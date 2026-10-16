import { useState, useRef, useEffect, Fragment } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import type { Program, WorkoutDay, ProgramExercise, DayOfWeek, ScheduleType, WeightUnit } from '../../types'
import { queryClient } from '../../lib/queryClient'
import {
  useWorkoutDays,
  useCreateWorkoutDay,
  useUpdateWorkoutDayName,
  useDeleteWorkoutDay,
  useProgramExercises,
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
import ExercisePicker from '../programs/ExercisePicker'
import { groupIntoUnits, moveUnit, isLinkedGap, planLinkToggle } from '../../lib/supersetGroups.js'
import {
  RestStepper,
  TempoEditor,
  UnitChips,
  BlockRestEditor,
  WarmupRoutineEditor,
  SupersetLinkToggle,
  IconBtn,
  Sheet,
} from './designFieldEditors'

// Chunk 30: the design-field editors this file renders below (RestStepper,
// TempoEditor, UnitChips, BlockRestEditor, WarmupRoutineEditor,
// SupersetLinkToggle and the IconBtn/Sheet helpers) live in
// designFieldEditors.tsx now, so Plan's STRUCTURE view can show the same
// editors. Moved as they were: where this file's comments below say "below"
// or "above" about one of them, read "in designFieldEditors.tsx".
//
// Step 2 — Exercises and order (SPEC.md "Stepped program planner" step 2;
// TASKS.md "step 2 adds workouts, exercises (existing picker), order
// (up/down) and one weekday per workout"). Serves the planner only (a saved
// program): chunk 33 removed Plan's program tab, the only other caller, and the
// planner refuses a run's copy, so nothing edits a running program's workouts
// or schedule any more (SPEC Programs and runs [P1.1]: fixed for the run).
//
// Schedule type (chunk 25 — SPEC.md "Scheduling → Sequence" / TASKS.md
// "Planner step 2 gains the schedule type and a sequence editor"): a
// WEEKDAY/SEQUENCE toggle (useUpdateScheduleType), never gated by
// volumeReadOnly — same "schedule is not volume" posture the weekday
// chip row below already takes, and "nothing is converted automatically"
// (TASKS.md's G14 prompt, DECISIONS 44 (a)): flipping it only ever changes
// v2_programs.schedule_type itself. WEEKDAY shows exactly the per-workout
// weekday chip row this file has always rendered (unchanged); SEQUENCE
// hides that row (schedule is always '{}' for a sequence program —
// v2_plan_week's own header) and shows SequenceEditor (below) instead: one
// program-level ordered list of workout/rest slots (v2_program_sequence_
// items), up/down, a workout may appear more than once (SPEC, G8).
//

// Warmup routine (chunk 18 — SPEC.md "Warmup routine": "Per workout, in the
// program: a checklist shown at the top of the session... the warmup
// routine checklist" is explicitly step 2's own, per SPEC's "Planner step 2"
// excerpt). Design field, same posture as rest/tempo/superset grouping
// below: never gated by volumeReadOnly, editable for both planning types.
// Lives below the exercise list (WarmupRoutineEditor, below) — add an item,
// edit its text, remove it, and reorder with the same up/down arrow pattern
// the exercise rows above already use (moveWarmupItem,
// warmupRoutineService.ts). A blank body is refused and nothing is written,
// same "caller trims and checks, never the service" convention this file's
// own TempoEditor/WorkoutEditor.saveName already use. This is the routine
// ITSELF, not a tick — ticking happens only on the workout screen
// (GymSession.tsx's WarmupRoutineChecklist.tsx), is session-local, and is
// never written through this file or warmupRoutineService.ts at all.
//
// Rest / rest-after / superset rest (chunk 16 — SPEC.md "Rest"/"Programs and
// runs": design fields, "editable for both planning types... applying to
// this run from the next session on"). Like superset grouping above, NEVER
// gated by volumeReadOnly — rest is a design field, not "volume". Exercise-
// level REST/REST AFTER steppers live on ExerciseRow below; a block's own
// WITHIN ROUND/AFTER ROUND steppers render once per linked unit (2+
// members), right after its last member — BlockRestEditor, below.
//
// Tempo (chunk 17 — SPEC.md "Tempo"): same design-field posture as rest
// above — never gated by volumeReadOnly, editable for both planning types.
// Lives right beside REST/REST AFTER on ExerciseRow (TempoEditor, below),
// validated by plannerVocabulary.ts's normaliseTempo (chunk 2) — the one
// parser for this format anywhere in the app.
//
// Superset grouping (chunk 13 — SPEC.md "Supersets" / "Stepped program
// planner" step 2: "exercises per workout, their order, superset grouping")
// lives HERE too: a SupersetLinkToggle between every adjacent pair of rows
// links/unlinks them (src/lib/supersetGroups.ts's planLinkToggle decides
// the resulting block membership; useToggleSupersetLink, usePrograms.ts,
// performs the writes), and a reorder moves a whole linked run as one unit
// (moveUnit). Grouping is a design field (SPEC "Programs and runs"): never
// gated by volumeReadOnly, same posture the weekday row below already
// takes — "schedule is not volume", and neither is "which exercises share
// a block".
//
// `volumeReadOnly` (chunk 9's own rule, SPEC.md "Programs and runs" —
// "Volume — the exercise list and the sets... week-dependent: read-only")
// gates workout-level and exercise-level structure alike: add/rename/delete
// a workout, add/reorder/delete an exercise. It never gates the weekday
// assignment below — scheduling WHEN a workout runs isn't "volume" (how
// much), so it stays editable regardless of planning type (same posture the
// old ProgramBuilderPage's WeeklyScheduleGrid always took, for any program
// kind, before this chunk).
const DAYS: { key: DayOfWeek; label: string }[] = [
  { key: 'monday', label: 'MON' },
  { key: 'tuesday', label: 'TUE' },
  { key: 'wednesday', label: 'WED' },
  { key: 'thursday', label: 'THU' },
  { key: 'friday', label: 'FRI' },
  { key: 'saturday', label: 'SAT' },
  { key: 'sunday', label: 'SUN' },
]

export default function StepExercises({
  program,
  volumeReadOnly,
}: {
  program: Program
  volumeReadOnly: boolean
}) {
  const { data: workoutDays = [], isLoading } = useWorkoutDays(program.id)
  const createDay = useCreateWorkoutDay(program.id)

  // Chunk 25 — defaults to 'weekday' (the column default — every program
  // predating this chunk, and any hand-built test fixture, reads this way).
  const scheduleType: ScheduleType = program.scheduleType ?? 'weekday'
  const updateScheduleType = useUpdateScheduleType()

  const [showAddDay, setShowAddDay] = useState(false)
  const [newDayName, setNewDayName] = useState('')

  async function handleCreateDay(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newDayName.trim()
    if (!trimmed) return
    await createDay.mutateAsync({ name: trimmed, position: workoutDays.length })
    setNewDayName('')
    setShowAddDay(false)
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
        <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Schedule type (chunk 25) — never gated by volumeReadOnly, same
          posture the weekday chip row below already takes. A single-select
          toggle, same shape PlannerPage.tsx's own step switcher uses. */}
      <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
        {(['weekday', 'sequence'] as const).map((st) => (
          <button
            key={st}
            onClick={() => { if (st !== scheduleType) updateScheduleType.mutate({ id: program.id, scheduleType: st }) }}
            disabled={updateScheduleType.isPending}
            style={{ flex: 1, padding: '9px 0', background: scheduleType === st ? 'var(--accent)' : 'var(--surface)', border: 'none', cursor: updateScheduleType.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: scheduleType === st ? 'var(--on-accent)' : 'var(--text-muted)' }}
          >
            {st.toUpperCase()}
          </button>
        ))}
      </div>

      {scheduleType === 'sequence' && <SequenceEditor programId={program.id} workoutDays={workoutDays} />}

      {workoutDays.length === 0 && (
        <p style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
          NO WORKOUTS YET
        </p>
      )}

      {workoutDays.map((day) => (
        <WorkoutEditor
          key={day.id}
          programId={program.id}
          workoutDay={day}
          schedule={program.schedule}
          scheduleType={scheduleType}
          volumeReadOnly={volumeReadOnly}
        />
      ))}

      {!volumeReadOnly && (
        <button
          onClick={() => { setNewDayName(''); setShowAddDay(true) }}
          style={{ width: '100%', height: 52, background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 12, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13, letterSpacing: '1.5px' }}
        >
          <Plus size={16} style={{ color: 'var(--accent)' }} />
          ADD WORKOUT
        </button>
      )}

      {showAddDay && (
        <Sheet onClose={() => setShowAddDay(false)}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, letterSpacing: '1px', marginBottom: 20, color: 'var(--text-primary)' }}>
            ADD WORKOUT
          </p>
          <form onSubmit={handleCreateDay}>
            <label style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 8 }}>
              WORKOUT NAME
            </label>
            <input
              type="text"
              value={newDayName}
              onChange={(e) => setNewDayName(e.target.value)}
              placeholder="e.g. Push Day"
              autoFocus
              style={{ width: '100%', height: 52, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, padding: '0 16px', fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box', marginBottom: 20 }}
            />
            <button
              type="submit"
              disabled={createDay.isPending}
              style={{ width: '100%', height: 56, background: createDay.isPending ? 'var(--border-strong)' : 'var(--accent)', border: 'none', borderRadius: 11, cursor: createDay.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 15, letterSpacing: '2px', color: createDay.isPending ? 'var(--text-muted)' : 'var(--on-accent)' }}
            >
              {createDay.isPending ? '…' : 'ADD WORKOUT'}
            </button>
          </form>
        </Sheet>
      )}
    </div>
  )
}

// ─── One workout: name, weekday, exercises ─────────────────────────────────

function WorkoutEditor({
  programId,
  workoutDay,
  schedule,
  scheduleType,
  volumeReadOnly,
}: {
  programId: string
  workoutDay: WorkoutDay
  schedule: Program['schedule']
  // Chunk 25 — optional, defaults to 'weekday': gates the weekday chip row
  // below, same "may not exist yet" fallback convention every other optional
  // prop on this screen already takes.
  scheduleType?: ScheduleType
  volumeReadOnly: boolean
}) {
  const { data: exercises = [], isLoading } = useProgramExercises(workoutDay.id)
  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDeleteExercise, setConfirmDeleteExercise] = useState<{ id: string; name: string } | null>(null)
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
  // Chunk 16 (SPEC "Rest"/"Supersets") — this workout's own superset blocks'
  // rest fields, same "one fetch per workout" batching as useProgramExercises
  // above.
  const { data: blockRests = [] } = useSupersetBlockRests(workoutDay.id)
  const blockRestById = new Map(blockRests.map((b) => [b.id, b]))
  const updateBlockRest = useUpdateSupersetBlockRest(workoutDay.id)
  const globalWeightUnit = useSettingsStore((s) => s.weightUnit)

  // Contiguous same-block runs, in this workout's own exercise order — one
  // "unit" moves together on reorder (moveUnit), and is the thing a move
  // button shown on only its first member controls (see the render below).
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

  // Moves the WHOLE unit containing exercises[index] — SPEC "Supersets":
  // "Every reorder (program, week plan, session) moves a superset as one
  // block." With no grouping at all (every unit size 1 — every workout
  // before this chunk), moveUnit degrades to exactly the old adjacent-swap
  // behaviour, so this still sends the full list in its new order, byte-
  // identical to before for that case.
  function moveExercise(index: number, direction: 'up' | 'down') {
    const next = moveUnit(exercises, index, direction)
    if (next === exercises) return
    queryClient.setQueryData(
      ['v2_programExercises', workoutDay.id],
      next.map((ex, i) => ({ ...ex, position: i })),
    )
    reorder.mutate(next.map((ex, i) => ({ id: ex.id, position: i })))
  }

  // Toggles the gap after exercises[gapIndex] — link merges the two
  // neighbouring runs into one block, unlink splits one run in two
  // (supersetGroups.ts's planLinkToggle decides exactly which ids get which
  // block id, including minting a fresh one when needed).
  function handleToggleLink(gapIndex: number) {
    toggleLink.mutate(planLinkToggle(exercises, gapIndex))
  }

  const currentDow = DAYS.find((d) => schedule[d.key] === workoutDay.id)?.key ?? null

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Name row */}
      <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        {editingName ? (
          <input
            ref={nameRef}
            value={nameValue}
            onChange={(e) => setNameValue(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') nameRef.current?.blur() }}
            style={{ flex: 1, background: 'transparent', border: 'none', borderBottom: '1px solid var(--accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, color: 'var(--text-primary)', padding: '4px 0', outline: 'none' }}
          />
        ) : (
          <button
            onClick={() => { if (volumeReadOnly) return; setNameValue(workoutDay.name); setEditingName(true) }}
            disabled={volumeReadOnly}
            style={{ flex: 1, background: 'transparent', border: 'none', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16, color: 'var(--text-primary)', cursor: volumeReadOnly ? 'default' : 'pointer', textAlign: 'left', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {workoutDay.name}
          </button>
        )}
        {!volumeReadOnly && (
          <button
            onClick={() => setConfirmDelete(true)}
            aria-label={`Delete ${workoutDay.name}`}
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {/* Weekday chip row — always editable, never gated by volumeReadOnly
          (schedule is "when", not "volume"). Single-select: tapping the
          already-assigned day clears it (rest); tapping another day moves
          the assignment there, so this workout is never on two days at
          once (TASKS.md "one weekday per workout").
          Chunk 25 — hidden for a sequence program: program.schedule is
          always '{}' there (v2_plan_week's own header), so this row would
          have nothing to show; SequenceEditor (StepExercises' own top
          level) is that mode's equivalent, one per program rather than per
          workout. */}
      {(scheduleType ?? 'weekday') === 'weekday' && (
      <div className="hide-scrollbar" style={{ overflowX: 'auto', padding: '0 16px 12px' }}>
        <div style={{ display: 'flex', gap: 5 }}>
          {DAYS.map(({ key, label }) => {
            const active = currentDow === key
            return (
              <button
                key={key}
                onClick={() => assignWeekday.mutate({ schedule, workoutDayId: workoutDay.id, dow: active ? null : key })}
                disabled={assignWeekday.isPending}
                style={{
                  height: 26,
                  padding: '0 9px',
                  flexShrink: 0,
                  background: active ? 'var(--accent-muted)' : 'var(--surface-overlay)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                  borderRadius: 6,
                  cursor: assignWeekday.isPending ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '1px',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      )}

      <div style={{ height: 1, background: 'var(--border-subtle)' }} />

      {/* Exercises */}
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {isLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
            <div className="animate-spin" style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
          </div>
        )}

        {!isLoading && exercises.length === 0 && (
          volumeReadOnly ? (
            <p style={{ textAlign: 'center', padding: '12px 0', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-dim)' }}>
              NO EXERCISES YET
            </p>
          ) : (
            <button
              onClick={() => setShowPicker(true)}
              style={{ width: '100%', height: 48, background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 13 }}
            >
              <Plus size={14} style={{ color: 'var(--accent)' }} />
              Add an exercise
            </button>
          )
        )}

        {!isLoading && exercises.map((ex, index) => {
          const unit = units[unitIndexByExerciseId.get(ex.id) ?? index] ?? [ex]
          const unitIndex = unitIndexByExerciseId.get(ex.id) ?? index
          const isFirstInUnit = unit[0]?.id === ex.id
          const isLastInUnit = unit[unit.length - 1]?.id === ex.id
          return (
            <Fragment key={ex.id}>
              <ExerciseRow
                pe={ex}
                index={index}
                readOnly={volumeReadOnly}
                showMoveControls={isFirstInUnit}
                canMoveUp={unitIndex > 0}
                canMoveDown={unitIndex < units.length - 1}
                onMoveUp={() => moveExercise(index, 'up')}
                onMoveDown={() => moveExercise(index, 'down')}
                onDelete={() => setConfirmDeleteExercise({ id: ex.id, name: ex.exercise?.name ?? 'this exercise' })}
                globalWeightUnit={globalWeightUnit}
                onWeightUnit={(weightUnit) => updateWeightUnit.mutate({ id: ex.id, weightUnit })}
                onRest={(changes) => updateRest.mutate({ id: ex.id, changes })}
                onTempo={(tempo) => updateTempo.mutate({ id: ex.id, tempo })}
              />
              {/* Chunk 16 (SPEC "Rest"/"Supersets": "Both overridable per
                  superset") — once per linked unit (2+ members), right after
                  its last one; never gated by volumeReadOnly, same posture
                  as the grouping toggle right below. */}
              {isLastInUnit && unit.length >= 2 && ex.supersetBlockId && (
                <BlockRestEditor
                  blockId={ex.supersetBlockId}
                  rest={blockRestById.get(ex.supersetBlockId) ?? null}
                  onChange={(changes) => updateBlockRest.mutate({ id: ex.supersetBlockId!, changes })}
                />
              )}
              {/* Chunk 13 — never gated by volumeReadOnly, see this file's
                  own header comment on why grouping isn't "volume". */}
              {index < exercises.length - 1 && (
                <SupersetLinkToggle
                  linked={isLinkedGap(exercises, index)}
                  disabled={toggleLink.isPending}
                  onToggle={() => handleToggleLink(index)}
                />
              )}
            </Fragment>
          )
        })}

        {!isLoading && !volumeReadOnly && exercises.length > 0 && (
          <button
            onClick={() => setShowPicker(true)}
            style={{ width: '100%', height: 44, background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 12 }}
          >
            <Plus size={14} style={{ color: 'var(--accent)' }} />
            ADD EXERCISE
          </button>
        )}
      </div>

      {/* Warmup routine checklist (chunk 18 — SPEC.md "Warmup routine" /
          "Planner step 2") — below the exercise list, this file's own header
          comment above has the full reasoning. Never gated by
          volumeReadOnly (no readOnly prop passed at all — same posture
          RestStepper/TempoEditor already take on ExerciseRow, below). */}
      <WarmupRoutineEditor workoutDayId={workoutDay.id} />

      {showPicker && !volumeReadOnly && (
        <ExercisePicker
          workoutDayId={workoutDay.id}
          existingExerciseIds={exercises.map((e) => e.exerciseId)}
          onClose={() => setShowPicker(false)}
        />
      )}

      {confirmDelete && (
        <Sheet onClose={() => setConfirmDelete(false)}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
            Delete "{workoutDay.name}"?
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            This removes the workout and every exercise in it. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setConfirmDelete(false)}
              style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', color: 'var(--text-secondary)' }}
            >
              CANCEL
            </button>
            <button
              onClick={() => { deleteDay.mutate({ id: workoutDay.id, schedule }); setConfirmDelete(false) }}
              disabled={deleteDay.isPending}
              style={{ flex: 1, height: 50, background: 'rgba(248, 113, 113, 0.15)', border: 'none', borderRadius: 10, cursor: deleteDay.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: 'var(--error)' }}
            >
              {deleteDay.isPending ? '…' : 'DELETE'}
            </button>
          </div>
        </Sheet>
      )}

      {confirmDeleteExercise && (
        <Sheet onClose={() => setConfirmDeleteExercise(null)}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
            Remove "{confirmDeleteExercise.name}"?
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            This also removes its planned sets here. This cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setConfirmDeleteExercise(null)}
              style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', color: 'var(--text-secondary)' }}
            >
              CANCEL
            </button>
            <button
              onClick={() => {
                deleteExercise.mutate(confirmDeleteExercise.id)
                setConfirmDeleteExercise(null)
              }}
              disabled={deleteExercise.isPending}
              style={{ flex: 1, height: 50, background: 'rgba(248, 113, 113, 0.15)', border: 'none', borderRadius: 10, cursor: deleteExercise.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: 'var(--error)' }}
            >
              {deleteExercise.isPending ? '…' : 'REMOVE'}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// ─── Exercise row — name, order, weight unit (suggested reps removed) ──────

function ExerciseRow({
  pe,
  index,
  readOnly,
  showMoveControls,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
  globalWeightUnit,
  onWeightUnit,
  onRest,
  onTempo,
}: {
  pe: ProgramExercise
  index: number
  readOnly: boolean
  // Chunk 13 — shown only on a unit's FIRST member (a plain, ungrouped
  // exercise is always its own size-1 unit, so this is always true then —
  // unchanged from before this chunk). canMoveUp/canMoveDown reflect the
  // UNIT's own position among units, not this row's own index among rows.
  showMoveControls: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onDelete: () => void
  globalWeightUnit: WeightUnit
  onWeightUnit: (unit: WeightUnit | null) => void
  // Chunk 16 (SPEC "Rest") — design field, never gated by `readOnly` (this
  // row's own `readOnly` IS volumeReadOnly, passed straight through from
  // StepExercises — see this file's own header comment on why rest stays
  // editable regardless).
  onRest: (changes: { restSeconds?: number | null; restAfterSeconds?: number | null }) => void
  // Chunk 17 (SPEC "Tempo") — same posture: a design field, never gated by
  // `readOnly`. Already-normalised text or null; TempoEditor (below) is the
  // one place this row calls normaliseTempo, so this callback only ever
  // receives a valid tempo or null, never raw user input.
  onTempo: (tempo: string | null) => void
}) {
  return (
    <div style={{ background: 'var(--surface-overlay)', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, color: 'var(--text-dim)', flexShrink: 0, minWidth: 20 }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pe.exercise?.name ?? '—'}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 2 }}>
            {pe.exercise?.muscleGroup?.toUpperCase() ?? ''}
          </div>
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
            {showMoveControls && (
              <>
                <IconBtn onClick={onMoveUp} disabled={!canMoveUp}><ChevronUp size={13} /></IconBtn>
                <IconBtn onClick={onMoveDown} disabled={!canMoveDown}><ChevronDown size={13} /></IconBtn>
              </>
            )}
            <IconBtn onClick={onDelete}><Trash2 size={12} /></IconBtn>
          </div>
        )}
      </div>

      {/* Weight unit (existing field, v3 §2.4 / TASKS.md §4 item 28) — kept
          as-is, minus the suggested-reps stepper that used to sit beside it
          (SPEC.md "Removals"). */}
      <div style={{ padding: '0 12px 10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flexShrink: 0, paddingTop: 8 }}>
          UNIT
        </span>
        <UnitChips
          value={pe.weightUnit}
          globalUnit={globalWeightUnit}
          disabled={readOnly}
          onChange={onWeightUnit}
          style={{ paddingTop: 8 }}
        />
      </div>

      {/* Rest / rest after / tempo (chunk 16 — SPEC.md "Rest"; chunk 17 —
          SPEC.md "Tempo") — design fields, never gated by readOnly (this
          row's readOnly is volumeReadOnly — see this file's own header
          comment). null = "no override": REST falls through to the global
          Settings value, REST AFTER simply never applies (the exercise's
          own last set then also falls through to REST, then global); no
          tempo means none is shown during the workout. */}
      <div style={{ padding: '0 12px 10px', borderTop: '1px solid var(--border-subtle)', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, paddingTop: 8 }}>
        <RestStepper
          label="REST"
          value={pe.restSeconds ?? null}
          disabled={false}
          onChange={(v) => onRest({ restSeconds: v })}
          defaultText="GLOBAL"
        />
        <RestStepper
          label="REST AFTER"
          value={pe.restAfterSeconds ?? null}
          disabled={false}
          onChange={(v) => onRest({ restAfterSeconds: v })}
          defaultText="NONE"
        />
        <TempoEditor
          value={pe.tempo ?? null}
          disabled={false}
          onChange={onTempo}
        />
      </div>
    </div>
  )
}

// ─── Sequence editor (chunk 25 — SPEC.md "Scheduling → Sequence" /
// TASKS.md "Planner step 2 gains the schedule type and a sequence editor
// (workout and rest-day slots, up/down; a workout may appear more than
// once)") ─────────────────────────────────────────────────────────────────
// One per PROGRAM (not per workout — StepExercises' own top level renders
// this once, beside the schedule-type toggle), mirroring
// WarmupRoutineEditor's shape (add/reorder/remove, up/down arrows, a
// confirm sheet before removing) with one structural difference: a slot's
// own "body" is which workout occupies it (or REST), picked from a small
// sheet rather than typed — SequenceItemPicker, below, reused for both
// "add a new slot" and "change an existing slot's workout".
function SequenceEditor({ programId, workoutDays }: { programId: string; workoutDays: WorkoutDay[] }) {
  const { data: items = [], isLoading } = useSequenceItems(programId)
  const addItem = useAddSequenceItem(programId)
  const updateItem = useUpdateSequenceItemWorkout(programId)
  const removeItem = useRemoveSequenceItem(programId)
  const reorderItems = useReorderSequenceItems(programId)

  const [confirmRemove, setConfirmRemove] = useState<{ id: string; label: string } | null>(null)
  // Which existing slot's workout is being re-picked — null while adding a
  // brand-new slot instead (showAddPicker), never both at once.
  const [pickerForId, setPickerForId] = useState<string | null>(null)
  const [showAddPicker, setShowAddPicker] = useState(false)

  // Same "write the optimistic order into this query's cache, then fire the
  // mutation" shape WorkoutEditor's own moveExercise / WarmupRoutineEditor's
  // own moveItem both take.
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

  return (
    <div role="region" aria-label="Sequence editor" style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginBottom: 8 }}>
        SEQUENCE
      </p>

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <div className="animate-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
        </div>
      )}

      {!isLoading && items.length === 0 && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)', marginBottom: 8 }}>
          NO SLOTS YET
        </p>
      )}

      {!isLoading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {items.map((item, index) => (
            <SequenceItemRow
              key={item.id}
              index={index}
              label={workoutName(item.workoutDayId)}
              isRest={item.workoutDayId === null}
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

      <button
        onClick={() => setShowAddPicker(true)}
        style={{ width: '100%', height: 36, background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 11 }}
      >
        <Plus size={12} style={{ color: 'var(--accent)' }} />
        ADD SLOT
      </button>

      {(pickerForId !== null || showAddPicker) && (
        <Sheet onClose={() => { setPickerForId(null); setShowAddPicker(false) }}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, letterSpacing: '1px', marginBottom: 16, color: 'var(--text-primary)' }}>
            {pickerForId ? 'CHANGE SLOT' : 'ADD SLOT'}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button
              onClick={() => handlePick(null)}
              style={{ height: 48, background: 'var(--surface)', border: '1px dashed var(--border-strong)', borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', textAlign: 'left', padding: '0 14px' }}
            >
              REST DAY
            </button>
            {workoutDays.map((d) => (
              <button
                key={d.id}
                onClick={() => handlePick(d.id)}
                style={{ height: 48, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-primary)', cursor: 'pointer', fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, textAlign: 'left', padding: '0 14px' }}
              >
                {d.name}
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {confirmRemove && (
        <Sheet onClose={() => setConfirmRemove(null)}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
            Remove this slot?
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            "{confirmRemove.label}" — this cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setConfirmRemove(null)}
              style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', color: 'var(--text-secondary)' }}
            >
              CANCEL
            </button>
            <button
              onClick={() => { removeItem.mutate(confirmRemove.id); setConfirmRemove(null) }}
              disabled={removeItem.isPending}
              style={{ flex: 1, height: 50, background: 'rgba(248, 113, 113, 0.15)', border: 'none', borderRadius: 10, cursor: removeItem.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: 'var(--error)' }}
            >
              {removeItem.isPending ? '…' : 'REMOVE'}
            </button>
          </div>
        </Sheet>
      )}
    </div>
  )
}

// One slot row — tap the label to open the workout/REST picker (never
// inline-edited, unlike a warmup item's free text), plus the same
// up/down/delete IconBtn cluster WarmupItemRow's own structure row uses.
function SequenceItemRow({
  index,
  label,
  isRest,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onChangeWorkout,
  onDelete,
}: {
  index: number
  label: string
  isRest: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onChangeWorkout: () => void
  onDelete: () => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 11, color: 'var(--text-dim)', flexShrink: 0, minWidth: 16 }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <button
        onClick={onChangeWorkout}
        style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: '6px 0', fontSize: 13, fontWeight: isRest ? 500 : 700, fontStyle: isRest ? 'italic' : 'normal', color: isRest ? 'var(--text-dim)' : 'var(--text-primary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {label}
      </button>
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <IconBtn onClick={onMoveUp} disabled={!canMoveUp}><ChevronUp size={13} /></IconBtn>
        <IconBtn onClick={onMoveDown} disabled={!canMoveDown}><ChevronDown size={13} /></IconBtn>
        <IconBtn onClick={onDelete}><Trash2 size={12} /></IconBtn>
      </div>
    </div>
  )
}
