import { format } from 'date-fns'
import { supabase } from '../../lib/supabase'
import type { FinishedRunCounts, Mesocycle, MesocycleStatus, ProgramKind, WeeklySchedule } from '../../types'

type DbMesoProgram = { id: string; name: string }

type DbMeso = {
  id: string
  user_id: string
  name: string
  program_id: string
  status: MesocycleStatus
  start_date: string
  end_date: string | null
  created_at: string
  v2_programs: DbMesoProgram | null
  source_program_id?: string | null  // absent until migration 027
}

function toMesocycle(row: DbMeso): Mesocycle {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    programId: row.program_id,
    program: row.v2_programs
      ? {
          id: row.v2_programs.id,
          name: row.v2_programs.name,
          userId: row.user_id,
          schedule: {} as WeeklySchedule,
          workoutDays: [],
          createdAt: '',
          updatedAt: '',
          // Not selected by this row's embed (id, name only) — every run's
          // copy this list can show is 'run' by construction (program_id
          // always names the run's own copy from chunk 6 on), so this is a
          // safe, honest default rather than a fetched value.
          kind: 'run' as ProgramKind,
        }
      : undefined,
    status: row.status,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: row.created_at,
    sourceProgramId: row.source_program_id ?? null,
  }
}

export async function fetchMesos(): Promise<Mesocycle[]> {
  const { data, error } = await supabase
    .from('v2_mesocycles')
    .select('*, v2_programs!v2_mesocycles_program_id_fkey(id, name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data as DbMeso[]).map(toMesocycle)
}

// createMeso / completeAllActiveMesos (the old two-request start path) are
// retired as of chunk 6 — v2_start_run (runService.ts) replaces both in one
// atomic, race-safe call (TASKS.md; scratch R8). Removed rather than kept
// exported-but-unused: nothing else in the app called either.

export async function completeMeso(id: string): Promise<void> {
  const today = format(new Date(), 'yyyy-MM-dd')
  const { error } = await supabase
    .from('v2_mesocycles')
    .update({ status: 'completed', end_date: today })
    .eq('id', id)
  if (error) throw error
}

// ─── The full delete of a finished program (chunk 75; 1.2.1 item 8b; migration 048) ───────────────────────────────────────────────────────────────
// Both functions are `security invoker` and refuse by error code, which PostgREST hands back in `error.code` (read there, never from the message or
// the HTTP status: `P0002` not found / not the caller's answers 500, `OL003` not finished and `OL001` maintenance answer 400). Deleting needs a
// connection and is never queued (SPEC Rules 2): nothing here touches the sync queue.

type DbFinishedRunCounts = {
  weeks?: unknown
  sessions?: unknown
  logged_sets?: unknown
  coach_analyses?: unknown
  coach_notes?: unknown
}

// A count the text will print is a whole number or nothing: a row with a column missing (or a function that came back changed) must never
// read as "undefined sessions" in front of a DELETE that cannot be undone.
function countOf(value: unknown, column: string): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) throw new Error(`the count of ${column} is missing from the answer`)
  return n
}

/**
 * What a full delete of this finished program would remove: `rpc('v2_finished_run_counts', { p_mesocycle_id })`, one row (a `returns table`
 * function answers an array of rows). Read-only; the same refusals as the delete (`P0002`, `OL003`) reach the caller as the error.
 */
export async function fetchFinishedRunCounts(id: string): Promise<FinishedRunCounts> {
  const { data, error } = await supabase.rpc('v2_finished_run_counts', { p_mesocycle_id: id })
  if (error) throw error
  const row = (Array.isArray(data) ? data[0] : data) as DbFinishedRunCounts | null | undefined
  if (!row) throw new Error('no counts came back for this program')
  return {
    weeks: countOf(row.weeks, 'weeks'),
    sessions: countOf(row.sessions, 'sessions'),
    loggedSets: countOf(row.logged_sets, 'logged sets'),
    coachAnalyses: countOf(row.coach_analyses, 'Coach analyses'),
    coachNotes: countOf(row.coach_notes, 'Coach notes'),
  }
}

// The ids of the program's sessions, read with the counts and before the delete, because the delete takes the sessions: the phone drops the queued
// writes that name each of them once the request has gone through (`useDeleteFinishedRun`). Paged (ordered, `.range()` until a short page) under
// PostgREST's row cap, as every history read is (Checks that lied #31): a program's sessions are bounded in practice, but a cap met silently would
// leave the later sessions' queued writes refused for ever.
const SESSION_ID_PAGE = 500

export async function fetchFinishedRunSessionIds(id: string): Promise<string[]> {
  const ids: string[] = []
  for (let from = 0; ; from += SESSION_ID_PAGE) {
    const { data, error } = await supabase
      .from('v2_sessions')
      .select('id')
      .eq('mesocycle_id', id)
      .order('id')
      .range(from, from + SESSION_ID_PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as Array<{ id: string }>
    for (const row of rows) ids.push(row.id)
    if (rows.length < SESSION_ID_PAGE) break
  }
  return ids
}

/**
 * DELETE a finished program whole: `rpc('v2_delete_finished_run', { p_mesocycle_id })` and nothing else (DECISIONS 249 rows 1-15 and 22). One
 * transaction in the database; it is refused unless the program is the caller's own and finished, and the refusal is the database's, rethrown
 * as it came so the confirmation can say the real reason.
 */
export async function deleteFinishedRun(id: string): Promise<void> {
  const { error } = await supabase.rpc('v2_delete_finished_run', { p_mesocycle_id: id })
  if (error) throw error
}
