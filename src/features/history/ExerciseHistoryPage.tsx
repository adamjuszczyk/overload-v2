import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import ExerciseHistoryView from './ExerciseHistoryView'

// Route wrapper for the "jump to exercise history" link on the gym screen
// (SPEC §4.3 / TASKS.md §4 item 15) — wired to the real per-exercise chart +
// table view (SPEC §7) as of Phase 3.4 item 22. Same BACK-button shell as
// before; ExerciseHistoryView owns everything below the header.
export default function ExerciseHistoryPage() {
  const navigate = useNavigate()
  const { exerciseId } = useParams<{ exerciseId: string }>()

  return (
    <div className="px-4 pt-8 pb-12">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 mb-6 text-xs font-bold tracking-widest"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        <ChevronLeft size={16} />
        BACK
      </button>
      {exerciseId && <ExerciseHistoryView exerciseId={exerciseId} />}
    </div>
  )
}
