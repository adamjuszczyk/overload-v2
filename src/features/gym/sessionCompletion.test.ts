import { describe, it, expect } from 'vitest'
import { deriveCompletedAt, shouldClassifyAsSkipped } from './sessionCompletion'

describe('deriveCompletedAt', () => {
  it('returns null for zero eligible rows — must not fall back to wall-clock time', () => {
    expect(deriveCompletedAt([])).toBeNull()
  })

  it('returns the single row loggedAt when there is exactly one', () => {
    expect(deriveCompletedAt([{ loggedAt: '2026-08-11T10:00:00.000Z' }])).toBe(
      '2026-08-11T10:00:00.000Z',
    )
  })

  it('picks the maximum loggedAt among multiple rows, regardless of input order', () => {
    const logs = [
      { loggedAt: '2026-08-11T10:00:00.000Z' },
      { loggedAt: '2026-08-11T10:15:00.000Z' },
      { loggedAt: '2026-08-11T10:05:00.000Z' },
    ]
    expect(deriveCompletedAt(logs)).toBe('2026-08-11T10:15:00.000Z')
  })

  it('picks the maximum even when the latest row is first in the array', () => {
    const logs = [
      { loggedAt: '2026-08-11T10:15:00.000Z' },
      { loggedAt: '2026-08-11T10:00:00.000Z' },
      { loggedAt: '2026-08-11T10:05:00.000Z' },
    ]
    expect(deriveCompletedAt(logs)).toBe('2026-08-11T10:15:00.000Z')
  })

  it('is not fooled by ISO string suffix differences (Z vs +00:00) representing the same instant', () => {
    // Supabase/PostgREST returns timestamptz values with a +00:00 suffix;
    // client-generated timestamps (new Date().toISOString()) always use Z.
    // deriveCompletedAt compares via real Date parsing, not raw string
    // comparison, so this must not affect which row is picked.
    const logs = [
      { loggedAt: '2026-08-11T10:00:00.000+00:00' },
      { loggedAt: '2026-08-11T10:05:00.000Z' },
    ]
    expect(deriveCompletedAt(logs)).toBe('2026-08-11T10:05:00.000Z')
  })

  it('two rows sharing the exact same instant both produce an equivalent result', () => {
    // deriveCompletedAt's comparison is strict (>), so the first-encountered
    // row of a tie is kept rather than the second — this only matters if the
    // two tied rows' loggedAt strings could ever differ despite being the
    // same instant, which they don't in practice (both would come from the
    // same logged_at column read in one query). Asserting on the derived
    // instant, not object identity, is the actually-meaningful guarantee.
    const logs = [
      { loggedAt: '2026-08-11T10:00:00.000Z' },
      { loggedAt: '2026-08-11T10:00:00.000Z' },
    ]
    const result = deriveCompletedAt(logs)
    expect(new Date(result!).getTime()).toBe(new Date('2026-08-11T10:00:00.000Z').getTime())
  })

  it('skips rows with an unparseable loggedAt instead of getting stuck on them', () => {
    // A naive "track the running max, seeded from the first element" loop
    // would get permanently poisoned here: once "latest" holds an invalid
    // date, every future comparison (including against later, genuinely
    // later, valid rows) involves NaN, which is never greater than anything
    // — so a bad first element could silently freeze the result forever.
    // This asserts the real fix: invalid rows are skipped, not trusted.
    const logs = [
      { loggedAt: 'not-a-real-date' },
      { loggedAt: '2026-08-11T10:00:00.000Z' },
      { loggedAt: '2026-08-11T10:30:00.000Z' },
    ]
    expect(deriveCompletedAt(logs)).toBe('2026-08-11T10:30:00.000Z')
  })

  it('returns null when every row is unparseable, not a garbage string', () => {
    const logs = [{ loggedAt: 'garbage' }, { loggedAt: 'also garbage' }]
    expect(deriveCompletedAt(logs)).toBeNull()
  })

  it('skips null/undefined entries in the array rather than throwing', () => {
    // Not reachable via today's real callers (both wrap raw rows in a fresh
    // {loggedAt} object literal before calling in), but the function should
    // be a total, never-silently-crashing function over its declared input
    // type rather than one that only happens to behave given today's callers.
    const logs = [
      null as unknown as { loggedAt: string },
      { loggedAt: '2026-08-11T10:00:00.000Z' },
      undefined as unknown as { loggedAt: string },
    ]
    expect(deriveCompletedAt(logs)).toBe('2026-08-11T10:00:00.000Z')
  })
})

describe('shouldClassifyAsSkipped', () => {
  it('false for zero rows — a session logged with nothing is a different, pre-existing case, not reclassified here', () => {
    expect(shouldClassifyAsSkipped([])).toBe(false)
  })

  it('true when every row is skipped — the real 2026-08-15 Legs session shape (10 rows, all is_skipped)', () => {
    const logs = Array.from({ length: 10 }, () => ({ isSkipped: true }))
    expect(shouldClassifyAsSkipped(logs)).toBe(true)
  })

  it('false when even one row is a real (non-skipped) set', () => {
    const logs = [{ isSkipped: true }, { isSkipped: true }, { isSkipped: false }]
    expect(shouldClassifyAsSkipped(logs)).toBe(false)
  })

  it('false for a normal fully-logged session (no skips at all)', () => {
    const logs = [{ isSkipped: false }, { isSkipped: false }, { isSkipped: false }]
    expect(shouldClassifyAsSkipped(logs)).toBe(false)
  })

  it('true for a single all-skipped row', () => {
    expect(shouldClassifyAsSkipped([{ isSkipped: true }])).toBe(true)
  })
})
