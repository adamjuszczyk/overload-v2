import { describe, it, expect } from 'vitest'
import { isStageOfSkippedHead } from './progressService'

// Found by adversarial review (2026-08-13/14): fetchExerciseProgress's
// volume sum (points[].volume) counted a stage even when its own head was
// skipped, since a stage's own is_skipped is always false and its weight/
// reps can be real/non-null — the row-level "is this row skipped" check
// never looked at the *parent*. Real account instance: a 2026-07-16
// session (One-arm Dumbell Lateral Raise), a 5kg×8 stage attached to a
// skipped set 4, its 40kg·reps silently counted into that day's volume.
// progressService.ts itself has no unit tests (I/O-bound, verified live
// per this project's established convention) — this tests the pure
// decision rule extracted out of it.
describe('isStageOfSkippedHead', () => {
  it('is false for a head-level row (parentSetId null) regardless of the map', () => {
    const skippedById = new Map([['head-1', true]])
    expect(isStageOfSkippedHead(null, skippedById)).toBe(false)
  })

  it('is false for a stage whose parent is not skipped', () => {
    const skippedById = new Map([['head-1', false]])
    expect(isStageOfSkippedHead('head-1', skippedById)).toBe(false)
  })

  it('is true for a stage whose parent is skipped — the exact gap this fix closes', () => {
    const skippedById = new Map([['head-1', true]])
    expect(isStageOfSkippedHead('head-1', skippedById)).toBe(true)
  })

  it('is false for a stage whose parent id is missing from the map (defensive default)', () => {
    // Shouldn't happen in practice (every stage's parent is fetched in the
    // same unfiltered row set), but a missing entry must not be treated as
    // "skipped" by default — that would silently zero out legitimate volume.
    const skippedById = new Map<string, boolean>()
    expect(isStageOfSkippedHead('head-missing', skippedById)).toBe(false)
  })
})
