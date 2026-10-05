import { supabase } from '../../lib/supabase'

// v2_start_run (migration 028, chunk 6 — TASKS.md "A run owns a copy of its
// program"). The repo's second .rpc() call (reassignService.ts's
// reassign_exercise_history is the first and its own precedent): one
// all-or-nothing transaction that completes every active run of the
// caller's, deep-copies the saved program and creates the new mesocycle —
// what the two-request completeAllActiveMesos + createMeso path
// (mesoService.ts/useMesos.ts, replaced by this file) could never make
// atomic or race-safe on its own (TASKS.md; scratch R8). No user id
// parameter: unlike createMeso, the function resolves auth.uid() itself
// (SECURITY INVOKER), so RLS — not a client-supplied id — is what scopes it
// to the caller's own programs and mesocycles.
//
// v2_start_run RETURNS uuid (a single scalar, not a table), so PostgREST
// hands supabase-js the bare id directly in `data` — no array-unwrap needed
// here, unlike reassign_exercise_history's RETURNS TABLE (...).
export async function startRun(programId: string, name: string, startDate: string): Promise<string> {
  const { data, error } = await supabase.rpc('v2_start_run', {
    p_program_id: programId,
    p_name: name,
    p_start_date: startDate,
  })
  if (error) throw error
  return data as string
}
