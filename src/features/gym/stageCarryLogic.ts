// Chunk 14 — "Staged sets: all four stage kinds" (SPEC.md "Staged sets",
// verbatim): "Dropset: as today. Other kinds: each stage's weight carries
// over from the previous stage by default instead of being dropped."
// Reviewer's brief: "each stage's weight input defaults to the previous
// stage's logged (or entered) weight... Put this in a pure, tested
// function." Same precedent as setGroupLogic.ts/referenceLogic.ts/
// e1rm.ts/weightUnit.ts: pure, no React, no Supabase, independently
// testable, so SetGroup.tsx only ever calls it rather than re-deriving the
// rule inline.
//
// "The previous row" is the head when the group has no stages logged yet,
// otherwise the last-logged stage (stages are logged strictly in order —
// a stage never renders loggable until the one before it, or the head for
// the first stage, is logged — chunk 3's own locking rule) — so the last
// element of `group.stages` (if any) is always the correct, and only,
// candidate, never a deeper/skipped-ahead one. "Logged (or entered)" in
// the brief's own words: by the time a row is read here it is a committed
// SetLog, whatever weight ended up in it, whether the user kept a
// prefilled figure or typed a different one — this function only ever
// reads that one committed field, never re-derives "what the user is
// currently typing" into an unlogged row (chunk 3's locking rule means
// there is no second simultaneously-open, unlogged predecessor row to
// read from).
import { STAGE_KIND_CARRIES_WEIGHT, type StageKind } from '../../lib/plannerVocabulary.js'

export function resolveStageCarryWeightKg<T extends { weight: number | null }>(
  stageKind: StageKind,
  group: { head: T; stages: T[] },
): number | null {
  if (!STAGE_KIND_CARRIES_WEIGHT[stageKind]) return null
  return group.stages.length > 0 ? group.stages[group.stages.length - 1].weight : group.head.weight
}
