// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

// Chunk 63 (G46 (a): "until the set is logged again ... or the session ends"; TASKS 63: "the session's end clears the session's drafts"): the one way a session ends, FINISH SESSION and
// auto-finish alike (`useCompleteSession`), clears what the phone kept for its unlogged sets and its added sets once the finish has gone through, online or queued
// behind a flaky connection or none; a finish that fails clears nothing (the session is still in progress).
const world = vi.hoisted(() => ({ online: true, completeFails: false, cleared: [] as string[], queued: [] as unknown[] }))

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => world.online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('./sessionDrafts', () => ({
  clearSessionDrafts: async (id: string) => void world.cleared.push(id),
}))
vi.mock('../offline/useSyncQueue', () => ({
  flushSyncQueue: async () => {},
  hasQueuedWritesFor: async () => false,
  queueSetLogDelete: async () => {},
  dropQueuedWritesNamingLog: async () => 0,
}))
vi.mock('../../lib/db', () => ({
  db: {
    set_logs: { where: () => ({ equals: () => ({ toArray: async () => [] }) }) },
    sync_queue: { add: async (item: unknown) => void world.queued.push(item) },
  },
}))
vi.mock('./sessionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sessionService')>()),
  completeSession: async () => {
    if (world.completeFails) throw new Error('refused')
    return { status: 'completed' as const }
  },
}))

const { useCompleteSession } = await import('./useSession')
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

beforeEach(() => {
  world.online = true
  world.completeFails = false
  world.cleared = []
  world.queued = []
  queryClient.clear()
})
afterEach(cleanup)

describe('the session\'s end clears the drafts the phone kept for it (G46 (a))', () => {
  it('a finish that goes through online clears them, for that session (break: nothing cleared)', async () => {
    const { result } = renderHook(() => useCompleteSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 'session-1', note: null })
    })
    expect(world.cleared).toEqual(['session-1'])
  })

  it('a finish queued offline clears them too: the session has ended on this phone', async () => {
    world.online = false
    const { result } = renderHook(() => useCompleteSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 'session-1', note: null })
    })
    expect(world.queued).toHaveLength(1)
    expect(world.cleared).toEqual(['session-1'])
  })

  it('a finish that is refused clears nothing: the session is still in progress and its unlogged sets keep their numbers', async () => {
    world.completeFails = true
    const { result } = renderHook(() => useCompleteSession(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync({ id: 'session-1', note: null }).catch(() => {})
    })
    expect(world.cleared).toEqual([])
  })
})
