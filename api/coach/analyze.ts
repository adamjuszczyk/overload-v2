import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { authorizeCoachRequest } from '../../src/features/coach/coachApiAuth.js'
import { assembleAnalysisInput } from '../../src/features/coach/analysisInput.js'
import { COACH_SYSTEM_PROMPT, PROMPT_VERSION } from '../../src/features/coach/coachPrompt.js'
import type { CoachAnalysisContent, CoachSessionAnalysis } from '../../src/types/index.js'

// Vercel serverless function (COACH-ANALYSIS-TASKS.md §4 step E). Single
// POST endpoint: verify the caller's Supabase JWT → check the server-side
// COACH_USER_ID gate (the authoritative one — coachGate.ts's client-side
// check is cosmetic only, see CONTEXT.md) → return any existing analysis for
// this session (idempotency, real money guard) → assemble the payload via
// step D's assembleAnalysisInput → call Haiku 4.5 with structured output →
// insert, persisting response.model (not the request constant, §1.6) and
// the full input_snapshot (§5.11) → return the row.
//
// No service-role key: this function builds a per-request Supabase client
// scoped to the caller's own access token, same as every RLS-scoped client
// elsewhere in this app — v2_coach_session_analyses' "own rows only" policy
// does the rest.

// Pinned snapshot, not the `claude-haiku-4-5` alias — `model` is stored per
// row (§1.6), so provenance matters. E1 (§4) measured this exact model at
// 14.2s wall-clock against the 60s maxDuration cap (vercel.json) — a
// comfortable margin, not a marginal one.
const MODEL = 'claude-haiku-4-5-20251001'

const ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    exercises: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          exerciseId: { type: 'string' },
          exerciseName: { type: 'string' },
          comment: { type: 'string' },
        },
        required: ['exerciseId', 'exerciseName', 'comment'],
        additionalProperties: false,
      },
    },
    overall: { type: 'string' },
  },
  required: ['exercises', 'overall'],
  additionalProperties: false,
}

type CoachSessionAnalysisRow = {
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

function toCoachSessionAnalysis(row: CoachSessionAnalysisRow): CoachSessionAnalysis {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authorizeCoachRequest(req, res)
  if (!auth) return
  const { supabase, userId } = auth

  const sessionId = req.body?.sessionId
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    res.status(400).json({ error: 'sessionId is required' })
    return
  }

  const { data: existingRow, error: existingError } = await supabase
    .from('v2_coach_session_analyses')
    .select('*')
    .eq('session_id', sessionId)
    // Defence-in-depth alongside RLS, matching every query in
    // analysisInput.ts — currently redundant (RLS plus the COACH_USER_ID
    // gate above already make session_id alone safe), but an adversarial
    // review flagged this as the one place in the function relying on RLS
    // alone rather than also filtering explicitly.
    .eq('user_id', userId)
    .maybeSingle()
  if (existingError) {
    res.status(500).json({ error: 'Failed to check for an existing analysis' })
    return
  }
  if (existingRow) {
    res.status(200).json(toCoachSessionAnalysis(existingRow as CoachSessionAnalysisRow))
    return
  }

  let inputSnapshot
  try {
    inputSnapshot = await assembleAnalysisInput(supabase, userId, sessionId)
  } catch (err) {
    res.status(500).json({ error: 'Failed to assemble analysis input', detail: String(err) })
    return
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    res.status(500).json({ error: 'Server misconfigured: missing ANTHROPIC_API_KEY' })
    return
  }
  const anthropic = new Anthropic({ apiKey })

  let response
  try {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: COACH_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(inputSnapshot) }],
    })
  } catch (err) {
    // Anthropic SDK errors embed the full upstream status/body in their
    // message (unlike a Postgrest error object, whose String() is inert) —
    // logged server-side only, not echoed to the client, same treatment as
    // the insert-failure path below.
    console.error('Coach analysis generation call failed', { sessionId, userId, error: err })
    res.status(502).json({ error: 'Analysis generation failed' })
    return
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    res.status(502).json({ error: 'Model returned no text content' })
    return
  }

  let content: CoachAnalysisContent
  try {
    content = JSON.parse(textBlock.text) as CoachAnalysisContent
  } catch {
    res.status(502).json({ error: 'Model output was not valid JSON', generated: textBlock.text })
    return
  }

  const { data: insertedRow, error: insertError } = await supabase
    .from('v2_coach_session_analyses')
    .insert({
      user_id: userId,
      session_id: sessionId,
      content,
      input_snapshot: inputSnapshot,
      model: response.model,
      prompt_version: PROMPT_VERSION,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    })
    .select('*')
    .single()

  if (insertError) {
    // 23505 = unique_violation on v2_coach_analyses_session_uk — a
    // concurrent request already inserted this session's row. Race-safe
    // idempotency: return the row that won rather than erroring.
    if (insertError.code === '23505') {
      const { data: raceRow, error: raceError } = await supabase
        .from('v2_coach_session_analyses')
        .select('*')
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .single()
      if (!raceError && raceRow) {
        res.status(200).json(toCoachSessionAnalysis(raceRow as CoachSessionAnalysisRow))
        return
      }
    }

    // §5.12 — a paid-but-unsaved generation is an accepted risk outside a
    // hard maxDuration kill. Return the generated content in the error
    // response rather than discarding it, and log it server-side.
    console.error('Coach analysis insert failed after a successful generation', {
      sessionId,
      userId,
      error: insertError,
      content,
    })
    res.status(500).json({
      error: 'Analysis was generated but failed to save',
      generated: content,
    })
    return
  }

  res.status(200).json(toCoachSessionAnalysis(insertedRow as CoachSessionAnalysisRow))
}
