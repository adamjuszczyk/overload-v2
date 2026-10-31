// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { captureRender } from '../../testing/captureRender'
import { exerciseOf, plannedSet, renderCard } from './cardHarness.testutil'
import DeleteSetConfirm from './DeleteSetConfirm'

// Chunk 61 — W9, the confirm a delete asks (TASKS-1.2 61; board W9: "Delete set 03?", "52.5 kg × 8–10. Only today's session changes; the plan stays the same.",
// CANCEL and DELETE SET). `CAPTURE_RENDER=1 npx vitest run src/features/gym/DeleteSetConfirm.test.tsx` writes the fixture for `npm run shot`.
afterEach(cleanup)

const props = { eyebrow: 'LAT PULLDOWN · SET 03', title: 'Delete set 03?', body: "52.5 kg × 8–10. Only today's session changes; the plan stays the same.", onConfirm: vi.fn(), onCancel: vi.fn() }

describe('the dialog', () => {
  it('is an alert dialog named by its title, with the eyebrow, the body, CANCEL and DELETE SET', () => {
    render(<DeleteSetConfirm {...props} />)
    const dialog = screen.getByRole('alertdialog', { name: 'Delete set 03?' })
    expect(dialog.textContent).toBe(`LAT PULLDOWN · SET 03Delete set 03?${props.body}CANCELDELETE SET`)
  })

  it('CANCEL, a tap on the scrim and Escape ask onCancel; a tap inside the card, and DELETE SET, do not', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<DeleteSetConfirm {...props} onCancel={onCancel} onConfirm={onConfirm} />)
    const dialog = screen.getByRole('alertdialog')
    fireEvent.click(dialog)
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByText('CANCEL'))
    fireEvent.click(dialog.parentElement as HTMLElement) // the scrim around the card
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(3)
    expect(onConfirm).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByText('DELETE SET'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('opens on CANCEL (the safe answer) and gives the focus back to what had it', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const { unmount } = render(<DeleteSetConfirm {...props} />)
    expect(document.activeElement).toBe(within(screen.getByRole('alertdialog')).getByText('CANCEL'))
    unmount()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })

  it('while the delete is out both buttons are off and the button says DELETING…; a refused delete leaves the dialog with its headline and the real reason', () => {
    const onCancel = vi.fn()
    const { rerender } = render(<DeleteSetConfirm {...props} onCancel={onCancel} />)
    rerender(<DeleteSetConfirm {...props} onCancel={onCancel} pending />) // the press of DELETE SET: the dialog was open before the delete started
    const dialog = screen.getByRole('alertdialog')
    expect((within(dialog).getByText('CANCEL') as HTMLButtonElement).disabled).toBe(true)
    expect((within(dialog).getByText('DELETING…') as HTMLButtonElement).disabled).toBe(true)
    // nor does the scrim or Escape close it while the delete is out: a dialog closed then would hide a failure
    fireEvent.click(dialog.parentElement as HTMLElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()
    rerender(<DeleteSetConfirm {...props} error={{ headline: "Couldn't delete the set.", reason: 'Failed to fetch' }} />)
    expect(within(screen.getByRole('alertdialog')).getByRole('alert').textContent).toBe("Couldn't delete the set.Failed to fetch")
    expect((within(screen.getByRole('alertdialog')).getByText('DELETE SET') as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('as the screen draws it (board W9)', () => {
  it('Lat Pulldown 03, planned 52.5 kg × 8–10: the board\'s own words', () => {
    const lat = exerciseOf({ exercise: { ...exerciseOf().exercise!, id: 'ex-lat', name: 'Lat Pulldown', muscleGroup: 'back' }, exerciseId: 'ex-lat' })
    const { container } = renderCard({
      plannedSets: [plannedSet(1), plannedSet(2), plannedSet(3, { targetWeight: 52.5, repMin: 8, repMax: 10 })],
      logs: [],
      props: { programExercise: lat },
    })
    fireEvent.click(within(container.querySelector('[data-row-key="set:set-3"]') as HTMLElement).getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('DELETE SET'))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete set 03?' })
    expect(dialog.textContent).toBe(`LAT PULLDOWN · SET 03Delete set 03?52.5 kg × 8–10. Only today's session changes; the plan stays the same.CANCELDELETE SET`)
    captureRender('w9', document.body) // after the assertions: a dialog that lost a word fails above and leaves the committed fixture alone
  })
})
