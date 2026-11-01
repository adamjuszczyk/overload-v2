import { useEffect } from 'react'
import { MemoryRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@app/lib/queryClient'
import ProgramsTab from './overrides/ProgramsTab'
import FinishedProgramPage from './overrides/FinishedProgramPage'
import FinishedPriorities from './overrides/FinishedPriorities'
import GymSession from './overrides/GymSession'
import { workoutDay, weekPlan, weekPlanNoSets, useWorkoutSession } from './demo/workoutFixture'
import SessionPreview from './overrides/SessionPreview'
import StepExercises from './overrides/StepExercises'
import { plannerProgram } from './demo/plannerFixture'
import { ArrowLeft } from 'lucide-react'
import OldSessionPreview from '@app/features/gym/SessionPreview'
import Nav from '@app/components/Nav'
import { useAccentColour } from '@app/hooks/useAccentColour'
import { useSettingsStore } from '@app/features/settings/settingsStore'
import SettingsPage from './overrides/SettingsPage'
import { ReleaseNotesPage, AfterUpdateSheet } from './screens/release'
import { MaintenanceScreen, UpdateRequiredScreen, MaintenanceStrip, NotInPrototype } from './screens/gates'
import { useDemo } from './demo/demoStore'
import { DemoButton, DemoMenu } from './demo/DemoMenu'

function PreviewRoute({ old = false, noSets = false }: { old?: boolean; noSets?: boolean }) {
  const navigate = useNavigate()
  const props = {
    workoutDay, weekPlan: noSets ? weekPlanNoSets : weekPlan, weekNumber: 2, today: '2026-01-06', isStarting: false,
    onBack: () => navigate('/today'),
    onStart: () => { useWorkoutSession.getState().reset('fresh'); navigate('/today') },
  }
  return old ? <OldSessionPreview {...props} /> : <SessionPreview {...props} eyebrow="WEEK 2 · TUESDAY" />
}

// The planner's step 2 (PlannerPage's frame, drawn plainly: the step 2 body is the real component).
function PlannerRoute() {
  const navigate = useNavigate()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      <div style={{ padding: '16px 16px 14px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button type="button" onClick={() => navigate('/program')} aria-label="Back to Programs" style={{ width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-raised)', border: '1px solid var(--border-strong)', borderRadius: 10, color: 'var(--text-secondary)' }}>
          <ArrowLeft size={18} />
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>2 · EXERCISES</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, lineHeight: 1.1, color: 'var(--text-primary)' }}>PUSH PULL LEGS</h1>
        </div>
      </div>
      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '16px' }}>
        <StepExercises program={plannerProgram} volumeReadOnly={false} />
      </div>
    </div>
  )
}

function ProgramsTabRoute() {
  const navigate = useNavigate()
  return <ProgramsTab onTab={(tab) => tab === 'plan' && navigate('/week')} />
}

// The app shell as AppRoutes draws it (src/App.tsx), with the 1.2.1 gates in front.
function Shell() {
  const { gate, exemptStrip, afterUpdateSheet, menuOpen } = useDemo()
  const theme = useSettingsStore((s) => s.theme)
  const accent = useSettingsStore((s) => s.accentColour)
  useAccentColour(accent)
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme) }, [theme])

  return (
    <>
      {gate === 'maintenance' && <MaintenanceScreen />}
      {gate === 'update' && <UpdateRequiredScreen />}
      {gate === 'none' && (
        <div className="flex flex-col h-dvh">
          {exemptStrip && <MaintenanceStrip />}
          <main className="flex-1 overflow-y-auto min-h-0">
            <Routes>
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/settings/whats-new/:version" element={<ReleaseNotesPage />} />
              <Route path="/today" element={<GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={2} today="2026-01-06" />} />
              <Route path="/today/preview" element={<PreviewRoute />} />
              <Route path="/today/preview-no-sets" element={<PreviewRoute noSets />} />
              <Route path="/today/preview-1.2" element={<PreviewRoute old />} />
              <Route path="/program/planner" element={<PlannerRoute />} />
              <Route path="/plan" element={<Navigate to="/program" replace />} />
              <Route path="/program" element={<ProgramsTabRoute />} />
              <Route path="/program/finished/:mesocycleId" element={<FinishedProgramPage />} />
              <Route path="/program/finished/:mesocycleId/priorities" element={<FinishedPriorities />} />
              <Route path="*" element={<NotInPrototype />} />
            </Routes>
          </main>
          <Nav />
          {afterUpdateSheet && <AfterUpdateSheet />}
        </div>
      )}
      <DemoButton />
      {menuOpen && <DemoMenu />}
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/program']}>
        <Shell />
      </MemoryRouter>
    </QueryClientProvider>
  )
}
