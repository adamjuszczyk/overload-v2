// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { subWeeks, format } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay } from '../../types'
import { EMPTY_SCHEDULE } from '../programs/programService'
import {
  createFakeSupabase,
  fakeWeekPlan,
  fakeWeekPlanExercise,
  fakeWeekPlanSet,
} from './fakeWeekPlanDb.testutil'

// Chunk 27 (TASKS-1.1: "Rule: stored values are ignored by copying — Client: COPY WEEK on PlanPage (copyOnePlanForward), from a source row
// whose carry fields name a different slot and position → the inserted v2_week_plan_exercises payload has the source row's own
// program_exercise_id and position, and each set keeps its own program_exercise_id"), carried to chunk 52's COPY (SPEC Weeks and copying
// [1.2] → COPY (2c); Data model: "Client writes to existing `v2_week_plan_sets` rows ..., one `v2_apply_ops` call").
//
// This is the screen-level twin of copySheetLogic.test.ts. It mocks NOTHING of Plan's own code: the real PlanPage, the real useWeekPlan.ts
// reads, the real CopySheet, useCopyNumbers and applyOps run, against an in-memory Supabase (fakeWeekPlanDb.testutil.ts), and the
// assertions are on the request that reaches the database client. Tapping COPY INTO N WORKOUTS on week 2 therefore goes
// PlanPage -> copyRows -> CopySheet -> copyNumbers -> numbersOps -> useCopyNumbers -> applyOps -> `v2_apply_ops`.
//
// The fixture tells the right data source from the wrong one: week 1 (the source) holds exercises whose stored carry values name another
// exercise row and another position (what an old "only this week" tick left), and their sets carry weights; week 2 holds its own rows for
// the same exercises, in the other order, with empty boxes. A copy that read the stored carry values (the exercise it names, the position
// it stores) would pair the wrong rows or none, and the ops would name other sets or be fewer.
// Break proofs (chunk 52's report): toProgramExerciseFromWeekPlanExercise reading carry_position / carry_program_exercise_id;
// numbersOps naming a set other than the target's.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// Week 2 of a meso that started 8 days ago, so the page opens on week 2.
const startDate = format(subWeeks(new Date(), 1), 'yyyy-MM-dd')

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate, endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-1' },
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  kind: 'run', planningType: 'week_dependent',
}
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

let fake = createFakeSupabase([])

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => (fake.client.from as (t: string) => unknown)(table),
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
// Plan reads the run's schedule rows (useRunSchedule, chunk 50): this file's run has none, so every week is the run copy's.
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

// Week 1 is the source; its exercise rows are what an old "only this week" tick left: 'pe-swapped-in' stores
// carry_program_exercise_id = 'pe-original' and carry_position = 0 while its own position is 1; 'pe-b' stores carry_position 5 against
// its own position 0. Every set has the weight a copy should take (b: 60; swapped head 100 with a drop stage at 80) and RIR 2, which
// week 2's sets have too, so what a copy changes is the weights. Week 2 lists the same two exercises in the other order, each its own
// row (pe-b2, pe-s2), with empty weight boxes.
function buildWorld() {
  const source = fakeWeekPlan('wp-1', 1, {
    sets: [
      fakeWeekPlanSet('wp-1', 's-b-1', 'pe-b', { set_number: 1, target_weight: 60 }),
      fakeWeekPlanSet('wp-1', 's-swapped-1', 'pe-swapped-in', { set_number: 1, target_weight: 100 }),
      fakeWeekPlanSet('wp-1', 's-swapped-1-drop', 'pe-swapped-in', {
        set_number: 1, is_dropset: true, parent_week_plan_set_id: 's-swapped-1', stage_index: 1, target_rir: 2, target_weight: 80,
      }),
    ],
    exercises: [
      fakeWeekPlanExercise('wp-1', 'pe-swapped-in', 1, { programExerciseId: 'pe-original', position: 0 }, 'ex-swapped'),
      fakeWeekPlanExercise('wp-1', 'pe-b', 0, { position: 5 }, 'ex-b'),
    ],
  })
  const target = fakeWeekPlan('wp-2', 2, {
    sets: [
      fakeWeekPlanSet('wp-2', 't-s-1', 'pe-s2', { set_number: 1 }),
      fakeWeekPlanSet('wp-2', 't-s-1-drop', 'pe-s2', { set_number: 1, is_dropset: true, parent_week_plan_set_id: 't-s-1', stage_index: 1 }),
      fakeWeekPlanSet('wp-2', 't-b-1', 'pe-b2', { set_number: 1 }),
    ],
    exercises: [
      fakeWeekPlanExercise('wp-2', 'pe-s2', 0, {}, 'ex-swapped'),
      fakeWeekPlanExercise('wp-2', 'pe-b2', 1, {}, 'ex-b'),
    ],
  })
  fake = createFakeSupabase([source, target])
}

function renderPlanPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const opsSent = () => fake.writes.filter((w) => w.table === 'rpc' && w.method === 'v2_apply_ops').map((w) => (w.args[0] as { p_ops: unknown[] }).p_ops)

describe('PlanPage — COPY copies a source row with stored carry values as its own content (chunk 27, carried to chunk 52)', () => {
  it('COPY INTO 1 WORKOUT sends one v2_apply_ops with an update per target set, taking each exercise\'s numbers from the source row of the same exercise', async () => {
    buildWorld()
    renderPlanPage()

    fireEvent.click(await screen.findByText('COPY'))
    const sheet = within(await screen.findByRole('dialog', { name: "Copy last week's numbers" }))
    expect(sheet.getByText("WEEK 2 · FROM WEEK 1'S PLAN")).toBeTruthy()
    fireEvent.click(sheet.getByText('COPY INTO 1 WORKOUT'))

    await waitFor(() => expect(opsSent()).toHaveLength(1))
    // The target rows' ids, in this week's exercise order (pe-s2 first), each with the weight of the source set of the same exercise.
    expect(opsSent()[0]).toEqual([
      { op: 'update', table: 'v2_week_plan_sets', id: 't-s-1', patch: { target_weight: 100 } },
      { op: 'update', table: 'v2_week_plan_sets', id: 't-s-1-drop', patch: { target_weight: 80 } },
      { op: 'update', table: 'v2_week_plan_sets', id: 't-b-1', patch: { target_weight: 60 } },
    ])
    // Numbers only: no exercise row, no set row is inserted, upserted or deleted by a copy.
    expect(fake.writes.filter((w) => w.table !== 'rpc')).toEqual([])
    expect(fake.writes.map((w) => `${w.table}:${w.method}`)).toEqual(['rpc:v2_apply_ops'])
  })
})
