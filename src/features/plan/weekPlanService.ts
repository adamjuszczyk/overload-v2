import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type { WeekPlan, WeekPlanSet, ProgramExercise, MuscleSubgroup, MovementPattern } from '../../types'

// ─── DB Types ──────────────────────────────────────────────────────────────────

export type DbWeekPlanSet = {
  id: string
  week_plan_id: string
  user_id: string
  program_exercise_id: string
  set_number: number
  target_rir: number | null
  is_dropset: boolean
  // Absent until migration 004/006 has been applied.
  parent_week_plan_set_id?: string | null
  stage_index?: number
  is_warmup?: boolean
}

// Chunk 7 (TASKS.md "Each planned session owns its exercise list") — the
// joined shape needed to render a v2_week_plan_exercises row as a
// ProgramExercise, same fields sessionService.ts's own DbExercise /
// programService.ts's DbExerciseJoin independently carry (this codebase's
// existing convention: each service duplicates the lean row shape it needs
// rather than importing another feature's DB type).
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

type DbProgramExerciseJoin = {
  id: string
  workout_day_id: string
  user_id: string
  exercise_id: string
  position: number
  target_reps: number | null
  weight_unit?: string | null // absent until migration 006 has been applied
  exercises: DbExerciseJoin | null
}

// v2_week_plan_exercises (027/029). The embed rule (DECISIONS 38): this
// table has TWO FKs to v2_program_exercises (program_exercise_id,
// carry_program_exercise_id), so the nested embed below must be hinted —
// see fetchWeekPlans' select for the exact hint string. v2_program_exercises
// is present (not optional) on every read this file does, since every select
// below asks for it; carry_* stay plain nullable columns, never embedded
// (nothing writes a non-null carry_* before chunk 9).
export type DbWeekPlanExercise = {
  id: string
  week_plan_id: string
  user_id: string
  program_exercise_id: string
  position: number
  carry_program_exercise_id: string | null
  carry_position: number | null
  created_at: string
  v2_program_exercises: DbProgramExerciseJoin
}

type DbWeekPlan = {
  id: string
  user_id: string
  mesocycle_id: string
  workout_day_id: string
  week_number: number
  is_deload: boolean
  notes: string | null
  created_at: string
  v2_week_plan_sets: DbWeekPlanSet[]
  v2_week_plan_exercises: DbWeekPlanExercise[]
}

// The same embed string is repeated as an inline literal at every
// v2_week_plans select below, rather than hoisted to a shared `const` —
// scripts/check-embeds.mjs's scan only recognises a quoted literal passed
// straight to .select(), so hoisting it would make every one of these
// embeds invisible to that check. v2_week_plan_sets(*) stays a sibling
// embed, never nested into v2_program_exercises itself (TASKS.md/DECISIONS
// 38: prefer v2_week_plan_exercises(…) as the junction from v2_week_plans to
// v2_program_exercises now that there are two); the nested
// v2_program_exercises embed is hinted by FK name (two FKs on
// v2_week_plan_exercises — program_exercise_id, carry_program_exercise_id —
// so an un-hinted embed there would be PGRST201-ambiguous).

// ─── Mappers ──────────────────────────────────────────────────────────────────

function toSet(row: DbWeekPlanSet): WeekPlanSet {
  return {
    id: row.id,
    weekPlanId: row.week_plan_id,
    userId: row.user_id,
    programExerciseId: row.program_exercise_id,
    setNumber: row.set_number,
    targetRir: row.target_rir,
    isDropset: row.is_dropset,
    // Same "column may not exist yet" fallback as autoFinishMinutes — safe
    // regardless of whether 004/006 have been applied when this code deploys.
    parentWeekPlanSetId: row.parent_week_plan_set_id ?? null,
    stageIndex: row.stage_index ?? 0,
    isWarmup: row.is_warmup ?? false,
  }
}

// A v2_week_plan_exercises row, as a ProgramExercise (the shape
// GymSession/SessionPreview/PlanPage already render) — position comes from
// THIS row (the week's own order), everything else from the joined
// v2_program_exercises/exercises (027/029's design: those don't get their
// own copy on the week's row, only identity + order do).
function toProgramExerciseFromWeekPlanExercise(row: DbWeekPlanExercise): ProgramExercise {
  const pe = row.v2_program_exercises
  const ex = pe.exercises
  return {
    id: pe.id,
    workoutDayId: pe.workout_day_id,
    userId: pe.user_id,
    exerciseId: pe.exercise_id,
    position: row.position,
    targetReps: pe.target_reps,
    weightUnit: (pe.weight_unit ?? null) as ProgramExercise['weightUnit'],
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

function toPlan(row: DbWeekPlan): WeekPlan {
  return {
    id: row.id,
    userId: row.user_id,
    mesocycleId: row.mesocycle_id,
    workoutDayId: row.workout_day_id,
    weekNumber: row.week_number,
    isDeload: row.is_deload,
    notes: row.notes,
    sets: (row.v2_week_plan_sets ?? []).map(toSet).sort((a, b) => a.setNumber - b.setNumber),
    exercises: (row.v2_week_plan_exercises ?? [])
      .map(toProgramExerciseFromWeekPlanExercise)
      .sort((a, b) => a.position - b.position),
    createdAt: row.created_at,
  }
}

// ─── Week Plans ───────────────────────────────────────────────────────────────

export async function fetchWeekPlans(mesoId: string, weekNumber: number): Promise<WeekPlan[]> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('mesocycle_id', mesoId)
    .eq('week_number', weekNumber)
  if (error) throw error
  return (data as DbWeekPlan[]).map(toPlan)
}

export async function createWeekPlan(
  userId: string,
  mesoId: string,
  workoutDayId: string,
  weekNumber: number,
): Promise<WeekPlan> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .insert({
      user_id: userId,
      mesocycle_id: mesoId,
      workout_day_id: workoutDayId,
      week_number: weekNumber,
      is_deload: false,
    })
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .single()
  if (error) throw error
  const plan = data as DbWeekPlan
  // Chunk 7 — a brand-new week plan row ("ADD SET" lazily creating one,
  // useAddSet/useWeekPlan.ts) starts with the workout's CURRENT program
  // exercises, in program order — the one path that reads straight off
  // v2_program_exercises rather than copying another week's own list
  // forward (copyOnePlanForward below), since there is no other week to
  // copy from here. Same shape migration 029's backfill writes for every
  // pre-existing row, so an old row and a brand new one end up identical.
  await writeWeekPlanExercisesFromProgram(userId, plan.id, workoutDayId)
  return toPlan(plan)
}

// Shared by createWeekPlan above (a fresh plan, no previous week to copy)
// and nowhere else — copyOnePlanForward's own fresh-insert branch instead
// copies the PREVIOUS week's own v2_week_plan_exercises forward
// (copyExercisesForward, below copySetsWithGrouping), not the program's
// current state, since "copy" means "copy that specific source", not
// "reset to the program". Plain insert (not upsert): a week plan row this
// function has just created cannot already have any v2_week_plan_exercises
// rows, so a real collision here would be a genuine bug, not a benign race.
async function writeWeekPlanExercisesFromProgram(
  userId: string,
  weekPlanId: string,
  workoutDayId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('v2_program_exercises')
    .select('id, position')
    .eq('workout_day_id', workoutDayId)
    .order('position', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as { id: string; position: number }[]
  if (rows.length === 0) return

  const { error: insertError } = await supabase.from('v2_week_plan_exercises').insert(
    rows.map((pe) => ({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: pe.id,
      position: pe.position,
    })),
  )
  if (insertError) throw insertError
}

export async function setDeload(weekPlanId: string, isDeload: boolean): Promise<void> {
  const { error } = await supabase
    .from('v2_week_plans')
    .update({ is_deload: isDeload })
    .eq('id', weekPlanId)
  if (error) throw error
}

// ─── Sets ─────────────────────────────────────────────────────────────────────

export async function addSet(
  userId: string,
  weekPlanId: string,
  programExerciseId: string,
  setNumber: number,
): Promise<WeekPlanSet> {
  const { data, error } = await supabase
    .from('v2_week_plan_sets')
    .insert({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: programExerciseId,
      set_number: setNumber,
      target_rir: null,
      is_dropset: false,
    })
    .select()
    .single()
  if (error) throw error
  return toSet(data as DbWeekPlanSet)
}

// Phase 3.1's real stage-authoring interaction (TASKS.md §4 item 10):
// PlanPage.tsx's ADD STAGE is tied to a specific existing set, so the parent
// id is given directly here — same reasoning as GymSession.tsx's ADD STAGE
// (see setGroupLogic.ts). This retires the nearest-preceding-non-dropset
// inference updateSet() used to need for this: there is no more "toggle
// this set into a dropset" interaction to infer a parent for. Stages share
// their head's set_number by convention (TASKS.md §2.1); stageIndex is the
// caller's count of that head's existing stages + 1.
export async function addStage(
  userId: string,
  weekPlanId: string,
  programExerciseId: string,
  parentId: string,
  setNumber: number,
  stageIndex: number,
): Promise<WeekPlanSet> {
  const { data, error } = await supabase
    .from('v2_week_plan_sets')
    .insert({
      week_plan_id: weekPlanId,
      user_id: userId,
      program_exercise_id: programExerciseId,
      set_number: setNumber,
      target_rir: null,
      is_dropset: true,
      parent_week_plan_set_id: parentId,
      stage_index: stageIndex,
    })
    .select()
    .single()
  if (error) throw error
  return toSet(data as DbWeekPlanSet)
}

export async function updateSet(
  id: string,
  changes: { targetRir?: number | null },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('targetRir' in changes) patch.target_rir = changes.targetRir

  const { error } = await supabase.from('v2_week_plan_sets').update(patch).eq('id', id)
  if (error) throw error
}

export async function removeSet(id: string): Promise<void> {
  const { error } = await supabase.from('v2_week_plan_sets').delete().eq('id', id)
  if (error) throw error
}

export async function fetchAllWeekPlansForMeso(mesoId: string): Promise<WeekPlan[]> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('mesocycle_id', mesoId)
  if (error) throw error
  return (data as DbWeekPlan[]).map(toPlan)
}

export async function fetchWeekPlanById(id: string): Promise<WeekPlan> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('id', id)
    .single()
  if (error) throw error
  return toPlan(data as DbWeekPlan)
}

// ─── Copy from previous week ──────────────────────────────────────────────────

export async function copyFromPreviousWeek(
  userId: string,
  mesoId: string,
  weekNumber: number,
): Promise<void> {
  const { data: prevPlans, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('mesocycle_id', mesoId)
    .eq('week_number', weekNumber - 1)
  if (error) throw error
  if (!prevPlans || prevPlans.length === 0) return

  for (const prev of prevPlans as DbWeekPlan[]) {
    await copyOnePlanForward(userId, mesoId, weekNumber, prev)
  }
}

// Phase 3.7's scoped twin of copyFromPreviousWeek (TASKS.md §4 item 31 /
// SPEC §5) — same previous-week source, but filtered to one workoutDayId
// instead of every workout in the week. `existingWeekPlanId` lets the caller
// pass an already-created (possibly still-empty) week_plan row for this
// workout/week so this doesn't create a duplicate — same optional-id pattern
// useAddSet/addSet already uses.
export async function copyWorkoutFromPreviousWeek(
  userId: string,
  mesoId: string,
  weekNumber: number,
  workoutDayId: string,
  existingWeekPlanId?: string,
): Promise<void> {
  const { data: prevPlan, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*), v2_week_plan_exercises(*, v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey(*, exercises(*)))')
    .eq('mesocycle_id', mesoId)
    .eq('week_number', weekNumber - 1)
    .eq('workout_day_id', workoutDayId)
    .maybeSingle()
  if (error) throw error
  if (!prevPlan) return

  await copyOnePlanForward(userId, mesoId, weekNumber, prevPlan as DbWeekPlan, existingWeekPlanId)
}

// Shared by both copy actions above — the two differ only in how they pick
// which previous-week plan(s) to walk (every plan in the week vs. one
// workout's plan); once a source plan is picked, copying it forward is
// identical either way. Creates the destination week_plan row unless the
// caller already has one (copyWorkoutFromPreviousWeek's existingWeekPlanId),
// then hands the set-copying itself to copySetsWithGrouping unchanged.
async function copyOnePlanForward(
  userId: string,
  mesoId: string,
  weekNumber: number,
  prevPlan: DbWeekPlan,
  existingWeekPlanId?: string,
): Promise<void> {
  const prevSets = (prevPlan.v2_week_plan_sets ?? []) as DbWeekPlanSet[]
  if (prevSets.length === 0) return

  let newWeekPlanId = existingWeekPlanId
  if (!newWeekPlanId) {
    const { data: newPlan, error } = await supabase
      .from('v2_week_plans')
      .insert({
        user_id: userId,
        mesocycle_id: mesoId,
        workout_day_id: prevPlan.workout_day_id,
        week_number: weekNumber,
        is_deload: prevPlan.is_deload,
      })
      .select()
      .single()
    if (error) throw error
    newWeekPlanId = (newPlan as { id: string }).id
  } else {
    // Reusing an already-created (empty) plan row — still sync is_deload
    // from the source, same as the fresh-insert branch above, so "copy this
    // workout" faithfully replicates the source week's plan (deload flag
    // included), not just its sets. Found by Phase 3.7's adversarial
    // review: this branch used to leave whatever is_deload the row already
    // had (always false, since the only way to reach this branch with an
    // existing row is useAddSet's createWeekPlan, which hardcodes false).
    const { error } = await supabase
      .from('v2_week_plans')
      .update({ is_deload: prevPlan.is_deload })
      .eq('id', newWeekPlanId)
    if (error) throw error
  }

  // Chunk 7 — the destination week's own exercise list, copied forward from
  // the SOURCE week's list (prevPlan's own v2_week_plan_exercises), not
  // re-read from the program's current state: "copy" means "copy that
  // specific source", exactly like copySetsWithGrouping below copies
  // prevPlan's own sets rather than resetting to some other source. Upsert
  // (copyExercisesForward's default), not plain insert: the
  // existingWeekPlanId branch above may be reusing a row
  // createWeekPlan/writeWeekPlanExercisesFromProgram already gave a full
  // exercise list (useAddSet's lazy-create, TASKS.md §4 item 31's own
  // existingWeekPlanId precedent) — the same (week_plan_id,
  // program_exercise_id) pairs would otherwise collide on the unique key.
  await copyExercisesForward(userId, newWeekPlanId, (prevPlan.v2_week_plan_exercises ?? []) as DbWeekPlanExercise[])
  await copySetsWithGrouping(userId, newWeekPlanId, prevSets)
}

// A single batched upsert, factored out so tests can substitute a fake and
// assert on exactly what copyExercisesForward tried to write — same
// injection-seam pattern as defaultInsertPlanSet/copySetsWithGrouping below.
// Upsert, not plain insert: see copyOnePlanForward's own comment above for
// why its existingWeekPlanId branch can hand this a week plan that already
// has some of these rows.
async function defaultUpsertPlanExercises(payloads: Record<string, unknown>[]): Promise<void> {
  if (payloads.length === 0) return
  const { error } = await supabase
    .from('v2_week_plan_exercises')
    .upsert(payloads, { onConflict: 'week_plan_id,program_exercise_id' })
  if (error) throw error
}

// Copies one week_plan's exercise list forward — "what copying forward
// uses" is literally what TASKS.md's data model calls
// carry_program_exercise_id/carry_position: a row with no override (every
// row before chunk 9 — nothing sets carry_* yet) just carries its own
// program_exercise_id/position forward verbatim; an "only this week"
// swap/reorder would instead carry forward the PRE-swap/reorder slot
// recorded there. The new row always starts with carry_* null (omitted from
// the payload, same as every other write in this file) — it has no
// override of its own yet, whatever its source row had.
//
// Exported (and takes an injectable upsertPlanExercises) for the same
// reason copySetsWithGrouping is: so a test can exercise the
// carry_*-fallback logic directly, without a real Supabase round-trip.
export async function copyExercisesForward(
  userId: string,
  newWeekPlanId: string,
  prevExercises: DbWeekPlanExercise[],
  upsertPlanExercises: (payloads: Record<string, unknown>[]) => Promise<void> = defaultUpsertPlanExercises,
): Promise<void> {
  const payloads = prevExercises.map((ex) => ({
    week_plan_id: newWeekPlanId,
    user_id: userId,
    program_exercise_id: ex.carry_program_exercise_id ?? ex.program_exercise_id,
    position: ex.carry_position ?? ex.position,
  }))
  await upsertPlanExercises(payloads)
}

// A single new-row insert, factored out so tests can substitute a fake and
// assert on exactly what copySetsWithGrouping tried to write — real behaviour
// (the supabase call) is unchanged, this is purely an injection seam.
async function defaultInsertPlanSet(
  payload: Record<string, unknown>,
): Promise<DbWeekPlanSet> {
  const { data, error } = await supabase
    .from('v2_week_plan_sets')
    .insert(payload)
    .select()
    .single()
  if (error) throw error
  return data as DbWeekPlanSet
}

// Copies one week_plan's sets forward via a direct old-id → new-id map,
// instead of re-inferring grouping from set_number ordering the way this
// used to work (AUDIT M5's plan-side fix, pre-Phase-3.1). That re-inference
// assumed every stage's set_number was strictly greater than its head's —
// true for legacy rows, but no longer true for Phase 3.1's ADD STAGE, which
// writes stages sharing their head's set_number (TASKS.md §2.1). It would
// silently fail to reattach any dropset authored through ADD STAGE. A direct
// map works for both: Phase 3.0's backfill + M5 fixes mean
// parent_week_plan_set_id is now correctly populated on every existing row
// (log side 8/8, plan side 7/7, independently verified — see CONTEXT.md), so
// there's no longer a reason to re-derive it here at all. Heads are inserted
// first so each stage's new parent id is already resolvable when its own row
// is created.
//
// Exported (and takes an injectable insertPlanSet) so Phase 3.7's test suite
// can exercise the reattachment logic directly without a real Supabase
// round-trip — the id-remapping is the part that's actually risky, not the
// insert call itself. Called once per week_plan by both copyFromPreviousWeek
// (in a loop, one call per workout in the week) and
// copyWorkoutFromPreviousWeek (a single call) — this function has no
// awareness of which caller it's serving, which is exactly what makes it
// safe to share: whole-week scope is just "call this per plan," never a
// different code path through here.
export async function copySetsWithGrouping(
  userId: string,
  newWeekPlanId: string,
  prevSets: DbWeekPlanSet[],
  insertPlanSet: (payload: Record<string, unknown>) => Promise<DbWeekPlanSet> = defaultInsertPlanSet,
): Promise<void> {
  const idMap = new Map<string, string>()
  const heads = prevSets.filter((s) => s.parent_week_plan_set_id == null)
  const stages = prevSets.filter((s) => s.parent_week_plan_set_id != null)

  for (const s of heads) {
    const newRow = await insertPlanSet({
      week_plan_id: newWeekPlanId,
      user_id: userId,
      program_exercise_id: s.program_exercise_id,
      set_number: s.set_number,
      target_rir: s.target_rir,
      is_dropset: s.is_dropset,
      stage_index: s.stage_index ?? 0,
    })
    idMap.set(s.id, newRow.id)
  }

  for (const s of stages) {
    const newParentId = s.parent_week_plan_set_id ? idMap.get(s.parent_week_plan_set_id) : undefined
    const newRow = await insertPlanSet({
      week_plan_id: newWeekPlanId,
      user_id: userId,
      program_exercise_id: s.program_exercise_id,
      set_number: s.set_number,
      target_rir: s.target_rir,
      is_dropset: s.is_dropset,
      parent_week_plan_set_id: newParentId ?? null,
      stage_index: s.stage_index ?? 0,
    })
    idMap.set(s.id, newRow.id)
  }
}
