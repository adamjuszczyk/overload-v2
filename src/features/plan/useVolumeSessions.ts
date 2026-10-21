import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import { useAuth } from '../auth/useAuth'
import { DONE_WEEK_PLANS_KEY } from './useDoneWeekPlanIds'
import type { MuscleGroup, SessionSetChange, SessionStatus, SetLog } from '../../types'

// Chunk 55 (TASKS-1.2 "VOLUME"; SPEC [1.2] Volume per muscle (14)): last week's sessions with their logs and their set changes, the one read
// the VOLUME sheet makes that Plan's page doesn't already have. By the plan rows of last week (`week_plan_id`), never by date: a session is
// last week's because its plan row is (a moved session keeps its week, B2), and a session with no plan row belongs to no week Plan draws.
//
// What it returns is the shape `volumeRows` (chunk 44) takes, picked from the app's own types, so typecheck proves the sheet hands it what
// it reads without a cast:
//   - `setLogs` is populated (an unloaded list reads as no logs, and a done session would count 0 without a sound: Checks that lied #33):
//     each log's exercise, the planned set it was logged against, its head, and whether it was a warmup or skipped;
//   - `sessionSetChanges` holds the session's `deleted` rows, the only kind volume reads (a planned set the session removed is out). A
//     `retyped` or `pending_stages` row changes no count: what was logged is in the logs. (Chunk 56 reads all three kinds for REVIEW.)
//   - `exercises` is every exercise a log names with its muscle group, archived ones included (the embed filters nothing): one missing
//     would count as Other. A swap or an exercise added in the session counts for the exercise actually done.
//
// Paged (ordered, `.range()` until a short page): bounded by a week's plan rows in practice, but every history read pages under PostgREST's
// max_rows (Checks that lied #31). The embeds are single-FK each way (`v2_set_logs` → `exercises` is the embed `fetchSession` already makes;
// `v2_session_set_changes.session_id` is its only FK to `v2_sessions`); `check-embeds-local.sh` resolves them in CI.
const PAGE = 500

export interface VolumeSessionRead {
  weekPlanId: string
  status: SessionStatus
  setLogs: Array<Pick<SetLog, 'id' | 'exerciseId' | 'weekPlanSetId' | 'parentSetId' | 'isWarmup' | 'isSkipped'>>
  sessionSetChanges: SessionSetChange[]
}

export interface VolumeSessionsRead {
  sessions: VolumeSessionRead[]
  exercises: Array<{ id: string; muscleGroup: MuscleGroup }>
}

type Row = {
  id: string
  week_plan_id: string
  status: SessionStatus
  v2_set_logs: Array<{
    id: string
    exercise_id: string
    week_plan_set_id: string | null
    parent_set_id: string | null
    is_warmup?: boolean | null
    is_skipped: boolean
    exercises: { id: string; muscle_group: string | null } | null
  }> | null
  v2_session_set_changes: Array<{ kind: string; week_plan_set_id: string | null }> | null
}

export async function fetchVolumeSessions(weekPlanIds: readonly string[]): Promise<VolumeSessionsRead> {
  const sessions: VolumeSessionRead[] = []
  const exercises = new Map<string, MuscleGroup>()
  if (weekPlanIds.length === 0) return { sessions, exercises: [] }
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('v2_sessions')
      .select('id, week_plan_id, status, v2_set_logs(id, exercise_id, week_plan_set_id, parent_set_id, is_warmup, is_skipped, exercises(id, muscle_group)), v2_session_set_changes(kind, week_plan_set_id)')
      .in('week_plan_id', [...weekPlanIds])
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as Row[]
    for (const row of rows) {
      const logs = row.v2_set_logs ?? []
      for (const log of logs) {
        if (log.exercises && !exercises.has(log.exercises.id)) exercises.set(log.exercises.id, toMuscleGroup(log.exercises.muscle_group))
      }
      sessions.push({
        weekPlanId: row.week_plan_id,
        status: row.status,
        setLogs: logs.map((log) => ({
          id: log.id,
          exerciseId: log.exercise_id,
          weekPlanSetId: log.week_plan_set_id,
          parentSetId: log.parent_set_id,
          // Absent until migration 004/005/006 has been applied, as sessionService.ts reads it.
          isWarmup: log.is_warmup ?? false,
          isSkipped: log.is_skipped,
        })),
        sessionSetChanges: (row.v2_session_set_changes ?? []).flatMap((change): SessionSetChange[] =>
          change.kind === 'deleted' && change.week_plan_set_id !== null ? [{ kind: 'deleted', weekPlanSetId: change.week_plan_set_id }] : [],
        ),
      })
    }
    if (rows.length < PAGE) break
  }
  return { sessions, exercises: [...exercises].map(([id, muscleGroup]) => ({ id, muscleGroup })) }
}

/**
 * Last week's sessions for the VOLUME sheet; idle (and no request) while there are no plan rows to read by. The key sits under the done
 * list's prefix, so every writer that refreshes that list (a start, a finish, a reopen, a skip, a move: `useSession.ts`) refreshes this one
 * too, and it is never fresh: each time the sheet opens it reads again (what last week holds changes while it is still running).
 */
export function useVolumeSessions(weekPlanIds: readonly string[]) {
  const { user } = useAuth()
  const ids = [...new Set(weekPlanIds)].sort()
  return useQuery({
    queryKey: [DONE_WEEK_PLANS_KEY, 'volume', ids],
    queryFn: () => fetchVolumeSessions(ids),
    enabled: !!user && ids.length > 0,
    staleTime: 0,
  })
}
