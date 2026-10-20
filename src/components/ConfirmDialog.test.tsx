// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import ConfirmDialog from './ConfirmDialog'

// The shared confirm dialog (Library's confirms, Plan's, CHANGE THE PROGRAM's). Chunk 65 gives it `pendingLabel` so PR7's FINISH confirm
// can say FINISHING… while the write is out; the default is the "…" every caller drew before.

afterEach(cleanup)

const render_ = (props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) => {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(<ConfirmDialog title="Finish Push Pull Legs?" body="The program stays saved." confirmLabel="FINISH" onConfirm={onConfirm} onCancel={onCancel} {...props} />)
  return { onConfirm, onCancel }
}

describe('ConfirmDialog', () => {
  it('shows the title, the body and the two buttons; the confirm button says what it was given and runs the confirm', () => {
    const { onConfirm, onCancel } = render_()
    expect(screen.getByText('Finish Push Pull Legs?')).toBeTruthy()
    expect(screen.getByText('The program stays saved.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'FINISH' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL' }))
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('while pending the confirm button is disabled and says "…" unless it is given a pendingLabel (the default every caller had)', () => {
    render_({ isPending: true })
    const button = screen.getByRole('button', { name: '…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: 'FINISH' })).toBeNull()
  })

  it('PR7: with a pendingLabel the button says that while pending, and its own label otherwise', () => {
    render_({ isPending: true, pendingLabel: 'FINISHING…' })
    expect((screen.getByRole('button', { name: 'FINISHING…' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '…' })).toBeNull()
    cleanup()

    render_({ isPending: false, pendingLabel: 'FINISHING…' })
    expect(screen.getByRole('button', { name: 'FINISH' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'FINISHING…' })).toBeNull()
  })

  it('a tap on the scrim cancels; a tap inside the dialog does not', () => {
    const { onCancel } = render_()
    fireEvent.click(screen.getByText('The program stays saved.'))
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Finish Push Pull Legs?').parentElement!.parentElement!)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
