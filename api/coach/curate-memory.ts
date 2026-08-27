import type { VercelRequest, VercelResponse } from '@vercel/node'
import { authorizeCoachRequest } from '../../src/features/coach/coachApiAuth.js'
import { runCuration } from '../../src/features/coach/curationRunner.js'

// Vercel serverless function (COACH-PERSONALIZATION-TASKS.md §5.2-§5.3). A
// third Coach function, same reasoning as weekly §1.1 (analyze-week.ts):
// vercel.json's api/** block already covers it at maxDuration 60,
// tsconfig.api.json already includes api/, no config change needed.
//
// The Notes/Memory restructure (COACH-PERSONALIZATION-SPEC.md v1.1) removed
// the "UPDATE MEMORY" button that used to be this endpoint's only caller —
// curation now runs automatically, wired into api/coach/analyze.ts via the
// same runCuration() this handler calls. This endpoint stays: it's still the
// standalone, independently-callable curation entry point this project's own
// verification technique relies on (hitting a real deployed endpoint
// directly with a real bearer token, the same way every prior live check in
// this feature line has worked), and keeping it thin and separate from
// analyze.ts keeps the adversarial-review surface small per handler (§2.8).
//
// All the actual flow — authorize -> rate-limit guard -> uncurated notes ->
// zero notes free exit -> active memory -> one Anthropic call -> validate ->
// apply deterministically -> return — lives in curationRunner.ts's
// runCuration(), shared with analyze.ts. This handler only maps that
// function's typed outcome onto HTTP status codes and a response body,
// unchanged from what it always returned.

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await authorizeCoachRequest(req, res)
  if (!auth) return
  const { supabase, userId } = auth

  const outcome = await runCuration(supabase, userId)

  switch (outcome.kind) {
    case 'rate_limited':
      res.status(409).json({ error: 'A curation run already happened in the last minute — wait before trying again' })
      return
    case 'error':
      res.status(outcome.status).json({
        error: outcome.error,
        ...(outcome.applied ? { applied: outcome.applied } : {}),
      })
      return
    case 'success':
      res.status(200).json(outcome.result)
      return
  }
}
