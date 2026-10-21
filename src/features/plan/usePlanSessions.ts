import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { DONE_WEEK_PLANS_KEY } from './useDoneWeekPlanIds'
import type { PlanSession } from './weekViewLogic'
import type { SessionStatus } from '../../types'

// Chunk 54b (board 10, board 1c: a session's chip says ✓, SKIPPED or MOVED; its header says ✓ DONE, SKIPPED or MOVED → THU). The
// sessions of a run that belong to a plan row, with only what the week view reads, so Plan knows which are done, skipped, started or
// moved without a read per week. A weekday run's sessions are matched to a chip by plan row and date, a sequence run's by plan row
// (weekViewLogic.ts's `sessionStateOf`).
//
// Paged (ordered, `.range()` until a short page): a run's sessions are bounded in practice, but every history read pages under
// PostgREST's max_rows (Checks that lied #31).
//
// The key sits under the done list's own prefix (as usePlanRowStatuses.ts's does), so every writer that refreshes that list refreshes
// this one: a start, a finish, a reopen, a skip, a move (`useSession.ts`).
const PAGE = 500

type Row = { id: string; week_plan_id: string; workout_day_id: string | null; date: string; moved_to_date: string | null; status: SessionStatus }

export async function fetchPlanSessions(mesoId: string): Promise<PlanSession[]> {
  const out: PlanSession[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('v2_sessions')
      .select('id, week_plan_id, workout_day_id, date, moved_to_date, status')
      .eq('mesocycle_id', mesoId)
      .not('week_plan_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as Row[]
    for (const r of rows) {
      out.push({ id: r.id, weekPlanId: r.week_plan_id, workoutDayId: r.workout_day_id, date: r.date, movedToDate: r.moved_to_date ?? null, status: r.status })
    }
    if (rows.length < PAGE) break
  }
  return out
}

/** The run's sessions with a plan row; undefined until read (a chip then shows no state, never a wrong one). */
export function usePlanSessions(mesoId: string | undefined): readonly PlanSession[] | undefined {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: [DONE_WEEK_PLANS_KEY, 'sessions', mesoId],
    queryFn: () => fetchPlanSessions(mesoId!),
    enabled: !!user && !!mesoId,
  })
  return data
}
