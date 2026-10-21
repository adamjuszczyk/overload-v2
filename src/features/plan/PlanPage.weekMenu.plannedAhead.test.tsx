// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { format, subDays } from 'date-fns'
import type { Mesocycle, Program, WorkoutDay } from '../../types'
import { queryClient } from '../../lib/queryClient'
import { EMPTY_SCHEDULE } from '../programs/programService'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { createFakeDeloadDb, fakePlan, fakeSet, type FakePlanRow, type FakeSetRow } from './fakeDeloadDb.testutil'
import { closeSheet, openWeekMenu, openWeekTile } from './planMenus.testutil'

// Chunk 52, review 1, F1 (RULES: "A writer that takes its target from what the screen has open is tested with something open other than what
// the screen opens on"). WEEK ⋯ is offered on a week planned ahead as well as on the current week (a week PLAN FORWARD has planned is one),
// and MARK WEEK AS DELOAD / UNMARK THIS WEEK in its sheet write the week that is OPEN. Every earlier test of that button ran on a run whose
// open week was also its current week, so a hook built for the current week instead of the open one passed all of them.
//
// This is the call-site proof, through the real code from the screen down to the rows: the real PlanPage, the real `useSetWeekDeload` and the
// real weekPlanService.ts (`markWeekDeload`, `unmarkWeekDeload`) run against a stateful in-memory Supabase (fakeDeloadDb.testutil.ts: it
// applies the writes, so the page refetches what a user would see). Nothing about the week is mocked.
//
// The fixture tells the right week from the wrong one: a run in its third week with weeks 1 to 4 planned, each with a Push and a Pull
// session (so "every session of the week" is told from "one session"), WEEK 4 opened from its tile. The rows that end up marked are read from
// the database stand-in by id, so a mark that went to week 3 (the current week) or to week 5 (the first unplanned) or to one session shows.
// The control is the same screen with week 3, the current week, open: its mark goes to week 3 and week 4 stays unmarked.
// Break proofs (chunk 52's report, attempt 2): the hook built for the current week instead of the open one (`tilesCurrent` for `viewWeek`).

afterEach(() => {
  cleanup()
  queryClient.clear()
  useSettingsStore.setState(DEFAULT_SETTINGS)
})
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
  queryClient.setDefaultOptions({ queries: { retry: false } })
})

// A run that started 14 days ago: the same weekday two calendar weeks back, so today is in week 3 on any day the suite runs (the tiles are
// asserted below, so a wrong week would fail on the first line rather than pass on the wrong ones).
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
    from: (table: string) => (fake.client.from as (t: string) => unknown)(table),
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
vi.mock('./useReview', () => ({ useReview: () => ({ status: 'ready', groups: [], count: 0, error: null }) })) // REVIEW's line (chunk 56): nothing differed here
vi.mock('./usePlanSessions', () => ({ usePlanSessions: () => undefined })) // the week view's session states (chunk 54b): none here
vi.mock('./useDoneWeekPlanIds', () => ({ useDoneWeekPlanIds: () => new Set<string>() }))
vi.mock('./usePlanRowStatuses', () => ({ usePlanRowStatuses: () => new Map<string, 'done' | 'in_progress'>() }))
vi.mock('./useRunSchedule', () => ({ useRunSchedule: () => ({ data: [] }) }))
vi.mock('./MoveSessionControl', () => ({ default: () => null }))

const { default: PlanPage } = await import('./PlanPage')

const WEEKS = [1, 2, 3, 4]
const planId = (week: number, day: 'push' | 'pull') => `wp-${week}-${day}`
const idsOfWeek = (week: number) => [planId(week, 'push'), planId(week, 'pull')]

// Weeks 1 to 4 planned: two sessions each, two sets each. No rules in Settings (the default), so a mark is the flag alone and no set moves.
function buildWorld() {
  const plans: FakePlanRow[] = WEEKS.flatMap((week) => [
    fakePlan(planId(week, 'push'), week, { workout_day_id: 'wd-push' }),
    fakePlan(planId(week, 'pull'), week, { workout_day_id: 'wd-pull' }),
  ])
  const sets: FakeSetRow[] = plans.flatMap((plan) =>
    [1, 2].map((n) => fakeSet(plan.id, `${plan.id}-s${n}`, n, { target_rir: 2, target_weight: 100, rep_min: 8, rep_max: 10 })),
  )
  fake = createFakeDeloadDb({ plans, sets, exercises: [] })
}

function renderPlanPage() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/plan']}>
        <PlanPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const FOUND = { timeout: 5000 }
const tileLabels = () => Array.from(document.querySelectorAll<HTMLElement>('[data-week]')).map((el) => el.getAttribute('aria-label'))
/** The ids of the sessions the database stand-in holds as deload, sorted. */
const deloaded = () => fake.state.plans.filter((p) => p.is_deload).map((p) => p.id).sort()
const updatesToPlans = () => fake.writes.filter((w) => w.table === 'v2_week_plans' && w.method === 'update')
const SETS_BEFORE = WEEKS.length * 2 * 2

/** The strip as it reads for the fixture: the run is in week 3, weeks 1 to 4 are planned (the printed queue the tests stand on). */
async function openedPlan() {
  renderPlanPage()
  await screen.findByLabelText('Week 3 options', {}, FOUND)
  expect(tileLabels()).toEqual(['WEEK 1 · DONE', 'WEEK 2 · DONE', 'WEEK 3 · THIS WEEK', 'WEEK 4 · PLANNED', 'WEEK 5 · NOT PLANNED'])
}

describe('WEEK ⋯ on a week planned ahead marks that week, not the current one (chunk 52, F1)', () => {
  it('WEEK 4 open: MARK WEEK AS DELOAD marks both of week 4\'s sessions and nothing in weeks 1 to 3; UNMARK THIS WEEK takes week 4\'s marks off again', async () => {
    buildWorld()
    await openedPlan()
    expect(deloaded()).toEqual([])

    openWeekTile('WEEK 4')
    await screen.findByLabelText('Week 4 options', {}, FOUND)
    openWeekMenu()
    fireEvent.click(await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND))

    // The rows by id first, so a mark that went to the current week reads as week 3's ids and not as a screen that never changed.
    await waitFor(() => expect(deloaded().length).toBeGreaterThan(0), FOUND)
    expect(deloaded()).toEqual(idsOfWeek(4).sort())
    for (const week of [1, 2, 3]) expect(fake.state.plans.filter((p) => p.week_number === week).every((p) => !p.is_deload)).toBe(true)
    // The sheet follows what the open week now is, read back through the page's own refetch of week 4.
    await screen.findByText('UNMARK THIS WEEK', {}, FOUND)
    // Flag only: one update of the flag per session of the week, nothing else written (no set moved, no week planned).
    expect(updatesToPlans().map((w) => w.args[0])).toEqual([{ is_deload: true }, { is_deload: true }])
    expect(fake.writes.filter((w) => w.table !== 'v2_week_plans')).toEqual([])
    expect(fake.state.sets).toHaveLength(SETS_BEFORE)

    fireEvent.click(screen.getByText('UNMARK THIS WEEK'))
    await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND)
    expect(deloaded()).toEqual([]) // week 4's marks are off, and nothing else was marked on the way
    expect(updatesToPlans().map((w) => w.args[0])).toEqual([{ is_deload: true }, { is_deload: true }, { is_deload: false }, { is_deload: false }])
    expect(fake.writes.filter((w) => w.table !== 'v2_week_plans')).toEqual([])
  })

  it('control, the current week (3) open: its mark goes to week 3\'s sessions and week 4, planned ahead, stays unmarked', async () => {
    buildWorld()
    await openedPlan()

    openWeekMenu() // the page opens on the current week
    fireEvent.click(await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND))

    await waitFor(() => expect(deloaded().length).toBeGreaterThan(0), FOUND)
    expect(deloaded()).toEqual(idsOfWeek(3).sort())
    expect(fake.state.plans.filter((p) => p.week_number === 4).every((p) => !p.is_deload)).toBe(true)
    await screen.findByText('UNMARK THIS WEEK', {}, FOUND)

    fireEvent.click(screen.getByText('UNMARK THIS WEEK'))
    await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND)
    expect(deloaded()).toEqual([])
  })

  it('the sheet reads the open week: with week 4 marked, week 3\'s own WEEK ⋯ still offers to mark it', async () => {
    buildWorld()
    await openedPlan()

    openWeekTile('WEEK 4')
    await screen.findByLabelText('Week 4 options', {}, FOUND)
    openWeekMenu()
    fireEvent.click(await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND))
    await screen.findByText('UNMARK THIS WEEK', {}, FOUND)
    expect(deloaded()).toEqual(idsOfWeek(4).sort())
    closeSheet()

    openWeekTile('WEEK 3')
    await screen.findByLabelText('Week 3 options', {}, FOUND)
    openWeekMenu()
    expect(await screen.findByText('MARK WEEK AS DELOAD', {}, FOUND)).toBeTruthy()
    expect(screen.queryByText('UNMARK THIS WEEK')).toBeNull()
  })
})
