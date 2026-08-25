import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { authorizeCoachRequest } from '../../src/features/coach/coachApiAuth.js'
import {
  COACH_CURATION_SYSTEM_PROMPT,
  CURATION_PROMPT_VERSION,
} from '../../src/features/coach/coachCurationPrompt.js'
import { planCurationApply, runCurationSteps } from '../../src/features/coach/curationApply.js'
import type {
  CurationInput,
  CurationNoteInput,
  CurationMemoryInput,
  CurationDecision,
  CurationRawDecision,
  CurationApplied,
  CurationResult,
} from '../../src/types/index.js'

// Vercel serverless function (COACH-PERSONALIZATION-TASKS.md §5.2-§5.3). A
// third Coach function, same reasoning as weekly §1.1 (analyze-week.ts):
// vercel.json's api/** block already covers it at maxDuration 60,
// tsconfig.api.json already includes api/, no config change needed.
//
// Unlike the other two AI surfaces, this one *mutates a standing store*
// instead of appending a permanent record — the model returns a decision
// list, this handler applies it deterministically (§2.8). No service-role
// key: same per-request, RLS-scoped client every other Coach function in
// this app uses.
//
// Flow, exactly per §5.3: authorize -> 60s rate-limit guard (a cheap kill
// for a double-tap, not a lock, §7.7) -> read uncurated notes (curated_at is
// null, oldest first) -> zero notes -> return an empty result and never call
// the model (the only genuinely free money guard here) -> read active
// memory -> one Anthropic call -> validate every id against what was
// actually sent (curationApply.ts's planCurationApply, never trusting the
// model, §2.8) -> apply deterministically, in an order that leaves every
// partial failure safe-ish in the same direction: memory writes, then notes
// stamped as consumed, then the audit row (curationApply.ts's
// runCurationSteps makes that ordering explicit and testable) -> return
// { applied, rejectedIds, notesCurated }.

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
// add/update" directly, so this is the one place that gap is closed. Note
// that a dropped row is genuinely gone from `decisions` (the filtered,
// validated list passed to planCurationApply) — it's the CALLER's job to
// persist `raw` itself, unfiltered, if that's needed for audit purposes; see
// types/index.ts's CoachCurationRun.decisions comment.
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
// local arrays and returning a fresh object only on full success. This
// matters specifically for the partial-failure path (§5.3/§7.7): if a write
// partway through this function throws (e.g. the second of three updates),
// the caller's `applied` binding must still reflect the writes that already
// landed in the database before the throw — a local-array-then-return shape
// would lose that partial progress entirely, since the function would never
// reach its `return`, and the caller's `applied` variable would remain
// whatever it was initialised to. Confirmed live as a real bug via a mocked
// failure-injection test during this session's adversarial review (a
// mid-loop update failure produced a 500 response whose `applied.updated`
// was empty despite an earlier update in the same loop having actually
// succeeded) — fixed here rather than only in the reported symptom.
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authorizeCoachRequest(req, res)
  if (!auth) return
  const { supabase, userId } = auth

  // ── Step 2: rate-limit guard — not a lock, kills the one real failure
  // mode (an impatient double-tap paying twice), §5.3/§7.7. ────────────────
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
  const { data: recentRun, error: recentRunError } = await supabase
    .from('v2_coach_curation_runs')
    .select('id')
    .eq('user_id', userId)
    .gte('created_at', windowStart)
    .limit(1)
    .maybeSingle()
  if (recentRunError) {
    res.status(500).json({ error: 'Failed to check for a recent curation run' })
    return
  }
  if (recentRun) {
    res.status(409).json({ error: 'A curation run already happened in the last minute — wait before trying again' })
    return
  }

  // ── Step 3: uncurated notes, oldest first — the partial index
  // (v2_coach_notes_uncurated_idx, migration 017) serves this exactly. ────
  const { data: noteRows, error: notesError } = await supabase
    .from('v2_coach_notes')
    .select('id, body, created_at, session_id')
    .eq('user_id', userId)
    .is('curated_at', null)
    .order('created_at', { ascending: true })
  if (notesError) {
    res.status(500).json({ error: 'Failed to read uncurated notes' })
    return
  }
  const notes = (noteRows ?? []) as NoteRow[]

  // ── Step 4: zero uncurated notes -> return early, never call the model.
  // The only genuinely free money guard this function has. ───────────────
  if (notes.length === 0) {
    const empty: CurationResult = {
      applied: { added: [], updated: [], expired: [] },
      rejectedIds: [],
      notesCurated: 0,
    }
    res.status(200).json(empty)
    return
  }

  // Session date/workout-day name for sidebar-sourced notes, so the model
  // can place a note in time — same denormalised columns coachService.ts's
  // AnalyzableSession already reads from this view.
  const sessionIds = [...new Set(notes.filter((n) => n.session_id).map((n) => n.session_id as string))]
  const sessionById = new Map<string, SessionRow>()
  if (sessionIds.length > 0) {
    const { data: sessionRows, error: sessionsError } = await supabase
      .from('v2_history_session_summary')
      .select('id, date, workout_day_name')
      .eq('user_id', userId)
      .in('id', sessionIds)
    if (sessionsError) {
      res.status(500).json({ error: 'Failed to read session context for notes' })
      return
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

  // ── Step 5: active memory, oldest first. ────────────────────────────────
  const { data: memoryRows, error: memoryError } = await supabase
    .from('v2_coach_memory_entries')
    .select('id, body, source')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
  if (memoryError) {
    res.status(500).json({ error: 'Failed to read current memory' })
    return
  }
  const memoryInputs: CurationMemoryInput[] = (memoryRows as MemoryRow[]).map((m) => ({
    id: m.id,
    body: m.body,
    source: m.source,
  }))

  const inputSnapshot: CurationInput = { notes: noteInputs, memory: memoryInputs }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: missing ANTHROPIC_API_KEY' })
    return
  }
  const anthropic = new Anthropic({ apiKey })

  // ── Step 6: one Anthropic call. ──────────────────────────────────────────
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
    res.status(502).json({ error: 'Curation generation failed' })
    return
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    res.status(502).json({ error: 'Model returned no text content' })
    return
  }

  let rawDecisions: CurationRawDecision[]
  try {
    const parsed = JSON.parse(textBlock.text) as { decisions?: unknown }
    // The try/catch above only catches a JSON *syntax* error — syntactically
    // valid JSON shaped like `{}` or `{"decisions": null}` parses fine, and
    // reading `.decisions` off it never throws (plain property access on a
    // missing/mistyped key doesn't throw). Confirmed live during this
    // session's adversarial review that without this check, such a response
    // reaches toDecisions()'s `for (const d of raw)` below and throws an
    // uncaught TypeError past every try/catch in this handler — skipping the
    // clean 502 response and this file's own error-logging convention
    // entirely. additionalProperties:false + required:['decisions'] on
    // CURATION_SCHEMA make this unlikely under normal structured-output
    // behaviour, but it costs nothing to not trust that at runtime too.
    if (!Array.isArray(parsed.decisions)) {
      throw new Error('decisions field missing or not an array')
    }
    rawDecisions = parsed.decisions as CurationRawDecision[]
  } catch {
    res.status(502).json({ error: 'Model output was not valid JSON', generated: textBlock.text })
    return
  }

  // ── Step 7: validate, never trust the model. ─────────────────────────────
  const decisions = toDecisions(rawDecisions)
  const validMemoryIds = new Set(memoryInputs.map((m) => m.id))
  const plan = planCurationApply(decisions, validMemoryIds)

  // ── Steps 8-10, in the accepted-partial-failure order (§5.3/§7.7), with
  // one deliberate deviation from TASKS.md's original step order — see below.
  //
  // `applied` is mutated in place by applyMemoryChanges (see its own
  // comment) so a mid-loop failure still leaves this reflecting every write
  // that really landed before the throw, rather than staying at this
  // initial empty value.
  const applied: CurationApplied = { added: [], updated: [], expired: [] }
  const noteIds = notes.map((n) => n.id)
  const failure = await runCurationSteps([
    async () => { await applyMemoryChanges(supabase, userId, plan, applied) },
    // The audit-row insert now runs BEFORE the notes are stamped
    // curated_at — TASKS.md §5.3 originally ordered these the other way
    // round. Reordered after this session's adversarial review confirmed
    // (via a mocked failure-injection test against the real handler) a
    // strictly worse failure window in the original order: a crash between
    // stamping notes and inserting the run row leaves those notes
    // permanently unrecoverable (curated_at is already set, so no future
    // run's `curated_at is null` read will ever see them again) with zero
    // audit row ever explaining the memory change that already happened —
    // worse than the one failure window §7.7 explicitly accepts ("a crash
    // between applying decisions and stamping curated_at... may add a
    // duplicate entry [on retry], visible and correctable by hand"). In
    // this order, a crash between the audit-row insert and the notes-stamp
    // instead falls into that exact already-accepted class: the run row
    // (with accurate `applied`) already exists, and the notes stay
    // uncurated, so a retry just re-reads and re-applies them — a visible,
    // correctable redundancy, never a silent, permanent gap.
    async () => {
      const { error } = await supabase.from('v2_coach_curation_runs').insert({
        user_id: userId,
        input_snapshot: inputSnapshot,
        // The genuinely unfiltered model output — rawDecisions, not the
        // toDecisions()-filtered `decisions` — so a row toDecisions dropped
        // (op-specific field missing, e.g. an `update` with a null id)
        // still leaves a trace here instead of vanishing with no record
        // anywhere (fixed during this session's adversarial review; see
        // types/index.ts's CoachCurationRun.decisions comment).
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
    // §7.7 — accepted, not engineered away: no transaction across these
    // calls, so a crash here is a real possibility. Logged with exactly how
    // far it got, and the already-applied memory changes are returned
    // rather than discarded — a re-run re-reads the same still-uncurated
    // notes and may duplicate an entry, which is visible, editable, and
    // deletable by hand (SPEC §7's "visible and correctable, always").
    console.error('Coach curation partially failed', {
      userId,
      completedSteps: failure.completed,
      error: failure.error,
      applied,
    })
    res.status(500).json({
      error: 'Curation was generated but did not finish applying — some changes may already be saved',
      applied,
    })
    return
  }

  // ── Step 11. ──────────────────────────────────────────────────────────────
  const result: CurationResult = { applied, rejectedIds: plan.rejectedIds, notesCurated: notes.length }
  res.status(200).json(result)
}
