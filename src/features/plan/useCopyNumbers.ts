import { useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { applyOps } from '../programs/applyOps'
import type { Op } from '../programs/programChange'
import { queryKeysTouchedBy } from '../programs/useChangeProgram'

// Chunk 52 (TASKS-1.2 "Plan's header" → CopySheet; SPEC Weeks and copying [1.2] → COPY (2c); Data model: "Client writes to existing
// `v2_week_plan_sets` rows ..., one `v2_apply_ops` call so a sheet's copy lands or fails as a whole"). COPY's one write: the op list
// `numbersOps` built goes to `v2_apply_ops` exactly as given, in one request (nothing is filtered or added here). `networkMode:
// 'always'` (every write mutation): offline the call fails and the sheet shows the error with its choices kept.
//
// The mutation settles only when the plans the write made stale have been read again (the week's own, every week's, which the
// "changed since" marks and the week tiles read), so the sheet closes on the numbers it wrote.
export function useCopyNumbers() {
  return useMutation({
    networkMode: 'always',
    mutationFn: async (ops: readonly Op[]) => {
      const applied = await applyOps(ops)
      await Promise.all(queryKeysTouchedBy(ops).map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      return applied
    },
  })
}
