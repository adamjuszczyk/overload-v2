import { useState, useRef, useEffect, Fragment } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown, X, Link2 } from 'lucide-react'
import type { Program, WorkoutDay, ProgramExercise, DayOfWeek, WeightUnit } from '../../types'
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
  useToggleSupersetLink,
} from '../programs/usePrograms'
import { useAssignWorkoutWeekday } from './usePlanner'
import { useSettingsStore } from '../settings/settingsStore'
import ExercisePicker from '../programs/ExercisePicker'
import { groupIntoUnits, moveUnit, isLinkedGap, planLinkToggle } from '../../lib/supersetGroups.js'

// Step 2 — Exercises and order (SPEC.md "Stepped program planner" step 2;
// TASKS.md "step 2 adds workouts, exercises (existing picker), order
// (up/down) and one weekday per workout"). Reused as-is (same component) by
// a stable run's Program tab (ProgramTab.tsx, TASKS.md "the program tab
// edits the run's copy... with the same step 2/step 3 components").
//
// Not in this step, on purpose (their own later chunks, TASKS.md): design
// fields (rest/rest-after/tempo), the warmup routine checklist. Schedule
// type stays weekday-only until chunk 25.
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
  volumeReadOnly,
}: {
  programId: string
  workoutDay: WorkoutDay
  schedule: Program['schedule']
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
  const assignWeekday = useAssignWorkoutWeekday(programId)
  const toggleLink = useToggleSupersetLink(workoutDay.id)
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
          once (TASKS.md "one weekday per workout"). */}
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
          const unitIndex = unitIndexByExerciseId.get(ex.id) ?? index
          const isFirstInUnit = units[unitIndex]?.[0]?.id === ex.id
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
              />
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
              onClick={() => { deleteExercise.mutate(confirmDeleteExercise.id); setConfirmDeleteExercise(null) }}
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
