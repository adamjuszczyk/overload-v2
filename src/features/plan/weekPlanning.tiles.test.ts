import { describe, it, expect } from 'vitest'
import { firstUnplannedWeek, weekTiles } from './weekPlanning'

// Chunk 42 — which weeks exist and what each tile says (SPEC, Plan screen → Week row; Weeks and copying →
// How far ahead). weekTiles is pure: the planned week numbers and the current week in, the tiles out.
// The screen (chunk 52) draws them; its own tests prove the wiring.

const states = (planned: number[], currentWeek: number) =>
  weekTiles({ plannedWeeks: planned, currentWeek }).map((t) => `${t.week}:${t.state}`)

describe('weekTiles — a tile per week from 1 to the first unplanned one, and no further', () => {
  it('weeks planned one at a time: every planned week, then the first unplanned as NOT PLANNED', () => {
    expect(states([1, 2, 3], 2)).toEqual(['1:done', '2:this', '3:planned', '4:not_planned'])
  })

  it('stops at the first unplanned week even when a later week is planned (planned {1,2,4} → tiles 1, 2, 3; 4 is not reachable)', () => {
    const tiles = weekTiles({ plannedWeeks: [1, 2, 4], currentWeek: 2 })
    expect(tiles.map((t) => t.week)).toEqual([1, 2, 3])
    expect(tiles[2]).toEqual({ week: 3, state: 'not_planned' })
    expect(tiles.some((t) => t.week === 4)).toBe(false)
  })

  it('past weeks are DONE, the current week THIS, a week planned ahead PLANNED, the first unplanned NOT PLANNED', () => {
    expect(states([1, 2, 3, 4], 2)).toEqual(['1:done', '2:this', '3:planned', '4:planned', '5:not_planned'])
    expect(states([1, 2, 3, 4], 4)).toEqual(['1:done', '2:done', '3:done', '4:this', '5:not_planned'])
    expect(states([1, 2, 3, 4], 1)).toEqual(['1:this', '2:planned', '3:planned', '4:planned', '5:not_planned'])
  })

  it('nothing planned yet: one tile, week 1, NOT PLANNED', () => {
    expect(states([], 1)).toEqual(['1:not_planned'])
  })

  it('a current week that is not planned yet reads NOT PLANNED, not THIS (Plan plans it on open, chunk 52)', () => {
    expect(states([1, 2], 3)).toEqual(['1:done', '2:done', '3:not_planned'])
  })

  it('a current week beyond the tiles has no THIS tile', () => {
    expect(states([1, 2], 6)).toEqual(['1:done', '2:done', '3:not_planned'])
  })

  it('the order, duplicates and junk in the list do not matter: only positive whole weeks count', () => {
    expect(states([3, 1, 2, 2, 1], 2)).toEqual(['1:done', '2:this', '3:planned', '4:not_planned'])
    expect(states([0, -1, 1.5, Number.NaN, 1], 1)).toEqual(['1:this', '2:not_planned'])
  })

  it('takes any iterable (a Set of week numbers)', () => {
    expect(weekTiles({ plannedWeeks: new Set([1, 2]), currentWeek: 1 }).map((t) => t.week)).toEqual([1, 2, 3])
  })
})

describe('firstUnplannedWeek', () => {
  it('is the last planned week + 1 when weeks are planned in order, and the gap when one is missing', () => {
    expect(firstUnplannedWeek([])).toBe(1)
    expect(firstUnplannedWeek([1, 2, 3])).toBe(4)
    expect(firstUnplannedWeek([1, 2, 4])).toBe(3)
    expect(firstUnplannedWeek([2, 3])).toBe(1)
  })
})
