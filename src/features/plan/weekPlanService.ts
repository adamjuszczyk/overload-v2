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

export async function updateSet(
  id: string,
  changes: { targetRir?: number | null; isDropset?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('targetRir' in changes) patch.target_rir = changes.targetRir

  if ('isDropset' in changes) {
    patch.is_dropset = changes.isDropset

    // AUDIT M5 plan-side fix: PlanPage.tsx's DROP toggle can only ever
    // apply to the set currently being edited — the same reasoning as
    // GymSession.tsx's M5 fix — so nearest-preceding-non-dropset
    // inference (same week_plan_id + program_exercise_id, ordered by
    // set_number) is provably correct here too, not a guess. Deliberately
    // NOT shared with GymSession.tsx's copy of this logic; consolidate
    // both into setGroupLogic.ts when Phase 3.1 builds it for real.
    if (changes.isDropset) {
      const { data: target, error: eTarget } = await supabase
        .from('v2_week_plan_sets')
        .select('week_plan_id, program_exercise_id, set_number')
        .eq('id', id)
        .single()
      if (eTarget) throw eTarget

      const { data: parent, error: eParent } = await supabase
        .from('v2_week_plan_sets')
        .select('id')
        .eq('week_plan_id', target.week_plan_id)
        .eq('program_exercise_id', target.program_exercise_id)
        .eq('is_dropset', false)
        .lt('set_number', target.set_number)
        .order('set_number', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (eParent) throw eParent

      patch.parent_week_plan_set_id = parent?.id ?? null
    } else {
      // Un-toggling — this set is no longer a stage, so it must not keep
      // pointing at a parent.
      patch.parent_week_plan_set_id = null
    }
  }

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
      const { data: newSets, error: e3 } = await supabase
        .from('v2_week_plan_sets')
        .insert(
          prevSets.map((s) => ({
            week_plan_id: (newPlan as { id: string }).id,
            user_id: userId,
            program_exercise_id: s.program_exercise_id,
            set_number: s.set_number,
            target_rir: s.target_rir,
            is_dropset: s.is_dropset,
          })),
        )
        .select()
      if (e3) throw e3

      // AUDIT M5 plan-side fix: parent_week_plan_set_id can't be copied
      // forward — the old week's ids don't exist in this one — so
      // grouping is re-inferred from scratch against the newly-created
      // batch instead of remapping old-id → new-id, the same trick 007's
      // backfill already uses successfully for historical data. Correct
      // here for the same reason: grouping only ever depends on sibling
      // is_dropset/set_number within (week_plan_id, program_exercise_id),
      // never on row identity.
      await reparentCopiedDropsets((newSets ?? []) as DbWeekPlanSet[])
    }
  }
}

// Re-infers parent_week_plan_set_id for a freshly-inserted batch of plan
// sets by grouping on program_exercise_id (every row already shares one
// week_plan_id, being one insert batch) and applying the same
// nearest-preceding-non-dropset rule as updateSet() above. Deliberately
// NOT shared with GymSession.tsx's copy of this logic; consolidate into
// setGroupLogic.ts when Phase 3.1 builds it for real.
async function reparentCopiedDropsets(rows: DbWeekPlanSet[]): Promise<void> {
  const byExercise = new Map<string, DbWeekPlanSet[]>()
  for (const row of rows) {
    const group = byExercise.get(row.program_exercise_id) ?? []
    group.push(row)
    byExercise.set(row.program_exercise_id, group)
  }

  for (const group of byExercise.values()) {
    const sorted = [...group].sort((a, b) => a.set_number - b.set_number)
    for (const row of sorted) {
      if (!row.is_dropset) continue
      const parent = [...sorted]
        .filter((s) => s.set_number < row.set_number)
        .sort((a, b) => b.set_number - a.set_number)
        .find((s) => !s.is_dropset)
      if (!parent) continue
      const { error } = await supabase
        .from('v2_week_plan_sets')
        .update({ parent_week_plan_set_id: parent.id })
        .eq('id', row.id)
      if (error) throw error
    }
  }
}
