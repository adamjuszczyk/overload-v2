import { format, addDays, parseISO } from 'date-fns'
import { supabase } from '../../lib/supabase'
import { fetchMesos } from '../programs/mesoService'
import { fetchPrograms, fetchWorkoutDays } from '../programs/programService'
import { resolveWeek } from './weekResolution'
import { COACH_ANALYSIS_START_DATE } from './coachService'
import { weekKey } from './weightLogic'
import type { CoachWeekAnalysisContent, CoachWeekAnalysis, Session, Mesocycle } from '../../types'

// Week list/detail reads plus the POST to api/coach/analyze-week.ts
// (COACH-WEEK-ANALYSIS-TASKS.md §4 step 8b), following coachService.ts's
// shape: snake_case DB row types kept separate from the camelCase public
// interface, explicit .eq('user_id', userId) defence-in-depth alongside
// RLS. Client-side only — free to reuse mesoService.ts/programService.ts
// directly (their browser-singleton import is exactly what's fine here and
// fatal in api/coach/analyze-week.ts's own server-side equivalent,
// assembleWeekResolution).

const ISO_DATE = 'yyyy-MM-dd'

// ─── "To analyze" — complete weeks since the ship-date cutoff, no analysis row ──

export interface AnalyzableWeek {
  weekStart: string
  weekEnd: string
  mesocycleName: string | null
  expectedSessionCount: number
}

type RawSessionRow = {
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
}

function toSession(row: RawSessionRow): Session {
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
    // Not selected by this query, and not read by weekResolution.ts's own
    // completeness logic (date/status only) — hardcoded rather than
    // fetched, since resolveWeek doesn't need the real value. Distinct from
    // weekAnalysisInput.ts's own WeekAnalysisSessionRoster, which does carry
    // real per-session energy/pump ratings now that Weekly Analysis reads
    // Coach Personalization data (COACH-WEEK-ANALYSIS-TASKS.md's
    // personalization wiring) — this Session object exists only to drive
    // resolveWeek, never the analysis payload itself.
    energyRating: null,
    pumpRating: null,
  }
}

// Candidate weeks are derived from real sessions, not a hand-computed
// "floor Monday" — reuses COACH_ANALYSIS_START_DATE (daily's own ship-date
// cutoff, coachService.ts) exactly as-is, comparing instant-to-instant
// (completedAt >= COACH_ANALYSIS_START_DATE) the same way daily's own
// fetchAnalyzableSessions does, rather than converting it to a calendar
// date/week and risking a timezone slip in that conversion. A week
// qualifies as a candidate the moment any one of its sessions clears the
// cutoff; resolveWeek (unchanged) then decides for real whether the whole
// week is actually complete.
export async function fetchAnalyzableWeeks(userId: string): Promise<AnalyzableWeek[]> {
  const [mesocycles, programsRaw, { data: sessionRows, error: sessionError }, { data: analyzedRows, error: analyzedError }] =
    await Promise.all([
      fetchMesos(),
      fetchPrograms(),
      supabase
        .from('v2_sessions')
        .select('id, user_id, mesocycle_id, week_plan_id, workout_day_id, date, status, note, started_at, completed_at, created_at')
        .eq('user_id', userId),
      supabase.from('v2_coach_week_analyses').select('week_start').eq('user_id', userId),
    ])
  if (sessionError) throw sessionError
  if (analyzedError) throw analyzedError

  const programs = await Promise.all(
    programsRaw.map(async (p) => ({ ...p, workoutDays: await fetchWorkoutDays(p.id) })),
  )

  const sessions = (sessionRows as RawSessionRow[]).map(toSession)
  const analyzedWeekStarts = new Set((analyzedRows as { week_start: string }[]).map((r) => r.week_start))

  const candidateWeeks = new Set<string>()
  for (const s of sessions) {
    if (s.completedAt && s.completedAt >= COACH_ANALYSIS_START_DATE) {
      candidateWeeks.add(weekKey(s.date))
    }
  }

  const mesoById = new Map<string, Mesocycle>(mesocycles.map((m) => [m.id, m]))

  const result: AnalyzableWeek[] = []
  for (const weekStart of candidateWeeks) {
    if (analyzedWeekStarts.has(weekStart)) continue
    const resolution = resolveWeek(weekStart, mesocycles, programs, sessions)
    if (!resolution.isComplete) continue
    const mesocycleName = resolution.expected[0] ? (mesoById.get(resolution.expected[0].mesocycleId)?.name ?? null) : null
    result.push({
      weekStart: resolution.weekStart,
      weekEnd: resolution.weekEnd,
      mesocycleName,
      expectedSessionCount: resolution.expected.length,
    })
  }
  result.sort((a, b) => b.weekStart.localeCompare(a.weekStart))
  return result
}

// ─── "Analyses" — the saved write-ups ──────────────────────────────────────────

export interface CoachWeekAnalysisListItem {
  id: string
  weekStart: string
  weekEnd: string
  createdAt: string
  overall: string
}

type RawWeekAnalysisListRow = {
  id: string
  week_start: string
  created_at: string
  overall: string
}

// Selects a narrow JSON path out of content (content->>overall) instead of
// the whole row — same reasoning as coachService.ts's fetchCoachAnalyses:
// the list only needs enough to render a row, and input_snapshot is
// several KB per row the list has no use for. The detail fetch below pulls
// the full row.
export async function fetchCoachWeekAnalyses(userId: string): Promise<CoachWeekAnalysisListItem[]> {
  const { data, error } = await supabase
    .from('v2_coach_week_analyses')
    .select('id, week_start, created_at, overall:content->>overall')
    .eq('user_id', userId)
    .order('week_start', { ascending: false })
  if (error) throw error

  return (data as unknown as RawWeekAnalysisListRow[]).map((r) => ({
    id: r.id,
    weekStart: r.week_start,
    weekEnd: format(addDays(parseISO(r.week_start), 6), ISO_DATE),
    createdAt: r.created_at,
    overall: r.overall,
  }))
}

type RawWeekAnalysisRow = {
  id: string
  user_id: string
  week_start: string
  content: CoachWeekAnalysisContent
  input_snapshot: CoachWeekAnalysis['inputSnapshot']
  model: string
  prompt_version: number
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

const WEEK_ANALYSIS_COLUMNS =
  'id, user_id, week_start, content, input_snapshot, model, prompt_version, input_tokens, output_tokens, created_at'

function toCoachWeekAnalysis(row: RawWeekAnalysisRow): CoachWeekAnalysis {
  return {
    id: row.id,
    userId: row.user_id,
    weekStart: row.week_start,
    content: row.content,
    inputSnapshot: row.input_snapshot,
    model: row.model,
    promptVersion: row.prompt_version,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: row.created_at,
  }
}

export async function fetchCoachWeekAnalysisDetail(id: string, userId: string): Promise<CoachWeekAnalysis> {
  const { data, error } = await supabase
    .from('v2_coach_week_analyses')
    .select(WEEK_ANALYSIS_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return toCoachWeekAnalysis(data as unknown as RawWeekAnalysisRow)
}

// ─── Generate — POST to the serverless function (step 7) ──────────────────────
//
// The client sends only { weekStart } (TASKS §1.3 — the function re-derives
// completeness and assembles the payload itself server-side).
// api/coach/analyze-week.ts's response body is already the camelCase
// CoachWeekAnalysis shape, so no row-mapping is needed on this side —
// only on the direct-Supabase-read paths above.

export async function analyzeWeek(weekStart: string): Promise<CoachWeekAnalysis> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/api/coach/analyze-week', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ weekStart }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? 'Analysis failed')
  return body as CoachWeekAnalysis
}
