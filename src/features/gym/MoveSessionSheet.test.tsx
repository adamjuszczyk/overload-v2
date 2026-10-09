// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import MoveSessionSheet from './MoveSessionSheet'

afterEach(() => cleanup())

// Week of 2026-08-24 (Monday) .. 2026-08-30 (Sunday) — same hand-verified
// week as scheduler.test.ts/moveSession.test.ts.
const MON = '2026-08-24'
const FRI = '2026-08-28'

describe('MoveSessionSheet — the day-chip picker', () => {
  it('offers all 7 days of the session\'s own week', () => {
    const { getByText } = render(
      <MoveSessionSheet
        workoutDayName="Push Day" originalDate={MON} currentDate={MON}
        isPending={false} onPick={vi.fn()} onClose={vi.fn()}
      />,
    )
    for (const label of ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']) {
      expect(getByText(label)).toBeTruthy()
    }
  })

  it('tapping a day calls onPick with that exact date', () => {
    const onPick = vi.fn()
    const { getByText } = render(
      <MoveSessionSheet
        workoutDayName="Push Day" originalDate={MON} currentDate={MON}
        isPending={false} onPick={onPick} onClose={vi.fn()}
      />,
    )
    fireEvent.click(getByText('FRI').closest('button')!)
    expect(onPick).toHaveBeenCalledWith(FRI)
  })

  it('the current (effective) day is disabled and labelled, never pickable', () => {
    const onPick = vi.fn()
    const { getByText } = render(
      <MoveSessionSheet
        workoutDayName="Push Day" originalDate={MON} currentDate={FRI}
        isPending={false} onPick={onPick} onClose={vi.fn()}
      />,
    )
    const friButton = getByText('FRI').closest('button')! as HTMLButtonElement
    expect(friButton.disabled).toBe(true)
    expect(getByText('HERE NOW')).toBeTruthy()
    fireEvent.click(friButton)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('a session already moved away shows its original day as "MOVE BACK", still pickable', () => {
    const onPick = vi.fn()
    const { getByText } = render(
      <MoveSessionSheet
        workoutDayName="Push Day" originalDate={MON} currentDate={FRI}
        isPending={false} onPick={onPick} onClose={vi.fn()}
      />,
    )
    expect(getByText('MOVE BACK')).toBeTruthy()
    fireEvent.click(getByText('MON').closest('button')!)
    expect(onPick).toHaveBeenCalledWith(MON)
  })

  it('closing via the backdrop calls onClose; the sheet body itself does not', () => {
    const onClose = vi.fn()
    const { container } = render(
      <MoveSessionSheet
        workoutDayName="Push Day" originalDate={MON} currentDate={MON}
        isPending={false} onPick={vi.fn()} onClose={onClose}
      />,
    )
    const backdrop = container.firstChild as HTMLElement
    fireEvent.click(backdrop)
    expect(onClose).toHaveBeenCalled()
  })

  it('while pending, every non-current day is disabled too', () => {
    const { getByText } = render(
      <MoveSessionSheet
        workoutDayName="Push Day" originalDate={MON} currentDate={MON}
        isPending onPick={vi.fn()} onClose={vi.fn()}
      />,
    )
    expect((getByText('FRI').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
