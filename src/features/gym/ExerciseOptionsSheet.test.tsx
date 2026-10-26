// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen, act, within } from '@testing-library/react'
import ExerciseOptionsSheet, { type ExerciseOptionsSheetProps } from './ExerciseOptionsSheet'

// Chunk 59 (board W10): the exercise ⋯'s sheet by itself: which rows it draws, the inline confirm of the skip, what each row calls.
// Which rows a card offers and what they write are ExerciseCard.options.test.tsx's and GymSession.swap.test.tsx's.

afterEach(() => cleanup())

function props(over: Partial<ExerciseOptionsSheetProps> = {}): ExerciseOptionsSheetProps {
  return {
    exerciseName: 'Lat Pulldown',
    eyebrow: 'BACK · 2 OF 3 SETS DONE',
    onSwap: vi.fn(),
    skip: { description: 'Set 03 and its drop will be marked skipped.', label: 'SKIP 2 SETS', onConfirm: vi.fn(() => Promise.resolve()) },
    onAddSet: vi.fn(),
    onHistory: vi.fn(),
    onClose: vi.fn(),
    ...over,
  }
}

describe('ExerciseOptionsSheet: the rows of board W10', () => {
  it('draws the eyebrow over the name and the four rows with their sublines', () => {
    render(<ExerciseOptionsSheet {...props()} />)
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('BACK · 2 OF 3 SETS DONE')).toBeTruthy()
    expect(within(sheet).getByText('Lat Pulldown')).toBeTruthy()
    expect(within(sheet).getByText('Swap for today')).toBeTruthy()
    expect(within(sheet).getByText("Next week's plan stays the same.")).toBeTruthy()
    expect(within(sheet).getByText('Skip the rest of this exercise')).toBeTruthy()
    expect(within(sheet).getByText('Set 03 and its drop will be marked skipped.')).toBeTruthy()
    expect(within(sheet).getByText('Add a set')).toBeTruthy()
    expect(within(sheet).getByText('This exercise only. In a superset, the others stay as they are.')).toBeTruthy()
    expect(within(sheet).getByText('Exercise history')).toBeTruthy()
  })

  it('a row the card does not offer is not drawn: no swap, no skip ("Nothing left to skip"), no Add a set; the history row is always there', () => {
    render(<ExerciseOptionsSheet {...props({ onSwap: null, skip: null, onAddSet: null })} />)
    expect(screen.queryByText('Swap for today')).toBeNull()
    expect(screen.queryByText('Skip the rest of this exercise')).toBeNull()
    expect(screen.queryByText('Add a set')).toBeNull()
    expect(screen.getByText('Exercise history')).toBeTruthy()
  })

  it('the skip row asks first: CANCEL and SKIP 2 SETS appear when it is tapped, and CANCEL takes them back without writing', () => {
    const p = props()
    render(<ExerciseOptionsSheet {...p} />)
    expect(screen.queryByText('SKIP 2 SETS')).toBeNull()
    fireEvent.click(screen.getByText('Skip the rest of this exercise'))
    expect(screen.getByText('SKIP 2 SETS')).toBeTruthy()
    fireEvent.click(screen.getByText('CANCEL'))
    expect(screen.queryByText('SKIP 2 SETS')).toBeNull()
    expect(p.skip!.onConfirm).not.toHaveBeenCalled()
    expect(p.onClose).not.toHaveBeenCalled()
  })

  it('SKIP 2 SETS writes once, reads SKIPPING… while the skips are out, and closes the sheet when they are written (break: closing first, or twice)', async () => {
    let release: () => void = () => {}
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => void (release = resolve)))
    const p = props({ skip: { description: 'Set 03 and its drop will be marked skipped.', label: 'SKIP 2 SETS', onConfirm } })
    render(<ExerciseOptionsSheet {...p} />)
    fireEvent.click(screen.getByText('Skip the rest of this exercise'))
    await act(async () => {
      fireEvent.click(screen.getByText('SKIP 2 SETS'))
      fireEvent.click(screen.getByText('SKIP 2 SETS')) // a second press in the same instant
    })
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByText('SKIPPING…')).toBeTruthy()
    expect((screen.getByText('CANCEL') as HTMLButtonElement).disabled).toBe(true)
    expect(p.onClose).not.toHaveBeenCalled()
    await act(async () => {
      release()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it('Swap for today and Add a set call their handlers and close the sheet; Exercise history calls its own and leaves closing to its caller', () => {
    const p = props()
    render(<ExerciseOptionsSheet {...p} />)
    fireEvent.click(screen.getByText('Swap for today'))
    expect(p.onSwap).toHaveBeenCalledTimes(1)
    expect(p.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByText('Add a set'))
    expect(p.onAddSet).toHaveBeenCalledTimes(1)
    expect(p.onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByText('Exercise history'))
    expect(p.onHistory).toHaveBeenCalledTimes(1)
  })

  it('the close button closes it', () => {
    const p = props()
    render(<ExerciseOptionsSheet {...p} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })
})
