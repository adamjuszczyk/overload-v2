import { describe, it, expect } from 'vitest'
import { selectPreviousMeso, applyOptimisticPriority } from './usePriorityContext'
import { densifyPriorities } from '../../lib/priorityTags'
import type { StoredPriority } from '../../lib/priorityTags'
import type { PriorityContext } from './priorityContext'
import type { Mesocycle } from '../../types'

// Fixture factory — only the fields selectPreviousMeso actually reads
// (id, startDate, createdAt) vary meaningfully per test; the rest are fixed
// so each test only has to state what's relevant to it.
function meso(overrides: Partial<Mesocycle> & { id: string }): Mesocycle {
  return {
    userId: 'u1',
    name: overrides.id,
    programId: 'p1',
    status: 'completed',
    startDate: '2026-01-01',
    endDate: '2026-02-01',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('selectPreviousMeso — Q1a\'s selection rule', () => {
  it('greatest start_date wins', () => {
    const mesos = [
      meso({ id: 'target', startDate: '2026-03-01', createdAt: '2026-03-01T00:00:00Z' }),
      meso({ id: 'oldest', startDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' }),
      meso({ id: 'newest-prior', startDate: '2026-02-15', createdAt: '2026-02-15T00:00:00Z' }),
      meso({ id: 'middle', startDate: '2026-02-01', createdAt: '2026-02-01T00:00:00Z' }),
    ]
    expect(selectPreviousMeso(mesos, 'target')?.id).toBe('newest-prior')
  })

  it('the target meso is excluded even when it is the newest by start_date — the next-greatest among the remainder wins', () => {
    const mesos = [
      meso({ id: 'target', startDate: '2026-05-01', createdAt: '2026-05-01T00:00:00Z' }),
      meso({ id: 'runner-up', startDate: '2026-03-01', createdAt: '2026-03-01T00:00:00Z' }),
      meso({ id: 'oldest', startDate: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' }),
    ]
    const result = selectPreviousMeso(mesos, 'target')
    expect(result?.id).toBe('runner-up')
    expect(result?.id).not.toBe('target')
  })

  it('created_at desc breaks a tie when two mesos share the same start_date', () => {
    const mesos = [
      meso({ id: 'target', startDate: '2026-03-01', createdAt: '2026-03-01T00:00:00Z' }),
      meso({ id: 'created-earlier', startDate: '2026-02-01', createdAt: '2026-02-01T00:00:00Z' }),
      meso({ id: 'created-later', startDate: '2026-02-01', createdAt: '2026-02-05T00:00:00Z' }),
    ]
    expect(selectPreviousMeso(mesos, 'target')?.id).toBe('created-later')
  })

  it('returns null when no prior meso exists — the case that hides the copy button', () => {
    expect(selectPreviousMeso([meso({ id: 'only-one' })], 'only-one')).toBeNull()
    expect(selectPreviousMeso([], 'target')).toBeNull()
  })

  it('returns null when the only other mesos present are also excluded by id (defensive: never returns the target itself)', () => {
    const mesos = [meso({ id: 'target', startDate: '2026-01-01' })]
    const result = selectPreviousMeso(mesos, 'target')
    expect(result).toBeNull()
  })
})


// Built the same way fetchPriorityContext builds the real thing — densify,
// then attach the meso id — so these tests run against the actual cached
// shape useSetTagPriority's onMutate reads, not a hand-rolled stand-in.
function context(rows: StoredPriority[] = []): PriorityContext {
  return { mesocycleId: 'meso-1', ...densifyPriorities(rows) }
}

describe("applyOptimisticPriority — A5's optimistic write", () => {
  it('a group tap lands on the group record, the flat entries, and anyExplicit', () => {
    const next = applyOptimisticPriority(context(), 'muscle_group', 'chest', 'top')

    expect(next.muscleGroups.chest.priority).toBe('top')
    expect(next.muscleGroups.chest.isExplicit).toBe(true)
    expect(next.muscleGroups.chest.updatedAt).not.toBeNull()
    expect(next.entries.find((e) => e.tagType === 'muscle_group' && e.tagValue === 'chest')?.priority).toBe('top')
    expect(next.anyExplicit).toBe(true)
  })

  it('a subgroup tap lands on the subgroup record and leaves its parent group alone', () => {
    const next = applyOptimisticPriority(context(), 'muscle_subgroup', 'upper_chest', 'high')

    expect(next.muscleSubgroups.upper_chest.priority).toBe('high')
    expect(next.muscleSubgroups.upper_chest.isExplicit).toBe(true)
    // SPEC §3 makes the group the ceiling, not a mirror of its subgroups —
    // setting a subgroup states nothing about the group.
    expect(next.muscleGroups.chest.priority).toBe('normal')
    expect(next.muscleGroups.chest.isExplicit).toBe(false)
  })

  // The real trap in this function. Six tag_values are members of BOTH
  // vocabularies, so a lookup keyed on tagValue alone would silently move a
  // group's identically-named subgroup (or the reverse) on every tap — a
  // wrong chip moving on screen, with the correct row written to the
  // database, which is the hardest kind of mismatch to notice.
  const BOTH = ['biceps', 'forearms', 'quads', 'hamstrings', 'glutes', 'calves'] as const

  // Asserted on the flat `entries` array as well as the two records, and
  // that is the whole point: the records are rebuilt by a ternary that
  // already branches on tagType, so they survive a value-only lookup —
  // `entries` is the one built by a predicate, so it is the only place the
  // regression actually shows. Checking the records alone passes against
  // deliberately broken code (verified by injecting exactly that break).
  // `entries` is also what a payload to Mesocycle Analysis is serialised
  // from, so a disagreement here is what would reach the model.
  function flat(ctx: PriorityContext, tagType: string, tagValue: string) {
    return ctx.entries.filter((e) => e.tagType === tagType && e.tagValue === tagValue)
  }

  it.each(BOTH)('tapping the %s GROUP does not move the identically-named subgroup', (tag) => {
    const next = applyOptimisticPriority(context(), 'muscle_group', tag, 'top')

    expect(next.muscleGroups[tag].priority).toBe('top')
    expect(next.muscleGroups[tag].isExplicit).toBe(true)
    expect(next.muscleSubgroups[tag].priority).toBe('normal')
    expect(next.muscleSubgroups[tag].isExplicit).toBe(false)

    expect(flat(next, 'muscle_group', tag)).toEqual([next.muscleGroups[tag]])
    expect(flat(next, 'muscle_subgroup', tag)).toEqual([next.muscleSubgroups[tag]])
  })

  it.each(BOTH)('tapping the %s SUBGROUP does not move the identically-named group', (tag) => {
    const next = applyOptimisticPriority(context(), 'muscle_subgroup', tag, 'low')

    expect(next.muscleSubgroups[tag].priority).toBe('low')
    expect(next.muscleSubgroups[tag].isExplicit).toBe(true)
    expect(next.muscleGroups[tag].priority).toBe('normal')
    expect(next.muscleGroups[tag].isExplicit).toBe(false)

    expect(flat(next, 'muscle_subgroup', tag)).toEqual([next.muscleSubgroups[tag]])
    expect(flat(next, 'muscle_group', tag)).toEqual([next.muscleGroups[tag]])
  })

  // The structural invariant behind both of the above, stated once for every
  // tap rather than only for the six colliding names: whatever the two
  // records say, the flat array says the same thing, exactly once each.
  it.each(BOTH)('leaves records and flat entries in agreement for every tag after a %s tap', (tag) => {
    const next = applyOptimisticPriority(context(), 'muscle_group', tag, 'high')

    for (const [value, entry] of Object.entries(next.muscleGroups)) {
      expect(flat(next, 'muscle_group', value)).toEqual([entry])
    }
    for (const [value, entry] of Object.entries(next.muscleSubgroups)) {
      expect(flat(next, 'muscle_subgroup', value)).toEqual([entry])
    }
  })

  // The invariant onError's rollback actually rests on: onMutate hands the
  // pre-tap context back as ctx.prev and then passes that very object to
  // this function. If this mutated it, the snapshot would already carry the
  // optimistic value and restoring it would restore nothing.
  it("never mutates the context it is given, so onMutate's ctx.prev stays a true snapshot", () => {
    const prev = context()
    const before = structuredClone(prev)

    const next = applyOptimisticPriority(prev, 'muscle_group', 'back', 'top')

    expect(prev).toEqual(before)
    expect(prev.muscleGroups.back.priority).toBe('normal')
    expect(prev.muscleGroups.back.isExplicit).toBe(false)
    expect(prev.anyExplicit).toBe(false)
    expect(next).not.toBe(prev)
    expect(next.entries).not.toBe(prev.entries)
  })

  // What the COPY FROM button's own gate reads (§5.8): the first tap on a
  // blank meso hides the button optimistically, and a rollback to the
  // snapshot brings it back — the button state follows the write, not the
  // tap.
  it('turns anyExplicit true on a blank meso while the snapshot stays false', () => {
    const prev = context()
    const next = applyOptimisticPriority(prev, 'muscle_subgroup', 'adductors', 'high')

    expect(prev.anyExplicit).toBe(false)
    expect(next.anyExplicit).toBe(true)
  })

  it('preserves everything the write does not touch — meso id, subgroupParent, and all 34 entries in order', () => {
    const prev = context()
    const next = applyOptimisticPriority(prev, 'muscle_group', 'core', 'low')

    expect(next.mesocycleId).toBe('meso-1')
    expect(next.subgroupParent).toEqual(prev.subgroupParent)
    expect(next.entries).toHaveLength(34)
    expect(next.entries.map((e) => `${e.tagType}:${e.tagValue}`)).toEqual(
      prev.entries.map((e) => `${e.tagType}:${e.tagValue}`),
    )
    expect(Object.keys(next.muscleGroups)).toHaveLength(12)
    expect(Object.keys(next.muscleSubgroups)).toHaveLength(22)
  })

  it('overwrites an already-explicit entry in place rather than adding a 35th', () => {
    const prev = context([
      { tagType: 'muscle_group', tagValue: 'chest', priority: 'low', updatedAt: '2026-01-01T00:00:00Z' },
    ])
    const next = applyOptimisticPriority(prev, 'muscle_group', 'chest', 'top')

    expect(next.muscleGroups.chest.priority).toBe('top')
    expect(next.entries).toHaveLength(34)
    expect(next.entries.filter((e) => e.tagType === 'muscle_group' && e.tagValue === 'chest')).toHaveLength(1)
  })
})
