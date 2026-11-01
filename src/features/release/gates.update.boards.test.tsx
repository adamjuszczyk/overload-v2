// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_SETTINGS } from '../settings/settingsStore'
import { captureRender } from '../../testing/captureRender'

// The prototype's "Update to continue" states (SPEC.md 1.2.1, Screens → Update to continue [11]; TASKS.md chunk 73): Ready, Unsent changes, Updating,
// Couldn't update, drawn by the REAL app shell (`AppRoutes`) with the REAL gate, the REAL update hook and the REAL screen, as the prototype's DEMO
// states are: the running version 1.2.0 against a database that wants 1.2.1 ("This is 1.2.0. Overload needs 1.2.1 or newer."). UPDATING… and the
// error line are reached the way a person reaches them, by pressing UPDATE against a service worker registration that never answers, and against one
// whose update check is refused. Captured for design/1.2.1/built with CAPTURE_RENDER=1 (written after the assertions, so a failing rule leaves the
// committed fixture alone). The shell is the app's own column (`h-dvh`), so each capture is as tall as a phone screen.
const world = vi.hoisted(() => ({
  queued: 0,
  registration: undefined as unknown,
}))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u-stable' }, loading: false, signOut: vi.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('../settings/useSettings', () => ({
  useSettings: () => ({ data: DEFAULT_SETTINGS }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
  useUpdateDeloadRules: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ useSyncQueueInit: () => {}, useSyncQueueRunner: () => {} }))
vi.mock('../library/useExercises', () => ({ useSeedDefaultExercisesIfEmpty: () => {} }))
vi.mock('./appStatusService', () => ({
  fetchAppStatus: async () => ({ maintenance: false, minVersion: '1.2.1', exemptUserIds: [], updatedAt: 'now' }),
}))
vi.mock('./useQueuedWriteCount', () => ({ useQueuedWriteCount: () => world.queued }))
vi.mock('../pwa/useServiceWorker', () => ({
  useServiceWorker: () => {},
  serviceWorkerRecord: () => ({ registration: world.registration, newWorkerActive: false }),
}))
vi.mock('../auth/LoginPage', () => ({ default: () => <div>LOGIN PAGE</div> }))
vi.mock('../gym/TodayPage', () => ({ default: () => <div>TODAY PAGE</div> }))
vi.mock('../plan/PlanPage', () => ({ default: () => <div>PLAN PAGE</div> }))
vi.mock('../plan/PrioritiesEditor', () => ({ default: () => <div>PRIORITIES EDITOR</div> }))
vi.mock('../progress/ProgressPage', () => ({ default: () => <div>PROGRESS PAGE</div> }))
vi.mock('../history/HistoryPage', () => ({ default: () => <div>HISTORY PAGE</div> }))
vi.mock('../history/ExerciseHistoryPage', () => ({ default: () => <div>EXERCISE HISTORY</div> }))
vi.mock('../history/SessionTypeHistoryPage', () => ({ default: () => <div>SESSION TYPE HISTORY</div> }))
vi.mock('../planner/PlannerPage', () => ({ default: () => <div>PLANNER PAGE</div> }))
vi.mock('../programs/ChangeProgramPage', () => ({ default: () => <div>CHANGE PROGRAM</div> }))
vi.mock('../programs/FinishedProgramPage', () => ({ default: () => <div>FINISHED PROGRAM</div> }))
vi.mock('../programs/FinishedProgramPriorities', () => ({ default: () => <div>FINISHED PROGRAM PRIORITIES</div> }))
vi.mock('../coach/MesoPrioritiesPage', () => ({ default: () => <div>MESO PRIORITIES</div> }))
vi.mock('../library/LibraryPage', () => ({ default: () => <div>LIBRARY PAGE</div> }))
vi.mock('../coach/CoachPage', () => ({ default: () => <div>COACH PAGE</div> }))
vi.mock('../settings/AfterUpdateSheet', () => ({ default: () => null }))

// The three vite `define` globals (vite.config.ts), which vitest.config.ts doesn't define. The running version is the old one.
vi.stubGlobal('__BUILD_HASH__', 'test')
vi.stubGlobal('__BUILD_TIME__', '2026-01-01T12:00:00.000Z')
vi.stubGlobal('__APP_VERSION__', '1.2.0')

const { AppRoutes } = await import('../../App')
const { queryClient } = await import('../../lib/queryClient')

function renderShell(path = '/today') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  world.queued = 0
  world.registration = undefined
  queryClient.clear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  onlineManager.setOnline(true)
  queryClient.clear()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

const VERSIONS = 'This is 1.2.0. Overload needs 1.2.1 or newer.'
const UNSENT = 'Unsent changes are kept and sent after the update.'
const ERROR = "Couldn't update. Check your connection and try again."

describe('Update to continue · Ready', () => {
  it('UPDATE / UPDATE TO CONTINUE / the sentence with both versions, an UPDATE button under it, over the whole app: no navigation, no page', async () => {
    const { container } = renderShell()
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('UPDATE TO CONTINUE')
    expect(container.querySelector('p')!.textContent).toBe('UPDATE')
    expect(screen.getByText(VERSIONS)).toBeTruthy()
    expect(screen.queryByText(UNSENT)).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByText('TODAY PAGE')).toBeNull()
    expect((screen.getByRole('button', { name: 'UPDATE' }) as HTMLButtonElement).disabled).toBe(false)
    expect(container.textContent).toBe(`UPDATEUPDATE TO CONTINUE${VERSIONS}UPDATE`)
    captureRender('update-to-continue-ready', container)
  })
})

describe('Update to continue · Unsent changes', () => {
  it('the same screen with the one line more when the phone holds unsent changes (the queue holds 3)', async () => {
    world.queued = 3
    const { container } = renderShell()
    expect(await screen.findByText(UNSENT)).toBeTruthy()
    const lines = [...container.querySelectorAll('p')].map((p) => p.textContent)
    expect(lines).toEqual(['UPDATE', VERSIONS, UNSENT])
    captureRender('update-to-continue-unsent-changes', container)
  })
})

describe('Update to continue · Updating', () => {
  it('UPDATE pressed: the button reads UPDATING… and is held; the rest is as it was', async () => {
    world.registration = { installing: null, waiting: null, addEventListener() {}, removeEventListener() {}, update: () => new Promise(() => {}) }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: new EventTarget() })
    const { container } = renderShell()
    fireEvent.click(await screen.findByRole('button', { name: 'UPDATE' }))
    const button = (await screen.findByRole('button')) as HTMLButtonElement
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))))
    expect(button.textContent).toBe('UPDATING…')
    expect(button.disabled).toBe(true)
    expect(screen.getByText(VERSIONS)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.textContent).toBe(`UPDATEUPDATE TO CONTINUE${VERSIONS}UPDATING…`)
    captureRender('update-to-continue-updating', container)
  })
})

describe("Update to continue · Couldn't update", () => {
  it('the update check refused: the error line under the sentence, and the button reads TRY AGAIN', async () => {
    world.registration = { installing: null, waiting: null, addEventListener() {}, removeEventListener() {}, update: () => Promise.reject(new TypeError('Failed to fetch')) }
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: new EventTarget() })
    const { container } = renderShell()
    fireEvent.click(await screen.findByRole('button', { name: 'UPDATE' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(ERROR)
    expect(screen.getByRole('button', { name: 'TRY AGAIN' })).toBeTruthy()
    expect(container.textContent).toBe(`UPDATEUPDATE TO CONTINUE${VERSIONS}${ERROR}TRY AGAIN`)
    captureRender('update-to-continue-couldnt-update', container)
  })
})
