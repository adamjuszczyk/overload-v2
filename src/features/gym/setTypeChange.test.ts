import { describe, it, expect, vi } from 'vitest'
import { applySetTypeChange, type TypedNumbers } from './workoutRules'
import { RequiresConnectionError, fromPickerType, runTypeChange, toPickerType, typeConfirm, type TypeChangeDeps } from './setTypeChange'
import { addedLog, card, dropLog, headLog, held, orderOf, pending, retyped, rowKeyed, staged, viewOf } from './workoutRules.testutil'
import type { SessionSetChangeType, SetLog } from '../../types'

// Chunk 62 — what a set's new type writes, and in which order (TASKS-1.2 62; setTypeChange.ts), over what 46r's `applySetTypeChange` says (its own tests: workoutRules.setType.test.ts).
// The writers are spies that record the order; the "card" is a bench of three planned sets unless a test says.

const BENCH = () => card('bench', 'n n n')

function run(
  key: string,
  pick: SessionSetChangeType,
  logs: SetLog[],
  o: { order?: ReturnType<typeof BENCH>[]; changes?: ReturnType<typeof held>[]; numbers?: TypedNumbers; online?: boolean; fail?: string } = {},
) {
  const calls: string[] = []
  const view = viewOf(orderOf(o.order ?? [BENCH()]), logs, o.changes ?? [])
  const row = rowKeyed(view, key)
  const effects = applySetTypeChange({ row, pick, session: view, ...(o.numbers === undefined ? {} : { numbers: o.numbers }) })
  const step = (label: string, text: string) => {
    calls.push(`${label} ${text}`)
    if (o.fail === label) throw new Error(`${label} refused`)
  }
  const deps: TypeChangeDeps = {
    writers: {
      online: o.online ?? true,
      patchLog: vi.fn(async (id, changes) => step('log', `${id} ${JSON.stringify(changes)}`)),
      writeChanges: vi.fn(async (writes) => step('changes', writes.map((w) => `${w.change.kind}${w.id === null ? '' : `#${w.id}`}`).join(','))),
      patchNumbers: vi.fn(async (patches) => step('numbers', patches.map((p) => `${p.id}=${p.setNumber}`).join(','))),
    },
    deleteLog: vi.fn(async (log) => step('delete', `${log.id} under ${log.parentSetId}`)),
    keepAddedType: vi.fn((type) => void calls.push(`keep ${JSON.stringify(type)}`)),
  }
  return { calls, deps, row, effects, done: () => runTypeChange(row, effects, deps) }
}

describe('a logged head: the log patch first, then the drops that go, the rows, the numbers (G47: online only)', () => {
  it('Dropset on a logged planned set: the patch, then its `retyped` and `pending_stages` rows; no delete, no renumber', async () => {
    const t = run('set:bench.2', staged('dropset', 2), [headLog('bench', 1), headLog('bench', 2)])
    await t.done()
    expect(t.calls).toEqual(['log log.bench.2 {"isWarmup":false,"stageKind":"dropset"}', 'changes retyped,pending_stages'])
    expect(t.deps.keepAddedType).not.toHaveBeenCalled()
  })

  it('Normal on a dropset with two logged drops (the confirmed answer): the patch BEFORE any delete, the drops last first, the Normal row', async () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const t = run('set:bench.1', { kind: 'normal' }, [head, dropLog(head, 1), dropLog(head, 2)], { order: [card('bench', 'd2 n')] })
    expect(t.effects.needsConfirm).toBe(true)
    await t.done()
    expect(t.calls).toEqual([
      'log log.bench.1 {"isWarmup":false,"stageKind":null}',
      'delete log.bench.1.d2 under log.bench.1',
      'delete log.bench.1.d1 under log.bench.1',
      'changes retyped',
    ])
  })

  it('the first refusal stops the rest: a refused patch deletes no drop and writes no row; a refused delete writes no row', async () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const logs = [head, dropLog(head, 1)]
    const first = run('set:bench.1', { kind: 'normal' }, logs, { order: [card('bench', 'd1 n')], fail: 'log' })
    await expect(first.done()).rejects.toThrow('log refused')
    expect(first.calls).toEqual(['log log.bench.1 {"isWarmup":false,"stageKind":null}'])
    const second = run('set:bench.1', { kind: 'normal' }, logs, { order: [card('bench', 'd1 n')], fail: 'delete' })
    await expect(second.done()).rejects.toThrow('delete refused')
    expect(second.calls.map((c) => c.split(' ')[0])).toEqual(['log', 'delete'])
    const third = run('set:bench.2', { kind: 'warmup' }, [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)], { fail: 'changes' })
    await expect(third.done()).rejects.toThrow('changes refused')
    expect(third.calls.map((c) => c.split(' ')[0])).toEqual(['log', 'changes']) // no renumber after a refused row
  })

  it('Warmup on the logged 02 of 01–03: the patch, the row, then the logged 03 to 2 and 02\'s own log to its warmup number', async () => {
    const t = run('set:bench.2', { kind: 'warmup' }, [headLog('bench', 1), headLog('bench', 2), headLog('bench', 3)])
    await t.done()
    expect(t.calls).toEqual(['log log.bench.2 {"isWarmup":true,"stageKind":null}', 'changes retyped', 'numbers log.bench.2=1,log.bench.3=2'])
  })

  it('an added logged set: its patch and its `pending_stages` row alone (no planned set, no `retyped` row)', async () => {
    const t = run('added:bench:a1', staged('myo_reps', 3), [headLog('bench', 1), addedLog('bench', 4, { place: 1 })], { order: [card('bench', 'n n n', { added: [addedLog('bench', 4, { place: 1 })] })] })
    await t.done()
    expect(t.calls).toEqual(['log log.bench.added4 {"isWarmup":false,"stageKind":"myo_reps"}', 'changes pending_stages'])
  })

  it('a warmup with no numbers made a working set sends the two numbers in the patch (152)', async () => {
    const numberless = headLog('bench', 1, { warmup: true, weight: null, reps: null })
    const t = run('set:bench.1', { kind: 'normal' }, [numberless], { order: [card('bench', 'w')], numbers: { weight: 40, reps: 6 } })
    await t.done()
    expect(t.calls[0]).toBe('log log.bench.1 {"isWarmup":false,"stageKind":null,"weight":40,"reps":6}')
  })

  it('with no connection it is refused before any request, with the reason the panel gives', async () => {
    const t = run('set:bench.1', staged('dropset', 1), [headLog('bench', 1)], { online: false })
    await expect(t.done()).rejects.toBeInstanceOf(RequiresConnectionError)
    await expect(t.done()).rejects.toThrow('Requires a connection')
    expect(t.calls).toEqual([])
  })

  it('a change that is the type the set already has writes nothing', async () => {
    const t = run('set:bench.1', { kind: 'normal' }, [headLog('bench', 1)])
    await t.done()
    expect(t.calls).toEqual([])
  })
})

describe('an upcoming set: the row (planned) or the card\'s own state (added), and the numbers; works offline (168 (a))', () => {
  it('a planned set: its `retyped` row, replacing the row the session holds by id; then the renumber', async () => {
    const t = run('set:bench.1', { kind: 'warmup' }, [headLog('bench', 2)], { changes: [held(retyped('bench', 1, staged('dropset', 2)), 'chg-9')] })
    await t.done()
    expect(t.calls).toEqual(['changes retyped#chg-9', 'numbers log.bench.2=1'])
    expect(t.deps.writers.patchLog).not.toHaveBeenCalled()
    expect(t.deps.deleteLog).not.toHaveBeenCalled()
  })

  it('it is the same offline: nothing in it asks for a connection (the writers queue)', async () => {
    const t = run('set:bench.1', staged('rest_pause', 2), [], { online: false })
    await t.done()
    expect(t.calls).toEqual(['changes retyped'])
  })

  it('an added set not logged: its type is kept by the card and nothing is written; the logged sets after it still renumber', async () => {
    const order = [card('bench', 'n', { added: [{ kind: 'normal' }] })]
    const t = run('added:bench:a1', { kind: 'warmup' }, [headLog('bench', 1)], { order })
    await t.done()
    expect(t.calls).toEqual(['keep {"kind":"warmup"}'])
    expect(t.deps.writers.writeChanges).not.toHaveBeenCalled()
  })

  it('a logged drop\'s head with its pending row held is replaced by that row\'s id, not written twice', async () => {
    const head = headLog('bench', 1, { stageKind: 'dropset' })
    const t = run('set:bench.1', staged('dropset', 3), [head], { order: [card('bench', 'd1 n')], changes: [held(pending(head, 'dropset', 1), 'chg-4')] })
    await t.done()
    expect(t.calls[1]).toBe('changes retyped,pending_stages#chg-4')
  })
})

describe('the picker\'s type and the stored type', () => {
  it('map both ways; the rest between stages is not stored', () => {
    expect(toPickerType(null)).toEqual({ kind: 'normal' })
    expect(toPickerType({ kind: 'warmup' })).toEqual({ kind: 'warmup' })
    expect(toPickerType(staged('cluster', 3))).toEqual({ kind: 'staged', stageKind: 'cluster', stageCount: 3, stageRestSeconds: null })
    expect(fromPickerType({ kind: 'staged', stageKind: 'cluster', stageCount: 3, stageRestSeconds: 45 })).toEqual(staged('cluster', 3))
    expect(fromPickerType({ kind: 'normal' })).toEqual({ kind: 'normal' })
  })
})

describe('the question 19c asks (no board draws it; D31)', () => {
  const rowOfDropset = () => rowKeyed(viewOf(orderOf([card('bench', 'd2')]), [headLog('bench', 1, { stageKind: 'dropset' })]), 'set:bench.1')
  it('says how many logged drops go, in the words of TASKS 62, with W9\'s note and a button that names them', () => {
    expect(typeConfirm(rowOfDropset(), 2)).toEqual({
      eyebrow: 'BENCH · SET 01',
      title: 'Delete the 2 logged drops?',
      body: "Only today's session changes; the plan stays the same.",
      confirmLabel: 'DELETE 2 DROPS',
    })
    expect(typeConfirm(rowOfDropset(), 1)).toMatchObject({ title: 'Delete the 1 logged drop?', confirmLabel: 'DELETE DROP' })
  })

  it('calls a stage of any other kind a stage', () => {
    const row = rowKeyed(viewOf(orderOf([card('bench', 'r2')]), [headLog('bench', 1, { stageKind: 'rest_pause' })]), 'set:bench.1')
    expect(typeConfirm(row, 2)).toMatchObject({ title: 'Delete the 2 logged stages?', confirmLabel: 'DELETE 2 STAGES' })
    expect(typeConfirm(row, 1)).toMatchObject({ title: 'Delete the 1 logged stage?', confirmLabel: 'DELETE STAGE' })
  })
})
