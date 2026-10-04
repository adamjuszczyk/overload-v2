import { describe, it, expect } from 'vitest'
import { resolveLineageGroup, type WorkoutLineageRow } from './workoutLineage'

function rows(pairs: [id: string, source: string | null][]): WorkoutLineageRow[] {
  return pairs.map(([id, source_workout_day_id]) => ({ id, source_workout_day_id }))
}

describe('resolveLineageGroup', () => {
  it('no lineage: a workout with no source and nothing pointing at it resolves to just itself — today\'s production shape (027 live, source_workout_day_id NULL on every row)', () => {
    const data = rows([['w1', null]])
    expect(resolveLineageGroup('w1', data)).toEqual(['w1'])
  })

  it('root with two run copies: from the root resolves to all 3 ids', () => {
    const data = rows([
      ['root', null],
      ['copy1', 'root'],
      ['copy2', 'root'],
    ])
    const group = resolveLineageGroup('root', data)
    expect(group).toHaveLength(3)
    expect(new Set(group)).toEqual(new Set(['root', 'copy1', 'copy2']))
  })

  it('root with two run copies: from either copy resolves to the exact same 3 ids as from the root (walking up to the root first is what makes this so)', () => {
    const data = rows([
      ['root', null],
      ['copy1', 'root'],
      ['copy2', 'root'],
    ])
    const fromRoot = resolveLineageGroup('root', data)
    const fromCopy1 = resolveLineageGroup('copy1', data)
    const fromCopy2 = resolveLineageGroup('copy2', data)
    // Not just "same set" — the same root is found from every member, so
    // collectLineageGroup runs on identical inputs and the array itself
    // (order included) comes back identical every time.
    expect(fromCopy1).toEqual(fromRoot)
    expect(fromCopy2).toEqual(fromRoot)
  })

  it('a 2-level chain (root <- mid <- leaf): resolves transitively, from any of the 3 members, to all 3 ids — not just the root\'s direct child', () => {
    const data = rows([
      ['a', null], // root
      ['b', 'a'], // 1 level below root
      ['c', 'b'], // 2 levels below root
    ])
    const fromLeaf = resolveLineageGroup('c', data)
    expect(new Set(fromLeaf)).toEqual(new Set(['a', 'b', 'c']))
    expect(resolveLineageGroup('b', data)).toEqual(fromLeaf)
    expect(resolveLineageGroup('a', data)).toEqual(fromLeaf)
  })

  it('a dangling source (points at an id not present in rows) stops the walk — the workout is treated as its own root', () => {
    const data = rows([['w', 'ghost-not-in-rows']])
    expect(resolveLineageGroup('w', data)).toEqual(['w'])
  })

  it('a dangling source at the top still collects a real descendant below it — dangling makes the workout its own root, not a dead end', () => {
    const data = rows([
      ['w', 'ghost-not-in-rows'],
      ['child', 'w'],
    ])
    expect(new Set(resolveLineageGroup('w', data))).toEqual(new Set(['w', 'child']))
  })

  it('a cycle (a -> source b -> source a) terminates and returns a sane result: both cycle members, nothing else, from either starting point', () => {
    const data = rows([
      ['a', 'b'],
      ['b', 'a'],
    ])
    const fromA = resolveLineageGroup('a', data)
    const fromB = resolveLineageGroup('b', data)
    expect(new Set(fromA)).toEqual(new Set(['a', 'b']))
    expect(new Set(fromB)).toEqual(new Set(['a', 'b']))
  })

  it('unrelated workouts are excluded: a standalone workout with no edge to the group never appears in it', () => {
    const data = rows([
      ['root', null],
      ['copy1', 'root'],
      ['other', null], // unrelated, standalone
    ])
    const group = resolveLineageGroup('copy1', data)
    expect(new Set(group)).toEqual(new Set(['root', 'copy1']))
    expect(group).not.toContain('other')
  })
})
