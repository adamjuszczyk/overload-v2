import { useEffect } from 'react'
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
import ProgramPage from './features/programs/ProgramPage'
import PlannerPage from './features/planner/PlannerPage'
import LibraryPage from './features/library/LibraryPage'
import SettingsPage from './features/settings/SettingsPage'
import CoachPage from './features/coach/CoachPage'
import MesoPrioritiesPage from './features/coach/MesoPrioritiesPage'
import PrioritiesEditor from './features/plan/PrioritiesEditor'
import Nav from './components/Nav'
import Toast from './features/notifications/Toast'
import PwaUpdateNotice from './features/pwa/PwaUpdateNotice'
import { useAccentColour } from './hooks/useAccentColour'
import { useSettings } from './features/settings/useSettings'
import { useSyncQueueInit, useSyncQueueRunner } from './features/offline/useSyncQueue'
import { useSeedDefaultExercisesIfEmpty } from './features/library/useExercises'

function SyncManager() {
  useSyncQueueInit()
  useSyncQueueRunner()
  useSeedDefaultExercisesIfEmpty()
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          {/* Unconditional on auth state — a stale bundle on the login
              screen is just as real a problem as one mid-workout, and
              registering the update check here (rather than only once
              authenticated) means it can't be blocked on a test/verification
              path that needs to reach a logged-in screen. */}
          <PwaUpdateNotice />
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}

function AppRoutes() {
  const { user, loading } = useAuth()
  const { data: settings } = useSettings()

  // Apply accent colour from settings (falls back to #FF8C42 default)
  useAccentColour(settings.accentColour)

  // Apply light/dark theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', settings.theme)
  }, [settings.theme])

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

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }

  return (
    <div className="flex flex-col h-dvh">
      <SyncManager />
      <main className="flex-1 overflow-y-auto min-h-0">
        <Routes>
          <Route path="/" element={<Navigate to="/today" replace />} />
          <Route path="/today"    element={<TodayPage />}    />
          <Route path="/plan"     element={<PlanPage />}     />
          <Route path="/plan/priorities" element={<PrioritiesEditor />} />
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/history"  element={<HistoryPage />}  />
          <Route path="/exercise/:exerciseId" element={<ExerciseHistoryPage />} />
          <Route path="/session-type/:workoutDayId" element={<SessionTypeHistoryPage />} />
          <Route path="/program"                           element={<ProgramPage />}         />
          {/* Chunk 11 — the stepped program planner replaces
              ProgramBuilderPage/WorkoutDayEditorPage/WeeklyScheduleGrid
              (removed) at this same route. */}
          <Route path="/program/:programId"             element={<PlannerPage />}           />
          <Route path="/meso/:mesocycleId/priorities"   element={<MesoPrioritiesPage />}   />
          <Route path="/library"  element={<LibraryPage />}  />
          <Route path="/settings" element={<SettingsPage />} />
          {/* Unconditional route — CoachPage itself renders the locked
              placeholder for every account except the gated one, so
              opening /coach directly still resolves to *something*
              (COACH-ANALYSIS-SPEC.md §3), it just isn't in Nav for
              anyone else. */}
          <Route path="/coach"    element={<CoachPage />}    />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
      <Toast />
      <Nav />
    </div>
  )
}
