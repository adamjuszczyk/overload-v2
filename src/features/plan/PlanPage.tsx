import { useState, useEffect, useRef } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronRight, Copy, Lock, Pencil } from 'lucide-react'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import type { WeekPlan, DayOfWeek, WorkoutDay } from '../../types'
import { useMesos } from '../programs/useMesos'
import { usePrograms, useWorkoutDays, useSequenceItems } from '../programs/usePrograms'
import { hasScheduledWorkout } from '../programs/hasSchedule'
import { scheduleForWeek } from '../programs/runSchedule'
import { changeStartWeek } from '../programs/programChange'
import { useWeekPlans, useAllWeekPlans, useSetWeekDeload, usePlanWeek } from './useWeekPlan'
import { detectSharedWeekdayWorkouts } from '../planner/usePlanner'
import { resolveEffectiveDeloadRules } from '../../lib/deloadRules'
import { deloadRulesLine } from './deloadRulesLine'
import { useSettingsStore } from '../settings/settingsStore'
import WeekView from './WeekView'
import { usePlanSessions } from './usePlanSessions'
import { DAYS_ORDER, DOW_LABEL } from './weekViewLogic'
import { useDoneWeekPlanIds } from './useDoneWeekPlanIds'
import PlanTabs, { type PlanTab } from './PlanTabs'
import WeekTiles from './WeekTiles'
import PlanForwardCard from './PlanForwardCard'
import CopySheet from './CopySheet'
import WeekMenuSheet from './WeekMenuSheet'
import VolumeSheet from './VolumeSheet'
import ReviewLine from './ReviewLine'
import ReviewSheet from './ReviewSheet'
import { copyRows } from './copySheetLogic'
import { forwardNote, forwardSource } from './planForwardLogic'
import { weekTiles } from './weekPlanning'
import ProgramsTab from '../programs/ProgramsTab'
import { errorReason } from '../../components/exercisePickerLogic'
import { usePlanRowStatuses } from './usePlanRowStatuses'
import { useRunSchedule } from './useRunSchedule'
import { useSequenceCurrentCycle } from './useSequenceCurrentCycle'
import { useToday } from '../../hooks/useToday'

// ─── Constants ────────────────────────────────────────────────────────────────

// There is no program tab (chunk 33, SPEC Plan screen [P1.1]: "No program tab.
// It's removed; what it did happens in the week or is fixed for the run"). Where each thing the tab
// did lives now (chunk 54a, SPEC [1.2]):
//   - rest, rest after, tempo, superset grouping and rest, the warmup routine, an exercise's weight
//     unit, and the exercise list itself → CHANGE THE PROGRAM (chunks 51a and 51b); a set's own rest
//     is the set type picker's "Rest after this set" in a week-dependent week;
//   - stable volume (sets, reps, set kinds, the exercise list) → CHANGE THE PROGRAM;
//   - priorities → the PROGRAMS tab (chunk 65);
//   - the deload rules are the Settings rules (programs have no override since chunk 48) → one
//     read-only line in WEEK ⋯.

function computeWeekNumber(startDate: string): number {
  return differenceInCalendarWeeks(new Date(), parseISO(startDate), { weekStartsOn: 1 }) + 1
}

// ─── Page ─────────────────────────────────────────────────────────────────────

// Chunk 52 (TASKS-1.2 "Plan's header: tiles, PLAN FORWARD, COPY, WEEK ⋯, and when a week gets planned"; SPEC Screens → Plan screen; boards
// 1, 1b, 1d, 1e, 2, 12). The header is the PLAN | PROGRAMS tabs and "[PROGRAM] · CURRENT PROGRAM", then a tile per week (cycle) from week 1
// through the current week and on to the first unplanned one after it (`weekTiles`, chunk 42): tapping a tile opens that week and plans
// nothing. Plan plans one week by itself, the CURRENT one, when it has no rows; the week after the current one, once it is the first
// unplanned, opens with PLAN FORWARD (`PlanForwardCard`), which plans exactly that week. A week nobody planned that has passed shows NOT
// PLANNED, read-only and empty, and nothing is ever written for it (DECISIONS 131). Under the header: COPY (`CopySheet`, hidden on week 1,
// P1.2-1), VOLUME (`VolumeSheet`, chunk 55: hidden there too) and WEEK ⋯ (`WeekMenuSheet`: the week's deload and the Settings rules), then the week: since chunk 54a one card per exercise with its set
// rows (`PlanExerciseCard`), under the session chips, the legend and the session header and ⋯ that chunk 54b drew (`WeekView`: boards 1, 1a,
// 1c, 1d, 10, 11; a stable week's THIS WEEK ONLY, the marks of what differs from the week's source, done sessions and past weeks read-only).
// The PROGRAMS tab is chunk 65's `ProgramsTab` (it drew today's Programs page until then, P1.2-12).
//
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
//
// Chunk 65 (TASKS-1.2 "The PROGRAMS tab"; SPEC Navigation and settings [1.2] → PLAN | PROGRAMS (8): "Tapping Plan in the nav opens straight
// into the week. With no program running it opens on PROGRAMS; PLAN shows a lock"; Programs and runs [1.2], Starting: "lands on Plan, week
// 1") makes this the shell that chooses the tab:
//   - `/plan` opens the week of the program that runs, or PROGRAMS when none does (PLAN is locked then, PR2: nothing can open it; a program
//     that finishes under an open Plan leaves PROGRAMS too). `/program` is the same page opened on PROGRAMS (`initialTab`).
//   - START (both of them: the PROGRAMS tab's sheet and the planner's) goes to `/plan?week=1`. The shell reads `week` once, opens Plan on that
//     week, and takes it out of the address: a one-shot, so a reload or a later visit opens the current week as ever.
//   - A run list that couldn't be read is the load error (board 12), never "no program running": an empty answer and a failed one differ.
export default function PlanPage({ initialTab }: { initialTab?: PlanTab } = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [chosen, setChosen] = useState<PlanTab | null>(initialTab ?? null)
  const [forcedWeek, setForcedWeek] = useState<number | null>(null)
  const mesosRead = useMesos()
  const programsRead = usePrograms()
  const mesos = mesosRead.data
  const activeMeso = mesos?.find((m) => m.status === 'active') ?? null

  // The one-shot `?week=N`: a whole number from 1 opens Plan on that week; anything else is only taken out of the address.
  const weekParam = parseWeekParam(searchParams.get('week'))
  useEffect(() => {
    if (searchParams.get('week') === null) return
    if (weekParam !== null) {
      setChosen('plan')
      setForcedWeek(weekParam)
    }
    const rest = new URLSearchParams(searchParams)
    rest.delete('week')
    setSearchParams(rest, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const noRun = mesos !== undefined && activeMeso === null
  const tab: PlanTab = noRun ? 'programs' : weekParam !== null ? 'plan' : (chosen ?? 'plan')

  if (tab === 'programs') return <ProgramsTab onTab={setChosen} />

  if (mesosRead.isError === true && mesos === undefined) return <PlanLoadError error={mesosRead.error} />

  if (activeMeso && programsRead.data === undefined) {
    return programsRead.isError ? <PlanLoadError error={programsRead.error} /> : <PlanSpinner />
  }

  const initialWeek = forcedWeek ?? weekParam ?? undefined
  const program = programsRead.data?.find((p) => p.id === activeMeso?.programId)
  if (activeMeso && (program?.scheduleType ?? 'weekday') === 'sequence') {
    return <SequencePlanPage mesoId={activeMeso.id} programId={activeMeso.programId} onTab={setChosen} initialWeek={initialWeek} />
  }
  return <PlanScreen onTab={setChosen} initialWeek={initialWeek} />
}

/** `?week=N` as a week number: a whole number from 1, else null. */
function parseWeekParam(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const week = Number(value)
  return Number.isSafeInteger(week) && week >= 1 ? week : null
}

// The sequence run's wrapper: finds the current cycle, then renders the same
// screen with it. Until the three reads behind it have answered the cycle is
// unknown, and the loading spinner shows instead of any cycle: marking cycle 1
// current (and editable) on a run that is in cycle 4, until the answer lands,
// would be a wrong cycle on screen. If one of the reads failed and has nothing
// to show, the spinner would never end: the load error shows instead, and
// nothing is planned (a fallback to the calendar week or cycle 1 would plan
// the wrong cycle). Display-only choices (D31), provisional.
function SequencePlanPage({ mesoId, programId, onTab, initialWeek }: { mesoId: string; programId: string; onTab: (tab: PlanTab) => void; initialWeek?: number }) {
  const { cycle, failed, error } = useSequenceCurrentCycle(mesoId, programId)
  if (cycle === null) return failed ? <PlanLoadError error={error} /> : <PlanSpinner />
  return <PlanScreen sequenceCycle={cycle} onTab={onTab} initialWeek={initialWeek} />
}

// Board 12's two states with nothing to draw but the title: "PLAN" over a spinner (OPENING PLAN) or over the error (PLAN COULDN'T LOAD).
function PlanFrame({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      <div style={{ padding: '14px 16px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <h1 style={{ margin: 0, minHeight: 44, display: 'flex', alignItems: 'flex-end', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
          PLAN
        </h1>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>{children}</div>
    </div>
  )
}

function PlanSpinner() {
  return (
    <PlanFrame>
      <div role="status" aria-label="Loading" className="animate-spin" style={{ width: 22, height: 22, borderRadius: '50%', ...SPINNER_RING }} />
    </PlanFrame>
  )
}

// Board 12's error: the headline, then the reason the read gave (SPEC Errors (15): "the line under its headline is the real reason: the
// message the server or the client actually returned"; "You may be offline" only when that is the reason; P1.2-5: "Something went
// wrong." when the message is empty). Plan and Today had no load error of their own before 1.2; this one is the app's.
function PlanLoadError({ error }: { error: unknown }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  return (
    <PlanFrame>
      <div role="alert" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--error)' }}>COULDN'T LOAD PLAN</p>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{errorReason(error, offline)}</p>
      </div>
    </PlanFrame>
  )
}

const NO_PLANS: WeekPlan[] = []

// The spinner's ring, one side at a time: a captured render drops a `border` shorthand with `var()`, and a `borderColor` followed by
// `borderTopColor` (jsdom keeps neither), so the board-12 screenshots would show no ring.
const SPINNER_RING: CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: 'var(--accent)',
  borderRightColor: 'var(--border-strong)',
  borderBottomColor: 'var(--border-strong)',
  borderLeftColor: 'var(--border-strong)',
}

const MONO_CAPTION: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

// One of the buttons under the header (board 1: COPY, VOLUME, WEEK ⋯). The row sizes itself to how many there are: week 1 has WEEK ⋯ alone.
const ACTION_BUTTON: CSSProperties = {
  height: 44,
  boxSizing: 'border-box',
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  background: 'var(--surface)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 7,
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: '0.15em',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}

// A card for the week the header opened when there is nothing of it to draw: a week that passed unplanned, or the current week while it is
// being planned, or a week that couldn't be read. `error` makes it an alert; the children are what can be done about it, if anything.
function WeekNote({ title, body, error = false, children }: { title: string; body: string; error?: boolean; children?: ReactNode }) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '18px 16px', borderRadius: 12, background: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' }}
    >
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 18, lineHeight: 1.2, color: 'var(--text-primary)' }}>{title}</span>
      <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{body}</span>
      {children}
    </div>
  )
}

// `sequenceCycle`: the current cycle of a sequence run (SequencePlanPage), null
// for a weekday run, whose current week is the calendar week. `initialWeek` (chunk 65): the week Plan opens on instead of the current one,
// when START sent it to week 1 (`?week=1`, read by the shell); one that isn't among the tiles opens the current week as ever.
function PlanScreen({ sequenceCycle = null, onTab, initialWeek }: { sequenceCycle?: number | null; onTab: (tab: PlanTab) => void; initialWeek?: number }) {
  const navigate = useNavigate()
  const today = useToday()
  const { data: mesos = [], isLoading: mesosLoading } = useMesos()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null

  const currentWeek = sequenceCycle ?? (activeMeso ? computeWeekNumber(activeMeso.startDate) : 1)
  // A run whose start date is still ahead has no current week yet: week 1 (as CHANGE THE PROGRAM's button reads it). `weekTiles` needs
  // a whole number from 1.
  const tilesCurrent = Math.max(1, currentWeek)
  // The week the header has open. It opens on the current week (the current cycle on a sequence run) from the first render, not after an
  // effect, so no other week is shown (or flagged read-only) first: a run in week 5 whose weeks are already read would otherwise draw
  // week 1 and its lock line for a render. What is shown is `viewWeek` below, which is always one of the tiles.
  const [openedWeek, setOpenedWeek] = useState(initialWeek ?? sequenceCycle ?? tilesCurrent)

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

  // The opening view is the current week (the current cycle on a sequence run), or the week START asked for.
  useEffect(() => {
    if (activeMeso) setOpenedWeek(initialWeek ?? tilesCurrent)
  }, [activeMeso?.id])

  // Which sheet is open, if any: COPY (board 2), VOLUME (board 3) or WEEK ⋯ (board 1e).
  const [showCopy, setShowCopy] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const [showReview, setShowReview] = useState(false)
  const [showWeekMenu, setShowWeekMenu] = useState(false)

  // Week plans with a completed or skipped session: read-only like a past week.
  const doneWeekPlanIds = useDoneWeekPlanIds(activeMeso?.id)
  // The run's sessions with a plan row: which are done, skipped, started or moved (the chips' and headers' states, chunk 54b).
  const planSessions = usePlanSessions(activeMeso?.id)

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
  const unit = isSequence ? 'cycle' : 'week'
  const UNIT = isSequence ? 'CYCLE' : 'WEEK'

  // Chunk 22, chunk 48 — the EFFECTIVE deload rules for this run: the Settings
  // rules and nothing else (deloadRules.ts's resolveEffectiveDeloadRules; SPEC
  // Deload [1.2], 16b: "Settings only; programs have no override"). A program
  // that stored an override of its own (v2_programs.deload_rules, which stays
  // in the database) is never read: the run falls back to Settings, silently.
  // Resolved once, here at the screen layer, and handed to every
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
  const settingsDeloadRules = useSettingsStore((s) => s.deloadRules)
  const effectiveDeloadRules = resolveEffectiveDeloadRules(settingsDeloadRules)
  // Chunk 33 (SPEC Deload [P1.1], G43): "Plan shows the rules in effect,
  // read-only, next to the deload action." Chunk 52 (board 1e): the line is in
  // WEEK ⋯, under the mark. It shows exactly what marking is handed
  // (effectiveDeloadRules above, never a second resolution) and says they are
  // from Settings. It follows a change in Settings with no reload because this
  // reads the store live.
  const deloadRulesText = deloadRulesLine(effectiveDeloadRules)

  // Chunk 22 (reviewer's note 5) — "Already started — sets left as they
  // are", shown after a mark/unmark that the started guard caught. Cleared
  // on every new attempt so a stale notice from a previous click never
  // lingers once a fresh one is in flight.
  const [weekDeloadNotice, setWeekDeloadNotice] = useState<string | null>(null)

  const { data: workoutDays = [], isLoading: workoutDaysLoading } = useWorkoutDays(
    activeMeso?.programId ?? '',
  )
  // Chunk 50 (SPEC [1.2] Programs and runs → "Weekdays storage"): which workout is on which weekday is the schedule IN
  // FORCE FOR THE VIEWED WEEK, not the run copy's (which holds the newest days once CHANGE THE PROGRAM has moved some,
  // chunk 51b). The run's schedule rows are read once (`['v2_runSchedules', mesoId]`, shared with Today); the page waits
  // for them like it waits for the workouts, because the run copy's days drawn for a week that had others would put a
  // MOVE THIS SESSION on the wrong date. A sequence run has no weekday schedule and no rows.
  const { data: scheduleRows } = useRunSchedule(activeMeso?.id)
  const scheduleLoading = !isSequence && !!activeMeso && scheduleRows === undefined
  const daysLoading = workoutDaysLoading || scheduleLoading

  // Chunk 8 — the meso's full planned history (every week, every workout). Chunk 52: the week tiles are drawn from it (which weeks have
  // a plan row), and so is what the current week's planning is gated on; COPY reads each workout's source week from it. It is "not
  // known" until the read has answered: an empty list would read as "no week planned" and plan the current week on top of a run that
  // has weeks.
  const allWeeksRead = useAllWeekPlans(activeMeso?.id ?? '')
  const allWeekPlans = allWeeksRead.data ?? NO_PLANS
  const allWeeksKnown = allWeeksRead.data !== undefined

  // The week tiles (chunk 42's `weekTiles`): from week 1 through the current week, then the weeks planned ahead and the first unplanned
  // one after it. `viewWeek` is the tile that is open, and the current week if the open one is no longer among them.
  const tiles = allWeeksKnown ? weekTiles({ plannedWeeks: allWeekPlans.map((wp) => wp.weekNumber), currentWeek: tilesCurrent }) : []
  const viewWeek = tiles.length === 0 || tiles.some((t) => t.week === openedWeek) ? openedWeek : tilesCurrent
  const viewTile = tiles.find((t) => t.week === viewWeek)
  const forwardTile = tiles.find((t) => t.planForward)
  // What the open tile is, which decides what the week area shows: a week that passed unplanned (read-only, empty: nothing is written
  // for it); the first unplanned week after the current one (PLAN FORWARD); the current week while it is being planned; or a week with a
  // plan, which is drawn as it always was.
  const missedWeek = !!viewTile && viewTile.readOnly && viewTile.state === 'not_planned'
  const showForward = !!viewTile && viewTile.planForward
  const currentUnplanned = !!viewTile && viewTile.state === 'not_planned' && !viewTile.readOnly && !viewTile.planForward
  const weekIsOpen = !!viewTile && !missedWeek && !showForward && !currentUnplanned
  // A past week: every tile before the current one. Week plans with a completed or skipped session are read-only too (below). With the
  // run's weeks still unread there is no tile and nothing is known to be past: the lock line must not show over the spinner.
  const isPast = !!viewTile && viewTile.readOnly

  const weekPlansRead = useWeekPlans(activeMeso?.id ?? '', viewWeek)
  const weekPlans = weekPlansRead.data ?? NO_PLANS
  const plansLoading = weekPlansRead.isLoading
  const plansFailed = weekPlansRead.isError === true && weekPlansRead.data === undefined

  // Chunk 51a: the week CHANGE THE PROGRAM's changes start in (chunk 45's `changeStartWeek`), for the button at the foot of the panel.
  // A run whose start date is still ahead has no current week yet: week 1. The second display follow-up (DECISIONS 172 (j), Adam,
  // 2026-10-19: "The button follows the screen."): the statuses are the screen's own, done, in progress or not started, and a session
  // in progress is left as it is, so when the week's last open session is the one in progress the changes start the week after,
  // as the screen's rule box says. (`doneWeekPlanIds` knows only the rows that are done, which is what locks a row.)
  const planRowStatuses = usePlanRowStatuses(activeMeso?.id)
  const changeFromWeek = changeStartWeek(
    allWeekPlans.map((wp) => ({ weekNumber: wp.weekNumber, status: planRowStatuses.get(wp.id) ?? ('not_started' as const) })),
    tilesCurrent,
  )

  const planWeek = usePlanWeek()
  // Chunk 21 — "Mark this week as deload" / "Unmark this week" (SPEC
  // "Deload"), one action per viewed week, not per workout, since it targets
  // every planned row of the week by (mesocycle_id, week_number) alone — see
  // useWeekPlan.ts's own header comment on useSetWeekDeload. Chunk 52: it
  // lives in WEEK ⋯ and no longer plans the week first.
  const setWeekDeload = useSetWeekDeload(activeMeso?.id ?? '', viewWeek)

  // Chunk 52 (SPEC Weeks and copying [1.2]: "when a week gets planned: when it starts, or earlier when the user taps PLAN FORWARD on it.
  // Opening it doesn't plan it"; F1: until now an effect planned every week the screen showed). v2_plan_week is atomic and idempotent,
  // but nothing is planned by browsing any more: this plans the CURRENT week (the current cycle on a sequence run) and only when it
  // has no rows, once the run's weeks have been read. A week that passed unplanned is never planned (DECISIONS 131), and a week
  // after the current one only by PLAN FORWARD. It is tried once per run and week (a failure doesn't loop; TRY AGAIN is the retry),
  // and a new current week (Plan left open over Sunday midnight) is tried on its own.
  const currentWeekPlanned = allWeekPlans.some((wp) => wp.weekNumber === tilesCurrent)
  const planAttempt = useRef<string | null>(null)
  useEffect(() => {
    if (!activeMeso || !allWeeksKnown || currentWeekPlanned) return
    const key = `${activeMeso.id}:${tilesCurrent}`
    if (planAttempt.current === key) return
    planAttempt.current = key
    planWeek.mutate({ mesoId: activeMeso.id, weekNumber: tilesCurrent })
    // planWeek is a stable mutation object across renders (useMutation);
    // only a real change of meso, current week or what is planned should re-fire this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMeso?.id, allWeeksKnown, currentWeekPlanned, tilesCurrent])
  function retryCurrentWeek() {
    if (!activeMeso) return
    planAttempt.current = `${activeMeso.id}:${tilesCurrent}`
    planWeek.mutate({ mesoId: activeMeso.id, weekNumber: tilesCurrent })
  }

  // Chunk 20 (reviewer's note 7 — G14/DECISIONS 42–48): "say so in the offer
  // text if that workout is shared, the same wording convention chunk 21
  // will use" — detectSharedWeekdayWorkouts only ever returns a group for a
  // workout actually on 2+ weekdays, so membership alone is "is shared".
  // Chunk 50: both are read from the viewed week's schedule (weekSchedule, below).
  const weekSchedule = program && !isSequence ? scheduleForWeek(scheduleRows ?? [], program.schedule, viewWeek) : undefined
  const sharedGroups = weekSchedule ? detectSharedWeekdayWorkouts(weekSchedule) : []
  // Chunk 21 (reviewer's note 2 — "the marking UI says so where the mark is
  // set, e.g. 'Marks Mon, Tue, Wed, Thu, Fri — they share one plan'") — the
  // per-workout toggle needs the actual weekday list.
  const sharedWeekdaysByWorkoutDayId = new Map(sharedGroups.map((g) => [g.workoutDayId, g.weekdays]))

  const scheduledDays = weekSchedule
    ? DAYS_ORDER.filter((dow) => !!weekSchedule[dow])
        .map((dow) => ({
          dow,
          workoutDay: workoutDays.find((d) => d.id === weekSchedule[dow]),
        }))
        .filter((x): x is { dow: DayOfWeek; workoutDay: WorkoutDay } => !!x.workoutDay)
    : []

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
  // Chunk 21 — "Mark this week as deload" / "Unmark this week" (SPEC
  // "Deload" / "Plan screen" — "mark session or week as deload" is one of
  // this screen's own Weeks actions). weekIsFullyDeload reads off weekPlans as
  // they stand now (the same query the rest of this screen already reads) — a
  // one-button toggle, same convention as the per-session DELOAD pill,
  // flipping between the two labels rather than two separate buttons.
  // Chunk 25 review fix — "Mark this cycle as deload" (chunk 21's week
  // shortcut, relabelled): setWeekDeload itself already marks every row
  // sharing (mesocycle_id, week_number) with no workout_day_id filter at
  // all (weekPlanService.ts's own header: "Never filters by
  // workout_day_id... exactly the bug this function exists to not have"),
  // so it already covers every slot of a cycle unchanged.
  const weekIsFullyDeload = weekPlans.length > 0 && weekPlans.every((wp) => wp.isDeload)
  function toggleWeekDeload() {
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
  }

  // Every tag of the run's week sets: the cues sheet's "YOURS" list (SPEC Tags: "plus custom text"; no storage of its own). The meso-wide list
  // holds every week, the viewed week's own plans are the fresh ones (a cue just written is in them first), and a repeat is fine.
  const runCues = [...allWeekPlans, ...weekPlans].flatMap((wp) => wp.sets.flatMap((s) => s.tags ?? []))

  // ── No active meso ────────────────────────────────────────────────────────

  // Chunk 65: no program running is PROGRAMS' page with PLAN locked (PR2; SPEC: "With no program running it opens on PROGRAMS"), which the
  // shell above chooses, so this screen is drawn without a run only while the run list is still out. Chunk 11's "NO ACTIVE MESOCYCLE /
  // START A PROGRAM →" page is gone with the page it led to.
  if (mesosLoading || !activeMeso) return <PlanSpinner />

  // A run's weeks that can't be read leave nothing to draw the header from: board 12's error, with the real reason.
  if (allWeeksRead.isError === true && allWeeksRead.data === undefined) return <PlanLoadError error={allWeeksRead.error} />

  // ── Active meso ───────────────────────────────────────────────────────────

  // What is drawn under the header, in the order the page was built: the spinner while the run's weeks, schedule or this week's plan are
  // out; a run with no schedule; then the open tile's own content.
  const contentLoading = !allWeeksKnown || daysLoading || (weekIsOpen && plansLoading)
  const actionsShown = weekIsOpen && !isPast && !contentLoading && !plansFailed && weekPlans.length > 0
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  // The sheets' rows (board 2's INTO list): this week's workouts, each with the day or days it is on and its name; a sequence run's by
  // slot. Day order is the week's, so the list reads the way the week does.
  const dayLabel = (wp: WeekPlan): string => {
    if (isSequence) return `SLOT ${(wp.sequencePosition ?? 0) + 1}`
    if (!weekSchedule) return ''
    return DAYS_ORDER.filter((dow) => weekSchedule[dow] === wp.workoutDayId).map((dow) => DOW_LABEL[dow].slice(0, 3)).join(' · ')
  }
  const planOrder = (wp: WeekPlan): number => {
    if (isSequence) return wp.sequencePosition ?? 0
    const index = weekSchedule ? DAYS_ORDER.findIndex((dow) => weekSchedule[dow] === wp.workoutDayId) : -1
    return index === -1 ? DAYS_ORDER.length : index
  }
  const orderedWeekPlans = [...weekPlans].sort((a, b) => planOrder(a) - planOrder(b))

  // What REVIEW reads (chunk 56): the open week's own plan rows, those whose session isn't done (a done session is locked in Plan, so nothing is
  // written into its plan), and last week's rows out of the run's every-week list (a week nobody planned has none, DECISIONS 131).
  const reviewArgs = {
    weekNumber: viewWeek,
    thisWeek: weekPlans.filter((wp) => !doneWeekPlanIds.has(wp.id)),
    lastWeek: allWeekPlans.filter((wp) => wp.weekNumber === viewWeek - 1),
    workouts: workoutDays.map((d) => ({ id: d.id, name: d.name })),
  }

  // What PLAN FORWARD's card says: the workouts the week will have, by the schedule in force for that week (chunk 50: `weekSchedule` is
  // the open week's), and what it takes from where.
  const forwardWillHave = isSequence
    ? sequenceSlots.map((s) => ({ label: `SLOT ${s.position + 1}`, name: s.workoutDay?.name ?? 'Rest day' }))
    : scheduledDays.map((d) => ({ label: DOW_LABEL[d.dow].slice(0, 3), name: d.workoutDay.name }))
  const forwardWorkoutDayIds = isSequence
    ? sequenceSlots.flatMap((s) => (s.workoutDay ? [s.workoutDay.id] : []))
    : [...new Set(scheduledDays.map((d) => d.workoutDay.id))]
  const forwardSlots = isSequence
    ? sequenceSlots.flatMap((s) => (s.workoutDay ? [{ workoutDayId: s.workoutDay.id, sequencePosition: s.position }] : []))
    : forwardWorkoutDayIds.map((workoutDayId) => ({ workoutDayId, sequencePosition: null }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>

      {/* Header: the PLAN | PROGRAMS tabs, the run's name and the week tiles (boards 1, 1b, 1d) */}
      <div style={{ padding: '14px 16px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <PlanTabs active="plan" onSelect={onTab} />
          <span style={{ ...MONO_CAPTION, overflowWrap: 'anywhere' }}>{`${activeMeso.name.toUpperCase()} · CURRENT PROGRAM`}</span>
        </div>
        {tiles.length > 0 && <WeekTiles tiles={tiles} unit={UNIT} openWeek={viewWeek} focusWeek={tilesCurrent} onOpen={setOpenedWeek} />}
      </div>

      {/* Content */}
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '14px 16px 32px', minHeight: 0 }}>
        {/* Past week (board 1c): the lock line. A week that passed unplanned is one too. On a sequence run the cycle replaces the week in
            labels (SPEC Scheduling → Sequence: "The cycle replaces the week everywhere the week is used"), so a past cycle reads PAST CYCLE. */}
        {isPast && (
          <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, height: 32, ...MONO_CAPTION, fontSize: 9, letterSpacing: '0.15em' }}>
            <Lock size={13} strokeWidth={2.5} aria-hidden="true" />
            {`PAST ${UNIT} · READ ONLY`}
          </div>
        )}

        {/* Loading: the week's own spinner under the tiles (board 12) */}
        {contentLoading && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
            <div role="status" aria-label="Loading" className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', ...SPINNER_RING }} />
          </div>
        )}

        {/* A run with no schedule (chunk 33; SPEC Plan screen empty states [P1.1],
            G39 — "A run with no schedule (started before Start needed one) → a line
            linking to the Programs page"; DECISIONS 86, provisional): one line for
            a weekday run and a sequence run alike, since a schedule can't be set up
            during a run any more — its schedule is fixed for the run — so there is
            nothing per type left to say. The check is the one every START uses. */}
        {!contentLoading && !hasSchedule && (
          <div style={{ boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '24px 16px', borderRadius: 12, background: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)' }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>No workouts scheduled</span>
            <button
              type="button"
              onClick={() => onTab('programs')}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '6px 8px', border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--accent)' }}
            >
              PROGRAMS
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          </div>
        )}

        {/* The open week's own content */}
        {!contentLoading && hasSchedule && missedWeek && (
          <WeekNote
            title={`${capitalWord(unit)} ${viewWeek} wasn't planned`}
            body={`It passed with nothing planned, so it stays empty and read-only. Nothing is written for a ${unit} that has passed.`}
          />
        )}

        {!contentLoading && hasSchedule && showForward && forwardTile && (
          <PlanForwardCard
            mesoId={activeMeso.id}
            week={forwardTile.week}
            unit={unit}
            planningType={program?.planningType ?? 'week_dependent'}
            note={forwardNote({
              unit,
              week: forwardTile.week,
              source: forwardSource({ planningType: program?.planningType ?? 'week_dependent', week: forwardTile.week, slots: forwardSlots, allWeekPlans }),
            })}
            willHave={forwardWillHave}
            workoutDayIds={forwardWorkoutDayIds}
          />
        )}

        {!contentLoading && hasSchedule && currentUnplanned && (
          <WeekNote
            title={`${capitalWord(unit)} ${viewWeek} isn't planned yet`}
            body={planWeek.isError ? errorReason(planWeek.error, offline) : `Planning this ${unit} now.`}
            error={planWeek.isError}
          >
            {planWeek.isError && (
              <button
                type="button"
                onClick={retryCurrentWeek}
                style={{ height: 40, padding: '0 16px', borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-strong)', background: 'var(--surface)', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-primary)', cursor: 'pointer' }}
              >
                TRY AGAIN
              </button>
            )}
          </WeekNote>
        )}

        {!contentLoading && hasSchedule && weekIsOpen && plansFailed && (
          <WeekNote title="Couldn't load this week" body={errorReason(weekPlansRead.error, offline)} error />
        )}

        {!contentLoading && hasSchedule && weekIsOpen && !plansFailed && (
          <>
            {/* Under the header (board 1): COPY, VOLUME and WEEK ⋯. A past week has none of them (board 1c). COPY and VOLUME aren't
                offered on week 1: there is nothing before it, and numbers never come from another program (P1.2-1, provisional under
                D31). VOLUME is a button and nothing more: the week itself carries no volume (SPEC 14). */}
            {actionsShown && (
              <div style={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(0, 1fr)', gap: 8, marginBottom: 14 }}>
                {viewWeek > 1 && (
                  <button type="button" onClick={() => setShowCopy(true)} style={ACTION_BUTTON}>
                    <Copy size={14} strokeWidth={2} aria-hidden="true" />
                    COPY
                  </button>
                )}
                {viewWeek > 1 && (
                  <button type="button" onClick={() => setShowVolume(true)} style={ACTION_BUTTON}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 20V12M12 20V5M19 20v-9" />
                    </svg>
                    VOLUME
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`${capitalWord(unit)} ${viewWeek} options`}
                  onClick={() => {
                    setWeekDeloadNotice(null)
                    setShowWeekMenu(true)
                  }}
                  style={ACTION_BUTTON}
                >
                  {UNIT}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
              </div>
            )}

            {/* REVIEW (chunk 56; SPEC Review (13), board 1): one line under the action row when last week differed from its plan; never on week 1. */}
            {actionsShown && viewWeek > 1 && <ReviewLine unit={unit} onOpen={() => setShowReview(true)} {...reviewArgs} />}

            {/* The legend, the session chips and the open session (chunk 54b; boards 1, 1a, 1c, 1d, 10, 11) */}
            <WeekView
              isSequence={isSequence}
              mesoId={activeMeso.id}
              startDate={activeMeso.startDate}
              viewWeek={viewWeek}
              currentWeek={currentWeek}
              unit={unit}
              weekPlans={weekPlans}
              allWeekPlans={allWeekPlans}
              scheduledDays={scheduledDays}
              sequenceSlots={sequenceSlots}
              selectedDow={selectedDow}
              onSelectDow={setSelectedDow}
              selectedSlotId={selectedSlotId}
              onSelectSlot={setSelectedSlotId}
              sharedWeekdaysByWorkoutDayId={sharedWeekdaysByWorkoutDayId}
              sessions={planSessions}
              doneWeekPlanIds={doneWeekPlanIds}
              isPast={isPast}
              today={today}
              runCues={runCues}
              deloadRules={effectiveDeloadRules}
              planningType={program?.planningType ?? 'week_dependent'}
            />

            {/* Chunk 51a (SPEC Plan screen [1.2] → Bottom; board 1): the one way into CHANGE THE PROGRAM from Plan. "FROM WEEK N" is the
                week the changes start in (the week of the next session that isn't done), the number the screen's rule box gives; a past
                week has no button (board 1c). Plan reads which sessions are done, not which one is in progress, so on the one day a
                week's last open session is the one in progress this says the week the screen then corrects (display only, D31). */}
            {!isPast && (
              <button
                type="button"
                onClick={() => navigate('/plan/change')}
                style={{ marginTop: 16, width: '100%', height: 52, boxSizing: 'border-box', borderRadius: 10, border: '1px solid var(--border-strong)', background: 'var(--surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-primary)', cursor: 'pointer' }}
              >
                <Pencil size={16} aria-hidden="true" />
                CHANGE THE PROGRAM FROM {isSequence ? 'CYCLE' : 'WEEK'} {changeFromWeek}
              </button>
            )}
          </>
        )}
      </div>

      {/* COPY (board 2), VOLUME (board 3) and WEEK ⋯ (board 1e): sheets, mounted to open them. Outside the content above, which isn't clickable
          but scrolls; each is drawn through a portal. */}
      {showCopy && actionsShown && (
        <CopySheet
          unit={unit}
          weekNumber={viewWeek}
          planningType={program?.planningType ?? 'week_dependent'}
          rows={copyRows({
            thisWeek: orderedWeekPlans,
            allWeekPlans,
            doneWeekPlanIds,
            label: (wp) => ({ day: dayLabel(wp), name: workoutDays.find((d) => d.id === wp.workoutDayId)?.name ?? 'Workout' }),
          })}
          thisWeek={orderedWeekPlans}
          onClose={() => setShowCopy(false)}
        />
      )}
      {showVolume && actionsShown && viewWeek > 1 && (
        <VolumeSheet
          unit={unit}
          weekNumber={viewWeek}
          // Last week is over exactly when Plan shows the current week (the current cycle): on a week planned ahead it is still
          // running (DECISIONS 133). A past week has no action row, so this is never asked of one.
          ended={viewWeek <= tilesCurrent}
          // The open week's own query (an edit shows in it at once), and last week's rows from the run's every-week list.
          thisWeek={weekPlans}
          lastWeek={allWeekPlans.filter((wp) => wp.weekNumber === viewWeek - 1)}
          thisWeekSchedule={weekSchedule ?? null}
          lastWeekSchedule={program && !isSequence ? scheduleForWeek(scheduleRows ?? [], program.schedule, viewWeek - 1) : null}
          onClose={() => setShowVolume(false)}
        />
      )}
      {showReview && actionsShown && viewWeek > 1 && (
        <ReviewSheet
          unit={unit}
          fromWeek={changeFromWeek}
          program={{
            mesoId: activeMeso.id,
            programId: activeMeso.programId,
            planningType: program?.planningType ?? 'week_dependent',
            scheduleType: program?.scheduleType ?? 'weekday',
            currentWeek: tilesCurrent,
          }}
          onClose={() => setShowReview(false)}
          {...reviewArgs}
        />
      )}
      {showWeekMenu && actionsShown && (
        <WeekMenuSheet
          programName={activeMeso.name}
          unit={unit}
          weekNumber={viewWeek}
          marked={weekIsFullyDeload}
          pending={setWeekDeload.isPending}
          pendingDeload={setWeekDeload.variables?.isDeload === true}
          rulesLine={deloadRulesText}
          notice={weekDeloadNotice}
          error={setWeekDeload.isError ? setWeekDeload.error : null}
          onToggle={toggleWeekDeload}
          onClose={() => setShowWeekMenu(false)}
        />
      )}
    </div>
  )
}

const capitalWord = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
