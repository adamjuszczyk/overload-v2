import type { ProgramExercise } from '../../types'

export default function ExerciseHeader({ programExercise }: { programExercise: ProgramExercise }) {
  const ex = programExercise.exercise
  return (
    <div className="px-4 pt-3 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
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
  )
}
