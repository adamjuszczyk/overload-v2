import { describe, it, expect } from 'vitest'
import { groupIntoUnits, moveUnit, isLinkedGap, planLinkToggle, type SupersetLinkable } from './supersetGroups'

function item(id: string, supersetBlockId: string | null = null): SupersetLinkable {
  return { id, supersetBlockId }
}

describe('groupIntoUnits', () => {
  it('no grouping at all → every item its own unit', () => {
    const items = [item('a'), item('b'), item('c')]
    expect(groupIntoUnits(items)).toEqual([[items[0]], [items[1]], [items[2]]])
  })

  it('a contiguous run sharing one block id becomes one unit', () => {
    const items = [item('a', 'blk-1'), item('b', 'blk-1'), item('c')]
    const units = groupIntoUnits(items)
    expect(units).toHaveLength(2)
    expect(units[0]).toEqual([items[0], items[1]])
    expect(units[1]).toEqual([items[2]])
  })

  it('any number of exercises: a 4-member run is one unit', () => {
    const items = [item('a', 'blk'), item('b', 'blk'), item('c', 'blk'), item('d', 'blk')]
    expect(groupIntoUnits(items)).toEqual([items])
  })

  it('two different blocks stay two separate units even when adjacent', () => {
    const items = [item('a', 'blk-1'), item('b', 'blk-1'), item('c', 'blk-2'), item('d', 'blk-2')]
    const units = groupIntoUnits(items)
    expect(units).toEqual([[items[0], items[1]], [items[2], items[3]]])
  })

  it('undefined supersetBlockId behaves exactly like null (pre-chunk-13 fixtures)', () => {
    const items: SupersetLinkable[] = [{ id: 'a' }, { id: 'b' }]
    expect(groupIntoUnits(items)).toEqual([[items[0]], [items[1]]])
  })
})

describe('moveUnit', () => {
  it('no grouping: moving index 1 up swaps it with index 0 (today\'s plain adjacent-swap behaviour)', () => {
    const items = [item('a'), item('b'), item('c')]
    expect(moveUnit(items, 1, 'up')).toEqual([items[1], items[0], items[2]])
  })

  it('no grouping: moving index 1 down swaps it with index 2', () => {
    const items = [item('a'), item('b'), item('c')]
    expect(moveUnit(items, 1, 'down')).toEqual([items[0], items[2], items[1]])
  })

  it('at the top edge, moving up is a no-op (same array reference back)', () => {
    const items = [item('a'), item('b')]
    expect(moveUnit(items, 0, 'up')).toBe(items)
  })

  it('at the bottom edge, moving down is a no-op (same array reference back)', () => {
    const items = [item('a'), item('b')]
    expect(moveUnit(items, 1, 'down')).toBe(items)
  })

  it('a block moves as one unit past a neighbouring single exercise', () => {
    // [A, B, C, D] with A+B one block — moving from inside the block (index
    // 1, "B") down swaps the whole [A, B] unit with [C], not just B and C.
    const items = [item('a', 'blk'), item('b', 'blk'), item('c')]
    expect(moveUnit(items, 1, 'down')).toEqual([items[2], items[0], items[1]])
  })

  it('clicking any member of a block moves the same whole unit', () => {
    const items = [item('a', 'blk'), item('b', 'blk'), item('c')]
    // index 0 ("A") and index 1 ("B") both belong to the same unit, so
    // moving "down" from either produces the identical result.
    expect(moveUnit(items, 0, 'down')).toEqual(moveUnit(items, 1, 'down'))
  })

  it('a block cannot move past its own edge even though it has 2 members', () => {
    const items = [item('a', 'blk'), item('b', 'blk'), item('c')]
    expect(moveUnit(items, 0, 'up')).toBe(items) // the block is already first
  })

  it('relative order within a moved block is preserved', () => {
    const items = [item('x'), item('a', 'blk'), item('b', 'blk'), item('c', 'blk')]
    const next = moveUnit(items, 2, 'up') // move the 3-member block up past "x"
    expect(next.map((i) => i.id)).toEqual(['a', 'b', 'c', 'x'])
  })
})

describe('isLinkedGap', () => {
  it('true when both sides share a non-null block', () => {
    const items = [item('a', 'blk'), item('b', 'blk')]
    expect(isLinkedGap(items, 0)).toBe(true)
  })

  it('false when neither side has a block', () => {
    const items = [item('a'), item('b')]
    expect(isLinkedGap(items, 0)).toBe(false)
  })

  it('false across a boundary between two different blocks', () => {
    const items = [item('a', 'blk-1'), item('b', 'blk-2')]
    expect(isLinkedGap(items, 0)).toBe(false)
  })
})

describe('planLinkToggle — linking', () => {
  it('two ungrouped singles → one new block covering both', () => {
    const items = [item('a'), item('b')]
    const plans = planLinkToggle(items, 0)
    expect(plans).toEqual([{ ids: ['a', 'b'], blockId: null, needsNewBlock: true }])
  })

  it('linking a single into an existing 2-member block reuses that block\'s id (any number of exercises)', () => {
    const items = [item('a', 'blk'), item('b', 'blk'), item('c')]
    const plans = planLinkToggle(items, 1) // link the block to "c"
    expect(plans).toEqual([{ ids: ['a', 'b', 'c'], blockId: 'blk', needsNewBlock: false }])
  })

  it('linking two existing blocks together reuses the left block\'s id for everyone', () => {
    const items = [item('a', 'blk-1'), item('b', 'blk-1'), item('c', 'blk-2'), item('d', 'blk-2')]
    const plans = planLinkToggle(items, 1)
    expect(plans).toEqual([{ ids: ['a', 'b', 'c', 'd'], blockId: 'blk-1', needsNewBlock: false }])
  })
})

describe('planLinkToggle — unlinking', () => {
  it('splitting a 2-member block leaves both sides as plain singles (null, not a lingering block)', () => {
    const items = [item('a', 'blk'), item('b', 'blk')]
    const plans = planLinkToggle(items, 0)
    expect(plans).toEqual([
      { ids: ['a'], blockId: null, needsNewBlock: false },
      { ids: ['b'], blockId: null, needsNewBlock: false },
    ])
  })

  it('splitting a 3-member block at the first gap: left (1) clears, right (2) keeps the existing id — no new block needed', () => {
    const items = [item('a', 'blk'), item('b', 'blk'), item('c', 'blk')]
    const plans = planLinkToggle(items, 0)
    expect(plans).toEqual([
      { ids: ['a'], blockId: null, needsNewBlock: false },
      { ids: ['b', 'c'], blockId: 'blk', needsNewBlock: false },
    ])
  })

  it('splitting a 3-member block at the second gap: left (2) keeps the existing id, right (1) clears', () => {
    const items = [item('a', 'blk'), item('b', 'blk'), item('c', 'blk')]
    const plans = planLinkToggle(items, 1)
    expect(plans).toEqual([
      { ids: ['a', 'b'], blockId: 'blk', needsNewBlock: false },
      { ids: ['c'], blockId: null, needsNewBlock: false },
    ])
  })

  it('splitting a 4-member block in the middle: both sides keep 2+ members, so one side mints a fresh block', () => {
    const items = [item('a', 'blk'), item('b', 'blk'), item('c', 'blk'), item('d', 'blk')]
    const plans = planLinkToggle(items, 1)
    expect(plans).toEqual([
      { ids: ['a', 'b'], blockId: 'blk', needsNewBlock: false },
      { ids: ['c', 'd'], blockId: null, needsNewBlock: true },
    ])
  })

  it('unlinking only affects the run spanning the gap — an unrelated block elsewhere is untouched', () => {
    const items = [item('a', 'blk-1'), item('b', 'blk-1'), item('x'), item('c', 'blk-2'), item('d', 'blk-2')]
    const plans = planLinkToggle(items, 0) // split blk-1
    const touchedIds = plans.flatMap((p) => p.ids)
    expect(touchedIds.sort()).toEqual(['a', 'b'])
  })
})
