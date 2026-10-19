import { useState } from 'react'
import ExerciseProgress from './ExerciseProgress'
import MesoProgress from './MesoProgress'

type Tab = 'exercise' | 'meso'

const TABS: { id: Tab; label: string }[] = [
  { id: 'exercise', label: 'EXERCISE' },
  { id: 'meso', label: 'MESO OVERVIEW' },
]

export default function ProgressPage() {
  const [activeTab, setActiveTab] = useState<Tab>('exercise')

  return (
    <div className="px-4 pt-8 pb-12">
      {/* Page header */}
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        ANALYTICS
      </p>
      <h1
        className="text-3xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        PROGRESS
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
      {activeTab === 'exercise' ? <ExerciseProgress /> : <MesoProgress />}
    </div>
  )
}
