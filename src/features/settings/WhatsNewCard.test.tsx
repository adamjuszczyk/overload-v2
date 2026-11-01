// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useParams } from 'react-router-dom'

// The version the app runs is a build-time define read once, when version.ts loads. This test varies it per case: the stub lets the real
// module load, and the mock below hands out whatever `running.version` holds when the card asks (the real compareVersions stays real).
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
// Three releases, the running one in the middle: a card that marks the newest, or the first, tells itself apart from one that marks the running one.
vi.mock('../../data/releaseNotes', () => ({
  RELEASES: [
    { version: '1.3', date: '2026-12-01', groups: [{ title: 'Newest', items: ['Newest line.'] }] },
    { version: '1.2.1', date: '2026-11-05', groups: [{ title: 'Middle', items: ['Middle line.'] }] },
    { version: '1.2', date: '2026-10-28', groups: [{ title: 'Oldest', items: ['Oldest line.'] }] },
  ],
}))
import WhatsNewCard from './WhatsNewCard'

// Settings' WHAT'S NEW card (SPEC.md 1.2.1, Screens): one row per release, newest first — version, date, THIS VERSION on the running
// one — and a row opens that release's notes.

afterEach(() => {
  cleanup()
  running.version = '1.2.1'
  vi.restoreAllMocks()
})

function NotesStandIn() {
  return <p>NOTES OF {useParams().version}</p>
}

function renderCard() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<WhatsNewCard cardStyle={{ backgroundColor: 'var(--surface)' }} />} />
        <Route path="/settings/whats-new/:version" element={<NotesStandIn />} />
      </Routes>
    </MemoryRouter>,
  )
}

const rows = () => screen.getAllByRole('button')

describe('the rows', () => {
  it('lists every release, newest first, each with its version and its date', () => {
    renderCard()
    expect(rows()).toHaveLength(3)
    expect(rows().map((row) => row.textContent)).toEqual(['1.31 DEC 2026', '1.2.1THIS VERSION5 NOV 2026', '1.228 OCT 2026'])
  })

  // [the running version, the versions whose row carries THIS VERSION]
  it.each([
    ['1.2.1', ['1.2.1']],
    ['1.3', ['1.3']],
    ['1.2', ['1.2']],
    ['1.2.0', ['1.2']], // 1.2 and 1.2.0 are one version: a missing part reads 0
    ['1.2.2', []], // a version the notes don't hold marks no row
    ['9.9', []],
  ])('with %s running, THIS VERSION is on %j and nowhere else', (version, marked) => {
    running.version = version
    renderCard()
    const found = rows()
      .filter((row) => row.textContent?.includes('THIS VERSION'))
      .map((row) => row.querySelector('span')!.textContent)
    expect(found).toEqual(marked)
    expect(screen.queryAllByText('THIS VERSION')).toHaveLength(marked.length)
  })

  it('takes the card style it is given, and keeps each row at least 44 px tall', () => {
    const { container } = renderCard()
    expect((container.firstElementChild as HTMLElement).style.backgroundColor).toBe('var(--surface)')
    for (const row of rows()) expect(parseInt(row.style.minHeight, 10)).toBeGreaterThanOrEqual(44)
  })
})

describe('a row opens its own notes', () => {
  it.each(['1.3', '1.2.1', '1.2'])('the %s row opens /settings/whats-new/%s', (version) => {
    renderCard()
    const row = rows().find((r) => r.textContent?.startsWith(version) && !(version === '1.2' && r.textContent.startsWith('1.2.1')))!
    fireEvent.click(row)
    expect(screen.getByText(`NOTES OF ${version}`)).toBeTruthy()
  })
})

describe('offline', () => {
  it('reads and asks for nothing: the notes ship with the app', () => {
    const request = vi.spyOn(globalThis, 'fetch')
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      renderCard()
      fireEvent.click(rows()[1])
      expect(screen.getByText('NOTES OF 1.2.1')).toBeTruthy()
      expect(request).not.toHaveBeenCalled()
    } finally {
      delete (navigator as { onLine?: boolean }).onLine
    }
  })
})
