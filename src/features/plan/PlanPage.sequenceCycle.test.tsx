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
//     walk the whole control matrix of the viewed cycle (chunk 54a: Plan has the
//     one view, the exercise cards and their set rows): the page's COPY and
//     CYCLE ⋯ buttons (chunk 52: COPY LAST CYCLE and MARK CYCLE AS DELOAD became
//     them); the panel's per-session DELOAD toggle; each exercise's "+" (and that it has no
//     ⋯ and the page no ADD EXERCISE); each set row's weight, reps and RIR cells and
//     its ⋯ button, which opens the set type picker; a stage row's cells (it has no
//     ⋯). Each edit is made and the write it reaches is the viewed cycle's own;
//   - the cycle moving on while the page is open turns the viewed cycle read-only
//     on the spot, and the picker or sheet that is open goes with it;
//   - a skipped workout moves the current cycle exactly as a done one does;
//   - cold load: nothing is mounted or planned until the programs have answered
//     (no week tiles, no calendar-week plan), and the current cycle, when it has no
//     rows, is the first and only cycle planned (chunk 52: when it has rows, none is);
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
type Read = { data?: unknown; isLoading?: boolean; isError?: boolean; error?: unknown }
let readOverrides: { programs?: Read; items?: Read; plans?: Read; lastEvent?: Read } = {}

const updateSetMutate = vi.fn()
const addSetMutate = vi.fn()
const removeSetMutate = vi.fn()
const changeTypeMutate = vi.fn()
const planWeekMutate = vi.fn()
const setDeloadMutate = vi.fn()
const lastEventHook = vi.fn((_mesoId: string): Read => readOverrides.lastEvent ?? { data: lastDoneOrSkipped })

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => readOverrides.programs ?? { data: [program], isLoading: false },
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => readOverrides.items ?? { data: sequenceItems, isLoading: false },
}))
// The set type picker (a set's ⋯) reads the exercise's program sets for its rest row; this file gives it none.
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// Today's own hook, the one read Plan adds on a sequence run.
vi.mock('../gym/useSession', () => ({
  useLastDoneOrSkippedSession: (mesoId: string) => lastEventHook(mesoId),
}))
// Plan reads which sessions are done (useDoneWeekPlanIds); none here.
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() })) // the CHANGE THE PROGRAM button's statuses: none here
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: allPlans.filter((w) => w.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => readOverrides.plans ?? { data: allPlans, isLoading: false },
  usePlanWeek: () => ({ mutate: planWeekMutate, isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: addSetMutate, isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: removeSetMutate, isPending: false }),
  useChangeSetType: () => ({ mutate: changeTypeMutate, isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
// COPY's sheet writes through its own hook (chunk 52); this file opens the sheet only to read what it says.
vi.mock('./useCopyNumbers', () => ({ useCopyNumbers: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }) }))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile, openWeekMenu, closeSheet } = await import('./planMenus.testutil')

afterEach(() => {
  readOverrides = {}
  updateSetMutate.mockClear()
  addSetMutate.mockClear()
  removeSetMutate.mockClear()
  changeTypeMutate.mockClear()
  planWeekMutate.mockClear()
  setDeloadMutate.mockClear()
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

// The lock line of a past week (board 1c). SPEC Scheduling → Sequence: "The cycle replaces the week everywhere the week is used (week plan,
// copying, …, labels, …)", so a sequence run's past cycle reads CYCLE and a weekday run's past week reads WEEK (review 1, F4: the line was
// WEEK on both). `banner()` is whichever of the two is on screen; the helpers below pin which one.
const CYCLE_LOCK_LINE = 'PAST CYCLE · READ ONLY'
const WEEK_LOCK_LINE = 'PAST WEEK · READ ONLY'
const banner = () => screen.queryByText(/^PAST (WEEK|CYCLE) · READ ONLY$/)
// A sequence run's past cycle: the cycle's word is there, and the week's is not.
function expectCycleLockLine() {
  expect(screen.queryByText(CYCLE_LOCK_LINE)).not.toBeNull()
  expect(screen.queryByText(WEEK_LOCK_LINE)).toBeNull()
}
// The week tiles (chunk 52): a tile is a week's name over its state. `WEEK_OR_CYCLE_HEADER` is a tile's name: none is on screen
// while a read is out, and none is when the load error shows.
const WEEK_OR_CYCLE_HEADER = /^(WEEK|CYCLE) \d+$/
const tileOf = (text: string) => screen.getByText(text).closest('button') as HTMLButtonElement
// The tile that is open: the one the week area is showing.
const isOpen = (text: string) => tileOf(text).getAttribute('aria-current') === 'true'
// The cycle that is open is the CURRENT cycle: its tile says THIS CYCLE (THIS WEEK) and it is the open one.
const isMarkedCurrent = (text: string) => isOpen(text) && /THIS (WEEK|CYCLE)/.test(tileOf(text).textContent ?? '')
// WEEK ⋯ / CYCLE ⋯: "Week 3 options" / "Cycle 3 options", there while the viewed week can be edited.
const weekMenuButton = () => screen.queryByLabelText(/^(Week|Cycle) \d+ options$/)
const asButton = (el: HTMLElement | null) => el as HTMLButtonElement
const plannedWeeks = () => planWeekMutate.mock.calls.map(([v]) => (v as { weekNumber: number }).weekNumber)

// Buttons the screen gives an aria-label (everything except the weight and RIR
// cells, which controlsOf finds by role inside their row). By label, not by role:
// computing every button's accessible name is what makes ByRole slow on a screen
// this size.
const labelled = (label: string | RegExp) => screen.getByLabelText(label) as HTMLButtonElement
const maybeLabelled = (label: string | RegExp) => screen.queryByLabelText(label) as HTMLButtonElement | null
const allLabelled = (label: string | RegExp) => screen.queryAllByLabelText(label) as HTMLButtonElement[]

// Opens a week by its tile. The tile has to exist: the strip reaches week 1 through the current week, and the weeks planned ahead
// and the first unplanned one (chunk 52).
function goTo(cycle: number) {
  openWeekTile(`CYCLE ${cycle}`)
  expect(isOpen(`CYCLE ${cycle}`)).toBe(true)
}

// The numbers "01" of the set rows: Bench Press's first set and Barbell Row's.
const setNumberOnes = () => screen.getAllByText('01')

// The set rows of a populated cycle's selected slot, in the order the screen
// draws them: Bench Press set 1, its stage, set 2, then Barbell Row set 1.
function setRows() {
  const ones = setNumberOnes()
  return {
    benchSet1: ones[0].parentElement as HTMLElement,
    stage: screen.getByText('↳').parentElement as HTMLElement,
    benchSet2: screen.getByText('02').parentElement as HTMLElement,
    rowSet1: ones[1].parentElement as HTMLElement,
  }
}

// A row's cells (chunk 54a): the weight box, the reps cell and the RIR cell are buttons that open a field or a picker, and the ⋯ opens the
// set type picker (a stage row has none).
function controlsOf(row: HTMLElement) {
  const q = within(row)
  return {
    weight: asButton(q.getByRole('button', { name: '—' })),
    reps: asButton(q.getByRole('button', { name: 'Set rep target' })),
    rir: asButton(q.getByRole('button', { name: /^RIR/ })),
    options: q.queryByRole('button', { name: /^Options for / }) as HTMLButtonElement | null,
  }
}

function lastUpdate() {
  const call = updateSetMutate.mock.calls[updateSetMutate.mock.calls.length - 1]
  return call?.[0] as { id: string; changes: Record<string, unknown> } | undefined
}
const updatedIds = () => updateSetMutate.mock.calls.map(([vars]) => (vars as { id: string }).id)

// The pickers a tap opens are dialogs: these drive the one control each check needs. AMRAP on the reps cell; NONE on the RIR cell.
const inDialog = () => within(screen.getByRole('dialog'))
function setRepsToAmrap(row: HTMLElement) {
  fireEvent.click(controlsOf(row).reps)
  fireEvent.click(inDialog().getByRole('button', { name: 'AMRAP' }))
  fireEvent.click(inDialog().getByRole('button', { name: 'SET AMRAP' }))
}
function clearRir(row: HTMLElement) {
  fireEvent.click(controlsOf(row).rir)
  fireEvent.click(inDialog().getByRole('button', { name: 'NONE' }))
  fireEvent.click(inDialog().getByRole('button', { name: 'CLEAR TARGET' }))
}

// The viewed (populated) cycle can be edited: every control the screen has for
// it is there and live, and each edit reaches the hook with THIS cycle's own
// row. Each call starts from a closed screen and leaves it closed.
function expectEditable(cycle: number, slot = 0) {
  // — the page: CYCLE ⋯ is there, and its sheet holds the cycle's deload
  expect(banner()).toBeNull()
  expect(weekMenuButton()).not.toBeNull()
  openWeekMenu()
  expect(screen.getByText('MARK CYCLE AS DELOAD')).toBeTruthy()
  closeSheet()

  // — the session's own DELOAD toggle (above the cards)
  const sessionDeload = asButton(labelled('Mark this session as deload'))
  expect(sessionDeload.disabled).toBe(false)
  setDeloadMutate.mockClear()
  fireEvent.click(sessionDeload)
  expect(setDeloadMutate).toHaveBeenCalledTimes(1)
  expect((setDeloadMutate.mock.calls[0][0] as { weekPlanId: string }).weekPlanId).toBe(planId(cycle, slot))
  setDeloadMutate.mockClear()

  // — each exercise: "+" is live; the exercise has no ⋯ (an exercise is changed in CHANGE THE PROGRAM) and the page no ADD EXERCISE
  for (const name of [EX1, EX2]) {
    expect(asButton(labelled(`Add set to ${name}`)).disabled).toBe(false)
    expect(maybeLabelled(`${name} options`)).toBeNull()
  }
  expect(screen.queryByText('ADD EXERCISE')).toBeNull()

  // — "+" writes this cycle's own plan row, for this slot's own exercise row, as the next head number after set 2
  addSetMutate.mockClear()
  fireEvent.click(labelled(`Add set to ${EX1}`))
  expect(addSetMutate).toHaveBeenCalledTimes(1)
  expect(addSetMutate.mock.calls[0][0]).toMatchObject({ weekPlanId: planId(cycle, slot), programExerciseId: `pe-c${cycle}-s${slot}`, setNumber: 3 })
  addSetMutate.mockClear()

  // — every set row (heads, the other exercise's): weight, reps and RIR live, and a ⋯ button;
  //   the stage row's cells are live too, and it has no ⋯ (the head's stepper changes how many stages: G55)
  const rows = setRows()
  for (const row of [rows.benchSet1, rows.benchSet2, rows.rowSet1]) {
    const c = controlsOf(row)
    expect(c.weight.disabled).toBe(false)
    expect(c.reps.disabled).toBe(false)
    expect(c.rir.disabled).toBe(false)
    expect(c.options).not.toBeNull()
  }
  const stageCells = controlsOf(rows.stage)
  expect(stageCells.weight.disabled).toBe(false)
  expect(stageCells.reps.disabled).toBe(false)
  expect(stageCells.rir.disabled).toBe(false)
  expect(stageCells.options).toBeNull()

  // — the first set's cells each write THIS cycle's own set(s)
  updateSetMutate.mockClear()
  fireEvent.click(controlsOf(rows.benchSet1).weight)
  fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '100' } })
  fireEvent.blur(screen.getByLabelText('Weight target'))
  expect(updateSetMutate).toHaveBeenCalledTimes(1)
  expect(lastUpdate()).toEqual({ id: setId(cycle, slot), changes: { targetWeight: 100 } })
  // reps: the picker's "Use for all" starts ticked, so both of Bench Press's heads are written, and no stage and no other exercise
  updateSetMutate.mockClear()
  setRepsToAmrap(rows.benchSet1)
  expect(updatedIds()).toEqual([setId(cycle, slot), `set2-c${cycle}-s${slot}`])
  expect(lastUpdate()?.changes).toEqual({ repMin: null, repMax: null, isAmrap: true })
  // RIR: the same, from the RIR picker
  updateSetMutate.mockClear()
  clearRir(rows.benchSet1)
  expect(updatedIds()).toEqual([setId(cycle, slot), `set2-c${cycle}-s${slot}`])
  expect(lastUpdate()?.changes).toEqual({ targetRir: null, targetRirMax: null })
  // ... and a stage's own cells write that stage alone (its picker has no "Use for all")
  updateSetMutate.mockClear()
  clearRir(rows.stage)
  expect(updatedIds()).toEqual([`stage-c${cycle}-s${slot}`])
  updateSetMutate.mockClear()

  // — a head's ⋯ opens the set type picker, with Cues and REMOVE THIS SET; it holds none of the old menu's exercise or stage controls
  fireEvent.click(controlsOf(rows.benchSet1).options!)
  expect(screen.getByRole('dialog', { name: 'What is this set?' })).toBeTruthy()
  expect(screen.getByText('Cues')).toBeTruthy()
  expect(screen.getByText('REMOVE THIS SET')).toBeTruthy()
  expect(maybeLabelled('Add stage')).toBeNull()
  expect(screen.queryByText('STAGE KIND')).toBeNull()
  closeSheet()
  expect(screen.queryByText('REMOVE THIS SET')).toBeNull()
}

// The viewed (populated) cycle is past: the banner shows, and every control that
// would change it is gone or dead — nothing opens, nothing reaches a hook.
function expectReadOnly() {
  // — the page: the lock line in the cycle's word, no COPY, no CYCLE ⋯ (board 1c: a past week has no action row), no offer
  expectCycleLockLine()
  expect(weekMenuButton()).toBeNull()
  expect(screen.queryByText('COPY')).toBeNull()
  expect(screen.queryByText('MARK CYCLE AS DELOAD')).toBeNull()
  expect(screen.queryByText(/APPLY THIS CHANGE/)).toBeNull()

  // — the session's own DELOAD toggle stays on screen but dead
  const sessionDeload = asButton(labelled('Mark this session as deload'))
  expect(sessionDeload.disabled).toBe(true)
  setDeloadMutate.mockClear()
  fireEvent.click(sessionDeload)
  expect(setDeloadMutate).not.toHaveBeenCalled()

  // — no ADD EXERCISE, no exercise header controls, no "+", no ⋯ buttons or menus anywhere
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
  expect(screen.queryByText('STAGE KIND')).toBeNull()
  expect(screen.queryByText('TAGS')).toBeNull()
  expect(screen.queryByText('+ CUSTOM')).toBeNull()
  expect(screen.queryByText('REMOVE THIS SET')).toBeNull()
  // The run-wide fields (chunk 30) have no control here either: no REST / TEMPO / unit group, no link toggle between the exercises.
  expect(maybeLabelled('Every week')).toBeNull()
  expect(maybeLabelled('Weight unit')).toBeNull()
  expect(screen.queryByText('LINK AS SUPERSET')).toBeNull()

  // — the set rows themselves are still drawn, every cell on screen but dead, and opening nothing
  expect(setNumberOnes()).toHaveLength(2)
  expect(screen.getByText('↳')).toBeTruthy()
  updateSetMutate.mockClear()
  for (const row of Object.values(setRows())) {
    const c = controlsOf(row)
    expect(c.weight.disabled).toBe(true)
    expect(c.reps.disabled).toBe(true)
    expect(c.rir.disabled).toBe(true)
    expect(c.options).toBeNull()
    for (const cell of [c.weight, c.reps, c.rir]) fireEvent.click(cell)
  }
  expect(screen.queryByLabelText('Weight target')).toBeNull()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(updateSetMutate).not.toHaveBeenCalled()
  expect(addSetMutate).not.toHaveBeenCalled()
  expect(removeSetMutate).not.toHaveBeenCalled()
  expect(changeTypeMutate).not.toHaveBeenCalled()

  // — COMPACT is gone, so there is no REMOVE LAST SET to be dead either
  expect(screen.queryByText('COMPACT')).toBeNull()
  expect(allLabelled('Remove last set')).toHaveLength(0)
}

// An EMPTY cycle (plan rows, no exercises) that is current or later: COPY is offered and opens the sheet for THIS
// cycle, which names the cycle it copies from (the last planned normal, non-empty cycle before it: cycle 1, the others hold no sets).
// An empty cycle has no set to put numbers into, so the sheet says so and sends nothing (chunk 52: COPY writes into sets that
// exist; it no longer copies a whole empty week). The cycle can otherwise be edited (its cycle action, its session toggle); it has
// no ADD EXERCISE (chunk 54a: an exercise is added in CHANGE THE PROGRAM).
function expectEmptyCycleEditable(cycle: number) {
  expect(banner()).toBeNull()
  expect(weekMenuButton()).not.toBeNull()
  expect(asButton(labelled('Mark this session as deload')).disabled).toBe(false)
  expect(screen.queryByText('ADD EXERCISE')).toBeNull()
  expect(screen.getByText('COPY')).toBeTruthy()
  fireEvent.click(screen.getByText('COPY'))
  const sheet = within(screen.getByRole('dialog'))
  expect(sheet.getByText(`CYCLE ${cycle} · FROM CYCLE 1'S PLAN`)).toBeTruthy()
  expect(sheet.getByText('NOTHING TO COPY')).toBeTruthy()
  expect(asButton(sheet.getByText('NOTHING TO COPY')).disabled).toBe(true)
  closeSheet()
}

// An EMPTY past cycle: nothing to copy into — no COPY — and nothing else to change it with either.
function expectEmptyCycleReadOnly() {
  expectCycleLockLine()
  expect(asButton(labelled('Mark this session as deload')).disabled).toBe(true)
  expect(screen.queryByText('COPY')).toBeNull()
  expect(weekMenuButton()).toBeNull()
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
      expect(isOpen('CYCLE 2')).toBe(false) // planned ahead: its tile is there, and it isn't the one open
      expect(isMarkedCurrent('CYCLE 1')).toBe(true)
      expect(banner()).toBeNull()
      expectEditable(1)
    })

    it('cycle 1 carries no lock line (neither "PAST CYCLE · READ ONLY" nor "PAST WEEK · READ ONLY") however it is reached (the calendar week would flag it past)', () => {
      setUpSequenceRun(NINE_DAY)
      renderPlan()

      goTo(1)
      expect(banner()).toBeNull()
      expect(screen.queryByText(CYCLE_LOCK_LINE)).toBeNull()
      expect(screen.queryByText(WEEK_LOCK_LINE)).toBeNull()
      expect(weekMenuButton()).not.toBeNull()
    })

    it('opening it plans nothing: the current cycle has its rows, and no other cycle is planned by being the calendar week', () => {
      setUpSequenceRun(NINE_DAY)
      renderPlan()
      expect(plannedWeeks()).toEqual([])
    })

    it('plans the current cycle only when it has no rows — not the calendar week (2), and not a cycle that is already planned', () => {
      // cycle 2 has rows, cycle 1 (current) has none; the calendar says week 2
      setUpSequenceRun({ ...NINE_DAY, cyclesWithPlans: [2] })
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
      expect(isOpen('CYCLE 1')).toBe(false) // a past cycle: its tile is there, and it isn't the one open
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)
      expect(banner()).toBeNull()
      expectEditable(3)
      expect(plannedWeeks()).toEqual([]) // cycle 3 has its rows
    })

    it('cycle 3 without rows is the one cycle planned on opening: not the calendar week (1), not cycle 1 or 2, not 4', () => {
      setUpSequenceRun({ ...THREE_DAY, cyclesWithPlans: [1, 2, 4] })
      renderPlan()
      expectOpensOnTheCycleTodayShowsNext(THREE_DAY, 3)
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
    it('the last workout of cycle 3 gets done: the viewed cycle 3 turns read-only on the spot, and the set type picker that was open goes with it', () => {
      setUpSequenceRun(THREE_DAY)
      const view = renderPlan()
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)

      // On the current cycle: open a set's ⋯ (the set type picker).
      const rows = setRows()
      fireEvent.click(controlsOf(rows.benchSet1).options!)
      expect(screen.getByText('REMOVE THIS SET')).toBeTruthy()

      // The last workout of cycle 3 (C, on the Sunday) is done; Plan's reads refresh.
      lastDoneOrSkipped = sessionFor(THREE_DAY.layout, { status: 'completed', cycle: 3, position: 2, on: dayOf(1, 'Sunday') })
      view.rerender(ui())

      // The view stays where it was; what it is has changed.
      expect(screen.getByText('CYCLE 3')).toBeTruthy()
      expect(isMarkedCurrent('CYCLE 3')).toBe(false)
      expectReadOnly() // banner, no cycle action, dead cells, no ⋯ buttons
      expect(screen.queryByText('REMOVE THIS SET')).toBeNull() // the picker that was open
      // ... and the next cycle is the current one now.
      goTo(4)
      expect(isMarkedCurrent('CYCLE 4')).toBe(true)
      expectEditable(4)
    })

    // Chunk 52: COPY's sheet and WEEK ⋯'s sheet belong to a week that has them; a past cycle has neither (board 1c), so an open one goes.
    // Chunk 54a: a set's pickers belong to a set that can be edited, so an open one goes too, whichever cell opened it.
    for (const [name, open] of [
      ['COPY', () => fireEvent.click(screen.getByText('COPY'))],
      ['WEEK ⋯', () => openWeekMenu()],
      ['rep target picker', () => fireEvent.click(controlsOf(setRows().benchSet1).reps)],
      ['RIR target picker', () => fireEvent.click(controlsOf(setRows().benchSet1).rir)],
      ['set type picker', () => fireEvent.click(controlsOf(setRows().benchSet1).options!)],
    ] as const) {
      it(`the ${name} sheet that is open goes with it: the cycle turns read-only under it`, () => {
        setUpSequenceRun(THREE_DAY)
        const view = renderPlan()
        expect(isMarkedCurrent('CYCLE 3')).toBe(true)
        open()
        expect(screen.getByRole('dialog')).toBeTruthy()

        lastDoneOrSkipped = sessionFor(THREE_DAY.layout, { status: 'completed', cycle: 3, position: 2, on: dayOf(1, 'Sunday') })
        view.rerender(ui())

        expect(isMarkedCurrent('CYCLE 3')).toBe(false)
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(screen.queryByText('COPY')).toBeNull()
      })
    }
  })

  describe('empty cycles: what can be copied into', () => {
    it('the scenario: cycle 1 planned, cycles 2–4 empty; the current cycle is 3', () => {
      expect(inputsOf(EMPTY_AHEAD).todayShowsNext).toBe('A (cycle 3, slot 1), due Sunday 2026-09-20')
      expect(allPlansOf(EMPTY_AHEAD).map((w) => `${w.weekNumber}:${w.sets.length}`)).toEqual(
        ['1:4', '1:4', '1:4', '2:0', '2:0', '2:0', '3:0', '3:0', '3:0', '4:0', '4:0', '4:0'],
      )
    })

    it('COPY is offered on the current empty cycle (3) and on a later one (4), each opening its own cycle and naming cycle 1 as the source', () => {
      setUpSequenceRun(EMPTY_AHEAD)
      renderPlan()

      expectOpensOnTheCycleTodayShowsNext(EMPTY_AHEAD, 3)
      expect(isMarkedCurrent('CYCLE 3')).toBe(true)
      expectEmptyCycleEditable(3)
      goTo(4)
      expect(isMarkedCurrent('CYCLE 4')).toBe(false)
      expectEmptyCycleEditable(4)
    })

    it('COPY is not offered on a past empty cycle (2), though cycle 1 would be a valid source for it', () => {
      setUpSequenceRun(EMPTY_AHEAD)
      renderPlan()

      goTo(2)
      expect(isMarkedCurrent('CYCLE 2')).toBe(false)
      expectEmptyCycleReadOnly()
      // ... and back on the current cycle it is there again.
      goTo(3)
      expect(screen.getByText('COPY')).toBeTruthy()
    })

    it('the cycle moving on takes COPY away from the cycle that was current', () => {
      setUpSequenceRun(EMPTY_AHEAD)
      const view = renderPlan()
      expect(screen.getByText('COPY')).toBeTruthy()

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
      expect(weekMenuButton()).toBeNull()
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
    it('a sequence run: no week tiles and nothing planned while it is out, then only the current cycle is planned (it has no rows here)', () => {
      setUpSequenceRun({ ...NINE_DAY, cyclesWithPlans: [2] })
      readOverrides.programs = { data: undefined, isLoading: true }
      const view = renderPlan()

      // While the programs are out: the spinner, no screen, no calendar-week plan, no last-event read.
      expect(view.container.querySelector('.animate-spin')).not.toBeNull()
      expect(screen.queryByText(WEEK_OR_CYCLE_HEADER)).toBeNull()
      expect(planWeekMutate).not.toHaveBeenCalled()
      expect(lastEventHook).not.toHaveBeenCalled()

      // The programs answer: the sequence program. The page opens on cycle 1 (the
      // calendar says week 2) and plans cycle 1 — and only cycle 1, which has no rows
      // while cycle 2 has (a cycle with rows is never planned again).
      readOverrides = {}
      view.rerender(ui())
      expect(screen.getByText('CYCLE 1')).toBeTruthy()
      expect(screen.queryByText('WEEK 2')).toBeNull()
      expect(isOpen('CYCLE 1')).toBe(true)
      expect(plannedWeeks()).toEqual([1])
    })

    it('a weekday run: nothing is planned while it is out; then the page opens on the calendar week, and plans it only when it has no rows', () => {
      setUpWeekdayRun()
      allPlans = allPlans.filter((w) => !(w.weekNumber === 3 && w.sequencePosition === undefined))
      readOverrides.programs = { data: undefined, isLoading: true }
      const view = renderPlan()

      expect(view.container.querySelector('.animate-spin')).not.toBeNull()
      expect(screen.queryByText(WEEK_OR_CYCLE_HEADER)).toBeNull()
      expect(planWeekMutate).not.toHaveBeenCalled()

      readOverrides = {}
      view.rerender(ui())
      expect(screen.getByText('WEEK 3')).toBeTruthy()
      expect(isOpen('WEEK 3')).toBe(true)
      // week 3 has no rows here (it is the current week; weeks 1, 2 and 4 do): the calendar week is planned, and no other
      expect(plannedWeeks()).toEqual([3])
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
        // the second line is the reason (SPEC Errors (15)); none came with this failure, so P1.2-5's words
        expect(screen.getByText('Something went wrong.')).toBeTruthy()
        expect(screen.queryByText('Check your connection and try again.')).toBeNull()
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

    it('the real reason is the second line: a Supabase error object\'s message, on each read, verbatim', () => {
      const reasons: [string, () => void][] = [
        ['the programs read', () => { readOverrides = { programs: { data: undefined, isError: true, error: { message: 'JWT expired' } } } }],
        ['the sequence read', () => { readOverrides = { items: { data: undefined, isError: true, error: { message: 'permission denied for table v2_program_sequence_items' } } } }],
        ['the week plans read', () => { readOverrides = { plans: { data: undefined, isError: true, error: { message: 'canceling statement due to statement timeout' } } } }],
        ['the last-event read', () => { readOverrides = { lastEvent: { data: undefined, isError: true, error: { message: 'connection reset' } } } }],
      ]
      const messages = ['JWT expired', 'permission denied for table v2_program_sequence_items', 'canceling statement due to statement timeout', 'connection reset']
      reasons.forEach(([, fail], i) => {
        cleanup()
        setUpSequenceRun(THREE_DAY)
        fail()
        renderPlan()
        expect(screen.getByText("COULDN'T LOAD PLAN")).toBeTruthy()
        expect(screen.getByText(messages[i])).toBeTruthy()
        expect(screen.queryByText('Something went wrong.')).toBeNull()
        expect(screen.queryByText('You may be offline.')).toBeNull()
      })
    })

    it('"You may be offline." is the reason only when the phone is offline and the read gave no message; a real message still wins', () => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      try {
        setUpSequenceRun(THREE_DAY)
        readOverrides = { programs: { data: undefined, isError: true } }
        renderPlan()
        expect(screen.getByText('You may be offline.')).toBeTruthy()
        cleanup()
        setUpSequenceRun(THREE_DAY)
        readOverrides = { programs: { data: undefined, isError: true, error: { message: 'Failed to fetch' } } }
        renderPlan()
        expect(screen.getByText('Failed to fetch')).toBeTruthy()
        expect(screen.queryByText('You may be offline.')).toBeNull()
      } finally {
        delete (navigator as unknown as Record<string, unknown>).onLine
      }
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
      expect(isOpen('CYCLE 1')).toBe(true) // nothing is planned for it (there is no workout), so its tile says NOT PLANNED
      expect(banner()).toBeNull()
      // Chunk 33: one line for a run with no schedule, whichever type it is.
      expect(screen.getByText('NO WORKOUTS SCHEDULED')).toBeTruthy()
      expect(screen.queryByText('NO SLOTS SCHEDULED')).toBeNull()
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
    expect(weekMenuButton()?.getAttribute('aria-label')).toBe('Week 3 options')
    // Week 3 has its rows, so opening plans nothing (chunk 52: no week is planned by being viewed, and week 1 no longer on the way).
    expect(plannedWeeks()).toEqual([])
    // The weekday run never asked for a last event.
    expect(lastEventHook).not.toHaveBeenCalled()
    // ... and its weeks before the calendar week are still the past ones, with the week's word on the lock line.
    openWeekTile('WEEK 2')
    expect(isOpen('WEEK 2')).toBe(true)
    expect(screen.queryByText(WEEK_LOCK_LINE)).not.toBeNull()
    expect(screen.queryByText(CYCLE_LOCK_LINE)).toBeNull()
  })
})

// Review 1, F4. The lock line of a past week is "PAST WEEK · READ ONLY" on board 1c, and SPEC Scheduling → Sequence says the cycle replaces the
// week in labels, so a sequence run's past cycle says CYCLE. The first attempt drew WEEK on both, and the tests above pinned it. The two runs are
// told apart here on the same component in turn, so a line that hard-codes either word fails one of them.
describe('PlanPage — the lock line names the run\'s own unit (review 1, F4)', () => {
  const lockLine = () => screen.getByText(/^PAST (WEEK|CYCLE) · READ ONLY$/)

  it('a sequence run\'s past cycle reads PAST CYCLE · READ ONLY and a weekday run\'s past week PAST WEEK · READ ONLY: the whole line, one word each', () => {
    setUpSequenceRun(THREE_DAY)
    renderPlan()
    goTo(2) // cycle 3 is the current cycle, so cycle 2 is a past one
    expect(isMarkedCurrent('CYCLE 3')).toBe(false)
    expect(lockLine().textContent).toBe(CYCLE_LOCK_LINE)
    expect(screen.queryByText(WEEK_LOCK_LINE)).toBeNull()
    cleanup()

    setUpWeekdayRun()
    renderPlan()
    openWeekTile('WEEK 2') // week 3 is the current week, so week 2 is a past one
    expect(isOpen('WEEK 2')).toBe(true)
    expect(lockLine().textContent).toBe(WEEK_LOCK_LINE)
    expect(screen.queryByText(CYCLE_LOCK_LINE)).toBeNull()
  })

  it('a cycle that passed unplanned is a past cycle too: the note and the lock line both speak of the cycle (cycle 1 has no rows; cycle 3 is current)', () => {
    const missedFirst: Scenario = { ...THREE_DAY, cyclesWithPlans: [2, 3, 4] }
    expect(allPlansOf(missedFirst).some((w) => w.weekNumber === 1)).toBe(false)
    setUpSequenceRun(missedFirst)
    renderPlan()

    goTo(1)
    expect(screen.getByText("Cycle 1 wasn't planned")).toBeTruthy()
    expect(lockLine().textContent).toBe(CYCLE_LOCK_LINE)
    expect(screen.queryByText(WEEK_LOCK_LINE)).toBeNull()
  })

  it('the current cycle and a cycle planned ahead carry no lock line in either word', () => {
    setUpSequenceRun(THREE_DAY)
    renderPlan()
    expect(isMarkedCurrent('CYCLE 3')).toBe(true)
    expect(banner()).toBeNull()
    goTo(4)
    expect(banner()).toBeNull()
  })
})
