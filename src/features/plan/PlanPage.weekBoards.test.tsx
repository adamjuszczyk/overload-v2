// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { format, startOfWeek, subWeeks } from 'date-fns'
import type { Mesocycle, MuscleGroup, Program, ProgramExercise, ProgramSet, SequenceItem, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { dateForDow } from '../gym/moveSession'
import { captureRender } from '../../testing/captureRender'
import { pe, plan, pset, stage, wset } from './weekPlanning.testutil'
import type { PlanSession } from './weekViewLogic'

// Chunk 54b: the week view rendered the way boards 1, 1a, 1c, 1d, 9, 10 and 11 draw it, for the 390 px screenshots beside the boards
// (`CAPTURE_RENDER=1` writes `__fixtures__/plan-<name>.html`; `npm run shot` turns each into design/1.2/built/<board-id>.png + .txt). Each test
// captures first, then asserts the few things that say the capture is the state its board draws (RULES: a fixture is captured before it
// asserts). The real PlanPage tree with the data hooks mocked, at 390 px. (54a's PlanPage.rowBoards.test.tsx draws the exercise cards and rows.)
//
//   board 1    Tuesday's Pull 1 on a week-dependent run, week 2 against week 1: the chips (Monday's Push 1 done), the legend, the marks (a weight and
//              a RIR changed, a drop and a set added, a rep target changed, the kind chip), the session header with its ⋯
//   board 1a   the same on a stable run: the legend, and THIS WEEK ONLY / CHANGE EVERY WEEK → on the exercises that differ from the default
//   board 1c   week 1, a past week: the lock line, the chips with Thursday's SKIPPED, a done session's flat rows, no buttons row, no bottom button
//   board 1d   a sequence run in cycle 3: SLOT chips with a rest slot, the legend in CYCLE words
//   board 9    the changes since the source on cards (a new exercise, a removed one, a removed set) and a deload session (no marks)
//   board 10   the session menu (marked and already started; shared plan; offline; a slot), a skipped session's header, an empty workout, a
//              program with no schedule
//   board 11   a done session, read only
//
// Not drawn here, because other chunks build them: VOLUME and the REVIEW line (55, 56).

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 390 })
})

const monday = (weeksAgo: number) => format(startOfWeek(subWeeks(new Date(), weeksAgo), { weekStartsOn: 1 }), 'yyyy-MM-dd')
const START = monday(1) // today is in week 2 of the run
const PROGRAM_NAME = 'Push Pull Legs'
const wd = (id: string, name: string, position: number): WorkoutDay => ({ id, programId: 'prog-1', userId: 'user-1', name, position, exercises: [] })
const DAYS = [wd('wd-push1', 'Push 1', 0), wd('wd-pull1', 'Pull 1', 1), wd('wd-push2', 'Push 2', 2), wd('wd-pull2', 'Pull 2', 3), wd('wd-legs', 'Legs', 4)]
const WEEKDAYS = { ...EMPTY_SCHEDULE, monday: 'wd-push1', tuesday: 'wd-pull1', thursday: 'wd-push2', friday: 'wd-pull2', saturday: 'wd-legs' }

const state = vi.hoisted(() => ({
  meso: null as unknown as Mesocycle,
  program: null as unknown as Program,
  all: [] as WeekPlan[],
  sessions: undefined as PlanSession[] | undefined,
  done: new Set<string>(),
  runCopy: {} as Record<string, ProgramExercise[] | undefined>,
  programSets: [] as ProgramSet[],
  sequenceItems: [] as SequenceItem[],
  online: true,
  rangeSessions: [] as unknown[],
}))
const setDeloadMutate = vi.fn()

vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [state.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [state.program], isLoading: false }),
  useWorkoutDays: () => ({ data: DAYS, isLoading: false }),
  useProgramExercises: (workoutDayId: string) => ({ data: state.runCopy[workoutDayId] ?? [], isLoading: false }),
  useSequenceItems: () => ({ data: state.sequenceItems }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
  useProgramSets: (ids: string[]) => ({ data: state.programSets.filter((ps) => ids.includes(ps.programExerciseId)) }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => state.sessions }))
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => state.done }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: 3, failed: false }) }))
vi.mock('./useCopyNumbers', () => ({ useCopyNumbers: () => ({ mutateAsync: vi.fn(), isPending: false, isError: false }) }))
vi.mock('../../hooks/useToday', () => ({ useToday: () => dateForDow(START, 2, 'tuesday') }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => state.online }))
vi.mock('../gym/useSession', () => ({
  useSessionsInRange: () => ({ data: state.rangeSessions }),
  useMoveSession: () => ({ mutate: vi.fn(), isPending: false }),
  useClearMovedSession: () => ({ mutate: vi.fn(), isPending: false }),
  useLastDoneOrSkippedSession: () => ({ data: null }),
}))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: state.all.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: state.all, isLoading: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: setDeloadMutate }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useChangeSetType: () => ({ mutate: vi.fn(), isPending: false }),
}))

const { default: PlanPage } = await import('./PlanPage')
const { openWeekTile, openSessionMenu } = await import('./planMenus.testutil')

// ─── The exercises and the weeks ───────────────────────────────────────────────

const named = (id: string, name: string, muscleGroup: MuscleGroup, position: number, workoutDayId: string, over: Partial<ProgramExercise> = {}): ProgramExercise => {
  const base = pe(id, id, position, { workoutDayId, ...over })
  return { ...base, exercise: { ...base.exercise!, name, muscleGroup } }
}
const LAT = named('pe-lat', 'Lat Pulldown', 'back', 0, 'wd-pull1')
const ROW = named('pe-row', 'Seated Cable Row', 'back', 1, 'wd-pull1', { supersetBlockId: 'blk-a' })
const FACE = named('pe-face', 'Face Pull', 'shoulders', 2, 'wd-pull1', { supersetBlockId: 'blk-a' })
const CURL = named('pe-curl', 'EZ Bar Curl', 'biceps', 3, 'wd-pull1')
const INCLINE = named('pe-incline', 'Incline Dumbbell Press', 'chest', 0, 'wd-push1')
const DIPS = named('pe-dips', 'Dips', 'chest', 1, 'wd-push1')
const PEC = named('pe-pec', 'Pec Deck Fly', 'chest', 2, 'wd-push1')
const INC2 = named('pe-inc2', 'Incline Press', 'chest', 0, 'wd-push2')

const planId = (workoutDayId: string, week: number) => `wp-${workoutDayId}-${week}`
const S = (week: number, workoutDayId: string) => (name: string, peId: string, n: number, more: Partial<WeekPlanSet>) =>
  wset(`${name}-${week}`, peId, n, { weekPlanId: planId(workoutDayId, week), ...more })

/** Pull 1: week 1 is the source; week 2 holds board 1's differences from it. */
function pullDay(week: number): WeekPlan {
  const s = S(week, 'wd-pull1')
  const now = week === 2
  const sets = [
    s('lat1', 'pe-lat', 1, { targetWeight: 55, repMin: 8, repMax: 10, targetRir: 2, tags: ['push back'] }),
    s('lat2', 'pe-lat', 2, { targetWeight: 55, repMin: 8, repMax: 10, targetRir: 2 }),
    s('lat3', 'pe-lat', 3, { targetWeight: now ? 52.5 : 50, repMin: 8, repMax: 10, targetRir: now ? 1 : 2, ...(now ? { stageKind: 'dropset' as const } : {}) }),
    ...(now ? [{ ...stage('lat3s-2', 'lat3-2', 'pe-lat', 1, { targetWeight: 40, repMin: null, repMax: null, isAmrap: true, targetRir: 0 }), weekPlanId: planId('wd-pull1', 2) }] : []),
    ...[1, 2, ...(now ? [3] : [])].map((n) => s(`row${n}`, 'pe-row', n, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 1, targetRirMax: 2 })),
    s('face1', 'pe-face', 1, { targetWeight: 15, repMin: 15, repMax: 20, targetRir: 1 }),
    s('face2', 'pe-face', 2, { targetWeight: now ? 17.5 : 15, repMin: 15, repMax: 20, targetRir: 1 }),
    s('curlw', 'pe-curl', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12, targetRir: null }),
    s('curl1', 'pe-curl', 2, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 1 }),
    now ? s('curl2', 'pe-curl', 3, { targetWeight: 30, repMin: null, repMax: null, isAmrap: true, targetRir: 0 }) : s('curl2', 'pe-curl', 3, { targetWeight: 30, repMin: 8, repMax: 8, targetRir: 0 }),
  ]
  return plan(week, [LAT, ROW, FACE, CURL], sets, { id: planId('wd-pull1', week), workoutDayId: 'wd-pull1' })
}

/** Push 1 (Monday): the same in both weeks, so nothing in it is marked. */
function pushDay(week: number): WeekPlan {
  const s = S(week, 'wd-push1')
  const sets = [
    s('inc1', 'pe-incline', 1, { targetWeight: 26, repMin: 8, repMax: 10, targetRir: 2, tags: ['push here'] }),
    s('inc2', 'pe-incline', 2, { targetWeight: 26, repMin: 8, repMax: 10, targetRir: 2 }),
    s('inc3', 'pe-incline', 3, { targetWeight: 26, repMin: 8, repMax: 10, targetRir: 1 }),
    s('dips1', 'pe-dips', 1, { targetWeight: 10, repMin: 8, repMax: 8, targetRir: 2 }),
    s('dips2', 'pe-dips', 2, { targetWeight: 10, repMin: 8, repMax: 8, targetRir: 1 }),
    s('pec1', 'pe-pec', 1, { targetWeight: 40, repMin: 12, repMax: 15, targetRir: 1 }),
    s('pec2', 'pe-pec', 2, { targetWeight: 40, repMin: 12, repMax: 15, targetRir: 1, stageKind: 'dropset' }),
    { ...stage(`pec2s-${week}`, `pec2-${week}`, 'pe-pec', 1, { targetWeight: 30, repMin: null, repMax: null, isAmrap: true, targetRir: 0 }), weekPlanId: planId('wd-push1', week) },
  ]
  return plan(week, [INCLINE, DIPS, PEC], sets, { id: planId('wd-push1', week), workoutDayId: 'wd-push1' })
}

const emptyDay = (week: number, workoutDayId: string) => plan(week, [], [], { id: planId(workoutDayId, week), workoutDayId })

function weekdayRun(planningType: Program['planningType'] = 'week_dependent', over: { weeks?: Record<number, WeekPlan[]>; schedule?: Program['schedule'] } = {}) {
  state.meso = { id: 'meso-1', userId: 'user-1', name: PROGRAM_NAME, programId: 'prog-1', status: 'active', startDate: START, endDate: null, createdAt: '2026-01-01T00:00:00Z' }
  state.program = {
    id: 'prog-1', userId: 'user-1', name: PROGRAM_NAME, workoutDays: [], schedule: over.schedule ?? WEEKDAYS, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', kind: 'run', planningType,
  }
  state.all = [1, 2].flatMap((week) => over.weeks?.[week] ?? [pushDay(week), pullDay(week), emptyDay(week, 'wd-push2'), emptyDay(week, 'wd-pull2'), emptyDay(week, 'wd-legs')])
  state.sessions = [{ id: 's-push1-2', weekPlanId: planId('wd-push1', 2), workoutDayId: 'wd-push1', date: dateForDow(START, 2, 'monday'), movedToDate: null, status: 'completed' }]
  state.done = new Set([planId('wd-push1', 2)]) // Monday's Push 1 is done
  state.runCopy = {}
  state.programSets = []
  state.sequenceItems = []
  state.online = true
  state.rangeSessions = []
  setDeloadMutate.mockReset()
}

const ui = () => (
  <MemoryRouter initialEntries={['/plan']}>
    <PlanPage />
  </MemoryRouter>
)
const chip = (label: string) => screen.getAllByText(label)[0].closest('button') as HTMLButtonElement
const cardOf = (name: string) => screen.getByText(name).closest('[data-exercise-card]') as HTMLElement
const marks = (kind: string) => Array.from(document.querySelectorAll(`[data-diff="${kind}"]`))

// ─── Board 1, 1a ─────────────────────────────────────────────────────────────

describe('board 1: Tuesday\'s Pull 1, week 2 against week 1 (week-dependent run)', () => {
  it('the legend, the chips with Monday ticked, the header with its ⋯, and the marks the board draws', () => {
    weekdayRun()
    render(ui())
    fireEvent.click(chip('TUE'))
    captureRender('plan-1-week', document.body)

    expect(screen.getByText('CHANGED SINCE WEEK 1')).toBeTruthy()
    expect(chip('MON').querySelector('svg[aria-label="done"]')).not.toBeNull()
    expect(screen.getByRole('heading', { name: 'Pull 1' })).toBeTruthy()
    expect(screen.getByLabelText('Pull 1 options')).toBeTruthy()
    // Lat Pulldown's third set: its weight and its RIR; the kind chip (it holds a drop now); the drop is a new row. Seated Cable Row's third set is new.
    // Face Pull's second set: its weight. EZ Bar Curl's second set: its rep target (AMRAP).
    expect(marks('kind')).toHaveLength(1)
    expect(marks('added')).toHaveLength(2) // the drop under Lat Pulldown's third set, and Seated Cable Row's third set
    expect(within(cardOf('Seated Cable Row')).getByText('03')).toBeTruthy()
    expect(marks('changed')).toHaveLength(2 + 1 + 3 + 1 + 1) // Lat 3: weight, RIR; its drop: reps (its weight and RIR are the structure's); Row 3: three; Face 2; Curl 2
    expect(screen.queryByText('THIS WEEK ONLY')).toBeNull()
    expect(screen.getByText('CHANGE THE PROGRAM FROM WEEK 2')).toBeTruthy()
  })
})

describe('board 1a: the same week on a stable run', () => {
  it('the legend, and THIS WEEK ONLY with CHANGE EVERY WEEK → on the exercises that differ from the default', () => {
    weekdayRun('stable')
    // The default: Lat Pulldown 3 sets, Seated Cable Row 3, Face Pull 2, EZ Bar Curl a warmup and two sets of 8.
    state.runCopy = { 'wd-pull1': [LAT, ROW, FACE, CURL] }
    state.programSets = [
      ...[1, 2, 3].map((n) => pset(`d-lat${n}`, 'pe-lat', n, { repMin: 8, repMax: 10 })),
      ...[1, 2, 3].map((n) => pset(`d-row${n}`, 'pe-row', n, { repMin: 10, repMax: 12 })),
      ...[1, 2].map((n) => pset(`d-face${n}`, 'pe-face', n, { repMin: 15, repMax: 20 })),
      pset('d-curlw', 'pe-curl', 1, { isWarmup: true, repMin: 12, repMax: 12 }),
      pset('d-curl1', 'pe-curl', 2, { repMin: 8, repMax: 8 }),
      pset('d-curl2', 'pe-curl', 3, { repMin: 8, repMax: 8 }),
    ]
    render(ui())
    fireEvent.click(chip('TUE'))
    captureRender('plan-1a-week', document.body)

    expect(screen.getByText('CHANGED SINCE WEEK 1')).toBeTruthy() // G48: "CHANGED SINCE WEEK N" on stable weeks too
    expect(within(cardOf('Lat Pulldown')).getByText('THIS WEEK ONLY')).toBeTruthy() // a drop where the default has none
    expect(within(cardOf('Lat Pulldown')).getByRole('button', { name: 'CHANGE EVERY WEEK →' })).toBeTruthy()
    expect(within(cardOf('EZ Bar Curl')).getByText('THIS WEEK ONLY')).toBeTruthy() // AMRAP where the default says 8
    expect(within(cardOf('Seated Cable Row')).queryByText('THIS WEEK ONLY')).toBeNull()
    expect(within(cardOf('Face Pull')).queryByText('THIS WEEK ONLY')).toBeNull()
  })
})

// ─── Board 1c, 11 and the states of board 10 ──────────────────────────────────

describe('board 1c: week 1, a past week', () => {
  it('the lock line, no buttons row, the chips (Thursday SKIPPED), a done session\'s flat rows, no bottom button', () => {
    weekdayRun()
    const week1 = (workoutDayId: string, day: Parameters<typeof dateForDow>[2], status: PlanSession['status']): PlanSession => ({
      id: `s-${workoutDayId}-1`, weekPlanId: planId(workoutDayId, 1), workoutDayId, date: dateForDow(START, 1, day), movedToDate: null, status,
    })
    state.sessions = [week1('wd-push1', 'monday', 'completed'), week1('wd-pull1', 'tuesday', 'completed'), week1('wd-push2', 'thursday', 'skipped'), week1('wd-pull2', 'friday', 'completed')]
    state.done = new Set(['wd-push1', 'wd-pull1', 'wd-push2', 'wd-pull2'].map((id) => planId(id, 1)))
    render(ui())
    openWeekTile('WEEK 1')
    fireEvent.click(chip('TUE'))
    captureRender('plan-1c-week', document.body)

    expect(screen.getByText('PAST WEEK · READ ONLY')).toBeTruthy()
    expect(screen.queryByText('COPY')).toBeNull()
    expect(screen.queryByLabelText(/^Week \d+ options$/)).toBeNull()
    expect(screen.queryByText(/^CHANGE THE PROGRAM/)).toBeNull()
    expect(screen.queryByText(/^CHANGED SINCE/)).toBeNull() // week 1 is compared with nothing
    expect(chip('MON').querySelector('svg[aria-label="done"]')).not.toBeNull()
    expect(chip('TUE').querySelector('svg[aria-label="done"]')).not.toBeNull()
    expect(chip('THU').textContent).toContain('· SKIPPED')
    expect(document.querySelector('[data-session-state]')?.textContent).toBe('DONE')
    expect(screen.queryAllByLabelText(/^Options for /)).toHaveLength(0)
    expect(screen.queryAllByLabelText(/^Add set to /)).toHaveLength(0)
    expect((within(cardOf('Lat Pulldown')).getAllByRole('button', { name: /^RIR/ })[0] as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('board 11: a done session, read only', () => {
  it('✓ DONE on the right of its header, no ⋯, flat rows, the legend; the week\'s buttons and CHANGE THE PROGRAM stay', () => {
    weekdayRun()
    render(ui())
    captureRender('plan-11-done', document.body)

    expect(document.querySelector('[data-session-state]')?.textContent).toBe('DONE')
    expect(screen.getByRole('heading', { name: 'Push 1' })).toBeTruthy()
    expect(screen.queryByLabelText('Push 1 options')).toBeNull()
    expect(screen.getByText('CHANGED SINCE WEEK 1')).toBeTruthy()
    expect(screen.getByText('COPY')).toBeTruthy()
    expect(screen.getByText('CHANGE THE PROGRAM FROM WEEK 2')).toBeTruthy()
    expect(screen.queryAllByLabelText(/^Add set to /)).toHaveLength(0)
    for (const button of within(cardOf('Dips')).getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('board 10: the session menu and a session\'s states', () => {
  it('the menu: MARK THIS SESSION AS DELOAD and MOVE THIS SESSION', () => {
    weekdayRun()
    render(ui())
    fireEvent.click(chip('TUE'))
    openSessionMenu()
    captureRender('plan-10-menu', document.body)
    const menu = within(screen.getByRole('dialog'))
    expect(menu.getByText('TUESDAY · WEEK 2')).toBeTruthy()
    expect(menu.getByText('Pull 1')).toBeTruthy()
    expect(menu.getByText('MARK THIS SESSION AS DELOAD')).toBeTruthy()
    expect(menu.getByText('MOVE THIS SESSION')).toBeTruthy()
  })

  it('already started, deload on: UNMARK THIS SESSION with the chip, "Already started — sets left as they are", and a MOVE that says it can\'t', () => {
    weekdayRun()
    state.all = state.all.map((p) => (p.id === planId('wd-pull1', 2) ? { ...p, isDeload: true } : p))
    state.rangeSessions = [{ id: 'q', workoutDayId: 'wd-pull1', date: dateForDow(START, 2, 'tuesday'), status: 'in_progress', weekPlanId: planId('wd-pull1', 2) }]
    setDeloadMutate.mockImplementation((_vars: unknown, opts?: { onSuccess?: (outcome: string) => void }) => opts?.onSuccess?.('alreadyStarted'))
    render(ui())
    fireEvent.click(chip('TUE'))
    openSessionMenu()
    fireEvent.click(screen.getByText('UNMARK THIS SESSION').closest('button') as HTMLButtonElement)
    captureRender('plan-10-menu-started', document.body)
    const menu = within(screen.getByRole('dialog'))
    expect(menu.getByText('Already started — sets left as they are')).toBeTruthy()
    expect(menu.getByText("Already started — can't be moved")).toBeTruthy()
    expect((menu.getByText('MOVE THIS SESSION').closest('button') as HTMLButtonElement).disabled).toBe(true)
    expect(menu.getByText('DELOAD')).toBeTruthy()
  })

  it('one plan on two weekdays: "Marks Mon, Thu — they share one plan."', () => {
    weekdayRun('week_dependent', { schedule: { ...WEEKDAYS, thursday: 'wd-push1' } })
    state.sessions = []
    state.done = new Set()
    render(ui())
    openSessionMenu()
    captureRender('plan-10-menu-shared', document.body)
    expect(within(screen.getByRole('dialog')).getByText('Marks Mon, Thu — they share one plan.')).toBeTruthy()
    expect(screen.getByText('Shared with Thu — changes apply to both')).toBeTruthy()
  })

  it('offline: MOVE THIS SESSION dimmed, "Requires a connection"', () => {
    weekdayRun()
    state.online = false
    render(ui())
    fireEvent.click(chip('TUE'))
    openSessionMenu()
    captureRender('plan-10-menu-offline', document.body)
    expect(within(screen.getByRole('dialog')).getByText('Requires a connection')).toBeTruthy()
  })

  it('a slot of a sequence run: "SLOT 3 · CYCLE 3" and no MOVE THIS SESSION', () => {
    sequenceRun()
    render(ui())
    fireEvent.click(screen.getAllByText('SLOT 3')[0])
    openSessionMenu()
    captureRender('plan-10-menu-slot', document.body)
    const menu = within(screen.getByRole('dialog'))
    expect(menu.getByText('SLOT 3 · CYCLE 3')).toBeTruthy()
    expect(menu.getByText('MARK THIS SESSION AS DELOAD')).toBeTruthy()
    expect(menu.queryByText('MOVE THIS SESSION')).toBeNull()
  })

  it('a skipped session: SKIPPED on the right of its header, and "THURSDAY · WEEK 1" over the name in a week that is not the current one', () => {
    weekdayRun()
    state.sessions = [{ id: 's-skip', weekPlanId: planId('wd-push2', 1), workoutDayId: 'wd-push2', date: dateForDow(START, 1, 'thursday'), movedToDate: null, status: 'skipped' }]
    state.done = new Set([planId('wd-push2', 1)])
    render(ui())
    openWeekTile('WEEK 1')
    fireEvent.click(chip('THU'))
    captureRender('plan-10-skipped', document.body)
    expect(document.querySelector('[data-session-state]')?.textContent).toBe('SKIPPED')
    expect(screen.getByText('THURSDAY · WEEK 1')).toBeTruthy()
  })

  it('an empty workout: "No exercises in this day", under a header with its ⋯', () => {
    weekdayRun()
    render(ui())
    fireEvent.click(chip('SAT'))
    captureRender('plan-10-empty', document.body)
    expect(screen.getByText('No exercises in this day')).toBeTruthy()
    expect(screen.getByLabelText('Legs options')).toBeTruthy()
  })

  it('a program with no schedule: "No workouts scheduled" and PROGRAMS →', () => {
    weekdayRun('week_dependent', { schedule: EMPTY_SCHEDULE })
    render(ui())
    captureRender('plan-10-no-schedule', document.body)
    expect(screen.getByText('No workouts scheduled')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'PROGRAMS' })).toBeTruthy()
  })
})

// ─── Board 9: the changes, and a deload session ──────────────────────────────

describe('board 9: changes since the source', () => {
  it('a new exercise (NEW), a removed one (a dashed card), a changed weight, rep target and RIR, and a removed set (a dashed line)', () => {
    const SAP = named('pe-sap', 'Straight-Arm Pulldown', 'back', 0, 'wd-pull1')
    const CSR = named('pe-csr', 'Chest-Supported Row', 'back', 0, 'wd-pull1')
    const ROW2 = { ...ROW, position: 1 }
    const s = (week: number) => S(week, 'wd-pull1')
    const week1 = plan(1, [CSR, { ...ROW, position: 1 }], [
      s(1)('csr1', 'pe-csr', 1, { targetWeight: 45, repMin: 10, repMax: 12, targetRir: 2 }),
      s(1)('row1', 'pe-row', 1, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 2 }),
      s(1)('row2', 'pe-row', 2, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 2 }),
      s(1)('row3', 'pe-row', 3, { targetWeight: 60, repMin: 10, repMax: 12, targetRir: 2 }),
    ], { id: planId('wd-pull1', 1), workoutDayId: 'wd-pull1' })
    const week2 = plan(2, [SAP, ROW2], [
      s(2)('sap1', 'pe-sap', 1, { targetWeight: 25, repMin: 12, repMax: 15, targetRir: 2 }),
      s(2)('sap2', 'pe-sap', 2, { targetWeight: 25, repMin: 12, repMax: 15, targetRir: 1 }),
      s(2)('row1', 'pe-row', 1, { targetWeight: 62.5, repMin: 10, repMax: 12, targetRir: 2 }),
      s(2)('row2', 'pe-row', 2, { targetWeight: 60, repMin: 8, repMax: 10, targetRir: 1 }),
    ], { id: planId('wd-pull1', 2), workoutDayId: 'wd-pull1' })
    weekdayRun('week_dependent', { weeks: { 1: [week1], 2: [week2] } })
    state.sessions = []
    state.done = new Set()
    render(ui())
    fireEvent.click(chip('TUE'))
    captureRender('plan-9-changes', document.body)

    expect(screen.getByText('CHANGED SINCE WEEK 1')).toBeTruthy()
    expect(cardOf('Straight-Arm Pulldown').getAttribute('data-diff')).toBe('added')
    expect(within(cardOf('Straight-Arm Pulldown')).getByText('· NEW')).toBeTruthy()
    const removed = marks('removed') as HTMLElement[]
    expect(removed.map((r) => r.textContent)).toEqual(['Chest-Supported RowREMOVED SINCE WEEK 1', '03 · 60 kg × 10–12 · RIR 2'])
    expect(removed[0].querySelector('del')?.textContent).toBe('Chest-Supported Row')
    expect(marks('changed')).toHaveLength(1 + 2) // the first weight; the second set's reps and RIR
  })

  it('a deload session shows no marks and no legend, though every number differs from last week\'s', () => {
    const s = (week: number) => S(week, 'wd-push2')
    const week1 = plan(1, [INC2], [s(1)('i1', 'pe-inc2', 1, { targetWeight: 30, targetRir: 2 }), s(1)('i2', 'pe-inc2', 2, { targetWeight: 30, targetRir: 2 })], { id: planId('wd-push2', 1), workoutDayId: 'wd-push2' })
    const week2 = plan(2, [INC2], [s(2)('i1', 'pe-inc2', 1, { targetWeight: 22, targetRir: 4 }), s(2)('i2', 'pe-inc2', 2, { targetWeight: 22, targetRir: 4 })], { id: planId('wd-push2', 2), workoutDayId: 'wd-push2', isDeload: true })
    weekdayRun('week_dependent', { weeks: { 1: [week1], 2: [week2] } })
    state.sessions = []
    state.done = new Set()
    render(ui())
    fireEvent.click(chip('THU'))
    captureRender('plan-9-deload', document.body)

    expect(document.querySelector('[data-session-deload]')?.textContent).toBe('DELOAD')
    expect(document.querySelectorAll('[data-diff]')).toHaveLength(0)
    expect(screen.queryByText(/^CHANGED SINCE/)).toBeNull()
  })
})

// ─── Board 1d: a sequence run ────────────────────────────────────────────────

function sequenceRun() {
  weekdayRun()
  state.program = { ...state.program, scheduleType: 'sequence', schedule: EMPTY_SCHEDULE }
  state.sequenceItems = [
    { id: 'si-0', userId: 'user-1', programId: 'prog-1', position: 0, workoutDayId: 'wd-push1' },
    { id: 'si-1', userId: 'user-1', programId: 'prog-1', position: 1, workoutDayId: null },
    { id: 'si-2', userId: 'user-1', programId: 'prog-1', position: 2, workoutDayId: 'wd-pull1' },
    { id: 'si-3', userId: 'user-1', programId: 'prog-1', position: 3, workoutDayId: 'wd-push2' },
  ]
  // Cycle 2 holds week 1's numbers, cycle 3 week 2's.
  const asCycle = (p: WeekPlan, cycle: number, position: number): WeekPlan => ({ ...p, id: `${p.id}-c${cycle}`, weekNumber: cycle, sequencePosition: position })
  state.all = [1, 2, 3].flatMap((cycle) => {
    const source = cycle === 3 ? 2 : 1
    return [asCycle(pushDay(source), cycle, 0), asCycle(pullDay(source), cycle, 2), asCycle(emptyDay(1, 'wd-push2'), cycle, 3)]
  })
  state.sessions = [{ id: 's-seq', weekPlanId: `${planId('wd-push1', 2)}-c3`, workoutDayId: 'wd-push1', date: START, movedToDate: null, status: 'completed' }]
  state.done = new Set([`${planId('wd-push1', 2)}-c3`])
}

describe('board 1d: a sequence run in cycle 3', () => {
  it('SLOT chips with a rest slot and slot 1 ticked, the open slot, the legend and the bottom button in CYCLE words', () => {
    sequenceRun()
    render(ui())
    fireEvent.click(screen.getAllByText('SLOT 3')[0])
    captureRender('plan-1d-week', document.body)

    const slots = screen.getByRole('region', { name: 'Sequence slot switcher' })
    expect(within(slots).getAllByRole('button').map((b) => b.textContent)).toEqual(['SLOT 1Push 1', 'SLOT 2REST DAY', 'SLOT 3Pull 1', 'SLOT 4Push 2'])
    expect(within(slots).getByText('SLOT 1').closest('button')?.querySelector('svg[aria-label="done"]')).not.toBeNull()
    expect(screen.getByText('CHANGED SINCE CYCLE 2')).toBeTruthy()
    expect(screen.getByText('CHANGE THE PROGRAM FROM CYCLE 3')).toBeTruthy()
    expect(screen.getByLabelText('Pull 1 options')).toBeTruthy()
    expect(screen.queryByText('MOVE THIS SESSION')).toBeNull()
  })
})
