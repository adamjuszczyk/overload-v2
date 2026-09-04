import type { SupabaseClient } from '@supabase/supabase-js'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import { fetchMesoWeekRollups } from './mesoWeekRollup.js'
import type { WeekRollup } from './mesoWeekRollup.js'
import { fetchPriorityContext } from './priorityContext.js'
import type { PriorityContext } from './priorityContext.js'
import { fetchActiveMemory, toPhaseEntries, toWeightEntries } from './analysisInput.js'
import type { RawPhaseRow, RawWeightRow } from './analysisInput.js'
import { phaseAt } from './phaseLogic.js'
import type { PhaseAtResult } from './phaseLogic.js'
import { recentWeightTrend } from './weightLogic.js'
import { groupWeekPlanSets, headsOnly } from '../gym/setGroupLogic.js'
import { averageRating, FORM_SCALE } from '../gym/ratingScales.js'
import type { RatingAverage } from '../gym/ratingScales.js'
import { sessionE1rmAvg } from '../progress/e1rm.js'
import type { E1rmSetInput } from '../progress/e1rm.js'
import type { WeekPlanSet, MuscleGroup, MuscleSubgroup, MovementPattern, PhaseEntry, WeightEntry, WeeklyWeightAverage, FormRating } from '../../types/index.js'

// Mesocycle Analysis's aggregation layer (MESOCYCLE-ANALYSIS-TASKS.md §2).
// Same two-part split as analysisInput.ts / weekAnalysisInput.ts:
// buildMesoAnalysisInput (pure, Vitest-covered against constructed fixtures)
// and assembleMesoAnalysisInput (injected client, queries only). Imports
// Step R's mesoWeekRollup.ts for the shared meso-week fetch rather than
// re-implementing or re-extracting it (§2.5) — this module never truncates
// it, unlike qaContext.ts's Q&A-specific `.slice(-ROLLUP_WEEKS)`.
//
// The deterministic/judgment line (§1): week bucketing, e1RM, volume,
// completed-vs-planned, swap resolution, and grouping all live here in code.
// Which trajectories are worth mentioning, whether a decline is real, and
// all prose are left to the model (Phase 4+), not this module.

// ─── Output payload (§2.1) ──────────────────────────────────────────────────

export interface MesoSummary {
  id: string
  name: string
  startDate: string
  endDate: string | null
  weekCount: number
  statusAtAnalysis: string
}

export interface MesoWeekContext {
  weekNumber: number
  sessionsInWeek: number
  totalSets: number
  avgRir: number | null
  avgReps: number | null
  avgDurationSeconds: number | null
  avgFormRating: RatingAverage | null
  avgEnergyRating: RatingAverage | null
  avgPumpRating: RatingAverage | null
  isDeload: boolean
}

// SPEC §3's required per-week fields, one per week this exercise was
// scheduled or performed — NOT densified across the meso's full span the
// way the top-level `weeks` above is (§2.3's densification is a meso-wide
// statement; an exercise absent from both the plan and the log in a given
// week has nothing to say for that week, unlike the meso as a whole, which
// always has *a* week 1 whether or not anything was trained in it).
export interface ExerciseWeekPoint {
  weekNumber: number
  e1rmAvg: number | null // null = not computable this week, never a decline (§2.2)
  volume: number // Σ weight×reps, INCLUDING drop stages (§2.1)
  setsCompleted: number // heads, not skipped, excludes drop stages (§2.1)
  setsPlanned: number | null // null when unresolvable, never 0-as-unknown (§2.4)
  sessionsInWeek: number
  isDeload: boolean
  avgRir: number | null
  avgReps: number | null
  avgFormRating: RatingAverage | null
  // §3.3 Case C — a question, not a finding. Set when this week's e1rmAvg
  // moves more than DISCONTINUITY_THRESHOLD_PERCENT against this exercise's
  // own trailing median and nothing else explains it (not a deload week,
  // not an incomplete week vs. its own plan).
  discontinuityFlag: boolean
}

export interface ExerciseTrajectory {
  exerciseId: string
  exerciseName: string
  muscleGroup: MuscleGroup | null
  muscleSubgroups: MuscleSubgroup[] | null
  movementPattern: MovementPattern | null
  points: ExerciseWeekPoint[]
}

// §3.3 Case A — a structurally linked swap, read and stated as fact.
export interface MesoSwapGroup {
  originalExerciseId: string | null
  originalExerciseName: string
  replacementExerciseId: string | null
  replacementExerciseName: string
  sessionId: string
  sessionDate: string
  weekNumber: number
}

// §3.3 Case B — the raw both-halves co-occurrence only, never a claimed
// pairing (26 exercises and multi-exercise sessions make "same session"
// a candidate, not a fact).
export interface UnlinkedSwapCandidate {
  sessionId: string
  sessionDate: string
  weekNumber: number
  abandonedExerciseIds: string[]
  unplannedExerciseIds: string[]
}

export interface MesoSessionNote {
  body: string
  sessionDate: string
  workoutDayName: string | null
}

export interface MesoAnalysisInput {
  meso: MesoSummary
  weeks: MesoWeekContext[]
  exercises: ExerciseTrajectory[]
  swaps: MesoSwapGroup[]
  unlinkedSwapCandidates: UnlinkedSwapCandidate[]
  priority: PriorityContext
  phase: PhaseAtResult
  weightTrend: WeeklyWeightAverage[]
  memory: string[]
  notes: MesoSessionNote[]
}

// A5 (MESOCYCLE-ANALYSIS-TASKS.md §3.3/§8): recommended conservative 25% —
// a false negative here is the headline artifact going unchallenged, a
// false positive is one extra hedged sentence.
export const DISCONTINUITY_THRESHOLD_PERCENT = 25

// Not specified by SPEC as an exact number — matching analysisInput.ts's /
// weekAnalysisInput.ts's own WEIGHT_TREND_WEEKS constant/reasoning.
const WEIGHT_TREND_WEEKS = 6

function weekNumberOf(date: string, mesoStartDate: string): number {
  return differenceInCalendarWeeks(parseISO(date), parseISO(mesoStartDate), { weekStartsOn: 1 }) + 1
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

// Mirrors progressService.ts's isStageOfSkippedHead exactly (found by
// adversarial review there, TASKS §0.1's reuse table: "do not re-derive") —
// re-implemented here, not imported, because progressService.ts's
// module-level import of the browser-singleton `supabase` client
// (../../lib/supabase.js) throws at load outside a Vite app, the same risk
// analysisInput.ts's own header documents at length. This module must stay
// safely importable from a Vercel function, so it cannot pull in anything
// that transitively imports that singleton.
function isStageOfSkippedHead(parentSetId: string | null, skippedById: Map<string, boolean>): boolean {
  return parentSetId != null && skippedById.get(parentSetId) === true
}

function toE1rmSetInput(l: MesoSetLogInput): E1rmSetInput {
  return { weight: l.weight, reps: l.reps, rir: l.rir, isSkipped: l.isSkipped, isWarmup: l.isWarmup, parentSetId: l.parentSetId }
}

// §3.3 Case C — set only when nothing else already explains the move: not a
// deload week (an expected dip), and not a week where fewer sets were
// completed than planned (a resolvable, already-visible incompleteness that
// would explain a different average on its own). Mutates `points` in place;
// `points` must already be sorted by weekNumber ascending.
function applyDiscontinuityFlags(points: ExerciseWeekPoint[]): void {
  for (let i = 0; i < points.length; i++) {
    const point = points[i]
    if (point.e1rmAvg === null || point.isDeload) continue

    const priorValues = points
      .slice(0, i)
      .filter((p) => !p.isDeload && p.e1rmAvg !== null)
      .map((p) => p.e1rmAvg as number)
    if (priorValues.length === 0) continue

    const trailingMedian = median(priorValues)
    if (trailingMedian === 0) continue
    const percentMove = Math.abs((point.e1rmAvg - trailingMedian) / trailingMedian) * 100

    const explainedByIncompleteWork = point.setsPlanned !== null && point.setsCompleted < point.setsPlanned
    if (percentMove > DISCONTINUITY_THRESHOLD_PERCENT && !explainedByIncompleteWork) {
      point.discontinuityFlag = true
    }
  }
}

// ─── Pure builder ────────────────────────────────────────────────────────────

export interface MesoInput {
  id: string
  name: string
  startDate: string
  endDate: string | null
  status: string
}

// One flat row per set log across every exercise, every completed session in
// the meso — the builder does its own per-(exercise, week) grouping from
// this, rather than the fetch layer pre-grouping it (§2's own emphasis on
// keeping the arithmetic in tested, pure code).
export interface MesoSetLogInput {
  id: string
  sessionId: string
  sessionDate: string
  exerciseId: string
  weight: number | null
  reps: number | null
  rir: number | null
  isSkipped: boolean
  isWarmup: boolean
  parentSetId: string | null
  formRating: FormRating | null
}

export interface MesoSessionSummary {
  id: string
  date: string
  workoutDayName: string | null
}

export interface MesoExerciseTagInput {
  exerciseName: string
  muscleGroup: MuscleGroup | null
  muscleSubgroups: MuscleSubgroup[] | null
  movementPattern: MovementPattern | null
}

// One row per (week_number, exerciseId) with a nonzero planned head count —
// a week/exercise combination with a resolvable plan but zero planned sets
// simply has no row here (see resolvedPlanWeeks for the null-vs-zero split,
// §2.4).
export interface MesoPlannedHeadCount {
  weekNumber: number
  exerciseId: string
  headCount: number
}

export interface MesoSwapRow {
  sessionId: string
  sessionDate: string
  originalExerciseId: string | null
  originalExerciseName: string
  replacementExerciseId: string | null
  replacementExerciseName: string
}

export interface BuildMesoAnalysisInputArgs {
  meso: MesoInput
  weekRollups: WeekRollup[] // unsliced, from fetchMesoWeekRollups (Step R)
  sessions: MesoSessionSummary[] // one per completed session
  setLogs: MesoSetLogInput[]
  exerciseTags: Map<string, MesoExerciseTagInput>
  plannedHeadCounts: MesoPlannedHeadCount[]
  resolvedPlanWeeks: Set<number> // week numbers with at least one v2_week_plans row (§2.4)
  deloadWeeks: Set<number>
  // sessionId -> exerciseIds planned for that specific session (via its own
  // week_plan_id — one row per workout day per week, so a session's
  // week_plan_id already identifies exactly the one day's plan, no further
  // workout_day_id filtering needed).
  plannedExerciseIdsBySession: Map<string, Set<string>>
  swaps: MesoSwapRow[] // §3.3 Case A
  priority: PriorityContext
  phaseEntries: PhaseEntry[]
  weightEntries: WeightEntry[]
  memory?: string[]
  notes?: MesoSessionNote[]
}

function lastRelevantDate(meso: MesoInput, sessions: MesoSessionSummary[]): string {
  if (meso.endDate) return meso.endDate
  if (sessions.length === 0) return meso.startDate
  return sessions.reduce((max, s) => (s.date > max ? s.date : max), sessions[0].date)
}

export function buildMesoAnalysisInput(args: BuildMesoAnalysisInputArgs): MesoAnalysisInput {
  const { meso } = args

  // ── Top-level, meso-wide weeks — densified across the full observed span
  // (§2.3), not emitted only where a session landed: `weeks` runs from
  // min(1, firstObservedWeek) to maxObservedWeek, with any week having no
  // sessions explicitly zeroed rather than absent. ────────────────────────
  const sessionWeekNumbers = args.sessions.map((s) => weekNumberOf(s.date, meso.startDate))
  const observedWeekNumbers = new Set<number>([...args.weekRollups.map((w) => w.weekNumber), ...sessionWeekNumbers])

  const rollupByWeek = new Map(args.weekRollups.map((w) => [w.weekNumber, w]))
  const sessionCountByWeek = new Map<number, number>()
  for (const wk of sessionWeekNumbers) sessionCountByWeek.set(wk, (sessionCountByWeek.get(wk) ?? 0) + 1)

  const weeks: MesoWeekContext[] = []
  if (observedWeekNumbers.size > 0) {
    const firstObserved = Math.min(...observedWeekNumbers)
    const lastObserved = Math.max(...observedWeekNumbers)
    const first = Math.min(1, firstObserved)
    for (let wk = first; wk <= lastObserved; wk++) {
      const rollup = rollupByWeek.get(wk)
      weeks.push({
        weekNumber: wk,
        sessionsInWeek: sessionCountByWeek.get(wk) ?? 0,
        totalSets: rollup?.totalSets ?? 0,
        avgRir: rollup?.avgRir ?? null,
        avgReps: rollup?.avgReps ?? null,
        avgDurationSeconds: rollup?.avgDurationSeconds ?? null,
        avgFormRating: rollup?.avgFormRating ?? null,
        avgEnergyRating: rollup?.avgEnergyRating ?? null,
        avgPumpRating: rollup?.avgPumpRating ?? null,
        isDeload: rollup ? rollup.isDeload : args.deloadWeeks.has(wk),
      })
    }
  }

  // ── Exercise trajectories ────────────────────────────────────────────────
  const skippedById = new Map(args.setLogs.map((l) => [l.id, l.isSkipped]))
  const plannedHeadCountByKey = new Map(args.plannedHeadCounts.map((p) => [`${p.weekNumber}:${p.exerciseId}`, p.headCount]))

  const exerciseIds = new Set<string>()
  for (const l of args.setLogs) exerciseIds.add(l.exerciseId)
  for (const p of args.plannedHeadCounts) exerciseIds.add(p.exerciseId)

  const exercises: ExerciseTrajectory[] = [...exerciseIds].map((exerciseId) => {
    const tags = args.exerciseTags.get(exerciseId)
    const logsForExercise = args.setLogs.filter((l) => l.exerciseId === exerciseId)

    const weekNumbers = new Set<number>()
    for (const l of logsForExercise) weekNumbers.add(weekNumberOf(l.sessionDate, meso.startDate))
    for (const p of args.plannedHeadCounts) {
      if (p.exerciseId === exerciseId && p.headCount > 0) weekNumbers.add(p.weekNumber)
    }

    const points: ExerciseWeekPoint[] = [...weekNumbers]
      .sort((a, b) => a - b)
      .map((wk) => {
        const weekLogs = logsForExercise.filter((l) => weekNumberOf(l.sessionDate, meso.startDate) === wk)
        const heads = headsOnly(weekLogs, (l) => l.parentSetId)
        const valid = heads.filter((l) => !l.isSkipped && l.weight !== null && l.reps !== null)
        const withRir = valid.filter((l) => l.rir !== null)

        // volume KEEPS drop stages (a stage is real work performed) — but a
        // stage under a skipped head never represents real performed work,
        // regardless of its own values (progressService.ts:190-212, §2.1).
        const volumeEligible = weekLogs.filter(
          (l) => l.weight !== null && l.reps !== null && !isStageOfSkippedHead(l.parentSetId, skippedById),
        )
        const volume = volumeEligible.reduce((sum, l) => sum + l.weight! * l.reps!, 0)

        // e1RM: sessionE1rmAvg per session, then averaged across the week's
        // sessions (§2.2) — not recomputed from a flattened set list, since
        // that would silently change which sets are eligible per session.
        const sessionIdsThisWeek = [...new Set(weekLogs.map((l) => l.sessionId))]
        const perSessionAvgs = sessionIdsThisWeek
          .map((sid) => sessionE1rmAvg(weekLogs.filter((l) => l.sessionId === sid).map(toE1rmSetInput)))
          .filter((v): v is number => v !== null)
        const e1rmAvg = perSessionAvgs.length > 0 ? perSessionAvgs.reduce((s, v) => s + v, 0) / perSessionAvgs.length : null

        const setsPlanned = args.resolvedPlanWeeks.has(wk) ? (plannedHeadCountByKey.get(`${wk}:${exerciseId}`) ?? 0) : null

        return {
          weekNumber: wk,
          e1rmAvg,
          volume,
          setsCompleted: valid.length,
          setsPlanned,
          sessionsInWeek: sessionIdsThisWeek.length,
          isDeload: args.deloadWeeks.has(wk),
          avgRir: withRir.length > 0 ? withRir.reduce((s, l) => s + l.rir!, 0) / withRir.length : null,
          avgReps: valid.length > 0 ? valid.reduce((s, l) => s + l.reps!, 0) / valid.length : null,
          avgFormRating: averageRating(FORM_SCALE, valid.map((l) => l.formRating)),
          discontinuityFlag: false,
        }
      })

    applyDiscontinuityFlags(points)

    return {
      exerciseId,
      exerciseName: tags?.exerciseName ?? '(unknown exercise)',
      muscleGroup: tags?.muscleGroup ?? null,
      muscleSubgroups: tags?.muscleSubgroups ?? null,
      movementPattern: tags?.movementPattern ?? null,
      points,
    }
  })

  // ── §3.3 Case A — linked swaps, read and stated as fact ─────────────────
  const swaps: MesoSwapGroup[] = args.swaps.map((s) => ({
    originalExerciseId: s.originalExerciseId,
    originalExerciseName: s.originalExerciseName,
    replacementExerciseId: s.replacementExerciseId,
    replacementExerciseName: s.replacementExerciseName,
    sessionId: s.sessionId,
    sessionDate: s.sessionDate,
    weekNumber: weekNumberOf(s.sessionDate, meso.startDate),
  }))

  // ── §3.3 Case B — the raw both-halves co-occurrence, candidates only.
  // Sessions already covered by a Case A structural row are excluded here —
  // that swap is a stated fact already, not also a candidate to weigh. ────
  const sessionIdsWithLinkedSwap = new Set(args.swaps.map((s) => s.sessionId))
  const unlinkedSwapCandidates: UnlinkedSwapCandidate[] = []
  for (const session of args.sessions) {
    if (sessionIdsWithLinkedSwap.has(session.id)) continue
    const plannedIds = args.plannedExerciseIdsBySession.get(session.id) ?? new Set<string>()
    const sessionLogs = args.setLogs.filter((l) => l.sessionId === session.id)
    const sessionHeads = headsOnly(sessionLogs, (l) => l.parentSetId)

    const loggedExerciseIds = new Set<string>()
    const validExerciseIds = new Set<string>()
    for (const l of sessionHeads) {
      loggedExerciseIds.add(l.exerciseId)
      if (!l.isSkipped && l.weight !== null && l.reps !== null) validExerciseIds.add(l.exerciseId)
    }

    // Abandoned: planned this session but never logged with real data
    // (all skipped, or planned and never logged at all).
    const abandonedExerciseIds = [...plannedIds].filter((exId) => !validExerciseIds.has(exId))
    // Unplanned: real logged data for an exercise not part of this
    // session's own plan.
    const unplannedExerciseIds = [...validExerciseIds].filter((exId) => !plannedIds.has(exId))

    if (abandonedExerciseIds.length > 0 && unplannedExerciseIds.length > 0) {
      unlinkedSwapCandidates.push({
        sessionId: session.id,
        sessionDate: session.date,
        weekNumber: weekNumberOf(session.date, meso.startDate),
        abandonedExerciseIds,
        unplannedExerciseIds,
      })
    }
  }

  const asOf = lastRelevantDate(meso, args.sessions)

  return {
    meso: {
      id: meso.id,
      name: meso.name,
      startDate: meso.startDate,
      endDate: meso.endDate,
      weekCount: weeks.length,
      statusAtAnalysis: meso.status,
    },
    weeks,
    exercises,
    swaps,
    unlinkedSwapCandidates,
    priority: args.priority,
    phase: phaseAt(args.phaseEntries, asOf),
    weightTrend: recentWeightTrend(args.weightEntries, asOf, WEIGHT_TREND_WEEKS),
    memory: args.memory ?? [],
    notes: args.notes ?? [],
  }
}

// ─── Thin server-side fetch layer ──────────────────────────────────────────

type RawMesoRow = { id: string; name: string; start_date: string; end_date: string | null; status: string }

type RawSetLogRow = {
  id: string
  exercise_id: string
  weight: number | null
  reps: number | null
  rir: number | null
  is_skipped: boolean
  is_warmup: boolean
  parent_set_id: string | null
  form_rating: FormRating | null
}
type RawSessionRow = {
  id: string
  date: string
  workout_day_id: string | null
  week_plan_id: string | null
  v2_set_logs: RawSetLogRow[]
}

type RawWeekPlanSetRow = {
  id: string
  parent_week_plan_set_id: string | null
  stage_index: number
  set_number: number
  target_rir: number | null
  is_dropset: boolean
  v2_program_exercises: { exercise_id: string } | null
}
type RawWeekPlanRow = { id: string; week_number: number; is_deload: boolean }

type RawExerciseTagRow = {
  id: string
  name: string
  muscle_group: MuscleGroup | null
  muscle_subgroup: MuscleSubgroup[] | null
  movement_pattern: MovementPattern | null
}

export async function assembleMesoAnalysisInput(
  client: SupabaseClient,
  userId: string,
  mesocycleId: string,
): Promise<MesoAnalysisInput> {
  const { data: mesoRow, error: mesoError } = await client
    .from('v2_mesocycles')
    .select('id, name, start_date, end_date, status')
    .eq('id', mesocycleId)
    .eq('user_id', userId)
    .single()
  if (mesoError) throw mesoError
  const mesoRaw = mesoRow as RawMesoRow

  const [
    weekRollups,
    priority,
    { data: sessionRows, error: sessionsError },
    { data: weekPlanRows, error: weekPlansError },
    { data: phaseRows, error: phaseError },
    { data: weightRows, error: weightError },
    memory,
  ] = await Promise.all([
    fetchMesoWeekRollups(client, userId, mesocycleId, mesoRaw.start_date),
    fetchPriorityContext(client, userId, mesocycleId),
    client
      .from('v2_sessions')
      .select(
        'id, date, workout_day_id, week_plan_id, v2_set_logs(id, exercise_id, weight, reps, rir, is_skipped, is_warmup, parent_set_id, form_rating)',
      )
      .eq('user_id', userId)
      .eq('mesocycle_id', mesocycleId)
      .eq('status', 'completed')
      .order('date', { ascending: true }),
    client.from('v2_week_plans').select('id, week_number, is_deload').eq('user_id', userId).eq('mesocycle_id', mesocycleId),
    client.from('v2_coach_phase_entries').select('id, user_id, phase, start_date, created_at').eq('user_id', userId),
    client
      .from('v2_coach_weight_entries')
      .select('id, user_id, entry_date, weight_kg, kind, created_at')
      .eq('user_id', userId),
    fetchActiveMemory(client, userId),
  ])
  if (sessionsError) throw sessionsError
  if (weekPlansError) throw weekPlansError
  if (phaseError) throw phaseError
  if (weightError) throw weightError

  const sessionsRaw = sessionRows as unknown as RawSessionRow[]
  const weekPlansRaw = weekPlanRows as RawWeekPlanRow[]
  const weekPlanIds = weekPlansRaw.map((p) => p.id)
  const weekNumberByPlanId = new Map(weekPlansRaw.map((p) => [p.id, p.week_number]))
  const sessionIds = sessionsRaw.map((s) => s.id)
  const workoutDayIds = [...new Set(sessionsRaw.map((s) => s.workout_day_id).filter((id): id is string => id != null))]

  const [
    { data: workoutDayRows, error: workoutDayError },
    { data: weekPlanSetRows, error: weekPlanSetError },
    { data: swapRows, error: swapError },
    { data: noteRows, error: noteError },
  ] = await Promise.all([
    workoutDayIds.length > 0
      ? client.from('v2_workout_days').select('id, name').eq('user_id', userId).in('id', workoutDayIds)
      : Promise.resolve({ data: [], error: null }),
    weekPlanIds.length > 0
      ? client
          .from('v2_week_plan_sets')
          .select('id, parent_week_plan_set_id, stage_index, set_number, target_rir, is_dropset, week_plan_id, v2_program_exercises(exercise_id)')
          .eq('user_id', userId)
          .in('week_plan_id', weekPlanIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length > 0
      ? client
          .from('v2_session_exercise_swaps')
          .select('session_id, original_exercise_id, original_exercise_name, replacement_exercise_id, replacement_exercise_name')
          .eq('user_id', userId)
          .in('session_id', sessionIds)
      : Promise.resolve({ data: [], error: null }),
    sessionIds.length > 0
      ? client
          .from('v2_coach_notes')
          .select('body, session_id, created_at')
          .eq('user_id', userId)
          .in('session_id', sessionIds)
          .order('created_at', { ascending: true })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (workoutDayError) throw workoutDayError
  if (weekPlanSetError) throw weekPlanSetError
  if (swapError) throw swapError
  if (noteError) throw noteError

  const workoutDayNameById = new Map((workoutDayRows as { id: string; name: string }[]).map((r) => [r.id, r.name]))
  const dateBySessionId = new Map(sessionsRaw.map((s) => [s.id, s.date]))
  const workoutDayNameBySessionId = new Map(
    sessionsRaw.map((s) => [s.id, s.workout_day_id ? (workoutDayNameById.get(s.workout_day_id) ?? null) : null]),
  )

  // ── Planned sets: group per week_plan_id (one row per workout day per
  // week — a session's own week_plan_id already identifies exactly the one
  // day's plan, §2.4/BuildMesoAnalysisInputArgs.plannedExerciseIdsBySession
  // comment), then fold into per-(week_number, exerciseId) head counts. ──
  const weekPlanSetsRaw = ((weekPlanSetRows ?? []) as unknown as (RawWeekPlanSetRow & { week_plan_id: string })[])
  const setsByPlanId = new Map<string, RawWeekPlanSetRow[]>()
  for (const row of weekPlanSetsRaw) {
    const list = setsByPlanId.get(row.week_plan_id)
    if (list) list.push(row)
    else setsByPlanId.set(row.week_plan_id, [row])
  }

  const exerciseIdsByPlanId = new Map<string, Set<string>>()
  const plannedHeadCountByWeekExercise = new Map<string, number>()
  for (const [planId, rows] of setsByPlanId.entries()) {
    const asWeekPlanSets: WeekPlanSet[] = rows.map((r) => ({
      id: r.id,
      weekPlanId: planId,
      userId,
      programExerciseId: '', // unused by groupWeekPlanSets
      setNumber: r.set_number,
      targetRir: r.target_rir,
      isDropset: r.is_dropset,
      parentWeekPlanSetId: r.parent_week_plan_set_id,
      stageIndex: r.stage_index,
      isWarmup: false, // unused by groupWeekPlanSets
    }))
    const groups = groupWeekPlanSets(asWeekPlanSets)
    const exerciseIdById = new Map(rows.map((r) => [r.id, r.v2_program_exercises?.exercise_id ?? null]))
    const exerciseIdsThisPlan = new Set<string>()

    for (const group of groups) {
      const exId = exerciseIdById.get(group.head.id)
      if (!exId) continue
      exerciseIdsThisPlan.add(exId)
      const weekNumber = weekNumberByPlanId.get(planId)
      if (weekNumber === undefined) continue
      const key = `${weekNumber}:${exId}`
      plannedHeadCountByWeekExercise.set(key, (plannedHeadCountByWeekExercise.get(key) ?? 0) + 1)
    }
    exerciseIdsByPlanId.set(planId, exerciseIdsThisPlan)
  }

  const plannedHeadCounts: MesoPlannedHeadCount[] = [...plannedHeadCountByWeekExercise.entries()].map(([key, headCount]) => {
    const [weekNumberStr, exerciseId] = key.split(':')
    return { weekNumber: Number(weekNumberStr), exerciseId, headCount }
  })

  const plannedExerciseIdsBySession = new Map<string, Set<string>>()
  for (const s of sessionsRaw) {
    if (!s.week_plan_id) continue
    plannedExerciseIdsBySession.set(s.id, exerciseIdsByPlanId.get(s.week_plan_id) ?? new Set())
  }

  const resolvedPlanWeeks = new Set(weekPlansRaw.map((p) => p.week_number))
  const deloadWeeks = new Set(weekPlansRaw.filter((p) => p.is_deload).map((p) => p.week_number))

  // ── Flatten every set log across every session, tagging each with its
  // session's date (the builder computes week numbers itself, §2.3). ──────
  const setLogs: MesoSetLogInput[] = sessionsRaw.flatMap((s) =>
    (s.v2_set_logs ?? []).map((l) => ({
      id: l.id,
      sessionId: s.id,
      sessionDate: s.date,
      exerciseId: l.exercise_id,
      weight: l.weight,
      reps: l.reps,
      rir: l.rir,
      isSkipped: l.is_skipped,
      isWarmup: l.is_warmup,
      parentSetId: l.parent_set_id,
      formRating: l.form_rating,
    })),
  )

  const sessions: MesoSessionSummary[] = sessionsRaw.map((s) => ({
    id: s.id,
    date: s.date,
    workoutDayName: s.workout_day_id ? (workoutDayNameById.get(s.workout_day_id) ?? null) : null,
  }))

  // ── Exercise tags, across every exercise touched by a set log or a plan
  // (§5.3-style single new query, matching weekAnalysisInput.ts's shape). ──
  const exerciseIdsForTags = new Set<string>()
  for (const l of setLogs) exerciseIdsForTags.add(l.exerciseId)
  for (const key of plannedHeadCountByWeekExercise.keys()) exerciseIdsForTags.add(key.split(':')[1])
  const exerciseTags = new Map<string, MesoExerciseTagInput>()
  if (exerciseIdsForTags.size > 0) {
    const { data, error } = await client
      .from('exercises')
      .select('id, name, muscle_group, muscle_subgroup, movement_pattern')
      .eq('user_id', userId)
      .in('id', [...exerciseIdsForTags])
    if (error) throw error
    for (const row of data as RawExerciseTagRow[]) {
      exerciseTags.set(row.id, {
        exerciseName: row.name,
        muscleGroup: row.muscle_group,
        muscleSubgroups: row.muscle_subgroup,
        movementPattern: row.movement_pattern,
      })
    }
  }

  const swaps: MesoSwapRow[] = (
    swapRows as {
      session_id: string
      original_exercise_id: string | null
      original_exercise_name: string
      replacement_exercise_id: string | null
      replacement_exercise_name: string
    }[]
  ).map((r) => ({
    sessionId: r.session_id,
    sessionDate: dateBySessionId.get(r.session_id) ?? '',
    originalExerciseId: r.original_exercise_id,
    originalExerciseName: r.original_exercise_name,
    replacementExerciseId: r.replacement_exercise_id,
    replacementExerciseName: r.replacement_exercise_name,
  }))

  const notes: MesoSessionNote[] = (noteRows as { body: string; session_id: string }[]).map((r) => ({
    body: r.body,
    sessionDate: dateBySessionId.get(r.session_id) ?? '',
    workoutDayName: workoutDayNameBySessionId.get(r.session_id) ?? null,
  }))

  return buildMesoAnalysisInput({
    meso: { id: mesoRaw.id, name: mesoRaw.name, startDate: mesoRaw.start_date, endDate: mesoRaw.end_date, status: mesoRaw.status },
    weekRollups,
    sessions,
    setLogs,
    exerciseTags,
    plannedHeadCounts,
    resolvedPlanWeeks,
    deloadWeeks,
    plannedExerciseIdsBySession,
    swaps,
    priority,
    phaseEntries: toPhaseEntries(phaseRows as RawPhaseRow[]),
    weightEntries: toWeightEntries(weightRows as RawWeightRow[]),
    memory,
    notes,
  })
}
