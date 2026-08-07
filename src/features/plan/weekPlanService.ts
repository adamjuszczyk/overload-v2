import { supabase } from '../../lib/supabase'
import type { WeekPlan, WeekPlanSet } from '../../types'

// ─── DB Types ──────────────────────────────────────────────────────────────────

type DbWeekPlanSet = {
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
}

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
    createdAt: row.created_at,
  }
}

// ─── Week Plans ───────────────────────────────────────────────────────────────

export async function fetchWeekPlans(mesoId: string, weekNumber: number): Promise<WeekPlan[]> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*)')
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
    .select('*, v2_week_plan_sets(*)')
    .single()
  if (error) throw error
  return toPlan(data as DbWeekPlan)
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
    .select('*, v2_week_plan_sets(*)')
    .eq('mesocycle_id', mesoId)
  if (error) throw error
  return (data as DbWeekPlan[]).map(toPlan)
}

export async function fetchWeekPlanById(id: string): Promise<WeekPlan> {
  const { data, error } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*)')
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
  const { data: prevPlans, error: e1 } = await supabase
    .from('v2_week_plans')
    .select('*, v2_week_plan_sets(*)')
    .eq('mesocycle_id', mesoId)
    .eq('week_number', weekNumber - 1)
  if (e1) throw e1
  if (!prevPlans || prevPlans.length === 0) return

  for (const prev of prevPlans as DbWeekPlan[]) {
    const { data: newPlan, error: e2 } = await supabase
      .from('v2_week_plans')
      .insert({
        user_id: userId,
        mesocycle_id: mesoId,
        workout_day_id: prev.workout_day_id,
        week_number: weekNumber,
        is_deload: prev.is_deload,
      })
      .select()
      .single()
    if (e2) throw e2

    const prevSets = (prev.v2_week_plan_sets ?? []) as DbWeekPlanSet[]
    if (prevSets.length > 0) {
      await copySetsWithGrouping(userId, (newPlan as { id: string }).id, prevSets)
    }
  }
}

// Copies a week's sets forward via a direct old-id → new-id map, instead of
// re-inferring grouping from set_number ordering the way this used to work
// (AUDIT M5's plan-side fix, pre-Phase-3.1). That re-inference assumed every
// stage's set_number was strictly greater than its head's — true for legacy
// rows, but no longer true for Phase 3.1's ADD STAGE, which writes stages
// sharing their head's set_number (TASKS.md §2.1). It would silently fail
// to reattach any dropset authored through ADD STAGE. A direct map works
// for both: Phase 3.0's backfill + M5 fixes mean parent_week_plan_set_id is
// now correctly populated on every existing row (log side 8/8, plan side
// 7/7, independently verified — see CONTEXT.md), so there's no longer a
// reason to re-derive it here at all. Heads are inserted first so each
// stage's new parent id is already resolvable when its own row is created.
async function copySetsWithGrouping(
  userId: string,
  newWeekPlanId: string,
  prevSets: DbWeekPlanSet[],
): Promise<void> {
  const idMap = new Map<string, string>()
  const heads = prevSets.filter((s) => s.parent_week_plan_set_id == null)
  const stages = prevSets.filter((s) => s.parent_week_plan_set_id != null)

  for (const s of heads) {
    const { data: newRow, error } = await supabase
      .from('v2_week_plan_sets')
      .insert({
        week_plan_id: newWeekPlanId,
        user_id: userId,
        program_exercise_id: s.program_exercise_id,
        set_number: s.set_number,
        target_rir: s.target_rir,
        is_dropset: s.is_dropset,
        stage_index: s.stage_index ?? 0,
      })
      .select()
      .single()
    if (error) throw error
    idMap.set(s.id, (newRow as DbWeekPlanSet).id)
  }

  for (const s of stages) {
    const newParentId = s.parent_week_plan_set_id ? idMap.get(s.parent_week_plan_set_id) : undefined
    const { data: newRow, error } = await supabase
      .from('v2_week_plan_sets')
      .insert({
        week_plan_id: newWeekPlanId,
        user_id: userId,
        program_exercise_id: s.program_exercise_id,
        set_number: s.set_number,
        target_rir: s.target_rir,
        is_dropset: s.is_dropset,
        parent_week_plan_set_id: newParentId ?? null,
        stage_index: s.stage_index ?? 0,
      })
      .select()
      .single()
    if (error) throw error
    idMap.set(s.id, (newRow as DbWeekPlanSet).id)
  }
}
