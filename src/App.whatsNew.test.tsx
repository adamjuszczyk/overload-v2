// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DEFAULT_SETTINGS } from './features/settings/settingsStore'

// Chunk 71 (TASKS.md 1.2.1; SPEC.md Settings · WHAT'S NEW; DECISIONS 256): App.tsx's own wiring of the release notes, on the real route
// table (<AppRoutes/>) under this test's own <MemoryRouter>, as App.test.tsx does for the other routes, with every routed page a
// one-line stand-in except the two chunk 71 adds (the notes screen and the sheet after an update) and Settings' WHAT'S NEW card, which
// are real. What is proven here:
//   - the sheet after an update is mounted in the signed-in shell only: it opens over the first signed-in screen, never over the login
//     page (nor while the session is still loading), and a sign-in is what opens it;
//   - the notes screen has its route, and the card's rows reach it.

const auth = vi.hoisted(() => ({ user: { id: 'user-1' } as { id: string } | null, loading: false }))

vi.mock('./features/auth/useAuth', () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading, signOut: vi.fn() }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))
vi.mock('./features/settings/useSettings', () => ({
  useSettings: () => ({ data: DEFAULT_SETTINGS }),
}))
vi.mock('./features/offline/useSyncQueue', () => ({
  useSyncQueueInit: () => {},
  useSyncQueueRunner: () => {},
}))
vi.mock('./features/library/useExercises', () => ({
  useSeedDefaultExercisesIfEmpty: () => {},
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
vi.mock('./features/coach/CoachPage', () => ({ default: () => <div>COACH PAGE</div> }))
vi.mock('./components/Nav', () => ({ default: () => <div>NAV</div> }))
vi.mock('./features/pwa/PwaUpdateNotice', () => ({ default: () => null }))
// Chunk 72 — the release gate (maintenance) is not what this file looks at (App.maintenance.test.tsx mounts the real one in this shell): no gate.
vi.mock('./features/release/useAppStatus', () => ({ useGate: () => null }))
// Settings: a stand-in that holds the REAL card, so a row's path meets the real route. (SettingsPage itself is proven in
// SettingsPage.whatsNew.test.tsx.)
vi.mock('./features/settings/SettingsPage', async () => {
  const { default: WhatsNewCard } = await import('./features/settings/WhatsNewCard')
  return {
    default: function SettingsStandIn() {
      return (
        <div>
          SETTINGS PAGE
          <WhatsNewCard cardStyle={{}} />
        </div>
      )
    },
  }
})

// The define vitest doesn't run (vite.config.ts), before App.tsx's imports reach src/lib/version.ts.
vi.stubGlobal('__APP_VERSION__', '1.2.1')

const { AppRoutes } = await import('./App')
const { RELEASES } = await import('./data/releaseNotes')
const { NOTES_SEEN_KEY } = await import('./features/settings/releaseNotesSeen')

beforeEach(() => {
  localStorage.clear()
  auth.user = { id: 'user-1' }
  auth.loading = false
})
afterEach(() => {
  cleanup()
  localStorage.clear()
})

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

const dialog = () => screen.queryByRole('dialog')

describe('the sheet after an update is in the signed-in shell, over the first signed-in screen', () => {
  it('opens over the screen the app opened on, with the running version\'s notes', () => {
    renderAt('/')
    expect(screen.getByText('TODAY PAGE')).toBeTruthy() // `/` goes to Today: the first signed-in screen
    expect(dialog(), 'the sheet is open over the first signed-in screen').not.toBeNull()
    expect(within(dialog()!).getByRole('heading', { level: 2 }).textContent).toBe(`OVERLOAD ${RELEASES[0].version}`)
  })

  it('opens over any other screen the app opens on just the same (a link to Library, say)', () => {
    renderAt('/library')
    expect(screen.getByText('LIBRARY PAGE')).toBeTruthy()
    expect(dialog()).not.toBeNull()
  })

  it('GOT IT closes it, writes the mark, and a later start does not open it', () => {
    renderAt('/today')
    expect(dialog(), 'the sheet is open').not.toBeNull()
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'GOT IT' }))
    expect(dialog()).toBeNull()
    expect(localStorage.getItem(NOTES_SEEN_KEY)).toBe('1.2.1')
    cleanup()
    renderAt('/today')
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
    expect(dialog()).toBeNull()
  })

  it('does not open for a phone that has already seen this version', () => {
    localStorage.setItem(NOTES_SEEN_KEY, '1.2.1')
    renderAt('/today')
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
    expect(dialog()).toBeNull()
  })
})

describe('never over the login page (Adam, 2026-10-30, TASKS question 7)', () => {
  it('signed out: the login page, no sheet, and no mark written', () => {
    auth.user = null
    renderAt('/today')
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    expect(dialog()).toBeNull()
    expect(localStorage.getItem(NOTES_SEEN_KEY)).toBeNull()
  })

  it('while the session is still loading: no sheet, and not the login page either', () => {
    auth.loading = true
    renderAt('/today')
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
    expect(dialog()).toBeNull()
  })

  it('signing in is what opens it: the login page first, then the first signed-in screen with the sheet over it', () => {
    auth.user = null
    const { rerender } = renderAt('/')
    expect(screen.getByText('LOGIN PAGE')).toBeTruthy()
    expect(dialog()).toBeNull()
    auth.user = { id: 'user-1' }
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    )
    expect(screen.queryByText('LOGIN PAGE')).toBeNull()
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
    expect(dialog()).not.toBeNull()
  })
})

describe('the notes screen', () => {
  beforeEach(() => localStorage.setItem(NOTES_SEEN_KEY, '1.2.1')) // the sheet has had its turn: it is not what these look at

  it('has its route: /settings/whats-new/1.2 shows the notes of 1.2, from the data file', () => {
    renderAt('/settings/whats-new/1.2')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OVERLOAD 1.2')
    const oldest = RELEASES[RELEASES.length - 1]
    expect(oldest.version).toBe('1.2')
    expect(screen.getByText(oldest.groups[0].items[0])).toBeTruthy()
    expect(screen.getByText(oldest.groups[oldest.groups.length - 1].title.toUpperCase())).toBeTruthy()
  })

  it('a WHAT\'S NEW row on Settings reaches it, and Back returns to Settings', () => {
    renderAt('/settings')
    expect(screen.getByText('SETTINGS PAGE')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${RELEASES[RELEASES.length - 1].version.replace('.', '\\.')}(?!\\.)`) }))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`OVERLOAD ${RELEASES[RELEASES.length - 1].version}`)
    expect(screen.queryByText('SETTINGS PAGE')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }))
    expect(screen.getByText('SETTINGS PAGE')).toBeTruthy()
  })
})
