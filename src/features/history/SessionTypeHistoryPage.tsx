import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import SessionTypeHistoryView from './SessionTypeHistoryView'

// Route wrapper for "view every occurrence of this session type", reached
// from SessionDetail.tsx (Phase 3.4 item 21). Same shell as
// ExerciseHistoryPage.tsx — SessionTypeHistoryView owns everything below
// the header.
export default function SessionTypeHistoryPage() {
  const navigate = useNavigate()
  const { workoutDayId } = useParams<{ workoutDayId: string }>()

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
      {workoutDayId && <SessionTypeHistoryView workoutDayId={workoutDayId} />}
    </div>
  )
}
