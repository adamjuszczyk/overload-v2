import { describe, it, expect } from 'vitest'
import {
  resolveSwapSlot,
  resolveSwapCarry,
  resolveReorderCarry,
  resolveAddSlot,
} from './weekEdits'

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

describe('resolveSwapCarry — "only this week" (swap)', () => {
  it('ticked: records the pre-swap slot, so copying forward reverts', () => {
    expect(resolveSwapCarry('pe-original', true)).toEqual({
      carryProgramExerciseId: 'pe-original',
      carryPosition: null,
    })
  })

  it('off (default): carries nothing — the swap is permanent', () => {
    expect(resolveSwapCarry('pe-original', false)).toEqual({
      carryProgramExerciseId: null,
      carryPosition: null,
    })
  })

  it('a later permanent swap clears a stale carry from an earlier only-this-week one — recomputed from this edit alone', () => {
    // Same row, same pre-swap identity either time: what matters is only
    // THIS call's onlyThisWeek flag, never anything left over from before.
    const onlyThisWeek = resolveSwapCarry('pe-x', true)
    expect(onlyThisWeek.carryProgramExerciseId).toBe('pe-x')
    const permanentAfterward = resolveSwapCarry('pe-x', false)
    expect(permanentAfterward.carryProgramExerciseId).toBeNull()
  })
})

describe('resolveReorderCarry — "only this week" (reorder)', () => {
  it('ticked: records the pre-reorder position, so copying forward reverts to the old order', () => {
    expect(resolveReorderCarry(3, true)).toEqual({ carryPosition: 3 })
  })

  it('off (default): clears carry_position — the new order is permanent', () => {
    expect(resolveReorderCarry(3, false)).toEqual({ carryPosition: null })
  })

  it('position 0 (falsy but valid) is still carried when ticked — not coerced to the off case', () => {
    expect(resolveReorderCarry(0, true)).toEqual({ carryPosition: 0 })
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
