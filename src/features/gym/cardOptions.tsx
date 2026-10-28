import type { CSSProperties, ReactNode } from 'react'
import ExercisePickerSheet from '../../components/ExercisePickerSheet'
import { errorReason } from '../../components/exercisePickerLogic'
import type { Exercise, ProgramExercise } from '../../types'
import type { ExerciseOptions } from './WorkoutExerciseHeader'
import type { ExerciseCardState } from './useExerciseCardState'
import { optionsEyebrow, skipDescription, skipLabel, swapNote } from './exerciseOptions'

// Chunk 59 — what a card hands its exercise ⋯ (board W10) and its swap picker (W11): one place for ExerciseCard and SupersetBlock, so a
// plain card and a superset member offer the same rows by the same rules.

/** The rows the ⋯ offers on this card, and what each does. A row the card doesn't offer is null (and isn't drawn). */
export function cardOptions(state: ExerciseCardState, cardKey: string, programExercise: ProgramExercise): ExerciseOptions {
  const plan = state.skipPlan
  return {
    eyebrow: optionsEyebrow(state.cardRows, cardKey, programExercise.exercise?.muscleGroup),
    onSwap: state.canSwap ? () => state.setShowSwapSheet(true) : null,
    skip: plan.count > 0 ? { description: skipDescription(plan), label: skipLabel(plan.count), onConfirm: state.handleConfirmSkip } : null,
    onAddSet: state.canAddSet ? () => state.handleAddSet() : null,
  }
}

const ERROR_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }
const HEADLINE: CSSProperties = { margin: 0, fontSize: 13, fontWeight: 700, lineHeight: 1.4, color: 'var(--error)' }
const REASON: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }

/** An error as the app words it (SPEC Errors (15)): the headline, and under it the real reason: the message the server or the client returned. */
export function ErrorLine({ headline, error }: { headline: string; error: unknown }) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  return (
    <div role="alert" style={ERROR_STYLE}>
      <p style={HEADLINE}>{headline}</p>
      <p style={REASON}>{errorReason(error, offline)}</p>
    </div>
  )
}

/** W11: "Swap for what?" over the shared picker; a tap picks, SWAP FOR TODAY saves the swap (`state.handleConfirmSwap`), and a swap that isn't saved says why. */
export function SwapPickerSheet({
  state,
  programExercise,
  excludeExerciseIds,
}: {
  state: ExerciseCardState
  programExercise: ProgramExercise
  /** Every exercise already in the workout: the picker never lists them. */
  excludeExerciseIds: readonly string[]
}) {
  const exercise = programExercise.exercise
  const note = (picked: Exercise | null): ReactNode => (
    <>
      <span style={{ display: 'block' }}>{swapNote(state.swapMoves, picked?.name ?? null)}</span>
      {state.swapError !== null && <ErrorLine headline="Couldn't swap." error={state.swapError} />}
    </>
  )
  return (
    <ExercisePickerSheet
      mode="swap"
      replacing={{ id: programExercise.exerciseId, muscleGroup: exercise?.muscleGroup ?? null }}
      eyebrow={`${(exercise?.name ?? 'this exercise').toUpperCase()} · TODAY ONLY`}
      title="Swap for what?"
      exclude={excludeExerciseIds}
      showGroup={false}
      onCreate={() => {}}
      confirmLabel="SWAP FOR TODAY"
      confirmNote={note}
      onPick={(picked) => void state.handleConfirmSwap(picked)}
      onClose={() => {
        state.clearSwapError()
        state.setShowSwapSheet(false)
      }}
    />
  )
}
