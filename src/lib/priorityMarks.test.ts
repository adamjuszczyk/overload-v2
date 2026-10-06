import { describe, it, expect } from 'vitest'
import {
  effectiveSubgroupMark,
  summarizeGroup,
  buildGroupMarkEntries,
  MARK_LABELS,
  type StoredMark,
} from './priorityMarks'
import { MUSCLE_GROUPS } from './exerciseTags'

describe('effectiveSubgroupMark', () => {
  it('a subgroup with no mark of its own takes its group\'s mark (SPEC: inheritance)', () => {
    expect(effectiveSubgroupMark('focus', null)).toBe('focus')
    expect(effectiveSubgroupMark('dont_care', null)).toBe('dont_care')
  })

  it('a subgroup marked differently keeps its own (SPEC: override)', () => {
    expect(effectiveSubgroupMark('focus', 'dont_care')).toBe('dont_care')
    expect(effectiveSubgroupMark('dont_care', 'focus')).toBe('focus')
  })

  it('an explicit subgroup mark wins even when the group has none', () => {
    expect(effectiveSubgroupMark(null, 'focus')).toBe('focus')
  })

  it('neither marked is normal (null)', () => {
    expect(effectiveSubgroupMark(null, null)).toBeNull()
  })

  it('a subgroup explicitly agreeing with its group is just that mark, not treated specially', () => {
    expect(effectiveSubgroupMark('focus', 'focus')).toBe('focus')
  })
})

describe('summarizeGroup', () => {
  it('is null when the group itself carries no mark, regardless of exceptions', () => {
    expect(summarizeGroup('chest', null, [])).toBeNull()
    expect(summarizeGroup('chest', null, ['upper chest'])).toBeNull()
  })

  it('is the plain group label when the group has a mark and no subgroup differs', () => {
    expect(summarizeGroup('chest', 'focus', [])).toBe('chest')
  })

  // The one example SPEC itself gives (Stepped program planner step 1).
  it('matches SPEC\'s own example exactly: "chest without upper chest"', () => {
    expect(summarizeGroup('chest', 'focus', ['upper chest'])).toBe('chest without upper chest')
  })

  it('joins more than one exception with a plain comma, the same convention used elsewhere in the app', () => {
    expect(summarizeGroup('chest', 'focus', ['upper chest', 'lower chest'])).toBe(
      'chest without upper chest, lower chest',
    )
  })
})

describe('buildGroupMarkEntries', () => {
  it('returns all 12 groups even when no row exists at all', () => {
    const entries = buildGroupMarkEntries([])
    expect(entries).toHaveLength(12)
    expect(entries.map((e) => e.tagValue).sort()).toEqual([...MUSCLE_GROUPS].sort())
    for (const e of entries) {
      expect(e.ownMark).toBeNull()
      expect(e.summary).toBeNull()
      for (const s of e.subgroups) {
        expect(s.ownMark).toBeNull()
        expect(s.effectiveMark).toBeNull()
      }
    }
  })

  it('every group\'s subgroups match PRIORITY_TREE exactly (22 total, no group missing)', () => {
    const entries = buildGroupMarkEntries([])
    const totalSubgroups = entries.reduce((n, e) => n + e.subgroups.length, 0)
    expect(totalSubgroups).toBe(22)
  })

  it('a bare group mark is inherited by every one of its subgroups (SPEC worked example: chest/focus covers upper chest)', () => {
    const rows: StoredMark[] = [{ tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: 't' }]
    const chest = buildGroupMarkEntries(rows).find((e) => e.tagValue === 'chest')!
    expect(chest.ownMark).toBe('focus')
    expect(chest.summary).toBe('chest')
    for (const s of chest.subgroups) {
      expect(s.ownMark).toBeNull()
      expect(s.effectiveMark).toBe('focus')
    }
  })

  it('one subgroup marked differently overrides only itself and produces the "without" summary', () => {
    const rows: StoredMark[] = [
      { tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: 't' },
      { tagType: 'muscle_subgroup', tagValue: 'upper_chest', mark: 'dont_care', updatedAt: 't' },
    ]
    const chest = buildGroupMarkEntries(rows).find((e) => e.tagValue === 'chest')!
    expect(chest.summary).toBe('chest without upper chest')

    const upperChest = chest.subgroups.find((s) => s.tagValue === 'upper_chest')!
    expect(upperChest.ownMark).toBe('dont_care')
    expect(upperChest.effectiveMark).toBe('dont_care')

    // The sibling subgroups still inherit the group's mark, untouched.
    const midChest = chest.subgroups.find((s) => s.tagValue === 'mid_chest')!
    expect(midChest.ownMark).toBeNull()
    expect(midChest.effectiveMark).toBe('focus')
  })

  it('a subgroup explicitly agreeing with its group is not reported as an exception', () => {
    const rows: StoredMark[] = [
      { tagType: 'muscle_group', tagValue: 'chest', mark: 'focus', updatedAt: 't' },
      { tagType: 'muscle_subgroup', tagValue: 'upper_chest', mark: 'focus', updatedAt: 't' },
    ]
    const chest = buildGroupMarkEntries(rows).find((e) => e.tagValue === 'chest')!
    expect(chest.summary).toBe('chest')
  })

  it('a subgroup marked on its own, with its group left normal, is not folded into any group summary', () => {
    const rows: StoredMark[] = [{ tagType: 'muscle_subgroup', tagValue: 'upper_chest', mark: 'focus', updatedAt: 't' }]
    const chest = buildGroupMarkEntries(rows).find((e) => e.tagValue === 'chest')!
    expect(chest.ownMark).toBeNull()
    expect(chest.summary).toBeNull()
    const upperChest = chest.subgroups.find((s) => s.tagValue === 'upper_chest')!
    expect(upperChest.ownMark).toBe('focus')
    expect(upperChest.effectiveMark).toBe('focus')
  })

  it('multiple exceptions under one group are all named', () => {
    const rows: StoredMark[] = [
      { tagType: 'muscle_group', tagValue: 'back', mark: 'dont_care', updatedAt: 't' },
      { tagType: 'muscle_subgroup', tagValue: 'lats', mark: 'focus', updatedAt: 't' },
      { tagType: 'muscle_subgroup', tagValue: 'traps', mark: 'focus', updatedAt: 't' },
    ]
    const back = buildGroupMarkEntries(rows).find((e) => e.tagValue === 'back')!
    expect(back.summary).toBe("back without lats, traps")
  })

  it('tag_type and tag_value together disambiguate values shared by both vocabularies (e.g. glutes)', () => {
    const rows: StoredMark[] = [
      { tagType: 'muscle_group', tagValue: 'glutes', mark: 'focus', updatedAt: 't' },
      { tagType: 'muscle_subgroup', tagValue: 'glutes', mark: 'dont_care', updatedAt: 't' },
    ]
    const entries = buildGroupMarkEntries(rows)
    const glutesGroup = entries.find((e) => e.tagValue === 'glutes')!
    expect(glutesGroup.ownMark).toBe('focus')
    expect(glutesGroup.subgroups).toHaveLength(1)
    expect(glutesGroup.subgroups[0].ownMark).toBe('dont_care')
    expect(glutesGroup.summary).toBe('glutes without glutes')
  })

  it('an unrecognised tag_value is silently excluded, same posture as densifyPriorities', () => {
    const rows: StoredMark[] = [{ tagType: 'muscle_group', tagValue: 'not_a_real_group', mark: 'focus', updatedAt: 't' }]
    const entries = buildGroupMarkEntries(rows)
    expect(entries).toHaveLength(12)
    expect(entries.every((e) => e.ownMark === null)).toBe(true)
  })
})

describe('MARK_LABELS', () => {
  it('has exactly the two stored mark values', () => {
    expect(Object.keys(MARK_LABELS).sort()).toEqual(['dont_care', 'focus'])
  })
})
