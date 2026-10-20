// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { MemoryRouter, useNavigate, useParams } from 'react-router-dom'
import { DEFAULT_SETTINGS } from './features/settings/settingsStore'

// Chunk 26 (TASKS.md: "App.tsx routes: /program → the Programs page;
// /program/:id → the planner (both reached from Plan). Old deep links
// resolve. Keep a test per route."). This is App.tsx's own real route
// table (<AppRoutes/>, exported from App.tsx this chunk for exactly this),
// mounted under this test's own <MemoryRouter> instead of App()'s
// production <BrowserRouter> — the same <Routes>/<Route> tree, same real
// path strings, just reachable without AuthProvider/QueryClientProvider's
// own Supabase-touching side effects.
//
// Every routed PAGE component is mocked to a one-line stand-in (own
// useParams reads only, where the route carries an id) — this file proves
// ROUTING (which path renders which component, with which id), not each
// page's internals, which are each already covered by their own dedicated
// test file. "Prove every rule at the layer that applies it" (Lessons).
// useAuth/useSettings/the sync-queue and seed hooks are mocked because
// AppRoutes/SyncManager call them directly (real Supabase/Dexie hooks);
// useAccentColour and Toast are left real — both are supabase-free
// (confirmed: no v2_* read, no auth call) and are exercised for free.

vi.mock('./features/auth/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, loading: false, signOut: vi.fn() }),
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
// PlanPage's own tab choice is its state, made once when the page is mounted (`initialTab`, else none, which is the page choosing by whether a
// program runs): this stand-in keeps the same kind of state, so the route table's `key`s are provable (the two routes must start a new page).
vi.mock('./features/plan/PlanPage', () => ({
  default: function PlanPageStub({ initialTab }: { initialTab?: string }) {
    const navigate = useNavigate()
    const [openedOn] = useState(initialTab ?? 'auto')
    return (
      <div>
        PLAN PAGE tab={openedOn}
        <button onClick={() => navigate('/plan')}>GO TO /plan</button>
        <button onClick={() => navigate('/plan?week=1')}>GO TO /plan?week=1</button>
        <button onClick={() => navigate('/program')}>GO TO /program</button>
      </div>
    )
  },
}))
vi.mock('./features/plan/PrioritiesEditor', () => ({ default: () => <div>PRIORITIES EDITOR</div> }))
vi.mock('./features/progress/ProgressPage', () => ({ default: () => <div>PROGRESS PAGE</div> }))
vi.mock('./features/history/HistoryPage', () => ({ default: () => <div>HISTORY PAGE</div> }))
vi.mock('./features/history/ExerciseHistoryPage', () => ({
  default: () => <div>EXERCISE HISTORY exerciseId={useParams().exerciseId}</div>,
}))
vi.mock('./features/history/SessionTypeHistoryPage', () => ({
  default: () => <div>SESSION TYPE HISTORY workoutDayId={useParams().workoutDayId}</div>,
}))
vi.mock('./features/planner/PlannerPage', () => ({
  default: () => <div>PLANNER PAGE programId={useParams().programId}</div>,
}))
vi.mock('./features/coach/MesoPrioritiesPage', () => ({
  default: () => <div>MESO PRIORITIES mesocycleId={useParams().mesocycleId}</div>,
}))
vi.mock('./features/library/LibraryPage', () => ({ default: () => <div>LIBRARY PAGE</div> }))
vi.mock('./features/settings/SettingsPage', () => ({ default: () => <div>SETTINGS PAGE</div> }))
vi.mock('./features/coach/CoachPage', () => ({ default: () => <div>COACH PAGE</div> }))
vi.mock('./components/Nav', () => ({ default: () => <div>NAV</div> }))
// Not rendered by AppRoutes at all (only by App()'s own BrowserRouter
// wrapper, not under test here) — mocked anyway, because its import chain
// (usePwaUpdate.ts) reaches vite-plugin-pwa's "virtual:pwa-register/react"
// module, which only exists under vite.config.ts's own plugin pipeline, not
// vitest's (vitest.config.ts's own header comment: deliberately not that
// config). Merely importing App.tsx evaluates this statement regardless of
// what AppRoutes renders — ESM top-level imports always run on module load.
vi.mock('./features/pwa/PwaUpdateNotice', () => ({ default: () => null }))

const { AppRoutes } = await import('./App')

afterEach(() => cleanup())

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  )
}

describe('App routes — chunk 26: /program and /program/:id', () => {
  it('/program renders Plan opened on PROGRAMS (chunk 65: ProgramsPage is gone, the page at /program is the PROGRAMS tab of Plan)', () => {
    renderAt('/program')
    expect(screen.getByText(/PLAN PAGE tab=programs/)).toBeTruthy()
  })

  it('/program/:programId renders the planner, with the real id from the URL — an old deep link to a specific program still resolves', () => {
    renderAt('/program/prog-42')
    expect(screen.getByText('PLANNER PAGE programId=prog-42')).toBeTruthy()
  })
})

// The two routes share one component, and React keeps a component's state across a change between two elements of the same type in the
// same place: going from /program to /plan would keep the PROGRAMS tab the first one opened on, so the nav's PLAN ("opens straight into the
// week") and START's `/plan?week=1` would land on PROGRAMS. Each route's element has a key of its own, so the other starts a new page.
describe('App routes — chunk 65: going between /plan and /program starts a new Plan, which opens on its own tab', () => {
  it('/program → /plan: the page opens on its own choice again, not on the PROGRAMS tab /program opened it on', () => {
    renderAt('/program')
    expect(screen.getByText(/PLAN PAGE tab=programs/)).toBeTruthy()
    fireEvent.click(screen.getByText('GO TO /plan'))
    expect(screen.getByText(/PLAN PAGE tab=auto/)).toBeTruthy()
    expect(screen.queryByText(/PLAN PAGE tab=programs/)).toBeNull()
  })

  it('/program → /plan?week=1 (START from the PROGRAMS route): the same', () => {
    renderAt('/program')
    fireEvent.click(screen.getByText('GO TO /plan?week=1'))
    expect(screen.getByText(/PLAN PAGE tab=auto/)).toBeTruthy()
  })

  it('/plan → /program: PROGRAMS, not whatever the Plan that was open had chosen', () => {
    renderAt('/plan')
    expect(screen.getByText(/PLAN PAGE tab=auto/)).toBeTruthy()
    fireEvent.click(screen.getByText('GO TO /program'))
    expect(screen.getByText(/PLAN PAGE tab=programs/)).toBeTruthy()
  })
})

describe('App routes — old deep links resolve unchanged', () => {
  it('/today → TodayPage', () => {
    renderAt('/today')
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
  })

  it('/ redirects to /today', () => {
    renderAt('/')
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
  })

  it('/plan → PlanPage, which chooses its own tab (no tab is passed: the week, or PROGRAMS when no program runs)', () => {
    renderAt('/plan')
    expect(screen.getByText(/PLAN PAGE tab=auto/)).toBeTruthy()
  })

  it('/plan/priorities → PrioritiesEditor', () => {
    renderAt('/plan/priorities')
    expect(screen.getByText('PRIORITIES EDITOR')).toBeTruthy()
  })

  it('/progress → ProgressPage', () => {
    renderAt('/progress')
    expect(screen.getByText('PROGRESS PAGE')).toBeTruthy()
  })

  it('/history → HistoryPage', () => {
    renderAt('/history')
    expect(screen.getByText('HISTORY PAGE')).toBeTruthy()
  })

  it('/exercise/:exerciseId → ExerciseHistoryPage, with the real id', () => {
    renderAt('/exercise/ex-7')
    expect(screen.getByText('EXERCISE HISTORY exerciseId=ex-7')).toBeTruthy()
  })

  it('/session-type/:workoutDayId → SessionTypeHistoryPage, with the real id', () => {
    renderAt('/session-type/wd-3')
    expect(screen.getByText('SESSION TYPE HISTORY workoutDayId=wd-3')).toBeTruthy()
  })

  it('/meso/:mesocycleId/priorities → MesoPrioritiesPage (Coach, untouched by this chunk), with the real id', () => {
    renderAt('/meso/meso-9/priorities')
    expect(screen.getByText('MESO PRIORITIES mesocycleId=meso-9')).toBeTruthy()
  })

  it('/library → LibraryPage', () => {
    renderAt('/library')
    expect(screen.getByText('LIBRARY PAGE')).toBeTruthy()
  })

  it('/settings → SettingsPage', () => {
    renderAt('/settings')
    expect(screen.getByText('SETTINGS PAGE')).toBeTruthy()
  })

  it('/coach → CoachPage (unconditional route — reachable directly even though Nav hides the tab for most accounts)', () => {
    renderAt('/coach')
    expect(screen.getByText('COACH PAGE')).toBeTruthy()
  })

  it('an unknown path redirects to /today', () => {
    renderAt('/some-removed-route')
    expect(screen.getByText('TODAY PAGE')).toBeTruthy()
  })
})
