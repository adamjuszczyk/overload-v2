// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]: the extra line "when the phone has unsent offline changes"). The count is the length of the
// sync queue, read through Dexie's `liveQuery` so it follows the queue as writes are queued and sent. What is proven here is the wiring: the querier
// is `db.sync_queue.count()` and nothing else, the hook subscribes once, follows what the observable delivers, and lets go when it unmounts. That
// Dexie delivers a new count when the queue changes is Dexie's own contract: read once in real Chromium, on the built app, against the real
// IndexedDB (chunk 72's report), because jsdom has no IndexedDB to change.
const live = vi.hoisted(() => ({
  queriers: [] as Array<() => unknown>,
  observers: [] as Array<{ next: (value: number) => void; error: (error: unknown) => void }>,
  unsubscribed: 0,
  count: vi.fn(async () => 0),
}))
vi.mock('dexie', () => ({
  liveQuery: (querier: () => unknown) => {
    live.queriers.push(querier)
    return {
      subscribe: (observer: { next: (value: number) => void; error: (error: unknown) => void }) => {
        live.observers.push(observer)
        return { unsubscribe: () => void (live.unsubscribed += 1) }
      },
    }
  },
}))
vi.mock('../../lib/db', () => ({ db: { sync_queue: { count: live.count }, tables: [] } }))

const { useQueuedWriteCount } = await import('./useQueuedWriteCount')

afterEach(() => {
  cleanup()
  live.queriers.length = 0
  live.observers.length = 0
  live.unsubscribed = 0
  live.count.mockClear()
  vi.restoreAllMocks()
})

describe('useQueuedWriteCount', () => {
  it('is 0 until the queue has been counted, then the count Dexie delivers, each time it delivers one', () => {
    const { result } = renderHook(() => useQueuedWriteCount())
    expect(result.current).toBe(0)
    act(() => live.observers[0].next(3))
    expect(result.current).toBe(3)
    act(() => live.observers[0].next(2))
    expect(result.current).toBe(2)
    act(() => live.observers[0].next(0))
    expect(result.current).toBe(0)
  })

  it('counts the sync queue (db.sync_queue.count()) and reads nothing else of it', async () => {
    renderHook(() => useQueuedWriteCount())
    expect(live.queriers.length).toBe(1)
    live.count.mockResolvedValueOnce(7)
    await expect(live.queriers[0]()).resolves.toBe(7)
    expect(live.count).toHaveBeenCalledTimes(1)
  })

  it('subscribes once however often it draws, and lets go of the subscription when it unmounts', () => {
    const { rerender, unmount } = renderHook(() => useQueuedWriteCount())
    rerender()
    rerender()
    expect(live.observers.length).toBe(1)
    expect(live.unsubscribed).toBe(0)
    unmount()
    expect(live.unsubscribed).toBe(1)
  })

  it('a count that cannot be read draws no line and never throws: it keeps the last count', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useQueuedWriteCount())
    act(() => live.observers[0].next(3))
    act(() => live.observers[0].error(new Error('UnknownError')))
    expect(result.current).toBe(3)
    expect(logged).toHaveBeenCalledTimes(1)
  })
})
