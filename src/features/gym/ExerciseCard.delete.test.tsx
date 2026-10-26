// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, screen, within, act } from '@testing-library/react'
import type { SessionSetChange, SetLog } from '../../types'
import { headLogOf, logOf, plannedDrop, plannedSet, renderCard, rowLabels, rowStates } from './cardHarness.testutil'
import { spyWriters } from './setWriters.testutil'
import type { LogRequest } from './useExerciseCardState'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import type { AddedSet, ChangeWrite, HeldChange } from './workoutRules'

// Chunk 61 — DELETE at the card (TASKS-1.2 61; SPEC [1.2] "Delete set (18b)", "Offline (G47)"; boards W7, W8, W9, W2b; DECISIONS 146 (a), 147 (a), 170, 178,
// 174's added place). The card is drawn through `useWorkoutRows` as GymSession draws it (cardHarness.testutil.tsx); `onDeleteSet` is the log delete and
// `writers` are the change rows, the renumber and a head's stage kind, each a spy, so what is asserted is what the screen sends and in which order. The
// session's answer is played back with `setLogs` / `setChanges`, so a row that must not come back is read on the screen after the writes, not only in
// the writes (RULES: "A write path's output is proven through the reader that draws it").

afterEach(cleanup)
beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS }))

const rowOf = (c: HTMLElement, key: string) => c.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const settle = () =>
  act(async () => {
    for (let i = 0; i < 16; i++) await Promise.resolve()
  })
const held = (change: SessionSetChange, id: string): HeldChange => ({ ...change, id })
const dropLog = (n: number, index: number, over: Partial<SetLog> = {}): SetLog =>
  logOf({ id: `d${n}${index === 1 ? '' : `-${index}`}`, parentSetId: `log-${n}`, stageIndex: index, setNumber: n, isDropset: true, weekPlanSetId: `set-${n}-drop-${index}`, ...over })
const dialog = () => screen.getByRole('alertdialog')
const press = (el: Element) =>
  act(async () => {
    fireEvent.click(el)
    for (let i = 0; i < 16; i++) await Promise.resolve()
  })

/** The recorder: every write the card makes, in the order it made it. */
function recorder(over: Parameters<typeof spyWriters>[0] = {}) {
  const order: string[] = []
  const deleted: string[] = []
  const writers = spyWriters({
    ...over,
    writeChanges: vi.fn(async (writes: readonly ChangeWrite[]) => void order.push(`changes ${JSON.stringify(writes)}`)),
    patchNumbers: vi.fn(async (patches: readonly unknown[]) => void order.push(`numbers ${JSON.stringify(patches)}`)),
    clearStageKind: vi.fn(async (id: string) => void order.push(`kind ${id}`)),
  })
  const onDeleteSet = vi.fn(async (id: string) => {
    deleted.push(id)
    order.push(`delete ${id}`)
  })
  return { order, deleted, writers, onDeleteSet }
}

/** The pen of a logged row, then DELETE in its edit panel (W2b), which asks W9. */
function askFromPanel(container: HTMLElement, key: string) {
  fireEvent.click(within(rowOf(container, key)).getByLabelText('Edit set'))
  fireEvent.click(within(rowOf(container, key)).getByText('DELETE'))
}
/** The ⋯ of an open row, then DELETE SET in its sheet (W7, W8), which asks W9. */
function askFromSheet(container: HTMLElement, key: string) {
  fireEvent.click(within(rowOf(container, key)).getByLabelText('Set options'))
  fireEvent.click(within(screen.getByRole('dialog')).getByText('DELETE SET'))
}

describe('a logged set: the panel\'s DELETE asks W9, then deletes the drops first and the head last, and renumbers the sets after it, drops included', () => {
  // Sets 01–04 logged; 03 and 04 are dropsets with one logged drop each. Deleting 03 leaves 04 as 03, and its drop with it.
  const plan = () => [plannedSet(1), plannedSet(2), plannedSet(3, { stageKind: 'dropset' }), plannedDrop(3, 1), plannedSet(4, { stageKind: 'dropset' }), plannedDrop(4, 1)]
  const logs = () => [
    headLogOf(1),
    headLogOf(2),
    headLogOf(3, { stageKind: 'dropset' }),
    dropLog(3, 1),
    headLogOf(4, { stageKind: 'dropset' }),
    dropLog(4, 1),
  ]

  it('asks first (W9: its title, its numbers and the plan note) and writes nothing until DELETE SET', async () => {
    const { deleted, writers, onDeleteSet } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: logs(), props: { onDeleteSet, writers } })
    askFromPanel(container, 'set:set-3')
    const confirm = dialog()
    expect(within(confirm).getByText('Delete set 03?')).toBeTruthy()
    expect(confirm.textContent).toContain('BENCH PRESS · SET 03')
    expect(confirm.textContent).toContain("60 kg × 8 and its drop. Only today's session changes; the plan stays the same.")
    expect(deleted).toEqual([])
    expect(writers.writeChanges).not.toHaveBeenCalled()
    expect(writers.patchNumbers).not.toHaveBeenCalled()
    fireEvent.click(within(confirm).getByText('CANCEL'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(deleted).toEqual([])
    expect(rowLabels(container)).toEqual(['01', '02', '03', '↳', '04', '↳'])
  })

  it('deletes the drop, then the head; the change row; then patches set 04 to 03 and its drop with it (heads and stages)', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: logs(), props: { onDeleteSet, writers } })
    askFromPanel(container, 'set:set-3')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual([
      'delete d3',
      'delete log-3',
      `changes ${JSON.stringify([{ change: { kind: 'deleted', weekPlanSetId: 'set-3' }, id: null }])}`,
      `numbers ${JSON.stringify([{ id: 'log-4', setNumber: 3 }, { id: 'd4', setNumber: 3 }])}`,
    ])
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('what the screen draws afterwards: 04 is 03 with its drop, and the deleted set is not an open row (the session\'s answer played back)', async () => {
    const { writers, onDeleteSet } = recorder()
    const { container, setLogs, setChanges } = renderCard({ plannedSets: plan(), logs: logs(), props: { onDeleteSet, writers } })
    askFromPanel(container, 'set:set-3')
    await press(within(dialog()).getByText('DELETE SET'))
    // the server: the logs of 03 are gone, 04 and its drop carry 03, and the change row is there
    setLogs([headLogOf(1), headLogOf(2), headLogOf(4, { stageKind: 'dropset', setNumber: 3 }), dropLog(4, 1, { setNumber: 3 })])
    setChanges([held({ kind: 'deleted', weekPlanSetId: 'set-3' }, 'chg-1')])
    expect(rowLabels(container)).toEqual(['01', '02', '03', '↳'])
    expect(rowStates(container)).toEqual(['logged', 'logged', 'logged', 'logged'])
    expect(container.querySelector('[data-current-set]')).toBeNull() // nothing open: the deleted set did not come back
  })

  it('a log that can\'t be deleted stops everything after it: no change row, no renumber, and W9 says why', async () => {
    const { order, writers } = recorder()
    const onDeleteSet = vi.fn(async (id: string) => {
      order.push(`delete ${id}`)
      throw new Error('Failed to fetch')
    })
    const { container } = renderCard({ plannedSets: plan(), logs: logs(), props: { onDeleteSet, writers } })
    askFromPanel(container, 'set:set-3')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual(['delete d3']) // the first refusal stops the rest: the head's own delete is never tried
    expect(writers.writeChanges).not.toHaveBeenCalled()
    expect(writers.patchNumbers).not.toHaveBeenCalled()
    expect(within(dialog()).getByText("Couldn't delete the set.")).toBeTruthy()
    expect(within(dialog()).getByText('Failed to fetch')).toBeTruthy()
    // nothing is hidden: the set is still there, and the dialog can be answered again
    expect(rowLabels(container)).toEqual(['01', '02', '03', '↳', '04', '↳'])
    expect(within(dialog()).getByText('DELETE SET')).toBeTruthy()
  })

  it('two presses in one instant delete once', async () => {
    const { deleted, writers, onDeleteSet } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: logs(), props: { onDeleteSet, writers } })
    askFromPanel(container, 'set:set-3')
    const button = within(dialog()).getByText('DELETE SET')
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
      for (let i = 0; i < 16; i++) await Promise.resolve()
    })
    expect(deleted).toEqual(['d3', 'log-3'])
    expect(writers.writeChanges).toHaveBeenCalledTimes(1)
  })
})

describe('an open planned set: its ⋯ DELETE SET writes the `deleted` change row and nothing else', () => {
  const plan = () => [plannedSet(1), plannedSet(2), plannedSet(3)]

  it('writes `deleted` for the planned set (no type, no log), sends no log delete, and the row is gone with the next one renumbered', async () => {
    const { order, deleted, writers, onDeleteSet } = recorder()
    const { container, setChanges } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], props: { onDeleteSet, writers } })
    expect(rowLabels(container)).toEqual(['01', '02', '03'])
    askFromSheet(container, 'set:set-2')
    expect(dialog().textContent).toContain('BENCH PRESS · SET 02')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual([`changes ${JSON.stringify([{ change: { kind: 'deleted', weekPlanSetId: 'set-2' }, id: null }])}`])
    expect(deleted).toEqual([])
    expect(writers.patchNumbers).not.toHaveBeenCalled() // no logged set after it
    // the session's answer: the change row. 03 is 02 now, and it is the current set
    setChanges([held({ kind: 'deleted', weekPlanSetId: 'set-2' }, 'chg-1')])
    expect(rowLabels(container)).toEqual(['01', '02'])
    expect(rowOf(container, 'set:set-3').hasAttribute('data-current-set')).toBe(true)
  })

  it('a reload that finds no change row brings the row back (the control for "the write is what removes it")', () => {
    const { container, setChanges } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], changes: [held({ kind: 'deleted', weekPlanSetId: 'set-2' }, 'chg-1')] })
    expect(rowLabels(container)).toEqual(['01', '02'])
    setChanges([])
    expect(rowLabels(container)).toEqual(['01', '02', '03'])
  })

  it('while the change row is being written the row is already gone, and a failed write brings it back with the reason', async () => {
    let fail!: (err: Error) => void
    const { writers, onDeleteSet } = recorder()
    writers.writeChanges.mockImplementation(() => new Promise<void>((_resolve, reject) => void (fail = reject)))
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], props: { onDeleteSet, writers } })
    askFromSheet(container, 'set:set-2')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(rowLabels(container)).toEqual(['01', '02']) // drawn as deleted from the first press, with the write still out
    expect(within(dialog()).getByText('DELETING…')).toBeTruthy()
    await act(async () => fail(new Error('permission denied')))
    await settle()
    expect(rowLabels(container)).toEqual(['01', '02', '03']) // not written: the set is still there
    expect(within(dialog()).getByText("Couldn't delete the set.")).toBeTruthy()
    expect(within(dialog()).getByText('permission denied')).toBeTruthy()
  })

  it('a set the session already changed: the `deleted` write replaces its `retyped` row by that row\'s id (one row per planned set)', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const retyped = held({ kind: 'retyped', weekPlanSetId: 'set-2', type: { kind: 'staged', stageKind: 'dropset', stageCount: 2 } }, 'chg-7')
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], changes: [retyped], props: { onDeleteSet, writers } })
    expect(container.textContent).toContain('DROPSET · 2 DROPS')
    askFromSheet(container, 'set:set-2')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual([`changes ${JSON.stringify([{ change: { kind: 'deleted', weekPlanSetId: 'set-2' }, id: 'chg-7' }])}`])
  })

  it('a set the session already retyped, deleted while the write is out: the row is gone at once (the written row wins over the stored one), and a refused write brings it back as it was', async () => {
    let fail!: (err: Error) => void
    const { writers, onDeleteSet } = recorder()
    writers.writeChanges.mockImplementation(() => new Promise<void>((_resolve, reject) => void (fail = reject)))
    const retyped = held({ kind: 'retyped', weekPlanSetId: 'set-2', type: { kind: 'staged', stageKind: 'dropset', stageCount: 2 } }, 'chg-7')
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], changes: [retyped], props: { onDeleteSet, writers } })
    expect(rowLabels(container)).toEqual(['01', '02', '↳', '↳', '03'])
    askFromSheet(container, 'set:set-2')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(rowLabels(container)).toEqual(['01', '02']) // the set and its two drops are out, 03 is 02: no error from two rows for one planned set
    await act(async () => fail(new Error('permission denied')))
    await settle()
    expect(rowLabels(container)).toEqual(['01', '02', '↳', '↳', '03']) // as it was: a dropset with two drops
    expect(within(dialog()).getByText('permission denied')).toBeTruthy()
  })

  it('a planned dropset deleted open says its drops go with it (W9\'s head variant)', async () => {
    const { container } = renderCard({ plannedSets: [plannedSet(1, { stageKind: 'dropset', targetWeight: 52.5, repMin: 8, repMax: 10 }), plannedDrop(1, 1), plannedDrop(1, 2)] })
    askFromSheet(container, 'set:set-1')
    expect(dialog().textContent).toContain("52.5 kg × 8–10 and its 2 drops. Only today's session changes; the plan stays the same.")
  })

  it('the plan row is untouched: nothing here writes a week plan set (the writers are the log delete, the change rows, the renumber and a head\'s kind)', async () => {
    const { writers, onDeleteSet } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], props: { onDeleteSet, writers } })
    askFromSheet(container, 'set:set-2')
    await press(within(dialog()).getByText('DELETE SET'))
    for (const call of writers.writeChanges.mock.calls) {
      for (const write of call[0] as ChangeWrite[]) expect(['deleted', 'retyped', 'pending_stages']).toContain(write.change.kind)
    }
    expect(Object.keys(writers).sort()).toEqual(['clearStageKind', 'isCycle', 'mesocycleId', 'online', 'patchNumbers', 'weekNumber', 'writeChanges'])
  })
})

describe('SKIP THIS SET writes the skip and no change row (RULES: only a delete turns a `retyped` row into `deleted`)', () => {
  const retyped = () => held({ kind: 'retyped', weekPlanSetId: 'set-2', type: { kind: 'staged', stageKind: 'dropset', stageCount: 2 } }, 'chg-7')
  const plan = () => [plannedSet(1), plannedSet(2), plannedSet(3)]

  it('a set the session retyped is skipped: its log is written, the change row is not touched, no number is patched and nothing is deleted', async () => {
    const { writers, onDeleteSet } = recorder()
    const onLog = vi.fn(async (params: LogRequest) => logOf({ id: 'skip-1', ...(params as unknown as Partial<SetLog>) }))
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], changes: [retyped()], props: { onDeleteSet, writers, onLog } })
    expect(container.textContent).toContain('DROPSET · 2 DROPS')
    fireEvent.click(within(rowOf(container, 'set:set-2')).getByLabelText('Set options'))
    await press(within(screen.getByRole('dialog')).getByText('SKIP THIS SET'))
    expect(onLog).toHaveBeenCalledTimes(1)
    expect(onLog.mock.calls[0][0]).toMatchObject({ isSkipped: true, weekPlanSetId: 'set-2' })
    expect(writers.writeChanges).not.toHaveBeenCalled()
    expect(writers.patchNumbers).not.toHaveBeenCalled()
    expect(writers.clearStageKind).not.toHaveBeenCalled()
    expect(onDeleteSet).not.toHaveBeenCalled()
  })

  it('the control: DELETE SET on that same set does write its change row (a `deleted` replacing the `retyped` by id), so the absence above is not a card that writes nothing', async () => {
    const { writers, onDeleteSet } = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: [headLogOf(1)], changes: [retyped()], props: { onDeleteSet, writers } })
    askFromSheet(container, 'set:set-2')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(writers.writeChanges).toHaveBeenCalledWith([{ change: { kind: 'deleted', weekPlanSetId: 'set-2' }, id: 'chg-7' }])
  })
})

describe('a skipped set can be deleted too (F4: "can\'t delete a skipped set")', () => {
  it('its ⋯ has DELETE SET alone; W9 then deletes the skip\'s log and writes the `deleted` row', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const skipped = headLogOf(1, { isSkipped: true, weight: null, reps: null })
    const { container } = renderCard({ plannedSets: [plannedSet(1), plannedSet(2)], logs: [skipped], props: { onDeleteSet, writers } })
    expect(rowStates(container)).toEqual(['skipped', 'current'])
    fireEvent.click(within(rowOf(container, 'set:set-1')).getByLabelText('Set options'))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('DELETE SET')).toBeTruthy()
    for (const absent of ['SKIP THIS SET', 'FORM', 'SET TYPE', 'CUES']) expect(within(sheet).queryByText(absent)).toBeNull()
    expect(within(sheet).queryByRole('switch')).toBeNull()
    fireEvent.click(within(sheet).getByText('DELETE SET'))
    expect(dialog().textContent).toContain("Only today's session changes; the plan stays the same.")
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual(['delete log-1', `changes ${JSON.stringify([{ change: { kind: 'deleted', weekPlanSetId: 'set-1' }, id: null }])}`])
    expect(writers.patchNumbers).not.toHaveBeenCalled()
  })
})

describe('a drop on its own (board W8; DECISIONS 147 (a))', () => {
  const dropsetPlan = (drops: number) => [plannedSet(1, { stageKind: 'dropset', targetWeight: 60, repMin: 8, repMax: 8 }), ...Array.from({ length: drops }, (_, i) => plannedDrop(1, i + 1, { targetWeight: 40 - i * 10, isAmrap: true }))]

  it('an open drop: its sheet has FORM, the lbs row and DELETE SET only; DELETE writes the set\'s `retyped` row and its `pending_stages` row with one drop fewer, and no log', async () => {
    const { order, deleted, writers, onDeleteSet } = recorder()
    const { container, setChanges } = renderCard({ plannedSets: dropsetPlan(2), logs: [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1)], props: { onDeleteSet, writers } })
    expect(rowStates(container)).toEqual(['logged', 'logged', 'current'])
    fireEvent.click(within(rowOf(container, 'set:set-1:stage:2')).getByLabelText('Set options'))
    const sheet = screen.getByRole('dialog')
    expect(within(sheet).getByText('BENCH PRESS · SET 01 · DROP 2')).toBeTruthy()
    expect(within(sheet).getByText('FORM')).toBeTruthy()
    expect(within(sheet).getByRole('switch')).toBeTruthy()
    for (const absent of ['SET TYPE', 'CUES', 'SKIP THIS SET']) expect(within(sheet).queryByText(absent)).toBeNull()
    fireEvent.click(within(sheet).getByText('DELETE SET'))
    expect(within(dialog()).getByText('Delete set 01 drop 2?')).toBeTruthy()
    await press(within(dialog()).getByText('DELETE SET'))
    expect(deleted).toEqual([])
    expect(order).toEqual([
      `changes ${JSON.stringify([
        { change: { kind: 'retyped', weekPlanSetId: 'set-1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 } }, id: null },
        { change: { kind: 'pending_stages', setLogId: 'log-1', stageKind: 'dropset', stageCount: 1 }, id: null },
      ])}`,
    ])
    expect(writers.clearStageKind).not.toHaveBeenCalled()
    // the session's answer: the head has one drop, and it is logged
    setChanges([
      held({ kind: 'retyped', weekPlanSetId: 'set-1', type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 } }, 'chg-1'),
      held({ kind: 'pending_stages', setLogId: 'log-1', stageKind: 'dropset', stageCount: 1 }, 'chg-2'),
    ])
    expect(rowLabels(container)).toEqual(['01', '↳'])
    expect(container.querySelector('[data-current-set]')).toBeNull()
  })

  it('the last drop of a logged head: the log loses its stage kind (it is a normal set now), after the drop\'s own log and before the rows', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const { container } = renderCard({ plannedSets: dropsetPlan(1), logs: [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1)], props: { onDeleteSet, writers } })
    askFromPanel(container, 'set:set-1:stage:1') // a logged drop's pen
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual([
      'delete d1',
      'kind log-1',
      `changes ${JSON.stringify([{ change: { kind: 'retyped', weekPlanSetId: 'set-1', type: { kind: 'normal' } }, id: null }])}`,
    ])
  })

  it('offline, a delete that has to patch the head\'s stage kind writes nothing at all and says "Requires a connection" (the queue\'s patch is a set number only)', async () => {
    const { order, deleted, writers, onDeleteSet } = recorder({ online: false })
    const { container } = renderCard({ plannedSets: dropsetPlan(1), logs: [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1)], props: { onDeleteSet, writers } })
    askFromPanel(container, 'set:set-1:stage:1')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual([])
    expect(deleted).toEqual([])
    expect(within(dialog()).getByText('Requires a connection')).toBeTruthy()
    expect(rowLabels(container)).toEqual(['01', '↳']) // still there
  })

  it('offline, a drop that leaves other drops needs no stage-kind patch and is written', async () => {
    const { order, writers, onDeleteSet } = recorder({ online: false })
    const { container } = renderCard({ plannedSets: dropsetPlan(2), logs: [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1)], props: { onDeleteSet, writers } })
    fireEvent.click(within(rowOf(container, 'set:set-1:stage:2')).getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('DELETE SET'))
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toHaveLength(1)
    expect(order[0]).toContain('"kind":"pending_stages"')
  })
})

describe('sets added in the session (DECISIONS 170, 174): the card\'s list, the place, the numbers', () => {
  const entry = (localId: string, place: number, logId: string | null = null): AddedSet => ({ localId, logId, type: { kind: 'normal' }, place })
  const addedLog = (id: string, place: number, over: Partial<SetLog> = {}): SetLog => logOf({ id, weekPlanSetId: null, setNumber: 1 + place, addedPlace: place, ...over })

  it('a drop deleted under an added dropset writes the head\'s `pending_stages` row alone, replacing the held row by its id: an added set never gets a `retyped` row (DECISIONS 141)', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const head = addedLog('log-a', 1, { stageKind: 'dropset' })
    const drop = logOf({ id: 'da1', weekPlanSetId: null, parentSetId: 'log-a', stageIndex: 1, setNumber: 2, isDropset: true, addedPlace: null })
    const pending = (stageCount: number) => held({ kind: 'pending_stages', setLogId: 'log-a', stageKind: 'dropset', stageCount }, 'chg-p')
    const { container, setChanges } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1), head, drop], changes: [pending(2)], initialAdded: [entry('a1', 1, 'log-a')], props: { onDeleteSet, writers } })
    expect(rowLabels(container)).toEqual(['01', '02', '↳', '↳'])
    askFromSheet(container, 'added:pe-1:a1:stage:2')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual([`changes ${JSON.stringify([{ change: { kind: 'pending_stages', setLogId: 'log-a', stageKind: 'dropset', stageCount: 1 }, id: 'chg-p' }])}`])
    setChanges([pending(1)]) // the session's answer
    expect(rowLabels(container)).toEqual(['01', '02', '↳'])
  })

  it('an open added set is deleted in the card alone: no log delete, no change row, no renumber', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1)], initialAdded: [entry('a1', 1)], props: { onDeleteSet, writers } })
    expect(rowLabels(container)).toEqual(['01', '02'])
    askFromSheet(container, 'added:pe-1:a1')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual([])
    expect(rowLabels(container)).toEqual(['01'])
  })

  it('a logged added set: its log is deleted, its entry leaves the card\'s list (it is not drawn as an open row once the log is gone), and the sets after it close the gap without ever carrying a place', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const a = addedLog('log-a', 1)
    const b = addedLog('log-b', 2)
    const { container, setLogs } = renderCard({
      plannedSets: [plannedSet(1)],
      logs: [headLogOf(1), a, b],
      initialAdded: [entry('a1', 1, 'log-a'), entry('a2', 2, 'log-b')],
      props: { onDeleteSet, writers },
    })
    expect(rowLabels(container)).toEqual(['01', '02', '03'])
    askFromPanel(container, 'added:pe-1:a1')
    await press(within(dialog()).getByText('DELETE SET'))
    // log-b's stored number follows its row (03 -> 02); the patch names a number and nothing else: never a place
    expect(order).toEqual(['delete log-a', `numbers ${JSON.stringify([{ id: 'log-b', setNumber: 2 }])}`])
    expect(writers.writeChanges).not.toHaveBeenCalled()
    // the session's answer: log-a is gone. The deleted set must not come back as an open row
    setLogs([headLogOf(1), { ...b, setNumber: 2 }])
    expect(rowLabels(container)).toEqual(['01', '02'])
    expect(rowStates(container)).toEqual(['logged', 'logged'])
    expect(container.querySelector('[data-current-set]')).toBeNull()
    // log-b keeps the place it was written with: nothing the delete wrote names one
    expect(JSON.stringify(order)).not.toMatch(/addedPlace|added_place|place/)
  })

  it('an open added set deleted before a logged one: the logged set after it closes the gap (an open set keeps its place, so a logged set can come after it)', async () => {
    const { order, writers, onDeleteSet } = recorder()
    const b = addedLog('log-b', 2)
    const { container } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1), b], initialAdded: [entry('a1', 1), entry('a2', 2, 'log-b')], props: { onDeleteSet, writers } })
    expect(rowLabels(container)).toEqual(['01', '02', '03'])
    askFromSheet(container, 'added:pe-1:a1')
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual([`numbers ${JSON.stringify([{ id: 'log-b', setNumber: 2 }])}`])
  })
})

describe('the warmup row: its edit panel\'s DELETE asks W9 and deletes the warmup set from the session', () => {
  it('a logged planned warmup (rows): pen, DELETE, DELETE SET writes the log delete and the `deleted` row, and the warmups after it renumber', async () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'rows' })
    const { order, writers, onDeleteSet } = recorder()
    const plan = [plannedSet(1, { id: 'wup-1', isWarmup: true }), plannedSet(2, { id: 'wup-2', isWarmup: true }), plannedSet(3)]
    const logs = [logOf({ id: 'lw-1', weekPlanSetId: 'wup-1', isWarmup: true, setNumber: 1 }), logOf({ id: 'lw-2', weekPlanSetId: 'wup-2', isWarmup: true, setNumber: 2 })]
    const { container } = renderCard({ plannedSets: plan, logs, props: { onDeleteSet, writers } })
    fireEvent.click(within(rowOf(container, 'set:wup-1')).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(container, 'set:wup-1')).getByText('DELETE'))
    expect(within(dialog()).getByText('Delete warmup?')).toBeTruthy()
    await press(within(dialog()).getByText('DELETE SET'))
    expect(order).toEqual(['delete lw-1', `changes ${JSON.stringify([{ change: { kind: 'deleted', weekPlanSetId: 'wup-1' }, id: null }])}`, `numbers ${JSON.stringify([{ id: 'lw-2', setNumber: 1 }])}`])
  })
})
