// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_SETTINGS } from './features/settings/settingsStore'
import type { UserSettings } from './types'

// Chunk 73 (SPEC.md 1.2.1, Screens → Update to continue [11]; TASKS.md chunk 73, D): App.tsx's own wiring of the update gate, on the real route table
// (<AppRoutes/>) under this test's own <MemoryRouter>, with the REAL gate and the REAL update hook on the app's own `queryClient`: the status is read by
// `useAppStatus` through a service that answers what a test sets, and what the screen, the shell and UPDATE do with the answer is what is looked at.
// Every routed page is a one-line stand-in (as in App.test.tsx). The running version is stubbed 1.2.1.
//   - min_version above the running version → the screen, over every route, navigation included, signed in or not, while the session loads or not;
//   - it comes before maintenance when both apply (an old app must update before it can wait out maintenance);
//   - no answer (unread, a read that fails) and offline → the app as usual; online again → the screen; min_version lowered → the app, where it was;
//   - UPDATE reloads (the service worker's record is a stand-in here; the branches are in useRequiredUpdate.test.tsx);
//   - App() registers the service worker ONCE, whatever is showing (the gap pre-read's 73-5); AppRoutes never does.
const world = vi.hoisted(() => ({
  user: { id: 'u-stable' } as { id: string } | null,
  loading: false,
  settings: null as unknown as UserSettings,
  status: null as unknown as { maintenance: boolean; minVersion: string; exemptUserIds: string[]; updatedAt: string },
  read: 'answers' as 'answers' | 'fails' | 'never',
  reads: 0,
  queued: 0,
  registrations: 0,
  record: { registration: undefined, newWorkerActive: false } as { registration: unknown; newWorkerActive: boolean },
}))
vi.stubGlobal('__APP_VERSION__', '1.2.1')

vi.mock('./features/auth/useAuth', () => ({
  useAuth: () => ({ user: world.user, loading: world.loading, signOut: vi.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('./features/settings/useSettings', () => ({ useSettings: () => ({ data: world.settings }) }))
vi.mock('./features/offline/useSyncQueue', () => ({ useSyncQueueInit: () => {}, useSyncQueueRunner: () => {} }))
vi.mock('./features/library/useExercises', () => ({ useSeedDefaultExercisesIfEmpty: () => {} }))
vi.mock('./features/release/appStatusService', () => ({
  fetchAppStatus: async () => {
    world.reads += 1
    if (world.read === 'fails') throw new Error('Failed to fetch')
    if (world.read === 'never') return new Promise(() => {})
    return { ...world.status }
  },
}))
vi.mock('./features/release/useQueuedWriteCount', () => ({ useQueuedWriteCount: () => world.queued }))
vi.mock('./features/pwa/useServiceWorker', () => ({
  useServiceWorker: () => void (world.registrations += 1),
  serviceWorkerRecord: () => world.record,
}))
vi.mock('./features/auth/LoginPage', () => ({ default: () => <div>LOGIN PAGE</div> }))
vi.mock('./features/gym/TodayPage', () => ({ default: () => <div>TODAY PAGE</div> }))
vi.mock('./features/plan/PlanPage', () => ({ default: () => <div>PLAN PAGE</div> }))
vi.mock('./features/plan/PrioritiesEditor', () => ({ default: () => <div>PRIORITIES EDITOR</div> }))
vi.mock('./features/progress/ProgressPage', () => ({ default: () => <div>PROGRESS PAGE</div> }))
vi.mock('./features/history/HistoryPage', () => ({ default: () => <div>HISTORY PAGE</div> }))
vi.mock('./features/history/ExerciseHistoryPage', () => ({ default: () => <div>EXERCISE HISTORY</div> }))
vi.mock('./features/history/SessionTypeHistoryPage', () => ({ default: () => <div>SESSION TYPE HISTORY</div> }))
vi.mock('./features/planner/PlannerPage', () => ({ default: () => <div>PLANNER PAGE</div> }))
vi.mock('./features/programs/ChangeProgramPage', () => ({ default: () => <div>CHANGE PROGRAM</div> }))
vi.mock('./features/programs/FinishedProgramPage', () => ({ default: () => <div>FINISHED PROGRAM</div> }))
vi.mock('./features/programs/FinishedProgramPriorities', () => ({ default: () => <div>FINISHED PROGRAM PRIORITIES</div> }))
vi.mock('./features/coach/MesoPrioritiesPage', () => ({ default: () => <div>MESO PRIORITIES</div> }))
vi.mock('./features/library/LibraryPage', () => ({ default: () => <div>LIBRARY PAGE</div> }))
vi.mock('./features/settings/SettingsPage', () => ({ default: () => <div>SETTINGS PAGE</div> }))
vi.mock('./features/settings/ReleaseNotesPage', () => ({ default: () => <div>RELEASE NOTES PAGE</div> }))
vi.mock('./features/settings/AfterUpdateSheet', () => ({ default: () => null }))
vi.mock('./features/coach/CoachPage', () => ({ default: () => <div>COACH PAGE</div> }))
vi.mock('./components/Nav', () => ({ default: () => <div>NAV</div> }))

const { default: App, AppRoutes } = await import('./App')
const { queryClient } = await import('./lib/queryClient')
const { APP_STATUS_KEY } = await import('./lib/maintenanceRefusal')

const REQUIRED = { maintenance: false, minVersion: '1.2.2', exemptUserIds: [] as string[], updatedAt: 'now' } // the running version is 1.2.1
const FINE = { ...REQUIRED, minVersion: '1.2.1' }
const SCREEN_TITLE = 'UPDATE TO CONTINUE'
const SENTENCE = 'This is 1.2.1. Overload needs 1.2.2 or newer.'
const UNSENT = 'Unsent changes are kept and sent after the update.'
const ERROR = "Couldn't update. Check your connection and try again."

// A new element each time: the auth hook is a stand-in that reads the test's state, which React does not see change.
const tree = (path = '/today') => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>
  </QueryClientProvider>
)
const mount = (path = '/today') => render(tree(path))
const appIsShown = () => screen.queryByText('NAV') !== null
const reread = () =>
  act(async () => {
    await queryClient.invalidateQueries({ queryKey: APP_STATUS_KEY })
  })

let reload: ReturnType<typeof vi.fn>
beforeEach(() => {
  world.user = { id: 'u-stable' }
  world.loading = false
  world.settings = { ...DEFAULT_SETTINGS }
  world.status = { ...REQUIRED }
  world.read = 'answers'
  world.reads = 0
  world.queued = 0
  world.registrations = 0
  world.record = { registration: undefined, newWorkerActive: false }
  reload = vi.fn()
  vi.stubGlobal('location', { ...window.location, reload })
  queryClient.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('--accent')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.stubGlobal('__APP_VERSION__', '1.2.1')
  vi.restoreAllMocks()
  onlineManager.setOnline(true)
  queryClient.clear()
})

describe('min_version above the running version: the update screen replaces the whole app', () => {
  it('a signed-in account: UPDATE / UPDATE TO CONTINUE / the sentence with both versions, and none of the app (no page, no navigation)', async () => {
    mount()
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(SCREEN_TITLE)
    expect(screen.getByText(SENTENCE)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'UPDATE' })).toBeTruthy()
    expect(screen.queryByText('NAV')).toBeNull()
    expect(screen.queryByText('TODAY PAGE')).toBeNull()
    expect(screen.queryByText(UNSENT)).toBeNull()
  })

  it('over every route, not only Today', async () => {
    for (const path of ['/plan', '/history', '/library', '/settings', '/program/p1', '/coach', '/settings/whats-new/1.2']) {
      const view = mount(path)
      expect(await screen.findByText(SCREEN_TITLE), path).toBeTruthy()
      expect(appIsShown(), path).toBe(false)
      view.unmount()
      queryClient.clear()
    }
  })

  it('whatever the account: an exempt one is gated too (min_version is for every account)', async () => {
    world.user = { id: 'u-adam' }
    world.status = { ...REQUIRED, maintenance: true, exemptUserIds: ['u-adam'] }
    mount()
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    expect(screen.queryByText('MAINTENANCE ON · ONLY YOUR ACCOUNT CAN USE THE APP')).toBeNull()
    expect(appIsShown()).toBe(false)
  })

  it('signed out: the screen covers the sign-in page, with no way round it (no SIGN IN action, unlike maintenance)', async () => {
    world.user = null
    mount()
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
    expect(screen.queryByRole('button', { name: 'SIGN IN' })).toBeNull()
  })

  it('while the session is still loading: the screen is already there, not the spinner (an old app must not wait for a sign-in to be old)', async () => {
    world.loading = true
    world.user = null
    const { container } = mount()
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    expect(container.querySelector('.animate-spin')).toBeNull()
  })

  it('the theme and the accent are the user\'s own on the screen too', async () => {
    world.settings = { ...DEFAULT_SETTINGS, theme: 'light', accentColour: '#112233' }
    mount()
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#112233')
  })
})

describe('the update screen comes before maintenance', () => {
  it('both rules true: the update screen shows, not BACK SOON; when min_version is read back down the maintenance screen takes over; then the app', async () => {
    world.status = { ...REQUIRED, maintenance: true }
    mount()
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    expect(screen.queryByText('BACK SOON')).toBeNull()

    world.status = { ...FINE, maintenance: true }
    await reread()
    expect(await screen.findByText('BACK SOON')).toBeTruthy()
    expect(screen.queryByText(SCREEN_TITLE)).toBeNull()

    world.status = { ...FINE, maintenance: false }
    await reread()
    expect(await screen.findByText('NAV')).toBeTruthy()
    expect(screen.queryByText('BACK SOON')).toBeNull()
  })

  it('signed out with both: the update screen (nothing to sign in to yet)', async () => {
    world.user = null
    world.status = { ...REQUIRED, maintenance: true }
    mount()
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    expect(screen.queryByText('BACK SOON')).toBeNull()
  })
})

describe('when it does not show', () => {
  it('a table over the answer: min_version older than, equal to, or newer than the running version; unread; a read that fails', async () => {
    const rows: Array<{ name: string; read: 'answers' | 'fails' | 'never'; minVersion: string; shows: 'screen' | 'app' }> = [
      { name: 'older', read: 'answers', minVersion: '1.1.0', shows: 'app' },
      { name: 'equal', read: 'answers', minVersion: '1.2.1', shows: 'app' },
      { name: 'missing parts: 1.2 is older than 1.2.1', read: 'answers', minVersion: '1.2', shows: 'app' },
      { name: 'newer', read: 'answers', minVersion: '1.2.2', shows: 'screen' },
      { name: 'a newer minor', read: 'answers', minVersion: '1.10.0', shows: 'screen' },
      { name: 'not read yet', read: 'never', minVersion: '9.9.9', shows: 'app' },
      { name: 'a read that fails', read: 'fails', minVersion: '9.9.9', shows: 'app' },
    ]
    for (const row of rows) {
      world.read = row.read
      world.status = { ...REQUIRED, minVersion: row.minVersion }
      const view = mount()
      await waitFor(() => expect(world.reads, row.name).toBeGreaterThanOrEqual(1))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(screen.queryByText(SCREEN_TITLE) !== null, `${row.name}: the screen`).toBe(row.shows === 'screen')
      expect(appIsShown(), `${row.name}: the app`).toBe(row.shows === 'app')
      view.unmount()
      queryClient.clear()
    }
  })

  it('offline the app cannot read min_version and works as usual: a screen shown online goes, and online again it is gated', async () => {
    mount('/library')
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    act(() => void window.dispatchEvent(new Event('offline')))
    expect(screen.queryByText(SCREEN_TITLE), 'the data read online is not an answer while offline').toBeNull()
    expect(screen.getByText('LIBRARY PAGE')).toBeTruthy()
    expect(screen.getByText('NAV')).toBeTruthy()
    act(() => void window.dispatchEvent(new Event('online')))
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    expect(appIsShown()).toBe(false)
  })

  it('min_version lowered (or the app updated elsewhere): the next read shows the app again where it was, by itself', async () => {
    mount('/library')
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    world.status = { ...FINE }
    await reread()
    expect(await screen.findByText('LIBRARY PAGE')).toBeTruthy()
    expect(screen.getByText('NAV')).toBeTruthy()
    expect(screen.queryByText(SCREEN_TITLE)).toBeNull()
  })
})

describe('Unsent changes', () => {
  it('the queue holds writes (3): "Unsent changes are kept and sent after the update."; nothing waiting: no line', async () => {
    world.queued = 3
    const view = mount()
    expect(await screen.findByText(UNSENT)).toBeTruthy()
    view.unmount()
    world.queued = 0
    mount()
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    expect(screen.queryByText(UNSENT)).toBeNull()
  })
})

describe('UPDATE', () => {
  it('a newer worker is already running: one press reloads the page once, and the screen stays on UPDATING… (a page that is going away does not flicker back)', async () => {
    world.record = { registration: undefined, newWorkerActive: true }
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'UPDATE' }))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    const button = screen.getByRole('button') as HTMLButtonElement
    expect(button.textContent).toBe('UPDATING…')
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(reload, 'a second press does nothing').toHaveBeenCalledTimes(1)
  })

  it('it fails (the update check is refused): the error line and TRY AGAIN; the next press, with the worker now running, reloads', async () => {
    world.record = { registration: { installing: null, waiting: null, addEventListener() {}, removeEventListener() {}, update: () => Promise.reject(new TypeError('Failed to fetch')) }, newWorkerActive: false }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: new EventTarget() })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'UPDATE' }))
    expect((await screen.findByRole('alert')).textContent).toBe(ERROR)
    expect(screen.getByRole('button', { name: 'TRY AGAIN' })).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()

    world.record = { ...world.record, newWorkerActive: true }
    fireEvent.click(screen.getByRole('button', { name: 'TRY AGAIN' }))
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    Reflect.deleteProperty(navigator, 'serviceWorker')
  })
})

describe('App() registers the service worker once, whatever is showing (73-5); AppRoutes never does', () => {
  const scenarios: Array<{ name: string; arrange: () => void }> = [
    { name: 'signed out, nothing gating', arrange: () => void ((world.user = null), (world.status = { ...FINE })) },
    { name: 'signed in, nothing gating', arrange: () => void (world.status = { ...FINE }) },
    { name: 'the update screen showing', arrange: () => void (world.status = { ...REQUIRED }) },
    { name: 'the maintenance screen showing', arrange: () => void (world.status = { ...FINE, maintenance: true }) },
    { name: 'the session still loading', arrange: () => void ((world.loading = true), (world.user = null), (world.status = { ...FINE })) },
  ]
  for (const scenario of scenarios) {
    it(`${scenario.name}: the hook was called once by App(), and the page it drew has no say in it`, async () => {
      scenario.arrange()
      render(<App />)
      await waitFor(() => expect(world.reads).toBeGreaterThanOrEqual(1))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(world.registrations).toBe(1)
    })
  }

  it('the routes alone do not register it (App() does, above them)', async () => {
    mount()
    await waitFor(() => expect(world.reads).toBeGreaterThanOrEqual(1))
    expect(world.registrations).toBe(0)
  })

  it('and a gate that comes and goes under App() does not register it again', async () => {
    world.status = { ...REQUIRED }
    render(<App />)
    expect(await screen.findByText(SCREEN_TITLE)).toBeTruthy()
    world.status = { ...FINE }
    await reread()
    expect(await screen.findByText('NAV')).toBeTruthy()
    expect(world.registrations).toBe(1)
  })
})
