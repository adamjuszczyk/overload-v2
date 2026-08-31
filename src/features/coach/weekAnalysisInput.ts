import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, differenceInCalendarWeeks, format, parseISO } from 'date-fns'
import {
  assembleSessionFacts,
  buildExercise,
  fetchIsDeload,
  fetchActiveMemory,
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
import { headsOnly } from '../gym/setGroupLogic.js'
import { averageRating, FORM_SCALE, ENERGY_SCALE, PUMP_SCALE, type RatingAverage } from '../gym/ratingScales.js'
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
  EnergyRating,
  PumpRating,
  DayOfWeek,
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

// 2026-08-31 fix (CONTEXT.md, Weekly Analysis v2 fabrication finding #1) —
// one implementation, used for both WeekAnalysisSessionRoster.dayOfWeek
// (assembleWeekAnalysisInput below) and WeekAnalysisOccurrence.dayOfWeek
// (buildWeekAnalysisInput's occurrence loop), so the two can never drift
// apart on the same date. Same exact computation scheduler.ts already uses
// for program.schedule lookups (`format(date, 'EEEE').toLowerCase() as
// DayOfWeek`) — reused, not a second copy with its own casing convention.
function dayOfWeekOf(date: string): DayOfWeek {
  return format(parseISO(date), 'EEEE').toLowerCase() as DayOfWeek
}

// ─── Output payload (TASKS §3.2) ────────────────────────────────────────────

export interface WeekAnalysisOccurrence {
  occurrenceId: string // `${sessionId}:${exerciseId}`
  sessionId: string
  sessionDate: string
  // Pre-computed from sessionDate (2026-08-31 fix, see dayOfWeekOf below) —
  // never require the model to derive a weekday from a date string itself.
  dayOfWeek: DayOfWeek
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
  // Pre-computed from date (2026-08-31 fix, see dayOfWeekOf below) — never
  // require the model to derive a weekday from a date string itself.
  dayOfWeek: DayOfWeek
  workoutDayName: string | null
  // Skipped sessions ARE included (§7.8) — a week with one skipped session
  // is a materially different week and the model should be able to say so.
  status: 'completed' | 'skipped'
  isDeload: boolean | null
  mesocycleName: string | null
  weekNumber: number | null // 1-based week within its meso
  // Coach Personalization wiring into Weekly Analysis — required keys,
  // nullable types, same "absence is data too" convention as
  // AnalysisInput.session.energyRating/pumpRating (analysisInput.ts), which
  // this mirrors exactly at a per-session level: null = not rated (a
  // skipped session is never rated at all), 'none' = rated, no energy/pump
  // reported. A skipped session's DB row simply has both columns NULL, so
  // no separate branch is needed here.
  energyRating: EnergyRating | null
  pumpRating: PumpRating | null
}

// One raw Coach Note whose session falls within the week being analyzed.
// Unlike daily's `sessionNotes` (bodies only — there is only ever one
// session in scope), a week spans several sessions, so each note carries
// enough to place it against the right day: `sessionDate`/`workoutDayName`
// let the model tie a note to the specific day's occurrences in
// `occurrences`, rather than reading it as generic, undated context for
// the whole week. This solves week-scoping (which day a note belongs to
// across several sessions) — a real gap daily's single-session
// `sessionNotes` never had. It does NOT solve a related but distinct
// problem: CONTEXT.md's "Chest Press substitution described
// inconsistently" finding was a single real, already-correctly-dated
// session's note characterized two different ways in two parts of the
// same generated output ("a planned equipment swap" vs. correctly
// "forced") — a cross-section narrative-consistency failure, not a
// misattribution-to-the-wrong-day one. That failure mode is untouched by
// dating and remains open at both the daily and weekly level, same
// tracked-but-unaddressed status CONTEXT.md's "Pending feedback to
// address" already gives it — not something this field closes. No id,
// same "no ids" reasoning as daily's sessionNotes/memory (§4.5/§9.5 of
// COACH-PERSONALIZATION-TASKS.md) — the model reasons with notes, it
// never edits them. General (non-session)
// notes are out of scope here by construction: v1.1 routes every standing
// fact directly into Memory instead (COACH-PERSONALIZATION-SPEC.md §11), so
// a note with no session_id has nothing to attach a date to and is not a
// note "attached to any session within the week" — the fetch layer below
// only ever queries notes whose session_id is one of this week's own.
export interface WeekAnalysisNote {
  body: string
  sessionDate: string
  workoutDayName: string | null
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
  // Coach Personalization wiring into Weekly Analysis. Optional on purpose,
  // same reasoning as AnalysisInput.sessionNotes?/memory? (analysisInput.ts
  // §4.5): a real v2_coach_week_analyses row already exists with
  // WEEK_PROMPT_VERSION 1's frozen input_snapshot, permanently lacking every
  // field below (CONTEXT.md, "Weekly Analysis's first real output"). A
  // freshly assembled payload (assembleWeekAnalysisInput, below) always
  // populates all five as real values — [] / null, never omitted — the
  // optionality exists only for reading old stored rows back through this
  // type.
  //
  // Active Coach Memory, oldest → newest, bodies only — the exact same
  // full-list query analysisInput.ts's daily path already uses
  // (fetchActiveMemory), unchanged shape.
  memory?: string[]
  // Every Coach Note attached to a session within this week, oldest →
  // newest — see WeekAnalysisNote above for why each carries its own date.
  notes?: WeekAnalysisNote[]
  // This week's averages — reuses the exact shared pure module
  // progressService.ts's fetchMesoWeeklyProgress already uses for the
  // identical figures (ratingScales.ts's averageRating + FORM_SCALE/
  // ENERGY_SCALE/PUMP_SCALE), so the mean/ordinal/null-handling math is one
  // implementation, not a second copy that could drift. null when nothing
  // was rated. Carried alongside the individual per-session (sessions[].
  // energyRating/pumpRating) and per-set (occurrences[].match.*.formRating)
  // values above, never instead of them — the model gets both the real,
  // disaggregated facts and a week-wide summary figure, same "mechanical
  // regrouping, not blending" principle COACH-WEEK-ANALYSIS-SPEC.md §5
  // already applies to the muscle-group buckets.
  avgFormRating?: RatingAverage | null
  avgEnergyRating?: RatingAverage | null
  avgPumpRating?: RatingAverage | null
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
  // Both optional — default to [] below, so every existing caller/test that
  // doesn't care about memory/notes needs no change, same convention as
  // analysisInput.ts's BuildAnalysisInputArgs.sessionNotes/memory. Already
  // resolved by the fetch layer (bodies only for memory; body + sessionDate
  // + workoutDayName for notes) — this builder does no further lookup on
  // either, just places them in the output and folds formRating/energy/pump
  // into the week's averages below.
  memory?: string[]
  notes?: WeekAnalysisNote[]
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
        dayOfWeek: dayOfWeekOf(facts.session.date),
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

  // ── Weekly averages ──────────────────────────────────────────────────────
  // Form: every current-session set logged for any exercise in the week,
  // restricted to the same "valid" definition progressService.ts's
  // fetchMesoWeeklyProgress already uses for its own avgFormRating — headsOnly
  // (a drop stage is never counted as an independent set, the stage-exclusion
  // rule CONTEXT.md's "Key architectural rules" states and every other
  // averaged stat in this app already follows), not skipped, and real
  // weight/reps logged. Individual stages still carry their own formRating
  // inside occurrences[].match above (§7.2 of COACH-PERSONALIZATION-TASKS.md
  // — the average excludes them, the payload does not), so nothing is lost,
  // only kept out of the mean.
  const allCurrentLogs = args.completedSessionFacts.flatMap((f) => f.exercises.flatMap((e) => e.currentLogs))
  const validFormLogs = headsOnly(allCurrentLogs, (l) => l.parentSetId).filter(
    (l) => !l.isSkipped && l.weight !== null && l.reps !== null,
  )
  // Energy/pump: one rating per COMPLETED session (skipped sessions are
  // never rated — nothing to complete), same as fetchMesoWeeklyProgress's own
  // weekEnergyRatings/weekPumpRatings maps.
  const completedSessions = args.sessions.filter((s) => s.status === 'completed')

  return {
    week: args.week,
    sessions: args.sessions,
    occurrences,
    bySubgroup: bucketed.bySubgroup,
    byPattern: bucketed.byPattern,
    phase: phaseAt(args.phaseEntries, asOf),
    weightTrend: recentWeightTrend(args.weightEntries, asOf, WEIGHT_TREND_WEEKS),
    memory: args.memory ?? [],
    notes: args.notes ?? [],
    avgFormRating: averageRating(FORM_SCALE, validFormLogs.map((l) => l.formRating)),
    avgEnergyRating: averageRating(ENERGY_SCALE, completedSessions.map((s) => s.energyRating)),
    avgPumpRating: averageRating(PUMP_SCALE, completedSessions.map((s) => s.pumpRating)),
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
  energy_rating: string | null
  pump_rating: string | null
}

type RawWeekNoteRow = { body: string; session_id: string; created_at: string }

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
    .select('id, date, status, workout_day_id, mesocycle_id, week_plan_id, energy_rating, pump_rating')
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
      dayOfWeek: dayOfWeekOf(s.date),
      workoutDayName: s.workout_day_id ? (workoutDayNameById.get(s.workout_day_id) ?? null) : null,
      status: s.status,
      isDeload: s.week_plan_id ? (isDeloadByPlanId.get(s.week_plan_id) ?? null) : null,
      mesocycleName: meso?.name ?? null,
      weekNumber,
      energyRating: (s.energy_rating ?? null) as EnergyRating | null,
      pumpRating: (s.pump_rating ?? null) as PumpRating | null,
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

  // ── Every Coach Note attached to a session in this week — scoped to this
  // week's own session ids, same batched-conditional shape as the
  // workoutDayIds/mesocycleIds/exerciseIds lookups above (skip the query
  // entirely when there is nothing to scope it to, rather than issuing an
  // `.in('session_id', [])` that would just return everything unfiltered on
  // some clients). General (session_id null) notes are structurally excluded
  // — an `.in()` filter never matches a NULL column (§ WeekAnalysisNote
  // above explains why that's correct, not incidental). ───────────────────
  const sessionIds = sessionsRaw.map((s) => s.id)
  const dateBySessionId = new Map(sessionsRaw.map((s) => [s.id, s.date]))
  const workoutDayNameBySessionId = new Map(
    sessionsRaw.map((s) => [s.id, s.workout_day_id ? (workoutDayNameById.get(s.workout_day_id) ?? null) : null]),
  )
  let notes: WeekAnalysisNote[] = []
  if (sessionIds.length > 0) {
    const { data: noteRows, error: noteError } = await client
      .from('v2_coach_notes')
      .select('body, session_id, created_at')
      .eq('user_id', userId)
      .in('session_id', sessionIds)
      .order('created_at', { ascending: true })
    if (noteError) throw noteError
    notes = (noteRows as RawWeekNoteRow[]).map((r) => ({
      body: r.body,
      sessionDate: dateBySessionId.get(r.session_id) ?? '',
      workoutDayName: workoutDayNameBySessionId.get(r.session_id) ?? null,
    }))
  }

  // ── Phase and weight context, and active Coach Memory — user-scoped
  // reads, fetched once for the whole week (not once per session — the
  // point of this module existing). Memory reuses fetchActiveMemory
  // verbatim (analysisInput.ts) — the exact same full-list query the daily
  // path uses, no second implementation. ───────────────────────────────────
  const [{ data: phaseRows, error: phaseError }, { data: weightRows, error: weightError }, memory] = await Promise.all([
    client.from('v2_coach_phase_entries').select('id, user_id, phase, start_date, created_at').eq('user_id', userId),
    client.from('v2_coach_weight_entries').select('id, user_id, entry_date, weight_kg, kind, created_at').eq('user_id', userId),
    fetchActiveMemory(client, userId),
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
    memory,
    notes,
  })
}
