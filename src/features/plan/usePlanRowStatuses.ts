import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../auth/useAuth'
import { fetchPlanRowStatuses } from '../programs/changeProgramService'
import { DONE_WEEK_PLANS_KEY } from './useDoneWeekPlanIds'

// Which of a run's plan rows have a session that is done, skipped or in progress, and which of the two: the status the "CHANGE THE
// PROGRAM FROM WEEK N" button at the foot of the week panel needs (DECISIONS 172 (j), Adam, 2026-10-19: "The button follows the
// screen."). A row missing from the map is not started.
//
// It is the screen's own read, `fetchPlanRowStatuses` (changeProgramService.ts), and not a second one beside it: the screen
// names the week of the first session that has not started ("a session in progress is left as it is, so changes start the week
// after"), and the button must name the same week. `useDoneWeekPlanIds` cannot tell the button that: it knows the rows that are
// done, which is what locks a row, and a session in progress doesn't lock one.
//
// The key sits under the done list's own prefix, so every place that refreshes that list (starting a session, finishing, reopening,
// skipping, moving: `useSession.ts`, `useHistory.ts`) refreshes this one too. The list is small, and the session that starts is
// the case this exists for.
export type PlanRowStatuses = ReadonlyMap<string, 'done' | 'in_progress'>

const NONE: PlanRowStatuses = new Map()

export function usePlanRowStatuses(mesoId: string | undefined): PlanRowStatuses {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: [DONE_WEEK_PLANS_KEY, 'statuses', mesoId],
    queryFn: () => fetchPlanRowStatuses(mesoId!),
    enabled: !!user && !!mesoId,
  })
  return data ?? NONE
}
