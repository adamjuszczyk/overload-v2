// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { addDays, format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, Program, ProgramExercise, ProgramSet, SequenceItem, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import type { PlanSession } from './weekViewLogic'

// Chunk 54b (TASKS-1.2 "Plan's week view: sessions, states, the stable-week line, legend and marks, read-only weeks"; SPEC Screens → Plan screen,
// Weeks and copying [1.2]; boards 1, 1a, 1c, 1d, 10, 11). The session chips and their states, the header's states, the session ⋯ (deload and
// MOVE THIS SESSION), a stable week's THIS WEEK ONLY line and its link, the legend, a missed week and a sequence run's slots, read through the
// real PlanPage tree with only the data hooks mocked (the seam every PlanPage test uses). The marks themselves are PlanPage.highlights.test.tsx's
// (and weekPlanning.changes.test.ts proves the rules); the deload mark's own payloads are PlanPage.deload.test.tsx's.
//
// Dates are derived from the run's start Monday and proven to be the weekday they claim (Checks that lied #21). The run is in its week 3.
// MoveSessionControl is the REAL one (with the session hooks it reads mocked): this is where its row in the menu is proven.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

const START_MONDAY = startOfWeek(subWeeks(new Date(), 2), { weekStartsOn: 1 }) // today is in week 3 of the run
const startDate = format(START_MONDAY, 'yyyy-MM-dd')
const DOW = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const
function on(week: number, day: (typeof DOW)[number]): string {
  const date = addDays(START_MONDAY, (week - 1) * 7 + DOW.indexOf(day))
  expect(format(date, 'EEEE').toLowerCase(), `${format(date, 'yyyy-MM-dd')} is not a ${day}`).toBe(day)
  return format(date, 'yyyy-MM-dd')
}

const meso: Mesocycle = { id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1', status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z' }
const wd = (id: string, name: string, position: number): WorkoutDay => ({ id, programId: 'prog-1', userId: 'user-1', name, position, exercises: [] })
const PUSH = wd('wd-push', 'Push 1', 0)
const PULL = wd('wd-pull', 'Pull 1', 1)
const LEGS = wd('wd-legs', 'Legs', 2)
// Push is on Monday AND Thursday (one shared plan row, G14), Pull on Tuesday, Legs on Friday.
const SCHEDULE = { ...EMPTY_SCHEDULE, monday: 'wd-push', tuesday: 'wd-pull', thursday: 'wd-push', friday: 'wd-legs' }

const program = (over: Partial<Program> = {}): Program => ({
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: SCHEDULE, workoutDays: [],
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType: 'week_dependent', ...over,
})

const exercise = (id: string, name: string) => ({
  id, userId: 'user-1', name, muscleGroup: 'quads' as const, isArchived: false, createdAt: '', muscleSubgroups: null,
  movementPattern: null, status: 'active' as const, sourceLibraryId: null, lostAt: null,
})
// The program exercise's id and the catalogue exercise's id differ on purpose (CHANGE EVERY WEEK → carries the catalogue's).
const peOf = (workoutDayId: string, id: string, exerciseId: string, name: string, position = 0): ProgramExercise => ({
  id, workoutDayId, userId: 'user-1', exerciseId, position, weightUnit: null, exercise: exercise(exerciseId, name),
})
const PE_PUSH = peOf('wd-push', 'pe-bench', 'ex-bench', 'Bench Press')
const PE_PULL = peOf('wd-pull', 'pe-row', 'ex-row', 'Row')
const PE_LEGS = peOf('wd-legs', 'pe-leg-press', 'ex-leg-press', 'Leg Press')
const PE_CURL = peOf('wd-legs', 'pe-curl', 'ex-curl', 'Leg Curl', 1)

const wset = (id: string, programExerciseId: string, setNumber: number, over: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp', userId: 'user-1', programExerciseId, setNumber, targetRir: 2, isDropset: false, parentWeekPlanSetId: null,
  stageIndex: 0, isWarmup: false, targetWeight: 100, repMin: 10, repMax: 10, ...over,
})
const planRow = (week: number, workoutDay: WorkoutDay, exercises: ProgramExercise[], sets: WeekPlanSet[], over: Partial<WeekPlan> = {}): WeekPlan => ({
  id: `wp-${week}-${workoutDay.id}${over.sequencePosition != null ? `-s${over.sequencePosition}` : ''}`, userId: 'user-1', mesocycleId: 'meso-1',
  workoutDayId: workoutDay.id, weekNumber: week, isDeload: false, notes: null, sets, exercises, createdAt: '2026-01-01T00:00:00Z', ...over,
})
const pset = (id: string, programExerciseId: string, position: number, over: Partial<ProgramSet> = {}): ProgramSet => ({
  id, userId: 'user-1', programExerciseId, position, isWarmup: false, stageKind: null, stageRestSeconds: null, parentProgramSetId: null,
  stageIndex: 0, repMin: 10, repMax: 10, isAmrap: false, restSeconds: null, createdAt: '', ...over,
})

// Each week of the run: Push, Pull and Legs (one set each), planned.
const weekOf = (week: number): WeekPlan[] => [
  planRow(week, PUSH, [PE_PUSH], [wset(`b${week}`, 'pe-bench', 1)]),
  planRow(week, PULL, [PE_PULL], [wset(`r${week}`, 'pe-row', 1)]),
  planRow(week, LEGS, [PE_LEGS], [wset(`l${week}`, 'pe-leg-press', 1)]),
]

const mockState = vi.hoisted(() => ({
  program: null as unknown as Program,
  days: [] as WorkoutDay[],
  all: [] as WeekPlan[],
  sessions: undefined as PlanSession[] | undefined,
  done: new Set<string>(),
  sequenceItems: [] as SequenceItem[],
  runCopy: {} as Record<string, ProgramExercise[] | undefined>,
  programSets: [] as ProgramSet[],
  today: '',
  online: true,
}))
const setDeloadMutate = vi.fn()
const planWeekMutate = vi.fn()
const moveMutate = vi.fn()
const clearMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [mockState.program], isLoading: false }),
  useWorkoutDays: () => ({ data: mockState.days, isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: mockState.runCopy[workoutDayId], isLoading: false }),
  useSequenceItems: () => ({ data: mockState.sequenceItems }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
  useProgramSets: (ids: string[]) => ({ data: mockState.programSets.filter((ps) => ids.includes(ps.programExerciseId)) }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => mockState.sessions }))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => mockState.done }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: 3, failed: false }) }))
vi.mock('./usePlanForward', () => ({ usePlanForward: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }), useDefaultHasSets: () => ({ data: undefined }) }))
vi.mock('../../hooks/useToday', () => ({ useToday: () => mockState.today }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mockState.online }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: mockState.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: mockState.all, isLoading: false }),
  usePlanWeek: () => ({ mutate: planWeekMutate, isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))
// The REAL MoveSessionControl, with the hooks it reads and writes through mocked.
vi.mock('../gym/useSession', () => ({
  useSessionsInRange: () => ({ data: [] }),
  useMoveSession: () => ({ mutate: moveMutate, isPending: false }),
  useClearMovedSession: () => ({ mutate: clearMutate, isPending: false }),
  useLastDoneOrSkippedSession: () => ({ data: null }),
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile, openSessionMenu, sessionMenuButton, sessionToggle, closeSheet } = await import('./planMenus.testutil')

beforeEach(() => {
  mockState.program = program()
  mockState.days = [PUSH, PULL, LEGS]
  mockState.all = [1, 2, 3].flatMap(weekOf)
  mockState.sessions = undefined
  mockState.done = new Set()
  mockState.sequenceItems = []
  mockState.runCopy = {}
  mockState.programSets = []
  mockState.today = on(3, 'monday')
  mockState.online = true
  for (const fn of [setDeloadMutate, planWeekMutate, moveMutate, clearMutate]) fn.mockClear()
})

function Where() {
  return <span data-testid="where">{useLocation().pathname + useLocation().hash}</span>
}
function renderPlan() {
  return render(
    <MemoryRouter initialEntries={['/plan']}>
      <Routes>
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/plan/change" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

const session = (week: number, workoutDay: WorkoutDay, day: (typeof DOW)[number], status: PlanSession['status'], movedTo: string | null = null): PlanSession => ({
  id: `s-${week}-${workoutDay.id}-${day}`, weekPlanId: `wp-${week}-${workoutDay.id}`, workoutDayId: workoutDay.id, date: on(week, day), movedToDate: movedTo, status,
})
const chip = (label: string) => screen.getByText(label).closest('button') as HTMLButtonElement
// A day of the move sheet (drawn after the page, so the last of the buttons that say it: Friday's chip is behind it).
const pickDay = (label: string) => {
  const all = screen.getAllByText(label)
  return all[all.length - 1].closest('button') as HTMLButtonElement
}
const ticked = (button: HTMLElement) => button.querySelector('svg[aria-label="done"]') !== null
// The header's right-hand state ("✓ DONE", "SKIPPED", "READ ONLY", "MOVED → SUN").
const headerStates = () => Array.from(document.querySelectorAll('[data-session-state]')).map((el) => el.textContent) // (the week tiles say DONE too)

// ═══════════════════════════════════════════════════════════════════════════════
// The session chips and the header's states (boards 1, 1c, 10, 11)
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — a session\'s state: on its chip and in its header', () => {
  // Week 3: Monday's Push is done, Tuesday's Pull skipped, Friday's Legs moved to Sunday; Thursday's Push has no session of its own
  // (it shares Monday's plan row, which is therefore locked).
  const states = () => [
    session(3, PUSH, 'monday', 'completed'),
    session(3, PULL, 'tuesday', 'skipped'),
    session(3, LEGS, 'friday', 'planned', on(3, 'sunday')),
    // The decoys: last week's sessions of the same workouts, and an in-progress session of week 3's Push on a day it isn't for.
    session(2, PULL, 'tuesday', 'completed'),
    session(2, LEGS, 'friday', 'skipped'),
  ]

  it('each chip says its own session\'s state, by plan and by day: ✓ on Monday, SKIPPED on Tuesday, MOVED on Friday, nothing on Thursday', () => {
    mockState.sessions = states()
    mockState.done = new Set(['wp-3-wd-push', 'wp-3-wd-pull'])
    renderPlan()

    expect(ticked(chip('MON'))).toBe(true)
    expect(chip('TUE').textContent).toContain('· SKIPPED')
    expect(ticked(chip('TUE'))).toBe(false)
    expect(chip('FRI').textContent).toContain('· MOVED')
    // Thursday shares Monday's plan row but its own day has no session: no tick, no state (a plan alone doesn't say it is done).
    expect(ticked(chip('THU'))).toBe(false)
    expect(chip('THU').textContent).toBe('THUPush 1')
    // Last week's sessions are not this week's (the plan rows differ).
    expect(chip('TUE').textContent).not.toContain('MOVED')
    expect(chip('FRI').textContent).not.toContain('SKIPPED')
  })

  it('the header: ✓ DONE and SKIPPED with no ⋯; READ ONLY for the shared plan a done session locked; MOVED → SUN with its ⋯', () => {
    mockState.sessions = states()
    mockState.done = new Set(['wp-3-wd-push', 'wp-3-wd-pull'])
    renderPlan()

    expect(headerStates()).toEqual(['DONE']) // Monday is open
    expect(sessionMenuButton()).toBeNull()
    fireEvent.click(chip('TUE'))
    expect(headerStates()).toEqual(['SKIPPED'])
    expect(sessionMenuButton()).toBeNull()
    fireEvent.click(chip('THU'))
    expect(headerStates()).toEqual(['READ ONLY']) // its plan is locked, its own session isn't done
    expect(sessionMenuButton()).toBeNull()
    fireEvent.click(chip('FRI'))
    expect(headerStates()).toEqual(['MOVED → SUN'])
    expect(sessionMenuButton()).not.toBeNull()
  })

  it('a session the sessions read says is finished has no ⋯ even before the done list has its plan (the two reads arrive apart)', () => {
    mockState.sessions = [session(3, PUSH, 'monday', 'completed')]
    mockState.done = new Set() // the done list hasn't caught up
    renderPlan()
    expect(headerStates()).toEqual(['DONE'])
    expect(sessionMenuButton()).toBeNull()
  })

  it('a session only in progress shows no state at all and keeps its ⋯ (board 10 draws none for it)', () => {
    mockState.sessions = [session(3, PUSH, 'monday', 'in_progress')]
    renderPlan()
    expect(ticked(chip('MON'))).toBe(false)
    expect(headerStates()).toEqual([])
    expect(sessionMenuButton()).not.toBeNull()
  })

  it('"Shared with …": the other days, and the chip chosen decides which (SPEC; P1.2-7 for three days)', () => {
    renderPlan()
    expect(screen.getByText('Shared with Thu — changes apply to both')).toBeTruthy()
    fireEvent.click(chip('THU'))
    expect(screen.getByText('Shared with Mon — changes apply to both')).toBeTruthy()
    fireEvent.click(chip('TUE'))
    expect(screen.queryByText(/^Shared with /)).toBeNull() // Pull is on one day
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// The session ⋯ (board 10)
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — the session ⋯ menu: deload, MOVE THIS SESSION', () => {
  it('"[DAY] · WEEK 3" over the workout\'s name, MARK THIS SESSION AS DELOAD, and MOVE THIS SESSION with its arrow', () => {
    renderPlan()
    openSessionMenu()
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('MONDAY · WEEK 3')).toBeTruthy()
    expect(sheet.getByText('Push 1')).toBeTruthy()
    expect(sheet.getByText('MARK THIS SESSION AS DELOAD')).toBeTruthy()
    expect((sheet.getByText('MOVE THIS SESSION').closest('button') as HTMLButtonElement).disabled).toBe(false)
    // Shared plan: it says the mark covers every day that shares it (Mon and Thu).
    expect(sheet.getByText('Marks Mon, Thu — they share one plan.')).toBeTruthy()
  })

  it('W: MOVE THIS SESSION → a day hands useMoveSession this session\'s plan, workout, ITS OWN date and the chosen date', () => {
    renderPlan()
    openSessionMenu()
    fireEvent.click(screen.getByText('MOVE THIS SESSION'))
    fireEvent.click(pickDay('FRI'))

    expect(moveMutate).toHaveBeenCalledTimes(1)
    expect(moveMutate).toHaveBeenCalledWith({ mesoId: 'meso-1', weekPlanId: 'wp-3-wd-push', workoutDayId: 'wd-push', date: on(3, 'monday'), targetDate: on(3, 'friday') })
    expect(clearMutate).not.toHaveBeenCalled()
    // The chip decides which session: Thursday's Push is moved from Thursday's own date.
    cleanup()
    moveMutate.mockClear()
    mockState.today = on(3, 'monday')
    renderPlan()
    fireEvent.click(chip('THU'))
    openSessionMenu()
    fireEvent.click(screen.getByText('MOVE THIS SESSION'))
    fireEvent.click(pickDay('SAT'))
    expect(moveMutate).toHaveBeenCalledWith({ mesoId: 'meso-1', weekPlanId: 'wp-3-wd-push', workoutDayId: 'wd-push', date: on(3, 'thursday'), targetDate: on(3, 'saturday') })
  })

  it('a week planned ahead has no MOVE THIS SESSION (SPEC: the current week only), and neither has a sequence slot; both still have the deload row', () => {
    mockState.all = [1, 2, 3, 4].flatMap(weekOf)
    renderPlan()
    openWeekTile('WEEK 4')
    openSessionMenu()
    expect(within(screen.getByRole('dialog')).getByText('MONDAY · WEEK 4')).toBeTruthy()
    expect(screen.queryByText('MOVE THIS SESSION')).toBeNull()
    expect(sessionToggle().textContent).toBe('MARK THIS SESSION AS DELOAD')
  })

  it('offline: the row is dimmed and disabled, with "Requires a connection" under it', () => {
    mockState.online = false
    renderPlan()
    openSessionMenu()
    expect((screen.getByText('MOVE THIS SESSION').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Requires a connection')).toBeTruthy()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// A stable week (board 1a): THIS WEEK ONLY, CHANGE EVERY WEEK →, the legend
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — a stable week: THIS WEEK ONLY on an exercise that differs from the default, and the legend', () => {
  // The default: Leg Press 3 sets of 10, Leg Curl 2 sets of 10. This week (3): Leg Press has a drop on its third set; Leg Curl is the
  // default's sets with other weights.
  const arrange = () => {
    mockState.program = program({ planningType: 'stable' })
    mockState.runCopy = { 'wd-legs': [PE_LEGS, PE_CURL] }
    mockState.programSets = [
      pset('p-lp1', 'pe-leg-press', 1), pset('p-lp2', 'pe-leg-press', 2), pset('p-lp3', 'pe-leg-press', 3),
      pset('p-c1', 'pe-curl', 1), pset('p-c2', 'pe-curl', 2),
    ]
    const legsWeek = (week: number, stage: boolean, curlWeight: number) =>
      planRow(week, LEGS, [PE_LEGS, PE_CURL], [
        wset(`lp${week}a`, 'pe-leg-press', 1), wset(`lp${week}b`, 'pe-leg-press', 2), wset(`lp${week}c`, 'pe-leg-press', 3, stage ? { stageKind: 'dropset' } : {}),
        ...(stage ? [wset(`lp${week}s`, 'pe-leg-press', 1, { isDropset: true, parentWeekPlanSetId: `lp${week}c`, stageIndex: 1, targetWeight: 80, repMin: 6, repMax: 6 })] : []),
        wset(`c${week}a`, 'pe-curl', 1, { targetWeight: curlWeight }), wset(`c${week}b`, 'pe-curl', 2, { targetWeight: curlWeight }),
      ])
    mockState.all = [
      ...[1, 2].flatMap((w) => [planRow(w, PUSH, [PE_PUSH], [wset(`b${w}`, 'pe-bench', 1)]), planRow(w, PULL, [PE_PULL], [wset(`r${w}`, 'pe-row', 1)]), legsWeek(w, false, 40)]),
      planRow(3, PUSH, [PE_PUSH], [wset('b3', 'pe-bench', 1)]), planRow(3, PULL, [PE_PULL], [wset('r3', 'pe-row', 1)]),
      legsWeek(3, true, 45),
    ]
    renderPlan()
    fireEvent.click(chip('FRI'))
  }
  const cardOf = (name: string) => screen.getByText(name).closest('[data-exercise-card]') as HTMLElement

  it('Leg Press (a drop added) says THIS WEEK ONLY and links on; Leg Curl (only its weights differ) says nothing', () => {
    arrange()
    expect(within(cardOf('Leg Press')).getByText('THIS WEEK ONLY')).toBeTruthy()
    expect(within(cardOf('Leg Press')).getByRole('button', { name: 'CHANGE EVERY WEEK →' })).toBeTruthy()
    expect(within(cardOf('Leg Curl')).queryByText('THIS WEEK ONLY')).toBeNull() // weight never counts: the default holds none
    expect(screen.getAllByText('THIS WEEK ONLY')).toHaveLength(1)
  })

  it('CHANGE EVERY WEEK → opens CHANGE THE PROGRAM at the catalogue exercise (ex-leg-press), not the program exercise row (pe-leg-press)', () => {
    arrange()
    fireEvent.click(within(cardOf('Leg Press')).getByRole('button', { name: 'CHANGE EVERY WEEK →' }))
    expect(screen.getByTestId('where').textContent).toBe('/plan/change#ex-leg-press')
  })

  it('the legend names last week ("CHANGED SINCE WEEK 2") on week 3, and a stable week 1 has none (nothing is compared with it)', () => {
    arrange()
    expect(screen.getByText('CHANGED SINCE WEEK 2')).toBeTruthy()
    openWeekTile('WEEK 1')
    expect(screen.queryByText(/^CHANGED SINCE/)).toBeNull()
    expect(screen.queryByText('THIS WEEK ONLY')).toBeNull() // a past week: nothing to change from there
  })

  it('a deload session of a stable week says no THIS WEEK ONLY: its sets are calculated, so they would all differ from the default', () => {
    arrange()
    mockState.all = mockState.all.map((p) =>
      p.id === 'wp-3-wd-legs' ? { ...p, isDeload: true, sets: p.sets.filter((x) => x.id !== 'lp3c' && x.id !== 'lp3s') } : p,
    )
    cleanup()
    renderPlan()
    fireEvent.click(chip('FRI'))
    expect(document.querySelector('[data-session-deload]')).not.toBeNull()
    expect(screen.queryByText('THIS WEEK ONLY')).toBeNull()
    expect(screen.queryByText(/^CHANGED SINCE/)).toBeNull() // and no marks: a deload session compares with nothing
  })

  it('a week-dependent week has no THIS WEEK ONLY at all, whatever it holds', () => {
    renderPlan()
    expect(screen.queryByText('THIS WEEK ONLY')).toBeNull()
    expect(screen.getByText('CHANGED SINCE WEEK 2')).toBeTruthy() // the legend is every week's (G48)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Past weeks, a missed week (131), a sequence run
// ═══════════════════════════════════════════════════════════════════════════════

describe('PlanPage — a week nobody planned that has passed opens read-only and empty (DECISIONS 131)', () => {
  it('the lock line and the note, and nothing else: no chip, no COPY, no WEEK ⋯, no CHANGE THE PROGRAM, no PLAN FORWARD — and nothing is written', () => {
    mockState.all = [...weekOf(1), ...weekOf(3)] // week 2 was never planned
    renderPlan()
    planWeekMutate.mockClear()
    openWeekTile('WEEK 2')

    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.getByText("Week 2 wasn't planned")).toBeTruthy()
    for (const gone of ['MON', 'TUE', 'THU', 'FRI']) expect(screen.queryByText(gone)).toBeNull()
    expect(screen.queryByText('COPY')).toBeNull()
    expect(screen.queryByLabelText(/^(Week|Cycle) \d+ options$/)).toBeNull()
    expect(sessionMenuButton()).toBeNull()
    expect(screen.queryByText(/^CHANGE THE PROGRAM/)).toBeNull()
    expect(screen.queryByText('PLAN FORWARD')).toBeNull()
    expect(document.querySelectorAll('[data-exercise-card]')).toHaveLength(0)
    expect(planWeekMutate).not.toHaveBeenCalled()
    expect(setDeloadMutate).not.toHaveBeenCalled()
  })
})

describe('PlanPage — a sequence run: SLOT chips, CYCLE wording', () => {
  // Slot 1 Push, slot 2 a rest day, slot 3 Pull; cycle 3 is current. Cycle 2's slot 1 was done (a decoy: the same workout, another plan row).
  const arrange = () => {
    mockState.program = program({ scheduleType: 'sequence', schedule: EMPTY_SCHEDULE })
    mockState.sequenceItems = [
      { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-push' },
      { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: null },
      { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 2, workoutDayId: 'wd-pull' },
    ]
    mockState.all = [1, 2, 3].flatMap((cycle) => [
      planRow(cycle, PUSH, [PE_PUSH], [wset(`b${cycle}`, 'pe-bench', 1)], { sequencePosition: 0 }),
      planRow(cycle, PULL, [PE_PULL], [wset(`r${cycle}`, 'pe-row', 1)], { sequencePosition: 2 }),
    ])
    mockState.sessions = [
      { id: 'q-2', weekPlanId: 'wp-2-wd-push-s0', workoutDayId: 'wd-push', date: on(2, 'monday'), movedToDate: null, status: 'completed' },
      { id: 'q-3', weekPlanId: 'wp-3-wd-pull-s2', workoutDayId: 'wd-pull', date: on(3, 'monday'), movedToDate: null, status: 'completed' },
    ]
    mockState.done = new Set(['wp-2-wd-push-s0', 'wp-3-wd-pull-s2'])
  }

  it('the chips read SLOT 1 / SLOT 2 (REST DAY, nothing to open) / SLOT 3; a slot\'s state is its own cycle\'s plan row, not another cycle\'s', () => {
    arrange()
    renderPlan()
    expect(screen.getByText('CYCLE 3')).toBeTruthy()
    const slots = screen.getByRole('region', { name: 'Sequence slot switcher' })
    expect(within(slots).getAllByRole('button').map((b) => b.textContent)).toEqual(['SLOT 1Push 1', 'SLOT 2REST DAY', 'SLOT 3Pull 1'])
    expect((within(slots).getByText('REST DAY').closest('button') as HTMLButtonElement).disabled).toBe(true)
    // Slot 3's session of THIS cycle is done; slot 1's done session belongs to cycle 2's plan row.
    expect(ticked(within(slots).getByText('SLOT 3').closest('button') as HTMLElement)).toBe(true)
    expect(ticked(within(slots).getByText('SLOT 1').closest('button') as HTMLElement)).toBe(false)
  })

  it('one workout in two slots: each chip says its own slot\'s session (a plan row is the workout\'s AND the slot\'s)', () => {
    arrange()
    mockState.sequenceItems = [
      { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-push' },
      { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: null },
      { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 2, workoutDayId: 'wd-push' },
    ]
    mockState.all = [1, 2, 3].flatMap((cycle) => [
      planRow(cycle, PUSH, [PE_PUSH], [wset(`b${cycle}-0`, 'pe-bench', 1)], { sequencePosition: 0 }),
      planRow(cycle, PUSH, [PE_PUSH], [wset(`b${cycle}-2`, 'pe-bench', 1)], { sequencePosition: 2 }),
    ])
    mockState.sessions = [{ id: 'q-3', weekPlanId: 'wp-3-wd-push-s2', workoutDayId: 'wd-push', date: on(3, 'monday'), movedToDate: null, status: 'completed' }]
    mockState.done = new Set(['wp-3-wd-push-s2'])
    renderPlan()
    const slots = screen.getByRole('region', { name: 'Sequence slot switcher' })
    expect(ticked(within(slots).getByText('SLOT 3').closest('button') as HTMLElement)).toBe(true)
    expect(ticked(within(slots).getByText('SLOT 1').closest('button') as HTMLElement)).toBe(false)
    expect(headerStates()).toEqual([]) // slot 1 is open, and its session is not done
    expect(sessionMenuButton()).not.toBeNull()
  })

  it('the open slot\'s header says SLOT n; a done one says DONE and has no ⋯; an undone one\'s menu says "SLOT 1 · CYCLE 3" and has no MOVE', () => {
    arrange()
    renderPlan()
    expect(screen.getAllByText('SLOT 1')).toHaveLength(2) // the chip and the header
    openSessionMenu()
    const sheet = within(screen.getByRole('dialog'))
    expect(sheet.getByText('SLOT 1 · CYCLE 3')).toBeTruthy()
    expect(sheet.getByText('MARK THIS SESSION AS DELOAD')).toBeTruthy()
    expect(sheet.queryByText('MOVE THIS SESSION')).toBeNull()
    closeSheet()

    fireEvent.click(screen.getAllByText('SLOT 3')[0])
    expect(headerStates()).toEqual(['DONE'])
    expect(sessionMenuButton()).toBeNull()
  })

  it('a past cycle reads PAST CYCLE · READ ONLY and its header says CYCLE 2', () => {
    arrange()
    renderPlan()
    openWeekTile('CYCLE 2')
    expect(screen.getByText('PAST CYCLE · READ ONLY')).toBeTruthy()
    expect(screen.getByText('SLOT 1 · CYCLE 2')).toBeTruthy() // the open slot's header names the cycle when it isn't the current one
    expect(screen.queryByText(/^CHANGE THE PROGRAM/)).toBeNull()
  })
})
