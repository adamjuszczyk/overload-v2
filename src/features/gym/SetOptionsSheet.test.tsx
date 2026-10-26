// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen, within, act } from '@testing-library/react'
import { captureRender } from '../../testing/captureRender'
import type { SetLog } from '../../types'
import { headLogOf, logOf, plannedDrop, plannedSet, renderCard, exerciseOf } from './cardHarness.testutil'
import type { LogRequest } from './useExerciseCardState'
import SetOptionsSheet from './SetOptionsSheet'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'

// Chunk 61 — the set ⋯ sheet (TASKS-1.2 61; boards W7 and W8; SPEC [1.2] "The set's ⋯ during a workout (C9)"; DECISIONS 165 (a): "no CUES row in the ⋯ of a
// set with no planned set"). The sheet is drawn through the real card, so a row that isn't offered is absent from what the screen shows, on a fixture where
// the same row IS offered one set up (RULES: "An absence test needs a fixture where the thing would appear without the guard"). `CAPTURE_RENDER=1 npx vitest
// run src/features/gym/SetOptionsSheet.test.tsx` writes the fixtures for `npm run shot` (W7, W8's drop and lbs frames).
afterEach(() => {
  cleanup()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})
beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS }))

const lat = (over: Parameters<typeof exerciseOf>[0] = {}) => exerciseOf({ exercise: { ...exerciseOf().exercise!, id: 'ex-lat', name: 'Lat Pulldown', muscleGroup: 'back' }, exerciseId: 'ex-lat', ...over })
const rowOf = (c: HTMLElement, key: string) => c.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const sheet = () => screen.getByRole('dialog')
const openMore = (container: HTMLElement, key: string) => fireEvent.click(within(rowOf(container, key)).getByLabelText('Set options'))
const names = (scope: HTMLElement) => Array.from(scope.querySelectorAll('button')).map((b) => b.textContent ?? '')
type Payload = Record<string, unknown>
function spy() {
  const calls: Payload[] = []
  const onLog = vi.fn((params: LogRequest) => {
    calls.push(params as unknown as Payload)
    return Promise.resolve(logOf({ id: `new-${calls.length}`, ...(params as unknown as Partial<SetLog>) }))
  })
  return { calls, onLog }
}

// Board W1/W7's set: Lat Pulldown 01–02 logged, 03 a dropset with one drop, a cue on it.
const w7Plan = () => [
  plannedSet(1, { targetWeight: 55, repMin: 9, repMax: 9 }),
  plannedSet(2, { targetWeight: 55, repMin: 8, repMax: 8 }),
  plannedSet(3, { stageKind: 'dropset', targetWeight: 52.5, repMin: 8, repMax: 10, tags: ['push here'] }),
  plannedDrop(3, 1, { targetWeight: 40, isAmrap: true }),
]
const w7Logs = () => [headLogOf(1, { weight: 55, reps: 9 }), headLogOf(2, { weight: 55, reps: 8 })]

describe('an open planned set\'s ⋯ (board W7)', () => {
  it('"LAT PULLDOWN · SET 03" over "Set options", then SET TYPE, CUES, FORM, the lbs row, SKIP THIS SET and DELETE SET, in that order, with the board\'s words', () => {
    const { container } = renderCard({ plannedSets: w7Plan(), logs: w7Logs(), props: { programExercise: lat() } })
    openMore(container, 'set:set-3')
    const frame = sheet()
    const text = frame.textContent ?? ''
    expect(text).toContain('LAT PULLDOWN · SET 03')
    expect(frame.getAttribute('aria-modal')).toBe('true')
    const order = ['Set options', 'SET TYPE', 'Dropset · 1 drop', 'CUES', 'Push here', 'FORM', 'RUSHED', 'NORMAL', 'CONTROLLED', 'EXTRA CONTROLLED', 'Log this set in lbs', 'This exercise is in kg.', 'SKIP THIS SET', 'DELETE SET']
    const at = order.map((word) => text.indexOf(word))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at) // each is after the one before
    expect(within(frame).getByRole('switch', { name: 'Log this set in lbs' }).getAttribute('aria-checked')).toBe('false')
    captureRender('w7', document.body) // after the assertions: a sheet that lost a row fails above and leaves the committed fixture alone
  })

  it('the SET TYPE row shows the set\'s type now and does nothing until chunk 62 wires it (a disabled row)', () => {
    const { container } = renderCard({ plannedSets: w7Plan(), logs: w7Logs(), props: { programExercise: lat() } })
    openMore(container, 'set:set-3')
    const row = within(sheet()).getByText('SET TYPE').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(true)
    fireEvent.click(row)
    expect(screen.getByRole('dialog')).toBeTruthy() // it did not close, open or write anything
  })

  it('a set with no cue says nothing in its CUES row (the standing UI rule: an unset feature shows nothing)', () => {
    const { container } = renderCard({ plannedSets: [plannedSet(1)], props: { programExercise: lat() } })
    openMore(container, 'set:set-1')
    const row = within(sheet()).getByText('CUES').closest('button') as HTMLButtonElement
    expect(row.textContent).toBe('CUES')
  })

  it('the sheet closes with its × and the page behind keeps what was typed in the row', () => {
    const { container } = renderCard({ plannedSets: [plannedSet(1, { repMin: 5, repMax: 5 })] })
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Weight'), { target: { value: '70' } })
    openMore(container, 'set:set-1')
    fireEvent.click(within(sheet()).getByLabelText('Close'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((within(rowOf(container, 'set:set-1')).getByLabelText('Weight') as HTMLInputElement).value).toBe('70')
  })
})

describe('an open drop\'s ⋯ (board W8): FORM, the lbs row and DELETE SET only', () => {
  it('has no SET TYPE, no CUES and no SKIP THIS SET, where the set it belongs to has all three', () => {
    const { container } = renderCard({ plannedSets: w7Plan(), logs: [...w7Logs(), headLogOf(3, { stageKind: 'dropset' })], props: { programExercise: lat() } })
    // the control: the head's own sheet, one frame before, offers them (the head is logged now, so it has a pen, not a ⋯: the first set of the card does)
    expect(within(rowOf(container, 'set:set-3:stage:1')).getByLabelText('Set options')).toBeTruthy()
    openMore(container, 'set:set-3:stage:1')
    const frame = sheet()
    expect(frame.textContent).toContain('LAT PULLDOWN · SET 03 · DROP 1')
    expect(within(frame).getByText('FORM')).toBeTruthy()
    expect(within(frame).getByRole('switch', { name: 'Log this set in lbs' })).toBeTruthy()
    expect(names(frame).filter((n) => n.startsWith('DELETE'))).toEqual(['DELETE SET'])
    for (const absent of ['SET TYPE', 'CUES', 'SKIP THIS SET']) expect(within(frame).queryByText(absent)).toBeNull()
    captureRender('w8-drop', document.body)
  })

  it('the same absence on a fixture where the head is open: its own sheet has them, the drop (locked until the head is logged) has no ⋯ at all', () => {
    const { container } = renderCard({ plannedSets: w7Plan(), logs: w7Logs(), props: { programExercise: lat() } })
    expect(within(rowOf(container, 'set:set-3:stage:1')).queryByLabelText('Set options')).toBeNull()
    openMore(container, 'set:set-3')
    for (const present of ['SET TYPE', 'CUES', 'SKIP THIS SET']) expect(within(sheet()).getByText(present)).toBeTruthy()
  })
})

describe('a set with no planned set has no CUES row (DECISIONS 165 (a))', () => {
  it('an added set\'s ⋯ has SET TYPE, FORM, the lbs row, SKIP THIS SET and DELETE SET, and no CUES; the planned set beside it has CUES', () => {
    const { container } = renderCard({ plannedSets: [plannedSet(1)], props: { programExercise: lat() } })
    fireEvent.click(screen.getByText('ADD SET'))
    openMore(container, 'set:set-1')
    expect(within(sheet()).getByText('CUES')).toBeTruthy()
    fireEvent.click(within(sheet()).getByLabelText('Close'))
    const added = container.querySelector('[data-row-key^="added:"]') as HTMLElement
    fireEvent.click(within(added).getByLabelText('Set options'))
    const frame = sheet()
    for (const present of ['SET TYPE', 'FORM', 'SKIP THIS SET', 'DELETE SET']) expect(within(frame).getByText(present)).toBeTruthy()
    expect(within(frame).queryByText('CUES')).toBeNull()
  })

  it('SKIP THIS SET on an added set writes its place with the skip (DECISIONS 174; 46m\'s mapping), and its own id', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1)], props: { onLog } })
    fireEvent.click(screen.getByText('ADD SET'))
    const added = container.querySelector('[data-row-key^="added:"]') as HTMLElement
    fireEvent.click(within(added).getByLabelText('Set options'))
    await act(async () => {
      fireEvent.click(within(sheet()).getByText('SKIP THIS SET'))
      await Promise.resolve()
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ isSkipped: true, weight: null, reps: null, weekPlanSetId: null, setNumber: 2, addedPlace: 1 })
    expect(typeof calls[0].id).toBe('string')
  })

  it('SKIP THIS SET on a planned set leaves the place out (a planned set has none)', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], props: { onLog } })
    openMore(container, 'set:set-1')
    await act(async () => {
      fireEvent.click(within(sheet()).getByText('SKIP THIS SET'))
      await Promise.resolve()
    })
    expect(calls[0]).toMatchObject({ isSkipped: true, weekPlanSetId: 'set-1' })
    expect('addedPlace' in calls[0]).toBe(false)
  })
})

describe('FORM and the unit in the sheet are the row\'s own state until LOG', () => {
  it('a FORM chip pressed again clears it, and what is left pressed goes with LOG', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 50, repMin: 8, repMax: 8 })], props: { onLog } })
    openMore(container, 'set:set-1')
    fireEvent.click(within(sheet()).getByText('RUSHED'))
    expect(within(sheet()).getByText('RUSHED').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(sheet()).getByText('RUSHED'))
    expect(within(sheet()).getByText('RUSHED').getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(within(sheet()).getByText('EXTRA CONTROLLED'))
    fireEvent.click(within(sheet()).getByLabelText('Close'))
    await act(async () => {
      fireEvent.click(within(rowOf(container, 'set:set-1')).getByText('LOG'))
      await Promise.resolve()
    })
    expect(calls[0].formRating).toBe('extra_controlled')
  })

  it('an exercise in lbs offers "Log this set in kg" and says "This exercise is in lbs."; the switch is on after it is pressed', () => {
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [], props: { programExercise: exerciseOf({ weightUnit: 'lbs' }) } })
    openMore(container, 'set:set-1')
    const frame = sheet()
    expect(within(frame).getByText('This exercise is in lbs.')).toBeTruthy()
    const toggle = within(frame).getByRole('switch', { name: 'Log this set in kg' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(within(frame).getByRole('switch', { name: 'Log this set in kg' }).getAttribute('aria-checked')).toBe('true')
  })

  it('an exercise in kg: "Log this set in lbs" over "This exercise is in kg."; pressed, the switch is on and the words stay (board W8\'s second frame)', () => {
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [], props: { programExercise: exerciseOf() } })
    openMore(container, 'set:set-1')
    const frame = sheet()
    expect(within(frame).getByText('This exercise is in kg.')).toBeTruthy()
    const toggle = within(frame).getByRole('switch', { name: 'Log this set in lbs' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(toggle)
    expect(within(frame).getByRole('switch', { name: 'Log this set in lbs' }).getAttribute('aria-checked')).toBe('true')
    expect(within(frame).getByText('This exercise is in kg.')).toBeTruthy()
    captureRender('w8-lbs', document.body) // after the assertions
  })
})

describe('the sheet itself (props only)', () => {
  const base = { eyebrow: 'EZ BAR CURL · SET 02', typeText: 'Normal', cuesText: null, onCues: vi.fn(), form: null, onSkip: null, onDelete: vi.fn(), onClose: vi.fn() }

  it('offers a row only when it is passed: nothing but DELETE SET with nothing else', () => {
    render(<SetOptionsSheet {...base} typeText={null} unit={null} />)
    expect(names(sheet()).filter((n) => n !== '')).toEqual(['DELETE SET'])
  })

  it('without `onDelete` there is no DELETE SET (the drop ADD STAGE draws until chunk 62: nothing to delete)', () => {
    render(<SetOptionsSheet {...base} typeText={null} unit={null} onDelete={null} />)
    expect(within(sheet()).queryByText('DELETE SET')).toBeNull()
  })

  it('SET TYPE and CUES call their handlers when they have them', () => {
    const onSetType = vi.fn()
    const onCues = vi.fn()
    render(<SetOptionsSheet {...base} onSetType={onSetType} cuesText="Push here" onCues={onCues} unit={null} />)
    fireEvent.click(within(sheet()).getByText('SET TYPE').closest('button') as HTMLButtonElement)
    fireEvent.click(within(sheet()).getByText('CUES').closest('button') as HTMLButtonElement)
    expect(onSetType).toHaveBeenCalledTimes(1)
    expect(onCues).toHaveBeenCalledTimes(1)
  })
})
