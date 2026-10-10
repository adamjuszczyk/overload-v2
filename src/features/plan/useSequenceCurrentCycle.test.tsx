// @vitest-environment jsdom
//
// Chunk 35 — useSequenceCurrentCycle.ts, Plan's reading of a sequence run's
// current cycle (SPEC Scheduling → Sequence [P1.1], G40: "the one containing
// the next due workout"). Two things are proven here, at the hook layer that
// applies them:
//   1. while any of its three reads (the run's sequence, every week plan, the
//      last workout done or skipped) hasn't answered, it names no cycle (null);
//      "nothing done yet" is an answer, not a wait;
//   2. it agrees with Today: for the same query results, the cycle it returns is
//      the cycle useSequenceScheduler (Today) puts its next workout in — the
//      two run the same last-event rule (sequenceLastEvent.ts) over the same
//      data, so a scenario table is enough to catch them drifting apart.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import type { WorkoutDay, WeekPlan, Session, SequenceItem, Mesocycle } from '../../types'

let workoutDays: WorkoutDay[] = []
let sequenceItems: SequenceItem[] | undefined = []
let allWeekPlans: WeekPlan[] | undefined = []
let lastDoneOrSkipped: Session | null | undefined = null
let sessions: Session[] = []

vi.mock('../programs/usePrograms', () => ({
  useWorkoutDays: () => ({ data: workoutDays }),
  useSequenceItems: () => ({ data: sequenceItems }),
}))
vi.mock('./useWeekPlan', () => ({
  useAllWeekPlans: () => ({ data: allWeekPlans }),
}))
vi.mock('../gym/useSession', () => ({
  useLastDoneOrSkippedSession: () => ({ data: lastDoneOrSkipped }),
  useSessionsInRange: () => ({ data: sessions }),
}))

const { useSequenceCurrentCycle } = await import('./useSequenceCurrentCycle')
const { useSequenceScheduler } = await import('../gym/useSequenceScheduler')

afterEach(() => {
  cleanup()
  workoutDays = []
  sequenceItems = []
  allWeekPlans = []
  lastDoneOrSkipped = null
  sessions = []
})

const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'u1', name: 'Seq', programId: 'prog-1', status: 'active',
  startDate: '2026-01-05', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}

// Renders Plan's cycle and Today's result side by side, from the same mocks.
function Probe() {
  const plan = useSequenceCurrentCycle('meso-1', 'prog-1')
  const today = useSequenceScheduler('2026-03-01', activeMeso, 'prog-1')
  return <div data-testid="out">{JSON.stringify({ plan, today: today.result, todayLoading: today.isLoading })}</div>
}

function read(): { plan: number | null; today: { type: string; next?: { weekNumber: number }; session?: Session } | null; todayLoading: boolean } {
  render(<Probe />)
  return JSON.parse(screen.getByTestId('out').textContent!)
}

function item(position: number, workoutDayId: string | null): SequenceItem {
  return { id: `si-${position}`, userId: 'u1', programId: 'prog-1', position, workoutDayId }
}

function weekPlan(id: string, weekNumber: number, sequencePosition: number | null, workoutDayId = 'wd-a'): WeekPlan {
  return {
    id, userId: 'u1', mesocycleId: 'meso-1', workoutDayId, weekNumber, isDeload: false, notes: null,
    sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z', sequencePosition,
  }
}

function session(overrides: Partial<Session> & { id: string }): Session {
  return {
    userId: 'u1', mesocycleId: 'meso-1', weekPlanId: null, workoutDayId: 'wd-a', date: '2026-02-01',
    status: 'completed', note: null, startedAt: '2026-02-01T09:00:00Z', completedAt: '2026-02-01T10:00:00Z',
    createdAt: '2026-02-01T09:00:00Z', setLogs: [], energyRating: null, pumpRating: null, movedToDate: null,
    ...overrides,
  }
}

const ABC = [item(0, 'wd-a'), item(1, 'wd-b'), item(2, 'wd-c')]
const ABAR = [item(0, 'wd-a'), item(1, 'wd-b'), item(2, 'wd-a'), item(3, null)]

describe('useSequenceCurrentCycle — no cycle until its three reads have answered', () => {
  it('the sequence not loaded → null', () => {
    sequenceItems = undefined
    allWeekPlans = []
    lastDoneOrSkipped = null
    expect(read().plan).toBeNull()
  })

  it('the meso\'s week plans not loaded → null (the last event can\'t be placed without them)', () => {
    sequenceItems = ABC
    allWeekPlans = undefined
    lastDoneOrSkipped = session({ id: 's-1', weekPlanId: 'wp-1' })
    expect(read().plan).toBeNull()
  })

  it('the last-event read not answered (undefined) → null', () => {
    sequenceItems = ABC
    allWeekPlans = [weekPlan('wp-1', 2, 1)]
    lastDoneOrSkipped = undefined
    expect(read().plan).toBeNull()
  })

  it('the last-event read answered "none" (null) is an answer: cycle 1', () => {
    sequenceItems = ABC
    allWeekPlans = []
    lastDoneOrSkipped = null
    expect(read().plan).toBe(1)
  })
})

describe('useSequenceCurrentCycle — agrees with Today on the same data', () => {
  const scenarios: {
    name: string
    items: SequenceItem[]
    plans: WeekPlan[]
    last: Session | null
    expectedCycle: number
  }[] = [
    { name: 'nothing done yet', items: ABAR, plans: [], last: null, expectedCycle: 1 },
    {
      name: 'mid-cycle: B of cycle 2 done',
      items: ABC, plans: [weekPlan('wp-c2-s1', 2, 1, 'wd-b')],
      last: session({ id: 's-1', weekPlanId: 'wp-c2-s1', workoutDayId: 'wd-b' }), expectedCycle: 2,
    },
    {
      name: 'the last workout of cycle 2 done',
      items: ABC, plans: [weekPlan('wp-c2-s2', 2, 2, 'wd-c')],
      last: session({ id: 's-1', weekPlanId: 'wp-c2-s2', workoutDayId: 'wd-c' }), expectedCycle: 3,
    },
    {
      name: 'the last workout of cycle 2 SKIPPED',
      items: ABC, plans: [weekPlan('wp-c2-s2', 2, 2, 'wd-c')],
      last: session({ id: 's-1', weekPlanId: 'wp-c2-s2', workoutDayId: 'wd-c', status: 'skipped' }), expectedCycle: 3,
    },
    {
      name: 'second A of A, B, A, rest done (the row names slot 2, not slot 0)',
      items: ABAR, plans: [weekPlan('wp-c3-s0', 3, 0), weekPlan('wp-c3-s2', 3, 2)],
      last: session({ id: 's-1', weekPlanId: 'wp-c3-s2' }), expectedCycle: 4,
    },
    {
      name: 'first A of A, B, A, rest done',
      items: ABAR, plans: [weekPlan('wp-c3-s0', 3, 0), weekPlan('wp-c3-s2', 3, 2)],
      last: session({ id: 's-1', weekPlanId: 'wp-c3-s0' }), expectedCycle: 3,
    },
    {
      name: 'the last session names a week plan that is not in the list (unresolvable → nothing trained)',
      items: ABC, plans: [weekPlan('wp-other', 4, 1)],
      last: session({ id: 's-1', weekPlanId: 'wp-gone' }), expectedCycle: 1,
    },
    {
      name: 'the last session names a weekday-shaped row (no slot) → nothing trained',
      items: ABC, plans: [weekPlan('wp-wd', 4, null)],
      last: session({ id: 's-1', weekPlanId: 'wp-wd' }), expectedCycle: 1,
    },
  ]

  for (const s of scenarios) {
    it(s.name, () => {
      workoutDays = []
      sequenceItems = s.items
      allWeekPlans = s.plans
      lastDoneOrSkipped = s.last
      const out = read()
      expect(out.todayLoading).toBe(false)
      expect(out.today?.type).toBe('next')
      expect(out.today?.next?.weekNumber).toBe(s.expectedCycle)
      expect(out.plan).toBe(s.expectedCycle)
    })
  }

  it('a workout in progress is that slot: cycle 2\'s last workout in progress keeps cycle 2 current in Plan, and Today shows that session', () => {
    sequenceItems = ABC
    allWeekPlans = [weekPlan('wp-c2-s1', 2, 1, 'wd-b'), weekPlan('wp-c2-s2', 2, 2, 'wd-c')]
    // B of cycle 2 is the last one done; C (cycle 2, the cycle's last workout) is in progress.
    lastDoneOrSkipped = session({ id: 's-b', weekPlanId: 'wp-c2-s1', workoutDayId: 'wd-b' })
    sessions = [session({ id: 's-c', weekPlanId: 'wp-c2-s2', workoutDayId: 'wd-c', status: 'in_progress', completedAt: null, date: '2026-03-01' })]
    const out = read()
    expect(out.today?.type).toBe('active_session')
    expect(out.today?.session?.weekPlanId).toBe('wp-c2-s2')
    expect(out.plan).toBe(2)
  })

  it('a sequence with no workout: Today says no_workouts, Plan says cycle 1', () => {
    sequenceItems = [item(0, null), item(1, null)]
    allWeekPlans = []
    lastDoneOrSkipped = null
    const out = read()
    expect(out.today?.type).toBe('no_workouts')
    expect(out.plan).toBe(1)
  })
})
