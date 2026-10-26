import { describe, it, expect, vi } from 'vitest'
import { NeedsConnectionError, runDelete, type DeleteDeps } from './setDelete'
import type { DeleteEffects } from './workoutRules'

// Chunk 61 — `runDelete`, the order a delete is sent in (TASKS-1.2 61: "the stages then the head ... then the renumber patches"; setDelete.ts's header): the
// logs from the last drop to the head, the head's stage kind, the change rows, the renumber. Every write is awaited before the next starts and the first
// refusal stops the rest, which only a writer that doesn't answer at once can show: each write here is a gate the test opens.
const effects = (over: Partial<DeleteEffects> = {}): DeleteEffects => ({
  deleteOrder: [{ id: 'drop', parentSetId: 'head' }, { id: 'head', parentSetId: null }] as unknown as DeleteEffects['deleteOrder'],
  stageCount: 1,
  renumber: [{ id: 'later', setNumber: 2 }],
  changes: [{ change: { kind: 'deleted', weekPlanSetId: 'p1' }, id: null }],
  headPatch: { id: 'other-head', stageKind: null },
  type: null,
  ...over,
})

type Step = 'delete drop' | 'delete head' | 'stage kind' | 'change rows' | 'numbers'
const STEPS: Step[] = ['delete drop', 'delete head', 'stage kind', 'change rows', 'numbers']

/** Every writer is a gate: it records that it started, and settles when the test says so. */
function gated(online = true) {
  const started: Step[] = []
  const gates = new Map<Step, { open: () => void; fail: (err: Error) => void }>()
  const gate = (step: Step) =>
    new Promise<void>((resolve, reject) => {
      started.push(step)
      gates.set(step, { open: resolve, fail: reject })
    })
  const deps: DeleteDeps = {
    deleteLog: (log) => gate(log.id === 'drop' ? 'delete drop' : 'delete head'),
    writers: {
      online,
      writeChanges: () => gate('change rows'),
      patchNumbers: () => gate('numbers'),
      clearStageKind: () => gate('stage kind'),
    },
  }
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5))
  return { deps, started, gates, tick }
}

describe('runDelete', () => {
  it('sends each write only once the one before it has been answered: the drop, the head, its stage kind, the change rows, the numbers', async () => {
    const { deps, started, gates, tick } = gated()
    let done = false
    const run = runDelete(effects(), deps).then(() => void (done = true))
    for (let i = 0; i < STEPS.length; i++) {
      await tick()
      expect(started).toEqual(STEPS.slice(0, i + 1)) // nothing after the open step has started
      expect(done).toBe(false)
      gates.get(STEPS[i])!.open()
    }
    await run
    expect(done).toBe(true)
    expect(started).toEqual(STEPS)
  })

  it.each(STEPS.map((step, index) => [step, index] as const))('a refusal at "%s" stops everything after it and is thrown with its reason', async (step, index) => {
    const { deps, started, gates, tick } = gated()
    const run = runDelete(effects(), deps)
    const refused = expect(run).rejects.toThrow('permission denied')
    for (let i = 0; i < index; i++) {
      await tick()
      gates.get(STEPS[i])!.open()
    }
    await tick()
    gates.get(step)!.fail(new Error('permission denied'))
    await refused
    await tick()
    expect(started).toEqual(STEPS.slice(0, index + 1))
  })

  it('a write that has nothing to write is not made: no change rows, no renumber, no stage kind', async () => {
    const { deps, started, gates, tick } = gated()
    const run = runDelete(effects({ changes: [], renumber: [], headPatch: null }), deps)
    await tick()
    gates.get('delete drop')!.open()
    await tick()
    gates.get('delete head')!.open()
    await run
    expect(started).toEqual(['delete drop', 'delete head'])
  })

  it('a delete that needs a connection and has none writes nothing at all and says so; with nothing to patch it is sent like any other offline', async () => {
    const offline = gated(false)
    await expect(runDelete(effects(), offline.deps)).rejects.toBeInstanceOf(NeedsConnectionError)
    await expect(runDelete(effects(), offline.deps)).rejects.toThrow('Requires a connection')
    expect(offline.started).toEqual([])
    const sendable = gated(false)
    const run = runDelete(effects({ headPatch: null }), sendable.deps)
    for (const step of ['delete drop', 'delete head', 'change rows', 'numbers'] as const) {
      await sendable.tick()
      sendable.gates.get(step)!.open()
    }
    await run
    expect(sendable.started).toEqual(['delete drop', 'delete head', 'change rows', 'numbers'])
  })

  it('hands each log to the delete with its id and its head, the drops first (the queue names a drop\'s head)', async () => {
    const deleteLog = vi.fn(async (_log: { id: string; parentSetId: string | null }) => {})
    await runDelete(effects({ changes: [], renumber: [], headPatch: null }), {
      deleteLog,
      writers: { online: true, writeChanges: async () => {}, patchNumbers: async () => {}, clearStageKind: async () => {} },
    })
    expect(deleteLog.mock.calls.map(([log]) => [log.id, log.parentSetId])).toEqual([['drop', 'head'], ['head', null]])
  })
})
