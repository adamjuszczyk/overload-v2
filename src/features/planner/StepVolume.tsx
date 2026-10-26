import { useState, type CSSProperties } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { Program, ProgramExercise, ProgramSet, PlanningType, DayOfWeek } from '../../types'
import { RepTargetPicker, SetTypePicker, applyToAllTargets } from '../../components/pickers'
import { hairline } from '../../components/pickers/pickerControls'
import { REST_MAX_SECONDS, stepRest } from '../../components/pickers/pickerLogic'
import { columnsToRepTarget, formatRepTarget, STAGE_KIND_LABELS, type RepTarget } from '../../lib/plannerVocabulary.js'
import { formatRestTime } from '../../lib/formatRestTime'
import { useWorkoutDays, useProgramExercises, useUpdatePlanningType } from '../programs/usePrograms'
import {
  useProgramSets,
  useSetExerciseSetCount,
  useUpdateSetRepTarget,
  useSetRepTargetForAllSets,
  useUpdateProgramSetRest,
  useChangeProgramSetType,
  useRemoveProgramSetStage,
  summarizeRepTargets,
} from './usePlanner'
import { programRows, programSetTypeChange, programSetTypeOf, type ProgramRow } from './programSetRows'
import { kindChipText } from '../plan/planSetRows'

// Step 3 — Volume (SPEC.md "Stepped program planner" step 3; TASKS-1.2 chunk 67; boards PP3, PP3b, PP3c, PP3d and PP6's two volume states).
// Serves the planner only (a saved program): chunk 33 removed Plan's program tab, the only other caller, and the planner refuses a run's
// copy. A running program's volume is edited in the week and made the default from there (SPEC Programs and runs [P1.1]). There is no
// deload-rules control here (chunk 48, SPEC Stepped program planner [1.2]: "No deload-rules control"): the rules are Settings' alone.
//
// "The only required value is the number of sets per exercise. Rep targets... are optional" (SPEC) — Save/Start are never blocked by a
// missing count (DECISIONS 52, provisional (a)); this step only ever shows a flag, never a guard.
//
// Since chunk 67 a set's number opens the set type picker (Normal, Warmup, Dropset, Rest-pause, Myo-reps, Cluster, the DROPS stepper, REST
// BETWEEN, REMOVE THIS SET) and a rep box (or ALL) opens the rep target picker, the two shared pickers (chunk 39). The old DROPSET /
// REST-PAUSE / MYO-REPS / CLUSTER chips, WARMUP chip, + ADD STAGE, the stage's delete icon, the STAGE REST row and the typed rep boxes are
// gone. Both pickers write nothing: what they return becomes the writes below (programSetRows.ts holds the type's mapping and its order),
// and the pickers are mounted beside the workout's card, outside everything clickable (BottomSheet portals, and React events from inside it
// bubble to whatever rendered it).

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }
const CAPTION: CSSProperties = { ...MONO, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }
const DISPLAY: CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 900, color: 'var(--text-primary)', overflowWrap: 'anywhere' }
const BOX: CSSProperties = { height: 44, boxSizing: 'border-box', borderRadius: 8, ...hairline('var(--border)'), background: 'var(--surface)' }
const PLAIN_BUTTON: CSSProperties = { borderWidth: 0, background: 'transparent', padding: 0, cursor: 'pointer' }

const DAY_ORDER: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

// The weekday a closed workout card names (board PP3: "TUE"): the day or days the program's schedule gives it; a sequence program has none.
function dayLabel(program: Program, workoutDayId: string): string | null {
  if (program.scheduleType === 'sequence') return null
  const days = DAY_ORDER.filter((d) => program.schedule?.[d] === workoutDayId).map((d) => d.slice(0, 3).toUpperCase())
  return days.length > 0 ? days.join(' · ') : null
}

const repTargetOf = (set: Pick<ProgramSet, 'repMin' | 'repMax' | 'isAmrap'>): RepTarget =>
  columnsToRepTarget({ repMin: set.repMin, repMax: set.repMax, isAmrap: set.isAmrap })
const repText = (set: Pick<ProgramSet, 'repMin' | 'repMax' | 'isAmrap'>): string => {
  const target = repTargetOf(set)
  return target.type === 'none' ? '—' : formatRepTarget(target)
}
const holdsTarget = (set: Pick<ProgramSet, 'repMin' | 'repMax' | 'isAmrap'>, target: RepTarget) => formatRepTarget(repTargetOf(set)) === formatRepTarget(target)

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
  // One workout's editor is open at a time (board PP3 draws the first open and the others as closed cards with their weekday).
  const [openId, setOpenId] = useState<string | null>(null)
  const openWorkoutId = workoutDays.some((d) => d.id === openId) ? openId : (workoutDays[0]?.id ?? null)

  function setPlanningType(next: PlanningType) {
    if (!canChangePlanningType || next === planningType) return
    updatePlanningType.mutate({ id: program.id, planningType: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={CAPTION}>PLANNING</span>
        <div role="group" aria-label="Planning" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', height: 44, borderRadius: 10, ...hairline('var(--border)'), background: 'var(--surface)', overflow: 'hidden' }}>
          {(
            [
              { value: 'stable' as const, label: 'STABLE' },
              { value: 'week_dependent' as const, label: 'WEEK-DEPENDENT' },
            ]
          ).map((opt) => {
            const active = planningType === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                onClick={() => setPlanningType(opt.value)}
                disabled={!canChangePlanningType || updatePlanningType.isPending}
                style={{ ...MONO, borderWidth: 0, background: active ? 'var(--accent)' : 'transparent', cursor: canChangePlanningType ? 'pointer' : 'default', fontSize: 10, letterSpacing: '0.15em', color: active ? 'var(--on-accent)' : 'var(--text-secondary)' }}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
        <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
          {planningType === 'stable'
            ? 'The sets planned here are the volume for every week.'
            : 'Only week 1 is planned here; later weeks copy forward.'}
        </span>
      </div>

      {isLoading && <LoadingCard />}

      {!isLoading && workoutDays.length === 0 && (
        <div style={{ borderRadius: 12, ...hairline('var(--border)'), background: 'var(--base)', padding: 14 }}>
          <p style={{ ...CAPTION, padding: '24px 0 14px', textAlign: 'center', margin: 0 }}>NO WORKOUTS YET</p>
        </div>
      )}

      {!isLoading &&
        workoutDays.map((day) =>
          day.id === openWorkoutId ? (
            <WorkoutVolumeEditor key={day.id} workoutDayId={day.id} workoutName={day.name} volumeReadOnly={volumeReadOnly} />
          ) : (
            <ClosedWorkoutCard key={day.id} name={day.name} day={dayLabel(program, day.id)} onOpen={() => setOpenId(day.id)} />
          ),
        )}
    </div>
  )
}

// Board PP6, "VOLUME · LOADING A WORKOUT": a card with a spinner while a workout's exercises and sets are read.
function LoadingCard() {
  return (
    <div style={{ height: 96, boxSizing: 'border-box', borderRadius: 12, ...hairline('var(--border)'), background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div
        role="status"
        aria-label="Loading"
        className="animate-spin"
        style={{ width: 20, height: 20, borderRadius: '50%', borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--border-strong)', borderTopColor: 'var(--accent)' }}
      />
    </div>
  )
}

// Board PP3: a workout that isn't the open one is a closed card with its name, its weekday and a chevron; tapping it opens its editor.
function ClosedWorkoutCard({ name, day, onOpen }: { name: string; day: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={false}
      aria-label={`Show editor for ${name}`}
      onClick={onOpen}
      style={{ ...PLAIN_BUTTON, width: '100%', minHeight: 64, boxSizing: 'border-box', borderRadius: 12, ...hairline('var(--border)'), background: 'var(--surface)', display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 0 16px', textAlign: 'left' }}
    >
      <span style={{ ...DISPLAY, flex: 1, minWidth: 0, fontSize: 16 }}>{name}</span>
      {day !== null && <span style={{ ...CAPTION, flex: '0 0 auto', letterSpacing: '0.15em' }}>{day}</span>}
      <span aria-hidden="true" style={{ flex: '0 0 auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
        <ChevronDown size={16} strokeWidth={2.2} />
      </span>
    </button>
  )
}

type PickState =
  | { kind: 'type'; exerciseId: string; headId: string }
  | { kind: 'reps'; exerciseId: string; headId: string; stageId: string | null }
  | { kind: 'all'; exerciseId: string }

// What the rep picker opens on for ALL: the rep target every set has, and none (the picker's NONE, no number) when they differ.
function allValue(heads: readonly ProgramSet[]): RepTarget {
  const summary = summarizeRepTargets([...heads])
  return summary === null || summary === 'mixed' ? { type: 'none' } : summary
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
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const [pick, setPick] = useState<PickState | null>(null)
  const updateTarget = useUpdateSetRepTarget()
  const setAll = useSetRepTargetForAllSets()
  const updateRest = useUpdateProgramSetRest()
  const changeType = useChangeProgramSetType()
  const removeSet = useRemoveProgramSetStage()

  if (exercisesLoading || (setsLoading && exerciseIds.length > 0)) return <LoadingCard />

  const rowsOf = (exerciseId: string): ProgramRow[] => programRows(sets.filter((s) => s.programExerciseId === exerciseId))
  const nameOf = (ex: ProgramExercise) => ex.exercise?.name ?? 'this exercise'

  // What the open picker is about, read from the sets as they are now (the picker keeps showing what the database holds).
  const pickExercise = pick ? exercises.find((e) => e.id === pick.exerciseId) : undefined
  const pickRows = pickExercise ? rowsOf(pickExercise.id) : []
  const pickHeads = pickRows.map((r) => r.head)
  const pickRow = pick && pick.kind !== 'all' ? pickRows.find((r) => r.head.id === pick.headId) : undefined
  const pickStage = pick?.kind === 'reps' && pick.stageId !== null ? pickRow?.stages.find((s) => s.id === pick.stageId) : undefined
  const pickValid =
    pick === null ||
    (pickExercise !== undefined &&
      (pick.kind === 'all' ? pickHeads.length > 0 : pickRow !== undefined && (pick.kind !== 'reps' || pick.stageId === null || pickStage !== undefined)))
  // A picker whose set has gone (removed here or on another phone) closes: reset in the render, not in an effect.
  if (!pickValid) setPick(null)

  function toggle(exerciseId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(exerciseId)) next.delete(exerciseId)
      else next.add(exerciseId)
      return next
    })
  }

  function submitReps(target: RepTarget, applyToAll: boolean) {
    if (!pick || pick.kind !== 'reps' || !pickRow) return
    setPick(null)
    // A stage's picker writes that stage only.
    if (pickStage) {
      if (!holdsTarget(pickStage, target)) updateTarget.mutate({ id: pickStage.id, target })
      return
    }
    if (applyToAll) {
      // "Use for all N sets": every head of the exercise, a warmup too (a rep target goes to every head).
      if (!pickHeads.every((h) => holdsTarget(h, target))) setAll.mutate({ headIds: applyToAllTargets(pickHeads, target, 'reps').map((w) => w.id), target })
      return
    }
    if (!holdsTarget(pickRow.head, target)) updateTarget.mutate({ id: pickRow.head.id, target })
  }

  function submitAll(target: RepTarget) {
    setPick(null)
    // ALL sets every set of the exercise, and is a no-op when every one already holds the target.
    if (pickHeads.length > 0 && !pickHeads.every((h) => holdsTarget(h, target))) setAll.mutate({ headIds: pickHeads.map((h) => h.id), target })
  }

  return (
    <>
      <div style={{ background: 'var(--surface)', ...hairline('var(--border)'), borderRadius: 12, padding: '8px 16px', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
          <span style={{ ...DISPLAY, flex: 1, minWidth: 0, fontSize: 18 }}>{workoutName}</span>
          <span style={{ ...CAPTION, flex: '0 0 auto', width: 132, textAlign: 'center' }}>SETS</span>
        </div>
        {exercises.length === 0 && <p style={{ ...CAPTION, margin: 0, padding: '12px 0 16px', letterSpacing: '0.15em' }}>NO EXERCISES YET</p>}
        {exercises.map((ex) => (
          <ExerciseSetsEditor
            key={ex.id}
            exercise={ex}
            rows={rowsOf(ex.id)}
            open={expanded.has(ex.id)}
            onToggle={() => toggle(ex.id)}
            volumeReadOnly={volumeReadOnly}
            onType={(row) => setPick({ kind: 'type', exerciseId: ex.id, headId: row.head.id })}
            onReps={(row, stage) => setPick({ kind: 'reps', exerciseId: ex.id, headId: row.head.id, stageId: stage?.id ?? null })}
            onAll={() => setPick({ kind: 'all', exerciseId: ex.id })}
            onRest={(id, restSeconds) => updateRest.mutate({ id, restSeconds })}
          />
        ))}
      </div>

      {pick?.kind === 'type' && pickExercise && pickRow && (
        <SetTypePicker
          context="planner"
          exerciseName={nameOf(pickExercise)}
          setNumber={pickRow.number}
          value={programSetTypeOf(pickRow)}
          onChange={(next) => {
            // A tap while a change is out asks for nothing: the stepper's taps would each be worked out from rows the first is still changing.
            if (changeType.isPending) return
            const ops = programSetTypeChange(pickRow, next)
            if (ops.length > 0) changeType.mutate({ ops })
          }}
          onClose={() => setPick(null)}
          onRemove={() => {
            if (changeType.isPending) return
            // The head's removal takes its stages with it (027's cascade); the position stays empty (DECISIONS 213 (a)).
            removeSet.mutate(pickRow.head.id)
            setPick(null)
          }}
        />
      )}
      {pick?.kind === 'reps' && pickExercise && pickRow && (pick.stageId === null || pickStage) && (
        <RepTargetPicker
          exerciseName={nameOf(pickExercise)}
          setNumber={pickRow.number}
          value={repTargetOf(pickStage ?? pickRow.head)}
          // A stage has no siblings to share its target with: "Use for all" is for a set's own rep box.
          sets={pickStage ? [pickRow.head] : pickHeads}
          onSubmit={({ target, applyToAll }) => submitReps(target, applyToAll)}
          onClose={() => setPick(null)}
        />
      )}
      {pick?.kind === 'all' && pickExercise && pickHeads.length > 0 && (
        <RepTargetPicker
          exerciseName={nameOf(pickExercise)}
          setNumber={1}
          value={allValue(pickHeads)}
          // ALL always sets every set: one entry keeps the picker from offering "Use for all" as a choice.
          sets={pickHeads.slice(0, 1)}
          onSubmit={({ target }) => submitAll(target)}
          onClose={() => setPick(null)}
        />
      )}
    </>
  )
}

// ─── One exercise: its SETS stepper (the one required value), and, opened, its rows (board PP3)

function ExerciseSetsEditor({
  exercise,
  rows,
  open,
  onToggle,
  volumeReadOnly,
  onType,
  onReps,
  onAll,
  onRest,
}: {
  exercise: ProgramExercise
  rows: ProgramRow[]
  open: boolean
  onToggle: () => void
  volumeReadOnly: boolean
  onType: (row: ProgramRow) => void
  onReps: (row: ProgramRow, stage: ProgramSet | null) => void
  onAll: () => void
  onRest: (id: string, restSeconds: number | null) => void
}) {
  const heads = rows.map((r) => r.head)
  const setCount = useSetExerciseSetCount()
  const name = exercise.exercise?.name ?? 'this exercise'
  const shown = open && rows.length > 0

  function changeCount(delta: number) {
    if (volumeReadOnly) return
    const next = Math.max(0, heads.length + delta)
    if (next === heads.length) return
    setCount.mutate({ programExerciseId: exercise.id, currentHeads: heads, count: next })
  }

  const stepStyle: CSSProperties = { height: '100%', borderWidth: 0, background: 'transparent', fontSize: 16, padding: 0 }
  const lessDisabled = volumeReadOnly || heads.length === 0 || setCount.isPending
  const moreDisabled = volumeReadOnly || setCount.isPending

  return (
    <div
      data-exercise={exercise.id}
      style={
        shown
          ? { margin: '4px -16px 0', padding: '0 16px 16px', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)', background: 'var(--surface-raised)', display: 'flex', flexDirection: 'column', gap: 8 }
          : { borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)', display: 'flex', flexDirection: 'column' }
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, minHeight: 64, marginLeft: -12 }}>
        {rows.length > 0 ? (
          <button
            type="button"
            aria-expanded={shown}
            aria-label={`${shown ? 'Hide' : 'Show'} set targets for ${name}`}
            onClick={onToggle}
            style={{ ...PLAIN_BUTTON, flex: '0 0 auto', width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}
          >
            {shown ? <ChevronUp size={16} strokeWidth={2.2} /> : <ChevronDown size={16} strokeWidth={2.2} />}
          </button>
        ) : (
          <span aria-hidden="true" style={{ flex: '0 0 auto', width: 44 }} />
        )}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.25, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{name}</span>
          {rows.length === 0 && <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.12em', color: 'var(--error)' }}>NO SETS YET</span>}
        </div>

        {/* SETS stepper — the one required value (SPEC), never a blocking gate (DECISIONS 52, provisional (a)). */}
        <div role="group" aria-label={`Sets for ${name}`} style={{ ...BOX, flex: '0 0 auto', display: 'grid', gridTemplateColumns: '44px 44px 44px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => changeCount(-1)}
            disabled={lessDisabled}
            aria-label={`Fewer sets for ${name}`}
            style={{ ...stepStyle, color: lessDisabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: lessDisabled ? 'default' : 'pointer' }}
          >
            −
          </button>
          <span style={{ ...MONO, fontWeight: 700, fontSize: 16, textAlign: 'center', color: heads.length === 0 ? 'var(--text-dim)' : 'var(--text-primary)' }}>{heads.length}</span>
          <button
            type="button"
            onClick={() => changeCount(1)}
            disabled={moreDisabled}
            aria-label={`More sets for ${name}`}
            style={{ ...stepStyle, color: moreDisabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: moreDisabled ? 'default' : 'pointer' }}
          >
            +
          </button>
        </div>
      </div>

      {shown && (
        <>
          {/* "Fill all sets of an exercise at once" (SPEC step 3's plain-case shortcut): ALL opens the rep target picker for every head. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ ...CAPTION, flex: '0 0 auto', width: 44, letterSpacing: '0.1em' }}>ALL</span>
            <button
              type="button"
              aria-label={`Set every set's rep target for ${name}`}
              disabled={volumeReadOnly}
              onClick={onAll}
              style={{ ...BOX, ...MONO, flex: 1, minWidth: 0, padding: '0 12px', display: 'flex', alignItems: 'center', textAlign: 'left', fontSize: 11, letterSpacing: '0.12em', color: 'var(--text-muted)', cursor: volumeReadOnly ? 'default' : 'pointer' }}
            >
              {allText(heads)}
            </button>
            <span style={{ ...CAPTION, flex: '0 1 150px', minWidth: 112, textAlign: 'center' }}>REST AFTER</span>
          </div>
          {rows.map((row) => (
            <SetRowView key={row.head.id} row={row} readOnly={volumeReadOnly} onType={() => onType(row)} onReps={(stage) => onReps(row, stage)} onRest={(restSeconds) => onRest(row.head.id, restSeconds)} />
          ))}
        </>
      )}
    </div>
  )
}

// What ALL reads: the rep target every set has, MIXED when they differ (a warmup counts: ALL sets it too), a dash when none has one.
function allText(heads: readonly ProgramSet[]): string {
  const summary = summarizeRepTargets([...heads])
  if (summary === 'mixed') return 'MIXED'
  return summary === null || summary.type === 'none' ? '—' : formatRepTarget(summary)
}

// ─── One set: its number (opens the type picker), its rep box (opens the rep picker), its REST AFTER stepper, and a staged set's stages

function SetRowView({
  row,
  readOnly,
  onType,
  onReps,
  onRest,
}: {
  row: ProgramRow
  readOnly: boolean
  onType: () => void
  onReps: (stage: ProgramSet | null) => void
  onRest: (restSeconds: number | null) => void
}) {
  const { head, stages, label } = row
  const type = programSetTypeOf(row)
  const staged = type.kind === 'staged' ? type : null
  const kindWord = staged ? STAGE_KIND_LABELS[staged.stageKind].toLowerCase() : ''
  const target = repText(head)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          aria-label={`Set ${label}: type`}
          disabled={readOnly}
          onClick={onType}
          style={{ ...BOX, ...MONO, flex: '0 0 auto', width: 44, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12, color: 'var(--text-muted)', cursor: readOnly ? 'default' : 'pointer' }}
        >
          {label}
        </button>
        <RepBox label={`Rep target for set ${label}`} text={target} dim={target === '—'} warmup={head.isWarmup} disabled={readOnly} onClick={() => onReps(null)} />
        <RestAfterStepper label={label} seconds={head.restSeconds} onChange={onRest} />
      </div>
      {staged && (
        <div style={{ margin: '0 0 8px 21px', padding: '4px 0 4px 21px', borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: 'var(--accent)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button
            type="button"
            aria-label={`Set ${label} type: ${kindChipText(staged.stageKind, staged.stageCount).replace(' · ', ', ').toLowerCase()}`}
            disabled={readOnly}
            onClick={onType}
            style={{ ...MONO, alignSelf: 'flex-start', maxWidth: '100%', height: 32, boxSizing: 'border-box', padding: '0 10px', borderRadius: 6, ...hairline('var(--accent)'), background: 'var(--accent-muted)', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, letterSpacing: '0.12em', color: 'var(--accent)', cursor: readOnly ? 'default' : 'pointer' }}
          >
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{kindChipText(staged.stageKind, staged.stageCount)}</span>
            <ChevronDown size={10} strokeWidth={3} aria-hidden="true" style={{ flex: '0 0 auto' }} />
          </button>
          {stages.map((stage, i) => {
            const text = repText(stage)
            return (
              <div key={stage.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span aria-hidden="true" style={{ ...MONO, flex: '0 0 auto', width: 16, fontSize: 13, color: 'var(--text-muted)' }}>↳</span>
                <RepBox label={`Rep target for the ${kindWord} stage${stages.length > 1 ? ` ${i + 1}` : ''}`} text={text} dim={text === '—'} warmup={false} disabled={readOnly} onClick={() => onReps(stage)} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RepBox({ label, text, dim, warmup, disabled, onClick }: { label: string; text: string; dim: boolean; warmup: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{ ...BOX, flex: 1, minWidth: 72, padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 6, textAlign: 'left', overflow: 'hidden', cursor: disabled ? 'default' : 'pointer' }}
    >
      <span style={{ ...MONO, fontWeight: 700, fontSize: 15, color: dim ? 'var(--text-dim)' : 'var(--text-primary)', whiteSpace: 'nowrap' }}>{text}</span>
      {warmup && (
        <span style={{ ...MONO, height: 22, boxSizing: 'border-box', padding: '0 6px', borderRadius: 4, background: 'var(--surface-raised)', ...hairline('var(--border-subtle)'), color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', fontSize: 9, letterSpacing: '0.08em' }}>WARMUP</span>
      )}
    </button>
  )
}

// The set's own rest after it (SPEC Rest: the set's own rest override): CHAIN until it has one, 15 s a tap, never past ten minutes, and the
// − at the first step clears it back to the chain. A design field, never gated by `volumeReadOnly` (chunk 16: the stepper and its sibling
// rests were never gated by it). The rest between stages is the set type picker's REST BETWEEN.
function RestAfterStepper({ label, seconds, onChange }: { label: string; seconds: number | null; onChange: (seconds: number | null) => void }) {
  const own = seconds !== null
  const lessDisabled = seconds === null
  const moreDisabled = seconds !== null && seconds >= REST_MAX_SECONDS
  const stepStyle: CSSProperties = { height: '100%', borderWidth: 0, background: 'transparent', fontSize: 16, padding: 0 }
  return (
    <div
      role="group"
      aria-label={`Rest after set ${label}`}
      style={{ ...BOX, flex: '0 1 150px', minWidth: 112, display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) 36px', alignItems: 'center', ...hairline(own ? 'var(--accent)' : 'var(--border)'), background: own ? 'var(--accent-muted)' : 'var(--surface)' }}
    >
      <button
        type="button"
        aria-label={`Less rest after set ${label}`}
        disabled={lessDisabled}
        onClick={() => onChange(stepRest(seconds, -1))}
        style={{ ...stepStyle, color: lessDisabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: lessDisabled ? 'default' : 'pointer' }}
      >
        −
      </button>
      <span style={{ ...MONO, fontWeight: 700, fontSize: 11, letterSpacing: '0.04em', textAlign: 'center', whiteSpace: 'nowrap', color: own ? 'var(--accent)' : 'var(--text-muted)' }}>
        {seconds === null ? 'CHAIN' : formatRestTime(seconds)}
      </span>
      <button
        type="button"
        aria-label={`More rest after set ${label}`}
        disabled={moreDisabled}
        onClick={() => onChange(stepRest(seconds, 1))}
        style={{ ...stepStyle, color: moreDisabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: moreDisabled ? 'default' : 'pointer' }}
      >
        +
      </button>
    </div>
  )
}
