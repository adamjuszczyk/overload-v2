import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type {
  Program,
  WorkoutDay,
  ProgramExercise,
  WeeklySchedule,
  WeightUnit,
  MuscleSubgroup,
  MovementPattern,
  ProgramKind,
  PlanningType,
} from '../../types'
import { fetchRunProgramExercises, removeRunProgramExercise } from './runProgramExercises'

// ─── DB Types ──────────────────────────────────────────────────────────────────

type DbProgram = {
  id: string
  user_id: string
  name: string
  schedule: Record<string, string | null>
  created_at: string
  updated_at: string
  // Absent until migration 027 (same "key missing, not null" fallback as
  // weight_unit below) — a program predating 027 reads as 'saved', exactly
  // the default 027 gave every existing row.
  kind?: ProgramKind
  // Absent until migration 027 — chunk 8's own field, same fallback. Reads
  // as 'week_dependent', 027's own column default.
  planning_type?: PlanningType
}

type DbWorkoutDay = {
  id: string
  program_id: string
  user_id: string
  name: string
  position: number
  source_workout_day_id?: string | null  // absent until migration 027
}

type DbExerciseJoin = {
  id: string
  user_id: string
  name: string
  muscle_group: string | null
  is_archived: boolean
  created_at: string
  muscle_subgroup: MuscleSubgroup[] | null
  movement_pattern: MovementPattern | null
  status: string
  source_library_id: string | null
  lost_at: string | null
}

type DbProgramExercise = {
  id: string
  workout_day_id: string
  user_id: string
  exercise_id: string
  position: number
  target_reps: number | null
  weight_unit?: string | null  // absent until migration 006 has been applied
  exercises: DbExerciseJoin | null
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

export const EMPTY_SCHEDULE: WeeklySchedule = {
  monday: null, tuesday: null, wednesday: null, thursday: null,
  friday: null, saturday: null, sunday: null,
}

function toProgram(row: DbProgram): Program {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    schedule: { ...EMPTY_SCHEDULE, ...(row.schedule as Partial<WeeklySchedule>) },
    workoutDays: [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    kind: row.kind ?? 'saved',
    planningType: row.planning_type ?? 'week_dependent',
  }
}

function toWorkoutDay(row: DbWorkoutDay): WorkoutDay {
  return {
    id: row.id,
    programId: row.program_id,
    userId: row.user_id,
    name: row.name,
    position: row.position,
    exercises: [],
    sourceWorkoutDayId: row.source_workout_day_id ?? null,
  }
}

function toProgramExercise(row: DbProgramExercise): ProgramExercise {
  const ex = row.exercises
  return {
    id: row.id,
    workoutDayId: row.workout_day_id,
    userId: row.user_id,
    exerciseId: row.exercise_id,
    position: row.position,
    targetReps: row.target_reps,
    // Falls back to inherit (null) until migration 006 has been applied — the
    // key is absent from the row entirely rather than null, since the column
    // doesn't exist yet (same pattern as autoFinishMinutes in settingsService).
    weightUnit: (row.weight_unit ?? null) as ProgramExercise['weightUnit'],
    exercise: ex
      ? {
          id: ex.id,
          userId: ex.user_id,
          name: ex.name,
          muscleGroup: toMuscleGroup(ex.muscle_group),
          isArchived: ex.is_archived,
          createdAt: ex.created_at,
          muscleSubgroups: ex.muscle_subgroup,
          movementPattern: ex.movement_pattern,
          status: ex.status === 'lost' ? 'lost' : 'active',
          sourceLibraryId: ex.source_library_id,
          lostAt: ex.lost_at,
        }
      : undefined,
  }
}

// ─── Programs ─────────────────────────────────────────────────────────────────

export async function fetchPrograms(): Promise<Program[]> {
  const { data, error } = await supabase
    .from('v2_programs')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbProgram[]).map(toProgram)
}

// Program lists (chunk 6, TASKS.md — "program lists show kind = 'saved'
// only"): the programs page's own list and its Start Mesocycle picker, the
// only two places a user picks a reusable template from. Everywhere else
// that reads a program by a known id — PlanPage's active-run lookup, the
// planner's (PlannerPage.tsx, chunk 11) own route param — which is a run's
// own copy (kind = 'run') while a run is active — keeps using the
// unfiltered fetchPrograms above; filtering that one too would make the
// active run's own copy invisible to the very pages that edit it.
export async function fetchSavedPrograms(): Promise<Program[]> {
  const { data, error } = await supabase
    .from('v2_programs')
    .select('*')
    .eq('kind', 'saved')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbProgram[]).map(toProgram)
}

export async function createProgram(userId: string, name: string): Promise<Program> {
  const { data, error } = await supabase
    .from('v2_programs')
    .insert({ user_id: userId, name: name.trim(), schedule: EMPTY_SCHEDULE })
    .select()
    .single()
  if (error) throw error
  return toProgram(data as DbProgram)
}

export async function updateProgramName(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('v2_programs')
    .update({ name: name.trim(), updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function updateSchedule(id: string, schedule: WeeklySchedule): Promise<void> {
  const { error } = await supabase
    .from('v2_programs')
    .update({ schedule, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Chunk 11 (SPEC.md "Stepped program planner" step 3 — "choose stable or
// week-dependent"). The planner's own first writer of this column (027 adds
// it with the 'week_dependent' default; nothing before this chunk ever lets
// the user change it).
export async function updatePlanningType(id: string, planningType: PlanningType): Promise<void> {
  const { error } = await supabase
    .from('v2_programs')
    .update({ planning_type: planningType, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// ─── Workout Days ─────────────────────────────────────────────────────────────

export async function fetchWorkoutDays(programId: string): Promise<WorkoutDay[]> {
  const { data, error } = await supabase
    .from('v2_workout_days')
    .select('*')
    .eq('program_id', programId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as DbWorkoutDay[]).map(toWorkoutDay)
}

export async function createWorkoutDay(
  userId: string,
  programId: string,
  name: string,
  position: number,
): Promise<WorkoutDay> {
  const { data, error } = await supabase
    .from('v2_workout_days')
    .insert({ user_id: userId, program_id: programId, name: name.trim(), position })
    .select()
    .single()
  if (error) throw error
  return toWorkoutDay(data as DbWorkoutDay)
}

export async function updateWorkoutDayName(id: string, name: string): Promise<void> {
  const { error } = await supabase
    .from('v2_workout_days')
    .update({ name: name.trim() })
    .eq('id', id)
  if (error) throw error
}

export async function deleteWorkoutDay(id: string): Promise<void> {
  const { error } = await supabase.from('v2_workout_days').delete().eq('id', id)
  if (error) throw error
}

// ─── Program Exercises ────────────────────────────────────────────────────────
// Chunk 9 (TASKS.md "Edit a week's exercises" — "One read path") —
// fetchProgramExercises/deleteProgramExercise now delegate to
// runProgramExercises.ts, the only code that reads v2_program_exercises for
// a run (enforced by scripts/check-program-exercise-reads.mjs). A saved
// program's rows never carry week_only/removed_at, so both delegations are
// behaviour-preserving for the planner; they only change what happens on a
// run's copy, which this page also edits via the Plan screen's Program tab.

export async function fetchProgramExercises(workoutDayId: string): Promise<ProgramExercise[]> {
  return fetchRunProgramExercises(workoutDayId)
}

// Chunk 9 — the chunk-7 bridge that used to copy a new row into every week
// that had already planned this workout day (addExerciseToExistingWeekPlans)
// is removed: the program tab is read-only for volume on a week-dependent
// run (every run today), so this can no longer run against a workout day
// that already has week plans — adding to a saved program's own workout day
// never had any (a saved program has no mesocycle, so no v2_week_plans row
// ever names its workout_day_id). A week-dependent week's own add goes
// through weekPlanService.ts's addWeekExercise instead, with its own carry
// semantics (weekEdits.ts).
export async function addProgramExercise(
  userId: string,
  workoutDayId: string,
  exerciseId: string,
  position: number,
  // Resolved literal, not the raw per-exercise override (v3 §2.4 / TASKS.md
  // §4 item 28) — the caller resolves against the global Settings default at
  // creation time and writes that literal, so a later change to the global
  // default doesn't retroactively reinterpret an already-created row. Rows
  // created outside the builder (if any ever are) stay NULL and inherit.
  weightUnit: WeightUnit,
): Promise<ProgramExercise> {
  const { data, error } = await supabase
    .from('v2_program_exercises')
    .insert({
      user_id: userId,
      workout_day_id: workoutDayId,
      exercise_id: exerciseId,
      position,
      target_reps: null,
      weight_unit: weightUnit,
    })
    .select('*, exercises(*)')
    .single()
  if (error) throw error
  const pe = data as DbProgramExercise
  return toProgramExercise(pe)
}

export async function updateProgramExerciseReps(
  id: string,
  targetReps: number | null,
): Promise<void> {
  const { error } = await supabase
    .from('v2_program_exercises')
    .update({ target_reps: targetReps })
    .eq('id', id)
  if (error) throw error
}

// The per-program-exercise unit picker (TASKS.md §4 item 28) — null means
// "inherit the global Settings unit", same tri-state as the column itself.
export async function updateProgramExerciseWeightUnit(
  id: string,
  weightUnit: WeightUnit | null,
): Promise<void> {
  const { error } = await supabase
    .from('v2_program_exercises')
    .update({ weight_unit: weightUnit })
    .eq('id', id)
  if (error) throw error
}

// Chunk 9 — a saved program's row is still a hard delete (unchanged;
// cascades to v2_week_plan_exercises/v2_week_plan_sets, but a saved
// program's own workout_day_id is never named by any v2_week_plans row —
// weeks only ever belong to a run's copy). A run copy's row instead becomes
// a soft removal (runProgramExercises.ts's removeRunProgramExercise —
// "removed_at... planned weeks keep their rows", 027's own column comment);
// unreachable via any UI today (the program tab is read-only for volume on
// a week-dependent run, and every run is week-dependent until chunk 11),
// but correct now, so chunk 11's stable program tab needs nothing new here.
export async function deleteProgramExercise(id: string): Promise<void> {
  return removeRunProgramExercise(id)
}

// Chunk 9 — the chunk-7 bridge that used to copy a position change into
// every week that had already planned this workout day
// (reorderExercisesInExistingWeekPlans) is removed, for the same reason
// addProgramExercise's own bridge call above is: the program tab is
// read-only for volume on a week-dependent run, and a saved program's
// workout_day_id is never named by any v2_week_plans row in the first
// place. A week-dependent week's own reorder goes through
// weekPlanService.ts's reorderWeekExercises instead, with its own carry
// semantics (weekEdits.ts).
export async function reorderProgramExercises(updates: { id: string; position: number }[]): Promise<void> {
  for (const { id, position } of updates) {
    const { error } = await supabase
      .from('v2_program_exercises')
      .update({ position })
      .eq('id', id)
    if (error) throw error
  }
}
