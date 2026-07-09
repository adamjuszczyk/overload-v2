import { ArrowLeft } from 'lucide-react'
import type { WorkoutDay, WeekPlan } from '../../types'
import { useProgramExercises, useExerciseOccurrenceCounts } from '../programs/usePrograms'
import PreviewExerciseCard from './PreviewExerciseCard'

interface SessionPreviewProps {
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | null
  weekNumber: number
  today: string
  isStarting: boolean
  onBack: () => void
  onStart: () => void
}

// Read-only walkthrough of what START SESSION would open — same exercise
// order and plan targets, no inputs, no timer, no writes until confirmed.
export default function SessionPreview({
  workoutDay,
  weekPlan,
  weekNumber,
  today,
  isStarting,
  onBack,
  onStart,
}: SessionPreviewProps) {
  const { data: programExercises = [] } = useProgramExercises(workoutDay.id)
  const occurrenceCounts = useExerciseOccurrenceCounts(workoutDay.programId)
  const sortedExercises = [...programExercises].sort((a, b) => a.position - b.position)

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="px-4 pt-8 pb-4">
        <button
          onClick={onBack}
          className="flex items-center justify-center mb-4"
          style={{
            width: 36,
            height: 36,
            backgroundColor: 'var(--surface-overlay)',
            border: '1px solid var(--border-strong)',
            borderRadius: 9,
            color: 'var(--text-secondary)',
          }}
          aria-label="Back to Today"
        >
          <ArrowLeft size={16} />
        </button>

        <p
          className="text-xs font-bold tracking-widest mb-1"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {weekPlan?.isDeload ? 'DELOAD · ' : ''}WEEK {weekNumber}
        </p>
        <h1
          className="text-3xl font-black tracking-tight"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {workoutDay.name}
        </h1>
        <span
          className="inline-block mt-2 px-2 py-1 rounded text-xs font-bold tracking-widest"
          style={{ border: '1px dashed var(--accent)', color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          PREVIEW · NOTHING LOGGED YET
        </span>
      </div>

      {/* Exercise cards — read only */}
      <div className="px-4 space-y-4">
        {sortedExercises.map((pe) => {
          const plannedSets = (weekPlan?.sets ?? [])
            .filter((s) => s.programExerciseId === pe.id)
            .sort((a, b) => a.setNumber - b.setNumber)

          return (
            <PreviewExerciseCard
              key={pe.id}
              programExercise={pe}
              plannedSets={plannedSets}
              workoutDayId={workoutDay.id}
              occurrenceCount={occurrenceCounts.get(pe.exerciseId) ?? 1}
              today={today}
            />
          )
        })}
      </div>

      {/* Start session */}
      <div className="px-4 mt-6">
        <button
          onClick={onStart}
          disabled={isStarting}
          className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
          style={{
            backgroundColor: 'var(--accent)',
            color: 'var(--base)',
            fontFamily: 'var(--font-mono)',
            opacity: isStarting ? 0.6 : 1,
          }}
        >
          {isStarting ? 'STARTING…' : 'START SESSION'}
        </button>
      </div>
    </div>
  )
}
