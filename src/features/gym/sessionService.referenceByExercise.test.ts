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
// the calls fetchReferenceSessionsByExercise makes:
// .select(...).eq('user_id', …).in('exercise_id', […]), awaited directly
// (thenable chain, same precedent as sessionService.test.ts's own
// makeChain).
function makeSelectChain(result: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    in: vi.fn(() => chain),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
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
