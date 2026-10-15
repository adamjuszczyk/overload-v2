import { describe, expect, it } from 'vitest'
import type { SessionSetChangeRecord, SetLog } from '../../types'
import {
  applySetTypeChange,
  canUnlog,
  changeColumns,
  currentSet,
  deleteEffects,
  finishWarning,
  resolveRows,
  unlogEffects,
  type HeldChange,
  type OrderExercise,
  type ResolvedRow,
} from './workoutRules'
import { FakeServer, PgError } from './workoutRules.server.testutil'
import { SESSION, addedLog, brief, card, dropLog, exerciseIdOf, headLog, held, orderOf, pending, retyped, rowKeyed, staged, viewOf } from './workoutRules.testutil'

// Chunk 46: the change rows (042's `v2_session_set_changes`; Adam's data-model rules, 2026-10-14 and 15):
// one row per planned set per session; a "retyped" row keyed by the planned set whether or not the set is
// logged; a later delete turns it into "deleted" in one write that clears the type, on the row's own id; an
// added set never gets a "retyped" row. Here: the columns a change is written as, the stand-in that refuses
// what the table refuses (proved against hand-built rows, so a test that applies to it means something), and
// a walk through many sessions that applies every write the rules return.

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
  const cards = [card('bench', 'n', { added: 1 })]

  it('type changes, a delete and an unlog write no "retyped" change for a set added in the session', () => {
    const picks = [{ kind: 'normal' }, { kind: 'warmup' }, staged('dropset', 2), staged('cluster', 1)] as const
    for (const logged of [false, true]) {
      const head = addedLog('bench', 1, { number: 2 })
      const view = viewOf(orderOf(cards), logged ? [headLog('bench', 1), head] : [])
      const row = rowKeyed(view, 'added:bench:1')
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

// ─── A walk through many sessions ───────────────────────────────────────────────────────────────
// Every step of every walk applies what a rule returns to the stand-in (a write the table would refuse
// throws) and then checks what must hold afterwards. The walk logs, switches types, adds sets, deletes sets and
// drops and unlogs drops, on a session with a superset, a card with warmups and drops, and added sets.
// (Unlogging a whole set is not in the walk: unlog keeps the logged sets' numbers, so it leaves a gap in them,
// which chunk 46's report asks about.)

function walker(seed: number) {
  let state = seed >>> 0
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 2 ** 32
  }
  return {
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number): boolean => next() < p,
  }
}

const WALK_CARDS = (added: Record<string, number>): OrderExercise[] => [
  card('bench', 'w w n n d2 n', { added: added.bench }),
  card('row', 'n n n', { added: added.row }),
  card('lat', 'n d1 n', { added: added.lat }),
  card('curl', 'n n n'),
]
const WALK_BLOCKS = [{ id: 'blk', members: ['row', 'lat'] }]

/** What the app writes when a row is logged: a head gets the next number, a warmup its place, a drop its head's number. */
function logOf(row: ResolvedRow, server: FakeServer, rows: readonly ResolvedRow[], serial: number): SetLog | null {
  const exerciseId = exerciseIdOf(row.exerciseKey)
  const base = headLog(row.exerciseKey, 1)
  if (row.kind === 'stage') {
    const head = rows.find((r) => r.key === row.headKey)
    const headLog_ = head?.logId ? server.logs.find((l) => l.id === head.logId) : undefined
    if (!headLog_) return null
    const taken = server.logs.filter((l) => l.parentSetId === headLog_.id).map((l) => l.stageIndex)
    return { ...base, id: `walk.${serial}`, exerciseId, weekPlanSetId: null, parentSetId: headLog_.id, isDropset: true, stageIndex: Math.max(0, ...taken) + 1, setNumber: headLog_.setNumber, stageKind: null }
  }
  const working = server.logs.filter((l) => l.exerciseId === exerciseId && l.parentSetId === null && !l.isWarmup).length
  return {
    ...base,
    id: `walk.${serial}`,
    exerciseId,
    weekPlanSetId: row.weekPlanSetId,
    setNumber: row.kind === 'warmup' ? row.number : working + 1,
    isWarmup: row.kind === 'warmup',
    stageKind: row.type?.kind === 'staged' ? row.type.stageKind : null,
  }
}

function walk(seed: number, steps: number): string[] {
  const rng = walker(seed)
  const added: Record<string, number> = { bench: 0, row: 0, lat: 0 }
  const server = new FakeServer({ logs: [] })
  const trace: string[] = []
  let serial = 0
  for (let step = 0; step < steps; step++) {
    const order = orderOf(WALK_CARDS(added), WALK_BLOCKS)
    const view = viewOf(order, server.logs, server.held())
    const rows = view.rows
    const op = rng.pick(['logNext', 'logNext', 'logNext', 'log', 'type', 'type', 'delete', 'delete', 'add', 'unlogDrop', 'unlogDrop'] as const)
    const open = rows.filter((r) => r.state === 'unlogged')
    const heads = rows.filter((r) => r.kind !== 'stage' && r.state !== 'skipped')
    if ((op === 'log' || op === 'logNext') && open.length > 0) {
      const row = op === 'logNext' ? open[0] : rng.pick(open)
      const log = logOf(row, server, rows, ++serial)
      if (log) {
        server.logs.push(log)
        trace.push(`log ${row.key}`)
      }
    } else if (op === 'add') {
      const key = rng.pick(['bench', 'row', 'lat'])
      added[key] += 1
      trace.push(`add ${key}`)
    } else if (op === 'type' && heads.length > 0) {
      const row = rng.pick(heads)
      const pick = rng.pick([{ kind: 'normal' }, { kind: 'warmup' }, staged('dropset', rng.chance(0.5) ? 1 : 2), staged('rest_pause', 3)] as const)
      const effects = applySetTypeChange({ row, pick, session: view })
      server.applySetType(effects, row)
      const after = resolveRows(order, server.logs, server.held()).find((r) => r.key === row.key)
      if (after && row.state !== 'unlogged' && effects.changed) expect(after.type, `${step}: ${row.key} to ${JSON.stringify(pick)}`).toEqual(effects.type)
      if (row.state === 'unlogged' && row.weekPlanSetId !== null && effects.changed) expect(after!.type).toEqual(effects.type)
      trace.push(`type ${row.key} ${JSON.stringify(pick)}`)
    } else if (op === 'delete' && rows.length > 0) {
      const row = rng.pick(rows)
      const effects = deleteEffects(row, view)
      server.applyDelete(effects)
      if (row.added && row.kind !== 'stage') added[row.exerciseKey] = Math.max(0, added[row.exerciseKey] - 1)
      const after = resolveRows(orderOf(WALK_CARDS(added), WALK_BLOCKS), server.logs, server.held())
      if (row.weekPlanSetId !== null) expect(after.map((r) => r.key), `${step}: deleted ${row.key}`).not.toContain(row.key)
      if (row.kind === 'stage') {
        const head = after.find((r) => r.key === row.headKey)
        const before = rows.find((r) => r.key === row.headKey)!
        const dropsBefore = before.type?.kind === 'staged' ? before.type.stageCount : 0
        const dropsAfter = head?.type?.kind === 'staged' ? head.type.stageCount : 0
        expect(dropsAfter, `${step}: drops of ${row.headKey} after deleting ${row.key}`).toBe(dropsBefore - 1)
      }
      trace.push(`delete ${row.key}`)
    } else if (op === 'unlogDrop') {
      const candidates = rows.filter((r) => r.kind === 'stage' && r.logId !== null && canUnlog(r, view))
      if (candidates.length > 0) {
        const drop = rng.pick(candidates)
        server.applyUnlog(unlogEffects(drop, view))
        trace.push(`unlog ${drop.key}`)
      }
    }

    // what must hold after every step
    const now = resolveRows(orderOf(WALK_CARDS(added), WALK_BLOCKS), server.logs, server.held())
    expect(new Set(now.map((r) => r.key)).size, `${step}: row keys are unique`).toBe(now.length)
    for (const exercise of ['bench', 'row', 'lat', 'curl']) {
      const numbers = server.logs
        .filter((l) => l.exerciseId === exerciseIdOf(exercise) && l.parentSetId === null && !l.isWarmup)
        .map((l) => l.setNumber)
        .sort((a, b) => a - b)
      expect(numbers, `${step}: ${exercise}'s logged working sets are numbered 1 to ${numbers.length}\n${trace.join('\n')}`).toEqual(numbers.map((_, i) => i + 1))
    }
    for (const exercise of ['bench', 'row', 'lat', 'curl']) {
      const shown = now.filter((r) => r.exerciseKey === exercise && r.kind === 'working').map((r) => r.number)
      expect(new Set(shown).size, `${step}: no two working sets of ${exercise} read the same number (${shown.join(' ')})\n${trace.join('\n')}`).toBe(shown.length)
    }
    const rowsNow = new Set(now.map((r) => r.key))
    for (const change of server.held()) {
      if (change.kind === 'deleted') expect(rowsNow.has(`set:${change.weekPlanSetId}`), `${step}: ${change.weekPlanSetId} is deleted`).toBe(false)
    }
    void currentSet(orderOf(WALK_CARDS(added), WALK_BLOCKS), server.logs, server.held())
    void finishWarning(orderOf(WALK_CARDS(added), WALK_BLOCKS), server.logs, server.held())
  }
  return trace
}

describe('a walk through many sessions', () => {
  it('every write the rules return is accepted by the tables, the logged sets stay numbered 1 to n, and a deleted set stays deleted', () => {
    let steps = 0
    for (let seed = 1; seed <= 400; seed++) steps += walk(seed, 14).length
    expect(steps).toBeGreaterThan(2000)
  })

  it('the walks exercise every kind of step', () => {
    const kinds = new Set<string>()
    for (let seed = 1; seed <= 60; seed++) for (const step of walk(seed, 14)) kinds.add(step.split(' ')[0])
    expect([...kinds].sort()).toEqual(['add', 'delete', 'log', 'type', 'unlog'])
  })
})
