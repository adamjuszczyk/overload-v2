// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
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

// Chunk 27 (TASKS-1.1: "Rule: stored values are ignored by copying — Client:
// COPY WEEK on PlanPage (copyOnePlanForward), from a source row whose carry
// fields name a different slot and position → the inserted
// v2_week_plan_exercises payload has the source row's own program_exercise_id
// and position, and each set keeps its own program_exercise_id").
//
// This is the screen-level twin of weekPlanService.copyForward.test.ts. It
// mocks NOTHING of Plan's own code: the real PlanPage, the real useWeekPlan.ts
// hooks and the real weekPlanService.ts run, against an in-memory Supabase
// (fakeWeekPlanDb.testutil.ts). Tapping COPY WEEK on week 2 therefore goes
// PlanPage -> useCopyFromPreviousWeek -> copyFromPreviousWeek ->
// copyOnePlanForward, and the assertions are on the rows that reach the
// database client. Break proof: restore the `carry_* ?? own` fallbacks in
// copyExercisesForward / the set remap in copySetsWithGrouping.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// Week 2 of a meso that started 8 days ago, so viewWeek mounts on week 2.
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

// Week 1 is the source; its rows are what an old "only this week" tick left:
// 'pe-swapped-in' stores carry_program_exercise_id = 'pe-original' and
// carry_position = 0 while its own position is 1; 'pe-b' stores carry_position
// 5 against its own position 0. Week 2 is the empty row v2_plan_week made.
let fake = createFakeSupabase([])

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => (fake.client.from as (t: string) => unknown)(table),
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [workoutDay], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

function buildWorld() {
  const source = fakeWeekPlan('wp-1', 1, {
    sets: [
      fakeWeekPlanSet('wp-1', 's-swapped-1', 'pe-swapped-in', { set_number: 1 }),
      fakeWeekPlanSet('wp-1', 's-swapped-1-drop', 'pe-swapped-in', {
        set_number: 1, is_dropset: true, parent_week_plan_set_id: 's-swapped-1', stage_index: 1, target_rir: 0,
      }),
      fakeWeekPlanSet('wp-1', 's-b-1', 'pe-b', { set_number: 1 }),
    ],
    exercises: [
      fakeWeekPlanExercise('wp-1', 'pe-swapped-in', 1, { programExerciseId: 'pe-original', position: 0 }),
      fakeWeekPlanExercise('wp-1', 'pe-b', 0, { position: 5 }),
    ],
  })
  fake = createFakeSupabase([source, fakeWeekPlan('wp-2', 2)])
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

describe('PlanPage — COPY WEEK copies a source row with stored carry values as its own content (chunk 27)', () => {
  it('tapping COPY WEEK upserts the source rows\' own program_exercise_id and position, and each copied set keeps its own program_exercise_id', async () => {
    buildWorld()
    renderPlanPage()

    fireEvent.click(await screen.findByText('COPY WEEK'))

    await waitFor(() => expect(fake.writes.some((w) => w.table === 'v2_week_plan_exercises' && w.method === 'upsert')).toBe(true))

    const upsert = fake.writes.find((w) => w.table === 'v2_week_plan_exercises' && w.method === 'upsert')!
    const [payloads] = upsert.args as [Record<string, unknown>[]]
    expect(payloads).toEqual([
      { week_plan_id: 'wp-2', user_id: 'user-1', program_exercise_id: 'pe-swapped-in', position: 1 },
      { week_plan_id: 'wp-2', user_id: 'user-1', program_exercise_id: 'pe-b', position: 0 },
    ])
    expect(payloads.map((p) => p.program_exercise_id)).not.toContain('pe-original')

    const setInserts = fake.writes
      .filter((w) => w.table === 'v2_week_plan_sets' && w.method === 'insert')
      .map((w) => w.args[0] as Record<string, unknown>)
    // Heads first (source order), then the stage — all under their OWN exercise rows.
    expect(setInserts.map((p) => p.program_exercise_id)).toEqual(['pe-swapped-in', 'pe-b', 'pe-swapped-in'])
    expect(setInserts.every((p) => p.week_plan_id === 'wp-2')).toBe(true)
  })
})
