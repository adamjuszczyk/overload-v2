import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, differenceInCalendarWeeks, format, parseISO } from 'date-fns'
import {
  assembleSessionFacts,
  buildExercise,
  fetchIsDeload,
  toPhaseEntries,
  toWeightEntries,
  type SessionFacts,
  type AnalysisInputReference,
  type AnalysisInputSecondaryReference,
  type RawPhaseRow,
  type RawWeightRow,
} from './analysisInput.js'
import { bucketOccurrences, type TaggableOccurrence } from './weekBuckets.js'
import { phaseAt, type PhaseAtResult } from './phaseLogic.js'
import { recentWeightTrend, weekKey } from './weightLogic.js'
import type { PositionMatchResult } from '../progress/positionMatch.js'
import type {
  PhaseEntry,
  WeightEntry,
  WeeklyWeightAverage,
  ExerciseTags,
  MuscleGroup,
  MuscleSubgroup,
  MovementPattern,
  WeekAnalysisBucket,
} from '../../types/index.js'

// The week payload (COACH-WEEK-ANALYSIS-TASKS.md §4 step 5, §5.3). Same
// two-part shape as analysisInput.ts: a pure builder (buildWeekAnalysisInput,
// Vitest-covered below against constructed fixtures — no need to wait for a
// real complete week to test this) plus a thin server-side fetch layer
// (assembleWeekAnalysisInput). The fetch layer does NOT itself decide
// whether the week is complete — that is weekResolution.ts's job, and the
// caller (the future server function) is responsible for checking it before
// ever calling this. This module assumes it is being asked to assemble a
// week that is already known to be resolvable, and just reads what
// genuinely happened in that date range (§7.3 — membership, not
// expectedness).

const ISO_DATE = 'yyyy-MM-dd'

// Same not-load-bearing default as analysisInput.ts's own WEIGHT_TREND_WEEKS
// — kept as a separate constant (not imported) since the two are allowed to
// diverge independently later without one accidentally changing the other.
const WEIGHT_TREND_WEEKS = 6

// ─── Output payload (TASKS §3.2) ────────────────────────────────────────────

export interface WeekAnalysisOccurrence {
  occurrenceId: string // `${sessionId}:${exerciseId}`
  sessionId: string
  sessionDate: string
  workoutDayName: string | null
  exerciseId: string
  exerciseName: string
  // Tags as stored, carried inline (§1.4) — muscleSubgroups is null when
  // untagged. The fallback rule has already been applied to bucketKeys
  // below; these three fields are the raw truth, unmodified by it.
  muscleGroup: MuscleGroup | null
  muscleSubgroups: MuscleSubgroup[] | null
  movementPattern: MovementPattern | null
  // Which buckets this occurrence was mechanically placed in — code's
  // decision, never the model's (SPEC §8).
  bucketKeys: string[]
  reference: AnalysisInputReference
  isDeloadReference: boolean | null
  isDeloadCurrent: boolean | null
  match: PositionMatchResult | null
  // Reach-back (2026-08-22 fix, CONTEXT.md) — reused verbatim from the daily
  // payload via buildExercise, same meaning: present only when `reference`
  // resolved but had zero real comparable sets, scoped to the current meso.
  secondaryReference: AnalysisInputSecondaryReference | null
}

export interface WeekAnalysisSessionRoster {
  id: string
  date: string
  workoutDayName: string | null
  // Skipped sessions ARE included (§7.8) — a week with one skipped session
  // is a materially different week and the model should be able to say so.
  status: 'completed' | 'skipped'
  isDeload: boolean | null
  mesocycleName: string | null
  weekNumber: number | null // 1-based week within its meso
}

export interface WeekAnalysisInput {
  week: { weekStart: string; weekEnd: string }
  sessions: WeekAnalysisSessionRoster[]
  occurrences: WeekAnalysisOccurrence[] // every fact exactly once (§1.4)
  bySubgroup: WeekAnalysisBucket[]
  byPattern: WeekAnalysisBucket[]
  // Resolved once for the week, not once per session (§3.2). See
  // lastSessionDate below for exactly which date "once" means.
  phase: PhaseAtResult
  weightTrend: WeeklyWeightAverage[]
}

// ─── Pure builder ────────────────────────────────────────────────────────────

export interface BuildWeekAnalysisInputArgs {
  week: { weekStart: string; weekEnd: string }
  // The full roster — completed and skipped alike (§7.8). Already resolved
  // by the fetch layer (workout day name, mesocycle name, week number,
  // is_deload) — this builder does no further lookup on it, just places it
  // in the output and uses its dates to resolve phase/weight.
  sessions: WeekAnalysisSessionRoster[]
  // One entry per COMPLETED session only — a skipped session has no set
  // logs, so there is nothing for assembleSessionFacts to have produced for
  // it (§7.8: skipped sessions contribute zero occurrences).
  completedSessionFacts: SessionFacts[]
  // exerciseId -> tags row. A MISSING key (not merely a key mapped to
  // null-ish fields) means no `exercises` row was found at all for that id
  // (§7.12) — structurally possible since v2_program_exercises.exercise_id
  // carries no user scoping. That distinction is preserved through to
  // weekBuckets.ts's TaggableOccurrence.tags (null exactly in that case).
  tagsByExerciseId: Map<string, ExerciseTags>
  phaseEntries: PhaseEntry[]
  weightEntries: WeightEntry[]
}

// "As of the week's last session's date" (§3.2) — the latest date among
// every session in the roster, completed or skipped alike. A skipped
// session is still a real date on the calendar the week's story ran
// through, so it is not excluded from this — the alternative (completed
// sessions only) would silently use an earlier date whenever the week's
// final scheduled session was the one that got skipped. Falls back to
// weekEnd only in the defensive case of an empty roster, which should not
// occur for a week resolveWeek ever called complete (isComplete requires
// at least one session), but this function does not assume that guarantee
// holds — it is a pure function of whatever it is given.
function lastSessionDate(sessions: WeekAnalysisSessionRoster[], weekEnd: string): string {
  if (sessions.length === 0) return weekEnd
  return sessions.reduce((max, s) => (s.date > max ? s.date : max), sessions[0].date)
}

export function buildWeekAnalysisInput(args: BuildWeekAnalysisInputArgs): WeekAnalysisInput {
  const occurrences: WeekAnalysisOccurrence[] = []
  const taggable: TaggableOccurrence[] = []

  for (const facts of args.completedSessionFacts) {
    for (const source of facts.exercises) {
      const built = buildExercise(source, facts.session.id, facts.session.date, facts.currentMesocycleId)
      const occurrenceId = `${facts.session.id}:${source.exerciseId}`
      // Looked up once per occurrence; `undefined` (no key) is the §7.12
      // no-row case, kept distinct from a row whose own fields are null.
      const tagsRow = args.tagsByExerciseId.get(source.exerciseId)

      occurrences.push({
        occurrenceId,
        sessionId: facts.session.id,
        sessionDate: facts.session.date,
        workoutDayName: facts.session.workoutDayName,
        exerciseId: built.exerciseId,
        exerciseName: built.exerciseName,
        muscleGroup: tagsRow?.muscleGroup ?? null,
        muscleSubgroups: tagsRow?.muscleSubgroups ?? null,
        movementPattern: tagsRow?.movementPattern ?? null,
        bucketKeys: [], // filled in below, once bucketing has actually run
        reference: built.reference,
        isDeloadReference: built.isDeloadReference,
        isDeloadCurrent: facts.isDeloadCurrent,
        match: built.match,
        secondaryReference: built.secondaryReference,
      })

      taggable.push({
        occurrenceId,
        exerciseId: source.exerciseId,
        tags: tagsRow
          ? { muscleGroup: tagsRow.muscleGroup, muscleSubgroups: tagsRow.muscleSubgroups, movementPattern: tagsRow.movementPattern }
          : null,
      })
    }
  }

  const bucketed = bucketOccurrences(taggable)
  const bucketKeysByOccurrenceId = new Map(bucketed.occurrences.map((b) => [b.occurrenceId, b.bucketKeys]))
  for (const occ of occurrences) {
    occ.bucketKeys = bucketKeysByOccurrenceId.get(occ.occurrenceId) ?? []
  }

  const asOf = lastSessionDate(args.sessions, args.week.weekEnd)

  return {
    week: args.week,
    sessions: args.sessions,
    occurrences,
    bySubgroup: bucketed.bySubgroup,
    byPattern: bucketed.byPattern,
    phase: phaseAt(args.phaseEntries, asOf),
    weightTrend: recentWeightTrend(args.weightEntries, asOf, WEIGHT_TREND_WEEKS),
  }
}

// ─── Thin server-side fetch layer ──────────────────────────────────────────────

type RawSessionRow = {
  id: string
  date: string
  status: 'completed' | 'skipped'
  workout_day_id: string | null
  mesocycle_id: string | null
  week_plan_id: string | null
}

type RawExerciseTagRow = {
  id: string
  name: string
  muscle_group: MuscleGroup | null
  muscle_subgroup: MuscleSubgroup[] | null
  movement_pattern: MovementPattern | null
}

export async function assembleWeekAnalysisInput(
  client: SupabaseClient,
  userId: string,
  weekStartInput: string,
): Promise<WeekAnalysisInput> {
  const weekStart = weekKey(weekStartInput)
  const weekEnd = format(addDays(parseISO(weekStart), 6), ISO_DATE)

  // ── Sessions in range, completed or skipped (§7.3 — membership, not
  // expectedness: every session that actually happened in this date range,
  // whether or not weekResolution.ts's schedule-derived expectation would
  // have predicted it) ──────────────────────────────────────────────────────
  const { data: sessionRows, error: sessionsError } = await client
    .from('v2_sessions')
    .select('id, date, status, workout_day_id, mesocycle_id, week_plan_id')
    .eq('user_id', userId)
    .gte('date', weekStart)
    .lte('date', weekEnd)
    .in('status', ['completed', 'skipped'])
    .order('date', { ascending: true })
  if (sessionsError) throw sessionsError
  const sessionsRaw = sessionRows as RawSessionRow[]

  // ── Workout day names, batched across the whole roster ──────────────────────
  const workoutDayIds = [...new Set(sessionsRaw.map((s) => s.workout_day_id).filter((id): id is string => id != null))]
  const workoutDayNameById = new Map<string, string>()
  if (workoutDayIds.length > 0) {
    const { data, error } = await client.from('v2_workout_days').select('id, name').eq('user_id', userId).in('id', workoutDayIds)
    if (error) throw error
    for (const row of data as { id: string; name: string }[]) workoutDayNameById.set(row.id, row.name)
  }

  // ── Mesocycle names + start dates (start date needed for week-number
  // arithmetic below), batched ─────────────────────────────────────────────────
  const mesocycleIds = [...new Set(sessionsRaw.map((s) => s.mesocycle_id).filter((id): id is string => id != null))]
  const mesoById = new Map<string, { name: string; startDate: string }>()
  if (mesocycleIds.length > 0) {
    const { data, error } = await client.from('v2_mesocycles').select('id, name, start_date').eq('user_id', userId).in('id', mesocycleIds)
    if (error) throw error
    for (const row of data as { id: string; name: string; start_date: string }[]) {
      mesoById.set(row.id, { name: row.name, startDate: row.start_date })
    }
  }

  // ── is_deload per week plan, batched — same helper analysisInput.ts uses,
  // reused directly rather than a second copy that could drift ────────────────
  const isDeloadByPlanId = await fetchIsDeload(
    client,
    userId,
    sessionsRaw.map((s) => s.week_plan_id),
  )

  // ── Session roster. Week number always uses differenceInCalendarWeeks with
  // weekStartsOn: 1 — this app's standing rule (CONTEXT.md "Key
  // architectural rules"), never differenceInWeeks, which has no such option
  // and drifts off Monday ───────────────────────────────────────────────────────
  const sessions: WeekAnalysisSessionRoster[] = sessionsRaw.map((s) => {
    const meso = s.mesocycle_id ? mesoById.get(s.mesocycle_id) : undefined
    const weekNumber = meso
      ? differenceInCalendarWeeks(parseISO(s.date), parseISO(meso.startDate), { weekStartsOn: 1 }) + 1
      : null
    return {
      id: s.id,
      date: s.date,
      workoutDayName: s.workout_day_id ? (workoutDayNameById.get(s.workout_day_id) ?? null) : null,
      status: s.status,
      isDeload: s.week_plan_id ? (isDeloadByPlanId.get(s.week_plan_id) ?? null) : null,
      mesocycleName: meso?.name ?? null,
      weekNumber,
    }
  })

  // ── Per-session facts, completed sessions only (§7.8 — a skipped session
  // has no set logs, so there is nothing for assembleSessionFacts to read) ────
  const completedSessionFacts = await Promise.all(
    sessionsRaw.filter((s) => s.status === 'completed').map((s) => assembleSessionFacts(client, userId, s.id)),
  )

  // ── Exercise tags — the one genuinely new query in this whole feature
  // (§5.3), across every distinct exercise touched anywhere in the week ───────
  const exerciseIds = [...new Set(completedSessionFacts.flatMap((f) => f.exercises.map((e) => e.exerciseId)))]
  const tagsByExerciseId = new Map<string, ExerciseTags>()
  if (exerciseIds.length > 0) {
    const { data, error } = await client
      .from('exercises')
      .select('id, name, muscle_group, muscle_subgroup, movement_pattern')
      .eq('user_id', userId)
      .in('id', exerciseIds)
    if (error) throw error
    for (const row of data as RawExerciseTagRow[]) {
      tagsByExerciseId.set(row.id, {
        exerciseId: row.id,
        exerciseName: row.name,
        muscleGroup: row.muscle_group,
        muscleSubgroups: row.muscle_subgroup,
        movementPattern: row.movement_pattern,
      })
    }
  }

  // ── Phase and weight context, fetched once for the whole week (not once
  // per session — the point of this module existing) ──────────────────────────
  const [{ data: phaseRows, error: phaseError }, { data: weightRows, error: weightError }] = await Promise.all([
    client.from('v2_coach_phase_entries').select('id, user_id, phase, start_date, created_at').eq('user_id', userId),
    client.from('v2_coach_weight_entries').select('id, user_id, entry_date, weight_kg, kind, created_at').eq('user_id', userId),
  ])
  if (phaseError) throw phaseError
  if (weightError) throw weightError

  return buildWeekAnalysisInput({
    week: { weekStart, weekEnd },
    sessions,
    completedSessionFacts,
    tagsByExerciseId,
    phaseEntries: toPhaseEntries(phaseRows as RawPhaseRow[]),
    weightEntries: toWeightEntries(weightRows as RawWeightRow[]),
  })
}
