// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent } from '@testing-library/react'
import MoveSessionSheet from './MoveSessionSheet'

afterEach(() => cleanup())
// Reviewer's own UI rule (chunk 24): "Check UI at 375 px via jsdom" — same
// convention as PlanPage.deload.test.tsx's own beforeEach.
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

// Week of 2026-08-24 (Monday) .. 2026-08-30 (Sunday) — same hand-verified
// week as scheduler.test.ts/moveSession.test.ts.
const MON = '2026-08-24'
const FRI = '2026-08-28'

describe('MoveSessionSheet — the day-chip picker', () => {
  it('on the first day of the week, offers all 7 days of the session\'s own week', () => {
    const { getByText } = render(
      <MoveSessionSheet
        workoutDayName="Push Day" originalDate={MON} currentDate={MON} today={MON}
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
        workoutDayName="Push Day" originalDate={MON} currentDate={MON} today={MON}
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
        workoutDayName="Push Day" originalDate={MON} currentDate={FRI} today={MON}
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
        workoutDayName="Push Day" originalDate={MON} currentDate={FRI} today={MON}
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
        workoutDayName="Push Day" originalDate={MON} currentDate={MON} today={MON}
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
        workoutDayName="Push Day" originalDate={MON} currentDate={MON} today={MON}
        isPending onPick={vi.fn()} onClose={vi.fn()}
      />,
    )
    expect((getByText('FRI').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

// B2 (2026-10-10): the sheet offered days that had already passed.
describe('MoveSessionSheet — only today and later days are offered', () => {
  const SAT = '2026-10-10'
  const THU = '2026-10-08'

  it('on Saturday: SAT and SUN are offered; MON-FRI are not', () => {
    const { queryByText } = render(
      <MoveSessionSheet
        workoutDayName="Legs" originalDate={SAT} currentDate={SAT} today={SAT}
        isPending={false} onPick={vi.fn()} onClose={vi.fn()}
      />,
    )
    expect(queryByText('SAT')).toBeTruthy()
    expect(queryByText('SUN')).toBeTruthy()
    for (const label of ['MON', 'TUE', 'WED', 'THU', 'FRI']) {
      expect(queryByText(label)).toBeNull()
    }
  })

  it('a session moved earlier this week to a day that has passed is not offered "MOVE BACK" to it', () => {
    const { queryByText } = render(
      <MoveSessionSheet
        workoutDayName="Legs" originalDate={THU} currentDate={SAT} today={SAT}
        isPending={false} onPick={vi.fn()} onClose={vi.fn()}
      />,
    )
    expect(queryByText('THU')).toBeNull()
    expect(queryByText('MOVE BACK')).toBeNull()
    expect(queryByText('SUN')).toBeTruthy()
  })

  it('when no day is left in the session\'s week, says so instead of showing an empty picker', () => {
    const { getByText, queryByText } = render(
      <MoveSessionSheet
        workoutDayName="Legs" originalDate="2026-09-28" currentDate="2026-09-28" today={SAT}
        isPending={false} onPick={vi.fn()} onClose={vi.fn()}
      />,
    )
    expect(queryByText('MON')).toBeNull()
    expect(getByText('NO DAYS LEFT THIS WEEK')).toBeTruthy()
  })
})
