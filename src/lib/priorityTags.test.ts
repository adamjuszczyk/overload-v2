import { describe, it, expect } from 'vitest'
import { MUSCLE_GROUPS, MUSCLE_SUBGROUPS } from './exerciseTags'
import {
  PRIORITY_SCALE,
  DEFAULT_PRIORITY,
  PRIORITY_TREE,
  SUBGROUP_PARENT,
  densifyPriorities,
  type StoredPriority,
} from './priorityTags'

describe('PRIORITY_TREE', () => {
  it("has exactly MUSCLE_GROUPS's 12 keys, no missing, no extra", () => {
    expect(Object.keys(PRIORITY_TREE).sort()).toEqual([...MUSCLE_GROUPS].sort())
  })

  // The test that fails the day someone adds a 23rd subgroup to
  // exerciseTags.ts and forgets this file (TASKS §3.4) — the single most
  // valuable assertion in this suite.
  it("flattened values set-equal exerciseTags.ts's MUSCLE_SUBGROUPS, each exactly once", () => {
    const flattened = MUSCLE_GROUPS.flatMap((group) => PRIORITY_TREE[group])
    expect(flattened).toHaveLength(22)
    expect(new Set(flattened).size).toBe(22)
    expect([...flattened].sort()).toEqual([...MUSCLE_SUBGROUPS].sort())
  })

  it('matches the approved §3.2 table exactly, per group', () => {
    expect(PRIORITY_TREE).toEqual({
      chest: ['upper_chest', 'mid_chest', 'lower_chest'],
      back: ['lats', 'mid_back', 'lower_back', 'traps'],
      shoulders: ['front_delt', 'side_delt', 'rear_delt'],
      biceps: ['biceps', 'brachialis'],
      triceps: ['triceps_long_head', 'triceps_lateral_head'],
      forearms: ['forearms'],
      quads: ['quads'],
      hamstrings: ['hamstrings'],
      glutes: ['glutes'],
      calves: ['calves'],
      core: ['abs', 'obliques'],
      other: ['adductors'],
    })
  })

  it("'adductors' is reachable (under 'other'), unlike the validity map it is deliberately not derived from", () => {
    expect(PRIORITY_TREE.other).toContain('adductors')
  })
})

describe('SUBGROUP_PARENT', () => {
  it('is the exact inverse of PRIORITY_TREE', () => {
    for (const group of MUSCLE_GROUPS) {
      for (const subgroup of PRIORITY_TREE[group]) {
        expect(SUBGROUP_PARENT[subgroup]).toBe(group)
      }
    }
  })

  it('has exactly 22 keys, one per subgroup', () => {
    expect(Object.keys(SUBGROUP_PARENT)).toHaveLength(22)
  })
})

describe('PRIORITY_SCALE', () => {
  it('has exactly 4 values, ordered low to high', () => {
    expect(PRIORITY_SCALE.values).toEqual(['low', 'normal', 'high', 'top'])
  })

  it('has a label for every value and no extra label keys', () => {
    expect(Object.keys(PRIORITY_SCALE.labels).sort()).toEqual([...PRIORITY_SCALE.values].sort())
  })

  it('DEFAULT_PRIORITY is normal, and is a real scale value', () => {
    expect(DEFAULT_PRIORITY).toBe('normal')
    expect(PRIORITY_SCALE.values).toContain(DEFAULT_PRIORITY)
  })
})

describe('densifyPriorities', () => {
  it('an empty row set — the ordinary "meso with no rows yet" case, not an edge case — densifies to all 34 entries, all normal, all defaulted', () => {
    const result = densifyPriorities([])
    expect(result.entries).toHaveLength(34)
    expect(result.entries.every((e) => e.priority === 'normal')).toBe(true)
    expect(result.entries.every((e) => e.isExplicit === false)).toBe(true)
    expect(result.entries.every((e) => e.updatedAt === null)).toBe(true)
    expect(result.anyExplicit).toBe(false)
    expect(Object.keys(result.muscleGroups)).toHaveLength(12)
    expect(Object.keys(result.muscleSubgroups)).toHaveLength(22)
  })

  it('a partial row set overlays correctly and leaves everything else defaulted', () => {
    const rows: StoredPriority[] = [
      { tagType: 'muscle_group', tagValue: 'chest', priority: 'low', updatedAt: '2026-01-01T00:00:00Z' },
      { tagType: 'muscle_subgroup', tagValue: 'upper_chest', priority: 'top', updatedAt: '2026-01-02T00:00:00Z' },
    ]
    const result = densifyPriorities(rows)

    expect(result.muscleGroups.chest).toEqual({
      tagType: 'muscle_group', tagValue: 'chest', priority: 'low', isExplicit: true, updatedAt: '2026-01-01T00:00:00Z',
    })
    expect(result.muscleSubgroups.upper_chest).toEqual({
      tagType: 'muscle_subgroup', tagValue: 'upper_chest', priority: 'top', isExplicit: true, updatedAt: '2026-01-02T00:00:00Z',
    })

    // Untouched sibling — still defaulted.
    expect(result.muscleSubgroups.mid_chest).toEqual({
      tagType: 'muscle_subgroup', tagValue: 'mid_chest', priority: 'normal', isExplicit: false, updatedAt: null,
    })
    // Untouched, unrelated group — still defaulted.
    expect(result.muscleGroups.back).toEqual({
      tagType: 'muscle_group', tagValue: 'back', priority: 'normal', isExplicit: false, updatedAt: null,
    })

    expect(result.entries).toHaveLength(34)
    expect(result.anyExplicit).toBe(true)
  })

  it("an explicit row set to 'normal' produces isExplicit: true and anyExplicit: true — an explicit normal is not a default", () => {
    const result = densifyPriorities([
      { tagType: 'muscle_group', tagValue: 'back', priority: 'normal', updatedAt: '2026-01-01T00:00:00Z' },
    ])
    expect(result.muscleGroups.back.priority).toBe('normal')
    expect(result.muscleGroups.back.isExplicit).toBe(true)
    expect(result.muscleGroups.back.updatedAt).toBe('2026-01-01T00:00:00Z')
    expect(result.anyExplicit).toBe(true)
  })

  // Six tag_values are members of both vocabularies at once, so the stored
  // map has to be keyed on tag_type as well as tag_value. Keyed on value
  // alone, one stored group row would also satisfy its identically-named
  // subgroup lookup — reading back a priority for a tag that was never set.
  it('a group row and a subgroup row sharing one tag_value stay separate', () => {
    const result = densifyPriorities([
      { tagType: 'muscle_group', tagValue: 'quads', priority: 'top', updatedAt: '2026-01-01T00:00:00Z' },
    ])

    expect(result.muscleGroups.quads.priority).toBe('top')
    expect(result.muscleGroups.quads.isExplicit).toBe(true)
    expect(result.muscleSubgroups.quads.priority).toBe('normal')
    expect(result.muscleSubgroups.quads.isExplicit).toBe(false)
  })

  it('the reverse — a subgroup row does not satisfy its identically-named group', () => {
    const result = densifyPriorities([
      { tagType: 'muscle_subgroup', tagValue: 'glutes', priority: 'low', updatedAt: '2026-01-01T00:00:00Z' },
    ])

    expect(result.muscleSubgroups.glutes.priority).toBe('low')
    expect(result.muscleSubgroups.glutes.isExplicit).toBe(true)
    expect(result.muscleGroups.glutes.priority).toBe('normal')
    expect(result.muscleGroups.glutes.isExplicit).toBe(false)
  })

  it('both rows can coexist for one tag_value, each carrying its own priority', () => {
    const result = densifyPriorities([
      { tagType: 'muscle_group', tagValue: 'calves', priority: 'top', updatedAt: '2026-01-01T00:00:00Z' },
      { tagType: 'muscle_subgroup', tagValue: 'calves', priority: 'low', updatedAt: '2026-01-02T00:00:00Z' },
    ])

    expect(result.muscleGroups.calves.priority).toBe('top')
    expect(result.muscleSubgroups.calves.priority).toBe('low')
    expect(result.entries).toHaveLength(34)
  })

  it('an unknown tag_value is ignored — still exactly 34 entries, no throw', () => {
    const result = densifyPriorities([
      { tagType: 'muscle_subgroup', tagValue: 'not_a_real_subgroup', priority: 'top', updatedAt: '2026-01-01T00:00:00Z' },
    ])
    expect(result.entries).toHaveLength(34)
    expect(result.anyExplicit).toBe(false)
  })

  it('an unknown tag_type is ignored — still exactly 34 entries, no throw', () => {
    const result = densifyPriorities([
      { tagType: 'movement_pattern' as StoredPriority['tagType'], tagValue: 'chest', priority: 'top', updatedAt: '2026-01-01T00:00:00Z' },
    ])
    expect(result.entries).toHaveLength(34)
    expect(result.anyExplicit).toBe(false)
  })

  it('entries order is deterministic — PRIORITY_TREE order, each group immediately followed by its own subgroups', () => {
    const result = densifyPriorities([])
    const tags = result.entries.map((e) => e.tagValue)
    expect(tags.slice(0, 4)).toEqual(['chest', 'upper_chest', 'mid_chest', 'lower_chest'])
    expect(tags[tags.length - 1]).toBe('adductors')
    expect(tags[tags.length - 2]).toBe('other')
  })

  it('two calls over the same input produce structurally identical output, so two mesos\' contexts diff readably', () => {
    const rows: StoredPriority[] = [
      { tagType: 'muscle_group', tagValue: 'quads', priority: 'high', updatedAt: '2026-01-01T00:00:00Z' },
    ]
    expect(densifyPriorities(rows)).toEqual(densifyPriorities(rows))
  })
})
