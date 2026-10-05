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
} from '../../types'

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
// that reads a program by a known id — PlanPage's active-run lookup,
// ProgramBuilderPage/WorkoutDayEditorPage's route param, which is a run's
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

export async function fetchProgramExercises(workoutDayId: string): Promise<ProgramExercise[]> {
  const { data, error } = await supabase
    .from('v2_program_exercises')
    .select('*, exercises(*)')
    .eq('workout_day_id', workoutDayId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data as DbProgramExercise[]).map(toProgramExercise)
}

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
  await addExerciseToExistingWeekPlans(userId, workoutDayId, pe.id, pe.position)
  return toProgramExercise(pe)
}

// Chunk 7 (TASKS.md "Each planned session owns its exercise list") — until
// chunk 9 drops per-week divergence, an edit made here (the workout editor,
// on the run's own copy) must land in every week that has already planned
// this workout day, the same instant it happens — exactly what rendering
// straight off v2_program_exercises already gave PlanPage/GymSession for
// free before this chunk. A week with no v2_week_plans row yet needs
// nothing done now: whenever one is created later (createWeekPlan /
// copyOnePlanForward, weekPlanService.ts), it reads the program's CURRENT
// exercises at that moment, which by then already includes this one.
async function addExerciseToExistingWeekPlans(
  userId: string,
  workoutDayId: string,
  programExerciseId: string,
  position: number,
): Promise<void> {
  const { data, error } = await supabase.from('v2_week_plans').select('id').eq('workout_day_id', workoutDayId)
  if (error) throw error
  const plans = (data ?? []) as { id: string }[]
  if (plans.length === 0) return

  const { error: insertError } = await supabase.from('v2_week_plan_exercises').insert(
    plans.map((p) => ({
      week_plan_id: p.id,
      user_id: userId,
      program_exercise_id: programExerciseId,
      position,
    })),
  )
  if (insertError) throw insertError
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

// Chunk 7 — no v2_week_plan_exercises code needed here: that table's
// program_exercise_id is `references v2_program_exercises(id) on delete
// cascade` (027), so deleting a program exercise already removes it from
// every week's own exercise list in the same statement, exactly as it
// already removed it from every week's v2_week_plan_sets (same cascade,
// unchanged since migration 001) — the one existing-behaviour-preserving
// path that needed nothing new written for it.
export async function deleteProgramExercise(id: string): Promise<void> {
  const { error } = await supabase.from('v2_program_exercises').delete().eq('id', id)
  if (error) throw error
}

export async function reorderProgramExercises(
  workoutDayId: string,
  updates: { id: string; position: number }[],
): Promise<void> {
  for (const { id, position } of updates) {
    const { error } = await supabase
      .from('v2_program_exercises')
      .update({ position })
      .eq('id', id)
    if (error) throw error
  }
  await reorderExercisesInExistingWeekPlans(workoutDayId, updates)
}

// Chunk 7's reorder twin of addExerciseToExistingWeekPlans above — same
// "every week that has already planned this workout day, kept in step
// until chunk 9" rule, for a position change instead of a brand new row.
// No unique constraint on (week_plan_id, position), so there is no
// transient-collision ordering concern the way there would be if position
// were part of a unique key (it is not — only (week_plan_id,
// program_exercise_id) is, 027).
async function reorderExercisesInExistingWeekPlans(
  workoutDayId: string,
  updates: { id: string; position: number }[],
): Promise<void> {
  const { data, error } = await supabase.from('v2_week_plans').select('id').eq('workout_day_id', workoutDayId)
  if (error) throw error
  const plans = (data ?? []) as { id: string }[]
  if (plans.length === 0) return

  for (const plan of plans) {
    for (const { id, position } of updates) {
      const { error: updateError } = await supabase
        .from('v2_week_plan_exercises')
        .update({ position })
        .eq('week_plan_id', plan.id)
        .eq('program_exercise_id', id)
      if (updateError) throw updateError
    }
  }
}
