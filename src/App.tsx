import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { AuthProvider, useAuth } from './features/auth/useAuth'
import LoginPage from './features/auth/LoginPage'
import TodayPage from './features/gym/TodayPage'
import PlanPage from './features/plan/PlanPage'
import ProgressPage from './features/progress/ProgressPage'
import HistoryPage from './features/history/HistoryPage'
import ExerciseHistoryPage from './features/history/ExerciseHistoryPage'
import SessionTypeHistoryPage from './features/history/SessionTypeHistoryPage'
import PlannerPage from './features/planner/PlannerPage'
import LibraryPage from './features/library/LibraryPage'
import SettingsPage from './features/settings/SettingsPage'
import ReleaseNotesPage from './features/settings/ReleaseNotesPage'
import AfterUpdateSheet from './features/settings/AfterUpdateSheet'
import CoachPage from './features/coach/CoachPage'
import MesoPrioritiesPage from './features/coach/MesoPrioritiesPage'
import PrioritiesEditor from './features/plan/PrioritiesEditor'
import ChangeProgramPage from './features/programs/ChangeProgramPage'
import FinishedProgramPage from './features/programs/FinishedProgramPage'
import FinishedProgramPriorities from './features/programs/FinishedProgramPriorities'
import Nav from './components/Nav'
import Toast from './features/notifications/Toast'
import { useServiceWorker } from './features/pwa/useServiceWorker'
import StagingBadge from './components/StagingBadge'
import { useAccentColour } from './hooks/useAccentColour'
import { useSettings } from './features/settings/useSettings'
import { useSyncQueueInit, useSyncQueueRunner } from './features/offline/useSyncQueue'
import SyncFailedNotice from './features/offline/SyncFailedNotice'
import { useSeedDefaultExercisesIfEmpty } from './features/library/useExercises'
import { MaintenanceScreen, MaintenanceStrip, UpdateRequiredScreen } from './features/release/gates'
import { useGate } from './features/release/useAppStatus'
import { useRequiredUpdate } from './features/release/useRequiredUpdate'
import { APP_VERSION } from './lib/version'

function SyncManager() {
  useSyncQueueInit()
  useSyncQueueRunner()
  useSeedDefaultExercisesIfEmpty()
  return null
}

export default function App() {
  // 1.2.1 (chunk 73; SPEC Update to continue [11]) — the service worker's registration and its update checks, once, here, whatever the app is
  // showing. A stale bundle on the login screen is just as real a problem as one mid-workout, and a registration that lived in the signed-in shell
  // (or behind a gate) would be gone exactly when the update screen, which replaces the shell, needs it for UPDATE (the gap pre-read's 73-5).
  // Nothing is drawn: the RELOAD banner is gone, the new code installs in the background, and the update screen decides whether the old one may
  // still be used.
  useServiceWorker()
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <StagingBadge />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

// 1.2.1 (chunk 72; DECISIONS 270) — what a visitor who is not signed in sees: the sign-in page, and over it the maintenance screen while maintenance is on.
// "Signing in still works" (SPEC), so an account that is exempt can still sign in and then gets the strip: the screen's small SIGN IN action opens the
// sign-in page. Signing in is an auth write the maintenance check never touches. A visitor who signs in and is not exempt is signed in and sees the
// screen without the action. The choice to sign in is this component's own state, so it ends with it (a later sign-out starts from the screen again).
// The sign-in page is the same element, in the same place, whether maintenance is on (the visitor asked for it) or off, so maintenance ending while
// someone types does not start the page again and lose what they typed.
function SignedOutEntry({ maintenance }: { maintenance: boolean }) {
  const [signingIn, setSigningIn] = useState(false)
  if (maintenance && !signingIn) return <MaintenanceScreen onSignIn={() => setSigningIn(true)} />
  return (
    <Routes>
      <Route path="*" element={<LoginPage />} />
    </Routes>
  )
}

// Exported (chunk 26) so App.test.tsx can mount the real route table under
// its own <MemoryRouter> — the exact same <Routes>/<Route> tree App() wires
// under <BrowserRouter> in production, just reachable from a test without
// AuthProvider/QueryClientProvider's own Supabase-touching side effects
// (both of App's own mounted-component dependencies are mocked at their
// hook boundary in that test instead, same precedent every other screen
// test in this codebase already follows).
export function AppRoutes() {
  const { user, loading } = useAuth()
  const { data: settings } = useSettings()
  // 1.2.1 (chunk 72; SPEC Maintenance [10]) — what the release state asks of this account: the maintenance screen, the strip an exempt account
  // works under, or nothing (also when it is unread or the phone is offline: the app works as usual).
  const gate = useGate()
  // 1.2.1 (chunk 73; SPEC Update to continue [11]) — whether this version is older than the database's `min_version`: the update screen, which wins
  // over maintenance (an old app must update before it can wait out maintenance). Nothing offline or before the first read, as for maintenance.
  const update = useRequiredUpdate()

  // Apply accent colour from settings (falls back to #FF8C42 default)
  useAccentColour(settings.accentColour)

  // Apply light/dark theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

  // The theme and the accent are applied above the gate, here, before anything below returns: the maintenance screen draws in the user's own
  // theme and accent as the app does (chunk 72's pre-read, 72-6; the prototype's Shell does the same).

  // 1.2.1 (chunk 73) — the update screen replaces the whole app, navigation included, whatever the person is doing and whether or not anyone is signed
  // in or the sign-in is still being read: an old app must never keep writing into a newer database. It is first, so it also comes before maintenance.
  if (update.required) {
    return <UpdateRequiredScreen appVersion={APP_VERSION} minVersion={update.minVersion} state={update.state} onUpdate={() => void update.update()} />
  }

  if (loading) {
    return (
      <div
        className="h-dvh flex items-center justify-center"
        style={{ backgroundColor: 'var(--base)' }}
      >
        <div
          className="w-6 h-6 rounded-full animate-spin"
          style={{
            border: '2px solid var(--border-strong)',
            borderTopColor: 'var(--text-primary)',
          }}
        />
      </div>
    )
  }

  // 1.2.1 (chunk 72) — maintenance on and this account not exempt: a full screen that replaces the whole app, navigation included, and the sign-in
  // page too while nobody is signed in (there is no account to exempt before sign-in; Adam, 2026-10-30, TASKS question 6, DECISIONS 255). The shell
  // below is not mounted meanwhile, and it opens again by itself, where the address was, when `useAppStatus` reads maintenance off.
  if (user && gate === 'maintenance') return <MaintenanceScreen />

  if (!user) return <SignedOutEntry maintenance={gate === 'maintenance'} />

  return (
    <div className="flex flex-col h-dvh">
      {/* An exempt account works as usual with the strip on top (SPEC: "styled as the old RELOAD banner was"): in this column, above the screen. */}
      {gate === 'strip' && <MaintenanceStrip />}
      <SyncManager />
      <main className="flex-1 overflow-y-auto min-h-0">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today"    element={<TodayPage />}    />
          {/* Chunk 65: `/plan` opens the week, or PROGRAMS when no program runs (PlanPage chooses the tab); `/program` is the same page
              opened on PROGRAMS. Each has a key of its own: going from one to the other (the nav's PLAN from `/program`, START's
              `/plan?week=1` from it) must start a new Plan, which opens on its own tab, not keep the other's choice. */}
          <Route path="/plan"     element={<PlanPage key="plan" />}     />
          <Route path="/plan/priorities" element={<PrioritiesEditor />} />
          <Route path="/plan/change" element={<ChangeProgramPage />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/history"  element={<HistoryPage />}  />
          <Route path="/exercise/:exerciseId" element={<ExerciseHistoryPage />} />
          <Route path="/session-type/:workoutDayId" element={<SessionTypeHistoryPage />} />
          {/* Chunk 26 — PROGRAM is gone from the bottom bar (Nav.tsx); both
              routes below are reached from Plan's PROGRAMS tab. Chunk 65: the
              page at `/program` is Plan opened on PROGRAMS (ProgramsPage.tsx
              is gone) — every old deep link to /program or /program/:id
              still resolves. */}
          <Route path="/program"                           element={<PlanPage key="programs" initialTab="programs" />} />
          {/* Chunk 66 — a finished program (PR14), opened from a FINISHED row of the PROGRAMS tab, and the editor its PRIORITIES row opens
              for a run whose marks are in the new table. A pre-1.1 run's PRIORITIES row goes on to the Coach page below, as it is (G50). */}
          <Route path="/program/finished/:mesocycleId"            element={<FinishedProgramPage />}       />
          <Route path="/program/finished/:mesocycleId/priorities" element={<FinishedProgramPriorities />} />
          {/* Chunk 11 — the stepped program planner replaces
              ProgramBuilderPage/WorkoutDayEditorPage/WeeklyScheduleGrid
              (removed) at this same route. */}
          <Route path="/program/:programId"             element={<PlannerPage />}           />
          <Route path="/meso/:mesocycleId/priorities"   element={<MesoPrioritiesPage />}   />
          <Route path="/library"  element={<LibraryPage />}  />
          <Route path="/settings" element={<SettingsPage />} />
          {/* 1.2.1 (chunk 71) — one release's notes, opened from Settings' WHAT'S NEW; the notes ship with the app. */}
          <Route path="/settings/whats-new/:version" element={<ReleaseNotesPage />} />
          {/* Unconditional route — CoachPage itself renders the locked
              placeholder for every account except the gated one, so
              opening /coach directly still resolves to *something*
              (COACH-ANALYSIS-SPEC.md §3), it just isn't in Nav for
              anyone else. */}
          {/* A Coach note with no session that can't sync shows here (the
              Coach code itself is frozen). Renders nothing otherwise. */}
          <Route path="/coach"    element={<><SyncFailedNotice sessionId={null} className="px-4 pt-4" /><CoachPage /></>} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
      <Toast />
      <Nav />
      {/* 1.2.1 (chunk 71) — the running version's notes, once per phone, over the first signed-in screen (DECISIONS 256): it is mounted
          here, in the signed-in shell, so it never opens over the login page. It decides for itself whether the version is new here. */}
      <AfterUpdateSheet />
    </div>
  )
}
