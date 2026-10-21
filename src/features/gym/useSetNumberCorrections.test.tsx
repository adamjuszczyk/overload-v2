// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, cleanup, act } from '@testing-library/react'
import type { Session } from '../../types'

// Chunk 58a — the hook that writes the workout screen's number corrections (DECISIONS 178, 185 (c), 197), on its own: what it waits
// for, what it does not write twice, and what the screen's copy of a log says once its patch is queued. (The screen's use of it:
// GymSession.numberCorrections.test.tsx; the queue's own rules: useSyncQueue.patch.test.ts.)
afterEach(() => cleanup())

let online = true
let queueGate: Promise<void> = Promise.resolve()
const queued: Array<{ log: { id: string; sessionId: string; parentSetId?: string | null }; setNumber: number }> = []
const flushed = vi.fn()

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online }))
vi.mock('../offline/useSyncQueue', () => ({
  queueSetLogPatch: async (log: { id: string; sessionId: string; parentSetId?: string | null }, setNumber: number) => {
    await queueGate
    queued.push({ log, setNumber })
  },
  flushSyncQueue: () => {
    flushed()
    return Promise.resolve()
  },
}))

const { useSetNumberCorrections, patchSetNumbers } = await import('./useSetNumberCorrections')
const { queryClient } = await import('../../lib/queryClient')

const settle = () =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
const hook = (p: Parameters<typeof useSetNumberCorrections>[0]) => useSetNumberCorrections(p)
const props = { sessionId: 's1', enabled: true, corrections: [{ id: 'a', setNumber: 2 }], logs: [{ id: 'a', parentSetId: null }], busy: 0 }

beforeEach(() => {
  online = true
  queueGate = Promise.resolve()
  queued.length = 0
  flushed.mockClear()
  queryClient.clear()
})

describe('useSetNumberCorrections', () => {
  it('writes nothing while a write of the screen\'s own is on its way (a delete and its renumber), and writes once it is done', async () => {
    const { rerender } = renderHook(hook, { initialProps: { ...props, busy: 1 } })
    await settle()
    expect(queued).toEqual([])
    rerender({ ...props, busy: 0 })
    await settle()
    expect(queued).toEqual([{ log: { id: 'a', sessionId: 's1', parentSetId: null }, setNumber: 2 }])
    expect(flushed).toHaveBeenCalledTimes(1)
  })

  it('a patch still on its way is not queued a second time by a draw that lists it again', async () => {
    let release!: () => void
    queueGate = new Promise<void>((resolve) => (release = resolve)) // the queue is slow: the first patch is still being added
    const { rerender } = renderHook(hook, { initialProps: props })
    rerender({ ...props, busy: 1 }) // a write of the screen's own comes and goes: the hook runs again with the same list
    rerender({ ...props, busy: 0 })
    release()
    await settle()
    expect(queued).toHaveLength(1)
  })

  it('a session that is not drawn for working in (not in progress) writes nothing', async () => {
    renderHook(hook, { initialProps: { ...props, enabled: false } })
    await settle()
    expect(queued).toEqual([])
    expect(flushed).not.toHaveBeenCalled()
  })
})

describe('patchSetNumbers', () => {
  it('once a patch is queued, the screen\'s own copy of the log holds the new number (the next draw lists nothing for it) and a stage names its head', async () => {
    queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: [{ id: 'a', setNumber: 5 }, { id: 'b', setNumber: 6 }] } as unknown as Session)
    await patchSetNumbers({ sessionId: 's1', patches: [{ id: 'a', setNumber: 4 }], logs: [{ id: 'a', parentSetId: 'head' }], flush: false })
    const cached = queryClient.getQueryData<Session>(['v2_session', 's1'])
    expect(cached?.setLogs?.map((l) => [l.id, l.setNumber])).toEqual([['a', 4], ['b', 6]])
    expect(queued).toEqual([{ log: { id: 'a', sessionId: 's1', parentSetId: 'head' }, setNumber: 4 }])
    expect(flushed).not.toHaveBeenCalled()
  })

  it('the queue is sent after the last patch is queued, and only when the phone is online (flush)', async () => {
    await patchSetNumbers({ sessionId: 's1', patches: [{ id: 'a', setNumber: 1 }, { id: 'b', setNumber: 2 }], logs: [], flush: true })
    expect(queued.map((q) => q.log.id)).toEqual(['a', 'b'])
    expect(flushed).toHaveBeenCalledTimes(1)
  })
})
