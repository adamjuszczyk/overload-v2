import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type { MuscleGroup, SessionStatus } from '../../types'
import { groupByParent, type SetGroup } from '../gym/setGroupLogic'
import { trimPartialTrailingGroup } from './historyPagination'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HistoryRow {
  id: string
  date: string
  status: SessionStatus
  note: string | null
  startedAt: string | null
  completedAt: string | null
  workoutDayId: string | null
  workoutDayName: string | null
  mesocycleId: string | null
  mesocycleName: string | null
  setCount: number
  muscleGroups: MuscleGroup[]
}

export interface HistorySetRow {
  id: string
  setNumber: number
  weight: number | null
  reps: number | null
  rir: number | null
  restSeconds: number | null
  isSkipped: boolean
  isDropset: boolean
  parentSetId: string | null
  stageIndex: number
}

export interface HistoryExerciseGroup {
  exerciseId: string
  exerciseName: string
  muscleGroup: MuscleGroup
  position: number
  // Grouped, not flat (§2.7 item 6) — a drop stage nests under its head
  // instead of appearing as its own row.
  sets: SetGroup<HistorySetRow>[]
}

export interface HistoryDetail extends HistoryRow {
  exerciseGroups: HistoryExerciseGroup[]
}

// ─── Raw DB row types ─────────────────────────────────────────────────────────

type RawLogFull = {
  id: string
  exercise_id: string
  set_number: number
  weight: number | null
  reps: number | null
  rir: number | null
  rest_seconds: number | null
  is_skipped: boolean
  is_dropset: boolean
  parent_set_id: string | null
  stage_index: number
  logged_at: string
  exercises: { id: string; name: string; muscle_group: string | null } | null
}

type RawSessionFull = {
  id: string
  date: string
  status: string
  note: string | null
  started_at: string | null
  completed_at: string | null
  workout_day_id: string | null
  mesocycle_id: string | null
  v2_set_logs: RawLogFull[]
  v2_mesocycles: { id: string; name: string } | null
}

type RawSummaryRow = {
  id: string
  date: string
  status: string
  note: string | null
  started_at: string | null
  completed_at: string | null
  workout_day_id: string | null
  workout_day_name: string | null
  mesocycle_id: string | null
  mesocycle_name: string | null
  set_count: number
  muscle_groups: string[]
}

// ─── Session list (v2_history_session_summary — TASKS.md §2.6 / Phase 3.4 item 20) ──
//
// Replaces the old per-set-log join (up to 500 sessions × every set log ever
// recorded — AUDIT P2) with the pre-aggregated view: one row per session,
// set_count and muscle_groups computed in Postgres. Real .range() pagination,
// ordered by date desc, so the newest sessions are always in the first page
// (the same class of fix as AUDIT H4's progress-chart pagination).
//
// security_invoker on the view (Postgres 15+, confirmed live: 17.6.1.141)
// already scopes rows to the caller via RLS. The explicit .eq('user_id', …)
// below is defence-in-depth on top of that, per §2.6's own risk section and
// the same reasoning as AUDIT S1 for the exercises table — not the only
// thing standing between this query and another user's rows.

const HISTORY_SESSION_PAGE_SIZE = 25

export interface HistorySessionsPage {
  rows: HistoryRow[]
  nextOffset: number | null
}

export async function fetchHistorySessions(
  userId: string,
  offset = 0,
  pageSize = HISTORY_SESSION_PAGE_SIZE,
): Promise<HistorySessionsPage> {
  const { data, error } = await supabase
    .from('v2_history_session_summary')
    .select(`
      id, date, status, note, started_at, completed_at,
      workout_day_id, workout_day_name, mesocycle_id, mesocycle_name,
      set_count, muscle_groups
    `)
    .eq('user_id', userId)
    // date is day-granularity, so two sessions on the same date tie on the
    // primary sort key — Postgres doesn't promise a stable order for ties
    // across separate page requests without a secondary key. Without this,
    // a same-day session could appear twice (or never) across "load more"
    // pages. id is arbitrary but stable, which is all a tiebreaker needs.
    .order('date', { ascending: false })
    .order('id', { ascending: true })
    .range(offset, offset + pageSize - 1)
  if (error) throw error

  const rows: HistoryRow[] = (data as unknown as RawSummaryRow[]).map((r) => ({
    id: r.id,
    date: r.date,
    status: r.status as SessionStatus,
    note: r.note,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    workoutDayId: r.workout_day_id,
    workoutDayName: r.workout_day_name,
    mesocycleId: r.mesocycle_id,
    mesocycleName: r.mesocycle_name,
    setCount: r.set_count,
    muscleGroups: (r.muscle_groups ?? []) as MuscleGroup[],
  }))

  return { rows, nextOffset: rows.length === pageSize ? offset + rows.length : null }
}

// ─── Session detail ───────────────────────────────────────────────────────────
//
// Unchanged by the P2 fix — this already scopes to exactly one session's set
// logs (not "every set log ever"), so it was never the query the views above
// replace. Still needs every log for that one session, which is what a
// session-detail screen is for.

export async function fetchHistoryDetail(sessionId: string): Promise<HistoryDetail> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .select(`
      id, date, status, note, started_at, completed_at,
      workout_day_id, mesocycle_id,
      v2_set_logs(
        id, exercise_id, set_number, weight, reps, rir,
        rest_seconds, is_skipped, is_dropset, parent_set_id, stage_index, logged_at,
        exercises(id, name, muscle_group)
      ),
      v2_mesocycles(id, name)
    `)
    .eq('id', sessionId)
    .single()
  if (error) throw error

  const session = data as unknown as RawSessionFull

  let workoutDayName: string | null = null
  const positionMap: Record<string, number> = {}

  if (session.workout_day_id) {
    const [{ data: day }, { data: progEx }] = await Promise.all([
      supabase
        .from('v2_workout_days')
        .select('id, name')
        .eq('id', session.workout_day_id)
        .maybeSingle(),
      supabase
        .from('v2_program_exercises')
        .select('exercise_id, position')
        .eq('workout_day_id', session.workout_day_id),
    ])
    workoutDayName = (day as { id: string; name: string } | null)?.name ?? null
    for (const pe of (progEx ?? []) as { exercise_id: string; position: number }[]) {
      positionMap[pe.exercise_id] = pe.position
    }
  }

  // Sort set_logs by logged_at then set_number for stable ordering
  const sortedLogs = [...(session.v2_set_logs ?? [])].sort((a, b) => {
    const d = a.logged_at.localeCompare(b.logged_at)
    return d !== 0 ? d : a.set_number - b.set_number
  })

  // Group by exercise; program position for ordering, first-appearance as fallback.
  // Rows are collected flat per exercise first, then grouped into head+stages
  // at the end (§2.7 item 6) — a drop stage nests under its head instead of
  // appearing as its own row.
  const exerciseMeta = new Map<
    string,
    { exerciseName: string; muscleGroup: MuscleGroup; position: number }
  >()
  const flatSetsByExercise = new Map<string, HistorySetRow[]>()
  let fallbackPos = 0
  for (const log of sortedLogs) {
    if (!log.exercises) continue
    if (!exerciseMeta.has(log.exercise_id)) {
      exerciseMeta.set(log.exercise_id, {
        exerciseName: log.exercises.name,
        muscleGroup: toMuscleGroup(log.exercises.muscle_group),
        position:
          log.exercise_id in positionMap ? positionMap[log.exercise_id] : 9999 + fallbackPos++,
      })
      flatSetsByExercise.set(log.exercise_id, [])
    }
    flatSetsByExercise.get(log.exercise_id)!.push({
      id: log.id,
      setNumber: log.set_number,
      weight: log.weight,
      reps: log.reps,
      rir: log.rir,
      restSeconds: log.rest_seconds,
      isSkipped: log.is_skipped,
      isDropset: log.is_dropset,
      parentSetId: log.parent_set_id,
      stageIndex: log.stage_index,
    })
  }

  const exerciseGroups: HistoryExerciseGroup[] = [...exerciseMeta.entries()]
    .map(([exerciseId, meta]) => ({
      exerciseId,
      exerciseName: meta.exerciseName,
      muscleGroup: meta.muscleGroup,
      position: meta.position,
      sets: groupByParent(
        flatSetsByExercise.get(exerciseId) ?? [],
        (s) => s.id,
        (s) => s.parentSetId,
        (s) => s.stageIndex,
      ),
    }))
    .sort((a, b) => a.position - b.position)

  const activeLogs = sortedLogs.filter(l => !l.is_skipped)
  const muscleGroups = [
    ...new Set(activeLogs.map(l => l.exercises?.muscle_group).filter(Boolean) as MuscleGroup[]),
  ]

  return {
    id: session.id,
    date: session.date,
    status: session.status as SessionStatus,
    note: session.note,
    startedAt: session.started_at,
    completedAt: session.completed_at,
    workoutDayId: session.workout_day_id,
    workoutDayName,
    mesocycleId: session.mesocycle_id,
    mesocycleName: session.v2_mesocycles?.name ?? null,
    // Heads only (stage-exclusion rule, TASKS.md §2.1 / §2.7 item 6).
    setCount: activeLogs.filter((l) => l.parent_set_id == null).length,
    muscleGroups,
    exerciseGroups,
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('v2_sessions').delete().eq('id', id)
  if (error) throw error
}

// ─── Workout day name (for the Session-type history header) ───────────────────

export async function fetchWorkoutDayName(
  userId: string,
  workoutDayId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('v2_workout_days')
    .select('name')
    // workoutDayId comes straight from a URL route param (/session-type/:workoutDayId)
    // — unlike sessionId elsewhere in this file, which is only ever sourced from an
    // already user_id-scoped list. Same defense-in-depth policy as the three view
    // queries above; found missing here by adversarial review.
    .eq('user_id', userId)
    .eq('id', workoutDayId)
    .maybeSingle()
  if (error) throw error
  return (data as { name: string } | null)?.name ?? null
}

// ─── Exercise, all time (v2_exercise_set_history — SPEC §7 / Phase 3.4 item 21) ────
//
// One row per SET, so unlike the two views above, a page boundary can split
// a dropset's head from its stage(s). Every page is fetched one row past the
// requested size and run through trimPartialTrailingGroup (historyPagination.ts)
// so a group is never rendered split — the trimmed rows come back complete at
// the start of the next page instead.

export interface ExerciseSetHistoryRow {
  id: string
  sessionId: string
  date: string
  mesocycleId: string | null
  mesocycleName: string | null
  weekNumber: number | null
  isDeload: boolean
  setNumber: number
  stageIndex: number
  parentSetId: string | null
  weight: number | null
  reps: number | null
  rir: number | null
  restSeconds: number | null
  setSeconds: number | null
  isWarmup: boolean
  isSkipped: boolean
}

type RawExerciseSetRow = {
  id: string
  session_id: string
  date: string
  mesocycle_id: string | null
  mesocycle_name: string | null
  week_number: number | null
  is_deload: boolean
  set_number: number
  stage_index: number
  parent_set_id: string | null
  weight: number | null
  reps: number | null
  rir: number | null
  rest_seconds: number | null
  set_seconds: number | null
  is_warmup: boolean
  is_skipped: boolean
}

const EXERCISE_SET_HISTORY_PAGE_SIZE = 60

export interface ExerciseSetHistoryPage {
  rows: ExerciseSetHistoryRow[]
  nextOffset: number | null
}

export async function fetchExerciseSetHistory(
  userId: string,
  exerciseId: string,
  offset = 0,
  pageSize = EXERCISE_SET_HISTORY_PAGE_SIZE,
): Promise<ExerciseSetHistoryPage> {
  const { data, error } = await supabase
    .from('v2_exercise_set_history')
    .select(`
      id, session_id, date, mesocycle_id, mesocycle_name, week_number, is_deload,
      set_number, stage_index, parent_set_id, weight, reps, rir,
      rest_seconds, set_seconds, is_warmup, is_skipped
    `)
    .eq('user_id', userId)
    .eq('exercise_id', exerciseId)
    // Every one of these is load-bearing, not cosmetic — found by an
    // adversarial review after the fact: session_id alone still ties for
    // every ordinary (non-dropset) set in one session, since stage_index
    // defaults to 0 for every head row, not just the first. A session with
    // 3 plain sets of one exercise has 3 rows sharing (date, session_id,
    // stage_index=0) — Postgres promises nothing about tie order across
    // separate page requests, which both scrambles the "EVERY SET" table's
    // display order and can duplicate or silently drop rows across pages
    // (trimPartialTrailingGroup's contiguity assumption depends on a true
    // total order). set_number is unique per exercise per session and
    // gives the semantically correct display order (heads in logged
    // order — stage-to-stage order within one head is handled separately
    // by groupByParent's own sort, not by this ORDER BY). id is the final
    // tiebreaker since set_number's uniqueness is a convention, not a DB
    // constraint (TASKS.md's migration-risk section already flags one
    // known renumbering race elsewhere in this codebase) — id is the only
    // column here guaranteed unique by the database itself.
    .order('date', { ascending: false })
    .order('session_id', { ascending: true })
    .order('set_number', { ascending: true })
    .order('stage_index', { ascending: true })
    .order('id', { ascending: true })
    .range(offset, offset + pageSize) // pageSize + 1 rows — see trim note above
  if (error) throw error

  const raw = data as unknown as RawExerciseSetRow[]
  const { pageRows, hasMore } = trimPartialTrailingGroup(raw, pageSize, (r) => r.session_id)

  const rows: ExerciseSetHistoryRow[] = pageRows.map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    date: r.date,
    mesocycleId: r.mesocycle_id,
    mesocycleName: r.mesocycle_name,
    weekNumber: r.week_number,
    isDeload: r.is_deload,
    setNumber: r.set_number,
    stageIndex: r.stage_index,
    parentSetId: r.parent_set_id,
    weight: r.weight,
    reps: r.reps,
    rir: r.rir,
    restSeconds: r.rest_seconds,
    setSeconds: r.set_seconds,
    isWarmup: r.is_warmup,
    isSkipped: r.is_skipped,
  }))

  return { rows, nextOffset: hasMore ? offset + rows.length : null }
}

// ─── Session type, all time (v2_session_type_history — SPEC §7 / Phase 3.4 item 21) ──
//
// One row per session OCCURRENCE, already aggregated in SQL (total_volume,
// avg_rir, set_count, duration_seconds) — no client-side grouping, so no
// pagination/grouping interaction to guard against here.

export interface SessionTypeHistoryRow {
  sessionId: string
  date: string
  mesocycleId: string | null
  weekNumber: number | null
  isDeload: boolean
  durationSeconds: number | null
  totalVolume: number | null
  avgRir: number | null
  setCount: number
}

type RawSessionTypeRow = {
  session_id: string
  date: string
  mesocycle_id: string | null
  week_number: number | null
  is_deload: boolean
  duration_seconds: number | null
  total_volume: number | null
  avg_rir: number | null
  set_count: number
}

const SESSION_TYPE_HISTORY_PAGE_SIZE = 25

export interface SessionTypeHistoryPage {
  rows: SessionTypeHistoryRow[]
  nextOffset: number | null
}

export async function fetchSessionTypeHistory(
  userId: string,
  workoutDayId: string,
  offset = 0,
  pageSize = SESSION_TYPE_HISTORY_PAGE_SIZE,
): Promise<SessionTypeHistoryPage> {
  const { data, error } = await supabase
    .from('v2_session_type_history')
    .select(`
      session_id, date, mesocycle_id, week_number, is_deload,
      duration_seconds, total_volume, avg_rir, set_count
    `)
    .eq('user_id', userId)
    .eq('workout_day_id', workoutDayId)
    // Deterministic tiebreaker — see fetchExerciseSetHistory's comment above;
    // same-date sessions otherwise have no guaranteed stable order across pages.
    .order('date', { ascending: false })
    .order('session_id', { ascending: true })
    .range(offset, offset + pageSize - 1)
  if (error) throw error

  const rows: SessionTypeHistoryRow[] = (data as unknown as RawSessionTypeRow[]).map((r) => ({
    sessionId: r.session_id,
    date: r.date,
    mesocycleId: r.mesocycle_id,
    weekNumber: r.week_number,
    isDeload: r.is_deload,
    durationSeconds: r.duration_seconds,
    totalVolume: r.total_volume,
    avgRir: r.avg_rir,
    setCount: r.set_count,
  }))

  return { rows, nextOffset: rows.length === pageSize ? offset + rows.length : null }
}
