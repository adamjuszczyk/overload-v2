import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { COACH_CURATION_SYSTEM_PROMPT, CURATION_PROMPT_VERSION } from './coachCurationPrompt.js'
import { planCurationApply, runCurationSteps } from './curationApply.js'
import type {
  CurationInput,
  CurationNoteInput,
  CurationMemoryInput,
  CurationDecision,
  CurationRawDecision,
  CurationApplied,
  CurationResult,
} from '../../types/index.js'

// The curation flow itself (COACH-PERSONALIZATION-TASKS.md §5.3), extracted
// out of api/coach/curate-memory.ts so it has two callers instead of one:
// that endpoint (still independently reachable — useful on its own for
// direct verification, the same "hit the deployed endpoint with a real
// token" technique this project has used for every prior live check) and
// api/coach/analyze.ts, which now runs curation automatically after a fresh
// analysis save (Coach Personalization Notes/Memory restructure — curation
// is no longer a separate manual click, it's the second half of the one
// ANALYZE action). Nothing about the flow itself changed in this move — same
// rate-limit guard, same zero-notes free exit, same validate-then-apply-
// deterministically shape, same accepted partial-failure ordering (memory
// writes -> audit row -> stamp notes, §5.3's ordering-fix comment in
// curationApply.ts's runCurationSteps still applies verbatim).
//
// Returns a typed outcome instead of writing an HTTP response directly, so
// each caller maps it to its own response shape: curate-memory.ts maps it to
// the exact status codes it always has; analyze.ts only logs it and never
// lets a curation failure change its own response — the analysis it already
// generated and saved is the thing the caller paid for and asked for, and
// curation riding along automatically must not be able to turn that into a
// failure.

export type CurationRunOutcome =
  | { kind: 'rate_limited' }
  | { kind: 'error'; status: number; error: string; applied?: CurationApplied }
  | { kind: 'success'; result: CurationResult }

const MODEL = 'claude-haiku-4-5-20251001'
const RATE_LIMIT_WINDOW_MS = 60_000

// The model returns one flat shape per decision, `id`/`body` required-but-
// nullable depending on `op` — Anthropic's structured output has no
// discriminated-union primitive the way TypeScript's CurationDecision does,
// so this is the closest strict-schema equivalent (same additionalProperties
// : false discipline as ANALYSIS_SCHEMA/WEEK_ANALYSIS_SCHEMA). toDecisions
// below reconciles a raw row against its own `op` before it becomes a real
// CurationDecision.
const CURATION_SCHEMA = {
  type: 'object',
  properties: {
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          op: { type: 'string', enum: ['add', 'update', 'expire'] },
          id: { type: ['string', 'null'] },
          body: { type: ['string', 'null'] },
          reason: { type: 'string' },
        },
        required: ['op', 'id', 'body', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['decisions'],
  additionalProperties: false,
}

// A row whose fields don't match its own `op` (e.g. `add` with a null body)
// is dropped here rather than surfaced as an error — the schema's
// required-but-nullable fields can't express "body required iff op is
// add/update" directly, so this is the one place that gap is closed. A
// dropped row is genuinely gone from `decisions` (the filtered, validated
// list passed to planCurationApply) — the raw, unfiltered list is what gets
// persisted for audit purposes; see types/index.ts's CoachCurationRun.decisions
// comment.
function toDecisions(raw: CurationRawDecision[]): CurationDecision[] {
  const decisions: CurationDecision[] = []
  for (const d of raw) {
    if (d.op === 'add' && d.body != null) {
      decisions.push({ op: 'add', body: d.body, reason: d.reason })
    } else if (d.op === 'update' && d.id != null && d.body != null) {
      decisions.push({ op: 'update', id: d.id, body: d.body, reason: d.reason })
    } else if (d.op === 'expire' && d.id != null) {
      decisions.push({ op: 'expire', id: d.id, reason: d.reason })
    }
  }
  return decisions
}

type NoteRow = { id: string; body: string; created_at: string; session_id: string | null }
type SessionRow = { id: string; date: string; workout_day_name: string | null }
type MemoryRow = { id: string; body: string; source: 'curation' | 'manual' }

// Mutates `applied` in place, one write at a time, rather than building
// local arrays and returning a fresh object only on full success — see
// api/coach/curate-memory.ts's git history / CONTEXT.md for the mocked
// failure-injection test that found the bug this shape fixes: a mid-loop
// write failure must still leave the caller's `applied` reflecting every
// write that really landed before the throw.
async function applyMemoryChanges(
  supabase: SupabaseClient,
  userId: string,
  plan: ReturnType<typeof planCurationApply>,
  applied: CurationApplied,
): Promise<void> {
  if (plan.toInsert.length > 0) {
    const { data, error } = await supabase
      .from('v2_coach_memory_entries')
      .insert(plan.toInsert.map((x) => ({ user_id: userId, body: x.body, source: 'curation' })))
      .select('id, body')
    if (error) throw error
    for (const row of data as { id: string; body: string }[]) {
      applied.added.push({ id: row.id, body: row.body })
    }
  }

  for (const u of plan.toUpdate) {
    const { error } = await supabase
      .from('v2_coach_memory_entries')
      .update({ body: u.body, updated_at: new Date().toISOString() })
      .eq('id', u.id)
      .eq('user_id', userId)
    if (error) throw error
    applied.updated.push({ id: u.id, body: u.body })
  }

  for (const x of plan.toExpire) {
    const { error } = await supabase
      .from('v2_coach_memory_entries')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('id', x.id)
      .eq('user_id', userId)
    if (error) throw error
    applied.expired.push({ id: x.id })
  }
}

export async function runCuration(supabase: SupabaseClient, userId: string): Promise<CurationRunOutcome> {
  // ── Rate-limit guard — not a lock, kills the one real failure mode most
  // relevant to the manual trigger this used to be exclusively (an impatient
  // double-tap paying twice, §5.3/§7.7). Kept as-is for the automatic
  // trigger too: it also throttles two Analyze clicks in quick succession
  // from running curation twice back to back for no reason. ────────────────
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { data: recentRun, error: recentRunError } = await supabase
    .from('v2_coach_curation_runs')
    .select('id')
    .eq('user_id', userId)
    .gte('created_at', windowStart)
    .limit(1)
    .maybeSingle()
  if (recentRunError) {
    return { kind: 'error', status: 500, error: 'Failed to check for a recent curation run' }
  }
  if (recentRun) {
    return { kind: 'rate_limited' }
  }

  // ── Uncurated notes, oldest first — the partial index
  // (v2_coach_notes_uncurated_idx, migration 017) serves this exactly. This
  // is also what keeps an automatic run from ever reprocessing a note: once
  // curated_at is stamped (last step below), no future run's `is('curated_at',
  // null)` read will see it again, whether the run was triggered manually
  // (the old button) or automatically (post-Analyze, now). ─────────────────
  const { data: noteRows, error: notesError } = await supabase
    .from('v2_coach_notes')
    .select('id, body, created_at, session_id')
    .eq('user_id', userId)
    .is('curated_at', null)
    .order('created_at', { ascending: true })
  if (notesError) {
    return { kind: 'error', status: 500, error: 'Failed to read uncurated notes' }
  }
  const notes = (noteRows ?? []) as NoteRow[]

  // ── Zero uncurated notes -> return early, never call the model. The only
  // genuinely free money guard this function has. ─────────────────────────
  if (notes.length === 0) {
    return {
      kind: 'success',
      result: { applied: { added: [], updated: [], expired: [] }, rejectedIds: [], notesCurated: 0 },
    }
  }

  // Session date/workout-day name for sidebar-sourced notes, so the model
  // can place a note in time.
  const sessionIds = [...new Set(notes.filter((n) => n.session_id).map((n) => n.session_id as string))]
  const sessionById = new Map<string, SessionRow>()
  if (sessionIds.length > 0) {
    const { data: sessionRows, error: sessionsError } = await supabase
      .from('v2_history_session_summary')
      .select('id, date, workout_day_name')
      .eq('user_id', userId)
      .in('id', sessionIds)
    if (sessionsError) {
      return { kind: 'error', status: 500, error: 'Failed to read session context for notes' }
    }
    for (const row of sessionRows as SessionRow[]) sessionById.set(row.id, row)
  }

  const noteInputs: CurationNoteInput[] = notes.map((n) => {
    const session = n.session_id ? sessionById.get(n.session_id) : undefined
    return {
      id: n.id,
      body: n.body,
      createdAt: n.created_at,
      session: session ? { date: session.date, workoutDayName: session.workout_day_name } : null,
    }
  })

  // ── Active memory, oldest first. ────────────────────────────────────────
  const { data: memoryRows, error: memoryError } = await supabase
    .from('v2_coach_memory_entries')
    .select('id, body, source')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
  if (memoryError) {
    return { kind: 'error', status: 500, error: 'Failed to read current memory' }
  }
  const memoryInputs: CurationMemoryInput[] = (memoryRows as MemoryRow[]).map((m) => ({
    id: m.id,
    body: m.body,
    source: m.source,
  }))

  const inputSnapshot: CurationInput = { notes: noteInputs, memory: memoryInputs }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { kind: 'error', status: 500, error: 'Server misconfigured: missing ANTHROPIC_API_KEY' }
  }
  const anthropic = new Anthropic({ apiKey })

  // ── One Anthropic call. ──────────────────────────────────────────────────
  let response
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: COACH_CURATION_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: CURATION_SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(inputSnapshot) }],
    })
  } catch (err) {
    console.error('Coach curation call failed', { userId, error: err })
    return { kind: 'error', status: 502, error: 'Curation generation failed' }
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    return { kind: 'error', status: 502, error: 'Model returned no text content' }
  }

  let rawDecisions: CurationRawDecision[]
  try {
    const parsed = JSON.parse(textBlock.text) as { decisions?: unknown }
    // The try/catch above only catches a JSON *syntax* error — syntactically
    // valid JSON shaped like `{}` or `{"decisions": null}` parses fine, and
    // reading `.decisions` off it never throws. Without this explicit check,
    // such a response would reach toDecisions()'s `for (const d of raw)`
    // below and throw an uncaught TypeError.
    if (!Array.isArray(parsed.decisions)) {
      throw new Error('decisions field missing or not an array')
    }
    rawDecisions = parsed.decisions as CurationRawDecision[]
  } catch {
    return { kind: 'error', status: 502, error: 'Model output was not valid JSON' }
  }

  // ── Validate, never trust the model. ─────────────────────────────────────
  const decisions = toDecisions(rawDecisions)
  const validMemoryIds = new Set(memoryInputs.map((m) => m.id))
  const plan = planCurationApply(decisions, validMemoryIds)

  // ── Apply, in the accepted-partial-failure order (§5.3/§7.7): memory
  // writes, then the audit row, then the notes stamp — see curationApply.ts's
  // runCurationSteps and api/coach/curate-memory.ts's own history for why
  // this exact order, not the reverse. `applied` is mutated in place by
  // applyMemoryChanges so a mid-loop failure still reflects every write that
  // really landed before the throw. ────────────────────────────────────────
  const applied: CurationApplied = { added: [], updated: [], expired: [] }
  const noteIds = notes.map((n) => n.id)
  const failure = await runCurationSteps([
    async () => { await applyMemoryChanges(supabase, userId, plan, applied) },
    async () => {
      const { error } = await supabase.from('v2_coach_curation_runs').insert({
        user_id: userId,
        input_snapshot: inputSnapshot,
        decisions: rawDecisions,
        applied,
        model: response!.model,
        prompt_version: CURATION_PROMPT_VERSION,
        input_tokens: response!.usage?.input_tokens ?? null,
        output_tokens: response!.usage?.output_tokens ?? null,
        note_count: notes.length,
      })
      if (error) throw error
    },
    async () => {
      const { error } = await supabase
        .from('v2_coach_notes')
        .update({ curated_at: new Date().toISOString() })
        .in('id', noteIds)
        .eq('user_id', userId)
      if (error) throw error
    },
  ])

  if (failure) {
    console.error('Coach curation partially failed', {
      userId,
      completedSteps: failure.completed,
      error: failure.error,
      applied,
    })
    return {
      kind: 'error',
      status: 500,
      error: 'Curation was generated but did not finish applying — some changes may already be saved',
      applied,
    }
  }

  return {
    kind: 'success',
    result: { applied, rejectedIds: plan.rejectedIds, notesCurated: notes.length },
  }
}
