import { describe, it, expect } from 'vitest'
import { resolveExerciseReference, resolveSecondaryReference } from './referenceLogic'
import type { ReferenceSession } from './sessionService'
import type { SetLog } from '../../types'
import type { SetGroup } from './setGroupLogic'

function makeSession(
  sessionId: string,
  date: string,
  completedAt: string | null = null,
  mesocycleId: string | null = null,
  logs: SetGroup<SetLog>[] = [],
): ReferenceSession {
  return { sessionId, date, completedAt, mesocycleId, logs }
}

// Minimal SetLog stand-in — resolveSecondaryReference's hasRealLoggedSet only
// ever reads `.isSkipped` on a group's head, so every other field is
// irrelevant filler required only to satisfy the type.
function makeLog(isSkipped: boolean): SetLog {
  return {
    id: 'log-' + Math.random(),
    userId: 'u1',
    sessionId: 's',
    exerciseId: 'ex1',
    weekPlanSetId: null,
    setNumber: 1,
    weight: isSkipped ? null : 100,
    reps: isSkipped ? null : 8,
    rir: isSkipped ? null : 2,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped,
    loggedAt: '2026-08-01T10:00:00Z',
    restSeconds: null,
  }
}

function makeGroup(isSkipped: boolean): SetGroup<SetLog> {
  return { head: makeLog(isSkipped), stages: [] }
}

describe('resolveExerciseReference — LAST WEEK (Monday-anchored, not a day count)', () => {
  // today = 2026-08-11 (Tuesday). thisWeekStart = 2026-08-10 (Monday).
  // prevWeek = [2026-08-03 (Mon), 2026-08-09 (Sun)].
  const today = '2026-08-11'

  it('excludes a session 9 days back that falls in the week BEFORE prevWeek, even though a fixed day-count window would include it', () => {
    // 2026-08-02 is a Sunday, 9 days before today, and would pass a naive
    // "within 10 days" heuristic (the old RECENT_DAYS constant) — but it's
    // in the week of Jul 27–Aug 2, one full calendar week before prevWeek.
    const outOfWindow = makeSession('s1', '2026-08-02')
    const { primary } = resolveExerciseReference(today, [outOfWindow])

    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') {
      expect(primary.session.sessionId).toBe('s1')
      expect(primary.daysSince).toBe(9)
    }
  })

  it('includes a session 8 days back that falls inside the Monday-anchored prevWeek window', () => {
    // 2026-08-03 is a Monday, 8 days before today, and the first day of
    // prevWeek — a fixed 7-day lookback from today would miss this (it's
    // 8 days back), but the calendar-week boundary correctly includes it.
    const inWindow = makeSession('s2', '2026-08-03')
    const { primary } = resolveExerciseReference(today, [inWindow])

    expect(primary.type).toBe('last_week')
    if (primary.type === 'last_week') {
      expect(primary.session.sessionId).toBe('s2')
    }
  })

  it('includes the prevWeek window boundary dates inclusively (Monday start, Sunday end)', () => {
    const start = makeSession('start', '2026-08-03') // prevWeekStart
    const end = makeSession('end', '2026-08-09') // prevWeekEnd
    const beforeStart = resolveExerciseReference(today, [start])
    const atEnd = resolveExerciseReference(today, [end])

    expect(beforeStart.primary.type).toBe('last_week')
    expect(atEnd.primary.type).toBe('last_week')
  })

  it('picks the most recent session when several fall within prevWeek', () => {
    const earlier = makeSession('earlier', '2026-08-04')
    const later = makeSession('later', '2026-08-07')
    const { primary } = resolveExerciseReference(today, [earlier, later])

    expect(primary.type).toBe('last_week')
    if (primary.type === 'last_week') {
      expect(primary.session.sessionId).toBe('later')
    }
  })

  it('breaks a same-date tie by completedAt (true completion time), not by input array order', () => {
    // Two sessions on the identical calendar date — AUDIT A3 confirms there's
    // no DB constraint preventing this, and AUDIT E8 documents same-day
    // multi-workout as real. sB genuinely finished later that day.
    const sA = makeSession('sA', '2026-08-05', '2026-08-05T09:00:00.000Z')
    const sB = makeSession('sB', '2026-08-05', '2026-08-05T18:00:00.000Z')

    const forward = resolveExerciseReference(today, [sA, sB])
    const reversed = resolveExerciseReference(today, [sB, sA])

    expect(forward.primary.type).toBe('last_week')
    expect(reversed.primary.type).toBe('last_week')
    // Same result regardless of input order — sB (later completedAt) wins both times.
    if (forward.primary.type === 'last_week') expect(forward.primary.session.sessionId).toBe('sB')
    if (reversed.primary.type === 'last_week') expect(reversed.primary.session.sessionId).toBe('sB')
  })

  it('falls back to sessionId (not array order) when completedAt is unavailable on either side', () => {
    const sA = makeSession('sA', '2026-08-05', null)
    const sB = makeSession('sB', '2026-08-05', null)

    const forward = resolveExerciseReference(today, [sA, sB])
    const reversed = resolveExerciseReference(today, [sB, sA])

    // Both orderings must agree with each other, whichever sessionId wins.
    expect(forward.primary).toEqual(reversed.primary)
  })
})

describe('resolveExerciseReference — fallback chain in isolation', () => {
  const today = '2026-08-11'

  it('FIRST TIME: no sessions at all', () => {
    const { primary, thisWeek } = resolveExerciseReference(today, [])
    expect(primary).toEqual({ type: 'first_time' })
    expect(thisWeek).toEqual([])
  })

  it('LAST TIME: no session in prevWeek, falls back to the most recent ever with correct elapsed days', () => {
    const old = makeSession('old', '2026-07-01') // well before prevWeek, not this week either
    const { primary } = resolveExerciseReference(today, [old])

    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') {
      expect(primary.session.sessionId).toBe('old')
      expect(primary.daysSince).toBe(41) // 2026-07-01 -> 2026-08-11
    }
  })

  it('LAST WEEK takes priority over LAST TIME when both exist', () => {
    const veryOld = makeSession('veryOld', '2026-01-01')
    const lastWeek = makeSession('lastWeek', '2026-08-05')
    const { primary } = resolveExerciseReference(today, [veryOld, lastWeek])

    expect(primary.type).toBe('last_week')
    if (primary.type === 'last_week') {
      expect(primary.session.sessionId).toBe('lastWeek')
    }
  })

  it('LAST TIME correctly picks the single most recent session, not just the first in the input array', () => {
    const older = makeSession('older', '2026-06-01')
    const mostRecent = makeSession('mostRecent', '2026-07-15')
    // Input order deliberately not sorted — the resolver must sort itself.
    const { primary } = resolveExerciseReference(today, [older, mostRecent])

    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') {
      expect(primary.session.sessionId).toBe('mostRecent')
    }
  })
})

describe('resolveExerciseReference — THIS WEEK (additive secondary slot)', () => {
  // today = 2026-08-12 (Wednesday). thisWeekStart = 2026-08-10 (Monday).
  const today = '2026-08-12'

  it('zero occurrences this week: empty list, independent of what primary resolves to', () => {
    const lastWeekSession = makeSession('lw', '2026-08-05')
    const { thisWeek, primary } = resolveExerciseReference(today, [lastWeekSession])

    expect(thisWeek).toEqual([])
    expect(primary.type).toBe('last_week')
  })

  it('one occurrence this week: a single-entry list with its own elapsed time, not a collapsed scalar', () => {
    const monday = makeSession('mon', '2026-08-10')
    const { thisWeek } = resolveExerciseReference(today, [monday])

    expect(thisWeek).toHaveLength(1)
    expect(thisWeek[0].session.sessionId).toBe('mon')
    expect(thisWeek[0].daysSince).toBe(2) // Monday -> Wednesday
  })

  it('multiple occurrences this week: one entry per occurrence, each with its own elapsed time, most recent first', () => {
    const monday = makeSession('mon', '2026-08-10')
    const tuesday = makeSession('tue', '2026-08-11')
    const { thisWeek } = resolveExerciseReference(today, [monday, tuesday])

    expect(thisWeek).toHaveLength(2)
    expect(thisWeek.map((o) => o.session.sessionId)).toEqual(['tue', 'mon'])
    expect(thisWeek[0].daysSince).toBe(1)
    expect(thisWeek[1].daysSince).toBe(2)
  })

  it('a session from last week is never counted in THIS WEEK, even though both windows are adjacent', () => {
    const sunday = makeSession('sun', '2026-08-09') // last day of prevWeek
    const { thisWeek } = resolveExerciseReference(today, [sunday])
    expect(thisWeek).toEqual([])
  })

  it('THIS WEEK can surface the same underlying session LAST TIME falls back to, when last week is empty and this week has the most recent occurrence', () => {
    // No prevWeek session at all; the only session is earlier this week.
    // LAST TIME's "most recent ever" fallback and THIS WEEK's own window
    // both legitimately reference it — this is not a bug, both framings
    // are simultaneously true (see referenceLogic.ts / CONTEXT.md).
    const monday = makeSession('mon', '2026-08-10')
    const { primary, thisWeek } = resolveExerciseReference(today, [monday])

    expect(primary.type).toBe('last_time')
    if (primary.type === 'last_time') expect(primary.session.sessionId).toBe('mon')
    expect(thisWeek).toHaveLength(1)
    expect(thisWeek[0].session.sessionId).toBe('mon')
  })
})

describe('resolveExerciseReference — defensive same-day/future filtering', () => {
  const today = '2026-08-12'

  it('excludes a session dated today itself (should never happen — current session is always in_progress — but the boundary math does not depend on the caller getting that right)', () => {
    const sameDay = makeSession('today-session', '2026-08-12')
    const { primary, thisWeek } = resolveExerciseReference(today, [sameDay])

    expect(primary).toEqual({ type: 'first_time' })
    expect(thisWeek).toEqual([])
  })
})

describe('resolveSecondaryReference — meso-scoped reach-back (2026-08-22 fix)', () => {
  const today = '2026-08-22'

  it('none_in_meso: no candidateId at all matches the current meso', () => {
    const candidates = [makeSession('other', '2026-08-01', null, 'meso-0', [makeGroup(false)])]
    const result = resolveSecondaryReference(today, candidates, 'meso-1')
    expect(result).toEqual({ type: 'none_in_meso' })
  })

  it('none_in_meso: zero candidates at all', () => {
    expect(resolveSecondaryReference(today, [], 'meso-1')).toEqual({ type: 'none_in_meso' })
  })

  it('none_in_meso: there is no current mesocycle to search within', () => {
    const candidates = [makeSession('s1', '2026-08-01', null, null, [makeGroup(false)])]
    expect(resolveSecondaryReference(today, candidates, null)).toEqual({ type: 'none_in_meso' })
  })

  it('all_skipped_in_meso: occurrences exist this meso, but every one is skipped', () => {
    const candidates = [
      makeSession('s1', '2026-08-15', null, 'meso-1', [makeGroup(true)]),
      makeSession('s2', '2026-08-08', null, 'meso-1', [makeGroup(true)]),
    ]
    const result = resolveSecondaryReference(today, candidates, 'meso-1')
    expect(result).toEqual({ type: 'all_skipped_in_meso' })
  })

  it('found: picks the most recent in-meso occurrence with a real logged set, with a real daysSince', () => {
    const candidates = [
      makeSession('older', '2026-08-01', null, 'meso-1', [makeGroup(false)]),
      makeSession('newer', '2026-08-15', null, 'meso-1', [makeGroup(false)]),
    ]
    const result = resolveSecondaryReference(today, candidates, 'meso-1')
    expect(result.type).toBe('found')
    if (result.type === 'found') {
      expect(result.session.sessionId).toBe('newer')
      expect(result.daysSince).toBe(7) // 2026-08-15 -> 2026-08-22
    }
  })

  it('found: skips over an all-skipped occurrence that is more recent than a real one', () => {
    const candidates = [
      makeSession('real-but-older', '2026-08-01', null, 'meso-1', [makeGroup(false)]),
      makeSession('skipped-but-newer', '2026-08-15', null, 'meso-1', [makeGroup(true)]),
    ]
    const result = resolveSecondaryReference(today, candidates, 'meso-1')
    expect(result.type).toBe('found')
    if (result.type === 'found') expect(result.session.sessionId).toBe('real-but-older')
  })

  it('never reaches into a previous mesocycle, even when it is the only real data and more recent than anything in-meso', () => {
    const candidates = [
      makeSession('prev-meso-real', '2026-08-20', null, 'meso-0', [makeGroup(false)]),
      makeSession('this-meso-skipped', '2026-08-01', null, 'meso-1', [makeGroup(true)]),
    ]
    const result = resolveSecondaryReference(today, candidates, 'meso-1')
    expect(result).toEqual({ type: 'all_skipped_in_meso' })
  })

  it('a group with a real head but the head itself skipped does not count — mirrors buildLoggedSlots exactly', () => {
    // A dropset whose head is skipped is not "logged" by this project's own
    // convention (positionMatch.ts's buildLoggedSlots), regardless of what
    // its stages look like — no stage-level override here either.
    const skippedHeadWithStage: SetGroup<SetLog> = { head: makeLog(true), stages: [makeLog(false)] }
    const candidates = [makeSession('s1', '2026-08-15', null, 'meso-1', [skippedHeadWithStage])]
    const result = resolveSecondaryReference(today, candidates, 'meso-1')
    expect(result).toEqual({ type: 'all_skipped_in_meso' })
  })

  it('excludes a same-date-as-today or future candidate, same defensive convention as the primary chain', () => {
    const candidates = [makeSession('s1', '2026-08-22', null, 'meso-1', [makeGroup(false)])]
    expect(resolveSecondaryReference(today, candidates, 'meso-1')).toEqual({ type: 'none_in_meso' })
  })
})
