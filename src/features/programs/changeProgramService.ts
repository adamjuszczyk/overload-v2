import { supabase } from '../../lib/supabase'
import type { Exercise, PlanningType, RunSchedule } from '../../types'
import { toProgramSet, type DbProgramSet } from '../planner/plannerService'
import { fetchRunSchedules } from '../plan/useRunSchedule'
import { fetchProgram, fetchSupersetBlockRests, fetchWorkoutDays } from './programService'
import { fetchRunCopyExerciseRows } from './runProgramExercises'
import { fetchWarmupItems } from './warmupRoutineService'
import {
  planRowStatus,
  type ChangeSession,
  type ChangeSessionSet,
  type ProgramChangeRunCopy,
  type RunCopyRoutineItem,
  type RunCopySetRow,
} from './programChange'

// Chunk 51a (TASKS-1.2: "CHANGE THE PROGRAM: the screen, exercise-level changes and SAVE") — the reads behind the screen and
// behind SAVE: the run copy as `planProgramChange` (chunk 45) takes it, and the run's planned sessions from the current week
// on with each one's status. Nothing here writes.
//
// SAVE reads all of it again (never the copy the screen opened with): a session can have started since, and a plan that
// is computed from yesterday's statuses would write into a session in progress ("'Not done' means not started").
//
// Every read of a table that grows pages (ordered, `.range()` until a short page; RULES.md, Checks that lied #31). The run
// copy's own rows come from `runProgramExercises.ts`, the one reader of `v2_program_exercises` (scripts/check-program-
// exercise-reads.mjs): a session's exercise rows below are read as their own `id`, `program_exercise_id` and `position`, with
// no embed of the program exercise, so this file needs no exception there.

export interface ChangeProgramSource {
  runCopy: ProgramChangeRunCopy
  // The exercises the run copy's rows name (live or not), for the names and muscle groups the cards show.
  exercises: Exercise[]
  // Every planned session of the run from the current week on, with its status.
  sessions: ChangeSession[]
  // The run's weekday history (`v2_run_schedules`); rows are empty until a weekday change (chunk 51b) has been saved.
  scheduleRows: RunSchedule[]
}

const PAGE = 500
// A planned session arrives with its sets and exercise rows embedded, so a page of them is smaller.
const SESSION_PAGE = 100

type DbSessionSet = {
  id: string
  program_exercise_id: string
  set_number: number
  parent_week_plan_set_id: string | null
  stage_index: number | null
  is_warmup: boolean | null
  stage_kind: string | null
  program_set_id: string | null
  rep_min: number | null
  rep_max: number | null
  is_amrap: boolean | null
}

type DbSession = {
  id: string
  workout_day_id: string
  week_number: number
  sequence_position: number | null
  deload_restore: unknown
  v2_week_plan_sets: DbSessionSet[] | null
  v2_week_plan_exercises: Array<{ id: string; program_exercise_id: string; position: number }> | null
}

function toSessionSet(row: DbSessionSet): ChangeSessionSet {
  return {
    id: row.id,
    programExerciseId: row.program_exercise_id,
    setNumber: row.set_number,
    parentWeekPlanSetId: row.parent_week_plan_set_id ?? null,
    stageIndex: row.stage_index ?? 0,
    isWarmup: row.is_warmup ?? false,
    stageKind: (row.stage_kind ?? null) as ChangeSessionSet['stageKind'],
    programSetId: row.program_set_id ?? null,
    repMin: row.rep_min ?? null,
    repMax: row.rep_max ?? null,
    isAmrap: row.is_amrap ?? false,
  }
}

/**
 * The status of every plan row that has a session that is done, skipped or in progress, by the plan row's id. A plan row with
 * none of those (no session yet, or one that is only `planned`) is not here: not started. One plan row can have several
 * sessions (G14: one workout on two weekdays shares it); `planRowStatus` makes it done as soon as one is.
 */
export async function fetchPlanRowStatuses(mesoId: string): Promise<Map<string, 'done' | 'in_progress'>> {
  const statuses = new Map<string, Array<'completed' | 'skipped' | 'in_progress'>>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('v2_sessions')
      .select('id, week_plan_id, status')
      .eq('mesocycle_id', mesoId)
      .in('status', ['completed', 'skipped', 'in_progress'])
      .not('week_plan_id', 'is', null)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as Array<{ week_plan_id: string; status: 'completed' | 'skipped' | 'in_progress' }>
    for (const row of rows) {
      const list = statuses.get(row.week_plan_id) ?? []
      list.push(row.status)
      statuses.set(row.week_plan_id, list)
    }
    if (rows.length < PAGE) break
  }
  const out = new Map<string, 'done' | 'in_progress'>()
  for (const [planId, list] of statuses) {
    const status = planRowStatus(list)
    if (status !== 'not_started') out.set(planId, status)
  }
  return out
}

/** Every planned session of the run from `fromWeek` on (the cycle on a sequence run), without its status. */
async function fetchPlannedSessions(mesoId: string, fromWeek: number): Promise<Omit<ChangeSession, 'status'>[]> {
  const out: Omit<ChangeSession, 'status'>[] = []
  for (let from = 0; ; from += SESSION_PAGE) {
    const { data, error } = await supabase
      .from('v2_week_plans')
      .select(
        'id, workout_day_id, week_number, sequence_position, deload_restore, v2_week_plan_sets(id, program_exercise_id, set_number, parent_week_plan_set_id, stage_index, is_warmup, stage_kind, program_set_id, rep_min, rep_max, is_amrap), v2_week_plan_exercises(id, program_exercise_id, position)',
      )
      .eq('mesocycle_id', mesoId)
      .gte('week_number', fromWeek)
      .order('id')
      .range(from, from + SESSION_PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as unknown as DbSession[]
    for (const row of rows) {
      out.push({
        id: row.id,
        workoutDayId: row.workout_day_id,
        weekNumber: row.week_number,
        sequencePosition: row.sequence_position ?? null,
        exercises: (row.v2_week_plan_exercises ?? []).map((e) => ({
          weekPlanExerciseId: e.id,
          programExerciseId: e.program_exercise_id,
          position: e.position,
        })),
        sets: (row.v2_week_plan_sets ?? []).map(toSessionSet),
        deloadRestore: Array.isArray(row.deload_restore) ? (row.deload_restore as ChangeSession['deloadRestore']) : null,
      })
    }
    if (rows.length < SESSION_PAGE) break
  }
  return out
}

// The default's sets of the given exercise rows, every row (the live ones are the default, `removedAt` marks the dropped).
async function fetchRunCopySets(exerciseRowIds: readonly string[]): Promise<RunCopySetRow[]> {
  const out: RunCopySetRow[] = []
  // 20 exercise rows a request keeps the address short and a page's answer far under the row cap.
  for (let i = 0; i < exerciseRowIds.length; i += 20) {
    const ids = exerciseRowIds.slice(i, i + 20)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('v2_program_sets')
        .select('*')
        .in('program_exercise_id', ids)
        .order('id')
        .range(from, from + PAGE - 1)
      if (error) throw error
      const rows = (data ?? []) as DbProgramSet[]
      out.push(...rows.map(toProgramSet))
      if (rows.length < PAGE) break
    }
  }
  return out
}

/**
 * Everything the screen and SAVE need, read fresh. `planningType` decides whether the default's sets are read (a
 * week-dependent run's default holds none that the screen uses).
 */
export async function fetchChangeProgramSource(args: {
  mesoId: string
  programId: string
  planningType: PlanningType
  currentWeek: number
}): Promise<ChangeProgramSource> {
  const { mesoId, programId, planningType, currentWeek } = args
  const [program, workoutDays] = await Promise.all([fetchProgram(programId), fetchWorkoutDays(programId)])
  const workoutIds = workoutDays.map((w) => w.id)

  const [rows, blockLists, routineLists, scheduleRows, planned, statuses] = await Promise.all([
    fetchRunCopyExerciseRows(workoutIds),
    Promise.all(workoutIds.map((id) => fetchSupersetBlockRests(id))),
    Promise.all(workoutIds.map((id) => fetchWarmupItems(id))),
    fetchRunSchedules(mesoId),
    fetchPlannedSessions(mesoId, currentWeek),
    fetchPlanRowStatuses(mesoId),
  ])

  const liveRowIds = rows.filter((r) => !r.weekOnly && r.removedAt === null).map((r) => r.id)
  const sets = planningType === 'stable' ? await fetchRunCopySets(liveRowIds) : []

  const exercises = new Map<string, Exercise>()
  for (const row of rows) if (row.exercise) exercises.set(row.exercise.id, row.exercise)

  const routine: RunCopyRoutineItem[] = routineLists.flat().map((item) => ({
    id: item.id,
    workoutDayId: item.workoutDayId,
    position: item.position,
    body: item.body,
  }))

  return {
    runCopy: {
      programId,
      mesocycleId: mesoId,
      schedule: program.schedule,
      workouts: workoutDays.map((w) => ({ id: w.id, name: w.name, position: w.position })),
      exercises: rows,
      sets,
      blocks: blockLists.flat(),
      routine,
    },
    exercises: [...exercises.values()],
    sessions: planned.map((s) => ({ ...s, status: statuses.get(s.id) ?? 'not_started' })),
    scheduleRows,
  }
}
