import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chunk 25 (reviewer's note 3 — "Apply-ahead... and deload rules match by
// slot for sequence runs. Say how sequence_position enters their slot
// identity, and test it"; TASKS.md "copying is per slot: a slot's source
// is the same slot's last normal occurrence"). weekPlanService.test.ts's
// own header explicitly leaves the copy actions' Supabase queries
// untested as "thin, unbranched" — this chunk adds a REAL branch (is vs.
// eq on sequence_position), so it gets its own focused test here, same
// mocking convention weekPlanService.deloadDataSource.test.ts already
// uses for the analogous deload branch.
//
// Fixtures are built so fetchPlannedWeekHistory always returns NO usable
// source (resolveManualCopySource — 'none'), so copyOneWorkoutFromHistory
// returns right after that one query — isolating the test to exactly the
// filter choice this chunk changed, never the full copy-forward path
// (already covered elsewhere, unaffected by this chunk).

type Call = { table: string; method: string; args: unknown[] }
const calls: Call[] = []

function makeHistoryChain(table: string) {
  const chain: Record<string, unknown> = {}
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ table, method, args })
    return chain
  }
  chain.select = record('select')
  chain.eq = record('eq')
  chain.lt = record('lt')
  chain.is = record('is')
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
  return chain
}

function makeEmptyIdsChain(table: string, rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {}
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ table, method, args })
    return chain
  }
  chain.select = record('select')
  chain.eq = record('eq')
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
  return chain
}

let emptyIdsRows: Record<string, unknown>[] = []
// copyFromPreviousWeek issues exactly ONE discovery query (fetchEmptyWorkoutPlanIds)
// before its loop's own per-slot history queries — the first v2_week_plans
// call is always the discovery one; every one after it is a per-slot
// fetchPlannedWeekHistory call. copyWorkoutFromPreviousWeek's own tests
// never prime emptyIdsRows, so weekPlansCallCount simply never triggers
// the discovery branch for them (every call there is history).
let weekPlansCallCount = 0
const fromMock = vi.fn((table: string) => {
  if (table === 'v2_week_plans') {
    weekPlansCallCount += 1
    if (emptyIdsRows.length > 0 && weekPlansCallCount === 1) return makeEmptyIdsChain(table, emptyIdsRows)
    return makeHistoryChain(table)
  }
  return makeHistoryChain(table)
})

vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => fromMock(table) },
}))

const { copyWorkoutFromPreviousWeek, copyFromPreviousWeek } = await import('./weekPlanService')

beforeEach(() => {
  calls.length = 0
  emptyIdsRows = []
  weekPlansCallCount = 0
  fromMock.mockClear()
})

describe('copyWorkoutFromPreviousWeek — slot identity (chunk 25, R16)', () => {
  it('sequencePosition omitted (every pre-chunk-25 caller) filters by IS NULL — a weekday run, unaffected', async () => {
    await copyWorkoutFromPreviousWeek('u1', 'm1', 3, 'wd-1')
    const historyCalls = calls.filter((c) => c.method === 'is' || (c.method === 'eq' && c.args[0] === 'sequence_position'))
    expect(historyCalls).toEqual([{ table: 'v2_week_plans', method: 'is', args: ['sequence_position', null] }])
  })

  it('sequencePosition explicitly null (a weekday caller after chunk 25) also filters by IS NULL', async () => {
    await copyWorkoutFromPreviousWeek('u1', 'm1', 3, 'wd-1', undefined, null)
    const historyCalls = calls.filter((c) => c.method === 'is' || (c.method === 'eq' && c.args[0] === 'sequence_position'))
    expect(historyCalls).toEqual([{ table: 'v2_week_plans', method: 'is', args: ['sequence_position', null] }])
  })

  it('sequencePosition = 2 (a sequence slot) filters by EQ 2, never IS NULL', async () => {
    await copyWorkoutFromPreviousWeek('u1', 'm1', 3, 'wd-a', undefined, 2)
    const historyCalls = calls.filter((c) => c.method === 'is' || (c.method === 'eq' && c.args[0] === 'sequence_position'))
    expect(historyCalls).toEqual([{ table: 'v2_week_plans', method: 'eq', args: ['sequence_position', 2] }])
  })

  it('two different slots of the SAME workout (0 and 2) are filtered independently — never conflated', async () => {
    await copyWorkoutFromPreviousWeek('u1', 'm1', 3, 'wd-a', undefined, 0)
    const afterFirst = calls.length
    await copyWorkoutFromPreviousWeek('u1', 'm1', 3, 'wd-a', undefined, 2)
    const secondCallOnward = calls.slice(afterFirst)
    const secondHistoryCalls = secondCallOnward.filter((c) => c.method === 'is' || (c.method === 'eq' && c.args[0] === 'sequence_position'))
    expect(secondHistoryCalls).toEqual([{ table: 'v2_week_plans', method: 'eq', args: ['sequence_position', 2] }])
  })
})

describe('copyFromPreviousWeek — per-slot discovery (chunk 25)', () => {
  it('two empty rows sharing one workoutDayId but different slots each get their OWN per-slot history filter', async () => {
    emptyIdsRows = [
      { id: 'wp-slot0', workout_day_id: 'wd-a', sequence_position: 0, v2_week_plan_exercises: [] },
      { id: 'wp-slot2', workout_day_id: 'wd-a', sequence_position: 2, v2_week_plan_exercises: [] },
    ]
    await copyFromPreviousWeek('u1', 'm1', 3)
    const slotFilters = calls.filter((c) => c.method === 'is' || (c.method === 'eq' && c.args[0] === 'sequence_position'))
    expect(slotFilters).toEqual([
      { table: 'v2_week_plans', method: 'eq', args: ['sequence_position', 0] },
      { table: 'v2_week_plans', method: 'eq', args: ['sequence_position', 2] },
    ])
  })

  it('a weekday cycle (every row sequence_position null) filters every workout by IS NULL', async () => {
    emptyIdsRows = [
      { id: 'wp-1', workout_day_id: 'wd-1', sequence_position: null, v2_week_plan_exercises: [] },
      { id: 'wp-2', workout_day_id: 'wd-2', sequence_position: null, v2_week_plan_exercises: [] },
    ]
    await copyFromPreviousWeek('u1', 'm1', 3)
    const slotFilters = calls.filter((c) => c.method === 'is' || (c.method === 'eq' && c.args[0] === 'sequence_position'))
    expect(slotFilters).toEqual([
      { table: 'v2_week_plans', method: 'is', args: ['sequence_position', null] },
      { table: 'v2_week_plans', method: 'is', args: ['sequence_position', null] },
    ])
  })
})
