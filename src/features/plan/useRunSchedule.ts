import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { fullSchedule } from '../programs/runSchedule'
import type { RunSchedule, WeeklySchedule } from '../../types'

// Chunk 50 (SPEC [1.2] Programs and runs → "Weekdays storage": "this week's not-done sessions keep their days; the new
// days apply from next week"; Screens → Today: "it finds sessions by the weekdays in force that week"). The rows of a
// weekday run's schedule history, `v2_run_schedules` (migration 042, live on staging): the schedule in force for a
// week is the row with the greatest `from_week` at or before it, else the run copy's own `v2_programs.schedule`
// (`runSchedule.ts`' `scheduleForWeek`, chunk 45, the one resolver). This is the read; the resolving is the caller's,
// with the run copy's schedule it already holds (Today's `useScheduler`, Plan's weekday labels, the rest-day screen).
//
// One small query per run, cached under ['v2_runSchedules', mesoId]: Today and Plan share the one entry. Chunk 51b's
// save invalidates that key (it writes the rows). A run nobody changed the days of has no rows, and `data` is then
// `[]`: a real answer, "the run copy's schedule applies in every week", unlike `undefined`, which is "not read yet" (a
// caller that resolves a week before the rows have answered would show the run copy's days for a week that may have
// had others, so it waits). A sequence run never gets a row; its callers don't ask (mesoId undefined, query off).
//
// Paged (ordered, `.range()` until a short page): `unique (mesocycle_id, from_week)` bounds the rows by the run's
// weeks, but every read pages under PostgREST's max_rows all the same (RULES.md, Checks that lied #31).
export const RUN_SCHEDULES_KEY = 'v2_runSchedules'

const PAGE = 500

// A row as PostgREST returns it. `schedule` is jsonb in the same `{ monday: workoutDayId | null, … }` shape as
// `v2_programs.schedule`; a map that leaves a weekday out (the seed writes sparse ones) reads as that weekday null,
// as `programService.ts`' mapper reads the program's own.
type DbRunSchedule = {
  id: string
  user_id: string
  mesocycle_id: string
  from_week: number
  schedule: Partial<WeeklySchedule> | null
  created_at: string
}

export function toRunSchedule(row: DbRunSchedule): RunSchedule {
  return {
    id: row.id,
    userId: row.user_id,
    mesocycleId: row.mesocycle_id,
    fromWeek: row.from_week,
    schedule: fullSchedule(row.schedule ?? {}),
    createdAt: row.created_at,
  }
}

export async function fetchRunSchedules(mesoId: string): Promise<RunSchedule[]> {
  const out: RunSchedule[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('v2_run_schedules')
      .select('*')
      .eq('mesocycle_id', mesoId)
      .order('from_week')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as DbRunSchedule[]
    out.push(...rows.map(toRunSchedule))
    if (rows.length < PAGE) break
  }
  return out
}

export function useRunSchedule(mesoId: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: [RUN_SCHEDULES_KEY, mesoId],
    queryFn: () => fetchRunSchedules(mesoId!),
    enabled: !!user && !!mesoId,
  })
}
