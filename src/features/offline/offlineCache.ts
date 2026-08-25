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
  // Absent until migration 004/005/006 has been applied.
  stage_index?: number
  is_warmup?: boolean
  set_seconds?: number | null
  entered_unit?: string | null
  // Absent until migration 016 has been applied.
  form_rating?: string | null
}

type RawSessionRow = {
  id: string
  user_id: string
  date: string
  status: string
  mesocycle_id: string | null
  week_plan_id: string | null
  workout_day_id: string | null
  note: string | null
  started_at: string | null
  completed_at: string | null
  // Absent until migration 016 has been applied.
  energy_rating?: string | null
  pump_rating?: string | null
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

  // 3. Cache candidate completed sessions for this workout day, and every
  // set log in them for this workout day's exercises — session-first, same
  // shape as sessionService.fetchReferenceSessions (v3 §2.3), so the
  // offline reference panel (useExerciseReferenceSessions' Dexie fallback)
  // has the full LAST WEEK / THIS WEEK / LAST TIME picture available, not
  // just a single "last session". This also fully covers the old
  // single-session prefill cache it replaces — a superset, not a narrower
  // fetch.
  const exerciseIds = programExercises.map((pe) => pe.exerciseId)
  if (exerciseIds.length > 0) {
    const { data: sessionData } = await supabase
      .from('v2_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('workout_day_id', workoutDay.id)
      .eq('status', 'completed')
      .neq('id', sessionId)
      .order('date', { ascending: false })

    const sessionRows = (sessionData ?? []) as RawSessionRow[]
    if (sessionRows.length > 0) {
      await Promise.all(
        sessionRows.map((s) =>
          db.sessions.put({
            id: s.id,
            userId: s.user_id,
            date: s.date,
            status: s.status,
            mesocycleId: s.mesocycle_id,
            weekPlanId: s.week_plan_id,
            workoutDayId: s.workout_day_id,
            note: s.note,
            startedAt: s.started_at,
            completedAt: s.completed_at,
            energyRating: s.energy_rating ?? null,
            pumpRating: s.pump_rating ?? null,
          }),
        ),
      )

      const sessionIds = sessionRows.map((s) => s.id)
      const { data: logData } = await supabase
        .from('v2_set_logs')
        .select('*')
        .eq('user_id', userId)
        .in('session_id', sessionIds)
        .in('exercise_id', exerciseIds)

      const logRows = (logData ?? []) as RawSetLogRow[]
      await Promise.all(
        logRows.map((row) =>
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
            stageIndex: row.stage_index ?? 0,
            isWarmup: row.is_warmup ?? false,
            setSeconds: row.set_seconds ?? null,
            enteredUnit: row.entered_unit ?? null,
            isSkipped: row.is_skipped,
            loggedAt: row.logged_at,
            restSeconds: row.rest_seconds,
            // Every cached row here comes from a status = 'completed' query.
            sessionStatus: 'completed',
            formRating: row.form_rating ?? null,
          }),
        ),
      )
    }
  }

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
