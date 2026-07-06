import { db } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import type { WorkoutDay, WeekPlan, ProgramExercise } from '../../types'

type RawSetLogRow = {
  id: string
  session_id: string
  exercise_id: string
  week_plan_set_id: string | null
  set_number: number
  weight: number | null
  reps: number | null
  rir: number | null
  note: string | null
  is_dropset: boolean
  parent_set_id: string | null
  is_skipped: boolean
  logged_at: string
  rest_seconds: number | null
  v2_sessions: { id: string; status: string } | null
}

export async function primeOfflineCache(params: {
  userId: string
  sessionId: string
  workoutDay: WorkoutDay
  weekPlan: WeekPlan | null
  programExercises: ProgramExercise[]
}): Promise<void> {
  const { userId, sessionId, workoutDay, weekPlan, programExercises } = params

  // 1. Cache workout day with program exercises
  await db.workout_days.put({
    id: workoutDay.id,
    programId: workoutDay.programId,
    name: workoutDay.name,
    position: workoutDay.position,
    exercises: programExercises,
  })

  // 2. Cache week plan with sets
  if (weekPlan) {
    await db.week_plans.put({
      id: weekPlan.id,
      mesocycleId: weekPlan.mesocycleId,
      workoutDayId: weekPlan.workoutDayId,
      weekNumber: weekPlan.weekNumber,
      isDeload: weekPlan.isDeload,
      sets: weekPlan.sets,
    })
  }

  // 3. Cache last completed session logs for each exercise (for pre-fill)
  await Promise.all(
    programExercises.map(async (pe) => {
      const { data } = await supabase
        .from('v2_set_logs')
        .select('*, v2_sessions(id, status)')
        .eq('user_id', userId)
        .eq('exercise_id', pe.exerciseId)
        .order('logged_at', { ascending: false })
        .limit(20)

      if (!data) return
      const rows = data as unknown as RawSetLogRow[]

      const prevSessionId = rows.find(
        (r) => r.session_id !== sessionId && r.v2_sessions?.status === 'completed',
      )?.session_id
      if (!prevSessionId) return

      const prevRows = rows.filter((r) => r.session_id === prevSessionId)
      await Promise.all(
        prevRows.map((row) =>
          db.set_logs.put({
            id: row.id,
            sessionId: row.session_id,
            exerciseId: row.exercise_id,
            weekPlanSetId: row.week_plan_set_id,
            setNumber: row.set_number,
            weight: row.weight,
            reps: row.reps,
            rir: row.rir,
            note: row.note,
            isDropset: row.is_dropset,
            parentSetId: row.parent_set_id,
            isSkipped: row.is_skipped,
            loggedAt: row.logged_at,
            restSeconds: row.rest_seconds,
          }),
        ),
      )
    }),
  )

  // 4. Cache exercise list
  const { data: exercises } = await supabase
    .from('exercises')
    .select('id, name, muscle_group, user_id, is_archived')
    .eq('user_id', userId)
    .eq('is_archived', false)

  if (exercises) {
    await Promise.all(
      (exercises as { id: string; name: string; muscle_group: string; user_id: string; is_archived: boolean }[]).map(
        (ex) =>
          db.exercises.put({
            id: ex.id,
            userId: ex.user_id,
            name: ex.name,
            muscleGroup: ex.muscle_group,
            isArchived: ex.is_archived,
          }),
      ),
    )
  }
}
