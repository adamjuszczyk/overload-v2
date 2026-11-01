// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_SETTINGS } from '../settings/settingsStore'
import { captureRender } from '../../testing/captureRender'

// The prototype's "Maintenance" states (SPEC.md 1.2.1, Screens → Maintenance [10]; TASKS.md chunk 72): Screen, Offline changes waiting, Your
// account, drawn by the REAL app shell (`AppRoutes`) with the REAL gate, the REAL screens, and for "Your account" the REAL Settings page and the
// REAL navigation under the strip, as the prototype's state does (`go('/settings')`). Every other page is a one-line stand-in and the status is
// what a test sets. Captured for design/1.2.1/built with CAPTURE_RENDER=1 (written after the assertions, so a failing rule leaves the committed
// fixture alone). The shell is the app's own column (`h-dvh`), so each capture is as tall as a phone screen.
const world = vi.hoisted(() => ({ user: { id: 'u-stable' } as { id: string } | null, queued: 0 }))

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({ user: world.user, loading: false, signOut: vi.fn() }),
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
  fetchAppStatus: async () => ({ maintenance: true, minVersion: '1.2.1', exemptUserIds: ['u-adam'], updatedAt: 'now' }),
}))
vi.mock('./useQueuedWriteCount', () => ({ useQueuedWriteCount: () => world.queued }))
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
vi.mock('../pwa/useServiceWorker', () => ({ useServiceWorker: () => {}, serviceWorkerRecord: () => ({ registration: undefined, newWorkerActive: false }) }))
vi.mock('../settings/AfterUpdateSheet', () => ({ default: () => null }))

// The three vite `define` globals (vite.config.ts), which vitest.config.ts doesn't define.
vi.stubGlobal('__BUILD_HASH__', 'test')
vi.stubGlobal('__BUILD_TIME__', '2026-01-01T12:00:00.000Z')
vi.stubGlobal('__APP_VERSION__', '1.2.1')

const { AppRoutes } = await import('../../App')
const { queryClient } = await import('../../lib/queryClient')

function renderShell(path: string) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  world.user = { id: 'u-stable' }
  world.queued = 0
  queryClient.clear()
})
afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  queryClient.clear()
})

const QUEUED_LINE = 'Changes you made offline are kept and sent then.'

describe('Maintenance · Screen', () => {
  it('draws MAINTENANCE / BACK SOON / the one sentence, over the whole app: no navigation, no strip', async () => {
    const { container } = renderShell('/today')
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('BACK SOON')
    expect(screen.getByText('MAINTENANCE')).toBeTruthy()
    expect(screen.getByText("Overload is being updated. It opens again by itself when that's done.")).toBeTruthy()
    expect(screen.queryByText(QUEUED_LINE)).toBeNull()
    expect(screen.queryByRole('navigation')).toBeNull()
    expect(screen.queryByText('TODAY PAGE')).toBeNull()
    expect(container.textContent).toBe("MAINTENANCEBACK SOONOverload is being updated. It opens again by itself when that's done.")
    captureRender('maintenance-screen', container)
  })
})

// Not a DEMO state: the prototype's screen has no way to the sign-in page, and SPEC says "signing in still works" (DECISIONS 270). The screen covers
// the sign-in page while nobody is signed in, so it carries one small action, SIGN IN, there and nowhere else. Captured beside the others so the
// choice can be looked at.
describe('Maintenance · Screen, signed out (the small SIGN IN of DECISIONS 270; not a prototype state)', () => {
  it('the same screen with one small SIGN IN under it, in tokens', async () => {
    world.user = null
    const { container } = renderShell('/today')
    const button = await screen.findByRole('button', { name: 'SIGN IN' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('BACK SOON')
    expect(container.querySelectorAll('button').length).toBe(1)
    expect(button.getAttribute('style')).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    captureRender('maintenance-screen-signed-out', container)
  })
})

describe('Maintenance · Offline changes waiting', () => {
  it('the same screen with the one line more when the phone holds unsent changes (the queue holds 3)', async () => {
    world.queued = 3
    const { container } = renderShell('/today')
    expect(await screen.findByText(QUEUED_LINE)).toBeTruthy()
    const lines = [...container.querySelectorAll('p')].map((p) => p.textContent)
    expect(lines).toEqual(['MAINTENANCE', "Overload is being updated. It opens again by itself when that's done.", QUEUED_LINE])
    captureRender('maintenance-offline-changes-waiting', container)
  })
})

describe('Maintenance · Your account', () => {
  it('an exempt account on Settings: the strip on top, then the real screen and the real navigation, as the prototype draws it', async () => {
    world.user = { id: 'u-adam' }
    const { container } = renderShell('/settings')
    const strip = await screen.findByRole('status')
    expect(strip.textContent).toBe('MAINTENANCE ON · ONLY YOUR ACCOUNT CAN USE THE APP')
    const column = strip.parentElement!
    expect(column.className).toContain('h-dvh')
    // top to bottom: the strip, the screen (Settings), the navigation
    const children = [...column.children]
    expect(children[0]).toBe(strip)
    expect(children[1].tagName).toBe('MAIN')
    expect(within(children[1] as HTMLElement).getAllByText('SETTINGS').length, 'the Settings screen, under the strip').toBeGreaterThan(0)
    expect(screen.getByText('TODAY')).toBeTruthy() // the navigation's first tab
    expect(screen.queryByText('BACK SOON')).toBeNull()
    captureRender('maintenance-your-account', container)
  })
})
