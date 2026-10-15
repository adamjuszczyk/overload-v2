import TargetPickerSheet from './TargetPickerSheet'
import {
  draftFromRirTarget,
  periodTail,
  pickerEyebrow,
  rirTargetFromDraft,
  rirTargetSummary,
  type RirTarget,
  type TargetableSet,
} from './pickerLogic'

// The one RIR target picker (TASKS-1.2 chunk 39; board 7; SPEC "Targets [1.2]", 17: "NONE (clears it),
// NUMBER or RANGE, then the numbers, and 'Use for all N sets of [exercise]', as in the rep target
// picker ... 'Use for all' starts ticked ... values go well beyond 5"). It writes nothing: the footer
// button hands the caller a `RirTarget` and whether "Use for all" was ticked. The caller writes
// `rirTargetToColumns(target)` to the set, or to `applyToAllTargets(sets, ...)` when it was; the
// heads that list holds never include a warmup (SPEC, G49: a warmup row in Plan has no RIR target).
export interface RirTargetPickerResult {
  target: RirTarget
  /** "Use for all N sets of [exercise]" was ticked (it starts ticked, and isn't drawn when fewer than two sets would take it). */
  applyToAll: boolean
}

export interface RirTargetPickerProps {
  /** The eyebrow's `[EXERCISE] · SET NN`, and the name in "Use for all N sets of [exercise]". */
  exerciseName: string
  setNumber: number
  /** `WEEK N` in Plan (`CYCLE N` with `isCycle`). */
  weekNumber?: number
  isCycle?: boolean
  /** The set's RIR target now; the sheet opens on its segment and numbers. */
  value: RirTarget
  /** The exercise's head sets, this one included. The N in "Use for all N sets" counts the ones that aren't warmups. */
  sets: readonly TargetableSet[]
  onSubmit: (result: RirTargetPickerResult) => void
  /** Asked for by ×, a tap on the scrim and Escape. */
  onClose: () => void
}

export default function RirTargetPicker({ exerciseName, setNumber, weekNumber, isCycle, value, sets, onSubmit, onClose }: RirTargetPickerProps) {
  return (
    <TargetPickerSheet
      kind="rir"
      eyebrow={pickerEyebrow({ exerciseName, setNumber, tail: periodTail(weekNumber, isCycle) })}
      initial={draftFromRirTarget(value)}
      exerciseName={exerciseName}
      sets={sets}
      summaryOf={(draft) => rirTargetSummary(rirTargetFromDraft(draft))}
      onSubmit={(draft, applyToAll) => onSubmit({ target: rirTargetFromDraft(draft), applyToAll })}
      onClose={onClose}
    />
  )
}
