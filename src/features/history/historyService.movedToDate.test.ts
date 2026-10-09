import { describe, it, expect, vi, beforeEach } from 'vitest'

// Chunk 24 (SPEC "Weekday" — History shows "the day a session was actually
// done": moved_to_date when set, else date) — in its own file, not
// historyService.test.ts/historyService.warmup.test.ts, so neither existing
// file needs touching beyond the one mock-shape addition historyService.
// test.ts's own mockTables now takes (this chunk's report explains why).
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { fetchHistorySessions, fetchHistoryDetail, fetchSessionTypeHistory } =
  await import('./historyService')

function makeChain(result: { data?: unknown; error?: unknown }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    order: vi.fn(() => chain),
    range: vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  fromMock.mockReset()
})

const SUMMARY_ROW = {
  id: 'session-1', date: '2026-08-24', status: 'completed', note: null,
  started_at: '2026-08-24T10:00:00Z', completed_at: '2026-08-24T11:00:00Z',
  workout_day_id: 'wd-1', workout_day_name: 'Push Day',
  mesocycle_id: 'meso-1', mesocycle_name: 'Test Meso',
  set_count: 5, muscle_groups: ['chest'],
}

describe('fetchHistorySessions — the list shows moved_to_date when set, else date', () => {
  it('an unmoved session (moved_to_date null) shows its own date, unchanged', async () => {
    const summaryChain = makeChain({ data: [SUMMARY_ROW], error: null })
    const movedChain = makeChain({ data: [], error: null })
    fromMock.mockImplementation((table: string) =>
      table === 'v2_history_session_summary' ? summaryChain : movedChain,
    )

    const page = await fetchHistorySessions('user-1')

    expect(page.rows[0].date).toBe('2026-08-24')
  })

  it('a moved session shows moved_to_date instead of its own date', async () => {
    const summaryChain = makeChain({ data: [SUMMARY_ROW], error: null })
    const movedChain = makeChain({ data: [{ id: 'session-1', moved_to_date: '2026-08-28' }], error: null })
    fromMock.mockImplementation((table: string) =>
      table === 'v2_history_session_summary' ? summaryChain : movedChain,
    )

    const page = await fetchHistorySessions('user-1')

    expect(page.rows[0].date).toBe('2026-08-28')
  })

  it('the moved_to_date lookup is bounded to this page\'s own ids — a .in() on v2_sessions, not unbounded', async () => {
    const summaryChain = makeChain({ data: [SUMMARY_ROW], error: null })
    const movedChain = makeChain({ data: [], error: null })
    fromMock.mockImplementation((table: string) =>
      table === 'v2_history_session_summary' ? summaryChain : movedChain,
    )

    await fetchHistorySessions('user-1')

    expect(fromMock).toHaveBeenCalledWith('v2_sessions')
    expect(movedChain.select).toHaveBeenCalledWith('id, moved_to_date')
    expect(movedChain.in).toHaveBeenCalledWith('id', ['session-1'])
  })

  it('an empty page never queries v2_sessions at all', async () => {
    const summaryChain = makeChain({ data: [], error: null })
    fromMock.mockImplementation((table: string) =>
      table === 'v2_history_session_summary' ? summaryChain : makeChain({ data: [], error: null }),
    )

    await fetchHistorySessions('user-1')

    expect(fromMock).not.toHaveBeenCalledWith('v2_sessions')
  })
})

const DETAIL_ROW = {
  id: 'session-1', date: '2026-08-24', status: 'completed', note: null,
  started_at: '2026-08-24T10:00:00Z', completed_at: '2026-08-24T11:00:00Z',
  workout_day_id: null, mesocycle_id: null, energy_rating: null, pump_rating: null,
  v2_mesocycles: null, v2_set_logs: [],
}

describe('fetchHistoryDetail — the same substitution, read directly off v2_sessions (no second query)', () => {
  it('selects moved_to_date alongside the rest of the row', async () => {
    const chain = makeChain({ data: DETAIL_ROW, error: null })
    fromMock.mockReturnValue(chain)

    await fetchHistoryDetail('session-1')

    expect((chain.select as ReturnType<typeof vi.fn>).mock.calls[0][0]).toEqual(
      expect.stringContaining('moved_to_date'),
    )
  })

  it('an unmoved session (moved_to_date null) shows its own date', async () => {
    fromMock.mockReturnValue(makeChain({ data: { ...DETAIL_ROW, moved_to_date: null }, error: null }))

    const detail = await fetchHistoryDetail('session-1')

    expect(detail.date).toBe('2026-08-24')
  })

  it('a moved session shows moved_to_date instead of its own date', async () => {
    fromMock.mockReturnValue(makeChain({ data: { ...DETAIL_ROW, moved_to_date: '2026-08-28' }, error: null }))

    const detail = await fetchHistoryDetail('session-1')

    expect(detail.date).toBe('2026-08-28')
  })
})

const TYPE_ROW = {
  session_id: 's1', date: '2026-08-24', mesocycle_id: null, week_number: null,
  is_deload: false, duration_seconds: 2700, total_volume: 500, avg_rir: 2, set_count: 5,
}

describe('fetchSessionTypeHistory — the same substitution, same bounded-lookup shape as the session list', () => {
  function mockTables(typeRows: unknown[], movedRows: { id: string; moved_to_date: string | null }[]) {
    const lineageChain = makeChain({ data: [{ id: 'wd-1', source_workout_day_id: null }], error: null })
    const typeChain = makeChain({ data: typeRows, error: null })
    const movedChain = makeChain({ data: movedRows, error: null })
    fromMock.mockImplementation((table: string) => {
      if (table === 'v2_workout_days') return lineageChain
      if (table === 'v2_session_type_history') return typeChain
      if (table === 'v2_sessions') return movedChain
      throw new Error(`unexpected table ${table}`)
    })
    return { movedChain }
  }

  it('an unmoved occurrence shows its own date', async () => {
    mockTables([TYPE_ROW], [])
    const page = await fetchSessionTypeHistory('user-1', 'wd-1')
    expect(page.rows[0].date).toBe('2026-08-24')
  })

  it('a moved occurrence shows moved_to_date instead', async () => {
    mockTables([TYPE_ROW], [{ id: 's1', moved_to_date: '2026-08-28' }])
    const page = await fetchSessionTypeHistory('user-1', 'wd-1')
    expect(page.rows[0].date).toBe('2026-08-28')
  })

  it('the lookup is keyed by session_id (this view\'s own id column), bounded to this page', async () => {
    const { movedChain } = mockTables([TYPE_ROW], [])
    await fetchSessionTypeHistory('user-1', 'wd-1')
    expect(movedChain.in).toHaveBeenCalledWith('id', ['s1'])
  })
})
