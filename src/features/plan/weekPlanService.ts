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
  if ('isDropset' in changes) patch.is_dropset = changes.isDropset
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
      const { error: e3 } = await supabase.from('v2_week_plan_sets').insert(
        prevSets.map((s) => ({
          week_plan_id: (newPlan as { id: string }).id,
          user_id: userId,
          program_exercise_id: s.program_exercise_id,
          set_number: s.set_number,
          target_rir: s.target_rir,
          is_dropset: s.is_dropset,
        })),
      )
      if (e3) throw e3
    }
  }
}
