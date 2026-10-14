import { describe, it, expect, vi, beforeEach } from 'vitest'

// Migration 042 (TASKS-1.2 chunk 36) adds v2_week_plan_sets.target_rir_max, the
// high end of a RIR range (target_rir stays the number / the low end). This
// chunk only READS it: toSet() maps it to WeekPlanSet.targetRirMax, with null
// for a plain number and for a row from a database that has not applied 042
// yet (the key is absent from the row). Nothing writes it until chunk 54a.
//
// Reached through fetchWeekPlans (select '*', so the column arrives with the
// row) with the Supabase client mocked at the module boundary, the way the
// other service tests do.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args), rpc: vi.fn() },
}))

const { fetchWeekPlans } = await import('./weekPlanService')

function setRow(overrides: Record<string, unknown>) {
  return {
    id: 'set-1',
    week_plan_id: 'wp-1',
    user_id: 'u1',
    program_exercise_id: 'pe-1',
    set_number: 1,
    target_rir: 2,
    is_dropset: false,
    ...overrides,
  }
}

function planRow(sets: unknown[]) {
  return {
    id: 'wp-1',
    user_id: 'u1',
    mesocycle_id: 'm-1',
    workout_day_id: 'wd-1',
    week_number: 3,
    is_deload: false,
    notes: null,
    created_at: '2026-10-05T00:00:00Z',
    v2_week_plan_sets: sets,
    v2_week_plan_exercises: [],
  }
}

function plansChain(rows: unknown[]) {
  const result = { data: rows, error: null }
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('toSet — the RIR range\'s high end (target_rir_max)', () => {
  it('a ranged set maps both ends: target_rir 1 stays targetRir, target_rir_max 2 becomes targetRirMax', async () => {
    fromMock.mockReturnValue(
      plansChain([planRow([setRow({ id: 'set-range', target_rir: 1, target_rir_max: 2 })])]),
    )

    const [plan] = await fetchWeekPlans('m-1', 3)

    const set = plan.sets.find((s) => s.id === 'set-range')!
    expect(set.targetRir).toBe(1)
    expect(set.targetRirMax).toBe(2)
  })

  it('a plain number has no high end: target_rir_max null reads null', async () => {
    fromMock.mockReturnValue(
      plansChain([planRow([setRow({ id: 'set-number', target_rir: 2, target_rir_max: null })])]),
    )

    const [plan] = await fetchWeekPlans('m-1', 3)

    const set = plan.sets.find((s) => s.id === 'set-number')!
    expect(set.targetRir).toBe(2)
    expect(set.targetRirMax).toBeNull()
  })

  it('a row from a database that has not applied 042 (no target_rir_max key at all) reads null, never undefined', async () => {
    const legacy = setRow({ id: 'set-legacy', target_rir: 3 })
    expect('target_rir_max' in legacy).toBe(false)
    fromMock.mockReturnValue(plansChain([planRow([legacy])]))

    const [plan] = await fetchWeekPlans('m-1', 3)

    expect(plan.sets[0].targetRirMax).toBeNull()
  })

  it('a set with no RIR target at all (a warmup) keeps both ends null', async () => {
    fromMock.mockReturnValue(
      plansChain([planRow([setRow({ id: 'set-warmup', target_rir: null, target_rir_max: null, is_warmup: true })])]),
    )

    const [plan] = await fetchWeekPlans('m-1', 3)

    expect(plan.sets[0].targetRir).toBeNull()
    expect(plan.sets[0].targetRirMax).toBeNull()
  })
})
