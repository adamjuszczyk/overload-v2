import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/useAuth'
import { fetchMesos } from '../programs/mesoService'
import type { CoachMesoAnalysis } from '../../types'

// Meso sub-tab (MESOCYCLE-ANALYSIS-TASKS.md §7 Phase 6 / §9) — data layer
// only, no separate service file: TASKS §9 names exactly three Phase 6
// files, and this feature's read surface is far smaller than Week's (a
// completed-meso filter, not weekResolution.ts's full completeness
// computation), so fetch + hooks fold into this one file rather than
// adding a fourth. Otherwise follows coachWeekService.ts/
// useCoachWeekAnalysis.ts's shape exactly: snake_case DB rows mapped to the
// camelCase CoachMesoAnalysis type, explicit .eq('user_id', userId)
// defence-in-depth alongside RLS on every direct query, and
// mesoService.ts's fetchMesos() reused as-is client-side (its
// browser-singleton import is exactly what's fine here — coachWeekService.ts's
// own header already establishes this for the identical reuse).

const ANALYZABLE_MESOS_KEY = ['v2_coachAnalyzableMesos']
const COACH_MESO_ANALYSES_KEY = ['v2_coachMesoAnalyses']

// ─── "To analyze" — completed mesos with no analysis row yet ───────────────────

export interface AnalyzableMeso {
  id: string
  name: string
  startDate: string
  endDate: string | null
}

async function fetchAnalyzableMesos(userId: string): Promise<AnalyzableMeso[]> {
  const [mesos, { data: analyzedRows, error }] = await Promise.all([
    fetchMesos(),
    supabase.from('v2_coach_meso_analyses').select('mesocycle_id').eq('user_id', userId),
  ])
  if (error) throw error

  // mesocycle_id is nullable (A6, on delete set null) — an orphaned
  // analysis's null can never match a real meso id, so it's filtered out
  // here rather than needing special-casing.
  const analyzedIds = new Set(
    (analyzedRows as { mesocycle_id: string | null }[])
      .map((r) => r.mesocycle_id)
      .filter((id): id is string => id != null),
  )
  return mesos
    .filter((m) => m.status === 'completed' && !analyzedIds.has(m.id))
    .map((m) => ({ id: m.id, name: m.name, startDate: m.startDate, endDate: m.endDate }))
}

export function useAnalyzableMesos() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ANALYZABLE_MESOS_KEY,
    queryFn: () => fetchAnalyzableMesos(user!.id),
    enabled: !!user,
  })
}

// ─── "Analyses" — the saved write-ups ──────────────────────────────────────────

export interface CoachMesoAnalysisListItem {
  id: string
  mesoName: string
  mesoStartDate: string
  mesoEndDate: string | null
  createdAt: string
  summary: string
}

type RawMesoAnalysisListRow = {
  id: string
  meso_name: string
  meso_start_date: string
  meso_end_date: string | null
  created_at: string
  summary: string
}

// Selects a narrow JSON path out of content (content->>summary) instead of
// the whole row — same reasoning as coachWeekService.ts's
// fetchCoachWeekAnalyses: the list only needs enough to render a row, and
// input_snapshot is several KB per row the list has no use for.
async function fetchCoachMesoAnalyses(userId: string): Promise<CoachMesoAnalysisListItem[]> {
  const { data, error } = await supabase
    .from('v2_coach_meso_analyses')
    .select('id, meso_name, meso_start_date, meso_end_date, created_at, summary:content->>summary')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
  if (error) throw error

  return (data as unknown as RawMesoAnalysisListRow[]).map((r) => ({
    id: r.id,
    mesoName: r.meso_name,
    mesoStartDate: r.meso_start_date,
    mesoEndDate: r.meso_end_date,
    createdAt: r.created_at,
    summary: r.summary,
  }))
}

export function useCoachMesoAnalyses() {
  const { user } = useAuth()
  return useQuery({
    queryKey: COACH_MESO_ANALYSES_KEY,
    queryFn: () => fetchCoachMesoAnalyses(user!.id),
    enabled: !!user,
  })
}

type RawMesoAnalysisRow = {
  id: string
  user_id: string
  mesocycle_id: string | null
  meso_name: string
  meso_start_date: string
  meso_end_date: string | null
  content: CoachMesoAnalysis['content']
  input_snapshot: CoachMesoAnalysis['inputSnapshot']
  model: string
  prompt_version: number
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

const MESO_ANALYSIS_COLUMNS =
  'id, user_id, mesocycle_id, meso_name, meso_start_date, meso_end_date, content, input_snapshot, model, prompt_version, input_tokens, output_tokens, created_at'

function toCoachMesoAnalysis(row: RawMesoAnalysisRow): CoachMesoAnalysis {
  return {
    id: row.id,
    userId: row.user_id,
    mesocycleId: row.mesocycle_id,
    mesoName: row.meso_name,
    mesoStartDate: row.meso_start_date,
    mesoEndDate: row.meso_end_date,
    content: row.content,
    inputSnapshot: row.input_snapshot,
    model: row.model,
    promptVersion: row.prompt_version,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    createdAt: row.created_at,
  }
}

async function fetchCoachMesoAnalysisDetail(id: string, userId: string): Promise<CoachMesoAnalysis> {
  const { data, error } = await supabase
    .from('v2_coach_meso_analyses')
    .select(MESO_ANALYSIS_COLUMNS)
    .eq('id', id)
    .eq('user_id', userId)
    .single()
  if (error) throw error
  return toCoachMesoAnalysis(data as unknown as RawMesoAnalysisRow)
}

export function useCoachMesoAnalysisDetail(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_coachMesoAnalysisDetail', id],
    queryFn: () => fetchCoachMesoAnalysisDetail(id!, user!.id),
    enabled: !!user && !!id,
  })
}

// ─── Generate — POST to the serverless function ────────────────────────────────
//
// The client sends only { mesocycleId } (§5.2 — the function re-derives
// completion and assembles the payload itself, server-side).
// api/coach/analyze-meso.ts's response body is already the camelCase
// CoachMesoAnalysis shape (its own toCoachMesoAnalysis), so no row-mapping
// is needed on this side — only on the direct-Supabase-read paths above.

async function analyzeMeso(mesocycleId: string): Promise<CoachMesoAnalysis> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')

  const res = await fetch('/api/coach/analyze-meso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ mesocycleId }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error((body as { error?: string })?.error ?? 'Analysis failed')
  return body as CoachMesoAnalysis
}

// A generation is the longest wait of any Coach analysis — up to 262.7s
// real, measured at Phase 5 (CONTEXT.md), against the 290s per-route
// maxDuration override (vercel.json). Callers key their in-flight UI off
// `variables` (the mesocycleId just passed to `mutate`) rather than
// separate local state, same convention useAnalyzeWeek/useAnalyzeSession use.
export function useAnalyzeMeso() {
  return useMutation({
    mutationFn: (mesocycleId: string) => analyzeMeso(mesocycleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ANALYZABLE_MESOS_KEY })
      queryClient.invalidateQueries({ queryKey: COACH_MESO_ANALYSES_KEY })
    },
  })
}
