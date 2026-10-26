// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { captureRender } from '../../testing/captureRender'
import { toStorageWeight } from '../../lib/weightUnit'
import { headLogOf, logOf, plannedDrop, plannedSet, renderCard } from './cardHarness.testutil'
import SetEditPanel from './SetEditPanel'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

// Chunk 61 — the edit panel a logged row's pen opens (TASKS-1.2 61; board W2b; SPEC [1.2] "A logged row shows a pen next to its tick (18d)", G47: "the edit
// panel's SAVE ... stay online-only"). The panel is drawn through the real card, so what is asserted is what the screen shows and what it hands `onUpdateSet`;
// `SetEditPanel.parity.test.tsx` holds the valid-input payloads against what the inline edit sent before this chunk. `CAPTURE_RENDER=1 npx vitest run
// src/features/gym/SetEditPanel.test.tsx` writes the four fixtures for `npm run shot` (W2b: a logged set, in lbs, an invalid weight, a warmup).
const online = vi.hoisted(() => ({ value: true }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online.value }))

afterEach(cleanup)
beforeEach(() => {
  online.value = true
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'rows' })
})

const rowOf = (c: HTMLElement, key: string) => c.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const typeInto = (scope: HTMLElement, label: 'Weight' | 'Reps' | 'RIR', value: string) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } })
const value = (scope: HTMLElement, label: 'Weight' | 'Reps' | 'RIR') => (within(scope).getByLabelText(label) as HTMLInputElement).value
const open = (container: HTMLElement, key: string) => {
  fireEvent.click(within(rowOf(container, key)).getByLabelText('Edit set'))
  return rowOf(container, key)
}
const button = (scope: HTMLElement, name: string) => within(scope).getByText(name) as HTMLButtonElement

describe('the panel the pen opens (board W2b)', () => {
  const logged = () => [headLogOf(1), headLogOf(2, { weight: 80, reps: 8, rir: 2, formRating: 'controlled' })]

  it('takes the row\'s place with its number, the logged weight, reps and RIR, FORM with the logged chip pressed, SET TYPE and the four buttons', () => {
    const onUpdateSet = vi.fn()
    const { container } = renderCard({ plannedSets: [plannedSet(1), plannedSet(2)], logs: logged(), props: { onUpdateSet } })
    const panel = open(container, 'set:set-2')
    expect(within(panel).getByText('02')).toBeTruthy()
    expect([value(panel, 'Weight'), value(panel, 'Reps'), value(panel, 'RIR')]).toEqual(['80', '8', '2'])
    expect(within(panel).getByText('kg')).toBeTruthy()
    expect(within(panel).getByText('FORM')).toBeTruthy()
    expect(within(panel).getByText('CONTROLLED').getAttribute('aria-pressed')).toBe('true')
    expect(within(panel).getByText('RUSHED').getAttribute('aria-pressed')).toBe('false')
    expect(within(panel).getByText('SET TYPE')).toBeTruthy()
    expect(within(panel).getByText('Normal')).toBeTruthy()
    expect(panel.textContent).toContain('UNLOGDELETECANCELSAVE')
    // the row it replaced is not drawn beside it, and the other row is as it was
    expect(within(rowOf(container, 'set:set-1')).getByLabelText('Edit set')).toBeTruthy()
    expect(within(panel).queryByLabelText('Edit set')).toBeNull()
    captureRender('w2b-edit', container) // after the assertions: a panel that lost a part fails above and leaves the committed fixture alone
  })

  it('a set logged in lbs: the weight is shown in lbs and the box says lbs', () => {
    const lbs = headLogOf(2, { weight: toStorageWeight(120, 'lbs'), reps: 10, rir: 1, formRating: 'controlled', enteredUnit: 'lbs' })
    const { container } = renderCard({ plannedSets: [plannedSet(1), plannedSet(2)], logs: [headLogOf(1), lbs] })
    const panel = open(container, 'set:set-2')
    expect(value(panel, 'Weight')).toBe('120')
    expect(within(panel).getByText('lbs')).toBeTruthy()
    captureRender('w2b-lbs', container)
  })

  it('"52..5" is not a weight: SAVE sends nothing, the box is marked and the line says "Enter a valid weight."', () => {
    const onUpdateSet = vi.fn()
    const { container } = renderCard({ plannedSets: [plannedSet(1), plannedSet(2)], logs: [headLogOf(1, { weight: 52.5, reps: 9, rir: 2, formRating: 'controlled' }), headLogOf(2)], props: { onUpdateSet } })
    const panel = open(container, 'set:set-1')
    typeInto(panel, 'Weight', '52..5')
    fireEvent.click(button(panel, 'SAVE'))
    expect(onUpdateSet).not.toHaveBeenCalled()
    expect(within(panel).getByText('Enter a valid weight.')).toBeTruthy()
    expect(within(panel).getByLabelText('Weight').getAttribute('aria-invalid')).toBe('true')
    captureRender('w2b-invalid', container)
    // typing again takes the message away
    typeInto(panel, 'Weight', '52.5')
    expect(within(panel).queryByText('Enter a valid weight.')).toBeNull()
    fireEvent.click(button(panel, 'SAVE'))
    expect(onUpdateSet).toHaveBeenCalledTimes(1)
  })

  it('a warmup: weight and reps only, SET TYPE Warmup (board "EDITING A WARMUP")', () => {
    const { container } = renderCard({ plannedSets: [plannedSet(1, { isWarmup: true }), plannedSet(2)], logs: [headLogOf(1, { isWarmup: true, weight: 20, reps: 12, rir: null })] })
    const panel = open(container, 'set:set-1')
    expect(within(panel).getByText('W')).toBeTruthy()
    expect([value(panel, 'Weight'), value(panel, 'Reps')]).toEqual(['20', '12'])
    expect(within(panel).queryByLabelText('RIR')).toBeNull()
    expect(within(panel).queryByText('FORM')).toBeNull()
    expect(within(panel).getByText('Warmup')).toBeTruthy()
    captureRender('w2b-warmup', container)
  })

  it('a drop\'s panel has no SET TYPE row (a drop has no type of its own), and its number cell is the arrow', () => {
    const { container } = renderCard({
      plannedSets: [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)],
      logs: [headLogOf(1, { stageKind: 'dropset' }), logOf({ id: 'd1', parentSetId: 'log-1', stageIndex: 1, setNumber: 1, isDropset: true, weekPlanSetId: 'set-1-drop-1' })],
    })
    const panel = open(container, 'set:set-1:stage:1')
    expect(within(panel).getByText('↳')).toBeTruthy()
    expect(within(panel).queryByText('SET TYPE')).toBeNull()
    expect(within(panel).getByText('DELETE')).toBeTruthy()
  })
})

describe('what SAVE refuses', () => {
  const setup = (over: Partial<ReturnType<typeof headLogOf>> = {}) => {
    const onUpdateSet = vi.fn()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1, { weight: 80, reps: 8, rir: 2, ...over })], props: { onUpdateSet } })
    return { onUpdateSet, panel: open(container, 'set:set-1') }
  }

  it('a working set needs its weight and its reps (the table refuses one without: 035\'s check): "Enter weight and reps." and nothing sent', () => {
    for (const [field, text] of [['Weight', ''], ['Reps', ''], ['Weight', '  ']] as const) {
      const { onUpdateSet, panel } = setup()
      typeInto(panel, field, text)
      fireEvent.click(button(panel, 'SAVE'))
      expect(onUpdateSet).not.toHaveBeenCalled()
      expect(within(panel).getByText('Enter weight and reps.')).toBeTruthy()
      cleanup()
    }
  })

  it('a warmup may have neither: both boxes empty is sent as nulls', () => {
    const onUpdateSet = vi.fn()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { isWarmup: true })], logs: [headLogOf(1, { isWarmup: true, weight: 20, reps: 12 })], props: { onUpdateSet } })
    const panel = open(container, 'set:set-1')
    typeInto(panel, 'Weight', '')
    typeInto(panel, 'Reps', '')
    fireEvent.click(button(panel, 'SAVE'))
    expect(onUpdateSet).toHaveBeenCalledWith('log-1', { weight: null, reps: null })
  })

  it('reps and RIR that are not whole numbers are refused, each with its own line (parseInt would have read "9x" as 9)', () => {
    let { onUpdateSet, panel } = setup()
    typeInto(panel, 'Reps', '9x')
    fireEvent.click(button(panel, 'SAVE'))
    expect(within(panel).getByText('Enter valid reps.')).toBeTruthy()
    cleanup()
    ;({ onUpdateSet, panel } = setup())
    typeInto(panel, 'RIR', 'x')
    fireEvent.click(button(panel, 'SAVE'))
    expect(within(panel).getByText('Enter a valid RIR.')).toBeTruthy()
    expect(onUpdateSet).not.toHaveBeenCalled()
  })

  it('a comma is a decimal point, and a weight that starts or ends with the point is a number ("." alone is not)', () => {
    const { onUpdateSet, panel } = setup()
    typeInto(panel, 'Weight', '82,5')
    fireEvent.click(button(panel, 'SAVE'))
    expect(onUpdateSet.mock.calls[0][1].weight).toBe(82.5)
    cleanup()
    const second = setup()
    typeInto(second.panel, 'Weight', '.')
    fireEvent.click(button(second.panel, 'SAVE'))
    expect(second.onUpdateSet).not.toHaveBeenCalled()
  })
})

describe('offline (G47: "the edit panel\'s SAVE ... stay online-only")', () => {
  it('SAVE is off and the panel says "Requires a connection"; a press sends nothing, and online again it saves', () => {
    online.value = false
    const onUpdateSet = vi.fn()
    const { container, rerender } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1)], props: { onUpdateSet } })
    const panel = open(container, 'set:set-1')
    typeInto(panel, 'Reps', '9')
    expect(button(panel, 'SAVE').disabled).toBe(true)
    expect(within(panel).getByText('Requires a connection')).toBeTruthy()
    fireEvent.click(button(panel, 'SAVE'))
    expect(onUpdateSet).not.toHaveBeenCalled()
    // CANCEL and DELETE are not held back by it
    expect(button(panel, 'CANCEL').disabled).toBe(false)
    expect(button(panel, 'DELETE').disabled).toBe(false)
    online.value = true
    rerender(<></>)
    cleanup()
    const again = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1)], props: { onUpdateSet } })
    const second = open(again.container, 'set:set-1')
    typeInto(second, 'Reps', '9')
    expect(within(second).queryByText('Requires a connection')).toBeNull()
    fireEvent.click(button(second, 'SAVE'))
    expect(onUpdateSet).toHaveBeenCalledTimes(1)
  })

  it('CANCEL closes the panel and writes nothing', () => {
    const onUpdateSet = vi.fn()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1)], props: { onUpdateSet } })
    const panel = open(container, 'set:set-1')
    typeInto(panel, 'Reps', '12')
    fireEvent.click(button(panel, 'CANCEL'))
    expect(onUpdateSet).not.toHaveBeenCalled()
    expect(within(rowOf(container, 'set:set-1')).getByLabelText('Edit set')).toBeTruthy()
  })
})

describe('SET TYPE and UNLOG are drawn as the board draws them and wait for chunks 62 and 63', () => {
  const props = { label: '02', log: { weight: 80, reps: 8, rir: 2, formRating: null, enteredUnit: null }, resolvedUnit: 'kg' as const, isWarmup: false, typeText: 'Normal', onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn() }

  it('with no handler each is a disabled button that does nothing', () => {
    render(<SetEditPanel {...props} />)
    expect((screen.getByText('UNLOG') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByText('SET TYPE').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })

  it('given its handler each is live and calls it', () => {
    const onSetType = vi.fn()
    const onUnlog = vi.fn()
    render(<SetEditPanel {...props} onSetType={onSetType} onUnlog={onUnlog} />)
    fireEvent.click(screen.getByText('UNLOG'))
    fireEvent.click(screen.getByText('SET TYPE').closest('button') as HTMLButtonElement)
    expect(onUnlog).toHaveBeenCalledTimes(1)
    expect(onSetType).toHaveBeenCalledTimes(1)
  })

  it('DELETE asks (onDelete) and sends nothing itself', () => {
    const onDelete = vi.fn()
    const onSave = vi.fn()
    render(<SetEditPanel {...props} onDelete={onDelete} onSave={onSave} />)
    fireEvent.click(screen.getByText('DELETE'))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })
})
