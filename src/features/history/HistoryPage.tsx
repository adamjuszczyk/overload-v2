import { useState } from 'react'
import HistorySessions from './HistorySessions'
import HistoryExercises from './HistoryExercises'

// Tab shell (CONTEXT.md "History: Sessions/Exercises tab split") — same
// pattern ProgressPage.tsx already uses for its own two tabs, applied here:
// page header + tab bar live in the shell, each tab owns its own content and
// local state below it.

type Tab = 'sessions' | 'exercises'

const TABS: { id: Tab; label: string }[] = [
  { id: 'sessions', label: 'SESSIONS' },
  { id: 'exercises', label: 'EXERCISES' },
]

export default function HistoryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('sessions')

  return (
    <div className="px-4 pt-8 pb-12">
      {/* Page header */}
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        HISTORY
      </p>
      <h1
        className="text-3xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        HISTORY
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
      {activeTab === 'sessions' ? <HistorySessions /> : <HistoryExercises />}
    </div>
  )
}
