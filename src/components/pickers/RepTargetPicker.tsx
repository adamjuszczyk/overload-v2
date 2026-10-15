import type { RepTarget } from '../../lib/plannerVocabulary'
import TargetPickerSheet from './TargetPickerSheet'
import {
  draftFromRepTarget,
  periodTail,
  pickerEyebrow,
  repTargetFromDraft,
  repTargetSummary,
  type TargetableSet,
} from './pickerLogic'

// The one rep target picker (TASKS-1.2 chunk 39; boards 6 and PP3d; SPEC "Targets [1.2]": "NONE /
// NUMBER / RANGE / AMRAP, then the numbers; 'Use for all N sets of [exercise]' applies it to every set
// of that exercise"). It writes nothing: the footer button hands the caller a `RepTarget` and whether
// "Use for all" was ticked, and the caller writes it to the set, or to `applyToAllTargets(sets, ...)`
// when it was. The caller mounts the sheet to open it and unmounts it to close it (outside clickable
// parents: React events from inside BottomSheet's portal still bubble to whatever rendered it).
export interface RepTargetPickerResult {
  target: RepTarget
  /** "Use for all N sets of [exercise]" was ticked (it starts ticked, and isn't drawn when there is only one set). */
  applyToAll: boolean
}

export interface RepTargetPickerProps {
  /** The eyebrow's `[EXERCISE] · SET NN`, and the name in "Use for all N sets of [exercise]". */
  exerciseName: string
  setNumber: number
  /** `WEEK N` in Plan (`CYCLE N` with `isCycle`); the stepped planner's picker names no week (PP3d). */
  weekNumber?: number
  isCycle?: boolean
  /** The set's rep target now; the sheet opens on its segment and numbers. */
  value: RepTarget
  /** The exercise's head sets, this one included. A rep target goes to every head, a warmup too. */
  sets: readonly TargetableSet[]
  onSubmit: (result: RepTargetPickerResult) => void
  /** Asked for by ×, a tap on the scrim and Escape. */
  onClose: () => void
}

export default function RepTargetPicker({ exerciseName, setNumber, weekNumber, isCycle, value, sets, onSubmit, onClose }: RepTargetPickerProps) {
  return (
    <TargetPickerSheet
      kind="reps"
      eyebrow={pickerEyebrow({ exerciseName, setNumber, tail: periodTail(weekNumber, isCycle) })}
      initial={draftFromRepTarget(value)}
      exerciseName={exerciseName}
      sets={sets}
      summaryOf={(draft) => repTargetSummary(repTargetFromDraft(draft))}
      onSubmit={(draft, applyToAll) => onSubmit({ target: repTargetFromDraft(draft), applyToAll })}
      onClose={onClose}
    />
  )
}
