import { describe, it, expect } from 'vitest'
import {
  buildLoggedSlots,
  matchSessionsByPosition,
  averagePositionMatchedDelta,
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
