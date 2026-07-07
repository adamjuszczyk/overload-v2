import { supabase } from '../../lib/supabase'
import { toMuscleGroup } from '../../lib/muscleGroup'
import type { Session, SetLog } from '../../types'

// ─── DB Types ──────────────────────────────────────────────────────────────────

type DbExercise = {
  id: string
  name: string
  muscle_group: string | null
  user_id: string
  is_archived: boolean
  created_at: string
}

type DbSetLog = {
  id: string
  user_id: string
  session_id: string
  exercise_id: string
  exercises?: DbExercise
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
}

type DbSession = {
  id: string
  user_id: string
  mesocycle_id: string | null
  week_plan_id: string | null
  workout_day_id: string | null
  date: string
  status: string
  note: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  v2_set_logs?: DbSetLog[]
}

// ─── Mappers ──────────────────────────────────────────────────────────────────

function toSetLog(row: DbSetLog): SetLog {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    exerciseId: row.exercise_id,
    exercise: row.exercises
      ? {
          id: row.exercises.id,
          userId: row.exercises.user_id,
          name: row.exercises.name,
          muscleGroup: toMuscleGroup(row.exercises.muscle_group),
          isArchived: row.exercises.is_archived,
          createdAt: row.exercises.created_at,
        }
      : undefined,
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
  }
}

function toSession(row: DbSession): Session {
  return {
    id: row.id,
    userId: row.user_id,
    mesocycleId: row.mesocycle_id,
    weekPlanId: row.week_plan_id,
    workoutDayId: row.workout_day_id,
    date: row.date,
    status: row.status as Session['status'],
    note: row.note,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    setLogs: row.v2_set_logs?.map(toSetLog).sort((a, b) => a.loggedAt.localeCompare(b.loggedAt)),
  }
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function fetchSessionsInRange(
  startDate: string,
  endDate: string,
): Promise<Session[]> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .select('*')
    .gte('date', startDate)
    .lte('date', endDate)
  if (error) throw error
  return (data as DbSession[]).map(toSession)
}

export async function fetchSession(id: string): Promise<Session> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .select('*, v2_set_logs(*, exercises(*))')
    .eq('id', id)
    .single()
  if (error) throw error
  return toSession(data as DbSession)
}

export async function createSession(
  userId: string,
  mesoId: string,
  weekPlanId: string | null,
  workoutDayId: string,
  date: string,
): Promise<Session> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .insert({
      user_id: userId,
      mesocycle_id: mesoId,
      week_plan_id: weekPlanId,
      workout_day_id: workoutDayId,
      date,
      status: 'in_progress',
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single()
  if (error) throw error
  return toSession(data as DbSession)
}

export async function completeSession(id: string, note: string | null): Promise<void> {
  const { error } = await supabase
    .from('v2_sessions')
    .update({ status: 'completed', completed_at: new Date().toISOString(), note })
    .eq('id', id)
  if (error) throw error
}

export async function reopenSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('v2_sessions')
    .update({ status: 'in_progress', completed_at: null })
    .eq('id', id)
  if (error) throw error
}

export async function skipSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('v2_sessions')
    .update({ status: 'skipped' })
    .eq('id', id)
  if (error) throw error
}

// Creates a session row for a missed date and immediately marks as skipped
export async function skipMissedSession(
  userId: string,
  mesoId: string,
  weekPlanId: string | null,
  workoutDayId: string,
  date: string,
  existingSessionId: string | null,
): Promise<void> {
  if (existingSessionId) {
    await skipSession(existingSessionId)
  } else {
    const { error } = await supabase.from('v2_sessions').insert({
      user_id: userId,
      mesocycle_id: mesoId,
      week_plan_id: weekPlanId,
      workout_day_id: workoutDayId,
      date,
      status: 'skipped',
    })
    if (error) throw error
  }
}

// ─── Set Logs ─────────────────────────────────────────────────────────────────

export async function logSet(params: {
  userId: string
  sessionId: string
  exerciseId: string
  weekPlanSetId: string | null
  setNumber: number
  weight: number | null
  reps: number | null
  rir: number | null
  note: string | null
  isDropset: boolean
  parentSetId: string | null
  isSkipped: boolean
  restSeconds: number | null
}): Promise<SetLog> {
  const { data, error } = await supabase
    .from('v2_set_logs')
    .insert({
      user_id: params.userId,
      session_id: params.sessionId,
      exercise_id: params.exerciseId,
      week_plan_set_id: params.weekPlanSetId,
      set_number: params.setNumber,
      weight: params.weight,
      reps: params.reps,
      rir: params.rir,
      note: params.note,
      is_dropset: params.isDropset,
      parent_set_id: params.parentSetId,
      is_skipped: params.isSkipped,
      logged_at: new Date().toISOString(),
      rest_seconds: params.restSeconds,
    })
    .select('*, exercises(*)')
    .single()
  if (error) throw error
  return toSetLog(data as DbSetLog)
}

export async function updateSetLog(
  id: string,
  changes: {
    weight?: number | null
    reps?: number | null
    rir?: number | null
    note?: string | null
    setNumber?: number
  },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if ('weight' in changes) patch.weight = changes.weight
  if ('reps' in changes) patch.reps = changes.reps
  if ('rir' in changes) patch.rir = changes.rir
  if ('note' in changes) patch.note = changes.note
  if ('setNumber' in changes) patch.set_number = changes.setNumber

  const { error } = await supabase.from('v2_set_logs').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteSetLog(id: string): Promise<void> {
  const { error } = await supabase.from('v2_set_logs').delete().eq('id', id)
  if (error) throw error
}

// Fetches the most recent previous session's set logs for a given exercise.
// Used to populate the ExerciseCard "Last Session" panel and pre-fill weights.
export async function fetchLastSessionLogs(
  userId: string,
  exerciseId: string,
  currentSessionId: string | null,
): Promise<SetLog[]> {
  // Join v2_sessions so we can filter by status = 'completed'.
  // Skipped/in_progress sessions must never appear as "last session" reference.
  const { data, error } = await supabase
    .from('v2_set_logs')
    .select('*, exercises(*), v2_sessions(id, status)')
    .eq('user_id', userId)
    .eq('exercise_id', exerciseId)
    .order('logged_at', { ascending: false })
    .limit(50)
  if (error) throw error

  type Row = DbSetLog & { v2_sessions: { id: string; status: string } | null }
  const rows = data as Row[]

  // Find the most recent session_id that is completed and isn't the active session
  const prevSessionId = rows.find(
    (r) => r.session_id !== currentSessionId && r.v2_sessions?.status === 'completed',
  )?.session_id

  if (!prevSessionId) return []
  return rows
    .filter((r) => r.session_id === prevSessionId)
    .map((r) => toSetLog(r as DbSetLog))
    .sort((a, b) => a.setNumber - b.setNumber)
}
