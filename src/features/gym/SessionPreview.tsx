import { ArrowLeft } from 'lucide-react'
import type { WorkoutDay, WeekPlan } from '../../types'
import { useProgramExercises } from '../programs/usePrograms'
import { useExerciseReferenceSessions } from './useSession'
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
  // Chunk 7 — same week-preferring source as PlanPage.tsx's WorkoutDayPanel
  // and GymSession.tsx: the week's own exercise list when a week plan
  // exists for this preview, the program's own exercises otherwise (no
  // plan for this week yet — unaffected by this chunk).
  const { data: fallbackProgramExercises = [] } = useProgramExercises(workoutDay.id)
  const programExercises = weekPlan?.exercises ?? fallbackProgramExercises
  const sortedExercises = [...programExercises].sort((a, b) => a.position - b.position)

  // No active session yet — currentSessionId is null, same as the old
  // PreviewExerciseCard's own currentSessionId={null} usage.
  const {
    data: referenceSessionsByExercise,
    isLoading: referenceLoading,
    isError: referenceIsError,
    isFromCache: referenceIsFromCache,
    retry: retryReference,
  } = useExerciseReferenceSessions(
    workoutDay.id,
    programExercises.map((pe) => pe.exerciseId),
    null,
  )
  // No session row exists yet to read mesocycle_id off of — the upcoming
  // week plan's is the best available stand-in (null when there's no plan
  // for this week, e.g. an off-schedule preview); resolveSecondaryReference
  // degrades to `none_in_meso` rather than crashing on null, so this is
  // never worse than the feature simply not showing here.
  const previewMesocycleId = weekPlan?.mesocycleId ?? null

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
              referenceSessions={referenceSessionsByExercise.get(pe.exerciseId) ?? []}
              referenceLoading={referenceLoading}
              referenceMesocycleId={previewMesocycleId}
              referenceIsError={referenceIsError}
              referenceIsFromCache={referenceIsFromCache}
              onRetryReference={retryReference}
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
