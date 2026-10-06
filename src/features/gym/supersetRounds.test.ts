import { describe, it, expect } from 'vitest'
import { buildSupersetRounds, zigzagOrder } from './supersetRounds'

describe('buildSupersetRounds', () => {
  it('round 1 = A1, B1, C1; round 2 = A2, B2, C2 (SPEC "Supersets") for equal counts', () => {
    const rounds = buildSupersetRounds([
      ['A1', 'A2'],
      ['B1', 'B2'],
      ['C1', 'C2'],
    ])
    expect(rounds).toEqual([
      { roundNumber: 1, cells: [{ memberIndex: 0, head: 'A1' }, { memberIndex: 1, head: 'B1' }, { memberIndex: 2, head: 'C1' }] },
      { roundNumber: 2, cells: [{ memberIndex: 0, head: 'A2' }, { memberIndex: 1, head: 'B2' }, { memberIndex: 2, head: 'C2' }] },
    ])
  })

  it('unequal counts: 4 of A, 3 of B → 4 rounds, round 4 holds only A (SPEC example)', () => {
    const rounds = buildSupersetRounds([
      ['A1', 'A2', 'A3', 'A4'],
      ['B1', 'B2', 'B3'],
    ])
    expect(rounds).toHaveLength(4)
    expect(rounds[3]).toEqual({ roundNumber: 4, cells: [{ memberIndex: 0, head: 'A4' }] })
    // Every earlier round still has both members, in member order.
    expect(rounds[0].cells.map((c) => c.head)).toEqual(['A1', 'B1'])
    expect(rounds[2].cells.map((c) => c.head)).toEqual(['A3', 'B3'])
  })

  it('a round can have an empty slot in the middle, not just at the tail', () => {
    // B has no 2nd set at all (e.g. a member with just one working set).
    const rounds = buildSupersetRounds([
      ['A1', 'A2'],
      ['B1'],
      ['C1', 'C2'],
    ])
    expect(rounds[1].cells.map((c) => c.memberIndex)).toEqual([0, 2]) // B (index 1) absent from round 2
  })

  it('no members → no rounds', () => {
    expect(buildSupersetRounds([])).toEqual([])
  })

  it('a member with zero heads contributes no cells but does not block other rounds', () => {
    const rounds = buildSupersetRounds([['A1', 'A2'], []])
    expect(rounds).toHaveLength(2)
    expect(rounds[0].cells).toEqual([{ memberIndex: 0, head: 'A1' }])
    expect(rounds[1].cells).toEqual([{ memberIndex: 0, head: 'A2' }])
  })
})

describe('zigzagOrder', () => {
  it('flattens round-major: A1 → B1 → A2 → B2 (SPEC "Supersets")', () => {
    const rounds = buildSupersetRounds([
      ['A1', 'A2'],
      ['B1', 'B2'],
    ])
    expect(zigzagOrder(rounds)).toEqual([
      { memberIndex: 0, head: 'A1' },
      { memberIndex: 1, head: 'B1' },
      { memberIndex: 0, head: 'A2' },
      { memberIndex: 1, head: 'B2' },
    ])
  })

  it('unequal counts: zigzag still skips the missing B4 cell entirely (4 of A, 3 of B)', () => {
    const rounds = buildSupersetRounds([
      ['A1', 'A2', 'A3', 'A4'],
      ['B1', 'B2', 'B3'],
    ])
    expect(zigzagOrder(rounds).map((c) => c.head)).toEqual([
      'A1', 'B1', 'A2', 'B2', 'A3', 'B3', 'A4',
    ])
  })

  it('empty rounds list → empty order', () => {
    expect(zigzagOrder([])).toEqual([])
  })
})
