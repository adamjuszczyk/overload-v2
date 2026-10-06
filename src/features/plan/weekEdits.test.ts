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

// No existing carry on the row (a fresh row, or one whose carry_* are both
// still null) — the simple, single-edit cases.
const NO_CARRY = { carryProgramExerciseId: null, carryPosition: null }

describe('resolveSwapCarry — "only this week" (swap)', () => {
  it('ticked, no existing carry: records the pre-swap slot, so copying forward reverts', () => {
    expect(resolveSwapCarry(NO_CARRY, 'pe-original', true)).toEqual({
      carryProgramExerciseId: 'pe-original',
      carryPosition: null,
    })
  })

  it('off (default), no existing carry: carries nothing — the swap is permanent', () => {
    expect(resolveSwapCarry(NO_CARRY, 'pe-original', false)).toEqual({
      carryProgramExerciseId: null,
      carryPosition: null,
    })
  })

  // Review bug: S swapped only-this-week to W1 (carry=S), then W1 swapped
  // only-this-week to W2 recomputed carry from W1 alone and got W1, not S —
  // so the next week showed W1 instead of the true original, S.
  it('a repeated only-this-week swap keeps reverting to the TRUE original, not the most recent pre-swap slot', () => {
    // S swapped only-this-week to W1: no existing carry yet, so this
    // swap's own pre-swap identity (S) becomes the recorded original.
    const afterFirst = resolveSwapCarry(NO_CARRY, 'S', true)
    expect(afterFirst).toEqual({ carryProgramExerciseId: 'S', carryPosition: null })

    // W1 swapped only-this-week to W2: the row already carries S, so S
    // wins — it must NOT be overwritten with this swap's own pre-swap
    // identity, W1 (the bug).
    const afterSecond = resolveSwapCarry(
      { carryProgramExerciseId: afterFirst.carryProgramExerciseId, carryPosition: afterFirst.carryPosition },
      'W1',
      true,
    )
    expect(afterSecond.carryProgramExerciseId).toBe('S')
  })

  // Review bug: any swap wrote carry_position: null, wiping an earlier
  // only-this-week reorder of that row.
  it('a swap (even a permanent one) leaves an existing carry_position untouched — an earlier only-this-week reorder still reverts', () => {
    // An only-this-week reorder recorded position 1 as the carry.
    const afterReorder = resolveReorderCarry({ carryPosition: null }, 1, true)
    expect(afterReorder).toEqual({ carryPosition: 1 })

    // A swap of the same row — permanent, the stricter case, since a swap
    // always clears carry_program_exercise_id when off — must still echo
    // carry_position back unchanged; it is reorder's field, not swap's.
    const afterSwap = resolveSwapCarry(
      { carryProgramExerciseId: null, carryPosition: afterReorder.carryPosition },
      'pe-x',
      false,
    )
    expect(afterSwap).toEqual({ carryProgramExerciseId: null, carryPosition: 1 })
  })

  // A permanent swap must still correctly clear a STALE carry an earlier
  // only-this-week swap left behind — W2 (this swap's replacement, written
  // by weekPlanService.ts alongside this carry) is what copying forward
  // then uses, since coalesce(carry_program_exercise_id, program_exercise_id)
  // falls through to it once the carry is null.
  it('permanent swap after an only-this-week swap clears the stale carry — W2 carries forward, not the stale original', () => {
    // S swapped only-this-week to W1: carry becomes S.
    const afterOnlyThisWeek = resolveSwapCarry(NO_CARRY, 'S', true)
    expect(afterOnlyThisWeek.carryProgramExerciseId).toBe('S')

    // W1 swapped PERMANENTLY to W2: the stale carry (S) must be cleared,
    // not kept and not reset to W1 — null, so W2 itself carries forward.
    const afterPermanent = resolveSwapCarry(
      { carryProgramExerciseId: afterOnlyThisWeek.carryProgramExerciseId, carryPosition: afterOnlyThisWeek.carryPosition },
      'W1',
      false,
    )
    expect(afterPermanent).toEqual({ carryProgramExerciseId: null, carryPosition: null })
  })
})

describe('resolveReorderCarry — "only this week" (reorder)', () => {
  it('ticked, no existing carry: records the pre-reorder position, so copying forward reverts to the old order', () => {
    expect(resolveReorderCarry({ carryPosition: null }, 3, true)).toEqual({ carryPosition: 3 })
  })

  it('off (default), no existing carry: clears carry_position — the new order is permanent', () => {
    expect(resolveReorderCarry({ carryPosition: null }, 3, false)).toEqual({ carryPosition: null })
  })

  it('position 0 (falsy but valid) is still carried when ticked — not coerced to the off case', () => {
    expect(resolveReorderCarry({ carryPosition: null }, 0, true)).toEqual({ carryPosition: 0 })
  })

  // Review bug: reorder with only-this-week twice made the carry the
  // already-moved position, not the original one.
  it('a repeated only-this-week reorder keeps reverting to the TRUE original position, not the most recent pre-reorder one', () => {
    // Original position 0, reordered (only this week) to some new spot:
    // no existing carry yet, so 0 becomes the recorded original.
    const afterFirst = resolveReorderCarry({ carryPosition: null }, 0, true)
    expect(afterFirst).toEqual({ carryPosition: 0 })

    // Reordered again (only this week) from its new, intermediate
    // position (2): the row already carries 0, so 0 wins — it must NOT be
    // overwritten with this reorder's own pre-reorder position, 2 (the bug).
    const afterSecond = resolveReorderCarry({ carryPosition: afterFirst.carryPosition }, 2, true)
    expect(afterSecond).toEqual({ carryPosition: 0 })
  })

  it('a later permanent reorder clears a stale carry an earlier only-this-week reorder left behind', () => {
    const afterOnlyThisWeek = resolveReorderCarry({ carryPosition: null }, 0, true)
    expect(afterOnlyThisWeek.carryPosition).toBe(0)

    const afterPermanent = resolveReorderCarry({ carryPosition: afterOnlyThisWeek.carryPosition }, 2, false)
    expect(afterPermanent).toEqual({ carryPosition: null })
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
