import { useNavigate } from 'react-router-dom'
import { History } from 'lucide-react'
import type { ProgramExercise } from '../../types'

export default function ExerciseHeader({ programExercise }: { programExercise: ProgramExercise }) {
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
      <button
        onClick={() => navigate(`/exercise/${programExercise.exerciseId}`)}
        aria-label="View exercise history"
        className="flex-shrink-0 flex items-center justify-center"
        style={{ width: 28, height: 28, color: 'var(--text-muted)' }}
      >
        <History size={15} />
      </button>
    </div>
  )
}
