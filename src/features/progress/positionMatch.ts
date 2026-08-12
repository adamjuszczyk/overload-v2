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
  slotIndex: number // 1-based position among logged, non-skipped slots
  isDropsetA: boolean
  isDropsetB: boolean
  // True when exactly one side is a dropset and the other isn't — an
  // assumption (compare heads only), not a confirmed rule, so callers/
  // reports must be able to see it happened rather than have it silently
  // applied.
  shapeMismatch: boolean
  head: PositionMatchItemResult
  // Stage-by-stage matches, up to the shorter side's stage count. Empty when
  // shapeMismatch is true, or when neither side is a dropset.
  stages: PositionMatchItemResult[]
  // Stages beyond the matched count on each side — logged, but produced no
  // comparison, same "extra doesn't compare" rule as extraSlotsA/B.
  extraStagesA: number
  extraStagesB: number
}

export interface PositionMatchResult {
  sessionA: { sessionId: string; date: string }
  sessionB: { sessionId: string; date: string }
  slotCountA: number
  slotCountB: number
  matchedSlotCount: number
  // Slots beyond matchedSlotCount on each side — logged, still count toward
  // volume elsewhere in the app, but this function doesn't touch that; they
  // just produce no comparison here.
  extraSlotsA: number
  extraSlotsB: number
  slots: PositionMatchSlotResult[]
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

function matchItem(logA: SetLog, logB: SetLog): PositionMatchItemResult {
  const e1rmA = eligibleE1rm(logA)
  const e1rmB = eligibleE1rm(logB)
  return {
    a: toSetValue(logA),
    b: toSetValue(logB),
    e1rmA,
    e1rmB,
    deltaPercent: e1rmA != null && e1rmB != null ? ((e1rmB - e1rmA) / e1rmA) * 100 : null,
  }
}

// Steps 2–5: match slot N to slot N up to the shorter session's slot count;
// within a matched pair, match stage 1 to stage 1 etc. (same truncation rule,
// one level down) when both sides are dropsets, or compare heads only (and
// say so) when their shapes disagree. Returns every matched comparison and
// its delta — deliberately no rollup/average here (TASKS.md-style precedent:
// e1rm.ts's compareE1rmWindow computes one summary number, but what a single
// summary should mean for a set-by-set comparison is a UI decision for
// later, not decided by this function).
export function matchSessionsByPosition(
  sessionA: PositionMatchSessionInput,
  sessionB: PositionMatchSessionInput,
): PositionMatchResult {
  const slotsA = buildLoggedSlots(sessionA.logs)
  const slotsB = buildLoggedSlots(sessionB.logs)
  const matchedSlotCount = Math.min(slotsA.length, slotsB.length)

  const slots: PositionMatchSlotResult[] = []
  for (let i = 0; i < matchedSlotCount; i++) {
    const groupA = slotsA[i]
    const groupB = slotsB[i]
    const isDropsetA = groupA.stages.length > 0
    const isDropsetB = groupB.stages.length > 0
    const shapeMismatch = isDropsetA !== isDropsetB

    let stages: PositionMatchItemResult[] = []
    let extraStagesA = 0
    let extraStagesB = 0
    if (!shapeMismatch && isDropsetA && isDropsetB) {
      const matchedStageCount = Math.min(groupA.stages.length, groupB.stages.length)
      for (let s = 0; s < matchedStageCount; s++) {
        stages.push(matchItem(groupA.stages[s], groupB.stages[s]))
      }
      extraStagesA = groupA.stages.length - matchedStageCount
      extraStagesB = groupB.stages.length - matchedStageCount
    }

    slots.push({
      slotIndex: i + 1,
      isDropsetA,
      isDropsetB,
      shapeMismatch,
      head: matchItem(groupA.head, groupB.head),
      stages,
      extraStagesA,
      extraStagesB,
    })
  }

  return {
    sessionA: { sessionId: sessionA.sessionId, date: sessionA.date },
    sessionB: { sessionId: sessionB.sessionId, date: sessionB.date },
    slotCountA: slotsA.length,
    slotCountB: slotsB.length,
    matchedSlotCount,
    extraSlotsA: slotsA.length - matchedSlotCount,
    extraSlotsB: slotsB.length - matchedSlotCount,
    slots,
  }
}
