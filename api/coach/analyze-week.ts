import type { VercelRequest, VercelResponse } from '@vercel/node'
import Anthropic from '@anthropic-ai/sdk'
import { authorizeCoachRequest } from '../../src/features/coach/coachApiAuth.js'
import { assembleWeekResolution } from '../../src/features/coach/weekResolution.js'
import { assembleWeekAnalysisInput } from '../../src/features/coach/weekAnalysisInput.js'
import { COACH_WEEK_SYSTEM_PROMPT, WEEK_PROMPT_VERSION } from '../../src/features/coach/coachWeekPrompt.js'
import { weekKey } from '../../src/features/coach/weightLogic.js'
import type { CoachWeekAnalysisContent, CoachWeekAnalysis } from '../../src/types/index.js'

// Vercel serverless function (COACH-WEEK-ANALYSIS-TASKS.md §4 step 7).
// Single POST endpoint: shared auth/gate (coachApiAuth.ts, §1.2) → validate
// weekStart is a real Monday → return any existing row for that week
// (idempotency — unique(user_id, week_start) makes regeneration
// structurally impossible, SPEC §4) → re-derive completeness *server-side*
// from live data, never trusted from the client (§1.3) → assemble via
// weekAnalysisInput.ts's assembleWeekAnalysisInput → call Haiku 4.5 with
// structured output → insert, persisting response.model (not the request
// constant) and the full input_snapshot → return the row.
//
// No service-role key: same per-request, RLS-scoped client every other
// Coach function in this app uses — v2_coach_week_analyses' "own rows
// only" policy does the rest.

// Pinned snapshot, not the `claude-haiku-4-5` alias — `model` is stored per
// row, so provenance matters. Step 6 (CONTEXT.md, 2026-08-22) measured this
// exact model at 21.3s wall-clock against the 60s maxDuration cap
// (vercel.json) — 38.7s of margin. Thinner than daily's own 45.8s margin
// (TASKS §7.17 flags this explicitly), but not a marginal reading.
const MODEL = 'claude-haiku-4-5-20251001'

const WEEK_ANALYSIS_SCHEMA = {
  type: 'object',
  properties: {
    highlights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bucketKind: { type: 'string', enum: ['muscle_subgroup', 'movement_pattern', 'cross'] },
          bucketLabel: { type: 'string' },
          exerciseIds: { type: 'array', items: { type: 'string' } },
          headline: { type: 'string' },
          comment: { type: 'string' },
        },
        required: ['bucketKind', 'bucketLabel', 'exerciseIds', 'headline', 'comment'],
        additionalProperties: false,
      },
    },
    overall: { type: 'string' },
  },
  required: ['highlights', 'overall'],
  additionalProperties: false,
}

type CoachWeekAnalysisRow = {
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

function toCoachWeekAnalysis(row: CoachWeekAnalysisRow): CoachWeekAnalysis {
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authorizeCoachRequest(req, res)
  if (!auth) return
  const { supabase, userId } = auth

  // ── Validate weekStart is a real Monday (§1.3 step 1) — checked here in
  // addition to the database CHECK (migration 013), since a client error
  // deserves a clean 400 rather than surfacing as a raw Postgres constraint
  // violation. weekKey normalises any date to its containing week's Monday
  // — if the client's string doesn't already equal its own normalised
  // form, it wasn't a canonical Monday to begin with. ─────────────────────
  const weekStartInput = req.body?.weekStart
  if (typeof weekStartInput !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartInput)) {
    res.status(400).json({ error: 'weekStart is required and must be a YYYY-MM-DD date string' })
    return
  }
  // Found by adversarial review (2026-08-23): the regex above accepts a
  // calendar-invalid string like "2026-02-30" — weekKey then throws
  // (date-fns's format on an Invalid Date), uncaught, which would surface
  // as an unhandled crash instead of the clean 400 this check exists to
  // give. Caught explicitly so a malformed-but-regex-shaped date degrades
  // to the same 400 as any other bad weekStart, never a raw exception.
  let normalized: string
  try {
    normalized = weekKey(weekStartInput)
  } catch {
    res.status(400).json({ error: 'weekStart is not a valid calendar date' })
    return
  }
  if (normalized !== weekStartInput) {
    res.status(400).json({ error: 'weekStart must be the Monday of its week', normalizedMonday: normalized })
    return
  }
  const weekStart = weekStartInput

  const { data: existingRow, error: existingError } = await supabase
    .from('v2_coach_week_analyses')
    .select('*')
    .eq('week_start', weekStart)
    // Defence-in-depth alongside RLS, same pattern as every query in this
    // feature (analysisInput.ts, analyze.ts) — currently redundant given
    // RLS plus the COACH_USER_ID gate, but deliberate rather than assumed.
    .eq('user_id', userId)
    .maybeSingle()
  if (existingError) {
    res.status(500).json({ error: 'Failed to check for an existing analysis' })
    return
  }
  if (existingRow) {
    res.status(200).json(toCoachWeekAnalysis(existingRow as CoachWeekAnalysisRow))
    return
  }

  // ── Re-derive completeness server-side (§1.3 steps 2–3) — never trusted
  // from the client. A stale TanStack cache or a UI bug claiming a
  // half-finished week is complete must not be able to pay for and
  // permanently store an analysis of it, with no regeneration path to fix
  // it (SPEC §9). ───────────────────────────────────────────────────────
  let resolution
  try {
    resolution = await assembleWeekResolution(supabase, userId, weekStart)
  } catch (err) {
    res.status(500).json({ error: 'Failed to resolve week completeness', detail: String(err) })
    return
  }
  if (!resolution.isComplete) {
    res.status(409).json({
      error: 'Week is not complete',
      weekStart: resolution.weekStart,
      weekEnd: resolution.weekEnd,
      expectedSessions: resolution.expected.length,
    })
    return
  }

  let inputSnapshot
  try {
    inputSnapshot = await assembleWeekAnalysisInput(supabase, userId, weekStart)
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
      system: COACH_WEEK_SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: WEEK_ANALYSIS_SCHEMA } },
      messages: [{ role: 'user', content: JSON.stringify(inputSnapshot) }],
    })
  } catch (err) {
    // Anthropic SDK errors embed the full upstream status/body in their
    // message — logged server-side only, not echoed to the client, same
    // treatment as the insert-failure path below.
    console.error('Coach week analysis generation call failed', { weekStart, userId, error: err })
    res.status(502).json({ error: 'Analysis generation failed' })
    return
  }

  const textBlock = response.content.find((block) => block.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    res.status(502).json({ error: 'Model returned no text content' })
    return
  }

  let content: CoachWeekAnalysisContent
  try {
    content = JSON.parse(textBlock.text) as CoachWeekAnalysisContent
  } catch {
    res.status(502).json({ error: 'Model output was not valid JSON', generated: textBlock.text })
    return
  }

  // ── Re-check completeness immediately before the insert (found by
  // adversarial review, 2026-08-23) — the completeness check above and the
  // input-snapshot assembly are two independent, unsynchronized queries,
  // with the ~20s Anthropic call sitting between them. A single-account
  // action as ordinary as reopening a session in this week during that
  // window (sessionService.ts's reopenSession, completed -> in_progress)
  // would leave the check at step 1 stale by the time this reaches the
  // insert — and per SPEC §9 there is no update/delete path, so a wrong
  // row landing here is permanent. Cheap relative to the call already
  // made: one more read, not another generation, and it's the last point
  // this can be caught for free. Same §7.17 accepted-risk treatment as any
  // other post-generation failure if it fires: the content already cost
  // money, so it's logged and returned rather than silently discarded. ──
  let recheck
  try {
    recheck = await assembleWeekResolution(supabase, userId, weekStart)
  } catch (err) {
    console.error('Coach week analysis pre-insert completeness re-check failed', { weekStart, userId, error: err })
    res.status(500).json({
      error: 'Analysis was generated but a final completeness check failed — not saved',
      generated: content,
    })
    return
  }
  if (!recheck.isComplete) {
    console.error('Coach week analysis: week became incomplete during generation — not saved', {
      weekStart,
      userId,
      content,
    })
    res.status(409).json({
      error: 'Week is no longer complete — it changed while this analysis was being generated, so it was not saved',
      weekStart: recheck.weekStart,
      weekEnd: recheck.weekEnd,
      generated: content,
    })
    return
  }

  const { data: insertedRow, error: insertError } = await supabase
    .from('v2_coach_week_analyses')
    .insert({
      user_id: userId,
      week_start: weekStart,
      content,
      input_snapshot: inputSnapshot,
      model: response.model,
      prompt_version: WEEK_PROMPT_VERSION,
      input_tokens: response.usage?.input_tokens ?? null,
      output_tokens: response.usage?.output_tokens ?? null,
    })
    .select('*')
    .single()

  if (insertError) {
    // 23505 = unique_violation on v2_coach_week_analyses_week_uk — a
    // concurrent request already inserted this week's row. Race-safe
    // idempotency: return the row that won rather than erroring.
    if (insertError.code === '23505') {
      const { data: raceRow, error: raceError } = await supabase
        .from('v2_coach_week_analyses')
        .select('*')
        .eq('week_start', weekStart)
        .eq('user_id', userId)
        .single()
      if (!raceError && raceRow) {
        res.status(200).json(toCoachWeekAnalysis(raceRow as CoachWeekAnalysisRow))
        return
      }

      // Found by adversarial review (2026-08-23): 23505 means a row for
      // this (user_id, week_start) already exists — the analysis WAS
      // saved, by whichever concurrent request won. If the re-select just
      // above fails or comes back empty, that's a transient read problem,
      // not a lost write — the generic "failed to save" message below
      // would tell the client the opposite of what actually happened.
      console.error('Coach week analysis: 23505 race-row re-select failed after a real insert conflict', {
        weekStart,
        userId,
        raceError,
      })
      res.status(500).json({
        error: 'This week was already analyzed by a concurrent request, but re-fetching that saved analysis failed — reload and check the Analyses list',
      })
      return
    }

    // §7.17 — a paid-but-unsaved generation is an accepted risk outside a
    // hard maxDuration kill. Return the generated content in the error
    // response rather than discarding it, and log it server-side.
    console.error('Coach week analysis insert failed after a successful generation', {
      weekStart,
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

  res.status(200).json(toCoachWeekAnalysis(insertedRow as CoachWeekAnalysisRow))
}
