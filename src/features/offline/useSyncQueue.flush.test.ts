// B3 (4 of 5): overlapping queue flushes. A flush reads the whole queue,
// then deletes each item after its upsert. A second flush started in that
// window (connectivity flapping, or a finish asking for a flush) read the
// same items and replayed them, so an old write (a session's in_progress
// upsert) could land after the newer one (its completion).
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends

interface QueueItem {
  id: number
  table: string
  operation: 'upsert'
  payload: Record<string, unknown>
  createdAt: string
  attempts?: number
}

let queue: QueueItem[] = []
const upserts: Array<Record<string, unknown>> = []
let gate: Promise<void> = Promise.resolve()

vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({ toArray: async () => [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }),
      delete: async (id: number) => {
        queue = queue.filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        queue = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
    },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      upsert: async (payload: Record<string, unknown>) => {
        await gate
        upserts.push(payload)
        return { error: null }
      },
    }),
  },
}))
vi.mock('../../lib/queryClient', () => ({ queryClient: { invalidateQueries: vi.fn() } }))
// Chunk 73: the version check is not what this file looks at (useSyncQueue.versionGate.test.tsx is); the queue here sends as it always did.
vi.mock('../release/versionGate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../release/versionGate')>()),
  readVersionGate: () => 'ok' as const,
  useVersionGate: () => 'ok' as const,
}))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

const { flushSyncQueue } = await import('./useSyncQueue')

const tick = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  queue = [
    { id: 1, table: 'v2_sessions', operation: 'upsert', payload: { id: 's1', status: 'in_progress' }, createdAt: '2026-10-11T08:00:00Z' },
    { id: 2, table: 'v2_sessions', operation: 'upsert', payload: { id: 's1', status: 'completed' }, createdAt: '2026-10-11T09:00:00Z' },
  ]
  upserts.length = 0
  gate = Promise.resolve()
})

describe('flushSyncQueue — one flush at a time (B3)', () => {
  it('two overlapping flushes replay each item once, in order', async () => {
    let release!: () => void
    gate = new Promise<void>((r) => {
      release = r
    })
    const first = flushSyncQueue()
    await tick()
    const second = flushSyncQueue()
    await tick()
    release()
    await Promise.all([first, second])

    expect(upserts.map((u) => u.status)).toEqual(['in_progress', 'completed'])
    expect(queue).toEqual([])
  })

  it('an item queued while a flush runs is sent by that flush’s follow-up pass', async () => {
    let release!: () => void
    gate = new Promise<void>((r) => {
      release = r
    })
    const first = flushSyncQueue()
    await tick()
    queue.push({ id: 3, table: 'v2_set_logs', operation: 'upsert', payload: { id: 'l1' }, createdAt: '2026-10-11T09:30:00Z' })
    const second = flushSyncQueue()
    release()
    await Promise.all([first, second])

    expect(upserts.map((u) => u.id)).toEqual(['s1', 's1', 'l1'])
    expect(queue).toEqual([])
  })

  it('a flush after the previous one finished runs normally', async () => {
    await flushSyncQueue()
    queue.push({ id: 4, table: 'v2_set_logs', operation: 'upsert', payload: { id: 'l2' }, createdAt: '2026-10-11T10:00:00Z' })
    await flushSyncQueue()
    expect(upserts.map((u) => u.id)).toEqual(['s1', 's1', 'l2'])
  })
})
