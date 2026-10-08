import { describe, it, expect } from 'vitest'
import { effectiveDate } from './effectiveDate'

describe('effectiveDate — moved_to_date when set, else date', () => {
  it('returns date when movedToDate is undefined (every pre-chunk-24 Session literal)', () => {
    expect(effectiveDate({ date: '2026-08-29' })).toBe('2026-08-29')
  })

  it('returns date when movedToDate is null (the common, unmoved case)', () => {
    expect(effectiveDate({ date: '2026-08-29', movedToDate: null })).toBe('2026-08-29')
  })

  it('returns movedToDate when set', () => {
    expect(effectiveDate({ date: '2026-08-29', movedToDate: '2026-08-30' })).toBe('2026-08-30')
  })
})
