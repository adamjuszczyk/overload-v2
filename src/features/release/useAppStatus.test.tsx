// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
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
const APP_QUERY_DEFAULTS = queryClient.getDefaultOptions() // a test that changes them puts them back

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
  queryClient.setDefaultOptions(APP_QUERY_DEFAULTS)
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

// ─── Chunk 73 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const MUST_UPDATE: AppStatus = { ...OFF, minVersion: '1.2.2' } // the running version is stubbed 1.2.1

describe('chunk 72 review, D: a read that fails after one that answered keeps the answer (TanStack holds the data of the last good read)', () => {
  it('maintenance read on, then a read that fails online: the screen stays up, and nothing is erased', async () => {
    queryClient.setDefaultOptions({ queries: { retry: false } }) // the failure is the point, not the retry after it
    world.status = ON
    const { result } = renderHook(() => useGate(), { wrapper })
    await waitFor(() => expect(result.current).toBe('maintenance'))
    world.failing = true
    act(() => setVisibility('visible'))
    await waitFor(() => expect(queryClient.getQueryState(['v2_appStatus'])?.status).toBe('error'))
    expect(world.reads).toBe(2)
    expect(result.current, 'the failed read changed nothing the person sees').toBe('maintenance')
    expect(queryClient.getQueryData(['v2_appStatus'])).toMatchObject({ maintenance: true })
    world.failing = false
    world.status = OFF
    act(() => setVisibility('visible'))
    await waitFor(() => expect(result.current).toBeNull()) // a read that answers differently is what changes it
  })

  it('the same for the version: an update that was required stays required through a read that fails', async () => {
    queryClient.setDefaultOptions({ queries: { retry: false } })
    world.status = MUST_UPDATE
    const { result } = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(result.current.data?.minVersion).toBe('1.2.2'))
    world.failing = true
    act(() => setVisibility('visible'))
    await waitFor(() => expect(queryClient.getQueryState(['v2_appStatus'])?.status).toBe('error'))
    expect(result.current.data?.minVersion).toBe('1.2.2')
  })
})

describe('chunk 72 review, P2: one read when the app comes back to the foreground, however many components use the status', () => {
  it('three users of the status (the gate, and two more): a return reads once, and once more for the next', async () => {
    const gate = renderHook(() => useGate(), { wrapper })
    const second = renderHook(() => useAppStatus(), { wrapper })
    const third = renderHook(() => useAppStatus(), { wrapper })
    await waitFor(() => expect(second.result.current.data).toBeDefined())
    expect(world.reads, 'one read at start for all three').toBe(1)

    act(() => setVisibility('visible'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(world.reads, 'a return is one read').toBe(2)
    act(() => setVisibility('visible'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(world.reads).toBe(3)

    third.unmount()
    act(() => setVisibility('visible'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(world.reads, 'one user fewer: still one read').toBe(4)
    gate.unmount()
    second.unmount()
    act(() => setVisibility('visible'))
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(world.reads, 'nobody listens: none').toBe(4)
  })

  it("the listener is the document's own and is added once: one add for three users, removed with the last", () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const ofVisibility = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === 'visibilitychange').length
    const views = [renderHook(() => useAppStatus(), { wrapper }), renderHook(() => useAppStatus(), { wrapper }), renderHook(() => useGate(), { wrapper })]
    expect(ofVisibility(add)).toBe(1)
    views[0].unmount()
    views[1].unmount()
    expect(ofVisibility(remove), 'one user still listens').toBe(0)
    views[2].unmount()
    expect(ofVisibility(remove)).toBe(1)
  })
})

describe('Update to continue is checked at the same moments as maintenance: every minute while the screen shows', () => {
  it('the running version is older than min_version: a read every minute, minute after minute, whatever maintenance says', async () => {
    world.status = MUST_UPDATE
    const { result } = await mountWithFakeTimers()
    expect(result.current.data?.minVersion).toBe('1.2.2')
    expect(world.reads).toBe(1)
    await advance(GATE_POLL_MS - 1)
    expect(world.reads).toBe(1)
    await advance(1)
    expect(world.reads).toBe(2)
    await advance(GATE_POLL_MS * 3)
    expect(world.reads).toBe(5)
  })

  it('an exempt account is gated by the version like everyone: its strip is not a screen, but the update screen is', async () => {
    world.user = { id: 'u-adam' }
    world.status = { ...MUST_UPDATE, maintenance: true, exemptUserIds: ['u-adam'] }
    await mountWithFakeTimers()
    await advance(GATE_POLL_MS * 2)
    expect(world.reads).toBe(3)
  })

  it('signed out too (the screen covers the sign-in page)', async () => {
    world.user = null
    world.status = MUST_UPDATE
    await mountWithFakeTimers()
    await advance(GATE_POLL_MS * 2)
    expect(world.reads).toBe(3)
  })

  it('the minute that finds min_version back at the running version stops the minutes: the next read is an hour away', async () => {
    world.status = MUST_UPDATE
    const { result } = await mountWithFakeTimers()
    await advance(GATE_POLL_MS)
    expect(world.reads).toBe(2)
    world.status = OFF
    await advance(GATE_POLL_MS)
    expect(world.reads).toBe(3)
    await advance(1)
    expect(result.current.data?.minVersion).toBe('1.2.1')
    await advance(GATE_POLL_MS * 30)
    expect(world.reads, 'half an hour on: nothing more').toBe(3)
    await advance(IDLE_POLL_MS)
    expect(world.reads).toBe(4)
  })

  it('control: min_version at the running version is no screen, so only the hour reads', async () => {
    world.status = OFF
    await mountWithFakeTimers()
    await advance(GATE_POLL_MS * 10)
    expect(world.reads).toBe(1)
  })
})
