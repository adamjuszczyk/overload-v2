import { useState, useRef, useEffect, Fragment } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown, X, Link2 } from 'lucide-react'
import type { Program, WorkoutDay, ProgramExercise, DayOfWeek, ScheduleType, WeightUnit, WarmupRoutineItem } from '../../types'
import { slotIdOf, type ChangeRecord } from '../plan/applyAhead'
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
  useWarmupRoutineItems,
  useAddWarmupItem,
  useUpdateWarmupItemBody,
  useRemoveWarmupItem,
  useReorderWarmupItems,
  useUpdateScheduleType,
  useSequenceItems,
  useAddSequenceItem,
  useUpdateSequenceItemWorkout,
  useRemoveSequenceItem,
  useReorderSequenceItems,
} from '../programs/usePrograms'
import { moveWarmupItem } from '../programs/warmupRoutineService'
import { moveSequenceItem } from '../programs/sequenceItemsService'
import { useAssignWorkoutWeekday } from './usePlanner'
import { useSettingsStore } from '../settings/settingsStore'
import ExercisePicker from '../programs/ExercisePicker'
import { groupIntoUnits, moveUnit, isLinkedGap, planLinkToggle } from '../../lib/supersetGroups.js'
import { formatRestTime } from '../../lib/formatRestTime'
import { normaliseTempo } from '../../lib/plannerVocabulary.js'

// Step 2 — Exercises and order (SPEC.md "Stepped program planner" step 2;
// TASKS.md "step 2 adds workouts, exercises (existing picker), order
// (up/down) and one weekday per workout"). Reused as-is (same component) by
// a stable run's Program tab (ProgramTab.tsx, TASKS.md "the program tab
// edits the run's copy... with the same step 2/step 3 components").
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
// below: never gated by volumeReadOnly, editable for both planning types,
// in both the planner and the program tab (this same reused component).
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
  onVolumeChange,
}: {
  program: Program
  volumeReadOnly: boolean
  // Chunk 20 ("Apply this change to planned weeks ahead") — only ever
  // passed by ProgramTab.tsx (a stable run's own program tab); the planner
  // (PlannerPage.tsx, saved programs and week-dependent runs) never passes
  // this, so it stays undefined there and nothing below ever calls it —
  // zero behaviour change for every existing caller. Reported per workout
  // day (never per saved-program edit — ProgramTab is the only caller that
  // can ever reach a 'stable' planningType, so this is a no-op anywhere
  // else even if it were wired).
  onVolumeChange?: (workoutDayId: string, changes: ChangeRecord[]) => void
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
            style={{ flex: 1, padding: '9px 0', background: scheduleType === st ? 'var(--accent)' : 'var(--surface)', border: 'none', cursor: updateScheduleType.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: scheduleType === st ? 'var(--base)' : 'var(--text-muted)' }}
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
          onVolumeChange={onVolumeChange}
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
              style={{ width: '100%', height: 56, background: createDay.isPending ? 'var(--border-strong)' : 'var(--accent)', border: 'none', borderRadius: 11, cursor: createDay.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 15, letterSpacing: '2px', color: createDay.isPending ? 'var(--text-muted)' : 'var(--base)' }}
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
  onVolumeChange,
}: {
  programId: string
  workoutDay: WorkoutDay
  schedule: Program['schedule']
  // Chunk 25 — optional, defaults to 'weekday' (ProgramTab.tsx's own
  // existing caller doesn't pass it yet — see this chunk's report): gates
  // the weekday chip row below, same "may not exist yet" fallback
  // convention every other optional prop on this screen already takes.
  scheduleType?: ScheduleType
  volumeReadOnly: boolean
  onVolumeChange?: (workoutDayId: string, changes: ChangeRecord[]) => void
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
    // Review fix item 3 — the stable program-tab's own exercise reorder;
    // SPEC names no exception for it. Same ReorderMove shape PlanPage.tsx's
    // own week-level reorder already builds — only exercises that actually
    // moved, each with its true pre-move position.
    const newPositionById = new Map(next.map((ex, i) => [ex.id, i]))
    const moves = exercises
      .map((ex) => ({ slotId: slotIdOf(ex), oldPosition: ex.position, newPosition: newPositionById.get(ex.id)! }))
      .filter((m) => m.oldPosition !== m.newPosition)
    if (moves.length > 0) {
      onVolumeChange?.(workoutDay.id, [{ editType: 'reorderExercise', moves }])
    }
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
          workout. Every existing caller that doesn't pass scheduleType
          (ProgramTab.tsx) still sees this row exactly as before. */}
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
          // Chunk 20 — "Adding or removing an exercise in a week is allowed
          // for both planning types" (SPEC); for stable, apply-ahead covers
          // a PROGRAM-tab add the same way, since a stable week is always
          // built fresh from the program and already-planned weeks
          // wouldn't otherwise see it (SPEC "Programs and runs").
          onAdded={(exerciseId) => onVolumeChange?.(workoutDay.id, [{ editType: 'addExercise', workoutDayId: workoutDay.id, exerciseId }])}
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
                const target = exercises.find((e) => e.id === confirmDeleteExercise.id)
                deleteExercise.mutate(confirmDeleteExercise.id)
                // Chunk 20 — same "both planning types, program-tab covers
                // it for stable" reasoning as ADD above.
                if (target) {
                  onVolumeChange?.(workoutDay.id, [{ editType: 'removeExercise', slotId: slotIdOf(target), exerciseId: target.exerciseId }])
                }
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
        <div style={{ display: 'flex', gap: 4, paddingTop: 8 }}>
          {(
            [
              { value: null, label: `INHERIT (${globalWeightUnit.toUpperCase()})` },
              { value: 'kg' as const, label: 'KG' },
              { value: 'lbs' as const, label: 'LBS' },
            ]
          ).map((opt) => {
            const active = pe.weightUnit === opt.value
            return (
              <button
                key={opt.label}
                onClick={() => onWeightUnit(opt.value)}
                disabled={readOnly}
                style={{
                  height: 24,
                  padding: '0 8px',
                  flexShrink: 0,
                  background: active ? 'var(--accent-muted)' : 'var(--surface)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
                  borderRadius: 6,
                  cursor: readOnly ? 'default' : 'pointer',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: '1px',
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
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

// ─── Rest stepper (chunk 16) — same +/- stepper shape as PlanPage.tsx's own
// RirStepper (this build's existing rest/RIR pattern), seconds instead of
// RIR: 15s per tap, tapping "−" at the floor clears back to null ("no
// override" — the caller's own defaultText says what that falls through
// to), tapping "+" from null starts at 15s. Capped at 600s (10 min) — generous
// enough for any real rest, so the stepper target that caps RirStepper's own
// range stays meaningful here rather than open-ended.
const REST_STEP_SECONDS = 15
const REST_MAX_SECONDS = 600

function RestStepper({
  label,
  value,
  disabled,
  onChange,
  defaultText,
}: {
  label: string
  value: number | null
  disabled: boolean
  onChange: (v: number | null) => void
  defaultText: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ display: 'inline-flex', alignItems: 'center', height: 26, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 6, flexShrink: 0 }}>
        <button
          disabled={disabled || value === null}
          onClick={() => {
            if (value === null) return
            onChange(value - REST_STEP_SECONDS <= 0 ? null : value - REST_STEP_SECONDS)
          }}
          style={{ width: 22, height: 26, background: 'transparent', border: 'none', color: (disabled || value === null) ? 'var(--text-dim)' : 'var(--text-muted)', cursor: (disabled || value === null) ? 'default' : 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          −
        </button>
        <span style={{ minWidth: 48, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11, color: value === null ? 'var(--text-dim)' : 'var(--text-primary)' }}>
          {value === null ? defaultText : formatRestTime(value)}
        </span>
        <button
          disabled={disabled}
          onClick={() => onChange(Math.min((value ?? 0) + REST_STEP_SECONDS, REST_MAX_SECONDS))}
          style={{ width: 22, height: 26, background: 'transparent', border: 'none', color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ─── Tempo (chunk 17 — SPEC.md "Tempo") ─────────────────────────────────────
// Same tap-to-edit text-input pattern StepVolume.tsx's SetTargetRow/
// ExerciseTargetRow already use for their own parsed free-text design field
// (rep target), inside the same labelled-box shape RestStepper uses just
// above (so the three sit as one row of controls) — reviewer's note: "the
// same row and the same existing input/stepper pattern." Validated by
// plannerVocabulary.ts's normaliseTempo (chunk 2) — the one parser for this
// format anywhere in the app; an invalid entry shows an inline error (same
// "input border turns --error, a message appears below" pattern
// ExerciseForm.tsx's own name field already uses — the one existing inline-
// validation precedent in this codebase) and writes nothing, never closing
// the editor so the message stays visible until fixed. Clearing the field
// (blank, trimmed) writes null, same "no override" meaning REST/REST AFTER
// give an empty stepper.
function TempoEditor({
  value,
  disabled,
  onChange,
}: {
  value: string | null
  disabled: boolean
  onChange: (tempo: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    if (disabled) return
    setText(value ?? '')
    setError('')
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    if (trimmed === '') {
      setEditing(false)
      setError('')
      if (value !== null) onChange(null)
      return
    }
    const normalised = normaliseTempo(trimmed)
    if (normalised === null) {
      // Refused — stays in edit mode with the raw input still showing, the
      // message right below it; nothing is written (reviewer's note).
      setError('Use 4 fields, e.g. 3-1-1-0 (X allowed)')
      return
    }
    setEditing(false)
    setError('')
    if (normalised !== value) onChange(normalised)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flexShrink: 0 }}>
        TEMPO
      </span>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError('') }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
            placeholder="3-1-1-0"
            aria-label="Tempo"
            style={{ width: 96, height: 26, background: 'var(--surface)', border: `1px solid ${error ? 'var(--error)' : 'var(--accent)'}`, borderRadius: 6, padding: '0 8px', fontSize: 11, fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--text-primary)', boxSizing: 'border-box', outline: 'none' }}
          />
          {error && (
            <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--error)', letterSpacing: '0.5px' }}>
              {error}
            </span>
          )}
        </div>
      ) : (
        <button
          onClick={startEditing}
          disabled={disabled}
          style={{ height: 26, padding: '0 8px', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11, color: value === null ? 'var(--text-dim)' : 'var(--text-primary)' }}
        >
          {/* '—' (not "NONE" — RestStepper's own REST AFTER already uses
              that exact text for a different, rest-specific meaning right
              in this same row; reusing it here would make the two
              ambiguous to anything querying by text, this file's own tests
              included) — same "nothing set" placeholder ExerciseRow's own
              exercise name fallback and StepVolume.tsx's SetTargetRow both
              already use. */}
          {value ?? '—'}
        </button>
      )}
    </div>
  )
}

// ─── Superset block rest (chunk 16 — SPEC.md "Rest"/"Supersets") ──────────
// Once per linked unit, right after its last member — "within round"/"after
// round", both overridable, both null by SPEC default (no timer within a
// round; the chain of the exercise that ends a round).
function BlockRestEditor({
  blockId,
  rest,
  onChange,
}: {
  blockId: string
  rest: { restWithinRoundSeconds: number | null; restAfterRoundSeconds: number | null } | null
  onChange: (changes: { restWithinRoundSeconds?: number | null; restAfterRoundSeconds?: number | null }) => void
}) {
  return (
    <div
      key={`block-rest-${blockId}`}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '2px 4px 6px' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)', flexShrink: 0 }}>
        SUPERSET
      </span>
      <RestStepper
        label="WITHIN ROUND"
        value={rest?.restWithinRoundSeconds ?? null}
        disabled={false}
        onChange={(v) => onChange({ restWithinRoundSeconds: v })}
        defaultText="NO TIMER"
      />
      <RestStepper
        label="AFTER ROUND"
        value={rest?.restAfterRoundSeconds ?? null}
        disabled={false}
        onChange={(v) => onChange({ restAfterRoundSeconds: v })}
        defaultText="PER EXERCISE"
      />
    </div>
  )
}

// ─── Warmup routine checklist (chunk 18 — SPEC.md "Warmup routine") ───────
// One per workout, below its exercise list (this file's own header comment
// has the full reasoning). Never gated by volumeReadOnly — no readOnly prop
// at all, same posture RestStepper/TempoEditor already take above.
function WarmupRoutineEditor({ workoutDayId }: { workoutDayId: string }) {
  const { data: items = [], isLoading } = useWarmupRoutineItems(workoutDayId)
  const addItem = useAddWarmupItem(workoutDayId)
  const updateItem = useUpdateWarmupItemBody(workoutDayId)
  const removeItem = useRemoveWarmupItem(workoutDayId)
  const reorderItems = useReorderWarmupItems(workoutDayId)

  const [showAdd, setShowAdd] = useState(false)
  const [newText, setNewText] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; body: string } | null>(null)

  // Same "write the optimistic order into this query's cache, then fire the
  // mutation" shape WorkoutEditor's own moveExercise takes for
  // reorderProgramExercises above — moveWarmupItem mirrors moveUnit's own
  // "same reference back = no-op" convention, so a boundary tap is a no-op.
  function moveItem(index: number, direction: 'up' | 'down') {
    const next = moveWarmupItem(items, index, direction)
    if (next === items) return
    const reindexed = next.map((item, i) => ({ ...item, position: i }))
    queryClient.setQueryData(['v2_workoutWarmupItems', workoutDayId], reindexed)
    reorderItems.mutate(reindexed.map((item, i) => ({ id: item.id, position: i })))
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newText.trim()
    if (!trimmed) return // refused — nothing is written (reviewer's note)
    await addItem.mutateAsync({ body: trimmed, position: items.length })
    setNewText('')
    setShowAdd(false)
  }

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div style={{ height: 1, background: 'var(--border-subtle)', marginBottom: 12 }} />
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginBottom: 8 }}>
        WARMUP ROUTINE
      </p>

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <div className="animate-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
        </div>
      )}

      {!isLoading && items.length === 0 && !showAdd && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)', marginBottom: 8 }}>
          NO WARMUP ITEMS YET
        </p>
      )}

      {!isLoading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          {items.map((item, index) => (
            <WarmupItemRow
              key={item.id}
              item={item}
              index={index}
              canMoveUp={index > 0}
              canMoveDown={index < items.length - 1}
              onMoveUp={() => moveItem(index, 'up')}
              onMoveDown={() => moveItem(index, 'down')}
              onSave={(body) => updateItem.mutate({ id: item.id, body })}
              onDelete={() => setConfirmRemove({ id: item.id, body: item.body })}
            />
          ))}
        </div>
      )}

      {showAdd ? (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onBlur={() => { if (!newText.trim()) setShowAdd(false) }}
            placeholder="e.g. 5 min easy bike"
            autoFocus
            aria-label="New warmup item"
            style={{ flex: 1, height: 36, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box' }}
          />
          <button
            type="submit"
            disabled={addItem.isPending}
            style={{ height: 36, padding: '0 14px', flexShrink: 0, background: 'var(--accent)', border: 'none', borderRadius: 8, cursor: addItem.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 10, letterSpacing: '1px', color: 'var(--base)' }}
          >
            ADD
          </button>
        </form>
      ) : (
        <button
          onClick={() => { setNewText(''); setShowAdd(true) }}
          style={{ width: '100%', height: 36, background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 11 }}
        >
          <Plus size={12} style={{ color: 'var(--accent)' }} />
          ADD ITEM
        </button>
      )}

      {confirmRemove && (
        <Sheet onClose={() => setConfirmRemove(null)}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
            Remove this item?
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            "{confirmRemove.body}" — this cannot be undone.
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

// One item row — tap-to-edit text (same pattern TempoEditor above uses),
// plus the same up/down/delete IconBtn cluster ExerciseRow's own structure
// row uses. A blank commit is refused — the editor just closes, re-showing
// item.body (the last saved value), same "trimmed falsy => no write, no
// forced revert needed since nothing local held the stale text" posture
// WorkoutEditor's own saveName already takes for a workout's own name.
function WarmupItemRow({
  item,
  index,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onSave,
  onDelete,
}: {
  item: WarmupRoutineItem
  index: number
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onSave: (body: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    setText(item.body)
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    setEditing(false)
    if (trimmed && trimmed !== item.body) onSave(trimmed)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 11, color: 'var(--text-dim)', flexShrink: 0, minWidth: 16 }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
          aria-label="Warmup item text"
          style={{ flex: 1, height: 32, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 7, padding: '0 8px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box' }}
        />
      ) : (
        <button
          onClick={startEditing}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: '6px 0', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {item.body}
        </button>
      )}
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <IconBtn onClick={onMoveUp} disabled={!canMoveUp}><ChevronUp size={13} /></IconBtn>
        <IconBtn onClick={onMoveDown} disabled={!canMoveDown}><ChevronDown size={13} /></IconBtn>
        <IconBtn onClick={onDelete}><Trash2 size={12} /></IconBtn>
      </div>
    </div>
  )
}

function IconBtn({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', borderRadius: 6, flexShrink: 0 }}
    >
      {children}
    </button>
  )
}

// ─── Superset grouping editor — one toggle per gap between adjacent rows
// (chunk 13, SPEC.md "Supersets") ───────────────────────────────────────────
// Deliberately between every pair of rows, not just at a unit's own edges:
// "any number of exercises" (SPEC) falls out of being able to link/unlink
// at any point, including splitting an existing 3+ member block part way
// through (supersetGroups.ts's planLinkToggle).
function SupersetLinkToggle({
  linked,
  disabled,
  onToggle,
}: {
  linked: boolean
  disabled: boolean
  onToggle: () => void
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      style={{
        width: '100%',
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        background: linked ? 'var(--accent-muted)' : 'transparent',
        border: linked ? '1px solid var(--accent)' : '1px dashed var(--border-strong)',
        borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '1.5px',
        color: linked ? 'var(--accent)' : 'var(--text-muted)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Link2 size={11} />
      {linked ? 'SUPERSET — TAP TO UNLINK' : 'LINK AS SUPERSET'}
    </button>
  )
}

// ─── Small local bottom sheet — same shape every programs/plan page already
// repeats its own copy of (ProgramPage.tsx's own BottomSheet is the closest
// precedent); not shared, following this codebase's existing convention of
// each file carrying its own small presentational helpers.
function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', border: '1px solid var(--border)', borderBottom: 'none', maxHeight: '85dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <X size={13} />
          </button>
        </div>
        {children}
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
