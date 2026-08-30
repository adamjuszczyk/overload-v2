import { describe, it, expect, vi, beforeEach } from 'vitest'

// checkReassignBlockers (P3/P4, §5.2) touches two independent stores — the
// local Dexie sync queue and a live Supabase query — so each is mocked on
// its own module, same reasoning as exerciseService.test.ts's fromMock:
// this is the first test in the suite to also touch ../../lib/db.
const fromMock = vi.fn()
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

const syncQueueCountMock = vi.fn()
vi.mock('../../lib/db', () => ({
  db: { sync_queue: { count: (...args: unknown[]) => syncQueueCountMock(...args) } },
}))

const { checkReassignBlockers } = await import('./reassignService')

// A thenable stand-in for supabase-js's query builder, matching
// exerciseService.test.ts's makeChain — `.select(..., {count, head:true})`
// resolves without a trailing `.single()`.
function makeChain(result: { count?: number | null; error?: unknown }) {
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
  syncQueueCountMock.mockReset()
})

describe('checkReassignBlockers — P3/P4 (§5.2)', () => {
  it('both clear: empty sync queue, no session in progress', async () => {
    syncQueueCountMock.mockResolvedValue(0)
    const sessionsChain = makeChain({ count: 0, error: null })
    fromMock.mockReturnValue(sessionsChain)

    const result = await checkReassignBlockers()

    expect(result).toEqual({ hasUnsyncedSets: false, hasSessionInProgress: false })
    expect(fromMock).toHaveBeenCalledWith('v2_sessions')
    expect(sessionsChain.eq).toHaveBeenCalledWith('status', 'in_progress')
  })

  it('P3 — a non-empty sync queue blocks independently of session state', async () => {
    syncQueueCountMock.mockResolvedValue(2)
    fromMock.mockReturnValue(makeChain({ count: 0, error: null }))

    const result = await checkReassignBlockers()

    expect(result.hasUnsyncedSets).toBe(true)
    expect(result.hasSessionInProgress).toBe(false)
  })

  it('P4 — a session in progress blocks independently of sync queue state', async () => {
    syncQueueCountMock.mockResolvedValue(0)
    fromMock.mockReturnValue(makeChain({ count: 1, error: null }))

    const result = await checkReassignBlockers()

    expect(result.hasUnsyncedSets).toBe(false)
    expect(result.hasSessionInProgress).toBe(true)
  })

  it('both block at once', async () => {
    syncQueueCountMock.mockResolvedValue(5)
    fromMock.mockReturnValue(makeChain({ count: 3, error: null }))

    const result = await checkReassignBlockers()

    expect(result).toEqual({ hasUnsyncedSets: true, hasSessionInProgress: true })
  })

  it('propagates a query error rather than silently reading as clear', async () => {
    syncQueueCountMock.mockResolvedValue(0)
    fromMock.mockReturnValue(makeChain({ count: null, error: new Error('boom') }))

    await expect(checkReassignBlockers()).rejects.toThrow('boom')
  })
})
