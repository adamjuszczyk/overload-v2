// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

// Chunk 73 (SPEC.md 1.2.1, Screens → Update to continue [11]: "It replaces the RELOAD banner (PwaUpdateNotice), which is removed. The new code still
// installs in the background as today."; the gap pre-read's 73-5 and 73-7). `useServiceWorker` is usePwaUpdate.ts without the banner: the registration,
// its fallback, the hourly check and the foreground check stay, `onNeedReload` only records that a newer worker is running, and nothing is drawn or
// reloaded. `virtual:pwa-register/react` exists only under vite.config.ts's plugin pipeline, so the file that imports it (pwaRegister.ts) is stood in
// for here, and the options the hook gives it are what a test drives, as workbox-window would.
interface Options {
  onNeedReload?: () => void
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void
  onRegisterError?: (error: unknown) => void
}
const library = vi.hoisted(() => ({ options: null as null | Options, calls: 0 }))
vi.mock('./pwaRegister', () => ({
  useRegisterSW: (options: Options) => {
    library.calls += 1
    library.options = options
    return { needRefresh: [false, () => {}], offlineReady: [false, () => {}], updateServiceWorker: async () => {} }
  },
}))

const { useServiceWorker, serviceWorkerRecord, resetServiceWorkerRecord } = await import('./useServiceWorker')

const HOUR = 60 * 60 * 1000

function fakeRegistration() {
  return { update: vi.fn(() => Promise.resolve()) } as unknown as ServiceWorkerRegistration & { update: ReturnType<typeof vi.fn> }
}
function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

let reload: ReturnType<typeof vi.fn>
beforeEach(() => {
  library.options = null
  library.calls = 0
  resetServiceWorkerRecord()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('the registration', () => {
  it('registers the worker when the hook mounts, once, with no screen and nothing to draw', () => {
    const { result } = renderHook(() => useServiceWorker())
    expect(library.calls).toBe(1)
    expect(result.current).toBeUndefined()
  })

  it('the registration workbox reports is recorded for UPDATE; until then there is none', () => {
    renderHook(() => useServiceWorker())
    expect(serviceWorkerRecord().registration).toBeUndefined()
    const registration = fakeRegistration()
    act(() => library.options!.onRegisteredSW!('/sw.js', registration))
    expect(serviceWorkerRecord().registration).toBe(registration)
  })

  it('a worker newer than the page\'s code is recorded when it has activated, and nothing reloads', () => {
    renderHook(() => useServiceWorker())
    expect(serviceWorkerRecord().newWorkerActive).toBe(false)
    act(() => library.options!.onNeedReload!())
    expect(serviceWorkerRecord().newWorkerActive).toBe(true)
    expect(reload, 'the library\'s own default would reload; this callback replaces it').not.toHaveBeenCalled()
  })
})

describe('the hourly check and the foreground check (as the banner\'s hook ran them)', () => {
  it('registration.update() runs every hour, not before, errors swallowed', async () => {
    vi.useFakeTimers()
    renderHook(() => useServiceWorker())
    const registration = fakeRegistration()
    registration.update.mockRejectedValue(new Error('offline'))
    act(() => library.options!.onRegisteredSW!('/sw.js', registration))
    await advance(HOUR - 1)
    expect(registration.update).not.toHaveBeenCalled()
    await advance(1)
    expect(registration.update).toHaveBeenCalledTimes(1)
    await advance(HOUR)
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('every return to the foreground checks once, going to the background checks nothing', () => {
    renderHook(() => useServiceWorker())
    const registration = fakeRegistration()
    act(() => library.options!.onRegisteredSW!('/sw.js', registration))
    act(() => setVisibility('hidden'))
    expect(registration.update).not.toHaveBeenCalled()
    act(() => setVisibility('visible'))
    expect(registration.update).toHaveBeenCalledTimes(1)
    act(() => setVisibility('visible'))
    expect(registration.update).toHaveBeenCalledTimes(2)
  })

  it('no check before there is a registration to ask', async () => {
    vi.useFakeTimers()
    renderHook(() => useServiceWorker())
    act(() => setVisibility('visible'))
    await advance(HOUR * 2)
    expect(serviceWorkerRecord().registration).toBeUndefined()
  })

  it('nothing is checked once the app unmounts', async () => {
    vi.useFakeTimers()
    const view = renderHook(() => useServiceWorker())
    const registration = fakeRegistration()
    act(() => library.options!.onRegisteredSW!('/sw.js', registration))
    view.unmount()
    await advance(HOUR * 2)
    act(() => setVisibility('visible'))
    expect(registration.update).not.toHaveBeenCalled()
  })
})

describe('the fallback registration (workbox-window could not load)', () => {
  function withServiceWorker(register: ReturnType<typeof vi.fn>) {
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } })
  }

  it('registers the worker plainly at /sw.js with scope /, once, and records that registration for UPDATE; the error is logged', async () => {
    const fallback = fakeRegistration()
    const register = vi.fn(() => Promise.resolve(fallback))
    withServiceWorker(register)
    renderHook(() => useServiceWorker())
    await act(async () => library.options!.onRegisterError!(new Error('chunk blocked')))
    expect(register).toHaveBeenCalledTimes(1)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    expect(serviceWorkerRecord().registration).toBe(fallback)
    expect(console.error).toHaveBeenCalled()
  })

  it('as before, the fallback gets no hourly check of its own', async () => {
    vi.useFakeTimers()
    const fallback = fakeRegistration()
    withServiceWorker(vi.fn(() => Promise.resolve(fallback)))
    renderHook(() => useServiceWorker())
    await act(async () => library.options!.onRegisterError!(new Error('chunk blocked')))
    await advance(HOUR * 2)
    act(() => setVisibility('visible'))
    expect(fallback.update).not.toHaveBeenCalled()
  })

  it('a fallback that also fails is logged and goes no further', async () => {
    const register = vi.fn(() => Promise.reject(new Error('no')))
    withServiceWorker(register)
    renderHook(() => useServiceWorker())
    await act(async () => library.options!.onRegisterError!(new Error('chunk blocked')))
    expect(serviceWorkerRecord().registration).toBeUndefined()
    expect(console.error).toHaveBeenCalledTimes(2)
  })

  it('a browser with no service worker at all has nothing to fall back to, and nothing throws', async () => {
    renderHook(() => useServiceWorker())
    await act(async () => library.options!.onRegisterError!(new Error('chunk blocked')))
    expect(serviceWorkerRecord().registration).toBeUndefined()
  })
})
