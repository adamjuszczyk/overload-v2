import { describe, it, expect } from 'vitest'
import { toRuns } from './compactPlanLogic'
import type { WeekPlanSet } from '../../types'
import type { SetGroup as Group } from '../gym/setGroupLogic'

function makeGroup(headOverrides: Partial<WeekPlanSet>, stageCount = 0): Group<WeekPlanSet> {
  const head: WeekPlanSet = {
    id: 'head-id',
    weekPlanId: 'wp1',
    userId: 'u1',
    programExerciseId: 'pe1',
    setNumber: 1,
    targetRir: 2,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
    ...headOverrides,
  }
  const stages: WeekPlanSet[] = Array.from({ length: stageCount }, (_, i) => ({
    ...head,
    id: `${head.id}-stage-${i + 1}`,
    isDropset: true,
    parentWeekPlanSetId: head.id,
    stageIndex: i + 1,
  }))
  return { head, stages }
}

describe('toRuns', () => {
  it('collapses consecutive plain sets into a single run', () => {
    const groups = [1, 2, 3].map((n) => makeGroup({ id: `s${n}`, setNumber: n }))
    expect(toRuns(groups)).toEqual([{ count: 3, stageCount: 0 }])
  })

  it('renders a dropset as its own single-count run with its stage count', () => {
    const groups = [makeGroup({ id: 'head' }, 2)]
    expect(toRuns(groups)).toEqual([{ count: 1, stageCount: 2 }])
  })

  it('preserves true set order — a dropset between two plain sets stays between them, not pushed after both', () => {
    // Phase 3.7 adversarial review's exact failure scenario: plain(1),
    // dropset(2, 2 stages), plain(3). The old implementation (partition
    // into all-plain-then-all-dropsets) rendered "2× Name" then
    // "1× Name +2 stages" — implying the dropset happened last, when it
    // actually happened second. toRuns must keep the true order.
    const groups = [
      makeGroup({ id: 's1', setNumber: 1 }),
      makeGroup({ id: 's2', setNumber: 2 }, 2),
      makeGroup({ id: 's3', setNumber: 3 }),
    ]
    expect(toRuns(groups)).toEqual([
      { count: 1, stageCount: 0 },
      { count: 1, stageCount: 2 },
      { count: 1, stageCount: 0 },
    ])
  })

  it('never merges two adjacent dropsets into one entry, even with equal stage counts', () => {
    const groups = [
      makeGroup({ id: 's1', setNumber: 1 }, 1),
      makeGroup({ id: 's2', setNumber: 2 }, 1),
    ]
    expect(toRuns(groups)).toEqual([
      { count: 1, stageCount: 1 },
      { count: 1, stageCount: 1 },
    ])
  })

  it('resumes a fresh plain run after a dropset interrupts an earlier one', () => {
    const groups = [
      makeGroup({ id: 's1', setNumber: 1 }),
      makeGroup({ id: 's2', setNumber: 2 }),
      makeGroup({ id: 's3', setNumber: 3 }, 1),
      makeGroup({ id: 's4', setNumber: 4 }),
      makeGroup({ id: 's5', setNumber: 5 }),
    ]
    expect(toRuns(groups)).toEqual([
      { count: 2, stageCount: 0 },
      { count: 1, stageCount: 1 },
      { count: 2, stageCount: 0 },
    ])
  })

  it('returns an empty list for an empty groups array', () => {
    expect(toRuns([])).toEqual([])
  })
})
