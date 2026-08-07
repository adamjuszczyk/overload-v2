import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'

// Stub destination for the "jump to exercise history" link on the gym screen
// (SPEC §4.3 / TASKS.md §4 item 15). Phase 3.4 replaces this with the real
// per-exercise chart + table view (SPEC §7) once the cross-meso history
// views exist — this just gives the link somewhere real to land for now.
export default function ExerciseHistoryPage() {
  const navigate = useNavigate()

  return (
    <div className="px-4 pt-8 pb-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 mb-6 text-xs font-bold tracking-widest"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        <ChevronLeft size={16} />
        BACK
      </button>
      <h1
        className="text-3xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        EXERCISE HISTORY
      </h1>
      <p className="mt-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
        Per-exercise history is coming in a future phase — this is a placeholder
        destination for the jump-to-history link.
      </p>
    </div>
  )
}
