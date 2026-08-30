import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import { withUserLock } from '../../lib/locks'
import { DEFAULT_EXERCISES } from './defaultExercises'
import type {
  Exercise,
  MuscleGroup,
  MuscleSubgroup,
  MovementPattern,
  ExerciseLifecycle,
} from '../../types'

// supabase-js infers this embed's shape as one-to-many (guessing multiplicity
// from the select string alone, with no generated Database type in this repo
// to correct it — same reason every other query here casts through a plain
// interface rather than trusting the inferred type), where the real relation
// is one-to-one on both hops. Cast through this shape instead.
type DbProgramReference = {
  workout_day: { program: { name: string } | null } | null
}

type DbExercise = {
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
    // Coerces anything but the literal 'lost' to 'active' — same reasoning
    // toMuscleGroup coerces an unrecognised value to 'other': a row cached
    // by an older client (before migration 019) has no status column at
    // all, and that must read as "active", never as a third state
    // (EXERCISE-LIBRARY-TASKS.md §7.2). The live column is NOT NULL with a
    // 'active'/'lost' CHECK, so this only ever matters for stale caches.
    status: row.status === 'lost' ? 'lost' : 'active',
    sourceLibraryId: row.source_library_id,
    lostAt: row.lost_at,
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

// status = 'active' is unconditional here, regardless of includeArchived —
// a lost exercise is excluded from every selectable/display list the same
// way regardless of its archived flag (EXERCISE-LIBRARY-TASKS.md §2.3: "is_archived
// keeps its exact current behaviour for status = 'active' rows"). Lost
// Exercises has its own fetch (fetchLostExercises, below).
export async function fetchExercises(includeArchived: boolean): Promise<Exercise[]> {
  let query = supabase
    .from('exercises')
    .select('*')
    .eq('status', 'active')
    .order('name', { ascending: true })
  if (!includeArchived) query = query.eq('is_archived', false)
  const { data, error } = await query
  if (error) throw error
  return (data as DbExercise[]).map(toExercise)
}

export async function fetchLostExercises(): Promise<Exercise[]> {
  const { data, error } = await supabase
    .from('exercises')
    .select('*')
    .eq('status', 'lost')
    .order('lost_at', { ascending: false })
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

// ─── Delete + Lost Exercises (§8 step 7) ───────────────────────────────────
// The three-state lifecycle (§0.3/§2.3): a row is 'active' or 'lost', or —
// for a hard-deleted exercise — 'gone', which has no row left to hold it.
// The one preflight this whole step turns on: does this exercise have any
// real logged history (v2_set_logs)? Zero → 'gone' is safe and permanent.
// Any → never destroyed; the row becomes 'lost' instead.

export interface ExerciseDeletePreview {
  outcome: ExerciseLifecycle // 'lost' or 'gone' — never 'active' here
  setCount: number
  // Only ever non-empty when outcome === 'gone'. Found during this step's
  // implementation: v2_program_exercises.exercise_id has a plain (NO ACTION)
  // FK, so deleteExercise()'s hard-delete branch clears any referencing
  // program-exercise rows before deleting the exercise itself — silently
  // removing it from whatever workout template(s) still listed it. That is
  // a real, non-obvious side effect the confirm dialog has to name before
  // the delete fires, not just "no logged history."
  programNames: string[]
}

export async function previewExerciseDelete(id: string): Promise<ExerciseDeletePreview> {
  const { count, error } = await supabase
    .from('v2_set_logs')
    .select('id', { count: 'exact', head: true })
    .eq('exercise_id', id)
  if (error) throw error
  const setCount = count ?? 0
  const outcome: ExerciseLifecycle = setCount > 0 ? 'lost' : 'gone'
  if (outcome === 'lost') return { outcome, setCount, programNames: [] }

  // The lost branch never clears v2_program_exercises (§8 step 7's own
  // changelog — deliberately left dangling for reassignment's step 2 to
  // handle later), so the program lookup only matters, and only runs, on
  // the hard-delete path.
  const { data, error: programsError } = await supabase
    .from('v2_program_exercises')
    .select('workout_day:v2_workout_days(program:v2_programs(name))')
    .eq('exercise_id', id)
  if (programsError) throw programsError
  const programNames = Array.from(
    new Set(
      (data as unknown as DbProgramReference[])
        .map((row) => row.workout_day?.program?.name)
        .filter((name): name is string => !!name),
    ),
  )
  return { outcome, setCount, programNames }
}

// Re-derives the preflight rather than trusting a caller-supplied preview —
// same reasoning §5.2/§6.2 give for reassignment's own counts: a set logged
// between preview and confirm should not be silently hard-deleted because a
// stale preview said "gone". The window here is narrower (a single-row
// check, no lock) but the re-check costs one query and removes the
// possibility entirely.
export async function deleteExercise(id: string): Promise<ExerciseLifecycle> {
  const { outcome } = await previewExerciseDelete(id)
  if (outcome === 'lost') {
    const { error } = await supabase
      .from('exercises')
      .update({ status: 'lost', lost_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error
    return 'lost'
  }

  // Zero history: exercises.id has a plain (NO ACTION) FK from
  // v2_program_exercises.exercise_id (001_v2_schema.sql — no ON DELETE
  // clause), so a hard delete cannot succeed while any program still lists
  // this exercise in a workout day's template. Clearing those rows first is
  // the only way to allow the delete without either blocking it outright
  // (rejected — TASKS.md §9.3's same reasoning: it would make removing an
  // old exercise from an old program impossible) or building reassignment's
  // re-pointing machinery here, which step 7 deliberately excludes. This is
  // safe precisely because we're in the zero-history branch: no
  // v2_set_logs row can reference a week_plan_set under this exercise's
  // program-exercise rows either, so the FK's own on-delete-cascade to
  // v2_week_plan_sets touches only unlogged, future-planned sets.
  const { error: programExercisesError } = await supabase
    .from('v2_program_exercises')
    .delete()
    .eq('exercise_id', id)
  if (programExercisesError) throw programExercisesError

  const { error } = await supabase.from('exercises').delete().eq('id', id)
  if (error) throw error
  return 'gone'
}

// The reversible direction (§9.4/§11.4) — no preflight, no data check.
// Clearing lost_at alongside status is what exercises_lost_at_chk (migration
// 019) requires: an active row must not claim to have been lost.
export async function restoreExercise(id: string): Promise<void> {
  const { error } = await supabase
    .from('exercises')
    .update({ status: 'active', lost_at: null })
    .eq('id', id)
  if (error) throw error
}
