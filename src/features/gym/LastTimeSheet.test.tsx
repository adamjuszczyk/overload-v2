// @vitest-environment jsdom
// Chunk 58b — the last-time sheet's own states (boards W16, W17) drawn from a view: loading, failed, first time, the notes.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import LastTimeSheet from './LastTimeSheet'
import type { LastTimeView } from './lastTimeView'

afterEach(() => cleanup())

const draw = (view: LastTimeView, onRetry = vi.fn(), onClose = vi.fn()) => {
  render(
    <MemoryRouter>
      <LastTimeSheet exerciseId="ex-9" exerciseName="Lat Pulldown" view={view} onRetry={onRetry} onClose={onClose} />
    </MemoryRouter>,
  )
  return { onRetry, onClose }
}
const titles = () => Array.from(document.querySelectorAll('[data-last-panel]')).map((el) => (el as HTMLElement).dataset.lastPanel)

describe('LastTimeSheet', () => {
  it('names the exercise over the title and always carries the deload note and FULL HISTORY', () => {
    draw({ line: 'FIRST TIME', body: { kind: 'first_time' } })
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('LAT PULLDOWN')
    expect(dialog.textContent).toContain('Last time')
    expect(dialog.textContent).toContain('Deload sessions are left out.')
    expect(screen.getByRole('link', { name: /FULL HISTORY/ }).getAttribute('href')).toBe('/exercise/ex-9')
  })

  it('FIRST TIME is a panel with no rows', () => {
    draw({ line: 'FIRST TIME', body: { kind: 'first_time' } })
    expect(titles()).toEqual(['FIRST TIME'])
    expect(document.querySelectorAll('[data-last-row]')).toHaveLength(0)
  })

  it('loading shows the LAST WEEK panel with placeholders', () => {
    draw({ line: 'LAST = ···', body: { kind: 'loading' } })
    expect(titles()).toEqual(['LAST WEEK'])
    expect(screen.getByRole('dialog').textContent).toContain('···')
  })

  it("a failed read says COULDN'T LOAD LAST TIME with a RETRY that asks again, and shows no panel", () => {
    const { onRetry } = draw({ line: "COULDN'T LOAD LAST TIME", body: { kind: 'failed' } })
    expect(screen.getByText("COULDN'T LOAD LAST TIME")).toBeTruthy()
    expect(titles()).toEqual([])
    expect(onRetry).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'RETRY' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('a note under the panels is drawn only when the view has one', () => {
    const panel = { title: 'LAST WEEK' as const, when: 'TUE 30 DEC', rows: [{ n: '01', text: '—', rir: '', badge: 'SKIPPED', stage: false }] }
    draw({ line: 'LAST = SKIPPED EVERY TIME', body: { kind: 'panels', panels: [panel], note: 'Skipped every time on record.' } })
    expect(document.querySelector('[data-last-note]')!.textContent).toBe('Skipped every time on record.')
    expect(screen.getByRole('dialog').textContent).toContain('SKIPPED')
    cleanup()
    draw({ line: 'LAST = LAST WEEK, TUE', body: { kind: 'panels', panels: [panel], note: null } })
    expect(document.querySelector('[data-last-note]')).toBeNull()
  })

  it('the close button asks the sheet to close', () => {
    const { onClose } = draw({ line: 'FIRST TIME', body: { kind: 'first_time' } })
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
