import { supabase } from '../../lib/supabase'
import { db } from '../../lib/db'
import type { Exercise, ProgramExercise, ReassignPreview, ReassignResult } from '../../types'

// P3/P4 (§5.2) — the blocking preflights, checked right before the
// confirmation sheet allows the tap rather than surfacing as a failure
// after it (§6.2). Both describe a state that resolves on its own.
export interface ReassignBlockers {
  // P3 — a queued v2_set_logs upsert carries a literal exercise_id
  // (useSession.ts:692); replayed after the source row is hard-deleted by
  // the merge, it violates the FK and useSyncQueue.ts dead-letters it,
  // discarding a real logged set permanently. Client-side/this-device only
  // — §5.6 documents the residual second-device window this doesn't close.
  hasUnsyncedSets: boolean
  // P4 — a live session could be logging under either exercise while the
  // merge runs. §5.3 step 1's row lock closes the window inside the
  // transaction, but a session mid-workout should not be silently
  // renumbered underneath the lifter without warning first.
  hasSessionInProgress: boolean
}

export async function checkReassignBlockers(): Promise<ReassignBlockers> {
  const [unsyncedCount, sessionResult] = await Promise.all([
    db.sync_queue.count(),
    supabase.from('v2_sessions').select('id', { count: 'exact', head: true }).eq('status', 'in_progress'),
  ])
  if (sessionResult.error) throw sessionResult.error
  return {
    hasUnsyncedSets: unsyncedCount > 0,
    hasSessionInProgress: (sessionResult.count ?? 0) > 0,
  }
}

// Thrown in place of calling the RPC when P3/P4 hold at merge time. Carries
// the fresh blockers so the caller can render the same explanation the
// confirmation sheet already shows for the selection-time check, rather than
// reporting an irreversible action as having failed for an unknown reason.
export class ReassignBlockedError extends Error {
  readonly blockers: ReassignBlockers
  constructor(blockers: ReassignBlockers) {
    super('Reassignment blocked by an unsynced set or an in-progress session')
    this.name = 'ReassignBlockedError'
    this.blockers = blockers
  }
}

// reassign_exercise_history() (migration 021, EXERCISE-LIBRARY-TASKS.md §5,
// §8 step 8) — the repo's first .rpc() call. Merges a lost exercise's entire
// logged history onto an active target in one all-or-nothing transaction;
// see the migration file for the full mechanics (§5.3). Client-side, all
// this does is re-check P3/P4, call it, and translate the returned row — no
// retry, no optimistic update, since a partial success here is meaningless
// (the RPC itself either commits everything or raises).
//
// The P3/P4 re-check lives here, immediately before .rpc(), and not only in
// ReassignSheet.tsx's selectTarget(): that snapshot is taken when a target is
// picked and goes stale while the sheet sits open. A set logged offline, or a
// session started, on this same device in that window would otherwise slip
// through a blocked=false that stopped being true minutes ago — narrow, but
// the failure it guards (P3's dead-lettered set log) is silent and permanent.
// Guarding the RPC wrapper rather than its caller means there is no path to
// the merge that skips the check. Fails closed: a check that errors raises
// rather than reading as clear. §5.6's second-device window is unaffected —
// this closes the same-device one only.
export async function reassignExerciseHistory(sourceId: string, targetId: string): Promise<ReassignResult> {
  const blockers = await checkReassignBlockers()
  if (blockers.hasUnsyncedSets || blockers.hasSessionInProgress) throw new ReassignBlockedError(blockers)

  const { data, error } = await supabase.rpc('reassign_exercise_history', {
    p_source: sourceId,
    p_target: targetId,
  })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as {
    set_logs_moved: number
    program_exercises_moved: number
    program_exercises_merged: number
    plan_sets_moved: number
    source_deleted: boolean
  }
  return {
    setLogsMoved: row.set_logs_moved,
    programExercisesMoved: row.program_exercises_moved,
    programExercisesMerged: row.program_exercises_merged,
    planSetsMoved: row.plan_sets_moved,
    sourceDeleted: row.source_deleted,
  }
}

type DbSetLogRef = { session_id: string; logged_at: string }
type DbWorkoutDayRef = { workout_day: { name: string } | null }

// P5 (§5.2) — the real counts the confirmation copy needs (§6.1 items 2/3/
// 7/8/9). This is a rendering aid only: the RPC re-derives every one of
// these at merge time (§6.2 — "both counts come from the same query the RPC
// will re-derive"), so a number shown here is never what the merge actually
// acts on, only what it's expected to act on a moment later.
export async function previewReassign(sourceId: string, targetId: string): Promise<ReassignPreview> {
  const { data: logs, error: logsError } = await supabase
    .from('v2_set_logs')
    .select('session_id, logged_at')
    .eq('exercise_id', sourceId)
  if (logsError) throw logsError
  const sourceLogs = (logs ?? []) as DbSetLogRef[]

  const setCount = sourceLogs.length
  const sessionIds = Array.from(new Set(sourceLogs.map((l) => l.session_id)))
  const dates = sourceLogs.map((l) => l.logged_at).sort()
  const firstDate = dates[0] ?? null
  const lastDate = dates[dates.length - 1] ?? null

  // §5.3 step 3 / §6.1 item 8 — sessions already logging the target too.
  let overlappingSessionCount = 0
  if (sessionIds.length > 0) {
    const { data: targetLogs, error: targetLogsError } = await supabase
      .from('v2_set_logs')
      .select('session_id')
      .eq('exercise_id', targetId)
      .in('session_id', sessionIds)
    if (targetLogsError) throw targetLogsError
    overlappingSessionCount = new Set((targetLogs ?? []).map((r: { session_id: string }) => r.session_id)).size
  }

  // §5.3 step 2b / §6.1 item 7 — workout days where the source and target
  // already share a program-exercise row (the merge case), not every day
  // the source merely appears in.
  const { data: sourceProgramExercises, error: speError } = await supabase
    .from('v2_program_exercises')
    .select('workout_day_id')
    .eq('exercise_id', sourceId)
  if (speError) throw speError
  const sourceWorkoutDayIds = (sourceProgramExercises ?? []).map((r: { workout_day_id: string }) => r.workout_day_id)

  let affectedWorkoutDays: string[] = []
  if (sourceWorkoutDayIds.length > 0) {
    const { data: collisions, error: collisionsError } = await supabase
      .from('v2_program_exercises')
      .select('workout_day:v2_workout_days(name)')
      .eq('exercise_id', targetId)
      .in('workout_day_id', sourceWorkoutDayIds)
    if (collisionsError) throw collisionsError
    affectedWorkoutDays = Array.from(
      new Set(
        (collisions as unknown as DbWorkoutDayRef[])
          .map((row) => row.workout_day?.name)
          .filter((name): name is string => !!name),
      ),
    )
  }

  const frozenAnalysisCount =
    (await countAnalysesReferencing('v2_coach_session_analyses', sourceId)) +
    (await countAnalysesReferencing('v2_coach_week_analyses', sourceId))

  return {
    setCount,
    sessionCount: sessionIds.length,
    firstDate,
    lastDate,
    affectedWorkoutDays,
    overlappingSessionCount,
    frozenAnalysisCount,
  }
}

// §5.3 step 4 / §6.1 item 9 — a written analysis embeds exercise identity as
// {exerciseId, exerciseName} inside its frozen content/input_snapshot JSON
// (analysisInput.ts), at a nesting depth that differs between daily and
// weekly analyses. A plain substring match on the row's JSON text is exact
// here — exerciseId is a uuid, so there's no possible false-positive
// collision against any other field's value — and simpler than a recursive
// jsonb path query for what the confirmation only needs as a single count.
async function countAnalysesReferencing(
  table: 'v2_coach_session_analyses' | 'v2_coach_week_analyses',
  exerciseId: string,
): Promise<number> {
  const { data, error } = await supabase.from(table).select('content, input_snapshot')
  if (error) throw error
  return (data ?? []).filter((row: unknown) => JSON.stringify(row).includes(exerciseId)).length
}

// ─── Client-side cleanup after a successful merge (§5.5) ───────────────────
// Not optional: three Dexie tables mirror exercise identity and would
// otherwise keep showing the pre-merge world offline until an unrelated
// event happened to touch them. No Dexie version bump — row content only.

export async function reprimeAfterReassign(sourceId: string, target: Exercise): Promise<void> {
  const targetId = target.id

  // db.exercises — the source identity no longer exists once merged; drop
  // it rather than guess a replacement value.
  await db.exercises.delete(sourceId)

  // db.set_logs — its cached set_number does not reflect §5.3 step 3's
  // renumbering (only ever computed server-side). Rather than mirror a
  // value this client never computed and risk it drifting from the
  // server's true order, drop every cached log under the old identity —
  // it's an offline reference/prefill mirror, not a record of truth, and
  // gets correctly repopulated by primeOfflineCache() the next time this
  // account opens a session for the affected workout day while online.
  await db.set_logs.where('exerciseId').equals(sourceId).delete()

  // db.workout_days — the serialised ProgramExercise[] blob embeds joined
  // exercise identity per slot (§1), in TWO places: the slot's own
  // exerciseId AND the joined `exercise` object hanging off it. Re-pointing
  // only the id leaves the join naming the exercise the merge just deleted,
  // and ExerciseHeader.tsx renders `programExercise.exercise?.name` — so the
  // offline gym view would label the merged slot with the dead exercise,
  // which is the exact outcome §5.5 item 2 exists to prevent. Both are
  // re-pointed together here, which is why this takes the whole target
  // Exercise rather than just its id.
  //
  // If the day already had a slot for the target (the §5.3 step 2b merge
  // collision), drop the source's (now server-deleted) slot instead of
  // producing two slots for one exercise — the surviving slot already
  // carries the target's own correct join.
  const days = await db.workout_days.toArray()
  await Promise.all(
    days.map(async (day) => {
      const exercises = day.exercises as ProgramExercise[] | undefined
      if (!Array.isArray(exercises)) return
      const hasSource = exercises.some((pe) => pe.exerciseId === sourceId)
      if (!hasSource) return
      const hasTarget = exercises.some((pe) => pe.exerciseId === targetId)
      const next = hasTarget
        ? exercises.filter((pe) => pe.exerciseId !== sourceId)
        : exercises.map((pe) =>
            pe.exerciseId === sourceId ? { ...pe, exerciseId: targetId, exercise: target } : pe,
          )
      await db.workout_days.update(day.id, { exercises: next })
    }),
  )
}
