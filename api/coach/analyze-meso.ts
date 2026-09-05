import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { authorizeCoachRequest } from '../../src/features/coach/coachApiAuth.js'
import { assembleMesoAnalysisInput } from '../../src/features/coach/mesoAnalysisInput.js'
import { COACH_MESO_SYSTEM_PROMPT, MESO_PROMPT_VERSION, buildMesoPromptPayload } from '../../src/features/coach/coachMesoPrompt.js'
import type { CoachMesoAnalysisContent, CoachMesoAnalysis } from '../../src/types/index.js'

// Vercel serverless function (MESOCYCLE-ANALYSIS-TASKS.md §5). Mirrors
// analyze-week.ts's structure with ask.ts's stop_reason bar (§5.4) — this
// table has no update path, and a wrong row here costs months, not a day or
// a week (SPEC §5), so the bar is the highest of any Coach endpoint.
//
// Single POST endpoint: shared auth/gate (coachApiAuth.ts, §5.1) → validate
// mesocycleId (§5.2 step 1) → return any existing row for this mesocycle
// (idempotency — the unique index makes regeneration structurally
// impossible while the meso exists, §4.2) → re-derive completion
// server-side, never trusted from the client (§5.2 step 3) → assemble via
// mesoAnalysisInput.ts's assembleMesoAnalysisInput → shape the actual model
// payload via coachMesoPrompt.ts's buildMesoPromptPayload → call Sonnet 5
// with structured output (§5.3) → check stop_reason before ever parsing or
// saving (§5.4) → re-check completion immediately before insert (§5.2 step
// 8) → insert, persisting response.model (not the request constant), the
// exact payload the model saw, and both token counts → return the row.
//
// No service-role key: same per-request, RLS-scoped client every other
// Coach function in this app uses — v2_coach_meso_analyses' own-rows-only
// policy (migration 026) does the rest.
//
// §5.2 steps 4 and 5 collapse into one call here, not two: TASKS.md
// describes "assemble" and "fetchPriorityContext, folded into the payload"
// as separate steps, but Phase 2's real assembleMesoAnalysisInput already
// calls fetchPriorityContext itself as part of its own Promise.all
// (mesoAnalysisInput.ts) — priority arrives already folded into `input`,
// so calling it again here would be a second, redundant query against the
// same mesocycle id, not a second source of truth.

// Sonnet 5's own complete id (TASKS §5.3 point 3) — it takes no date
// suffix, unlike the pinned Haiku snapshot analyze-week.ts uses; appending
// one would be an invalid id (qaCategory.ts's own SONNET_MODEL comment).
const MESO_MODEL = 'claude-sonnet-5'

// A8 (TASKS §5.3/§8): 16,000 is an estimate, not a measurement — Sonnet 5's
// thinking counts toward max_tokens, and ~26 exercises plus two grouping
// layers plus a summary is well beyond Q&A planning's single-answer 8,000.
// The real figure is measured at Phase 5, before any row can be stored; a
// ceiling too low here truncates the answer while the thinking completes,
// exactly the stop_reason: 'max_tokens' failure below exists to catch.
const MESO_MAX_TOKENS = 16000

// A7 (TASKS §5.3/§8): 'high' is proposed, not measured — Q&A's planning
// route uses 'medium', but this is the deepest reasoning task in the
// project and fires a handful of times a year, so the cost delta is
// negligible on the same logic SPEC §5 uses to choose Sonnet over Haiku.
// Phase 5 measures both on the same real payload before this is trusted.
const MESO_EFFORT = 'high' as const

const MESO_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    perExercise: {
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
    groups: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          axis: { type: 'string', enum: ['muscle_group', 'muscle_subgroup', 'movement_pattern'] },
          label: { type: 'string' },
          exerciseIds: { type: 'array', items: { type: 'string' } },
          comment: { type: 'string' },
        },
        required: ['axis', 'label', 'exerciseIds', 'comment'],
        additionalProperties: false,
      },
    },
    summary: { type: 'string' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          area: { type: 'string' },
          suggestion: { type: 'string' },
        },
        required: ['area', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['perExercise', 'groups', 'summary', 'suggestions'],
  additionalProperties: false,
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuidLike(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

type CoachMesoAnalysisRow = {
  id: string
  user_id: string
  mesocycle_id: string | null
  meso_name: string
  meso_start_date: string
  meso_end_date: string | null
  content: CoachMesoAnalysisContent
  input_snapshot: CoachMesoAnalysis['inputSnapshot']
  model: string
  prompt_version: number
  input_tokens: number | null
  output_tokens: number | null
  created_at: string
}

function toCoachMesoAnalysis(row: CoachMesoAnalysisRow): CoachMesoAnalysis {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authorizeCoachRequest(req, res)
  if (!auth) return
  const { supabase, userId } = auth

  // ── §5.2 step 1 — validate mesocycleId is a UUID-shaped string ───────────
  const mesocycleIdInput = req.body?.mesocycleId
  if (!isUuidLike(mesocycleIdInput)) {
    res.status(400).json({ error: 'mesocycleId is required and must be a uuid string' })
    return
  }
  const mesocycleId = mesocycleIdInput

  // ── §5.2 step 2 — existing-row check, idempotent and free ────────────────
  const { data: existingRow, error: existingError } = await supabase
    .from('v2_coach_meso_analyses')
    .select('*')
    .eq('mesocycle_id', mesocycleId)
    .eq('user_id', userId)
    .maybeSingle()
  if (existingError) {
    res.status(500).json({ error: 'Failed to check for an existing analysis' })
    return
  }
  if (existingRow) {
    res.status(200).json(toCoachMesoAnalysis(existingRow as CoachMesoAnalysisRow))
    return
  }

  // ── §5.2 step 3 — re-derive completion server-side, never trusted from
  // the client. §4.1 caveat 1: no CHECK constraint on `status`, so this
  // compares to the literal 'completed' rather than assuming a closed
  // vocabulary. ──────────────────────────────────────────────────────────
  const { data: mesoRow, error: mesoError } = await supabase
    .from('v2_mesocycles')
    .select('id, status')
    .eq('id', mesocycleId)
    .eq('user_id', userId)
    .maybeSingle()
  if (mesoError) {
    res.status(500).json({ error: 'Failed to look up mesocycle' })
    return
  }
  if (!mesoRow) {
    res.status(404).json({ error: 'Mesocycle not found' })
    return
  }
  if ((mesoRow as { status: string }).status !== 'completed') {
    res.status(409).json({ error: 'Mesocycle is not completed', status: (mesoRow as { status: string }).status })
    return
  }

  // ── §5.2 steps 4-5 — assemble (priority is already folded in, see header
  // comment) → 500 on throw. ────────────────────────────────────────────────
  let input
  try {
    input = await assembleMesoAnalysisInput(supabase, userId, mesocycleId)
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

  const payload = buildMesoPromptPayload(input)

  // ── §5.3 — Sonnet 5's real surface: no temperature/top_p/top_k, effort
  // inside output_config alongside format, no date suffix on the model id,
  // thinking tokens counted toward max_tokens. ──────────────────────────────
  let response: Anthropic.Message
  try {
    response = await anthropic.messages.create({
      model: MESO_MODEL,
      max_tokens: MESO_MAX_TOKENS,
      system: COACH_MESO_SYSTEM_PROMPT,
      output_config: { effort: MESO_EFFORT, format: { type: 'json_schema', schema: MESO_ANALYSIS_SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
    })
  } catch (err) {
    // Anthropic SDK errors embed the full upstream status/body in their
    // message — logged server-side only, never echoed to the client, same
    // treatment as every other Coach endpoint.
    console.error('Coach meso analysis generation call failed', { mesocycleId, userId, error: err })
    res.status(502).json({ error: 'Analysis generation failed' })
    return
  }

  // ── §5.4 — stop_reason checked before anything is parsed or saved, this
  // endpoint's own bar (ask.ts's, not analyze.ts's/analyze-week.ts's known
  // unchecked gap) — a truncated or refused generation is not an analysis,
  // and the unique constraint means a wrong row here would be permanent. ──
  if (response.stop_reason === 'max_tokens') {
    console.error('Coach meso analysis generation truncated by max_tokens — not saved', {
      mesocycleId,
      userId,
      model: response.model,
    })
    res.status(502).json({ error: 'The analysis was cut off before it finished generating — not saved' })
    return
  }
  if (response.stop_reason === 'refusal') {
    console.error('Coach meso analysis generation refused', {
      mesocycleId,
      userId,
      stopDetails: response.stop_details,
    })
    res.status(502).json({
      error: 'The model declined to analyze this mesocycle',
      category: response.stop_details?.category ?? null,
    })
    return
  }

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    res.status(502).json({ error: 'Model returned no text content' })
    return
  }

  let content: CoachMesoAnalysisContent
  try {
    content = JSON.parse(textBlock.text) as CoachMesoAnalysisContent
  } catch {
    res.status(502).json({ error: 'Model output was not valid JSON', generated: textBlock.text })
    return
  }

  // ── §5.2 step 8 — re-check completion immediately before insert. Same
  // reasoning as analyze-week.ts's own re-check: generation takes tens of
  // seconds and there is no update path to repair a wrong permanent row —
  // as ordinary an action as completing a *different* meso and, via
  // useMesos.ts's completeAllActiveMesos, disturbing this one's row between
  // the check above and here would otherwise go uncaught. ──────────────────
  const { data: recheckRow, error: recheckError } = await supabase
    .from('v2_mesocycles')
    .select('status')
    .eq('id', mesocycleId)
    .eq('user_id', userId)
    .maybeSingle()
  if (recheckError) {
    console.error('Coach meso analysis pre-insert completeness re-check failed', { mesocycleId, userId, error: recheckError })
    res.status(500).json({
      error: 'Analysis was generated but a final completeness check failed — not saved',
      generated: content,
    })
    return
  }
  if (!recheckRow || (recheckRow as { status: string }).status !== 'completed') {
    console.error('Coach meso analysis: mesocycle no longer completed during generation — not saved', {
      mesocycleId,
      userId,
      content,
    })
    res.status(409).json({
      error: 'Mesocycle is no longer completed — it changed while this analysis was being generated, so it was not saved',
      generated: content,
    })
    return
  }

  // ── §5.2 step 9 — insert, denormalising meso identity (§4.2/A6) from the
  // payload's own `meso` block, no extra query. ─────────────────────────────
  const { data: insertedRow, error: insertError } = await supabase
    .from('v2_coach_meso_analyses')
    .insert({
      user_id: userId,
      mesocycle_id: mesocycleId,
      meso_name: input.meso.name,
      meso_start_date: input.meso.startDate,
      meso_end_date: input.meso.endDate,
      content,
      input_snapshot: payload,
      model: response.model,
      prompt_version: MESO_PROMPT_VERSION,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    })
    .select('*')
    .single()

  if (insertError) {
    // This table has one unique constraint (user_id, mesocycle_id), so a
    // bare 23505 is unambiguous — unlike ask.ts's two-constraint table, no
    // name check is needed to know what happened: a concurrent request
    // already inserted this mesocycle's row.
    if (insertError.code === '23505') {
      const { data: raceRow, error: raceError } = await supabase
        .from('v2_coach_meso_analyses')
        .select('*')
        .eq('mesocycle_id', mesocycleId)
        .eq('user_id', userId)
        .maybeSingle()
      if (!raceError && raceRow) {
        res.status(200).json(toCoachMesoAnalysis(raceRow as CoachMesoAnalysisRow))
        return
      }
      console.error('Coach meso analysis: 23505 race-row re-select failed after a real insert conflict', {
        mesocycleId,
        userId,
        raceError,
      })
      res.status(500).json({
        error: 'This mesocycle was already analyzed by a concurrent request, but re-fetching that saved analysis failed — reload and check the Analyses list',
      })
      return
    }

    // A paid-but-unsaved generation is an accepted risk outside a hard
    // maxDuration kill, same treatment as every other Coach endpoint.
    console.error('Coach meso analysis insert failed after a successful generation', {
      mesocycleId,
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

  res.status(200).json(toCoachMesoAnalysis(insertedRow as CoachMesoAnalysisRow))
}
