import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type { Exercise, MuscleGroup } from '../../types'

type DbExercise = {
  id: string
  user_id: string
  name: string
  muscle_group: string | null
  is_archived: boolean
  created_at: string
}

function toExercise(row: DbExercise): Exercise {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    muscleGroup: toMuscleGroup(row.muscle_group),
    isArchived: row.is_archived,
    createdAt: row.created_at,
  }
}

export async function fetchExercises(includeArchived: boolean): Promise<Exercise[]> {
  let query = supabase.from('exercises').select('*').order('name', { ascending: true })
  if (!includeArchived) query = query.eq('is_archived', false)
  const { data, error } = await query
  if (error) throw error
  return (data as DbExercise[]).map(toExercise)
}

export async function createExercise(
  userId: string,
  name: string,
  muscleGroup: MuscleGroup,
): Promise<Exercise> {
  const { data, error } = await supabase
    .from('exercises')
    .insert({ user_id: userId, name: name.trim(), muscle_group: muscleGroup })
    .select()
    .single()
  if (error) throw error
  return toExercise(data as DbExercise)
}

export async function updateExercise(
  id: string,
  name: string,
  muscleGroup: MuscleGroup,
): Promise<Exercise> {
  const { data, error } = await supabase
    .from('exercises')
    .update({ name: name.trim(), muscle_group: muscleGroup })
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return toExercise(data as DbExercise)
}

export async function setExerciseArchived(id: string, archived: boolean): Promise<void> {
  const { error } = await supabase
    .from('exercises')
    .update({ is_archived: archived })
    .eq('id', id)
  if (error) throw error
}
