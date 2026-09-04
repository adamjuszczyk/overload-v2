import type { SupabaseClient } from '@supabase/supabase-js'
import {
  resolveExerciseReference,
  resolveSecondaryReference,
  type PrimarySlot,
  type SecondaryReference,
} from '../gym/referenceLogic.js'
import type { ReferenceSession } from '../gym/sessionService.js'
import { matchSessionsByPosition, type PositionMatchResult } from '../progress/positionMatch.js'
import { groupSetLogs, type SetGroup } from '../gym/setGroupLogic.js'
import { phaseAt } from './phaseLogic.js'
import { recentWeightTrend } from './weightLogic.js'
import type {
  SetLog,
  PhaseEntry,
  WeightEntry,
  ResolvedPhase,
  WeeklyWeightAverage,
  EnergyRating,
  PumpRating,
} from '../../types/index.js'

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

// Reach-back (2026-08-22 fix, CONTEXT.md): the primary reference above can
// legitimately resolve to a real session that had nothing comparable in it
// (every set for this exercise was individually skipped — date-based session
// selection and set-level comparability are deliberately separate concerns,
// see referenceLogic.ts). When that happens, this searches backward within
// the *current mesocycle only* (never a previous one — a different training
// block's programming isn't a fair "last time" comparison) for the most
// recent occurrence that actually has real logged data.
export type AnalysisInputSecondaryReference =
  | { kind: 'none_in_meso' } // this exercise never appears, with real data or not, anywhere in the current meso
  | { kind: 'all_skipped_in_meso' } // it appears this meso, but every occurrence was skipped too
  | { kind: 'found'; sessionId: string; date: string; daysSince: number; match: PositionMatchResult }

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
  // Present exactly when `reference` resolved to a real session
  // (last_week/last_time) but `match` shows zero real comparable sets on the
  // reference side (`match.plain.slotCountA === 0 && match.dropsets.slotCountA
  // === 0`) — null in every other case, including first_time (nothing to
  // reach back from) and the ordinary case where the primary already had
  // real data.
  secondaryReference: AnalysisInputSecondaryReference | null
}

export interface AnalysisInput {
  session: {
    id: string
    date: string
    workoutDayName: string | null
    // Coach Personalization phase 5 (TASKS §4.5) — required keys, nullable
    // types, same "absence is data too" convention as Session.energyRating/
    // pumpRating (types/index.ts) and SetLog.formRating: null = not rated,
    // never a default.
    energyRating: EnergyRating | null
    pumpRating: PumpRating | null
  }
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
  // mood/pump/note text is explicitly out of scope (now superseded for
  // ratings by phase 5 — session.note itself is still out of scope).
  //
  // Optional on purpose (TASKS §4.5) — every input_snapshot frozen before
  // PROMPT_VERSION 4 was written without either key, and those rows are
  // permanent (SPEC §9). A freshly assembled payload (assembleAnalysisInput,
  // below) always populates both as arrays, empty or not — the optionality
  // is for reading old stored rows back through this type, not for a live
  // assembly ever omitting them.
  sessionNotes?: string[]
  memory?: string[]
  // Swap-exercise's structural link (migration 025, PROMPT_VERSION 7,
  // 2026-09-03) — same optionality reasoning as sessionNotes/memory above:
  // every input_snapshot frozen before this field existed is permanent
  // (SPEC §9) and simply lacks it; a freshly assembled payload always
  // populates it as an array, empty or not. Feeds coachPrompt.ts the fact
  // directly ("X was swapped for Y this session") instead of leaving the
  // model to notice, on its own, that two entries in `exercises` are really
  // one substitution — the same "don't make the model derive what's already
  // knowable" principle dayOfWeek/repsDelta already apply elsewhere. See
  // this file's assembleAnalysisInput for where it's fetched.
  swaps?: AnalysisInputSwap[]
}

// originalExerciseId/replacementExerciseId can be null — the swap row's own
// FKs are ON DELETE SET NULL (migration 025), so an exercise hard-deleted
// after the swap leaves the fact intact but loses that one side's id. The
// *Name fields are what the migration denormalises specifically so the fact
// stays statable either way; the model matches swaps to `exercises` entries
// by name when an id has gone missing, same as it would from exerciseName
// alone anywhere else in this payload.
export interface AnalysisInputSwap {
  originalExerciseId: string | null
  originalExerciseName: string
  replacementExerciseId: string | null
  replacementExerciseName: string
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
  // The same unfiltered candidate list resolveExerciseReference itself
  // consumed to resolve `reference` above — reused, not re-fetched, so
  // buildExercise's reach-back (secondaryReference) is one implementation,
  // not a second copy that could drift (COACH-WEEK-ANALYSIS-TASKS.md's own
  // "reused verbatim" precedent for reference/match). Only ever walked when
  // the primary's comparable sets turn out to be all-skipped.
  secondaryCandidates: ReferenceSession[]
}

export interface BuildAnalysisInputArgs {
  session: {
    id: string
    date: string
    workoutDayName: string | null
    energyRating: EnergyRating | null
    pumpRating: PumpRating | null
  }
  isDeloadCurrent: boolean | null
  exercises: AnalysisInputExerciseSource[]
  // The current session's own mesocycle (v2_sessions.mesocycle_id) — kept
  // separate from `session` above (not nested inside it) so it can never
  // accidentally leak into AnalysisInput.session's output shape, which
  // deliberately omits it (buildAnalysisInput below assigns `args.session`
  // straight through to the output). Needed only to scope the reach-back
  // search to "within the current meso," never a previous one.
  currentMesocycleId: string | null
  phaseEntries: PhaseEntry[]
  weightEntries: WeightEntry[]
  // Both optional — default to [] in buildAnalysisInput below, so every
  // existing caller/test that doesn't care about notes/memory needs no
  // change. Oldest → newest, bodies only (§4.5's "no ids" reasoning).
  sessionNotes?: string[]
  memory?: string[]
  // Optional, same default-to-[] reasoning as sessionNotes/memory above.
  swaps?: AnalysisInputSwap[]
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

function toSecondaryReference(
  secondary: SecondaryReference,
  currentSessionId: string,
  currentDate: string,
  currentLogs: SetLog[],
): AnalysisInputSecondaryReference {
  if (secondary.type !== 'found') return { kind: secondary.type }
  return {
    kind: 'found',
    sessionId: secondary.session.sessionId,
    date: secondary.session.date,
    daysSince: secondary.daysSince,
    match: matchSessionsByPosition(
      { sessionId: secondary.session.sessionId, date: secondary.session.date, logs: flattenGroups(secondary.session.logs) },
      { sessionId: currentSessionId, date: currentDate, logs: currentLogs },
    ),
  }
}

// Exported so the weekly analysis path (COACH-WEEK-ANALYSIS-TASKS.md §5.2)
// can map an AnalysisInputExerciseSource into reference/isDeloadReference/
// match through the exact same function the daily path uses, rather than a
// second copy that could drift.
export function buildExercise(
  source: AnalysisInputExerciseSource,
  currentSessionId: string,
  currentDate: string,
  currentMesocycleId: string | null,
): AnalysisInputExercise {
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

  // Reach-back trigger: a real reference session was found, but it has zero
  // real comparable sets on either stream — the exact shape the 2026-08-22
  // fix targets (an all-skipped reference session read by the model as "not
  // logged"). first_time never reaches here (match is null) — there is
  // nothing to reach back from when no reference session exists at all.
  const secondaryReference: AnalysisInputSecondaryReference | null =
    match && match.plain.slotCountA === 0 && match.dropsets.slotCountA === 0
      ? toSecondaryReference(
          resolveSecondaryReference(currentDate, source.secondaryCandidates, currentMesocycleId),
          currentSessionId,
          currentDate,
          source.currentLogs,
        )
      : null

  return {
    exerciseId: source.exerciseId,
    exerciseName: source.exerciseName,
    reference: toReference(source.reference),
    isDeloadReference: source.reference.type === 'first_time' ? null : source.isDeloadReference,
    match,
    secondaryReference,
  }
}

export function buildAnalysisInput(args: BuildAnalysisInputArgs): AnalysisInput {
  return {
    session: args.session,
    isDeloadCurrent: args.isDeloadCurrent,
    exercises: args.exercises.map((ex) =>
      buildExercise(ex, args.session.id, args.session.date, args.currentMesocycleId),
    ),
    phase: phaseAt(args.phaseEntries, args.session.date),
    weightTrend: recentWeightTrend(args.weightEntries, args.session.date, WEIGHT_TREND_WEEKS),
    sessionNotes: args.sessionNotes ?? [],
    memory: args.memory ?? [],
    swaps: args.swaps ?? [],
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
  // Absent until migration 016 has been applied.
  form_rating?: string | null
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
    // Same "column may not exist yet" fallback as stageIndex/isWarmup above.
    // Not yet read by the payload this module builds (v3 Personalization
    // phase 5 wires it in) — extended now so the field isn't silently
    // mapped to null once phase 5 does read it (TASKS.md §2.4).
    formRating: (row.form_rating ?? null) as SetLog['formRating'],
  }
}

// Batch is_deload lookup for a set of week_plan_ids — one query regardless
// of how many sessions/exercises need it. Sessions are valid without a
// week plan (v2_sessions.week_plan_id is nullable), so the result maps a
// missing/null plan id to `null` (unknown), not `false`. Exported so the
// weekly analysis path (COACH-WEEK-ANALYSIS-TASKS.md §5.3) reuses this
// exact batched lookup for its own session roster rather than a second
// copy that could drift.
export async function fetchIsDeload(
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

// Everything assembleAnalysisInput needs EXCEPT the phase/weight fetch and
// the final buildAnalysisInput call (COACH-WEEK-ANALYSIS-TASKS.md §5.2). A
// pure move, not a rewrite — the body below is byte-identical to what this
// function's namesake block did before the split, verbatim down to the
// comments. Extracted because a weekly payload wants ONE phase/weight
// resolution for the whole week (as of the week's own last session date),
// not phaseAt/recentWeightTrend re-run and thrown away once per session —
// which is what calling assembleAnalysisInput unmodified and discarding
// .phase/.weightTrend would otherwise do.
export interface SessionFacts {
  session: {
    id: string
    date: string
    workoutDayName: string | null
    // Coach Personalization phase 5 (TASKS §4.5) — read here, alongside the
    // existing session fields, but NOT spread wholesale into
    // WeekAnalysisOccurrence by weekAnalysisInput.ts (which destructures
    // only id/date/workoutDayName off THIS object when building an
    // occurrence). Unlike formRating (carried via buildExercise →
    // matchSessionsByPosition → PositionMatchSetValue), these two never
    // reach the weekly payload through this particular object — but they do
    // reach it: weekAnalysisInput.ts's own WeekAnalysisSessionRoster carries
    // real energyRating/pumpRating per session, populated from a separate
    // fetch-layer query in assembleWeekAnalysisInput (its own
    // energy_rating/pump_rating select on the sessions-in-range query), not
    // from this SessionFacts.session object. See
    // COACH-WEEK-ANALYSIS-TASKS.md §12 for the wiring; §7.10 there
    // describes the earlier state, before that section, where they didn't
    // reach the weekly payload at all.
    energyRating: EnergyRating | null
    pumpRating: PumpRating | null
  }
  isDeloadCurrent: boolean | null
  exercises: AnalysisInputExerciseSource[]
  // See BuildAnalysisInputArgs.currentMesocycleId — kept as a sibling field
  // (not nested inside `session`) for the same output-shape leak reason.
  currentMesocycleId: string | null
}

export async function assembleSessionFacts(
  client: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<SessionFacts> {
  // ── Current session + its set logs ──────────────────────────────────────────
  const { data: sessionRow, error: sessionError } = await client
    .from('v2_sessions')
    .select(
      'id, date, workout_day_id, week_plan_id, mesocycle_id, energy_rating, pump_rating, v2_set_logs(id, user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir, note, is_dropset, parent_set_id, stage_index, is_warmup, is_skipped, logged_at, rest_seconds, form_rating, exercises(name))',
    )
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()
  if (sessionError) throw sessionError

  const session = sessionRow as unknown as {
    id: string
    date: string
    mesocycle_id: string | null
    workout_day_id: string | null
    week_plan_id: string | null
    energy_rating: string | null
    pump_rating: string | null
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
  let candidateSessions: {
    id: string
    date: string
    completed_at: string | null
    week_plan_id: string | null
    mesocycle_id: string | null
  }[] = []
  if (session.workout_day_id) {
    const { data, error } = await client
      .from('v2_sessions')
      .select('id, date, completed_at, week_plan_id, mesocycle_id')
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
        'id, user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, rir, note, is_dropset, parent_set_id, stage_index, is_warmup, is_skipped, logged_at, rest_seconds, form_rating, exercises(name)',
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
  const mesocycleIdBySessionId = new Map(candidateSessions.map((s) => [s.id, s.mesocycle_id]))

  function referenceSessionsFor(exerciseId: string): ReferenceSession[] {
    const bySession = referenceLogsByExerciseAndSession.get(exerciseId)
    if (!bySession) return []
    return [...bySession.entries()]
      .map(([sid, logs]) => ({
        sessionId: sid,
        date: dateBySessionId.get(sid)!,
        completedAt: completedAtBySessionId.get(sid) ?? null,
        mesocycleId: mesocycleIdBySessionId.get(sid) ?? null,
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
      secondaryCandidates: candidates,
    }
  })

  return {
    session: {
      id: session.id,
      date: session.date,
      workoutDayName,
      energyRating: (session.energy_rating ?? null) as EnergyRating | null,
      pumpRating: (session.pump_rating ?? null) as PumpRating | null,
    },
    isDeloadCurrent,
    exercises,
    currentMesocycleId: session.mesocycle_id,
  }
}

// Row → domain mappers for the two Context-tab tables, extracted (pure move,
// same discipline as assembleSessionFacts's own extraction) so the weekly
// analysis path's single week-level phase/weight fetch
// (COACH-WEEK-ANALYSIS-TASKS.md §5.3) reuses the exact same mapping rather
// than a second copy that could drift.
export type RawPhaseRow = { id: string; user_id: string; phase: string; start_date: string; created_at: string }
export type RawWeightRow = { id: string; user_id: string; entry_date: string; weight_kg: number; kind: string; created_at: string }

export function toPhaseEntries(rows: RawPhaseRow[]): PhaseEntry[] {
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    phase: r.phase as PhaseEntry['phase'],
    startDate: r.start_date,
    createdAt: r.created_at,
  }))
}

export function toWeightEntries(rows: RawWeightRow[]): WeightEntry[] {
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    entryDate: r.entry_date,
    weightKg: r.weight_kg,
    kind: r.kind as WeightEntry['kind'],
    createdAt: r.created_at,
  }))
}

// Unchanged signature, unchanged behaviour (verified against real production
// data post-extraction — COACH-WEEK-ANALYSIS-TASKS.md §5.4): now
// assembleSessionFacts + the phase/weight fetch + buildAnalysisInput,
// instead of one block that did all three inline.
// Coach Personalization phase 5 (TASKS §4.5) — bodies only, no ids (§9.5):
// the daily prompt reasons with these, it never edits them, so an id would
// only invite a citation the output schema has no slot for.
type RawMemoryBodyRow = { body: string }
type RawNoteBodyRow = { body: string }

// Exported so the weekly analysis path (COACH-WEEK-ANALYSIS-TASKS.md's own
// personalization wiring) reuses the exact same full-active-list query
// rather than a second copy that could drift — this query's shape is
// identical for both callers (every active entry, oldest first), unlike the
// notes query below, which daily scopes to one session and weekly scopes to
// every session in the week being analyzed.
export async function fetchActiveMemory(client: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await client
    .from('v2_coach_memory_entries')
    .select('body')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data as RawMemoryBodyRow[]).map((r) => r.body)
}

export async function assembleAnalysisInput(
  client: SupabaseClient,
  userId: string,
  sessionId: string,
): Promise<AnalysisInput> {
  const facts = await assembleSessionFacts(client, userId, sessionId)

  // ── Phase/weight context, active Coach Memory, and this session's own
  // Coach Notes — all user- or session-scoped reads, fetched together
  // (TASKS §4.5, §7.8 reversed 2026-08-25: the analyzed session's own notes
  // reach the daily prompt directly, not gated on curation status, since
  // curation's roughly-weekly cadence structurally cannot reach a same-day
  // analysis) ────────────────────────────────────────────────────────────────
  const [
    { data: phaseRows, error: phaseError },
    { data: weightRows, error: weightError },
    memory,
    { data: noteRows, error: noteError },
    { data: swapRows, error: swapError },
  ] = await Promise.all([
    client.from('v2_coach_phase_entries').select('id, user_id, phase, start_date, created_at').eq('user_id', userId),
    client
      .from('v2_coach_weight_entries')
      .select('id, user_id, entry_date, weight_kg, kind, created_at')
      .eq('user_id', userId),
    fetchActiveMemory(client, userId),
    client
      .from('v2_coach_notes')
      .select('body')
      .eq('user_id', userId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    // Swap-exercise's structural link (migration 025) — scoped to this
    // session only, same as the notes query above. RLS already scopes to
    // user_id; the explicit filter matches this file's own defence-in-depth
    // convention for every other user-scoped query here.
    client
      .from('v2_session_exercise_swaps')
      .select('original_exercise_id, original_exercise_name, replacement_exercise_id, replacement_exercise_name')
      .eq('user_id', userId)
      .eq('session_id', sessionId),
  ])
  if (phaseError) throw phaseError
  if (weightError) throw weightError
  if (noteError) throw noteError
  if (swapError) throw swapError

  const phaseEntries = toPhaseEntries(phaseRows as RawPhaseRow[])
  const weightEntries = toWeightEntries(weightRows as RawWeightRow[])
  const sessionNotes = (noteRows as RawNoteBodyRow[]).map((r) => r.body)
  const swaps: AnalysisInputSwap[] = (
    swapRows as {
      original_exercise_id: string | null
      original_exercise_name: string
      replacement_exercise_id: string | null
      replacement_exercise_name: string
    }[]
  ).map((r) => ({
    originalExerciseId: r.original_exercise_id,
    originalExerciseName: r.original_exercise_name,
    replacementExerciseId: r.replacement_exercise_id,
    replacementExerciseName: r.replacement_exercise_name,
  }))

  return buildAnalysisInput({
    session: facts.session,
    isDeloadCurrent: facts.isDeloadCurrent,
    exercises: facts.exercises,
    currentMesocycleId: facts.currentMesocycleId,
    phaseEntries,
    weightEntries,
    sessionNotes,
    memory,
    swaps,
  })
}
