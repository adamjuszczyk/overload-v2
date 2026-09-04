import type { SupabaseClient } from '@supabase/supabase-js'
import { differenceInCalendarWeeks, format, parseISO, subDays, addDays } from 'date-fns'
import { assembleAnalysisInput, fetchActiveMemory, toPhaseEntries, toWeightEntries } from './analysisInput.js'
import type { AnalysisInput, RawPhaseRow, RawWeightRow } from './analysisInput.js'
import { phaseAt } from './phaseLogic.js'
import type { PhaseAtResult } from './phaseLogic.js'
import { recentWeightTrend, weekKey } from './weightLogic.js'
import { assembleWeekResolution } from './weekResolution.js'
import { groupWeekPlanSets, headsOnly } from '../gym/setGroupLogic.js'
import { averageRating, FORM_SCALE, ENERGY_SCALE, PUMP_SCALE } from '../gym/ratingScales.js'
import type { RatingAverage } from '../gym/ratingScales.js'
import { APP_MECHANICS_REFERENCE, APP_MECHANICS_VERSION } from './appMechanicsReference.js'
import { fetchMesoWeekRollups } from './mesoWeekRollup.js'
import type { WeekRollup } from './mesoWeekRollup.js'
import type {
  WeekPlanSet,
  DayOfWeek,
  SessionStatus,
  EnergyRating,
  PumpRating,
  FormRating,
  WeeklyWeightAverage,
} from '../../types/index.js'

// Context assembly per category (QA-SIDEBAR-TASKS.md §4). Same two-part
// shape as analysisInput.ts/weekAnalysisInput.ts's own modules — every
// exported `assemble*Context` function here takes an injected
// SupabaseClient (never the browser singleton, src/lib/supabase.ts, which
// throws at module load outside a Vite app — the same risk documented at
// length in analysisInput.ts's own header) and is directly callable from
// api/coach/ask.ts (Phase 5) once it exists, and from a zero-spend browser
// dry run before then (TASKS §9 Phase 3).
//
// The Northstar rule (SPEC §2, standing for all of Overload, not just this
// feature) is enforced here as a checkable property, not an intention:
// every `.from(...)` call in this file names either a `v2_`-prefixed table
// or the shared `exercises` table (name/tags only, never anything else off
// it). TASKS §4.3 calls for this to be grepped table-by-table against the
// finished file at review time, not asserted from having written it
// carefully — see CONTEXT.md's Phase 3 session entry for that audit.

// ─── in_session (TASKS §4.1) ────────────────────────────────────────────────

export interface PlannedStage {
  stageIndex: number
  targetRir: number | null
}

// No rep-range field anywhere — confirmed live against production
// (CONTEXT.md, Phase 0 diagnostic, 2026-09-01): v2_week_plan_sets carries a
// target RIR and a dropset/warmup shape, never a target rep count. Adding
// one here would be inventing a field the real table doesn't have.
export interface PlannedSet {
  setNumber: number
  isWarmup: boolean
  isDropset: boolean
  targetRir: number | null
  stages: PlannedStage[] // empty when not a dropset; ordered by stageIndex
}

export interface PlannedSetSummary {
  exerciseId: string
  exerciseName: string
  sets: PlannedSet[]
}

export interface InSessionContext {
  analysis: AnalysisInput
  // Deterministic-from-UI, same principle as category itself (TASKS §4.1
  // item 1) — never inferred by the model. Both null when the UI doesn't
  // know which exercise card the question came from.
  currentExerciseId: string | null
  currentExerciseName: string | null
  plannedSets: PlannedSetSummary[]
}

type RawWeekPlanSetRow = {
  id: string
  program_exercise_id: string
  set_number: number
  target_rir: number | null
  is_dropset: boolean
  parent_week_plan_set_id: string | null
  stage_index: number
  is_warmup: boolean
  v2_program_exercises: { exercise_id: string; exercises: { name: string } | null } | null
}

// v2_week_plan_sets carries no exercise_id at all — exercise identity only
// reaches it via a two-hop join through program_exercise_id (confirmed
// live: a direct `exercises` embed 404s with PostgREST's PGRST200, "no
// relationship found" — the same shape weekPlanService.ts already uses,
// not a direct one). CONTEXT.md's Phase 0 diagnostic entry is the source
// of truth for this table's real shape, not the original TASKS.md prose.
async function fetchPlannedSetSummaries(
  client: SupabaseClient,
  userId: string,
  weekPlanId: string,
): Promise<PlannedSetSummary[]> {
  const { data, error } = await client
    .from('v2_week_plan_sets')
    .select(
      'id, program_exercise_id, set_number, target_rir, is_dropset, parent_week_plan_set_id, stage_index, is_warmup, v2_program_exercises(exercise_id, exercises(name))',
    )
    .eq('user_id', userId)
    .eq('week_plan_id', weekPlanId)
    .order('set_number', { ascending: true })
  if (error) throw error
  const rows = data as unknown as RawWeekPlanSetRow[]

  // Grouped through the same pure head-plus-stages helper every other
  // surface uses for this identical relational shape (TASKS §4.1) — the
  // stage-exclusion rule is applied by one implementation, not a second
  // one that could drift.
  const asWeekPlanSets: WeekPlanSet[] = rows.map((r) => ({
    id: r.id,
    weekPlanId,
    userId,
    programExerciseId: r.program_exercise_id,
    setNumber: r.set_number,
    targetRir: r.target_rir,
    isDropset: r.is_dropset,
    parentWeekPlanSetId: r.parent_week_plan_set_id,
    stageIndex: r.stage_index,
    isWarmup: r.is_warmup,
  }))
  const groups = groupWeekPlanSets(asWeekPlanSets)
  const joinById = new Map(rows.map((r) => [r.id, r.v2_program_exercises]))

  const byExercise = new Map<string, PlannedSetSummary>()
  for (const group of groups) {
    const joined = joinById.get(group.head.id)
    const exerciseId = joined?.exercise_id ?? '(unknown exercise)'
    const exerciseName = joined?.exercises?.name ?? '(unknown exercise)'

    const plannedSet: PlannedSet = {
      setNumber: group.head.setNumber,
      isWarmup: group.head.isWarmup,
      isDropset: group.head.isDropset,
      targetRir: group.head.targetRir,
      stages: group.stages.map((s) => ({ stageIndex: s.stageIndex, targetRir: s.targetRir })),
    }

    const existing = byExercise.get(exerciseId)
    if (existing) existing.sets.push(plannedSet)
    else byExercise.set(exerciseId, { exerciseId, exerciseName, sets: [plannedSet] })
  }

  return [...byExercise.values()]
}

export async function assembleInSessionContext(
  client: SupabaseClient,
  userId: string,
  sessionId: string,
  currentExerciseId: string | null,
): Promise<InSessionContext> {
  const analysis = await assembleAnalysisInput(client, userId, sessionId)

  // Resolved directly, not read off `analysis.exercises` — the entire
  // reason currentExerciseId exists is that an exercise with no logged
  // sets yet is invisible to AnalysisInput (TASKS §4.1 item 1), so it can,
  // and often will, be absent there.
  let currentExerciseName: string | null = null
  if (currentExerciseId) {
    const { data, error } = await client
      .from('exercises')
      .select('name')
      .eq('id', currentExerciseId)
      .maybeSingle()
    if (error) throw error
    currentExerciseName = (data as { name: string } | null)?.name ?? null
  }

  const { data: sessionRow, error: sessionError } = await client
    .from('v2_sessions')
    .select('week_plan_id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .single()
  if (sessionError) throw sessionError
  const weekPlanId = (sessionRow as { week_plan_id: string | null }).week_plan_id

  const plannedSets = weekPlanId ? await fetchPlannedSetSummaries(client, userId, weekPlanId) : []

  return { analysis, currentExerciseId, currentExerciseName, plannedSets }
}

// ─── general (TASKS §4.2) and its shared core with planning ────────────────

export interface GeneralMesoSummary {
  id: string
  name: string
  startDate: string
  currentWeekNumber: number
}

export interface GeneralContext {
  meso: GeneralMesoSummary | null
  weeks: WeekRollup[]
  phase: PhaseAtResult
  weightTrend: WeeklyWeightAverage[]
  memory: string[]
}

async function fetchActiveMeso(
  client: SupabaseClient,
  userId: string,
): Promise<{ id: string; name: string; startDate: string } | null> {
  const { data, error } = await client
    .from('v2_mesocycles')
    .select('id, name, start_date')
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const row = data as { id: string; name: string; start_date: string }
  return { id: row.id, name: row.name, startDate: row.start_date }
}

// Last N calendar weeks of rollups only (TASKS §4.2) — a week is one row,
// not fifty. Not per-set data.
const ROLLUP_WEEKS = 8
// Matching analysisInput.ts's own WEIGHT_TREND_WEEKS constant/reasoning —
// not specified as an exact number by the spec, generous without turning
// the payload into a full history.
const WEIGHT_TREND_WEEKS = 6

// Delegates to mesoWeekRollup.ts's shared, injected-client fetch (Step R,
// MESOCYCLE-ANALYSIS-TASKS.md §2.5) — that module returns every observed
// week unsliced; the `.slice(-ROLLUP_WEEKS)` windowing is Q&A-specific and
// stays here, at this call site, rather than inside the shared fetch.
async function fetchWeeklyRollups(
  client: SupabaseClient,
  userId: string,
  mesoId: string,
  mesoStartDate: string,
): Promise<WeekRollup[]> {
  const rollups = await fetchMesoWeekRollups(client, userId, mesoId, mesoStartDate)
  return rollups.slice(-ROLLUP_WEEKS)
}

// Shared by assembleGeneralContext and assemblePlanningContext (TASKS
// §4.3: "planning reuses everything §4.2 reuses") — one fetch, not two
// copies that could drift.
async function assembleGeneralCore(client: SupabaseClient, userId: string, today: string): Promise<GeneralContext> {
  const activeMeso = await fetchActiveMeso(client, userId)

  const [weeks, { data: phaseRows, error: phaseError }, { data: weightRows, error: weightError }, memory] =
    await Promise.all([
      activeMeso ? fetchWeeklyRollups(client, userId, activeMeso.id, activeMeso.startDate) : Promise.resolve([]),
      client
        .from('v2_coach_phase_entries')
        .select('id, user_id, phase, start_date, created_at')
        .eq('user_id', userId),
      client
        .from('v2_coach_weight_entries')
        .select('id, user_id, entry_date, weight_kg, kind, created_at')
        .eq('user_id', userId),
      fetchActiveMemory(client, userId),
    ])
  if (phaseError) throw phaseError
  if (weightError) throw weightError

  const phaseEntries = toPhaseEntries(phaseRows as RawPhaseRow[])
  const weightEntries = toWeightEntries(weightRows as RawWeightRow[])

  const meso: GeneralMesoSummary | null = activeMeso
    ? {
        id: activeMeso.id,
        name: activeMeso.name,
        startDate: activeMeso.startDate,
        currentWeekNumber:
          differenceInCalendarWeeks(parseISO(today), parseISO(activeMeso.startDate), { weekStartsOn: 1 }) + 1,
      }
    : null

  return {
    meso,
    weeks,
    phase: phaseAt(phaseEntries, today),
    weightTrend: recentWeightTrend(weightEntries, today, WEIGHT_TREND_WEEKS),
    memory,
  }
}

export async function assembleGeneralContext(client: SupabaseClient, userId: string): Promise<GeneralContext> {
  const today = format(new Date(), 'yyyy-MM-dd')
  return assembleGeneralCore(client, userId, today)
}

// ─── planning (TASKS §4.3) ──────────────────────────────────────────────────

export interface RecentDaySummary {
  date: string
  workoutDayName: string | null
  status: SessionStatus
  headSetCount: number
  avgRir: number | null
  durationSeconds: number | null
  energyRating: EnergyRating | null
  pumpRating: PumpRating | null
}

export interface RecoverySummary {
  avgFormRating: RatingAverage | null
  avgEnergyRating: RatingAverage | null
  avgPumpRating: RatingAverage | null
}

export interface WeekOutlookSession {
  date: string
  dayOfWeek: DayOfWeek
  workoutDayName: string | null
}

export interface WeekOutlook {
  weekStart: string
  weekEnd: string
  isComplete: boolean
  expectedSessions: WeekOutlookSession[]
  // Expected dates with no completed/skipped session yet, including a date
  // with no session row at all — "should I skip this session" and "how
  // should I think about next week" both turn on this list directly.
  unresolvedDates: string[]
}

export interface PlanningContext {
  meso: GeneralMesoSummary | null
  weeks: WeekRollup[]
  recentDays: RecentDaySummary[]
  recovery: RecoverySummary
  thisWeek: WeekOutlook
  nextWeek: WeekOutlook
  phase: PhaseAtResult
  weightTrend: WeeklyWeightAverage[]
  memory: string[]
  // Coach Notes from the same recent window as recentDays (TASKS §4.3's
  // recurring 14-day theme) — bodies only, same "no ids, reasoned with,
  // never edited" convention as daily's sessionNotes/memory. Not spelled
  // out field-by-field in TASKS.md beyond the type shape; this is the
  // narrowest reading consistent with the rest of this section's design
  // (a bounded recent-activity window), not every note ever written.
  recentNotes: string[]
}

// Recent load at day granularity plus the three rating averages pooled
// across the same window (TASKS §4.3) — one query, two derived outputs,
// since both need the identical per-session set-log data.
const RECENT_DAYS_WINDOW = 14

type RawRecentSetLog = {
  weight: number | null
  reps: number | null
  rir: number | null
  is_skipped: boolean
  parent_set_id: string | null
  form_rating: string | null
}
type RawRecentSessionRow = {
  date: string
  status: string
  workout_day_id: string | null
  started_at: string | null
  completed_at: string | null
  energy_rating: EnergyRating | null
  pump_rating: PumpRating | null
  v2_set_logs: RawRecentSetLog[]
}

async function fetchWorkoutDayNames(
  client: SupabaseClient,
  userId: string,
  workoutDayIds: string[],
): Promise<Map<string, string>> {
  const nameById = new Map<string, string>()
  if (workoutDayIds.length === 0) return nameById
  const { data, error } = await client
    .from('v2_workout_days')
    .select('id, name')
    .eq('user_id', userId)
    .in('id', workoutDayIds)
  if (error) throw error
  for (const wd of data as { id: string; name: string }[]) nameById.set(wd.id, wd.name)
  return nameById
}

async function fetchRecentDaysAndRecovery(
  client: SupabaseClient,
  userId: string,
  today: string,
): Promise<{ recentDays: RecentDaySummary[]; recovery: RecoverySummary }> {
  const earliestDate = format(subDays(parseISO(today), RECENT_DAYS_WINDOW - 1), 'yyyy-MM-dd')

  const { data, error } = await client
    .from('v2_sessions')
    .select(
      'date, status, workout_day_id, started_at, completed_at, energy_rating, pump_rating, v2_set_logs(weight, reps, rir, is_skipped, parent_set_id, form_rating)',
    )
    .eq('user_id', userId)
    .gte('date', earliestDate)
    .lte('date', today)
    .order('date', { ascending: false })
  if (error) throw error
  const rows = data as unknown as RawRecentSessionRow[]

  const workoutDayIds = [...new Set(rows.map((r) => r.workout_day_id).filter((id): id is string => id !== null))]
  const nameByWorkoutDayId = await fetchWorkoutDayNames(client, userId, workoutDayIds)

  const allFormRatings: (FormRating | null)[] = []
  const allEnergyRatings: (EnergyRating | null)[] = []
  const allPumpRatings: (PumpRating | null)[] = []

  const recentDays: RecentDaySummary[] = rows.map((row) => {
    const headLogs = headsOnly(row.v2_set_logs, (l) => l.parent_set_id)
    const valid = headLogs.filter((l) => !l.is_skipped && l.weight !== null && l.reps !== null)
    const withRir = valid.filter((l) => l.rir !== null)

    let durationSeconds: number | null = null
    if (row.started_at && row.completed_at) {
      const d = (parseISO(row.completed_at).getTime() - parseISO(row.started_at).getTime()) / 1000
      if (d > 0) durationSeconds = d
    }

    allFormRatings.push(...valid.map((l) => l.form_rating as FormRating | null))
    allEnergyRatings.push(row.energy_rating)
    allPumpRatings.push(row.pump_rating)

    return {
      date: row.date,
      workoutDayName: row.workout_day_id ? (nameByWorkoutDayId.get(row.workout_day_id) ?? null) : null,
      status: row.status as SessionStatus,
      headSetCount: valid.length,
      avgRir: withRir.length > 0 ? withRir.reduce((s, l) => s + l.rir!, 0) / withRir.length : null,
      durationSeconds,
      energyRating: row.energy_rating,
      pumpRating: row.pump_rating,
    }
  })

  const recovery: RecoverySummary = {
    avgFormRating: averageRating(FORM_SCALE, allFormRatings),
    avgEnergyRating: averageRating(ENERGY_SCALE, allEnergyRatings),
    avgPumpRating: averageRating(PUMP_SCALE, allPumpRatings),
  }

  return { recentDays, recovery }
}

// assembleWeekResolution (weekResolution.ts) gives expected dates keyed by
// a bare workoutDayId, with no name attached (SPEC/TASKS never needed one
// there — server-side completeness re-derivation only cares about dates).
// A frozen Q&A context snapshot does need the name, so it's resolved here,
// plus which of the expected dates has no completed/skipped session yet —
// neither of which assembleWeekResolution's own return shape exposes.
async function fetchWeekOutlook(client: SupabaseClient, userId: string, weekStartInput: string): Promise<WeekOutlook> {
  const resolution = await assembleWeekResolution(client, userId, weekStartInput)

  const workoutDayIds = [...new Set(resolution.expected.map((e) => e.workoutDayId))]
  const nameByWorkoutDayId = await fetchWorkoutDayNames(client, userId, workoutDayIds)

  const { data: sessionRows, error: sessionError } = await client
    .from('v2_sessions')
    .select('date, status')
    .eq('user_id', userId)
    .gte('date', resolution.weekStart)
    .lte('date', resolution.weekEnd)
  if (sessionError) throw sessionError
  const statusByDate = new Map((sessionRows as { date: string; status: string }[]).map((s) => [s.date, s.status]))

  const unresolvedDates = resolution.expected
    .filter((e) => {
      const status = statusByDate.get(e.date)
      return status !== 'completed' && status !== 'skipped'
    })
    .map((e) => e.date)

  return {
    weekStart: resolution.weekStart,
    weekEnd: resolution.weekEnd,
    isComplete: resolution.isComplete,
    expectedSessions: resolution.expected.map((e) => ({
      date: e.date,
      dayOfWeek: e.dow,
      workoutDayName: nameByWorkoutDayId.get(e.workoutDayId) ?? null,
    })),
    unresolvedDates,
  }
}

export async function assemblePlanningContext(client: SupabaseClient, userId: string): Promise<PlanningContext> {
  const today = format(new Date(), 'yyyy-MM-dd')
  const thisWeekStart = weekKey(today)
  const nextWeekStart = format(addDays(parseISO(thisWeekStart), 7), 'yyyy-MM-dd')
  const earliestNoteAt = new Date(Date.now() - RECENT_DAYS_WINDOW * 24 * 60 * 60 * 1000).toISOString()

  const [core, { recentDays, recovery }, thisWeek, nextWeek, { data: noteRows, error: noteError }] =
    await Promise.all([
      assembleGeneralCore(client, userId, today),
      fetchRecentDaysAndRecovery(client, userId, today),
      fetchWeekOutlook(client, userId, thisWeekStart),
      fetchWeekOutlook(client, userId, nextWeekStart),
      client
        .from('v2_coach_notes')
        .select('body')
        .eq('user_id', userId)
        .gte('created_at', earliestNoteAt)
        .order('created_at', { ascending: true }),
    ])
  if (noteError) throw noteError

  return {
    ...core,
    recentDays,
    recovery,
    thisWeek,
    nextWeek,
    recentNotes: (noteRows as { body: string }[]).map((r) => r.body),
  }
}

// ─── app_mechanics (TASKS §4.4) ─────────────────────────────────────────────

export interface AppMechanicsContext {
  reference: string
  version: number
}

// Zero parameters, deliberately — not (client, userId) accepted-but-unused.
// This is the one category that never touches user data (TASKS §4.4), and
// a zero-arg signature makes that true of the function's own shape, not
// just its body. Not async either: there is nothing to await.
export function assembleAppMechanicsContext(): AppMechanicsContext {
  return { reference: APP_MECHANICS_REFERENCE, version: APP_MECHANICS_VERSION }
}

// ─── the discriminated union (TASKS §3.2) ───────────────────────────────────

export type QaContext =
  | { kind: 'in_session'; payload: InSessionContext }
  | { kind: 'general'; payload: GeneralContext }
  | { kind: 'planning'; payload: PlanningContext }
  | { kind: 'app_mechanics'; payload: AppMechanicsContext }
