// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, screen, within, act } from '@testing-library/react'
import type { SetLog } from '../../types'
import type { LogRequest } from './useExerciseCardState'
import { headLogOf, logOf, plannedDrop, plannedSet, referenceSessionOf, renderCard, rowLabels, rowStates, exerciseOf } from './cardHarness.testutil'
import type { ReferenceSession } from './sessionService'
import { parseISO, format } from 'date-fns'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { toStorageWeight } from '../../lib/weightUnit'

// Chunk 58a — the rows of one exercise card, as the session's rules draw them and as LOG, SKIP, ADD SET and the edit write them
// (TASKS-1.2 58a "Verification": row states, LOG of an untouched row, added place, drop and stage logs; boards W1–W3b). The card is
// drawn through `useWorkoutRows` as GymSession does (cardHarness.testutil.tsx); `onLog` is `useLogSet`'s mutate, so what it receives
// is the payload the screen writes.

vi.mock('./SwapExerciseSheet', () => ({ default: () => null }))

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
})
beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS }))

const typeInto = (scope: HTMLElement, label: 'Weight' | 'Reps' | 'RIR', value: string) => fireEvent.change(within(scope).getByLabelText(label), { target: { value } })
const current = (c: HTMLElement) => c.querySelector('[data-current-set]') as HTMLElement
const rowOf = (c: HTMLElement, key: string) => c.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const pressLog = async (scope: HTMLElement) =>
  act(async () => {
    fireEvent.click(within(scope).getByText('LOG'))
    await Promise.resolve()
  })
type Payload = Record<string, unknown>
function spy() {
  const calls: Payload[] = []
  const onLog = vi.fn((params: LogRequest) => {
    calls.push(params as unknown as Payload)
    return Promise.resolve(logOf({ id: `new-${calls.length}`, ...(params as unknown as Partial<SetLog>) }))
  })
  return { calls, onLog }
}

describe('row states (SPEC [1.2] "Row states", boards W1, W2)', () => {
  const plan = () => [1, 2, 3, 4].map((n) => plannedSet(n, { targetWeight: 55, repMin: 8, repMax: 10, targetRir: 1, targetRirMax: 2 }))
  const logged = () => [headLogOf(1, { weight: 55, reps: 9, rir: 2 }), headLogOf(2, { weight: 55, reps: 8, rir: 1 })]

  it('with sets 1–2 logged, 03 is the current row with its boxes and LOG, and 04 is upcoming with its targets only', () => {
    const { container } = renderCard({ plannedSets: plan(), logs: logged() })
    expect(rowLabels(container)).toEqual(['01', '02', '03', '04'])
    expect(rowStates(container)).toEqual(['logged', 'logged', 'current', 'upcoming'])
    // inputs and LOG exist on the current row alone (absence on the others)
    expect(container.querySelectorAll('input')).toHaveLength(3)
    expect(within(current(container)).getByText('LOG')).toBeTruthy()
    const upcoming = rowOf(container, 'set:set-4')
    expect(upcoming.querySelector('input')).toBeNull()
    expect(within(upcoming).queryByText('LOG')).toBeNull()
    expect(upcoming.textContent).toContain('55 kg × 8–10 @ RIR 1–2')
  })

  it('a logged row reads "55 kg × 9 @ RIR 2" with a pen and a tick', () => {
    const { container } = renderCard({ plannedSets: plan(), logs: logged() })
    const first = rowOf(container, 'set:set-1')
    expect(first.textContent).toContain('55')
    expect(first.textContent).toContain('kg')
    expect(first.textContent).toContain('× 9')
    expect(first.textContent).toContain('@ RIR 2')
    expect(within(first).getByLabelText('Edit set')).toBeTruthy()
    expect(first.querySelector('svg.lucide-check')).not.toBeNull()
  })

  it('the reps box shows the plan\'s "8–10" and RIR the placeholder "1–2" for a range (target_rir_max is read, not target_rir alone)', () => {
    const { container } = renderCard({ plannedSets: plan(), logs: logged() })
    expect((within(current(container)).getByLabelText('Reps') as HTMLInputElement).placeholder).toBe('8–10')
    expect((within(current(container)).getByLabelText('RIR') as HTMLInputElement).placeholder).toBe('1–2')
    expect((within(current(container)).getByLabelText('Weight') as HTMLInputElement).value).toBe('55')
  })

  it('a planned dropset: its drops are locked ("AFTER SET 01", "AFTER DROP 1") until the head is logged, then the first drop is current (C8)', () => {
    const planned = [plannedSet(1, { stageKind: 'dropset', targetWeight: 52.5, repMin: 8, repMax: 10 }), plannedDrop(1, 1, { targetWeight: 40, isAmrap: true }), plannedDrop(1, 2, { targetWeight: 30, isAmrap: true })]
    const { container, setLogs } = renderCard({ plannedSets: planned })
    expect(rowStates(container)).toEqual(['current', 'locked', 'locked'])
    expect(container.textContent).toContain('DROPSET · 2 DROPS')
    expect(container.textContent).toContain('AFTER SET 01')
    expect(container.textContent).toContain('AFTER DROP 1')
    setLogs([headLogOf(1, { stageKind: 'dropset' })])
    expect(rowStates(container)).toEqual(['logged', 'current', 'locked'])
    expect(rowLabels(container)).toEqual(['01', '↳', '↳'])
  })

  it('a skipped set and its skipped drop read SKIPPED, and nothing after them is current by mistake', () => {
    const planned = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedSet(2)]
    const { container } = renderCard({
      plannedSets: planned,
      logs: [headLogOf(1, { isSkipped: true, weight: null, reps: null, stageKind: 'dropset' }), logOf({ id: 'drop-skip', weekPlanSetId: 'set-1-drop-1', parentSetId: 'log-1', stageIndex: 1, setNumber: 1, isSkipped: true, weight: null, reps: null })],
    })
    expect(rowStates(container)).toEqual(['skipped', 'skipped', 'current'])
    expect(rowOf(container, 'set:set-1').textContent).toContain('SKIPPED')
  })

  it('there is no inline rest timer under a logged row (C5: the rest timer is the pinned bar)', () => {
    useRestTimerStore.getState().startRest(90)
    useRestTimerStore.setState({ anchorId: 'log-1' })
    const { container } = renderCard({ plannedSets: plan(), logs: logged() })
    expect(container.textContent).not.toMatch(/REST \d/) // no "REST 0:12" under the row (the card's own SKIP REST OF EXERCISE is not a timer)
  })
})

describe('LOG of an untouched row (DECISIONS 162 (a), Adam 2026-10-16)', () => {
  it('writes the plan\'s targets: the planned weight and a number target, with the number the row shows', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 52.5, repMin: 8, repMax: 8 })], props: { onLog } })
    await pressLog(current(container))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'set-1', setNumber: 1, weight: 52.5, reps: 8, rir: null })
  })

  it('with a rep range it sends nothing until reps are typed (the planned weight stays)', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 52.5, repMin: 8, repMax: 10 })], props: { onLog } })
    await pressLog(current(container))
    expect(calls).toEqual([])
    expect(current(container).textContent).toContain('Enter weight and reps, or skip the set from ⋮.')
    typeInto(current(container), 'Reps', '9')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ weight: 52.5, reps: 9 })
  })

  it('with AMRAP it sends nothing until reps are typed', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 40, isAmrap: true })], props: { onLog } })
    await pressLog(current(container))
    expect(calls).toEqual([])
    typeInto(current(container), 'Reps', '12')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ weight: 40, reps: 12 })
  })

  it('with no planned weight the weight box is empty and LOG needs the weight', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { repMin: 8, repMax: 8 })], props: { onLog } })
    expect((within(current(container)).getByLabelText('Weight') as HTMLInputElement).value).toBe('')
    await pressLog(current(container))
    expect(calls).toEqual([])
    typeInto(current(container), 'Weight', '60')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ weight: 60, reps: 8 })
  })

  it('last time is the LAST line only: its numbers are never in the boxes and LOG never takes them', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({
      plannedSets: [plannedSet(1)],
      props: { onLog, today: '2026-01-05', referenceSessions: [referenceSessionOf('prev', '2025-12-31', [logOf({ id: 'last-1', sessionId: 'prev', weight: 52.5, reps: 10, rir: 1 })])] },
    })
    const row = current(container)
    expect((within(row).getByLabelText('Weight') as HTMLInputElement).value).toBe('')
    expect((within(row).getByLabelText('Reps') as HTMLInputElement).value).toBe('')
    expect(row.textContent).toContain('LAST')
    expect(row.textContent).toContain('52.5 × 10 @ 1')
    await pressLog(row)
    expect(calls).toEqual([])
  })

  it('what is typed wins over the plan, and the RIR achieved is written ("1" typed over the dim "1–2")', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 55, repMin: 8, repMax: 10, targetRir: 1, targetRirMax: 2 })], props: { onLog } })
    typeInto(current(container), 'Weight', '57.5')
    typeInto(current(container), 'Reps', '9')
    typeInto(current(container), 'RIR', '1')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ weight: 57.5, reps: 9, rir: 1 })
  })
})

describe('the number LOG stores is the number the row shows (DECISIONS 151, 170)', () => {
  it('with 01 and 03 logged and 02 open (an unlog), LOG on 02 stores 2, not the logged sets + 1 (which is 3)', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({
      plannedSets: [1, 2, 3].map((n) => plannedSet(n, { targetWeight: 50, repMin: 8, repMax: 8 })),
      logs: [headLogOf(1), headLogOf(3)],
      props: { onLog },
    })
    expect(rowStates(container)).toEqual(['logged', 'current', 'logged'])
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'set-2', setNumber: 2 })
  })
})

describe('the logging-time unit override and MEASURE SET TIME (today\'s, kept in the new row)', () => {
  it('flipping the unit label logs that one set in the other unit: the weight is converted to kg and entered_unit says so', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { repMin: 5, repMax: 5 })], props: { onLog } })
    fireEvent.click(within(current(container)).getByLabelText('Log this set in lbs'))
    typeInto(current(container), 'Weight', '100')
    await pressLog(current(container))
    expect(calls[0].enteredUnit).toBe('lbs')
    expect(calls[0].weight).toBe(toStorageWeight(100, 'lbs'))
  })

  it('with MEASURE SET TIME on, START SET replaces LOG; TIMING shows; LOG then writes the set\'s seconds and the rest frozen at START SET', async () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, measureSetTime: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'))
    useRestTimerStore.setState({ startedAt: Date.now() - 75_000, targetSeconds: 90 })
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 50, repMin: 8, repMax: 8 })], props: { onLog } })
    expect(within(current(container)).queryByText('LOG')).toBeNull()
    fireEvent.click(within(current(container)).getByText('START SET'))
    expect(current(container).textContent).toContain('TIMING')
    expect(useRestTimerStore.getState().startedAt).toBeNull() // true rest ends at START SET
    vi.setSystemTime(new Date(Date.now() + 42_000))
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ setSeconds: 42, restSeconds: 75, weight: 50, reps: 8 })
  })

  it('with MEASURE SET TIME on the row before START SET has no RIR box; tapping TIMING brings every box back with the clock kept, and LOG writes what was typed', async () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, measureSetTime: true })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'))
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 50, repMin: 8, repMax: 8 })], props: { onLog } })
    expect(within(current(container)).queryByLabelText('RIR')).toBeNull()
    fireEvent.click(within(current(container)).getByText('START SET'))
    expect(within(current(container)).queryByLabelText('Reps')).toBeNull() // TIMING stands where the boxes were (board W2)
    fireEvent.click(within(current(container)).getByText(/^TIMING/))
    expect(within(current(container)).getByLabelText('RIR')).toBeTruthy()
    expect(current(container).textContent).toMatch(/TIMING 0:\d\d/)
    typeInto(current(container), 'Reps', '7')
    typeInto(current(container), 'RIR', '2')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ weight: 50, reps: 7, rir: 2 })
  })

  it('⋮ keeps FORM and SKIP THIS SET reachable until chunk 61\'s sheet: SKIP writes a skipped set under the number the row shows', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { stageKind: 'rest_pause' })], props: { onLog } })
    fireEvent.click(within(current(container)).getByLabelText('Set options'))
    fireEvent.click(within(current(container)).getByText('SKIP THIS SET'))
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'set-1', setNumber: 1, isSkipped: true, weight: null, reps: null, stageKind: 'rest_pause' })
  })

  it('FORM picked in ⋮ goes into the LOG payload', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 50, repMin: 8, repMax: 8 })], props: { onLog } })
    fireEvent.click(within(current(container)).getByLabelText('Set options'))
    fireEvent.click(within(current(container)).getByText('CONTROLLED'))
    await pressLog(current(container))
    expect(calls[0].formRating).toBe('controlled')
  })
})

describe('sets added in the session carry their place on LOG (DECISIONS 174, 177; 46m\'s mapping)', () => {
  it('+ ADD SET then LOG: the head log carries added_place 1, and its own id', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [], props: { onLog } })
    fireEvent.click(screen.getByText('ADD SET'))
    expect(rowLabels(container)).toEqual(['01'])
    typeInto(current(container), 'Weight', '50')
    typeInto(current(container), 'Reps', '9')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ weekPlanSetId: null, setNumber: 1, addedPlace: 1, weight: 50, reps: 9 })
    expect(typeof calls[0].id).toBe('string')
  })

  it('the next added set is place 2, also after the first has been logged', async () => {
    const { calls, onLog } = spy()
    const { container, setLogs } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 50, repMin: 8, repMax: 8 })], logs: [headLogOf(1)], props: { onLog } })
    fireEvent.click(screen.getByText('ADD SET'))
    typeInto(current(container), 'Weight', '50')
    typeInto(current(container), 'Reps', '9')
    await pressLog(current(container))
    expect(calls[0].addedPlace).toBe(1)
    setLogs([headLogOf(1), logOf({ id: calls[0].id as string, setNumber: 2, addedPlace: 1 })]) // the first is logged now
    fireEvent.click(screen.getByText('ADD SET'))
    typeInto(current(container), 'Weight', '50')
    typeInto(current(container), 'Reps', '9')
    await pressLog(current(container))
    expect(calls[1]).toMatchObject({ addedPlace: 2, setNumber: 3 })
  })

  it('two taps of ADD SET in one instant give two places, 1 and 2', async () => {
    const { calls, onLog } = spy()
    const { container, setLogs } = renderCard({ plannedSets: [], props: { onLog } })
    act(() => {
      fireEvent.click(screen.getByText('ADD SET'))
      fireEvent.click(screen.getByText('ADD SET'))
    })
    expect(rowLabels(container)).toEqual(['01', '02'])
    typeInto(current(container), 'Weight', '50')
    typeInto(current(container), 'Reps', '9')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ addedPlace: 1, setNumber: 1 })
    setLogs([logOf({ id: calls[0].id as string, setNumber: 1, addedPlace: 1 })]) // the first is logged now: the second is the current row
    typeInto(current(container), 'Weight', '50')
    typeInto(current(container), 'Reps', '9')
    await pressLog(current(container))
    expect(calls[1]).toMatchObject({ addedPlace: 2, setNumber: 2 }) // the second tap saw the first (a stale list would give it place 1 again)
  })

  it('a planned set\'s payload has no added_place key and no log id of its own (absence)', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { targetWeight: 50, repMin: 8, repMax: 8 })], props: { onLog } })
    await pressLog(current(container))
    expect('addedPlace' in calls[0]).toBe(false)
    expect('id' in calls[0]).toBe(false)
  })

  it('the row names its log before the request is answered: once the optimistic log is in the session, the set is one row, not two', async () => {
    const { calls, onLog } = spy()
    const { container, setLogs } = renderCard({ plannedSets: [], props: { onLog } })
    fireEvent.click(screen.getByText('ADD SET'))
    typeInto(current(container), 'Weight', '50')
    typeInto(current(container), 'Reps', '9')
    await pressLog(current(container))
    // the optimistic log has landed in the cache under the id the card named; the request has not been answered yet
    setLogs([logOf({ id: calls[0].id as string, setNumber: 1, addedPlace: 1 })])
    expect(rowLabels(container)).toEqual(['01'])
    expect(rowStates(container)).toEqual(['logged'])
  })

  it('a drop logged under an added set carries no place (DECISIONS 177: only an added set\'s own log does)', async () => {
    const { calls, onLog } = spy()
    const head = logOf({ id: 'added-head', setNumber: 1, addedPlace: 1, weight: 50, reps: 9 })
    const { container } = renderCard({ plannedSets: [], logs: [head], props: { onLog } })
    fireEvent.click(screen.getByText('mark as dropset'))
    typeInto(current(container), 'Weight', '40')
    typeInto(current(container), 'Reps', '8')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ parentSetId: 'added-head', stageIndex: 1, isDropset: true, weekPlanSetId: null, setNumber: 1 })
    expect('addedPlace' in calls[0]).toBe(false)
    expect('id' in calls[0]).toBe(false)
  })
})

describe('staged sets (chunks 3 and 14: planned drops render from the start, locked until the row before is logged)', () => {
  const dropset = () => [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedDrop(1, 2)]

  it('logging the unlocked drop writes the head\'s real log id as its parent and stageIndex 1, then 2, with isDropset true and its own plan slot', async () => {
    const { calls, onLog } = spy()
    const { container, setLogs } = renderCard({ plannedSets: dropset(), logs: [headLogOf(1, { stageKind: 'dropset', id: 'real-head' })], props: { onLog } })
    typeInto(current(container), 'Weight', '40')
    typeInto(current(container), 'Reps', '8')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ parentSetId: 'real-head', stageIndex: 1, isDropset: true, weekPlanSetId: 'set-1-drop-1', setNumber: 1, stageKind: null })
    setLogs([headLogOf(1, { stageKind: 'dropset', id: 'real-head' }), logOf({ id: 'd1', weekPlanSetId: 'set-1-drop-1', parentSetId: 'real-head', stageIndex: 1, setNumber: 1, isDropset: true })])
    typeInto(current(container), 'Weight', '30')
    typeInto(current(container), 'Reps', '8')
    await pressLog(current(container))
    expect(calls[1]).toMatchObject({ parentSetId: 'real-head', stageIndex: 2, weekPlanSetId: 'set-1-drop-2' })
  })

  it('a locked drop has nothing in it that fires: no boxes and no LOG', () => {
    const { container } = renderCard({ plannedSets: dropset() })
    const locked = rowOf(container, 'set:set-1:stage:1')
    expect(locked.querySelector('input')).toBeNull()
    expect(locked.querySelector('button')).toBeNull()
  })

  it('a planned rest-pause set of 3 stages shows every stage from the start, carries the weight stage to stage, and writes stage_kind "as planned" on its head only', async () => {
    const { calls, onLog } = spy()
    const planned = [plannedSet(1, { stageKind: 'rest_pause', targetWeight: 35, repMin: 10, repMax: 10 }), plannedDrop(1, 1), plannedDrop(1, 2), plannedDrop(1, 3)]
    const { container, setLogs } = renderCard({ plannedSets: planned, props: { onLog } })
    expect(rowLabels(container)).toEqual(['01', '↳', '↳', '↳'])
    expect(container.textContent).toContain('REST-PAUSE · 3 STAGES')
    await pressLog(current(container)) // the head takes the plan's 35 × 10
    expect(calls[0]).toMatchObject({ stageKind: 'rest_pause', weight: 35, reps: 10 })
    const head = headLogOf(1, { stageKind: 'rest_pause', id: 'real-head', weight: 35, reps: 10 })
    setLogs([head])
    expect((within(current(container)).getByLabelText('Weight') as HTMLInputElement).value).toBe('35')
    typeInto(current(container), 'Reps', '4')
    await pressLog(current(container))
    expect(calls[1]).toMatchObject({ parentSetId: 'real-head', stageIndex: 1, stageKind: null, weight: 35 })
    setLogs([head, logOf({ id: 's1', parentSetId: 'real-head', stageIndex: 1, weight: 33, reps: 4, weekPlanSetId: 'set-1-drop-1', isDropset: true })])
    expect((within(current(container)).getByLabelText('Weight') as HTMLInputElement).value).toBe('33') // the stage before, not the head
  })
})

describe('ADD STAGE and "mark as dropset" stay until chunk 62\'s picker replaces them (SPEC "Set types")', () => {
  it('a logged set with no drop planned or logged offers the low-emphasis "mark as dropset"; tapping it opens a drop row whose LOG writes the drop', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1, { id: 'h' })], props: { onLog } })
    expect(screen.queryByText('ADD STAGE')).toBeNull()
    fireEvent.click(screen.getByText('mark as dropset'))
    typeInto(current(container), 'Weight', '40')
    typeInto(current(container), 'Reps', '8')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ parentSetId: 'h', stageIndex: 1, isDropset: true, weekPlanSetId: null })
  })

  it('with one unplanned drop already logged it is the bold ADD STAGE, and the next drop is stageIndex 2', async () => {
    const { calls, onLog } = spy()
    const head = headLogOf(1, { id: 'h' })
    const drop = logOf({ id: 'd1', parentSetId: 'h', stageIndex: 1, setNumber: 1, isDropset: true })
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [head, drop], props: { onLog } })
    expect(screen.queryByText('mark as dropset')).toBeNull()
    fireEvent.click(screen.getByText('ADD STAGE'))
    typeInto(current(container), 'Weight', '30')
    typeInto(current(container), 'Reps', '8')
    await pressLog(current(container))
    expect(calls[0]).toMatchObject({ parentSetId: 'h', stageIndex: 2 })
  })

  it('a skipped set offers no stage at all', () => {
    renderCard({ plannedSets: [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)], logs: [headLogOf(1, { isSkipped: true, weight: null, reps: null, stageKind: 'dropset' })] })
    expect(screen.queryByText('ADD STAGE')).toBeNull()
    expect(screen.queryByText('mark as dropset')).toBeNull()
  })
})

describe('SKIP REST OF EXERCISE (planned working sets; each skip stores the number its row shows)', () => {
  it('skips the open planned sets around a logged one, 1 and 3, as skipped logs of their own plan slots', async () => {
    const { calls, onLog } = spy()
    renderCard({ plannedSets: [1, 2, 3].map((n) => plannedSet(n)), logs: [headLogOf(2)], props: { onLog } })
    fireEvent.click(screen.getByText('SKIP REST OF EXERCISE'))
    fireEvent.click(screen.getByText('CONFIRM SKIP'))
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls.map((c) => [c.weekPlanSetId, c.setNumber, c.isSkipped])).toEqual([['set-1', 1, true], ['set-3', 3, true]])
  })

  it('a planned dropset: its head, then each drop under the head\'s real log id, in order', async () => {
    const { calls, onLog } = spy()
    // the dropset is set 2 (set 1 is logged): a drop that took any number but its head's shows
    renderCard({ plannedSets: [plannedSet(1), plannedSet(2, { stageKind: 'dropset' }), plannedDrop(2, 1), plannedDrop(2, 2)], logs: [headLogOf(1)], props: { onLog } })
    fireEvent.click(screen.getByText('SKIP REST OF EXERCISE'))
    fireEvent.click(screen.getByText('CONFIRM SKIP'))
    await vi.waitFor(() => expect(calls).toHaveLength(3))
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'set-2', setNumber: 2, isSkipped: true, stageKind: 'dropset', parentSetId: null })
    expect(calls.slice(1).map((c) => [c.weekPlanSetId, c.parentSetId, c.stageIndex, c.isDropset, c.setNumber])).toEqual([
      ['set-2-drop-1', 'new-1', 1, true, 2],
      ['set-2-drop-2', 'new-1', 2, true, 2],
    ])
  })

  it('leaves an added set and a warmup alone (today\'s skip covers planned working sets: chunk 59 extends it)', async () => {
    const { calls, onLog } = spy()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { id: 'w', isWarmup: true }), plannedSet(2, { id: 'set-2' })], props: { onLog } })
    fireEvent.click(screen.getByText('ADD SET'))
    fireEvent.click(screen.getByText('SKIP REST OF EXERCISE'))
    fireEvent.click(screen.getByText('CONFIRM SKIP'))
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].weekPlanSetId).toBe('set-2')
    expect(rowLabels(container)).toEqual(['W', '01', '02'])
  })
})

describe('editing and deleting a logged set (today\'s writes, kept until chunk 61\'s edit panel)', () => {
  it('the pen opens the logged numbers; SAVE sends weight, reps, RIR and FORM — and no note', () => {
    const onUpdateSet = vi.fn()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1, { weight: 80, reps: 8, rir: 2 })], props: { onUpdateSet } })
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByLabelText('Edit set'))
    const row = rowOf(container, 'set:set-1')
    expect((within(row).getByLabelText('Weight') as HTMLInputElement).value).toBe('80')
    expect(row.querySelector('input[aria-label="Note"], textarea')).toBeNull()
    typeInto(row, 'Reps', '9')
    fireEvent.click(within(row).getByText('SAVE'))
    expect(onUpdateSet).toHaveBeenCalledWith('log-1', { weight: 80, reps: 9, rir: 2, formRating: null })
    expect(Object.keys(onUpdateSet.mock.calls[0][1])).not.toContain('note')
  })

  it('an unchanged weight typed again keeps the stored kg (the round-trip guard: 9 kg shows as 19.8 lbs)', () => {
    const onUpdateSet = vi.fn()
    const { container } = renderCard({
      plannedSets: [plannedSet(1)],
      logs: [headLogOf(1, { weight: 9, reps: 8, enteredUnit: 'lbs' })],
      props: { onUpdateSet },
    })
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByLabelText('Edit set'))
    const row = rowOf(container, 'set:set-1')
    expect((within(row).getByLabelText('Weight') as HTMLInputElement).value).toBe('19.8')
    fireEvent.click(within(row).getByText('SAVE'))
    expect(onUpdateSet.mock.calls[0][1].weight).toBe(9)
  })

  it('a weight that is not a number blocks SAVE with its message', () => {
    const onUpdateSet = vi.fn()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1)], props: { onUpdateSet } })
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByLabelText('Edit set'))
    const row = rowOf(container, 'set:set-1')
    typeInto(row, 'Weight', 'abc')
    fireEvent.click(within(row).getByText('SAVE'))
    expect(onUpdateSet).not.toHaveBeenCalled()
    expect(row.textContent).toContain('Enter a valid weight')
  })

  it('DELETE asks first, then removes the drop before the head and renumbers the sets after it (heads only, as today)', async () => {
    const deleted: string[] = []
    const onUpdateSet = vi.fn()
    const logs = [
      headLogOf(1, { stageKind: 'dropset' }),
      logOf({ id: 'd1', parentSetId: 'log-1', stageIndex: 1, setNumber: 1, isDropset: true, weekPlanSetId: 'set-1-drop-1' }),
      headLogOf(2),
      headLogOf(3),
    ]
    const { container } = renderCard({
      plannedSets: [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedSet(2), plannedSet(3)],
      logs,
      props: { onUpdateSet, onDeleteSet: async (id) => void deleted.push(id) },
    })
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByText('DELETE'))
    expect(deleted).toEqual([]) // asks first
    await act(async () => {
      fireEvent.click(within(rowOf(container, 'set:set-1')).getByText('CONFIRM DELETE'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(deleted).toEqual(['d1', 'log-1']) // the drop first, the head last
    expect(onUpdateSet.mock.calls).toEqual([['log-2', { setNumber: 1 }], ['log-3', { setNumber: 2 }]])
  })
})

describe('a swapped slot offers no second swap, and a plain card does', () => {
  it('the swap button is on a plain card and gone from a card of a swapped slot', () => {
    const plain = renderCard({ plannedSets: [plannedSet(1)] })
    expect(screen.getAllByLabelText('Swap exercise for this session')).toHaveLength(1)
    plain.unmount()
    renderCard({ plannedSets: [plannedSet(1)], props: { slotSwapped: true, programExercise: exerciseOf() } })
    expect(screen.queryAllByLabelText('Swap exercise for this session')).toHaveLength(0)
  })
})

// Review 1 of 58a, finding 2: the LAST line reads the session the exercise's reference panel calls its primary one (`lastTimeSet.ts`),
// not the latest completed session. Today is Thursday 2026-01-08 (weeks run Monday to Sunday): "this week" is Mon 2026-01-05 on,
// last week Mon 2025-12-29 to Sun 2026-01-04, and the dates below are checked against their weekdays (Checks that lied #21).
describe('the LAST line reads the reference\'s primary session (58a review 1, finding 2)', () => {
  const TODAY = '2026-01-08'
  const DAY = { today: TODAY, thisWeekMon: '2026-01-05', lastWeekWed: '2025-12-31', twoWeeksWed: '2025-12-24' }
  it('the fixture dates are the weekdays they are named for', () => {
    expect(Object.values(DAY).map((d) => format(parseISO(d), 'EEE'))).toEqual(['Thu', 'Mon', 'Wed', 'Wed'])
  })

  const sets = (sessionId: string, weights: number[], over: Partial<SetLog> = {}) =>
    weights.map((weight, i) => logOf({ id: `${sessionId}-${i + 1}`, sessionId, setNumber: i + 1, weight, reps: 10, rir: 1, ...over }))
  const session = (sessionId: string, date: string, weights: number[], over: Partial<ReferenceSession> = {}) => referenceSessionOf(sessionId, date, sets(sessionId, weights), over)
  const skippedSession = (sessionId: string, date: string) => referenceSessionOf(sessionId, date, sets(sessionId, [0, 0, 0], { isSkipped: true, weight: null, reps: null, rir: null }))
  const card = (referenceSessions: ReferenceSession[], props: Record<string, unknown> = {}) =>
    renderCard({ plannedSets: [1, 2, 3].map((n) => plannedSet(n)), props: { today: TODAY, referenceSessions, ...props } })
  // The text of each row's LAST line, in the order the rows are drawn (null: the row draws none).
  const lastLines = (container: Element) =>
    Array.from(container.querySelectorAll('[data-row-key]')).map((row) => Array.from(row.querySelectorAll('p')).map((p) => p.textContent ?? '').find((t) => t.startsWith('LAST')) ?? null)

  it('row 01 shows last week\'s first working set, 02 its second, 03 its third: never always the first', () => {
    const { container } = card([session('lw', DAY.lastWeekWed, [60, 62.5, 65])])
    expect(lastLines(container)).toEqual(['LAST 60 × 10 @ 1', 'LAST 62.5 × 10 @ 1', 'LAST 65 × 10 @ 1'])
  })

  it('warmups are left out: the place counts working sets only', () => {
    const logs = [...sets('lw', [20, 40], { isWarmup: true }), ...sets('lw', [60, 62.5, 65]).map((l, i) => ({ ...l, id: `lw-w${i}`, setNumber: i + 3 }))]
    const { container } = card([referenceSessionOf('lw', DAY.lastWeekWed, logs)])
    expect(lastLines(container)).toEqual(['LAST 60 × 10 @ 1', 'LAST 62.5 × 10 @ 1', 'LAST 65 × 10 @ 1'])
  })

  it('a deload session last week never counts: the line reads the session before it (the latest completed session is the deload)', () => {
    const { container } = card([session('deload', DAY.lastWeekWed, [30, 30, 30], { isDeload: true }), session('before', DAY.twoWeeksWed, [60, 62.5, 65])])
    expect(lastLines(container)).toEqual(['LAST 60 × 10 @ 1', 'LAST 62.5 × 10 @ 1', 'LAST 65 × 10 @ 1'])
  })

  it('the exercise done earlier this week does not replace last week\'s numbers (the panel shows it apart, as EARLIER THIS WEEK)', () => {
    const { container } = card([session('early', DAY.thisWeekMon, [70, 72.5, 75]), session('lw', DAY.lastWeekWed, [50, 52.5, 55])])
    expect(lastLines(container)).toEqual(['LAST 50 × 10 @ 1', 'LAST 52.5 × 10 @ 1', 'LAST 55 × 10 @ 1'])
  })

  it('after a last session in which every set was skipped, the line reads the session the reference reaches back to', () => {
    const { container } = card([skippedSession('lw', DAY.lastWeekWed), session('before', DAY.twoWeeksWed, [60, 62.5, 65])])
    expect(lastLines(container)).toEqual(['LAST 60 × 10 @ 1', 'LAST 62.5 × 10 @ 1', 'LAST 65 × 10 @ 1'])
  })

  it('with nothing on record, or every session skipped, no row draws a LAST line (and none says it is loading or failed)', () => {
    for (const sessions of [[], [skippedSession('lw', DAY.lastWeekWed)]]) {
      const { container, unmount } = card(sessions)
      expect(lastLines(container)).toEqual([null, null, null])
      expect(container.textContent).not.toContain('LOADING LAST TIME')
      expect(container.textContent).not.toContain('COULDN\'T LOAD')
      unmount()
    }
  })

  it('only a working set has a LAST line: the open drop under a logged head has none', () => {
    const { container } = renderCard({
      plannedSets: [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)],
      logs: [headLogOf(1, { stageKind: 'dropset' })],
      props: { today: TODAY, referenceSessions: [session('lw', DAY.lastWeekWed, [60])] },
    })
    expect(rowStates(container)).toEqual(['logged', 'current'])
    expect(lastLines(container)).toEqual([null, null])
  })

  it('on a sequence run it is the most recent session whatever its week; on a weekday run last week\'s', () => {
    const sessions = [session('early', DAY.thisWeekMon, [70, 72.5, 75]), session('lw', DAY.lastWeekWed, [50, 52.5, 55])]
    const sequence = card(sessions, { referenceScheduleType: 'sequence' })
    expect(lastLines(sequence.container)[0]).toBe('LAST 70 × 10 @ 1')
    sequence.unmount()
    expect(lastLines(card(sessions).container)[0]).toBe('LAST 50 × 10 @ 1')
  })

  it('while the reference loads, the current row and the rows after it say LOADING LAST TIME… (board W3b) and show no numbers', () => {
    const { container } = card([session('lw', DAY.lastWeekWed, [60, 62.5, 65])], { referenceLoading: true })
    expect(lastLines(container)).toEqual([null, null, null])
    const texts = Array.from(container.querySelectorAll('[data-row-key]')).map((row) => row.textContent ?? '')
    expect(texts.map((t) => t.includes('LOADING LAST TIME…'))).toEqual([true, true, true])
  })

  it('when the reference could not be read, the current row says COULDN\'T LOAD LAST WEEK with a RETRY that asks again (board W2); no stale numbers, and no failed line on the rows after it', () => {
    const onRetryReference = vi.fn()
    const { container } = card([session('lw', DAY.lastWeekWed, [60, 62.5, 65])], { referenceIsError: true, onRetryReference })
    expect(lastLines(container)).toEqual([null, null, null])
    const failed = Array.from(container.querySelectorAll('[data-row-key]')).map((row) => (row.textContent ?? '').includes('COULDN\'T LOAD LAST WEEK'))
    expect(failed).toEqual([true, false, false])
    fireEvent.click(within(current(container)).getByText('RETRY'))
    expect(onRetryReference).toHaveBeenCalledTimes(1)
  })
})
