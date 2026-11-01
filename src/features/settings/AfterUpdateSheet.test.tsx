// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

// The version the app runs is a build-time define read once, when version.ts loads. This test varies it per case: the stub lets the real
// module load, and the mock below hands out whatever `running.version` holds when the sheet asks (the real compareVersions stays real).
const running = vi.hoisted(() => {
  vi.stubGlobal('__APP_VERSION__', '1.2.1')
  return { version: '1.2.1' }
})
vi.mock('../../lib/version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/version')>()
  return {
    ...actual,
    get APP_VERSION() {
      return running.version
    },
  }
})
// Three releases with nothing in common, the running one in the middle: a sheet that opens the newest, instead of the running one's, is told apart.
vi.mock('../../data/releaseNotes', () => ({
  RELEASES: [
    { version: '1.3', date: '2026-12-01', groups: [{ title: 'Newest group', items: ['Newest line.'] }] },
    { version: '1.2.1', date: '2026-11-05', groups: [{ title: 'Running group', items: ['Running first line.', 'Running second line.'] }] },
    { version: '1.2', date: '2026-10-28', groups: [{ title: 'Oldest group', items: ['Oldest line.'] }] },
  ],
}))
import AfterUpdateSheet from './AfterUpdateSheet'
import { NOTES_SEEN_KEY } from './releaseNotesSeen'

// The sheet after an update (SPEC.md 1.2.1, Settings · WHAT'S NEW, "Shown once"; TASKS question 7, DECISIONS 256): when the running version
// is newer than the phone's mark, or the phone has none, the running version's notes open once, with GOT IT, and closing any way writes
// the running version as the mark.

beforeEach(() => {
  localStorage.clear()
  running.version = '1.2.1'
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

const dialog = () => screen.queryByRole('dialog')
const writes = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter(([key]) => key === NOTES_SEEN_KEY).map(([, value]) => value)

describe('when it opens', () => {
  // [the running version, the phone's mark (null: none), whether the sheet opens]
  const CASES: [string, string | null, boolean][] = [
    ['1.2.1', null, true], // no mark at all: every phone sees 1.2.1's notes once
    ['1.2.1', '', true],
    ['1.2.1', '0', true],
    ['1.2.1', '1.1.9', true],
    ['1.2.1', '1.2', true], // 1.2 is older than 1.2.1
    ['1.2.1', '1.2.0', true],
    ['1.2.1', 'not a version', true], // a mark that is not a version reads as older: the notes show once and the mark is then a real one
    ['1.10.0', '1.9.9', true], // numbers, not text
    ['1.2.1', '1.2.1', false], // the same version
    ['1.2.1', ' 1.2.1 ', false],
    ['1.2.1', '1.2.2', false], // the phone has seen a newer version
    ['1.2.1', '1.3', false],
    ['1.2.1', '1.10.0', false],
    ['1.2.1', '2', false],
    ['1.9.9', '1.10.0', false],
    ['1.2.0', '1.2', false], // one version: a missing part reads 0
    ['1.2', '1.2.0', false],
    ['1.2', '1.2.1', false],
  ]

  it.each(CASES)('running %s, mark %j: opens %s', (version, mark, opens) => {
    running.version = version
    if (mark !== null) localStorage.setItem(NOTES_SEEN_KEY, mark)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<AfterUpdateSheet />)
    expect(dialog() !== null).toBe(opens)
    // opening writes nothing (a sheet cut short by the app closing shows again), and a sheet that stays shut leaves the mark alone
    expect(writes(setItem)).toEqual([])
    expect(localStorage.getItem(NOTES_SEEN_KEY)).toBe(mark)
  })

  it('reads the mark when it mounts: a mark written after that does not close it', () => {
    render(<AfterUpdateSheet />)
    expect(dialog()).not.toBeNull()
    localStorage.setItem(NOTES_SEEN_KEY, '1.2.1')
    expect(dialog()).not.toBeNull()
  })
})

describe('what it shows', () => {
  it("the running version's own notes, under UPDATED · its date and OVERLOAD and its version, with GOT IT", () => {
    render(<AfterUpdateSheet />)
    const sheet = within(dialog()!)
    expect(sheet.getByRole('heading', { level: 2 }).textContent).toBe('OVERLOAD 1.2.1')
    expect(sheet.getByText('UPDATED · 5 NOV 2026')).toBeTruthy()
    expect(sheet.getByText('RUNNING GROUP')).toBeTruthy()
    expect(sheet.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Running first line.', 'Running second line.'])
    expect(sheet.getByRole('button', { name: 'GOT IT' })).toBeTruthy()
    expect(sheet.queryByText(/Newest|Oldest/)).toBeNull()
  })

  it.each([
    ['1.2.0', 'OVERLOAD 1.2', 'Oldest line.'], // 1.2.0 is the 1.2 entry
    ['1.3', 'OVERLOAD 1.3', 'Newest line.'],
    ['1.4', 'OVERLOAD 1.3', 'Newest line.'], // a version the notes don't hold opens the newest entry
  ])('running %s opens %s', (version, title, line) => {
    running.version = version
    render(<AfterUpdateSheet />)
    expect(within(dialog()!).getByRole('heading', { level: 2 }).textContent).toBe(title)
    expect(within(dialog()!).getAllByRole('listitem').map((li) => li.textContent)).toEqual([line])
  })

  it('draws GOT IT in --on-accent on the accent (text on the accent: DECISIONS 128 (g))', () => {
    render(<AfterUpdateSheet />)
    const button = screen.getByRole('button', { name: 'GOT IT' })
    expect(button.style.background).toBe('var(--accent)')
    expect(button.style.color).toBe('var(--on-accent)')
  })
})

describe('closing it', () => {
  const WAYS: [string, () => void][] = [
    ['GOT IT', () => fireEvent.click(screen.getByRole('button', { name: 'GOT IT' }))],
    ['the close control', () => fireEvent.click(screen.getByRole('button', { name: 'Close' }))],
    ['a tap on the scrim', () => fireEvent.click(document.querySelector('[data-bottom-sheet-scrim]')!)],
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ]

  it.each(WAYS)('by %s: the sheet goes, and the running version is written once as the mark', (_way, close) => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<AfterUpdateSheet />)
    close()
    expect(dialog()).toBeNull()
    expect(writes(setItem)).toEqual(['1.2.1'])
    expect(localStorage.getItem(NOTES_SEEN_KEY)).toBe('1.2.1')
  })

  it.each(WAYS)('by %s: opening the app again does not show it again', (_way, close) => {
    render(<AfterUpdateSheet />)
    close()
    cleanup()
    render(<AfterUpdateSheet />)
    expect(dialog()).toBeNull()
  })

  it('writes the running version, not the newest entry or an older mark', () => {
    running.version = '1.2.0'
    localStorage.setItem(NOTES_SEEN_KEY, '1.1')
    render(<AfterUpdateSheet />)
    fireEvent.click(screen.getByRole('button', { name: 'GOT IT' }))
    expect(localStorage.getItem(NOTES_SEEN_KEY)).toBe('1.2.0')
  })

  it('writes once for two presses in one instant', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<AfterUpdateSheet />)
    const gotIt = screen.getByRole('button', { name: 'GOT IT' })
    await act(async () => {
      gotIt.click()
      gotIt.click()
    })
    expect(writes(setItem)).toEqual(['1.2.1'])
  })
})

// Private browsing in some browsers, a full quota or blocked site data: the store, or the accessor that returns it, throws. The sheet is
// a courtesy: it still opens (the mark can't be read) and still closes (the mark can't be written), and nothing throws.
describe('a store that throws', () => {
  it('opens when the mark can\'t be read, and closes when it can\'t be written', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(() => render(<AfterUpdateSheet />)).not.toThrow()
    expect(dialog()).not.toBeNull()
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'GOT IT' }))).not.toThrow()
    expect(dialog()).toBeNull()
  })

  it('does the same when reaching localStorage at all throws', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('blocked', 'SecurityError')
      },
    })
    try {
      expect(() => render(<AfterUpdateSheet />)).not.toThrow()
      expect(dialog()).not.toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      expect(dialog()).toBeNull()
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original)
    }
  })
})
