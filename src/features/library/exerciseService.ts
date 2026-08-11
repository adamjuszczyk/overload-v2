import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import { DEFAULT_EXERCISES } from './defaultExercises'
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
// adversarial review). navigator.locks serializes same-browser callers so
// the loser re-checks the *real* count after the winner's insert has
// landed, instead of trusting a count read before the lock was acquired.
// This does not protect against two genuinely different devices seeding
// the same brand-new account at the same instant — that residual window
// is accepted rather than closed with a new production constraint.
export async function seedDefaultExercisesIfEmpty(userId: string): Promise<void> {
  const run = async () => {
    const count = await fetchExerciseCount()
    if (count > 0) return
    await seedDefaultExercises(userId)
  }
  if (typeof navigator !== 'undefined' && navigator.locks) {
    await navigator.locks.request(`overload-seed-exercises-${userId}`, run)
  } else {
    await run()
  }
}

// Explicit, user-triggered import (post-launch fix, 2026-08-10) — the
// original seed (above) only ever runs once, automatically, on a brand-new
// account. An account that started before that existed, or that archived
// its way down to an empty-looking library, had no way to pull the same
// default list in later. Reuses DEFAULT_EXERCISES/the same insert shape as
// seedDefaultExercises rather than a second copy of either. Diffs by name
// (case/whitespace-insensitive, since two exercises differing only in
// casing is more likely a duplicate than two distinct movements) against
// every existing row, archived included — an archived exercise still means
// "already present in this account's library", same reasoning
// fetchExerciseCount already documents for the empty-account check.
export async function importDefaultExercises(userId: string): Promise<{ added: number; skipped: number }> {
  const run = async () => {
    const existing = await fetchExercises(true)
    const existingNames = new Set(existing.map((ex) => ex.name.trim().toLowerCase()))
    const toAdd = DEFAULT_EXERCISES.filter((d) => !existingNames.has(d.name.trim().toLowerCase()))

    if (toAdd.length > 0) {
      const rows = toAdd.map(({ name, muscleGroup }) => ({
        user_id: userId,
        name,
        muscle_group: muscleGroup,
      }))
      const { error } = await supabase.from('exercises').insert(rows)
      if (error) throw error
    }

    return { added: toAdd.length, skipped: DEFAULT_EXERCISES.length - toAdd.length }
  }

  // Same double-tap/double-tab race seedDefaultExercisesIfEmpty already
  // guards against — this is a manual button tap rather than an
  // effect-on-mount, so the window is much narrower, but the guard is one
  // line to reuse and a double-insert here is exactly as permanent (no
  // hard-delete) as the original race it was written for.
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(`overload-seed-exercises-${userId}`, run)
  }
  return run()
}
