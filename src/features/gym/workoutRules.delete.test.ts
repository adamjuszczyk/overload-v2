import { describe, expect, it } from 'vitest'
import { deleteEffects } from './workoutRules'
import { groupSetLogs } from './setGroupLogic'
import { addedLog, deepFreeze, dropLog, headLog } from './workoutRules.testutil'
import type { SetLog } from '../../types'

// Chunk 46: deleting a logged set (SPEC [1.2] "Delete set (18b)"; TASKS: "the delete order (stages
// descending, then the head) and the renumbering of later heads and their stages, fixing F4's stale stage
// numbers"). The caller applies what comes back; these tests read it as data.

// Bench with four heads. Head 3 has one drop, head 4 has two; every drop carries its head's number, as the
// app writes it.
function benchFour() {
  const heads = [1, 2, 3, 4].map((n) => headLog('bench', n, { number: n, stageKind: n >= 3 ? 'dropset' : null }))
  const drops = [dropLog(heads[2], 1), dropLog(heads[3], 1), dropLog(heads[3], 2)]
  const logs = [...heads, ...drops]
  const groups = groupSetLogs(logs)
  const group = (n: number) => groups.find((g) => g.head.setNumber === n)!
  return { heads, drops, logs, groups, group }
}

describe('deleteEffects: the order of the deletes', () => {
  it('the drops from the last, then the head (a failure partway leaves a head with fewer drops, never orphans)', () => {
    const { group, groups } = benchFour()
    const effects = deleteEffects(group(4), groups)
    expect(effects.deleteOrder.map((l) => l.id)).toEqual(['log.bench.4.d2', 'log.bench.4.d1', 'log.bench.4'])
    expect(effects.stageCount).toBe(2)
  })

  it('a head with no drops is deleted alone and says no drop goes with it', () => {
    const { group, groups } = benchFour()
    const effects = deleteEffects(group(2), groups)
    expect(effects.deleteOrder.map((l) => l.id)).toEqual(['log.bench.2'])
    expect(effects.stageCount).toBe(0)
  })
})

describe('deleteEffects: the sets after it close the gap', () => {
  it('deleting head 02 of 04 renumbers 03 to 02 and 04 to 03, and their drops with them (F4)', () => {
    const { group, groups } = benchFour()
    expect(deleteEffects(group(2), groups).renumber).toEqual([
      { id: 'log.bench.3', setNumber: 2 },
      { id: 'log.bench.3.d1', setNumber: 2 },
      { id: 'log.bench.4', setNumber: 3 },
      { id: 'log.bench.4.d1', setNumber: 3 },
      { id: 'log.bench.4.d2', setNumber: 3 },
    ])
  })

  it('the head deleted is not renumbered, nor are the sets before it; deleting the last renumbers nothing', () => {
    const { group, groups } = benchFour()
    expect(deleteEffects(group(4), groups).renumber).toEqual([])
    const first = deleteEffects(group(1), groups).renumber
    expect(first.map((r) => r.id)).not.toContain('log.bench.1')
    expect(first.filter((r) => r.id.startsWith('log.bench.2'))).toEqual([{ id: 'log.bench.2', setNumber: 1 }])
  })

  it('closes a gap in the numbers, not just by one: heads 1, 2, 5 after deleting 2 become 1, 2', () => {
    const heads = [headLog('bench', 1, { number: 1 }), headLog('bench', 2, { number: 2 }), headLog('bench', 3, { number: 5 })]
    const groups = groupSetLogs(heads)
    expect(deleteEffects(groups[1], groups).renumber).toEqual([{ id: 'log.bench.3', setNumber: 2 }])
  })

  it('a head that already has its new number is left alone but its stale drops are put right', () => {
    // two heads numbered 3 (a bug's leftovers): after the delete the first becomes 2, the second keeps 3, its drop says 9
    const gone = headLog('bench', 1, { number: 2 })
    const a = headLog('bench', 2, { number: 3 })
    const b = headLog('bench', 3, { number: 3, stageKind: 'dropset' })
    const stale = dropLog(b, 1, { number: 9 })
    const groups = groupSetLogs([gone, a, b, stale])
    expect(deleteEffects(groups[0], groups).renumber).toEqual([
      { id: 'log.bench.2', setNumber: 2 },
      { id: stale.id, setNumber: 3 },
    ])
  })

  it('a drop that already carries its head\'s new number is not written again', () => {
    const gone = headLog('bench', 1, { number: 1 })
    const next = headLog('bench', 2, { number: 2, stageKind: 'dropset' })
    const drop = dropLog(next, 1, { number: 1 }) // already says 1, what its head is about to become
    const groups = groupSetLogs([gone, next, drop])
    expect(deleteEffects(groups[0], groups).renumber).toEqual([{ id: 'log.bench.2', setNumber: 1 }])
  })

  it('takes the sets after it in the order of their numbers, whatever order they are given in', () => {
    const heads = [1, 2, 3, 4].map((n) => headLog('bench', n, { number: n }))
    const groups = groupSetLogs(heads).reverse()
    const first = groups.find((g) => g.head.setNumber === 1)!
    expect(deleteEffects(first, groups).renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
      { id: 'log.bench.4', setNumber: 3 },
    ])
  })

  it('only the same exercise\'s sets are renumbered', () => {
    const bench = [headLog('bench', 1, { number: 1 }), headLog('bench', 2, { number: 2 })]
    const row = [headLog('row', 1, { number: 5 }), headLog('row', 2, { number: 6 })]
    const groups = groupSetLogs([...bench, ...row])
    expect(deleteEffects(groups[0], groups).renumber).toEqual([{ id: 'log.bench.2', setNumber: 1 }])
  })

  it('a skipped set is renumbered like any other (it has a number)', () => {
    const heads = [headLog('bench', 1), headLog('bench', 2, { skipped: true }), headLog('bench', 3)]
    const groups = groupSetLogs(heads)
    expect(deleteEffects(groups[0], groups).renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.3', setNumber: 2 },
    ])
  })

  it('a set added in the session is a head like any other', () => {
    const logs = [headLog('bench', 1), headLog('bench', 2), addedLog('bench', 1, { number: 3 })]
    const groups = groupSetLogs(logs)
    expect(deleteEffects(groups[0], groups).renumber).toEqual([
      { id: 'log.bench.2', setNumber: 1 },
      { id: 'log.bench.added1', setNumber: 2 },
    ])
  })
})

describe('deleteEffects: what renumbers nothing', () => {
  it('a warmup — it is not numbered with the working sets — and the warmups when a working set goes', () => {
    const warm = headLog('bench', 1, { warmup: true, number: 1 })
    const warm2 = headLog('bench', 2, { warmup: true, number: 2 })
    const work = [headLog('bench', 3, { number: 1 }), headLog('bench', 4, { number: 2 })]
    const groups = groupSetLogs([warm, warm2, ...work])
    expect(deleteEffects(groups[0], groups).renumber).toEqual([])
    expect(deleteEffects(groups[2], groups).renumber).toEqual([{ id: 'log.bench.4', setNumber: 1 }])
  })

  it('a drop deleted on its own: just that log (its number is its head\'s, and the sets after the head keep theirs)', () => {
    const { drops, groups } = benchFour()
    const lone = { head: drops[0], stages: [] as SetLog[] }
    const effects = deleteEffects(lone, groups)
    expect(effects.deleteOrder.map((l) => l.id)).toEqual([drops[0].id])
    expect(effects.renumber).toEqual([])
    expect(effects.stageCount).toBe(0)
  })

  it('reads and writes nothing it is handed', () => {
    const { logs } = benchFour()
    const frozen = deepFreeze(logs)
    const groups = groupSetLogs(frozen as SetLog[])
    const first = deleteEffects(groups[1], groups)
    expect(deleteEffects(groups[1], groups)).toEqual(first)
    expect(groups.map((g) => g.head.setNumber)).toEqual([1, 2, 3, 4])
  })
})
