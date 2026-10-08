import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type {
  Session,
  SetLog,
  WeightUnit,
  FormRating,
  EnergyRating,
  PumpRating,
  MuscleSubgroup,
  MovementPattern,
  Exercise,
} from '../../types'
import { groupSetLogs, type SetGroup } from './setGroupLogic'
import { deriveCompletedAt, shouldClassifyAsSkipped } from './sessionCompletion'
import type { StageKind } from '../../lib/plannerVocabulary.js'

// ─── DB Types ──────────────────────────────────────────────────────────────────

type DbExercise = {
  id: string
  name: string
  muscle_group: string | null
  user_id: string
  is_archived: boolean
  created_at: string
  muscle_subgroup: MuscleSubgroup[] | null
  movement_pattern: MovementPattern | null
  status: string
  source_library_id: string | null
  lost_at: string | null
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
  // Absent until migration 016 has been applied.
  form_rating?: string | null
  // Absent until migration 027 has been applied.
  stage_kind?: string | null
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
  // Absent until migration 016 has been applied.
  energy_rating?: string | null
  pump_rating?: string | null
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
          muscleSubgroups: row.exercises.muscle_subgroup,
          movementPattern: row.exercises.movement_pattern,
          status: row.exercises.status === 'lost' ? 'lost' : 'active',
          sourceLibraryId: row.exercises.source_library_id,
          lostAt: row.exercises.lost_at,
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
    // Same "column may not exist yet" fallback as stageIndex/isWarmup above.
    formRating: (row.form_rating ?? null) as FormRating | null,
    // Chunk 14 — heads only; a stage row's own value is always null (the
    // DB's own check). Same fallback as formRating above.
    stageKind: (row.stage_kind ?? null) as SetLog['stageKind'],
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
    // Same "column may not exist yet" fallback as toSetLog's formRating.
    energyRating: (row.energy_rating ?? null) as EnergyRating | null,
    pumpRating: (row.pump_rating ?? null) as PumpRating | null,
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
  // Optional, additive params, not a signature rewrite (TASKS.md §2.4) — two
  // call sites: SessionComplete.tsx passes them; useAutoFinishSession.ts
  // deliberately doesn't (an automatically finished session has no UI moment
  // to collect a rating, so both stay null — the correct "not rated" state,
  // not a gap).
  energyRating: EnergyRating | null = null,
  pumpRating: PumpRating | null = null,
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
    .update({ status, completed_at: completedAt, note, energy_rating: energyRating, pump_rating: pumpRating })
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
  formRating: FormRating | null
  // Chunk 14 — "as planned" (TASKS.md "Logging"). Optional (not required):
  // the one thing every real caller (useLogSet's mutationFn, below) always
  // supplies, but the D30-adjacent "logSet payload test"
  // (sessionService.test.ts) calls this function directly without it and
  // its exact-shape `toEqual` must stay byte-identical — an omitted key
  // here serialises to no key at all (Supabase's insert drops `undefined`
  // values), so an existing caller that never passes it writes exactly the
  // row it always has.
  stageKind?: StageKind | null
  // Chunk 15 (SPEC "Warmup sets") — same "omitted key serialises to no key
  // at all" convention as stageKind above: every pre-chunk-15 caller (and
  // the D30-adjacent logSet payload test) never passes this, so an existing
  // row's insert is unaffected; the DB column default (false) applies.
  // handleLogWarmup (useExerciseCardState.ts) is the one real caller that
  // ever sets it to true.
  isWarmup?: boolean
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
      form_rating: params.formRating,
      stage_kind: params.stageKind,
      is_warmup: params.isWarmup,
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
    setNumber?: number
    formRating?: FormRating | null
  },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('weight' in changes) patch.weight = changes.weight
  if ('reps' in changes) patch.reps = changes.reps
  if ('rir' in changes) patch.rir = changes.rir
  if ('setNumber' in changes) patch.set_number = changes.setNumber
  // RIR is editable on an already-logged row (SetRow.tsx's isEditing block)
  // — form must be too, or two controls that sit side by side behave
  // inconsistently for no reason (TASKS.md §4 item 4).
  if ('formRating' in changes) patch.form_rating = changes.formRating

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
  // Chunk 23 (SPEC "'Last time' reference" — "Elapsed time counts from
  // moved_to_date when set, else the session date") — v2_sessions.moved_to_date.
  // Optional, same "may not exist yet" convention as every other
  // migration-027 column on this app's other types (WeekPlan.deloadRestore
  // etc.): every pre-chunk-23 construction of a ReferenceSession (this
  // file's own fetchReferenceSessions below, useSession.ts's offline
  // fallback, Coach's analysisInput.ts) predates this field and never sets
  // it; absent/undefined reads as "use `date`" wherever this is read
  // (referenceByExercise.ts), never a crash.
  movedToDate?: string | null
  // Chunk 23 — this session's own v2_week_plans.is_deload, through the
  // week_plan_id embed. Optional for the same reason as movedToDate above:
  // only fetchReferenceSessionsByExercise (below) ever sets it, and only as
  // a defensive, independently-testable second filter — that function
  // already excludes a deload session from the Map entirely (SPEC "Deload
  // sessions never count"), so every object it returns has this `false`
  // in practice; referenceByExercise.ts's own resolver re-checks it anyway
  // (Lessons: "prove every rule at the layer that applies it"), which is
  // what actually makes it reachable/testable rather than dead code.
  isDeload?: boolean
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
  // Chunk 15 (SPEC "Warmup sets" — "never counted in ... 'last time'
  // matching"): dropped here, at the call site, before any ReferenceSession
  // is built — referenceLogic.ts itself (resolveExerciseReference,
  // resolveSecondaryReference, hasRealLoggedSet) is frozen (Coach imports
  // it) and stays byte-identical; filtering the rows it will ever see is
  // how its existing logic (which already treats an all-skipped session as
  // not "real") also treats an all-warmup session as not real, with no
  // change to that file at all.
  for (const row of (logRows as DbSetLog[]).filter((r) => !r.is_warmup)) {
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

// Cross-run candidate query (chunk 23 — SPEC "'Last time' reference":
// "Matching: by exercise_id across all completed sessions of the user,
// every run and every workout", "Deload sessions never count", "Crosses
// run boundaries"). Separate from fetchReferenceSessions above, which
// stays exactly as it is (still per-workout-day — whatever else keeps
// calling it keeps getting that scope); this one is exercise-id-scoped
// only, no workout_day_id anywhere, so a run/workout boundary can never
// narrow the candidate set the way it used to.
//
// One query (not session-first/two-step like fetchReferenceSessions —
// there is no "candidate sessions" table to query first: v2_sessions has
// no exercise_id column, so the only way to find "every completed session
// where this exercise was logged" is through v2_set_logs itself, same
// precedent as progressService.ts's fetchAllExerciseSetLogRows), batched
// across every exercise id the screen needs (same "no query per card" the
// per-workout version already followed). The deload flag rides along
// through the week_plan_id embed (v2_sessions -> v2_week_plans(is_deload))
// — exactly one FK each way today (confirmed by check-embeds-local.sh), so
// no hint is needed; completed-only and deload-excluded are both applied
// here in JS against the embedded v2_sessions/v2_week_plans columns, same
// convention as progressService.ts's own `row.v2_sessions?.status ===
// 'completed'` / `.v2_week_plans?.is_deload` (filtering an embedded
// resource's column via `.eq()` would need `!inner` and this codebase has
// no precedent for that — see this chunk's report). Warmups dropped here
// too, same call-site convention fetchReferenceSessions above already
// uses — referenceLogic.ts stays untouched either way.
//
// No date bound, same "AUDIT P5" reasoning fetchReferenceCandidateSessions
// documents above — now exercise-scoped rather than workout-day-scoped.
//
// Review fix: "not expected to be large at this app's scale" doesn't hold
// against PostgREST's own hard cap — max_rows defaults to 1000
// (supabase/config.toml), silently truncating ANY query past that many
// rows, with no error and no signal anything was dropped. Scoped to one
// workout day, fetchReferenceCandidateSessions/fetchReferenceSessions
// above could reasonably stay unbounded (AUDIT P5's own call); scoped to
// one EXERCISE across a user's entire history, several months of training
// can exceed 1000 set_log rows on its own, and this is BATCHED across
// every exercise id a whole screen needs (6-8+ exercises at once) — easily
// reachable, not a hypothetical. An arbitrary (not even "oldest wins")
// 1000-row slice could drop last week's session specifically, showing
// LAST TIME from an older one, or even FIRST TIME. Same fix shape as
// progressService.ts's own fetchAllExerciseSetLogRows (AUDIT H4) and
// historyService.ts's Phase 3.4 pagination: loop `.range()` pages, ordered
// by a stable key, until a short page proves there's nothing left — never
// trust a single unbounded `.select()` to have returned everything.
const REFERENCE_SESSIONS_PAGE_SIZE = 1000

type DbCrossRunSetLog = DbSetLog & {
  v2_sessions: {
    id: string
    date: string
    completed_at: string | null
    moved_to_date: string | null
    status: string
    mesocycle_id: string | null
    v2_week_plans: { is_deload: boolean } | null
  } | null
}

// Pagination extracted so the service test can assert the exact `.range`
// bounds and `.order` calls each page makes, same "the lowest layer the
// brief names" precedent this chunk's other tests already follow.
async function fetchAllReferenceSetLogRows(
  userId: string,
  exerciseIds: string[],
): Promise<DbCrossRunSetLog[]> {
  const rows: DbCrossRunSetLog[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase
      .from('v2_set_logs')
      .select('*, v2_sessions(id, date, completed_at, moved_to_date, status, mesocycle_id, v2_week_plans(is_deload))')
      .eq('user_id', userId)
      .in('exercise_id', exerciseIds)
      // A stable order, same tie-break as progressService.ts's own
      // fetchAllExerciseSetLogRows — logged_at alone can tie (an
      // offline-queued batch), and a tie without a secondary key can
      // duplicate or drop rows across separate `.range()` calls.
      .order('logged_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + REFERENCE_SESSIONS_PAGE_SIZE - 1)
    if (error) throw error

    const page = data as unknown as DbCrossRunSetLog[]
    rows.push(...page)
    if (page.length < REFERENCE_SESSIONS_PAGE_SIZE) break
    offset += REFERENCE_SESSIONS_PAGE_SIZE
  }
  return rows
}

export async function fetchReferenceSessionsByExercise(
  userId: string,
  exerciseIds: string[],
): Promise<Map<string, ReferenceSession[]>> {
  if (exerciseIds.length === 0) return new Map()

  const rows = await fetchAllReferenceSetLogRows(userId, exerciseIds)

  type SessionMeta = {
    date: string
    completedAt: string | null
    mesocycleId: string | null
    movedToDate: string | null
  }
  const sessionMetaById = new Map<string, SessionMeta>()
  const logsByExercise = new Map<string, Map<string, SetLog[]>>()

  for (const row of rows) {
    const s = row.v2_sessions
    // Completed only (skipped/in_progress never match) and never a deload
    // session (SPEC "Deload sessions never count") — both are columns on
    // the embedded v2_sessions/v2_week_plans resources, filtered here in
    // JS rather than via a `.eq()` on the query builder (see header above).
    if (!s || s.status !== 'completed' || (s.v2_week_plans?.is_deload ?? false)) continue
    // Chunk 15 (SPEC "Warmup sets" — "never counted in ... 'last time'
    // matching"): same call-site exclusion as fetchReferenceSessions above.
    if (row.is_warmup) continue

    if (!sessionMetaById.has(s.id)) {
      sessionMetaById.set(s.id, {
        date: s.date,
        completedAt: s.completed_at,
        mesocycleId: s.mesocycle_id,
        movedToDate: s.moved_to_date,
      })
    }

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
      .map(([sessionId, logs]) => {
        const meta = sessionMetaById.get(sessionId)!
        return {
          sessionId,
          date: meta.date,
          completedAt: meta.completedAt,
          mesocycleId: meta.mesocycleId,
          movedToDate: meta.movedToDate,
          logs: groupSetLogs([...logs].sort((a, b) => a.setNumber - b.setNumber)),
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
    result.set(exerciseId, refSessions)
  }

  return result
}

// ─── Exercise swaps ───────────────────────────────────────────────────────────
// Session-scoped structural link between a swapped-out exercise slot and its
// replacement (migration 025) — see that file's header for why this exists.
// One row per swap event, keyed by the program_exercise "slot" it replaces
// so GymSession.tsx can render the replacement in that slot's own position
// instead of appending it, and assembleAnalysisInput (analysisInput.ts) can
// state the substitution as an explicit fact instead of leaving the model to
// infer it from two disconnected exercises in the same session.

export interface ExerciseSwap {
  id: string
  sessionId: string
  programExerciseId: string | null
  originalExerciseId: string | null
  originalExerciseName: string
  replacementExerciseId: string | null
  replacementExerciseName: string
  createdAt: string
}

type DbExerciseSwap = {
  id: string
  session_id: string
  program_exercise_id: string | null
  original_exercise_id: string | null
  original_exercise_name: string
  replacement_exercise_id: string | null
  replacement_exercise_name: string
  created_at: string
}

function toExerciseSwap(row: DbExerciseSwap): ExerciseSwap {
  return {
    id: row.id,
    sessionId: row.session_id,
    programExerciseId: row.program_exercise_id,
    originalExerciseId: row.original_exercise_id,
    originalExerciseName: row.original_exercise_name,
    replacementExerciseId: row.replacement_exercise_id,
    replacementExerciseName: row.replacement_exercise_name,
    createdAt: row.created_at,
  }
}

// Names are captured from the real Exercise objects at swap time (not looked
// up again later) — the same "identity travels denormalised" reasoning the
// migration's own header cites, and it means this insert needs no join.
export async function recordExerciseSwap(params: {
  userId: string
  sessionId: string
  programExerciseId: string
  originalExercise: Exercise
  replacementExercise: Exercise
}): Promise<ExerciseSwap> {
  const { data, error } = await supabase
    .from('v2_session_exercise_swaps')
    .insert({
      user_id: params.userId,
      session_id: params.sessionId,
      program_exercise_id: params.programExerciseId,
      original_exercise_id: params.originalExercise.id,
      original_exercise_name: params.originalExercise.name,
      replacement_exercise_id: params.replacementExercise.id,
      replacement_exercise_name: params.replacementExercise.name,
    })
    .select('*')
    .single()
  if (error) throw error
  return toExerciseSwap(data as DbExerciseSwap)
}

export async function fetchSessionSwaps(sessionId: string): Promise<ExerciseSwap[]> {
  const { data, error } = await supabase
    .from('v2_session_exercise_swaps')
    .select('*')
    .eq('session_id', sessionId)
  if (error) throw error
  return (data as DbExerciseSwap[]).map(toExerciseSwap)
}
