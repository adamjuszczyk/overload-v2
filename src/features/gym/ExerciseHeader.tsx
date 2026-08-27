import { useNavigate } from 'react-router-dom'
import { History, Repeat2 } from 'lucide-react'
import type { ProgramExercise } from '../../types'

export default function ExerciseHeader({
  programExercise,
  onSwapClick,
}: {
  programExercise: ProgramExercise
  // Exercise-level, not per-set (SPEC v1.1 "Part C") — this header is the
  // one place on the workout screen that already represents "this whole
  // exercise" rather than one set of it, unlike SetRow's per-set `▼ MORE`
  // drawer (RIR/form/SKIP), so the swap trigger lives here alongside the
  // existing per-exercise History action, not there. Optional and omitted
  // by PreviewExerciseCard.tsx's read-only mirror of this header (no LOG/
  // ADD SET there either — swapping only makes sense in a live session).
  onSwapClick?: () => void
}) {
  const ex = programExercise.exercise
  const navigate = useNavigate()
  return (
    <div
      className="px-4 pt-3 pb-2 flex items-start justify-between"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <div>
        <div className="flex items-baseline gap-2">
          <span
            className="font-black text-base"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {ex?.name ?? '—'}
          </span>
          {programExercise.targetReps && (
            <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {programExercise.targetReps} REPS
            </span>
          )}
        </div>
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {ex?.muscleGroup?.toUpperCase()}
        </span>
      </div>
      <div className="flex-shrink-0 flex items-center">
        {onSwapClick && (
          <button
            onClick={onSwapClick}
            aria-label="Swap exercise for this session"
            className="flex items-center justify-center"
            style={{ width: 28, height: 28, color: 'var(--text-muted)' }}
          >
            <Repeat2 size={15} />
          </button>
        )}
        <button
          onClick={() => navigate(`/exercise/${programExercise.exerciseId}`)}
          aria-label="View exercise history"
          className="flex items-center justify-center"
          style={{ width: 28, height: 28, color: 'var(--text-muted)' }}
        >
          <History size={15} />
        </button>
      </div>
    </div>
  )
}
