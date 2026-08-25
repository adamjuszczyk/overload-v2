import type { CurationDecision } from '../../types'

// Pure logic for applying a curation call's decisions (COACH-PERSONALIZATION-
// TASKS.md §5.3 steps 7-10). Split out of api/coach/curate-memory.ts so the
// two genuinely judgment-free parts of that flow — validating ids and
// deciding what write each decision becomes, and the ordering/stop-on-
// failure behaviour of the writes themselves — are tested against
// constructed fixtures rather than only exercised live. Not a file TASKS §8
// names explicitly (that list predates this level of design detail — see
// TASKS §0), but it follows the same pure-module-plus-.test.ts shape as
// ratingScales.ts/weekBuckets.ts/positionMatch.ts elsewhere in this feature
// line: the model makes the judgment call, tested deterministic code does
// everything that isn't one.

export interface CurationApplyPlan {
  toInsert: { body: string; reason: string }[]
  toUpdate: { id: string; body: string; reason: string }[]
  toExpire: { id: string; reason: string }[]
  rejectedIds: string[]
}

// §5.3 step 7: every id in an `update`/`expire` decision must be in the set
// of memory ids actually sent to the model. An unrecognised id is dropped,
// never applied, and collected into `rejectedIds` — the same defence
// WeekAnalysisDetail.tsx already applies to hallucinated exerciseIds. An
// `add` with an empty/whitespace-only body is dropped silently (not
// rejected — there is no id to reject, it simply isn't planned). An
// `update` that would blank an entry's body is treated the same way, as a
// no-op, rather than writing an empty string over real memory.
//
// `toUpdate`/`toExpire`/`rejectedIds` are deduplicated by id, keeping the
// LAST decision seen for a given id. Two decisions targeting the same id
// with the same op would otherwise land as two separate writes applied
// sequentially — the database correctly ends up holding only the later
// one, but a naive one-array-entry-per-decision plan would still report
// (and permanently persist into v2_coach_curation_runs.applied) the
// earlier, already-overwritten body as if it were a distinct, currently-true
// change. "Last wins" matches the real write order exactly, so the plan
// this function returns and the database state after applying it never
// disagree. Found live during this session's adversarial review — the
// curation prompt asks the model to collapse same-fact notes into one
// decision (coachCurationPrompt.ts), but nothing structurally guarantees it.
export function planCurationApply(
  decisions: CurationDecision[],
  validMemoryIds: ReadonlySet<string>,
): CurationApplyPlan {
  const toInsert: CurationApplyPlan['toInsert'] = []
  const toUpdateById = new Map<string, { id: string; body: string; reason: string }>()
  const toExpireById = new Map<string, { id: string; reason: string }>()
  const rejectedIds = new Set<string>()

  for (const decision of decisions) {
    if (decision.op === 'add') {
      const body = decision.body.trim()
      if (body.length === 0) continue
      toInsert.push({ body, reason: decision.reason })
      continue
    }

    if (!validMemoryIds.has(decision.id)) {
      rejectedIds.add(decision.id)
      continue
    }

    if (decision.op === 'update') {
      const body = decision.body.trim()
      if (body.length === 0) continue
      toUpdateById.set(decision.id, { id: decision.id, body, reason: decision.reason })
    } else {
      toExpireById.set(decision.id, { id: decision.id, reason: decision.reason })
    }
  }

  return {
    toInsert,
    toUpdate: [...toUpdateById.values()],
    toExpire: [...toExpireById.values()],
    rejectedIds: [...rejectedIds],
  }
}

export interface CurationStepFailure {
  completed: number
  error: unknown
}

// §5.3's ordering note on steps 8-10: there is no transaction across
// PostgREST calls, so a failure between them has to leave every partial
// state safe-ish in the same direction — memory changes land first, then
// notes are marked as consumed, then the audit row, never the reverse
// (consuming notes before memory changes land would silently drop notes
// that produced nothing on a crash, the worse failure per §7.7). Expressed
// here as a plain ordered list of async steps, stopping at the first
// rejection, so that sequencing is something a test can exercise with mock
// steps rather than something only implicit in the handler's control flow.
export async function runCurationSteps(
  steps: Array<() => Promise<void>>,
): Promise<CurationStepFailure | null> {
  for (let i = 0; i < steps.length; i++) {
    try {
      await steps[i]()
    } catch (error) {
      return { completed: i, error }
    }
  }
  return null
}
