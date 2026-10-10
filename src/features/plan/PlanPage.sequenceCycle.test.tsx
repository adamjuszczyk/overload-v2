// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, differenceInCalendarWeeks, format, parseISO, startOfWeek } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay, ProgramExercise, WeekPlan, Exercise, SequenceItem, WeekPlanSet, Session } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { scheduleSequence } from '../gym/sequenceSchedule'

// Chunk 35 (TASKS-1.1 "A sequence run's current cycle is the one with its next
// due workout"; SPEC Scheduling → Sequence [P1.1], G40) — Plan's current week on
// a sequence run is the cycle containing the next due workout (the one Today
// shows next), not the calendar week. Cycles before it are past and read-only;
// it and later ones can be edited. Weekday runs keep the calendar week.
//
// Driven through the REAL PlanPage tree (the seam every PlanPage test file
// uses: only the data hooks are mocked). What the tests prove:
//   - the opening view, the current-cycle marker, the read-only banner and EVERY
//     control that depends on a week being past follow the sequence's cycle, not
//     the calendar week or the cycle before it. expectEditable / expectReadOnly
//     walk the whole control matrix of the viewed cycle: the page's COPY LAST
//     CYCLE (empty cycles) and MARK CYCLE AS DELOAD; the panel's per-session
//     DELOAD toggle, apply-ahead offer, COPY THIS WORKOUT and ADD EXERCISE; each
//     exercise's ADD SET, ⋯ button and ⋯ menu (swap, move, warmup, remove); each
//     set row's weight, reps and RIR cells, ⋯ button and ⋯ menu (stage, stage
//     kind, tags, delete); a stage row's cells, ⋯ and menu; the compact view's
//     REMOVE LAST SET;
//   - the cycle moving on while the page is open turns the viewed cycle read-only
//     on the spot, and its apply-ahead offer and open menus go with it;
//   - a skipped workout moves the current cycle exactly as a done one does;
//   - cold load: nothing is mounted or planned until the programs have answered
//     (no WEEK n header, no calendar-week plan), and the current cycle is the
//     first and only cycle planned;
//   - while a read is out, no cycle is shown or marked current; a read that
//     failed with nothing to show gets the app's load error and nothing is planned;
//   - a weekday run still uses the calendar week even when a last event exists.
//
// Dates are never typed in (Checks that lied #21): every one is a weekday of a
// numbered week counted from a Monday, "today" is a controlled system time, and
// each scenario asserts its own inputs (weekdays, calendar week, sequence, last
// event, next due workout) before it asserts anything about Plan.

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// ─── A controlled calendar ────────────────────────────────────────────────────

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
type Weekday = (typeof WEEKDAYS)[number]

// Weeks are Monday-anchored (CONTEXT: meso week numbers are calendar weeks).
// Week n of the calendar below starts on MONDAY_1 + 7 * (n - 1).
const MONDAY_1 = startOfWeek(new Date(2026, 8, 14), { weekStartsOn: 1 })
function dayOf(week: number, weekday: Weekday): Date {
  return addDays(MONDAY_1, (week - 1) * 7 + WEEKDAYS.indexOf(weekday))
}
const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const named = (d: Date) => `${format(d, 'EEEE')} ${iso(d)}`

// ─── Scenario state, read by the mocks below ─────────────────────────────────

const EX_X: Exercise = {
  id: 'ex-x', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}
const EX_Y: Exercise = { ...EX_X, id: 'ex-y', name: 'Barbell Row', muscleGroup: 'back' }
const EX1 = EX_X.name
const EX2 = EX_Y.name

let activeMeso: Mesocycle
let program: Program
let workoutDays: WorkoutDay[] = []
let sequenceItems: SequenceItem[] = []
let allPlans: WeekPlan[] = []
// undefined = the last-event query hasn't answered; null = it answered "none".
let lastDoneOrSkipped: Session | null | undefined = null

// A test can replace what any one read returns (still loading: data undefined;
// failed: data undefined with isError; failed on a refetch: data with isError).
type Read = { data?: unknown; isLoading?: boolean; isError?: boolean }
let readOverrides: { programs?: Read; items?: Read; plans?: Read; lastEvent?: Read } = {}

const updateSetMutate = vi.fn()
const planWeekMutate = vi.fn()
const setDeloadMutate = vi.fn()
const copyWeekMutate = vi.fn()
const copyWeekHook = vi.fn((_mesoId: string, _weekNumber: number) => ({ mutate: copyWeekMutate, isPending: false }))
const copyWorkoutMutate = vi.fn()
const lastEventHook = vi.fn((_mesoId: string): Read => readOverrides.lastEvent ?? { data: lastDoneOrSkipped })

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => readOverrides.programs ?? { data: [program], isLoading: false },
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => readOverrides.items ?? { data: sequenceItems, isLoading: false },
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// Today's own hook, the one read Plan adds on a sequence run.
vi.mock('../gym/useSession', () => ({
  useLastDoneOrSkippedSession: (mesoId: string) => lastEventHook(mesoId),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: allPlans.filter((w) => w.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => readOverrides.plans ?? { data: allPlans, isLoading: false },
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: planWeekMutate, isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: (mesoId: string, weekNumber: number) => copyWeekHook(mesoId, weekNumber),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: copyWorkoutMutate, isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  readOverrides = {}
  updateSetMutate.mockClear()
  planWeekMutate.mockClear()
  setDeloadMutate.mockClear()
  copyWeekHook.mockClear()
  copyWeekMutate.mockClear()
  copyWorkoutMutate.mockClear()
  lastEventHook.mockClear()
})

// ─── Scenario builders ───────────────────────────────────────────────────────

const WORKOUT_NAMES: Record<string, string> = { 'wd-a': 'A', 'wd-b': 'B', 'wd-c': 'C', 'wd-d': 'D', 'wd-e': 'E' }

interface LastEvent {
  status: 'completed' | 'skipped'
  cycle: number
  position: number
  on: Date
}

interface Scenario {
  runStart: Date
  today: Date
  layout: (string | null)[] // workout day id per slot; null = a rest day
  cyclesWithPlans: number[] // cycles planned with exercises and sets
  emptyCycles?: number[] // cycles whose plan rows exist but carry no exercises
  lastEvent: LastEvent | null | undefined // undefined = not answered yet
}

const planId = (cycle: number, position: number) => `wp-c${cycle}-s${position}`
const setId = (cycle: number, position: number) => `set-c${cycle}-s${position}`

function planSet(id: string, weekPlanId: string, programExerciseId: string, setNumber: number, parent: string | null = null, stageIndex = 0): WeekPlanSet {
  return {
    id, weekPlanId, userId: 'user-1', programExerciseId, setNumber, targetRir: 2, isDropset: parent !== null,
    parentWeekPlanSetId: parent, stageIndex, isWarmup: false, targetWeight: null,
  }
}

// A planned cycle's row for one workout slot: two exercises — Bench Press with
// set 1 (and a stage under it) and set 2, Barbell Row with one set — so every
// per-exercise and per-set control (including a stage row's, and move up AND
// move down) exists on the screen. An "empty" cycle's row carries nothing.
function plansFor(layout: (string | null)[], populated: number[], empty: number[] = []): WeekPlan[] {
  const plans: WeekPlan[] = []
  for (const cycle of [...populated, ...empty].sort((a, b) => a - b)) {
    const isEmpty = empty.includes(cycle)
    layout.forEach((workoutDayId, position) => {
      if (!workoutDayId) return
      const wp = planId(cycle, position)
      const bench: ProgramExercise = { id: `pe-c${cycle}-s${position}`, workoutDayId, userId: 'user-1', exerciseId: 'ex-x', position: 0, weightUnit: null, exercise: EX_X }
      const row: ProgramExercise = { id: `pey-c${cycle}-s${position}`, workoutDayId, userId: 'user-1', exerciseId: 'ex-y', position: 1, weightUnit: null, exercise: EX_Y }
      plans.push({
        id: wp, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber: cycle,
        sequencePosition: position, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z',
        exercises: isEmpty ? [] : [bench, row],
        sets: isEmpty ? [] : [
          planSet(setId(cycle, position), wp, bench.id, 1),
          planSet(`stage-c${cycle}-s${position}`, wp, bench.id, 1, setId(cycle, position), 1),
          planSet(`set2-c${cycle}-s${position}`, wp, bench.id, 2),
          planSet(`sety-c${cycle}-s${position}`, wp, row.id, 1),
        ],
      })
    })
  }
  return plans
}

// The plan rows a scenario builds, for a test to count.
function allPlansOf(s: Scenario): WeekPlan[] {
  return plansFor(s.layout, s.cyclesWithPlans, s.emptyCycles)
}

function sessionFor(layout: (string | null)[], e: LastEvent): Session {
  return {
    id: 's-last', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: planId(e.cycle, e.position), workoutDayId: layout[e.position],
    date: iso(e.on), status: e.status, note: null, startedAt: `${iso(e.on)}T09:00:00Z`, completedAt: `${iso(e.on)}T10:00:00Z`,
    createdAt: `${iso(e.on)}T09:00:00Z`, setLogs: [], energyRating: null, pumpRating: null, movedToDate: null,
  }
}

// Sets up everything the mocks read and fixes the system clock at noon on
// `today`, which is what PlanPage's calendar-week rule (new Date()) reads.
function setUpSequenceRun(s: Scenario): void {
  const ids = Array.from(new Set(s.layout.filter((id): id is string => !!id)))
  workoutDays = ids.map((id, i) => ({ id, programId: 'prog-1', userId: 'user-1', name: `Workout ${WORKOUT_NAMES[id]}`, position: i, exercises: [] }))
  sequenceItems = s.layout.map((workoutDayId, position) => ({ id: `si-${position}`, userId: 'user-1', programId: 'prog-1', position, workoutDayId }))
  allPlans = plansFor(s.layout, s.cyclesWithPlans, s.emptyCycles)
  lastDoneOrSkipped = s.lastEvent === undefined ? undefined : s.lastEvent === null ? null : sessionFor(s.layout, s.lastEvent)
  activeMeso = {
    id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
    status: 'active', startDate: iso(s.runStart), endDate: null, createdAt: '2026-01-01T00:00:00Z',
  }
  program = {
    id: 'prog-1', userId: 'user-1', name: 'Test Sequence Program', schedule: EMPTY_SCHEDULE,
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType: 'week_dependent', scheduleType: 'sequence',
  }
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(s.today.getFullYear(), s.today.getMonth(), s.today.getDate(), 12, 0, 0))
}

// A weekday run (Workout A on Wednesdays) started on a Monday, viewed on the
// Wednesday of its third calendar week, with a completed session on record. The
// sequence mocks are deliberately left holding a sequence whose rule would give
// cycle 1 (A done in cycle 1 → B next, in cycle 1), so a weekday run that
// wrongly read its last event would not land on week 3.
const WEEKDAY_RUN: Scenario = {
  runStart: dayOf(1, 'Monday'),
  today: dayOf(3, 'Wednesday'),
  layout: ['wd-a', 'wd-b'],
  cyclesWithPlans: [1],
  lastEvent: { status: 'completed', cycle: 1, position: 0, on: dayOf(2, 'Wednesday') },
}

function setUpWeekdayRun(): void {
  setUpSequenceRun(WEEKDAY_RUN)
  // The weekday run's own rows: one plan row per week for the workout on Wednesdays.
  const weekdayRow = (week: number): WeekPlan => {
    const pe: ProgramExercise = { id: `pe-w${week}`, workoutDayId: 'wd-a', userId: 'user-1', exerciseId: 'ex-x', position: 0, weightUnit: null, exercise: EX_X }
    return {
      id: `wp-w${week}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: week,
      isDeload: false, notes: null, exercises: [pe], sets: [planSet(`set-w${week}`, `wp-w${week}`, pe.id, 1)], createdAt: '2026-01-01T00:00:00Z',
    }
  }
  allPlans = [...allPlans, weekdayRow(1), weekdayRow(2), weekdayRow(3), weekdayRow(4)]
  program = { ...program, name: 'Test Weekday Program', schedule: { ...EMPTY_SCHEDULE, wednesday: 'wd-a' }, scheduleType: 'weekday' }
}

const slotNameIn = (layout: (string | null)[], position: number) => {
  const id = layout[position]
  return id ? WORKOUT_NAMES[id] : 'rest'
}

// What Today shows next for the scenario: the pure scheduler Today runs
// (scheduleSequence) over the same sequence and the same last event, with
// nothing in progress. Plan's current cycle has to be this one's cycle.
function todaysNext(s: Scenario) {
  if (s.lastEvent === undefined) return null
  const e = s.lastEvent
  return scheduleSequence(iso(s.today), {
    items: s.layout.map((workoutDayId, position) => ({ position, workoutDayId })),
    sessions: [],
    lastEvent: e === null ? null : { weekNumber: e.cycle, sequencePosition: e.position, status: e.status, date: iso(e.on) },
  })
}

// What the scenario feeds Plan, in words, so a failing assertion prints the
// inputs and not only the result (Checks that lied #21).
function inputsOf(s: Scenario) {
  const e = s.lastEvent
  const next = todaysNext(s)
  let todayShowsNext = 'unknown'
  if (next?.type === 'no_workouts') todayShowsNext = 'nothing (no workout in the sequence)'
  if (next?.type === 'next') {
    const due = next.dueDate === null ? 'now' : named(parseISO(next.dueDate))
    todayShowsNext = `${slotNameIn(s.layout, next.next.sequencePosition)} (cycle ${next.next.weekNumber}, slot ${next.next.sequencePosition + 1}), due ${due}`
  }
  return {
    runStarts: named(s.runStart),
    today: named(s.today),
    calendarWeekOfTheRun: differenceInCalendarWeeks(s.today, s.runStart, { weekStartsOn: 1 }) + 1,
    sequence: s.layout.map((_, i) => slotNameIn(s.layout, i)).join(', '),
    lastEvent: e === undefined ? 'not answered yet' : e === null ? 'none' : `${e.status} ${slotNameIn(s.layout, e.position)} (cycle ${e.cycle}, slot ${e.position + 1}) on ${named(e.on)}`,
    todayShowsNext,
  }
}

// Plan's header names the cycle Today's next workout is in, and it is the
// cycle the test expects (so a wrong expectation can't pass quietly either).
function expectOpensOnTheCycleTodayShowsNext(s: Scenario, expected: number) {
  const next = todaysNext(s)
  expect(next?.type).toBe('next')
  expect(next?.type === 'next' ? next.next.weekNumber : null).toBe(expected)
  expect(screen.getByText(`CYCLE ${expected}`)).toBeTruthy()
}

function ui() {
  return (
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>
  )
}

function renderPlan() {
  return render(ui())
}

// ─── Screen helpers ──────────────────────────────────────────────────────────

const READ_ONLY_BANNER = 'PAST WEEK — READ ONLY'
const banner = () => screen.queryByText(READ_ONLY_BANNER)
const WEEK_OR_CYCLE_HEADER = /^(WEEK|CYCLE) \d+$/
// The week stepper's chip: filled with the accent colour only on the current cycle.
const chipOf = (text: string) => screen.getByText(text).parentElement as HTMLElement
const isMarkedCurrent = (text: string) => chipOf(text).style.background === 'var(--accent)'
const asButton = (el: HTMLElement | null) => el as HTMLButtonElement
const plannedWeeks = () => planWeekMutate.mock.calls.map(([v]) => (v as { weekNumber: number }).weekNumber)
const MINUS = '−' // the RIR stepper's minus glyph

// Buttons the screen gives an aria-label (everything except the weight and RIR
// cells, which controlsOf finds by role inside their row). By label, not by role:
// computing every button's accessible name is what makes ByRole slow on a screen
// this size.
const labelled = (label: string | RegExp) => screen.getByLabelText(label) as HTMLButtonElement
const maybeLabelled = (label: string | RegExp) => screen.queryByLabelText(label) as HTMLButtonElement | null
const allLabelled = (label: string | RegExp) => screen.queryAllByLabelText(label) as HTMLButtonElement[]

function goTo(cycle: number) {
  for (let guard = 0; guard < 20 && screen.queryByText(`CYCLE ${cycle}`) === null; guard++) {
    const showing = Number((screen.getByText(/^CYCLE \d+$/).textContent ?? '').replace('CYCLE ', ''))
    fireEvent.click(screen.getByLabelText(showing > cycle ? 'Previous week' : 'Next week'))
  }
  expect(screen.getByText(`CYCLE ${cycle}`)).toBeTruthy()
}

// The set rows of a populated cycle's selected slot, in the order the screen
// draws them: Bench Press set 1, its stage, set 2, then Barbell Row set 1.
function setRows() {
  const ones = screen.getAllByText('01')
  return {
    benchSet1: ones[0].parentElement as HTMLElement,
    stage: screen.getByText('↳').parentElement as HTMLElement,
    benchSet2: screen.getByText('02').parentElement as HTMLElement,
    rowSet1: ones[1].parentElement as HTMLElement,
  }
}

function controlsOf(row: HTMLElement) {
  const q = within(row)
  return {
    weight: asButton(q.getByRole('button', { name: '—' })),
    reps: asButton(q.getByRole('button', { name: 'Set rep target' })),
    rirDown: asButton(q.getByRole('button', { name: MINUS })),
    rirUp: asButton(q.getByRole('button', { name: '+' })),
    options: q.queryByRole('button', { name: /^Options for / }) as HTMLButtonElement | null,
  }
}

function lastUpdate() {
  const call = updateSetMutate.mock.calls[updateSetMutate.mock.calls.length - 1]
  return call?.[0] as { id: string; changes: Record<string, unknown> } | undefined
}

// The viewed (populated) cycle can be edited: every control the screen has for
// it is there and live, and each edit reaches the hook with THIS cycle's own row.
function expectEditable(cycle: number, slot = 0) {
  // — the page
  expect(banner()).toBeNull()
  expect(screen.getByText('MARK CYCLE AS DELOAD')).toBeTruthy()

  // — the session's own DELOAD toggle
  const sessionDeload = asButton(labelled('Mark this session as deload'))
  expect(sessionDeload.disabled).toBe(false)
  setDeloadMutate.mockClear()
  fireEvent.click(sessionDeload)
  expect(setDeloadMutate).toHaveBeenCalledTimes(1)
  expect((setDeloadMutate.mock.calls[0][0] as { weekPlanId: string }).weekPlanId).toBe(planId(cycle, slot))
  setDeloadMutate.mockClear()

  // — ADD EXERCISE
  expect(screen.getByText('ADD EXERCISE')).toBeTruthy()

  // — each exercise: ADD SET, the ⋯ button, and its ⋯ menu (swap, move, warmup, remove)
  for (const [name, canMoveUp, canMoveDown] of [[EX1, false, true], [EX2, true, false]] as const) {
    expect(asButton(labelled(`Add set to ${name}`)).disabled).toBe(false)
    fireEvent.click(labelled(`${name} options`))
    expect(labelled(`Swap ${name}`)).toBeTruthy()
    expect(asButton(labelled('Move up')).disabled).toBe(!canMoveUp)
    expect(asButton(labelled('Move down')).disabled).toBe(!canMoveDown)
    expect(labelled('Add warmup sets')).toBeTruthy()
    expect(labelled(`Remove ${name} from this week`)).toBeTruthy()
    fireEvent.click(labelled(`${name} options`))
    expect(maybeLabelled(`Swap ${name}`)).toBeNull()
  }

  // — every set row (heads, the stage, the other exercise's): all four cells live, a ⋯ button
  const rows = setRows()
  for (const row of [rows.benchSet1, rows.stage, rows.benchSet2, rows.rowSet1]) {
    const c = controlsOf(row)
    expect(c.weight.disabled).toBe(false)
    expect(c.reps.disabled).toBe(false)
    expect(c.rirDown.disabled).toBe(false)
    expect(c.rirUp.disabled).toBe(false)
    expect(c.options).not.toBeNull()
  }

  // — the first set's cells each write THIS cycle's own set
  updateSetMutate.mockClear()
  fireEvent.click(controlsOf(rows.benchSet1).weight)
  fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '100' } })
  fireEvent.blur(screen.getByLabelText('Weight target'))
  expect(updateSetMutate).toHaveBeenCalledTimes(1)
  expect(lastUpdate()?.id).toBe(setId(cycle, slot))
  fireEvent.click(controlsOf(rows.benchSet1).reps)
  fireEvent.change(screen.getByLabelText('Rep target'), { target: { value: '8-12' } })
  fireEvent.blur(screen.getByLabelText('Rep target'))
  expect(updateSetMutate).toHaveBeenCalledTimes(2)
  expect(lastUpdate()?.id).toBe(setId(cycle, slot))
  fireEvent.click(controlsOf(rows.benchSet1).rirUp)
  expect(updateSetMutate).toHaveBeenCalledTimes(3)
  expect(lastUpdate()).toEqual({ id: setId(cycle, slot), changes: { targetRir: 3 } })
  // ... and so does the stage's
  fireEvent.click(controlsOf(rows.stage).rirDown)
  expect(lastUpdate()).toEqual({ id: `stage-c${cycle}-s${slot}`, changes: { targetRir: 1 } })
  updateSetMutate.mockClear()

  // — a head's ⋯ menu: ADD STAGE, STAGE KIND (it has a stage), the tags editor, DELETE SET
  fireEvent.click(controlsOf(rows.benchSet1).options!)
  expect(labelled('Add stage')).toBeTruthy()
  expect(screen.getByText('STAGE KIND')).toBeTruthy()
  expect(screen.getByText('TAGS')).toBeTruthy()
  expect(asButton(screen.getByText('+ CUSTOM')).disabled).toBe(false)
  expect(labelled('Delete set')).toBeTruthy()
  fireEvent.click(controlsOf(rows.benchSet1).options!)
  expect(maybeLabelled('Delete set')).toBeNull()

  // — a stage's ⋯ menu: DELETE STAGE
  fireEvent.click(controlsOf(rows.stage).options!)
  expect(labelled('Delete stage')).toBeTruthy()
  fireEvent.click(controlsOf(rows.stage).options!)
  expect(maybeLabelled('Delete stage')).toBeNull()

  // — the compact view: REMOVE LAST SET on each exercise
  fireEvent.click(screen.getByText('COMPACT'))
  expect(allLabelled('Remove last set')).toHaveLength(2)
  fireEvent.click(screen.getByText('COMPACT'))

  // The edits above offered "apply ahead" where later cycles are planned; leave none showing.
  const dismiss = maybeLabelled('Dismiss')
  if (dismiss) fireEvent.click(dismiss)
}

// The viewed (populated) cycle is past: the banner shows, and every control that
// would change it is gone or dead — nothing opens, nothing reaches a hook.
function expectReadOnly() {
  // — the page
  expect(banner()).not.toBeNull()
  expect(screen.queryByText('MARK CYCLE AS DELOAD')).toBeNull()
  expect(screen.queryByText(/APPLY THIS CHANGE/)).toBeNull()

  // — the session's own DELOAD toggle stays on screen but dead
  const sessionDeload = asButton(labelled('Mark this session as deload'))
  expect(sessionDeload.disabled).toBe(true)
  setDeloadMutate.mockClear()
  fireEvent.click(sessionDeload)
  expect(setDeloadMutate).not.toHaveBeenCalled()

  // — no ADD EXERCISE, no exercise header controls, no ⋯ buttons or menus anywhere
  expect(screen.queryByText('ADD EXERCISE')).toBeNull()
  for (const name of [EX1, EX2]) {
    expect(maybeLabelled(`Add set to ${name}`)).toBeNull()
    expect(maybeLabelled(`${name} options`)).toBeNull()
    expect(maybeLabelled(`Swap ${name}`)).toBeNull()
  }
  expect(allLabelled(/^Options for /)).toHaveLength(0)
  for (const label of ['Move up', 'Move down', 'Add warmup sets', 'Add stage', 'Delete set', 'Delete stage']) {
    expect(maybeLabelled(label)).toBeNull()
  }
  // The tags editor and the stage-kind chips live in a set's ⋯ menu, which a past
  // cycle doesn't have (that is what these absences pin). The tags editor's own
  // `disabled` flag is a second lock behind that door: no screen state reaches it.
  expect(screen.queryByText('STAGE KIND')).toBeNull()
  expect(screen.queryByText('TAGS')).toBeNull()
  expect(screen.queryByText('+ CUSTOM')).toBeNull()

  // — every set row's cells are on screen but dead, and open nothing
  updateSetMutate.mockClear()
  for (const row of Object.values(setRows())) {
    const c = controlsOf(row)
    expect(c.weight.disabled).toBe(true)
    expect(c.reps.disabled).toBe(true)
    expect(c.rirDown.disabled).toBe(true)
    expect(c.rirUp.disabled).toBe(true)
    expect(c.options).toBeNull()
    for (const cell of [c.weight, c.reps, c.rirDown, c.rirUp]) fireEvent.click(cell)
  }
  expect(screen.queryByLabelText('Weight target')).toBeNull()
  expect(screen.queryByLabelText('Rep target')).toBeNull()
  expect(updateSetMutate).not.toHaveBeenCalled()

  // — the compact view has no REMOVE LAST SET
  fireEvent.click(screen.getByText('COMPACT'))
  expect(allLabelled('Remove last set')).toHaveLength(0)
  fireEvent.click(screen.getByText('COMPACT'))
}

// An EMPTY cycle (plan rows, no exercises) that is current or later: copying is
// offered — the whole cycle, and this workout — and each acts on THIS cycle; the
// cycle can otherwise be edited (its cycle action, its session toggle, ADD EXERCISE).
function expectEmptyCycleEditable(cycle: number, slot = 0) {
  expect(banner()).toBeNull()
  expect(screen.getByText('MARK CYCLE AS DELOAD')).toBeTruthy()
  expect(asButton(labelled('Mark this session as deload')).disabled).toBe(false)
  expect(screen.getByText('ADD EXERCISE')).toBeTruthy()

  expect(screen.getByText('COPY LAST CYCLE')).toBeTruthy()
  copyWeekMutate.mockClear()
  fireEvent.click(screen.getByText('COPY LAST CYCLE'))
  expect(copyWeekMutate).toHaveBeenCalledTimes(1)
  expect(copyWeekHook).toHaveBeenLastCalledWith('meso-1', cycle)
  copyWeekMutate.mockClear()

  expect(screen.getByText('COPY THIS WORKOUT')).toBeTruthy()
  copyWorkoutMutate.mockClear()
  fireEvent.click(screen.getByText('COPY THIS WORKOUT'))
  expect(copyWorkoutMutate).toHaveBeenCalledWith({ workoutDayId: 'wd-a', weekPlanId: planId(cycle, slot), sequencePosition: slot })
  copyWorkoutMutate.mockClear()
}

// An EMPTY past cycle: nothing to copy into — neither button — and nothing else
// to change it with either.
function expectEmptyCycleReadOnly() {
  expect(banner()).not.toBeNull()
  expect(screen.queryByText('COPY LAST CYCLE')).toBeNull()
  expect(screen.queryByText('COPY THIS WORKOUT')).toBeNull()
  expect(screen.queryByText('MARK CYCLE AS DELOAD')).toBeNull()
  expect(asButton(labelled('Mark this session as deload')).disabled).toBe(true)
  expect(screen.queryByText('ADD EXERCISE')).toBeNull()
}

// ─── The scenarios ───────────────────────────────────────────────────────────

// A 9-day cycle (A, B, rest, C, D, rest, E, rest, rest), run started on a
// Wednesday. On the Tuesday of the run's SECOND calendar week, D was done on the
// Sunday and the next due workout, E, is in cycle 1 — the cycle still in
// progress. The calendar says week 2; the sequence says cycle 1.
const NINE_DAY: Scenario = {
  runStart: dayOf(1, 'Wednesday'),
  today: dayOf(2, 'Tuesday'),
  layout: ['wd-a', 'wd-b', null, 'wd-c', 'wd-d', null, 'wd-e', null, null],
  cyclesWithPlans: [1, 2],
  lastEvent: { status: 'completed', cycle: 1, position: 4, on: dayOf(1, 'Sunday') },
}

// A 3-day cycle (A, B, C), run started on a Monday: cycle 1 is Mon–Wed, cycle 2
// is Thu–Sat. On the Sunday, still in the run's FIRST calendar week, cycle 2's
// last workout (C) was done on the Saturday: cycle 3 is the current cycle.
const THREE_DAY: Scenario = {
  runStart: dayOf(1, 'Monday'),
  today: dayOf(1, 'Sunday'),
  layout: ['wd-a', 'wd-b', 'wd-c'],
  cyclesWithPlans: [1, 2, 3, 4],
  lastEvent: { status: 'completed', cycle: 2, position: 2, on: dayOf(1, 'Saturday') },
}

// The same 3-day run with only cycle 1 planned (it is the copy source); cycles 2,
// 3 and 4 have plan rows but nothing in them. Cycle 3 is current, 2 is past, 4 is ahead.
const EMPTY_AHEAD: Scenario = {
  ...THREE_DAY,
  cyclesWithPlans: [1],
  emptyCycles: [2, 3, 4],
}

describe('PlanPage — a sequence run\'s current cycle (chunk 35)', () => {
  describe('a 9-day cycle still in progress in the run\'s second calendar week', () => {
    it('the scenario: calendar week 2, and the next due workout (E) is in cycle 1', () => {
      expect(inputsOf(NINE_DAY)).toEqual({
        runStarts: 'Wednesday 2026-09-16',
        today: 'Tuesday 2026-09-22',
        calendarWeekOfTheRun: 2,
        sequence: 'A, B, rest, C, D, rest, E, rest, rest',
        lastEvent: 'completed D (cycle 1, slot 5) on Sunday 2026-09-20',
        todayShowsNext: 'E (cycle 1, slot 7), due Tuesday 2026-09-22',
      })
    })

    it('opens on CYCLE 1 as the current cycle — not the calendar week 2 — with no read-only banner, and it can be edited', () => {
      setUpSequenceRun(NINE_DAY)
      renderPlan()

      expectOpensOnTheCycleTodayShowsNext(NINE_DAY, 1)
      expect(screen.queryByText('CYCLE 2')).toBeNull()
      expect(isMarkedCurrent('CYCLE 1')).toBe(true)
      expect(banner()).toBeNull()
      expectEditable(1)
    })

    it('cycle 1 carries no "PAST WEEK — READ ONLY" however it is reached (the calendar week would flag it past)', () => {
      setUpSequenceRun(NINE_DAY)
      renderPlan()

      goTo(1)
      expect(banner()).toBeNull()
      expect(screen.queryByText(READ_ONLY_BANNER)).toBeNull()
      expect(screen.getByText('MARK CYCLE AS DELOAD')).toBeTruthy()
    })

    it('plans (opens) the current cycle only — not the calendar week', () => {
      setUpSequenceRun(NINE_DAY)
      renderPlan()
      expect(plannedWeeks()).toEqual([1])
    })

    it('stepping to cycle 2 (a later cycle) and back never makes cycle 1 read-only; cycle 2 is editable too', () => {
      setUpSequenceRun(NINE_DAY)
      renderPlan()

      goTo(2)
      expect(isMarkedCurrent('CYCLE 2')).toBe(false)
      expectEditable(2)
      goTo(1)
      expect(banner()).toBeNull()
      expect(isMarkedCurrent('CYCLE 1')).toBe(true)
      expectEditable(1)
    })
  })

  describe('a 3-day cycle in the run\'s first calendar week, cycle 2\'s last workout done', () => {
    it('the scenario: calendar week 1, but cycles 1 and 2 are over (C of cycle 2 done on the Saturday)', () => {
      expect(inputsOf(THREE_DAY)).toEqual({
        runStarts: 'Monday 2026-09-14',
        today: 'Sunday 2026-09-20',
        calendarWeekOfTheRun: 1,
        sequence: 'A, B, C',
        lastEvent: 'completed C (cycle 2, slot 3) on Saturday 2026-09-19',
        todayShowsNext: 'A (cycle 3, slot 1), due Sunday 2026-09-20',
      })
    })

    it('opens on CYCLE 3 as the current cycle, editable — not the calendar week 1', () => {
      setUpSequenceRun(THREE_DAY)
      renderPlan()

      expectOpensOnTheCycleTodayShowsNext(THREE_DAY, 3)
      expect(screen.queryByText('CYCLE 1')).toBeNull()
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)
      expect(banner()).toBeNull()
      expectEditable(3)
      expect(plannedWeeks()).toEqual([3])
    })

    it('cycles 1 and 2 are past and read-only (every control gone or dead); cycles 3 and 4 are editable', () => {
      setUpSequenceRun(THREE_DAY)
      renderPlan()

      goTo(2)
      expect(isMarkedCurrent('CYCLE 2')).toBe(false)
      expectReadOnly()
      goTo(1)
      expect(isMarkedCurrent('CYCLE 1')).toBe(false)
      expectReadOnly()
      goTo(4)
      expect(isMarkedCurrent('CYCLE 4')).toBe(false)
      expectEditable(4)
      goTo(3)
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)
      expectEditable(3)
    })

    it('a SKIPPED last workout moves the current cycle exactly as a done one does: cycle 3, with cycle 2 read-only', () => {
      const skipped: Scenario = { ...THREE_DAY, lastEvent: { status: 'skipped', cycle: 2, position: 2, on: dayOf(1, 'Saturday') } }
      expect(inputsOf(skipped).lastEvent).toBe('skipped C (cycle 2, slot 3) on Saturday 2026-09-19')
      // A skip makes the next workout due the same day (the skip's own date).
      expect(inputsOf(skipped).todayShowsNext).toBe('A (cycle 3, slot 1), due Saturday 2026-09-19')
      setUpSequenceRun(skipped)
      renderPlan()

      expectOpensOnTheCycleTodayShowsNext(skipped, 3)
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)
      goTo(2)
      expectReadOnly()
    })

    it('before cycle 2\'s last workout is done (B done on the Friday, C still ahead or in progress) cycle 2 is the current cycle; cycle 1 is read-only', () => {
      const inProgress: Scenario = {
        ...THREE_DAY,
        today: dayOf(1, 'Saturday'),
        lastEvent: { status: 'completed', cycle: 2, position: 1, on: dayOf(1, 'Friday') },
      }
      expect(inputsOf(inProgress)).toEqual({
        runStarts: 'Monday 2026-09-14',
        today: 'Saturday 2026-09-19',
        calendarWeekOfTheRun: 1,
        sequence: 'A, B, C',
        lastEvent: 'completed B (cycle 2, slot 2) on Friday 2026-09-18',
        todayShowsNext: 'C (cycle 2, slot 3), due Saturday 2026-09-19',
      })
      setUpSequenceRun(inProgress)
      renderPlan()

      expectOpensOnTheCycleTodayShowsNext(inProgress, 2)
      expect(isMarkedCurrent('CYCLE 2')).toBe(true)
      expectEditable(2)
      goTo(1)
      expectReadOnly()
      goTo(3)
      expect(isMarkedCurrent('CYCLE 3')).toBe(false)
      expectEditable(3)
    })
  })

  describe('the cycle moves on while the page is open', () => {
    it('the last workout of cycle 3 gets done: the viewed cycle 3 turns read-only on the spot, and its apply-ahead offer and open ⋯ menus go with it', () => {
      setUpSequenceRun(THREE_DAY)
      const view = renderPlan()
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)

      // On the current cycle: open an exercise's ⋯ menu and a set's ⋯ menu, and
      // make an edit, so the apply-ahead offer shows (cycle 4 is planned).
      fireEvent.click(labelled(`${EX1} options`))
      const rows = setRows()
      fireEvent.click(controlsOf(rows.benchSet1).options!)
      fireEvent.click(controlsOf(rows.benchSet2).weight)
      fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '100' } })
      fireEvent.blur(screen.getByLabelText('Weight target'))
      expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
      expect(labelled(`Swap ${EX1}`)).toBeTruthy()
      expect(labelled('Delete set')).toBeTruthy()

      // The last workout of cycle 3 (C, on the Sunday) is done; Plan's reads refresh.
      lastDoneOrSkipped = sessionFor(THREE_DAY.layout, { status: 'completed', cycle: 3, position: 2, on: dayOf(1, 'Sunday') })
      view.rerender(ui())

      // The view stays where it was; what it is has changed.
      expect(screen.getByText('CYCLE 3')).toBeTruthy()
      expect(isMarkedCurrent('CYCLE 3')).toBe(false)
      expectReadOnly() // banner, no cycle action, no offer, dead cells, no ⋯ buttons
      expect(maybeLabelled(`Swap ${EX1}`)).toBeNull() // the exercise menu that was open
      expect(maybeLabelled('Delete set')).toBeNull() // the set menu that was open
      // ... and the next cycle is the current one now.
      goTo(4)
      expect(isMarkedCurrent('CYCLE 4')).toBe(true)
      expectEditable(4)
    })
  })

  describe('empty cycles: what can be copied into', () => {
    it('the scenario: cycle 1 planned, cycles 2–4 empty; the current cycle is 3', () => {
      expect(inputsOf(EMPTY_AHEAD).todayShowsNext).toBe('A (cycle 3, slot 1), due Sunday 2026-09-20')
      expect(allPlansOf(EMPTY_AHEAD).map((w) => `${w.weekNumber}:${w.sets.length}`)).toEqual(
        ['1:4', '1:4', '1:4', '2:0', '2:0', '2:0', '3:0', '3:0', '3:0', '4:0', '4:0', '4:0'],
      )
    })

    it('COPY LAST CYCLE and COPY THIS WORKOUT are offered on the current empty cycle (3) and on a later one (4), each acting on its own cycle', () => {
      setUpSequenceRun(EMPTY_AHEAD)
      renderPlan()

      expectOpensOnTheCycleTodayShowsNext(EMPTY_AHEAD, 3)
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)
      expectEmptyCycleEditable(3)
      goTo(4)
      expect(isMarkedCurrent('CYCLE 4')).toBe(false)
      expectEmptyCycleEditable(4)
    })

    it('neither is offered on a past empty cycle (2), though cycle 1 would be a valid source for it', () => {
      setUpSequenceRun(EMPTY_AHEAD)
      renderPlan()

      goTo(2)
      expect(isMarkedCurrent('CYCLE 2')).toBe(false)
      expectEmptyCycleReadOnly()
      // ... and back on the current cycle they are there again.
      goTo(3)
      expect(screen.getByText('COPY LAST CYCLE')).toBeTruthy()
      expect(screen.getByText('COPY THIS WORKOUT')).toBeTruthy()
    })

    it('the cycle moving on takes the copy buttons away from the cycle that was current', () => {
      setUpSequenceRun(EMPTY_AHEAD)
      const view = renderPlan()
      expect(screen.getByText('COPY LAST CYCLE')).toBeTruthy()
      expect(screen.getByText('COPY THIS WORKOUT')).toBeTruthy()

      lastDoneOrSkipped = sessionFor(EMPTY_AHEAD.layout, { status: 'completed', cycle: 3, position: 2, on: dayOf(1, 'Sunday') })
      view.rerender(ui())

      expect(screen.getByText('CYCLE 3')).toBeTruthy()
      expectEmptyCycleReadOnly()
    })
  })

  describe('no workout done yet, in the run\'s third calendar week', () => {
    const NOTHING_DONE: Scenario = {
      runStart: dayOf(1, 'Monday'),
      today: dayOf(3, 'Wednesday'),
      layout: ['wd-a', 'wd-b', 'wd-c'],
      cyclesWithPlans: [1, 2, 3],
      lastEvent: null,
    }

    it('the cycle is 1, not the calendar week 3: cycle 1 is the current cycle and nothing is read-only', () => {
      expect(inputsOf(NOTHING_DONE)).toEqual({
        runStarts: 'Monday 2026-09-14',
        today: 'Wednesday 2026-09-30',
        calendarWeekOfTheRun: 3,
        sequence: 'A, B, C',
        lastEvent: 'none',
        todayShowsNext: 'A (cycle 1, slot 1), due now',
      })
      setUpSequenceRun(NOTHING_DONE)
      renderPlan()

      expectOpensOnTheCycleTodayShowsNext(NOTHING_DONE, 1)
      expect(isMarkedCurrent('CYCLE 1')).toBe(true)
      expectEditable(1)
      goTo(3)
      expect(isMarkedCurrent('CYCLE 3')).toBe(false)
      expectEditable(3)
    })
  })

  describe('while a read has not answered', () => {
    it('the last-event read: no cycle is shown, none is marked current and no week is read-only or editable — the loading spinner shows instead', () => {
      const loading: Scenario = { ...THREE_DAY, lastEvent: undefined }
      expect(inputsOf(loading).lastEvent).toBe('not answered yet')
      setUpSequenceRun(loading)
      const { container } = renderPlan()

      expect(lastEventHook).toHaveBeenCalledWith('meso-1')
      expect(screen.queryByText(WEEK_OR_CYCLE_HEADER)).toBeNull()
      expect(banner()).toBeNull()
      expect(screen.queryByText('MARK CYCLE AS DELOAD')).toBeNull()
      expect(container.querySelector('.animate-spin')).not.toBeNull()
      expect(screen.queryByText("COULDN'T LOAD PLAN")).toBeNull() // loading is not an error
      // ... and nothing was planned for a cycle the screen can't name yet.
      expect(planWeekMutate).not.toHaveBeenCalled()
    })

    const stillLoading: [string, () => void][] = [
      ['the sequence read', () => { readOverrides = { items: { data: undefined, isLoading: true } } }],
      ['the week plans read', () => { readOverrides = { plans: { data: undefined, isLoading: true } } }],
    ]
    for (const [name, wait] of stillLoading) {
      it(`${name}: the same — a spinner, no header, nothing planned`, () => {
        setUpSequenceRun(THREE_DAY)
        wait()
        const { container } = renderPlan()

        expect(screen.queryByText(WEEK_OR_CYCLE_HEADER)).toBeNull()
        expect(container.querySelector('.animate-spin')).not.toBeNull()
        expect(screen.queryByText("COULDN'T LOAD PLAN")).toBeNull()
        expect(planWeekMutate).not.toHaveBeenCalled()
      })
    }
  })

  describe('cold load: the programs read has not answered yet', () => {
    it('a sequence run: no WEEK/CYCLE header and nothing planned while it is out, then only the current cycle is planned', () => {
      setUpSequenceRun(NINE_DAY)
      readOverrides.programs = { data: undefined, isLoading: true }
      const view = renderPlan()

      // While the programs are out: the spinner, no screen, no calendar-week plan, no last-event read.
      expect(view.container.querySelector('.animate-spin')).not.toBeNull()
      expect(screen.queryByText(WEEK_OR_CYCLE_HEADER)).toBeNull()
      expect(planWeekMutate).not.toHaveBeenCalled()
      expect(lastEventHook).not.toHaveBeenCalled()

      // The programs answer: the sequence program. The page opens on cycle 1 (the
      // calendar says week 2) and plans cycle 1 — and only cycle 1.
      readOverrides = {}
      view.rerender(ui())
      expect(screen.getByText('CYCLE 1')).toBeTruthy()
      expect(screen.queryByText('WEEK 2')).toBeNull()
      expect(isMarkedCurrent('CYCLE 1')).toBe(true)
      expect(plannedWeeks()).toEqual([1])
    })

    it('a weekday run: nothing is planned while it is out; then the page is what it always was (the calendar week)', () => {
      setUpWeekdayRun()
      readOverrides.programs = { data: undefined, isLoading: true }
      const view = renderPlan()

      expect(view.container.querySelector('.animate-spin')).not.toBeNull()
      expect(screen.queryByText(WEEK_OR_CYCLE_HEADER)).toBeNull()
      expect(planWeekMutate).not.toHaveBeenCalled()

      readOverrides = {}
      view.rerender(ui())
      expect(screen.getByText('WEEK 3')).toBeTruthy()
      expect(isMarkedCurrent('WEEK 3')).toBe(true)
      const planned = plannedWeeks()
      expect(planned[planned.length - 1]).toBe(3)
      expect(planned).not.toContain(2)
    })
  })

  describe('a read that failed with nothing to show', () => {
    const failures: [string, () => void][] = [
      ['the programs read', () => { readOverrides = { programs: { data: undefined, isError: true } } }],
      ['the sequence read', () => { readOverrides = { items: { data: undefined, isError: true } } }],
      ['the week plans read', () => { readOverrides = { plans: { data: undefined, isError: true } } }],
      ['the last-event read', () => { readOverrides = { lastEvent: { data: undefined, isError: true } } }],
    ]

    for (const [name, fail] of failures) {
      it(`${name}: the app's load error shows (not an endless spinner), no cycle is guessed, and nothing is planned`, () => {
        setUpSequenceRun(THREE_DAY)
        fail()
        const { container } = renderPlan()

        const title = screen.getByText("COULDN'T LOAD PLAN")
        expect(title.style.color).toBe('var(--error)') // the existing load error's look
        expect(screen.getByText('Check your connection and try again.')).toBeTruthy()
        expect(container.querySelector('.animate-spin')).toBeNull()
        expect(screen.queryByText(WEEK_OR_CYCLE_HEADER)).toBeNull()
        expect(banner()).toBeNull()
        expect(planWeekMutate).not.toHaveBeenCalled()
      })
    }

    it('a weekday run whose programs read failed: the same load error, nothing planned', () => {
      setUpWeekdayRun()
      readOverrides = { programs: { data: undefined, isError: true } }
      renderPlan()

      expect(screen.getByText("COULDN'T LOAD PLAN")).toBeTruthy()
      expect(screen.queryByText(WEEK_OR_CYCLE_HEADER)).toBeNull()
      expect(planWeekMutate).not.toHaveBeenCalled()
    })

    it('a read that failed on a REFETCH but still has its data does not blank the page: the cycle is named from what is there', () => {
      setUpSequenceRun(THREE_DAY)
      readOverrides = {
        programs: { data: [program], isError: true },
        items: { data: sequenceItems, isError: true },
        plans: { data: allPlans, isError: true },
        lastEvent: { data: lastDoneOrSkipped, isError: true },
      }
      renderPlan()

      expect(screen.queryByText("COULDN'T LOAD PLAN")).toBeNull()
      expect(screen.getByText('CYCLE 3')).toBeTruthy()
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)
    })
  })

  describe('a sequence with no workout in it', () => {
    it('the current cycle stays 1 (nothing is past)', () => {
      const allRest: Scenario = {
        runStart: dayOf(1, 'Monday'),
        today: dayOf(2, 'Thursday'),
        layout: [null, null],
        cyclesWithPlans: [],
        lastEvent: null,
      }
      expect(inputsOf(allRest)).toEqual({
        runStarts: 'Monday 2026-09-14',
        today: 'Thursday 2026-09-24',
        calendarWeekOfTheRun: 2,
        sequence: 'rest, rest',
        lastEvent: 'none',
        todayShowsNext: 'nothing (no workout in the sequence)',
      })
      setUpSequenceRun(allRest)
      renderPlan()

      expect(screen.getByText('CYCLE 1')).toBeTruthy()
      expect(isMarkedCurrent('CYCLE 1')).toBe(true)
      expect(banner()).toBeNull()
      expect(screen.getByText('NO SLOTS SCHEDULED')).toBeTruthy()
    })
  })
})

describe('PlanPage — a weekday run keeps the calendar week (chunk 35)', () => {
  it('uses the calendar week (WEEK 3, current, editable) even when a last workout exists, and makes no last-event read at all', () => {
    setUpWeekdayRun()
    expect(inputsOf(WEEKDAY_RUN).calendarWeekOfTheRun).toBe(3)
    expect(inputsOf(WEEKDAY_RUN).lastEvent).toBe('completed A (cycle 1, slot 1) on Wednesday 2026-09-23')
    expect(program.scheduleType).toBe('weekday')

    renderPlan()

    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.queryByText(/^CYCLE \d+$/)).toBeNull()
    expect(isMarkedCurrent('WEEK 3')).toBe(true)
    expect(banner()).toBeNull()
    expect(screen.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    // The week it settles on (a weekday run has always planned week 1 on its way
    // there, before its opening effect moves the view; that is not asserted).
    const planned = plannedWeeks()
    expect(planned[planned.length - 1]).toBe(3)
    // The weekday run never asked for a last event.
    expect(lastEventHook).not.toHaveBeenCalled()
    // ... and its weeks before the calendar week are still the past ones.
    fireEvent.click(screen.getByLabelText('Previous week'))
    expect(screen.getByText('WEEK 2')).toBeTruthy()
    expect(banner()).not.toBeNull()
  })
})
