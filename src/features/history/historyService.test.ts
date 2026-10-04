import { describe, it, expect, vi, beforeEach } from 'vitest'

// historyService.ts imports the real Supabase client at module load time
// (supabase.ts throws if env vars are missing, and would otherwise hit the
// network) — mocked here the same way exerciseService.test.ts /
// sessionService.test.ts's own precedent does.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { fetchSessionTypeHistory } = await import('./historyService')

// A chainable stand-in for supabase-js's query builder, generic enough for
// both tables fetchSessionTypeHistory touches: v2_workout_days (select + eq,
// no further chain) and v2_session_type_history (select + eq + in + order +
// order + range). Every chain method returns the same object, and the
// object itself is thenable (same precedent as exerciseService.test.ts's /
// sessionService.test.ts's own makeChain), so `await supabase.from(...)...`
// resolves with no further method needed, regardless of which of these a
// given table's query actually calls.
function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const SESSION_ROW = {
  session_id: 's1',
  date: '2026-01-01',
  mesocycle_id: null,
  week_number: null,
  is_deload: false,
  duration_seconds: 2700,
  total_volume: 500,
  avg_rir: 2,
  set_count: 5,
}

function mockTables(lineageRows: { id: string; source_workout_day_id: string | null }[], sessionRows: unknown[]) {
  const lineageChain = makeChain({ data: lineageRows, error: null })
  const historyChain = makeChain({ data: sessionRows, error: null })
  fromMock.mockImplementation((table: string) => {
    if (table === 'v2_workout_days') return lineageChain
    if (table === 'v2_session_type_history') return historyChain
    throw new Error(`unexpected table ${table}`)
  })
  return { lineageChain, historyChain }
}

beforeEach(() => {
  fromMock.mockReset()
})

// Chunk 5 (TASKS.md): fetchSessionTypeHistory now queries the workout's
// lineage group (workoutLineage.ts's resolveLineageGroup), not just the one
// id handed in, so a run's copy of a workout shares "all time" history with
// the saved program's workout it was copied from. The group is resolved
// from a fresh read of the user's own v2_workout_days rows on every call.
describe('fetchSessionTypeHistory — queries the lineage group, not one id (chunk 5)', () => {
  it('no lineage (today\'s production shape — 027 live, source_workout_day_id NULL on every row): queries .in(\'workout_day_id\', [workoutDayId]) exactly, a single-element array', async () => {
    const { historyChain } = mockTables([{ id: 'w1', source_workout_day_id: null }], [SESSION_ROW])

    await fetchSessionTypeHistory('user-1', 'w1')

    expect(historyChain.in).toHaveBeenCalledWith('workout_day_id', ['w1'])
  })

  it('a resolved lineage group (root + two run copies): queries .in(\'workout_day_id\', …) with all 3 ids, starting from a copy\'s own id', async () => {
    const { historyChain } = mockTables(
      [
        { id: 'root', source_workout_day_id: null },
        { id: 'copy1', source_workout_day_id: 'root' },
        { id: 'copy2', source_workout_day_id: 'root' },
      ],
      [SESSION_ROW],
    )

    await fetchSessionTypeHistory('user-1', 'copy1')

    const inCall = (historyChain.in as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(inCall[0]).toBe('workout_day_id')
    expect(new Set(inCall[1] as string[])).toEqual(new Set(['root', 'copy1', 'copy2']))
  })

  it('the lineage lookup reads v2_workout_days scoped to the same user (id, source_workout_day_id only)', async () => {
    const { lineageChain } = mockTables([{ id: 'w1', source_workout_day_id: null }], [])

    await fetchSessionTypeHistory('user-1', 'w1')

    expect(fromMock).toHaveBeenCalledWith('v2_workout_days')
    expect(lineageChain.select).toHaveBeenCalledWith('id, source_workout_day_id')
    expect(lineageChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
  })

  it('everything else about the v2_session_type_history query is unchanged: same select, same user scoping, same ordering, same .range() paging', async () => {
    const { historyChain } = mockTables([{ id: 'w1', source_workout_day_id: null }], [SESSION_ROW])

    await fetchSessionTypeHistory('user-1', 'w1', 25, 25)

    expect(fromMock).toHaveBeenCalledWith('v2_session_type_history')
    expect(historyChain.select).toHaveBeenCalledTimes(1)
    expect((historyChain.select as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(
      expect.stringContaining('total_volume, avg_rir, set_count'),
    )
    expect(historyChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(historyChain.order).toHaveBeenNthCalledWith(1, 'date', { ascending: false })
    expect(historyChain.order).toHaveBeenNthCalledWith(2, 'session_id', { ascending: true })
    expect(historyChain.range).toHaveBeenCalledWith(25, 49)
  })

  it('maps the resolved rows the same way as before (camelCase SessionTypeHistoryRow) and computes nextOffset the same way', async () => {
    mockTables([{ id: 'w1', source_workout_day_id: null }], [SESSION_ROW])

    const page = await fetchSessionTypeHistory('user-1', 'w1')

    expect(page.rows).toEqual([
      {
        sessionId: 's1',
        date: '2026-01-01',
        mesocycleId: null,
        weekNumber: null,
        isDeload: false,
        durationSeconds: 2700,
        totalVolume: 500,
        avgRir: 2,
        setCount: 5,
      },
    ])
    expect(page.nextOffset).toBeNull()
  })
})
