import { differenceInWeeks, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExerciseSessionPoint {
  sessionId: string
  date: string
  topWeight: number
  volume: number
  avgRir: number | null
  avgRestSeconds: number | null
  setCount: number
  avgReps: number
  topSet: { weight: number; reps: number; rir: number | null }
}

export interface WeekPoint {
  weekNumber: number
  totalSets: number
  avgRir: number | null
  avgReps: number | null
  avgRestSeconds: number | null
  isDeload: boolean
}

// ─── Exercise progress ────────────────────────────────────────────────────────

type RawSetLogRow = {
  session_id: string
  weight: number | null
  reps: number | null
  rir: number | null
  rest_seconds: number | null
  is_skipped: boolean
  logged_at: string
  v2_sessions: { id: string; date: string; status: string } | null
}

export async function fetchExerciseProgress(
  userId: string,
  exerciseId: string,
): Promise<ExerciseSessionPoint[]> {
  const { data, error } = await supabase
    .from('v2_set_logs')
    .select(
      'session_id, weight, reps, rir, rest_seconds, is_skipped, logged_at, v2_sessions(id, date, status)',
    )
    .eq('user_id', userId)
    .eq('exercise_id', exerciseId)
    .eq('is_skipped', false)
    .order('logged_at', { ascending: true })
    .limit(1000)
  if (error) throw error

  // Filter to completed sessions only — skipped/in_progress never appear
  const rows = (data as unknown as RawSetLogRow[]).filter(
    (r) =>
      r.v2_sessions?.status === 'completed' && r.weight !== null && r.reps !== null,
  )

  // Group by session
  const sessionMap = new Map<string, { date: string; logs: RawSetLogRow[] }>()
  for (const row of rows) {
    const sid = row.session_id
    if (!sessionMap.has(sid)) sessionMap.set(sid, { date: row.v2_sessions!.date, logs: [] })
    sessionMap.get(sid)!.logs.push(row)
  }

  // Aggregate per session
  const result: ExerciseSessionPoint[] = []
  for (const [sessionId, { date, logs }] of sessionMap.entries()) {
    const topWeight = Math.max(...logs.map((l) => l.weight!))
    const topLog = logs.find((l) => l.weight === topWeight) ?? logs[0]

    const rirLogs = logs.filter((l) => l.rir !== null)
    const restLogs = logs.filter((l) => l.rest_seconds !== null)

    result.push({
      sessionId,
      date,
      topWeight,
      volume: logs.reduce((s, l) => s + l.weight! * l.reps!, 0),
      avgRir:
        rirLogs.length > 0 ? rirLogs.reduce((s, l) => s + l.rir!, 0) / rirLogs.length : null,
      avgRestSeconds:
        restLogs.length > 0
          ? restLogs.reduce((s, l) => s + l.rest_seconds!, 0) / restLogs.length
          : null,
      setCount: logs.length,
      avgReps: logs.reduce((s, l) => s + l.reps!, 0) / logs.length,
      topSet: { weight: topLog.weight!, reps: topLog.reps!, rir: topLog.rir },
    })
  }

  return result.sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Meso weekly progress ─────────────────────────────────────────────────────

type RawSession = {
  id: string
  date: string
  v2_set_logs: Array<{
    weight: number | null
    reps: number | null
    rir: number | null
    rest_seconds: number | null
    is_skipped: boolean
  }>
}

export async function fetchMesoWeeklyProgress(
  userId: string,
  mesoId: string,
  mesoStartDate: string,
): Promise<WeekPoint[]> {
  const [{ data: sessions, error: sErr }, { data: plans, error: pErr }] = await Promise.all([
    supabase
      .from('v2_sessions')
      .select('id, date, v2_set_logs(weight, reps, rir, rest_seconds, is_skipped)')
      .eq('user_id', userId)
      .eq('mesocycle_id', mesoId)
      .eq('status', 'completed')
      .order('date', { ascending: true }),
    supabase
      .from('v2_week_plans')
      .select('week_number, is_deload')
      .eq('mesocycle_id', mesoId),
  ])
  if (sErr) throw sErr
  if (pErr) throw pErr

  const deloadWeeks = new Set<number>(
    ((plans ?? []) as { week_number: number; is_deload: boolean }[])
      .filter((p) => p.is_deload)
      .map((p) => p.week_number),
  )

  // Group set_logs by week number, computed from session date vs meso start
  const weekMap = new Map<number, RawSession['v2_set_logs']>()
  for (const session of (sessions ?? []) as RawSession[]) {
    const wk = differenceInWeeks(parseISO(session.date), parseISO(mesoStartDate)) + 1
    const existing = weekMap.get(wk) ?? []
    weekMap.set(wk, [...existing, ...session.v2_set_logs])
  }

  const result: WeekPoint[] = []
  for (const [weekNumber, allLogs] of weekMap.entries()) {
    const valid = allLogs.filter(
      (l) => !l.is_skipped && l.weight !== null && l.reps !== null,
    )
    const withRir = valid.filter((l) => l.rir !== null)
    const withRest = allLogs.filter((l) => l.rest_seconds !== null)

    result.push({
      weekNumber,
      totalSets: valid.length,
      avgRir:
        withRir.length > 0 ? withRir.reduce((s, l) => s + l.rir!, 0) / withRir.length : null,
      avgReps:
        valid.length > 0 ? valid.reduce((s, l) => s + l.reps!, 0) / valid.length : null,
      avgRestSeconds:
        withRest.length > 0
          ? withRest.reduce((s, l) => s + l.rest_seconds!, 0) / withRest.length
          : null,
      isDeload: deloadWeeks.has(weekNumber),
    })
  }

  return result.sort((a, b) => a.weekNumber - b.weekNumber)
}
