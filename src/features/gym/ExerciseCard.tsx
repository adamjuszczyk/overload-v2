import { Plus } from 'lucide-react'
import WorkoutExerciseHeader from './WorkoutExerciseHeader'
import { CardRows } from './WorkoutRow'
import { cardOptions, SwapPickerSheet } from './cardOptions'
import { useExerciseCardState, type ExerciseCardProps } from './useExerciseCardState'

// Chunk 58a — a plain exercise's card: its header and reference, then its rows as the session's rules draw them (`useWorkoutRows`:
// warmups, working sets with their drops, the sets added in the session) and + ADD SET. Chunk 59 (boards W5, W10, W11): the swap and the
// skip of the rest of the exercise moved into the header's ⋯ (`ExerciseOptionsSheet`, with Add a set and the exercise's history), and
// the swap's picker is the shared one (`SwapPickerSheet`). The card a swap moved sets from has no + ADD SET (W5). Every computation and
// writer is in useExerciseCardState.ts, which SupersetBlock.tsx calls too.
export default function ExerciseCard(props: ExerciseCardProps) {
  const {
    cardKey,
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
    addedToday,
    excludeExerciseIds = [],
  } = props
  const state = useExerciseCardState(props)

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {/* The name, the "LAST = …" line and the history icon; the line and the icon open the last-time sheet (chunk 58b), the ⋯ the exercise's
          options (chunk 59). The plan's targets are in the rows (PlanTargetsPanel is gone). */}
      <WorkoutExerciseHeader
        programExercise={programExercise}
        options={cardOptions(state, cardKey, programExercise)}
        swappedFromName={swappedFrom?.exerciseName}
        addedToday={addedToday}
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

        {state.canAddSet && (
          <button
            onClick={state.handleAddSet}
            className="w-full flex items-center justify-center gap-2 rounded-lg text-xs font-bold tracking-widest"
            style={{ minHeight: 44, border: '1px dashed var(--border)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            <Plus size={12} />
            ADD SET
          </button>
        )}
      </div>

      {state.showSwapSheet && <SwapPickerSheet state={state} programExercise={programExercise} excludeExerciseIds={excludeExerciseIds} />}
    </div>
  )
}
