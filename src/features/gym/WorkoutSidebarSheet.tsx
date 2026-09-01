import { X } from 'lucide-react'
import { useQaSidebarStore } from '../coach/qaSidebarStore'
import QaPanel from '../coach/QaPanel'
import NotesPanel from './NotesPanel'

// The in-workout sidebar (QA-SIDEBAR-TASKS.md §8.1/§8.2) — sheet chrome
// moved here from WorkoutNotesSheet.tsx unchanged (fixed inset-0 backdrop,
// rounded-t-2xl sheet, grab-handle bar, maxHeight 70dvh, backdrop-click to
// dismiss), with WorkoutNotesSheet.tsx's static "SESSION NOTES" title
// replaced by a two-tab bar (NOTES | ASK, CoachPage.tsx's own tab-bar
// style). Presentational; NotesPanel and QaPanel own their own content and
// behaviour, this component only owns which tab is showing.

interface WorkoutSidebarSheetProps {
  sessionId: string
  onClose: () => void
}

const TABS = [
  { id: 'notes' as const, label: 'NOTES' },
  { id: 'ask' as const, label: 'ASK' },
]

export default function WorkoutSidebarSheet({ sessionId, onClose }: WorkoutSidebarSheetProps) {
  const { activeTab, setActiveTab } = useQaSidebarStore()

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full rounded-t-2xl px-4 pt-4 pb-10"
        style={{ backgroundColor: 'var(--base)', maxHeight: '70dvh', overflowY: 'auto' }}
      >
        <div
          className="mx-auto mb-4 rounded-full"
          style={{ width: 36, height: 4, backgroundColor: 'var(--border-strong)' }}
        />

        <div className="flex items-center justify-between gap-3 mb-4">
          <div className="flex flex-1 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex-1 py-2 text-xs font-bold tracking-widest"
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
          <button
            onClick={onClose}
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: 'var(--surface-overlay)',
              color: 'var(--text-secondary)',
            }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {activeTab === 'notes' ? (
          <NotesPanel sessionId={sessionId} />
        ) : (
          // No per-exercise entry point exists (this sheet opens from one
          // global header button, not from a specific ExerciseCard), so
          // currentExerciseId is null for every question asked from here —
          // §4.1 already treats it as optional ("when the UI knows it").
          <QaPanel category="in_session" sessionId={sessionId} currentExerciseId={null} />
        )}
      </div>
    </div>
  )
}
