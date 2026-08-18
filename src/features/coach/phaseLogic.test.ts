import { describe, it, expect } from 'vitest'
import { resolvePhases, phaseAt } from './phaseLogic'
import type { PhaseEntry } from '../../types'

function entry(id: string, phase: PhaseEntry['phase'], startDate: string): PhaseEntry {
  return { id, userId: 'u1', phase, startDate, createdAt: `${startDate}T00:00:00Z` }
}

describe('resolvePhases', () => {
  it('returns nothing for no entries', () => {
    expect(resolvePhases([], '2026-08-18')).toEqual([])
  })

  it('a single entry is open-ended: endDate null, duration runs to asOf', () => {
    const [resolved] = resolvePhases([entry('1', 'bulk', '2026-08-04')], '2026-08-18')
    expect(resolved.endDate).toBeNull()
    expect(resolved.durationDays).toBe(14)
  })

  it('an earlier entry closes the day before the next one starts, with its own fixed duration', () => {
    const entries = [entry('1', 'cut', '2026-06-23'), entry('2', 'bulk', '2026-08-04')]
    const [cut, bulk] = resolvePhases(entries, '2026-08-18')
    expect(cut.endDate).toBe('2026-08-03')
    expect(cut.durationDays).toBe(42) // 6 weeks, SPEC §5's example
    expect(bulk.endDate).toBeNull()
    expect(bulk.durationDays).toBe(14) // 2 weeks, as of asOf
  })

  it('sorts by startDate regardless of input order', () => {
    const entries = [entry('2', 'bulk', '2026-08-04'), entry('1', 'cut', '2026-06-23')]
    const resolved = resolvePhases(entries, '2026-08-18')
    expect(resolved.map((r) => r.id)).toEqual(['1', '2'])
  })
})

describe('phaseAt', () => {
  it('returns nulls when there are no entries', () => {
    expect(phaseAt([], '2026-08-18')).toEqual({ current: null, previous: null })
  })

  it('returns nulls when the date is before any recorded phase', () => {
    const entries = [entry('1', 'bulk', '2026-08-04')]
    expect(phaseAt(entries, '2026-07-01')).toEqual({ current: null, previous: null })
  })

  it('a single entry has no previous, and duration is as-of the queried date', () => {
    const entries = [entry('1', 'bulk', '2026-08-04')]
    const { current, previous } = phaseAt(entries, '2026-08-18')
    expect(previous).toBeNull()
    expect(current).toMatchObject({ id: '1', endDate: null, durationDays: 14 })
  })

  it("matches SPEC §5's example exactly: bulk 2 weeks in, cut before it ran 6 weeks", () => {
    const entries = [entry('cut', 'cut', '2026-06-23'), entry('bulk', 'bulk', '2026-08-04')]
    const { current, previous } = phaseAt(entries, '2026-08-18')
    expect(current).toMatchObject({ id: 'bulk', phase: 'bulk', durationDays: 14, endDate: null })
    expect(previous).toMatchObject({ id: 'cut', phase: 'cut', durationDays: 42, endDate: '2026-08-03' })
  })

  it('a date inside an already-closed earlier phase reports partial duration as of that date, not its eventual full duration', () => {
    const entries = [
      entry('1', 'cut', '2026-01-01'),
      entry('2', 'bulk', '2026-01-11'), // entry 1 closes 2026-01-10, full duration 10 days
      entry('3', 'maintain', '2026-01-21'),
    ]
    const { current, previous } = phaseAt(entries, '2026-01-15') // 4 days into entry 2's 10-day run
    expect(current).toMatchObject({ id: '2', phase: 'bulk', endDate: '2026-01-20', durationDays: 4 })
    expect(previous).toMatchObject({ id: '1', phase: 'cut', endDate: '2026-01-10', durationDays: 10 })
  })

  it('querying exactly on a boundary start date resolves to the new phase with zero elapsed days', () => {
    const entries = [entry('1', 'cut', '2026-01-01'), entry('2', 'bulk', '2026-01-11')]
    const { current, previous } = phaseAt(entries, '2026-01-11')
    expect(current).toMatchObject({ id: '2', durationDays: 0 })
    expect(previous).toMatchObject({ id: '1', durationDays: 10 })
  })
})
