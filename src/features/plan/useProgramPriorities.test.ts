import { describe, it, expect } from 'vitest'
import { applyOptimisticMark } from './useProgramPriorities'
import type { StoredMark } from '../../lib/priorityMarks'

// Mirrors usePriorityContext.test.ts's own treatment of
// applyOptimisticPriority: the pure function behind onMutate's optimistic
// write, tested directly against the real sparse-row shape
// fetchProgramPriorities returns, not a hand-rolled stand-in.

describe("applyOptimisticMark — this table's optimistic write", () => {
  it('adds a new row for a tag that had none', () => {
    const next = applyOptimisticMark([], 'muscle_group', 'chest', 'focus')
    expect(next).toEqual([{ tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: expect.any(String) }])
  })

  it('overwrites an already-set row in place rather than adding a second one', () => {
    const prev: StoredMark[] = [{ tagType: 'muscle_group', tagValue: 'chest', mark: 'dont_care', updatedAt: 't0' }]
    const next = applyOptimisticMark(prev, 'muscle_group', 'chest', 'focus')
    expect(next).toHaveLength(1)
    expect(next[0].mark).toBe('focus')
  })

  it('mark: null removes the row — the toggle-off-to-normal case this table has that the old one never did', () => {
    const prev: StoredMark[] = [{ tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: 't0' }]
    const next = applyOptimisticMark(prev, 'muscle_group', 'chest', null)
    expect(next).toEqual([])
  })

  it('mark: null on a tag with no row is a no-op, not an error', () => {
    const next = applyOptimisticMark([], 'muscle_group', 'chest', null)
    expect(next).toEqual([])
  })

  it('leaves every other row untouched', () => {
    const prev: StoredMark[] = [
      { tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: 't0' },
      { tagType: 'muscle_subgroup', tagValue: 'lats', mark: 'dont_care', updatedAt: 't0' },
    ]
    const next = applyOptimisticMark(prev, 'muscle_group', 'back', 'focus')
    expect(next).toHaveLength(3)
    expect(next).toContainEqual(prev[0])
    expect(next).toContainEqual(prev[1])
  })

  // The real trap this function must avoid: six tag_values belong to BOTH
  // vocabularies (biceps, forearms, quads, hamstrings, glutes, calves) — a
  // filter keyed on tagValue alone would clear or overwrite the wrong one.
  const BOTH = ['biceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves'] as const

  it.each(BOTH)('setting the %s GROUP leaves the identically-named SUBGROUP row alone', (tag) => {
    const prev: StoredMark[] = [{ tagType: 'muscle_subgroup', tagValue: tag, mark: 'dont_care', updatedAt: 't0' }]
    const next = applyOptimisticMark(prev, 'muscle_group', tag, 'focus')
    expect(next).toContainEqual(prev[0])
    expect(next.find((r) => r.tagType === 'muscle_group' && r.tagValue === tag)?.mark).toBe('focus')
  })

  it.each(BOTH)('clearing the %s SUBGROUP leaves the identically-named GROUP row alone', (tag) => {
    const prev: StoredMark[] = [
      { tagType: 'muscle_group', tagValue: tag, mark: 'focus', updatedAt: 't0' },
      { tagType: 'muscle_subgroup', tagValue: tag, mark: 'dont_care', updatedAt: 't0' },
    ]
    const next = applyOptimisticMark(prev, 'muscle_subgroup', tag, null)
    expect(next).toEqual([prev[0]])
  })

  it("never mutates the array it is given, so onMutate's ctx.prev stays a true snapshot", () => {
    const prev: StoredMark[] = [{ tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: 't0' }]
    const before = structuredClone(prev)

    const next = applyOptimisticMark(prev, 'muscle_group', 'chest', 'dont_care')

    expect(prev).toEqual(before)
    expect(next).not.toBe(prev)
  })
})
