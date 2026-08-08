import { describe, it, expect } from 'vitest'
import { trimPartialTrailingGroup } from './historyPagination'

interface Row {
  id: string
  sessionId: string
}

function row(id: string, sessionId: string): Row {
  return { id, sessionId }
}

const byKey = (r: Row) => r.sessionId

describe('trimPartialTrailingGroup', () => {
  it('returns everything unmodified when there is no overflow (last page)', () => {
    const rows = [row('a', 's1'), row('b', 's1'), row('c', 's2')]
    const { pageRows, hasMore } = trimPartialTrailingGroup(rows, 3, byKey)
    expect(pageRows).toEqual(rows)
    expect(hasMore).toBe(false)
  })

  it('keeps the page as-is when the overflow row starts a new group', () => {
    // page boundary lands exactly on a group edge — nothing to trim
    const rows = [row('a', 's1'), row('b', 's1'), row('c', 's2'), row('d', 's3')]
    const { pageRows, hasMore } = trimPartialTrailingGroup(rows, 3, byKey)
    expect(pageRows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(hasMore).toBe(true)
  })

  it('trims the trailing partial group when the overflow row continues it', () => {
    // s2 spans the page boundary: page has [a(s1), b(s2), c(s2)], overflow is s2 too
    const rows = [row('a', 's1'), row('b', 's2'), row('c', 's2'), row('d', 's2'), row('e', 's3')]
    const { pageRows, hasMore } = trimPartialTrailingGroup(rows, 3, byKey)
    // b and c (both s2) are trimmed since s2 continues past the page boundary
    expect(pageRows.map((r) => r.id)).toEqual(['a'])
    expect(hasMore).toBe(true)
  })

  it('does not trim a group that starts at the very beginning of the page and fills it entirely', () => {
    // whole page is one group (s1), and the overflow row also belongs to s1 —
    // trimming would empty the page and stall pagination, so it's left untrimmed.
    const rows = [row('a', 's1'), row('b', 's1'), row('c', 's1'), row('d', 's1')]
    const { pageRows, hasMore } = trimPartialTrailingGroup(rows, 3, byKey)
    expect(pageRows.map((r) => r.id)).toEqual(['a', 'b', 'c'])
    expect(hasMore).toBe(true)
  })

  it('handles an empty input', () => {
    const { pageRows, hasMore } = trimPartialTrailingGroup([], 3, byKey)
    expect(pageRows).toEqual([])
    expect(hasMore).toBe(false)
  })
})
