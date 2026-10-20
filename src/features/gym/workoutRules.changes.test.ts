import { describe, expect, it } from 'vitest'
import type { SessionSetChangeRecord } from '../../types'
import { applySetTypeChange, changeColumns, deleteEffects, unlogEffects, type HeldChange } from './workoutRules'
import { FakeServer, PgError } from './workoutRules.server.testutil'
import { SESSION, addedLog, brief, card, dropLog, headLog, held, orderOf, pending, retyped, rowKeyed, staged, viewOf } from './workoutRules.testutil'

// Chunk 46: the change rows (042's `v2_session_set_changes`; Adam's data-model rules, 2026-10-14 and 15):
// one row per planned set per session; a "retyped" row keyed by the planned set whether or not the set is
// logged; a later delete turns it into "deleted" in one write that clears the type, on the row's own id; an
// added set never gets a "retyped" row. Here: the columns a change is written as, and the stand-in that refuses
// what the table refuses (proved against hand-built rows, so a test that applies to it means something). The walk
// through many sessions that applies every write the rules return is DECISIONS 170's sequence test
// (`workoutRules.sequence.test.ts`).

describe('changeColumns: the whole row a change is written as', () => {
  it('a deleted set carries no type: every column the type touches is cleared', () => {
    expect(changeColumns({ kind: 'deleted', weekPlanSetId: 'p1' })).toEqual({
      kind: 'deleted',
      weekPlanSetId: 'p1',
      setLogId: null,
      isWarmup: false,
      stageKind: null,
      stageCount: 0,
    })
  })

  it('a retyped set carries its type: a warmup, Normal, or a stage kind with its count', () => {
    const cols = (type: Parameters<typeof retyped>[2]) => changeColumns(retyped('bench', 1, type))
    expect(cols({ kind: 'warmup' })).toEqual({ kind: 'retyped', weekPlanSetId: 'bench.1', setLogId: null, isWarmup: true, stageKind: null, stageCount: 0 })
    expect(cols({ kind: 'normal' })).toEqual({ kind: 'retyped', weekPlanSetId: 'bench.1', setLogId: null, isWarmup: false, stageKind: null, stageCount: 0 })
    expect(cols(staged('myo_reps', 3))).toEqual({ kind: 'retyped', weekPlanSetId: 'bench.1', setLogId: null, isWarmup: false, stageKind: 'myo_reps', stageCount: 3 })
  })

  it('a pending_stages row is keyed by the log alone and is never a warmup', () => {
    const head = headLog('bench', 1)
    expect(changeColumns(pending(head, 'cluster', 2))).toEqual({
      kind: 'pending_stages',
      weekPlanSetId: null,
      setLogId: head.id,
      isWarmup: false,
      stageKind: 'cluster',
      stageCount: 2,
    })
  })

  it('every change the rules return is accepted by the table\'s checks', () => {
    const head = headLog('bench', 1)
    const server = new FakeServer({ logs: [head] })
    for (const change of [
      { kind: 'deleted', weekPlanSetId: 'bench.2' },
      { kind: 'retyped', weekPlanSetId: 'bench.3', type: { kind: 'warmup' } },
      { kind: 'retyped', weekPlanSetId: 'bench.4', type: { kind: 'normal' } },
      { kind: 'retyped', weekPlanSetId: 'bench.5', type: staged('dropset', 1) },
      pending(head, 'rest_pause', 2),
    ] as const) {
      expect(() => server.upsertChange({ change, id: null })).not.toThrow()
    }
  })
})

describe('the stand-in for the table refuses what the table refuses (so applying to it proves something)', () => {
  const head = headLog('bench', 1)
  const seeded = () => new FakeServer({ logs: [head], changes: [held(retyped('bench', 1, { kind: 'warmup' }), 'c1'), held(pending(head, 'dropset', 1), 'c2')] })

  it('one row per planned set and one per log: the same key under another id is a duplicate (23505)', () => {
    expect(() => seeded().upsertChange({ change: { kind: 'retyped', weekPlanSetId: 'bench.1', type: { kind: 'normal' } }, id: null })).toThrow(/23505/)
    expect(() => seeded().upsertChange({ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: 'c9' })).toThrow(/23505/)
    expect(() => seeded().upsertChange({ change: pending(head, 'cluster', 2), id: null })).toThrow(/23505/)
  })

  it('the same key on the row\'s own id is an update, not a duplicate', () => {
    const server = seeded()
    server.upsertChange({ change: { kind: 'deleted', weekPlanSetId: 'bench.1' }, id: 'c1' })
    expect(server.rows.filter((r) => r.weekPlanSetId === 'bench.1')).toHaveLength(1)
  })

  it('a deleted row that holds a type, a warmup that is staged and a stage kind without its count are refused (23514)', () => {
    const server = seeded()
    expect(() => server.updateChange('c1', { kind: 'deleted' })).toThrow(/deleted_check/)
    expect(() => server.updateChange('c1', { stageKind: 'dropset', stageCount: 2 })).toThrow(/warmup_check/)
    expect(() => server.updateChange('c2', { stageCount: 0 })).toThrow(/stage_pair_check/)
    expect(() => server.updateChange('c2', { weekPlanSetId: 'bench.1' })).toThrow(/keys_check/)
    expect(() => server.updateChange('c1', { setLogId: head.id })).toThrow(/keys_check/)
  })

  it('a head is not deleted before its drops (the client\'s order), and a deleted log takes its pending_stages row', () => {
    const drop = dropLog(head, 1)
    const server = new FakeServer({ logs: [head, drop], changes: [held(pending(head, 'dropset', 1), 'c2')] })
    expect(() => server.deleteLog(head.id)).toThrow(PgError)
    server.deleteLog(drop.id)
    expect(server.rows).toHaveLength(1)
    server.deleteLog(head.id)
    expect(server.rows).toEqual([])
  })

  it('an insert of a log is held to the same checks: a working set with no weight (23514), a reused id (23505), a drop whose head is not there (23503)', () => {
    const server = new FakeServer({ logs: [head] })
    expect(() => server.insertLog(headLog('bench', 2, { weight: null }))).toThrow(/23514.*v2_set_logs_check/)
    expect(() => server.insertLog({ ...head })).toThrow(/23505/)
    expect(() => server.insertLog(dropLog(headLog('bench', 9), 1))).toThrow(/23503/)
    // a warmup may hold no numbers, and a drop under a head that is there is taken
    expect(() => server.insertLog(headLog('bench', 2, { warmup: true, weight: null, reps: null }))).not.toThrow()
    expect(() => server.insertLog(dropLog(head, 1))).not.toThrow()
    expect(server.logs).toHaveLength(3)
  })

  it('a pending_stages row for a log that is not there is refused (23503)', () => {
    expect(() => new FakeServer({ logs: [] }).upsertChange({ change: pending(head, 'dropset', 1), id: null })).toThrow(/23503/)
  })
})

describe('a stored change record is a held change as it is, and a change without its row\'s id is not', () => {
  it('SessionSetChangeRecord is assignable to HeldChange without a cast', () => {
    const record: SessionSetChangeRecord = {
      kind: 'retyped',
      weekPlanSetId: 'bench.1',
      type: { kind: 'warmup' },
      id: 'c1',
      userId: 'u1',
      sessionId: SESSION,
      createdAt: '2026-10-12T18:00:00Z',
      updatedAt: '2026-10-12T18:00:00Z',
    }
    const changes: HeldChange[] = [record]
    const view = viewOf(orderOf([card('bench', 'n n')]), [], changes)
    expect(view.rows.map(brief)).toEqual(['bench W1·', 'bench 01·'])
  })

  it('the rules that write take changes with their ids (proved under `tsc`, which a break proof must also run)', () => {
    // @ts-expect-error a change handed over without the id of its stored row can't be written over that row
    const noIds: HeldChange[] = [retyped('bench', 1, { kind: 'warmup' })]
    expect(noIds).toHaveLength(1)
  })
})

describe('an added set never gets a "retyped" row, whatever is done to it', () => {
  it('type changes, a delete and an unlog write no "retyped" change for a set added in the session', () => {
    const picks = [{ kind: 'normal' }, { kind: 'warmup' }, staged('dropset', 2), staged('cluster', 1)] as const
    for (const logged of [false, true]) {
      const head = addedLog('bench', 1, { number: 2 })
      const cards = [card('bench', 'n', { added: [logged ? head : { kind: 'normal' }] })]
      const view = viewOf(orderOf(cards), logged ? [headLog('bench', 1), head] : [])
      const row = rowKeyed(view, 'added:bench:a1')
      for (const pick of picks) {
        const writes = applySetTypeChange({ row, pick, session: view }).changes
        expect(writes.map((w) => w.change.kind).filter((k) => k !== 'pending_stages')).toEqual([])
      }
      expect(deleteEffects(row, view).changes).toEqual([])
      if (logged) {
        expect(unlogEffects({ ...row, type: staged('dropset', 1), retyped: true }, view).changes).toEqual([])
      }
    }
  })
})
