// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { cleanup, fireEvent, screen, within, act } from '@testing-library/react'
import type { SessionSetChange, SetLog } from '../../types'
import { exerciseOf, headLogOf, logOf, plannedDrop, plannedSet, renderCard, rowLabels, rowStates } from './cardHarness.testutil'
import { captureRender } from '../../testing/captureRender'
import { spyWriters } from './setWriters.testutil'
import type { LogRequest } from './useExerciseCardState'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { useToastStore } from '../notifications/toastStore'
import { changeRow } from './sessionSetChangesService'
import type { ChangeWrite, HeldChange } from './workoutRules'

// Chunk 62 — SET TYPE at the card (TASKS-1.2 62; SPEC [1.2] "Set type during a workout (19), (19c)", "Offline (G47)"; boards W7a, W7, W2b; DECISIONS 141, 146 (a),
// 150, 152 (a), 161, 167 (a), 168 (a), 173). The card is drawn through `useWorkoutRows` as GymSession draws it (cardHarness.testutil.tsx) and the type picker is the
// real one; `writers` are the log patch, the change rows, the renumber and the queued rows, each a spy that records the order, so what is asserted is what the screen
// sends. The session's answer is played back with `setLogs` / `setChanges`, so a type is read on the screen after the writes, not only in them (RULES: "A write path's
// output is proven through the reader that draws it"). The same flows against the real producers and a fake server: useSyncQueue.setType.test.tsx.

const net = vi.hoisted(() => ({ online: true }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => net.online }))

afterEach(() => {
  cleanup()
  useToastStore.getState().clear()
})
beforeEach(() => {
  net.online = true
  useSettingsStore.setState({ ...DEFAULT_SETTINGS })
})

const rowOf = (c: HTMLElement, key: string) => c.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const held = (change: SessionSetChange, id: string): HeldChange => ({ ...change, id })
const dropLog = (n: number, index: number, over: Partial<SetLog> = {}): SetLog =>
  logOf({ id: `d${n}${index === 1 ? '' : `-${index}`}`, parentSetId: `log-${n}`, stageIndex: index, setNumber: n, isDropset: true, weekPlanSetId: `set-${n}-drop-${index}`, ...over })
const press = (el: Element) =>
  act(async () => {
    fireEvent.click(el)
    for (let i = 0; i < 16; i++) await Promise.resolve()
  })
const dialog = () => screen.getByRole('dialog')
const alertDialog = () => screen.getByRole('alertdialog')

/** The ⋯ of an open row, then its SET TYPE row: the sheet gives way to the picker. */
function openFromSheet(c: HTMLElement, key: string) {
  fireEvent.click(within(rowOf(c, key)).getByLabelText('Set options'))
  fireEvent.click(within(dialog()).getByText('SET TYPE'))
}
/** The pen of a logged row, then the SET TYPE row of its edit panel. */
function openFromPanel(c: HTMLElement, key: string) {
  fireEvent.click(within(rowOf(c, key)).getByLabelText('Edit set'))
  fireEvent.click(within(rowOf(c, key)).getByText('SET TYPE'))
}
/** A row of the picker: its name. */
const pick = (name: string) => press(within(dialog()).getByText(name))
const step = (label: 'More drops' | 'Fewer drops') => press(within(dialog()).getByLabelText(label))

/** The recorder: every write the card makes, in the order it made it. */
function recorder(over: Parameters<typeof spyWriters>[0] = {}) {
  const order: string[] = []
  const writers = spyWriters({
    ...over,
    patchLog: vi.fn(async (id: string, changes: unknown) => void order.push(`log ${id} ${JSON.stringify(changes)}`)),
    writeChanges: vi.fn(async (writes: readonly ChangeWrite[]) => void order.push(`changes ${JSON.stringify(writes)}`)),
    patchNumbers: vi.fn(async (patches: readonly unknown[]) => void order.push(`numbers ${JSON.stringify(patches)}`)),
    queueChanges: vi.fn(async (writes: readonly ChangeWrite[]) => void order.push(`queued ${JSON.stringify(writes)}`)),
  })
  const onDeleteSet = vi.fn(async (id: string) => void order.push(`delete ${id}`))
  return { order, writers, onDeleteSet }
}
const retyped = (n: number, type: Extract<SessionSetChange, { kind: 'retyped' }>['type']): SessionSetChange => ({ kind: 'retyped', weekPlanSetId: `set-${n}`, type })
const staged = (stageCount: number, stageKind: 'dropset' | 'rest_pause' = 'dropset') => ({ kind: 'staged' as const, stageKind, stageCount })
const rowOfChange = (write: ChangeWrite) => changeRow(write, { userId: 'u1', sessionId: 'session-1', now: '2026-01-05T10:00:00Z' })

describe('an upcoming planned set: its ⋯ → SET TYPE writes a `retyped` row keyed by the planned set, and nothing on the plan (W7 → W7a)', () => {
  const plan = () => [plannedSet(1), plannedSet(2), plannedSet(3)]

  it('Dropset: one retyped row with the picker\'s first drop; no log patch, no number (the picker opens on the set\'s own type, Normal)', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], props: { writers, onDeleteSet } })
    openFromSheet(container, 'set:set-2')
    expect(within(dialog()).getByText('What is this set?')).toBeTruthy()
    expect(dialog().textContent).toContain('Bench Press · SET 02 · THIS WORKOUT') // (the sheet draws its eyebrow in capitals)
    expect(within(dialog()).getByText('Normal').closest('button')!.getAttribute('aria-pressed')).toBe('true')
    await pick('Dropset')
    expect(order).toEqual([`changes ${JSON.stringify([{ change: retyped(2, staged(1)), id: null }])}`])
    expect(writers.patchLog).not.toHaveBeenCalled()
    expect(writers.patchNumbers).not.toHaveBeenCalled()
    expect(writers.queueChanges).not.toHaveBeenCalled()
    expect(onDeleteSet).not.toHaveBeenCalled()
  })

  it('the row that is written is a `retyped` row with the dropset and its count, never a warmup beside a stage kind, never a kind with a count of 0 (042\'s checks; the union cannot build either)', async () => {
    const { writers } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], props: { writers } })
    openFromSheet(container, 'set:set-2')
    await pick('Dropset')
    const row = rowOfChange((writers.writeChanges.mock.calls[0][0] as ChangeWrite[])[0])
    expect(row).toMatchObject({ kind: 'retyped', week_plan_set_id: 'set-2', set_log_id: null, is_warmup: false, stage_kind: 'dropset', stage_count: 1 })
    expect((row.stage_kind !== null) === ((row.stage_count as number) > 0)).toBe(true)
    expect(row.is_warmup === true && row.stage_kind !== null).toBe(false)
  })

  it('what the screen draws once the row is held: the set is a dropset with one open drop under it, and the stepper writes the new count over the held row (its id)', async () => {
    const { order, writers } = recorder()
    const { container, setChanges } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], props: { writers } })
    openFromSheet(container, 'set:set-2')
    await pick('Dropset')
    setChanges([held(retyped(2, staged(1)), 'chg-1')])
    expect(rowLabels(container)).toEqual(['01', '02', '↳', '03'])
    expect(within(dialog()).getByText('Dropset').closest('button')!.getAttribute('aria-pressed')).toBe('true') // the picker shows what is true now
    await step('More drops')
    expect(order[1]).toBe(`changes ${JSON.stringify([{ change: retyped(2, staged(2)), id: 'chg-1' }])}`)
    setChanges([held(retyped(2, staged(2)), 'chg-1')])
    expect(rowLabels(container)).toEqual(['01', '02', '↳', '↳', '03'])
  })

  it('Warmup on a planned dropset writes `retyped` with the warmup flag and no stage kind, and the planned drops vanish', async () => {
    const { order, writers } = recorder()
    const planned = [plannedSet(1), plannedSet(2, { stageKind: 'dropset' }), plannedDrop(2, 1), plannedDrop(2, 2)]
    const { container, setChanges } = renderCard({ plannedSets: planned, logs: [], props: { writers } })
    expect(rowLabels(container)).toEqual(['01', '02', '↳', '↳'])
    openFromSheet(container, 'set:set-2')
    await pick('Warmup')
    expect(order).toEqual([`changes ${JSON.stringify([{ change: retyped(2, { kind: 'warmup' }), id: null }])}`])
    expect(rowOfChange((writers.writeChanges.mock.calls[0][0] as ChangeWrite[])[0])).toMatchObject({ kind: 'retyped', is_warmup: true, stage_kind: null, stage_count: 0 })
    setChanges([held(retyped(2, { kind: 'warmup' }), 'chg-1')])
    expect(rowLabels(container)).toEqual(['W', '01']) // the warmup is drawn first, and the working set after it is 01
  })

  it('Normal on a planned dropset writes the Normal row and the planned drops vanish; the plan is never written', async () => {
    const { order, writers } = recorder()
    const planned = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)]
    const { container, setChanges } = renderCard({ plannedSets: planned, props: { writers } })
    openFromSheet(container, 'set:set-1')
    await pick('Normal')
    expect(order).toEqual([`changes ${JSON.stringify([{ change: retyped(1, { kind: 'normal' }), id: null }])}`])
    setChanges([held(retyped(1, { kind: 'normal' }), 'chg-1')])
    expect(rowLabels(container)).toEqual(['01'])
  })

  it('Warmup on an open set with a logged set after it renumbers that set in the same change, as a delete does (146 (a), 173): the row, then the patch', async () => {
    const { order, writers } = recorder()
    // 01 open, 02 logged (stored 2), 03 logged (stored 3): 01 becomes a warmup, so 02 is 01 and 03 is 02
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(2), headLogOf(3)], props: { writers } })
    openFromSheet(container, 'set:set-1')
    await pick('Warmup')
    expect(order).toEqual([
      `changes ${JSON.stringify([{ change: retyped(1, { kind: 'warmup' }), id: null }])}`,
      `numbers ${JSON.stringify([{ id: 'log-2', setNumber: 1 }, { id: 'log-3', setNumber: 2 }])}`,
    ])
  })

  it('a pick that is refused says why in a toast, writes nothing after it, and the picker keeps showing what is true', async () => {
    const { order, writers } = recorder()
    writers.writeChanges.mockRejectedValue({ message: 'permission denied for table v2_session_set_changes' })
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(2), headLogOf(3)], props: { writers } })
    openFromSheet(container, 'set:set-1')
    await pick('Warmup')
    expect(useToastStore.getState().message).toBe("Couldn't change the set type. permission denied for table v2_session_set_changes")
    expect(writers.patchNumbers).not.toHaveBeenCalled() // the first refusal stops the rest
    expect(order).toEqual([])
    expect(within(dialog()).getByText('Normal').closest('button')!.getAttribute('aria-pressed')).toBe('true')
  })

  it('works offline (168 (a)): the same row and the same renumber are asked of the writers, which queue them', async () => {
    net.online = false
    const { order, writers } = recorder({ online: false })
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(2), headLogOf(3)], props: { writers } })
    openFromSheet(container, 'set:set-1')
    await pick('Warmup')
    expect(order).toHaveLength(2)
    expect(order[0]).toContain('"kind":"retyped"')
    expect(order[1]).toBe(`numbers ${JSON.stringify([{ id: 'log-2', setNumber: 1 }, { id: 'log-3', setNumber: 2 }])}`)
    expect(useToastStore.getState().message).toBeNull()
  })

  it('a drop has no SET TYPE row and a skipped set none (a drop follows its head; a settled set has no type to change)', () => {
    const planned = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedSet(2)]
    const { container } = renderCard({ plannedSets: planned, logs: [headLogOf(1, { stageKind: 'dropset' }), headLogOf(2, { isSkipped: true, weight: null, reps: null })] })
    fireEvent.click(within(rowOf(container, 'set:set-1:stage:1')).getByLabelText('Set options'))
    expect(within(dialog()).getByText('DELETE SET')).toBeTruthy() // the drop's sheet (W8): form, the lbs row and DELETE SET only
    expect(within(dialog()).queryByText('SET TYPE')).toBeNull()
    cleanup()
    const skipped = renderCard({ plannedSets: planned, logs: [headLogOf(1, { stageKind: 'dropset' }), headLogOf(2, { isSkipped: true, weight: null, reps: null })] })
    fireEvent.click(within(rowOf(skipped.container, 'set:set-2')).getByLabelText('Set options'))
    expect(within(dialog()).queryByText('SET TYPE')).toBeNull()
  })

  // Chunk 78 (SPEC 1.2.1 [13], DECISIONS 228 (a)): the open warmup's ⋯ is a second way into this same picker and writer; before it, a set made a Warmup by mistake could not be
  // made Normal again until it was logged.
  it('an open warmup\'s ⋯ → SET TYPE opens the picker on Warmup, and Normal writes the same `retyped` row any open set\'s pick writes: the former warmup is then working set 01 (break: the ⋯ opens nothing)', async () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'rows' })
    const { order, writers } = recorder()
    const { container, setChanges } = renderCard({ plannedSets: [plannedSet(1, { isWarmup: true }), plannedSet(2)], props: { writers } })
    expect(rowLabels(container)).toEqual(['W', '01'])
    openFromSheet(container, 'set:set-1')
    expect(within(dialog()).getByText('Warmup').closest('button')!.getAttribute('aria-pressed')).toBe('true') // the picker opens on the set\'s own type
    await pick('Normal')
    expect(order).toEqual([`changes ${JSON.stringify([{ change: retyped(1, { kind: 'normal' }), id: null }])}`])
    expect(writers.patchLog).not.toHaveBeenCalled() // an open set has no log to patch
    expect(writers.patchNumbers).not.toHaveBeenCalled() // and no logged set after it to renumber
    setChanges([held(retyped(1, { kind: 'normal' }), 'chg-1')])
    expect(rowLabels(container)).toEqual(['01', '02']) // the warmup is working set 01 now, and the other follows it
  })
})

describe('an added set that is not logged: its type is the card\'s own state, and LOG writes it with its log and a `pending_stages` row (DECISIONS 161)', () => {
  it('Dropset on a set made with + ADD SET writes nothing, draws the drop, and LOG writes the head as a dropset and queues the row keyed by the new log (count 1)', async () => {
    const { order, writers } = recorder()
    const calls: LogRequest[] = []
    const onLog = vi.fn(async (params: LogRequest) => {
      calls.push(params)
      order.push(`log ${params.id}`)
      return logOf({ id: params.id as string })
    })
    const { container } = renderCard({ plannedSets: [], props: { writers, onLog } })
    fireEvent.click(screen.getByText('ADD SET'))
    const key = container.querySelector('[data-row-key]')!.getAttribute('data-row-key')!
    openFromSheet(container, key)
    await pick('Dropset')
    expect(order).toEqual([]) // nothing is sent for an open added set
    expect(rowLabels(container)).toEqual(['01', '↳'])
    fireEvent.change(within(rowOf(container, key)).getByLabelText('Weight'), { target: { value: '50' } })
    fireEvent.change(within(rowOf(container, key)).getByLabelText('Reps'), { target: { value: '9' } })
    await press(within(rowOf(container, key)).getByText('LOG'))
    expect(calls[0]).toMatchObject({ stageKind: 'dropset', weekPlanSetId: null, setNumber: 1, addedPlace: 1 })
    const id = calls[0].id as string
    expect(order).toEqual([`log ${id}`, `queued ${JSON.stringify([{ change: { kind: 'pending_stages', setLogId: id, stageKind: 'dropset', stageCount: 1 }, id: null }])}`])
    expect(rowOfChange((writers.queueChanges.mock.calls[0][0] as ChangeWrite[])[0])).toMatchObject({ kind: 'pending_stages', set_log_id: id, week_plan_set_id: null, stage_kind: 'dropset', stage_count: 1 })
  })

  it('a Normal added set logs with no row, and a skipped staged one (its drops are dead) none either', async () => {
    const { writers } = recorder()
    const onLog = vi.fn(async (params: LogRequest) => logOf({ id: params.id as string }))
    const { container } = renderCard({ plannedSets: [], props: { writers, onLog } })
    fireEvent.click(screen.getByText('ADD SET'))
    const key = container.querySelector('[data-row-key]')!.getAttribute('data-row-key')!
    fireEvent.change(within(rowOf(container, key)).getByLabelText('Weight'), { target: { value: '50' } })
    fireEvent.change(within(rowOf(container, key)).getByLabelText('Reps'), { target: { value: '9' } })
    await press(within(rowOf(container, key)).getByText('LOG'))
    expect(writers.queueChanges).not.toHaveBeenCalled()
  })

  it('Warmup on an open added set is a warmup row (no number written; the logged sets after it renumber)', async () => {
    const { order, writers } = recorder()
    const { container } = renderCard({ plannedSets: [], logs: [logOf({ id: 'a1', setNumber: 1, addedPlace: 1 })], props: { writers } })
    fireEvent.click(screen.getByText('ADD SET'))
    const key = container.querySelectorAll('[data-row-key]')[1].getAttribute('data-row-key')!
    openFromSheet(container, key)
    await pick('Warmup')
    expect(rowLabels(container)).toEqual(['W', '01']) // (the card draws its warmups first)
    expect(writers.writeChanges).not.toHaveBeenCalled()
    expect(order).toEqual([]) // the added set was after the logged one: no number moves
  })
})

describe('what the screen draws while a change is on its way: the rows are held from the first request until they are in the session (a read between two requests never draws a half-written type)', () => {
  const deferred = () => {
    let resolve: () => void = () => {}
    const promise = new Promise<void>((r) => (resolve = r))
    return { promise, resolve }
  }
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })

  it('Dropset on a logged set: the log is patched (the screen\'s copy has its kind) and the rows are not written yet, and the drop is already drawn', async () => {
    const { writers } = recorder()
    const rows = deferred()
    writers.writeChanges.mockImplementation(() => rows.promise)
    const { container, setLogs, setChanges } = renderCard({ plannedSets: [plannedSet(1), plannedSet(2)], logs: [headLogOf(1), headLogOf(2)], props: { writers } })
    writers.patchLog.mockImplementation(async () => setLogs([headLogOf(1), headLogOf(2, { stageKind: 'dropset' })]))
    openFromPanel(container, 'set:set-2')
    fireEvent.click(within(dialog()).getByText('Dropset'))
    await flush()
    expect(writers.patchLog).toHaveBeenCalledTimes(1)
    expect(rowLabels(container)).toEqual(['01', '02', '↳']) // held: without it the set reads as Normal until its rows land
    rows.resolve()
    await flush()
    setChanges([held(retyped(2, staged(1)), 'chg-1'), held({ kind: 'pending_stages', setLogId: 'log-2', stageKind: 'dropset', stageCount: 1 }, 'chg-2')])
    expect(rowLabels(container)).toEqual(['01', '02', '↳'])
  })

  it('LOG of a set added as a dropset: its drop is drawn from the LOG on, while its `pending_stages` row is still on its way', async () => {
    const { writers } = recorder()
    const queued = deferred()
    writers.queueChanges.mockImplementation(() => queued.promise)
    let id = ''
    const onLog = vi.fn(async (params: LogRequest) => {
      id = params.id as string
      return logOf({ id })
    })
    const { container, setLogs } = renderCard({ plannedSets: [], props: { writers, onLog } })
    fireEvent.click(screen.getByText('ADD SET'))
    const key = container.querySelector('[data-row-key]')!.getAttribute('data-row-key')!
    openFromSheet(container, key)
    await pick('Dropset')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(within(rowOf(container, key)).getByLabelText('Weight'), { target: { value: '50' } })
    fireEvent.change(within(rowOf(container, key)).getByLabelText('Reps'), { target: { value: '9' } })
    fireEvent.click(within(rowOf(container, key)).getByText('LOG'))
    await flush()
    expect(writers.queueChanges).toHaveBeenCalledTimes(1)
    setLogs([logOf({ id, stageKind: 'dropset', setNumber: 1, addedPlace: 1 })]) // the screen's optimistic copy of the new log
    expect(rowLabels(container)).toEqual(['01', '↳']) // held: without it the logged head reads as a normal set
    queued.resolve()
    await flush()
  })
})

describe('LOG of an upcoming set whose type was changed writes the type it has now, not the plan\'s (SPEC Objects stored: "set kind and stage kind as done")', () => {
  const typeAndLog = async (container: HTMLElement, key: string) => {
    fireEvent.change(within(rowOf(container, key)).getByLabelText('Weight'), { target: { value: '50' } })
    fireEvent.change(within(rowOf(container, key)).getByLabelText('Reps'), { target: { value: '9' } })
    await press(within(rowOf(container, key)).getByText('LOG'))
  }
  const logging = () => {
    const calls: LogRequest[] = []
    const onLog = vi.fn(async (params: LogRequest) => {
      calls.push(params)
      return logOf({ id: 'x' })
    })
    return { calls, onLog }
  }

  it('a plain planned set retyped Dropset logs `stage_kind` dropset (the plan\'s is null) and queues no row: the retyped row already holds the count', async () => {
    const { calls, onLog } = logging()
    const { writers } = recorder()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], changes: [held(retyped(1, staged(2)), 'chg-1')], props: { onLog, writers } })
    await typeAndLog(container, 'set:set-1')
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'set-1', stageKind: 'dropset' })
    expect(writers.queueChanges).not.toHaveBeenCalled()
  })

  it('a planned dropset retyped Normal logs null (the plan\'s is dropset); retyped Rest-pause logs rest_pause', async () => {
    const { calls, onLog } = logging()
    const { container } = renderCard({ plannedSets: [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)], changes: [held(retyped(1, { kind: 'normal' }), 'chg-1')], props: { onLog } })
    await typeAndLog(container, 'set:set-1')
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'set-1', stageKind: null })
    cleanup()
    const again = logging()
    const second = renderCard({ plannedSets: [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)], changes: [held(retyped(1, staged(1, 'rest_pause')), 'chg-1')], props: { onLog: again.onLog } })
    await typeAndLog(second.container, 'set:set-1')
    expect(again.calls[0]).toMatchObject({ stageKind: 'rest_pause' })
  })

  it('a planned set no one retyped still logs the plan\'s kind (a kindless planned dropset logs null, as before the chunk)', async () => {
    const { calls, onLog } = logging()
    const { container } = renderCard({ plannedSets: [plannedSet(1), plannedSet(2, { stageKind: null }), plannedDrop(2, 1)], logs: [headLogOf(1)], props: { onLog } })
    await typeAndLog(container, 'set:set-2')
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'set-2', stageKind: null })
  })

  it('a planned set retyped Warmup is a warmup row and logs as one, naming its planned set', async () => {
    const { calls, onLog } = logging()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], changes: [held(retyped(1, { kind: 'warmup' }), 'chg-1')], props: { onLog } })
    expect(rowLabels(container)).toEqual(['W'])
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Weight'), { target: { value: '20' } })
    await press(within(rowOf(container, 'set:set-1')).getByText('LOG'))
    expect(calls[0]).toMatchObject({ weekPlanSetId: 'set-1', isWarmup: true, stageKind: null })
  })
})

describe('a logged set: the pen → SET TYPE patches its log, then the rows, then the numbers; online only (G47)', () => {
  const plan = () => [plannedSet(1), plannedSet(2), plannedSet(3)]

  it('Dropset on a logged Normal set: the log\'s stage kind, then the `retyped` and `pending_stages` rows with the one drop; that drop is then the current set', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const { container, setLogs, setChanges } = renderCard({ plannedSets: plan(), logs: [headLogOf(1), headLogOf(2)], props: { writers, onDeleteSet } })
    expect(rowStates(container)).toEqual(['logged', 'logged', 'current'])
    openFromPanel(container, 'set:set-2')
    await pick('Dropset')
    expect(order).toEqual([
      `log log-2 ${JSON.stringify({ isWarmup: false, stageKind: 'dropset' })}`,
      `changes ${JSON.stringify([
        { change: retyped(2, staged(1)), id: null },
        { change: { kind: 'pending_stages', setLogId: 'log-2', stageKind: 'dropset', stageCount: 1 }, id: null },
      ])}`,
    ])
    expect(onDeleteSet).not.toHaveBeenCalled()
    expect(writers.patchNumbers).not.toHaveBeenCalled()
    // the session's answer, played back from what the card wrote: the log patched, the rows it sent held (so a row the card did not send is not drawn)
    setLogs([headLogOf(1), headLogOf(2, { stageKind: 'dropset' })])
    const written = (writers.writeChanges.mock.calls as Array<[ChangeWrite[]]>).flatMap(([writes]) => writes)
    setChanges(written.map((write, i) => held(write.change, `chg-${i + 1}`)))
    expect(rowLabels(container)).toEqual(['01', '02', '↳', '03'])
    // (the head's edit panel is still open under the picker: its row has no state of a logged row)
    expect(rowStates(container)).toEqual(['logged', undefined, 'current', 'upcoming'])
    expect(within(rowOf(container, 'set:set-2')).getByText('Dropset · 1 drop')).toBeTruthy()
  })

  it('Dropset on a logged ADDED set: its drop is drawn from the `pending_stages` row alone (no planned set, so no `retyped` row), read back from what the card wrote', async () => {
    const { writers } = recorder()
    const added = logOf({ id: 'added-1', setNumber: 1, addedPlace: 1 })
    const { container, setLogs, setChanges } = renderCard({ plannedSets: [], logs: [added], props: { writers } })
    openFromPanel(container, container.querySelector('[data-row-key]')!.getAttribute('data-row-key')!)
    await pick('Dropset')
    setLogs([{ ...added, stageKind: 'dropset' }])
    const written = (writers.writeChanges.mock.calls as Array<[ChangeWrite[]]>).flatMap(([writes]) => writes)
    setChanges(written.map((write, i) => held(write.change, `chg-${i + 1}`)))
    expect(rowLabels(container)).toEqual(['01', '↳'])
  })

  it('the new drop is the current set unless an earlier set is still unlogged: then it follows the lock (SPEC 19)', async () => {
    const { writers } = recorder()
    // 01 is open, 02 is logged and becomes a dropset: the current set stays 01, and the drop waits
    const { container, setLogs, setChanges } = renderCard({ plannedSets: plan(), logs: [headLogOf(2)], props: { writers } })
    openFromPanel(container, 'set:set-2')
    await pick('Dropset')
    setLogs([headLogOf(2, { stageKind: 'dropset' })])
    setChanges([held(retyped(2, staged(1)), 'chg-1'), held({ kind: 'pending_stages', setLogId: 'log-2', stageKind: 'dropset', stageCount: 1 }, 'chg-2')])
    expect(rowLabels(container)).toEqual(['01', '02', '↳', '03'])
    expect(rowStates(container)).toEqual(['current', undefined, 'upcoming', 'upcoming'])
  })

  it('the pending drops are keyed by the LOG (042: `pending_stages` names a log, `retyped` a planned set), for an added set too (no `retyped` row at all)', async () => {
    const { writers } = recorder()
    const { container } = renderCard({ plannedSets: [], logs: [logOf({ id: 'added-1', setNumber: 1, addedPlace: 1 })], props: { writers } })
    openFromPanel(container, container.querySelector('[data-row-key]')!.getAttribute('data-row-key')!)
    await pick('Rest-pause')
    const writes = writers.writeChanges.mock.calls[0][0] as ChangeWrite[]
    expect(writes.map((w) => w.change.kind)).toEqual(['pending_stages'])
    expect(rowOfChange(writes[0])).toMatchObject({ kind: 'pending_stages', set_log_id: 'added-1', week_plan_set_id: null, stage_kind: 'rest_pause', stage_count: 1 })
    expect(writers.patchLog).toHaveBeenCalledWith('added-1', { isWarmup: false, stageKind: 'rest_pause' })
  })

  it('Normal on a dropset with a logged drop asks first (19c), writes nothing on CANCEL, and on the answer patches the log, deletes the drop, writes the Normal row', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const planned = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedSet(2)]
    const { container } = renderCard({ plannedSets: planned, logs: [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1)], props: { writers, onDeleteSet } })
    openFromPanel(container, 'set:set-1')
    await pick('Normal')
    const ask = alertDialog()
    expect(within(ask).getByText('Delete the 1 logged drop?')).toBeTruthy()
    expect(ask.textContent).toContain("Only today's session changes; the plan stays the same.")
    expect(order).toEqual([]) // nothing is written before the answer
    fireEvent.click(within(ask).getByText('CANCEL'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(order).toEqual([])
    expect(within(dialog()).getByText('Dropset').closest('button')!.getAttribute('aria-pressed')).toBe('true') // the picker shows the old type
    await pick('Normal')
    await press(within(alertDialog()).getByText('DELETE DROP'))
    expect(order).toEqual([
      `log log-1 ${JSON.stringify({ isWarmup: false, stageKind: null })}`,
      'delete d1',
      `changes ${JSON.stringify([{ change: retyped(1, { kind: 'normal' }), id: null }])}`,
    ])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('the stepper below the logged drops asks too (167 (a)): 2 drops, both logged, down to 1 deletes the last one after the answer', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const planned = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedDrop(1, 2)]
    const logs = [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1), dropLog(1, 2)]
    const { container } = renderCard({ plannedSets: planned, logs, props: { writers, onDeleteSet } })
    openFromPanel(container, 'set:set-1')
    await step('Fewer drops')
    expect(within(alertDialog()).getByText('Delete the 1 logged drop?')).toBeTruthy()
    expect(order).toEqual([])
    await press(within(alertDialog()).getByText('DELETE DROP'))
    expect(order).toEqual([
      `log log-1 ${JSON.stringify({ isWarmup: false, stageKind: 'dropset' })}`,
      'delete d1-2',
      `changes ${JSON.stringify([
        { change: retyped(1, staged(1)), id: null },
        { change: { kind: 'pending_stages', setLogId: 'log-1', stageKind: 'dropset', stageCount: 1 }, id: null },
      ])}`,
    ])
  })

  it('more drops than are logged asks nothing: the extra ones are open rows (the stepper going up deletes nothing)', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const planned = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)]
    const { container } = renderCard({ plannedSets: planned, logs: [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1)], props: { writers, onDeleteSet } })
    openFromPanel(container, 'set:set-1')
    await step('More drops')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onDeleteSet).not.toHaveBeenCalled()
    expect(order[1]).toContain('"stageCount":2')
  })

  it('the question\'s answer that fails says why inside the dialog and can be answered again', async () => {
    const { writers, onDeleteSet } = recorder()
    writers.patchLog.mockRejectedValueOnce({ message: 'permission denied' })
    const planned = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)]
    const { container } = renderCard({ plannedSets: planned, logs: [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1)], props: { writers, onDeleteSet } })
    openFromPanel(container, 'set:set-1')
    await pick('Normal')
    await press(within(alertDialog()).getByText('DELETE DROP'))
    expect(within(alertDialog()).getByRole('alert').textContent).toContain("Couldn't change the set type.")
    expect(within(alertDialog()).getByRole('alert').textContent).toContain('permission denied')
    expect(onDeleteSet).not.toHaveBeenCalled() // the drop is deleted only after the log patch went through
    await press(within(alertDialog()).getByText('DELETE DROP'))
    expect(onDeleteSet).toHaveBeenCalledWith('d1')
  })

  it('Warmup on the logged 02 of 01–03 patches the log, writes the row, then the logged 03 to 2 and 02\'s own log to its warmup number (146 (a), 173)', async () => {
    const { order, writers } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1), headLogOf(2), headLogOf(3)], props: { writers } })
    openFromPanel(container, 'set:set-2')
    await pick('Warmup')
    expect(order).toEqual([
      `log log-2 ${JSON.stringify({ isWarmup: true, stageKind: null })}`,
      `changes ${JSON.stringify([{ change: retyped(2, { kind: 'warmup' }), id: null }])}`,
      `numbers ${JSON.stringify([{ id: 'log-2', setNumber: 1 }, { id: 'log-3', setNumber: 2 }])}`,
    ])
  })

  it('offline the SET TYPE row of a logged set is off and the panel says "Requires a connection"; nothing is asked of any writer', async () => {
    net.online = false
    const { order, writers } = recorder({ online: false })
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], props: { writers } })
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByLabelText('Edit set'))
    const row = within(rowOf(container, 'set:set-1')).getByText('SET TYPE').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(true)
    expect(within(rowOf(container, 'set:set-1')).getByText('Requires a connection')).toBeTruthy()
    fireEvent.click(row)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(order).toEqual([])
  })

  it('a change that is asked of the card with no connection is refused with that reason before any request (the panel closed under it, or the phone went offline)', async () => {
    const { order, writers } = recorder({ online: false })
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], props: { writers } })
    openFromPanel(container, 'set:set-1') // the panel was enabled while the phone was online
    await pick('Warmup')
    expect(useToastStore.getState().message).toBe("Couldn't change the set type. Requires a connection")
    expect(order).toEqual([])
  })
})

describe('a warmup logged with no weight or reps made a working set (DECISIONS 152 (a)): the panel asks for both first; the type and the numbers are one write', () => {
  const numberless = () => headLogOf(1, { isWarmup: true, weight: null, reps: null })
  const plan = () => [plannedSet(1, { isWarmup: true })]

  it('the pick is held: nothing is written, the row shows it, and SAVE with a box empty says "Enter weight and reps." and sends nothing', async () => {
    const { order, writers } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [numberless()], props: { writers } })
    openFromPanel(container, 'set:set-1')
    await pick('Normal')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(order).toEqual([])
    expect(within(rowOf(container, 'set:set-1')).getByText('Normal')).toBeTruthy() // the SET TYPE row shows the held pick
    await press(within(rowOf(container, 'set:set-1')).getByText('SAVE'))
    expect(within(rowOf(container, 'set:set-1')).getByRole('alert').textContent).toBe('Enter weight and reps.')
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Weight'), { target: { value: '40' } })
    await press(within(rowOf(container, 'set:set-1')).getByText('SAVE'))
    expect(within(rowOf(container, 'set:set-1')).getByRole('alert').textContent).toBe('Enter weight and reps.')
    expect(order).toEqual([])
  })

  it('SAVE with both typed is ONE log patch holding the type and the weight and reps (the type alone is refused by the table: 23514)', async () => {
    const { order, writers } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [numberless()], props: { writers } })
    openFromPanel(container, 'set:set-1')
    await pick('Normal')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Weight'), { target: { value: '40' } })
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Reps'), { target: { value: '6' } })
    await press(within(rowOf(container, 'set:set-1')).getByText('SAVE'))
    expect(order[0]).toBe(`log log-1 ${JSON.stringify({ isWarmup: false, stageKind: null, weight: 40, reps: 6 })}`)
    expect(writers.patchLog).toHaveBeenCalledTimes(1)
    // a planned set: its `retyped` Normal row follows (141), and the logged sets after it move (146 (a)): there are none here
    expect(order[1]).toBe(`changes ${JSON.stringify([{ change: retyped(1, { kind: 'normal' }), id: null }])}`)
  })

  it('Dropset for it is the same: held, then one patch with the kind and both numbers, the rows after', async () => {
    const { order, writers } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [numberless()], props: { writers } })
    openFromPanel(container, 'set:set-1')
    await pick('Dropset')
    await step('More drops')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(order).toEqual([])
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Weight'), { target: { value: '30' } })
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Reps'), { target: { value: '10' } })
    await press(within(rowOf(container, 'set:set-1')).getByText('SAVE'))
    expect(order[0]).toBe(`log log-1 ${JSON.stringify({ isWarmup: false, stageKind: 'dropset', weight: 30, reps: 10 })}`)
    expect(order[1]).toContain('"stageCount":2')
  })

  it('a weight typed in lbs is stored in kg', async () => {
    const { order, writers } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [numberless()], props: { writers, programExercise: exerciseOf({ weightUnit: 'lbs' }) } })
    openFromPanel(container, 'set:set-1')
    await pick('Normal')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Weight'), { target: { value: '45' } })
    fireEvent.change(within(rowOf(container, 'set:set-1')).getByLabelText('Reps'), { target: { value: '6' } })
    await press(within(rowOf(container, 'set:set-1')).getByText('SAVE'))
    const patch = JSON.parse(order[0].slice('log log-1 '.length)) as { weight: number }
    expect(patch.weight).toBeCloseTo(20.41, 2) // 45 lbs
  })

  it('CANCEL throws the held pick away: the next time the panel opens the row says Warmup and nothing was written', async () => {
    const { order, writers } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [numberless()], props: { writers } })
    openFromPanel(container, 'set:set-1')
    await pick('Normal')
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByText('CANCEL'))
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByLabelText('Edit set'))
    expect(within(rowOf(container, 'set:set-1')).getByText('Warmup')).toBeTruthy()
    expect(order).toEqual([])
  })

  it('a warmup that HAS both numbers is changed at once, like any logged set (nothing to ask for)', async () => {
    const { order, writers } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1, { isWarmup: true })], props: { writers } })
    openFromPanel(container, 'set:set-1')
    await pick('Normal')
    expect(order[0]).toBe(`log log-1 ${JSON.stringify({ isWarmup: false, stageKind: null })}`)
  })
})

// The boards' pictures (`CAPTURE_RENDER=1 npx vitest run src/features/gym/ExerciseCard.setType.test.tsx` writes the two fixtures for `npm run shot`: W7a as the workout
// opens it, and the question 19c asks, which no board draws). They are written after the assertions, so a sheet that lost a part fails here and leaves the committed
// fixture alone.
describe('the pictures: W7a as the workout opens it, and the question 19c asks', () => {
  const lat = () => {
    const base = exerciseOf()
    return exerciseOf({ exercise: { ...base.exercise!, name: 'Lat Pulldown' } })
  }

  it('W7a: the ⋯ of set 03, a planned dropset with one drop, → SET TYPE: "What is this set?", the six types, Dropset picked with DROPS 1, and the note', () => {
    const planned = [plannedSet(1), plannedSet(2), plannedSet(3, { stageKind: 'dropset' }), plannedDrop(3, 1)]
    const { container } = renderCard({ plannedSets: planned, logs: [headLogOf(1), headLogOf(2)], props: { programExercise: lat() } })
    openFromSheet(container, 'set:set-3')
    const sheet = dialog()
    const text = sheet.textContent ?? ''
    const order = ['Lat Pulldown · SET 03 · THIS WORKOUT', 'What is this set?', 'Normal', 'Warmup', 'Dropset', 'DROPS', 'Rest-pause', 'Myo-reps', 'Cluster', "Changes this workout only. Next week's plan stays as it is; the change shows up in REVIEW when you plan it."]
    const at = order.map((word) => text.indexOf(word))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(within(sheet).getByText('Dropset').closest('button')!.getAttribute('aria-pressed')).toBe('true')
    captureRender('w7a-workout', document.body)
  })

  it('the question: a logged dropset with its drop logged, Normal picked: "Delete the 1 logged drop?" over W9\'s note, CANCEL and DELETE DROP', async () => {
    const planned = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1)]
    const { container } = renderCard({ plannedSets: planned, logs: [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1)], props: { programExercise: lat() } })
    openFromPanel(container, 'set:set-1')
    await pick('Normal')
    const ask = alertDialog()
    expect(ask.textContent).toContain('LAT PULLDOWN · SET 01')
    expect(within(ask).getByText('Delete the 1 logged drop?')).toBeTruthy()
    expect(within(ask).getByText("Only today's session changes; the plan stays the same.")).toBeTruthy()
    expect(within(ask).getByText('CANCEL')).toBeTruthy()
    expect(within(ask).getByText('DELETE DROP')).toBeTruthy()
    captureRender('w7a-confirm', document.body)
  })
})
