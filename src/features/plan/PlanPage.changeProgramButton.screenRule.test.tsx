// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { queryClient } from '../../lib/queryClient'
import type { Mesocycle, Program, SequenceItem, WeekPlan, WorkoutDay } from '../../types'
import { NOW, USER, cloneDb, type World } from '../programs/programChange.testutil'
import { sequenceWorld, stableWorld, weekDependentWorld } from '../programs/programChange.worlds.testutil'
import type { RunChangeStatus } from '../programs/programChange'
import { fakePostgrest, type FakePostgrest, type Row, type Tables } from '../programs/fakePostgrest.testutil'

// DECISIONS 172 (j), Adam, 2026-10-19: "Plan's "CHANGE THE PROGRAM FROM WEEK N" button naming a different week than the screen's rule
// box when the week's last open session is in progress ... The button follows the screen." This is the twin that holds it: ONE database
// (a world's rows and the sessions that give its plan rows their statuses, served by a stand-in for PostgREST) is read by both
// screens through their real reading paths, and for each pattern of statuses the number on PlanPage's button must be the number in
// CHANGE THE PROGRAM's rule box. The button reads `usePlanRowStatuses` for real (-> `fetchPlanRowStatuses`) and the screen reads
// `fetchChangeProgramSource` for real; what is mocked is the rest of what PlanPage draws (its week plans, workouts, schedule), which
// do not decide N. A button that counted only the sessions that are done (what it did until this follow-up) names the week of the
// session in progress, and the rule box the week after: the third row of the table below.
// Chunk 52: the week body (and its button) is drawn for a run that has a schedule, so the run's workouts and a sequence run's slots are
// handed to the page too, from the same world.

const h = vi.hoisted(() => ({
  client: null as unknown,
  meso: null as unknown as Mesocycle,
  programs: [] as Program[],
  plans: [] as WeekPlan[],
  workoutDays: [] as WorkoutDay[],
  sequenceItems: [] as SequenceItem[],
  done: new Set<string>(),
  cycle: 2,
}))

// (Spread arguments, not a named table: scripts/verify-rls-tables.test.mjs lists the calls of the table reader that name their table by a variable.)
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: [string]) => (h.client as FakePostgrest['client']).from(...args), rpc: vi.fn() },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-test' }, loading: false, signOut: vi.fn() }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [h.meso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  ...(await import('./structureHooks.testutil')).quietProgramsHooks,
  usePrograms: () => ({ data: h.programs, isLoading: false }),
  useWorkoutDays: () => ({ data: h.workoutDays, isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: h.sequenceItems }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./structureHooks.testutil')).quietPlannerHooks,
}))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))
vi.mock('./useDoneWeekPlanIds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useDoneWeekPlanIds')>()),
  useDoneWeekPlanIds: () => h.done,
}))
vi.mock('./useRunSchedule', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useRunSchedule')>()),
  useRunSchedule: () => ({ data: [] }),
}))
vi.mock('./useSequenceCurrentCycle', () => ({ useSequenceCurrentCycle: () => ({ cycle: h.cycle, failed: false }) }))
vi.mock('./useWeekPlan', () => ({
  useWeekPlans: (_mesoId: string, weekNumber: number) => ({ data: h.plans.filter((p) => p.weekNumber === weekNumber), isLoading: false }),
  useAllWeekPlans: () => ({ data: h.plans, isLoading: false }),
  useApplyAhead: () => ({ mutate: vi.fn(), isPending: false }),
  usePlanWeek: () => ({ mutate: vi.fn(), isPending: false }),
  useSetDeload: () => ({ mutate: vi.fn() }),
  useSetWeekDeload: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSet: () => ({ mutate: vi.fn(), isPending: false }),
  useAddStage: () => ({ mutate: vi.fn() }),
  useAddWarmupSet: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateSet: () => ({ mutate: vi.fn() }),
  useRemoveSet: () => ({ mutate: vi.fn(), isPending: false }),
  useSwapWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useAddWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useRemoveWeekExercise: () => ({ mutate: vi.fn(), isPending: false }),
  useReorderWeekExercises: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../library/exerciseService', () => ({
  fetchExercises: async () => [],
  createExercise: vi.fn(),
  updateExercise: vi.fn(),
  setExerciseArchived: vi.fn(),
  fetchExerciseCount: vi.fn(),
  seedDefaultExercisesIfEmpty: vi.fn(),
  fetchLostExercises: vi.fn(),
  previewExerciseDelete: vi.fn(),
  deleteExercise: vi.fn(),
  restoreExercise: vi.fn(),
}))

const { default: PlanPage } = await import('./PlanPage')
const { default: ChangeProgramPage } = await import('../programs/ChangeProgramPage')

// ─── The database both screens read ───────────────────────────────────────────────────────────────────────────────────

const EXERCISE_IDS = ['ex-bench', 'ex-pd', 'ex-face', 'ex-squat', 'ex-leg', 'ex-inc', 'ex-lat', 'ex-plank', 'ex-curl', 'ex-dip', 'ex-row']
const exerciseRows = (): Row[] =>
  EXERCISE_IDS.map((id) => ({
    id,
    user_id: USER,
    name: `Exercise ${id}`,
    muscle_group: 'back',
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    muscle_subgroup: null,
    movement_pattern: null,
    status: 'active',
    source_library_id: null,
    lost_at: null,
  }))

// A plan row with a session done, in progress or not yet (a row with no session: not started).
const sessionRow = (id: string, mesoId: string, planId: string, status: string): Row => ({ id, user_id: USER, mesocycle_id: mesoId, week_plan_id: planId, status })

let fake: FakePostgrest

// The clock stands at the testutil's NOW (Thursday 2026-10-15), and a weekday run began on Monday 2026-10-05: week 2 whatever day the
// suite runs. A sequence run's current cycle is the mocked `h.cycle` (2), as the world's.
const START_DATE = '2026-10-05'

function useWorld(w: World, statuses: Record<string, RunChangeStatus>) {
  queryClient.clear() // Plan's statuses are cached for five minutes: a second world must be read, not remembered
  const tables = cloneDb(w.db) as unknown as Tables
  tables.exercises = exerciseRows()
  tables.v2_sessions = Object.entries(statuses)
    .filter(([, status]) => status !== 'not_started')
    .map(([planId, status], i) => sessionRow(`ses-${i}`, w.mesocycleId, planId, status === 'done' ? 'completed' : 'in_progress'))
  fake = fakePostgrest(tables)
  h.client = fake.client
  h.meso = { id: w.mesocycleId, userId: 'u-test', name: 'The run', programId: w.programId, status: 'active', startDate: START_DATE, endDate: null, createdAt: '', sourceProgramId: 'saved' }
  const base = { userId: 'u-test', workoutDays: [], createdAt: '', updatedAt: '' }
  h.programs = [
    { ...base, id: w.programId, name: 'The run (copy)', schedule: w.db.v2_programs[0].schedule as Program['schedule'], kind: 'run', planningType: w.planningType, scheduleType: w.scheduleType },
    { ...base, id: 'saved', name: 'The program', schedule: {} as Program['schedule'], kind: 'saved', planningType: w.planningType, scheduleType: w.scheduleType },
  ]
  // what PlanPage draws of the week plans: the rows, with no sets (N does not depend on them)
  h.plans = w.db.v2_week_plans.map((p) => ({
    id: p.id,
    userId: 'u-test',
    mesocycleId: p.mesocycle_id,
    workoutDayId: p.workout_day_id,
    weekNumber: p.week_number,
    isDeload: false,
    notes: null,
    sets: [],
    exercises: [],
    createdAt: '',
  })) as WeekPlan[]
  // what the page needs to draw a week at all: the run's workouts, and a sequence run's slots (the slot's workout, by position)
  h.workoutDays = w.db.v2_workout_days
    .filter((d) => d.program_id === w.programId)
    .map((d) => ({ id: d.id, programId: d.program_id, userId: 'u-test', name: d.name, position: d.position, exercises: [] }))
  const slots = new Map<number, string>()
  for (const p of w.db.v2_week_plans) if (p.sequence_position !== null && !slots.has(p.sequence_position)) slots.set(p.sequence_position, p.workout_day_id)
  h.sequenceItems = [...slots.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([position, workoutDayId]) => ({ id: `si-${position}`, userId: 'u-test', programId: w.programId, position, workoutDayId }))
  // what locks a row in Plan: the rows with a session done
  h.done = new Set(Object.entries(statuses).filter(([, status]) => status === 'done').map(([planId]) => planId))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  queryClient.clear()
  queryClient.setDefaultOptions({ queries: { retry: false } })
  h.cycle = 2
})
afterEach(() => {
  cleanup()
  queryClient.clear()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

// ─── The two numbers ──────────────────────────────────────────────────────────────────────────────────────────────────

const BUTTON = /^CHANGE THE PROGRAM FROM (WEEK|CYCLE) (\d+)$/
const RULE = /^Changes start in (week|cycle) (\d+)\./

/** The number on PlanPage's button, once the statuses it reads have arrived. */
async function planButtonWeek(): Promise<number> {
  const askedBefore = fake.to('v2_sessions').length // the screen's own read of the same table may have come first
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/plan']}>
        <Routes>
          <Route path="/plan" element={<PlanPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(fake.to('v2_sessions').length).toBeGreaterThan(askedBefore))
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
  })
  const match = BUTTON.exec(screen.getByRole('button', { name: BUTTON }).textContent ?? '')!
  view.unmount()
  return Number(match[2])
}

/** The number in CHANGE THE PROGRAM's rule box, once the screen has read the run. */
async function ruleBoxWeek(): Promise<number> {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/plan', '/plan/change']} initialIndex={1}>
        <Routes>
          <Route path="/plan" element={<div>AT PLAN</div>} />
          <Route path="/plan/change" element={<ChangeProgramPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  const headline = await screen.findByText(RULE)
  const match = RULE.exec(headline.textContent ?? '')!
  view.unmount()
  return Number(match[2])
}

// Week-dependent world: Push (Monday), Pull (Tuesday), Legs (Thursday), weeks 2 and 3 planned, the run in week 2.
describe('PlanPage’s CHANGE THE PROGRAM button and CHANGE THE PROGRAM’s rule box name the same week, on the same rows', () => {
  const cases: Array<[string, () => World, Record<string, RunChangeStatus>, number]> = [
    ['nothing started: the current week', weekDependentWorld, {}, 2],
    ['the first session done, the others not started: the current week', weekDependentWorld, { 'p2-push': 'done' }, 2],
    ['the week’s last open session in progress, the others done (172 (j)): the week after', weekDependentWorld, { 'p2-push': 'done', 'p2-pull': 'done', 'p2-legs': 'in_progress' }, 3],
    ['a session in progress and one not started: the not started one is where the changes start', weekDependentWorld, { 'p2-push': 'done', 'p2-pull': 'in_progress' }, 2],
    ['the week all done: the week after', weekDependentWorld, { 'p2-push': 'done', 'p2-pull': 'done', 'p2-legs': 'done' }, 3],
    ['the only session started is in progress, the rest not: the current week', weekDependentWorld, { 'p2-push': 'in_progress' }, 2],
    ['both planned weeks started, the last session in progress: the week after the last one planned', weekDependentWorld, { 'p2-push': 'done', 'p2-pull': 'done', 'p2-legs': 'done', 'p3-push': 'done', 'p3-pull': 'done', 'p3-legs': 'in_progress' }, 4],
    ['a stable run, its last open session in progress', stableWorld, { 'p2-fb': 'done', 'p2-arms': 'in_progress' }, 3],
    ['a stable run, one shared session not started', stableWorld, { 'p2-fb': 'done' }, 2],
  ]
  for (const [name, make, statuses, expected] of cases) {
    it(name, async () => {
      useWorld(make(), statuses)
      const screenWeek = await ruleBoxWeek()
      const buttonWeek = await planButtonWeek()
      expect(screenWeek).toBe(expected)
      expect(buttonWeek).toBe(screenWeek)
    })
  }

  it('a sequence run: the cycle after the one whose last open slot is in progress, on the button and in the rule box', async () => {
    useWorld(sequenceWorld(), { 'c2-s0': 'done', 'c2-s1': 'done', 'c2-s2': 'done', 'c2-s3': 'in_progress' })
    const screenCycle = await ruleBoxWeek()
    const buttonCycle = await planButtonWeek()
    expect(screenCycle).toBe(3)
    expect(buttonCycle).toBe(screenCycle)
  })

  it('a sequence run with a slot not started: the current cycle on both', async () => {
    useWorld(sequenceWorld(), { 'c2-s0': 'done', 'c2-s1': 'in_progress' })
    const screenCycle = await ruleBoxWeek()
    const buttonCycle = await planButtonWeek()
    expect(screenCycle).toBe(2)
    expect(buttonCycle).toBe(screenCycle)
  })

  it('a second world is read, not remembered: the same page names the week of the statuses it is given (Plan holds them for five minutes)', async () => {
    // Pull in progress with Legs not started: the changes start in week 2; Legs in progress as well: the week after.
    useWorld(weekDependentWorld(), { 'p2-push': 'done', 'p2-pull': 'in_progress' })
    const notStarted = await planButtonWeek()
    useWorld(weekDependentWorld(), { 'p2-push': 'done', 'p2-pull': 'done', 'p2-legs': 'in_progress' })
    const lastInProgress = await planButtonWeek()
    expect([notStarted, lastInProgress]).toEqual([2, 3])
  })
})
