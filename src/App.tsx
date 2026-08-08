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
import ProgramBuilderPage from './features/programs/ProgramBuilderPage'
import WorkoutDayEditorPage from './features/programs/WorkoutDayEditorPage'
import LibraryPage from './features/library/LibraryPage'
import SettingsPage from './features/settings/SettingsPage'
import Nav from './components/Nav'
import Toast from './features/notifications/Toast'
import { useAccentColour } from './hooks/useAccentColour'
import { useSettings } from './features/settings/useSettings'
import { useSyncQueueInit, useSyncQueueRunner } from './features/offline/useSyncQueue'

function SyncManager() {
  useSyncQueueInit()
  useSyncQueueRunner()
  return null
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
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
          <Route path="/progress" element={<ProgressPage />} />
          <Route path="/history"  element={<HistoryPage />}  />
          <Route path="/exercise/:exerciseId" element={<ExerciseHistoryPage />} />
          <Route path="/session-type/:workoutDayId" element={<SessionTypeHistoryPage />} />
          <Route path="/program"                           element={<ProgramPage />}         />
          <Route path="/program/:programId"             element={<ProgramBuilderPage />}   />
          <Route path="/program/:programId/day/:dayId"  element={<WorkoutDayEditorPage />} />
          <Route path="/library"  element={<LibraryPage />}  />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/today" replace />} />
        </Routes>
      </main>
      <Toast />
      <Nav />
    </div>
  )
}
