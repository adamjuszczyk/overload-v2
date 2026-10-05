import { describe, it, expect } from 'vitest'
import {
  findLastNonDeloadWeek,
  resolveWeekSources,
  resolveManualCopySource,
  type PlannedWeekRecord,
} from './weekSources'

function weeks(...entries: Array<[number, boolean]>): PlannedWeekRecord[] {
  return entries.map(([weekNumber, isDeload]) => ({ weekNumber, isDeload }))
}

describe('findLastNonDeloadWeek', () => {
  it('returns null when there is no prior week at all', () => {
    expect(findLastNonDeloadWeek([], 3)).toBeNull()
  })

  it('returns the most recent prior week when none are deload', () => {
    expect(findLastNonDeloadWeek(weeks([1, false], [2, false]), 3)).toBe(2)
  })

  it('skips a deload occurrence and finds the one before it', () => {
    expect(findLastNonDeloadWeek(weeks([1, false], [2, true]), 3)).toBe(1)
  })

  it('returns null when every prior occurrence is deload', () => {
    expect(findLastNonDeloadWeek(weeks([1, true], [2, true]), 3)).toBeNull()
  })

  it('ignores a week at or after beforeWeek (never looks forward)', () => {
    // week 3 itself and a hypothetical week 4 must never be candidates when
    // resolving week 3's own source.
    expect(findLastNonDeloadWeek(weeks([1, false], [3, false], [4, false]), 3)).toBe(1)
  })

  it('is order-independent — the input need not be sorted', () => {
    expect(findLastNonDeloadWeek(weeks([3, false], [1, false], [2, true]), 4)).toBe(3)
  })

  it('an empty, non-deload prior week still counts as "the last planned week" (no second exclusion beyond deload)', () => {
    // weekSources.ts's own header: SPEC excludes deload, not "empty" — an
    // occurrence that was itself planned with nothing in it is still a
    // real, non-deload prior week and is found like any other.
    expect(findLastNonDeloadWeek(weeks([1, false], [2, false]), 3)).toBe(2)
  })
})

describe('resolveWeekSources — week 1 always comes from the program, for both planning types', () => {
  it('stable, week 1, no prior weeks', () => {
    const d = resolveWeekSources({ planningType: 'stable', weekNumber: 1, weekStart: 'copy', priorWeeks: [] })
    expect(d.volume).toEqual({ kind: 'program' })
    expect(d.weightRir).toEqual({ kind: 'none' })
  })

  it('week_dependent, week 1, regardless of week_start', () => {
    for (const weekStart of ['copy', 'empty'] as const) {
      const d = resolveWeekSources({ planningType: 'week_dependent', weekNumber: 1, weekStart, priorWeeks: [] })
      expect(d.volume).toEqual({ kind: 'program' })
    }
  })
})

describe('resolveWeekSources — stable: volume is always the program, weight/RIR from the last non-deload week', () => {
  it('week 2, a non-deload week 1 exists', () => {
    const d = resolveWeekSources({
      planningType: 'stable',
      weekNumber: 2,
      weekStart: 'copy', // irrelevant to stable
      priorWeeks: weeks([1, false]),
    })
    expect(d.volume).toEqual({ kind: 'program' })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('week_start = empty makes no difference to a stable program\'s volume', () => {
    const d = resolveWeekSources({
      planningType: 'stable',
      weekNumber: 2,
      weekStart: 'empty',
      priorWeeks: weeks([1, false]),
    })
    expect(d.volume).toEqual({ kind: 'program' })
  })

  it('week 1 was deload: stable volume is still the program; weight/RIR is "none" (missing source)', () => {
    const d = resolveWeekSources({
      planningType: 'stable',
      weekNumber: 2,
      weekStart: 'copy',
      priorWeeks: weeks([1, true]),
    })
    expect(d.volume).toEqual({ kind: 'program' })
    expect(d.weightRir).toEqual({ kind: 'none' })
  })

  it('a deload week 3 is skipped in favour of non-deload week 2 (deload is never a copy source)', () => {
    const d = resolveWeekSources({
      planningType: 'stable',
      weekNumber: 4,
      weekStart: 'copy',
      priorWeeks: weeks([1, false], [2, false], [3, true]),
    })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 2 })
  })
})

describe('resolveWeekSources — week-dependent, week_start = \'copy\' (the default)', () => {
  it('week 2 copies from the non-deload week 1', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 2,
      weekStart: 'copy',
      priorWeeks: weeks([1, false]),
    })
    expect(d.volume).toEqual({ kind: 'week', weekNumber: 1 })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('"missing source" — week_start is copy but nothing non-deload has ever been planned: empty, not an error', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 2,
      weekStart: 'copy',
      priorWeeks: [], // never planned
    })
    expect(d.volume).toEqual({ kind: 'empty' })
    expect(d.weightRir).toEqual({ kind: 'none' })
  })

  it('"missing source" — the only prior week exists but was deload', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 2,
      weekStart: 'copy',
      priorWeeks: weeks([1, true]),
    })
    expect(d.volume).toEqual({ kind: 'empty' })
    expect(d.weightRir).toEqual({ kind: 'none' })
  })

  it('a partly-deload week: THIS workout\'s own deload week is skipped in favour of the one before it', () => {
    // SPEC: "A week that's partly deload still copies its normal sessions;
    // its deload sessions copy from the last normal occurrence." Week 2
    // was deload for this workout; week 3's source must be week 1, not 2.
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 3,
      weekStart: 'copy',
      priorWeeks: weeks([1, false], [2, true]),
    })
    expect(d.volume).toEqual({ kind: 'week', weekNumber: 1 })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('the SAME partly-deload week, for a DIFFERENT workout that was NOT deload that week: sources from week 2 directly', () => {
    // Demonstrates the decision is made per workout, independently — the
    // caller passes each workout's own history; a different workout in
    // the identical week 2 can resolve differently.
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 3,
      weekStart: 'copy',
      priorWeeks: weeks([1, false], [2, false]),
    })
    expect(d.volume).toEqual({ kind: 'week', weekNumber: 2 })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 2 })
  })

  it('an empty (but not deload) prior week becomes the literal source — only deload is excluded', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 3,
      weekStart: 'copy',
      priorWeeks: weeks([1, false], [2, false]), // week 2 itself may have been planned empty — the
      // caller's priorWeeks record only weekNumber/isDeload, not content, by design (see header).
    })
    expect(d.volume).toEqual({ kind: 'week', weekNumber: 2 })
  })
})

describe('resolveWeekSources — week-dependent, week_start = \'empty\'', () => {
  it('week > 1 is always empty, even when a perfectly good non-deload source exists', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 2,
      weekStart: 'empty',
      priorWeeks: weeks([1, false]),
    })
    expect(d.volume).toEqual({ kind: 'empty' })
  })

  it('weight/RIR source is unaffected by week_start — it only gates volume', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 2,
      weekStart: 'empty',
      priorWeeks: weeks([1, false]),
    })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 1 })
  })
})

describe('resolveManualCopySource — "Copy last week" / "Copy this workout"', () => {
  it('finds the last non-deload week exactly like the automatic search', () => {
    expect(resolveManualCopySource(weeks([1, false], [2, true]), 3)).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('"missing source": none when nothing non-deload has ever been planned', () => {
    expect(resolveManualCopySource([], 2)).toEqual({ kind: 'none' })
    expect(resolveManualCopySource(weeks([1, true]), 2)).toEqual({ kind: 'none' })
  })

  it('does not take week_start at all — the manual action tries to copy regardless of the automatic default', () => {
    // No weekStart parameter exists on this function's signature; this
    // test is a compile-time guarantee as much as a runtime one — the
    // function only accepts (priorWeeks, beforeWeek).
    const result = resolveManualCopySource(weeks([1, false]), 2)
    expect(result).toEqual({ kind: 'week', weekNumber: 1 })
  })
})
