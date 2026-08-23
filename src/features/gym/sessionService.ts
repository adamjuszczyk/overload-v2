import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type { Session, SetLog, WeightUnit } from '../../types'
import { groupSetLogs, type SetGroup } from './setGroupLogic'
import { deriveCompletedAt, shouldClassifyAsSkipped } from './sessionCompletion'

// ─── DB Types ──────────────────────────────────────────────────────────────────

type DbExercise = {
  id: string
  name: string
  muscle_group: string | null
  user_id: string
  is_archived: boolean
  created_at: string
}

type DbSetLog = {
  id: string
  user_id: string
  session_id: string
  exercise_id: string
  exercises?: DbExercise
  week_plan_set_id: string | null
  set_number: number
  weight: number | null
  reps: number | null
  rir: number | null
  note: string | null
  is_dropset: boolean
  parent_set_id: string | null
  is_skipped: boolean
  logged_at: string
  rest_seconds: number | null
  // Absent until migration 004/005/006 has been applied.
  stage_index?: number
  is_warmup?: boolean
  set_seconds?: number | null
  entered_unit?: string | null
}

type DbSession = {
  id: string
  user_id: string
  mesocycle_id: string | null
  week_plan_id: string | null
  workout_day_id: string | null
  date: string
  status: string
  note: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  v2_set_logs?: DbSetLog[]
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function toSetLog(row: DbSetLog): SetLog {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    exerciseId: row.exercise_id,
    exercise: row.exercises
      ? {
          id: row.exercises.id,
          userId: row.exercises.user_id,
          name: row.exercises.name,
          muscleGroup: toMuscleGroup(row.exercises.muscle_group),
          isArchived: row.exercises.is_archived,
          createdAt: row.exercises.created_at,
        }
      : undefined,
    weekPlanSetId: row.week_plan_set_id,
    setNumber: row.set_number,
    weight: row.weight,
    reps: row.reps,
    rir: row.rir,
    note: row.note,
    isDropset: row.is_dropset,
    parentSetId: row.parent_set_id,
    // Same "column may not exist yet" fallback as autoFinishMinutes.
    stageIndex: row.stage_index ?? 0,
    isWarmup: row.is_warmup ?? false,
    setSeconds: row.set_seconds ?? null,
    enteredUnit: (row.entered_unit ?? null) as SetLog['enteredUnit'],
    isSkipped: row.is_skipped,
    loggedAt: row.logged_at,
    restSeconds: row.rest_seconds,
  }
}

function toSession(row: DbSession): Session {
  return {
    id: row.id,
    userId: row.user_id,
    mesocycleId: row.mesocycle_id,
    weekPlanId: row.week_plan_id,
    workoutDayId: row.workout_day_id,
    date: row.date,
    status: row.status as Session['status'],
    note: row.note,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    setLogs: row.v2_set_logs?.map(toSetLog).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)),
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function fetchSessionsInRange(
  startDate: string,
  endDate: string,
): Promise<Session[]> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
  if (error) throw error
  return (data as DbSession[]).map(toSession)
}

export async function fetchSession(id: string): Promise<Session> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .select('*, v2_set_logs(*, exercises(*))')
    .eq('id', id)
    .single()
  if (error) throw error
  return toSession(data as DbSession)
}

export async function createSession(
  userId: string,
  mesoId: string,
  weekPlanId: string | null,
  workoutDayId: string,
  date: string,
): Promise<Session> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .insert({
      user_id: userId,
      mesocycle_id: mesoId,
      week_plan_id: weekPlanId,
      workout_day_id: workoutDayId,
      date,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) throw error
  return toSession(data as DbSession)
}

// completed_at is derived from this session's own set_logs (deriveCompletedAt,
// sessionCompletion.ts), not wall-clock time at whatever moment this
// function happens to run — see that module's header for why. Requires a
// read before the write (this session's own set_logs), unlike the old
// single-UPDATE version; a transient failure on the read means the
// completion attempt fails outright rather than completing with a wrong
// timestamp, same class of failure as any other network error in this
// mutation.
//
// Known, deliberately-accepted race (found by adversarial review, not
// closed): the SELECT and the UPDATE are two separate round trips, not one
// transaction — a set logged for this same session in the narrow window
// between them is invisible to the SELECT's snapshot, so completed_at could
// land on the previous-latest set instead of the true latest one. Closing
// this fully would need either a DB-side transaction/SELECT ... FOR UPDATE
// or a single correlated-subquery UPDATE (this project has no Postgres
// functions/RPCs today, and every other multi-step write here already uses
// this same fetch-then-update shape, e.g. reopenSession below). Low
// practical impact — the error is bounded by one race window and only ever
// makes completed_at slightly earlier than true, never wall-clock-inflated
// like the bug this whole fix targets — so left as a known limitation
// rather than a blocker.
export async function completeSession(
  id: string,
  note: string | null,
): Promise<{ status: 'completed' | 'skipped' }> {
  const { data: logs, error: fetchError } = await supabase
    .from('v2_set_logs')
    .select('logged_at, is_skipped')
    .eq('session_id', id)
  if (fetchError) throw fetchError

  const rows = logs ?? []
  const completedAt = deriveCompletedAt(rows.map((l) => ({ loggedAt: l.logged_at as string })))
  // A session where every logged set was skipped is not meaningfully
  // "completed" — see sessionCompletion.ts's shouldClassifyAsSkipped header
  // for the real bug this closes (CONTEXT.md, 2026-08-22).
  const status: 'completed' | 'skipped' = shouldClassifyAsSkipped(
    rows.map((l) => ({ isSkipped: l.is_skipped as boolean })),
  )
    ? 'skipped'
    : 'completed'

  const { error } = await supabase
    .from('v2_sessions')
    .update({ status, completed_at: completedAt, note })
    .eq('id', id)
  if (error) throw error

  return { status }
}

// Reopening a completed session used to leave started_at untouched, so both
// duration surfaces — the live Today header (useSessionDuration.ts, straight
// Date.now() - startedAt) and v2_session_type_history's
// extract(epoch from completed_at - started_at) — counted the entire
// completed→reopened idle gap as part of the workout (found post-launch,
// 2026-08-10). Neither surface stores a duration value anywhere; both always
// recompute it fresh from these two columns, so there's nothing to
// backfill — the fix only has to change what happens from here forward.
// This is ONE contributor to the broad duration anomaly a live production
// query found this session (11 of 23 completed sessions >4h, across all 4
// workout types, not just the PULL 1 pair Phase 3.4 originally flagged) —
// not necessarily the dominant one. useAutoFinishSession.ts only polls
// while the app is foregrounded (a plain setInterval in a mounted
// component), so a session left open in a backgrounded/closed PWA can sit
// un-finished for hours with no reopen involved at all, then get
// completed_at set to whenever the app is next opened. Both mechanisms
// produce an identical stored signature (a large started_at→completed_at
// gap), so which one caused any specific historical row can't be
// determined after the fact — no audit trail exists. Only the reopen path
// is fixed here; the backgrounded-polling gap is reported, not fixed — see
// CONTEXT.md. Rather than adding a new column/event log, started_at is
// shifted forward by exactly the idle gap on reopen: newStartedAt =
// reopenTime - (oldCompletedAt - oldStartedAt). That makes
// (now - newStartedAt) and (nextCompletedAt - newStartedAt) both equal
// "time actually worked so far" without touching either read site, and
// composes correctly across repeated reopen/complete cycles since each
// reopen re-derives the shift from whatever startedAt the previous reopen
// (if any) already left in place.
export async function reopenSession(id: string): Promise<{ startedAt: string | null }> {
  const { data: current, error: fetchError } = await supabase
    .from('v2_sessions')
    .select('started_at, completed_at')
    .eq('id', id)
    .single()
  if (fetchError) throw fetchError

  let startedAt = current.started_at as string | null
  if (current.started_at) {
    // completed_at can now legitimately be null (deriveCompletedAt,
    // sessionCompletion.ts — a session completed with zero set_logs, or an
    // offline completion with nothing cached to derive from). Found by
    // adversarial review: the original guard here required BOTH
    // started_at AND completed_at before shifting, so a null completed_at
    // silently skipped the shift entirely and left startedAt at its stale
    // value — reproducing this function's own original bug through a door
    // Part 2 opened. A null completed_at carries no real "accumulated
    // work" signal either way, so it gets exactly the same treatment as an
    // untrustworthy (clock-skew, <= 0) span below: resume counting from
    // right now rather than trust/carry forward a number that isn't there.
    const accumulatedMs = current.completed_at
      ? new Date(current.completed_at).getTime() - new Date(current.started_at).getTime()
      : 0
    // A clock change between started_at/completed_at (same class of edge
    // case SessionTypeHistoryView.tsx's DURATION column already guards
    // against) could also make this <= 0. Falling all the way back to
    // "leave startedAt untouched" here would silently reproduce the exact
    // bug this function exists to fix for that trigger too — and since
    // every later reopen re-derives its shift from whatever startedAt is
    // already on the row, an untouched value here would keep re-encoding
    // that contamination into every future reopen too, not just this one.
    // The accumulated span can't be trusted when it's absent or negative,
    // so it's discarded rather than carried forward: resume counting from
    // right now, same as a session with no prior work at all.
    startedAt = accumulatedMs > 0 ? new Date(Date.now() - accumulatedMs).toISOString() : new Date().toISOString()
  }

  const { error } = await supabase
    .from('v2_sessions')
    .update({ status: 'in_progress', completed_at: null, started_at: startedAt })
    .eq('id', id)
  if (error) throw error

  // Returned (not just written) so useReopenSession's onSuccess can patch
  // the TanStack Query cache with the real new value immediately, instead
  // of only invalidating and leaving a stale cached session (old startedAt,
  // status 'completed') to render for however long the background refetch
  // takes — found by this session's own adversarial review: GymSession
  // reads this exact cache key on mount and feeds it straight into
  // useSessionDuration with no freshness/status guard.
  return { startedAt }
}

// Patches the note directly, independent of status — the completed-state
// Today screen's "edit note" action (SPEC §4.3) must not reopen the session
// or touch anything auto-finish related.
export async function updateSessionNote(id: string, note: string | null): Promise<void> {
  const { error } = await supabase.from('v2_sessions').update({ note }).eq('id', id)
  if (error) throw error
}

export async function skipSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('v2_sessions')
    .update({ status: 'skipped' })
    .eq('id', id)
  if (error) throw error
}

// Creates a session row for a missed date and immediately marks as skipped
export async function skipMissedSession(
  userId: string,
  mesoId: string,
  weekPlanId: string | null,
  workoutDayId: string,
  date: string,
  existingSessionId: string | null,
): Promise<void> {
  if (existingSessionId) {
    await skipSession(existingSessionId)
  } else {
    const { error } = await supabase.from('v2_sessions').insert({
      user_id: userId,
      mesocycle_id: mesoId,
      week_plan_id: weekPlanId,
      workout_day_id: workoutDayId,
      date,
      status: 'skipped',
    })
    if (error) throw error
  }
}

// ─── Set Logs ─────────────────────────────────────────────────────────────────

export async function logSet(params: {
  id: string
  userId: string
  sessionId: string
  exerciseId: string
  weekPlanSetId: string | null
  setNumber: number
  weight: number | null
  reps: number | null
  rir: number | null
  note: string | null
  isDropset: boolean
  parentSetId: string | null
  stageIndex: number
  isSkipped: boolean
  restSeconds: number | null
  setSeconds: number | null
  enteredUnit: WeightUnit | null
}): Promise<SetLog> {
  const { data, error } = await supabase
    .from('v2_set_logs')
    .insert({
      // Set explicitly (matches useSession.ts's optimistic-update id)
      // rather than left to the column's default — see useLogSet's
      // mutationFn for why: a stage logged via ADD STAGE before this
      // insert round-trips must be able to reference this row's real,
      // final id immediately, not one Postgres only assigns afterward.
      id: params.id,
      user_id: params.userId,
      session_id: params.sessionId,
      exercise_id: params.exerciseId,
      week_plan_set_id: params.weekPlanSetId,
      set_number: params.setNumber,
      weight: params.weight,
      reps: params.reps,
      rir: params.rir,
      note: params.note,
      is_dropset: params.isDropset,
      parent_set_id: params.parentSetId,
      stage_index: params.stageIndex,
      is_skipped: params.isSkipped,
      logged_at: new Date().toISOString(),
      rest_seconds: params.restSeconds,
      set_seconds: params.setSeconds,
      entered_unit: params.enteredUnit,
    })
    .select('*, exercises(*)')
    .single()
  if (error) throw error
  return toSetLog(data as DbSetLog)
}

export async function updateSetLog(
  id: string,
  changes: {
    weight?: number | null
    reps?: number | null
    rir?: number | null
    note?: string | null
    setNumber?: number
  },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('weight' in changes) patch.weight = changes.weight
  if ('reps' in changes) patch.reps = changes.reps
  if ('rir' in changes) patch.rir = changes.rir
  if ('note' in changes) patch.note = changes.note
  if ('setNumber' in changes) patch.set_number = changes.setNumber

  const { error } = await supabase.from('v2_set_logs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteSetLog(id: string): Promise<void> {
  const { error } = await supabase.from('v2_set_logs').delete().eq('id', id)
  if (error) throw error
}

// Fetches the most recent previous session's set logs for a given exercise.
// Used to populate the ExerciseCard "Last Session" panel and pre-fill weights.
export async function fetchLastSessionLogs(
  userId: string,
  exerciseId: string,
  currentSessionId: string | null,
): Promise<SetLog[]> {
  // Join v2_sessions so we can filter by status = 'completed'.
  // Skipped/in_progress sessions must never appear as "last session" reference.
  const { data, error } = await supabase
    .from('v2_set_logs')
    .select('*, exercises(*), v2_sessions(id, status)')
    .eq('user_id', userId)
    .eq('exercise_id', exerciseId)
    .order('logged_at', { ascending: false })
    .limit(50)
  if (error) throw error

  type Row = DbSetLog & { v2_sessions: { id: string; status: string } | null }
  const rows = data as Row[]

  // Find the most recent session_id that is completed and isn't the active session
  const prevSessionId = rows.find(
    (r) => r.session_id !== currentSessionId && r.v2_sessions?.status === 'completed',
  )?.session_id

  if (!prevSessionId) return []
  return rows
    .filter((r) => r.session_id === prevSessionId)
    .map((r) => toSetLog(r as DbSetLog))
    .sort((a, b) => a.setNumber - b.setNumber)
}

export interface ReferenceSession {
  sessionId: string
  date: string        // v2_sessions.date — the session's calendar date, not a log timestamp
  // Tiebreaker only, for two sessions sharing the same calendar date (AUDIT
  // A3 — no DB uniqueness constraint on (user_id, date) prevents this; AUDIT
  // E8 documents same-day multi-workout as a known, real scenario). `date`
  // remains the primary sort/window key everywhere; this is only consulted
  // when two sessions' dates are equal (see referenceLogic.ts's comparator).
  completedAt: string | null
  // Which mesocycle this session belongs to (v2_sessions.mesocycle_id) —
  // null when no meso was attached at the time. Needed so a reach-back
  // search (referenceLogic.ts's resolveSecondaryReference) can scope
  // "within the current mesocycle only" without a second query.
  mesocycleId: string | null
  // Grouped, not flat (§2.7 item 10) — a stage never has to be re-grouped by
  // whatever renders this; built via setGroupLogic.groupSetLogs at the point
  // this ReferenceSession is constructed, online and offline both. Sorted by
  // setNumber before grouping — a Postgres/Dexie read has no guaranteed row
  // order without ORDER BY, and set rows must still render in set order even
  // when the underlying scan order doesn't happen to match it (e.g. after a
  // mid-session delete-and-relog left a later insertion with an earlier
  // renumbered setNumber).
  logs: SetGroup<SetLog>[]
}

// Candidate completed sessions for the two-slot reference resolver (v3
// §2.3) — same workout_day_id as the session being logged/previewed,
// excluding it by id. No date bound on the past side: the primary slot's
// fallback chain (LAST WEEK -> LAST TIME -> FIRST TIME) needs the full
// history to find "most recent ever" when last week is empty, and this is
// scoped to one workout_day_id for one user, so it stays a handful of rows
// even unbounded (AUDIT P5 — no arbitrary row limit to silently drop one).
async function fetchReferenceCandidateSessions(
  userId: string,
  workoutDayId: string,
  currentSessionId: string | null,
): Promise<{ id: string; date: string; completed_at: string | null; mesocycle_id: string | null }[]> {
  let query = supabase
    .from('v2_sessions')
    .select('id, date, completed_at, mesocycle_id')
    .eq('user_id', userId)
    .eq('workout_day_id', workoutDayId)
    .eq('status', 'completed')
    .order('date', { ascending: false })

  if (currentSessionId) {
    query = query.neq('id', currentSessionId)
  }

  const { data, error } = await query
  if (error) throw error
  return data as { id: string; date: string; completed_at: string | null; mesocycle_id: string | null }[]
}

// Session-first, batched across every exercise sharing a workout day (v3
// §2.3) — one v2_sessions query for the candidate session ids, then one
// batched v2_set_logs query scoped to those ids AND to this workout day's
// exercise ids. Replaces the old fetchLastCompletedSessionForExercise,
// which fired once per exercise per slot (AUDIT P5 / part of P1).
export async function fetchReferenceSessions(
  userId: string,
  workoutDayId: string,
  exerciseIds: string[],
  currentSessionId: string | null,
): Promise<Map<string, ReferenceSession[]>> {
  if (exerciseIds.length === 0) return new Map()

  const candidateSessions = await fetchReferenceCandidateSessions(userId, workoutDayId, currentSessionId)
  if (candidateSessions.length === 0) return new Map()

  const sessionIds = candidateSessions.map((s) => s.id)
  const dateBySessionId = new Map(candidateSessions.map((s) => [s.id, s.date]))
  const completedAtBySessionId = new Map(candidateSessions.map((s) => [s.id, s.completed_at]))
  const mesocycleIdBySessionId = new Map(candidateSessions.map((s) => [s.id, s.mesocycle_id]))

  const { data: logRows, error } = await supabase
    .from('v2_set_logs')
    .select('*')
    .eq('user_id', userId)
    .in('session_id', sessionIds)
    .in('exercise_id', exerciseIds)
  if (error) throw error

  const logsByExercise = new Map<string, Map<string, SetLog[]>>()
  for (const row of logRows as DbSetLog[]) {
    const log = toSetLog(row)
    let bySession = logsByExercise.get(log.exerciseId)
    if (!bySession) {
      bySession = new Map()
      logsByExercise.set(log.exerciseId, bySession)
    }
    const list = bySession.get(log.sessionId)
    if (list) list.push(log)
    else bySession.set(log.sessionId, [log])
  }

  const result = new Map<string, ReferenceSession[]>()
  for (const [exerciseId, bySession] of logsByExercise) {
    const refSessions: ReferenceSession[] = [...bySession.entries()]
      .map(([sessionId, logs]) => ({
        sessionId,
        date: dateBySessionId.get(sessionId)!,
        completedAt: completedAtBySessionId.get(sessionId) ?? null,
        mesocycleId: mesocycleIdBySessionId.get(sessionId) ?? null,
        logs: groupSetLogs([...logs].sort((a, b) => a.setNumber - b.setNumber)),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
    result.set(exerciseId, refSessions)
  }

  return result
}
