import { describe, it, expect } from 'vitest'
import * as weekEdits from './weekEdits'
import { resolveSwapSlot, resolveAddSlot } from './weekEdits'

describe('resolveSwapSlot — the replacement row', () => {
  it('takes the replaced slot\'s position and superset block, and the picked exercise\'s identity', () => {
    const slot = resolveSwapSlot(
      { workoutDayId: 'wd-1', position: 2, supersetBlockId: 'block-1' },
      'ex-new',
    )
    expect(slot).toEqual({
      workoutDayId: 'wd-1',
      exerciseId: 'ex-new',
      position: 2,
      supersetBlockId: 'block-1',
    })
  })

  it('a slot with no superset block stays unblocked', () => {
    const slot = resolveSwapSlot({ workoutDayId: 'wd-1', position: 0, supersetBlockId: null }, 'ex-new')
    expect(slot.supersetBlockId).toBeNull()
  })
})

describe('resolveAddSlot — an added exercise is never in a superset', () => {
  it('always supersetBlockId: null, regardless of what the workout\'s other slots carry', () => {
    expect(resolveAddSlot('wd-1', 'ex-new', 5)).toEqual({
      workoutDayId: 'wd-1',
      exerciseId: 'ex-new',
      position: 5,
      supersetBlockId: null,
    })
  })
})

// Chunk 27 (SPEC [P1.1] "'Only this week' is removed"): a swap and a reorder
// have no carry decision left to make. Absence test (Checks that lied #32) —
// the module exports exactly the two slot decisions, so a carry helper put
// back here fails this.
describe('weekEdits — no "only this week" carry helpers remain (chunk 27)', () => {
  it('exports only resolveSwapSlot and resolveAddSlot', () => {
    expect(Object.keys(weekEdits).sort()).toEqual(['resolveAddSlot', 'resolveSwapSlot'])
  })
})
