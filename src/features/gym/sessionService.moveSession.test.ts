import { describe, it, expect, vi, beforeEach } from 'vitest'

// sessionService.ts imports the real Supabase client at module load time —
// mocked here the same way sessionService.test.ts's own precedent does.
// Kept in its own file (not sessionService.test.ts) because that file holds
// the D30-pinned logSet payload test, which this chunk's brief says must
// pass unchanged — a separate file proves that by construction, not just by
// care.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const { createSession, moveSessionTo, clearMovedSession, startMovedSession } =
  await import('./sessionService')

// A chainable stand-in generic enough for every shape these functions call:
// .select/.insert/.update/.delete/.eq, terminated by .maybeSingle(),
// .single(), or awaited directly (chain itself is thenable) — same
// precedent as historyService.test.ts's own makeChain.
function makeChain(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const chain: Record<string, unknown> = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    single: vi.fn(() => Promise.resolve(result)),
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject),
  }
  return chain
}

const BASE_ROW = {
  id: 'session-1',
  user_id: 'user-1',
  mesocycle_id: 'meso-1',
  week_plan_id: 'wp-1',
  workout_day_id: 'wd-1',
  date: '2026-08-24',
  status: 'planned',
  note: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-08-24T00:00:00Z',
  moved_to_date: '2026-08-28',
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('createSession — movedToDate (chunk 24: "Do it now" becomes a move to today)', () => {
  it('the common case (no movedToDate argument) writes no moved_to_date key at all', async () => {
    const chain = makeChain({ data: { ...BASE_ROW, moved_to_date: null }, error: null })
    fromMock.mockReturnValue(chain)

    await createSession('user-1', 'meso-1', 'wp-1', 'wd-1', '2026-08-24')

    const insertArg = (chain.insert as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(insertArg).not.toHaveProperty('moved_to_date')
  })

  it('"Do it now": date is the missed day, moved_to_date is today — both in the one insert', async () => {
    const chain = makeChain({ data: BASE_ROW, error: null })
    fromMock.mockReturnValue(chain)

    await createSession('user-1', 'meso-1', 'wp-1', 'wd-1', '2026-08-22', '2026-08-24')

    expect(chain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ date: '2026-08-22', moved_to_date: '2026-08-24', status: 'in_progress' }),
    )
  })

  it('maps the returned row\'s moved_to_date onto the Session it resolves to', async () => {
    fromMock.mockReturnValue(makeChain({ data: BASE_ROW, error: null }))

    const session = await createSession('user-1', 'meso-1', 'wp-1', 'wd-1', '2026-08-22', '2026-08-24')

    expect(session.movedToDate).toBe('2026-08-28')
  })
})

describe('moveSessionTo — exactly one row per (user, workout day, date), never a second insert', () => {
  it('no existing planned row: inserts one, status planned, carrying date + moved_to_date', async () => {
    const findChain = makeChain({ data: null, error: null })
    const insertChain = makeChain({ data: BASE_ROW, error: null })
    fromMock.mockReturnValueOnce(findChain).mockReturnValueOnce(insertChain)

    await moveSessionTo({
      userId: 'user-1', mesoId: 'meso-1', weekPlanId: 'wp-1',
      workoutDayId: 'wd-1', date: '2026-08-24', targetDate: '2026-08-28',
    })

    expect(findChain.eq).toHaveBeenCalledWith('user_id', 'user-1')
    expect(findChain.eq).toHaveBeenCalledWith('workout_day_id', 'wd-1')
    expect(findChain.eq).toHaveBeenCalledWith('date', '2026-08-24')
    expect(findChain.eq).toHaveBeenCalledWith('status', 'planned')
    expect(insertChain.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      mesocycle_id: 'meso-1',
      week_plan_id: 'wp-1',
      workout_day_id: 'wd-1',
      date: '2026-08-24',
      status: 'planned',
      moved_to_date: '2026-08-28',
    })
    expect(insertChain.update).not.toHaveBeenCalled()
  })

  it('an existing planned row (a second move of the same session): updates that one row, never inserts a second', async () => {
    const existing = { ...BASE_ROW, moved_to_date: '2026-08-26' }
    const findChain = makeChain({ data: existing, error: null })
    const updateChain = makeChain({ data: { ...existing, moved_to_date: '2026-08-28' }, error: null })
    fromMock.mockReturnValueOnce(findChain).mockReturnValueOnce(updateChain)

    const result = await moveSessionTo({
      userId: 'user-1', mesoId: 'meso-1', weekPlanId: 'wp-1',
      workoutDayId: 'wd-1', date: '2026-08-24', targetDate: '2026-08-28',
    })

    expect(updateChain.update).toHaveBeenCalledWith({ moved_to_date: '2026-08-28' })
    expect(updateChain.eq).toHaveBeenCalledWith('id', existing.id)
    expect(updateChain.insert).not.toHaveBeenCalled()
    expect(result.movedToDate).toBe('2026-08-28')
  })
})

describe('clearMovedSession — "moving back to its own day" deletes the planned row', () => {
  it('deletes the existing planned row by id', async () => {
    const findChain = makeChain({ data: { id: 'session-1' }, error: null })
    const deleteChain = makeChain({ data: null, error: null })
    fromMock.mockReturnValueOnce(findChain).mockReturnValueOnce(deleteChain)

    await clearMovedSession({ userId: 'user-1', workoutDayId: 'wd-1', date: '2026-08-24' })

    expect(deleteChain.delete).toHaveBeenCalled()
    expect(deleteChain.eq).toHaveBeenCalledWith('id', 'session-1')
  })

  it('no existing row: a silent no-op, no delete call at all', async () => {
    const findChain = makeChain({ data: null, error: null })
    fromMock.mockReturnValueOnce(findChain)

    await clearMovedSession({ userId: 'user-1', workoutDayId: 'wd-1', date: '2026-08-24' })

    expect(fromMock).toHaveBeenCalledTimes(1)
  })
})

describe('startMovedSession — a plain status + started_at transition, no reopenSession-style clock-skew handling', () => {
  it('writes status in_progress and a fresh started_at, by id, returning just startedAt (reopenSession\'s own shape)', async () => {
    const chain = makeChain({ data: { started_at: '2026-08-24T12:00:00Z' }, error: null })
    fromMock.mockReturnValue(chain)

    const result = await startMovedSession('session-1')

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress', started_at: expect.any(String) }),
    )
    expect(chain.select).toHaveBeenCalledWith('started_at')
    expect(chain.eq).toHaveBeenCalledWith('id', 'session-1')
    expect(result).toEqual({ startedAt: '2026-08-24T12:00:00Z' })
  })
})
