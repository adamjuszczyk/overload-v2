import { useRef, useState } from 'react'
import SetTypePicker from '../../components/pickers/SetTypePicker'
import type { SetType } from '../../components/pickers/pickerLogic'
import { errorReason } from '../../components/exercisePickerLogic'
import type { SessionSetChangeType } from '../../types'
import { useToastStore } from '../notifications/toastStore'
import DeleteSetConfirm from './DeleteSetConfirm'
import { fromPickerType, toPickerType, type TypeConfirm } from './setTypeChange'
import type { ExerciseCardState } from './useExerciseCardState'
import type { ResolvedRow } from './workoutRules'

// Chunk 62 (TASKS-1.2 62; board W7a "Set type, changed in a workout"; SPEC [1.2] "Set type during a workout (19), (19c)"): the one set type picker in its workout
// variant ("What is this set?" over `LAT PULLDOWN · SET 03 · THIS WORKOUT`, the six types, the stepper under a staged kind, "Changes this workout only ...")
// opened from a set's ⋯ (an upcoming or current set) or from the edit panel's SET TYPE row (a logged one).
//
// The picker writes nothing and neither does this: every pick is asked of the card (`changeSetType`: 46r's `applySetTypeChange`, then `runTypeChange`'s writes),
// the picker keeps showing what is true (`value` is the row's type, which the rows give back once the change is written), and a tap while a change is out is
// ignored. Two things come back instead of "done": a question (19c: the pick would delete logged drops, so the W9 dialog asks first; CANCEL leaves the set and
// the picker as they were) and a failure (the real reason, in a toast like the cues sheet's: SPEC Errors (15); in the dialog when the question had been asked).
//
// In HOLD mode (`onHold`) nothing is asked of the card: the edit panel of a warmup logged with no weight or reps keeps the pick until SAVE, which writes the type
// with the weight and reps in one request (DECISIONS 152 (a)), so the picker only hands the pick back.
//
// Display choices no board settles, provisional under D31: the question's words and its button ("Delete the 2 logged drops?" over W9's note, DELETE 2 DROPS), the
// failure as a toast, the eyebrow's number (the row's: a warmup's is its W number).
export interface WorkoutSetTypeSheetProps {
  row: ResolvedRow
  state: ExerciseCardState
  /** The type to draw: the row's, or the pick the panel is holding. */
  value: SessionSetChangeType
  /** Hold mode: called with each pick instead of writing it. */
  onHold?: (pick: SessionSetChangeType) => void
  onClose: () => void
}

export default function WorkoutSetTypeSheet({ row, state, value, onHold, onClose }: WorkoutSetTypeSheetProps) {
  const showToast = useToastStore((s) => s.show)
  const [asking, setAsking] = useState<{ pick: SessionSetChangeType; confirm: TypeConfirm } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ headline: string; reason: string } | null>(null)
  // One change at a time: a ref, because two taps in one instant both read the state before React draws.
  const inFlight = useRef(false)
  const offline = () => typeof navigator !== 'undefined' && navigator.onLine === false

  async function choose(next: SetType) {
    const pick = fromPickerType(next)
    if (onHold !== undefined) {
      onHold(pick)
      return
    }
    if (inFlight.current || asking !== null) return
    inFlight.current = true
    try {
      const result = await state.changeSetType(row, pick)
      if (result.kind === 'confirm') {
        setError(null)
        setAsking({ pick, confirm: result.confirm })
      }
    } catch (err) {
      console.error('[workout] set type change failed', err)
      showToast(`Couldn't change the set type. ${errorReason(err, offline())}`)
    } finally {
      inFlight.current = false
    }
  }

  async function confirm() {
    if (asking === null || inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      await state.changeSetType(row, asking.pick, { confirmed: true })
      setAsking(null)
    } catch (err) {
      console.error('[workout] set type change failed', err)
      setError({ headline: "Couldn't change the set type.", reason: errorReason(err, offline()) })
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return (
    <>
      <SetTypePicker context="workout" exerciseName={row.exerciseName} setNumber={row.number} value={toPickerType(value)} onChange={(next) => void choose(next)} onClose={onClose} />
      {asking !== null && (
        <DeleteSetConfirm
          eyebrow={asking.confirm.eyebrow}
          title={asking.confirm.title}
          body={asking.confirm.body}
          confirmLabel={asking.confirm.confirmLabel}
          pending={pending}
          error={error}
          onConfirm={() => void confirm()}
          onCancel={() => setAsking(null)}
        />
      )}
    </>
  )
}
