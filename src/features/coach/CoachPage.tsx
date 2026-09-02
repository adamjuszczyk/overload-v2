import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { isCoachUser } from './coachGate'
import CoachLocked from './CoachLocked'
import CoachAnalysisTab from './CoachAnalysisTab'
import CoachAskTab from './CoachAskTab'
import PhaseLog from './PhaseLog'
import WeightLog from './WeightLog'
import CoachMemory from './CoachMemory'

// Tab shell (COACH-ANALYSIS-TASKS.md §4 step B) — same pattern
// HistoryPage.tsx uses: page header + tab bar live in the shell, each tab
// owns its own content below it. ANALYSIS | ASK | CONTEXT (ASK added by
// QA-SIDEBAR-TASKS.md §8.1 Phase 7 — the not-in-session entry point).

type Tab = 'analysis' | 'ask' | 'context'

const TABS: { id: Tab; label: string }[] = [
  { id: 'analysis', label: 'ANALYSIS' },
  { id: 'ask', label: 'ASK' },
  { id: 'context', label: 'CONTEXT' },
]

export default function CoachPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<Tab>('analysis')

  if (!isCoachUser(user?.id)) {
    return <CoachLocked />
  }

  return (
    <div className="px-4 pt-8 pb-12">
      {/* Page header */}
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        COACH
      </p>
      <h1
        className="text-3xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        COACH
      </h1>

      {/* Tab bar */}
      <div
        className="flex mt-5 rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border)' }}
      >
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 py-2.5 text-xs font-bold tracking-widest"
            style={{
              backgroundColor: activeTab === tab.id ? 'var(--accent)' : 'var(--surface)',
              color: activeTab === tab.id ? 'var(--base)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'analysis' ? (
        <CoachAnalysisTab />
      ) : activeTab === 'ask' ? (
        <CoachAskTab />
      ) : (
        <>
          <PhaseLog />
          <WeightLog />
          <CoachMemory />
        </>
      )}
    </div>
  )
}
