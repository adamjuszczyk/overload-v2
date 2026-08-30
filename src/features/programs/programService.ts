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
} from '../../types'

// ─── DB Types ──────────────────────────────────────────────────────────────────

type DbProgram = {
  id: string
  user_id: string
  name: string
  schedule: Record<string, string | null>
  created_at: string
  updated_at: string
}

type DbWorkoutDay = {
  id: string
  program_id: string
  user_id: string
  name: string
  position: number
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
  return toProgramExercise(data as DbProgramExercise)
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

export async function deleteProgramExercise(id: string): Promise<void> {
  const { error } = await supabase.from('v2_program_exercises').delete().eq('id', id)
  if (error) throw error
}

export async function reorderProgramExercises(
  updates: { id: string; position: number }[],
): Promise<void> {
  for (const { id, position } of updates) {
    const { error } = await supabase
      .from('v2_program_exercises')
      .update({ position })
      .eq('id', id)
    if (error) throw error
  }
}
