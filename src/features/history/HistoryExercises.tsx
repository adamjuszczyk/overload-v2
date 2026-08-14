import { useState } from 'react'
import { ChevronLeft } from 'lucide-react'
import ExercisePicker from '../progress/ExercisePicker'
import ExerciseHistoryView from './ExerciseHistoryView'
import type { Exercise } from '../../types'

// Exercises tab (CONTEXT.md "History: Sessions/Exercises tab split") — the
// exercise-specific chart + SIDE BY SIDE view, now reached directly from its
// own tab instead of a collapsible search inside the Sessions tab (the old
// FIND EXERCISE HISTORY toggle, now superseded — see CONTEXT.md). Same
// picker-then-detail-with-back pattern Progress's own EXERCISE tab uses
// (ExerciseProgress.tsx), reusing the identical ExercisePicker component
// rather than a second implementation.
export default function HistoryExercises() {
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null)

  if (selectedExercise) {
    return (
      <div>
        <button
          onClick={() => setSelectedExercise(null)}
          className="flex items-center gap-1 mt-5 text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          <ChevronLeft size={16} />
          BACK
        </button>
        <ExerciseHistoryView exerciseId={selectedExercise.id} />
      </div>
    )
  }

  return (
    <>
      <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
        Select an exercise to view its history.
      </p>
      <ExercisePicker onSelect={setSelectedExercise} />
    </>
  )
}
