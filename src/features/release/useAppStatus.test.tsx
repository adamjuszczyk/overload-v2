// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AppStatus } from './appStatusService'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]; TASKS.md "The gate's state"): when the app reads the flag, and what the answer is allowed to
// decide. "The app checks the flag at start, when it comes back to the foreground, every hour, and every minute while the screen is showing" and
// "Offline, the app can't read the flag and works as usual". The reads are counted at the service (`fetchAppStatus`), and the hook runs on the
// app's own `queryClient`, so the options it sets (and the defaults it overrides) are the ones the app runs with. Phone, network and visibility
// are the real events a browser sends; time is faked where a wait is the point.
const world = vi.hoisted(() => ({
  user: null as { id: string } | null,
  status: { maintenance: false, minVersion: '1.2.1', exemptUserIds: [] as string[], updatedAt: '2026-10-30T18:00:00Z' } as unknown as AppStatus,
  reads: 0,
  failing: false,
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: world.user, loading: false, signOut: vi.fn() }) }))
vi.mock('./appStatusService', () => ({
  fetchAppStatus: async () => {
    world.reads += 1
    if (world.failing) throw new Error('Failed to fetch')
    return { ...world.status }
  },
}))

const { queryClient } = await import('../../lib/queryClient')
const { useAppStatus, useGate, maintenanceGate, GATE_POLL_MS, IDLE_POLL_MS } = await import('./useAppStatus')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
const ON: AppStatus = { maintenance: true, minVersion: '1.2.1', exemptUserIds: [], updatedAt: 'now' }
const OFF: AppStatus = { ...ON, maintenance: false }

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}
const goOffline = () => window.dispatchEvent(new Event('offline'))
const goOnline = () => window.dispatchEvent(new Event('online'))

beforeEach(() => {
  world.user = { id: 'u-stable' }
  world.status = OFF
  world.reads = 0
  world.failing = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  queryClient.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  onlineManager.setOnline(true) // the manager is module state: an offline test leaves it offline for the next
  queryClient.clear()
})

/** Time passes with the app's timers running; React and TanStack get to settle after each step. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
async function mountWithFakeTimers() {
  vi.useFakeTimers()
  const view = renderHook(() => useAppStatus(), { wrapper })
  await advance(0)
  return view
}

describe('when the flag is read', () => {
  it('the stated moments are an hour and a minute', () => {
    expect(IDLE_POLL_MS).toBe(60 * 60 * 1000)
    expect(GATE_POLL_MS).toBe(60 * 1000)
  })

  it('at start: one read when the app mounts, and the answer is the status, mapped', async () => {
    world.status = { ...ON, exemptUserIds: ['u-adam'] }
    const { result } = renderHook(() => useAppStatus(), { wrapper })
    expect(result.current.data).toBeUndefined() // unread: no answer, the app works as usual
    await waitFor(() => expect(result.current.data).toEqual({ ...ON, exemptUserIds: ['u-adam'] }))
    expect(world.reads).toBe(1)
  })

  it('when the document comes back to the foreground (visibilitychange to visible), and not when it goes to the background', async () => {
    const { result } = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(result.current.data).toBeDefined())
    expect(world.reads).toBe(1)
    act(() => setVisibility('hidden'))
    await new Promise((r) => setTimeout(r, 30))
    expect(world.reads, 'going to the background reads nothing').toBe(1)
    act(() => setVisibility('visible'))
    await waitFor(() => expect(world.reads).toBe(2))
    act(() => setVisibility('visible'))
    await waitFor(() => expect(world.reads).toBe(3)) // every return reads again, however recently it read
  })

  it('no longer listens once the app unmounts', async () => {
    const view = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(world.reads).toBe(1))
    view.unmount()
    act(() => setVisibility('visible'))
    await new Promise((r) => setTimeout(r, 30))
    expect(world.reads).toBe(1)
  })

  it('every hour while nothing is gated: nothing at a minute, nothing just before the hour, one at the hour, and the next one an hour on', async () => {
    await mountWithFakeTimers()
    expect(world.reads).toBe(1)
    await advance(GATE_POLL_MS)
    expect(world.reads, 'a minute: not a screen, no read').toBe(1)
    await advance(IDLE_POLL_MS - GATE_POLL_MS - 1)
    expect(world.reads, 'one ms short of the hour').toBe(1)
    await advance(1)
    expect(world.reads).toBe(2)
    await advance(IDLE_POLL_MS)
    expect(world.reads).toBe(3)
  })

  it('every minute while the maintenance screen shows (maintenance on, this account not exempt), minute after minute', async () => {
    world.status = ON
    const { result } = await mountWithFakeTimers()
    expect(result.current.data?.maintenance).toBe(true)
    expect(world.reads).toBe(1)
    await advance(GATE_POLL_MS - 1)
    expect(world.reads).toBe(1)
    await advance(1)
    expect(world.reads).toBe(2)
    await advance(GATE_POLL_MS)
    await advance(GATE_POLL_MS)
    expect(world.reads).toBe(4)
  })

  it('every minute while it shows signed out too (there is no account to exempt)', async () => {
    world.user = null
    world.status = { ...ON, exemptUserIds: ['u-adam'] }
    await mountWithFakeTimers()
    await advance(3 * GATE_POLL_MS)
    expect(world.reads).toBe(4)
  })

  it('not every minute for an exempt account: its strip is not a screen, so it reads every hour like the app with nothing on', async () => {
    world.user = { id: 'u-adam' }
    world.status = { ...ON, exemptUserIds: ['u-adam'] }
    const { result } = await mountWithFakeTimers()
    expect(result.current.data?.maintenance).toBe(true)
    await advance(10 * GATE_POLL_MS)
    expect(world.reads).toBe(1)
    await advance(IDLE_POLL_MS - 10 * GATE_POLL_MS)
    expect(world.reads).toBe(2)
  })

  it('when maintenance is read as off the minute reads stop: the app opens, and the next read is an hour away', async () => {
    world.status = ON
    const { result } = await mountWithFakeTimers()
    await advance(GATE_POLL_MS)
    expect(world.reads).toBe(2)
    world.status = OFF
    await advance(GATE_POLL_MS) // the read that finds it off
    expect(world.reads).toBe(3)
    await advance(1) // TanStack tells React on a zero timer, which a read that lands at the last tick schedules for the next
    expect(result.current.data?.maintenance).toBe(false)
    await advance(GATE_POLL_MS * 30)
    expect(world.reads, 'half an hour on: nothing more').toBe(3)
    await advance(IDLE_POLL_MS)
    expect(world.reads).toBe(4)
  })
})

describe('what the answer is when the app cannot read it (chunk 72 pre-read, 72-2)', () => {
  it('maintenance read on, then the phone goes offline: the app has no answer and works as usual; back online it reads again and the answer is back', async () => {
    world.status = ON
    const { result } = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(result.current.data?.maintenance).toBe(true))
    expect(world.reads).toBe(1)

    act(() => goOffline())
    expect(result.current.data, 'the data TanStack still holds is not an answer while the phone is offline').toBeUndefined()
    expect(queryClient.getQueryData(['v2_appStatus']), 'it is still held').toBeDefined()
    expect(world.reads).toBe(1) // nothing is read while offline

    act(() => goOnline())
    await waitFor(() => expect(world.reads).toBe(2)) // read again on reconnect
    await waitFor(() => expect(result.current.data?.maintenance).toBe(true))
  })

  it('the maintenance that was over while the phone was offline is read as over once it is back', async () => {
    world.status = ON
    const { result } = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(result.current.data?.maintenance).toBe(true))
    act(() => goOffline())
    world.status = OFF
    act(() => goOnline())
    await waitFor(() => expect(result.current.data?.maintenance).toBe(false))
  })

  it('a phone that starts offline reads nothing and has no answer', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    onlineManager.setOnline(false)
    const { result } = renderHook(() => useAppStatus(), { wrapper })
    await new Promise((r) => setTimeout(r, 30))
    expect(result.current.data).toBeUndefined()
    expect(world.reads).toBe(0)
  })

  it('a read that fails online leaves no answer (the app works as usual), and a later one that goes through brings it', async () => {
    world.failing = true
    const { result } = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(world.reads).toBeGreaterThanOrEqual(1))
    await new Promise((r) => setTimeout(r, 30))
    expect(result.current.data).toBeUndefined()
    world.failing = false
    world.status = ON
    act(() => setVisibility('visible'))
    // the read that failed is still on its one retry (a second, TanStack's `retry: 1`), which a read made meanwhile joins
    await waitFor(() => expect(result.current.data?.maintenance).toBe(true), { timeout: 4000 })
  })
})

describe('what the status asks of an account (maintenanceGate)', () => {
  it('a table: no answer or maintenance off → nothing; on → the screen, and the strip for an exempt account; signed out → the screen', () => {
    const exempt = { ...ON, exemptUserIds: ['u-adam', 'u-test'] }
    const rows: Array<[string, AppStatus | undefined, string | undefined, string | null]> = [
      ['no answer, signed in', undefined, 'u-stable', null],
      ['no answer, signed out', undefined, undefined, null],
      ['off, signed in', OFF, 'u-stable', null],
      ['off, an exempt id', { ...OFF, exemptUserIds: ['u-adam'] }, 'u-adam', null],
      ['on, nobody exempt, signed in', ON, 'u-stable', 'maintenance'],
      ['on, not on the list', exempt, 'u-stable', 'maintenance'],
      ['on, on the list (first)', exempt, 'u-adam', 'strip'],
      ['on, on the list (second)', exempt, 'u-test', 'strip'],
      ['on, signed out', exempt, undefined, 'maintenance'],
    ]
    for (const [name, status, userId, gate] of rows) expect(maintenanceGate(status, userId), name).toBe(gate)
  })

  it('useGate reads the account and the answer: the screen for a non-exempt account, the strip for an exempt one, and nothing offline', async () => {
    world.status = { ...ON, exemptUserIds: ['u-adam'] }
    const stable = renderHook(() => useGate(), { wrapper })
    expect(stable.result.current).toBeNull() // unread
    await waitFor(() => expect(stable.result.current).toBe('maintenance'))
    stable.unmount()
    world.user = { id: 'u-adam' }
    const adam = renderHook(() => useGate(), { wrapper })
    await waitFor(() => expect(adam.result.current).toBe('strip'))
    act(() => goOffline())
    expect(adam.result.current, 'offline: the app works as usual').toBeNull()
  })
})
