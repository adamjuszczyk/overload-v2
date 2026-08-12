// Position-matched progress comparison — new scope, not a TASKS.md phase (see
// CONTEXT.md "Position-matched progress comparison" initiative). Compares two
// sessions of the same exercise slot-by-slot (a "slot" = one logged, non-
// skipped set group — a plain set or a whole dropset) instead of the
// existing e1RM headline's whole-session average, so a session with more or
// fewer sets than its comparison, or a reordered/renumbered set list after a
// mid-session skip, still gets a defensible set-1-vs-set-1 comparison instead
// of a misleading average-vs-average one.
//
// Deliberately pure and separate, same precedent as e1rm.ts / referenceLogic.ts
// / setGroupLogic.ts — this module only ever sees two already-selected
// sessions' full SetLog rows. Picking *which* two sessions to compare (LAST
// WEEK via referenceLogic.ts's resolveExerciseReference, or meso-start-vs-now
// via e1rm.ts's compareE1rmWindow / progressService.ts's
// getExerciseE1rmComparison) is the caller's job — reused from those existing
// modules, not reimplemented here.
//
// Convention: sessionA is the earlier/baseline side, sessionB the later/
// comparison side — deltaPercent is (e1rmB - e1rmA) / e1rmA × 100, same sign
// convention as e1rm.ts's compareE1rmWindow (positive = improvement).

import type { SetLog } from '../../types'
import { groupSetLogs, type SetGroup } from '../gym/setGroupLogic'
import { calculateE1rm } from './e1rm'

export interface PositionMatchSessionInput {
  sessionId: string
  date: string
  // Every set_log row for this session + exercise — any row order. Sorted by
  // setNumber before grouping here, same precondition sessionService.ts's
  // fetchReferenceSessions already upholds for groupSetLogs (a DB read has no
  // guaranteed row order without ORDER BY).
  logs: SetLog[]
}

// One eligible side of a matched item. weight/reps/rir carried through even
// when ineligible (e.g. no RIR recorded) so a report can show what was
// actually logged, not just the computed delta.
export interface PositionMatchSetValue {
  weight: number | null
  reps: number | null
  rir: number | null
  isWarmup: boolean
}

export interface PositionMatchItemResult {
  a: PositionMatchSetValue
  b: PositionMatchSetValue
  // null when either side is ineligible: skipped (shouldn't reach here —
  // slots are pre-filtered — kept as a defensive gate, same one
  // e1rm.ts's isEligibleSet applies), a warmup, or missing weight/reps/rir.
  // Reuses calculateE1rm's RIR-adjusted Epley math directly — the
  // skip-if-no-RIR *gate* is re-declared here (not exported from e1rm.ts,
  // and e1rm.ts's own gate also requires parentSetId == null, which would
  // wrongly disqualify every dropset stage) but the formula itself is not
  // reimplemented.
  e1rmA: number | null
  e1rmB: number | null
  deltaPercent: number | null
}

export interface PositionMatchSlotResult {
  slotIndex: number // 1-based position within its own stream (plain or dropset)
  head: PositionMatchItemResult
  // Stage-by-stage matches, up to the shorter side's stage count. Always
  // empty for a plain-stream slot — both sides are guaranteed zero stages
  // by construction (see matchSessionsByPosition), not filtered here.
  stages: PositionMatchItemResult[]
  // Stages beyond the matched count on each side — logged, but produced no
  // comparison, same "extra doesn't compare" rule as extraSlotsA/B.
  extraStagesA: number
  extraStagesB: number
}

// Slot N is matched against slot N *within one stream* (see
// matchSessionsByPosition) — the shorter side's count in that stream caps
// how many produce a comparison; anything beyond that is a real logged slot
// that still counts toward volume elsewhere in the app, but this function
// doesn't touch that, it just doesn't compare it.
export interface PositionMatchStreamResult {
  slotCountA: number
  slotCountB: number
  matchedSlotCount: number
  extraSlotsA: number
  extraSlotsB: number
  slots: PositionMatchSlotResult[]
}

export interface PositionMatchResult {
  sessionA: { sessionId: string; date: string }
  sessionB: { sessionId: string; date: string }
  // Split before matching (TASKS.md-style precedent: e1rm.ts's own
  // stage-exclusion rule already treats "a plain set" and "a dropset stage"
  // as different kinds of thing) — a dropset only ever matches another
  // dropset, a plain set only ever matches another plain set. No
  // shapeMismatch field: matching within a stream makes a dropset-vs-plain
  // pairing structurally impossible, not just unobserved (see
  // matchSessionsByPosition's comment for why).
  plain: PositionMatchStreamResult
  dropsets: PositionMatchStreamResult
}

// Step 1: ordered list of "slots" — each logged (non-skipped) set group, in
// the order actually logged. A plain set is one slot; a dropset (head +
// stages) is one slot containing an ordered sub-list of its stages. A skip
// removes its group from this list entirely rather than leaving a gap — the
// mechanism behind the renumbering case (set 3 becomes slot 2 when set 2 was
// skipped): no separate renumbering logic needed, it falls out of filtering
// an already-ordered list.
export function buildLoggedSlots(logs: SetLog[]): SetGroup<SetLog>[] {
  const sorted = [...logs].sort((a, b) => a.setNumber - b.setNumber)
  return groupSetLogs(sorted).filter((group) => !group.head.isSkipped)
}

function toSetValue(log: SetLog): PositionMatchSetValue {
  return { weight: log.weight, reps: log.reps, rir: log.rir, isWarmup: log.isWarmup }
}

// Step 4: per-item e1RM delta. Eligibility mirrors e1rm.ts's isEligibleSet
// minus the parentSetId check (stages are legitimate items here, not
// excluded from being "an independent set" — that exclusion is about the
// *existing* whole-session-average headline, not this slot-by-slot one).
function eligibleE1rm(log: SetLog): number | null {
  if (log.isSkipped || log.isWarmup) return null
  if (log.weight == null || log.reps == null || log.rir == null) return null
  return calculateE1rm({ weight: log.weight, reps: log.reps, rir: log.rir })
}

// Found by adversarial review (2026-08-12): weight=0 is a legitimately
// loggable/storable set (no DB or UI floor above 0), and eligibleE1rm above
// only rejects null fields, not zero — so calculateE1rm(0, reps, rir) = 0
// reaches here as a non-null e1rmA. A percent change from a zero baseline
// is mathematically undefined, not just "small": dividing by e1rmA === 0
// produces Infinity (e1rmB > 0) or NaN (e1rmB also 0), and `!= null` does
// not catch either — both would have silently flowed into the averaged
// headline (and rendered literally as "+Infinity%"/"NaN%") without this
// guard. Excluding only e1rmA === 0 here (not e1rmB === 0, which produces a
// legitimate -100%) keeps the fix scoped to the actual undefined case.
function matchItem(logA: SetLog, logB: SetLog): PositionMatchItemResult {
  const e1rmA = eligibleE1rm(logA)
  const e1rmB = eligibleE1rm(logB)
  const deltaPercent =
    e1rmA != null && e1rmB != null && e1rmA !== 0 ? ((e1rmB - e1rmA) / e1rmA) * 100 : null
  return {
    a: toSetValue(logA),
    b: toSetValue(logB),
    e1rmA,
    e1rmB,
    deltaPercent,
  }
}

// One matched slot pair, whichever stream it came from. Stage matching
// (step 3, one level down) needs no dropset/plain branch here — it's the
// same "match N to N, extra doesn't compare" rule as the stream-level one,
// and for a plain-stream pair both sides' `stages` are always empty by
// construction (see matchSessionsByPosition), so the loop below simply
// produces nothing rather than needing to be skipped.
function matchSlotPair(
  groupA: SetGroup<SetLog>,
  groupB: SetGroup<SetLog>,
  slotIndex: number,
): PositionMatchSlotResult {
  const matchedStageCount = Math.min(groupA.stages.length, groupB.stages.length)
  const stages: PositionMatchItemResult[] = []
  for (let s = 0; s < matchedStageCount; s++) {
    stages.push(matchItem(groupA.stages[s], groupB.stages[s]))
  }
  return {
    slotIndex: slotIndex + 1,
    head: matchItem(groupA.head, groupB.head),
    stages,
    extraStagesA: groupA.stages.length - matchedStageCount,
    extraStagesB: groupB.stages.length - matchedStageCount,
  }
}

// Step 2, within one stream: match slot N to slot N up to the shorter side's
// count in *this* stream; anything beyond that is reported via
// extraSlotsA/B but produces no comparison.
function matchSlotStream(slotsA: SetGroup<SetLog>[], slotsB: SetGroup<SetLog>[]): PositionMatchStreamResult {
  const matchedSlotCount = Math.min(slotsA.length, slotsB.length)
  const slots: PositionMatchSlotResult[] = []
  for (let i = 0; i < matchedSlotCount; i++) {
    slots.push(matchSlotPair(slotsA[i], slotsB[i], i))
  }
  return {
    slotCountA: slotsA.length,
    slotCountB: slotsB.length,
    matchedSlotCount,
    extraSlotsA: slotsA.length - matchedSlotCount,
    extraSlotsB: slotsB.length - matchedSlotCount,
    slots,
  }
}

// A dropset is never a defensible stand-in for a plain set's position, or
// vice versa — comparing a 3-stage dropset's head against a lone plain set
// two-thirds of the way through a session says nothing about progress. So
// each session's ordered slot list is split into two ordered sub-streams
// *before* matching — dropset slots in the order logged, plain slots in the
// order logged — and each stream is matched against its own kind only,
// slot N to slot N, same truncation rule as before (step 2), just applied
// per stream instead of once across the whole session. A slot's position
// within the *original* combined order (e.g. "this was set 3 that day") is
// deliberately not carried through — the matched-comparison identity is
// "the Nth dropset" / "the Nth plain set", not "the Nth thing logged".
//
// This makes a dropset-vs-plain shapeMismatch structurally impossible, not
// just unobserved: a matched pair from the `dropsets` stream is, by
// construction, two groups that both passed the `stages.length > 0` filter
// below; a matched pair from `plain` both passed the inverse filter. There
// is no code path left that could zip a dropset against a plain set — the
// old shared-forward-index version could (and, against real account data,
// did); this version cannot, so the field that reported it is gone rather
// than kept around always false.
export function matchSessionsByPosition(
  sessionA: PositionMatchSessionInput,
  sessionB: PositionMatchSessionInput,
): PositionMatchResult {
  const slotsA = buildLoggedSlots(sessionA.logs)
  const slotsB = buildLoggedSlots(sessionB.logs)

  const dropsetSlotsA = slotsA.filter((g) => g.stages.length > 0)
  const dropsetSlotsB = slotsB.filter((g) => g.stages.length > 0)
  const plainSlotsA = slotsA.filter((g) => g.stages.length === 0)
  const plainSlotsB = slotsB.filter((g) => g.stages.length === 0)

  return {
    sessionA: { sessionId: sessionA.sessionId, date: sessionA.date },
    sessionB: { sessionId: sessionB.sessionId, date: sessionB.date },
    plain: matchSlotStream(plainSlotsA, plainSlotsB),
    dropsets: matchSlotStream(dropsetSlotsA, dropsetSlotsB),
  }
}

// The single headline percentage (SPEC §6's successor): every matched
// item's deltaPercent — plain-stream heads, dropset heads, dropset stages,
// all three categories, uniformly — with the nulls (ineligible items: no
// RIR, warmup) dropped before averaging rather than zeroed. Iterating both
// streams' slots the same way is safe, not an approximation: a plain slot's
// `stages` is always empty by construction (matchSessionsByPosition never
// puts a stage on a plain-stream pair), so folding it into the same loop as
// a dropset slot's stages just contributes nothing for that slot, it never
// needs to be special-cased out.
//
// Returns null — never 0% — when nothing survives to average: no matched
// items at all (e.g. the two sessions share no slots in either stream), or
// every matched item was ineligible. Same "nothing shown" treatment
// compareE1rmWindow already uses for fewer-than-2-eligible-sessions; this
// is the equivalent edge case one level down, at the item level instead of
// the session level.
export function averagePositionMatchedDelta(result: PositionMatchResult): number | null {
  const deltas: number[] = []
  for (const slot of [...result.plain.slots, ...result.dropsets.slots]) {
    if (slot.head.deltaPercent != null) deltas.push(slot.head.deltaPercent)
    for (const stage of slot.stages) {
      if (stage.deltaPercent != null) deltas.push(stage.deltaPercent)
    }
  }
  if (deltas.length === 0) return null
  return deltas.reduce((sum, d) => sum + d, 0) / deltas.length
}
