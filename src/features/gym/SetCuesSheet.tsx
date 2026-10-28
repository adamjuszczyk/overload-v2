import CuesSheet, { type CuesSheetResult } from '../../components/pickers/CuesSheet'
import { useToastStore } from '../notifications/toastStore'
import type { WeekPlanSet } from '../../types'
import { errorReason } from '../../components/exercisePickerLogic'
import { useAllWeekPlans } from '../plan/useWeekPlan'
import { cuePatches } from '../plan/planSetRows'
import { writeCuePatches } from './setCues'

// Chunk 61 (TASKS-1.2 61; SPEC [1.2] Tags / cues; boards W7 → 8): the cues sheet the set ⋯'s CUES row opens, over the shared `CuesSheet`. DONE
// writes the planned set's tags through Plan's own writer (`cuePatches`, `updateSet`: `setCues.ts`), on this week's row only; "Use for all" adds each
// cue to every working head of the exercise this workout still has (`applyTagToAllHeads`, so a warmup or a drop is never written and no cue is
// removed from another set). It is mounted only while it is open, so the workout screen reads the run's cues and week plans only when a person
// asks for them: the run's own cues (`runCues`, every tag of the run's week sets) come from the every-week list Today already holds.
//
// Display choice no board settles, provisional under D31: a write that is refused puts the old cues back and says so in a toast ("Couldn't save the
// cue.") with the real reason, as the toast says a session was completed automatically; Plan puts them back without a word.

export interface SetCuesSheetProps {
  exerciseName: string
  /** The number the eyebrow names (`SET 03`). */
  setNumber: number
  /** The planned set whose tags these are: this week's row of the set. */
  planned: WeekPlanSet
  /** The exercise's working heads that this workout still has (the sheet's N of "Use for all N sets"; the heads it writes to). */
  heads: readonly WeekPlanSet[]
  /** The run and the week the cues belong to; the caches that hold the plan are named by them. */
  mesocycleId: string | null
  weekNumber: number
  isCycle: boolean
  onClose: () => void
}

export default function SetCuesSheet({ exerciseName, setNumber, planned, heads, mesocycleId, weekNumber, isCycle, onClose }: SetCuesSheetProps) {
  const { data: allWeekPlans = [] } = useAllWeekPlans(mesocycleId ?? '')
  const showToast = useToastStore((s) => s.show)
  const runCues = allWeekPlans.flatMap((plan) => plan.sets.flatMap((set) => set.tags ?? []))

  function done(result: CuesSheetResult) {
    const patches = cuePatches({ set: planned, heads, cues: result.cues, applyToAll: result.applyToAll })
    onClose()
    writeCuePatches(patches, mesocycleId).catch((err: unknown) => {
      console.error('[workout] cue write failed', err)
      showToast(`Couldn't save the cue. ${errorReason(err, typeof navigator !== 'undefined' && navigator.onLine === false)}`)
    })
  }

  return (
    <CuesSheet
      exerciseName={exerciseName}
      setNumber={setNumber}
      weekNumber={weekNumber}
      isCycle={isCycle}
      value={planned.tags}
      runCues={runCues}
      sets={heads}
      onDone={done}
      onClose={onClose}
    />
  )
}
