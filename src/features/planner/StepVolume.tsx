import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { Program, ProgramExercise, ProgramSet, PlanningType } from '../../types'
import type { RepTarget } from '../../lib/plannerVocabulary.js'
import { useWorkoutDays, useProgramExercises, useUpdatePlanningType } from '../programs/usePrograms'
import {
  useProgramSets,
  useSetExerciseSetCount,
  useUpdateSetRepTarget,
  useSetRepTargetForAllSets,
  useUpdateProgramSetStageKind,
  useAddProgramSetStage,
  useRemoveProgramSetStage,
  headSets,
  summarizeRepTargets,
} from './usePlanner'
import { formatRepTarget, parseRepTarget, columnsToRepTarget, STAGE_KINDS, STAGE_KIND_LABELS, resolveStageKind } from '../../lib/plannerVocabulary.js'
import { groupByParent, nextStageIndex, type SetGroup as Group } from '../gym/setGroupLogic'
import RatingChips from '../gym/RatingChips.js'

// Step 3 — Volume (SPEC.md "Stepped program planner" step 3; TASKS.md "step
// 3 picks stable / week-dependent and plans sets"). Reused as-is by a
// stable run's Program tab (ProgramTab.tsx), where `canChangePlanningType`
// is false (planning type is decided once, at save time — SPEC doesn't
// offer changing it mid-run) and `volumeReadOnly` follows chunk 9's own
// rule (true for a week-dependent run).
//
// "The only required value is the number of sets per exercise. Rep
// targets... are optional" (SPEC) — Save/Start are never blocked by a
// missing count (DECISIONS 52, provisional (a)); this step only ever shows
// a flag, never a guard.
export default function StepVolume({
  program,
  volumeReadOnly,
  canChangePlanningType,
}: {
  program: Program
  volumeReadOnly: boolean
  canChangePlanningType: boolean
}) {
  const { data: workoutDays = [], isLoading } = useWorkoutDays(program.id)
  const updatePlanningType = useUpdatePlanningType()
  const planningType = program.planningType ?? 'week_dependent'

  function setPlanningType(next: PlanningType) {
    if (!canChangePlanningType || next === planningType) return
    updatePlanningType.mutate({ id: program.id, planningType: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 8 }}>
          PLANNING
        </p>
        <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {(
            [
              { value: 'stable' as const, label: 'STABLE', note: 'Same sets every week' },
              { value: 'week_dependent' as const, label: 'WEEK-DEPENDENT', note: 'Plans week 1 here; weeks copy forward' },
            ]
          ).map((opt) => {
            const active = planningType === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setPlanningType(opt.value)}
                disabled={!canChangePlanningType || updatePlanningType.isPending}
                style={{ flex: 1, padding: '10px 6px', background: active ? 'var(--accent)' : 'var(--surface)', border: 'none', cursor: canChangePlanningType ? 'pointer' : 'default', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', color: active ? 'var(--base)' : 'var(--text-muted)' }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>
          {planningType === 'stable'
            ? 'The sets planned here are the volume for every week.'
            : 'Only week 1 is planned here; later weeks copy forward.'}
        </p>
      </div>

      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 16 }}>
          <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
        </div>
      )}

      {!isLoading && workoutDays.length === 0 && (
        <p style={{ textAlign: 'center', padding: '24px 0', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
          NO WORKOUTS YET
        </p>
      )}

      {!isLoading && workoutDays.map((day) => (
        <WorkoutVolumeEditor key={day.id} workoutDayId={day.id} workoutName={day.name} volumeReadOnly={volumeReadOnly} />
      ))}
    </div>
  )
}

// ─── One workout's exercises, each with its own set count + per-set targets

function WorkoutVolumeEditor({
  workoutDayId,
  workoutName,
  volumeReadOnly,
}: {
  workoutDayId: string
  workoutName: string
  volumeReadOnly: boolean
}) {
  const { data: exercises = [], isLoading: exercisesLoading } = useProgramExercises(workoutDayId)
  const exerciseIds = exercises.map((e) => e.id)
  const { data: sets = [], isLoading: setsLoading } = useProgramSets(exerciseIds)

  if (exercisesLoading || (setsLoading && exerciseIds.length > 0)) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 16 }}>
        <div className="animate-spin" style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

  if (exercises.length === 0) return null

  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}>
        {workoutName.toUpperCase()}
      </p>
      {exercises.map((ex) => (
        <ExerciseSetsEditor
          key={ex.id}
          exercise={ex}
          sets={sets.filter((s) => s.programExerciseId === ex.id)}
          volumeReadOnly={volumeReadOnly}
        />
      ))}
    </div>
  )
}

// ─── One exercise: SETS stepper (the required value) + per-set targets ────

function ExerciseSetsEditor({
  exercise,
  sets,
  volumeReadOnly,
}: {
  exercise: ProgramExercise
  sets: ProgramSet[]
  volumeReadOnly: boolean
}) {
  const heads = headSets(sets).sort((a, b) => a.position - b.position)
  const setCount = useSetExerciseSetCount()

  function changeCount(delta: number) {
    if (volumeReadOnly) return
    const next = Math.max(0, heads.length + delta)
    if (next === heads.length) return
    setCount.mutate({ programExerciseId: exercise.id, currentHeads: heads, count: next })
  }

  return (
    <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: heads.length > 0 ? 8 : 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {exercise.exercise?.name ?? '—'}
          </div>
          {heads.length === 0 && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--error)' }}>
              NO SETS YET
            </span>
          )}
        </div>

        {/* SETS stepper — the one required value (SPEC), never a blocking
            gate (DECISIONS 52, provisional (a)). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
            SETS
          </span>
          <div style={{ display: 'flex', alignItems: 'center', height: 30, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8 }}>
            <button
              onClick={() => changeCount(-1)}
              disabled={volumeReadOnly || heads.length === 0 || setCount.isPending}
              aria-label={`Fewer sets for ${exercise.exercise?.name ?? 'this exercise'}`}
              style={{ width: 26, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: volumeReadOnly ? 'default' : 'pointer', fontSize: 15, lineHeight: 1 }}
            >
              −
            </button>
            <span style={{ width: 28, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>
              {heads.length}
            </span>
            <button
              onClick={() => changeCount(1)}
              disabled={volumeReadOnly || setCount.isPending}
              aria-label={`More sets for ${exercise.exercise?.name ?? 'this exercise'}`}
              style={{ width: 26, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: volumeReadOnly ? 'default' : 'pointer', fontSize: 15, lineHeight: 1 }}
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* "Fill all sets of an exercise at once" (SPEC.md step 3's own
          plain-case shortcut) — one tap sets every current head's target in
          one write (useSetRepTargetForAllSets); per-set rows right below
          still adjust one set at a time. */}
      {heads.length > 0 && (
        <ExerciseTargetRow heads={heads} readOnly={volumeReadOnly} exerciseName={exercise.exercise?.name ?? 'this exercise'} />
      )}

      {/* Per-set rep targets — filled by the row above, then adjustable
          individually. One group per head (chunk 14 — SPEC "Staged
          sets"): its own stage rows nested beneath it, exactly the same
          head+stages shape the week plan's own PlanSetGroup renders. */}
      {heads.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {groupByParent(sets, (s) => s.id, (s) => s.parentProgramSetId, (s) => s.stageIndex)
            .sort((a, b) => a.head.position - b.head.position)
            .map((group, i) => (
              <ProgramSetGroupEditor
                key={group.head.id}
                displayNumber={i + 1}
                exercise={exercise}
                group={group}
                readOnly={volumeReadOnly}
              />
            ))}
        </div>
      )}
    </div>
  )
}

// ─── "Fill all sets at once" (review fix) ──────────────────────────────────
// Same tap-to-edit text field as SetTargetRow (number / range / AMRAP,
// parsed the same way), but committing writes every CURRENT head's target
// in one call instead of one set's. Shows the shared target when every head
// agrees, "MIXED" (a neutral, existing-tokens label — same muted/dim
// styling StepExercises.tsx's own "NO EXERCISES YET" uses) when they don't,
// or "—" when every head has no target at all.
function ExerciseTargetRow({
  heads,
  readOnly,
  exerciseName,
}: {
  heads: ProgramSet[]
  readOnly: boolean
  exerciseName: string
}) {
  const setAll = useSetRepTargetForAllSets()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const summary = summarizeRepTargets(heads) // heads.length > 0 here, so never null
  const displayText = summary === 'mixed' ? 'MIXED' : summary && summary.type !== 'none' ? formatRepTarget(summary) : '—'

  function startEditing() {
    if (readOnly) return
    setValue(summary && summary !== 'mixed' && summary.type !== 'none' ? formatRepTarget(summary) : '')
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const trimmed = value.trim()
    const target: RepTarget | null = trimmed === '' ? { type: 'none' } : parseRepTarget(trimmed)
    if (target === null) return
    // No-op guard: every head already shows exactly this target.
    if (summary !== 'mixed' && summary && formatRepTarget(target) === formatRepTarget(summary)) return
    setAll.mutate({ headIds: heads.map((h) => h.id), target })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0 8px' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flexShrink: 0 }}>
        ALL SETS
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
          placeholder="8, 8-12, or AMRAP"
          style={{ flex: 1, height: 30, background: 'var(--surface-overlay)', border: '1px solid var(--accent)', borderRadius: 7, padding: '0 10px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', boxSizing: 'border-box', outline: 'none' }}
        />
      ) : (
        <button
          onClick={startEditing}
          disabled={readOnly}
          aria-label={`Set every set's rep target for ${exerciseName}`}
          style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', padding: '4px 0', cursor: readOnly ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: summary === 'mixed' || !summary || summary.type === 'none' ? 'var(--text-dim)' : 'var(--text-primary)' }}
        >
          {displayText}
        </button>
      )}
    </div>
  )
}

function SetTargetRow({
  displayNumber,
  set,
  readOnly,
  isStage = false,
  stageKindLabel,
  onRemove,
}: {
  displayNumber: number
  set: ProgramSet
  readOnly: boolean
  // Chunk 14 — a stage shares its head's displayNumber by convention (↳,
  // no number of its own), same as the week plan's own SetRow/the workout
  // screen's SetRow.
  isStage?: boolean
  stageKindLabel?: string
  // Stage rows only — the SETS stepper owns removing a whole head.
  onRemove?: () => void
}) {
  const updateTarget = useUpdateSetRepTarget()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  const current = columnsToRepTarget({ repMin: set.repMin, repMax: set.repMax, isAmrap: set.isAmrap })
  const displayText = current.type === 'none' ? '—' : formatRepTarget(current)

  function startEditing() {
    if (readOnly) return
    setValue(current.type === 'none' ? '' : formatRepTarget(current))
    setEditing(true)
  }

  function commit() {
    setEditing(false)
    const trimmed = value.trim()
    // Blank clears the target (parseRepTarget's own 'none' keyword does the
    // same; blank is just the easier way to type it). Anything else that
    // doesn't parse is left as it was — no error UI exists yet for this
    // step, so an unparseable entry is simply not saved, rather than
    // silently guessed at.
    const target = trimmed === '' ? { type: 'none' as const } : parseRepTarget(trimmed)
    if (target === null) return
    if (formatRepTarget(target) === formatRepTarget(current)) return
    updateTarget.mutate({ id: set.id, target })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
      <span style={{ width: 20, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 11, color: 'var(--text-dim)', flexShrink: 0 }}>
        {isStage ? '↳' : String(displayNumber).padStart(2, '0')}
      </span>
      {isStage && stageKindLabel && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', flexShrink: 0 }}>
          {stageKindLabel}
        </span>
      )}
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
          placeholder="8, 8-12, or AMRAP"
          style={{ flex: 1, height: 30, background: 'var(--surface-overlay)', border: '1px solid var(--accent)', borderRadius: 7, padding: '0 10px', fontSize: 13, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', boxSizing: 'border-box', outline: 'none' }}
        />
      ) : (
        <button
          onClick={startEditing}
          disabled={readOnly}
          style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', padding: '4px 0', cursor: readOnly ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: current.type === 'none' ? 'var(--text-dim)' : 'var(--text-primary)' }}
        >
          {displayText}
        </button>
      )}
      {isStage && !readOnly && onRemove && (
        <button
          onClick={onRemove}
          aria-label="Remove stage"
          style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
        >
          <Trash2 size={11} />
        </button>
      )}
    </div>
  )
}

// ─── One head + its stages (chunk 14 — SPEC.md "Staged sets") ─────────────
// Mirrors PlanPage.tsx's own PlanSetGroup (the week plan's equivalent
// authoring UI) one layer up: the head's existing SetTargetRow, its stage
// rows nested beneath it (labelled by kind), ADD STAGE, and — once there's
// at least one real stage — the same STAGE KIND chip row (RatingChips).
// Program sets carry no weight (SPEC "Targets": week-plan-only), so unlike
// the workout screen there is no carry-over concern here at all — only the
// kind, and each stage's own independent rep target (already handled by
// reusing SetTargetRow as-is for a stage row).
function ProgramSetGroupEditor({
  displayNumber,
  exercise,
  group,
  readOnly,
}: {
  displayNumber: number
  exercise: ProgramExercise
  group: Group<ProgramSet>
  readOnly: boolean
}) {
  const { head, stages } = group
  const stageKind = resolveStageKind(head.stageKind ?? null)
  const updateStageKind = useUpdateProgramSetStageKind()
  const addStage = useAddProgramSetStage()
  const removeStage = useRemoveProgramSetStage()

  function handleAddStage() {
    if (readOnly) return
    addStage.mutate({
      programExerciseId: exercise.id,
      parentId: head.id,
      position: head.position,
      // max(existing) + 1, not stages.length + 1 — same collision setGroupLogic
      // .ts's own nextStageIndex avoids for the week plan/workout screen.
      stageIndex: nextStageIndex(group, (s) => s.stageIndex),
    })
  }

  return (
    <div>
      <SetTargetRow displayNumber={displayNumber} set={head} readOnly={readOnly} />

      {stages.length > 0 && (
        <div style={{ paddingLeft: 20, borderLeft: '1px dashed var(--border-strong)', marginLeft: 10 }}>
          {stages.map((stage) => (
            <SetTargetRow
              key={stage.id}
              displayNumber={displayNumber}
              set={stage}
              readOnly={readOnly}
              isStage
              stageKindLabel={STAGE_KIND_LABELS[stageKind]}
              onRemove={() => removeStage.mutate(stage.id)}
            />
          ))}

          {!readOnly && (
            <div style={{ padding: '2px 0 6px' }}>
              <RatingChips
                scale={{ values: STAGE_KINDS, labels: STAGE_KIND_LABELS }}
                value={stageKind}
                onChange={(kind) => updateStageKind.mutate({ id: head.id, stageKind: kind })}
                label="STAGE KIND"
              />
            </div>
          )}
        </div>
      )}

      {!readOnly && (
        <button
          onClick={handleAddStage}
          disabled={addStage.isPending}
          style={{ display: 'flex', alignItems: 'center', gap: 5, height: 24, padding: stages.length > 0 ? '0 9px 4px 20px' : '0 9px 4px 0', background: 'transparent', border: 'none', cursor: addStage.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', opacity: addStage.isPending ? 0.6 : 1 }}
        >
          <Plus size={11} />
          ADD STAGE
        </button>
      )}
    </div>
  )
}
