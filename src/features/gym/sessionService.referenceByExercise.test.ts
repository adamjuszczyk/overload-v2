import { describe, it, expect, vi, beforeEach } from 'vitest'

// Same mocking convention as sessionService.test.ts (that file's own header
// comment explains why: sessionService.ts imports the real Supabase client
// at module load time, which throws without env vars). Kept in a SEPARATE
// file from sessionService.test.ts on purpose — that file is the D30-
// adjacent "logSet payload test" gate (chunk 23's brief: "passes
// unchanged") and this chunk touches none of it; a brand-new file means
// zero risk of perturbing it, even by as little as a shared import line.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { fetchReferenceSessionsByExercise } = await import('./sessionService')

// A chainable stand-in for supabase-js's query builder covering exactly
// the calls fetchAllReferenceSetLogRows makes (via fetchReferenceSessionsByExercise):
// .select(...).eq('user_id', …).in('exercise_id', […]).order(...).order(...).range(from, to),
// awaited directly (thenable chain, same precedent as sessionService.test.ts's
// own makeChain). Review fix (paging, PostgREST's own max_rows=1000 cap) —
// `.order`/`.range` are spies too, not just chain-returning no-ops, so a
// test can assert the exact calls each page makes, same "assert the actual
// .eq/.in/.lt calls" standard this chunk's other service tests already meet.
function makeSelectChain(result: { data?: unknown; error?: unknown } = { data: [], error: null }) {
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

// A fresh row, from `row()` below, differing only by its own (unique)
// `id`/`logged_at` — used to build a full 1000-row first page.
function fillerRow(index: number, sessionId: string, exerciseId: string, sessionDate: string) {
  return row({
    id: `log-filler-${index}`,
    sessionId,
    exerciseId,
    sessionDate,
    sessionStatus: 'completed',
  })
}

// Minimal DbSetLog + embedded v2_sessions/v2_week_plans row — every field
// fetchReferenceSessionsByExercise's own toSetLog call or session-level
// filter actually reads from, nothing else (same "minimal filler" style as
// referenceLogic.test.ts's own makeLog).
function row(params: {
  id: string
  sessionId: string
  exerciseId: string
  weight?: number | null
  reps?: number | null
  isWarmup?: boolean
  sessionDate: string
  sessionStatus: string
  mesocycleId?: string | null
  movedToDate?: string | null
  weekPlan?: { is_deload: boolean } | null
}) {
  return {
    id: params.id,
    user_id: 'user-1',
    session_id: params.sessionId,
    exercise_id: params.exerciseId,
    week_plan_set_id: null,
    set_number: 1,
    weight: params.weight ?? 100,
    reps: params.reps ?? 8,
    rir: 2,
    note: null,
    is_dropset: false,
    parent_set_id: null,
    is_skipped: false,
    logged_at: '2026-08-05T10:00:00Z',
    rest_seconds: null,
    is_warmup: params.isWarmup ?? false,
    v2_sessions: {
      id: params.sessionId,
      date: params.sessionDate,
      completed_at: params.sessionDate + 'T18:00:00Z',
      moved_to_date: params.movedToDate ?? null,
      status: params.sessionStatus,
      mesocycle_id: params.mesocycleId ?? null,
      v2_week_plans: params.weekPlan ?? null,
    },
  }
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('fetchReferenceSessionsByExercise — the candidate query itself (assert the actual .eq/.in calls and the embed)', () => {
  it('queries v2_set_logs, filtered by user_id and exercise_id IN (…), with the deload flag through the v2_sessions -> v2_week_plans embed — and never by workout_day_id', async () => {
    const chain = makeSelectChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await fetchReferenceSessionsByExercise('user-1', ['ex-1', 'ex-2'])

    expect(fromMock).toHaveBeenCalledWith('v2_set_logs')
    const selectArg = (chain.select as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(selectArg).toContain('v2_sessions(')
    expect(selectArg).toContain('v2_week_plans(is_deload)')
    expect(selectArg).toContain('moved_to_date')
    expect(chain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(chain.in).toHaveBeenCalledWith('exercise_id', ['ex-1', 'ex-2'])
    // Cross-run/cross-workout by construction — no workout_day_id filter at
    // all, unlike fetchReferenceSessions' own fetchReferenceCandidateSessions.
    const eqCalls = (chain.eq as ReturnType<typeof vi.fn>).mock.calls
    expect(eqCalls.some((c) => c[0] === 'workout_day_id')).toBe(false)
    expect(eqCalls.some((c) => c[0] === 'mesocycle_id')).toBe(false)
  })

  it('returns an empty Map without querying at all when exerciseIds is empty', async () => {
    const result = await fetchReferenceSessionsByExercise('user-1', [])
    expect(result).toEqual(new Map())
    expect(fromMock).not.toHaveBeenCalled()
  })
})

// Review fix (PostgREST's own max_rows cap, default 1000 — supabase/config.toml):
// an unbounded `.select()` on v2_set_logs can silently return an ARBITRARY
// 1000-row slice once a screen's exercises have logged more than that many
// rows in total (reachable within months across 6-8+ exercises) — with no
// error, nothing to catch downstream. If last week's rows are among the
// ones dropped, the panel would show LAST TIME from an older session, or
// even FIRST TIME, for no visible reason. Fixed by paging with `.range()`
// in REFERENCE_SESSIONS_PAGE_SIZE (1000) chunks, ordered by a stable key,
// until a short page proves nothing is left — same shape as
// progressService.ts's own fetchAllExerciseSetLogRows (AUDIT H4).
describe('fetchReferenceSessionsByExercise — paging past PostgREST\'s max_rows cap (review fix)', () => {
  it('orders by a stable key (logged_at, then id) on every page — so paging itself cannot duplicate or drop a row at a tie', async () => {
    const chain = makeSelectChain({ data: [], error: null })
    fromMock.mockReturnValue(chain)

    await fetchReferenceSessionsByExercise('user-1', ['ex-1'])

    expect(chain.order).toHaveBeenCalledWith('logged_at', { ascending: true })
    expect(chain.order).toHaveBeenCalledWith('id', { ascending: true })
  })

  it('a single short page (under 1000 rows) is read with exactly one call, ranged [0, 999]', async () => {
    const chain = makeSelectChain({ data: [row({ id: 'log-1', sessionId: 'sess-1', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed' })], error: null })
    fromMock.mockReturnValue(chain)

    await fetchReferenceSessionsByExercise('user-1', ['ex-1'])

    expect(fromMock).toHaveBeenCalledTimes(1)
    expect(chain.range).toHaveBeenCalledWith(0, 999)
  })

  it('a full first page (1000 rows) is followed by a second page, ranged [1000, 1999] — and the most recent session (only on page 2) is not lost', async () => {
    // Page 1: exactly 1000 rows, all for a single OLDER session (same
    // exercise) — a full page, by itself indistinguishable from "there
    // might be more". Page 2: one more row, for a DIFFERENT, MORE RECENT
    // session. Ascending logged_at/id means the newest rows sort LAST, so
    // this models exactly the failure the review found: without a second
    // page, the most recent session's own row is the one that goes
    // missing, not an arbitrary unrelated one.
    const page1Rows = Array.from({ length: 1000 }, (_, i) => fillerRow(i, 'sess-old', 'ex-1', '2026-01-01'))
    const page2Rows = [row({ id: 'log-recent', sessionId: 'sess-recent', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed' })]

    const page1Chain = makeSelectChain({ data: page1Rows, error: null })
    const page2Chain = makeSelectChain({ data: page2Rows, error: null })
    fromMock.mockReturnValueOnce(page1Chain).mockReturnValueOnce(page2Chain)

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])

    expect(fromMock).toHaveBeenCalledTimes(2)
    expect(page1Chain.range).toHaveBeenCalledWith(0, 999)
    expect(page2Chain.range).toHaveBeenCalledWith(1000, 1999)

    const sessionIds = (result.get('ex-1') ?? []).map((s) => s.sessionId)
    expect(new Set(sessionIds)).toEqual(new Set(['sess-old', 'sess-recent']))
  })

  it('three full pages (3000 rows total) followed by a short fourth page are all read — paging does not stop early', async () => {
    const chains = [0, 1, 2].map((p) =>
      makeSelectChain({
        data: Array.from({ length: 1000 }, (_, i) => fillerRow(p * 1000 + i, `sess-page-${p}`, 'ex-1', '2026-01-01')),
        error: null,
      }),
    )
    const lastChain = makeSelectChain({ data: [row({ id: 'log-last', sessionId: 'sess-last', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed' })], error: null })
    fromMock.mockReturnValueOnce(chains[0]).mockReturnValueOnce(chains[1]).mockReturnValueOnce(chains[2]).mockReturnValueOnce(lastChain)

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])

    expect(fromMock).toHaveBeenCalledTimes(4)
    expect(chains[0].range).toHaveBeenCalledWith(0, 999)
    expect(chains[1].range).toHaveBeenCalledWith(1000, 1999)
    expect(chains[2].range).toHaveBeenCalledWith(2000, 2999)
    expect(lastChain.range).toHaveBeenCalledWith(3000, 3999)
    expect((result.get('ex-1') ?? []).some((s) => s.sessionId === 'sess-last')).toBe(true)
  })
})

describe('fetchReferenceSessionsByExercise — deload exclusion via the embed', () => {
  it('a session whose week plan is_deload:true never appears in the Map, even though its row would otherwise match', async () => {
    const rows = [
      row({ id: 'log-1', sessionId: 'sess-normal', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed', weekPlan: { is_deload: false } }),
      row({ id: 'log-2', sessionId: 'sess-deload', exerciseId: 'ex-1', sessionDate: '2026-08-06', sessionStatus: 'completed', weekPlan: { is_deload: true } }),
    ]
    fromMock.mockReturnValue(makeSelectChain({ data: rows, error: null }))

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])
    const sessions = result.get('ex-1') ?? []
    expect(sessions.map((s) => s.sessionId)).toEqual(['sess-normal'])
  })

  it('a session with no week plan attached (v2_week_plans: null) is treated as non-deload, not excluded', async () => {
    const rows = [
      row({ id: 'log-1', sessionId: 'sess-no-plan', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed', weekPlan: null }),
    ]
    fromMock.mockReturnValue(makeSelectChain({ data: rows, error: null }))

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])
    expect((result.get('ex-1') ?? []).map((s) => s.sessionId)).toEqual(['sess-no-plan'])
  })
})

describe('fetchReferenceSessionsByExercise — completed sessions only', () => {
  it('excludes an in_progress session (e.g. the one currently being logged) and a skipped one', async () => {
    const rows = [
      row({ id: 'log-1', sessionId: 'sess-completed', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed' }),
      row({ id: 'log-2', sessionId: 'sess-in-progress', exerciseId: 'ex-1', sessionDate: '2026-08-07', sessionStatus: 'in_progress' }),
      row({ id: 'log-3', sessionId: 'sess-skipped', exerciseId: 'ex-1', sessionDate: '2026-08-06', sessionStatus: 'skipped' }),
    ]
    fromMock.mockReturnValue(makeSelectChain({ data: rows, error: null }))

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])
    expect((result.get('ex-1') ?? []).map((s) => s.sessionId)).toEqual(['sess-completed'])
  })
})

describe('fetchReferenceSessionsByExercise — warmups never reach a ReferenceSession\'s logs', () => {
  it('a warmup-flagged row is dropped; the real row for the same session/exercise still produces a ReferenceSession', async () => {
    const rows = [
      row({ id: 'log-real', sessionId: 'sess-1', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed', isWarmup: false }),
      row({ id: 'log-warmup', sessionId: 'sess-1', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed', isWarmup: true, weight: 20, reps: 15 }),
    ]
    fromMock.mockReturnValue(makeSelectChain({ data: rows, error: null }))

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])
    const sessions = result.get('ex-1') ?? []
    expect(sessions).toHaveLength(1)
    expect(sessions[0].logs).toHaveLength(1)
    expect(sessions[0].logs[0].head.id).toBe('log-real')
  })

  it('a session with ONLY a warmup row for this exercise produces no ReferenceSession at all (no real log to group)', async () => {
    const rows = [
      row({ id: 'log-warmup-only', sessionId: 'sess-warmup-only', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed', isWarmup: true }),
    ]
    fromMock.mockReturnValue(makeSelectChain({ data: rows, error: null }))

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])
    expect(result.get('ex-1') ?? []).toEqual([])
  })
})

describe('fetchReferenceSessionsByExercise — crosses run and workout boundaries (no scoping by either, at this layer)', () => {
  it('two sessions for the same exercise, from two different mesocycles (runs), both come back in one call — no mesocycle_id restriction anywhere', async () => {
    const rows = [
      row({ id: 'log-run1', sessionId: 'sess-run1', exerciseId: 'ex-1', sessionDate: '2026-08-05', sessionStatus: 'completed', mesocycleId: 'meso-1' }),
      row({ id: 'log-run2', sessionId: 'sess-run2', exerciseId: 'ex-1', sessionDate: '2026-02-01', sessionStatus: 'completed', mesocycleId: 'meso-2' }),
    ]
    fromMock.mockReturnValue(makeSelectChain({ data: rows, error: null }))

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])
    const sessionIds = (result.get('ex-1') ?? []).map((s) => s.sessionId)
    expect(new Set(sessionIds)).toEqual(new Set(['sess-run1', 'sess-run2']))
    const mesoIds = (result.get('ex-1') ?? []).map((s) => s.mesocycleId)
    expect(new Set(mesoIds)).toEqual(new Set(['meso-1', 'meso-2']))
  })
})

describe('fetchReferenceSessionsByExercise — batched across several exercise ids in one query, each keyed by its own id', () => {
  it('a Map entry for exercise A never contains exercise B\'s session, and vice versa', async () => {
    const rows = [
      row({ id: 'log-a', sessionId: 'sess-a', exerciseId: 'ex-a', sessionDate: '2026-08-05', sessionStatus: 'completed' }),
      row({ id: 'log-b', sessionId: 'sess-b', exerciseId: 'ex-b', sessionDate: '2026-08-06', sessionStatus: 'completed' }),
    ]
    fromMock.mockReturnValue(makeSelectChain({ data: rows, error: null }))

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-a', 'ex-b'])
    expect((result.get('ex-a') ?? []).map((s) => s.sessionId)).toEqual(['sess-a'])
    expect((result.get('ex-b') ?? []).map((s) => s.sessionId)).toEqual(['sess-b'])
  })
})

describe('fetchReferenceSessionsByExercise — carries mesocycleId/completedAt/movedToDate through onto each ReferenceSession', () => {
  it('propagates every per-session field the resolver needs', async () => {
    const rows = [
      row({
        id: 'log-1',
        sessionId: 'sess-1',
        exerciseId: 'ex-1',
        sessionDate: '2026-08-05',
        sessionStatus: 'completed',
        mesocycleId: 'meso-7',
        movedToDate: '2026-08-06',
        weekPlan: { is_deload: false },
      }),
    ]
    fromMock.mockReturnValue(makeSelectChain({ data: rows, error: null }))

    const result = await fetchReferenceSessionsByExercise('user-1', ['ex-1'])
    const [session] = result.get('ex-1') ?? []
    expect(session).toBeDefined()
    expect(session.date).toBe('2026-08-05')
    expect(session.movedToDate).toBe('2026-08-06')
    expect(session.mesocycleId).toBe('meso-7')
    expect(session.completedAt).toBe('2026-08-05T18:00:00Z')
  })

  it('throws when the query itself errors, rather than silently returning an empty Map', async () => {
    fromMock.mockReturnValue(makeSelectChain({ data: null, error: { message: 'boom' } }))
    await expect(fetchReferenceSessionsByExercise('user-1', ['ex-1'])).rejects.toBeTruthy()
  })
})
