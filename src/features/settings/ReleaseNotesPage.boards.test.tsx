// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { captureRender } from '../../testing/captureRender'
import { RELEASES } from '../../data/releaseNotes'
import ReleaseNotesPage from './ReleaseNotesPage'

// The prototype's "Release notes" states, "1.2.1 (sample)" and "1.2" (TASKS.md chunk 71), on the REAL release notes: what the notes screen
// draws for each entry the data file holds, line for line. Captured for design/1.2.1/built with CAPTURE_RENDER=1 (written after the
// assertions, so a failing rule leaves the committed fixture alone). The page sits in the same flex column the app's shell gives its
// screens (`h-dvh`, `main` as the scroller), so the capture is as tall as a phone screen.

afterEach(() => cleanup())

function renderNotes(version: string) {
  return render(
    <MemoryRouter initialEntries={[`/settings/whats-new/${version}`]}>
      <div className="flex flex-col h-dvh">
        <main className="flex-1 overflow-y-auto min-h-0">
          <Routes>
            <Route path="/settings/whats-new/:version" element={<ReleaseNotesPage />} />
          </Routes>
        </main>
      </div>
    </MemoryRouter>,
  )
}

function expectEntryOnScreen(version: string) {
  const release = RELEASES.find((r) => r.version === version)!
  expect(release, `the data file has a ${version} entry`).toBeDefined()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(`OVERLOAD ${version}`)
  expect(screen.getAllByText(/^[A-Z ,']+$/).map((el) => el.textContent)).toEqual(expect.arrayContaining(release.groups.map((group) => group.title.toUpperCase())))
  expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(release.groups.flatMap((group) => group.items))
}

describe('Release notes · 1.2.1 (sample)', () => {
  it('draws the newest entry: the header, every group, every line', () => {
    const { container } = renderNotes('1.2.1')
    expectEntryOnScreen('1.2.1')
    captureRender('release-notes-v1-2-1', container)
  })
})

describe('Release notes · 1.2', () => {
  it('draws 1.2\'s entry: the header, every group, every line, as the notes file has them', () => {
    const { container } = renderNotes('1.2')
    expectEntryOnScreen('1.2')
    expect(screen.getByText("WHAT'S NEW · 28 OCT 2026")).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(22)
    captureRender('release-notes-v1-2', container)
  })
})
