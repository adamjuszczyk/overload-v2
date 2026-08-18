import { supabase } from '../../lib/supabase'
import type { CoachAnalysisContent, CoachSessionAnalysis } from '../../types'

// Analysis list/detail reads plus the POST to api/coach/analyze.ts
// (COACH-ANALYSIS-TASKS.md §4 step F), following historyService.ts's shape:
// snake_case DB row types kept separate from the camelCase public interface,
// explicit .eq('user_id', userId) defence-in-depth alongside RLS.

// The real ship-date cutoff (COACH-ANALYSIS-TASKS.md §5.9 — "sessions
// finished after this ships, no historical backlog"), set at step G.
// Midnight, Monday 2026-08-17, Poland local time (CEST, UTC+2). 2026-08-17
// is confirmed a Monday via this app's own standing convention —
// startOfWeek(parseISO('2026-08-17'), { weekStartsOn: 1 }) returns
// 2026-08-17 unchanged, the same tool/pattern weightLogic.ts's weekKey()
// uses — rather than assumed by hand. The UTC instant below
// (2026-08-17T00:00:00+02:00) was computed by the JS Date parser itself,
// not hand-converted, to rule out an off-by-timezone slip.
export const COACH_ANALYSIS_START_DATE = '2026-08-16T22:00:00.000Z'

// ─── "To analyze" — completed sessions since the cutoff, no analysis row ──────

export interface AnalyzableSession {
  id: string
  date: string
  completedAt: string | null
  workoutDayName: string | null
  mesocycleName: string | null
  setCount: number
}

type RawSummaryRow = {
  id: string
  date: string
  completed_at: string | null
  workout_day_name: string | null
  mesocycle_name: string | null
  set_count: number
}

// Two queries, diffed client-side (TASKS §4 step F: "read from
// v2_history_session_summary diffed against the analysis-ids query") —
// PostgREST has no anti-join across two unrelated tables without a view,
// and a fourth database object just for this diff isn't worth it at this
// feature's volume (SPEC §8's minimal-footprint principle).
export async function fetchAnalyzableSessions(userId: string): Promise<AnalyzableSession[]> {
  const [{ data: sessionRows, error: sessionError }, { data: analyzedRows, error: analyzedError }] =
    await Promise.all([
      supabase
        .from('v2_history_session_summary')
        .select('id, date, completed_at, workout_day_name, mesocycle_name, set_count')
        .eq('user_id', userId)
        .eq('status', 'completed')
        .gte('completed_at', COACH_ANALYSIS_START_DATE)
        .order('completed_at', { ascending: false }),
      supabase.from('v2_coach_session_analyses').select('session_id').eq('user_id', userId),
    ])
  if (sessionError) throw sessionError
  if (analyzedError) throw analyzedError

  const analyzedIds = new Set((analyzedRows as { session_id: string }[]).map((r) => r.session_id))

  return (sessionRows as RawSummaryRow[])
    .filter((r) => !analyzedIds.has(r.id))
    .map((r) => ({
      id: r.id,
      date: r.date,
      completedAt: r.completed_at,
      workoutDayName: r.workout_day_name,
      mesocycleName: r.mesocycle_name,
      setCount: r.set_count,
    }))
}

// ─── "Analyses" — the saved write-ups ──────────────────────────────────────────

export interface CoachAnalysisListItem {
  id: string
  sessionId: string
  createdAt: string
  overall: string
  sessionDate: string | null
  workoutDayName: string | null
}

type RawAnalysisListRow = {
  id: string
  session_id: string
  created_at: string
  overall: string
  session: { date: string; workoutDayName: string | null } | null
}

// Selects a narrow JSON path out of input_snapshot (session:input_snapshot->session)
// instead of the whole snapshot — the list only needs date/workoutDayName to
// render a row, and input_snapshot is several KB of match data per row that
// the list has no use for. The detail fetch below pulls the full row.
export async function fetchCoachAnalyses(userId: string): Promise<CoachAnalysisListItem[]> {
  const { data, error } = await supabase
    .from('v2_coach_session_analyses')
    .select('id, session_id, created_at, overall:content->>overall, session:input_snapshot->session')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data as unknown as RawAnalysisListRow[]).map((r) => ({
    id: r.id,
    sessionId: r.session_id,
    createdAt: r.created_at,
    overall: r.overall,
    sessionDate: r.session?.date ?? null,
    workoutDayName: r.session?.workoutDayName ?? null,
  }))
}

type RawAnalysisRow = {
  id: string
  user_id: string
  session_id: string
  content: CoachAnalysisContent
  input_snapshot: CoachSessionAnalysis['inputSnapshot']
  model: string
  prompt_version: number
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

const ANALYSIS_COLUMNS =
  'id, user_id, session_id, content, input_snapshot, model, prompt_version, input_tokens, output_tokens, created_at'

function toCoachSessionAnalysis(row: RawAnalysisRow): CoachSessionAnalysis {
  return {
    id: row.id,
    userId: row.user_id,
    sessionId: row.session_id,
    content: row.content,
    inputSnapshot: row.input_snapshot,
    model: row.model,
    promptVersion: row.prompt_version,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: row.created_at,
  }
}

export async function fetchCoachAnalysisDetail(id: string, userId: string): Promise<CoachSessionAnalysis> {
  const { data, error } = await supabase
    .from('v2_coach_session_analyses')
    .select(ANALYSIS_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return toCoachSessionAnalysis(data as unknown as RawAnalysisRow)
}

// ─── Generate — POST to the serverless function (step E) ──────────────────────
//
// The client sends only { sessionId } (TASKS §1.5 — the function assembles
// the payload itself server-side). api/coach/analyze.ts's response body is
// already the camelCase CoachSessionAnalysis shape (it builds it with its
// own toCoachSessionAnalysis before returning), so no row-mapping is needed
// on this side — only on the direct-Supabase-read paths above.

export async function analyzeSession(sessionId: string): Promise<CoachSessionAnalysis> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/api/coach/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ sessionId }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? 'Analysis failed')
  return body as CoachSessionAnalysis
}
