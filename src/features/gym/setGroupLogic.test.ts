import { describe, it, expect } from 'vitest'
import { groupSetLogs, groupWeekPlanSets, headsOnly, cascadeDeleteOrder, nextStageIndex, canAddStageTo } from './setGroupLogic'
import type { SetLog, WeekPlanSet } from '../../types'

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

function makePlanSet(overrides: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'plan-id',
    weekPlanId: 'wp1',
    userId: 'u1',
    programExerciseId: 'pe1',
    setNumber: 1,
    targetRir: 2,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
    ...overrides,
  }
}

describe('groupSetLogs', () => {
  it('groups a 3-stage dropset under its head', () => {
    const head = makeLog({ id: 'head', setNumber: 1, stageIndex: 0, parentSetId: null })
    const s1 = makeLog({ id: 's1', setNumber: 1, stageIndex: 1, parentSetId: 'head', isDropset: true, weight: 80 })
    const s2 = makeLog({ id: 's2', setNumber: 1, stageIndex: 2, parentSetId: 'head', isDropset: true, weight: 60 })
    const s3 = makeLog({ id: 's3', setNumber: 1, stageIndex: 3, parentSetId: 'head', isDropset: true, weight: 40 })

    const groups = groupSetLogs([head, s1, s2, s3])

    expect(groups).toHaveLength(1)
    expect(groups[0].head.id).toBe('head')
    expect(groups[0].stages.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('orders stages by stageIndex regardless of input order', () => {
    const head = makeLog({ id: 'head', parentSetId: null })
    const s3 = makeLog({ id: 's3', stageIndex: 3, parentSetId: 'head' })
    const s1 = makeLog({ id: 's1', stageIndex: 1, parentSetId: 'head' })
    const s2 = makeLog({ id: 's2', stageIndex: 2, parentSetId: 'head' })

    const groups = groupSetLogs([head, s3, s1, s2])

    expect(groups[0].stages.map((s) => s.id)).toEqual(['s1', 's2', 's3'])
  })

  it('treats undefined stageIndex as 0 (pre-migration cached rows)', () => {
    const head = makeLog({ id: 'head', parentSetId: null })
    const legacyStage = makeLog({ id: 'legacy', parentSetId: 'head', stageIndex: undefined as unknown as number })
    const realStage = makeLog({ id: 'real', parentSetId: 'head', stageIndex: 1 })

    const groups = groupSetLogs([head, legacyStage, realStage])

    // undefined sorts as 0, so it comes before stageIndex 1
    expect(groups[0].stages.map((s) => s.id)).toEqual(['legacy', 'real'])
  })

  it('keeps independent heads as separate groups, each with only its own stages', () => {
    const headA = makeLog({ id: 'headA', setNumber: 1, parentSetId: null })
    const stageA = makeLog({ id: 'stageA', setNumber: 1, stageIndex: 1, parentSetId: 'headA' })
    const headB = makeLog({ id: 'headB', setNumber: 2, parentSetId: null })

    const groups = groupSetLogs([headA, stageA, headB])

    expect(groups).toHaveLength(2)
    const groupA = groups.find((g) => g.head.id === 'headA')!
    const groupB = groups.find((g) => g.head.id === 'headB')!
    expect(groupA.stages.map((s) => s.id)).toEqual(['stageA'])
    expect(groupB.stages).toEqual([])
  })

  it('a plain session with no dropsets produces one group per set, all with empty stages', () => {
    const rows = [1, 2, 3].map((n) => makeLog({ id: `set-${n}`, setNumber: n, parentSetId: null }))
    const groups = groupSetLogs(rows)
    expect(groups).toHaveLength(3)
    for (const g of groups) expect(g.stages).toEqual([])
  })
})

describe('groupWeekPlanSets', () => {
  it('groups plan-side stages the same way as log-side', () => {
    const head = makePlanSet({ id: 'head', setNumber: 1, parentWeekPlanSetId: null })
    const stage = makePlanSet({ id: 'stage', setNumber: 1, stageIndex: 1, parentWeekPlanSetId: 'head', isDropset: true })

    const groups = groupWeekPlanSets([head, stage])

    expect(groups).toHaveLength(1)
    expect(groups[0].stages.map((s) => s.id)).toEqual(['stage'])
  })
})

describe('headsOnly', () => {
  it('counts a 3-stage dropset as one set, not three (§2.7 item 1)', () => {
    const head = makeLog({ id: 'head', parentSetId: null })
    const s1 = makeLog({ id: 's1', parentSetId: 'head' })
    const s2 = makeLog({ id: 's2', parentSetId: 'head' })
    const rows = [head, s1, s2]

    expect(headsOnly(rows, (l) => l.parentSetId)).toHaveLength(1)
  })

  it('matches the flat count when there are no dropsets at all', () => {
    const rows = [1, 2, 3].map((n) => makeLog({ id: `set-${n}`, parentSetId: null }))
    expect(headsOnly(rows, (l) => l.parentSetId)).toHaveLength(3)
  })
})

describe('cascadeDeleteOrder', () => {
  it('orders stages first, descending stage_index, head last', () => {
    const head = makeLog({ id: 'head', parentSetId: null })
    const s1 = makeLog({ id: 's1', stageIndex: 1, parentSetId: 'head' })
    const s2 = makeLog({ id: 's2', stageIndex: 2, parentSetId: 'head' })
    const s3 = makeLog({ id: 's3', stageIndex: 3, parentSetId: 'head' })

    const groups = groupSetLogs([head, s1, s2, s3])
    const order = cascadeDeleteOrder(groups[0], (l) => l.stageIndex)

    expect(order.map((l) => l.id)).toEqual(['s3', 's2', 's1', 'head'])
  })

  it('is exactly [head] when the group has no stages', () => {
    const head = makeLog({ id: 'head', parentSetId: null })
    const groups = groupSetLogs([head])
    const order = cascadeDeleteOrder(groups[0], (l) => l.stageIndex)
    expect(order.map((l) => l.id)).toEqual(['head'])
  })

  it('never puts the head anywhere but last, for any stage count', () => {
    const head = makeLog({ id: 'head', parentSetId: null })
    const stages = [1, 2, 3, 4, 5].map((n) =>
      makeLog({ id: `s${n}`, stageIndex: n, parentSetId: 'head' }),
    )
    const groups = groupSetLogs([head, ...stages])
    const order = cascadeDeleteOrder(groups[0], (l) => l.stageIndex)

    expect(order[order.length - 1].id).toBe('head')
    expect(order.length).toBe(stages.length + 1)
    // Every non-head entry must precede the head, and be in descending order.
    const stageIds = order.slice(0, -1).map((l) => l.id)
    expect(stageIds).toEqual(['s5', 's4', 's3', 's2', 's1'])
  })
})

describe('nextStageIndex', () => {
  it('is 1 for a head with no stages yet', () => {
    const head = makeLog({ id: 'head', parentSetId: null })
    const groups = groupSetLogs([head])
    expect(nextStageIndex(groups[0], (l) => l.stageIndex)).toBe(1)
  })

  it('is max(existing) + 1, not length + 1, after a non-last stage is deleted', () => {
    // Stages 1, 2, 3 existed; stage 2 was deleted, leaving [1, 3].
    // length is 2, but stage_index 3 is taken — the next free index is 4.
    const head = makeLog({ id: 'head', parentSetId: null })
    const s1 = makeLog({ id: 's1', stageIndex: 1, parentSetId: 'head' })
    const s3 = makeLog({ id: 's3', stageIndex: 3, parentSetId: 'head' })
    const groups = groupSetLogs([head, s1, s3])

    expect(nextStageIndex(groups[0], (l) => l.stageIndex)).toBe(4)
  })

  it('increments by exactly 1 for the normal no-deletion case', () => {
    const head = makeLog({ id: 'head', parentSetId: null })
    const s1 = makeLog({ id: 's1', stageIndex: 1, parentSetId: 'head' })
    const s2 = makeLog({ id: 's2', stageIndex: 2, parentSetId: 'head' })
    const groups = groupSetLogs([head, s1, s2])

    expect(nextStageIndex(groups[0], (l) => l.stageIndex)).toBe(3)
  })
})

// Found by adversarial review (2026-08-13/14): SetGroup.tsx's ADD STAGE /
// "mark as dropset" affordance had no isSkipped check at all — a skipped
// head could still receive a new stage. Real account instance: a
// 2026-07-16 session (see CONTEXT.md).
describe('canAddStageTo', () => {
  it('is true for a normally-logged (not skipped) head', () => {
    expect(canAddStageTo({ isSkipped: false })).toBe(true)
  })

  it('is false for a skipped head — the exact gap this fix closes', () => {
    expect(canAddStageTo({ isSkipped: true })).toBe(false)
  })
})
