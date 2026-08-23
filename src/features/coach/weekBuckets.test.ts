import { describe, it, expect } from 'vitest'
import { bucketOccurrences, type TaggableOccurrence } from './weekBuckets'

function occ(
  occurrenceId: string,
  exerciseId: string,
  tags: TaggableOccurrence['tags'],
): TaggableOccurrence {
  return { occurrenceId, exerciseId, tags }
}

describe('bucketOccurrences', () => {
  it('a multi-tagged exercise lands in every named subgroup bucket, unmodified and in full (SPEC §4/§5)', () => {
    const result = bucketOccurrences([
      occ('s1:incline-press', 'incline-press', {
        muscleGroup: 'chest',
        muscleSubgroups: ['upper_chest', 'front_delt'],
        movementPattern: 'horizontal_push',
      }),
    ])

    expect(result.bySubgroup).toHaveLength(2)
    const keys = result.bySubgroup.map((b) => b.key).sort()
    expect(keys).toEqual(['subgroup:front_delt', 'subgroup:upper_chest'])
    for (const bucket of result.bySubgroup) {
      expect(bucket.occurrenceIds).toEqual(['s1:incline-press'])
      expect(bucket.isFallback).toBe(false)
      expect(bucket.kind).toBe('muscle_subgroup')
    }
    expect(result.occurrences[0].bucketKeys).toEqual(
      expect.arrayContaining(['subgroup:upper_chest', 'subgroup:front_delt', 'pattern:horizontal_push']),
    )
  })

  it('an untagged exercise (tags row exists, no muscleSubgroups) falls back to muscleGroup with isFallback: true', () => {
    const result = bucketOccurrences([
      occ('s1:lateral-raise', 'lateral-raise', {
        muscleGroup: 'shoulders',
        muscleSubgroups: null,
        movementPattern: null,
      }),
    ])

    expect(result.bySubgroup).toHaveLength(1)
    expect(result.bySubgroup[0]).toMatchObject({
      key: 'subgroup:shoulders',
      kind: 'muscle_subgroup',
      label: 'shoulders',
      isFallback: true,
    })
  })

  it('a null movement_pattern means the occurrence appears on the subgroup axis only (§7.9 — no fallback for pattern)', () => {
    const result = bucketOccurrences([
      occ('s1:plank', 'plank', { muscleGroup: 'core', muscleSubgroups: ['abs'], movementPattern: null }),
    ])

    expect(result.bySubgroup).toHaveLength(1)
    expect(result.byPattern).toHaveLength(0)
    expect(result.occurrences[0].bucketKeys).toEqual(['subgroup:abs'])
  })

  it('the same exercise trained twice in a week produces two independent occurrences in the same bucket', () => {
    const result = bucketOccurrences([
      occ('session-a:bench', 'bench', { muscleGroup: 'chest', muscleSubgroups: ['mid_chest'], movementPattern: 'horizontal_push' }),
      occ('session-b:bench', 'bench', { muscleGroup: 'chest', muscleSubgroups: ['mid_chest'], movementPattern: 'horizontal_push' }),
    ])

    expect(result.occurrences).toHaveLength(2)
    const subgroupBucket = result.bySubgroup.find((b) => b.key === 'subgroup:mid_chest')
    expect(subgroupBucket?.occurrenceIds).toEqual(['session-a:bench', 'session-b:bench'])
    const patternBucket = result.byPattern.find((b) => b.key === 'pattern:horizontal_push')
    expect(patternBucket?.occurrenceIds).toEqual(['session-a:bench', 'session-b:bench'])
  })

  it('an occurrence with no tags row at all still lands in a bucket rather than vanishing (§7.12)', () => {
    const result = bucketOccurrences([occ('s1:mystery', 'mystery-exercise', null)])

    expect(result.occurrences).toHaveLength(1)
    expect(result.bySubgroup).toHaveLength(1)
    expect(result.bySubgroup[0]).toMatchObject({ key: 'subgroup:untagged', label: 'untagged', isFallback: true })
    expect(result.byPattern).toHaveLength(0) // no pattern data to place on that axis at all
    expect(result.occurrences[0].bucketKeys).toEqual(['subgroup:untagged'])
  })

  it('an exercise tagged with no muscleGroup either falls back all the way to the untagged bucket', () => {
    const result = bucketOccurrences([
      occ('s1:edge-case', 'edge-case', { muscleGroup: null, muscleSubgroups: null, movementPattern: null }),
    ])
    expect(result.bySubgroup[0]).toMatchObject({ key: 'subgroup:untagged', isFallback: true })
  })
})
