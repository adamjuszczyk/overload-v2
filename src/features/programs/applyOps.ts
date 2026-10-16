import { useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { Op } from './programChange'

// Chunk 47 (TASKS-1.2 "Migration 043: `v2_apply_ops`, the atomic op executor") — the client of migration 043's
// `v2_apply_ops(p_ops jsonb) returns integer`. One request applies an op list in ONE transaction, in order, on a fixed list of
// tables, scoped to the signed-in user: every op lands or none does (SPEC [1.2]: "SAVE CHANGES writes everything at once";
// REVIEW's actions "write at once").
//
// What builds the list is not here: `programChange.ts` (chunk 45) does for CHANGE THE PROGRAM, chunk 56 will for REVIEW's actions,
// chunk 61 for a session's change rows. What is here is the call, and its rules:
//   - the list goes to the function exactly as given: the same array, under `p_ops`. Nothing is filtered, merged, reordered or added
//     (the server holds no planning logic, and nor does this layer). An empty list is sent too; the function answers 0.
//   - the answer is the number of ops the server applied.
//   - an error is thrown as it came, with the server's own message: `table not allowed`, `row not found: v2_week_plan_sets/<id>`,
//     `patch sets a protected column`, or a table's own refusal (a foreign key, a CHECK, a unique index). Nothing was written: the
//     whole request rolled back. The caller shows the message (the app's error patterns) and keeps its draft.
//   - the hook is `networkMode: 'always'` (RULES: every write mutation): offline the call fails and the error shows; under TanStack's
//     default ('online') the mutation would pause and a save's button would sit on its pending state for good.
//   - the hook invalidates nothing. Which caches an op list makes stale depends on the tables in it (the run copy, the week plans, the
//     schedule rows), so the caller (51a, 56) invalidates what its list touched. A list is built once per save (ids drawn then): a retry
//     after an attempt that may have landed refetches first (a second insert of the same ids is refused).
// Nothing calls this until chunk 51a.

// The op shape is chunk 45's (`Op`, typed per table): an op naming a table the function refuses, or a column a table hasn't got, does
// not compile.
export type { Op, OpTable } from './programChange'

export async function applyOps(ops: readonly Op[]): Promise<number> {
  const { data, error } = await supabase.rpc('v2_apply_ops', { p_ops: ops })
  if (error) throw error
  return data as number
}

export function useApplyOps() {
  return useMutation({
    networkMode: 'always',
    mutationFn: (ops: readonly Op[]) => applyOps(ops),
  })
}
