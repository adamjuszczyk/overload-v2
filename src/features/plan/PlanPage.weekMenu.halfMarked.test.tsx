// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay } from '../../types'
import type { DeloadRules, DeloadRestoreEntry } from '../../lib/deloadRules'
import { queryClient } from '../../lib/queryClient'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { createFakeDeloadDb, fakePlan, fakeSet, type FakeExerciseSlot, type FakePlanRow, type FakeSetRow } from './fakeDeloadDb.testutil'
import { openWeekMenu, openWeekTile } from './planMenus.testutil'

// Chunk 188f (Adam, 2026-10-20; DECISIONS 188 (a)): the review of chunk 52 found, with its probe B, that a week mark cut off part way leaves
// the week half marked and that marking it again from WEEK ⋯ lost a session's saved plan. This is that probe through the screen the user
// presses: the real PlanPage, the real `useSetWeekDeload` and the real weekPlanService.ts over a stateful in-memory database
// (fakeDeloadDb.testutil.ts). The hook-level sequences (a session marked on its own, a mark cut off, a started session) and the guard's
// calls are useWeekPlan.deloadHalfMarked.test.tsx and weekPlanService.deloadSavedCopy.test.ts.
//
// The week is told from the others the way PlanPage.weekMenu.plannedAhead.test.tsx does it: a run in its third week, weeks 1 to 4 planned,
// WEEK 4 opened from its tile; the rules are Settings' (sets −50%, RIR +2), so four sets of 100 at RIR 2 mark as two sets at RIR 4.
// Break proof (the report): the guard removed from markSessionDeload.

afterEach(() => {
  cleanup()
  queryClient.clear()
  useSettingsStore.setState(DEFAULT_SETTINGS)
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  queryClient.setDefaultOptions({ queries: { retry: false } })
})

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: format(subDays(new Date(), 14), 'yyyy-MM-dd'), endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const wdPush: WorkoutDay = { id: 'wd-push', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const wdPull: WorkoutDay = { id: 'wd-pull', programId: 'prog-1', userId: 'user-1', name: 'Pull Day', position: 1, exercises: [] }
const program: Program = {
  id: 'prog-1', userId: 'user-1', name: 'Test Program', schedule: { ...EMPTY_SCHEDULE, monday: 'wd-push', wednesday: 'wd-pull' },
  workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  kind: 'run', planningType: 'week_dependent',
}

let fake = createFakeDeloadDb({ plans: [], sets: [], exercises: [] })

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const chain = (fake.client.from as (t: string) => Record<string, unknown>)(table)
      // The earlier weeks' log read filters by `.in`; the stand-in answers every v2_set_logs read with no rows (nothing was ever logged).
      if (!chain.in) chain.in = () => chain
      return chain
    },
    rpc: (name: string, args: unknown) => fake.client.rpc(name, args),
  },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../programs/useMesos', () => ({ useMesos: () => ({ data: [activeMeso], isLoading: false }) }))
vi.mock('../programs/usePrograms', async () => ({
  usePrograms: () => ({ data: [program], isLoading: false }),
  useWorkoutDays: () => ({ data: [wdPush, wdPull], isLoading: false }),
  useProgramExercises: () => ({ data: [], isLoading: false }),
  useSequenceItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../planner/usePlanner')>()),
  ...(await import('./plannerHooks.testutil')).quietPlannerHooks,
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')
const { markSessionDeload } = await import('./weekPlanService')

const WEEKS = [1, 2, 3, 4]
const planId = (week: number, day: 'push' | 'pull') => `wp-${week}-${day}`
const RULES: DeloadRules = { sets: { mode: 'percent', value: 50, rounding: 'down' }, rir: { delta: 2 } }
const FOUND = { timeout: 5000 }

// Weeks 1 to 4 planned: Push and Pull each, one exercise of four sets of 100 at RIR 2.
function buildWorld() {
  const plans: FakePlanRow[] = WEEKS.flatMap((week) => [
    fakePlan(planId(week, 'push'), week, { workout_day_id: 'wd-push' }),
    fakePlan(planId(week, 'pull'), week, { workout_day_id: 'wd-pull' }),
  ])
  const peOf = (plan: FakePlanRow) => (plan.workout_day_id === 'wd-push' ? 'pe-push' : 'pe-pull')
  const sets: FakeSetRow[] = plans.flatMap((plan) =>
    [1, 2, 3, 4].map((n) => fakeSet(plan.id, `${plan.id}-s${n}`, n, { program_exercise_id: peOf(plan), target_rir: 2, target_weight: 100, rep_min: 8, rep_max: 10 })),
  )
  const exercises: FakeExerciseSlot[] = plans.map((p) => ({ week_plan_id: p.id, program_exercise_id: peOf(p), exercise_id: peOf(p).replace('pe-', 'ex-') }))
  fake = createFakeDeloadDb({ plans, sets, exercises })
}

const content = (id: string) =>
  fake.state.sets.filter((s) => s.week_plan_id === id).map((s) => [s.set_number, s.target_weight, s.target_rir]).sort((a, b) => (a[0] as number) - (b[0] as number))
const planRow = (id: string) => fake.state.plans.find((p) => p.id === id)!
const ORIGINAL = [[1, 100, 2], [2, 100, 2], [3, 100, 2], [4, 100, 2]]
const MARKED = [[1, 100, 4], [2, 100, 4]]

describe('WEEK ⋯ on a half-marked week (the review of chunk 52, probe B; DECISIONS 188 (a))', () => {
  it("MARK WEEK AS DELOAD finishes the mark and leaves the session marked first as it was; UNMARK THIS WEEK then puts every session back to its plan", async () => {
    buildWorld()
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, deloadRules: RULES })
    // Week 4's Push was marked on its own (as a week mark that stopped after its first session leaves it); Pull was not reached.
    expect(await markSessionDeload('user-1', planId(4, 'push'), RULES)).toBe('calculated')
    expect(content(planId(4, 'push'))).toEqual(MARKED)
    const copyAfterFirstMark = JSON.parse(JSON.stringify(planRow(planId(4, 'push')).deload_restore)) as DeloadRestoreEntry[]
    expect(copyAfterFirstMark).toHaveLength(4)
    expect(planRow(planId(4, 'pull')).is_deload).toBe(false)

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/plan']}>
          <PlanPage />
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await screen.findByLabelText('Week 3 options', {}, FOUND)
    // The queue the fixture stands on: the run is in week 3, weeks 1 to 4 are planned.
    expect(Array.from(document.querySelectorAll<HTMLElement>('[data-week]')).map((el) => el.getAttribute('aria-label'))).toEqual(
      ['WEEK 1 · DONE', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · PLANNED', 'WEEK 5 · NOT PLANNED'],
    )
    openWeekTile('WEEK 4')
    await screen.findByLabelText('Week 4 options', {}, FOUND)
    openWeekMenu()
    fireEvent.click(await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND)) // the half-marked week offers MARK, not UNMARK
    await screen.findByText('UNMARK THIS WEEK', {}, FOUND)

    // Push: sets and copy as its own mark left them. Pull: marked now, with the plan it had.
    expect(planRow(planId(4, 'push')).deload_restore).toEqual(copyAfterFirstMark)
    expect(content(planId(4, 'push'))).toEqual(MARKED)
    expect(planRow(planId(4, 'pull')).is_deload).toBe(true)
    expect(content(planId(4, 'pull'))).toEqual(MARKED)
    expect((planRow(planId(4, 'pull')).deload_restore as unknown[]).length).toBe(4)

    fireEvent.click(screen.getByText('UNMARK THIS WEEK'))
    await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND)
    await waitFor(() => expect(fake.state.plans.filter((p) => p.week_number === 4).every((p) => !p.is_deload)).toBe(true), FOUND)
    expect(content(planId(4, 'push'))).toEqual(ORIGINAL)
    expect(content(planId(4, 'pull'))).toEqual(ORIGINAL)
    for (const week of [1, 2, 3]) expect(fake.state.plans.filter((p) => p.week_number === week).every((p) => !p.is_deload && p.deload_restore === null)).toBe(true)
  })
})
