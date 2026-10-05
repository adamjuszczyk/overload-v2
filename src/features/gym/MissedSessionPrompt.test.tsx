// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import type { Mesocycle, MissedSession, WorkoutDay, WeekPlan } from '../../types'

// Chunk 8, review fix #2 ("DO IT NOW skips planning") — TASKS.md: "starting
// the first session of a new week plans it". DO IT NOW starts a session
// for the MISSED date, which can fall in a week never opened in Plan, so
// this must plan THAT date's week (the house rule, CONTEXT.md), not
// today's. planWeekThenFindId itself (its success/fallback behaviour) is
// unit-tested exhaustively in useWeekPlan.test.tsx; this file's own job is
// narrower — does the component compute the right week number from the
// missed date and correctly wire whatever planWeekThenFindId returns (the
// freshly planned id, or the fallback on failure) into createSession.
// planWeekThenFindId is therefore mocked directly, each test choosing
// which of its two real outcomes to simulate — not re-proving the fallback
// mechanism, which already has its own tests and break-proofs.

afterEach(() => cleanup())
beforeEach(() => {
  createSessionMutateAsync.mockClear()
  skipMissedMutateAsync.mockClear()
  planWeekThenFindIdMock.mockClear()
})

const createSessionMutateAsync = vi.fn().mockResolvedValue(undefined)
const skipMissedMutateAsync = vi.fn().mockResolvedValue(undefined)
const planWeekThenFindIdMock = vi.fn()

vi.mock('./useSession', () => ({
  useCreateSession: () => ({ mutateAsync: createSessionMutateAsync, isPending: false }),
  useSkipMissedSession: () => ({ mutateAsync: skipMissedMutateAsync, isPending: false }),
}))
vi.mock('../plan/useWeekPlan', () => ({
  usePlanWeek: () => ({ isPending: false }),
  planWeekThenFindId: (...args: unknown[]) => planWeekThenFindIdMock(...args),
}))

const { default: MissedSessionPrompt } = await import('./MissedSessionPrompt')

// Meso starts Monday 2026-01-05 (verified: `date -d 2026-01-05 +%A` →
// Monday). The missed date below, 2026-01-20, is a Tuesday in the THIRD
// Monday-anchored calendar week (week 1: Jan 5–11, week 2: Jan 12–18,
// week 3: Jan 19–25) — hand-verified, not derived from the same formula
// the component uses, so this can't pass by circular accident.
const activeMeso: Mesocycle = {
  id: 'meso-1', userId: 'user-1', name: 'Test Meso', programId: 'prog-1',
  status: 'active', startDate: '2026-01-05', endDate: null, createdAt: '2026-01-01T00:00:00Z',
}
const MISSED_DATE = '2026-01-20'
const EXPECTED_WEEK_NUMBER = 3

const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}

function makeMissed(weekPlan: WeekPlan | null): MissedSession {
  return { date: MISSED_DATE, weekPlan, workoutDay, existingSessionId: null }
}

const existingPlan: WeekPlan = {
  id: 'wp-existing', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1',
  weekNumber: EXPECTED_WEEK_NUMBER, isDeload: false, notes: null, sets: [], exercises: [],
  createdAt: '2026-01-01T00:00:00Z',
}

describe('MissedSessionPrompt — DO IT NOW plans the missed date\'s own week first', () => {
  it('computes the missed date\'s week (not today\'s) and passes it to planWeekThenFindId', async () => {
    planWeekThenFindIdMock.mockResolvedValue('wp-freshly-planned')
    const { getByText } = render(
      <MissedSessionPrompt queue={[makeMissed(null)]} activeMeso={activeMeso} onDismiss={vi.fn()} />,
    )

    fireEvent.click(getByText('DO IT NOW'))
    await vi.waitFor(() => expect(planWeekThenFindIdMock).toHaveBeenCalled())

    expect(planWeekThenFindIdMock).toHaveBeenCalledWith(
      'meso-1', EXPECTED_WEEK_NUMBER, 'wd-1', null, expect.anything(),
    )
  })

  it('uses the freshly planned id when planning succeeds', async () => {
    planWeekThenFindIdMock.mockResolvedValue('wp-freshly-planned')
    const { getByText } = render(
      <MissedSessionPrompt queue={[makeMissed(existingPlan)]} activeMeso={activeMeso} onDismiss={vi.fn()} />,
    )

    fireEvent.click(getByText('DO IT NOW'))
    await vi.waitFor(() => expect(createSessionMutateAsync).toHaveBeenCalled())

    expect(createSessionMutateAsync).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: 'wp-freshly-planned', workoutDayId: 'wd-1', date: MISSED_DATE,
    })
  })

  it('falls back to the old (pre-existing) plan id when planning rejects', async () => {
    // What planWeekThenFindId itself actually returns when its internal
    // plan call or re-read rejects — see useWeekPlan.test.tsx.
    planWeekThenFindIdMock.mockResolvedValue(existingPlan.id)
    const { getByText } = render(
      <MissedSessionPrompt queue={[makeMissed(existingPlan)]} activeMeso={activeMeso} onDismiss={vi.fn()} />,
    )

    fireEvent.click(getByText('DO IT NOW'))
    await vi.waitFor(() => expect(createSessionMutateAsync).toHaveBeenCalled())

    expect(createSessionMutateAsync).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: existingPlan.id, workoutDayId: 'wd-1', date: MISSED_DATE,
    })
  })

  it('falls back to null when there was no pre-existing plan and planning rejects', async () => {
    planWeekThenFindIdMock.mockResolvedValue(null)
    const { getByText } = render(
      <MissedSessionPrompt queue={[makeMissed(null)]} activeMeso={activeMeso} onDismiss={vi.fn()} />,
    )

    fireEvent.click(getByText('DO IT NOW'))
    await vi.waitFor(() => expect(createSessionMutateAsync).toHaveBeenCalled())

    expect(createSessionMutateAsync).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: null, workoutDayId: 'wd-1', date: MISSED_DATE,
    })
  })
})

describe('MissedSessionPrompt — MARK SKIPPED stays exactly as it was', () => {
  it('skips with the pre-existing plan id directly, never calling planWeekThenFindId', async () => {
    const { getByText } = render(
      <MissedSessionPrompt queue={[makeMissed(existingPlan)]} activeMeso={activeMeso} onDismiss={vi.fn()} />,
    )

    fireEvent.click(getByText('MARK SKIPPED'))
    await vi.waitFor(() => expect(skipMissedMutateAsync).toHaveBeenCalled())

    expect(planWeekThenFindIdMock).not.toHaveBeenCalled()
    expect(skipMissedMutateAsync).toHaveBeenCalledWith({
      mesoId: 'meso-1', weekPlanId: existingPlan.id, workoutDayId: 'wd-1',
      date: MISSED_DATE, existingSessionId: null,
    })
  })
})
