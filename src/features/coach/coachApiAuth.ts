import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '@vercel/node'

// Shared auth/gate block for every Coach serverless function, extracted
// from api/coach/analyze.ts's step E (COACH-WEEK-ANALYSIS-TASKS.md §1.2).
// Carries four hardening details from step G's adversarial review —
// invisible-character stripping on COACH_USER_ID, the createClient
// try/catch, not echoing upstream errors to the client, and the pattern
// every downstream query should still follow of also filtering
// `.eq('user_id', userId)` explicitly rather than relying on RLS alone.
// Copy-pasting this into a second function would mean copy-pasting those
// four fixes correctly and then maintaining them twice — the next fix
// would land in one copy only.
//
// Must not import src/lib/supabase.ts: that module throws at load when
// VITE_SUPABASE_* are absent — fine in the browser (Vite always defines
// them), fatal at a Vercel Node function's cold start, where
// import.meta.env is simply undefined. This file builds its own client
// from process.env instead, exactly like analysisInput.ts's own injected-
// client pattern.
//
// Writes the error response itself and returns null on any failure, so
// every caller stays a straight-line read:
//   const auth = await authorizeCoachRequest(req, res)
//   if (!auth) return
//   const { supabase, userId } = auth
export async function authorizeCoachRequest(
  req: VercelRequest,
  res: VercelResponse,
): Promise<{ supabase: SupabaseClient; userId: string } | null> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return null
  }

  const authHeader = req.headers.authorization
  if (typeof authHeader !== 'string' || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing bearer token' })
    return null
  }
  const accessToken = authHeader.slice('Bearer '.length)

  // Same invisible/non-ASCII stripping as src/lib/supabase.ts, for the same
  // reason: a dashboard-pasted env var value can carry a BOM or zero-width
  // space that silently corrupts the Authorization/apikey header.
  const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? '').replace(/[^\x20-\x7E]/g, '').trim()
  const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY ?? '').replace(/[^\x20-\x7E]/g, '').trim()
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: 'Server misconfigured: missing Supabase env vars' })
    return null
  }

  let supabase: SupabaseClient
  try {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    })
  } catch {
    // createClient throws synchronously on a non-empty but malformed URL
    // (e.g. dashboard-pasted with stray quotes) — the stripping above only
    // catches invisible characters, not this. Caught here so a bad env var
    // still produces the same clean 500 the missing-var case above does,
    // instead of an uncaught rejection and an opaque platform-level error.
    res.status(500).json({ error: 'Server misconfigured: invalid Supabase env vars' })
    return null
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken)
  if (userError || !userData.user) {
    res.status(401).json({ error: 'Invalid or expired session' })
    return null
  }
  const userId = userData.user.id

  // Authoritative gate — guards spend. Must equal the same account as the
  // client-side VITE_COACH_USER_ID gate (coachGate.ts); nothing enforces
  // that agreement automatically (see CONTEXT.md). Same invisible-char
  // stripping as the Supabase env vars above — a dashboard paste can carry
  // a BOM/zero-width space here too, which would otherwise silently lock
  // out the legitimate coach account (fails closed, but still a real gap).
  const coachUserId = (process.env.COACH_USER_ID ?? '').replace(/[^\x20-\x7E]/g, '').trim()
  if (!coachUserId || userId !== coachUserId) {
    res.status(403).json({ error: 'Not authorized for Coach analysis' })
    return null
  }

  return { supabase, userId }
}
