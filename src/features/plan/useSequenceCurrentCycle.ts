import { useSequenceItems } from '../programs/usePrograms'
import { useLastDoneOrSkippedSession } from '../gym/useSession'
import { resolveLastEvent, resolveCurrentCycle } from '../gym/sequenceLastEvent'
import { useAllWeekPlans } from './useWeekPlan'

// Chunk 35 (SPEC Scheduling → Sequence [P1.1], G40: "The current cycle is the
// one containing the next due workout. Cycles before it are past.") — Plan's
// current week on a SEQUENCE run. The same three reads Today's
// useSequenceScheduler.ts makes (the run's sequence, every week plan of the
// meso, and the last workout done or skipped — the very same TanStack query
// keys, so a screen that has already loaded them costs nothing here) feed the
// same pure rule (sequenceLastEvent.ts), so Plan and Today agree on the cycle
// by construction.
//
// The cycle is null until all three have answered. It is unknown then, and a
// guess would be wrong in the way that matters: cycle 1 marked current and
// editable on a run that is in cycle 4, until the query lands. The caller
// (PlanPage's SequencePlanPage) shows its loading spinner for that moment
// instead of any cycle.
//
// `failed` is true when there is no cycle because a read errored and has
// nothing to show (no data of any age): waiting would never end, and guessing
// (the calendar week, or cycle 1) would plan the wrong cycle, so the caller
// shows the app's load error and plans nothing. A read that failed on a
// REFETCH still has its earlier data, and the cycle is named from that, as
// Today does. Both are provisional display choices (D31), recorded in the
// chunk report.
//
// Weekday runs never call this: their current week is the calendar week
// (PlanPage's computeWeekNumber), and PlanPage mounts this only for a sequence
// run, so a weekday run makes no last-event read at all.
export interface SequenceCurrentCycle {
  cycle: number | null
  failed: boolean
}

export function useSequenceCurrentCycle(mesoId: string, programId: string): SequenceCurrentCycle {
  const itemsRead = useSequenceItems(programId)
  const plansRead = useAllWeekPlans(mesoId)
  const lastEventRead = useLastDoneOrSkippedSession(mesoId)
  const { data: items } = itemsRead
  const { data: allWeekPlans } = plansRead
  const { data: lastDoneOrSkipped } = lastEventRead

  // Same "still loading" test useSequenceScheduler.ts applies: `null` is a
  // real answer for the last-event query (nothing done or skipped yet),
  // `undefined` is not.
  if (!items || !allWeekPlans || lastDoneOrSkipped === undefined) {
    const failed = [itemsRead, plansRead, lastEventRead].some((read) => read.isError === true && read.data === undefined)
    return { cycle: null, failed }
  }

  return { cycle: resolveCurrentCycle(items, resolveLastEvent(lastDoneOrSkipped, allWeekPlans)), failed: false }
}
