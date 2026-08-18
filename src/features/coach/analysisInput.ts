import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveExerciseReference, type PrimarySlot } from '../gym/referenceLogic'
import type { ReferenceSession } from '../gym/sessionService'
import { matchSessionsByPosition, type PositionMatchResult } from '../progress/positionMatch'
import { groupSetLogs, type SetGroup } from '../gym/setGroupLogic'
import { phaseAt } from './phaseLogic'
import { recentWeightTrend } from './weightLogic'
import type { SetLog, PhaseEntry, WeightEntry, ResolvedPhase, WeeklyWeightAverage } from '../../types'

// Analysis input assembly (COACH-ANALYSIS-TASKS.md §4 step D). Two parts,
// deliberately kept in one file per the plan's own framing ("pure, plus a
// thin server-side fetch layer"):
//
// - buildAnalysisInput — pure. Given already-resolved data, produces the
//   exact JSON payload the model will see. Vitest-covered below.
// - assembleAnalysisInput — the thin fetch layer. Turns a bare sessionId
//   into everything buildAnalysisInput needs, then calls it. Zero API
//   spend either way — this is the last point in the pipeline where a
//   wrong payload can be caught for free (§4 D).
//
// assembleAnalysisInput deliberately does NOT import sessionService.ts /
// historyService.ts / coachContextService.ts, even though each already
// implements an equivalent query — every one of those imports the browser
// singleton `supabase` client (src/lib/supabase.ts), which throws at
// module load when VITE_SUPABASE_* are absent. That's fine in the browser,
// but step E's server function is a Vercel Node function, not a Vite app —
// import.meta.env.VITE_SUPABASE_URL is simply undefined there, so any
// value import chain leading back to src/lib/supabase.ts would crash at
// cold start (exactly the risk TASKS.md §1.3 flags for referenceLogic.ts's
// type-only import of sessionService.ts — the same failure mode, just
// triggered by a different, easier-to-miss path: this module pulling in a
// *value* import instead). This file takes an injected SupabaseClient
// instead, so it works unmodified from today's dry run (the app's own
// browser client, passed in explicitly) and from step E's future
// per-request, JWT-scoped client — no rewrite needed when that lands.

// ─── Output payload ─────────────────────────────────────────────────────────

export type AnalysisInputReference =
  | { kind: 'first_time' }
  | { kind: 'last_week'; sessionId: string; date: string }
  | { kind: 'last_time'; sessionId: string; date: string; daysSince: number }

export interface AnalysisInputExercise {
  exerciseId: string
  exerciseName: string
  // Labelled per §5.5 — the three variants mean different things: last_week
  // is the clean case, last_time+daysSince is a gap the model should reason
  // about rather than treat as weekly, first_time means there's nothing to
  // compare and the model should say so rather than invent a trend.
  reference: AnalysisInputReference
  // Only meaningful alongside a real reference session — null for
  // first_time, since there's no "other week" to have been a deload.
  isDeloadReference: boolean | null
  // null exactly when reference.kind === 'first_time' — matchSessionsByPosition
  // needs two sessions, and first_time has only one.
  match: PositionMatchResult | null
}

export interface AnalysisInput {
  session: { id: string; date: string; workoutDayName: string | null }
  // Session-level, not per-exercise — every exercise in one session shares
  // the same current-week deload flag by construction.
  isDeloadCurrent: boolean | null
  exercises: AnalysisInputExercise[]
  // Resolved as of the *session's* date, not today (§5.4) — an analysis of
  // a past session must not describe a phase that started after it.
  phase: { current: ResolvedPhase | null; previous: ResolvedPhase | null }
  // Same as-of-session-date resolution. source/dailyCount travel with each
  // week so the model can tell a stated weekly figure from a computed one,
  // not just see a bare number.
  weightTrend: WeeklyWeightAverage[]
  // Deliberately absent: session.note. SPEC §8/§9 — only structured set
  // data plus phase/weight context are reasoning inputs in v1; session-level
  // mood/pump/note text is explicitly out of scope.
}

// How many trailing weeks of weight-trend context to include. Not specified
// by the spec as an exact number ("a recent weight trend") — 6 weeks gives
// enough runway to see a trend across a typical phase without turning the
// payload into a full history. Not load-bearing: easy to change later, and
// harmless to be generous with since WeeklyWeightAverage rows are tiny.
const WEIGHT_TREND_WEEKS = 6

// ─── Pure builder ─────────────────────────────────────────────────────────────

export interface AnalysisInputExerciseSource {
  exerciseId: string
  exerciseName: string
  // Flat, unfiltered — every set_log row (including skipped/warmup) for
  // this exercise in the current session. matchSessionsByPosition does its
  // own skip/warmup handling internally (buildLoggedSlots, eligibleE1rm).
  currentLogs: SetLog[]
  reference: PrimarySlot
  // Flat logs for this exercise from the reference session — null exactly
  // when reference.type === 'first_time'.
  referenceLogs: SetLog[] | null
  isDeloadReference: boolean | null
}

export interface BuildAnalysisInputArgs {
  session: { id: string; date: string; workoutDayName: string | null }
  isDeloadCurrent: boolean | null
  exercises: AnalysisInputExerciseSource[]
  phaseEntries: PhaseEntry[]
  weightEntries: WeightEntry[]
}

function toReference(ref: PrimarySlot): AnalysisInputReference {
  switch (ref.type) {
    case 'first_time':
      return { kind: 'first_time' }
    case 'last_week':
      return { kind: 'last_week', sessionId: ref.session.sessionId, date: ref.session.date }
    case 'last_time':
      return {
        kind: 'last_time',
        sessionId: ref.session.sessionId,
        date: ref.session.date,
        daysSince: ref.daysSince,
      }
  }
}

function buildExercise(source: AnalysisInputExerciseSource, currentSessionId: string, currentDate: string): AnalysisInputExercise {
  const match =
    source.reference.type === 'first_time' || source.referenceLogs === null
      ? null
      : matchSessionsByPosition(
          {
            sessionId: source.reference.session.sessionId,
            date: source.reference.session.date,
            logs: source.referenceLogs,
          },
          { sessionId: currentSessionId, date: currentDate, logs: source.currentLogs },
        )

  return {
    exerciseId: source.exerciseId,
    exerciseName: source.exerciseName,
    reference: toReference(source.reference),
    isDeloadReference: source.reference.type === 'first_time' ? null : source.isDeloadReference,
    match,
  }
}

export function buildAnalysisInput(args: BuildAnalysisInputArgs): AnalysisInput {
  return {
    session: args.session,
    isDeloadCurrent: args.isDeloadCurrent,
    exercises: args.exercises.map((ex) => buildExercise(ex, args.session.id, args.session.date)),
    phase: phaseAt(args.phaseEntries, args.session.date),
    weightTrend: recentWeightTrend(args.weightEntries, args.session.date, WEIGHT_TREND_WEEKS),
  }
}

// ─── Thin server-side fetch layer ──────────────────────────────────────────────

function flattenGroups(groups: SetGroup<SetLog>[]): SetLog[] {
  return groups.flatMap((g) => [g.head, ...g.stages])
}

type RawSetLogRow = {
  id: string
  user_id: string
  session_id: string
  exercise_id: string
  week_plan_set_id: string | null
  set_number: number
  weight: number | null
  reps: number | null
  rir: number | null
  note: string | null
  is_dropset: boolean
  parent_set_id: string | null
  stage_index: number | null
  is_warmup: boolean | null
  is_skipped: boolean
  logged_at: string
  rest_seconds: number | null
  exercises: { name: string } | null
}

function toSetLog(row: RawSetLogRow): SetLog {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    exerciseId: row.exercise_id,
    weekPlanSetId: row.week_plan_set_id,
    setNumber: row.set_number,
    weight: row.weight,
    reps: row.reps,
    rir: row.rir,
    note: row.note,
    isDropset: row.is_dropset,
    parentSetId: row.parent_set_id,
    stageIndex: row.stage_index ?? 0,
    isWarmup: row.is_warmup ?? false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: row.is_skipped,
    loggedAt: row.logged_at,
    restSeconds: row.rest_seconds,
  }
}

// Batch is_deload lookup for a set of week_plan_ids — one query regardless
// of how many sessions/exercises need it. Sessions are valid without a
// week plan (v2_sessions.week_plan_id is nullable), so the result maps a
// missing/null plan id to `null` (unknown), not `false`.
async function fetchIsDeload(
  client: SupabaseClient,
  userId: string,
  weekPlanIds: (string | null)[],
): Promise<Map<string, boolean>> {
  const ids = [...new Set(weekPlanIds.filter((id): id is string => id != null))]
  if (ids.length === 0) return new Map()
  const { data, error } = await client
    .from('v2_week_plans')
    .select('id, is_deload')
    .eq('user_id', userId)
    .in('id', ids)
  if (error) throw error
  return new Map((data as { id: string; is_deload: boolean }[]).map((r) => [r.id, r.is_deload]))
}

export async function assembleAnalysisInput(
  client: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<AnalysisInput> {
  // ── Current session + its set logs ──────────────────────────────────────────
  const { data: sessionRow, error: sessionError } = await client
    .from('v2_sessions')
    .select(
      'id, date, workout_day_id, week_plan_id, v2_set_logs(id, user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir, note, is_dropset, parent_set_id, stage_index, is_warmup, is_skipped, logged_at, rest_seconds, exercises(name))',
    )
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()
  if (sessionError) throw sessionError

  const session = sessionRow as unknown as {
    id: string
    date: string
    workout_day_id: string | null
    week_plan_id: string | null
    v2_set_logs: RawSetLogRow[]
  }

  const currentLogs = (session.v2_set_logs ?? []).map(toSetLog)
  const exerciseNameById = new Map<string, string>()
  for (const row of session.v2_set_logs ?? []) {
    if (row.exercises?.name && !exerciseNameById.has(row.exercise_id)) {
      exerciseNameById.set(row.exercise_id, row.exercises.name)
    }
  }
  // First-appearance order, matching loggedAt ascending — "as performed",
  // same convention sessionService.ts's toSession uses for setLogs.
  const orderedLogs = [...currentLogs].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
  const exerciseIds: string[] = []
  for (const log of orderedLogs) {
    if (!exerciseIds.includes(log.exerciseId)) exerciseIds.push(log.exerciseId)
  }

  // ── Workout day name ─────────────────────────────────────────────────────────
  let workoutDayName: string | null = null
  if (session.workout_day_id) {
    const { data: day, error: dayError } = await client
      .from('v2_workout_days')
      .select('name')
      .eq('id', session.workout_day_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (dayError) throw dayError
    workoutDayName = (day as { name: string } | null)?.name ?? null
  }

  // ── Reference candidate sessions (same workout day, completed, not this one) ──
  // Same scope as sessionService.ts's fetchReferenceCandidateSessions — no
  // date bound, so the last_week → last_time → first_time fallback chain
  // can find "most recent ever" when last week is empty.
  let candidateSessions: { id: string; date: string; completed_at: string | null; week_plan_id: string | null }[] = []
  if (session.workout_day_id) {
    const { data, error } = await client
      .from('v2_sessions')
      .select('id, date, completed_at, week_plan_id')
      .eq('user_id', userId)
      .eq('workout_day_id', session.workout_day_id)
      .eq('status', 'completed')
      .neq('id', sessionId)
      .order('date', { ascending: false })
    if (error) throw error
    candidateSessions = data as typeof candidateSessions
  }

  // Reference set logs, batched across every exercise at once — same
  // session-first shape as sessionService.ts's fetchReferenceSessions.
  const referenceLogsByExerciseAndSession = new Map<string, Map<string, SetLog[]>>()
  if (candidateSessions.length > 0 && exerciseIds.length > 0) {
    const { data: refLogRows, error: refLogError } = await client
      .from('v2_set_logs')
      .select(
        'id, user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir, note, is_dropset, parent_set_id, stage_index, is_warmup, is_skipped, logged_at, rest_seconds, exercises(name)',
      )
      .eq('user_id', userId)
      .in(
        'session_id',
        candidateSessions.map((s) => s.id),
      )
      .in('exercise_id', exerciseIds)
    if (refLogError) throw refLogError

    for (const row of refLogRows as unknown as RawSetLogRow[]) {
      let bySession = referenceLogsByExerciseAndSession.get(row.exercise_id)
      if (!bySession) {
        bySession = new Map()
        referenceLogsByExerciseAndSession.set(row.exercise_id, bySession)
      }
      const list = bySession.get(row.session_id)
      const log = toSetLog(row)
      if (list) list.push(log)
      else bySession.set(row.session_id, [log])
    }
  }

  const dateBySessionId = new Map(candidateSessions.map((s) => [s.id, s.date]))
  const completedAtBySessionId = new Map(candidateSessions.map((s) => [s.id, s.completed_at]))
  const weekPlanIdBySessionId = new Map(candidateSessions.map((s) => [s.id, s.week_plan_id]))

  function referenceSessionsFor(exerciseId: string): ReferenceSession[] {
    const bySession = referenceLogsByExerciseAndSession.get(exerciseId)
    if (!bySession) return []
    return [...bySession.entries()]
      .map(([sid, logs]) => ({
        sessionId: sid,
        date: dateBySessionId.get(sid)!,
        completedAt: completedAtBySessionId.get(sid) ?? null,
        logs: groupSetLogs([...logs].sort((a, b) => a.setNumber - b.setNumber)),
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  // ── is_deload for the current week and every distinct reference week ─────────
  const isDeloadByPlanId = await fetchIsDeload(client, userId, [
    session.week_plan_id,
    ...candidateSessions.map((s) => s.week_plan_id),
  ])
  const isDeloadCurrent = session.week_plan_id ? (isDeloadByPlanId.get(session.week_plan_id) ?? null) : null

  // ── Resolve each exercise's reference + build its match input ────────────────
  const exercises: AnalysisInputExerciseSource[] = exerciseIds.map((exerciseId) => {
    const candidates = referenceSessionsFor(exerciseId)
    const { primary } = resolveExerciseReference(session.date, candidates)
    const exerciseLogs = currentLogs.filter((l) => l.exerciseId === exerciseId)

    let referenceLogs: SetLog[] | null = null
    let isDeloadReference: boolean | null = null
    if (primary.type !== 'first_time') {
      const refSession = candidates.find((c) => c.sessionId === primary.session.sessionId)
      referenceLogs = refSession ? flattenGroups(refSession.logs) : []
      const refWeekPlanId = weekPlanIdBySessionId.get(primary.session.sessionId) ?? null
      isDeloadReference = refWeekPlanId ? (isDeloadByPlanId.get(refWeekPlanId) ?? null) : null
    }

    return {
      exerciseId,
      exerciseName: exerciseNameById.get(exerciseId) ?? '(unknown exercise)',
      currentLogs: exerciseLogs,
      reference: primary,
      referenceLogs,
      isDeloadReference,
    }
  })

  // ── Phase and weight context ──────────────────────────────────────────────────
  const [{ data: phaseRows, error: phaseError }, { data: weightRows, error: weightError }] = await Promise.all([
    client.from('v2_coach_phase_entries').select('id, user_id, phase, start_date, created_at').eq('user_id', userId),
    client
      .from('v2_coach_weight_entries')
      .select('id, user_id, entry_date, weight_kg, kind, created_at')
      .eq('user_id', userId),
  ])
  if (phaseError) throw phaseError
  if (weightError) throw weightError

  const phaseEntries: PhaseEntry[] = (
    phaseRows as { id: string; user_id: string; phase: string; start_date: string; created_at: string }[]
  ).map((r) => ({
    id: r.id,
    userId: r.user_id,
    phase: r.phase as PhaseEntry['phase'],
    startDate: r.start_date,
    createdAt: r.created_at,
  }))

  const weightEntries: WeightEntry[] = (
    weightRows as { id: string; user_id: string; entry_date: string; weight_kg: number; kind: string; created_at: string }[]
  ).map((r) => ({
    id: r.id,
    userId: r.user_id,
    entryDate: r.entry_date,
    weightKg: r.weight_kg,
    kind: r.kind as WeightEntry['kind'],
    createdAt: r.created_at,
  }))

  return buildAnalysisInput({
    session: { id: session.id, date: session.date, workoutDayName },
    isDeloadCurrent,
    exercises,
    phaseEntries,
    weightEntries,
  })
}
