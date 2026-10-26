// Chunk 61's review 1, F1 — `clearStageKind`, the head's stage kind when its last drop is deleted (DECISIONS 147 (a); SPEC G47: delete set works offline).
// Online it is the request `useUpdateSetLog` sends, awaited, a refusal thrown (W9 says why). Offline it is one queued patch item and a change of the screen's
// copy of the session, the queue first. The queue's own rules (shape, order, the replay) are `useSyncQueue.patch.test.ts`, `useSyncQueue.order.test.ts` and
// `useSyncQueue.setDelete.test.tsx`; this file holds what only the writer decides.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Session, SetLog } from '../../types'

const queue = vi.hoisted(() => ({ clear: vi.fn() }))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogStageKindClear: queue.clear }))

const { queryClient } = await import('../../lib/queryClient')
const { clearStageKind } = await import('./clearStageKind')

const KEY = ['v2_session', 's1']
const log = (id: string, stageKind: SetLog['stageKind']): Partial<SetLog> => ({ id, stageKind })
const seed = () => queryClient.setQueryData(KEY, { id: 's1', setLogs: [log('h1', 'dropset'), log('h2', 'dropset'), log('d1', null)] } as unknown as Session)
const kinds = () => ((queryClient.getQueryData(KEY) as Session).setLogs ?? []).map((l) => [l.id, l.stageKind])

beforeEach(() => {
  queue.clear.mockReset()
  queue.clear.mockResolvedValue(undefined)
  queryClient.clear()
})

describe('online', () => {
  it('is the request itself: `update` is called once with the log, nothing is queued, and the screen\'s copy is left to `update` (it changes it and reads the session again)', async () => {
    seed()
    const update = vi.fn(async () => undefined)
    await clearStageKind({ sessionId: 's1', logId: 'h1', online: true, update })
    expect(update.mock.calls).toEqual([['h1']])
    expect(queue.clear).not.toHaveBeenCalled()
    expect(kinds()).toEqual([['h1', 'dropset'], ['h2', 'dropset'], ['d1', null]])
  })

  it('is awaited: the delete goes on only when the request has answered, and a refusal is thrown with its reason', async () => {
    let answer!: () => void
    const update = vi.fn(() => new Promise<void>((resolve) => (answer = resolve)))
    let done = false
    const run = clearStageKind({ sessionId: 's1', logId: 'h1', online: true, update }).then(() => void (done = true))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(done).toBe(false)
    answer()
    await run
    expect(done).toBe(true)
    await expect(clearStageKind({ sessionId: 's1', logId: 'h1', online: true, update: async () => Promise.reject(new Error('permission denied')) })).rejects.toThrow('permission denied')
  })
})

describe('offline', () => {
  it('queues one patch for the log with its session, never calls the request, and the screen\'s copy shows that log with no kind and every other log as it was', async () => {
    seed()
    const update = vi.fn(async () => undefined)
    await clearStageKind({ sessionId: 's1', logId: 'h1', online: false, update })
    expect(queue.clear.mock.calls).toEqual([[{ id: 'h1', sessionId: 's1' }]])
    expect(update).not.toHaveBeenCalled()
    expect(kinds()).toEqual([['h1', null], ['h2', 'dropset'], ['d1', null]])
  })

  it('queues first: a queue that can\'t take the item throws its reason and leaves the screen\'s copy alone (never a head drawn normal with its patch lost)', async () => {
    seed()
    queue.clear.mockRejectedValue(new Error('QuotaExceededError'))
    await expect(clearStageKind({ sessionId: 's1', logId: 'h1', online: false, update: async () => undefined })).rejects.toThrow('QuotaExceededError')
    expect(kinds()).toEqual([['h1', 'dropset'], ['h2', 'dropset'], ['d1', null]])
  })

  it('a session the screen does not hold yet is left alone (nothing is invented)', async () => {
    await clearStageKind({ sessionId: 's1', logId: 'h1', online: false, update: async () => undefined })
    expect(queue.clear).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(KEY)).toBeUndefined()
  })

  it('changes the screen\'s copy only after the reads in flight have been stopped (a cancelled read reverts the query once it settles, which would take a write made before it away)', async () => {
    seed()
    let stopped!: () => void
    const cancel = vi.spyOn(queryClient, 'cancelQueries').mockReturnValue(new Promise<void>((resolve) => (stopped = resolve)))
    const pending = clearStageKind({ sessionId: 's1', logId: 'h1', online: false, update: async () => undefined })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(kinds()).toEqual([['h1', 'dropset'], ['h2', 'dropset'], ['d1', null]])
    stopped()
    await pending
    expect(kinds()).toEqual([['h1', null], ['h2', 'dropset'], ['d1', null]])
    cancel.mockRestore()
  })

  it('stops a read of the session that left before the item was queued, as `useUpdateSetLog` does before its own write', async () => {
    seed()
    const cancel = vi.spyOn(queryClient, 'cancelQueries')
    await clearStageKind({ sessionId: 's1', logId: 'h1', online: false, update: async () => undefined })
    expect(cancel).toHaveBeenCalledWith({ queryKey: KEY })
    cancel.mockRestore()
  })
})
