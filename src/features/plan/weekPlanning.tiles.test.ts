import { describe, it, expect } from 'vitest'
import { weekTiles, type WeekTile } from './weekPlanning'

// Chunk 42 — which weeks exist and what each tile says (SPEC, Plan screen → Week row; Weeks and copying → How far
// ahead, with Adam's answer to G56, DECISIONS 131: "The week tiles always reach the current week. A past week that was
// never planned shows NOT PLANNED, read-only and empty, with no PLAN FORWARD, and nothing is written for it.").
// weekTiles is pure: the planned week numbers and the current week in, the tiles out. The screen (chunk 52) draws
// them; its own tests prove the wiring.

// One string per tile: `week:state`, then `:read-only` (the week opens as a past week does, board 1c) and
// `:plan-forward` (it opens with PLAN FORWARD, board 1b) where the tile has them.
const flags = (t: WeekTile) => `${t.week}:${t.state}${t.readOnly ? ':read-only' : ''}${t.planForward ? ':plan-forward' : ''}`
const show = (planned: Iterable<number>, currentWeek: number) =>
  weekTiles({ plannedWeeks: planned, currentWeek }).map(flags)

describe('weekTiles — weeks planned one at a time (no week missed): up to the first unplanned week, and no further', () => {
  it('past weeks DONE, the current week THIS, a week planned ahead PLANNED, then the first unplanned as NOT PLANNED with PLAN FORWARD', () => {
    expect(show([1, 2, 3], 2)).toEqual(['1:done:read-only', '2:this', '3:planned', '4:not_planned:plan-forward'])
    expect(show([1, 2, 3, 4], 2)).toEqual(['1:done:read-only', '2:this', '3:planned', '4:planned', '5:not_planned:plan-forward'])
    expect(show([1, 2, 3, 4], 4)).toEqual(['1:done:read-only', '2:done:read-only', '3:done:read-only', '4:this', '5:not_planned:plan-forward'])
    expect(show([1, 2, 3, 4], 1)).toEqual(['1:this', '2:planned', '3:planned', '4:planned', '5:not_planned:plan-forward'])
  })

  it('a tile is exactly its week, state and the two flags', () => {
    expect(weekTiles({ plannedWeeks: [1, 2], currentWeek: 2 })).toEqual([
      { week: 1, state: 'done', readOnly: true, planForward: false },
      { week: 2, state: 'this', readOnly: false, planForward: false },
      { week: 3, state: 'not_planned', readOnly: false, planForward: true },
    ])
  })

  it('nothing beyond the first unplanned week after the current one is reachable, even when a later week is planned', () => {
    // Week 5 is planned but week 4 is not: PLAN FORWARD on 4 comes first ("you can't go to week 4, but after you click
    // plan forward on week 3, you can go to week 4").
    expect(show([1, 2, 3, 5], 3)).toEqual(['1:done:read-only', '2:done:read-only', '3:this', '4:not_planned:plan-forward'])
    expect(show([1, 2, 3, 4, 6, 7], 2)).toEqual(['1:done:read-only', '2:this', '3:planned', '4:planned', '5:not_planned:plan-forward'])
  })

  it('nothing planned yet: one tile, week 1, NOT PLANNED, and it is the current week so it offers no PLAN FORWARD', () => {
    expect(show([], 1)).toEqual(['1:not_planned'])
  })

  it('a current week that is not planned yet reads NOT PLANNED, not THIS (Plan plans it on open, chunk 52): no PLAN FORWARD, no tile after it', () => {
    expect(show([1, 2], 3)).toEqual(['1:done:read-only', '2:done:read-only', '3:not_planned'])
    // A week planned ahead of an unplanned current week is out of reach: the current week is the first unplanned one.
    expect(show([1, 2, 4], 3)).toEqual(['1:done:read-only', '2:done:read-only', '3:not_planned'])
  })
})

describe('weekTiles — a week nobody planned (G56, DECISIONS 131 (b)): the tiles still reach the current week', () => {
  it('planned {1,2,4}, the current week 4 (week 3 was never planned): tiles 1, 2, 3, 4, 5 — 3 is NOT PLANNED and read-only, 5 is the first unplanned', () => {
    expect(show([1, 2, 4], 4)).toEqual([
      '1:done:read-only',
      '2:done:read-only',
      '3:not_planned:read-only', // the missed week: NOT PLANNED, read-only, no PLAN FORWARD
      '4:this',
      '5:not_planned:plan-forward',
    ])
  })

  it('the missed week is read-only, offers no PLAN FORWARD and is not DONE; PLAN FORWARD is on the week after the current one only', () => {
    const tiles = weekTiles({ plannedWeeks: [1, 2, 4], currentWeek: 4 })
    expect(tiles[2]).toEqual({ week: 3, state: 'not_planned', readOnly: true, planForward: false })
    expect(tiles.filter((t) => t.planForward)).toEqual([{ week: 5, state: 'not_planned', readOnly: false, planForward: true }])
  })

  it('a week beyond the old stopping place is reachable: planned {1,2}, the current week 6 → tiles 1 to 6, weeks 3 to 5 NOT PLANNED and read-only', () => {
    expect(show([1, 2], 6)).toEqual([
      '1:done:read-only',
      '2:done:read-only',
      '3:not_planned:read-only',
      '4:not_planned:read-only',
      '5:not_planned:read-only',
      '6:not_planned', // the current week, not planned yet: the last tile
    ])
  })

  it('the same with the current week planned: it is THIS WEEK and the week after it is the first unplanned one, with PLAN FORWARD', () => {
    expect(show([1, 2, 6], 6)).toEqual([
      '1:done:read-only',
      '2:done:read-only',
      '3:not_planned:read-only',
      '4:not_planned:read-only',
      '5:not_planned:read-only',
      '6:this',
      '7:not_planned:plan-forward',
    ])
    expect(show([1, 2, 6, 7], 6).slice(-3)).toEqual(['6:this', '7:planned', '8:not_planned:plan-forward'])
  })

  it('a missed week between planned ones: it reads NOT PLANNED while the planned weeks around it read DONE', () => {
    expect(show([1, 3, 4], 4)).toEqual(['1:done:read-only', '2:not_planned:read-only', '3:done:read-only', '4:this', '5:not_planned:plan-forward'])
  })

  it('nothing ever planned and the run already in week 3 (the app was not opened before): weeks 1 and 2 are missed, 3 is the last tile', () => {
    expect(show([], 3)).toEqual(['1:not_planned:read-only', '2:not_planned:read-only', '3:not_planned'])
  })

  it('only a week before the current one is read-only: the unplanned week still to come is not a missed week', () => {
    expect(show([1, 2, 3], 2).filter((t) => t.includes('read-only'))).toEqual(['1:done:read-only'])
    expect(show([1, 2], 1).filter((t) => t.includes('read-only'))).toEqual([])
  })
})

describe('weekTiles — SPEC\'s sentences, for every pattern of planned weeks (1–6) and every current week (1–8)', () => {
  it('holds for all 512 of them', () => {
    const everyWeek = Array.from({ length: 12 }, (_, i) => i + 1)
    for (let mask = 0; mask < 64; mask++) {
      const planned = [1, 2, 3, 4, 5, 6].filter((w) => mask & (1 << (w - 1)))
      for (let current = 1; current <= 8; current++) {
        const tiles = weekTiles({ plannedWeeks: planned, currentWeek: current })
        const where = `planned ${JSON.stringify(planned)}, current week ${current}`
        const tileOf = (week: number) => tiles.find((t) => t.week === week)

        // "A tile per week from week 1": no week skipped.
        expect(tiles.map((t) => t.week), where).toEqual(tiles.map((_, i) => i + 1))
        // "The week tiles always reach the current week", and "nothing beyond the first unplanned week": the last
        // tile is the first unplanned week at or after the current one.
        const firstUnplannedFromCurrent = everyWeek.filter((w) => w >= current).find((w) => !planned.includes(w))
        expect(tiles[tiles.length - 1]?.week, where).toBe(firstUnplannedFromCurrent)
        // Every tile says what the week is: planned or not.
        for (const t of tiles) expect(t.state === 'not_planned', `${where}, week ${t.week}`).toBe(!planned.includes(t.week))
        // A past week: DONE when planned, NOT PLANNED when never planned; read-only either way; never PLAN FORWARD.
        for (const t of tiles.filter((t) => t.week < current)) {
          expect(t.state, `${where}, week ${t.week}`).toBe(planned.includes(t.week) ? 'done' : 'not_planned')
          expect(t.readOnly, `${where}, week ${t.week}`).toBe(true)
          expect(t.planForward, `${where}, week ${t.week}`).toBe(false)
        }
        // The current week: THIS when planned, NOT PLANNED when not; open to edit; no PLAN FORWARD.
        expect(tileOf(current), where).toEqual({
          week: current,
          state: planned.includes(current) ? 'this' : 'not_planned',
          readOnly: false,
          planForward: false,
        })
        // After the current week: the weeks planned ahead, then the first unplanned one with PLAN FORWARD, and nothing else.
        const ahead = tiles.filter((t) => t.week > current)
        ahead.forEach((t, i) => {
          const last = i === ahead.length - 1
          expect(t, `${where}, week ${t.week}`).toEqual({
            week: t.week,
            state: last ? 'not_planned' : 'planned',
            readOnly: false,
            planForward: last,
          })
        })
        // So at most one tile offers PLAN FORWARD, and none unless the current week is planned.
        expect(tiles.filter((t) => t.planForward).length, where).toBe(planned.includes(current) ? 1 : 0)
      }
    }
  })
})

describe('weekTiles — the input', () => {
  it('the order, duplicates and junk in the planned list do not matter: only positive whole weeks count', () => {
    expect(show([3, 1, 2, 2, 1], 2)).toEqual(['1:done:read-only', '2:this', '3:planned', '4:not_planned:plan-forward'])
    expect(show([0, -1, 1.5, Number.NaN, 1], 1)).toEqual(['1:this', '2:not_planned:plan-forward'])
  })

  it('takes any iterable (a Set of week numbers)', () => {
    expect(weekTiles({ plannedWeeks: new Set([1, 2]), currentWeek: 1 }).map((t) => t.week)).toEqual([1, 2, 3])
  })

  it('a current week that is not a whole number from 1 has no tiles to reach: it throws (as chooseAutoCopySource does for a week below 1)', () => {
    // In this order on purpose: the first of them that doesn't throw ends the test, so a loosened check never reaches Infinity.
    expect(() => weekTiles({ plannedWeeks: [1], currentWeek: 0 })).toThrow(RangeError)
    expect(() => weekTiles({ plannedWeeks: [1], currentWeek: -1 })).toThrow(RangeError)
    expect(() => weekTiles({ plannedWeeks: [1], currentWeek: 1.5 })).toThrow(RangeError)
    expect(() => weekTiles({ plannedWeeks: [1], currentWeek: Number.NaN })).toThrow(RangeError)
    expect(() => weekTiles({ plannedWeeks: [1], currentWeek: Number.POSITIVE_INFINITY })).toThrow(RangeError)
  })
})
