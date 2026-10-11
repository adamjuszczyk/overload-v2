// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import type { WarmupRoutineItem } from '../../types'

// Chunk 30 — the design-field editors moved out of StepExercises.tsx so Plan's STRUCTURE view can show the
// same ones. The planner's own tests (StepExercises.test.tsx, unmodified) prove it still behaves as it did;
// these prove the three things the move added are OPTIONAL: left out, an editor draws exactly what it drew,
// and with them it says what the second user needs (an aria-label on a stepper's buttons, the EVERY WEEK
// label, the routine's ⋯ rows and its read-only list).

afterEach(() => cleanup())

let items: WarmupRoutineItem[] = []
const addMock = vi.fn()
const updateMock = vi.fn()
const removeMock = vi.fn()
const reorderMock = vi.fn()
vi.mock('../programs/usePrograms', () => ({
  useWarmupRoutineItems: () => ({ data: items, isLoading: false }),
  useAddWarmupItem: () => ({ mutateAsync: addMock, isPending: false }),
  useUpdateWarmupItemBody: () => ({ mutate: updateMock, isPending: false }),
  useRemoveWarmupItem: () => ({ mutate: removeMock, isPending: false }),
  useReorderWarmupItems: () => ({ mutate: reorderMock, isPending: false }),
}))

const { RestStepper, SupersetLinkToggle, BlockRestEditor, UnitChips, EveryWeekLabel, WarmupRoutineEditor } = await import('./designFieldEditors')

const item = (id: string, position: number, body: string): WarmupRoutineItem => ({ id, userId: 'u', workoutDayId: 'wd-1', position, body })

describe('RestStepper', () => {
  it('without ariaLabel its buttons carry no aria-label — the planner\'s markup', () => {
    render(<RestStepper label="REST" value={30} disabled={false} onChange={() => {}} defaultText="GLOBAL" />)
    for (const button of screen.getAllByRole('button')) expect(button.hasAttribute('aria-label')).toBe(false)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['−', '+'])
  })

  it('with ariaLabel the − and + buttons are named, and still step by 15 s, clearing to null at the floor', () => {
    const onChange = vi.fn()
    const { rerender } = render(<RestStepper label="REST" value={30} disabled={false} onChange={onChange} defaultText="GLOBAL" ariaLabel="rest for Squat" />)
    fireEvent.click(screen.getByLabelText('More rest for Squat'))
    expect(onChange).toHaveBeenLastCalledWith(45)
    fireEvent.click(screen.getByLabelText('Less rest for Squat'))
    expect(onChange).toHaveBeenLastCalledWith(15)
    rerender(<RestStepper label="REST" value={15} disabled={false} onChange={onChange} defaultText="GLOBAL" ariaLabel="rest for Squat" />)
    fireEvent.click(screen.getByLabelText('Less rest for Squat'))
    expect(onChange).toHaveBeenLastCalledWith(null)
    rerender(<RestStepper label="REST" value={null} disabled={false} onChange={onChange} defaultText="GLOBAL" ariaLabel="rest for Squat" />)
    expect((screen.getByLabelText('Less rest for Squat') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('More rest for Squat'))
    expect(onChange).toHaveBeenLastCalledWith(15)
  })

  it('caps at 600 s', () => {
    const onChange = vi.fn()
    render(<RestStepper label="REST" value={595} disabled={false} onChange={onChange} defaultText="GLOBAL" ariaLabel="rest" />)
    fireEvent.click(screen.getByLabelText('More rest'))
    expect(onChange).toHaveBeenLastCalledWith(600)
  })
})

describe('SupersetLinkToggle', () => {
  it('is just its label with no suffix, linked or not', () => {
    const { rerender } = render(<SupersetLinkToggle linked={false} disabled={false} onToggle={() => {}} />)
    expect(screen.getByRole('button').textContent).toBe('LINK AS SUPERSET')
    rerender(<SupersetLinkToggle linked disabled={false} onToggle={() => {}} />)
    expect(screen.getByRole('button').textContent).toBe('SUPERSET — TAP TO UNLINK')
  })

  it('shows a suffix after its label, and the label stays findable on its own', () => {
    render(<SupersetLinkToggle linked={false} disabled={false} onToggle={() => {}} suffix={<EveryWeekLabel />} />)
    expect(screen.getByText('LINK AS SUPERSET')).toBeTruthy()
    expect(within(screen.getByRole('button')).getByText('EVERY WEEK')).toBeTruthy()
  })
})

describe('BlockRestEditor', () => {
  it('without everyWeek: no EVERY WEEK and no aria-labels on its steppers (the planner\'s markup)', () => {
    render(<BlockRestEditor blockId="b1" rest={null} onChange={() => {}} />)
    expect(screen.queryByText('EVERY WEEK')).toBeNull()
    for (const button of screen.getAllByRole('button')) expect(button.hasAttribute('aria-label')).toBe(false)
    expect(screen.getByText('NO TIMER')).toBeTruthy()
    expect(screen.getByText('PER EXERCISE')).toBeTruthy()
  })

  it('with everyWeek: labelled, its steppers named, and each writes its own field', () => {
    const onChange = vi.fn()
    render(<BlockRestEditor blockId="b1" rest={{ restWithinRoundSeconds: 30, restAfterRoundSeconds: null }} onChange={onChange} everyWeek />)
    expect(screen.getByText('EVERY WEEK')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('More rest within round'))
    expect(onChange).toHaveBeenLastCalledWith({ restWithinRoundSeconds: 45 })
    fireEvent.click(screen.getByLabelText('More rest after round'))
    expect(onChange).toHaveBeenLastCalledWith({ restAfterRoundSeconds: 15 })
  })
})

describe('UnitChips', () => {
  it('INHERIT names the Settings unit; the active chip is the value; a tap passes null / kg / lbs', () => {
    const onChange = vi.fn()
    render(<UnitChips value="lbs" globalUnit="kg" disabled={false} onChange={onChange} />)
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['INHERIT (KG)', 'KG', 'LBS'])
    expect(screen.getByRole('button', { name: 'LBS' }).style.background).toBe('var(--accent-muted)')
    expect(screen.getByRole('button', { name: 'KG' }).style.background).toBe('var(--surface)')
    fireEvent.click(screen.getByRole('button', { name: 'INHERIT (KG)' }))
    fireEvent.click(screen.getByRole('button', { name: 'KG' }))
    fireEvent.click(screen.getByRole('button', { name: 'LBS' }))
    expect(onChange.mock.calls).toEqual([[null], ['kg'], ['lbs']])
  })

  it('disabled disables every chip and a tap does nothing; style is the caller\'s', () => {
    const onChange = vi.fn()
    const { container } = render(<UnitChips value={null} globalUnit="lbs" disabled onChange={onChange} style={{ paddingTop: 8 }} />)
    for (const button of screen.getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'KG' }))
    expect(onChange).not.toHaveBeenCalled()
    expect((container.firstChild as HTMLElement).style.paddingTop).toBe('8px')
    expect(screen.getByRole('button', { name: 'INHERIT (LBS)' })).toBeTruthy()
  })
})

describe('WarmupRoutineEditor', () => {
  it('rows (the planner\'s): the title, NO WARMUP ITEMS YET when empty, the icon cluster per item', () => {
    items = []
    const { container, rerender } = render(<WarmupRoutineEditor workoutDayId="wd-1" />)
    expect(screen.getByText('WARMUP ROUTINE')).toBeTruthy()
    expect(screen.getByText('NO WARMUP ITEMS YET')).toBeTruthy()
    expect(screen.getByText('ADD ITEM')).toBeTruthy()

    items = [item('wi-1', 0, 'Bike'), item('wi-2', 1, 'Bands')]
    rerender(<WarmupRoutineEditor workoutDayId="wd-1" />)
    expect(container.querySelectorAll('svg.lucide-chevron-up')).toHaveLength(2)
    expect(container.querySelectorAll('svg.lucide-chevron-down')).toHaveLength(2)
    expect(container.querySelectorAll('svg.lucide-trash2')).toHaveLength(2)
    expect(screen.queryByLabelText(/^Options for warmup item/)).toBeNull()
  })

  it('menu, read-only: the list and nothing to change it with', () => {
    items = [item('wi-1', 0, 'Bike'), item('wi-2', 1, 'Bands')]
    const { container } = render(<WarmupRoutineEditor workoutDayId="wd-1" variant="menu" readOnly />)
    expect(screen.getByText('Bike')).toBeTruthy()
    expect(screen.getByText('Bands')).toBeTruthy()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.queryByText('ADD ITEM')).toBeNull()
    expect(screen.queryByText('WARMUP ROUTINE')).toBeNull() // (the caller brings the title)
    expect(container.querySelectorAll('svg')).toHaveLength(0)
  })

  it('menu, read-only and empty: nothing at all', () => {
    items = []
    const { container } = render(<WarmupRoutineEditor workoutDayId="wd-1" variant="menu" readOnly />)
    expect(container.textContent).toBe('')
  })

  it('menu: an empty routine has only ADD ITEM; each item has a ⋯ that reorders and removes it', () => {
    items = [item('wi-1', 0, 'Bike'), item('wi-2', 1, 'Bands')]
    render(<WarmupRoutineEditor workoutDayId="wd-1" variant="menu" />)
    fireEvent.click(screen.getByLabelText('Options for warmup item 2'))
    fireEvent.click(screen.getByLabelText('Move warmup item 2 up'))
    expect(reorderMock).toHaveBeenLastCalledWith([{ id: 'wi-2', position: 0 }, { id: 'wi-1', position: 1 }])
    // (the action closed the menu)
    expect(screen.queryByLabelText('Move warmup item 2 up')).toBeNull()
    fireEvent.click(screen.getByLabelText('Options for warmup item 1'))
    fireEvent.click(screen.getByLabelText('Remove warmup item 1'))
    fireEvent.click(screen.getByText('REMOVE'))
    expect(removeMock).toHaveBeenLastCalledWith('wi-1')
  })
})
