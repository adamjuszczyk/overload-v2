import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, Minus, Trash2, Copy, Rows3, ArrowLeftRight, CalendarDays, Ellipsis } from 'lucide-react'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import type { WeekPlan, WeekPlanSet, ProgramExercise, DayOfWeek, WorkoutDay, Exercise, WeightUnit } from '../../types'
import { useMesos } from '../programs/useMesos'
import { usePrograms, useWorkoutDays, useProgramExercises, useSequenceItems } from '../programs/usePrograms'
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
import { useSettingsStore } from '../settings/settingsStore'
import RatingChips from '../gym/RatingChips.js'
import WorkoutSwitcher from './WorkoutSwitcher'
import SequenceSlotSwitcher, { type SwitcherSlot } from './SequenceSlotSwitcher'
import CompactPlanRows from './CompactPlanRows'
import ProgramTab from './ProgramTab'
import WeekExercisePickerSheet from './WeekExercisePickerSheet'
import MoveSessionControl from './MoveSessionControl'
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

// Plan screen tabs (chunk 6, SPEC.md "Plan screen" — Program tab + Weeks).
// Same tab-bar shape as CoachPage.tsx's own ANALYSIS/ASK/CONTEXT bar
// (flex row, rounded + overflow-hidden border, accent/surface fill),
// written in this file's own inline-style idiom rather than CoachPage's
// Tailwind classes.
type PlanTab = 'weeks' | 'program'

const PLAN_TABS: { id: PlanTab; label: string }[] = [
  { id: 'weeks', label: 'WEEKS' },
  { id: 'program', label: 'PROGRAM' },
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
export default function PlanPage() {
  const { data: mesos = [] } = useMesos()
  const { data: programs = [] } = usePrograms()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null
  const program = programs.find((p) => p.id === activeMeso?.programId)

  if (activeMeso && (program?.scheduleType ?? 'weekday') === 'sequence') {
    return <SequencePlanPage mesoId={activeMeso.id} programId={activeMeso.programId} />
  }
  return <PlanScreen />
}

// The sequence run's wrapper: finds the current cycle, then renders the same
// screen with it. Until the three reads behind it have answered the cycle is
// unknown, and the loading spinner shows instead of any cycle: marking cycle 1
// current (and editable) on a run that is in cycle 4, until the answer lands,
// would be a wrong cycle on screen. Display-only choice (D31), provisional.
function SequencePlanPage({ mesoId, programId }: { mesoId: string; programId: string }) {
  const cycle = useSequenceCurrentCycle(mesoId, programId)
  if (cycle === null) return <PlanSpinner />
  return <PlanScreen sequenceCycle={cycle} />
}

function PlanSpinner() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--base)' }}>
      <div className="animate-spin" style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
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

  // Compact display mode (TASKS.md §4 item 32) — not in SPEC §11's Settings
  // list, so this is page-local UI state, not a persisted setting: it resets
  // on reload, same as isPast/viewWeek here.
  const [compact, setCompact] = useState(false)

  // Program/Weeks tab (chunk 6) — page-local, resets on reload like compact
  // above; nothing in SPEC says it should persist across visits.
  const [activeTab, setActiveTab] = useState<PlanTab>('weeks')

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
  // this page's own Weeks-tab body (scheduledDays/WorkoutSwitcher/
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
  // as COMPACT above, flipping between the two labels rather than two
  // separate buttons.
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

        {/* Program / Weeks tab bar */}
        <div style={{ display: 'flex', marginTop: 12, borderRadius: 11, overflow: 'hidden', border: '1px solid var(--border)' }}>
          {PLAN_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{ flex: 1, padding: '10px 0', background: activeTab === tab.id ? 'var(--accent)' : 'var(--surface)', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: activeTab === tab.id ? 'var(--base)' : 'var(--text-muted)' }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 32px', minHeight: 0 }}>

        {/* Program tab — the active run's copy: its workouts, each opening
            the existing workout editor on the run's copy (SPEC.md "Plan
            screen"). Volume/design-field editing from this tab is later
            chunks' scope (chunk 6 brief: "the tab can edit it" already,
            through the existing editor this links to — chunk 9 adds the
            per-type rules on top). */}
        {activeTab === 'program' && (
          program
            ? <ProgramTab program={program} mesoId={activeMeso.id} />
            : (
              <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
                <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
              </div>
            )
        )}

        {activeTab === 'weeks' && (
        <>
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
                marginBottom: weekDeloadNotice ? 6 : 16,
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
            {weekDeloadNotice && (
              <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', marginBottom: 16, lineHeight: 1.5 }}>
                {weekDeloadNotice}
              </p>
            )}
          </>
        )}

        {/* Loading */}
        {(plansLoading || daysLoading) && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
            <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
          </div>
        )}

        {/* No scheduled days (weekday only — isSequence has its own parallel
            empty state below, since scheduledDays is always [] for one and
            would otherwise show this same, wrong-for-it message). */}
        {!isSequence && !plansLoading && !daysLoading && scheduledDays.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)', marginBottom: 12 }}>
              NO DAYS SCHEDULED
            </p>
            {/* Chunk 11 — ProgramBuilderPage (the old target, a whole-program
                schedule editor at /program/:id) is gone; schedule assignment
                now lives inline in the Program tab's own StepExercises, so
                this switches tabs instead of navigating away. */}
            <button
              onClick={() => setActiveTab('program')}
              style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)' }}
            >
              Set up weekly schedule →
            </button>
          </div>
        )}

        {/* Chunk 25 review fix — the sequence equivalent of "No scheduled
            days" above: no workout-bearing slot exists yet (an empty
            sequence, or every slot a rest day). */}
        {isSequence && !plansLoading && !daysLoading && !sequenceSlots.some((s) => s.workoutDay) && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)', marginBottom: 12 }}>
              NO SLOTS SCHEDULED
            </p>
            <button
              onClick={() => setActiveTab('program')}
              style={{ background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 13, fontWeight: 600, fontFamily: 'var(--font-sans)' }}
            >
              Set up the sequence →
            </button>
          </div>
        )}

        {/* Workout switcher + the one selected workout's panel */}
        {!isSequence && !plansLoading && !daysLoading && scheduledDays.length > 0 && selected && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => setCompact((c) => !c)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', background: compact ? 'var(--accent-muted)' : 'var(--surface-overlay)', border: `1px solid ${compact ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: compact ? 'var(--accent)' : 'var(--text-dim)' }}
              >
                <Rows3 size={11} />
                COMPACT
              </button>
            </div>

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
              compact={compact}
              canCopyFromHistory={hasManualSourceFor(selected.workoutDay.id)}
              isShared={sharedWorkoutDayIds.has(selected.workoutDay.id)}
              sharedWeekdays={sharedWeekdaysByWorkoutDayId.get(selected.workoutDay.id) ?? null}
              deloadRules={effectiveDeloadRules}
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
              <button
                onClick={() => setCompact((c) => !c)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', background: compact ? 'var(--accent-muted)' : 'var(--surface-overlay)', border: `1px solid ${compact ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: compact ? 'var(--accent)' : 'var(--text-dim)' }}
              >
                <Rows3 size={11} />
                COMPACT
              </button>
            </div>

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
              compact={compact}
              canCopyFromHistory={hasManualSourceFor(selectedSlot.workoutDay!.id, selectedSlot.position)}
              isShared={false}
              sharedWeekdays={null}
              deloadRules={effectiveDeloadRules}
            />
          </>
        )}
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
  compact: boolean
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
}

function WorkoutDayPanel({ headerLabel, workoutDay, weekPlan, isPast, mesoId, weekNumber, compact, canCopyFromHistory, isShared, sharedWeekdays, deloadRules }: PanelProps) {
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
  const { data: fallbackProgramExercises = [] } = useProgramExercises(workoutDay.id)
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
  // 3), week-level REMOVE SET on a head too (the trash icon on a whole
  // set, or compact mode's MINUS) — SPEC names no exception for it either
  // ("offered when a week is edited and later weeks are already planned").
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

      {/* Exercise card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {programExercises.length === 0 ? (
          <div style={{ padding: '20px 16px', textAlign: 'center' }}>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-dim)' }}>
              NO EXERCISES IN THIS DAY
            </p>
          </div>
        ) : (
          programExercises.map((pe, idx) => {
            const exerciseSets = sets.filter((s) => s.programExerciseId === pe.id)
            const groups = groupWeekPlanSets(exerciseSets).sort(
              (a, b) => a.head.setNumber - b.head.setNumber,
            )
            const unitIndex = unitIndexByProgramExerciseId.get(pe.id) ?? idx
            const unit = exerciseUnits[unitIndex]
            const isFirstInUnit = unit?.[0]?.id === pe.id

            return (
              <ExerciseSection
                key={pe.id}
                pe={pe}
                groups={groups}
                isPast={isPast}
                isLast={idx === programExercises.length - 1}
                // Read-only indicator only — grouping itself is edited in
                // the program tab, never here (SPEC "Supersets").
                inSuperset={(unit?.length ?? 0) > 1}
                showMoveControls={isFirstInUnit}
                compact={compact}
                // Disables ADD SET/minus while either mutation is in flight
                // for this workout day (found by adversarial review):
                // useAddSet has no optimistic update, so `groups` — and
                // therefore the minus button's own onRemoveLastSet closure
                // below — doesn't reflect a just-added set until the insert
                // round-trips and the query refetches. A rapid ADD SET then
                // MINUS before that happens targeted groups[groups.length-1]
                // from the stale pre-add render, silently deleting the
                // previous last set instead of the new one. addSet/removeSet
                // are shared per workout day, not per exercise, so this
                // briefly disables both buttons across every exercise in the
                // day during any single add/remove — a deliberately
                // conservative trade against the more invasive alternative
                // of adding optimistic-update logic to useAddSet itself.
                addOrRemovePending={addSet.isPending || removeSet.isPending || addWarmup.isPending}
                onAddSet={() => handleAddSet(pe)}
                onAddWarmup={() => handleAddWarmup(pe)}
                onAddStage={(group) => handleAddStage(pe, group, groups)}
                onRemoveSet={(id) => handleRemoveSet(id, pe, groups)}
                onRemoveLastSet={() => handleRemoveSet(groups[groups.length - 1].head.id, pe, groups)}
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
        )}
      </div>

      {/* Add exercise to this week (SPEC "Weeks and copying" — "Adding or
          removing an exercise in a week is allowed for both planning
          types"). Hidden once a week plan is past (read-only, same as every
          other edit on this screen) or missing (v2_plan_week always creates
          one the moment the week is shown — chunk 8 — so this is only
          absent during that first instant of loading). */}
      {!isPast && weekPlan && (
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

// ─── Row menu (⋯) ─────────────────────────────────────────────────────────────
// Adam's standing UI rule (CONTEXT.md, 2026-10-10): a plan row shows only
// what's used on every visit; everything else lives behind a ⋯ on the row or
// exercise it belongs to. The panel opens inline under its row (the exercise
// card clips overflow, so a floating popover would be cut off at 375px).
function MenuButton({ open, onClick, ariaLabel }: { open: boolean; onClick: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={open}
      style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: open ? 'var(--accent-muted)' : 'transparent', border: 'none', borderRadius: 7, color: open ? 'var(--accent)' : 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
    >
      <Ellipsis size={15} />
    </button>
  )
}

const MENU_PANEL_STYLE: React.CSSProperties = {
  margin: '2px 16px 8px',
  padding: '8px 10px',
  background: 'var(--surface-overlay)',
  border: '1px solid var(--border-strong)',
  borderRadius: 9,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
}

function MenuAction({
  onClick,
  disabled = false,
  ariaLabel,
  danger = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32, padding: 0, background: 'transparent', border: 'none', cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: danger ? 'var(--error)' : disabled ? 'var(--text-dim)' : 'var(--text-secondary)', opacity: disabled ? 0.5 : 1, textAlign: 'left' }}
    >
      {children}
    </button>
  )
}

// ─── Exercise Section ─────────────────────────────────────────────────────────

interface ExerciseSectionProps {
  pe: ProgramExercise
  groups: Group<WeekPlanSet>[]
  isPast: boolean
  isLast: boolean
  compact: boolean
  addOrRemovePending: boolean
  onAddSet: () => void
  onAddStage: (group: Group<WeekPlanSet>) => void
  onRemoveSet: (id: string) => void
  onRemoveLastSet: () => void
  onUpdateSet: (id: string, changes: SetChanges) => void
  // Chunk 19 (SPEC "Tags") — one tag, broadcast to every working head set of
  // THIS exercise in this week (plannerVocabulary.ts's applyTagToAllHeads
  // does the heads-only/no-warmup decision; WorkoutDayPanel's
  // handleApplyTagToAll does the actual writes).
  onApplyTagToAll: (tag: string) => void
  // Chunk 9 — Week actions: swap this exercise, reorder it, or remove it
  // from this week (SPEC "Weeks and copying"). All of them live in the
  // exercise's ⋯ menu, which is hidden whenever isPast is (a past week is
  // read-only).
  onSwap: () => void
  onRemoveExercise: () => void
  // "Add warmup sets" (⋯ menu) — one warmup above the first working set.
  onAddWarmup: () => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  // Chunk 13 — read-only here: grouping itself is only ever edited in the
  // program tab (SPEC "Supersets"). inSuperset marks every member of a 2+
  // block (a plain week shows it on nobody, unchanged); showMoveControls
  // hides Move up/down on every member but the block's first, since a
  // reorder here moves the whole unit (PlanPage's own handleMoveExercise).
  inSuperset: boolean
  showMoveControls: boolean
}

function ExerciseSection({
  pe,
  groups,
  isPast,
  isLast,
  compact,
  addOrRemovePending,
  onAddSet,
  onAddStage,
  onRemoveSet,
  onRemoveLastSet,
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
}: ExerciseSectionProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const name = pe.exercise?.name ?? 'this exercise'
  // Every menu action closes the menu: it was opened for one action.
  const act = (fn: () => void) => () => {
    setMenuOpen(false)
    fn()
  }
  return (
    <div style={{ borderBottom: isLast ? 'none' : '1px solid var(--border-subtle)' }}>
      {/* Exercise header row */}
      <div style={{ padding: '12px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {pe.exercise?.name ?? '—'}
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginTop: 2 }}>
            {pe.exercise?.muscleGroup?.toUpperCase()}
            {inSuperset && (
              <span style={{ marginLeft: 8, color: 'var(--accent)' }}>· SUPERSET</span>
            )}
          </div>
        </div>
        {!isPast && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {/* Compact mode has no per-row delete (it's a read-only glance
                view), so ADD SET's plus had no symmetric way to reduce the
                count without switching to expanded mode (post-launch fix,
                2026-08-10). Expanded mode already offers precise per-row
                delete via the set's ⋯ menu, so this stays compact-only
                rather than duplicating that control. */}
            {compact && groups.length > 0 && (
              <button
                onClick={onRemoveLastSet}
                disabled={addOrRemovePending}
                aria-label="Remove last set"
                style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 7, cursor: addOrRemovePending ? 'not-allowed' : 'pointer', color: 'var(--text-dim)', flexShrink: 0, opacity: addOrRemovePending ? 0.5 : 1 }}
              >
                <Minus size={13} />
              </button>
            )}
            <button
              onClick={onAddSet}
              disabled={addOrRemovePending}
              aria-label={`Add set to ${name}`}
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-muted)', border: '1px solid var(--accent)', borderRadius: 7, cursor: addOrRemovePending ? 'not-allowed' : 'pointer', color: 'var(--accent)', flexShrink: 0, opacity: addOrRemovePending ? 0.5 : 1 }}
            >
              <Plus size={13} />
            </button>
            <MenuButton open={menuOpen} onClick={() => setMenuOpen((v) => !v)} ariaLabel={`${name} options`} />
          </div>
        )}
      </div>

      {/* Exercise ⋯ menu (chunk 9's week actions, moved here by the UI rule):
          swap, move up/down, add warmup sets, remove from this week. */}
      {!isPast && menuOpen && (
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
          <MenuAction onClick={act(onRemoveExercise)} danger ariaLabel={`Remove ${name} from this week`}>
            <Trash2 size={13} />
            REMOVE FROM THIS WEEK
          </MenuAction>
        </div>
      )}

      {/* Set groups — one row per head, its stages nested beneath it.
          Compact mode swaps this for CompactPlanRows' collapsed summary;
          it's a read-only glance view, so editing needs expanded mode. */}
      {groups.length > 0 && (
        compact ? (
          <CompactPlanRows groups={groups} />
        ) : (
          <div style={{ paddingBottom: 10 }}>
            {groups.map((group, idx) => (
              <PlanSetGroup
                key={group.head.id}
                group={group}
                displayNumber={idx + 1}
                isPast={isPast}
                weightUnit={pe.weightUnit}
                onRemoveHead={() => onRemoveSet(group.head.id)}
                onRemoveStage={(id) => onRemoveSet(id)}
                onUpdate={(id, changes) => onUpdateSet(id, changes)}
                onAddStage={() => onAddStage(group)}
                onApplyTagToAll={onApplyTagToAll}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ─── Set Group ────────────────────────────────────────────────────────────────
// One planned set: a head row and its ordered stages nested beneath it
// (TASKS.md §4 item 10). Everything beyond weight/reps/RIR — set kind and its
// stages, tags, delete — is in the set's own ⋯ menu (SetRow renders it);
// see weekPlanService.ts's addStage() for the write path ADD STAGE feeds.

function PlanSetGroup({
  group,
  displayNumber,
  isPast,
  weightUnit,
  onRemoveHead,
  onRemoveStage,
  onUpdate,
  onAddStage,
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
  onRemoveHead: () => void
  onRemoveStage: (id: string) => void
  onUpdate: (id: string, changes: SetChanges) => void
  onAddStage: () => void
  onApplyTagToAll: (tag: string) => void
}) {
  const { head, stages } = group
  // Chunk 14 — resolved once per group, same rule the workout screen's own
  // SetGroup.tsx uses (a legacy/null kind reads as a dropset): the head's
  // kind marker, and the STAGE KIND chips' selected value in its menu.
  const stageKind = resolveStageKind(head.stageKind ?? null)
  return (
    <div>
      <SetRow
        displayNumber={displayNumber}
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
            {/* Set kind. Staged = a head with stages (chunk 14, SPEC "Staged
                sets": dropset, rest-pause, myo-reps, cluster). ADD STAGE just
                adds a stage row, leaving the head's own stage_kind null
                (reads as a dropset) until a different chip is tapped. A
                warmup is never staged (v2_program_sets_warmup_check's rule),
                so it gets no stage controls; warmups are added from the
                exercise's own ⋯ menu, not per row. */}
            {!head.isWarmup && (
              <div>
                {stages.length > 0 && (
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
            )}
            <TagsEditor
              tags={head.tags ?? null}
              disabled={isPast}
              onChange={(next) => onUpdate(head.id, { tags: next })}
              onApplyToAll={onApplyTagToAll}
            />
            <MenuAction onClick={() => { close(); onRemoveHead() }} danger ariaLabel="Delete set">
              <Trash2 size={13} />
              DELETE SET
            </MenuAction>
          </>
        )}
      />

      {stages.length > 0 && (
        <div style={{ paddingLeft: 22, borderLeft: '1px dashed var(--border-strong)', marginLeft: 11 }}>
          {stages.map((stage) => (
            <SetRow
              key={stage.id}
              isStage
              targetRir={stage.targetRir}
              repTarget={columnsToRepTarget({ repMin: stage.repMin ?? null, repMax: stage.repMax ?? null, isAmrap: stage.isAmrap ?? false })}
              targetWeight={stage.targetWeight ?? null}
              weightUnit={weightUnit}
              isPast={isPast}
              onUpdate={(changes) => onUpdate(stage.id, changes)}
              menu={(close) => (
                <MenuAction onClick={() => { close(); onRemoveStage(stage.id) }} danger ariaLabel="Delete stage">
                  <Trash2 size={13} />
                  DELETE STAGE
                </MenuAction>
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Set Row ──────────────────────────────────────────────────────────────────
// A single row: either a head (numbered) or a stage (↳ marker, no number of
// its own — it shares its head's set_number by convention, TASKS.md §2.1).
// By default it shows set number, weight, reps and RIR — nothing else
// (Adam's standing UI rule). A set that has a kind or tags shows them as a
// small marker line under the row; a set without them shows nothing extra.
// The ⋯ opens `menu`, which holds everything else for this set.

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
  // The ⋯ menu's contents; `close` collapses the panel. Omitted/ignored on a
  // past (read-only) week, which gets no ⋯ at all.
  menu: (close: () => void) => React.ReactNode
  onUpdate: (changes: SetChanges) => void
}) {
  // Chunk 19 — this exercise's resolved unit (its own override, else the
  // global Settings default), same resolution WeightTargetEditor's gym-
  // screen counterpart (SetRow.tsx) already uses.
  const { unit: resolvedUnit } = useWeightDisplay(weightUnit)
  const [menuOpen, setMenuOpen] = useState(false)
  const activeTags = tags != null && tags.length > 0 ? tags : null
  const hasMarkers = Boolean(kindLabel) || activeTags !== null
  const rowLabel = isStage ? 'stage' : `set ${displayNumber}`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', padding: '3px 16px', gap: 6 }}>
        {/* Set number */}
        <span style={{ width: 22, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, color: 'var(--text-dim)', flexShrink: 0 }}>
          {isStage ? '↳' : String(displayNumber).padStart(2, '0')}
        </span>

        {/* Weight target — entered/shown in the exercise's resolved unit,
            stored kg (chunk 19, SPEC "Targets"). */}
        <WeightTargetEditor
          valueKg={targetWeight}
          unit={resolvedUnit}
          disabled={isPast}
          onChange={(kg) => onUpdate({ targetWeight: kg })}
        />

        <span style={{ color: 'var(--text-dim)', fontSize: 11, flexShrink: 0 }}>×</span>

        {/* Rep target — this week's own override (chunk 19), parsed only by
            parseRepTarget. */}
        <RepTargetEditor
          value={repTarget}
          currentTargetRir={targetRir}
          disabled={isPast}
          onChange={(columns) => onUpdate(columns)}
        />

        {/* RIR stepper — not for a warmup (SPEC "Warmup sets": nothing but
            weight/reps/rest is ever logged on one, so a target RIR here would
            promise something that can never be fulfilled). */}
        {!isWarmup && (
          <RirStepper
            value={targetRir}
            disabled={isPast}
            onChange={(v) => onUpdate({ targetRir: v })}
          />
        )}

        {/* A warmup has no RIR stepper, so a spacer keeps its ⋯ at the right
            edge; on every other row the weight and reps cells take the room. */}
        {isWarmup && <div style={{ flex: 1, minWidth: 0 }} />}

        {isPast ? (
          <div style={{ width: 28, flexShrink: 0 }} />
        ) : (
          <MenuButton open={menuOpen} onClick={() => setMenuOpen((v) => !v)} ariaLabel={`Options for ${rowLabel}`} />
        )}
      </div>

      {/* Markers — only on a set that has a kind or tags. */}
      {hasMarkers && (
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 5, padding: '0 16px 4px', paddingLeft: 44 }}>
          {kindLabel && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--accent)' }}>
              {kindLabel}
            </span>
          )}
          {activeTags?.map((tag) => (
            <span
              key={tag}
              style={{ padding: '0 6px', height: 16, display: 'inline-flex', alignItems: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 5, fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ⋯ menu panel */}
      {!isPast && menuOpen && (
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
  onChange,
}: {
  value: RepTarget
  currentTargetRir: number | null
  disabled: boolean
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
      style={{ ...NUMBER_CELL_STYLE, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: value.type === 'none' ? 'var(--text-dim)' : 'var(--text-primary)' }}
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
  onChange,
}: {
  valueKg: number | null
  unit: WeightUnit
  disabled: boolean
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
      style={{ ...NUMBER_CELL_STYLE, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-display)', fontSize: 12, color: valueKg === null ? 'var(--text-dim)' : 'var(--text-primary)' }}
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
  onChange,
}: {
  value: number | null
  disabled: boolean
  onChange: (v: number | null) => void
}) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', height: 28, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 6, flexShrink: 0 }}>
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
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: 'var(--text-dim)' }}>
            NO RIR
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 12, color: 'var(--text-primary)' }}>
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
