// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_SETTINGS } from './features/settings/settingsStore'
import type { UserSettings } from './types'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]; TASKS.md chunk 72, D): App.tsx's own wiring of the release state, on the real route table
// (<AppRoutes/>) under this test's own <MemoryRouter>, with the REAL gate on the app's own `queryClient`: the status is read by `useAppStatus` through
// a service that answers what a test sets, and what the screen, the strip and the app do with the answer is what is looked at. Every routed page is
// a one-line stand-in (as in App.test.tsx), and so is the queue's runner (proven on its own in useSyncQueue.maintenance.test.tsx).
//   - maintenance on, this account not exempt → the screen and no navigation; exempt → the strip over the normal app; no answer (unread, a failed
//     read, offline) → the normal app; signed out → the screen, with a way to the sign-in page (DECISIONS 270);
//   - offline the app works as usual and a screen shown online does not stay up (the pre-read's 72-2), and it reads again once the phone is back;
//   - the app reopens where it was when maintenance is off; the theme and accent are those of the user's settings on the screen too (72-6).
const world = vi.hoisted(() => ({
  user: { id: 'u-stable' } as { id: string } | null,
  loading: false,
  settings: null as unknown as UserSettings,
  status: { maintenance: true, minVersion: '1.2.1', exemptUserIds: [] as string[], updatedAt: 'now' },
  read: 'answers' as 'answers' | 'fails' | 'never',
  reads: 0,
  queued: 0,
}))

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

// A sign-in page with state of its own, as the real one has (the email and password being typed): a page that is drawn again loses it.
vi.mock('./features/auth/LoginPage', async () => {
  const { useState } = await import('react')
  return {
    default: function LoginStandIn() {
      const [email, setEmail] = useState('')
      return (
        <div>
          LOGIN PAGE
          <input aria-label="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </div>
      )
    },
  }
})
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
vi.mock('./features/pwa/useServiceWorker', () => ({ useServiceWorker: () => {}, serviceWorkerRecord: () => ({ registration: undefined, newWorkerActive: false }) }))
vi.stubGlobal('__APP_VERSION__', '1.2.1')

const { AppRoutes } = await import('./App')
const { queryClient } = await import('./lib/queryClient')
const { APP_STATUS_KEY } = await import('./lib/maintenanceRefusal')

const STRIP = 'MAINTENANCE ON · ONLY YOUR ACCOUNT CAN USE THE APP'
const QUEUED_LINE = 'Changes you made offline are kept and sent then.'
const SCREEN = 'BACK SOON'

// A new element each time: a test that changes who is signed in re-renders with it (the auth hook is a stand-in that reads the test's state, which
// React does not see change: an element identical to the last one is not drawn again).
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

beforeEach(() => {
  world.user = { id: 'u-stable' }
  world.loading = false
  world.settings = { ...DEFAULT_SETTINGS }
  world.status = { maintenance: true, minVersion: '1.2.1', exemptUserIds: ['u-adam'], updatedAt: 'now' }
  world.read = 'answers'
  world.reads = 0
  world.queued = 0
  queryClient.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.removeProperty('--accent')
})
afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  queryClient.clear()
})

describe('maintenance on: every account but the exempt ones gets the screen, navigation included', () => {
  it('a signed-in account that is not exempt: MAINTENANCE / BACK SOON, and none of the app (no page, no navigation, no strip, no sign-in action)', async () => {
    mount()
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    expect(screen.getByText('MAINTENANCE')).toBeTruthy()
    expect(screen.getByText("Overload is being updated. It opens again by itself when that's done.")).toBeTruthy()
    expect(screen.queryByText('NAV')).toBeNull()
    expect(screen.queryByText('TODAY PAGE')).toBeNull()
    expect(screen.queryByText(STRIP)).toBeNull()
    expect(screen.queryByRole('button', { name: 'SIGN IN' })).toBeNull()
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
  })

  it('over every route, not only Today', async () => {
    for (const path of ['/plan', '/history', '/library', '/settings', '/program/p1', '/coach', '/settings/whats-new/1.2']) {
      const view = mount(path)
      expect(await screen.findByText(SCREEN), path).toBeTruthy()
      expect(appIsShown(), path).toBe(false)
      view.unmount()
      queryClient.clear()
    }
  })

  it('an exempt account: the app as usual, with the strip on top of it, in the shell\'s own column above the screen', async () => {
    world.user = { id: 'u-adam' }
    mount()
    expect(await screen.findByText(STRIP)).toBeTruthy()
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
    expect(screen.getByText('NAV')).toBeTruthy()
    expect(screen.queryByText(SCREEN)).toBeNull()
    const strip = screen.getByText(STRIP).closest('[role="status"]')!
    const main = screen.getByText('TODAY PAGE').closest('main')!
    expect(strip.nextElementSibling === main || strip.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(strip.parentElement).toBe(main.parentElement) // one column: the strip takes its height from the screen, it does not cover it
  })

  it('a table over the answer: off, on for a non-exempt account, on for an exempt one, and no answer (unread, or a read that fails)', async () => {
    const rows: Array<{ name: string; read: 'answers' | 'fails' | 'never'; maintenance: boolean; user: string; shows: 'screen' | 'strip' | 'app' }> = [
      { name: 'off', read: 'answers', maintenance: false, user: 'u-stable', shows: 'app' },
      { name: 'on, not exempt', read: 'answers', maintenance: true, user: 'u-stable', shows: 'screen' },
      { name: 'on, exempt', read: 'answers', maintenance: true, user: 'u-adam', shows: 'strip' },
      { name: 'not read yet', read: 'never', maintenance: true, user: 'u-stable', shows: 'app' },
      { name: 'a read that fails', read: 'fails', maintenance: true, user: 'u-stable', shows: 'app' },
    ]
    for (const row of rows) {
      world.read = row.read
      world.status = { ...world.status, maintenance: row.maintenance }
      world.user = { id: row.user }
      const view = mount()
      await waitFor(() => expect(world.reads, row.name).toBeGreaterThanOrEqual(1))
      await new Promise((resolve) => setTimeout(resolve, 30))
      expect(screen.queryByText(SCREEN) !== null, `${row.name}: the screen`).toBe(row.shows === 'screen')
      expect(screen.queryByText(STRIP) !== null, `${row.name}: the strip`).toBe(row.shows === 'strip')
      expect(appIsShown(), `${row.name}: the app`).toBe(row.shows !== 'screen')
      view.unmount()
      queryClient.clear()
    }
  })

  it('while the session is still loading there is neither the screen nor the app: an exempt account does not see the screen flash', async () => {
    world.loading = true
    world.user = null
    mount()
    await waitFor(() => expect(world.reads).toBeGreaterThanOrEqual(1))
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(screen.queryByText(SCREEN)).toBeNull()
    expect(appIsShown()).toBe(false)
  })
})

describe('the extra line: unsent offline changes', () => {
  it('the queue holds writes (3): "Changes you made offline are kept and sent then."; nothing waiting: no line', async () => {
    world.queued = 3
    const view = mount()
    expect(await screen.findByText(QUEUED_LINE)).toBeTruthy()
    view.unmount()
    world.queued = 0
    mount()
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    expect(screen.queryByText(QUEUED_LINE)).toBeNull()
  })

  it('an exempt account has no screen to add it to, and the strip carries no such line', async () => {
    world.user = { id: 'u-adam' }
    world.queued = 3
    mount()
    expect(await screen.findByText(STRIP)).toBeTruthy()
    expect(screen.queryByText(QUEUED_LINE)).toBeNull()
  })
})

describe('offline the app cannot read the flag and works as usual (the pre-read\'s 72-2)', () => {
  it('a screen shown online goes when the phone goes offline (the app, as usual), and comes back by the read made once it is online again', async () => {
    mount('/library')
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    expect(world.reads).toBe(1)

    act(() => void window.dispatchEvent(new Event('offline')))
    expect(screen.queryByText(SCREEN), 'the data read online is not an answer while offline').toBeNull()
    expect(screen.getByText('LIBRARY PAGE')).toBeTruthy()
    expect(screen.getByText('NAV')).toBeTruthy()
    expect(world.reads, 'nothing is read offline').toBe(1)

    act(() => void window.dispatchEvent(new Event('online')))
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    await waitFor(() => expect(world.reads).toBe(2)) // and it was read again
    expect(appIsShown()).toBe(false)
  })

  it('maintenance that ended while the phone was offline: online again, the app is simply there', async () => {
    mount('/library')
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    act(() => void window.dispatchEvent(new Event('offline')))
    world.status = { ...world.status, maintenance: false }
    act(() => void window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(world.reads).toBe(2))
    expect(screen.queryByText(SCREEN)).toBeNull()
    expect(screen.getByText('LIBRARY PAGE')).toBeTruthy()
  })

  // Chunk 72's review, D: a read that fails online after one that answered keeps the answer (TanStack holds the data of the last good read), so the
  // screen stays up; the comment in useAppStatus.ts said it left none. Only a read that answers differently changes what the person sees.
  it('a read that fails after one that answered changes nothing: the screen stays up, until a read that answers says otherwise', async () => {
    const defaults = queryClient.getDefaultOptions()
    queryClient.setDefaultOptions({ queries: { retry: false } }) // the failure is the point, not the retry after it
    try {
      mount('/library')
      expect(await screen.findByText(SCREEN)).toBeTruthy()
      world.read = 'fails'
      await reread()
      await waitFor(() => expect(queryClient.getQueryState(APP_STATUS_KEY)?.status).toBe('error'))
      expect(world.reads).toBe(2)
      expect(screen.getByText(SCREEN), 'the failed read did not erase the screen').toBeTruthy()
      expect(appIsShown()).toBe(false)

      world.read = 'answers'
      world.status = { ...world.status, maintenance: false }
      await reread()
      await waitFor(() => expect(screen.queryByText(SCREEN)).toBeNull())
      expect(screen.getByText('LIBRARY PAGE')).toBeTruthy()
    } finally {
      queryClient.setDefaultOptions(defaults)
    }
  })
})

describe('the app opens again by itself, where it was', () => {
  it('maintenance read as off: the screen goes and the screen the phone was on is there, at the same address', async () => {
    mount('/library')
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    world.status = { ...world.status, maintenance: false }
    await reread()
    await waitFor(() => expect(screen.queryByText(SCREEN)).toBeNull())
    expect(screen.getByText('LIBRARY PAGE')).toBeTruthy()
    expect(screen.getByText('NAV')).toBeTruthy()
  })

  it('and an exempt account\'s strip goes when maintenance does', async () => {
    world.user = { id: 'u-adam' }
    mount()
    expect(await screen.findByText(STRIP)).toBeTruthy()
    world.status = { ...world.status, maintenance: false }
    await reread()
    await waitFor(() => expect(screen.queryByText(STRIP)).toBeNull())
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
  })
})

describe('signed out: the same screen (there is no account to exempt), and signing in still works (DECISIONS 255, 270)', () => {
  beforeEach(() => {
    world.user = null
  })

  it('maintenance on: the screen over the sign-in page, with a small SIGN IN action', async () => {
    mount()
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
    expect(screen.getByRole('button', { name: 'SIGN IN' })).toBeTruthy()
    expect(appIsShown()).toBe(false)
  })

  it('SIGN IN opens the sign-in page, and nothing else changes', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'SIGN IN' }))
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    expect(screen.queryByText(SCREEN)).toBeNull()
  })

  it('maintenance off: the sign-in page as before, and no screen', async () => {
    world.status = { ...world.status, maintenance: false }
    mount()
    expect(await screen.findByText('LOGIN PAGE')).toBeTruthy()
    expect(screen.queryByText(SCREEN)).toBeNull()
  })

  it('no answer (offline, or a read that fails): the sign-in page as before', async () => {
    world.read = 'fails'
    mount()
    await waitFor(() => expect(world.reads).toBeGreaterThanOrEqual(1))
    expect(await screen.findByText('LOGIN PAGE')).toBeTruthy()
    expect(screen.queryByText(SCREEN)).toBeNull()
  })

  it('an exempt account signs in and gets the strip over the app; one that is not gets the screen, without the sign-in action', async () => {
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'SIGN IN' }))
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()

    world.user = { id: 'u-adam' } // the sign-in page signs in (an auth write; the maintenance check never touches it)
    view.rerender(tree())
    expect(await screen.findByText(STRIP)).toBeTruthy()
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
    cleanup()

    world.user = null
    const second = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'SIGN IN' }))
    world.user = { id: 'u-stable' }
    second.rerender(tree())
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'SIGN IN' })).toBeNull()
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
  })

  it('maintenance ending while someone is typing on the sign-in page does not start the page again: what was typed stays', async () => {
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'SIGN IN' }))
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'adam@example.test' } })
    expect((screen.getByLabelText('email') as HTMLInputElement).value).toBe('adam@example.test')

    world.status = { ...world.status, maintenance: false }
    await reread()
    await waitFor(() => expect(world.reads).toBeGreaterThanOrEqual(2))
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    expect((screen.getByLabelText('email') as HTMLInputElement).value, 'the same page, not a new one').toBe('adam@example.test')
    view.unmount()
  })

  it('a visitor who signed in, was shown the screen and signed out again starts from the screen, not from the sign-in page', async () => {
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'SIGN IN' }))
    world.user = { id: 'u-stable' }
    view.rerender(tree())
    expect(await screen.findByText(SCREEN)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'SIGN IN' })).toBeNull()
    world.user = null
    view.rerender(tree())
    expect(await screen.findByRole('button', { name: 'SIGN IN' })).toBeTruthy()
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
  })
})

describe('the theme and the accent are the user\'s on the screen too, not the defaults (the pre-read\'s 72-6)', () => {
  // The cold start: the answer is already in hand when the app first draws (a read that finished before the session did), so the very first thing
  // drawn is the screen. A theme applied only in the shell below the gate would never be applied at all.
  it('a signed-in account in the light theme with a blue accent: the screen is drawn under data-theme light and that accent, as the app is', () => {
    world.settings = { ...DEFAULT_SETTINGS, theme: 'light', accentColour: '#3B82F6' }
    queryClient.setQueryData(APP_STATUS_KEY, { ...world.status })
    mount()
    expect(screen.getByText(SCREEN), 'the first thing drawn is the screen').toBeTruthy()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#3B82F6')
  })

  it('the exempt account\'s strip is drawn in the accent it chose, too', () => {
    world.user = { id: 'u-adam' }
    world.settings = { ...DEFAULT_SETTINGS, theme: 'light', accentColour: '#22C55E' }
    queryClient.setQueryData(APP_STATUS_KEY, { ...world.status })
    mount()
    expect(screen.getByText(STRIP)).toBeTruthy()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#22C55E')
  })

  it('signed out the screen is in the defaults (there are no settings before sign-in), as the sign-in page is', () => {
    world.user = null
    queryClient.setQueryData(APP_STATUS_KEY, { ...world.status })
    mount()
    expect(screen.getByText(SCREEN)).toBeTruthy()
    expect(document.documentElement.getAttribute('data-theme')).toBe(DEFAULT_SETTINGS.theme)
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe(DEFAULT_SETTINGS.accentColour)
  })
})
