import { describe, it, expect } from 'vitest'
import { buildLoggedSlots, matchSessionsByPosition, type PositionMatchSessionInput } from './positionMatch'
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

// ─── matchSessionsByPosition (steps 2–5) ────────────────────────────────────

describe('matchSessionsByPosition — slot count truncation (step 2)', () => {
  it('matches up to the shorter session, reporting the extra slots without comparing them', () => {
    const a = session({
      sessionId: 'a',
      logs: [1, 2, 3].map((n) => makeLog({ id: `a-${n}`, setNumber: n, weight: 100 })),
    })
    const b = session({
      sessionId: 'b',
      logs: [1, 2].map((n) => makeLog({ id: `b-${n}`, setNumber: n, weight: 110 })),
    })
    const result = matchSessionsByPosition(a, b)

    expect(result.slotCountA).toBe(3)
    expect(result.slotCountB).toBe(2)
    expect(result.matchedSlotCount).toBe(2)
    expect(result.extraSlotsA).toBe(1)
    expect(result.extraSlotsB).toBe(0)
    expect(result.slots).toHaveLength(2)
    expect(result.slots[0].head.deltaPercent).not.toBeNull()
  })
})

describe('matchSessionsByPosition — dropset shape mismatch (step 3)', () => {
  it('compares heads only and flags the mismatch when one side is a dropset and the other is plain', () => {
    const dropHead = makeLog({ id: 'a-head', setNumber: 1, weight: 100 })
    const dropStage = makeLog({ id: 'a-stage', setNumber: 1, stageIndex: 1, parentSetId: 'a-head', weight: 70 })
    const a = session({ sessionId: 'a', logs: [dropHead, dropStage] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1, weight: 105 })] })

    const result = matchSessionsByPosition(a, b)

    expect(result.slots).toHaveLength(1)
    const slot = result.slots[0]
    expect(slot.isDropsetA).toBe(true)
    expect(slot.isDropsetB).toBe(false)
    expect(slot.shapeMismatch).toBe(true)
    expect(slot.stages).toEqual([])
    expect(slot.extraStagesA).toBe(0)
    expect(slot.extraStagesB).toBe(0)
    // Head-only comparison still runs despite the mismatch.
    expect(slot.head.a.weight).toBe(100)
    expect(slot.head.b.weight).toBe(105)
    expect(slot.head.deltaPercent).not.toBeNull()
  })

  it('does not flag a mismatch when both sides are plain sets', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1 })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.slots[0].shapeMismatch).toBe(false)
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

    expect(result.slots).toHaveLength(1)
    const slot = result.slots[0]
    expect(slot.shapeMismatch).toBe(false)
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

    const slot = result.slots[0]
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
    expect(result.slots[0].head.deltaPercent).toBeCloseTo(((e1rmB - e1rmA) / e1rmA) * 100, 5)
  })

  it('is null when either side has no RIR recorded — does not default to rir=0', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, rir: null })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1, rir: 2 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.slots[0].head.e1rmA).toBeNull()
    expect(result.slots[0].head.e1rmB).not.toBeNull()
    expect(result.slots[0].head.deltaPercent).toBeNull()
  })

  it('is null for a warmup item on either side', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, isWarmup: true })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.slots[0].head.e1rmA).toBeNull()
    expect(result.slots[0].head.deltaPercent).toBeNull()
  })

  it('still reports raw weight/reps/rir for an ineligible item, just no e1RM/delta', () => {
    const a = session({ sessionId: 'a', logs: [makeLog({ id: 'a-1', setNumber: 1, weight: 90, reps: 12, rir: null })] })
    const b = session({ sessionId: 'b', logs: [makeLog({ id: 'b-1', setNumber: 1 })] })
    const result = matchSessionsByPosition(a, b)
    expect(result.slots[0].head.a).toEqual({ weight: 90, reps: 12, rir: null, isWarmup: false })
    expect(result.slots[0].head.e1rmA).toBeNull()
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
    expect(result.slots).toHaveLength(2)
    expect(result.slots[0].head.deltaPercent).not.toEqual(result.slots[1].head.deltaPercent)
    // No averaged/rolled-up field anywhere on the result.
    expect(result).not.toHaveProperty('deltaPercent')
    expect(result).not.toHaveProperty('avgDeltaPercent')
  })
})
