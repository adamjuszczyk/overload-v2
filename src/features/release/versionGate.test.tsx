// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // the running version these tests stand on
import { act, cleanup, renderHook } from '@testing-library/react'
import { onlineManager } from '@tanstack/react-query'
import type { AppStatus } from './appStatusService'
import { queryClient } from '../../lib/queryClient'
import { APP_STATUS_KEY } from '../../lib/maintenanceRefusal'
import { readVersionGate, resetVersionGate, subscribeVersionGate, updateRequired, useVersionGate } from './versionGate'
import { STATUS_ALLOWS_1_2_1, STATUS_REQUIRES_1_2_2, versionCheckAnswers, versionCheckUnread } from './versionGate.testutil'

// Chunk 73 (SPEC.md 1.2.1, Rule 5; the gap pre-read's 73-1 and 73-2): "the old version never sends once the version check has refused it, and never
// before that check has answered". `readVersionGate` is that check, read from the query cache the status lives in at the moment it is asked.
//   - 'unknown' until a status has been read, and again after every offline stretch until a read made AFTER the phone is back online answers;
//   - 'blocked' when the running version (stubbed 1.2.1 here) is older than `min_version`; 'ok' when it is not.
const goOffline = () => act(() => onlineManager.setOnline(false))
const goOnline = () => act(() => onlineManager.setOnline(true))
const read = (status: AppStatus) => act(() => void queryClient.setQueryData(APP_STATUS_KEY, status))

beforeEach(() => {
  queryClient.clear()
  resetVersionGate()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  onlineManager.setOnline(true)
  queryClient.clear()
  resetVersionGate()
})

describe('updateRequired: this version is older than min_version', () => {
  it('a table over version pairs: dot-separated numbers, missing parts read 0, 1.2 is older than 1.2.1', () => {
    const rows: Array<[string, string, boolean]> = [
      ['1.2.0', '1.2.1', true],
      ['1.2.1', '1.2.1', false],
      ['1.2.2', '1.2.1', false],
      ['1.2', '1.2.1', true],
      ['1.2.0', '1.2', false],
      ['1.9.9', '1.10.0', true],
      ['1.10.0', '1.9.9', false],
      ['1.2.1', '2.0.0', true],
      ['1.2.1', '1.2.2', true],
      ['0.1.0', '1.2.1', true],
    ]
    for (const [app, min, required] of rows) {
      expect(updateRequired({ ...STATUS_ALLOWS_1_2_1, minVersion: min }, app), `${app} against ${min}`).toBe(required)
    }
  })

  it('no status is no answer: not required', () => {
    expect(updateRequired(undefined, '1.0.0')).toBe(false)
  })

  it('compares the running version, which is the stubbed define unless one is given', () => {
    expect(updateRequired({ ...STATUS_ALLOWS_1_2_1, minVersion: '1.2.1' })).toBe(false)
    expect(updateRequired({ ...STATUS_ALLOWS_1_2_1, minVersion: '1.2.2' })).toBe(true)
  })
})

describe('readVersionGate: from the cache, at the moment it is asked', () => {
  it("'unknown' with no status query at all, and with one that has been asked for and not answered", () => {
    expect(readVersionGate()).toBe('unknown')
    queryClient.getQueryCache().build(queryClient, { queryKey: APP_STATUS_KEY, queryFn: () => new Promise(() => {}) })
    expect(queryClient.getQueryState(APP_STATUS_KEY)?.data).toBeUndefined()
    expect(readVersionGate()).toBe('unknown')
  })

  it("'ok' when min_version is the running version or older, 'blocked' when it is newer, and it follows the cache", () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    expect(readVersionGate()).toBe('ok')
    versionCheckAnswers({ ...STATUS_ALLOWS_1_2_1, minVersion: '1.1.0' })
    expect(readVersionGate()).toBe('ok')
    versionCheckAnswers(STATUS_REQUIRES_1_2_2)
    expect(readVersionGate()).toBe('blocked')
    versionCheckAnswers(STATUS_ALLOWS_1_2_1) // the row went back
    expect(readVersionGate()).toBe('ok')
  })

  it('maintenance and the exempt list do not matter: the version check is for every account', () => {
    versionCheckAnswers({ ...STATUS_REQUIRES_1_2_2, maintenance: true, exemptUserIds: ['adam'] })
    expect(readVersionGate()).toBe('blocked')
    versionCheckAnswers({ ...STATUS_ALLOWS_1_2_1, maintenance: true })
    expect(readVersionGate()).toBe('ok')
  })

  it('a failed read after an answer keeps the answer (TanStack holds the data of the last good read)', async () => {
    versionCheckAnswers(STATUS_REQUIRES_1_2_2)
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await queryClient.fetchQuery({ queryKey: APP_STATUS_KEY, queryFn: () => Promise.reject(new Error('Failed to fetch')), staleTime: 0, retry: false }).catch(() => {})
    expect(queryClient.getQueryState(APP_STATUS_KEY)?.status).toBe('error')
    expect(readVersionGate()).toBe('blocked')
  })
})

describe('73-2: an answer older than the phone\'s return online is not an answer', () => {
  it("'ok' → offline → back online: 'unknown' until a read made after the return answers, then the new answer decides", () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    expect(readVersionGate()).toBe('ok')
    goOffline()
    expect(readVersionGate(), 'offline the old answer still stands, and nothing is sent offline anyway').toBe('ok')
    goOnline()
    expect(readVersionGate(), 'the cache still holds it, but it predates the return').toBe('unknown')
    read(STATUS_REQUIRES_1_2_2) // the release raised min_version while the phone was away
    expect(readVersionGate()).toBe('blocked')
  })

  it('the read after the return can also say it is fine', () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    goOffline()
    goOnline()
    expect(readVersionGate()).toBe('unknown')
    read(STATUS_ALLOWS_1_2_1)
    expect(readVersionGate()).toBe('ok')
  })

  it('"after" is counted in reads, not time: an answer set in the same millisecond as the return is still the old one', () => {
    vi.useFakeTimers({ toFake: ['Date'] }) // the clock stands still: every timestamp in this test is equal
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    const answeredAt = queryClient.getQueryState(APP_STATUS_KEY)!.dataUpdatedAt
    goOffline()
    goOnline()
    expect(queryClient.getQueryState(APP_STATUS_KEY)!.dataUpdatedAt, 'same instant').toBe(answeredAt)
    expect(readVersionGate()).toBe('unknown')
    read(STATUS_ALLOWS_1_2_1) // a new read in that same instant counts
    expect(readVersionGate()).toBe('ok')
  })

  it('a read that fails after the return is not an answer either: the gate stays unknown until one goes through', async () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    goOffline()
    goOnline()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await queryClient.fetchQuery({ queryKey: APP_STATUS_KEY, queryFn: () => Promise.reject(new Error('Failed to fetch')), staleTime: 0, retry: false }).catch(() => {})
    expect(queryClient.getQueryState(APP_STATUS_KEY)?.data, 'the old answer is still in the cache').toBeDefined()
    expect(readVersionGate()).toBe('unknown')
    await queryClient.fetchQuery({ queryKey: APP_STATUS_KEY, queryFn: async () => STATUS_REQUIRES_1_2_2, staleTime: 0 })
    expect(readVersionGate()).toBe('blocked')
  })

  it('every offline stretch does it, not only the first', () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    for (let stretch = 1; stretch <= 3; stretch += 1) {
      goOffline()
      goOnline()
      expect(readVersionGate(), `after stretch ${stretch}`).toBe('unknown')
      read(STATUS_ALLOWS_1_2_1)
      expect(readVersionGate(), `answered after stretch ${stretch}`).toBe('ok')
    }
  })

  it('a phone that was never offline needs no new read: an answer set by hand or by a read is trusted as read', () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    act(() => onlineManager.setOnline(true)) // already online: no change, no mark
    expect(readVersionGate()).toBe('ok')
  })

  it('a cache that is cleared (sign-out) forgets the mark with the query: the next read after it is trusted at once', () => {
    versionCheckAnswers(STATUS_ALLOWS_1_2_1)
    goOffline()
    goOnline()
    queryClient.clear()
    expect(readVersionGate()).toBe('unknown') // nothing read
    read(STATUS_ALLOWS_1_2_1) // a new query, with a count of its own
    expect(readVersionGate()).toBe('ok')
  })

  it('a status asked for only after the return is trusted as soon as it answers', () => {
    goOffline() // no status query exists yet
    goOnline()
    read(STATUS_REQUIRES_1_2_2)
    expect(readVersionGate()).toBe('blocked')
  })
})

describe('subscribeVersionGate and useVersionGate', () => {
  it('tells its listeners when the status query changes and when the phone is back online, and nothing for other queries', () => {
    const listener = vi.fn()
    const stop = subscribeVersionGate(listener)
    queryClient.setQueryData(['v2_session', 's1'], { id: 's1' })
    expect(listener, 'an unrelated query').not.toHaveBeenCalled()
    read(STATUS_ALLOWS_1_2_1)
    expect(listener).toHaveBeenCalled()
    listener.mockClear()
    goOffline()
    goOnline()
    expect(listener, 'back online').toHaveBeenCalled()
    stop()
    listener.mockClear()
    read(STATUS_REQUIRES_1_2_2)
    expect(listener, 'after unsubscribing').not.toHaveBeenCalled()
  })

  it('the hook gives the gate as a value and follows it: unknown, ok, blocked, unknown after the return, blocked again', () => {
    versionCheckUnread()
    const { result } = renderHook(() => useVersionGate())
    expect(result.current).toBe('unknown')
    read(STATUS_ALLOWS_1_2_1)
    expect(result.current).toBe('ok')
    read(STATUS_REQUIRES_1_2_2)
    expect(result.current).toBe('blocked')
    goOffline()
    goOnline()
    expect(result.current).toBe('unknown')
    read(STATUS_REQUIRES_1_2_2)
    expect(result.current).toBe('blocked')
  })
})
