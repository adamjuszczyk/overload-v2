import { useState, useRef, useEffect, Fragment } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { ChevronUp, ChevronDown, Link2, Trash2 } from 'lucide-react'
import BottomSheet from '../../components/BottomSheet'
import ConfirmDialog from '../../components/ConfirmDialog'
import ExercisePickerSheet from '../../components/ExercisePickerSheet'
import { errorReason } from '../../components/exercisePickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import type { Exercise, Program, WorkoutDay, ProgramExercise, DayOfWeek, ScheduleType } from '../../types'
import { queryClient } from '../../lib/queryClient'
import {
  useWorkoutDays,
  useCreateWorkoutDay,
  useUpdateWorkoutDayName,
  useDeleteWorkoutDay,
  useProgramExercises,
  useAddProgramExercise,
  useReorderProgramExercises,
  useDeleteProgramExercise,
  useUpdateProgramExerciseWeightUnit,
  useUpdateProgramExerciseRest,
  useUpdateProgramExerciseTempo,
  useToggleSupersetLink,
  useSupersetBlockRests,
  useUpdateSupersetBlockRest,
  useUpdateScheduleType,
  useSequenceItems,
  useAddSequenceItem,
  useUpdateSequenceItemWorkout,
  useRemoveSequenceItem,
  useReorderSequenceItems,
} from '../programs/usePrograms'
import { moveSequenceItem } from '../programs/sequenceItemsService'
import { useAssignWorkoutWeekday } from './usePlanner'
import { useSettingsStore } from '../settings/settingsStore'
import { useSettings } from '../settings/useSettings'
import { groupIntoUnits, moveUnit, isLinkedGap, planLinkToggle } from '../../lib/supersetGroups.js'
import { formatRestTime } from '../../lib/formatRestTime'
import { RestStepper, TempoEditor, UnitChips, BlockRestEditor, WarmupRoutineEditor } from './designFieldEditors'
import { CAPTION, CARD, Chevron, DashedButton, HEADING, IconButton, MONO, Spinner, ruleAbove, ruleBelow } from './plannerChrome'

// Step 2 — Exercises and order (SPEC.md "Stepped program planner" step 2; TASKS.md "step 2 adds workouts, exercises (existing picker), order
// (up/down) and one weekday per workout"; boards PP2, PP2b, PP2c, PP2d, PP2d2, PP2e, PP2f, PP4, PP4b and PP6). Serves the planner only (a saved
// program): chunk 33 removed Plan's program tab, the only other caller, and the planner refuses a run's copy, so nothing edits a running program's
// workouts or schedule any more (SPEC Programs and runs [P1.1]: fixed for the run).
//
// Chunk 68 draws it the way the boards do, over every write it had (every hook below is called with the arguments it was before the chunk):
//   - WEEKDAY | SEQUENCE is one segmented box; each workout is a card, shut to its name and its weekday or open to its editor (the first one is
//     open to begin with, a workout just added opens, a tap on a shut card opens it and shuts the one that was open);
//   - an open workout is its name (a tap renames it in place), its trash, its weekday chips, its exercises as numbered rows, + ADD EXERCISE and the
//     warmup routine. An exercise row says what is set on it (REST, REST AFTER, TEMPO) and opens, in place, to its muscle group, move up / down,
//     remove, UNIT, REST, REST AFTER, TEMPO and, in a superset, SUPERSET REST. One exercise is open at a time. A superset's members share the
//     rail, and the small link between two rows links or unlinks them;
//   - the add-exercise sheet is the shared picker (chunk 41's `ExercisePickerSheet`, add mode, `stayOpenAfterAdd`): a tap writes the exercise and
//     the list stays for the next one, the exercises already in the workout left out as they are added. The old `programs/ExercisePicker` is gone;
//   - the sheets (add workout, add or change a slot) are `BottomSheet`s; every confirm (delete a workout, remove an exercise, a warmup item or a
//     slot) is `ConfirmDialog` with the board's words.
//
// Schedule type (chunk 25 — SPEC.md "Scheduling → Sequence" / TASKS.md "Planner step 2 gains the schedule type and a sequence editor"): a
// WEEKDAY/SEQUENCE toggle (useUpdateScheduleType), never gated by volumeReadOnly — same "schedule is not volume" posture the weekday chip row takes,
// and "nothing is converted automatically" (TASKS.md's G14 prompt, DECISIONS 44 (a)): flipping it only ever changes v2_programs.schedule_type
// itself. WEEKDAY shows the per-workout weekday chip row; SEQUENCE hides that row (schedule is always '{}' for a sequence program — v2_plan_week's
// own header) and shows SequenceEditor (below) instead: one program-level ordered list of workout/rest slots (v2_program_sequence_items), up/down, a
// workout may appear more than once (SPEC, G8).
//
// Warmup routine (chunk 18 — SPEC.md "Warmup routine"): per workout, in the program, never gated by volumeReadOnly, editable for both planning
// types (designFieldEditors.tsx's WarmupRoutineEditor). Rest / rest-after / superset rest (chunk 16), tempo (chunk 17) and superset grouping
// (chunk 13) are design fields too: run-wide, never gated by volumeReadOnly. A reorder moves a whole linked run as one unit (moveUnit).
//
// `volumeReadOnly` (chunk 9's own rule, SPEC.md "Programs and runs" — "Volume — the exercise list and the sets... week-dependent: read-only")
// gates workout-level and exercise-level structure alike: add/rename/delete a workout, add/reorder/delete an exercise. It never gates the weekday
// assignment — scheduling WHEN a workout runs isn't "volume" (how much).
//
// Display choices no board settles, provisional under D31: a day another workout holds is drawn dimmed, as the board draws it, and stays tappable
// (the write is unchanged: it takes the day); a failed add of an exercise is a banner over the screen with the real reason, since PP2d draws none.
const DAYS: { key: DayOfWeek; label: string }[] = [
  { key: 'monday', label: 'MON' },
  { key: 'tuesday', label: 'TUE' },
  { key: 'wednesday', label: 'WED' },
  { key: 'thursday', label: 'THU' },
  { key: 'friday', label: 'FRI' },
  { key: 'saturday', label: 'SAT' },
  { key: 'sunday', label: 'SUN' },
]

const NAME_STYLE: CSSProperties = { ...HEADING, fontSize: 18, color: 'var(--text-primary)' }

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

const SUBMIT_STYLE: CSSProperties = { height: 52, boxSizing: 'border-box', borderRadius: 10, borderWidth: 0, fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, letterSpacing: '0.03em' }

export default function StepExercises({
  program,
  volumeReadOnly,
}: {
  program: Program
  volumeReadOnly: boolean
}) {
  const { data: workoutDays = [], isLoading } = useWorkoutDays(program.id)
  const createDay = useCreateWorkoutDay(program.id)

  // Chunk 25 — defaults to 'weekday' (the column default — every program predating this chunk, and any hand-built test fixture, reads this way).
  const scheduleType: ScheduleType = program.scheduleType ?? 'weekday'
  const updateScheduleType = useUpdateScheduleType()

  const [showAddDay, setShowAddDay] = useState(false)
  const [newDayName, setNewDayName] = useState('')
  // undefined: the first workout is open (nothing was tapped yet); null: none is.
  const [openDayId, setOpenDayId] = useState<string | null | undefined>(undefined)
  const effectiveOpenId = openDayId === undefined ? (workoutDays[0]?.id ?? null) : openDayId

  async function handleCreateDay(e?: React.FormEvent) {
    e?.preventDefault()
    const trimmed = newDayName.trim()
    if (!trimmed || createDay.isPending) return
    const created = await createDay.mutateAsync({ name: trimmed, position: workoutDays.length })
    setNewDayName('')
    setShowAddDay(false)
    if (created?.id) setOpenDayId(created.id)
  }

  if (isLoading) return <Spinner label="Loading workouts" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Schedule type (chunk 25) — never gated by volumeReadOnly, same posture the weekday chip row takes. One segmented box, as PP2 draws it. */}
      <div role="group" aria-label="Schedule type" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', height: 44, boxSizing: 'border-box', marginBottom: 8, borderRadius: 10, ...hairline('var(--border)'), background: 'var(--surface)', overflow: 'hidden' }}>
        {(['weekday', 'sequence'] as const).map((st) => (
          <button
            key={st}
            type="button"
            aria-pressed={scheduleType === st}
            onClick={() => { if (st !== scheduleType) updateScheduleType.mutate({ id: program.id, scheduleType: st }) }}
            disabled={updateScheduleType.isPending}
            style={{ ...MONO, borderWidth: 0, padding: 0, background: scheduleType === st ? 'var(--accent)' : 'transparent', color: scheduleType === st ? 'var(--on-accent)' : 'var(--text-secondary)', fontSize: 10, letterSpacing: '0.2em', cursor: updateScheduleType.isPending ? 'default' : 'pointer' }}
          >
            {st.toUpperCase()}
          </button>
        ))}
      </div>

      {scheduleType === 'sequence' && <SequenceEditor programId={program.id} workoutDays={workoutDays} />}

      {workoutDays.length === 0 && (
        <p style={{ ...CAPTION, margin: 0, textAlign: 'center', padding: '24px 0' }}>NO WORKOUTS YET</p>
      )}

      {workoutDays.map((day) => (
        <WorkoutCard
          key={day.id}
          programId={program.id}
          workoutDay={day}
          schedule={program.schedule}
          scheduleType={scheduleType}
          volumeReadOnly={volumeReadOnly}
          open={effectiveOpenId === day.id}
          onToggle={() => setOpenDayId(effectiveOpenId === day.id ? null : day.id)}
        />
      ))}

      {!volumeReadOnly && <DashedButton label="ADD WORKOUT" height={52} radius={12} onClick={() => { setNewDayName(''); setShowAddDay(true) }} />}

      {showAddDay && (
        <BottomSheet
          eyebrow={program.name.toUpperCase()}
          title="Add workout"
          onClose={() => setShowAddDay(false)}
          footer={
            <button
              type="button"
              onClick={() => void handleCreateDay()}
              disabled={createDay.isPending}
              style={{ ...SUBMIT_STYLE, width: '100%', background: createDay.isPending ? 'var(--surface-raised)' : 'var(--accent)', color: createDay.isPending ? 'var(--text-dim)' : 'var(--on-accent)', cursor: createDay.isPending ? 'default' : 'pointer' }}
            >
              {createDay.isPending ? '…' : 'ADD WORKOUT'}
            </button>
          }
        >
          <form onSubmit={handleCreateDay} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label htmlFor="planner-new-workout-name" style={CAPTION}>
              WORKOUT NAME
            </label>
            <input
              id="planner-new-workout-name"
              type="text"
              value={newDayName}
              onChange={(e) => setNewDayName(e.target.value)}
              placeholder="e.g. Push Day"
              autoFocus
              style={{ height: 52, boxSizing: 'border-box', borderRadius: 10, borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--accent)', background: 'var(--surface)', padding: '0 14px', fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', outline: 'none' }}
            />
          </form>
        </BottomSheet>
      )}
    </div>
  )
}

// ─── One workout: shut to its name and weekday, or open to its name, weekday, exercises and routine ─────────────────────────────────────────

function WorkoutCard({
  programId,
  workoutDay,
  schedule,
  scheduleType,
  volumeReadOnly,
  open,
  onToggle,
}: {
  programId: string
  workoutDay: WorkoutDay
  schedule: Program['schedule']
  // Chunk 25 — optional, defaults to 'weekday': gates the weekday chip row, same "may not exist yet" fallback convention every other optional prop
  // on this screen already takes.
  scheduleType?: ScheduleType
  volumeReadOnly: boolean
  open: boolean
  onToggle: () => void
}) {
  const { data: exercises = [], isLoading } = useProgramExercises(workoutDay.id)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDeleteExercise, setConfirmDeleteExercise] = useState<{ id: string; name: string } | null>(null)
  const [openExerciseId, setOpenExerciseId] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const updateName = useUpdateWorkoutDayName(programId)
  const deleteDay = useDeleteWorkoutDay(programId)
  const reorder = useReorderProgramExercises(workoutDay.id)
  const deleteExercise = useDeleteProgramExercise(workoutDay.id)
  const updateWeightUnit = useUpdateProgramExerciseWeightUnit(workoutDay.id)
  const updateRest = useUpdateProgramExerciseRest(workoutDay.id)
  const updateTempo = useUpdateProgramExerciseTempo(workoutDay.id)
  const assignWeekday = useAssignWorkoutWeekday(programId)
  const toggleLink = useToggleSupersetLink(workoutDay.id)
  // Chunk 16 (SPEC "Rest"/"Supersets") — this workout's own superset blocks' rest fields, same "one fetch per workout" batching as
  // useProgramExercises above.
  const { data: blockRests = [] } = useSupersetBlockRests(workoutDay.id)
  const blockRestById = new Map(blockRests.map((b) => [b.id, b]))
  const updateBlockRest = useUpdateSupersetBlockRest(workoutDay.id)
  const globalWeightUnit = useSettingsStore((s) => s.weightUnit)

  // Contiguous same-block runs, in this workout's own exercise order — one "unit" moves together on reorder (moveUnit).
  const units = groupIntoUnits(exercises)
  const unitIndexByExerciseId = new Map<string, number>()
  units.forEach((unit, unitIndex) => unit.forEach((pe) => unitIndexByExerciseId.set(pe.id, unitIndex)))

  useEffect(() => {
    if (editingName) nameRef.current?.focus()
  }, [editingName])

  async function saveName() {
    const trimmed = nameValue.trim()
    if (trimmed && trimmed !== workoutDay.name) {
      await updateName.mutateAsync({ id: workoutDay.id, name: trimmed })
    }
    setEditingName(false)
  }

  // Moves the WHOLE unit containing exercises[index] — SPEC "Supersets": "Every reorder (program, week plan, session) moves a superset as one
  // block." With no grouping at all (every unit size 1), moveUnit degrades to exactly the old adjacent-swap behaviour, so this still sends the full
  // list in its new order, byte-identical to before for that case.
  function moveExercise(index: number, direction: 'up' | 'down') {
    const next = moveUnit(exercises, index, direction)
    if (next === exercises) return
    queryClient.setQueryData(
      ['v2_programExercises', workoutDay.id],
      next.map((ex, i) => ({ ...ex, position: i })),
    )
    reorder.mutate(next.map((ex, i) => ({ id: ex.id, position: i })))
  }

  // Toggles the gap after exercises[gapIndex] — link merges the two neighbouring runs into one block, unlink splits one run in two
  // (supersetGroups.ts's planLinkToggle decides exactly which ids get which block id, including minting a fresh one when needed).
  function handleToggleLink(gapIndex: number) {
    toggleLink.mutate(planLinkToggle(exercises, gapIndex))
  }

  const weekday = (scheduleType ?? 'weekday') === 'weekday'
  const currentDow = DAYS.find((d) => schedule[d.key] === workoutDay.id)?.key ?? null

  if (!open) {
    const dayLabel = weekday ? DAYS.find((d) => d.key === currentDow)?.label : undefined
    return (
      <button
        type="button"
        aria-expanded={false}
        aria-label={`Show editor for ${workoutDay.name}`}
        onClick={onToggle}
        style={{ ...CARD, width: '100%', height: 64, padding: '0 4px 0 16px', display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer' }}
      >
        <span style={{ ...HEADING, flex: 1, minWidth: 0, fontSize: 16, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{workoutDay.name}</span>
        {dayLabel && <span style={{ ...MONO, flex: '0 0 auto', fontSize: 10, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>{dayLabel}</span>}
        <span style={{ flex: '0 0 auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          <Chevron />
        </span>
      </button>
    )
  }

  return (
    <div style={{ ...CARD, padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Name row: the name renames it in place (Enter or a tap away saves), then the trash and the chevron that shuts the card. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: -10 }}>
        {editingName ? (
          <input
            ref={nameRef}
            aria-label="Workout name"
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') nameRef.current?.blur() }}
            style={{ ...NAME_STYLE, flex: 1, minWidth: 0, height: 44, boxSizing: 'border-box', borderRadius: 10, borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--accent)', background: 'var(--surface)', padding: '0 12px', fontSize: 16, outline: 'none' }}
          />
        ) : (
          <button
            type="button"
            aria-label={`Rename ${workoutDay.name}`}
            onClick={() => { if (volumeReadOnly) return; setNameValue(workoutDay.name); setEditingName(true) }}
            disabled={volumeReadOnly}
            style={{ ...NAME_STYLE, flex: 1, minWidth: 0, height: 44, padding: 0, borderWidth: 0, background: 'transparent', textAlign: 'left', cursor: volumeReadOnly ? 'default' : 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {workoutDay.name}
          </button>
        )}
        {!volumeReadOnly && (
          <IconButton label={`Delete ${workoutDay.name}`} onClick={() => setConfirmDelete(true)}>
            <Trash2 size={17} />
          </IconButton>
        )}
        <IconButton label={`Hide editor for ${workoutDay.name}`} expanded onClick={onToggle}>
          <Chevron up />
        </IconButton>
      </div>

      {/* Weekday chip row — always editable, never gated by volumeReadOnly (schedule is "when", not "volume"). Single-select: tapping the
          already-assigned day clears it (rest); tapping another day moves the assignment there, so this workout is never on two days at once
          (TASKS.md "one weekday per workout"). Chunk 25 — hidden for a sequence program: program.schedule is always '{}' there. */}
      {weekday && (
        <div role="group" aria-label="Weekday" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
          {DAYS.map(({ key, label }) => {
            const active = currentDow === key
            const heldByAnother = !active && !!schedule[key] && schedule[key] !== workoutDay.id
            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => assignWeekday.mutate({ schedule, workoutDayId: workoutDay.id, dow: active ? null : key })}
                disabled={assignWeekday.isPending}
                style={{ ...MONO, height: 44, padding: 0, boxSizing: 'border-box', borderRadius: 8, ...hairline(active ? 'var(--accent)' : 'var(--border)'), background: active ? 'var(--accent-muted)' : heldByAnother ? 'var(--surface-raised)' : 'var(--surface)', color: active ? 'var(--accent)' : heldByAnother ? 'var(--text-dim)' : 'var(--text-secondary)', fontSize: 10, letterSpacing: '0.06em', cursor: assignWeekday.isPending ? 'default' : 'pointer' }}
              >
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Exercises: numbered rows edge to edge in the card, a link between every two, the open one's editor in place. */}
      <div style={{ margin: '4px -16px 0', ...ruleAbove(), display: 'flex', flexDirection: 'column' }}>
        {isLoading && <Spinner label="Loading exercises" size={16} padding="16px 0" />}

        {!isLoading && exercises.length === 0 && (
          <div style={{ padding: '12px 16px', ...ruleBelow() }}>
            {volumeReadOnly ? (
              <p style={{ ...CAPTION, margin: 0, textAlign: 'center', padding: '12px 0' }}>NO EXERCISES YET</p>
            ) : (
              <DashedButton label="ADD AN EXERCISE" height={48} onClick={() => setShowPicker(true)} />
            )}
          </div>
        )}

        {!isLoading && exercises.map((ex, index) => {
          const unitIndex = unitIndexByExerciseId.get(ex.id) ?? index
          const unit = units[unitIndex] ?? [ex]
          const number = String(index + 1).padStart(2, '0')
          const linkedAbove = index > 0 && isLinkedGap(exercises, index - 1)
          const linkedBelow = index < exercises.length - 1 && isLinkedGap(exercises, index)
          const exerciseName = ex.exercise?.name ?? '—'
          return (
            <Fragment key={ex.id}>
              {openExerciseId === ex.id ? (
                <OpenExercise
                  pe={ex}
                  number={number}
                  railUp={linkedAbove}
                  railDown={linkedBelow}
                  readOnly={volumeReadOnly}
                  canMoveUp={unitIndex > 0}
                  canMoveDown={unitIndex < units.length - 1}
                  inSuperset={unit.length >= 2 && !!ex.supersetBlockId}
                  blockRest={ex.supersetBlockId ? (blockRestById.get(ex.supersetBlockId) ?? null) : null}
                  globalWeightUnit={globalWeightUnit}
                  onClose={() => setOpenExerciseId(null)}
                  onMoveUp={() => moveExercise(index, 'up')}
                  onMoveDown={() => moveExercise(index, 'down')}
                  onDelete={() => setConfirmDeleteExercise({ id: ex.id, name: ex.exercise?.name ?? 'this exercise' })}
                  onWeightUnit={(weightUnit) => updateWeightUnit.mutate({ id: ex.id, weightUnit })}
                  onRest={(changes) => updateRest.mutate({ id: ex.id, changes })}
                  onTempo={(tempo) => updateTempo.mutate({ id: ex.id, tempo })}
                  onBlockRest={(changes) => updateBlockRest.mutate({ id: ex.supersetBlockId!, changes })}
                />
              ) : (
                <ShutExercise pe={ex} number={number} railUp={linkedAbove} railDown={linkedBelow} onOpen={() => setOpenExerciseId(ex.id)} />
              )}
              {/* Chunk 13 — never gated by volumeReadOnly, see this file's own header comment on why grouping isn't "volume". */}
              {index < exercises.length - 1 && (
                <LinkGap
                  above={exerciseName}
                  below={exercises[index + 1].exercise?.name ?? '—'}
                  linked={linkedBelow}
                  disabled={toggleLink.isPending}
                  onToggle={() => handleToggleLink(index)}
                />
              )}
            </Fragment>
          )
        })}
        {exercises.length > 0 && <div style={{ height: 1, background: 'var(--border-subtle)' }} />}
      </div>

      {!isLoading && !volumeReadOnly && exercises.length > 0 && <DashedButton label="ADD EXERCISE" onClick={() => setShowPicker(true)} />}

      {/* Warmup routine checklist (chunk 18 — SPEC.md "Warmup routine" / "Planner step 2") — below the exercise list. Never gated by volumeReadOnly. */}
      <WarmupRoutineEditor workoutDayId={workoutDay.id} />

      {showPicker && !volumeReadOnly && <AddExerciseSheet workoutDay={workoutDay} exercises={exercises} onClose={() => setShowPicker(false)} />}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete “${workoutDay.name}”?`}
          body="This removes the workout and every exercise in it. This can't be undone."
          confirmLabel="DELETE"
          danger
          isPending={deleteDay.isPending}
          onConfirm={() => { deleteDay.mutate({ id: workoutDay.id, schedule }); setConfirmDelete(false) }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {confirmDeleteExercise && (
        <ConfirmDialog
          title={`Remove “${confirmDeleteExercise.name}”?`}
          body="This also removes its planned sets here. This can't be undone."
          confirmLabel="REMOVE"
          danger
          isPending={deleteExercise.isPending}
          onConfirm={() => {
            deleteExercise.mutate(confirmDeleteExercise.id)
            if (confirmDeleteExercise.id === openExerciseId) setOpenExerciseId(null)
            setConfirmDeleteExercise(null)
          }}
          onCancel={() => setConfirmDeleteExercise(null)}
        />
      )}
    </div>
  )
}

// ─── The add-exercise sheet: the shared picker, writing through the hook the old one did ─────────────────────────────────────────────────

// PP2d: the sheet stays open after a tap ("Tap to add. The list stays open for the next one."), and the exercises the workout already holds are
// never listed: `exclude` is the workout's own live list, so an exercise leaves the list as soon as it has landed. What a tap writes is what the
// old picker's did: `useAddProgramExercise` with the exercise, the next position and the weight unit RESOLVED at add time (TASKS.md §4 item 28:
// "a freshly added exercise has no per-exercise override yet, so 'resolve' is just 'today's global default', written as a real value rather than
// NULL"), read from the settings query itself and gated on its loading, not from the store (which mirrors the query a frame late and reports
// the default 'kg' until it has: a fast add on a slow load could write a wrong literal that is permanent: found in adversarial review). One add
// is out at a time: a second tap in the same instant (or while the first is still out) writes nothing, so a list that hasn't yet dropped the row
// can't add it twice (a ref says so: `isPending` only turns true once React has drawn again).
function AddExerciseSheet({ workoutDay, exercises, onClose }: { workoutDay: WorkoutDay; exercises: ProgramExercise[]; onClose: () => void }) {
  const add = useAddProgramExercise(workoutDay.id)
  const { data: settings, isLoading: settingsLoading } = useSettings()
  const inFlight = useRef(false)
  const [failure, setFailure] = useState<{ name: string; reason: unknown } | null>(null)

  async function pick(exercise: Exercise) {
    if (settingsLoading || inFlight.current) return
    inFlight.current = true
    setFailure(null)
    try {
      await add.mutateAsync({ exerciseId: exercise.id, position: exercises.length, weightUnit: settings.weightUnit })
    } catch (reason) {
      setFailure({ name: exercise.name, reason })
    } finally {
      inFlight.current = false
    }
  }

  return (
    <>
      <ExercisePickerSheet
        mode="add"
        eyebrow={workoutDay.name.toUpperCase()}
        title="Add exercise"
        stayOpenAfterAdd
        showGroup={false}
        exclude={exercises.map((e) => e.exerciseId)}
        onPick={pick}
        onClose={onClose}
      />
      {failure &&
        createPortal(
          <div role="alert" style={{ position: 'fixed', top: 16, left: 16, right: 16, zIndex: 60, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 4, padding: '12px 14px', borderRadius: 12, ...hairline('var(--border)'), background: 'var(--surface-overlay)' }}>
            <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{`Couldn't add ${failure.name}.`}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{errorReason(failure.reason, offline())}</span>
          </div>,
          document.body,
        )}
    </>
  )
}

// ─── Exercise rows ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// What is set on an exercise, drawn on its shut row (PP2): REST, REST AFTER and TEMPO, each only when it is set (the standing UI rule).
function marksOf(pe: ProgramExercise): string[] {
  const marks: string[] = []
  if (pe.restSeconds != null) marks.push(`REST ${formatRestTime(pe.restSeconds)}`)
  if (pe.restAfterSeconds != null) marks.push(`REST AFTER ${formatRestTime(pe.restAfterSeconds)}`)
  if (pe.tempo) marks.push(`TEMPO ${pe.tempo}`)
  return marks
}

const RAIL: CSSProperties = { position: 'absolute', left: 25, width: 2, background: 'var(--accent)' }

function ShutExercise({ pe, number, railUp, railDown, onOpen }: { pe: ProgramExercise; number: string; railUp: boolean; railDown: boolean; onOpen: () => void }) {
  const marks = marksOf(pe)
  const name = pe.exercise?.name ?? '—'
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', minHeight: 64, paddingRight: 6 }}>
      <div style={{ position: 'relative', flex: '0 0 auto', width: 52, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {railUp && <span aria-hidden="true" style={{ ...RAIL, top: 0, height: 'calc(50% - 11px)' }} />}
        {railDown && <span aria-hidden="true" style={{ ...RAIL, bottom: 0, height: 'calc(50% - 11px)' }} />}
        <span style={{ ...MONO, fontSize: 12, color: 'var(--text-muted)' }}>{number}</span>
      </div>
      <button
        type="button"
        aria-expanded={false}
        aria-label={`Edit ${name}`}
        onClick={onOpen}
        style={{ flex: 1, minWidth: 0, padding: '12px 0', borderWidth: 0, background: 'transparent', textAlign: 'left', display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
      >
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.2, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{name}</span>
          {marks.length > 0 && (
            <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {marks.map((mark) => (
                <span key={mark} style={{ ...MONO, height: 22, boxSizing: 'border-box', padding: '0 7px', borderRadius: 4, background: 'var(--surface-raised)', ...hairline('var(--border-subtle)'), display: 'inline-flex', alignItems: 'center', fontSize: 10, letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
                  {mark}
                </span>
              ))}
            </span>
          )}
        </span>
        <span style={{ flex: '0 0 auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
          <Chevron />
        </span>
      </button>
    </div>
  )
}

function OpenExercise({
  pe,
  number,
  railUp,
  railDown,
  readOnly,
  canMoveUp,
  canMoveDown,
  inSuperset,
  blockRest,
  globalWeightUnit,
  onClose,
  onMoveUp,
  onMoveDown,
  onDelete,
  onWeightUnit,
  onRest,
  onTempo,
  onBlockRest,
}: {
  pe: ProgramExercise
  number: string
  railUp: boolean
  railDown: boolean
  readOnly: boolean
  // The UNIT's own position among units, not this row's among rows (a superset moves as one).
  canMoveUp: boolean
  canMoveDown: boolean
  inSuperset: boolean
  blockRest: { restWithinRoundSeconds: number | null; restAfterRoundSeconds: number | null } | null
  globalWeightUnit: 'kg' | 'lbs'
  onClose: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  onWeightUnit: (unit: 'kg' | 'lbs' | null) => void
  // Chunk 16 (SPEC "Rest") — design field, never gated by `readOnly` (the planner's volumeReadOnly passed straight through: rest stays editable
  // regardless). null = "no override": REST falls through to the global Settings value, REST AFTER simply never applies (the exercise's own last
  // set then also falls through to REST, then global); no tempo means none is shown during the workout.
  onRest: (changes: { restSeconds?: number | null; restAfterSeconds?: number | null }) => void
  // Chunk 17 (SPEC "Tempo") — same posture. Already-normalised text or null; TempoEditor is the one place that calls normaliseTempo, so this callback
  // only ever receives a valid tempo or null, never raw user input.
  onTempo: (tempo: string | null) => void
  onBlockRest: (changes: { restWithinRoundSeconds?: number | null; restAfterRoundSeconds?: number | null }) => void
}) {
  const name = pe.exercise?.name ?? '—'
  return (
    <div style={{ background: 'var(--surface-raised)', display: 'flex', alignItems: 'stretch' }}>
      <div style={{ position: 'relative', flex: '0 0 auto', width: 52 }}>
        {railUp && <span aria-hidden="true" style={{ ...RAIL, top: 0, height: 19 }} />}
        <span style={{ ...MONO, position: 'absolute', left: 0, right: 0, top: 0, height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: 'var(--accent)' }}>{number}</span>
        {railDown && <span aria-hidden="true" style={{ ...RAIL, top: 41, bottom: 0 }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0, padding: '0 16px 16px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', minHeight: 60, marginRight: -10 }}>
          <button
            type="button"
            aria-expanded
            aria-label={`Close ${name}`}
            onClick={onClose}
            style={{ flex: 1, minWidth: 0, minHeight: 52, padding: 0, borderWidth: 0, background: 'transparent', textAlign: 'left', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, cursor: 'pointer' }}
          >
            <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.2, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{name}</span>
            <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.15em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{pe.exercise?.muscleGroup ?? ''}</span>
          </button>
          {!readOnly && (
            <>
              <IconButton label={`Move ${name} up`} onClick={onMoveUp} disabled={!canMoveUp}>
                <ChevronUp size={16} strokeWidth={2.2} />
              </IconButton>
              <IconButton label={`Move ${name} down`} onClick={onMoveDown} disabled={!canMoveDown}>
                <ChevronDown size={16} strokeWidth={2.2} />
              </IconButton>
              <IconButton label={`Remove ${name}`} onClick={onDelete}>
                <Trash2 size={16} />
              </IconButton>
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {/* Weight unit (existing field, v3 §2.4 / TASKS.md §4 item 28), minus the suggested-reps stepper that used to sit beside it (SPEC.md "Removals"). */}
          <div style={{ display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', alignItems: 'center' }}>
            <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)' }}>UNIT</span>
            <UnitChips value={pe.weightUnit} globalUnit={globalWeightUnit} disabled={readOnly} onChange={onWeightUnit} />
          </div>
          <RestStepper label="REST" value={pe.restSeconds ?? null} disabled={false} onChange={(v) => onRest({ restSeconds: v })} defaultText="GLOBAL" ariaLabel="rest" />
          <RestStepper label="REST AFTER" value={pe.restAfterSeconds ?? null} disabled={false} onChange={(v) => onRest({ restAfterSeconds: v })} defaultText="NONE" ariaLabel="rest after" />
          <TempoEditor value={pe.tempo ?? null} disabled={false} onChange={onTempo} />
        </div>

        {/* Chunk 16 (SPEC "Rest"/"Supersets": "Both overridable per superset") — a member's editor carries its block's own two fields; never gated
            by volumeReadOnly, same posture as the grouping toggle. */}
        {inSuperset && pe.supersetBlockId && <BlockRestEditor blockId={pe.supersetBlockId} rest={blockRest} onChange={onBlockRest} />}
      </div>
    </div>
  )
}

// The link between two rows (PP2): a small box in the rail, on the rule between them. Linked: the accent, and the rail runs through both numbers.
function LinkGap({ above, below, linked, disabled, onToggle }: { above: string; below: string; linked: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <div style={{ position: 'relative', height: 1, marginLeft: 52, background: 'var(--border-subtle)' }}>
      <button
        type="button"
        aria-pressed={linked}
        aria-label={linked ? `Unlink ${above} and ${below}` : `Link ${above} and ${below} as superset`}
        disabled={disabled}
        onClick={onToggle}
        style={{ position: 'absolute', left: -48, top: -22, width: 44, height: 44, padding: 0, borderWidth: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}
      >
        <span style={{ width: 24, height: 24, boxSizing: 'border-box', borderRadius: 6, ...hairline(linked ? 'var(--accent)' : 'var(--border)'), background: linked ? 'var(--accent)' : 'var(--surface)', color: linked ? 'var(--on-accent)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Link2 size={12} strokeWidth={2.2} aria-hidden="true" />
        </span>
      </button>
    </div>
  )
}

// ─── Sequence editor (chunk 25 — SPEC.md "Scheduling → Sequence" / TASKS.md "Planner step 2 gains the schedule type and a sequence editor
// (workout and rest-day slots, up/down; a workout may appear more than once)"; boards PP2b, PP2c) ──────────────────────────────────────────
// One per PROGRAM (not per workout — StepExercises' own top level renders this once, beside the schedule-type toggle), mirroring
// WarmupRoutineEditor's shape (add/reorder/remove, up/down arrows, a confirm before removing) with one structural difference: a slot's own "body"
// is which workout occupies it (or REST DAY), picked from a small sheet rather than typed — the slot sheet, below, reused for both "add a new slot"
// and "change an existing slot's workout".
function SequenceEditor({ programId, workoutDays }: { programId: string; workoutDays: WorkoutDay[] }) {
  const { data: items = [], isLoading } = useSequenceItems(programId)
  const addItem = useAddSequenceItem(programId)
  const updateItem = useUpdateSequenceItemWorkout(programId)
  const removeItem = useRemoveSequenceItem(programId)
  const reorderItems = useReorderSequenceItems(programId)

  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null)
  // Which existing slot's workout is being re-picked — null while adding a brand-new slot instead (showAddPicker), never both at once.
  const [pickerForId, setPickerForId] = useState<string | null>(null)
  const [showAddPicker, setShowAddPicker] = useState(false)

  // Same "write the optimistic order into this query's cache, then fire the mutation" shape WorkoutCard's own moveExercise takes.
  function moveItem(index: number, direction: 'up' | 'down') {
    const next = moveSequenceItem(items, index, direction)
    if (next === items) return
    const reindexed = next.map((item, i) => ({ ...item, position: i }))
    queryClient.setQueryData(['v2_programSequenceItems', programId], reindexed)
    reorderItems.mutate(reindexed.map((item, i) => ({ id: item.id, position: i })))
  }

  function workoutName(id: string | null): string {
    if (id === null) return 'REST DAY'
    return workoutDays.find((d) => d.id === id)?.name ?? '—'
  }

  async function handlePick(workoutDayId: string | null) {
    if (pickerForId) {
      updateItem.mutate({ id: pickerForId, workoutDayId })
      setPickerForId(null)
    } else if (showAddPicker) {
      await addItem.mutateAsync({ position: items.length, workoutDayId })
      setShowAddPicker(false)
    }
  }

  const changingIndex = pickerForId ? items.findIndex((item) => item.id === pickerForId) : -1
  const slotNumber = (index: number) => String(index + 1).padStart(2, '0')

  return (
    <div role="region" aria-label="Sequence editor" style={{ ...CARD, padding: '8px 16px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {isLoading && <Spinner label="Loading the sequence" size={16} padding="12px 0" />}

      {!isLoading && items.length === 0 && <span style={{ ...CAPTION, letterSpacing: '0.12em', padding: '12px 0 4px' }}>NO SLOTS YET</span>}

      {!isLoading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {items.map((item, index) => (
            <SequenceItemRow
              key={item.id}
              number={slotNumber(index)}
              label={workoutName(item.workoutDayId)}
              isRest={item.workoutDayId === null}
              last={index === items.length - 1}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
              onMoveUp={() => moveItem(index, 'up')}
              onMoveDown={() => moveItem(index, 'down')}
              onChangeWorkout={() => setPickerForId(item.id)}
              onDelete={() => setConfirmRemove({ id: item.id, label: workoutName(item.workoutDayId) })}
            />
          ))}
        </div>
      )}

      <DashedButton label="ADD SLOT" onClick={() => setShowAddPicker(true)} />

      {(pickerForId !== null || showAddPicker) && (
        <BottomSheet
          eyebrow={`SEQUENCE · SLOT ${pickerForId ? slotNumber(Math.max(changingIndex, 0)) : slotNumber(items.length)}`}
          title={pickerForId ? 'Change slot' : 'Add slot'}
          onClose={() => { setPickerForId(null); setShowAddPicker(false) }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              type="button"
              onClick={() => handlePick(null)}
              style={{ ...MONO, height: 48, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border)'), background: 'var(--surface-raised)', color: 'var(--text-secondary)', padding: '0 14px', textAlign: 'left', fontSize: 12, letterSpacing: '0.15em', cursor: 'pointer' }}
            >
              REST DAY
            </button>
            {workoutDays.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => handlePick(d.id)}
                style={{ height: 48, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border)'), background: 'var(--surface)', color: 'var(--text-primary)', padding: '0 14px', textAlign: 'left', fontWeight: 600, fontSize: 15, overflowWrap: 'anywhere', cursor: 'pointer' }}
              >
                {d.name}
              </button>
            ))}
          </div>
        </BottomSheet>
      )}

      {confirmRemove && (
        <ConfirmDialog
          title="Remove this slot?"
          body={`“${confirmRemove.label}”. This can't be undone.`}
          confirmLabel="REMOVE"
          danger
          isPending={removeItem.isPending}
          onConfirm={() => { removeItem.mutate(confirmRemove.id); setConfirmRemove(null) }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </div>
  )
}

// One slot row — tap the label to open the workout/REST picker (never inline-edited, unlike a warmup item's free text), plus the same
// up/down/delete cluster WarmupItemRow's own row uses (PP2b names them "Move slot up", "Move slot down", "Remove slot").
function SequenceItemRow({
  number,
  label,
  isRest,
  last,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onChangeWorkout,
  onDelete,
}: {
  number: string
  label: string
  isRest: boolean
  last: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onChangeWorkout: () => void
  onDelete: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', minHeight: 48, ...(last ? {} : ruleBelow()) }}>
      <span style={{ ...MONO, flex: '0 0 auto', width: 28, fontSize: 12, color: 'var(--text-muted)' }}>{number}</span>
      <button
        type="button"
        aria-label={`Change slot ${number}: ${label}`}
        onClick={onChangeWorkout}
        style={{ flex: 1, minWidth: 0, height: 44, padding: 0, borderWidth: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer', overflowWrap: 'anywhere', ...(isRest ? { ...MONO, fontSize: 12, letterSpacing: '0.15em', color: 'var(--text-muted)' } : { fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }) }}
      >
        {label}
      </button>
      <div style={{ display: 'flex', flex: '0 0 auto', marginRight: -10 }}>
        <IconButton label="Move slot up" onClick={onMoveUp} disabled={!canMoveUp}>
          <ChevronUp size={16} strokeWidth={2.2} />
        </IconButton>
        <IconButton label="Move slot down" onClick={onMoveDown} disabled={!canMoveDown}>
          <ChevronDown size={16} strokeWidth={2.2} />
        </IconButton>
        <IconButton label="Remove slot" onClick={onDelete}>
          <Trash2 size={16} />
        </IconButton>
      </div>
    </div>
  )
}
