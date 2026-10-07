// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Chunk 18 (SPEC.md "Warmup routine": "Items are ticked off; nothing else is
// logged."). Needs a real `localStorage` global (jsdom provides one; the
// suite's default 'node' environment does not — see this file's own
// docblock), same reason every GymSession component test already opts into
// jsdom.

const { useWarmupRoutineStore } = await import('./warmupRoutineStore')

beforeEach(() => {
  useWarmupRoutineStore.setState({ bySession: {} })
  localStorage.clear()
})

describe('warmupRoutineStore — ticks are per session, never cross-contaminate', () => {
  it('toggling an item sets it ticked; toggling again clears it', () => {
    useWarmupRoutineStore.getState().toggle('session-1', 'item-a')
    expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({ 'item-a': true })

    useWarmupRoutineStore.getState().toggle('session-1', 'item-a')
    expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({ 'item-a': false })
  })

  it('two different items in the same session are independent', () => {
    useWarmupRoutineStore.getState().toggle('session-1', 'item-a')
    useWarmupRoutineStore.getState().toggle('session-1', 'item-b')
    expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({ 'item-a': true, 'item-b': true })
  })

  it('ticking in one session never leaks into another session id, even for the same item id', () => {
    useWarmupRoutineStore.getState().toggle('session-1', 'item-a')
    useWarmupRoutineStore.getState().load('session-2')

    expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({ 'item-a': true })
    expect(useWarmupRoutineStore.getState().bySession['session-2']).toEqual({})
  })
})

describe('warmupRoutineStore — survives a reload (localStorage, keyed by session id)', () => {
  it('a fresh store instance (simulating a reload) reads back ticks saved under the same session id', () => {
    useWarmupRoutineStore.getState().toggle('session-1', 'item-a')

    // Simulate "unmount and remount for the same session" without actually
    // re-importing the module: clear the in-memory cache (what a fresh page
    // load would start with) and load() again — it must re-hydrate from the
    // real localStorage write toggle() just made, not from anything held
    // over in memory.
    useWarmupRoutineStore.setState({ bySession: {} })
    useWarmupRoutineStore.getState().load('session-1')

    expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({ 'item-a': true })
  })

  it('a DIFFERENT session id never reads another session\'s own localStorage key', () => {
    useWarmupRoutineStore.getState().toggle('session-1', 'item-a')

    useWarmupRoutineStore.setState({ bySession: {} })
    useWarmupRoutineStore.getState().load('session-2')

    expect(useWarmupRoutineStore.getState().bySession['session-2']).toEqual({})
  })

  it('load() is a no-op once a session id is already hydrated in this store instance', () => {
    useWarmupRoutineStore.getState().toggle('session-1', 'item-a')
    // Overwrite localStorage directly — if load() re-read it, it would
    // clobber the in-memory (more current) state; it must not, since
    // session-1 is already in bySession.
    localStorage.setItem('overload:warmup-routine-ticks:session-1', JSON.stringify({ savedAt: 0, ticked: { 'item-a': false } }))
    useWarmupRoutineStore.getState().load('session-1')
    expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({ 'item-a': true })
  })
})

describe('warmupRoutineStore — a failing localStorage never throws', () => {
  it('toggle() still updates in-memory state when setItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      expect(() => useWarmupRoutineStore.getState().toggle('session-1', 'item-a')).not.toThrow()
      expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({ 'item-a': true })
    } finally {
      spy.mockRestore()
    }
  })

  it('load() still hydrates to {} (never throws) when getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    try {
      expect(() => useWarmupRoutineStore.getState().load('session-1')).not.toThrow()
      expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({})
    } finally {
      spy.mockRestore()
    }
  })

  it('a toggle made while storage is broken is simply not there after a real reload (storage never actually wrote)', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    useWarmupRoutineStore.getState().toggle('session-1', 'item-a')
    spy.mockRestore()

    useWarmupRoutineStore.setState({ bySession: {} }) // simulate reload
    useWarmupRoutineStore.getState().load('session-1')
    expect(useWarmupRoutineStore.getState().bySession['session-1']).toEqual({})
  })
})

describe('warmupRoutineStore — pruning old sessions\' keys', () => {
  it('writing a 21st distinct session evicts the single oldest key, keeping 20', () => {
    for (let i = 0; i < 20; i++) {
      useWarmupRoutineStore.getState().toggle(`session-${i}`, 'item-a')
    }
    const keysAfter20 = Object.keys(localStorage).filter((k) => k.startsWith('overload:warmup-routine-ticks:'))
    expect(keysAfter20).toHaveLength(20)
    expect(localStorage.getItem('overload:warmup-routine-ticks:session-0')).not.toBeNull()

    useWarmupRoutineStore.getState().toggle('session-20', 'item-a')

    const keysAfter21 = Object.keys(localStorage).filter((k) => k.startsWith('overload:warmup-routine-ticks:'))
    expect(keysAfter21).toHaveLength(20)
    // session-0 was written first (lowest savedAt) — the one evicted.
    expect(localStorage.getItem('overload:warmup-routine-ticks:session-0')).toBeNull()
    expect(localStorage.getItem('overload:warmup-routine-ticks:session-20')).not.toBeNull()
  })

  it('never prunes below the cap when at or under it', () => {
    for (let i = 0; i < 5; i++) {
      useWarmupRoutineStore.getState().toggle(`session-${i}`, 'item-a')
    }
    const keys = Object.keys(localStorage).filter((k) => k.startsWith('overload:warmup-routine-ticks:'))
    expect(keys).toHaveLength(5)
  })
})
