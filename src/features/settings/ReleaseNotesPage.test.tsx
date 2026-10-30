// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigationType } from 'react-router-dom'

// Two releases with nothing in common: a page that reads the wrong one (the newest for every route, the first match for a prefix) is told
// apart from one that reads the version in the URL.
vi.mock('../../data/releaseNotes', () => ({
  RELEASES: [
    { version: '1.3', date: '2026-12-01', groups: [{ title: 'Newest group', items: ['Newest first line.', 'Newest second line.'] }] },
    {
      version: '1.2',
      date: '2026-10-28',
      groups: [
        { title: 'Older group', items: ['Older first line.'] },
        { title: 'Older other group', items: ['Older second line.', 'Older third line.'] },
      ],
    },
  ],
}))
import ReleaseNotesPage from './ReleaseNotesPage'

// /settings/whats-new/:version (SPEC.md 1.2.1, Settings · WHAT'S NEW: "A row opens that release's notes"; the prototype's "Release notes").

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// What Back lands on: it says how it got there, so a replace is told from a push.
function SettingsStandIn() {
  return <p>SETTINGS via {useNavigationType()}</p>
}

function renderAt(path: string, history: string[] = [path]) {
  return render(
    <MemoryRouter initialEntries={history} initialIndex={history.length - 1}>
      <Routes>
        <Route path="/settings" element={<SettingsStandIn />} />
        <Route path="/settings/whats-new/:version" element={<ReleaseNotesPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('the release in the URL', () => {
  it('shows that release: its name, its date, every group and every line, and nothing of the other', () => {
    renderAt('/settings/whats-new/1.2')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OVERLOAD 1.2')
    expect(screen.getByText("WHAT'S NEW · 28 OCT 2026")).toBeTruthy()
    for (const title of ['OLDER GROUP', 'OLDER OTHER GROUP']) expect(screen.getByText(title)).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Older first line.', 'Older second line.', 'Older third line.'])
    expect(screen.queryByText(/Newest/i)).toBeNull()
  })

  it('shows the newest release by its own URL as well, so the page reads the URL and not just the first entry', () => {
    renderAt('/settings/whats-new/1.3')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OVERLOAD 1.3')
    expect(screen.getByText("WHAT'S NEW · 1 DEC 2026")).toBeTruthy()
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Newest first line.', 'Newest second line.'])
  })

  it('opens the newest release for a version the notes do not hold (the prototype\'s choice)', () => {
    renderAt('/settings/whats-new/9.9')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OVERLOAD 1.3')
  })
})

describe('Back', () => {
  it('goes to Settings and replaces this page in the history, so Back from Settings does not come here again', () => {
    renderAt('/settings/whats-new/1.2', ['/settings', '/settings/whats-new/1.2'])
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }))
    expect(screen.getByText('SETTINGS via REPLACE')).toBeTruthy()
  })

  it('is a 44 px touch target', () => {
    renderAt('/settings/whats-new/1.2')
    const back = screen.getByRole('button', { name: 'Back to Settings' })
    expect(back.style.width).toBe('44px')
    expect(back.style.height).toBe('44px')
  })
})

describe('offline', () => {
  it('asks for nothing: the notes ship with the app', () => {
    const request = vi.spyOn(globalThis, 'fetch')
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      renderAt('/settings/whats-new/1.2')
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OVERLOAD 1.2')
      expect(request).not.toHaveBeenCalled()
    } finally {
      delete (navigator as { onLine?: boolean }).onLine
    }
  })
})
