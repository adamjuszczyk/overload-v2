import { describe, it, expect } from 'vitest'
import {
  buildLoggedSlots,
  matchSessionsByPosition,
  averagePositionMatchedDelta,
  buildPositionMatchTable,
  type PositionMatchSessionInput,
} from './positionMatch'
import { calculateE1rm } from './e1rm'
import type { SetLog } from '../../types'

function makeLog(overrides: Partial<SetLog>): SetLog {
  return {
    id: 'log-id',
    userId: 'u1',
    sessionId: 's1',
    exerciseId: 'e1',
    weekPlanSetId: null,
    setNumber: 1,
    weight: 100,
    reps: 10,
    rir: 2,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: false,
    loggedAt: '2026-01-01T00:00:00.000Z',
    restSeconds: null,
    formRating: null,
    ...overrides,
  }
}

function session(overrides: Partial<PositionMatchSessionInput> & { logs: SetLog[] }): PositionMatchSessionInput {
  return { sessionId: 'sess', date: '2026-01-01', ...overrides }
}

// ─── buildLoggedSlots (step 1) ──────────────────────────────────────────────

describe('buildLoggedSlots', () => {
  it('produces one slot per plain set, in setNumber order', () => {
    const logs = [3, 1, 2].map((n) => makeLog({ id: `set-${n}`, setNumber: n }))
    const slots = buildLoggedSlots(logs)
    expect(slots.map((s) => s.head.id)).toEqual(['set-1', 'set-2', 'set-3'])
    for (const s of slots) expect(s.stages).toEqual([])
  })

  it('groups a dropset head + stages into a single slot, stages ordered by stageIndex', () => {
    const head = makeLog({ id: 'head', setNumber: 1, stageIndex: 0 })
    const stage2 = makeLog({ id: 's2', setNumber: 1, stageIndex: 2, parentSetId: 'head', weight: 60 })
    const stage1 = makeLog({ id: 's1', setNumber: 1, stageIndex: 1, parentSetId: 'head', weight: 80 })
    const slots = buildLoggedSlots([head, stage2, stage1])
    expect(slots).toHaveLength(1)
    expect(slots[0].stages.map((s) => s.id)).toEqual(['s1', 's2'])
  })

  // The exact renumbering case from the design conversation: a session logs
  // three sets, the second is skipped — the third set's slot position must
  // shift from 3 to 2, not leave a gap or keep its original setNumber as its
  // position.
  it('a mid-session skip renumbers later slots — 3rd logged set becomes the 2nd slot', () => {
    const set1 = makeLog({ id: 'set-1', setNumber: 1 })
    const skipped = makeLog({ id: 'set-2', setNumber: 2, isSkipped: true, weight: null, reps: null, rir: null })
    const set3 = makeLog({ id: 'set-3', setNumber: 3 })
    const slots = buildLoggedSlots([set1, skipped, set3])
    expect(slots.map((s) => s.head.id)).toEqual(['set-1', 'set-3'])
  })

  it('a skipped dropset head drops the whole group, stages included', () => {
    const head = makeLog({ id: 'head', setNumber: 1, isSkipped: true, weight: null, reps: null, rir: null })
    const stage = makeLog({ id: 'stage', setNumber: 1, stageIndex: 1, parentSetId: 'head' })
    const other = makeLog({ id: 'other', setNumber: 2 })
    const slots = buildLoggedSlots([head, stage, other])
    expect(slots.map((s) => s.head.id)).toEqual(['other'])
  })
})

// ─── matchSessionsByPosition (steps 2–5, split into a plain stream and a
// dropset stream before matching) ───────────────────────────────────────────

describe('matchSessionsByPosition — stream split (dropset only ever matches dropset)', () => {
  it('matches a dropset against the other session\'s dropset, even when a plain set sits between them positionally', () => {
    // Session A: plain, then a 1-stage dropset. Session B: dropset first,
    // then plain. A shared-forward-index match would have paired A's plain
    // set (slot 1) against B's dropset (slot 1) — the exact bug this
    // refinement fixes. The stream split must still pair the two dropsets
    // and the two plain sets correctly regardless of where each falls.
    const aPlain = makeLog({ id: 'a-plain', setNumber: 1, weight: 100 })
    const aDropHead = makeLog({ id: 'a-drop-head', setNumber: 2, weight: 90 })
    const aDropStage = makeLog({ id: 'a-drop-stage', setNumber: 2, stageIndex: 1, parentSetId: 'a-drop-head', weight: 60 })
    const a = session({ sessionId: 'a', logs: [aPlain, aDropHead, aDropStage] })

    const bDropHead = makeLog({ id: 'b-drop-head', setNumber: 1, weight: 95 })
    const bDropStage = makeLog({ id: 'b-drop-stage', setNumber: 1, stageIndex: 1, parentSetId: 'b-drop-head', weight: 65 })
    const bPlain = makeLog({ id: 'b-plain', setNumber: 2, weight: 105 })
    const b = session({ sessionId: 'b', logs: [bDropHead, bDropStage, bPlain] })

    const result = matchSessionsByPosition(a, b)

    expect(result.plain.slots).toHaveLength(1)
    expect(result.plain.slots[0].head.a.weight).toBe(100)
    expect(result.plain.slots[0].head.b.weight).toBe(105)

    expect(result.dropsets.slots).toHaveLength(1)
    expect(result.dropsets.slots[0].head.a.weight).toBe(90)
    expect(result.dropsets.slots[0].head.b.weight).toBe(95)
    expect(result.dropsets.slots[0].stages).toHaveLength(1)
    expect(result.dropsets.slots[0].stages[0].a.weight).toBe(60)
    expect(result.dropsets.slots[0].stages[0].b.weight).toBe(65)
  })

  it('has no shapeMismatch field anywhere on the result — a dropset/plain pairing is structurally impossible now', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1 })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.plain).not.toHaveProperty('shapeMismatch')
    expect(result.plain.slots[0]).not.toHaveProperty('shapeMismatch')
    expect(result.plain.slots[0]).not.toHaveProperty('isDropsetA')
    expect(result.plain.slots[0]).not.toHaveProperty('isDropsetB')
  })

  // The real scenario the account's data surfaced: a dropset as the *last*
  // slot in both sessions, but the two sessions have different total slot
  // counts overall (an extra plain set on one side). Positionally (shared
  // forward index) that extra plain set pushes the dropsets out of
  // alignment; per-stream, the plain-count difference only ever affects the
  // plain stream, and the two dropsets — both last, both "the 1st dropset
  // logged" in their own session — still pair correctly.
  it('correctly pairs a dropset as the last slot in two sessions with different total slot counts', () => {
    const aP1 = makeLog({ id: 'a-p1', setNumber: 1, weight: 100 })
    const aP2 = makeLog({ id: 'a-p2', setNumber: 2, weight: 100 })
    const aDropHead = makeLog({ id: 'a-drop-head', setNumber: 3, weight: 80 })
    const aDropStage = makeLog({ id: 'a-drop-stage', setNumber: 3, stageIndex: 1, parentSetId: 'a-drop-head', weight: 50 })
    const a = session({ sessionId: 'a', logs: [aP1, aP2, aDropHead, aDropStage] }) // 4 rows, 3 slots total

    const bP1 = makeLog({ id: 'b-p1', setNumber: 1, weight: 105 })
    const bDropHead = makeLog({ id: 'b-drop-head', setNumber: 2, weight: 85 })
    const bDropStage = makeLog({ id: 'b-drop-stage', setNumber: 2, stageIndex: 1, parentSetId: 'b-drop-head', weight: 55 })
    const b = session({ sessionId: 'b', logs: [bP1, bDropHead, bDropStage] }) // 3 rows, 2 slots total

    const result = matchSessionsByPosition(a, b)

    // Plain stream: A has 2, B has 1 — matches 1, A has 1 extra.
    expect(result.plain.slotCountA).toBe(2)
    expect(result.plain.slotCountB).toBe(1)
    expect(result.plain.matchedSlotCount).toBe(1)
    expect(result.plain.extraSlotsA).toBe(1)
    expect(result.plain.extraSlotsB).toBe(0)

    // Dropset stream: both have exactly 1 — they pair correctly despite the
    // plain-count mismatch and despite landing at different original
    // combined positions (slot 3 in A, slot 2 in B).
    expect(result.dropsets.slotCountA).toBe(1)
    expect(result.dropsets.slotCountB).toBe(1)
    expect(result.dropsets.matchedSlotCount).toBe(1)
    expect(result.dropsets.extraSlotsA).toBe(0)
    expect(result.dropsets.extraSlotsB).toBe(0)
    expect(result.dropsets.slots[0].head.a.weight).toBe(80)
    expect(result.dropsets.slots[0].head.b.weight).toBe(85)
    expect(result.dropsets.slots[0].stages[0].a.weight).toBe(50)
    expect(result.dropsets.slots[0].stages[0].b.weight).toBe(55)
  })
})

describe('matchSessionsByPosition — per-stream slot count truncation (step 2)', () => {
  it('matches up to the shorter session, reporting the extra plain slots without comparing them', () => {
    const a = session({
      sessionId: 'a',
      logs: [1, 2, 3].map((n) => makeLog({ id: `a-${n}`, setNumber: n, weight: 100 })),
    })
    const b = session({
      sessionId: 'b',
      logs: [1, 2].map((n) => makeLog({ id: `b-${n}`, setNumber: n, weight: 110 })),
    })
    const result = matchSessionsByPosition(a, b)

    expect(result.plain.slotCountA).toBe(3)
    expect(result.plain.slotCountB).toBe(2)
    expect(result.plain.matchedSlotCount).toBe(2)
    expect(result.plain.extraSlotsA).toBe(1)
    expect(result.plain.extraSlotsB).toBe(0)
    expect(result.plain.slots).toHaveLength(2)
    expect(result.plain.slots[0].head.deltaPercent).not.toBeNull()

    expect(result.dropsets.slotCountA).toBe(0)
    expect(result.dropsets.slotCountB).toBe(0)
    expect(result.dropsets.slots).toEqual([])
  })
})

describe('matchSessionsByPosition — dropset stage-by-stage matching (step 3, per-stage progress)', () => {
  it('matches each stage independently — every stage individually progressed', () => {
    // Session A: head 100x8@2, stage1 70x10@1, stage2 50x12@0
    const aHead = makeLog({ id: 'a-head', setNumber: 1, weight: 100, reps: 8, rir: 2 })
    const aS1 = makeLog({ id: 'a-s1', setNumber: 1, stageIndex: 1, parentSetId: 'a-head', weight: 70, reps: 10, rir: 1 })
    const aS2 = makeLog({ id: 'a-s2', setNumber: 1, stageIndex: 2, parentSetId: 'a-head', weight: 50, reps: 12, rir: 0 })
    // Session B: every stage up a bit
    const bHead = makeLog({ id: 'b-head', setNumber: 1, weight: 105, reps: 8, rir: 2 })
    const bS1 = makeLog({ id: 'b-s1', setNumber: 1, stageIndex: 1, parentSetId: 'b-head', weight: 75, reps: 10, rir: 1 })
    const bS2 = makeLog({ id: 'b-s2', setNumber: 1, stageIndex: 2, parentSetId: 'b-head', weight: 55, reps: 12, rir: 0 })

    const a = session({ sessionId: 'a', logs: [aHead, aS1, aS2] })
    const b = session({ sessionId: 'b', logs: [bHead, bS1, bS2] })
    const result = matchSessionsByPosition(a, b)

    expect(result.plain.slots).toEqual([])
    expect(result.dropsets.slots).toHaveLength(1)
    const slot = result.dropsets.slots[0]
    expect(slot.stages).toHaveLength(2)

    // Head: 100->105
    expect(slot.head.deltaPercent).toBeGreaterThan(0)
    // Stage 1: 70->75
    expect(slot.stages[0].deltaPercent).toBeGreaterThan(0)
    // Stage 2: 50->55
    expect(slot.stages[1].deltaPercent).toBeGreaterThan(0)

    const expectedStage1Delta =
      ((calculateE1rm({ weight: 75, reps: 10, rir: 1 }) - calculateE1rm({ weight: 70, reps: 10, rir: 1 })) /
        calculateE1rm({ weight: 70, reps: 10, rir: 1 })) *
      100
    expect(slot.stages[0].deltaPercent).toBeCloseTo(expectedStage1Delta, 5)
  })

  it('truncates extra stages on the longer side — the "extra doesn\'t compare" rule one level down', () => {
    const aHead = makeLog({ id: 'a-head', setNumber: 1 })
    const aS1 = makeLog({ id: 'a-s1', setNumber: 1, stageIndex: 1, parentSetId: 'a-head' })
    const aS2 = makeLog({ id: 'a-s2', setNumber: 1, stageIndex: 2, parentSetId: 'a-head' })
    const aS3 = makeLog({ id: 'a-s3', setNumber: 1, stageIndex: 3, parentSetId: 'a-head' })
    const bHead = makeLog({ id: 'b-head', setNumber: 1 })
    const bS1 = makeLog({ id: 'b-s1', setNumber: 1, stageIndex: 1, parentSetId: 'b-head' })

    const a = session({ sessionId: 'a', logs: [aHead, aS1, aS2, aS3] })
    const b = session({ sessionId: 'b', logs: [bHead, bS1] })
    const result = matchSessionsByPosition(a, b)

    const slot = result.dropsets.slots[0]
    expect(slot.stages).toHaveLength(1)
    expect(slot.extraStagesA).toBe(2)
    expect(slot.extraStagesB).toBe(0)
  })
})

describe('matchSessionsByPosition — e1RM delta (step 4, reusing e1rm.ts)', () => {
  it('computes deltaPercent as (e1rmB - e1rmA) / e1rmA × 100', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, weight: 100, reps: 8, rir: 2 })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1, weight: 110, reps: 8, rir: 2 })] })
    const result = matchSessionsByPosition(a, b)
    const e1rmA = calculateE1rm({ weight: 100, reps: 8, rir: 2 })
    const e1rmB = calculateE1rm({ weight: 110, reps: 8, rir: 2 })
    expect(result.plain.slots[0].head.deltaPercent).toBeCloseTo(((e1rmB - e1rmA) / e1rmA) * 100, 5)
  })

  it('is null when either side has no RIR recorded — does not default to rir=0', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, rir: null })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1, rir: 2 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots[0].head.e1rmA).toBeNull()
    expect(result.plain.slots[0].head.e1rmB).not.toBeNull()
    expect(result.plain.slots[0].head.deltaPercent).toBeNull()
  })

  it('is null for a warmup item on either side', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, isWarmup: true })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots[0].head.e1rmA).toBeNull()
    expect(result.plain.slots[0].head.deltaPercent).toBeNull()
  })

  // Found by adversarial review (2026-08-12): weight=0 is a legitimately
  // loggable value (no DB or UI floor above 0), so e1rmA=0 is a real,
  // reachable case, not a hypothetical. calculateE1rm(0, reps, rir) = 0
  // reaches eligibleE1rm as non-null, so a naive `e1rmA != null` guard on
  // deltaPercent would divide by zero — Infinity when e1rmB > 0, NaN when
  // e1rmB is also 0 — and neither is `== null`, so both would have
  // silently reached averagePositionMatchedDelta and the rendered headline.
  it('is null (not Infinity) when the baseline side has weight=0', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, weight: 0, reps: 8, rir: 2 })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1, weight: 100, reps: 8, rir: 2 })] })
    const result = matchSessionsByPosition(a, b)
    const head = result.plain.slots[0].head
    expect(head.e1rmA).toBe(0) // still a real, non-null e1RM — weight=0 is not "ineligible"
    expect(head.e1rmB).not.toBeNull()
    expect(head.deltaPercent).toBeNull() // but the percent change from a 0 baseline is undefined
  })

  it('is null (not NaN) when both sides have weight=0', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, weight: 0, reps: 8, rir: 2 })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1, weight: 0, reps: 8, rir: 2 })] })
    const result = matchSessionsByPosition(a, b)
    const head = result.plain.slots[0].head
    expect(head.e1rmA).toBe(0)
    expect(head.e1rmB).toBe(0)
    expect(head.deltaPercent).toBeNull()
  })

  it('still computes a legitimate -100% when only the comparison side is weight=0', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, weight: 100, reps: 8, rir: 2 })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1, weight: 0, reps: 8, rir: 2 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots[0].head.deltaPercent).toBeCloseTo(-100, 8)
  })

  it('still reports raw weight/reps/rir for an ineligible item, just no e1RM/delta', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, weight: 90, reps: 12, rir: null })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots[0].head.a).toEqual({ weight: 90, reps: 12, rir: null, isWarmup: false })
    expect(result.plain.slots[0].head.e1rmA).toBeNull()
  })
})

describe('matchSessionsByPosition — no rollup (step 5)', () => {
  it('returns every matched comparison individually, not an averaged summary', () => {
    const a = session({
      sessionId: 'a',
      logs: [1, 2].map((n) => makeLog({ id: `a-${n}`, setNumber: n, weight: 100 })),
    })
    const b = session({
      sessionId: 'b',
      logs: [1, 2].map((n) => makeLog({ id: `b-${n}`, setNumber: n, weight: 100 + n })),
    })
    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots).toHaveLength(2)
    expect(result.plain.slots[0].head.deltaPercent).not.toEqual(result.plain.slots[1].head.deltaPercent)
    // No averaged/rolled-up field anywhere on the result or either stream.
    expect(result).not.toHaveProperty('deltaPercent')
    expect(result).not.toHaveProperty('avgDeltaPercent')
    expect(result.plain).not.toHaveProperty('deltaPercent')
    expect(result.dropsets).not.toHaveProperty('deltaPercent')
  })
})

// ─── averagePositionMatchedDelta (the headline rollup) ──────────────────────

describe('averagePositionMatchedDelta', () => {
  it('averages every non-null delta across a plain head, a dropset head, and a dropset stage', () => {
    // Session A: plain 100x8@2; dropset head 90x8@2, stage 60x10@1
    const aPlain = makeLog({ id: 'a-plain', setNumber: 1, weight: 100, reps: 8, rir: 2 })
    const aDropHead = makeLog({ id: 'a-drop-head', setNumber: 2, weight: 90, reps: 8, rir: 2 })
    const aDropStage = makeLog({ id: 'a-drop-stage', setNumber: 2, stageIndex: 1, parentSetId: 'a-drop-head', weight: 60, reps: 10, rir: 1 })
    const a = session({ sessionId: 'a', logs: [aPlain, aDropHead, aDropStage] })

    // Session B: every item up a bit
    const bPlain = makeLog({ id: 'b-plain', setNumber: 1, weight: 110, reps: 8, rir: 2 })
    const bDropHead = makeLog({ id: 'b-drop-head', setNumber: 2, weight: 100, reps: 8, rir: 2 })
    const bDropStage = makeLog({ id: 'b-drop-stage', setNumber: 2, stageIndex: 1, parentSetId: 'b-drop-head', weight: 66, reps: 10, rir: 1 })
    const b = session({ sessionId: 'b', logs: [bPlain, bDropHead, bDropStage] })

    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots).toHaveLength(1)
    expect(result.dropsets.slots).toHaveLength(1)
    expect(result.dropsets.slots[0].stages).toHaveLength(1)

    const plainDelta = result.plain.slots[0].head.deltaPercent!
    const dropHeadDelta = result.dropsets.slots[0].head.deltaPercent!
    const dropStageDelta = result.dropsets.slots[0].stages[0].deltaPercent!
    const expectedAverage = (plainDelta + dropHeadDelta + dropStageDelta) / 3

    expect(averagePositionMatchedDelta(result)).toBeCloseTo(expectedAverage, 8)

    // Sanity-check against hand-computed e1RM deltas too, not just internal consistency.
    const e1rmPlainA = calculateE1rm({ weight: 100, reps: 8, rir: 2 })
    const e1rmPlainB = calculateE1rm({ weight: 110, reps: 8, rir: 2 })
    expect(plainDelta).toBeCloseTo(((e1rmPlainB - e1rmPlainA) / e1rmPlainA) * 100, 8)
  })

  it('excludes a null delta (no RIR recorded) from the average rather than treating it as zero', () => {
    const aEligible = makeLog({ id: 'a-1', setNumber: 1, weight: 100, reps: 8, rir: 2 })
    const aNoRir = makeLog({ id: 'a-2', setNumber: 2, weight: 100, reps: 8, rir: null })
    const a = session({ sessionId: 'a', logs: [aEligible, aNoRir] })

    const bEligible = makeLog({ id: 'b-1', setNumber: 1, weight: 110, reps: 8, rir: 2 })
    const bAlsoEligible = makeLog({ id: 'b-2', setNumber: 2, weight: 999, reps: 8, rir: 2 })
    const b = session({ sessionId: 'b', logs: [bEligible, bAlsoEligible] })

    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots).toHaveLength(2)
    expect(result.plain.slots[0].head.deltaPercent).not.toBeNull()
    expect(result.plain.slots[1].head.deltaPercent).toBeNull() // A's side has no RIR

    // If the null were zeroed instead of excluded, the average would be
    // dragged toward 0 by the phantom second term. It must equal exactly
    // the one real delta.
    const onlyRealDelta = result.plain.slots[0].head.deltaPercent!
    expect(averagePositionMatchedDelta(result)).toBeCloseTo(onlyRealDelta, 8)
  })

  // Found by adversarial review (2026-08-12): a single weight=0 baseline
  // item used to produce Infinity/NaN (see matchItem's tests above), and
  // `!= null` does not exclude either — so it would have poisoned the
  // whole average (any Infinity/NaN in a reduce's input makes the entire
  // sum, and therefore the whole exercise's headline, Infinity/NaN) even
  // with other perfectly normal, finite deltas in the same result.
  it('excludes a weight=0 baseline item rather than letting it poison the average with Infinity/NaN', () => {
    const aNormal = makeLog({ id: 'a-1', setNumber: 1, weight: 100, reps: 8, rir: 2 })
    const aZero = makeLog({ id: 'a-2', setNumber: 2, weight: 0, reps: 8, rir: 2 })
    const a = session({ sessionId: 'a', logs: [aNormal, aZero] })

    const bNormal = makeLog({ id: 'b-1', setNumber: 1, weight: 110, reps: 8, rir: 2 })
    const bAlsoNormal = makeLog({ id: 'b-2', setNumber: 2, weight: 200, reps: 8, rir: 2 })
    const b = session({ sessionId: 'b', logs: [bNormal, bAlsoNormal] })

    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots[0].head.deltaPercent).not.toBeNull()
    expect(result.plain.slots[1].head.deltaPercent).toBeNull() // the weight=0 slot

    const average = averagePositionMatchedDelta(result)
    expect(average).not.toBeNull()
    expect(Number.isFinite(average)).toBe(true)
    expect(average).toBeCloseTo(result.plain.slots[0].head.deltaPercent!, 8)
  })

  it('returns null, not 0%, when every matched item is ineligible', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, rir: null })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1, rir: null })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots).toHaveLength(1)
    expect(result.plain.slots[0].head.deltaPercent).toBeNull()
    expect(averagePositionMatchedDelta(result)).toBeNull()
  })

  it('returns null, not 0%, when nothing matched at all in either stream', () => {
    // Session A logs only a dropset, session B logs only a plain set — the
    // dropset stream and plain stream both have a zero count on one side,
    // so matchedSlotCount is 0 in both.
    const aHead = makeLog({ id: 'a-head', setNumber: 1 })
    const aStage = makeLog({ id: 'a-stage', setNumber: 1, stageIndex: 1, parentSetId: 'a-head' })
    const a = session({ sessionId: 'a', logs: [aHead, aStage] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1 })] })

    const result = matchSessionsByPosition(a, b)
    expect(result.plain.slots).toEqual([])
    expect(result.dropsets.slots).toEqual([])
    expect(averagePositionMatchedDelta(result)).toBeNull()
  })
})

// ─── buildPositionMatchTable (the N-session table for History) ─────────────

describe('buildPositionMatchTable', () => {
  it('basic N-session alignment: one row per position, one cell per session, in session order', () => {
    const a = session({ sessionId: 'a', date: '2026-01-01', logs: [makeLog({ id: 'a-1', setNumber: 1, weight: 100 })] })
    const b = session({ sessionId: 'b', date: '2026-01-08', logs: [makeLog({ id: 'b-1', setNumber: 1, weight: 105 })] })
    const c = session({ sessionId: 'c', date: '2026-01-15', logs: [makeLog({ id: 'c-1', setNumber: 1, weight: 110 })] })

    const table = buildPositionMatchTable([a, b, c])

    expect(table.sessions).toEqual([
      { sessionId: 'a', date: '2026-01-01' },
      { sessionId: 'b', date: '2026-01-08' },
      { sessionId: 'c', date: '2026-01-15' },
    ])
    expect(table.plain).toHaveLength(1)
    expect(table.plain[0].slotIndex).toBe(1)
    expect(table.plain[0].cells).toEqual([
      { sessionId: 'a', value: { weight: 100, reps: 10, rir: 2, isWarmup: false } },
      { sessionId: 'b', value: { weight: 105, reps: 10, rir: 2, isWarmup: false } },
      { sessionId: 'c', value: { weight: 110, reps: 10, rir: 2, isWarmup: false } },
    ])
    expect(table.dropsets).toEqual([])
  })

  it('no e1RM/delta math anywhere — cells are raw logged values only', () => {
    // rir: null would make this item e1RM-ineligible in the pairwise
    // function; the table has no eligibility concept at all, it just shows
    // what was logged.
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, weight: 100, rir: null })] })
    const table = buildPositionMatchTable([a])
    expect(table.plain[0].cells[0].value).toEqual({ weight: 100, reps: 10, rir: null, isWarmup: false })
    expect(table.plain[0].cells[0]).not.toHaveProperty('deltaPercent')
    expect(table.plain[0].cells[0]).not.toHaveProperty('e1rm')
  })

  // Real shape #1: a dropset that lands at a different *combined* logged
  // position across sessions must still land in the same dropset-stream row
  // — the exact identity model matchSessionsByPosition's stream split
  // already guarantees pairwise, now checked N-wide.
  it('a dropset occupying a different combined slot position across sessions still lands in the same dropset row', () => {
    // Session A: dropset first, then two plain sets (dropset at combined position 1).
    const aDropHead = makeLog({ id: 'a-drop-head', setNumber: 1, weight: 90 })
    const aDropStage = makeLog({ id: 'a-drop-stage', setNumber: 1, stageIndex: 1, parentSetId: 'a-drop-head', weight: 60 })
    const aP1 = makeLog({ id: 'a-p1', setNumber: 2, weight: 100 })
    const aP2 = makeLog({ id: 'a-p2', setNumber: 3, weight: 101 })
    const a = session({ sessionId: 'a', date: '2026-01-01', logs: [aDropHead, aDropStage, aP1, aP2] })

    // Session B: two plain sets, then the dropset (dropset at combined position 3).
    const bP1 = makeLog({ id: 'b-p1', setNumber: 1, weight: 102 })
    const bP2 = makeLog({ id: 'b-p2', setNumber: 2, weight: 103 })
    const bDropHead = makeLog({ id: 'b-drop-head', setNumber: 3, weight: 92 })
    const bDropStage = makeLog({ id: 'b-drop-stage', setNumber: 3, stageIndex: 1, parentSetId: 'b-drop-head', weight: 62 })
    const b = session({ sessionId: 'b', date: '2026-01-08', logs: [bP1, bP2, bDropHead, bDropStage] })

    // Session C: one plain set, then the dropset (dropset at combined position 2).
    const cP1 = makeLog({ id: 'c-p1', setNumber: 1, weight: 104 })
    const cDropHead = makeLog({ id: 'c-drop-head', setNumber: 2, weight: 94 })
    const cDropStage = makeLog({ id: 'c-drop-stage', setNumber: 2, stageIndex: 1, parentSetId: 'c-drop-head', weight: 64 })
    const c = session({ sessionId: 'c', date: '2026-01-15', logs: [cP1, cDropHead, cDropStage] })

    const table = buildPositionMatchTable([a, b, c])

    // One dropset row (the 1st — and only — dropset logged in every session).
    expect(table.dropsets).toHaveLength(1)
    expect(table.dropsets[0].slotIndex).toBe(1)
    expect(table.dropsets[0].head.cells.map((c) => c.value?.weight)).toEqual([90, 92, 94])
    expect(table.dropsets[0].stages).toHaveLength(1)
    expect(table.dropsets[0].stages[0].cells.map((c) => c.value?.weight)).toEqual([60, 62, 64])

    // Plain stream: A and B each logged 2 plain sets, C logged 1 — C's 2nd
    // plain row must be an empty cell, not the dropset bleeding into it.
    expect(table.plain).toHaveLength(2)
    expect(table.plain[0].cells.map((c) => c.value?.weight)).toEqual([100, 102, 104])
    expect(table.plain[1].cells.map((c) => c.value?.weight)).toEqual([101, 103, undefined])
    expect(table.plain[1].cells[2].value).toBeNull()
  })

  // Real shape #2: a session with fewer plain slots than others produces
  // empty cells at the missing positions, never a misaligned/shifted value
  // from a different position.
  it('a session with fewer plain slots than others gets empty cells, not misaligned ones', () => {
    const a = session({
      sessionId: 'a',
      date: '2026-01-01',
      logs: [1, 2, 3].map((n) => makeLog({ id: `a-${n}`, setNumber: n, weight: 100 + n })),
    })
    const b = session({
      sessionId: 'b',
      date: '2026-01-08',
      logs: [makeLog({ id: 'b-1', setNumber: 1, weight: 200 })], // only 1 plain set this session
    })
    const c = session({
      sessionId: 'c',
      date: '2026-01-15',
      logs: [1, 2].map((n) => makeLog({ id: `c-${n}`, setNumber: n, weight: 300 + n })),
    })

    const table = buildPositionMatchTable([a, b, c])

    // Row count is the max across sessions (3, from session A), not the min.
    expect(table.plain).toHaveLength(3)

    // Row 1: every session reached it.
    expect(table.plain[0].cells.map((c) => c.value?.weight)).toEqual([101, 200, 301])
    // Row 2: B never reached a 2nd plain slot — empty, and still correctly
    // C's real 2nd slot (302), not shifted/reused from row 1.
    expect(table.plain[1].cells[0].value?.weight).toBe(102)
    expect(table.plain[1].cells[1].value).toBeNull()
    expect(table.plain[1].cells[2].value?.weight).toBe(302)
    // Row 3: only A reached it — B and C both empty.
    expect(table.plain[2].cells[0].value?.weight).toBe(103)
    expect(table.plain[2].cells[1].value).toBeNull()
    expect(table.plain[2].cells[2].value).toBeNull()
  })

  // Real shape #3: a mid-session skip renumbers later slots — chained across
  // more than two sessions this time (three), not just a pair. Each
  // session's own skip is independent; the table must reflect each
  // session's own correctly-renumbered slot list without any session's skip
  // leaking into another's row alignment.
  it('a mid-session skip renumbers later slots, chained across three sessions independently', () => {
    // Session A: no skip — sets 1, 2, 3 → slots 1, 2, 3.
    const a = session({
      sessionId: 'a',
      date: '2026-01-01',
      logs: [1, 2, 3].map((n) => makeLog({ id: `a-${n}`, setNumber: n, weight: 100 + n })),
    })
    // Session B: set 2 skipped — logged sets 1, 2(skip), 3, 4 → slots
    // [set1, set3, set4] = [1, 2, 3], set 3 renumbers from position 3 to 2.
    const b = session({
      sessionId: 'b',
      date: '2026-01-08',
      logs: [
        makeLog({ id: 'b-1', setNumber: 1, weight: 200 }),
        makeLog({ id: 'b-2', setNumber: 2, isSkipped: true, weight: null, reps: null, rir: null }),
        makeLog({ id: 'b-3', setNumber: 3, weight: 203 }),
        makeLog({ id: 'b-4', setNumber: 4, weight: 204 }),
      ],
    })
    // Session C: sets 1 AND 3 skipped — logged sets 1(skip), 2, 3(skip), 4
    // → slots [set2, set4] = [1, 2]; set 4 renumbers from position 4 to 2.
    const c = session({
      sessionId: 'c',
      date: '2026-01-15',
      logs: [
        makeLog({ id: 'c-1', setNumber: 1, isSkipped: true, weight: null, reps: null, rir: null }),
        makeLog({ id: 'c-2', setNumber: 2, weight: 302 }),
        makeLog({ id: 'c-3', setNumber: 3, isSkipped: true, weight: null, reps: null, rir: null }),
        makeLog({ id: 'c-4', setNumber: 4, weight: 304 }),
      ],
    })

    const table = buildPositionMatchTable([a, b, c])

    // Row count is 3 — A's longest post-filter slot list.
    expect(table.plain).toHaveLength(3)

    // Row 1: A's set 1, B's set 1, C's set 2 (renumbered from 2 → 1).
    expect(table.plain[0].cells.map((c) => c.value?.weight)).toEqual([101, 200, 302])
    // Row 2: A's set 2, B's set 3 (renumbered from 3 → 2), C's set 4
    // (renumbered from 4 → 2, since set 3 was also skipped).
    expect(table.plain[1].cells.map((c) => c.value?.weight)).toEqual([102, 203, 304])
    // Row 3: A's set 3, B's set 4 (renumbered from 4 → 3), C never reached
    // a 3rd slot (only 2 non-skipped sets total) — empty, not C's set 4
    // bleeding down or any other value reused.
    expect(table.plain[2].cells[0].value?.weight).toBe(103)
    expect(table.plain[2].cells[1].value?.weight).toBe(204)
    expect(table.plain[2].cells[2].value).toBeNull()
  })

  it('the max stage count for a dropset row is the max across sessions at that position — shorter sessions get empty deeper-stage cells, not truncated rows', () => {
    // Session A: dropset with 2 stages.
    const aHead = makeLog({ id: 'a-head', setNumber: 1, weight: 100 })
    const aS1 = makeLog({ id: 'a-s1', setNumber: 1, stageIndex: 1, parentSetId: 'a-head', weight: 70 })
    const aS2 = makeLog({ id: 'a-s2', setNumber: 1, stageIndex: 2, parentSetId: 'a-head', weight: 50 })
    const a = session({ sessionId: 'a', date: '2026-01-01', logs: [aHead, aS1, aS2] })

    // Session B: same dropset position, only 1 stage.
    const bHead = makeLog({ id: 'b-head', setNumber: 1, weight: 105 })
    const bS1 = makeLog({ id: 'b-s1', setNumber: 1, stageIndex: 1, parentSetId: 'b-head', weight: 75 })
    const b = session({ sessionId: 'b', date: '2026-01-08', logs: [bHead, bS1] })

    const table = buildPositionMatchTable([a, b])

    expect(table.dropsets).toHaveLength(1)
    // 2 stage rows total — the max (session A), not the min (session B).
    expect(table.dropsets[0].stages).toHaveLength(2)
    expect(table.dropsets[0].stages[0].cells.map((c) => c.value?.weight)).toEqual([70, 75])
    // Session B has no 2nd stage at this position — empty cell, not A's
    // stage-2 value bleeding across or the row disappearing.
    expect(table.dropsets[0].stages[1].cells[0].value?.weight).toBe(50)
    expect(table.dropsets[0].stages[1].cells[1].value).toBeNull()
  })

  it('a session that logs no dropsets at all produces empty head+stage cells at every dropset row it does not reach', () => {
    const aHead = makeLog({ id: 'a-head', setNumber: 1 })
    const aStage = makeLog({ id: 'a-stage', setNumber: 1, stageIndex: 1, parentSetId: 'a-head' })
    const a = session({ sessionId: 'a', logs: [aHead, aStage] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1 })] }) // plain only, no dropset

    const table = buildPositionMatchTable([a, b])

    expect(table.dropsets).toHaveLength(1)
    expect(table.dropsets[0].head.cells[1].value).toBeNull()
    expect(table.dropsets[0].stages[0].cells[1].value).toBeNull()
  })

  it('returns empty plain/dropsets arrays for a single session with no logs', () => {
    const a = session({ sessionId: 'a', logs: [] })
    const table = buildPositionMatchTable([a])
    expect(table.sessions).toEqual([{ sessionId: 'a', date: '2026-01-01' }])
    expect(table.plain).toEqual([])
    expect(table.dropsets).toEqual([])
  })

  // Found by adversarial review as a coverage gap (no live bug — the loop
  // already scopes groupsAtThisSlot/maxStages fresh per iteration — but
  // nothing locked that in): two dropsets in one session, each with a
  // different, independently-varying stage count, must not let one row's
  // stage count/cells bleed into the other's.
  it('two independently-shaped dropsets in one session each get their own row and stage count, no cross-row bleed', () => {
    // Session A: dropset#1 has 3 stages, dropset#2 has 1 stage.
    const aP = makeLog({ id: 'a-plain', setNumber: 1, weight: 10 })
    const aD1Head = makeLog({ id: 'a-d1-head', setNumber: 2, weight: 100 })
    const aD1S1 = makeLog({ id: 'a-d1-s1', setNumber: 2, stageIndex: 1, parentSetId: 'a-d1-head', weight: 90 })
    const aD1S2 = makeLog({ id: 'a-d1-s2', setNumber: 2, stageIndex: 2, parentSetId: 'a-d1-head', weight: 80 })
    const aD1S3 = makeLog({ id: 'a-d1-s3', setNumber: 2, stageIndex: 3, parentSetId: 'a-d1-head', weight: 70 })
    const aD2Head = makeLog({ id: 'a-d2-head', setNumber: 3, weight: 200 })
    const aD2S1 = makeLog({ id: 'a-d2-s1', setNumber: 3, stageIndex: 1, parentSetId: 'a-d2-head', weight: 190 })
    const a = session({
      sessionId: 'a',
      date: '2026-01-01',
      logs: [aP, aD1Head, aD1S1, aD1S2, aD1S3, aD2Head, aD2S1],
    })

    // Session B: dropset#1 has 1 stage, dropset#2 has 3 stages — the exact inverse shape.
    const bD1Head = makeLog({ id: 'b-d1-head', setNumber: 1, weight: 105 })
    const bD1S1 = makeLog({ id: 'b-d1-s1', setNumber: 1, stageIndex: 1, parentSetId: 'b-d1-head', weight: 95 })
    const bD2Head = makeLog({ id: 'b-d2-head', setNumber: 2, weight: 205 })
    const bD2S1 = makeLog({ id: 'b-d2-s1', setNumber: 2, stageIndex: 1, parentSetId: 'b-d2-head', weight: 195 })
    const bD2S2 = makeLog({ id: 'b-d2-s2', setNumber: 2, stageIndex: 2, parentSetId: 'b-d2-head', weight: 185 })
    const bD2S3 = makeLog({ id: 'b-d2-s3', setNumber: 2, stageIndex: 3, parentSetId: 'b-d2-head', weight: 175 })
    const b = session({
      sessionId: 'b',
      date: '2026-01-08',
      logs: [bD1Head, bD1S1, bD2Head, bD2S1, bD2S2, bD2S3],
    })

    const table = buildPositionMatchTable([a, b])

    expect(table.dropsets).toHaveLength(2)

    // Row 1 (1st dropset logged each session): A's 3-stage vs B's 1-stage —
    // row's stage count is the max (3), not the *other* row's count (also 3,
    // which would mask a cross-row mixup), so assert head+stage values directly.
    const row1 = table.dropsets[0]
    expect(row1.head.cells.map((c) => c.value?.weight)).toEqual([100, 105])
    expect(row1.stages).toHaveLength(3)
    expect(row1.stages[0].cells.map((c) => c.value?.weight)).toEqual([90, 95])
    expect(row1.stages[1].cells.map((c) => c.value?.weight)).toEqual([80, undefined])
    expect(row1.stages[1].cells[1].value).toBeNull()
    expect(row1.stages[2].cells.map((c) => c.value?.weight)).toEqual([70, undefined])
    expect(row1.stages[2].cells[1].value).toBeNull()

    // Row 2 (2nd dropset logged each session): A's 1-stage vs B's 3-stage —
    // the inverse shape, must not pick up row 1's values or stage count.
    const row2 = table.dropsets[1]
    expect(row2.head.cells.map((c) => c.value?.weight)).toEqual([200, 205])
    expect(row2.stages).toHaveLength(3)
    expect(row2.stages[0].cells.map((c) => c.value?.weight)).toEqual([190, 195])
    expect(row2.stages[1].cells[0].value).toBeNull()
    expect(row2.stages[1].cells[1].value?.weight).toBe(185)
    expect(row2.stages[2].cells[0].value).toBeNull()
    expect(row2.stages[2].cells[1].value?.weight).toBe(175)

    // The lone plain set is unaffected by any of this.
    expect(table.plain).toHaveLength(1)
    expect(table.plain[0].cells[0].value?.weight).toBe(10)
    expect(table.plain[0].cells[1].value).toBeNull()
  })
})
