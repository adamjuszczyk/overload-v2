import type { VercelRequest, VercelResponse } from '@vercel/node'
import type { SupabaseClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { authorizeCoachRequest } from '../../src/features/coach/coachApiAuth.js'
import { resolveQaRoute } from '../../src/features/coach/qaCategory.js'
import { buildQaSystemPrompt, QA_PROMPT_VERSION } from '../../src/features/coach/coachQaPrompt.js'
import {
  hasReachedTurnLimit,
  nextTurnIndex,
  checkInvariance,
  buildHistoryMessages,
  HISTORY_TURN_CAP,
  MAX_TURNS_PER_CONVERSATION,
} from '../../src/features/coach/qaHistory.js'
import type { QaHistoryRow } from '../../src/features/coach/qaHistory.js'
import {
  assembleInSessionContext,
  assembleGeneralContext,
  assemblePlanningContext,
  assembleAppMechanicsContext,
} from '../../src/features/coach/qaContext.js'
import type { QaContext } from '../../src/features/coach/qaContext.js'
import type { QaCategory, QaAskRequest, CoachQaExchange } from '../../src/types/index.js'

// Vercel serverless function (QA-SIDEBAR-TASKS.md §5). Single POST endpoint:
// shared auth/gate (coachApiAuth.ts, §5.2) → validate the request, never
// trusting the client (§5.3) → check the turn ceiling and conversation
// invariance from the real history window (§5.5 item 4, §7.1, §6.2) →
// assemble context via Phase 3's four assemblers (§4) → call the routed
// model with structured output → check stop_reason before ever parsing or
// saving (§5.7 — this endpoint's own bar, not inherited from analyze.ts/
// analyze-week.ts, which don't check it) → insert, persisting
// response.model (not the request constant) and the full context snapshot
// → return the row.
//
// No service-role key: this function builds a per-request Supabase client
// scoped to the caller's own access token (coachApiAuth.ts), same as every
// other Coach endpoint — v2_coach_qa_exchanges' own-rows-only policies do
// the rest. Idempotency here is deliberately NOT analyze.ts's model (§5.5):
// asking the same question twice is legitimate, so spend is guarded in
// layers instead of by a unique-row constraint.

const ANSWER_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string' } },
  required: ['answer'],
  additionalProperties: false,
}

const MAX_QUESTION_CHARS = 2000
const VALID_CATEGORIES: readonly QaCategory[] = ['in_session', 'general', 'planning', 'app_mechanics']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

type CoachQaExchangeRow = {
  id: string
  user_id: string
  conversation_id: string
  turn_index: number
  category: QaCategory
  question: string
  answer: string
  context_snapshot: QaContext
  session_id: string | null
  model: string
  prompt_version: number
  input_tokens: number | null
  output_tokens: number | null
  history_turns_sent: number
  created_at: string
}

function toCoachQaExchange(row: CoachQaExchangeRow): CoachQaExchange {
  return {
    id: row.id,
    userId: row.user_id,
    conversationId: row.conversation_id,
    turnIndex: row.turn_index,
    category: row.category,
    question: row.question,
    answer: row.answer,
    contextSnapshot: row.context_snapshot,
    sessionId: row.session_id,
    model: row.model,
    promptVersion: row.prompt_version,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    historyTurnsSent: row.history_turns_sent,
    createdAt: row.created_at,
  }
}

// §5.3 step 6 — a stale client value must not silently steer the answer at
// another exercise. "Known to this session" means either already logged
// (v2_set_logs) or present in this session's own plan
// (v2_week_plan_sets → v2_program_exercises.exercise_id, the same two-hop
// join qaContext.ts's fetchPlannedSetSummaries uses — CONTEXT.md's Phase 0
// finding, not the naive direct one).
async function isKnownExerciseForSession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  weekPlanId: string | null,
  exerciseId: string,
): Promise<boolean> {
  const { data: logRows, error: logError } = await supabase
    .from('v2_set_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('session_id', sessionId)
    .eq('exercise_id', exerciseId)
    .limit(1)
  if (logError) throw logError
  if (logRows && logRows.length > 0) return true

  if (!weekPlanId) return false
  const { data: planRows, error: planError } = await supabase
    .from('v2_week_plan_sets')
    .select('v2_program_exercises(exercise_id)')
    .eq('user_id', userId)
    .eq('week_plan_id', weekPlanId)
  if (planError) throw planError
  const rows = planRows as unknown as { v2_program_exercises: { exercise_id: string } | null }[]
  return rows.some((r) => r.v2_program_exercises?.exercise_id === exerciseId)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authorizeCoachRequest(req, res)
  if (!auth) return
  const { supabase, userId } = auth

  const body = req.body as Partial<QaAskRequest> | undefined

  // ── §5.3 — request validation, in order, never trusting the client ────────

  // Step 1: id / conversationId
  if (!isUuidLike(body?.id) || !isUuidLike(body?.conversationId)) {
    res.status(400).json({ error: 'id and conversationId must be uuid strings' })
    return
  }
  const id = body!.id as string
  const conversationId = body!.conversationId as string

  // Step 2: category
  if (typeof body?.category !== 'string' || !VALID_CATEGORIES.includes(body.category as QaCategory)) {
    res.status(400).json({ error: 'category must be one of in_session, general, planning, app_mechanics' })
    return
  }
  const category = body.category as QaCategory

  // Step 3: question
  const question = typeof body.question === 'string' ? body.question.trim() : ''
  if (question.length === 0) {
    res.status(400).json({ error: 'question is required' })
    return
  }
  if (question.length > MAX_QUESTION_CHARS) {
    res.status(400).json({ error: `question must be ${MAX_QUESTION_CHARS} characters or fewer` })
    return
  }

  // Step 4: sessionId non-null exactly when category === 'in_session'
  const sessionIdInput = body.sessionId ?? null
  if (category === 'in_session' && (typeof sessionIdInput !== 'string' || sessionIdInput.length === 0)) {
    res.status(400).json({ error: 'sessionId is required for category in_session' })
    return
  }
  if (category !== 'in_session' && sessionIdInput !== null) {
    res.status(400).json({ error: 'sessionId must be null for this category' })
    return
  }
  const sessionId: string | null = category === 'in_session' ? (sessionIdInput as string) : null

  // Step 5: for in_session, the session must exist and belong to this user —
  // before anything else happens, including spend.
  let weekPlanId: string | null = null
  if (sessionId) {
    const { data: sessionRow, error: sessionError } = await supabase
      .from('v2_sessions')
      .select('week_plan_id')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .maybeSingle()
    if (sessionError) {
      res.status(500).json({ error: 'Failed to verify session' })
      return
    }
    if (!sessionRow) {
      res.status(404).json({ error: 'Session not found' })
      return
    }
    weekPlanId = (sessionRow as { week_plan_id: string | null }).week_plan_id
  }

  // Step 6: currentExerciseId, when present, must be known to this session.
  const currentExerciseIdInput = body.currentExerciseId ?? null
  if (currentExerciseIdInput !== null && typeof currentExerciseIdInput !== 'string') {
    res.status(400).json({ error: 'currentExerciseId must be a string or null' })
    return
  }
  let currentExerciseId: string | null = null
  if (currentExerciseIdInput) {
    if (!sessionId) {
      res.status(400).json({ error: 'currentExerciseId requires category in_session' })
      return
    }
    let known: boolean
    try {
      known = await isKnownExerciseForSession(supabase, userId, sessionId, weekPlanId, currentExerciseIdInput)
    } catch (err) {
      res.status(500).json({ error: 'Failed to verify currentExerciseId', detail: String(err) })
      return
    }
    if (!known) {
      res.status(400).json({ error: 'currentExerciseId is not part of this session' })
      return
    }
    currentExerciseId = currentExerciseIdInput
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: missing ANTHROPIC_API_KEY' })
    return
  }

  // ── History window, turn ceiling, invariance (§6.2, §5.5 item 4, §7.1) ────
  // One query does all three jobs (qaHistory.ts's own header) — the newest
  // row is always present in this capped, descending-ordered fetch, which is
  // all nextTurnIndex/hasReachedTurnLimit/checkInvariance actually need.
  const { data: historyData, error: historyError } = await supabase
    .from('v2_coach_qa_exchanges')
    .select('turn_index, category, session_id, question, answer')
    .eq('user_id', userId)
    .eq('conversation_id', conversationId)
    .order('turn_index', { ascending: false })
    .limit(HISTORY_TURN_CAP)
  if (historyError) {
    res.status(500).json({ error: 'Failed to read conversation history' })
    return
  }
  const historyRows: QaHistoryRow[] = (
    historyData as { turn_index: number; category: string; session_id: string | null; question: string; answer: string }[]
  ).map((r) => ({
    turnIndex: r.turn_index,
    category: r.category as QaCategory,
    sessionId: r.session_id,
    question: r.question,
    answer: r.answer,
  }))

  if (hasReachedTurnLimit(historyRows)) {
    res.status(409).json({ error: 'This conversation has reached its turn limit', maxTurns: MAX_TURNS_PER_CONVERSATION })
    return
  }

  const violation = checkInvariance(historyRows, { category, sessionId })
  if (violation) {
    res.status(409).json({
      error: 'Category and session cannot change within one conversation — start a new conversation instead',
      field: violation.field,
      expected: violation.expected,
      actual: violation.actual,
    })
    return
  }

  const turnIndex = nextTurnIndex(historyRows)
  const historyMessages = buildHistoryMessages(historyRows)

  // ── Context assembly (§4) — the last point a wrong payload is free ────────
  let context: QaContext
  try {
    if (category === 'in_session') {
      const payload = await assembleInSessionContext(supabase, userId, sessionId as string, currentExerciseId)
      context = { kind: 'in_session', payload }
    } else if (category === 'general') {
      const payload = await assembleGeneralContext(supabase, userId)
      context = { kind: 'general', payload }
    } else if (category === 'planning') {
      const payload = await assemblePlanningContext(supabase, userId)
      context = { kind: 'planning', payload }
    } else {
      context = { kind: 'app_mechanics', payload: assembleAppMechanicsContext() }
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to assemble context', detail: String(err) })
    return
  }

  const route = resolveQaRoute(category)
  const anthropic = new Anthropic({ apiKey })
  const systemPrompt = buildQaSystemPrompt(category)
  const userContent = JSON.stringify({ context, question })
  const messages: Anthropic.MessageParam[] = [
    ...historyMessages,
    { role: 'user' as const, content: userContent },
  ]

  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: route.model,
      max_tokens: route.maxTokens,
      system: systemPrompt,
      // Sonnet 5 gets effort alongside the structured-output format in the
      // same output_config object; Haiku 4.5 rejects effort outright with a
      // real 400 (§5.4), so it's omitted entirely rather than sent as
      // undefined.
      output_config: route.effort
        ? { effort: route.effort, format: { type: 'json_schema', schema: ANSWER_SCHEMA } }
        : { format: { type: 'json_schema', schema: ANSWER_SCHEMA } },
      messages,
    })
  } catch (err) {
    // Anthropic SDK errors embed the full upstream status/body in their
    // message — logged server-side only, not echoed to the client, same
    // treatment as every other Coach endpoint.
    console.error('Coach Q&A generation call failed', { conversationId, category, userId, error: err })
    res.status(502).json({ error: 'Answer generation failed' })
    return
  }

  // ── stop_reason checked before anything is parsed or saved (§5.7) — this
  // endpoint's own bar, not inherited from the pre-existing gap flagged in
  // analyze.ts/analyze-week.ts (CONTEXT.md, TASKS §10 A13). A truncated or
  // refused generation is not an answer, and this table has no update path
  // to repair one later. ──────────────────────────────────────────────────
  if (response.stop_reason === 'max_tokens') {
    console.error('Coach Q&A generation truncated by max_tokens — not saved', {
      conversationId,
      category,
      userId,
      model: response.model,
    })
    res.status(502).json({ error: 'The answer was cut off before it finished generating — not saved' })
    return
  }
  if (response.stop_reason === 'refusal') {
    console.error('Coach Q&A generation refused', {
      conversationId,
      category,
      userId,
      stopDetails: response.stop_details,
    })
    res.status(502).json({
      error: 'The model declined to answer this question',
      category: response.stop_details?.category ?? null,
    })
    return
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    res.status(502).json({ error: 'Model returned no text content' })
    return
  }

  let answer: string
  try {
    const parsed = JSON.parse(textBlock.text) as { answer?: unknown }
    if (typeof parsed.answer !== 'string') throw new Error('answer field missing or not a string')
    answer = parsed.answer
  } catch {
    res.status(502).json({ error: 'Model output was not valid JSON', generated: textBlock.text })
    return
  }

  // ── Insert (§5.5, §5.7) ────────────────────────────────────────────────────
  const { data: insertedRow, error: insertError } = await supabase
    .from('v2_coach_qa_exchanges')
    .insert({
      id,
      user_id: userId,
      conversation_id: conversationId,
      turn_index: turnIndex,
      category,
      question,
      answer,
      context_snapshot: context,
      session_id: sessionId,
      model: response.model,
      prompt_version: QA_PROMPT_VERSION,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
      // Each historical turn contributes one user + one assistant message —
      // the exact number actually resent this call, not merely the cap.
      history_turns_sent: historyMessages.length / 2,
    })
    .select('*')
    .single()

  if (insertError) {
    if (insertError.code === '23505') {
      // Two distinct unique constraints on this table (migration 023) mean
      // two distinct causes, distinguished by name, not assumed from a bare
      // 23505 the way analyze.ts can (that table has only one).
      if (insertError.message?.includes('_pkey')) {
        // §5.5 layer 2 — a retried POST with the same caller-supplied id.
        // Race-safe idempotency: return the row that already exists.
        const { data: existingRow, error: existingError } = await supabase
          .from('v2_coach_qa_exchanges')
          .select('*')
          .eq('id', id)
          .eq('user_id', userId)
          .maybeSingle()
        if (!existingError && existingRow) {
          res.status(200).json(toCoachQaExchange(existingRow as CoachQaExchangeRow))
          return
        }
        console.error('Coach Q&A: id-collision re-select failed after a real insert conflict', {
          id,
          userId,
          existingError,
        })
        res.status(500).json({
          error: 'This exchange was already saved, but re-fetching it failed — reload and check the conversation',
        })
        return
      }

      // §5.5 layer 3 — a concurrent send in the same conversation won the
      // race for this turn_index. The generation already cost money;
      // returned rather than silently discarded (daily §5.12's accepted-
      // risk treatment, same reasoning here).
      console.error('Coach Q&A: turn_index race lost — generated answer not saved', {
        conversationId,
        category,
        userId,
        turnIndex,
        error: insertError,
      })
      res.status(500).json({
        error: 'Another message in this conversation was sent at the same time and won this turn — not saved',
        generated: answer,
      })
      return
    }

    console.error('Coach Q&A insert failed after a successful generation', {
      conversationId,
      category,
      userId,
      error: insertError,
    })
    res.status(500).json({ error: 'Answer was generated but failed to save', generated: answer })
    return
  }

  res.status(200).json(toCoachQaExchange(insertedRow as CoachQaExchangeRow))
}
