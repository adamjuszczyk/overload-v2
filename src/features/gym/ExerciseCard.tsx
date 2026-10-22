import { Plus } from 'lucide-react'
import WorkoutExerciseHeader from './WorkoutExerciseHeader'
import SwapExerciseSheet from './SwapExerciseSheet'
import { CardRows } from './WorkoutRow'
import { useExerciseCardState, type ExerciseCardProps } from './useExerciseCardState'

// Chunk 58a — a plain exercise's card: its header and reference, then its rows as the session's rules draw them (`useWorkoutRows`:
// warmups, working sets with their drops, the sets added in the session), + ADD SET, and today's skip-the-rest and swap (chunk 59
// moves them to the exercise ⋯). Every computation and writer is in useExerciseCardState.ts, which SupersetBlock.tsx calls too.
export default function ExerciseCard(props: ExerciseCardProps) {
  const {
    programExercise,
    workout,
    referenceSessions,
    referenceLoading,
    referenceScheduleType,
    referenceIsError,
    referenceIsFromCache,
    onRetryReference,
    today,
    swappedFrom,
    slotSwapped,
  } = props
  const state = useExerciseCardState(props)

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* The name, the "LAST = …" line and the history icon; the line and the icon open the last-time sheet (chunk 58b). The plan's targets are
          in the rows (PlanTargetsPanel is gone). */}
      <WorkoutExerciseHeader
        programExercise={programExercise}
        onSwapClick={swappedFrom || slotSwapped ? undefined : () => state.setShowSwapSheet(true)}
        swappedFromName={swappedFrom?.exerciseName}
        today={today}
        scheduleType={referenceScheduleType ?? 'weekday'}
        sessions={referenceSessions}
        isLoading={referenceLoading}
        isError={referenceIsError}
        isFromCache={referenceIsFromCache}
        onRetry={onRetryReference}
        unit={state.resolvedWeightUnit}
      />

      <div className="px-3 py-3 space-y-1.5">
        <CardRows state={state} rows={state.cardRows} current={workout.current} />

        <button
          onClick={state.handleAddSet}
          className="w-full flex items-center justify-center gap-2 rounded-lg text-xs font-bold tracking-widest"
          style={{ minHeight: 44, border: '1px dashed var(--border)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          <Plus size={12} />
          ADD SET
        </button>

        {/* Skip whole exercise — planned sets only, see handleSkipExercise */}
        {state.hasUnfinishedPlannedWork &&
          (state.showSkipConfirm ? (
            <div className="flex gap-2">
              <button
                onClick={() => state.setShowSkipConfirm(false)}
                disabled={state.isSkippingExercise}
                className="flex-1 py-3 rounded-lg text-xs font-bold tracking-widest"
                style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                CANCEL
              </button>
              <button
                onClick={state.handleConfirmSkip}
                disabled={state.isSkippingExercise}
                className="flex-1 py-3 rounded-lg text-xs font-bold tracking-widest"
                style={{ backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)', color: 'var(--error)', fontFamily: 'var(--font-mono)' }}
              >
                CONFIRM SKIP
              </button>
            </div>
          ) : (
            <button
              onClick={() => state.setShowSkipConfirm(true)}
              disabled={state.isSkippingExercise}
              className="w-full flex items-center justify-center gap-2 rounded-lg text-xs font-bold tracking-widest"
              style={{ minHeight: 44, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', opacity: state.isSkippingExercise ? 0.6 : 1 }}
            >
              {state.isSkippingExercise ? 'SKIPPING…' : 'SKIP REST OF EXERCISE'}
            </button>
          ))}
      </div>

      {state.showSwapSheet && (
        <SwapExerciseSheet
          currentExerciseId={programExercise.exerciseId}
          currentExerciseName={programExercise.exercise?.name ?? 'this exercise'}
          muscleGroup={programExercise.exercise?.muscleGroup ?? 'other'}
          remainingSetCount={state.remainingPlannedCount}
          onConfirm={state.handleConfirmSwap}
          onClose={() => state.setShowSwapSheet(false)}
        />
      )}
    </div>
  )
}
