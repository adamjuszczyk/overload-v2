import { describe, it, expect } from 'vitest'
import { planWarmupInsert, type WarmupInsertRow } from './warmupInsert'

function head(id: string, setNumber: number, isWarmup = false): WarmupInsertRow {
  return { id, setNumber, isWarmup, isStage: false }
}
function stage(id: string, setNumber: number): WarmupInsertRow {
  return { id, setNumber, isWarmup: false, isStage: true }
}

describe('planWarmupInsert — a warmup goes above the first working set', () => {
  it('no sets yet: takes number 1, nothing moves', () => {
    expect(planWarmupInsert([])).toEqual({ insertAt: 1, shifts: [] })
  })

  it('three working sets: the warmup takes 1 and every set moves down one, highest first', () => {
    const plan = planWarmupInsert([head('a', 1), head('b', 2), head('c', 3)])
    expect(plan.insertAt).toBe(1)
    expect(plan.shifts).toEqual([
      { id: 'c', setNumber: 4 },
      { id: 'b', setNumber: 3 },
      { id: 'a', setNumber: 2 },
    ])
  })

  it('existing warmups stay on top: the new one lands after them, above the first working set', () => {
    const plan = planWarmupInsert([head('w1', 1, true), head('a', 2), head('b', 3)])
    expect(plan.insertAt).toBe(2)
    expect(plan.shifts).toEqual([
      { id: 'b', setNumber: 4 },
      { id: 'a', setNumber: 3 },
    ])
  })

  it('a staged head moves together with its stages (they share its number)', () => {
    const plan = planWarmupInsert([head('a', 1), stage('a-s1', 1), stage('a-s2', 1), head('b', 2)])
    expect(plan.insertAt).toBe(1)
    expect(plan.shifts.filter((s) => s.setNumber === 2).map((s) => s.id).sort()).toEqual(['a', 'a-s1', 'a-s2'])
    expect(plan.shifts.find((s) => s.id === 'b')).toEqual({ id: 'b', setNumber: 3 })
  })

  it('only warmups so far: the new one follows them, nothing moves', () => {
    expect(planWarmupInsert([head('w1', 1, true), head('w2', 2, true)])).toEqual({ insertAt: 3, shifts: [] })
  })

  it('gapped numbers (a deleted middle set): the insert point is the first working set\'s own number', () => {
    const plan = planWarmupInsert([head('a', 2), head('b', 5)])
    expect(plan.insertAt).toBe(2)
    expect(plan.shifts).toEqual([
      { id: 'b', setNumber: 6 },
      { id: 'a', setNumber: 3 },
    ])
  })

  it('input order does not matter', () => {
    const a = planWarmupInsert([head('b', 2), head('w', 1, true), head('c', 3)])
    const b = planWarmupInsert([head('c', 3), head('w', 1, true), head('b', 2)])
    expect(a).toEqual(b)
    expect(a.insertAt).toBe(2)
  })
})
