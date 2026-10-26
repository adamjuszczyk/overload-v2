import { describe, expect, it } from 'vitest'
import type { SetLog } from '../../types'
import { finishTiles, finishTitle, isReopened } from './finishView'
import { countCompletedSets } from './countCompletedSets'

// Chunk 64 — what the finish screen's tiles, title and variant say (boards W18, W19; SPEC G51: "the finish screen count[s] as [it does] today").

const log = (id: string, over: Partial<SetLog> = {}): SetLog => ({
  id, userId: 'u1', sessionId: 's1', exerciseId: 'ex-1', weekPlanSetId: null, setNumber: 1, weight: 60, reps: 8, rir: null, note: null, isDropset: false,
  parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false, loggedAt: '2026-01-05T10:00:00Z', restSeconds: null,
  formRating: null, stageKind: null, addedPlace: null, ...over,
})

describe('finishTiles', () => {
  // four working sets done, a drop of one of them, one working set skipped, two warmups done and one skipped: the old SETS LOGGED would have read 7
  const logs = [
    log('a'), log('b'), log('c'), log('d'),
    log('d1', { parentSetId: 'd', isDropset: true, stageIndex: 1 }),
    log('s', { isSkipped: true, weight: null, reps: null }),
    log('w1', { isWarmup: true }), log('w2', { isWarmup: true }),
    log('w3', { isWarmup: true, isSkipped: true, weight: null, reps: null }),
  ]

  it('WORKING SETS and SKIPPED are `countCompletedSets` (no warmup in either, a drop counted as today), WARMUPS the warmups done', () => {
    expect(finishTiles(logs)).toEqual({ working: 5, skipped: 1, warmups: 2 })
    expect(finishTiles(logs)).toMatchObject({ working: countCompletedSets(logs).total, skipped: countCompletedSets(logs).skipped })
  })

  it('a session with no logs reads 0, 0, 0', () => {
    expect(finishTiles([])).toEqual({ working: 0, skipped: 0, warmups: 0 })
  })

  it('does not depend on the order of the logs', () => {
    expect(finishTiles([...logs].reverse())).toEqual(finishTiles(logs))
  })
})

describe('isReopened', () => {
  it('a session that carries a note or a rating from an earlier COMPLETE is a reopened one; one with none of the three is not', () => {
    expect(isReopened({ note: null, energyRating: null, pumpRating: null })).toBe(false)
    expect(isReopened({ note: '', energyRating: null, pumpRating: null })).toBe(false)
    expect(isReopened({ note: 'Grip went.', energyRating: null, pumpRating: null })).toBe(true)
    expect(isReopened({ note: null, energyRating: 'none', pumpRating: null })).toBe(true) // 'none' is rated (TASKS §7.3), not "not rated"
    expect(isReopened({ note: null, energyRating: null, pumpRating: 'good' })).toBe(true)
  })

  it('a session that is not loaded yet is not a reopened one', () => {
    expect(isReopened(undefined)).toBe(false)
  })
})

describe('finishTitle', () => {
  it('"FINISH PULL 1" (board W18): the workout\'s name in capitals', () => {
    expect(finishTitle('Pull 1')).toBe('FINISH PULL 1')
    expect(finishTitle('Upper A')).toBe('FINISH UPPER A')
  })
})
