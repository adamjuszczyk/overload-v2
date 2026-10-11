import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, Trash2, Copy, ArrowLeftRight, CalendarDays } from 'lucide-react'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import type { WeekPlan, WeekPlanSet, ProgramExercise, DayOfWeek, WorkoutDay, Exercise, WeightUnit, PlanningType, ProgramSet } from '../../types'
import { useMesos } from '../programs/useMesos'
import { usePrograms, useWorkoutDays, useProgramExercises, useSequenceItems } from '../programs/usePrograms'
import { hasScheduledWorkout } from '../programs/hasSchedule'
import {
  useWeekPlans,
  useAllWeekPlans,
  useSetDeload,
  useSetWeekDeload,
  useAddSet,
  useAddStage,
  useAddWarmupSet,
  useUpdateSet,
  useRemoveSet,
  useCopyFromPreviousWeek,
  useCopyWorkoutFromPreviousWeek,
  usePlanWeek,
  useSwapWeekExercise,
  useAddWeekExercise,
  useRemoveWeekExercise,
  useReorderWeekExercises,
} from './useWeekPlan'
import { resolveManualCopySource, type PlannedWeekRecord } from './weekSources'
import { groupWeekPlanSets, headsOnly, nextStageIndex, type SetGroup as Group } from '../gym/setGroupLogic'
import { groupIntoUnits, moveUnit } from '../../lib/supersetGroups.js'
import { detectSharedWeekdayWorkouts } from '../planner/usePlanner'
import { slotIdOf, setPositionOf, laterPlannedWeeks, type ChangeRecord } from './applyAhead'
import { useApplyAheadOffer, ApplyAheadBanner } from './ApplyAheadOffer'
import {
  columnsToRepTarget,
  formatRepTarget,
  parseRepTarget,
  applyAmrapRirDefault,
  type RepTarget,
  type RepTargetColumns,
  STAGE_KINDS,
  STAGE_KIND_LABELS,
  resolveStageKind,
  type StageKind,
  PRESET_TAGS,
  addTag,
  removeTag,
  applyTagToAllHeads,
} from '../../lib/plannerVocabulary.js'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { toDisplayWeight, toStorageWeight, resolveEditedWeightKg } from '../../lib/weightUnit'
import { resolveEffectiveDeloadRules, type DeloadRules } from '../../lib/deloadRules'
import { deloadRulesLine, type DeloadRulesOwner } from './deloadRulesLine'
import { useSettingsStore } from '../settings/settingsStore'
import RatingChips from '../gym/RatingChips.js'
import WorkoutSwitcher from './WorkoutSwitcher'
import SequenceSlotSwitcher, { type SwitcherSlot } from './SequenceSlotSwitcher'
import WeekExercisePickerSheet from './WeekExercisePickerSheet'
import MoveSessionControl from './MoveSessionControl'
import MakeWeekDefault from './MakeWeekDefault'
import { canMakeWeekDefault } from './makeWeekDefault'
import { MenuButton, MenuAction, MENU_PANEL_STYLE, DiffDot } from './planMenu'
import {
  StructureFieldsProvider,
  StructureRoutine,
  ExerciseDesignMenu,
  SetRestMenu,
  ExerciseMarkers,
  MarkerChip,
  type StructureExerciseFields,
  type StructureFieldsFor,
  type StructureSetFields,
} from './StructureFields'
import { setRestMarkers, stageRestDefaultText } from './structureFields'
import { SupersetLinkToggle, BlockRestEditor, EveryWeekLabel } from '../planner/designFieldEditors'
import { WeekDiffGate } from './WeekDiffGate'
import { CHANGED_BAND, CHANGED_CELL, CHANGED_EDGE, RemovedExerciseLine, RemovedSetRow, RemovedStructureRow } from './WeekDiffMarks'
import { computeWeekDiff, weekDiffNeedsRunCopy, weeksOfSlot, type ExerciseDiff, type WeekDiff } from './weekDiff'
import { useSequenceCurrentCycle } from './useSequenceCurrentCycle'
import { dateForDow } from '../gym/moveSession'
import { useToday } from '../../hooks/useToday'

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_ORDER: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

const DOW_LABEL: Record<DayOfWeek, string> = {
  monday: 'MONDAY', tuesday: 'TUESDAY', wednesday: 'WEDNESDAY',
  thursday: 'THURSDAY', friday: 'FRIDAY', saturday: 'SATURDAY', sunday: 'SUNDAY',
}

// Chunk 21 — the shared-row note's own weekday list ("Marks Mon, Tue, Wed,
// Thu, Fri — they share one plan"), sentence-case to match ApplyAheadBanner's
// own G14 note (chunk 20) rather than WorkoutSwitcher.tsx's all-caps
// DOW_SHORT (a different label context — a tab, not a sentence).
const DOW_SHORT_TITLE: Record<DayOfWeek, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
}

// There is no program tab (chunk 33, SPEC Plan screen [P1.1]: "No program tab.
// It's removed; what it did happens in the week or is fixed for the run"). The
// WEEKS / PROGRAM bar and ProgramTab.tsx are gone; where each thing the tab
// did lives now:
//   - rest, rest after, tempo, superset grouping and rest, the warmup routine,
//     a set's own rest and stage rest → STRUCTURE (chunk 30), labelled "every
//     week", and an exercise's weight unit in its ⋯ there;
//   - stable volume (sets, reps, set kinds, the exercise list) → edit the week,
//     then "Make this week the new default" (chunk 32);
//   - priorities → shown view-only (chunk 28), set in the planner;
//   - fixed for the run (G30): the schedule (its type, a weekday per workout,
//     the sequence order), the workouts and the deload-rules override. No
//     screen edits them; the planner refuses a run's copy (PlannerPage.tsx);
//   - the planning type was already fixed (the tab never offered it);
//   - the rules in effect → one read-only line under the deload action.

// Plan's week panel shows one week in two views (chunk 29, SPEC Plan screen
// [P1.1], G16): SETS (how many sets, and each set's weight, reps and RIR, tags
// included, stage rows' and warmup sets' numbers too) and STRUCTURE (the
// shape: exercise order, swap, add and remove an exercise, set kinds with
// warmup sets and stages added and removed). The switch is a SegmentBar
// (below): the segmented bar chunk 6 built for the WEEKS / PROGRAM tabs, kept
// for this switch so Plan adds no new visual language.
type PlanView = 'sets' | 'structure'

const PLAN_VIEWS: { id: PlanView; label: string }[] = [
  { id: 'sets', label: 'SETS' },
  { id: 'structure', label: 'STRUCTURE' },
]

function computeWeekNumber(startDate: string): number {
  return differenceInCalendarWeeks(new Date(), parseISO(startDate), { weekStartsOn: 1 }) + 1
}

// Chunk 19 — the one shared shape every row-level editor on this page sends
// through useUpdateSet (RIR, stage kind, warmup, weight target, rep target,
// tags). A key's mere presence means "write this column"; its absence means
// "leave it alone" — weekPlanService.ts's own updateSet() already applies
// this key-by-key, so this type is just this file's one copy of the same
// contract rather than four slightly-diverging inline object types.
type SetChanges = {
  targetRir?: number | null
  stageKind?: StageKind | null
  isWarmup?: boolean
  targetWeight?: number | null
  repMin?: number | null
  repMax?: number | null
  isAmrap?: boolean
  tags?: string[] | null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// Chunk 35 (SPEC Scheduling → Sequence [P1.1], G40: "The current cycle is the
// one containing the next due workout. Cycles before it are past.") — what
// "current" means for the week this screen opens on, marks and keeps editable.
// A weekday run's is the calendar week (PlanScreen's computeWeekNumber, as
// ever). A sequence run's is the cycle of its next due workout, the one Today
// shows next, whether that workout is due yet or not — and finding it takes a
// read of its own (the last workout done or skipped, the same query Today
// makes). Hooks can't be conditional, so a sequence run is wrapped here and a
// weekday run never mounts the wrapper: it makes no such read and renders
// exactly what it always did.
//
// Which of the two a run is, is known only once the programs have answered. Until
// then there is no screen at all: a PlanScreen mounted on a guess would show a
// WEEK n header and plan the calendar week (as a cycle, for a sequence run)
// before the cycle is known. The existing spinner shows instead; a programs
// read that failed with nothing to show gets the load error. Display-only
// choices (D31), provisional.
export default function PlanPage() {
  const { data: mesos = [] } = useMesos()
  const programsRead = usePrograms()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null

  if (activeMeso && programsRead.data === undefined) {
    return programsRead.isError ? <PlanLoadError /> : <PlanSpinner />
  }

  const program = programsRead.data?.find((p) => p.id === activeMeso?.programId)
  if (activeMeso && (program?.scheduleType ?? 'weekday') === 'sequence') {
    return <SequencePlanPage mesoId={activeMeso.id} programId={activeMeso.programId} />
  }
  return <PlanScreen />
}

// The sequence run's wrapper: finds the current cycle, then renders the same
// screen with it. Until the three reads behind it have answered the cycle is
// unknown, and the loading spinner shows instead of any cycle: marking cycle 1
// current (and editable) on a run that is in cycle 4, until the answer lands,
// would be a wrong cycle on screen. If one of the reads failed and has nothing
// to show, the spinner would never end: the load error shows instead, and
// nothing is planned (a fallback to the calendar week or cycle 1 would plan
// the wrong cycle). Display-only choices (D31), provisional.
function SequencePlanPage({ mesoId, programId }: { mesoId: string; programId: string }) {
  const { cycle, failed } = useSequenceCurrentCycle(mesoId, programId)
  if (cycle === null) return failed ? <PlanLoadError /> : <PlanSpinner />
  return <PlanScreen sequenceCycle={cycle} />
}

function PlanSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--base)' }}>
      <div className="animate-spin" style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
    </div>
  )
}

// The app's existing page-level load error, as PrioritiesEditor (this feature),
// StepPriorities and MesoPrioritiesPage show it: the same markup and tokens,
// worded for this page. Plan and Today had none of their own.
function PlanLoadError() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--base)' }}>
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--error)' }}>
          COULDN'T LOAD PLAN
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text-dim)', marginTop: 8 }}>
          Check your connection and try again.
        </p>
      </div>
    </div>
  )
}

// `sequenceCycle`: the current cycle of a sequence run (SequencePlanPage), null
// for a weekday run, whose current week is the calendar week.
function PlanScreen({ sequenceCycle = null }: { sequenceCycle?: number | null }) {
  const navigate = useNavigate()
  const today = useToday()
  const { data: mesos = [], isLoading: mesosLoading } = useMesos()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null

  const currentWeek = sequenceCycle ?? (activeMeso ? computeWeekNumber(activeMeso.startDate) : 1)
  // A sequence run opens on its current cycle from the first render, not
  // after an effect, so no other cycle is shown (or flagged read-only) first.
  const [viewWeek, setViewWeek] = useState(sequenceCycle ?? 1)

  // Workout switcher (TASKS.md §4 item 30) — which single workout day is
  // showing. No effect needed to keep it valid: `selected` below always
  // falls back to the first scheduled day if this points at a dow that
  // isn't scheduled (e.g. after switching meso/program).
  const [selectedDow, setSelectedDow] = useState<DayOfWeek | null>(null)

  // Chunk 25 review fix — the sequence equivalent of selectedDow above: which
  // slot (v2_program_sequence_items row id) is showing for a sequence run.
  // Same "no effect needed to keep it valid" posture — selectedSlot below
  // always falls back to the first workout-bearing slot.
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)

  // Which of the week panel's two views is showing (chunk 29, SPEC Plan screen
  // [P1.1]) — SETS or STRUCTURE. Display-only choices (D31), provisional: it
  // opens on SETS (what's used on every visit), and it is page-local UI state,
  // not a persisted setting (it resets on reload, like viewWeek here). It lives
  // up here, not in the panel, so the view you chose stays when you step to
  // another week or switch to another workout. COMPACT (the page-local view
  // this replaces) is gone — "There's no compact view" (G17).
  const [planView, setPlanView] = useState<PlanView>('sets')

  // The opening view is the current week (the current cycle on a sequence run).
  useEffect(() => {
    if (activeMeso) setViewWeek(currentWeek)
  }, [activeMeso?.id])

  const isPast = viewWeek < currentWeek

  const { data: programs = [] } = usePrograms()
  const program = programs.find((p) => p.id === activeMeso?.programId)
  // Chunk 25 (SPEC "Scheduling → Sequence" — "the cycle replaces the week
  // everywhere the week is used"; reviewer's note 3: "Labels 'Cycle n'
  // everywhere a sequence run shows a week"). Review fix (first review):
  // this page's own week body (scheduledDays/WorkoutSwitcher/
  // WorkoutDayPanel below) is now ALSO sequence-aware, via the parallel
  // sequenceSlots/selectedSlot/SequenceSlotSwitcher derived below —
  // program.schedule (weekday-only) and scheduledDays/selected stay exactly
  // as they were for a weekday run; a sequence run never reads them at all.
  const isSequence = (program?.scheduleType ?? 'weekday') === 'sequence'

  // Chunk 22 — the EFFECTIVE deload rules for this run: the program's own
  // override if it has one, else the global default (deloadRules.ts's
  // resolveEffectiveDeloadRules — "a program override wins over the global
  // rules"). Resolved once, here at the screen layer, and handed to every
  // mark/unmark call below as a plain argument — the executor
  // (weekPlanService.ts) has no notion of settings or programs at all.
  // Read via useSettingsStore (the hydrated Zustand store), not useSettings
  // itself — same "read live without prop drilling" convention every other
  // settings-reading component already follows (SetRow.tsx/RestTimer.tsx/
  // useWeightDisplay.ts etc.); useSettings' own query is kept hydrated by
  // whichever ancestor already calls it, and reading the store here means
  // this page needs no QueryClientProvider of its own in tests that mock
  // every other Supabase-touching hook already (every existing PlanPage
  // jsdom test file).
  const globalDeloadRules = useSettingsStore((s) => s.deloadRules)
  const effectiveDeloadRules = resolveEffectiveDeloadRules(program?.deloadRules, globalDeloadRules)
  // Chunk 33 (SPEC Deload [P1.1], G43): "Plan shows the rules in effect,
  // read-only, next to the deload action." The line under MARK WEEK AS DELOAD
  // shows exactly what marking is handed (effectiveDeloadRules above, never a
  // second resolution), and says whose they are: the run's own override, else
  // the Settings default as it is now. A run on "use my default" follows a
  // change in Settings because this reads the store live.
  const deloadRulesOwner: DeloadRulesOwner = program?.deloadRules != null ? 'run' : 'default'
  const deloadRulesText = deloadRulesLine(effectiveDeloadRules, deloadRulesOwner)

  // Chunk 22 (reviewer's note 5) — "Already started — sets left as they
  // are", shown after a mark/unmark that the started guard caught. Cleared
  // on every new attempt so a stale notice from a previous click never
  // lingers once a fresh one is in flight.
  const [weekDeloadNotice, setWeekDeloadNotice] = useState<string | null>(null)

  const { data: workoutDays = [], isLoading: daysLoading } = useWorkoutDays(
    activeMeso?.programId ?? '',
  )
  const { data: weekPlans = [], isLoading: plansLoading } = useWeekPlans(
    activeMeso?.id ?? '',
    viewWeek,
  )
  // Chunk 8 — the meso's full planned history (every week, every workout),
  // used below to decide whether COPY WEEK/COPY THIS WORKOUT have anything
  // to offer (resolveManualCopySource needs a workout's whole history, not
  // just the immediately preceding week — a partly-deload week can send it
  // further back). The same hook the scheduler already reuses elsewhere.
  const { data: allWeekPlans = [] } = useAllWeekPlans(activeMeso?.id ?? '')

  const copyPrev = useCopyFromPreviousWeek(activeMeso?.id ?? '', viewWeek)
  const planWeek = usePlanWeek()
  // Chunk 21 — "Mark this week as deload" / "Unmark this week" (SPEC
  // "Deload"), page-level like COPY WEEK above (one action per viewed
  // week, not per workout) since it targets every planned row of the week
  // by (mesocycle_id, week_number) alone — see useWeekPlan.ts's own header
  // comment on useSetWeekDeload.
  const setWeekDeload = useSetWeekDeload(activeMeso?.id ?? '', viewWeek)

  // Chunk 8 (TASKS.md "Weeks plan themselves... planned the first time
  // it's opened in Plan") — v2_plan_week is atomic and idempotent, so this
  // fires on every week this screen shows, with no guard against repeats:
  // an already-planned week simply plans 0. Today.tsx is the other named
  // caller, triggered "when [a session] starts" instead of on view.
  useEffect(() => {
    if (!activeMeso) return
    planWeek.mutate({ mesoId: activeMeso.id, weekNumber: viewWeek })
    // planWeek is a stable mutation object across renders (useMutation);
    // only a real change of meso or viewed week should re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeso?.id, viewWeek])

  // Chunk 20 (reviewer's note 7 — G14/DECISIONS 42–48): "say so in the offer
  // text if that workout is shared, the same wording convention chunk 21
  // will use" — detectSharedWeekdayWorkouts only ever returns a group for a
  // workout actually on 2+ weekdays, so membership alone is "is shared".
  const sharedGroups = program ? detectSharedWeekdayWorkouts(program.schedule) : []
  const sharedWorkoutDayIds = new Set(sharedGroups.map((g) => g.workoutDayId))
  // Chunk 21 (reviewer's note 2 — "the marking UI says so where the mark is
  // set, e.g. 'Marks Mon, Tue, Wed, Thu, Fri — they share one plan'") — the
  // per-workout toggle needs the actual weekday list, not just the boolean
  // sharedWorkoutDayIds already carries for the apply-ahead banner above.
  const sharedWeekdaysByWorkoutDayId = new Map(sharedGroups.map((g) => [g.workoutDayId, g.weekdays]))

  const schedule = program?.schedule
  const scheduledDays = schedule
    ? DAYS_ORDER.filter((dow) => !!schedule[dow])
        .map((dow) => ({
          dow,
          workoutDay: workoutDays.find((d) => d.id === schedule[dow]),
        }))
        .filter((x): x is { dow: DayOfWeek; workoutDay: WorkoutDay } => !!x.workoutDay)
    : []

  const selected = scheduledDays.find((x) => x.dow === selectedDow) ?? scheduledDays[0]

  // Chunk 25 review fix — the sequence equivalent of scheduledDays/selected
  // above. Fetched only for a sequence program (isSequence gates it; an
  // empty programId — the hook's own `enabled` check — means a weekday
  // run's page never issues this read at all, same "no new cost for the
  // overwhelmingly common case" posture useWorkoutDays/useWeekPlans already
  // take with `?? ''`). Sorted by position (TASKS.md "ordered list");
  // workoutDay null = a rest slot (v2_program_sequence_items.workout_day_id
  // null — StepExercises.tsx's own SequenceEditor convention).
  const { data: sequenceItemsRaw = [] } = useSequenceItems(isSequence ? (activeMeso?.programId ?? '') : '')
  const sequenceSlots: { id: string; position: number; workoutDay: WorkoutDay | null }[] = [...sequenceItemsRaw]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      id: item.id,
      position: item.position,
      workoutDay: item.workoutDayId ? workoutDays.find((d) => d.id === item.workoutDayId) ?? null : null,
    }))
  // Never defaults to a rest slot (review: "rest days shown as
  // non-selectable") — the first WORKOUT-bearing slot, same "fall back to
  // the first one" rule scheduledDays/selected already follow.
  const selectedSlot = sequenceSlots.find((s) => s.id === selectedSlotId && s.workoutDay)
    ?? sequenceSlots.find((s) => s.workoutDay)
    ?? null
  // Chunk 33 (SPEC Plan screen [P1.1] empty states): whether this run has any
  // scheduled workout at all, by the same check every START uses
  // (programs/hasSchedule.ts), read from what this page already loads: a
  // weekday with a workout (weekday run), or a slot with a workout (sequence
  // run). A run started before Start needed a schedule can have none.
  const hasSchedule = hasScheduledWorkout({
    scheduleType: program?.scheduleType,
    schedule: program?.schedule,
    workoutDays,
    sequenceItems: sequenceItemsRaw,
  })
  // This slot's own week-plan row for the viewed cycle — matched by BOTH
  // workout_day_id and sequence_position (review: "never by workout
  // alone"), so the two slots of a repeated workout (SPEC G8) open
  // different rows.
  const selectedSlotWeekPlan = selectedSlot?.workoutDay
    ? weekPlans.find(
        (wp) => wp.workoutDayId === selectedSlot.workoutDay!.id && (wp.sequencePosition ?? null) === selectedSlot.position,
      )
    : undefined

  // Chunk 8 — this one workout's own planned history (any week number),
  // the shape resolveManualCopySource needs. isEmpty (DECISIONS 42 (b)) is
  // zero v2_week_plan_sets rows — wp.sets is exactly that: useAllWeekPlans
  // (fetchAllWeekPlansForMeso) embeds v2_week_plan_sets(*) in full for
  // every week plan in the meso, the same query this page already reads
  // allWeekPlans from for the history above, so every prior week's own set
  // rows are already here — no extra fetch needed, and never derived from
  // the exercise list (a week can carry exercises with no sets under them).
  // Chunk 25 review fix — `sequencePosition` (optional, defaults to null,
  // same "may not exist yet" convention this whole chunk already uses)
  // scopes the history to one SLOT, not just one workout: a repeated
  // workout (SPEC G8) occupies two slots in one cycle, each with its own
  // independent copy history (TASKS.md "copying is per slot: a slot's
  // source is the same slot's last normal occurrence") — exactly
  // fetchPlannedWeekHistory's own slot-scoped search (weekPlanService.ts),
  // mirrored here for the client-already-has-allWeekPlans case. Every
  // weekday call site (both below) keeps passing just one arg — a weekday
  // row's own sequencePosition is always null/undefined, so `?? null`
  // matches exactly as before this chunk, byte for byte.
  function historyFor(workoutDayId: string, sequencePosition: number | null = null): PlannedWeekRecord[] {
    return allWeekPlans
      .filter((wp) => wp.workoutDayId === workoutDayId && (wp.sequencePosition ?? null) === sequencePosition)
      .map((wp) => ({ weekNumber: wp.weekNumber, isDeload: wp.isDeload, isEmpty: wp.sets.length === 0 }))
  }

  // Whether COPY WEEK/COPY THIS WORKOUT would actually copy something for
  // this workout — the same search the manual actions themselves run
  // (weekPlanService.ts's copyOneWorkoutFromHistory), so the button never
  // promises a copy it can't deliver. SPEC's empty-state bullet names a
  // week-dependent run specifically ("A week-dependent run whose weeks
  // start empty → 'Copy last week'"); a stable program's volume always
  // comes from the run's own copy (never from a prior week), so copying
  // wouldn't change its volume and this chunk doesn't offer the action for
  // one (no real stable program can exist before chunk 11 regardless).
  function hasManualSourceFor(workoutDayId: string, sequencePosition: number | null = null): boolean {
    if (program?.planningType === 'stable') return false
    return resolveManualCopySource(historyFor(workoutDayId, sequencePosition), viewWeek).kind === 'week'
  }

  // Empty-state "Copy last week" (SPEC "Plan screen"/"Weeks and copying") —
  // every scheduled workout already has its own (possibly empty)
  // v2_week_plans row by the time this renders (the effect above), so
  // "nothing planned yet" now reads as "every row exists but carries no
  // exercises" rather than "no rows at all".
  // Chunk 25 review fix — SPEC "the cycle replaces the week everywhere the
  // week is used (week plan, copying, ...)": this bulk action already works
  // per slot with no service change at all (weekPlanService.ts's own
  // fetchEmptyWorkoutPlanIds reads straight off v2_week_plans by
  // (mesocycle_id, week_number) alone, already returning each row's own
  // sequence_position — chunk 25's original pass built it this way on
  // purpose) — only this gate (previously scheduledDays-only, always empty
  // for a sequence program) needed to also check sequence slots.
  const showCopyButton =
    !isPast &&
    viewWeek > 1 &&
    !plansLoading &&
    !daysLoading &&
    weekPlans.length > 0 &&
    weekPlans.every((wp) => wp.exercises.length === 0) &&
    (isSequence
      ? sequenceSlots.some((s) => s.workoutDay && hasManualSourceFor(s.workoutDay.id, s.position))
      : scheduledDays.some((d) => hasManualSourceFor(d.workoutDay.id)))

  // Chunk 21 — "Mark this week as deload" / "Unmark this week" (SPEC
  // "Deload" / "Plan screen" — "mark session or week as deload" is one of
  // this screen's own Weeks actions, listed alongside "copy last week").
  // Page-level, shown whenever the viewed week has anything scheduled and
  // isn't read-only — independent of showCopyButton (that one hides once
  // the week has real content; this one doesn't care, since marking never
  // depends on whether anything's been planned by hand yet). weekIsFully
  // Deload reads off weekPlans as they stand now (the same query the rest
  // of this screen already reads) — a one-button toggle, same convention
  // as the per-session DELOAD pill, flipping between the two labels rather
  // than two separate buttons.
  // Chunk 25 review fix — "Mark this cycle as deload" (chunk 21's week
  // shortcut, relabelled): setWeekDeload itself already marks every row
  // sharing (mesocycle_id, week_number) with no workout_day_id filter at
  // all (weekPlanService.ts's own header: "Never filters by
  // workout_day_id... exactly the bug this function exists to not have"),
  // so it already covers every slot of a cycle unchanged — only this
  // visibility gate (previously scheduledDays-only) needed to also
  // recognise a sequence run's own slots.
  const showWeekDeloadButton =
    !isPast && !plansLoading && !daysLoading && (isSequence ? sequenceSlots.some((s) => s.workoutDay) : scheduledDays.length > 0)
  const weekIsFullyDeload = weekPlans.length > 0 && weekPlans.every((wp) => wp.isDeload)

  // Chunk 32 — "Make this week the new default" (SPEC Weeks and copying [P1.1]; Plan
  // screen actions): page-level, above both views, only where SPEC offers it:
  //   - a STABLE run (a week-dependent run's next week copies this one anyway);
  //   - the current week and later ones (G29) — on a sequence run `isPast` follows chunk
  //     35's current cycle, the one with the next due workout, not the calendar week;
  //   - a week with at least one session that can be a source: not deload, not empty
  //     (canMakeWeekDefault: the function's own refusals). "It isn't offered on a week
  //     that's all deload" (G27), nor on one whose sessions are all deload or empty, nor
  //     on a week with nothing planned yet.
  const showMakeDefault =
    program?.planningType === 'stable' && !isPast && !plansLoading && !daysLoading && canMakeWeekDefault(weekPlans)

  // ── No active meso ────────────────────────────────────────────────────────

  if (mesosLoading) return <PlanSpinner />

  if (!activeMeso) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)', padding: '20px 20px' }}>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2.5px', color: 'var(--text-muted)', marginBottom: 6 }}>
          OVERLOAD v2
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 28, color: 'var(--text-primary)', lineHeight: 1 }}>
          PLAN
        </h1>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)', textAlign: 'center' }}>
            NO ACTIVE MESOCYCLE
          </p>
          {/* Chunk 11 (SPEC.md "Plan screen" — "no active run → 'Start a
              program', leading to the planner"): the programs page (/program
              — ProgramsPage.tsx since chunk 26, same route, same target) is
              where a program is picked or created — "+" there opens the
              planner (PlannerPage, /program/:id). */}
          <button
            onClick={() => navigate('/program')}
            style={{ background: 'var(--accent)', border: 'none', borderRadius: 9, padding: '10px 22px', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: 'var(--base)', cursor: 'pointer' }}
          >
            START A PROGRAM →
          </button>
        </div>
      </div>
    )
  }

  // ── Active meso ───────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>

      {/* Header */}
      <div style={{ padding: '20px 20px 12px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        {/* The meso-name line, made tappable (PRIORITY-CONTEXT-TASKS.md
            §5.3) — the primary route to the active run's priorities screen,
            since this is where Adam actually is while planning a block. A
            real touch target rather than relying on the 9px text alone.
            Chunk 10: now opens PrioritiesEditor.tsx (v2_program_priorities,
            focus/don't-care, on this run's own program copy), not the old
            MesoPrioritiesPage — that stays for completed runs only, reached
            from ProgramPage (TASKS.md "Priorities: focus / don't care"). */}
        <button
          onClick={() => navigate('/plan/priorities')}
          style={{ width: '100%', minHeight: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'transparent', border: 'none', padding: 0, marginBottom: 2, cursor: 'pointer' }}
        >
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2.5px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {activeMeso.name.toUpperCase()}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--accent)' }}>
            PRIORITIES
            <ChevronRight size={11} />
          </span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 26, color: 'var(--text-primary)', lineHeight: 1, flexShrink: 0 }}>
            PLAN
          </h1>

          {/* Week navigation */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {/* Chunk 26 (SPEC.md "Programs page" — "Reached from the plan
                screen's header"): PROGRAM is gone from the bottom bar
                (Nav.tsx), so this is now the only persistent route there —
                the no-active-run empty state below still has its own
                "START A PROGRAM" CTA to the same place, unchanged. */}
            <button
              onClick={() => navigate('/program')}
              aria-label="Programs"
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <CalendarDays size={14} />
            </button>
            <button
              onClick={() => setViewWeek((w) => Math.max(1, w - 1))}
              disabled={viewWeek <= 1}
              aria-label="Previous week"
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, color: viewWeek <= 1 ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: viewWeek <= 1 ? 'default' : 'pointer' }}
            >
              <ChevronLeft size={14} />
            </button>
            <div style={{ minWidth: 76, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: viewWeek === currentWeek ? 'var(--accent)' : 'var(--surface-overlay)', border: `1px solid ${viewWeek === currentWeek ? 'transparent' : 'var(--border-strong)'}`, borderRadius: 8, padding: '0 10px' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, letterSpacing: '1.5px', color: viewWeek === currentWeek ? 'var(--base)' : (isPast ? 'var(--text-dim)' : 'var(--text-muted)') }}>
                {isSequence ? 'CYCLE' : 'WEEK'} {viewWeek}
              </span>
            </div>
            <button
              onClick={() => setViewWeek((w) => w + 1)}
              aria-label="Next week"
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px', minHeight: 0 }}>
        {/* Past week notice */}
        {isPast && (
          <div style={{ marginBottom: 14, padding: '8px 12px', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-dim)' }}>
              PAST WEEK — READ ONLY
            </span>
          </div>
        )}

        {/* Copy whole week */}
        {showCopyButton && (
          <button
            onClick={() => copyPrev.mutate()}
            disabled={copyPrev.isPending}
            style={{ width: '100%', height: 48, marginBottom: 16, background: 'var(--surface)', border: '1px dashed var(--border-strong)', borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: copyPrev.isPending ? 'not-allowed' : 'pointer', opacity: copyPrev.isPending ? 0.6 : 1 }}
          >
            <Copy size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-secondary)' }}>
              {copyPrev.isPending ? 'COPYING…' : (isSequence ? 'COPY LAST CYCLE' : 'COPY WEEK')}
            </span>
          </button>
        )}

        {/* Mark/unmark this week as deload (chunk 21, SPEC "Deload") — same
            dashed-button pattern as COPY WEEK above; a single toggle (same
            convention as the per-session DELOAD pill) rather than two
            separate buttons, label and fill flipping with weekIsFullyDeload.
            Chunk 22: hands the screen-resolved effectiveDeloadRules through
            on every call — the hook/executor never re-resolves it. */}
        {showWeekDeloadButton && (
          <>
            <button
              onClick={() => {
                setWeekDeloadNotice(null)
                setWeekDeload.mutate(
                  { isDeload: !weekIsFullyDeload, rules: effectiveDeloadRules },
                  {
                    onSuccess: (result) => {
                      if (result.anyAlreadyStarted) {
                        setWeekDeloadNotice('Already started — sets left as they are')
                      }
                    },
                  },
                )
              }}
              disabled={setWeekDeload.isPending}
              style={{
                width: '100%',
                height: 48,
                marginBottom: deloadRulesText || weekDeloadNotice ? 6 : 16,
                background: weekIsFullyDeload ? 'var(--accent-muted)' : 'var(--surface)',
                border: `1px dashed ${weekIsFullyDeload ? 'var(--accent)' : 'var(--border-strong)'}`,
                borderRadius: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                cursor: setWeekDeload.isPending ? 'not-allowed' : 'pointer',
                opacity: setWeekDeload.isPending ? 0.6 : 1,
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: weekIsFullyDeload ? 'var(--accent)' : 'var(--text-secondary)' }}>
                {setWeekDeload.isPending
                  ? (weekIsFullyDeload ? 'UNMARKING…' : 'MARKING…')
                  : (weekIsFullyDeload
                      ? (isSequence ? 'UNMARK THIS CYCLE' : 'UNMARK THIS WEEK')
                      : (isSequence ? 'MARK CYCLE AS DELOAD' : 'MARK WEEK AS DELOAD'))}
              </span>
            </button>
            {/* The rules this action applies (chunk 33, SPEC Deload [P1.1]; DECISIONS 87,
                provisional): read-only, nothing when no rules are on. */}
            {deloadRulesText && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: weekDeloadNotice ? 6 : 16, lineHeight: 1.5 }}>
                {deloadRulesText}
              </p>
            )}
            {weekDeloadNotice && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.5 }}>
                {weekDeloadNotice}
              </p>
            )}
          </>
        )}

        {/* Make this week the new default (chunk 32) — a stable run's page-level action,
            next to the two above; confirm first, no undo. It changes the run's default and
            nothing in the weeks already planned (no apply-ahead offer follows it). */}
        {showMakeDefault && <MakeWeekDefault mesoId={activeMeso.id} weekNumber={viewWeek} isSequence={isSequence} />}

        {/* Loading */}
        {(plansLoading || daysLoading) && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
            <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
          </div>
        )}

        {/* A run with no schedule (chunk 33; SPEC Plan screen empty states [P1.1],
            G39 — "A run with no schedule (started before Start needed one) → a line
            linking to the Programs page"; DECISIONS 86, provisional): one line for
            a weekday run and a sequence run alike, since a schedule can't be set up
            during a run any more — its schedule is fixed for the run — so there is
            nothing per type left to say. The check is the one every START uses. */}
        {!plansLoading && !daysLoading && !hasSchedule && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)', marginBottom: 12 }}>
              NO WORKOUTS SCHEDULED
            </p>
            <button
              onClick={() => navigate('/program')}
              style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)' }}
            >
              Programs →
            </button>
          </div>
        )}

        {/* Workout switcher + the one selected workout's panel */}
        {!isSequence && !plansLoading && !daysLoading && scheduledDays.length > 0 && selected && (
          <>
            <WorkoutSwitcher days={scheduledDays} selectedDow={selected.dow} onSelect={setSelectedDow} />

            {/* Chunk 24 (SPEC "Weekday" — "'Move this session' on Today and
                in Plan") — scoped to the week containing real "today" only
                (reviewer's own scope decision, this chunk's report): a past
                week's days are already resolved one way or another, and
                SPEC says nothing about pre-moving a future week. */}
            <MoveSessionControl
              workoutDay={selected.workoutDay}
              weekPlan={weekPlans.find((wp) => wp.workoutDayId === selected.workoutDay.id)}
              mesoId={activeMeso.id}
              date={dateForDow(activeMeso.startDate, viewWeek, selected.dow)}
              today={today}
              isCurrentWeek={viewWeek === currentWeek}
            />

            <WorkoutDayPanel
              key={selected.workoutDay.id}
              headerLabel={DOW_LABEL[selected.dow]}
              workoutDay={selected.workoutDay}
              weekPlan={weekPlans.find((wp) => wp.workoutDayId === selected.workoutDay.id)}
              isPast={isPast}
              mesoId={activeMeso.id}
              weekNumber={viewWeek}
              view={planView}
              onViewChange={setPlanView}
              canCopyFromHistory={hasManualSourceFor(selected.workoutDay.id)}
              isShared={sharedWorkoutDayIds.has(selected.workoutDay.id)}
              sharedWeekdays={sharedWeekdaysByWorkoutDayId.get(selected.workoutDay.id) ?? null}
              deloadRules={effectiveDeloadRules}
              planningType={program?.planningType ?? 'week_dependent'}
            />
          </>
        )}

        {/* Chunk 25 review fix — the sequence equivalent of the block above:
            the slot switcher (ordered by position, SPEC G8's repeated-
            workout slots each their own chip) + the SAME WorkoutDayPanel,
            matched to this slot's own week-plan row by (workout_day_id,
            sequence_position) — never by workout alone, so the two slots of
            a repeated workout open different rows. No MoveSessionControl
            here (chunk 24's own scope decision: weekday-only, keyed by a
            calendar date a sequence slot doesn't have). */}
        {isSequence && !plansLoading && !daysLoading && selectedSlot && (
          <>
            <SequenceSlotSwitcher
              slots={sequenceSlots.map((s): SwitcherSlot => ({ id: s.id, position: s.position, workoutDayName: s.workoutDay?.name ?? null }))}
              selectedId={selectedSlot.id}
              onSelect={setSelectedSlotId}
            />

            <WorkoutDayPanel
              key={`${selectedSlot.workoutDay!.id}:${selectedSlot.position}`}
              headerLabel={`SLOT ${selectedSlot.position + 1}`}
              workoutDay={selectedSlot.workoutDay!}
              weekPlan={selectedSlotWeekPlan}
              isPast={isPast}
              mesoId={activeMeso.id}
              weekNumber={viewWeek}
              view={planView}
              onViewChange={setPlanView}
              canCopyFromHistory={hasManualSourceFor(selectedSlot.workoutDay!.id, selectedSlot.position)}
              isShared={false}
              sharedWeekdays={null}
              deloadRules={effectiveDeloadRules}
              planningType={program?.planningType ?? 'week_dependent'}
            />
          </>
        )}
      </div>
    </div>
  )
}

// ─── Workout Day Panel ────────────────────────────────────────────────────────

interface PanelProps {
  // Chunk 25 review fix — generalised from `dow: DayOfWeek` (a weekday
  // run's own panel header's small top line): a sequence slot has no day of
  // week, so the PARENT now computes whatever this line should read
  // (DOW_LABEL[dow] for a weekday call — byte-identical to before this
  // fix — or `SLOT n` for a sequence one) and hands it down as plain text.
  // The only call site this value was ever used for (see below).
  headerLabel: string
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | undefined
  isPast: boolean
  mesoId: string
  weekNumber: number
  // Chunk 29 — which of the panel's two views shows (SETS or STRUCTURE), and
  // how the switch under the page-level actions changes it. PlanScreen owns
  // the choice so it survives a week or workout switch; the panel renders it.
  view: PlanView
  onViewChange: (view: PlanView) => void
  // Chunk 8 — whether COPY THIS WORKOUT has a real source to copy (the
  // same per-workout backward search PlanPage's own showCopyButton uses),
  // computed once by the parent (it alone holds the meso-wide history).
  canCopyFromHistory: boolean
  // Chunk 20 (reviewer's note 7) — this workout covers more than one
  // weekday (G14); the offer banner says so when it applies.
  isShared: boolean
  // Chunk 21 (reviewer's note 2) — the actual weekday list behind isShared
  // above (null when not shared), for the per-session DELOAD toggle's own
  // note ("Marks Mon, Tue, Wed, Thu, Fri — they share one plan").
  sharedWeekdays: DayOfWeek[] | null
  // Chunk 22 — the screen-resolved effective deload rules (program
  // override, else the global default, else none — PlanPage.tsx's own
  // resolveEffectiveDeloadRules call, computed once for the whole page).
  deloadRules: DeloadRules | null
  // Chunk 31 — the run's planning type, which decides what this week is compared
  // with (weekDiff.ts's chooseDiffSources): undefined on the program reads as
  // week-dependent (the column default), resolved once by PlanScreen.
  planningType: PlanningType
}

function WorkoutDayPanel({ headerLabel, workoutDay, weekPlan, isPast, mesoId, weekNumber, view, onViewChange, canCopyFromHistory, isShared, sharedWeekdays, deloadRules, planningType }: PanelProps) {
  // Chunk 7 (TASKS.md "Each planned session owns its exercise list") — the
  // week's own v2_week_plan_exercises list when a week plan row exists for
  // this workout (weekPlan.exercises, written alongside the plan row itself
  // — weekPlanService.ts's createWeekPlan/copyOnePlanForward, kept in step
  // with the program by programService.ts's add/reorder sync until chunk
  // 9); the program's own exercises directly otherwise — no week plan has
  // been planned for this workout/week yet, the same source this screen
  // always read before this chunk. fallbackProgramExercises is still
  // fetched unconditionally (same as before) so that "no week plan" case
  // renders exactly as today.
  // Chunk 31: this same read is the run's copy of the workout (its current list: not
  // week-only, not removed), which week 1 and a stable week are compared with, so its
  // not-yet-read state (undefined) is kept apart from an empty list.
  const { data: runCopyExercises } = useProgramExercises(workoutDay.id)
  const fallbackProgramExercises = runCopyExercises ?? []
  const programExercises = weekPlan?.exercises ?? fallbackProgramExercises

  // Chunk 13 — contiguous same-block runs, in this week's own order. Move
  // controls render only on a unit's first member (see the render below);
  // a plain, ungrouped week (every unit size 1 — every week before this
  // chunk) shows one pair per row, unchanged.
  const exerciseUnits = groupIntoUnits(programExercises)
  const unitIndexByProgramExerciseId = new Map<string, number>()
  exerciseUnits.forEach((unit, unitIndex) =>
    unit.forEach((pe) => unitIndexByProgramExerciseId.set(pe.id, unitIndex)),
  )

  const addSet = useAddSet(mesoId, weekNumber)
  const addStage = useAddStage(mesoId, weekNumber)
  const addWarmup = useAddWarmupSet(mesoId, weekNumber)
  const removeSet = useRemoveSet(mesoId, weekNumber)
  const updateSet = useUpdateSet(mesoId, weekNumber)
  const toggleDeload = useSetDeload(mesoId, weekNumber)
  const copyWorkout = useCopyWorkoutFromPreviousWeek(mesoId, weekNumber)

  // Chunk 9 — swap/reorder/add/remove an exercise in THIS week.
  const swapExercise = useSwapWeekExercise(mesoId, weekNumber)
  const addExercise = useAddWeekExercise(mesoId, weekNumber)
  const removeExercise = useRemoveWeekExercise(mesoId, weekNumber)
  const reorderExercises = useReorderWeekExercises(mesoId, weekNumber)

  // Chunk 20 ("Apply this change to planned weeks ahead") — allWeekPlans is
  // the SAME meso-wide query PlanPage.tsx's own copy-history check already
  // reads (useAllWeekPlans dedupes by query key, so this costs no extra
  // round trip); laterPlannedWeeks filters it to this one workout's own
  // rows after the viewed week, "planned" needing no extra check since a
  // row's mere presence here already means one exists. The offer's own
  // state is scoped to this one panel (one per workout day, like every
  // other per-workout mutation above) and resets whenever the viewed
  // week or workout changes, so it never survives into one it wasn't
  // built for (reviewer's note 10).
  const { data: allWeekPlansForApplyAhead = [] } = useAllWeekPlans(mesoId)
  // Chunk 25 review fix — the reset key must also carry this slot's own
  // position: two slots of a repeated workout (SPEC G8) in the same cycle
  // would otherwise share one `${workoutDayId}:${weekNumber}` key and so
  // share one offer/outcome state, exactly the staleness reviewer's note 10
  // already guards against for a workout/week switch. Only appended when a
  // real sequence_position exists (weekPlan?.sequencePosition, the same
  // field laterWeeksForThisWorkout reads just below) — a weekday row's own
  // key is never touched: `undefined`/`null` there leaves the key exactly
  // `${workoutDayId}:${weekNumber}`, byte for byte as before this fix.
  const applyAheadOffer = useApplyAheadOffer(
    mesoId,
    `${workoutDay.id}:${weekNumber}${weekPlan?.sequencePosition != null ? `:${weekPlan.sequencePosition}` : ''}`,
  )
  function laterWeeksForThisWorkout() {
    // Chunk 25 (reviewer's note 3) — slot identity, not just workoutDayId:
    // weekPlan is THIS workout's own row for the viewed week/cycle; its
    // sequencePosition (null for a weekday run, or absent on a pre-chunk-25
    // fixture) is the slot every later week must also match.
    return laterPlannedWeeks(allWeekPlansForApplyAhead, workoutDay.id, weekNumber, weekPlan?.sequencePosition ?? null)
  }

  // Chunk 31 (SPEC Plan screen [P1.1]: "Anything different from the week's source is
  // highlighted") — what this week differs from its source by, weekDiff.ts's pure
  // decision over data Plan already holds: every week of the run (the same meso-wide
  // read as above), narrowed to THIS workout's slot (on a sequence run a repeated
  // workout's two slots are two histories, each compared with its own), and the run's
  // copy of the workout, read below only for a week that is compared with it. Nothing
  // is stored, and a week is compared as it is now (G22): the sources are read live
  // on every render. NEW WEEK STARTS is the store's, read live like deloadRules.
  const weekStart = useSettingsStore((s) => s.weekStart)
  const slotWeeks = weeksOfSlot(allWeekPlansForApplyAhead, workoutDay.id, weekPlan?.sequencePosition ?? null)
  const diffNeedsRunCopy =
    !!weekPlan && weekDiffNeedsRunCopy({ planningType, weekStart, weekNumber, slotWeeks, isDeload: weekPlan.isDeload })
  function computeDiff(runCopy: { exercises: ProgramExercise[]; programSets: ProgramSet[] } | null): WeekDiff | null {
    if (!weekPlan) return null
    return computeWeekDiff({ planningType, weekStart, weekNumber, week: weekPlan, slotWeeks, runCopy })
  }

  // Which sheet (if any) is open: swapping a specific slot, or adding a new
  // one. Exclusive — only one picker at a time, same as GymSession's own
  // showAddExerciseSheet/swap state never overlapping.
  const [swapTarget, setSwapTarget] = useState<ProgramExercise | null>(null)
  const [showAddExerciseSheet, setShowAddExerciseSheet] = useState(false)
  const [confirmRemoveExercise, setConfirmRemoveExercise] = useState<{ id: string; name: string } | null>(null)
  // Chunk 22 (reviewer's note 5) — same one-line notice as PlanPage's own
  // week-level action, scoped to this one session's own toggle.
  const [deloadNotice, setDeloadNotice] = useState<string | null>(null)

  const sets = weekPlan?.sets ?? []

  // Copy just this workout (TASKS.md §4 item 31 / SPEC §5; chunk 8 revises
  // the gate itself) — offered whenever this specific workout has nothing
  // planned yet this week (v2_plan_week already creates its row, possibly
  // with zero exercises — "a week-dependent run whose weeks start empty",
  // SPEC — so "nothing planned" is exercises.length === 0, not merely "no
  // row"), even if other workouts in the week already do (which is exactly
  // when the page-level "copy whole week" button above has already
  // disappeared), AND there is actually something non-deload in this
  // workout's own history to copy (canCopyFromHistory — the same check
  // showCopyButton uses, computed once by the parent).
  const showCopyWorkoutButton =
    !isPast && weekNumber > 1 && (weekPlan?.exercises.length ?? 0) === 0 && canCopyFromHistory

  function handleAddSet(pe: ProgramExercise) {
    // Count heads only — a dropset's stage rows must not inflate the next
    // set's number (§2.7 item 8).
    const existingHeadsForEx = headsOnly(
      sets.filter((s) => s.programExerciseId === pe.id),
      (s) => s.parentWeekPlanSetId,
    )
    addSet.mutate({
      workoutDayId: workoutDay.id,
      weekPlanId: weekPlan?.id,
      programExerciseId: pe.id,
      setNumber: existingHeadsForEx.length + 1,
    })
    // Review fix item 3 — week-level ADD SET: SPEC names no exception for
    // it ("offered when a week is edited and later weeks are already
    // planned"). Same shape as the stable program-tab's own stepper (+) —
    // both always append at the matched later week's own current end.
    const change: ChangeRecord = { editType: 'addSet', slotId: slotIdOf(pe), exerciseId: pe.exerciseId }
    applyAheadOffer.setOffer([change], laterWeeksForThisWorkout(), isShared)
  }

  // "Add warmup sets" (the exercise ⋯ menu): one warmup head above this
  // exercise's first working set (weekPlanService.ts's addWarmupSet picks the
  // number and shifts the rest down). Offered ahead like ADD SET is.
  function handleAddWarmup(pe: ProgramExercise) {
    addWarmup.mutate({
      workoutDayId: workoutDay.id,
      weekPlanId: weekPlan?.id,
      programExerciseId: pe.id,
    })
    const change: ChangeRecord = { editType: 'addWarmupSet', slotId: slotIdOf(pe), exerciseId: pe.exerciseId }
    applyAheadOffer.setOffer([change], laterWeeksForThisWorkout(), isShared)
  }

  function handleAddStage(pe: ProgramExercise, group: Group<WeekPlanSet>, groups: Group<WeekPlanSet>[]) {
    if (!weekPlan) return
    const headOrdinal = groups.findIndex((g) => g.head.id === group.head.id) + 1
    addStage.mutate({
      weekPlanId: weekPlan.id,
      programExerciseId: pe.id,
      parentId: group.head.id,
      setNumber: group.head.setNumber,
      // max(existing) + 1, not length + 1 — those diverge once a non-last
      // stage has been individually deleted (setGroupLogic.ts's
      // nextStageIndex explains the collision this avoids).
      stageIndex: nextStageIndex(group, (s) => s.stageIndex),
    })
    // Chunk 20 — "add/remove stage" (chunk 14), both planning types. Built
    // right alongside the mutate call, same posture every week action in
    // this file already takes (the swap/add/remove sheets below close
    // immediately too, never gated on the mutation's own success) —
    // useAddStage/useSwapWeekExercise/etc. carry no optimistic update of
    // their own, so there is no "settled" moment to hook for these that
    // isn't already a full query refetch away.
    const change: ChangeRecord = { editType: 'addStage', slotId: slotIdOf(pe), exerciseId: pe.exerciseId, headOrdinal }
    applyAheadOffer.setOffer([change], laterWeeksForThisWorkout(), isShared)
  }

  // Chunk 19 (SPEC "Tags" — "'Apply to all sets' fills one tag across an
  // exercise's sets"). `groups` is this ONE exercise's own heads-plus-stages
  // for this week (computed by the render loop below, one per exercise) —
  // applyTagToAllHeads (plannerVocabulary.ts) does the heads-only/no-warmup/
  // no-duplicate decision; this just fires one mutate per row it says
  // actually needs writing (idempotent: a second tap writes nothing, since
  // every head already carries the tag by then).
  function handleApplyTagToAll(groups: Group<WeekPlanSet>[], tag: string) {
    const heads = groups.map((g) => ({ id: g.head.id, tags: g.head.tags ?? null, isWarmup: g.head.isWarmup }))
    for (const u of applyTagToAllHeads(heads, tag)) {
      updateSet.mutate({ id: u.id, changes: { tags: u.tags } })
    }
    // Chunk 20 scope decision (kept on review): this writes several sets in
    // one user action, which doesn't fit the one-row-per-ChangeRecord model
    // — never offered. Documented in the report alongside its batch twin,
    // StepVolume.tsx's "ALL SETS" (setRepTargetForAllSets); only the
    // PER-SET editors are wired.
  }

  // Chunk 9 — Week actions: swap, reorder, add, remove (weekEdits.ts's slot
  // decisions, applied by weekPlanService.ts). Chunk 27: a swap or reorder is
  // a normal week edit — there is no "only this week" tick, so each one
  // always records the apply-ahead change.
  //
  // Review fix (bug 1): async + mutateAsync, not the fire-and-forget
  // .mutate() every other handler in this file uses — applying this swap
  // ahead must repoint each matched later week at the SAME resulting
  // program-exercise row THIS swap creates (never a fresh row per week,
  // or a follow-up edit on that row could never find them again — see
  // applyAhead.ts's own header), so the change record needs that row's
  // real id, which only exists once swapWeekExercise's own insert
  // resolves. setSwapTarget(null) still runs first, synchronously, so the
  // picker sheet closes at the exact same moment it always has.
  async function handlePickReplacement(exercise: Exercise) {
    if (!weekPlan || !swapTarget) return
    const target = swapTarget
    setSwapTarget(null)
    const replacement = await swapExercise.mutateAsync({
      weekPlanId: weekPlan.id,
      programExerciseId: target.id,
      replacementExerciseId: exercise.id,
    })
    // exerciseId: the PRE-swap real exercise (what later weeks still show),
    // captured from `target` rather than re-read after the swap.
    const change: ChangeRecord = {
      editType: 'swapExercise',
      slotId: slotIdOf(target),
      exerciseId: target.exerciseId,
      newExerciseId: exercise.id,
      resultingProgramExerciseId: replacement.id,
    }
    applyAheadOffer.setOffer([change], laterWeeksForThisWorkout(), isShared)
  }

  function handlePickAdd(exercise: Exercise) {
    if (!weekPlan) return
    addExercise.mutate({
      weekPlanId: weekPlan.id,
      workoutDayId: workoutDay.id,
      exerciseId: exercise.id,
      position: programExercises.length,
    })
    // Chunk 20 — "Adding or removing an exercise in a week is allowed for
    // both planning types" (SPEC), and apply-ahead covers it for both the
    // same way (reviewer's note 4: "Both planning types").
    const change: ChangeRecord = { editType: 'addExercise', workoutDayId: workoutDay.id, exerciseId: exercise.id }
    applyAheadOffer.setOffer([change], laterWeeksForThisWorkout(), isShared)
    setShowAddExerciseSheet(false)
  }

  function handleConfirmRemove() {
    if (!weekPlan || !confirmRemoveExercise) return
    const target = programExercises.find((p) => p.id === confirmRemoveExercise.id)
    removeExercise.mutate({ weekPlanId: weekPlan.id, programExerciseId: confirmRemoveExercise.id })
    if (target) {
      const change: ChangeRecord = { editType: 'removeExercise', slotId: slotIdOf(target), exerciseId: target.exerciseId }
      applyAheadOffer.setOffer([change], laterWeeksForThisWorkout(), isShared)
    }
    setConfirmRemoveExercise(null)
  }

  // Block-aware reorder (chunk 13 — SPEC.md "Supersets": "Every reorder
  // (program, week plan, session) moves a superset as one block"). With no
  // grouping at all (every unit size 1 — every week before this chunk),
  // moveUnit degrades to exactly the old adjacent-swap behaviour, so this
  // still sends exactly the two affected rows' own pre-move positions (in
  // their ORIGINAL order) to reorderWeekExercises, byte-identical to before
  // for that case. A block's every member gets its own move in the same
  // call, each carrying its own true oldPosition.
  function handleMoveExercise(index: number, direction: 'up' | 'down') {
    if (!weekPlan) return
    const ordered = [...programExercises].sort((a, b) => a.position - b.position)
    const reordered = moveUnit(ordered, index, direction)
    if (reordered === ordered) return
    const newPositionById = new Map(reordered.map((pe, i) => [pe.id, i]))
    const moves = ordered
      .map((pe) => ({ programExerciseId: pe.id, oldPosition: pe.position, newPosition: newPositionById.get(pe.id)! }))
      .filter((m) => m.oldPosition !== m.newPosition)
    if (moves.length === 0) return
    reorderExercises.mutate({ weekPlanId: weekPlan.id, moves })
    // Each move's slotId is `ordered`'s own pre-move row (captured here,
    // before the mutation changes any position), matching copying's own
    // identity rule.
    const change: ChangeRecord = {
      editType: 'reorderExercise',
      moves: moves.map((m) => {
        const row = ordered.find((p) => p.id === m.programExerciseId)!
        return { slotId: slotIdOf(row), oldPosition: m.oldPosition, newPosition: m.newPosition }
      }),
    }
    applyAheadOffer.setOffer([change], laterWeeksForThisWorkout(), isShared)
  }

  // Chunk 20 — "remove stage" (chunk 14) and, since the first review (item
  // 3), week-level REMOVE SET on a head too (a working set's ⋯ DELETE SET
  // in the Sets view, a warmup set's in the Structure view; chunk 29 took
  // compact mode's MINUS away with COMPACT) — SPEC names no exception for it
  // either ("offered when a week is edited and later weeks are already
  // planned").
  // setPositionOf tells head from stage by itself (stageIndex null = head),
  // so one function now covers both, each with its own editType:
  // removeHeadSet matches by ordinal (removing THAT ordinal, never
  // whichever is trailing — the distinguishing behaviour from the
  // program-tab's own removeSet, which stays trailing-only); removeStage
  // by ordinal + exact stage_index, as before. Position is read BEFORE
  // calling mutate — useRemoveSet optimistically filters the cache
  // synchronously (onMutate), but `groups` here is this render's own
  // already-captured array, unaffected by that.
  function handleRemoveSet(id: string, pe: ProgramExercise, groups: Group<WeekPlanSet>[]) {
    const pos = setPositionOf(groups, id)
    removeSet.mutate(id)
    if (!pos) return
    const change: ChangeRecord =
      pos.stageIndex == null
        ? { editType: 'removeHeadSet', slotId: slotIdOf(pe), exerciseId: pe.exerciseId, headOrdinal: pos.headOrdinal }
        : { editType: 'removeStage', slotId: slotIdOf(pe), exerciseId: pe.exerciseId, setPosition: pos }
    applyAheadOffer.setOffer([change], laterWeeksForThisWorkout(), isShared)
  }

  // Chunk 20 — the one shared path for weight target / rep target / RIR /
  // tags / stage kind / warmup (chunk 19, chunk 14's stage-kind editor, and
  // — since the first review (item 3) — chunk 15's WARMUP toggle, SPEC
  // naming no exception for it either) all funnel through PlanPage.tsx's
  // one onUpdateSet, keyed only by which field(s) `changes` actually
  // carries (same convention weekPlanService.ts's own updateSet already
  // uses). A compound write (e.g. an AMRAP rep target that also defaults
  // RIR — plannerVocabulary.ts's applyAmrapRirDefault) becomes more than
  // one record, offered and applied together as one bundle.
  function handleUpdateSet(id: string, changes: SetChanges, pe: ProgramExercise, groups: Group<WeekPlanSet>[]) {
    // Same "read before mutate" posture as handleRemoveSet above — current
    // is this render's own pre-edit value, read before useUpdateSet's own
    // optimistic onMutate touches the cache.
    const current = sets.find((s) => s.id === id)
    updateSet.mutate({ id, changes })
    if (!current) return
    const pos = setPositionOf(groups, id)
    if (!pos) return
    const slotId = slotIdOf(pe)
    const exerciseId = pe.exerciseId
    const records: ChangeRecord[] = []
    if ('targetWeight' in changes) {
      records.push({ editType: 'weightTarget', slotId, exerciseId, setPosition: pos, oldValue: current.targetWeight ?? null, newValue: changes.targetWeight ?? null })
    }
    if ('targetRir' in changes) {
      records.push({ editType: 'rir', slotId, exerciseId, setPosition: pos, oldValue: current.targetRir, newValue: changes.targetRir ?? null })
    }
    if ('repMin' in changes || 'repMax' in changes || 'isAmrap' in changes) {
      records.push({
        editType: 'repTarget',
        slotId,
        exerciseId,
        setPosition: pos,
        oldValue: { repMin: current.repMin ?? null, repMax: current.repMax ?? null, isAmrap: current.isAmrap ?? false },
        newValue: { repMin: changes.repMin ?? null, repMax: changes.repMax ?? null, isAmrap: changes.isAmrap ?? false },
      })
    }
    // Tags/stage kind/warmup: heads only (reviewer's note 2) — PlanPage.tsx
    // itself never offers any of the three editors on a stage row (SetRow's
    // own gating), so pos.stageIndex is already always null whenever these
    // keys appear; the check is a defensive belt, not a guess at new
    // behaviour.
    if ('tags' in changes && pos.stageIndex == null) {
      records.push({ editType: 'tags', slotId, exerciseId, setPosition: pos, oldValue: current.tags ?? null, newValue: changes.tags ?? null })
    }
    if ('stageKind' in changes && pos.stageIndex == null) {
      records.push({ editType: 'stageKind', slotId, exerciseId, setPosition: pos, oldValue: current.stageKind ?? null, newValue: changes.stageKind ?? null })
    }
    if ('isWarmup' in changes && pos.stageIndex == null) {
      records.push({ editType: 'warmup', slotId, exerciseId, setPosition: pos, oldValue: current.isWarmup, newValue: changes.isWarmup ?? false })
    }
    if (records.length === 0) return
    applyAheadOffer.setOffer(records, laterWeeksForThisWorkout(), isShared)
  }

  // The week's exercises, one section each — the same in both views. In the
  // STRUCTURE view `fieldsFor` carries each exercise's run-wide fields (chunk 30:
  // StructureFields.tsx); in SETS it is null and a section draws exactly what it
  // did before.
  //
  // Chunk 31: `diff` is what this week differs from its source by (null: nothing is
  // compared, and this draws exactly what it always did). The STRUCTURE view draws an
  // exercise the source has and the week doesn't as a dim struck-through line right
  // after the exercise it followed there — a swap: the old exercise directly above
  // the new one — so the list below is the week's exercises with those lines among
  // them, and "last" is the last of them.
  function renderExercises(fieldsFor: StructureFieldsFor | null, diff: WeekDiff | null) {
    const removedAfter = (anchor: string | null) =>
      view === 'structure' && diff ? diff.removedExercises.filter((r) => r.after === anchor) : []
    type Entry = { kind: 'exercise'; pe: ProgramExercise; idx: number } | { kind: 'removed'; key: string; name: string }
    const entries: Entry[] = []
    removedAfter(null).forEach((r, i) => entries.push({ kind: 'removed', key: `removed:top:${i}`, name: r.name }))
    programExercises.forEach((pe, idx) => {
      entries.push({ kind: 'exercise', pe, idx })
      removedAfter(pe.id).forEach((r, i) => entries.push({ kind: 'removed', key: `removed:${pe.id}:${i}`, name: r.name }))
    })

    return entries.map((entry, entryIdx) => {
      if (entry.kind === 'removed') {
        return <RemovedExerciseLine key={entry.key} name={entry.name} isLast={entryIdx === entries.length - 1} />
      }
      const { pe, idx } = entry
      const exerciseSets = sets.filter((s) => s.programExerciseId === pe.id)
      const groups = groupWeekPlanSets(exerciseSets).sort(
        (a, b) => a.head.setNumber - b.head.setNumber,
      )
      const unitIndex = unitIndexByProgramExerciseId.get(pe.id) ?? idx
      const unit = exerciseUnits[unitIndex]
      const isFirstInUnit = unit?.[0]?.id === pe.id

      return (
        <ExerciseSection
          // The view is in the key: switching views remounts the
          // section, so no ⋯ menu or half-typed cell from the other
          // view is carried over into this one.
          key={`${pe.id}:${view}`}
          view={view}
          pe={pe}
          groups={groups}
          isPast={isPast}
          isLast={entryIdx === entries.length - 1}
          diff={diff?.exercises.get(pe.id)}
          // A marker on every member of a 2+ block (a plain week shows it on
          // nobody). Linking and unlinking is the STRUCTURE view's toggle
          // between two neighbours (`structure.link`), run-wide (SPEC Supersets
          // [P1.1]).
          inSuperset={(unit?.length ?? 0) > 1}
          showMoveControls={isFirstInUnit}
          structure={fieldsFor ? fieldsFor(pe, idx) : null}
          // Disables ADD SET and ADD WARMUP SETS while either mutation
          // (or a set removal) is in flight for this workout day (found
          // by adversarial review): useAddSet has no optimistic update,
          // so `groups` doesn't reflect a just-added set until the
          // insert round-trips and the query refetches. addSet/removeSet
          // are shared per workout day, not per exercise, so this
          // briefly disables both buttons across every exercise in the
          // day during any single add/remove — a deliberately
          // conservative trade against the more invasive alternative
          // of adding optimistic-update logic to useAddSet itself.
          // (The compact view's minus, whose stale closure first
          // needed this, went with COMPACT in chunk 29.)
          addOrRemovePending={addSet.isPending || removeSet.isPending || addWarmup.isPending}
          onAddSet={() => handleAddSet(pe)}
          onAddWarmup={() => handleAddWarmup(pe)}
          onAddStage={(group) => handleAddStage(pe, group, groups)}
          onRemoveSet={(id) => handleRemoveSet(id, pe, groups)}
          onUpdateSet={(id, changes) => handleUpdateSet(id, changes, pe, groups)}
          onApplyTagToAll={(tag) => handleApplyTagToAll(groups, tag)}
          onSwap={() => setSwapTarget(pe)}
          onRemoveExercise={() => setConfirmRemoveExercise({ id: pe.id, name: pe.exercise?.name ?? 'this exercise' })}
          canMoveUp={unitIndex > 0}
          canMoveDown={unitIndex < exerciseUnits.length - 1}
          onMoveUp={() => handleMoveExercise(idx, 'up')}
          onMoveDown={() => handleMoveExercise(idx, 'down')}
        />
      )
    })
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}>
            {headerLabel}
          </span>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', lineHeight: 1.1 }}>
            {workoutDay.name}
          </div>
        </div>

        {/* Deload toggle — only renders if a weekPlan row exists. Chunk 21:
            this marks THAT ONE SESSION (this workout's own plan row for
            this week) — unchanged mechanics (still keyed by weekPlanId
            alone), now with an aria-label saying so explicitly, alongside
            the new week-level action above. Chunk 22: hands the
            screen-resolved `deloadRules` prop through on every call. */}
        {weekPlan && (
          <button
            onClick={() => {
              if (isPast) return
              setDeloadNotice(null)
              toggleDeload.mutate(
                { weekPlanId: weekPlan.id, isDeload: !weekPlan.isDeload, rules: deloadRules },
                {
                  onSuccess: (outcome) => {
                    if (outcome === 'alreadyStarted') {
                      setDeloadNotice('Already started — sets left as they are')
                    }
                  },
                },
              )
            }}
            disabled={isPast}
            aria-label={weekPlan.isDeload ? 'Unmark this session as deload' : 'Mark this session as deload'}
            style={{ height: 26, padding: '0 10px', background: weekPlan.isDeload ? 'var(--accent-muted)' : 'var(--surface-overlay)', border: `1px solid ${weekPlan.isDeload ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: isPast ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: weekPlan.isDeload ? 'var(--accent)' : 'var(--text-dim)', flexShrink: 0 }}
          >
            DELOAD
          </button>
        )}
      </div>

      {/* Shared-row note (chunk 21, reviewer's note 2 / G14) — this
          workout's plan row covers more than one weekday, so the DELOAD
          toggle above marks every one of them, as it already does for
          every other edit on this row (same isShared condition the
          apply-ahead banner below already uses). Shown next to the mark
          itself, not just after it's tapped, so it's known beforehand. */}
      {weekPlan && sharedWeekdays && sharedWeekdays.length > 0 && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', marginTop: -2, marginBottom: 8, lineHeight: 1.5 }}>
          {`Marks ${sharedWeekdays.map((d) => DOW_SHORT_TITLE[d]).join(', ')} — they share one plan.`}
        </p>
      )}

      {/* Chunk 22 (reviewer's note 5) — "say what you did": shown right
          after a mark/unmark the started guard caught. */}
      {deloadNotice && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', marginTop: -2, marginBottom: 8, lineHeight: 1.5 }}>
          {deloadNotice}
        </p>
      )}

      {/* Apply this change to planned weeks ahead (chunk 20) — dismissible,
          never blocking (reviewer's note 4): ignoring it leaves every later
          week untouched, exactly as if it had never appeared. Hidden on a
          past (read-only) week for the same reason no new offer could ever
          arise there — every edit action above is itself hidden then. */}
      {!isPast && (
        <ApplyAheadBanner
          offer={applyAheadOffer.offer}
          outcome={applyAheadOffer.outcome}
          isPending={applyAheadOffer.isPending}
          onApply={applyAheadOffer.apply}
          onDismiss={applyAheadOffer.dismiss}
        />
      )}

      {/* Copy just this workout */}
      {showCopyWorkoutButton && (
        <button
          onClick={() => copyWorkout.mutate({ workoutDayId: workoutDay.id, weekPlanId: weekPlan?.id, sequencePosition: weekPlan?.sequencePosition ?? null })}
          disabled={copyWorkout.isPending}
          style={{ width: '100%', height: 36, marginBottom: 8, background: 'var(--surface)', border: '1px dashed var(--border-strong)', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: copyWorkout.isPending ? 'not-allowed' : 'pointer', opacity: copyWorkout.isPending ? 0.6 : 1 }}
        >
          <Copy size={12} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-secondary)' }}>
            {copyWorkout.isPending ? 'COPYING…' : 'COPY THIS WORKOUT'}
          </span>
        </button>
      )}

      {/* SETS / STRUCTURE (chunk 29) — the switch between the panel's two
          views, directly under the page-level actions above (the DELOAD
          toggle, the apply-ahead banner, COPY THIS WORKOUT), which sit over
          both. A SegmentBar. */}
      <SegmentBar segments={PLAN_VIEWS} active={view} onSelect={onViewChange} marginBottom={8} />

      {/* The workout's warmup routine (chunk 30; SPEC Warmup routine [P1.1]) —
          at the top of the STRUCTURE view, above the exercises, labelled
          "every week": the routine belongs to the workout, not to a week. */}
      {view === 'structure' && <StructureRoutine workoutDayId={workoutDay.id} isPast={isPast} />}

      {/* Exercise card — the same exercises in either view (SETS: each
          exercise's `+` ADD SET and its set rows' numbers; STRUCTURE: each
          exercise's ⋯ and its set rows' kinds, and — chunk 30 — the run-wide
          fields: rest, tempo, unit, grouping, a set's own rest). */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {programExercises.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              NO EXERCISES IN THIS DAY
            </p>
          </div>
        ) : (
          // What differs from the week's source (chunk 31). The gate reads the run's
          // copy's sets only for a week that is compared with it.
          <WeekDiffGate needsRunCopy={diffNeedsRunCopy} runCopyExercises={runCopyExercises} compute={computeDiff}>
            {(diff) =>
              view === 'structure' ? (
                // Every hook the run-wide fields add lives in this one component, so
                // the SETS view calls none of them.
                <StructureFieldsProvider workoutDayId={workoutDay.id} programExercises={programExercises} isPast={isPast}>
                  {(fieldsFor) => renderExercises(fieldsFor, diff)}
                </StructureFieldsProvider>
              ) : (
                renderExercises(null, diff)
              )
            }
          </WeekDiffGate>
        )}
      </div>

      {/* Add exercise to this week (SPEC "Weeks and copying" — "Adding or
          removing an exercise in a week is allowed for both planning
          types"). Hidden once a week plan is past (read-only, same as every
          other edit on this screen) or missing (v2_plan_week always creates
          one the moment the week is shown — chunk 8 — so this is only
          absent during that first instant of loading). Chunk 29: adding and
          removing exercises are Structure (SPEC Plan screen [P1.1]), so this
          is only in the Structure view. */}
      {view === 'structure' && !isPast && weekPlan && (
        <button
          onClick={() => setShowAddExerciseSheet(true)}
          style={{ width: '100%', height: 44, marginTop: 8, background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1.5px' }}
        >
          <Plus size={14} style={{ color: 'var(--accent)' }} />
          ADD EXERCISE
        </button>
      )}

      {/* Swap / add pickers — presentational only; the actual write is this
          panel's own swapExercise/addExercise mutation (weekPlanService.ts). */}
      {swapTarget && (
        <WeekExercisePickerSheet
          title={`SWAP ${swapTarget.exercise?.name ?? 'EXERCISE'}`}
          excludeExerciseIds={programExercises.map((p) => p.exerciseId)}
          onPick={handlePickReplacement}
          onClose={() => setSwapTarget(null)}
        />
      )}
      {showAddExerciseSheet && (
        <WeekExercisePickerSheet
          title="ADD EXERCISE"
          excludeExerciseIds={programExercises.map((p) => p.exerciseId)}
          onPick={handlePickAdd}
          onClose={() => setShowAddExerciseSheet(false)}
        />
      )}

      {/* Remove-from-this-week confirmation — same bottom-sheet pattern as
          the planner's own delete-exercise sheet (WorkoutDayEditorPage.tsx). */}
      {confirmRemoveExercise && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
          onClick={(e) => { if (e.target === e.currentTarget) setConfirmRemoveExercise(null) }}
        >
          <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', border: '1px solid var(--border)', borderBottom: 'none' }}>
            <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
              Remove "{confirmRemoveExercise.name}" from week {weekNumber}?
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
              This deletes its planned sets for this week only. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmRemoveExercise(null)}
                style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', color: 'var(--text-secondary)' }}
              >
                CANCEL
              </button>
              <button
                onClick={handleConfirmRemove}
                disabled={removeExercise.isPending}
                style={{ flex: 1, height: 50, background: 'rgba(248, 113, 113, 0.15)', border: 'none', borderRadius: 10, cursor: removeExercise.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: 'var(--error)' }}
              >
                {removeExercise.isPending ? '…' : 'REMOVE'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Segment bar ──────────────────────────────────────────────────────────────
// The bar chunk 6 built for the WEEKS / PROGRAM tabs (gone in chunk 33): a flex
// row, rounded, with an overflow-hidden border; each segment a mono label filled
// with the accent when active and with the surface otherwise. It stays as the
// SETS / STRUCTURE switch (chunk 29), markup unchanged. An undefined margin is
// left out of the style.
function SegmentBar<T extends string>({
  segments,
  active,
  onSelect,
  marginBottom,
}: {
  segments: { id: T; label: string }[]
  active: T
  onSelect: (id: T) => void
  marginBottom?: number
}) {
  return (
    <div style={{ display: 'flex', borderRadius: 11, overflow: 'hidden', border: '1px solid var(--border)', marginBottom }}>
      {segments.map((segment) => (
        <button
          key={segment.id}
          onClick={() => onSelect(segment.id)}
          style={{ flex: 1, padding: '10px 0', background: active === segment.id ? 'var(--accent)' : 'var(--surface)', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: active === segment.id ? 'var(--base)' : 'var(--text-muted)' }}
        >
          {segment.label}
        </button>
      ))}
    </div>
  )
}

// ─── Exercise Section ─────────────────────────────────────────────────────────

interface ExerciseSectionProps {
  pe: ProgramExercise
  // Chunk 29 — which view the section is drawn for. SETS: the exercise's `+`
  // ADD SET and each set row's numbers (weight, reps, RIR), tags, DELETE SET.
  // STRUCTURE: the exercise's ⋯ (swap, move, add warmup sets, remove) and each
  // set row's kind (a warmup's DELETE, a working set's ADD STAGE / STAGE KIND,
  // a stage's DELETE STAGE). The exercise's name, muscle group and SUPERSET
  // marker head both.
  view: PlanView
  groups: Group<WeekPlanSet>[]
  isPast: boolean
  isLast: boolean
  addOrRemovePending: boolean
  onAddSet: () => void
  onAddStage: (group: Group<WeekPlanSet>) => void
  onRemoveSet: (id: string) => void
  onUpdateSet: (id: string, changes: SetChanges) => void
  // Chunk 19 (SPEC "Tags") — one tag, broadcast to every working head set of
  // THIS exercise in this week (plannerVocabulary.ts's applyTagToAllHeads
  // does the heads-only/no-warmup decision; WorkoutDayPanel's
  // handleApplyTagToAll does the actual writes).
  onApplyTagToAll: (tag: string) => void
  // Chunk 9 — Week actions: swap this exercise, reorder it, or remove it
  // from this week (SPEC "Weeks and copying"). All of them live in the
  // exercise's ⋯ menu (the STRUCTURE view's, since chunk 29), which is hidden
  // whenever isPast is (a past week is read-only).
  onSwap: () => void
  onRemoveExercise: () => void
  // "Add warmup sets" (⋯ menu) — one warmup above the first working set.
  onAddWarmup: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  // Chunk 13 — inSuperset marks every member of a 2+ block (a plain week
  // shows it on nobody, unchanged); showMoveControls hides Move up/down on
  // every member but the block's first, since a reorder here moves the whole
  // unit (PlanPage's own handleMoveExercise). Chunk 30: grouping is edited in
  // the STRUCTURE view (`structure.link`), run-wide.
  inSuperset: boolean
  showMoveControls: boolean
  // Chunk 30 — the run-wide fields (rest, tempo, unit, grouping, a set's own
  // rest), STRUCTURE view only: null in SETS, where the section draws exactly
  // what it did before (StructureFields.tsx).
  structure: StructureExerciseFields | null
  // Chunk 31 — what this exercise differs from its source by (weekDiff.ts). Undefined:
  // nothing is compared, and the section draws exactly what it always did. SETS marks
  // the numbers (weight, reps, RIR) and working sets added or removed; STRUCTURE the
  // exercise (added, moved), warmup sets and stages added or removed, and a set's kind.
  diff?: ExerciseDiff
}

function ExerciseSection({
  pe,
  view,
  groups,
  isPast,
  isLast,
  addOrRemovePending,
  onAddSet,
  onAddStage,
  onRemoveSet,
  onUpdateSet,
  onApplyTagToAll,
  onSwap,
  onRemoveExercise,
  onAddWarmup,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  inSuperset,
  showMoveControls,
  structure,
  diff,
}: ExerciseSectionProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const name = pe.exercise?.name ?? 'this exercise'
  // An exercise that is new this week, or has moved: its header is highlighted, in the
  // STRUCTURE view only (exercises and their order are that view's fields).
  const mark = view === 'structure' && diff ? (diff.added ? 'added' : diff.moved ? 'moved' : null) : null
  // The rows the source has and the week doesn't, drawn after the week's own: a working
  // set in SETS, a warmup set in STRUCTURE (stages are drawn under their set).
  const removedHeads = (diff?.removedHeads ?? []).filter((r) => (view === 'sets' ? !r.isWarmup : r.isWarmup))
  // Every menu action closes the menu: it was opened for one action.
  const act = (fn: () => void) => () => {
    setMenuOpen(false)
    fn()
  }
  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)' }}>
      {/* Exercise header row */}
      <div data-diff={mark ?? undefined} style={{ padding: '12px 16px 6px', display: 'flex', alignItems: 'center', gap: 10, ...(mark ? CHANGED_BAND : {}) }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: mark ? 'var(--accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pe.exercise?.name ?? '—'}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 2 }}>
            {pe.exercise?.muscleGroup?.toUpperCase()}
            {inSuperset && (
              <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· SUPERSET</span>
            )}
          </div>
          {/* The run-wide fields that are set (chunk 30): STRUCTURE only, and
              nothing at all on an exercise that has none. */}
          {structure && <ExerciseMarkers markers={structure.markers} />}
        </div>
        {!isPast && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {/* SETS: the number of sets is this view's, so ADD SET's `+` is
                here (a set is removed from its own row's ⋯). STRUCTURE: the
                exercise's ⋯ (swap, order, warmups, remove) is that view's. */}
            {view === 'sets' ? (
              <button
                onClick={onAddSet}
                disabled={addOrRemovePending}
                aria-label={`Add set to ${name}`}
                style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-muted)', border: '1px solid var(--accent)', borderRadius: 7, cursor: addOrRemovePending ? 'not-allowed' : 'pointer', color: 'var(--accent)', flexShrink: 0, opacity: addOrRemovePending ? 0.5 : 1 }}
              >
                <Plus size={13} />
              </button>
            ) : (
              <MenuButton open={menuOpen} onClick={() => setMenuOpen((v) => !v)} ariaLabel={`${name} options`} />
            )}
          </div>
        )}
      </div>

      {/* Exercise ⋯ menu (chunk 9's week actions, moved here by the UI rule,
          and into the STRUCTURE view by chunk 29): swap, move up/down, add
          warmup sets, remove from this week. Chunk 30 puts the exercise's
          run-wide fields between the first four and the remove: REST, REST
          AFTER and TEMPO under "EVERY WEEK", then the unit. */}
      {view === 'structure' && !isPast && menuOpen && (
        <div style={MENU_PANEL_STYLE}>
          <MenuAction onClick={act(onSwap)} ariaLabel={`Swap ${name}`}>
            <ArrowLeftRight size={13} />
            SWAP EXERCISE
          </MenuAction>
          {showMoveControls && (
            <>
              <MenuAction onClick={act(onMoveUp)} disabled={!canMoveUp} ariaLabel="Move up">
                <ChevronUp size={13} />
                MOVE UP
              </MenuAction>
              <MenuAction onClick={act(onMoveDown)} disabled={!canMoveDown} ariaLabel="Move down">
                <ChevronDown size={13} />
                MOVE DOWN
              </MenuAction>
            </>
          )}
          <MenuAction onClick={act(onAddWarmup)} disabled={addOrRemovePending} ariaLabel="Add warmup sets">
            <Plus size={13} />
            ADD WARMUP SETS
          </MenuAction>
          {structure && <ExerciseDesignMenu pe={pe} fields={structure} />}
          <MenuAction onClick={act(onRemoveExercise)} danger ariaLabel={`Remove ${name} from this week`}>
            <Trash2 size={13} />
            REMOVE FROM THIS WEEK
          </MenuAction>
        </div>
      )}

      {/* Set groups — one row per head, its stages nested beneath it. The
          SETS view's rows carry the numbers; the STRUCTURE view's carry the
          kind (and the ⋯ that changes it). Both number the heads the same
          way, so "set 2" is the same set in either. */}
      {(groups.length > 0 || removedHeads.length > 0) && (
        <div style={{ paddingBottom: 10 }}>
          {groups.map((group, idx) =>
            view === 'sets' ? (
              <PlanSetGroup
                key={group.head.id}
                group={group}
                displayNumber={idx + 1}
                isPast={isPast}
                weightUnit={pe.weightUnit}
                diff={diff}
                onRemoveHead={() => onRemoveSet(group.head.id)}
                onUpdate={(id, changes) => onUpdateSet(id, changes)}
                onApplyTagToAll={onApplyTagToAll}
              />
            ) : (
              <StructureSetGroup
                key={group.head.id}
                group={group}
                displayNumber={idx + 1}
                exerciseName={name}
                isPast={isPast}
                setFields={structure?.setFields}
                diff={diff}
                onRemoveHead={() => onRemoveSet(group.head.id)}
                onRemoveStage={(id) => onRemoveSet(id)}
                onUpdate={(id, changes) => onUpdateSet(id, changes)}
                onAddStage={() => onAddStage(group)}
              />
            ),
          )}
          {removedHeads.map((removed) =>
            view === 'sets' ? (
              <RemovedSetRow key={`removed:${removed.ordinal}`} removed={removed} weightUnit={pe.weightUnit} />
            ) : (
              <RemovedStructureRow key={`removed:${removed.ordinal}`} removed={removed} />
            ),
          )}
        </div>
      )}

      {/* Superset grouping, run-wide (chunk 30; SPEC Supersets [P1.1]): a linked
          unit's round rests after its last member, and the toggle between this
          exercise and the next — any two neighbours in THIS week's order. Both
          are run-wide controls (the ones the program tab used to hold), labelled
          "every week"; neither is on a past week. */}
      {structure?.blockRest && (
        <div style={{ padding: '0 16px 6px' }}>
          <BlockRestEditor
            blockId={structure.blockRest.blockId}
            rest={structure.blockRest.rest}
            onChange={structure.blockRest.onChange}
            everyWeek
          />
        </div>
      )}
      {structure?.link && (
        <div style={{ padding: '0 16px 10px' }}>
          <SupersetLinkToggle
            linked={structure.link.linked}
            disabled={structure.link.disabled}
            onToggle={structure.link.onToggle}
            suffix={<EveryWeekLabel />}
          />
        </div>
      )}
    </div>
  )
}

// ─── Set Group (SETS view) ────────────────────────────────────────────────────
// One planned set: a head row and its ordered stages nested beneath it
// (TASKS.md §4 item 10). The SETS view's rows carry the numbers: weight, reps
// and RIR, on a head and on each stage (a warmup's have no RIR). What else
// there is to do to a working set — its tags, DELETE SET — is in the set's own
// ⋯ menu (SetRow renders it); a stage row has nothing behind a ⋯ here, since
// its only action (DELETE STAGE) is the STRUCTURE view's. Set kinds — ADD
// STAGE, STAGE KIND, a warmup's DELETE — are StructureSetGroup's, below.

// The nest a head's stages sit in, in either view.
const STAGE_NEST_STYLE: React.CSSProperties = { paddingLeft: 22, borderLeft: '1px dashed var(--border-strong)', marginLeft: 11 }

function PlanSetGroup({
  group,
  displayNumber,
  isPast,
  weightUnit,
  diff,
  onRemoveHead,
  onUpdate,
  onApplyTagToAll,
}: {
  group: Group<WeekPlanSet>
  displayNumber: number
  isPast: boolean
  // Chunk 19 — this exercise's resolved weight unit (ProgramExercise.
  // weightUnit — null means "inherit the global Settings unit", resolved by
  // SetRow's own useWeightDisplay call, same pattern as the gym screen's
  // SetRow.tsx).
  weightUnit: WeightUnit | null | undefined
  // Chunk 31 — what this exercise differs from its source by; the SETS view marks the
  // numbers (weight, reps, RIR) that differ, and a working set that has no counterpart
  // in the shape source (new this week) by its number and its reps, with the rows of its
  // stages' reps. Its weight and RIR are not "new": like every set's they are the numbers
  // source's to say (weekDiff.ts), so they are marked only where last week's set at that
  // position differs or isn't there, and never on week 1. A warmup set's or a stage's own
  // newness is the STRUCTURE view's to mark.
  diff?: ExerciseDiff
  onRemoveHead: () => void
  onUpdate: (id: string, changes: SetChanges) => void
  onApplyTagToAll: (tag: string) => void
}) {
  const { head, stages } = group
  // Chunk 14 — resolved once per group, same rule the workout screen's own
  // SetGroup.tsx uses (a legacy/null kind reads as a dropset): the head's
  // kind marker.
  const stageKind = resolveStageKind(head.stageKind ?? null)
  const headDiff = diff?.sets.get(head.id)
  // A working set the shape source has no set for: new, so its number and its reps (and
  // its stages' reps) are marked. Its weight and RIR are NOT marked for being new: they
  // follow headDiff.weight / .rir (the numbers source's), like every other set's.
  const newSet = !!headDiff?.added && !head.isWarmup
  return (
    <div>
      <SetRow
        displayNumber={displayNumber}
        marks={{ number: newSet, weight: !!headDiff?.weight, reps: newSet || !!headDiff?.reps, rir: !!headDiff?.rir }}
        targetRir={head.targetRir}
        repTarget={columnsToRepTarget({ repMin: head.repMin ?? null, repMax: head.repMax ?? null, isAmrap: head.isAmrap ?? false })}
        targetWeight={head.targetWeight ?? null}
        weightUnit={weightUnit}
        // Heads only (SPEC "Tags" — reviewer's note) — a stage's own SetRow
        // call below never receives this prop at all, which is what SetRow
        // reads to decide "is this a head" for the tags marker and menu
        // (`tags !== undefined`), rather than a second isStage-shaped boolean.
        tags={head.tags ?? null}
        isPast={isPast}
        isWarmup={head.isWarmup}
        // Kind marker: only on a set that HAS a kind — a warmup, or a head
        // with stages (resolved kind). A plain working set shows nothing.
        kindLabel={head.isWarmup ? 'WARMUP' : stages.length > 0 ? STAGE_KIND_LABELS[stageKind] : undefined}
        onUpdate={(changes) => onUpdate(head.id, changes)}
        menu={(close) => (
          <>
            <TagsEditor
              tags={head.tags ?? null}
              disabled={isPast}
              onChange={(next) => onUpdate(head.id, { tags: next })}
              onApplyToAll={onApplyTagToAll}
            />
            {/* A warmup set is deleted in the STRUCTURE view (it is a set kind,
                and warmups are added there too); DELETE SET here is a working
                set's. */}
            {!head.isWarmup && (
              <MenuAction onClick={() => { close(); onRemoveHead() }} danger ariaLabel="Delete set">
                <Trash2 size={13} />
                DELETE SET
              </MenuAction>
            )}
          </>
        )}
      />

      {stages.length > 0 && (
        <div style={STAGE_NEST_STYLE}>
          {stages.map((stage) => {
            const stageDiff = diff?.sets.get(stage.id)
            return (
              <SetRow
                key={stage.id}
                isStage
                marks={{ weight: !!stageDiff?.weight, reps: newSet || !!stageDiff?.reps, rir: !!stageDiff?.rir }}
                targetRir={stage.targetRir}
                repTarget={columnsToRepTarget({ repMin: stage.repMin ?? null, repMax: stage.repMax ?? null, isAmrap: stage.isAmrap ?? false })}
                targetWeight={stage.targetWeight ?? null}
                weightUnit={weightUnit}
                isPast={isPast}
                onUpdate={(changes) => onUpdate(stage.id, changes)}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Set Group (STRUCTURE view) ───────────────────────────────────────────────
// The same set, drawn for its kind rather than its numbers (chunk 29, SPEC Plan
// screen [P1.1]: "set kinds (warmup, staged sets and their stages), including
// adding and removing warmup sets and stages"). A row is the set's number, its
// kind marker where it has a kind, and a ⋯ holding the kind controls:
//   - a working head: ADD STAGE and, once it has stages, the STAGE KIND chips
//     (a staged set; chunk 14, SPEC "Staged sets": dropset, rest-pause,
//     myo-reps, cluster). ADD STAGE just adds a stage row, leaving the head's
//     own stage_kind null (reads as a dropset) until a different chip is
//     tapped;
//   - a warmup head: DELETE SET (a warmup is never staged —
//     v2_program_sets_warmup_check's rule — so it gets no stage controls;
//     warmups are added from the exercise's own ⋯ menu, not per row);
//   - a stage row: DELETE STAGE.
// No numbers here: weight, reps, RIR and tags are the SETS view's.

function StructureSetGroup({
  group,
  displayNumber,
  exerciseName,
  isPast,
  setFields,
  diff,
  onRemoveHead,
  onRemoveStage,
  onUpdate,
  onAddStage,
}: {
  group: Group<WeekPlanSet>
  displayNumber: number
  exerciseName: string
  isPast: boolean
  // Chunk 30 — the run-wide fields of a set (its own REST, a staged head's STAGE
  // REST): present in the STRUCTURE view, where WorkoutDayPanel's provider hands
  // them over. A set that names no program set of its own exercise row gets none
  // (G45), whatever this is.
  setFields?: (set: WeekPlanSet) => StructureSetFields
  // Chunk 31 — what this exercise differs from its source by; the STRUCTURE view marks
  // a warmup set or a stage that is new this week, a warmup or stage the source has and
  // the week doesn't (a dim struck-through row in its place), and — on the set's ⋯ — a
  // set whose kind differs (warmup, staged, and the stage kind). A working set's own
  // newness is the SETS view's.
  diff?: ExerciseDiff
  onRemoveHead: () => void
  onRemoveStage: (id: string) => void
  onUpdate: (id: string, changes: SetChanges) => void
  onAddStage: () => void
}) {
  const { head, stages } = group
  const stageKind = resolveStageKind(head.stageKind ?? null)
  const headFields = setFields ? setFields(head) : null
  const isStaged = stages.length > 0
  const headOf = `set ${displayNumber} for ${exerciseName}`
  const headDiff = diff?.sets.get(head.id)
  // The stages the source's counterpart has and this set hasn't, among this set's own
  // in stage order.
  const removedStages = diff?.removedStages.get(head.id) ?? []
  const stageRows = [
    ...stages.map((stage, stageIdx) => ({ stageIndex: stage.stageIndex, stage, stageIdx, removed: undefined })),
    ...removedStages.map((removed) => ({ stageIndex: removed.stageIndex ?? 0, stage: undefined, stageIdx: -1, removed })),
  ].sort((a, b) => a.stageIndex - b.stageIndex)
  return (
    <div>
      <StructureSetRow
        displayNumber={displayNumber}
        isPast={isPast}
        added={head.isWarmup && !!headDiff?.added}
        kindChanged={!!headDiff?.kind}
        kindLabel={head.isWarmup ? 'WARMUP' : isStaged ? STAGE_KIND_LABELS[stageKind] : undefined}
        restMarkers={setRestMarkers(headFields?.programSet ?? null, isStaged)}
        menu={(close) =>
          head.isWarmup ? (
            <>
              {headFields && <SetRestMenu fields={headFields} of={headOf} />}
              <MenuAction onClick={() => { close(); onRemoveHead() }} danger ariaLabel="Delete set">
                <Trash2 size={13} />
                DELETE SET
              </MenuAction>
            </>
          ) : (
            <>
              {/* The set's own REST, and on a staged head its STAGE REST: run-wide
                  steppers on the set's program set (chunk 30). */}
              {headFields && (
                <SetRestMenu fields={headFields} of={headOf} stageRestDefaultText={isStaged ? stageRestDefaultText(stageKind) : undefined} />
              )}
              <div>
                {isStaged && (
                  <div style={{ paddingBottom: 4 }}>
                    <RatingChips
                      scale={{ values: STAGE_KINDS, labels: STAGE_KIND_LABELS }}
                      value={stageKind}
                      onChange={(kind) => onUpdate(head.id, { stageKind: kind })}
                      label="STAGE KIND"
                    />
                  </div>
                )}
                <MenuAction onClick={onAddStage} ariaLabel="Add stage">
                  <Plus size={13} />
                  ADD STAGE
                </MenuAction>
              </div>
            </>
          )
        }
      />

      {stageRows.length > 0 && (
        <div style={STAGE_NEST_STYLE}>
          {stageRows.map(({ stage, stageIdx, removed }) => {
            if (!stage) return <RemovedStructureRow key={`removed:${removed!.stageIndex}`} removed={removed!} />
            const stageFieldsOf = setFields ? setFields(stage) : null
            return (
              <StructureSetRow
                key={stage.id}
                isStage
                isPast={isPast}
                added={!!diff?.sets.get(stage.id)?.added}
                restMarkers={setRestMarkers(stageFieldsOf?.programSet ?? null, false)}
                menu={(close) => (
                  <>
                    {stageFieldsOf && <SetRestMenu fields={stageFieldsOf} of={`stage ${stageIdx + 1} of ${headOf}`} />}
                    <MenuAction onClick={() => { close(); onRemoveStage(stage.id) }} danger ariaLabel="Delete stage">
                      <Trash2 size={13} />
                      DELETE STAGE
                    </MenuAction>
                  </>
                )}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

// A set's row in the STRUCTURE view: the number (↳ on a stage), then the markers
// under it where the set has any — its kind, and (chunk 30) its own REST or its
// STAGE REST where set — and the ⋯. A past week has no ⋯ (read-only, like the SETS
// view's rows); the spacer keeps the columns where they are.
function StructureSetRow({
  displayNumber,
  isStage = false,
  kindLabel,
  restMarkers,
  isPast,
  added = false,
  kindChanged = false,
  menu,
}: {
  displayNumber?: number
  isStage?: boolean
  kindLabel?: string
  restMarkers?: string[]
  isPast: boolean
  // Chunk 31 — a warmup set or a stage that is new this week: its row is the accent
  // (its number, on the muted band an added exercise's header has).
  added?: boolean
  // Chunk 31 — the set's kind differs from the source's: a dot on the ⋯ (the kind
  // controls are inside it), or, on a past week with no ⋯, on the spacer in its place.
  kindChanged?: boolean
  menu: (close: () => void) => React.ReactNode
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const rowLabel = isStage ? 'stage' : `set ${displayNumber}`
  return (
    <div data-diff={added ? 'added' : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '3px 16px', gap: 6, ...(added ? CHANGED_BAND : {}) }}>
        {/* Set number */}
        <span style={{ width: 22, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, color: added ? 'var(--accent)' : 'var(--text-dim)', flexShrink: 0 }}>
          {isStage ? '↳' : String(displayNumber).padStart(2, '0')}
        </span>
        <div style={{ flex: 1, minWidth: 0 }} />
        {isPast ? (
          <div style={{ width: 28, flexShrink: 0, ...(kindChanged ? { position: 'relative' as const } : {}) }}>{kindChanged && <DiffDot />}</div>
        ) : (
          <MenuButton open={menuOpen} onClick={() => setMenuOpen((v) => !v)} ariaLabel={`Options for ${rowLabel}`} dot={kindChanged} />
        )}
      </div>

      <SetMarkers kindLabel={kindLabel} tags={null} extra={restMarkers} />

      {!isPast && menuOpen && (
        <div style={MENU_PANEL_STYLE}>
          {menu(() => setMenuOpen(false))}
        </div>
      )}
    </div>
  )
}

// The small marker line under a set's row: its kind, and its tags, only where
// it has them (standing UI rule: an unset feature shows nothing). Both views
// draw it the same way. `extra` (chunk 30) is the STRUCTURE view's run-wide
// fields where set, as the same compact chips the tags are.
function SetMarkers({ kindLabel, tags, extra }: { kindLabel?: string; tags: string[] | null; extra?: string[] }) {
  if (!kindLabel && tags === null && !(extra && extra.length > 0)) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '0 16px 4px', paddingLeft: 44 }}>
      {kindLabel && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--accent)' }}>
          {kindLabel}
        </span>
      )}
      {tags?.map((tag) => (
        <MarkerChip key={tag}>{tag}</MarkerChip>
      ))}
      {extra?.map((marker) => (
        <MarkerChip key={marker}>{marker}</MarkerChip>
      ))}
    </div>
  )
}

// ─── Set Row (SETS view) ──────────────────────────────────────────────────────
// A single row: either a head (numbered) or a stage (↳ marker, no number of
// its own — it shares its head's set_number by convention, TASKS.md §2.1).
// By default it shows set number, weight, reps and RIR — nothing else
// (Adam's standing UI rule). A set that has a kind or tags shows them as a
// small marker line under the row; a set without them shows nothing extra.
// The ⋯ opens `menu`, which holds everything else for this set; a row with no
// `menu` (a stage row, in the SETS view) has no ⋯ — a spacer holds its place.

function SetRow({
  displayNumber,
  isStage = false,
  kindLabel,
  targetRir,
  repTarget,
  targetWeight,
  weightUnit,
  tags,
  isPast,
  isWarmup = false,
  marks,
  menu,
  onUpdate,
}: {
  displayNumber?: number
  isStage?: boolean
  // Kind marker text (WARMUP, DROPSET, REST-PAUSE, …), resolved by
  // PlanSetGroup; undefined for a plain working set and for stage rows.
  kindLabel?: string
  targetRir: number | null
  // Chunk 11 (SPEC.md "Removals"; chunk 19 — SPEC.md "Targets": "The week
  // plan can override a set's rep target for that week"). Editable here via
  // RepTargetEditor below, on every row, in its own cell beside the weight.
  repTarget: RepTarget
  // Chunk 19 (SPEC "Targets" — "Weight targets: per set, in the week plan
  // only"). Kg; displayed/entered in `weightUnit`'s resolved unit via
  // WeightTargetEditor below. Heads and stages both.
  targetWeight: number | null
  weightUnit: WeightUnit | null | undefined
  // Chunk 19 (SPEC "Tags") — heads only: PlanSetGroup never passes this (or
  // the tags menu) on a stage row's own SetRow call, so `undefined`
  // here means "this is a stage, no tags marker" — not "a head with zero
  // tags" (that reads as `[]`/`null`).
  tags?: string[] | null
  isPast: boolean
  // A warmup head (PlanSetGroup never passes this on a stage row). Swaps the
  // RIR stepper out: "Mandatory fields never apply to warmup sets" [P2], and
  // RIR is never logged on one in the first place.
  isWarmup?: boolean
  // Chunk 31 — which of the row's values differ from the week's source (weekDiff.ts):
  // the number (a working set new this week), weight, reps, RIR. Each marked one is
  // drawn in the accent; a row with none is what it always was.
  marks?: { number?: boolean; weight?: boolean; reps?: boolean; rir?: boolean }
  // The ⋯ menu's contents; `close` collapses the panel. Omitted on a row with
  // nothing to put behind a ⋯ (an empty ⋯ would be a placeholder), and ignored
  // on a past (read-only) week, which gets no ⋯ at all.
  menu?: (close: () => void) => React.ReactNode
  onUpdate: (changes: SetChanges) => void
}) {
  // Chunk 19 — this exercise's resolved unit (its own override, else the
  // global Settings default), same resolution WeightTargetEditor's gym-
  // screen counterpart (SetRow.tsx) already uses.
  const { unit: resolvedUnit } = useWeightDisplay(weightUnit)
  const [menuOpen, setMenuOpen] = useState(false)
  const activeTags = tags != null && tags.length > 0 ? tags : null
  const rowLabel = isStage ? 'stage' : `set ${displayNumber}`

  return (
    <div data-diff={marks?.number ? 'added' : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '3px 16px', gap: 6 }}>
        {/* Set number */}
        <span style={{ width: 22, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, color: marks?.number ? 'var(--accent)' : 'var(--text-dim)', flexShrink: 0 }}>
          {isStage ? '↳' : String(displayNumber).padStart(2, '0')}
        </span>

        {/* Weight target — entered/shown in the exercise's resolved unit,
            stored kg (chunk 19, SPEC "Targets"). */}
        <WeightTargetEditor
          valueKg={targetWeight}
          unit={resolvedUnit}
          disabled={isPast}
          changed={!!marks?.weight}
          onChange={(kg) => onUpdate({ targetWeight: kg })}
        />

        <span style={{ color: 'var(--text-dim)', fontSize: 11, flexShrink: 0 }}>×</span>

        {/* Rep target — this week's own override (chunk 19), parsed only by
            parseRepTarget. */}
        <RepTargetEditor
          value={repTarget}
          currentTargetRir={targetRir}
          disabled={isPast}
          changed={!!marks?.reps}
          onChange={(columns) => onUpdate(columns)}
        />

        {/* RIR stepper — not for a warmup (SPEC "Warmup sets": nothing but
            weight/reps/rest is ever logged on one, so a target RIR here would
            promise something that can never be fulfilled). */}
        {!isWarmup && (
          <RirStepper
            value={targetRir}
            disabled={isPast}
            changed={!!marks?.rir}
            onChange={(v) => onUpdate({ targetRir: v })}
          />
        )}

        {/* A warmup has no RIR stepper, so a spacer keeps its ⋯ at the right
            edge; on every other row the weight and reps cells take the room. */}
        {isWarmup && <div style={{ flex: 1, minWidth: 0 }} />}

        {isPast || !menu ? (
          <div style={{ width: 28, flexShrink: 0 }} />
        ) : (
          <MenuButton open={menuOpen} onClick={() => setMenuOpen((v) => !v)} ariaLabel={`Options for ${rowLabel}`} />
        )}
      </div>

      {/* Markers — only on a set that has a kind or tags. */}
      <SetMarkers kindLabel={kindLabel} tags={activeTags} />

      {/* ⋯ menu panel */}
      {!isPast && menu && menuOpen && (
        <div style={MENU_PANEL_STYLE}>
          {menu(() => setMenuOpen(false))}
        </div>
      )}
    </div>
  )
}

// ─── Rep Target Editor ────────────────────────────────────────────────────────
// Chunk 19 (SPEC "Targets" — "The week plan can override a set's rep target
// for that week"). Same tap-to-edit/commit-on-blur-or-Enter pattern as
// StepExercises.tsx's own TempoEditor (chunk 17): parsed only by
// parseRepTarget, refused inline with nothing written on invalid input, a
// no-op commit (same value) writes nothing. UI rule (2026-10-10): reps is
// one of the three numbers every set row shows, so it is a visible cell
// like the weight's — not bare text — and a set with no target shows a
// dash in that cell, the one way to type a first target (nothing else in
// the app sets a WEEK's own rep-target override).
// The look shared by the weight and reps cells of a set row (the RIR
// stepper beside them is the same height). They share the row's free width
// equally and shrink before anything wraps, so three numbers always fit one
// line at 375px.
const NUMBER_CELL_STYLE: React.CSSProperties = {
  flex: '1 1 0',
  minWidth: 0,
  maxWidth: 84,
  height: 28,
  padding: '0 6px',
  background: 'var(--surface)',
  border: '1px solid var(--border-strong)',
  borderRadius: 6,
  fontWeight: 800,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

function RepTargetEditor({
  value,
  currentTargetRir,
  disabled,
  changed = false,
  onChange,
}: {
  value: RepTarget
  currentTargetRir: number | null
  disabled: boolean
  // Chunk 31 — the target differs from the week's source: the cell is the accent.
  changed?: boolean
  onChange: (columns: RepTargetColumns & { targetRir?: number }) => void
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
    setText(value.type === 'none' ? '' : formatRepTarget(value))
    setError('')
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    if (trimmed === '') {
      setEditing(false)
      setError('')
      if (value.type !== 'none') onChange({ repMin: null, repMax: null, isAmrap: false })
      return
    }
    const parsed = parseRepTarget(trimmed)
    if (parsed === null) {
      // Refused — stays in edit mode with the raw input still showing, the
      // message right below it; nothing is written (reviewer's note).
      setError('Enter a number, a range like 8-12, or AMRAP')
      return
    }
    setEditing(false)
    setError('')
    if (formatRepTarget(parsed) === formatRepTarget(value)) return // unchanged — nothing to write
    onChange(applyAmrapRirDefault(parsed, currentTargetRir))
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 0', minWidth: 0, maxWidth: 96 }}>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => { setText(e.target.value); if (error) setError('') }}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
          placeholder="8, 8-12, AMRAP"
          aria-label="Rep target"
          style={{ width: '100%', height: 28, background: 'var(--surface)', border: `1px solid ${error ? 'var(--error)' : 'var(--accent)'}`, borderRadius: 6, padding: '0 6px', fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-primary)', boxSizing: 'border-box', outline: 'none' }}
        />
        {error && (
          <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--error)', letterSpacing: '0.5px' }}>
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      disabled={disabled}
      aria-label={value.type === 'none' ? 'Set rep target' : undefined}
      data-diff={changed ? 'changed' : undefined}
      style={{ ...NUMBER_CELL_STYLE, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: value.type === 'none' ? 'var(--text-dim)' : 'var(--text-primary)', ...(changed ? CHANGED_CELL : {}) }}
    >
      {value.type === 'none' ? '—' : formatRepTarget(value)}
    </button>
  )
}

// ─── Weight Target Editor ─────────────────────────────────────────────────────
// Chunk 19 (SPEC "Targets" — "Weight targets: per set, in the week plan
// only... entered and shown in the exercise's resolved unit, stored kg").
// Same tap-to-edit pattern as RepTargetEditor/TempoEditor above. The
// round-trip drift guard (resolveEditedWeightKg) only applies once there's
// an existing kg value to compare the re-displayed figure against; a brand
// new value goes straight through toStorageWeight — same split gym
// SetRow.tsx's own saveEdit already makes for a logged set's weight.
function WeightTargetEditor({
  valueKg,
  unit,
  disabled,
  changed = false,
  onChange,
}: {
  valueKg: number | null
  unit: WeightUnit
  disabled: boolean
  // Chunk 31 — the target differs from the week's source: the cell is the accent.
  changed?: boolean
  onChange: (kg: number | null) => void
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
    setText(valueKg != null ? String(toDisplayWeight(valueKg, unit)) : '')
    setError('')
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    if (trimmed === '') {
      setEditing(false)
      setError('')
      if (valueKg !== null) onChange(null)
      return
    }
    const parsed = parseFloat(trimmed.replace(',', '.'))
    if (Number.isNaN(parsed) || parsed < 0) {
      // Same message/behaviour as gym SetRow.tsx's own saveEdit guard —
      // refused inline, nothing written.
      setError('Enter a valid weight')
      return
    }
    setEditing(false)
    setError('')
    const kg = valueKg === null ? toStorageWeight(parsed, unit) : resolveEditedWeightKg(valueKg, unit, parsed)
    if (kg !== valueKg) onChange(kg)
  }

  if (editing) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 0', minWidth: 0, maxWidth: 96 }}>
        <div style={{ position: 'relative' }}>
          <input
            ref={inputRef}
            type="text"
            inputMode="decimal"
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError('') }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
            placeholder="0"
            aria-label="Weight target"
            style={{ width: '100%', height: 28, background: 'var(--surface)', border: `1px solid ${error ? 'var(--error)' : 'var(--accent)'}`, borderRadius: 6, padding: '0 26px 0 6px', fontSize: 12, fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--text-primary)', boxSizing: 'border-box', outline: 'none' }}
          />
          <span style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
            {unit}
          </span>
        </div>
        {error && (
          <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--error)', letterSpacing: '0.5px' }}>
            {error}
          </span>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      disabled={disabled}
      data-diff={changed ? 'changed' : undefined}
      style={{ ...NUMBER_CELL_STYLE, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-display)', fontSize: 12, color: valueKg === null ? 'var(--text-dim)' : 'var(--text-primary)', ...(changed ? CHANGED_CELL : {}) }}
    >
      {valueKg != null ? `${toDisplayWeight(valueKg, unit)}${unit}` : '—'}
    </button>
  )
}

// ─── Tags Editor ───────────────────────────────────────────────────────────────
// Chunk 19 (SPEC "Tags" — preset list plus custom text, several allowed,
// each removable, "Apply to all sets fills one tag across an exercise's
// sets"). The preset/already-applied-custom chips reuse this app's existing
// toggle-chip look (RatingChips/STAGE KIND, SettingsPage's chipRow) —
// tapping an active chip clears it, same "there is always a way back"
// interaction RatingChips documents, just allowing several actives at once
// instead of one. The custom-text entry reuses TempoEditor's own tap-to-
// edit text pattern. Each active (currently-applied) chip also gets a small
// "apply to all sets" affordance next to it (reusing the Copy icon this
// file already imports for COPY WEEK/COPY THIS WORKOUT) — SPEC names the
// feature as filling ONE tag across the exercise, and this is the one place
// in the UI where a single, unambiguous tag is already in hand to broadcast
// (no separate picker needed to say which).
function TagsEditor({
  tags,
  disabled,
  onChange,
  onApplyToAll,
}: {
  tags: string[] | null
  disabled: boolean
  onChange: (next: string[] | null) => void
  onApplyToAll: (tag: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const current = tags ?? []
  // Every preset, in SPEC's own order, plus any custom tag already on this
  // set (in storage order) that isn't itself a preset string — nothing is
  // ever listed twice.
  const custom = current.filter((t) => !(PRESET_TAGS as readonly string[]).includes(t))
  const chips: string[] = [...PRESET_TAGS, ...custom]

  useEffect(() => {
    if (adding) inputRef.current?.focus()
  }, [adding])

  function toggle(tag: string) {
    if (disabled) return
    if (current.includes(tag)) {
      onChange(removeTag(current, tag))
      return
    }
    const next = addTag(current, tag)
    if (next !== null) onChange(next)
  }

  function commitCustom() {
    const next = addTag(current, text)
    setText('')
    setAdding(false)
    if (next !== null) onChange(next)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
        TAGS
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {chips.map((tag) => {
          const active = current.includes(tag)
          return (
            <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
              <button
                type="button"
                onClick={() => toggle(tag)}
                disabled={disabled}
                style={{ height: 24, padding: '0 8px', background: active ? 'var(--accent-muted)' : 'var(--surface-overlay)', border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.3px', color: active ? 'var(--accent)' : 'var(--text-dim)', whiteSpace: 'nowrap' }}
              >
                {tag}
              </button>
              {active && (
                <button
                  type="button"
                  onClick={() => onApplyToAll(tag)}
                  disabled={disabled}
                  aria-label={`Apply "${tag}" to all sets`}
                  title="Apply to all sets"
                  style={{ width: 20, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer', color: 'var(--text-dim)', flexShrink: 0 }}
                >
                  <Copy size={10} />
                </button>
              )}
            </span>
          )
        })}
        {adding ? (
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commitCustom}
            onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
            placeholder="custom tag"
            aria-label="Custom tag"
            style={{ height: 24, width: 100, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 6, padding: '0 6px', fontSize: 9, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', boxSizing: 'border-box', outline: 'none' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => !disabled && setAdding(true)}
            disabled={disabled}
            style={{ height: 24, padding: '0 8px', background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 6, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: 'var(--text-dim)' }}
          >
            + CUSTOM
          </button>
        )}
      </div>
    </div>
  )
}

// ─── RIR Stepper ──────────────────────────────────────────────────────────────

function RirStepper({
  value,
  disabled,
  changed = false,
  onChange,
}: {
  value: number | null
  disabled: boolean
  // Chunk 31 — the RIR differs from the week's source: the stepper is the accent.
  changed?: boolean
  onChange: (v: number | null) => void
}) {
  return (
    <div data-diff={changed ? 'changed' : undefined} style={{ display: 'inline-flex', alignItems: 'center', height: 28, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 6, flexShrink: 0, ...(changed ? CHANGED_EDGE : {}) }}>
      <button
        disabled={disabled || value === null}
        onClick={() => {
          if (value === null) return
          onChange(value === 0 ? null : value - 1)
        }}
        style={{ width: 22, height: 28, background: 'transparent', border: 'none', color: (disabled || value === null) ? 'var(--text-dim)' : 'var(--text-muted)', cursor: (disabled || value === null) ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        −
      </button>
      <div style={{ minWidth: 46, textAlign: 'center', whiteSpace: 'nowrap' }}>
        {value === null ? (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: changed ? 'var(--accent)' : 'var(--text-dim)' }}>
            NO RIR
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: changed ? 'var(--accent)' : 'var(--text-primary)' }}>
            RIR {value}
          </span>
        )}
      </div>
      <button
        disabled={disabled}
        onClick={() => onChange(value === null ? 3 : Math.min(value + 1, 9))}
        style={{ width: 22, height: 28, background: 'transparent', border: 'none', color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        +
      </button>
    </div>
  )
}
