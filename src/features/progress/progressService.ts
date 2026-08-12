import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { headsOnly } from '../gym/setGroupLogic'
import { fetchSession } from '../gym/sessionService'
import { compareE1rmWindow, type E1rmComparison, type E1rmSetInput } from './e1rm'
import { matchSessionsByPosition, averagePositionMatchedDelta } from './positionMatch'

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

// One session's raw eligible-set data plus the two fields (§2.5) needed to
// scope it to a meso window without a second query — mesocycleId decides
// which sessions belong to "the current meso" (SPEC §6), isDeload decides
// which of those are excluded from the e1RM comparison's endpoints.
export interface ExerciseE1rmSessionData {
  sessionId: string
  date: string
  mesocycleId: string | null
  isDeload: boolean
  sets: E1rmSetInput[]
}

export interface ExerciseProgressData {
  points: ExerciseSessionPoint[]
  e1rmSessions: ExerciseE1rmSessionData[]
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
  id: string
  session_id: string
  weight: number | null
  reps: number | null
  rir: number | null
  rest_seconds: number | null
  is_skipped: boolean
  is_warmup: boolean
  parent_set_id: string | null
  logged_at: string
  v2_sessions: {
    id: string
    date: string
    status: string
    mesocycle_id: string | null
    v2_week_plans: { is_deload: boolean } | null
  } | null
}

const EXERCISE_PROGRESS_PAGE_SIZE = 1000

// AUDIT H4: the old `.limit(1000)` on an ascending `logged_at` order silently
// dropped the NEWEST sets past row 1000 for a high-volume exercise — the
// oldest 1000 rows always won, which is backwards for a trend chart, and (per
// TASKS.md §2.5's "No new query" note) also truncated the e1RM baseline since
// it's computed from this same fetch. Same fix shape as historyService.ts's
// Phase 3.4 pagination (§2.6): loop `.range()` pages until a short page
// proves there's nothing left, instead of capping at all. `id` is a
// tiebreaker — `logged_at` alone can tie for an offline-queued batch
// (TASKS.md's migration-risk section already flags near-identical offline
// timestamps), and a tie without a stable secondary key can duplicate or
// drop rows across separate `.range()` calls.
async function fetchAllExerciseSetLogRows(
  userId: string,
  exerciseId: string,
): Promise<RawSetLogRow[]> {
  const rows: RawSetLogRow[] = []
  let offset = 0
  for (;;) {
    const { data, error } = await supabase
      .from('v2_set_logs')
      .select(
        'id, session_id, weight, reps, rir, rest_seconds, is_skipped, is_warmup, parent_set_id, logged_at, v2_sessions(id, date, status, mesocycle_id, v2_week_plans(is_deload))',
      )
      .eq('user_id', userId)
      .eq('exercise_id', exerciseId)
      .order('logged_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + EXERCISE_PROGRESS_PAGE_SIZE - 1)
    if (error) throw error

    const page = data as unknown as RawSetLogRow[]
    rows.push(...page)
    if (page.length < EXERCISE_PROGRESS_PAGE_SIZE) break
    offset += EXERCISE_PROGRESS_PAGE_SIZE
  }
  return rows
}

export async function fetchExerciseProgress(
  userId: string,
  exerciseId: string,
): Promise<ExerciseProgressData> {
  const allRows = await fetchAllExerciseSetLogRows(userId, exerciseId)

  // Filter to completed sessions only — skipped/in_progress never appear
  const rows = allRows.filter(
    (r) =>
      r.v2_sessions?.status === 'completed' && r.weight !== null && r.reps !== null,
  )

  // Group by session
  const sessionMap = new Map<
    string,
    { date: string; mesocycleId: string | null; isDeload: boolean; logs: RawSetLogRow[] }
  >()
  for (const row of rows) {
    const sid = row.session_id
    if (!sessionMap.has(sid)) {
      sessionMap.set(sid, {
        date: row.v2_sessions!.date,
        mesocycleId: row.v2_sessions!.mesocycle_id,
        isDeload: row.v2_sessions!.v2_week_plans?.is_deload ?? false,
        logs: [],
      })
    }
    sessionMap.get(sid)!.logs.push(row)
  }

  // Aggregate per session
  const points: ExerciseSessionPoint[] = []
  const e1rmSessions: ExerciseE1rmSessionData[] = []
  for (const [sessionId, { date, mesocycleId, isDeload, logs }] of sessionMap.entries()) {
    // Stage-exclusion rule (§2.1 / §2.7 item 4) — a drop stage is never
    // counted as an independent set. volume is the deliberate exception and
    // keeps stages, since a stage is real work performed.
    const headLogs = headsOnly(logs, (l) => l.parent_set_id)

    const topWeight = Math.max(...headLogs.map((l) => l.weight!))
    const topLog = headLogs.find((l) => l.weight === topWeight) ?? headLogs[0]

    const rirLogs = headLogs.filter((l) => l.rir !== null)
    const restLogs = logs.filter((l) => l.rest_seconds !== null)

    points.push({
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
      setCount: headLogs.length,
      avgReps: headLogs.reduce((s, l) => s + l.reps!, 0) / headLogs.length,
      topSet: { weight: topLog.weight!, reps: topLog.reps!, rir: topLog.rir },
    })

    e1rmSessions.push({
      sessionId,
      date,
      mesocycleId,
      isDeload,
      sets: logs.map((l) => ({
        weight: l.weight,
        reps: l.reps,
        rir: l.rir,
        isSkipped: l.is_skipped,
        isWarmup: l.is_warmup,
        parentSetId: l.parent_set_id,
      })),
    })
  }

  return {
    points: points.sort((a, b) => a.date.localeCompare(b.date)),
    e1rmSessions: e1rmSessions.sort((a, b) => a.date.localeCompare(b.date)),
  }
}

// Progress headline (TASKS.md §4 item 25 / SPEC §6): "first vs. most recent
// working numbers within the current meso." Scoping to one meso happens
// here, not inside e1rm.ts's compareE1rmWindow — that module only ever sees
// an already-scoped session list, same separation referenceLogic.ts uses
// between its pure date-window math and the workout_day_id scoping its
// caller does first.
export function getExerciseE1rmComparison(
  e1rmSessions: ExerciseE1rmSessionData[],
  mesocycleId: string,
): E1rmComparison | null {
  return compareE1rmWindow(
    e1rmSessions
      .filter((s) => s.mesocycleId === mesocycleId)
      .map((s) => ({ sessionId: s.sessionId, date: s.date, isDeload: s.isDeload, sets: s.sets })),
  )
}

// Progress headline (SPEC §6), now position-matched instead of a
// whole-session average (see CONTEXT.md "Position-matched progress
// comparison"). *Which* two sessions get compared is unchanged — still
// getExerciseE1rmComparison's first-eligible-vs-most-recent-eligible pick
// within the active meso, deload weeks excluded; `sessionPair` here is that
// same call's result, read only for its session identity
// (firstSessionId/firstDate/lastSessionId/lastDate), not its own
// deltaPercent (compareE1rmWindow's whole-session-average number, which
// this headline no longer uses — see CONTEXT.md for the one other call
// site check). Only the delta *calculation* on those two sessions changed:
// matchSessionsByPosition's slot-by-slot match, rolled up by
// averagePositionMatchedDelta, instead of compareE1rmWindow's average.
//
// `fetchExerciseProgress`'s own set-log fetch (`e1rmSessions[].sets`) is
// deliberately not reused here — it's the flat, position-agnostic shape
// e1rm.ts's whole-session average needs, without setNumber/stageIndex/id,
// so it can't build ordered slots. Two full `fetchSession` reads (the same
// already-shipped function the gym reference panel and session detail use)
// get the real ordered SetLog rows instead — a second network round trip
// per headline, not a free one, but React Query's cache key below scopes
// it to the resolved session pair, so it only re-fetches when the pair
// itself changes, not on every render.
export async function fetchPositionMatchedHeadline(
  exerciseId: string,
  sessionPair: E1rmComparison,
): Promise<number | null> {
  const [firstSession, lastSession] = await Promise.all([
    fetchSession(sessionPair.firstSessionId),
    fetchSession(sessionPair.lastSessionId),
  ])

  const result = matchSessionsByPosition(
    {
      sessionId: sessionPair.firstSessionId,
      date: sessionPair.firstDate,
      logs: (firstSession.setLogs ?? []).filter((l) => l.exerciseId === exerciseId),
    },
    {
      sessionId: sessionPair.lastSessionId,
      date: sessionPair.lastDate,
      logs: (lastSession.setLogs ?? []).filter((l) => l.exerciseId === exerciseId),
    },
  )

  return averagePositionMatchedDelta(result)
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
    parent_set_id: string | null
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
      .select('id, date, v2_set_logs(weight, reps, rir, rest_seconds, is_skipped, parent_set_id)')
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
    const wk = differenceInCalendarWeeks(parseISO(session.date), parseISO(mesoStartDate), { weekStartsOn: 1 }) + 1
    const existing = weekMap.get(wk) ?? []
    weekMap.set(wk, [...existing, ...session.v2_set_logs])
  }

  const result: WeekPoint[] = []
  for (const [weekNumber, allLogs] of weekMap.entries()) {
    // Stage-exclusion rule (§2.1 / §2.7 item 5) — a drop stage is never
    // counted as an independent set on the meso overview dashboard either.
    const headLogs = headsOnly(allLogs, (l) => l.parent_set_id)
    const valid = headLogs.filter(
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
