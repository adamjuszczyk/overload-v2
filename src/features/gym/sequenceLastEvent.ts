import type { Session, WeekPlan } from '../../types'
import { effectiveDate } from './effectiveDate'
import { resolveNextSlot, type SequenceCycleItem, type SequenceLastEvent } from './sequenceSchedule'

// Chunk 35 (SPEC "Scheduling → Sequence" [P1.1]: "The current cycle is the
// one containing the next due workout. Cycles before it are past.") — the one
// rule Today (useSequenceScheduler.ts) and Plan (useSequenceCurrentCycle.ts)
// share for "where is this sequence run now": the last done-or-skipped
// session's own SLOT, then the next slot after it (resolveNextSlot). Both
// screens call resolveLastEvent with the same two query results, so they
// cannot disagree about it.
//
// resolveLastEvent is the step that lived inline in useSequenceScheduler.ts
// (chunk 25), moved here unchanged in behaviour.

// Resolve the last done-or-skipped session's own SLOT (chunk 25, reviewer's
// note 2: "read from that session's week plan sequence_position and
// week_number") — via its OWN week plan row, not re-derived from the sequence
// items list (an item's position can change if the cycle is edited; the
// PLANNED row's own sequence_position is what was actually trained).
// Defensive fallback to null (treated as "nothing ever trained") when the row
// can't be resolved — a null weekPlanId (pre-chunk-8 data, if any ever reaches
// a sequence run) or a weekday-shaped row with no sequencePosition, neither of
// which a real sequence session should ever produce.
//
// `lastDoneOrSkipped` is the result of the bounded last-event query
// (useLastDoneOrSkippedSession): only a completed or skipped session is ever
// handed in, so a workout in progress is never an event — it is simply the
// next slot (its own status isn't read here at all; anything not 'skipped'
// counts as 'completed', as it did inline).
export function resolveLastEvent(
  lastDoneOrSkipped: Pick<Session, 'weekPlanId' | 'status' | 'date' | 'movedToDate'> | null | undefined,
  allWeekPlans: ReadonlyArray<Pick<WeekPlan, 'id' | 'weekNumber' | 'sequencePosition'>>,
): SequenceLastEvent | null {
  if (!lastDoneOrSkipped?.weekPlanId) return null
  const wp = allWeekPlans.find((w) => w.id === lastDoneOrSkipped.weekPlanId)
  if (!wp || wp.sequencePosition == null) return null
  return {
    weekNumber: wp.weekNumber,
    sequencePosition: wp.sequencePosition,
    status: lastDoneOrSkipped.status === 'skipped' ? 'skipped' : 'completed',
    date: effectiveDate(lastDoneOrSkipped),
  }
}

// The cycle Plan treats as "current" on a sequence run: the cycle of the next
// due workout — the slot after the last done or skipped one, whether that
// workout is due yet or not (SPEC G40, TASKS-1.1 chunk 35). The same
// resolveNextSlot Today's scheduleSequence runs, so the two always agree.
// A sequence with no workout at all (every slot a rest, or no slots) has no
// next workout: the current cycle stays 1.
export function resolveCurrentCycle(items: SequenceCycleItem[], lastEvent: SequenceLastEvent | null): number {
  return resolveNextSlot(items, lastEvent)?.next.weekNumber ?? 1
}
