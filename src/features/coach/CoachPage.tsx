import { useState } from 'react'
import { useAuth } from '../auth/useAuth'
import { isCoachUser } from './coachGate'
import CoachLocked from './CoachLocked'

// Two-tab shell (COACH-ANALYSIS-TASKS.md §4 step B) — same pattern
// HistoryPage.tsx uses: page header + tab bar live in the shell, each tab
// owns its own content below it. Both tabs ship empty here; Context tab
// logic is step C, Analysis tab logic is step F.

type Tab = 'analysis' | 'context'

const TABS: { id: Tab; label: string }[] = [
  { id: 'analysis', label: 'ANALYSIS' },
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

      {/* Tab content — both empty until steps C (Context) and F (Analysis) */}
      <div
        className="mt-8 text-center text-xs"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {activeTab === 'analysis' ? 'ANALYSIS — COMING SOON' : 'CONTEXT — COMING SOON'}
      </div>
    </div>
  )
}
