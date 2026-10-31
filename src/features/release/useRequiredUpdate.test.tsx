// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // the running version these tests stand on
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, onlineManager, useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { AppStatus } from './appStatusService'

// Chunk 73 (SPEC.md 1.2.1, Screens → Update to continue [11]; TASKS.md chunk 73, W; DECISIONS 257, 258; the gap pre-read's 73-4). What UPDATE does,
// branch by branch, against a service worker registration that is an event target of its own (installing, waiting, updatefound, statechange,
// controllerchange) and a reload that is a spy:
//   - offline: failed at once; a write in flight: the reload waits for it (8 s at the most);
//   - the new worker has already activated (autoUpdate + skipWaiting + clientsClaim make that the usual case): reload at once, no update asked for;
//   - a worker installing or waiting: attach to it; otherwise ask the registration for an update and watch for the worker it finds;
//   - the update check refused, a worker that fails, or none activated within 20 s: failed, nothing reloaded.
const world = vi.hoisted(() => ({
  user: { id: 'u-stable' } as { id: string } | null,
  status: null as unknown as AppStatus,
  reads: 0,
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: world.user, loading: false, signOut: vi.fn() }) }))
vi.mock('./appStatusService', () => ({
  fetchAppStatus: async () => {
    world.reads += 1
    return { ...world.status }
  },
}))
vi.mock('../pwa/pwaRegister', () => ({ useRegisterSW: () => ({}) }))

const { queryClient } = await import('../../lib/queryClient')
const { applyUpdate, useRequiredUpdate, UPDATE_WAIT_MS, MUTATION_WAIT_MS } = await import('./useRequiredUpdate')
const { recordNewWorkerActive, recordRegistration, resetServiceWorkerRecord } = await import('../pwa/useServiceWorker')

const OLD: AppStatus = { maintenance: false, minVersion: '1.2.2', exemptUserIds: [], updatedAt: 'now' } // the running version is 1.2.1
const FINE: AppStatus = { ...OLD, minVersion: '1.2.1' }
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

class FakeWorker extends EventTarget {
  state: ServiceWorkerState
  constructor(state: ServiceWorkerState = 'installing') {
    super()
    this.state = state
  }
  become(state: ServiceWorkerState) {
    this.state = state
    this.dispatchEvent(new Event('statechange'))
  }
}
class FakeRegistration extends EventTarget {
  installing: FakeWorker | null = null
  waiting: FakeWorker | null = null
  active: FakeWorker | null = new FakeWorker('activated')
  update = vi.fn(() => Promise.resolve())
  /** What `registration.update()` does when a new sw.js is found: a worker starts installing and `updatefound` fires. */
  found(worker: FakeWorker) {
    this.installing = worker
    this.dispatchEvent(new Event('updatefound'))
  }
}
class FakeContainer extends EventTarget {
  getRegistration = vi.fn(async (): Promise<FakeRegistration | undefined> => undefined)
}

let registration: FakeRegistration
let container: FakeContainer
let reload: ReturnType<typeof vi.fn>

function install(reg: FakeRegistration | null = registration) {
  if (reg) recordRegistration(reg as unknown as ServiceWorkerRegistration)
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}
/** A write in flight: a mutation that settles when `finish()` is called. */
function writeInFlight() {
  let finish!: () => void
  const view = renderHook(() => useMutation({ mutationFn: () => new Promise<void>((resolve) => (finish = resolve)) }), { wrapper })
  act(() => void view.result.current.mutate())
  return { finish: () => act(async () => finish()), view }
}

beforeEach(() => {
  world.user = { id: 'u-stable' }
  world.status = OLD
  world.reads = 0
  registration = new FakeRegistration()
  container = new FakeContainer()
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container })
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  resetServiceWorkerRecord()
  queryClient.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'serviceWorker')
  onlineManager.setOnline(true)
  queryClient.clear()
})

describe('applyUpdate: UPDATE, branch by branch', () => {
  it('offline: failed at once, before anything is waited for or asked, and nothing is reloaded', async () => {
    install()
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const write = writeInFlight() // a write in flight is not waited for either
    expect(await applyUpdate()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
    expect(registration.update).not.toHaveBeenCalled()
    await write.finish()
  })

  it('a newer worker has already activated: reloads at once, once, and asks for no update', async () => {
    install()
    recordNewWorkerActive()
    expect(await applyUpdate()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(registration.update).not.toHaveBeenCalled()
    expect(registration.installing).toBeNull()
  })

  it('a newer worker has already activated and no registration is known: it still reloads (the reload is served by the worker)', async () => {
    recordNewWorkerActive()
    expect(await applyUpdate()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('a worker is installing: UPDATE attaches to it, waits for it to activate, then reloads once; the registration is not asked for an update', async () => {
    install()
    const worker = new FakeWorker('installing')
    registration.installing = worker
    const done = applyUpdate()
    await Promise.resolve()
    expect(reload, 'not before it has activated').not.toHaveBeenCalled()
    worker.become('installed')
    worker.become('activating')
    expect(reload).not.toHaveBeenCalled()
    worker.become('activated')
    expect(await done).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(registration.update, 'there was one installing already').not.toHaveBeenCalled()
  })

  it('a worker is waiting (installed, not yet taking over): the same', async () => {
    install()
    const worker = new FakeWorker('installed')
    registration.waiting = worker
    const done = applyUpdate()
    await Promise.resolve()
    expect(reload).not.toHaveBeenCalled()
    worker.become('activated')
    expect(await done).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(registration.update).not.toHaveBeenCalled()
  })

  it('a worker that is already activated when UPDATE looks at it: reloads', async () => {
    install()
    registration.installing = new FakeWorker('activated')
    expect(await applyUpdate()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('nothing installing or waiting: the registration is asked for an update, the worker it finds is watched, and the reload follows its activation', async () => {
    install()
    const worker = new FakeWorker('installing')
    registration.update.mockImplementation(async () => registration.found(worker))
    const done = applyUpdate()
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1))
    expect(reload).not.toHaveBeenCalled()
    worker.become('installed')
    worker.become('activated')
    expect(await done).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('the update finds its worker only after update() has resolved (updatefound fires later): still watched', async () => {
    install()
    const worker = new FakeWorker('installing')
    let resolveUpdate!: () => void
    registration.update.mockImplementation(() => new Promise<void>((resolve) => (resolveUpdate = resolve)))
    const done = applyUpdate()
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled())
    resolveUpdate()
    await Promise.resolve()
    registration.found(worker)
    worker.become('activated')
    expect(await done).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('the controller changing (the new worker has claimed the page) counts as the new worker being active', async () => {
    install()
    const done = applyUpdate()
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalled())
    container.dispatchEvent(new Event('controllerchange'))
    expect(await done).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('the update check refused (update() rejects): failed at once, nothing reloaded', async () => {
    install()
    registration.update.mockRejectedValue(new TypeError('Failed to fetch'))
    expect(await applyUpdate()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('the worker fails to install (redundant): failed, nothing reloaded', async () => {
    install()
    const worker = new FakeWorker('installing')
    registration.installing = worker
    const done = applyUpdate()
    await Promise.resolve()
    worker.become('redundant')
    expect(await done).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  // The three tests below ("fails at once") run on fake timers and read the answer one millisecond in, so a failure that waits for the 20 s cap is caught by an
  // assertion. The two tests before them (a refused check, a redundant worker) wait on real timers and the cap resolves the same `false`: under a break that
  // defers the answer to the cap they pass at 20 s, or time out earlier, and neither is an assertion (chunk 73's review: B7g, B7j).
  it('the update check refused (update() rejects) fails at once: one millisecond on the attempt is over, the 20 s cap is not what ends it', async () => {
    vi.useFakeTimers()
    install()
    registration.update.mockRejectedValue(new TypeError('Failed to fetch'))
    let outcome: boolean | undefined
    void applyUpdate().then((ok) => (outcome = ok))
    await advance(1)
    expect(outcome, 'a refusal that waits for the cap is still undefined here').toBe(false)
    expect(registration.update).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })

  it('a worker that turns redundant while UPDATE watches it fails at once, not at the cap', async () => {
    vi.useFakeTimers()
    install()
    const worker = new FakeWorker('installing')
    registration.installing = worker
    let outcome: boolean | undefined
    void applyUpdate().then((ok) => (outcome = ok))
    await advance(0) // UPDATE has attached to the worker
    expect(outcome, 'still waiting while the worker installs').toBeUndefined()
    worker.become('redundant')
    await advance(1)
    expect(outcome, 'a redundant worker that waits for the cap is still undefined here').toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('a worker that is already redundant when UPDATE looks at it fails at once, not at the cap', async () => {
    vi.useFakeTimers()
    install()
    registration.installing = new FakeWorker('redundant')
    let outcome: boolean | undefined
    void applyUpdate().then((ok) => (outcome = ok))
    await advance(1)
    expect(outcome, 'a redundant worker that waits for the cap is still undefined here').toBe(false)
    expect(registration.update, 'there was a worker to look at, so no update is asked for').not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
  })

  it('no worker within 20 s: failed at 20 s and not before, nothing reloaded; a worker that comes later is not reloaded for', async () => {
    vi.useFakeTimers()
    install()
    expect(UPDATE_WAIT_MS).toBe(20_000)
    let outcome: boolean | undefined
    void applyUpdate().then((ok) => (outcome = ok))
    await advance(UPDATE_WAIT_MS - 1)
    expect(outcome, 'still waiting one millisecond short of the cap').toBeUndefined()
    await advance(1)
    expect(outcome).toBe(false)
    const late = new FakeWorker('installing')
    registration.found(late)
    late.become('activated')
    container.dispatchEvent(new Event('controllerchange'))
    expect(reload, 'the attempt is over: late events reload nothing').not.toHaveBeenCalled()
  })

  it('the cap counts from the update check, after the wait for a write in flight', async () => {
    vi.useFakeTimers()
    install()
    const write = writeInFlight()
    let outcome: boolean | undefined
    void applyUpdate().then((ok) => (outcome = ok))
    await advance(3000)
    expect(registration.update, 'still waiting for the write').not.toHaveBeenCalled()
    await write.finish()
    await advance(150)
    expect(registration.update).toHaveBeenCalledTimes(1)
    await advance(UPDATE_WAIT_MS - 1)
    expect(outcome).toBeUndefined()
    await advance(1)
    expect(outcome).toBe(false)
  })

  it('no registration known but the browser has one: it is asked for (getRegistration) and used', async () => {
    container.getRegistration.mockResolvedValue(registration)
    const worker = new FakeWorker('installing')
    registration.installing = worker
    const done = applyUpdate()
    await vi.waitFor(() => expect(container.getRegistration).toHaveBeenCalled())
    worker.become('activated')
    expect(await done).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('no registration at all in a browser that has service workers (the registration failed): no new version can install, so failed', async () => {
    expect(await applyUpdate()).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('a browser with no service worker caches nothing: a reload fetches the newest code, so it reloads', async () => {
    Reflect.deleteProperty(navigator, 'serviceWorker')
    expect(await applyUpdate()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('the reload waits for a write in flight, as the banner\'s RELOAD did', () => {
  it('a write that settles after 3 s: the reload is held until then, then goes', async () => {
    vi.useFakeTimers()
    install()
    recordNewWorkerActive()
    const write = writeInFlight()
    let outcome: boolean | undefined
    void applyUpdate().then((ok) => (outcome = ok))
    await advance(3000)
    expect(reload, 'the write is still out').not.toHaveBeenCalled()
    expect(outcome).toBeUndefined()
    await write.finish()
    await advance(150)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(outcome).toBe(true)
  })

  it('a write that never settles is waited for 8 s and no longer', async () => {
    vi.useFakeTimers()
    install()
    recordNewWorkerActive()
    expect(MUTATION_WAIT_MS).toBe(8000)
    writeInFlight()
    void applyUpdate()
    await advance(MUTATION_WAIT_MS - 150)
    expect(reload).not.toHaveBeenCalled()
    await advance(300)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('with no write in flight the reload does not wait at all', async () => {
    vi.useFakeTimers()
    install()
    recordNewWorkerActive()
    void applyUpdate()
    await advance(0)
    expect(reload).toHaveBeenCalledTimes(1)
  })
})

describe('useRequiredUpdate: when the screen shows, and the steps UPDATE goes through', () => {
  it('not before the status is read, not when min_version is the running version or older, and yes when it is newer (with the min_version to print)', async () => {
    world.status = FINE
    const fine = renderHook(() => useRequiredUpdate(), { wrapper })
    expect(fine.result.current).toMatchObject({ required: false, minVersion: '', state: 'ready' })
    await waitFor(() => expect(world.reads).toBe(1))
    await waitFor(() => expect(queryClient.getQueryData(['v2_appStatus'])).toBeDefined())
    expect(fine.result.current.required).toBe(false)
    fine.unmount()
    queryClient.clear()

    world.status = OLD
    const old = renderHook(() => useRequiredUpdate(), { wrapper })
    expect(old.result.current.required, 'unread: the app works as usual').toBe(false)
    await waitFor(() => expect(old.result.current.required).toBe(true))
    expect(old.result.current.minVersion).toBe('1.2.2')
  })

  it('signed out it is required too: the screen covers the sign-in page', async () => {
    world.user = null
    const { result } = renderHook(() => useRequiredUpdate(), { wrapper })
    await waitFor(() => expect(result.current.required).toBe(true))
  })

  it('offline there is no answer, so no screen (the app works as usual); back online it is required again', async () => {
    const { result } = renderHook(() => useRequiredUpdate(), { wrapper })
    await waitFor(() => expect(result.current.required).toBe(true))
    act(() => void window.dispatchEvent(new Event('offline')))
    expect(result.current.required).toBe(false)
    act(() => void window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(result.current.required).toBe(true))
  })

  it('UPDATE: ready → updating while it works → the page reloads and the screen stays on updating', async () => {
    install()
    recordNewWorkerActive()
    const { result } = renderHook(() => useRequiredUpdate(), { wrapper })
    await waitFor(() => expect(result.current.required).toBe(true))
    expect(result.current.state).toBe('ready')
    await act(async () => void (await result.current.update()))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(result.current.state, 'a page that is reloading stays on UPDATING until it is gone').toBe('updating')
  })

  it('UPDATE that fails: failed (the error line and TRY AGAIN), and TRY AGAIN runs it again, which can succeed', async () => {
    install()
    registration.update.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useRequiredUpdate(), { wrapper })
    await waitFor(() => expect(result.current.required).toBe(true))
    await act(async () => void (await result.current.update()))
    expect(result.current.state).toBe('failed')
    expect(reload).not.toHaveBeenCalled()

    recordNewWorkerActive() // the worker took over meanwhile
    await act(async () => void (await result.current.update()))
    expect(reload).toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('updating')
  })

  it('two presses at once make one attempt: the registration is asked for an update once, counted without awaiting either press', async () => {
    // The test after this one awaits its second press. Under a missing guard that press runs a second attempt, which waits on the cap and hangs on fake timers
    // (and leaves the hook of every test behind it unrendered); the count below fails by an assertion instead. It stands first so that it runs on a clean page.
    vi.useFakeTimers()
    install()
    const { result } = renderHook(() => useRequiredUpdate(), { wrapper })
    await advance(0)
    expect(result.current.required).toBe(true)
    act(() => {
      void result.current.update()
      void result.current.update()
    })
    await advance(0)
    expect(registration.update, 'one request for an update, however many presses').toHaveBeenCalledTimes(1)
    expect(result.current.state).toBe('updating')
    await advance(UPDATE_WAIT_MS)
    expect(result.current.state, 'the one attempt ended at the cap').toBe('failed')
  })

  it('a second press while it works does nothing: one attempt at a time', async () => {
    vi.useFakeTimers()
    install()
    const { result } = renderHook(() => useRequiredUpdate(), { wrapper })
    await advance(0)
    expect(result.current.required).toBe(true)
    let first!: Promise<void>
    act(() => void (first = result.current.update()))
    expect(result.current.state).toBe('updating')
    await act(async () => void (await result.current.update())) // pressed again: returns at once
    await advance(0)
    expect(registration.update, 'one request for an update').toHaveBeenCalledTimes(1)
    await advance(UPDATE_WAIT_MS)
    await first
    expect(result.current.state).toBe('failed')
  })

  it('a thrown error is a failure like any other: the screen says so instead of staying on UPDATING', async () => {
    install()
    registration.update.mockImplementation(() => {
      throw new Error('boom')
    })
    const { result } = renderHook(() => useRequiredUpdate(), { wrapper })
    await waitFor(() => expect(result.current.required).toBe(true))
    await act(async () => void (await result.current.update()))
    expect(result.current.state).toBe('failed')
  })

  it('when the version passes (min_version lowered, read again) the screen goes and the next time it shows it starts from UPDATE again', async () => {
    install()
    registration.update.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useRequiredUpdate(), { wrapper })
    await waitFor(() => expect(result.current.required).toBe(true))
    await act(async () => void (await result.current.update()))
    expect(result.current.state).toBe('failed')

    world.status = FINE
    await act(async () => void (await queryClient.invalidateQueries({ queryKey: ['v2_appStatus'] })))
    await waitFor(() => expect(result.current.required).toBe(false))
    expect(result.current.state).toBe('ready')

    world.status = OLD
    await act(async () => void (await queryClient.invalidateQueries({ queryKey: ['v2_appStatus'] })))
    await waitFor(() => expect(result.current.required).toBe(true))
    expect(result.current.state, 'no error line left from the attempt before').toBe('ready')
  })
})
