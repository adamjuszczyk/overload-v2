import { format, subDays, isAfter, parseISO } from 'date-fns'
import { useWorkoutDays } from '../programs/usePrograms'
import { useSequenceItems } from '../programs/usePrograms'
import { useAllWeekPlans } from '../plan/useWeekPlan'
import { useSessionsInRange, useLastDoneOrSkippedSession } from './useSession'
import { effectiveDate } from './effectiveDate'
import { scheduleSequence, type SequenceScheduleResult, type SequenceLastEvent, type SequenceCycleItem } from './sequenceSchedule'
import type { Mesocycle, WorkoutDay, WeekPlan } from '../../types'

// Chunk 25 — the sequence-run counterpart to useScheduler.ts (weekday).
// Gathers the small amount of history scheduleSequence.ts needs and hands
// it in (same "caller gathers, pure module decides" posture useScheduler.ts
// itself already takes for schedule()). Deliberately NOT a branch inside
// useScheduler.ts/schedule() itself — that function and its own tests stay
// completely untouched (D30/render-parity for a weekday run), this is a
// wholly separate hook SequenceTodayPage.tsx (TodayPage.tsx's own early
// branch) is the only caller of.
const LOOKBACK_DAYS = 7

export interface SequenceSchedulerData {
  result: SequenceScheduleResult | null
  isLoading: boolean
  workoutDays: WorkoutDay[]
  // This cycle's and every other cycle's own planned rows (useAllWeekPlans
  // — same meso-wide query the weekday scheduler/Plan screen already read
  // elsewhere, TanStack dedupes by key) — resolves a `next`/`active`
  // result's own weekPlan (null = not planned yet, same "no plan" case the
  // weekday scheduler's own suggest_no_plan handles).
  allWeekPlans: WeekPlan[]
}

export function useSequenceScheduler(today: string, activeMeso: Mesocycle | null, programId: string): SequenceSchedulerData {
  const { data: workoutDays } = useWorkoutDays(programId)
  const { data: sequenceItemsRaw } = useSequenceItems(programId)
  const { data: allWeekPlans } = useAllWeekPlans(activeMeso?.id ?? '')
  const { data: lastDoneOrSkipped } = useLastDoneOrSkippedSession(activeMeso?.id ?? '')

  // Same bounded lookback window useScheduler.ts's own active/completed-
  // today detection uses — an in-progress or just-completed session is
  // always recent; the UNBOUNDED-cadence "last done or skipped" lookup
  // above is the one that can reach further back (useLastDoneOrSkippedSession's
  // own header on why that's a separate, single-row query instead).
  const lookbackStart = activeMeso
    ? format(
        isAfter(parseISO(activeMeso.startDate), subDays(parseISO(today), LOOKBACK_DAYS))
          ? parseISO(activeMeso.startDate)
          : subDays(parseISO(today), LOOKBACK_DAYS),
        'yyyy-MM-dd',
      )
    : today
  const { data: sessions } = useSessionsInRange(lookbackStart, today)

  const isLoading =
    !activeMeso || !workoutDays || !sequenceItemsRaw || !allWeekPlans || lastDoneOrSkipped === undefined || !sessions

  if (isLoading) {
    return { result: null, isLoading: true, workoutDays: [], allWeekPlans: [] }
  }

  const items: SequenceCycleItem[] = sequenceItemsRaw.map((i) => ({ position: i.position, workoutDayId: i.workoutDayId }))

  // Resolve the last done-or-skipped session's own SLOT (reviewer's note 2:
  // "read from that session's week plan sequence_position and week_number")
  // — via its OWN week plan row, not re-derived from the sequence items
  // list (an item's position can change if the cycle is edited; the
  // PLANNED row's own sequence_position is what was actually trained).
  // Defensive fallback to null (treated as "nothing ever trained") when the
  // row can't be resolved — a null weekPlanId (pre-chunk-8 data, if any
  // ever reaches a sequence run) or a weekday-shaped row with no
  // sequencePosition, neither of which a real sequence session should ever
  // produce.
  let lastEvent: SequenceLastEvent | null = null
  if (lastDoneOrSkipped?.weekPlanId) {
    const wp = allWeekPlans.find((w) => w.id === lastDoneOrSkipped.weekPlanId)
    if (wp && wp.sequencePosition != null) {
      lastEvent = {
        weekNumber: wp.weekNumber,
        sequencePosition: wp.sequencePosition,
        status: lastDoneOrSkipped.status === 'skipped' ? 'skipped' : 'completed',
        date: effectiveDate(lastDoneOrSkipped),
      }
    }
  }

  const result = scheduleSequence(today, { items, sessions, lastEvent })
  return { result, isLoading: false, workoutDays, allWeekPlans }
}
