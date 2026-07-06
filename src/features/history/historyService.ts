import { supabase } from '../../lib/supabase'
import type { MuscleGroup, SessionStatus } from '../../types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HistoryRow {
  id: string
  date: string
  status: SessionStatus
  note: string | null
  startedAt: string | null
  completedAt: string | null
  workoutDayId: string | null
  workoutDayName: string | null
  mesocycleId: string | null
  mesocycleName: string | null
  setCount: number
  muscleGroups: MuscleGroup[]
}

export interface HistorySetRow {
  setNumber: number
  weight: number | null
  reps: number | null
  rir: number | null
  restSeconds: number | null
  isSkipped: boolean
  isDropset: boolean
}

export interface HistoryExerciseGroup {
  exerciseId: string
  exerciseName: string
  muscleGroup: MuscleGroup
  position: number
  sets: HistorySetRow[]
}

export interface HistoryDetail extends HistoryRow {
  exerciseGroups: HistoryExerciseGroup[]
}

// ─── Raw DB row types ─────────────────────────────────────────────────────────

type RawLogMinimal = {
  id: string
  is_skipped: boolean
  exercises: { id: string; muscle_group: string } | null
}

type RawSessionRow = {
  id: string
  date: string
  status: string
  note: string | null
  started_at: string | null
  completed_at: string | null
  workout_day_id: string | null
  mesocycle_id: string | null
  v2_set_logs: RawLogMinimal[]
  v2_mesocycles: { id: string; name: string } | null
}

type RawLogFull = {
  id: string
  exercise_id: string
  set_number: number
  weight: number | null
  reps: number | null
  rir: number | null
  rest_seconds: number | null
  is_skipped: boolean
  is_dropset: boolean
  logged_at: string
  exercises: { id: string; name: string; muscle_group: string } | null
}

type RawSessionFull = {
  id: string
  date: string
  status: string
  note: string | null
  started_at: string | null
  completed_at: string | null
  workout_day_id: string | null
  mesocycle_id: string | null
  v2_set_logs: RawLogFull[]
  v2_mesocycles: { id: string; name: string } | null
}

// ─── Session list ─────────────────────────────────────────────────────────────

export async function fetchHistorySessions(userId: string): Promise<HistoryRow[]> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .select(`
      id, date, status, note, started_at, completed_at,
      workout_day_id, mesocycle_id,
      v2_set_logs(id, is_skipped, exercises(id, muscle_group)),
      v2_mesocycles(id, name)
    `)
    .eq('user_id', userId)
    .order('date', { ascending: false })
    .limit(500)
  if (error) throw error

  const rows = data as unknown as RawSessionRow[]

  // Batch-fetch workout day names for all unique workout_day_ids
  const dayIds = [...new Set(rows.map(r => r.workout_day_id).filter(Boolean))] as string[]
  const dayNameMap: Record<string, string> = {}
  if (dayIds.length > 0) {
    const { data: days } = await supabase
      .from('v2_workout_days')
      .select('id, name')
      .in('id', dayIds)
    for (const d of (days ?? []) as { id: string; name: string }[]) {
      dayNameMap[d.id] = d.name
    }
  }

  return rows.map(r => {
    const activeLogs = (r.v2_set_logs ?? []).filter(l => !l.is_skipped)
    const muscleGroups = [
      ...new Set(activeLogs.map(l => l.exercises?.muscle_group).filter(Boolean) as MuscleGroup[]),
    ]
    return {
      id: r.id,
      date: r.date,
      status: r.status as SessionStatus,
      note: r.note,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      workoutDayId: r.workout_day_id,
      workoutDayName: r.workout_day_id ? (dayNameMap[r.workout_day_id] ?? null) : null,
      mesocycleId: r.mesocycle_id,
      mesocycleName: r.v2_mesocycles?.name ?? null,
      setCount: activeLogs.length,
      muscleGroups,
    }
  })
}

// ─── Session detail ───────────────────────────────────────────────────────────

export async function fetchHistoryDetail(sessionId: string): Promise<HistoryDetail> {
  const { data, error } = await supabase
    .from('v2_sessions')
    .select(`
      id, date, status, note, started_at, completed_at,
      workout_day_id, mesocycle_id,
      v2_set_logs(
        id, exercise_id, set_number, weight, reps, rir,
        rest_seconds, is_skipped, is_dropset, logged_at,
        exercises(id, name, muscle_group)
      ),
      v2_mesocycles(id, name)
    `)
    .eq('id', sessionId)
    .single()
  if (error) throw error

  const session = data as unknown as RawSessionFull

  let workoutDayName: string | null = null
  const positionMap: Record<string, number> = {}

  if (session.workout_day_id) {
    const [{ data: day }, { data: progEx }] = await Promise.all([
      supabase
        .from('v2_workout_days')
        .select('id, name')
        .eq('id', session.workout_day_id)
        .maybeSingle(),
      supabase
        .from('v2_program_exercises')
        .select('exercise_id, position')
        .eq('workout_day_id', session.workout_day_id),
    ])
    workoutDayName = (day as { id: string; name: string } | null)?.name ?? null
    for (const pe of (progEx ?? []) as { exercise_id: string; position: number }[]) {
      positionMap[pe.exercise_id] = pe.position
    }
  }

  // Sort set_logs by logged_at then set_number for stable ordering
  const sortedLogs = [...(session.v2_set_logs ?? [])].sort((a, b) => {
    const d = a.logged_at.localeCompare(b.logged_at)
    return d !== 0 ? d : a.set_number - b.set_number
  })

  // Group by exercise; program position for ordering, first-appearance as fallback
  const exerciseMap = new Map<string, HistoryExerciseGroup>()
  let fallbackPos = 0
  for (const log of sortedLogs) {
    if (!log.exercises) continue
    if (!exerciseMap.has(log.exercise_id)) {
      exerciseMap.set(log.exercise_id, {
        exerciseId: log.exercise_id,
        exerciseName: log.exercises.name,
        muscleGroup: log.exercises.muscle_group as MuscleGroup,
        position:
          log.exercise_id in positionMap ? positionMap[log.exercise_id] : 9999 + fallbackPos++,
        sets: [],
      })
    }
    exerciseMap.get(log.exercise_id)!.sets.push({
      setNumber: log.set_number,
      weight: log.weight,
      reps: log.reps,
      rir: log.rir,
      restSeconds: log.rest_seconds,
      isSkipped: log.is_skipped,
      isDropset: log.is_dropset,
    })
  }

  const exerciseGroups = [...exerciseMap.values()].sort((a, b) => a.position - b.position)

  const activeLogs = sortedLogs.filter(l => !l.is_skipped)
  const muscleGroups = [
    ...new Set(activeLogs.map(l => l.exercises?.muscle_group).filter(Boolean) as MuscleGroup[]),
  ]

  return {
    id: session.id,
    date: session.date,
    status: session.status as SessionStatus,
    note: session.note,
    startedAt: session.started_at,
    completedAt: session.completed_at,
    workoutDayId: session.workout_day_id,
    workoutDayName,
    mesocycleId: session.mesocycle_id,
    mesocycleName: session.v2_mesocycles?.name ?? null,
    setCount: activeLogs.length,
    muscleGroups,
    exerciseGroups,
  }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('v2_sessions').delete().eq('id', id)
  if (error) throw error
}
