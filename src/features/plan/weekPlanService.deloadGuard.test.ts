import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chunk 22, reviewer's note 5 — "a session that has already started (any
// set log against that week plan): marking or unmarking never deletes or
// replaces planned sets that logs point at... flag-only." weekPlanService.ts
// imports the real Supabase client at module load time — mocked here the
// same way weekPlanService.updateSet.test.ts's own precedent does for this
// exact file, so the started guard's effect (which tables get touched, and
// how) can be inspected directly, without a real round trip.
//
// The guard runs FIRST in markSessionDeload/unmarkSessionDeload (right
// after the "rules === null" / "no snapshot" fast paths), before the
// history gather or the calculate/restore executors are ever reached — so
// proving "v2_week_plan_sets is never touched, and v2_week_plans gets only
// the plain flag update" is a complete, precise proof of the guard itself.

type Call = { table: string; method: string; args: unknown[] }
const calls: Call[] = []

function makeChain(table: string, result: { data?: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {}
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ table, method, args })
    return chain
  }
  chain.select = record('select')
  chain.eq = record('eq')
  chain.in = record('in')
  chain.update = record('update')
  chain.delete = record('delete')
  chain.insert = record('insert')
  chain.single = () => Promise.resolve(result)
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return chain
}

const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => fromMock(table) },
}))

const { markSessionDeload, unmarkSessionDeload } = await import('./weekPlanService')

beforeEach(() => {
  calls.length = 0
  fromMock.mockReset()
})

// Wires fromMock to answer every call this flow makes, started=true
// throughout: v2_sessions -> one session row; v2_set_logs (count mode) ->
// count 1 (some log exists); v2_week_plans -> whatever `weekPlanResult`
// says (markSessionDeload fetches the core row only when rules are on;
// unmarkSessionDeload always fetches it first for deload_restore).
function wireStarted(weekPlanResult?: { data: unknown; error: null }) {
  fromMock.mockImplementation((table: string) => {
    if (table === 'v2_sessions') return makeChain(table, { data: [{ id: 'session-1' }], error: null })
    if (table === 'v2_set_logs') return makeChain(table, { data: null, error: null, count: 1 })
    if (table === 'v2_week_plans') {
      return makeChain(table, weekPlanResult ?? { data: null, error: null })
    }
    throw new Error(`unexpected table in this test: ${table}`)
  })
}

describe('markSessionDeload — the started guard (break proof target)', () => {
  it('a started session (any set log) stays flag-only: v2_week_plan_sets is NEVER touched, v2_week_plans gets only the plain flag update', async () => {
    wireStarted()
    const outcome = await markSessionDeload('user-1', 'wp-started', { sets: { mode: 'percent', value: 50, rounding: 'down' } })

    expect(outcome).toBe('alreadyStarted')
    expect(calls.some((c) => c.table === 'v2_week_plan_sets')).toBe(false)
    const weekPlanUpdates = calls.filter((c) => c.table === 'v2_week_plans' && c.method === 'update')
    expect(weekPlanUpdates).toHaveLength(1)
    expect(weekPlanUpdates[0].args[0]).toEqual({ is_deload: true }) // flag-only — no deload_restore key at all
  })

  it('checks v2_sessions by week_plan_id, then v2_set_logs by those session ids — "any log at all" counts, not just working ones', async () => {
    wireStarted()
    await markSessionDeload('user-1', 'wp-started', { reps: { delta: -2 } })

    const sessionsCall = calls.find((c) => c.table === 'v2_sessions' && c.method === 'eq')!
    expect(sessionsCall.args).toEqual(['week_plan_id', 'wp-started'])
    const logsCall = calls.find((c) => c.table === 'v2_set_logs' && c.method === 'in')!
    expect(logsCall.args).toEqual(['session_id', ['session-1']])
  })
})

describe('unmarkSessionDeload — the started guard leaves deload_restore untouched', () => {
  it('a started session stays flag-only, never nulling deload_restore or touching v2_week_plan_sets', async () => {
    wireStarted({
      data: { mesocycle_id: 'meso-1', workout_day_id: 'wd-1', week_number: 2, deload_restore: [{ programExerciseId: 'pe-1' }], v2_week_plan_sets: [] },
      error: null,
    })
    const outcome = await unmarkSessionDeload('user-1', 'wp-started')

    expect(outcome).toBe('alreadyStarted')
    expect(calls.some((c) => c.table === 'v2_week_plan_sets')).toBe(false)
    const weekPlanUpdates = calls.filter((c) => c.table === 'v2_week_plans' && c.method === 'update')
    expect(weekPlanUpdates).toHaveLength(1)
    expect(weekPlanUpdates[0].args[0]).toEqual({ is_deload: false }) // flag-only — deload_restore never nulled here
  })
})

describe('markSessionDeload — rules off is flag-only without even checking the guard', () => {
  it('rules === null never queries v2_sessions/v2_set_logs at all', async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_week_plans') return makeChain(table, { data: null, error: null })
      throw new Error(`unexpected table: ${table}`)
    })
    const outcome = await markSessionDeload('user-1', 'wp-1', null)
    expect(outcome).toBe('flagOnly')
    expect(calls.some((c) => c.table === 'v2_sessions')).toBe(false)
    expect(calls.some((c) => c.table === 'v2_set_logs')).toBe(false)
  })
})
