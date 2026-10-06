import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Plus, Minus, Trash2, Copy, Rows3, ArrowLeftRight } from 'lucide-react'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import type { WeekPlan, WeekPlanSet, ProgramExercise, DayOfWeek, WorkoutDay, Exercise } from '../../types'
import { useMesos } from '../programs/useMesos'
import { usePrograms, useWorkoutDays, useProgramExercises } from '../programs/usePrograms'
import {
  useWeekPlans,
  useAllWeekPlans,
  useSetDeload,
  useAddSet,
  useAddStage,
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
import {
  columnsToRepTarget,
  formatRepTarget,
  type RepTarget,
  STAGE_KINDS,
  STAGE_KIND_LABELS,
  resolveStageKind,
  type StageKind,
} from '../../lib/plannerVocabulary.js'
import RatingChips from '../gym/RatingChips.js'
import WorkoutSwitcher from './WorkoutSwitcher'
import CompactPlanRows from './CompactPlanRows'
import ProgramTab from './ProgramTab'
import WeekExercisePickerSheet from './WeekExercisePickerSheet'

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS_ORDER: DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

const DOW_LABEL: Record<DayOfWeek, string> = {
  monday: 'MONDAY', tuesday: 'TUESDAY', wednesday: 'WEDNESDAY',
  thursday: 'THURSDAY', friday: 'FRIDAY', saturday: 'SATURDAY', sunday: 'SUNDAY',
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const navigate = useNavigate()
  const { data: mesos = [], isLoading: mesosLoading } = useMesos()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null

  const currentWeek = activeMeso ? computeWeekNumber(activeMeso.startDate) : 1
  const [viewWeek, setViewWeek] = useState(1)

  // Workout switcher (TASKS.md §4 item 30) — which single workout day is
  // showing. No effect needed to keep it valid: `selected` below always
  // falls back to the first scheduled day if this points at a dow that
  // isn't scheduled (e.g. after switching meso/program).
  const [selectedDow, setSelectedDow] = useState<DayOfWeek | null>(null)

  // Compact display mode (TASKS.md §4 item 32) — not in SPEC §11's Settings
  // list, so this is page-local UI state, not a persisted setting: it resets
  // on reload, same as isPast/viewWeek here.
  const [compact, setCompact] = useState(false)

  // "Only this week" (chunk 9, SPEC.md "Weeks and copying" — "a tick on
  // swap and reorder actions... off by default"). Page-local, resets on
  // reload like compact/isPast/viewWeek above; nothing says it should
  // persist, and it only ever governs the NEXT swap/reorder tap.
  const [onlyThisWeek, setOnlyThisWeek] = useState(false)

  // Program/Weeks tab (chunk 6) — page-local, resets on reload like compact
  // above; nothing in SPEC says it should persist across visits.
  const [activeTab, setActiveTab] = useState<PlanTab>('weeks')

  useEffect(() => {
    if (activeMeso) setViewWeek(computeWeekNumber(activeMeso.startDate))
  }, [activeMeso?.id])

  const isPast = viewWeek < currentWeek

  const { data: programs = [] } = usePrograms()
  const program = programs.find((p) => p.id === activeMeso?.programId)

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

  // Chunk 8 — this one workout's own planned history (any week number),
  // the shape resolveManualCopySource needs. isEmpty (DECISIONS 42 (b)) is
  // zero v2_week_plan_sets rows — wp.sets is exactly that: useAllWeekPlans
  // (fetchAllWeekPlansForMeso) embeds v2_week_plan_sets(*) in full for
  // every week plan in the meso, the same query this page already reads
  // allWeekPlans from for the history above, so every prior week's own set
  // rows are already here — no extra fetch needed, and never derived from
  // the exercise list (a week can carry exercises with no sets under them).
  function historyFor(workoutDayId: string): PlannedWeekRecord[] {
    return allWeekPlans
      .filter((wp) => wp.workoutDayId === workoutDayId)
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
  function hasManualSourceFor(workoutDayId: string): boolean {
    if (program?.planningType === 'stable') return false
    return resolveManualCopySource(historyFor(workoutDayId), viewWeek).kind === 'week'
  }

  // Empty-state "Copy last week" (SPEC "Plan screen"/"Weeks and copying") —
  // every scheduled workout already has its own (possibly empty)
  // v2_week_plans row by the time this renders (the effect above), so
  // "nothing planned yet" now reads as "every row exists but carries no
  // exercises" rather than "no rows at all".
  const showCopyButton =
    !isPast &&
    viewWeek > 1 &&
    !plansLoading &&
    !daysLoading &&
    weekPlans.length > 0 &&
    weekPlans.every((wp) => wp.exercises.length === 0) &&
    scheduledDays.some((d) => hasManualSourceFor(d.workoutDay.id))

  // ── No active meso ────────────────────────────────────────────────────────

  if (mesosLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: 'var(--base)' }}>
        <div className="animate-spin" style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
      </div>
    )
  }

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
              program', leading to the planner"): the programs page (/program,
              unchanged this chunk) is where a program is picked or created —
              "+" there now opens the new planner (PlannerPage, /program/:id)
              instead of the old builder. */}
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
                WEEK {viewWeek}
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
            ? <ProgramTab program={program} />
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
              {copyPrev.isPending ? 'COPYING…' : 'COPY WEEK'}
            </span>
          </button>
        )}

        {/* Loading */}
        {(plansLoading || daysLoading) && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
            <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
          </div>
        )}

        {/* No scheduled days */}
        {!plansLoading && !daysLoading && scheduledDays.length === 0 && (
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

        {/* Workout switcher + the one selected workout's panel */}
        {!plansLoading && !daysLoading && scheduledDays.length > 0 && selected && (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 8 }}>
              {/* "Only this week" (SPEC "Weeks and copying") — week-dependent
                  only (DECISIONS 48 (a): stable's every edit is already a
                  one-off, no tick needed); governs the NEXT swap/reorder tap
                  below. Same toggle-pill pattern as COMPACT, to its left. */}
              {!isPast && (program?.planningType ?? 'week_dependent') !== 'stable' && (
                <button
                  onClick={() => setOnlyThisWeek((v) => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', background: onlyThisWeek ? 'var(--accent-muted)' : 'var(--surface-overlay)', border: `1px solid ${onlyThisWeek ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: onlyThisWeek ? 'var(--accent)' : 'var(--text-dim)' }}
                >
                  ONLY THIS WEEK
                </button>
              )}
              <button
                onClick={() => setCompact((c) => !c)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', background: compact ? 'var(--accent-muted)' : 'var(--surface-overlay)', border: `1px solid ${compact ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: compact ? 'var(--accent)' : 'var(--text-dim)' }}
              >
                <Rows3 size={11} />
                COMPACT
              </button>
            </div>

            <WorkoutSwitcher days={scheduledDays} selectedDow={selected.dow} onSelect={setSelectedDow} />

            <WorkoutDayPanel
              key={selected.workoutDay.id}
              dow={selected.dow}
              workoutDay={selected.workoutDay}
              weekPlan={weekPlans.find((wp) => wp.workoutDayId === selected.workoutDay.id)}
              isPast={isPast}
              mesoId={activeMeso.id}
              weekNumber={viewWeek}
              compact={compact}
              canCopyFromHistory={hasManualSourceFor(selected.workoutDay.id)}
              onlyThisWeek={onlyThisWeek}
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
  dow: DayOfWeek
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
  // Chunk 9 — SPEC "Weeks and copying": a tick on swap/reorder, off by
  // default, governing the NEXT one of either action (computed once by the
  // parent, which alone owns the toggle's state).
  onlyThisWeek: boolean
}

function WorkoutDayPanel({ dow, workoutDay, weekPlan, isPast, mesoId, weekNumber, compact, canCopyFromHistory, onlyThisWeek }: PanelProps) {
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
  const removeSet = useRemoveSet(mesoId, weekNumber)
  const updateSet = useUpdateSet(mesoId, weekNumber)
  const toggleDeload = useSetDeload(mesoId, weekNumber)
  const copyWorkout = useCopyWorkoutFromPreviousWeek(mesoId, weekNumber)

  // Chunk 9 — swap/reorder/add/remove an exercise in THIS week.
  const swapExercise = useSwapWeekExercise(mesoId, weekNumber)
  const addExercise = useAddWeekExercise(mesoId, weekNumber)
  const removeExercise = useRemoveWeekExercise(mesoId, weekNumber)
  const reorderExercises = useReorderWeekExercises(mesoId, weekNumber)

  // Which sheet (if any) is open: swapping a specific slot, or adding a new
  // one. Exclusive — only one picker at a time, same as GymSession's own
  // showAddExerciseSheet/swap state never overlapping.
  const [swapTarget, setSwapTarget] = useState<ProgramExercise | null>(null)
  const [showAddExerciseSheet, setShowAddExerciseSheet] = useState(false)
  const [confirmRemoveExercise, setConfirmRemoveExercise] = useState<{ id: string; name: string } | null>(null)

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
  }

  function handleAddStage(pe: ProgramExercise, group: Group<WeekPlanSet>) {
    if (!weekPlan) return
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
  }

  // Chunk 9 — Week actions: swap, reorder, add, remove (weekEdits.ts's
  // carry semantics, applied by weekPlanService.ts).
  function handlePickReplacement(exercise: Exercise) {
    if (!weekPlan || !swapTarget) return
    swapExercise.mutate({
      weekPlanId: weekPlan.id,
      programExerciseId: swapTarget.id,
      replacementExerciseId: exercise.id,
      onlyThisWeek,
    })
    setSwapTarget(null)
  }

  function handlePickAdd(exercise: Exercise) {
    if (!weekPlan) return
    addExercise.mutate({
      weekPlanId: weekPlan.id,
      workoutDayId: workoutDay.id,
      exerciseId: exercise.id,
      position: programExercises.length,
    })
    setShowAddExerciseSheet(false)
  }

  function handleConfirmRemove() {
    if (!weekPlan || !confirmRemoveExercise) return
    removeExercise.mutate({ weekPlanId: weekPlan.id, programExerciseId: confirmRemoveExercise.id })
    setConfirmRemoveExercise(null)
  }

  // Block-aware reorder (chunk 13 — SPEC.md "Supersets": "Every reorder
  // (program, week plan, session) moves a superset as one block"). With no
  // grouping at all (every unit size 1 — every week before this chunk),
  // moveUnit degrades to exactly the old adjacent-swap behaviour, so this
  // still sends exactly the two affected rows' own pre-move positions (in
  // their ORIGINAL order) to weekEdits.ts's resolveReorderCarry (inside
  // reorderWeekExercises), byte-identical to before for that case. A
  // block's every member gets its own move in the same call, each carrying
  // its own true oldPosition.
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
    reorderExercises.mutate({ weekPlanId: weekPlan.id, moves, onlyThisWeek })
  }

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Panel header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '2px', color: 'var(--text-muted)' }}>
            {DOW_LABEL[dow]}
          </span>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, color: 'var(--text-primary)', lineHeight: 1.1 }}>
            {workoutDay.name}
          </div>
        </div>

        {/* Deload toggle — only renders if a weekPlan row exists */}
        {weekPlan && (
          <button
            onClick={() => !isPast && toggleDeload.mutate({ weekPlanId: weekPlan.id, isDeload: !weekPlan.isDeload })}
            disabled={isPast}
            style={{ height: 26, padding: '0 10px', background: weekPlan.isDeload ? 'var(--accent-muted)' : 'var(--surface-overlay)', border: `1px solid ${weekPlan.isDeload ? 'var(--accent)' : 'var(--border-strong)'}`, borderRadius: 6, cursor: isPast ? 'default' : 'pointer', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: weekPlan.isDeload ? 'var(--accent)' : 'var(--text-dim)', flexShrink: 0 }}
          >
            DELOAD
          </button>
        )}
      </div>

      {/* Copy just this workout */}
      {showCopyWorkoutButton && (
        <button
          onClick={() => copyWorkout.mutate({ workoutDayId: workoutDay.id, weekPlanId: weekPlan?.id })}
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
                addOrRemovePending={addSet.isPending || removeSet.isPending}
                onAddSet={() => handleAddSet(pe)}
                onAddStage={(group) => handleAddStage(pe, group)}
                onRemoveSet={(id) => removeSet.mutate(id)}
                onRemoveLastSet={() => removeSet.mutate(groups[groups.length - 1].head.id)}
                onUpdateSet={(id, changes) => updateSet.mutate({ id, changes })}
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
  onUpdateSet: (id: string, changes: { targetRir?: number | null; stageKind?: StageKind | null }) => void
  // Chunk 9 — Week actions: swap this exercise, reorder it, or remove it
  // from this week (SPEC "Weeks and copying"). Hidden whenever the other
  // per-row controls above are (isPast — a past week is read-only).
  onSwap: () => void
  onRemoveExercise: () => void
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
  onSwap,
  onRemoveExercise,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  inSuperset,
  showMoveControls,
}: ExerciseSectionProps) {
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
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            {/* Compact mode has no per-row delete (it's a read-only glance
                view), so ADD SET's plus had no symmetric way to reduce the
                count without switching to expanded mode (post-launch fix,
                2026-08-10). Expanded mode already offers precise per-row
                delete via PlanSetGroup's trash icon, so this stays
                compact-only rather than duplicating that control. */}
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
              style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-muted)', border: '1px solid var(--accent)', borderRadius: 7, cursor: addOrRemovePending ? 'not-allowed' : 'pointer', color: 'var(--accent)', flexShrink: 0, opacity: addOrRemovePending ? 0.5 : 1 }}
            >
              <Plus size={13} />
            </button>
          </div>
        )}
      </div>

      {/* Week actions row (chunk 9) — swap, reorder, remove. Its own row,
          below the header: cramming four more icon buttons beside ADD
          SET/MINUS at 375px would overflow, and these are exercise-level
          actions (not per-set), so a visually separate row reads clearer. */}
      {!isPast && (
        <div style={{ padding: '0 16px 8px', display: 'flex', gap: 6 }}>
          <button
            onClick={onSwap}
            aria-label={`Swap ${pe.exercise?.name ?? 'this exercise'}`}
            style={{ height: 26, padding: '0 9px', display: 'flex', alignItems: 'center', gap: 5, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: 'pointer', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px' }}
          >
            <ArrowLeftRight size={11} />
            SWAP
          </button>
          {showMoveControls && (
            <>
              <IconBtn onClick={onMoveUp} disabled={!canMoveUp} ariaLabel="Move up"><ChevronUp size={13} /></IconBtn>
              <IconBtn onClick={onMoveDown} disabled={!canMoveDown} ariaLabel="Move down"><ChevronDown size={13} /></IconBtn>
            </>
          )}
          <IconBtn onClick={onRemoveExercise} ariaLabel={`Remove ${pe.exercise?.name ?? 'this exercise'} from this week`}><Trash2 size={12} /></IconBtn>
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
                onRemoveHead={() => onRemoveSet(group.head.id)}
                onRemoveStage={(id) => onRemoveSet(id)}
                onUpdate={(id, changes) => onUpdateSet(id, changes)}
                onAddStage={() => onAddStage(group)}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}

// ─── Set Group ────────────────────────────────────────────────────────────────
// One planned set: a head row, its ordered stages nested beneath it, and an
// ADD STAGE affordance tied directly to that head (TASKS.md §4 item 10) —
// replaces the old DROP toggle, which could only ever flag the row being
// edited. See weekPlanService.ts's addStage() for the write path this feeds.

function PlanSetGroup({
  group,
  displayNumber,
  isPast,
  onRemoveHead,
  onRemoveStage,
  onUpdate,
  onAddStage,
}: {
  group: Group<WeekPlanSet>
  displayNumber: number
  isPast: boolean
  onRemoveHead: () => void
  onRemoveStage: (id: string) => void
  onUpdate: (id: string, changes: { targetRir?: number | null; stageKind?: StageKind | null }) => void
  onAddStage: () => void
}) {
  const { head, stages } = group
  // Chunk 14 — resolved once per group, same rule the workout screen's own
  // SetGroup.tsx uses (a legacy/null kind reads as a dropset): labels each
  // stage row, and is the chip row's own selected value below.
  const stageKind = resolveStageKind(head.stageKind ?? null)
  return (
    <div>
      <SetRow
        displayNumber={displayNumber}
        targetRir={head.targetRir}
        repTarget={columnsToRepTarget({ repMin: head.repMin ?? null, repMax: head.repMax ?? null, isAmrap: head.isAmrap ?? false })}
        isPast={isPast}
        onRemove={onRemoveHead}
        onUpdate={(changes) => onUpdate(head.id, changes)}
      />

      {(stages.length > 0 || !isPast) && (
        <div style={{ paddingLeft: 22, borderLeft: '1px dashed var(--border-strong)', marginLeft: 11 }}>
          {stages.map((stage) => (
            <SetRow
              key={stage.id}
              isStage
              stageKindLabel={STAGE_KIND_LABELS[stageKind]}
              targetRir={stage.targetRir}
              repTarget={columnsToRepTarget({ repMin: stage.repMin ?? null, repMax: stage.repMax ?? null, isAmrap: stage.isAmrap ?? false })}
              isPast={isPast}
              onRemove={() => onRemoveStage(stage.id)}
              onUpdate={(changes) => onUpdate(stage.id, changes)}
            />
          ))}

          {/* Stage kind (chunk 14, SPEC "Staged sets" — "Stage kinds:
              dropset, rest-pause, myo-reps, cluster"): once this head has
              at least one real stage, pick which of the four this set is.
              ADD STAGE itself is unchanged (still just adds a stage row,
              defaulting the head's own stage_kind to null/dropset until a
              different chip is tapped — "a head with stages and no
              stage_kind reads as a dropset"). Existing "chip" look
              (RatingChips, same component the FORM rating uses). */}
          {stages.length > 0 && !isPast && (
            <div style={{ padding: '2px 0 6px' }}>
              <RatingChips
                scale={{ values: STAGE_KINDS, labels: STAGE_KIND_LABELS }}
                value={stageKind}
                onChange={(kind) => onUpdate(head.id, { stageKind: kind })}
                label="STAGE KIND"
              />
            </div>
          )}

          {!isPast && (
            <button
              onClick={onAddStage}
              style={{ display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px 0 0', background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)' }}
            >
              <Plus size={11} />
              ADD STAGE
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Set Row ──────────────────────────────────────────────────────────────────
// A single row: either a head (numbered) or a stage (↳ marker, no number of
// its own — it shares its head's set_number by convention, TASKS.md §2.1).

function SetRow({
  displayNumber,
  isStage = false,
  stageKindLabel,
  targetRir,
  repTarget,
  isPast,
  onRemove,
  onUpdate,
}: {
  displayNumber?: number
  isStage?: boolean
  // Chunk 14 (SPEC "Staged sets" — "labels stages by kind") — a stage
  // row's own group, resolved once by PlanSetGroup (today's legacy/null ->
  // dropset rule); undefined for a head row, which never shows this.
  stageKindLabel?: string
  targetRir: number | null
  // Chunk 11 (SPEC.md "Removals") — the planned rep target, read-only here
  // (copied from the program at plan time; chunk 19's SetTargetsEditor owns
  // editing it in the week plan). 'none' renders nothing, same as a null
  // targetRir today.
  repTarget: RepTarget
  isPast: boolean
  onRemove: () => void
  onUpdate: (changes: { targetRir?: number | null; stageKind?: StageKind | null }) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '3px 16px', gap: 8 }}>
      {/* Set number */}
      <span style={{ width: 22, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 12, color: 'var(--text-dim)', flexShrink: 0 }}>
        {isStage ? '↳' : String(displayNumber).padStart(2, '0')}
      </span>

      {/* Stage kind (chunk 14) — same slot/style as the rep-target span
          right below, so a stage row reads "↳ REST-PAUSE 8–12" in one
          line. */}
      {isStage && stageKindLabel && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', flexShrink: 0 }}>
          {stageKindLabel}
        </span>
      )}

      {/* Planned rep target (read-only) */}
      {repTarget.type !== 'none' && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', color: 'var(--text-dim)', flexShrink: 0 }}>
          {formatRepTarget(repTarget)}
        </span>
      )}

      {/* RIR stepper */}
      <RirStepper
        value={targetRir}
        disabled={isPast}
        onChange={(v) => onUpdate({ targetRir: v })}
      />

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Remove */}
      {isPast ? (
        <div style={{ width: 28 }} />
      ) : (
        <button
          onClick={onRemove}
          style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', flexShrink: 0 }}
        >
          <Trash2 size={12} />
        </button>
      )}
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
        style={{ width: 24, height: 28, background: 'transparent', border: 'none', color: (disabled || value === null) ? 'var(--text-dim)' : 'var(--text-muted)', cursor: (disabled || value === null) ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        −
      </button>
      <div style={{ minWidth: 56, textAlign: 'center' }}>
        {value === null ? (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: 'var(--text-dim)' }}>
            NO RIR
          </span>
        ) : (
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>
            RIR {value}
          </span>
        )}
      </div>
      <button
        disabled={disabled}
        onClick={() => onChange(value === null ? 3 : Math.min(value + 1, 9))}
        style={{ width: 24, height: 28, background: 'transparent', border: 'none', color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        +
      </button>
    </div>
  )
}

// ─── Icon Button ──────────────────────────────────────────────────────────────
// Chunk 9's week-actions row (ExerciseSection, above) — same small
// square-icon-button tokens as WorkoutDayEditorPage.tsx's own local IconBtn
// (the planner's equivalent reorder/delete row), reimplemented here rather
// than imported so this file stays self-contained like every other
// plan/*.tsx component already is.
function IconBtn({
  onClick,
  disabled = false,
  ariaLabel,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  ariaLabel: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 6, color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', flexShrink: 0, opacity: disabled ? 0.5 : 1 }}
    >
      {children}
    </button>
  )
}
