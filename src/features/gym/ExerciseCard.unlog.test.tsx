// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, screen, within, act } from '@testing-library/react'
import type { SessionSetChange, SetLog } from '../../types'
import { exerciseOf, headLogOf, logOf, plannedDrop, plannedSet, renderCard, rowLabels, rowStates } from './cardHarness.testutil'
import { spyWriters } from './setWriters.testutil'
import { fakeDraftStore, newDraftWorld, type DraftWorld } from './draftStore.testutil'
import { useRestTimerStore } from './restTimerStore'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import type { LogRequest } from './useExerciseCardState'
import type { ChangeWrite, HeldChange } from './workoutRules'

// Chunk 63 — UNLOG at the card (TASKS-1.2 63; SPEC [1.2] "Unlog (18c)", G46 (a), G47; boards W2b; DECISIONS 147 (b), 151, 161, 170, 174, 184 (b)). The card is drawn through
// `useWorkoutRows` as GymSession draws it (cardHarness.testutil.tsx), over a stand-in for what the phone keeps (`draftStore.testutil.ts`: copies, writes on a later tick;
// mounting again over the same world is a reload). `onDeleteSet` is the log delete, `onLog` the LOG, and `writers` the change rows and the renumber, each a spy, so what is
// asserted is what the screen sends, in which order, and what it draws once the session's answer is played back with `setLogs` (RULES: a write path is proven through the
// reader that draws it). Every writer here has a break in the report (RULES.md, "Break proofs for the remaining chunks").

afterEach(cleanup)
beforeEach(() => useSettingsStore.setState({ ...DEFAULT_SETTINGS }))

const rowOf = (c: HTMLElement, key: string) => c.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const wait = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const settle = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await wait()
  })
const press = (el: Element) =>
  act(async () => {
    fireEvent.click(el)
    for (let i = 0; i < 6; i++) await wait()
  })
const addedKeys = (c: HTMLElement) => Array.from(c.querySelectorAll('[data-row-key^="added:"]')).map((el) => el.getAttribute('data-row-key')!)
const boxes = (c: HTMLElement, key: string) => (['Weight', 'Reps', 'RIR'] as const).map((label) => (within(rowOf(c, key)).getByLabelText(label) as HTMLInputElement).value)
// a box holding the draft's number is marked and drawn in the muted colour; a typed one is neither (SPEC [P2]: pre-fill "visibly different from typed values")
const greyBoxes = (c: HTMLElement, key: string) =>
  (['Weight', 'Reps', 'RIR'] as const).map((label) => {
    const el = within(rowOf(c, key)).getByLabelText(label) as HTMLInputElement
    return el.getAttribute('data-draft') === 'true' && el.style.color === 'var(--text-muted)'
  })
const type = (c: HTMLElement, key: string, label: 'Weight' | 'Reps' | 'RIR', value: string) => fireEvent.change(within(rowOf(c, key)).getByLabelText(label), { target: { value } })
const held = (change: SessionSetChange, id: string): HeldChange => ({ ...change, id })
const dropLog = (n: number, index: number, over: Partial<SetLog> = {}): SetLog =>
  logOf({ id: `d${n}-${index}`, parentSetId: `log-${n}`, stageIndex: index, setNumber: n, isDropset: true, weekPlanSetId: `set-${n}-drop-${index}`, ...over })

/** The pen of a logged row, then its UNLOG. */
function unlogButtonOf(c: HTMLElement, key: string): HTMLButtonElement {
  fireEvent.click(within(rowOf(c, key)).getByLabelText('Edit set'))
  return within(rowOf(c, key)).getByText('UNLOG') as HTMLButtonElement
}

/** Every write the card makes, in the order it made it. */
function recorder(over: Parameters<typeof spyWriters>[0] = {}) {
  const calls: string[] = []
  const changeWrites: ChangeWrite[][] = []
  const deleted: string[] = []
  const requests: LogRequest[] = []
  const writers = spyWriters({
    ...over,
    writeChanges: vi.fn(async (writes: readonly ChangeWrite[]) => {
      calls.push('changes')
      changeWrites.push([...writes])
    }),
  })
  const onDeleteSet = vi.fn(async (id: string) => {
    deleted.push(id)
    calls.push(`delete ${id}`)
  })
  const onLog = vi.fn(async (request: LogRequest) => {
    requests.push(request)
    calls.push(`log ${request.setNumber}`)
    return {} as SetLog
  })
  const onUpdateSet = vi.fn()
  return { calls, changeWrites, deleted, requests, writers, onDeleteSet, onLog, onUpdateSet }
}

const draftIds = (w: DraftWorld) => [...w.drafts.keys()].sort()
const addedLogOf = (r: LogRequest, over: Partial<SetLog> = {}): SetLog =>
  logOf({ id: r.id!, weekPlanSetId: null, setNumber: r.setNumber, weight: r.weight, reps: r.reps, rir: r.rir, addedPlace: r.addedPlace ?? null, stageKind: r.stageKind, isWarmup: r.isWarmup ?? false, ...over })

describe('UNLOG on a logged set: the log goes, the numbers stay on the phone as a draft, and the row comes back current with them (SPEC 18c, G46 (a))', () => {
  const plan = () => [plannedSet(1), plannedSet(2), plannedSet(3)]
  const logs = () => [headLogOf(1), headLogOf(2), headLogOf(3, { weight: 80, reps: 8, rir: 2, formRating: 'controlled' })]

  it('deletes the log, keeps the whole draft under the planned set\'s key, and writes nothing else: no rest timer, no session row, no log write, no change row', async () => {
    const world = newDraftWorld()
    const startRest = vi.spyOn(useRestTimerStore.getState(), 'startRest')
    const stop = vi.spyOn(useRestTimerStore.getState(), 'stop')
    const r = recorder()
    const { container } = renderCard({ plannedSets: plan(), logs: logs(), store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, onUpdateSet: r.onUpdateSet, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-3'))
    expect(r.deleted).toEqual(['log-3'])
    expect([...world.drafts.values()]).toEqual([
      {
        id: 'session-1|p:set-3',
        sessionId: 'session-1',
        key: { sessionId: 'session-1', weekPlanSetId: 'set-3' },
        values: { weight: 80, reps: 8, rir: 2, formRating: 'controlled', enteredUnit: null },
      },
    ])
    expect(startRest).not.toHaveBeenCalled()
    expect(stop).not.toHaveBeenCalled()
    expect(r.onLog).not.toHaveBeenCalled()
    expect(r.onUpdateSet).not.toHaveBeenCalled()
    for (const writer of ['writeChanges', 'patchNumbers', 'clearStageKind', 'patchLog', 'queueChanges'] as const) expect(r.writers[writer]).not.toHaveBeenCalled()
    startRest.mockRestore()
    stop.mockRestore()
  })

  it('the row that comes back is the current set at its own number, with the draft\'s numbers in its boxes, grey, not typed (break: no draft written -> empty boxes)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const { container, setLogs } = renderCard({ plannedSets: plan(), logs: logs(), store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-3'))
    setLogs(logs().slice(0, 2)) // the session's answer: the log is gone
    await settle()
    expect(rowLabels(container)).toEqual(['01', '02', '03'])
    expect(rowStates(container)).toEqual(['logged', 'logged', 'current'])
    expect(boxes(container, 'set:set-3')).toEqual(['80', '8', '2'])
    expect(greyBoxes(container, 'set:set-3')).toEqual([true, true, true])
    // typing in a box makes that box a typed value; the others stay suggestions
    type(container, 'set:set-3', 'Reps', '9')
    expect(greyBoxes(container, 'set:set-3')).toEqual([true, false, true])
    expect((within(rowOf(container, 'set:set-3')).getByLabelText('Reps') as HTMLInputElement).style.color).toBe('var(--text-primary)')
  })

  it('LOG again inserts a new log with the draft\'s numbers at the same number and clears the draft; it patches nothing (break: patch the old id, or keep the draft)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const { container, setLogs } = renderCard({ plannedSets: plan(), logs: logs(), store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, onUpdateSet: r.onUpdateSet, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-3'))
    setLogs(logs().slice(0, 2))
    await settle()
    await press(within(rowOf(container, 'set:set-3')).getByText('LOG'))
    expect(r.onLog).toHaveBeenCalledTimes(1)
    expect(r.requests[0]).toMatchObject({ weekPlanSetId: 'set-3', setNumber: 3, weight: 80, reps: 8, rir: 2, formRating: 'controlled', isSkipped: false })
    expect('id' in r.requests[0]).toBe(false) // a planned set's log is found by its planned set, as before
    expect(r.onUpdateSet).not.toHaveBeenCalled()
    expect(world.drafts.size).toBe(0)
    expect(world.log.filter((l) => l.startsWith('delete'))).toEqual(['delete session-1|p:set-3'])
  })

  it('a LOG that fails puts the draft back: the row that returns after the rollback shows its numbers again (break: the draft not restored)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    let refuse!: () => void
    const failing = vi.fn(() => new Promise<SetLog>((_, reject) => (refuse = () => reject(new Error('refused')))))
    const { container, setLogs } = renderCard({ plannedSets: plan(), logs: logs(), store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: failing, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-3'))
    setLogs(logs().slice(0, 2))
    await settle()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await press(within(rowOf(container, 'set:set-3')).getByText('LOG'))
    setLogs(logs()) // the optimistic log: while the request is out the row is a logged row
    await settle()
    expect(rowStates(container)).toEqual(['logged', 'logged', 'logged'])
    await act(async () => {
      refuse()
      for (let i = 0; i < 6; i++) await wait()
    })
    setLogs(logs().slice(0, 2)) // the rollback: the row is open again, a new instance
    await settle()
    expect(world.drafts.size).toBe(1)
    expect(boxes(container, 'set:set-3')).toEqual(['80', '8', '2'])
    expect(greyBoxes(container, 'set:set-3')).toEqual([true, true, true])
  })

  it('01-03 logged, unlog 02 and log it again: the stored numbers are 1, 2, 3 and no other log\'s number is patched (DECISIONS 151; break: the next number after the logged ones -> 3)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const { container, setLogs } = renderCard({ plannedSets: plan(), logs: logs(), store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-2'))
    setLogs([headLogOf(1), headLogOf(3)])
    await settle()
    expect(rowLabels(container)).toEqual(['01', '02', '03']) // 03 stays 03, the open row shows its own number
    expect(rowStates(container)).toEqual(['logged', 'current', 'logged'])
    await press(within(rowOf(container, 'set:set-2')).getByText('LOG'))
    expect(r.requests.map((q) => q.setNumber)).toEqual([2])
    expect(r.writers.patchNumbers).not.toHaveBeenCalled()
  })

  it('works offline: the draft is on the phone before the delete has answered, and the delete is the card\'s own (the screen queues it)', async () => {
    const world = newDraftWorld()
    let release!: () => void
    const pendingDelete = new Promise<void>((resolve) => (release = resolve))
    const onDeleteSet = vi.fn(() => pendingDelete)
    const { container } = renderCard({ plannedSets: plan(), logs: logs(), store: fakeDraftStore(world), props: { onDeleteSet, writers: spyWriters({ online: false }) } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-3'))
    expect(onDeleteSet).toHaveBeenCalledWith('log-3')
    expect(world.drafts.size).toBe(1) // written at once, while the delete is still out (break: the draft written after the delete)
    release()
    await settle()
  })

  it('a delete that is refused leaves the set logged and lets the draft go; the confirm toast path is the row\'s (it throws to the caller)', async () => {
    const world = newDraftWorld()
    const onDeleteSet = vi.fn(async () => {
      throw new Error('refused')
    })
    const { container } = renderCard({ plannedSets: plan(), logs: logs(), store: fakeDraftStore(world), props: { onDeleteSet } })
    await settle()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await press(unlogButtonOf(container, 'set:set-3'))
    expect(onDeleteSet).toHaveBeenCalled()
    expect(world.drafts.size).toBe(0)
    expect(rowStates(container)).toEqual(['logged', 'logged', 'logged'])
  })
})

describe('a logged warmup (rows mode) can be unlogged too: its weight and reps come back as the draft (board W2b "EDITING A WARMUP")', () => {
  it('UNLOG in the warmup\'s panel deletes its log and keeps weight and reps; the open warmup row shows them grey and LOG writes a warmup with them (break: the panel\'s UNLOG not wired; break: the boxes not filled)', async () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'rows' })
    const world = newDraftWorld()
    const r = recorder()
    const plan = [plannedSet(1, { isWarmup: true }), plannedSet(2)]
    const warm = () => headLogOf(1, { isWarmup: true, weight: 40, reps: 5 })
    const { container, setLogs } = renderCard({ plannedSets: plan, logs: [warm()], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-1'))
    expect(r.deleted).toEqual(['log-1'])
    expect([...world.drafts.values()].map((d) => [d.id, d.values])).toEqual([['session-1|p:set-1', { weight: 40, reps: 5, rir: null, formRating: null, enteredUnit: null }]])
    setLogs([])
    await settle()
    const w = within(rowOf(container, 'set:set-1'))
    expect([(w.getByLabelText('Weight') as HTMLInputElement).value, (w.getByLabelText('Reps') as HTMLInputElement).value]).toEqual(['40', '5'])
    expect(w.getByLabelText('Weight').style.color).toBe('var(--text-muted)')
    await press(w.getByText('LOG'))
    expect(r.requests[0]).toMatchObject({ weekPlanSetId: 'set-1', isWarmup: true, weight: 40, reps: 5 })
    expect(world.drafts.size).toBe(0)
  })
})

describe('UNLOG is disabled while a later drop of the set is logged, and says so; a drop can be unlogged under the same rule (DECISIONS 147 (b))', () => {
  const plan = () => [plannedSet(1), plannedSet(2, { stageKind: 'dropset' }), plannedDrop(2, 1), plannedDrop(2, 2)]
  const logs = () => [headLogOf(1), headLogOf(2, { stageKind: 'dropset' }), dropLog(2, 1, { weight: 50, reps: 10 }), dropLog(2, 2, { weight: 40, reps: 12, rir: 1 })]

  it('the head\'s UNLOG is disabled with "Log its drops first" and does nothing; the first drop\'s too; the last drop\'s works and keeps its draft under the set\'s key and its number (break: UNLOG enabled)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const { container, setLogs } = renderCard({ plannedSets: plan(), logs: logs(), store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, writers: r.writers } })
    await settle()
    const head = unlogButtonOf(container, 'set:set-2')
    expect(head.disabled).toBe(true)
    expect(within(rowOf(container, 'set:set-2')).getByRole('status').textContent).toBe('Log its drops first')
    await press(head)
    expect(r.deleted).toEqual([])
    fireEvent.click(within(rowOf(container, 'set:set-2')).getByText('CANCEL'))
    const first = unlogButtonOf(container, 'set:set-2:stage:1')
    expect(first.disabled).toBe(true) // the second drop is logged after it
    fireEvent.click(within(rowOf(container, 'set:set-2:stage:1')).getByText('CANCEL'))

    await press(unlogButtonOf(container, 'set:set-2:stage:2'))
    expect(r.deleted).toEqual(['d2-2'])
    expect([...world.drafts.values()].map((d) => [d.id, d.key, d.values])).toEqual([
      ['session-1|p:set-2:d2', { sessionId: 'session-1', weekPlanSetId: 'set-2', drop: 2 }, { weight: 40, reps: 12, rir: 1, formRating: null, enteredUnit: null }],
    ])
    setLogs(logs().slice(0, 3))
    await settle()
    expect(boxes(container, 'set:set-2:stage:2')).toEqual(['40', '12', '1']) // the drop comes back with its own numbers
    expect(unlogButtonOf(container, 'set:set-2:stage:1').disabled).toBe(false) // now the first drop can go
  })
})

describe('a planned set logged as another type than the plan\'s keeps that type when it is unlogged: its `retyped` row goes first (board W2b; SPEC 19)', () => {
  it('writes the retyped row before the delete, and the open row keeps its dropset chip (break: no row written -> the chip is gone)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const pending: HeldChange = held({ kind: 'pending_stages', setLogId: 'log-2', stageKind: 'dropset', stageCount: 1 }, 'chg-p')
    const { container, setLogs, setChanges } = renderCard({
      plannedSets: [plannedSet(1), plannedSet(2)],
      logs: [headLogOf(1), headLogOf(2, { stageKind: 'dropset' })],
      changes: [pending],
      store: fakeDraftStore(world),
      props: { onDeleteSet: r.onDeleteSet, writers: r.writers },
    })
    await settle()
    expect(container.textContent).toContain('DROPSET') // the logged head reads as a dropset (its pending_stages row)
    await press(unlogButtonOf(container, 'set:set-2'))
    expect(r.calls).toEqual(['changes', 'delete log-2'])
    expect(r.changeWrites).toEqual([[{ change: { kind: 'retyped', weekPlanSetId: 'set-2', type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 } }, id: null }]])
    setLogs([headLogOf(1)])
    setChanges([held({ kind: 'retyped', weekPlanSetId: 'set-2', type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 } }, 'chg-r')])
    await settle()
    expect(container.textContent).toContain('DROPSET · 1 DROP')
  })
})

describe('a set added in the session: its draft, its place and its type come back after a reload (DECISIONS 161, 170, 174)', () => {
  const PLAN = () => [plannedSet(1)]

  /** + ADD SET, type the numbers into the new row, LOG it. Returns the log the session would answer with. */
  async function addAndLog(c: HTMLElement, r: ReturnType<typeof recorder>, w: string, reps: string, existing: string[]): Promise<{ key: string; log: SetLog }> {
    await press(screen.getByText('ADD SET'))
    const key = addedKeys(c).find((k) => !existing.includes(k))!
    type(c, key, 'Weight', w)
    type(c, key, 'Reps', reps)
    await press(within(rowOf(c, key)).getByText('LOG'))
    return { key, log: addedLogOf(r.requests[r.requests.length - 1], { loggedAt: `2026-01-05T10:0${r.requests.length}:00Z` }) }
  }

  it('unlog an added set, reload: the row is still there at its position with its numbers (break: the draft keyed by the planned set only)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const first = renderCard({ plannedSets: PLAN(), logs: [headLogOf(1)], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    const a = await addAndLog(first.container, r, '50', '10', [])
    first.setLogs([headLogOf(1), a.log])
    await settle()
    await press(unlogButtonOf(first.container, a.key))
    expect(r.deleted).toEqual([a.log.id])
    first.setLogs([headLogOf(1)])
    await settle()
    expect(boxes(first.container, a.key)).toEqual(['50', '10', ''])
    const draft = [...world.drafts.values()][0]
    expect(draft.key).toMatchObject({ sessionId: 'session-1', localId: a.key.split(':')[2], exerciseId: 'ex-1' })
    expect(draft.values).toMatchObject({ weight: 50, reps: 10, type: { kind: 'normal' }, place: 1, loggedAt: a.log.loggedAt })
    expect(world.lists).toEqual({ 'pe-1': [{ localId: a.key.split(':')[2], logId: null, type: { kind: 'normal' }, place: 1 }] })

    first.unmount() // a reload
    const again = renderCard({ plannedSets: PLAN(), logs: [headLogOf(1)], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    expect(addedKeys(again.container)).toEqual([a.key])
    expect(rowLabels(again.container)).toEqual(['01', '02'])
    expect(boxes(again.container, a.key)).toEqual(['50', '10', ''])
    expect(greyBoxes(again.container, a.key)).toEqual([true, true, false])
  })

  it('add A and C, log both, unlog A, delete two planned sets before them, add a third set and leave it open, reload: A, C and the new set come back in that order, with their numbers (DECISIONS 170; break: the list not kept -> the new set is gone)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const plan = [plannedSet(1), plannedSet(2), plannedSet(3)]
    const base = () => [headLogOf(1), headLogOf(2), headLogOf(3)]
    const first = renderCard({ plannedSets: plan, logs: base(), store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    const a = await addAndLog(first.container, r, '50', '10', [])
    first.setLogs([...base(), a.log])
    const c = await addAndLog(first.container, r, '45', '12', [a.key])
    first.setLogs([...base(), a.log, c.log])
    await settle()
    await press(unlogButtonOf(first.container, a.key))
    first.setLogs([...base(), c.log])
    // delete planned 01 and 02 (the panel's DELETE, then W9's)
    for (const key of ['set:set-1', 'set:set-2']) {
      fireEvent.click(within(rowOf(first.container, key)).getByLabelText('Edit set'))
      fireEvent.click(within(rowOf(first.container, key)).getByText('DELETE'))
      await press(within(screen.getByRole('alertdialog')).getByText('DELETE SET'))
    }
    const afterDelete = [headLogOf(3, { setNumber: 1 }), { ...c.log, setNumber: 3 }]
    const changes = [held({ kind: 'deleted', weekPlanSetId: 'set-1' }, 'chg-1'), held({ kind: 'deleted', weekPlanSetId: 'set-2' }, 'chg-2')]
    first.setLogs(afterDelete)
    first.setChanges(changes)
    await settle()
    const third = await (async () => {
      await press(screen.getByText('ADD SET'))
      return addedKeys(first.container).find((k) => k !== a.key && k !== c.key)!
    })()
    await settle()
    expect(rowLabels(first.container)).toEqual(['01', '02', '03', '04']) // the planned 03 as 01, A (open) as 02, C as 03, the new set as 04

    first.unmount() // a reload
    const again = renderCard({ plannedSets: plan, logs: afterDelete, changes, store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    expect(addedKeys(again.container)).toEqual([a.key, c.key, third])
    expect(rowLabels(again.container)).toEqual(['01', '02', '03', '04'])
    expect(rowStates(again.container)).toEqual(['logged', 'current', 'logged', 'upcoming'])
    expect(boxes(again.container, a.key)).toEqual(['50', '10', ''])
  })

  it('in a reopened session (the card\'s list lost, the draft and the other logs still there) the unlogged set is still drawn in its place', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const first = renderCard({ plannedSets: PLAN(), logs: [headLogOf(1)], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    const a = await addAndLog(first.container, r, '50', '10', [])
    first.setLogs([headLogOf(1), a.log])
    const b = await addAndLog(first.container, r, '40', '8', [a.key])
    first.setLogs([headLogOf(1), a.log, b.log])
    await settle()
    await press(unlogButtonOf(first.container, a.key))
    await settle() // the list's last write lands a tick after the render that asked for it
    first.unmount()
    world.lists = null // the list is gone with the session's end; the draft stays (a session reopened on this phone)
    const again = renderCard({ plannedSets: PLAN(), logs: [headLogOf(1), b.log], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, writers: r.writers } })
    await settle()
    expect(addedKeys(again.container).map((k) => k.split(':')[2])).toEqual([a.key.split(':')[2], b.log.id]) // A by its draft, B by its log, A first (its place 1)
    expect(boxes(again.container, a.key)).toEqual(['50', '10', ''])
  })

  it('DELETE of an open added set that holds a draft takes the draft with it: after a reload it is not drawn again (break: the draft kept)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const first = renderCard({ plannedSets: PLAN(), logs: [headLogOf(1)], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    const a = await addAndLog(first.container, r, '50', '10', [])
    first.setLogs([headLogOf(1), a.log])
    await settle()
    await press(unlogButtonOf(first.container, a.key))
    first.setLogs([headLogOf(1)])
    await settle()
    fireEvent.click(within(rowOf(first.container, a.key)).getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('DELETE SET'))
    await press(within(screen.getByRole('alertdialog')).getByText('DELETE SET'))
    await settle()
    expect(world.drafts.size).toBe(0)
    first.unmount()
    const again = renderCard({ plannedSets: PLAN(), logs: [headLogOf(1)], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, writers: r.writers } })
    await settle()
    expect(addedKeys(again.container)).toEqual([])
  })

  /** A and B added (places 1, 2) and logged, A unlogged, C added (place 3, left open). */
  async function unloggedAWithCAdded() {
    const world = newDraftWorld()
    const r = recorder()
    const mount = () => renderCard({ plannedSets: PLAN(), logs: [headLogOf(1)], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    const first = mount()
    await settle()
    const a = await addAndLog(first.container, r, '50', '10', [])
    first.setLogs([headLogOf(1), a.log])
    const b = await addAndLog(first.container, r, '40', '8', [a.key])
    first.setLogs([headLogOf(1), a.log, b.log])
    await settle()
    expect([a.log.addedPlace, b.log.addedPlace]).toEqual([1, 2])
    await press(unlogButtonOf(first.container, a.key))
    first.setLogs([headLogOf(1), b.log])
    await settle()
    await press(screen.getByText('ADD SET')) // C: place 3
    await settle()
    return { world, r, first, a, b, mount }
  }

  it('added place: add A and B (places 1, 2), log both, unlog A, add C (place 3), log A again: its new log holds place 1, not 4 (DECISIONS 174; break: recomputed at the re-log)', async () => {
    const { r, first, a } = await unloggedAWithCAdded()
    await press(within(rowOf(first.container, a.key)).getByText('LOG'))
    const relog = r.requests[r.requests.length - 1]
    expect(relog).toMatchObject({ addedPlace: 1, setNumber: 2, weight: 50, reps: 10 })
    expect(relog.id).toBeTruthy()
    expect(relog.id).not.toBe(a.log.id) // a new log row, a new id
  })

  it('the same after a reload: the place comes from the phone\'s copy, not from a recount', async () => {
    const { r, first, a, b, world } = await unloggedAWithCAdded()
    first.unmount()
    const again = renderCard({ plannedSets: PLAN(), logs: [headLogOf(1), b.log], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    await press(within(rowOf(again.container, a.key)).getByText('LOG'))
    expect(r.requests[r.requests.length - 1]).toMatchObject({ addedPlace: 1, setNumber: 2, weight: 50, reps: 10 })
  })

  it('an added set that only its log names (a reopened session) is taken into the list when it is unlogged, so its row keeps its key across the new log (46r header; break: not taken in)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const b = logOf({ id: 'log-b', weekPlanSetId: null, setNumber: 2, weight: 40, reps: 8, addedPlace: 1, loggedAt: '2026-01-05T10:05:00Z' })
    const { container, setLogs } = renderCard({ plannedSets: PLAN(), logs: [headLogOf(1), b], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    expect(addedKeys(container)).toEqual(['added:pe-1:log-b'])
    await press(unlogButtonOf(container, 'added:pe-1:log-b'))
    setLogs([headLogOf(1)])
    await settle()
    expect(addedKeys(container)).toEqual(['added:pe-1:log-b'])
    await press(within(rowOf(container, 'added:pe-1:log-b')).getByText('LOG'))
    expect(r.requests[0]).toMatchObject({ addedPlace: 1 })
    setLogs([headLogOf(1), addedLogOf(r.requests[0])])
    await settle()
    expect(addedKeys(container)).toEqual(['added:pe-1:log-b']) // the set is still the one the list names, under its first id, not the new log's
  })

  it('a set added before 1.2 (no place) is unlogged: nothing else moves, its draft keeps the log\'s time, and the re-log names no time of its own, so it is drawn after the other old sets (DECISIONS 184 (b); break: the draft\'s earlier time written back)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const old = (n: number, hour: number) => logOf({ id: `old-${n}`, weekPlanSetId: null, setNumber: n, addedPlace: null, loggedAt: `2026-01-05T${String(hour).padStart(2, '0')}:00:00Z` })
    const olds = [old(2, 8), old(3, 9), old(4, 10)]
    const { container, setLogs } = renderCard({ plannedSets: [plannedSet(1)], logs: [headLogOf(1), ...olds], store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, onLog: r.onLog, writers: r.writers } })
    await settle()
    expect(rowLabels(container)).toEqual(['01', '02', '03', '04'])
    await press(unlogButtonOf(container, 'added:pe-1:old-3'))
    expect(r.deleted).toEqual(['old-3'])
    for (const writer of ['patchNumbers', 'writeChanges', 'clearStageKind', 'patchLog'] as const) expect(r.writers[writer]).not.toHaveBeenCalled() // it changes no other row
    expect([...world.drafts.values()][0].values).toMatchObject({ place: null, loggedAt: '2026-01-05T09:00:00Z' })
    setLogs([headLogOf(1), olds[0], olds[2]])
    await settle()
    expect(rowLabels(container)).toEqual(['01', '02', '03', '04']) // the unlog moved nothing: 03 is open in its place
    expect(rowStates(container)).toEqual(['logged', 'logged', 'current', 'logged'])
    await press(within(rowOf(container, 'added:pe-1:old-3')).getByText('LOG'))
    expect(r.requests).toHaveLength(1)
    expect(Object.keys(r.requests[0])).not.toContain('loggedAt') // the write stamps the time it happens (useLogSet / logSet)
    expect(r.requests[0].addedPlace ?? null).toBeNull()
    // the session's answer: the new log is the newest, so the set now follows the other old sets
    const relogged = logOf({ id: 'new-log', weekPlanSetId: null, setNumber: 3, weight: 60, reps: 8, addedPlace: null, loggedAt: '2026-01-05T11:30:00Z' })
    setLogs([headLogOf(1), olds[0], olds[2], relogged])
    await settle()
    expect(addedKeys(container).map((k) => k.split(':')[2])).toEqual(['old-2', 'old-4', 'new-log'])
  })
})

describe('the drafts of a set\'s drops follow their drops (DECISIONS 147 (b); the second review\'s "a drop\'s draft key once an earlier drop was deleted")', () => {
  it('delete drop 1 of three after drops 2 and 3 were unlogged: their drafts move down one with them (break: the drafts keep their numbers)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const plan = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedDrop(1, 2), plannedDrop(1, 3)]
    const all = () => [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1, { weight: 50, reps: 10 }), dropLog(1, 2, { weight: 45, reps: 11 }), dropLog(1, 3, { weight: 40, reps: 12 })]
    const { container, setLogs } = renderCard({ plannedSets: plan, logs: all(), store: fakeDraftStore(world), props: { onDeleteSet: r.onDeleteSet, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-1:stage:3'))
    setLogs(all().slice(0, 3))
    await press(unlogButtonOf(container, 'set:set-1:stage:2'))
    setLogs(all().slice(0, 2))
    await settle()
    expect(draftIds(world)).toEqual(['session-1|p:set-1:d2', 'session-1|p:set-1:d3'])
    fireEvent.click(within(rowOf(container, 'set:set-1:stage:1')).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(container, 'set:set-1:stage:1')).getByText('DELETE'))
    await press(within(screen.getByRole('alertdialog')).getByText('DELETE SET'))
    await settle()
    expect(draftIds(world)).toEqual(['session-1|p:set-1:d1', 'session-1|p:set-1:d2'])
    expect([...world.drafts.values()].map((d) => [d.id, (d.values as { weight: number }).weight])).toEqual(expect.arrayContaining([['session-1|p:set-1:d1', 45], ['session-1|p:set-1:d2', 40]]))
  })
})

// Chunk 63's review (R3, R4): every test above is in kg, where the draft's figure and the figure on the screen agree. On an lbs exercise 9 kg shows as
// 19.8 lbs, and 19.8 converted again is 8.98 kg (RULES, 54a's round-trip rule): a LOG that leaves the weight as shown must send the draft's own kg.
describe('LOG again on an lbs exercise sends the draft\'s own kg when the weight is left as shown (9 kg shows as 19.8 lbs and goes back as 9, not 8.98)', () => {
  const lbs = exerciseOf({ weightUnit: 'lbs' })

  it('a working set: the unlogged 9 kg reads 19.8 in the box, and LOG sends weight 9 (break: every LOG converts the shown figure)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const { container, setLogs } = renderCard({ plannedSets: [plannedSet(1), plannedSet(2)], logs: [headLogOf(1, { weight: 9, reps: 10, rir: 1 })], store: fakeDraftStore(world), props: { programExercise: lbs, onLog: r.onLog, onDeleteSet: r.onDeleteSet, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-1'))
    setLogs([])
    await settle()
    expect(boxes(container, 'set:set-1')).toEqual(['19.8', '10', '1'])
    await press(within(rowOf(container, 'set:set-1')).getByText('LOG'))
    expect(r.requests[0]).toMatchObject({ weekPlanSetId: 'set-1', weight: 9, reps: 10, rir: 1 })
  })

  it('a warmup (rows mode): the same, LOG sends the warmup with weight 9 (break: the warmup row converts the shown figure again)', async () => {
    useSettingsStore.setState({ ...DEFAULT_SETTINGS, warmupDisplay: 'rows' })
    const world = newDraftWorld()
    const r = recorder()
    const { container, setLogs } = renderCard({ plannedSets: [plannedSet(1, { isWarmup: true }), plannedSet(2)], logs: [headLogOf(1, { isWarmup: true, weight: 9, reps: 10 })], store: fakeDraftStore(world), props: { programExercise: lbs, onLog: r.onLog, onDeleteSet: r.onDeleteSet, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-1'))
    setLogs([])
    await settle()
    expect((within(rowOf(container, 'set:set-1')).getByLabelText('Weight') as HTMLInputElement).value).toBe('19.8')
    await press(within(rowOf(container, 'set:set-1')).getByText('LOG'))
    expect(r.requests[0]).toMatchObject({ weekPlanSetId: 'set-1', isWarmup: true, weight: 9, reps: 10 })
  })
})

// Chunk 63's review (R2): the drop's own LOG after its UNLOG is a write of its own (`logStage`), and clears the draft like the head's does.
describe('a drop logged again after its UNLOG leaves no draft on the phone', () => {
  it('unlog drop 2, log it again with the draft\'s numbers: the draft is gone (break: logStage writes without clearing the draft)', async () => {
    const world = newDraftWorld()
    const r = recorder()
    const plan = [plannedSet(1, { stageKind: 'dropset' }), plannedDrop(1, 1), plannedDrop(1, 2)]
    const logs = () => [headLogOf(1, { stageKind: 'dropset' }), dropLog(1, 1, { weight: 50, reps: 10 }), dropLog(1, 2, { weight: 40, reps: 12, rir: 1 })]
    const { container, setLogs } = renderCard({ plannedSets: plan, logs: logs(), store: fakeDraftStore(world), props: { onLog: r.onLog, onDeleteSet: r.onDeleteSet, writers: r.writers } })
    await settle()
    await press(unlogButtonOf(container, 'set:set-1:stage:2'))
    expect(draftIds(world)).toEqual(['session-1|p:set-1:d2'])
    setLogs(logs().slice(0, 2)) // the session's answer: the drop's log is gone
    await settle()
    await press(within(rowOf(container, 'set:set-1:stage:2')).getByText('LOG'))
    expect(r.requests[0]).toMatchObject({ weight: 40, reps: 12, rir: 1 })
    expect(draftIds(world)).toEqual([])
  })
})
