import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import { withUserLock } from '../../lib/locks'
import { DEFAULT_EXERCISES } from './defaultExercises'
import type { Exercise, MuscleGroup, MuscleSubgroup, MovementPattern } from '../../types'

type DbExercise = {
  id: string
  user_id: string
  name: string
  muscle_group: string | null
  is_archived: boolean
  created_at: string
  muscle_subgroup: MuscleSubgroup[] | null
  movement_pattern: MovementPattern | null
}

function toExercise(row: DbExercise): Exercise {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    muscleGroup: toMuscleGroup(row.muscle_group),
    isArchived: row.is_archived,
    createdAt: row.created_at,
    muscleSubgroups: row.muscle_subgroup,
    movementPattern: row.movement_pattern,
  }
}

// Optional tag fields for createExercise/updateExercise. Both keys are
// independently optional so a caller that only touches one axis (e.g.
// ExerciseTagList.tsx toggling a single muscle_subgroup chip) never has to
// know or guess the other's current value just to avoid clobbering it.
export interface ExerciseTagFields {
  muscleSubgroups?: MuscleSubgroup[] | null
  movementPattern?: MovementPattern | null
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
  tags?: ExerciseTagFields,
): Promise<Exercise> {
  const { data, error } = await supabase
    .from('exercises')
    .insert({
      user_id: userId,
      name: name.trim(),
      muscle_group: muscleGroup,
      muscle_subgroup: tags?.muscleSubgroups ?? null,
      movement_pattern: tags?.movementPattern ?? null,
    })
    .select()
    .single()
  if (error) throw error
  return toExercise(data as DbExercise)
}

// tags is deliberately optional, and each of its two keys independently so
// too (EXERCISE-LIBRARY-TASKS.md §2.6) — an omitted key means "leave this
// column untouched", not "clear it". Only a key that's actually present in
// the `tags` object (even as an explicit `null`, meaning "untag this axis")
// reaches the update payload; omitting it entirely must never overwrite an
// existing tag with null. This is the one-line mistake with a silent,
// data-destroying outcome the plan calls out by name — every existing
// caller before this session (ExerciseForm.tsx's plain rename/re-group
// path) passed no tags at all and must keep working exactly as before.
export async function updateExercise(
  id: string,
  name: string,
  muscleGroup: MuscleGroup,
  tags?: ExerciseTagFields,
): Promise<Exercise> {
  const payload: {
    name: string
    muscle_group: MuscleGroup
    muscle_subgroup?: MuscleSubgroup[] | null
    movement_pattern?: MovementPattern | null
  } = { name: name.trim(), muscle_group: muscleGroup }
  if (tags && 'muscleSubgroups' in tags) payload.muscle_subgroup = tags.muscleSubgroups
  if (tags && 'movementPattern' in tags) payload.movement_pattern = tags.movementPattern

  const { data, error } = await supabase
    .from('exercises')
    .update(payload)
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

// Total row count, archived included — the seed-on-empty check (SPEC §9) must
// use this rather than fetchExercises(false), since a user who's archived
// every exercise (but still has rows) is not a fresh account and must not be
// reseeded on top of their own data.
export async function fetchExerciseCount(): Promise<number> {
  const { count, error } = await supabase
    .from('exercises')
    .select('id', { count: 'exact', head: true })
  if (error) throw error
  return count ?? 0
}

export async function seedDefaultExercises(userId: string): Promise<void> {
  const rows = DEFAULT_EXERCISES.map(({ name, muscleGroup }) => ({
    user_id: userId,
    name,
    muscle_group: muscleGroup,
  }))
  const { error } = await supabase.from('exercises').insert(rows)
  if (error) throw error
}

// There's no unique constraint on exercises(user_id, name) to upsert
// against, so seeding is a plain check-then-insert — two tabs (or a PWA
// auto-update reload) racing this on the same browser could otherwise both
// see count===0 and both insert the full default set (found via
// adversarial review). withUserLock serializes same-browser callers so the
// loser re-checks the *real* count after the winner's insert has landed,
// instead of trusting a count read before the lock was acquired. This does
// not protect against two genuinely different devices seeding the same
// brand-new account at the same instant — that residual window is accepted
// rather than closed with a new production constraint.
export async function seedDefaultExercisesIfEmpty(userId: string): Promise<void> {
  await withUserLock(`overload-seed-exercises-${userId}`, async () => {
    const count = await fetchExerciseCount()
    if (count > 0) return
    await seedDefaultExercises(userId)
  })
}

// The case/whitespace-insensitive name identity rule every "does the user
// already have this" diff in this feature applies — originally inline in
// the now-retired importDefaultExercises (EXERCISE-LIBRARY-TASKS.md §1),
// extracted so libraryService.ts's downloadLibrary (§8 step 6) applies the
// exact same rule rather than a second copy.
export function diffNewByName<T extends { name: string }>(
  candidates: readonly T[],
  existingNames: ReadonlySet<string>,
): T[] {
  return candidates.filter((c) => !existingNames.has(c.name.trim().toLowerCase()))
}
