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

import type { SetLog, FormRating } from '../../types/index.js'
import { groupSetLogs, type SetGroup } from '../gym/setGroupLogic.js'
import { calculateE1rm } from './e1rm.js'

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
  // Coach Personalization phase 5 (COACH-PERSONALIZATION-TASKS.md §4.5) —
  // null = not rated, same "absence is data too" convention as SetLog.formRating.
  formRating: FormRating | null
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
  // 2026-08-31 fix (CONTEXT.md — Weekly Analysis v2 fabrication finding #3):
  // a real generated analysis stated "dropped weight and reps" for a slot
  // whose real reps rose in every match — deltaPercent's sign was the only
  // signal offered for direction, and it blends weight/reps/RIR together,
  // so a caller inferring reps direction from its sign alone can be
  // literally backwards. Same "feed pre-computed data, don't make the
  // model derive it" principle dayOfWeek already applies elsewhere
  // (weekAnalysisInput.ts) — rep-count/weight direction is arithmetic, not
  // judgment, so it's computed once here rather than asked of every
  // caller. b - a, same sign convention as deltaPercent (positive =
  // increase from A to B). Independent of e1RM eligibility — unlike
  // deltaPercent, this needs only the one raw value on each side, not RIR
  // on both, so it can be non-null even when deltaPercent is null (e.g. no
  // RIR recorded).
  repsDelta: number | null
  weightDelta: number | null
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
  return { weight: log.weight, reps: log.reps, rir: log.rir, isWarmup: log.isWarmup, formRating: log.formRating }
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
// b - a, null when either side's own value is null — independent of the
// isSkipped/isWarmup/RIR eligibility eligibleE1rm applies, since a raw
// weight/rep comparison needs neither RIR nor e1RM eligibility to be
// meaningful.
function numericDelta(a: number | null, b: number | null): number | null {
  return a != null && b != null ? b - a : null
}

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
    repsDelta: numericDelta(logA.reps, logB.reps),
    weightDelta: numericDelta(logA.weight, logB.weight),
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
// order logged. A slot's position within the *original* combined order
// (e.g. "this was set 3 that day") is deliberately not carried through —
// the matched-comparison identity is "the Nth dropset" / "the Nth plain
// set", not "the Nth thing logged". Shared by matchSessionsByPosition
// (pairwise, below) and buildPositionMatchTable (N-way, further down) so
// both use the exact same identity rule — one filter, not two copies that
// could quietly drift apart.
function splitStreams(slots: SetGroup<SetLog>[]): {
  dropsets: SetGroup<SetLog>[]
  plain: SetGroup<SetLog>[]
} {
  return {
    dropsets: slots.filter((g) => g.stages.length > 0),
    plain: slots.filter((g) => g.stages.length === 0),
  }
}

// This makes a dropset-vs-plain shapeMismatch structurally impossible, not
// just unobserved: a matched pair from the `dropsets` stream is, by
// construction, two groups that both passed splitStreams' `stages.length >
// 0` filter; a matched pair from `plain` both passed the inverse filter.
// There is no code path left that could zip a dropset against a plain set —
// the old shared-forward-index version could (and, against real account
// data, did); this version cannot, so the field that reported it is gone
// rather than kept around always false.
export function matchSessionsByPosition(
  sessionA: PositionMatchSessionInput,
  sessionB: PositionMatchSessionInput,
): PositionMatchResult {
  const { dropsets: dropsetSlotsA, plain: plainSlotsA } = splitStreams(buildLoggedSlots(sessionA.logs))
  const { dropsets: dropsetSlotsB, plain: plainSlotsB } = splitStreams(buildLoggedSlots(sessionB.logs))

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

// ─── Multi-session position-matched table (History, not Progress) ──────────
//
// matchSessionsByPosition above is inherently pairwise — sessionA vs
// sessionB, one delta per matched item. History's "every session side by
// side" table needs a different shape: N sessions as N columns, "the Nth
// plain set logged" / "the Nth dropset logged" (and each of *its* stages) as
// independently-numbered rows, one cell per session — empty when that
// session's own slot list didn't reach that position, never
// misaligned/shifted to fill the gap. No e1RM/delta math here at all: this
// is a raw-value table, not a comparison, so there's nothing to compute
// beyond alignment — deltas belong to the pairwise function above, reused
// as-is by any future caller that wants them for a two-session slice of
// this same table.
//
// Reuses buildLoggedSlots and splitStreams directly (same functions
// matchSessionsByPosition uses, not re-derived copies) — this is the same
// plain/dropset identity model as the Progress headline, just aligned across
// N sessions instead of 2.

export interface PositionMatchTableCell {
  sessionId: string
  // null = this session's own slot list never reached this position (not a
  // skip — a skip already removed its slot entirely in buildLoggedSlots;
  // null here just means "logged fewer of this kind than other sessions
  // did").
  value: PositionMatchSetValue | null
}

// One row: one position (e.g. "the 2nd plain set logged" or "the 1st
// dropset's 2nd stage"), one cell per session in the same order as
// PositionMatchTable.sessions.
export interface PositionMatchTableRow {
  cells: PositionMatchTableCell[]
}

export interface PositionMatchDropsetTableRow {
  slotIndex: number // 1-based position within the dropset stream, independent of the plain stream's numbering
  head: PositionMatchTableRow
  // Stage rows, 1-based by position within the dropset — stages[0] is every
  // session's own 1st stage of its Nth dropset, etc. Row count is the max
  // stage count any single session logged for *this* dropset position, not
  // a fixed number — a session with fewer stages at this position gets
  // empty (null) cells on the deeper rows, it doesn't shrink the row count
  // for sessions that logged more.
  stages: PositionMatchTableRow[]
}

export interface PositionMatchTable {
  // Same order as the input — this function trusts the caller's chronological
  // ordering, same convention as matchSessionsByPosition's sessionA/sessionB
  // (picking and ordering the sessions is the caller's job).
  sessions: { sessionId: string; date: string }[]
  // Two independently-numbered row groups — a table row's slotIndex in
  // `plain` has no relationship to any slotIndex in `dropsets`, same
  // independence as the two streams in matchSessionsByPosition's result.
  plain: (PositionMatchTableRow & { slotIndex: number })[]
  dropsets: PositionMatchDropsetTableRow[]
}

function buildTableRow(
  sessions: PositionMatchSessionInput[],
  slotsPerSession: SetGroup<SetLog>[][],
  position: number,
  pick: (group: SetGroup<SetLog>) => SetLog,
): PositionMatchTableRow {
  return {
    cells: sessions.map((session, i) => {
      const group = slotsPerSession[i][position]
      return { sessionId: session.sessionId, value: group ? toSetValue(pick(group)) : null }
    }),
  }
}

export function buildPositionMatchTable(sessions: PositionMatchSessionInput[]): PositionMatchTable {
  const slotsPerSession = sessions.map((s) => buildLoggedSlots(s.logs))
  const streamsPerSession = slotsPerSession.map(splitStreams)
  const plainPerSession = streamsPerSession.map((s) => s.plain)
  const dropsetsPerSession = streamsPerSession.map((s) => s.dropsets)

  const maxPlain = Math.max(0, ...plainPerSession.map((s) => s.length))
  const plain: (PositionMatchTableRow & { slotIndex: number })[] = []
  for (let i = 0; i < maxPlain; i++) {
    plain.push({ slotIndex: i + 1, ...buildTableRow(sessions, plainPerSession, i, (g) => g.head) })
  }

  const maxDropsets = Math.max(0, ...dropsetsPerSession.map((s) => s.length))
  const dropsets: PositionMatchDropsetTableRow[] = []
  for (let i = 0; i < maxDropsets; i++) {
    const groupsAtThisSlot = dropsetsPerSession.map((s) => s[i] as SetGroup<SetLog> | undefined)
    const head = buildTableRow(sessions, dropsetsPerSession, i, (g) => g.head)

    const maxStages = Math.max(0, ...groupsAtThisSlot.map((g) => g?.stages.length ?? 0))
    const stages: PositionMatchTableRow[] = []
    for (let stageI = 0; stageI < maxStages; stageI++) {
      stages.push({
        cells: sessions.map((session, si) => {
          const stage = groupsAtThisSlot[si]?.stages[stageI]
          return { sessionId: session.sessionId, value: stage ? toSetValue(stage) : null }
        }),
      })
    }

    dropsets.push({ slotIndex: i + 1, head, stages })
  }

  return {
    sessions: sessions.map((s) => ({ sessionId: s.sessionId, date: s.date })),
    plain,
    dropsets,
  }
}
