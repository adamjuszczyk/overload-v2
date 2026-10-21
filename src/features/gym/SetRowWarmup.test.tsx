// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import type { SetLog, WeekPlanSet } from '../../types'
import type { ResolvedRow } from './workoutRules'
import SetRowWarmup from './SetRowWarmup'
import { toStorageWeight } from '../../lib/weightUnit'

// Chunk 15 (SPEC "Warmup sets": weight and reps, both optional; plus a rest timer, nothing else), as chunk 58a's row draws it (boards
// W1, W2b "WARMUPS AS ROWS" / "WARMUPS AS A TICK LIST"). The pins of the old SetRow's warmup branch, one by one.
afterEach(cleanup)

const row = { key: 'set:w1', kind: 'warmup', state: 'unlogged', number: 1, block: null } as unknown as ResolvedRow
const planned = { id: 'w1', programExerciseId: 'pe-1', setNumber: 1, isWarmup: true, targetRir: null } as unknown as WeekPlanSet
const logged = (over: Partial<SetLog> = {}): SetLog =>
  ({ id: 'log-w1', weight: 20, reps: 12, enteredUnit: null, isWarmup: true, ...over }) as SetLog

function mount(over: Partial<React.ComponentProps<typeof SetRowWarmup>> = {}) {
  const props = { onLog: vi.fn(), onUpdate: vi.fn(), onDelete: vi.fn() }
  const view = render(<SetRowWarmup row={row} planned={planned} log={null} unit="kg" display="rows" restElapsed={() => 41} {...props} {...over} />)
  return { ...view, ...props }
}

describe('SetRowWarmup — rows mode (the default)', () => {
  it('shows two optional weight/reps boxes and a LOG button; no RIR, no ⋮, no skip', () => {
    mount()
    expect(screen.getByLabelText('Weight')).toBeTruthy()
    expect(screen.getByLabelText('Reps')).toBeTruthy()
    expect(screen.getByText('LOG')).toBeTruthy()
    expect(screen.queryByLabelText('RIR')).toBeNull()
    expect(screen.queryByLabelText('Set options')).toBeNull()
    expect(screen.queryByText('SKIP THIS SET')).toBeNull()
  })

  it('LOG with both boxes blank calls onLog with weight null, reps null and isWarmup true, and the rest elapsed when it is pressed', () => {
    const { onLog } = mount()
    fireEvent.click(screen.getByText('LOG'))
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0]).toEqual({
      weekPlanSetId: 'w1', setNumber: 1, weight: null, reps: null, rir: null, isDropset: false, isSkipped: false,
      restSeconds: 41, setSeconds: null, enteredUnit: null, formRating: null, stageKind: null, isWarmup: true,
    })
  })

  it('LOG with weight and reps typed converts the weight to kg and sends both, still isWarmup true', () => {
    const { onLog } = mount({ unit: 'lbs' })
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('Reps'), { target: { value: '12' } })
    fireEvent.click(screen.getByText('LOG'))
    expect(onLog.mock.calls[0][0]).toMatchObject({ weight: toStorageWeight(45, 'lbs'), reps: 12, isWarmup: true })
  })

  it('the plan\'s weight and a number target are the boxes\' values, as on a working row (DECISIONS 162 (a))', () => {
    const { onLog } = mount({ planned: { ...planned, targetWeight: 20, repMin: 12, repMax: 12 } as WeekPlanSet })
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('20')
    fireEvent.click(screen.getByText('LOG'))
    expect(onLog.mock.calls[0][0]).toMatchObject({ weight: 20, reps: 12 })
  })

  it('a logged warmup reads weight × reps with a pen, and a numberless one reads DONE', () => {
    const { container } = mount({ log: logged() })
    expect(container.textContent).toContain('20')
    expect(container.textContent).toContain('× 12')
    expect(screen.getByLabelText('Edit set')).toBeTruthy()
    cleanup()
    const numberless = mount({ log: logged({ weight: null, reps: null }) })
    expect(numberless.container.textContent).toContain('DONE')
  })
})

describe('SetRowWarmup — tick mode (warmup_display = "tick")', () => {
  it('is one tick row, "WARMUP · TAP WHEN DONE": no boxes at all', () => {
    const { container } = mount({ display: 'tick' })
    expect(container.textContent).toContain('WARMUP · TAP WHEN DONE')
    expect(container.querySelector('input')).toBeNull()
  })

  it('tapping the row logs it with no numbers: tick-off only', () => {
    const { onLog } = mount({ display: 'tick' })
    fireEvent.click(screen.getByText('WARMUP · TAP WHEN DONE'))
    expect(onLog.mock.calls[0][0]).toMatchObject({ weight: null, reps: null, isWarmup: true, weekPlanSetId: 'w1' })
  })

  it('a ticked warmup reads "WARMUP · DONE", offers no pen, and unticking is deleting it (after a confirm)', () => {
    const { container, onDelete } = mount({ display: 'tick', log: logged({ weight: null, reps: null }) })
    expect(container.textContent).toContain('WARMUP · DONE')
    expect(screen.queryByLabelText('Edit set')).toBeNull()
    fireEvent.click(screen.getByLabelText('Untick warmup'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('DELETE'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })
})

describe('SetRowWarmup — a logged warmup can be corrected and removed (chunk 15 review fix)', () => {
  it('the pen opens weight and reps only, filled from the log — no RIR and no FORM', () => {
    mount({ log: logged() })
    fireEvent.click(screen.getByLabelText('Edit set'))
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('20')
    expect((screen.getByLabelText('Reps') as HTMLInputElement).value).toBe('12')
    expect(screen.queryByLabelText('RIR')).toBeNull()
    expect(screen.queryByText('FORM')).toBeNull()
  })

  it('SAVE sends weight and reps only: no rir or formRating key at all', () => {
    const { onUpdate } = mount({ log: logged() })
    fireEvent.click(screen.getByLabelText('Edit set'))
    fireEvent.change(screen.getByLabelText('Reps'), { target: { value: '15' } })
    fireEvent.click(screen.getByText('SAVE'))
    expect(onUpdate).toHaveBeenCalledWith({ weight: 20, reps: 15 })
    expect(Object.keys(onUpdate.mock.calls[0][0])).toEqual(['weight', 'reps'])
  })

  it('an unchanged weight typed again keeps the stored kg, and a weight that is not a number blocks SAVE', () => {
    const { onUpdate } = mount({ log: logged({ weight: 9, enteredUnit: 'lbs' }) })
    fireEvent.click(screen.getByLabelText('Edit set'))
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('19.8')
    fireEvent.click(screen.getByText('SAVE'))
    expect(onUpdate.mock.calls[0][0].weight).toBe(9)
    fireEvent.click(screen.getByLabelText('Edit set'))
    fireEvent.change(screen.getByLabelText('Weight'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByText('SAVE'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Enter a valid weight')).toBeTruthy()
  })

  it('CANCEL closes the edit without calling onUpdate', () => {
    const { onUpdate } = mount({ log: logged() })
    fireEvent.click(screen.getByLabelText('Edit set'))
    fireEvent.click(screen.getByText('CANCEL'))
    expect(onUpdate).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Edit set')).toBeTruthy()
  })

  it('removing needs a confirmation and then calls onDelete; its CANCEL backs out', () => {
    const { onDelete } = mount({ log: logged() })
    fireEvent.click(screen.getByLabelText('Delete set'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('CANCEL'))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText('Delete set'))
    fireEvent.click(screen.getByText('DELETE'))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('a warmup logged with no values (ticked) can still be edited in rows mode, the boxes starting blank', () => {
    mount({ log: logged({ weight: null, reps: null }) })
    fireEvent.click(screen.getByLabelText('Edit set'))
    expect((screen.getByLabelText('Weight') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('Reps') as HTMLInputElement).value).toBe('')
  })
})
