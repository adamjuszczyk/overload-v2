import { describe, it, expect } from 'vitest'
import {
  findLastUsableWeek,
  resolveWeekSources,
  resolveManualCopySource,
  type PlannedWeekRecord,
} from './weekSources'

// Third element is isEmpty, defaulting to false — most fixtures below are
// about deload, not emptiness, and stay terse; DECISIONS 42's own cases
// pass it explicitly.
function weeks(...entries: Array<[number, boolean, boolean?]>): PlannedWeekRecord[] {
  return entries.map(([weekNumber, isDeload, isEmpty = false]) => ({ weekNumber, isDeload, isEmpty }))
}

describe('findLastUsableWeek', () => {
  it('returns null when there is no prior week at all', () => {
    expect(findLastUsableWeek([], 3)).toBeNull()
  })

  it('returns the most recent prior week when none are deload or empty', () => {
    expect(findLastUsableWeek(weeks([1, false], [2, false]), 3)).toBe(2)
  })

  it('skips a deload occurrence and finds the one before it', () => {
    expect(findLastUsableWeek(weeks([1, false], [2, true]), 3)).toBe(1)
  })

  it('returns null when every prior occurrence is deload', () => {
    expect(findLastUsableWeek(weeks([1, true], [2, true]), 3)).toBeNull()
  })

  it('ignores a week at or after beforeWeek (never looks forward)', () => {
    // week 3 itself and a hypothetical week 4 must never be candidates when
    // resolving week 3's own source.
    expect(findLastUsableWeek(weeks([1, false], [3, false], [4, false]), 3)).toBe(1)
  })

  it('is order-independent — the input need not be sorted', () => {
    expect(findLastUsableWeek(weeks([3, false], [1, false], [2, true]), 4)).toBe(3)
  })

  // ── DECISIONS 42 (b), 2026-10-05: "skip an empty last occurrence, the
  // same as deload" ──────────────────────────────────────────────────────

  it('skips a single empty (non-deload) occurrence and finds the one before it', () => {
    expect(findLastUsableWeek(weeks([1, false], [2, false, true]), 3)).toBe(1)
  })

  it('empty then deload then normal: skips both unusable occurrences in a row, finds the real one', () => {
    // Walking back from week 4: week 3 is empty, week 2 is deload, week 1
    // is a real, usable occurrence.
    expect(findLastUsableWeek(weeks([1, false], [2, true], [3, false, true]), 4)).toBe(1)
  })

  it('deload then empty: the same two-skip chain in the other order', () => {
    // Walking back from week 4: week 3 is deload, week 2 is empty, week 1
    // is the real one.
    expect(findLastUsableWeek(weeks([1, false], [2, false, true], [3, true]), 4)).toBe(1)
  })

  it('all empty → null, even with several candidates', () => {
    expect(findLastUsableWeek(weeks([1, false, true], [2, false, true], [3, false, true]), 4)).toBeNull()
  })

  it('a mix of empty and deload, none usable → null', () => {
    expect(findLastUsableWeek(weeks([1, true], [2, false, true], [3, true]), 4)).toBeNull()
  })

  it('an occurrence that is BOTH deload and empty is still just skipped once (not a special case)', () => {
    expect(findLastUsableWeek(weeks([1, false], [2, true, true]), 3)).toBe(1)
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

describe('resolveWeekSources — stable: volume is always the program, weight/RIR from the last usable week', () => {
  it('week 2, a usable week 1 exists', () => {
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

  it('week 1 was empty (not deload): stable volume is still the program; weight/RIR is still "none"', () => {
    const d = resolveWeekSources({
      planningType: 'stable',
      weekNumber: 2,
      weekStart: 'copy',
      priorWeeks: weeks([1, false, true]),
    })
    expect(d.volume).toEqual({ kind: 'program' })
    expect(d.weightRir).toEqual({ kind: 'none' })
  })

  it('a deload week 3 is skipped in favour of usable week 2 (deload is never a copy source)', () => {
    const d = resolveWeekSources({
      planningType: 'stable',
      weekNumber: 4,
      weekStart: 'copy',
      priorWeeks: weeks([1, false], [2, false], [3, true]),
    })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 2 })
  })

  it('an empty week 3 is skipped the same way, in favour of usable week 2', () => {
    const d = resolveWeekSources({
      planningType: 'stable',
      weekNumber: 4,
      weekStart: 'copy',
      priorWeeks: weeks([1, false], [2, false], [3, false, true]),
    })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 2 })
  })
})

describe('resolveWeekSources — week-dependent, week_start = \'copy\' (the default)', () => {
  it('week 2 copies from the usable week 1', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 2,
      weekStart: 'copy',
      priorWeeks: weeks([1, false]),
    })
    expect(d.volume).toEqual({ kind: 'week', weekNumber: 1 })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('"missing source" — week_start is copy but nothing usable has ever been planned: empty, not an error', () => {
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

  it('"missing source" — the only prior week exists but was empty (DECISIONS 42)', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 2,
      weekStart: 'copy',
      priorWeeks: weeks([1, false, true]),
    })
    expect(d.volume).toEqual({ kind: 'empty' })
    expect(d.weightRir).toEqual({ kind: 'none' })
  })

  it('all prior weeks empty → empty, regardless of how many there are', () => {
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 4,
      weekStart: 'copy',
      priorWeeks: weeks([1, false, true], [2, false, true], [3, false, true]),
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

  it('DECISIONS 42: an empty (but not deload) prior week is now skipped, the same as deload — no longer the literal source', () => {
    // Before DECISIONS 42 this resolved to week 2 (empty, but "usable" by
    // the old deload-only rule); Adam's answer (b) reverses that.
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 3,
      weekStart: 'copy',
      priorWeeks: weeks([1, false], [2, false, true]),
    })
    expect(d.volume).toEqual({ kind: 'week', weekNumber: 1 })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('DECISIONS 42: week 4 was empty, week 5 skips it and copies from the last real week (3)', () => {
    // The exact scenario named in review: a week-dependent run whose week
    // 4 came out empty (e.g. week_start = 'empty' at the time) must not
    // leave week 5 empty too — it has to reach back to week 3's real
    // content. Mirrors this chunk's scratch run on the replayed database.
    const d = resolveWeekSources({
      planningType: 'week_dependent',
      weekNumber: 5,
      weekStart: 'copy',
      priorWeeks: weeks([1, false], [2, true], [3, false], [4, false, true]),
    })
    expect(d.volume).toEqual({ kind: 'week', weekNumber: 3 })
    expect(d.weightRir).toEqual({ kind: 'week', weekNumber: 3 })
  })
})

describe('resolveWeekSources — week-dependent, week_start = \'empty\'', () => {
  it('week > 1 is always empty, even when a perfectly good usable source exists', () => {
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
  it('finds the last usable week exactly like the automatic search', () => {
    expect(resolveManualCopySource(weeks([1, false], [2, true]), 3)).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('DECISIONS 42: skips an empty occurrence too, reaching back to the last real one', () => {
    expect(resolveManualCopySource(weeks([1, false], [2, false, true]), 3)).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('"missing source": none when nothing usable has ever been planned', () => {
    expect(resolveManualCopySource([], 2)).toEqual({ kind: 'none' })
    expect(resolveManualCopySource(weeks([1, true]), 2)).toEqual({ kind: 'none' })
    expect(resolveManualCopySource(weeks([1, false, true]), 2)).toEqual({ kind: 'none' })
  })

  it('does not take week_start at all — the manual action tries to copy regardless of the automatic default', () => {
    // No weekStart parameter exists on this function's signature; this
    // test is a compile-time guarantee as much as a runtime one — the
    // function only accepts (priorWeeks, beforeWeek).
    const result = resolveManualCopySource(weeks([1, false]), 2)
    expect(result).toEqual({ kind: 'week', weekNumber: 1 })
  })
})

// Chunk 21, reviewer's note 4 — "copy sources already skip deload sessions
// (chunk 8)... add a test proving a newly marked session is skipped as a
// source end to end, through weekSources.ts." This doesn't hand-build a
// PlannedWeekRecord with isDeload: true (every case above already does
// that) — it starts from the DB ROW shape v2_week_plans actually has, marks
// one week's row the same way chunk 21's marking does (flips is_deload on
// that one row, nothing else), maps rows into PlannedWeekRecord the SAME
// way weekPlanService.ts's fetchPlannedWeekHistory does (the real function
// both copyOneWorkoutFromHistory call sites feed into resolveManualCopySource),
// and only then calls into weekSources.ts — so the thing under test is the
// whole chain "mark a row" -> "read it back" -> "resolve a copy source",
// not just the pure decision in isolation.
describe('a newly marked session is skipped as a copy source, end to end through weekSources.ts (chunk 21)', () => {
  // The exact row shape weekPlanService.ts's fetchPlannedWeekHistory selects
  // (week_number, is_deload, v2_week_plan_sets(id)) — isEmpty is derived
  // from the embed's length, never a stored column, same as production.
  interface DbWeekPlanRow {
    week_number: number
    is_deload: boolean
    v2_week_plan_sets: { id: string }[]
  }

  function toPlannedWeekRecords(rows: DbWeekPlanRow[]): PlannedWeekRecord[] {
    return rows.map((r) => ({
      weekNumber: r.week_number,
      isDeload: r.is_deload,
      isEmpty: (r.v2_week_plan_sets ?? []).length === 0,
    }))
  }

  // setWeekDeload's own write shape (weekPlanService.ts): every row sharing
  // the targeted week_number flips to the new is_deload value; every other
  // row is untouched — exactly what the live scratch-SQL check proves
  // against the real table, mirrored here against the in-memory rows this
  // workout's own history query would return.
  function markWeek(rows: DbWeekPlanRow[], weekNumber: number, isDeload: boolean): DbWeekPlanRow[] {
    return rows.map((r) => (r.week_number === weekNumber ? { ...r, is_deload: isDeload } : r))
  }

  it('week 1 normal, week 2 freshly marked deload: week 3\'s source is week 1, not week 2', () => {
    const rowsBeforeMarking: DbWeekPlanRow[] = [
      { week_number: 1, is_deload: false, v2_week_plan_sets: [{ id: 'set-1' }] },
      { week_number: 2, is_deload: false, v2_week_plan_sets: [{ id: 'set-2' }] },
    ]
    // Sanity: before marking, week 2 (the most recent) would win.
    expect(resolveManualCopySource(toPlannedWeekRecords(rowsBeforeMarking), 3)).toEqual({ kind: 'week', weekNumber: 2 })

    const rowsAfterMarking = markWeek(rowsBeforeMarking, 2, true)
    // Marking touched only week 2's own row — week 1's is untouched.
    expect(rowsAfterMarking.find((r) => r.week_number === 1)?.is_deload).toBe(false)
    expect(rowsAfterMarking.find((r) => r.week_number === 2)?.is_deload).toBe(true)

    const records = toPlannedWeekRecords(rowsAfterMarking)
    expect(resolveManualCopySource(records, 3)).toEqual({ kind: 'week', weekNumber: 1 })
    // The automatic path (v2_plan_week's own TS mirror) agrees.
    expect(
      resolveWeekSources({ planningType: 'week_dependent', weekNumber: 3, weekStart: 'copy', priorWeeks: records }).volume,
    ).toEqual({ kind: 'week', weekNumber: 1 })
  })

  it('unmarking that same session restores it as the usable source again', () => {
    const marked: DbWeekPlanRow[] = [
      { week_number: 1, is_deload: false, v2_week_plan_sets: [{ id: 'set-1' }] },
      { week_number: 2, is_deload: true, v2_week_plan_sets: [{ id: 'set-2' }] },
    ]
    expect(resolveManualCopySource(toPlannedWeekRecords(marked), 3)).toEqual({ kind: 'week', weekNumber: 1 })

    const unmarked = markWeek(marked, 2, false)
    expect(resolveManualCopySource(toPlannedWeekRecords(unmarked), 3)).toEqual({ kind: 'week', weekNumber: 2 })
  })
})
