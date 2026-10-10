// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
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
// uses: only the data hooks are mocked). What each test proves, and the break
// that fails it (each injected and restored from a backup in the chunk report):
//   - the opening view, the current-cycle marker, the read-only banner and the
//     editing controls all follow the sequence's cycle (keep the calendar week
//     → the cycle 1 / cycle 3 tests fail);
//   - a skipped workout moves the current cycle exactly as a done one does
//     (ignore skipped in Plan's last-event step → the skipped test fails);
//   - while the last-event read is out, no cycle is shown or marked current;
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

let activeMeso: Mesocycle
let program: Program
let workoutDays: WorkoutDay[] = []
let sequenceItems: SequenceItem[] = []
let allPlans: WeekPlan[] = []
// undefined = the last-event query hasn't answered; null = it answered "none".
let lastDoneOrSkipped: Session | null | undefined = null

const updateSetMutate = vi.fn()
const planWeekMutate = vi.fn()
const lastEventHook = vi.fn((_mesoId: string) => ({ data: lastDoneOrSkipped }))

vi.mock('../programs/useMesos', () => ({
  useMesos: () => ({ data: [activeMeso], isLoading: false }),
}))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: workoutDays, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: sequenceItems, isLoading: false }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// Today's own hook, the one read Plan adds on a sequence run.
vi.mock('../gym/useSession', () => ({
  useLastDoneOrSkippedSession: (mesoId: string) => lastEventHook(mesoId),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: allPlans.filter((w) => w.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: allPlans, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: planWeekMutate, isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: updateSetMutate }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useCopyWorkoutFromPreviousWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

afterEach(() => {
  updateSetMutate.mockClear()
  planWeekMutate.mockClear()
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
  cyclesWithPlans: number[]
  lastEvent: LastEvent | null | undefined // undefined = not answered yet
}

const planId = (cycle: number, position: number) => `wp-c${cycle}-s${position}`
const setId = (cycle: number, position: number) => `set-c${cycle}-s${position}`

function plansFor(layout: (string | null)[], cycles: number[]): WeekPlan[] {
  const plans: WeekPlan[] = []
  for (const cycle of cycles) {
    layout.forEach((workoutDayId, position) => {
      if (!workoutDayId) return
      const pe: ProgramExercise = {
        id: `pe-c${cycle}-s${position}`, workoutDayId, userId: 'user-1', exerciseId: 'ex-x', position: 0, weightUnit: null, exercise: EX_X,
      }
      const set: WeekPlanSet = {
        id: setId(cycle, position), weekPlanId: planId(cycle, position), userId: 'user-1', programExerciseId: pe.id, setNumber: 1,
        targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null,
      }
      plans.push({
        id: planId(cycle, position), userId: 'user-1', mesocycleId: 'meso-1', workoutDayId, weekNumber: cycle,
        sequencePosition: position, isDeload: false, notes: null, exercises: [pe], sets: [set], createdAt: '2026-01-01T00:00:00Z',
      })
    })
  }
  return plans
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
  allPlans = plansFor(s.layout, s.cyclesWithPlans)
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

function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <PlanPage />
    </MemoryRouter>,
  )
}

// ─── Screen helpers ──────────────────────────────────────────────────────────

const READ_ONLY_BANNER = 'PAST WEEK — READ ONLY'
const banner = () => screen.queryByText(READ_ONLY_BANNER)
// The week stepper's chip: filled with the accent colour only on the current cycle.
const chipOf = (text: string) => screen.getByText(text).parentElement as HTMLElement
const isMarkedCurrent = (text: string) => chipOf(text).style.background === 'var(--accent)'
const weightButton = () => screen.getByRole('button', { name: '—' }) as HTMLButtonElement

function goTo(cycle: number) {
  for (let guard = 0; guard < 20 && screen.queryByText(`CYCLE ${cycle}`) === null; guard++) {
    const showing = Number((screen.getByText(/^CYCLE \d+$/).textContent ?? '').replace('CYCLE ', ''))
    fireEvent.click(screen.getByLabelText(showing > cycle ? 'Previous week' : 'Next week'))
  }
  expect(screen.getByText(`CYCLE ${cycle}`)).toBeTruthy()
}

// The viewed cycle can be edited: no read-only banner, the cycle action is
// offered, and a real weight edit reaches the hook with THIS cycle's own set.
function expectEditable(cycle: number, slot = 0) {
  expect(banner()).toBeNull()
  expect(screen.getByText('MARK CYCLE AS DELOAD')).toBeTruthy()
  expect(weightButton().disabled).toBe(false)
  updateSetMutate.mockClear()
  fireEvent.click(weightButton())
  fireEvent.change(screen.getByLabelText('Weight target'), { target: { value: '100' } })
  fireEvent.blur(screen.getByLabelText('Weight target'))
  expect(updateSetMutate).toHaveBeenCalledTimes(1)
  expect((updateSetMutate.mock.calls[0][0] as { id: string }).id).toBe(setId(cycle, slot))
  updateSetMutate.mockClear()
}

// The viewed cycle is past: the banner shows, the cycle action is gone, and the
// weight cell is dead (nothing opens, nothing reaches the hook).
function expectReadOnly() {
  expect(banner()).not.toBeNull()
  expect(screen.queryByText('MARK CYCLE AS DELOAD')).toBeNull()
  expect(weightButton().disabled).toBe(true)
  updateSetMutate.mockClear()
  fireEvent.click(weightButton())
  expect(screen.queryByLabelText('Weight target')).toBeNull()
  expect(updateSetMutate).not.toHaveBeenCalled()
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
      expect(planWeekMutate.mock.calls.map(([v]) => (v as { weekNumber: number }).weekNumber)).toEqual([1])
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
      expect(planWeekMutate.mock.calls.map(([v]) => (v as { weekNumber: number }).weekNumber)).toEqual([3])
    })

    it('cycles 1 and 2 are past and read-only (banner, no cycle action, nothing editable); cycle 4 is editable', () => {
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

  describe('while the last-event read has not answered', () => {
    it('no cycle is shown, none is marked current and no week is read-only or editable: the loading spinner shows instead', () => {
      const loading: Scenario = { ...THREE_DAY, lastEvent: undefined }
      expect(inputsOf(loading).lastEvent).toBe('not answered yet')
      setUpSequenceRun(loading)
      const { container } = renderPlan()

      expect(lastEventHook).toHaveBeenCalledWith('meso-1')
      expect(screen.queryByText(/^CYCLE \d+$/)).toBeNull()
      expect(screen.queryByText(/^WEEK \d+$/)).toBeNull()
      expect(banner()).toBeNull()
      expect(screen.queryByText('MARK CYCLE AS DELOAD')).toBeNull()
      expect(container.querySelector('.animate-spin')).not.toBeNull()
      // ... and nothing was planned for a cycle the screen can't name yet.
      expect(planWeekMutate).not.toHaveBeenCalled()
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
  // A weekday run (Wednesday: Workout A) started on a Monday, viewed on the
  // Wednesday of its third calendar week, with a completed session on record.
  // The sequence mocks are deliberately left holding a sequence whose rule would
  // give cycle 1 (A done in cycle 1 → B next, in cycle 1), so a weekday run that
  // wrongly read its last event would not land on week 3.
  it('uses the calendar week (WEEK 3, current, editable) even when a last workout exists, and makes no last-event read at all', () => {
    const weekdayRun: Scenario = {
      runStart: dayOf(1, 'Monday'),
      today: dayOf(3, 'Wednesday'),
      layout: ['wd-a', 'wd-b'],
      cyclesWithPlans: [1],
      lastEvent: { status: 'completed', cycle: 1, position: 0, on: dayOf(2, 'Wednesday') },
    }
    setUpSequenceRun(weekdayRun)
    // The weekday run's own rows: one plan row per week for the workout on Wednesdays.
    const weekdayRow = (week: number): WeekPlan => {
      const pe: ProgramExercise = { id: `pe-w${week}`, workoutDayId: 'wd-a', userId: 'user-1', exerciseId: 'ex-x', position: 0, weightUnit: null, exercise: EX_X }
      const set: WeekPlanSet = {
        id: `set-w${week}`, weekPlanId: `wp-w${week}`, userId: 'user-1', programExerciseId: pe.id, setNumber: 1,
        targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, targetWeight: null,
      }
      return {
        id: `wp-w${week}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-a', weekNumber: week,
        isDeload: false, notes: null, exercises: [pe], sets: [set], createdAt: '2026-01-01T00:00:00Z',
      }
    }
    allPlans = [...allPlans, weekdayRow(1), weekdayRow(2), weekdayRow(3), weekdayRow(4)]
    program = { ...program, name: 'Test Weekday Program', schedule: { ...EMPTY_SCHEDULE, wednesday: 'wd-a' }, scheduleType: 'weekday' }

    expect(inputsOf(weekdayRun).calendarWeekOfTheRun).toBe(3)
    expect(inputsOf(weekdayRun).lastEvent).toBe('completed A (cycle 1, slot 1) on Wednesday 2026-09-23')
    expect(program.scheduleType).toBe('weekday')

    renderPlan()

    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.queryByText(/^CYCLE \d+$/)).toBeNull()
    expect(isMarkedCurrent('WEEK 3')).toBe(true)
    expect(banner()).toBeNull()
    expect(screen.getByText('MARK WEEK AS DELOAD')).toBeTruthy()
    // The week it settles on (a weekday run has always planned week 1 on its way
    // there, before its opening effect moves the view; that is not asserted).
    const plannedWeeks = planWeekMutate.mock.calls.map(([v]) => (v as { weekNumber: number }).weekNumber)
    expect(plannedWeeks[plannedWeeks.length - 1]).toBe(3)
    // The weekday run never asked for a last event.
    expect(lastEventHook).not.toHaveBeenCalled()
    // ... and its weeks before the calendar week are still the past ones.
    fireEvent.click(screen.getByLabelText('Previous week'))
    expect(screen.getByText('WEEK 2')).toBeTruthy()
    expect(banner()).not.toBeNull()
  })
})
