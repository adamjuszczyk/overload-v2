// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NOTES_SEEN_KEY, markNotesSeen, readLastSeenNotesVersion } from './releaseNotesSeen'

// `lastSeenNotesVersion` (SPEC.md 1.2.1, "On the phone"): one localStorage key, every access in try/catch, never a table.

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('the mark in a working store', () => {
  it('is kept under overload:lastSeenNotesVersion', () => {
    expect(NOTES_SEEN_KEY).toBe('overload:lastSeenNotesVersion')
  })

  it('reads as none until a version is marked, and as that version after', () => {
    expect(readLastSeenNotesVersion()).toBeNull()
    markNotesSeen('1.2.1')
    expect(localStorage.getItem('overload:lastSeenNotesVersion')).toBe('1.2.1')
    expect(readLastSeenNotesVersion()).toBe('1.2.1')
  })

  it('a later mark replaces the earlier one, and it is the only thing written', () => {
    markNotesSeen('1.2')
    markNotesSeen('1.2.1')
    expect(readLastSeenNotesVersion()).toBe('1.2.1')
    expect(localStorage.length).toBe(1)
  })

  it('reads an empty or blank value as no mark (the sheet then shows), and ignores spaces round a real one', () => {
    localStorage.setItem(NOTES_SEEN_KEY, '')
    expect(readLastSeenNotesVersion()).toBeNull()
    localStorage.setItem(NOTES_SEEN_KEY, '   ')
    expect(readLastSeenNotesVersion()).toBeNull()
    localStorage.setItem(NOTES_SEEN_KEY, ' 1.2 ')
    expect(readLastSeenNotesVersion()).toBe('1.2')
  })
})

// Private browsing in some browsers, a full quota or blocked site data: the store, or the accessor that returns it, throws.
describe('a store that throws (private browsing, a full quota, blocked site data)', () => {
  it('reads as no mark, and does not throw, when getItem throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    expect(() => readLastSeenNotesVersion()).not.toThrow()
    expect(readLastSeenNotesVersion()).toBeNull()
  })

  it('does not throw when setItem throws (a full quota)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => markNotesSeen('1.2.1')).not.toThrow()
  })

  it('does not throw, reading or writing, when reaching localStorage at all throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    try {
      expect(readLastSeenNotesVersion()).toBeNull()
      expect(() => markNotesSeen('1.2.1')).not.toThrow()
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
      else delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })
})
