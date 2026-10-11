import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'

// Which of a run's week plans have a session that is completed or skipped.
// Plan treats those rows as read-only, like a past week's: the session has
// happened, so editing its plan afterwards would rewrite what it was held
// against. Matched by the session's own week_plan_id; a `planned` or
// `in_progress` session doesn't lock (nothing has finished yet).
//
// Paged (ordered, `.range()` until a short page): a run's finished sessions
// are bounded in practice, but every history read pages under PostgREST's
// max_rows (Checks that lied #31).
const PAGE = 500

export async function fetchDoneWeekPlanIds(mesoId: string): Promise<string[]> {
  const ids = new Set<string>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('v2_sessions')
      .select('id, week_plan_id')
      .eq('mesocycle_id', mesoId)
      .in('status', ['completed', 'skipped'])
      .not('week_plan_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as Array<{ week_plan_id: string }>
    for (const row of rows) ids.add(row.week_plan_id)
    if (rows.length < PAGE) break
  }
  return [...ids]
}

// The key is its own prefix, not under ['v2_sessions']: the session
// mutations' onSuccess runs array updaters over every ['v2_sessions'] entry,
// which a list of ids must not meet. They invalidate this key by name.
export const DONE_WEEK_PLANS_KEY = 'v2_doneWeekPlanIds'

export function useDoneWeekPlanIds(mesoId: string | undefined): Set<string> {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: [DONE_WEEK_PLANS_KEY, mesoId],
    queryFn: () => fetchDoneWeekPlanIds(mesoId!),
    enabled: !!user && !!mesoId,
  })
  return useMemo(() => new Set(data ?? []), [data])
}
