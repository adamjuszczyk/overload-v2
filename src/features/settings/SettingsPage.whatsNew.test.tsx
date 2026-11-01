// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { UserSettings } from '../../types'
import { DEFAULT_SETTINGS } from './settingsStore'
import { captureRender } from '../../testing/captureRender'

// Settings · WHAT'S NEW (SPEC.md 1.2.1, Screens; TASKS.md chunk 71): the REAL SettingsPage with the REAL card, the REAL release notes and
// the REAL notes screen behind a row, over the same two hook seams every Settings test uses (useSettings, useAuth). What is proven here is
// the wiring: ABOUT became WHAT'S NEW, one row per release the data file holds, THIS VERSION on the running one, a row reaching its notes,
// the build line under the list, and none of it needing a network.

const settings: UserSettings = { ...DEFAULT_SETTINGS }
vi.mock('./useSettings', () => ({
  useSettings: () => ({ data: settings }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
  useUpdateDeloadRules: () => ({ mutate: vi.fn() }),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))

// The three vite `define` globals (vite.config.ts), which vitest.config.ts doesn't define.
vi.stubGlobal('__BUILD_HASH__', 'test')
vi.stubGlobal('__BUILD_TIME__', '2026-01-01T12:00:00.000Z')
vi.stubGlobal('__APP_VERSION__', '1.2.1')

const { default: SettingsPage } = await import('./SettingsPage')
const { default: ReleaseNotesPage } = await import('./ReleaseNotesPage')
const { default: AfterUpdateSheet } = await import('./AfterUpdateSheet')
const { NOTES_SEEN_KEY } = await import('./releaseNotesSeen')
const { RELEASES } = await import('../../data/releaseNotes')

beforeEach(() => localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

function renderSettings(extra?: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/settings/whats-new/:version" element={<ReleaseNotesPage />} />
      </Routes>
      {extra}
    </MemoryRouter>,
  )
}

const rowsOfTheCard = () => screen.getAllByRole('button').filter((button) => RELEASES.some((release) => button.textContent?.startsWith(release.version)))

describe('the WHAT\'S NEW section', () => {
  it('is where ABOUT was: the last section, after ACCOUNT, and ABOUT is gone', () => {
    renderSettings()
    expect(screen.getByText("WHAT'S NEW")).toBeTruthy()
    expect(screen.queryByText('ABOUT')).toBeNull()
    const titles = screen.getAllByText(/^(APPEARANCE|REST TIMER|WORKOUT|SET TIMING|AUTO-FINISH SESSION|UNITS|WARMUP SETS|PLANNING|DELOAD RULES|ACCOUNT|WHAT'S NEW)$/).map((el) => el.textContent)
    expect(titles[titles.length - 1]).toBe("WHAT'S NEW")
    expect(titles[titles.length - 2]).toBe('ACCOUNT')
  })

  it('has one row per release the data file holds, newest first, and THIS VERSION on the running one only', () => {
    renderSettings()
    const rows = rowsOfTheCard()
    expect(rows.map((row) => row.querySelector('span')!.textContent)).toEqual(RELEASES.map((release) => release.version))
    expect(RELEASES.length).toBeGreaterThanOrEqual(2) // never empty: 1.2 is seeded
    expect(screen.getAllByText('THIS VERSION')).toHaveLength(1)
    expect(within(rows[0]).getByText('THIS VERSION')).toBeTruthy() // 1.2.1 runs, and it is the newest entry
  })

  it('keeps the build line, in small text under the list', () => {
    renderSettings()
    const build = screen.getByText(/^BUILD test · /)
    expect(build.textContent).toMatch(/^BUILD test · [A-Z][a-z]{2} \d{1,2}, 2026 \d{2}:\d{2}$/)
    const lastRow = rowsOfTheCard().slice(-1)[0]
    expect(lastRow.compareDocumentPosition(build) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // under the card, not in it
    expect(lastRow.closest('div.rounded-xl')!.contains(build)).toBe(false)
  })

  it('opens the notes of the row that was pressed (1.2, the oldest), with Back returning to Settings', () => {
    renderSettings()
    const oldest = rowsOfTheCard().slice(-1)[0]
    expect(oldest.textContent).toContain(RELEASES[RELEASES.length - 1].version)
    fireEvent.click(oldest)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`OVERLOAD ${RELEASES[RELEASES.length - 1].version}`)
    fireEvent.click(screen.getByRole('button', { name: 'Back to Settings' }))
    expect(screen.getByText("WHAT'S NEW")).toBeTruthy()
  })

  it('works offline: the notes ship with the app, so nothing is asked for', () => {
    const request = vi.spyOn(globalThis, 'fetch')
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      renderSettings()
      expect(rowsOfTheCard()).toHaveLength(RELEASES.length)
      fireEvent.click(rowsOfTheCard()[0])
      expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`OVERLOAD ${RELEASES[0].version}`)
      expect(request).not.toHaveBeenCalled()
    } finally {
      delete (navigator as { onLine?: boolean }).onLine
    }
  })
})

// The DEMO states, captured for design/1.2.1/built (CAPTURE_RENDER=1; written after the assertions, so a failing rule leaves the
// committed fixture alone).
describe('the captured states', () => {
  it('Settings · WHAT\'S NEW, Normal', () => {
    const { container } = renderSettings()
    expect(screen.getByText("WHAT'S NEW")).toBeTruthy()
    captureRender('settings-whats-new', container)
  })

  it('Settings · WHAT\'S NEW, Offline: the same page, nothing waiting on a network', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    try {
      const { container } = renderSettings()
      expect(rowsOfTheCard()).toHaveLength(RELEASES.length)
      captureRender('settings-whats-new-offline', container)
    } finally {
      delete (navigator as { onLine?: boolean }).onLine
    }
  })

  it('After an update · Notes, once: the sheet over Settings, the screen the app opened on', () => {
    renderSettings(<AfterUpdateSheet />)
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByRole('heading', { level: 2 }).textContent).toBe(`OVERLOAD ${RELEASES[0].version}`)
    expect(screen.getByText("WHAT'S NEW")).toBeTruthy() // Settings is drawn behind it
    captureRender('after-an-update-notes-once', document.body)
    // and closing it leaves the mark that stops it opening again
    fireEvent.click(within(sheet).getByRole('button', { name: 'GOT IT' }))
    expect(localStorage.getItem(NOTES_SEEN_KEY)).toBe('1.2.1')
  })
})
