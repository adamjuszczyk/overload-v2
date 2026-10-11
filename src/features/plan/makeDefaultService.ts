import { supabase } from '../../lib/supabase'
import { parseMakeDefaultResult, type MakeDefaultResult } from './makeWeekDefault'

// Chunk 32 (TASKS-1.1 "Stable: Make this week the new default") — the one call the action
// makes. The pure decisions are in makeWeekDefault.ts.

// "Make this week the new default": migration 040's v2_make_week_default rewrites the
// run's copy in one transaction (exercises and sets become the week's, a dropped set is
// soft-removed, weights, RIR and tags untouched) and answers with what it did, of which the
// action reads which workouts kept their default. Atomic: an error (not signed in, not a
// stable run, a week with no session that can be a source) means nothing was written, and
// is thrown as it came. There is no undo.
export async function makeWeekDefault(mesoId: string, weekNumber: number): Promise<MakeDefaultResult> {
  const { data, error } = await supabase.rpc('v2_make_week_default', {
    p_mesocycle_id: mesoId,
    p_week_number: weekNumber,
  })
  if (error) throw error
  return parseMakeDefaultResult(data)
}
