import { describe, expect, it } from 'vitest'
import type { SessionSetChangeRecord, SetLog } from '../../types'
import {
  applySetTypeChange,
  canUnlog,
  changeColumns,
  currentSet,
  deleteEffects,
  finishWarning,
  lockDecision,
  resolveRows,
  typeChangeNeedsNumbers,
  unlogEffects,
  type HeldChange,
  type OrderExercise,
  type ResolvedRow,
} from './workoutRules'
import { FakeServer, PgError } from './workoutRules.server.testutil'
import { SESSION, addedLog, brief, card, dropLog, dropOpenAdded, exerciseIdOf, headLog, held, keepType, orderOf, pending, retyped, rowKeyed, staged, viewOf } from './workoutRules.testutil'

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
// throws) and then checks what must hold afterwards. The walk logs (each row with the number it shows: DECISIONS 151),
// switches types, adds sets, deletes sets and drops, and unlogs drops and whole sets, on a session with a superset, a card
// with warmups and drops, and added sets. It keeps the phone's drafts the way the workout screen will: an unlogged added
// set's key goes beside its card, and is dropped when the set is logged again or deleted. A warmup is logged with no
// weight and no reps half the time (SetRow writes an empty box as null), and a type change that needs the numbers brings
// them (DECISIONS 152).

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

const WALK_CARDS = (): OrderExercise[] => [
  card('bench', 'w w d2 n n d1', { added: 0 }),
  card('row', 'n d1 n', { added: 0 }),
  card('lat', 'n d1 n', { added: 0 }),
  card('curl', 'n n n'),
]
const WALK_BLOCKS = [{ id: 'blk', members: ['row', 'lat'] }]
const WALK_EXERCISES = ['bench', 'row', 'lat', 'curl']
const NEW_ADDED_TYPE = { kind: 'normal' } as const

/** How often the walk reached each case of DECISIONS 161 (the walks must not pass by never getting there). */
const reached = {
  openAddedMadeWarmup: 0,
  openAddedMadeWarmupWithLoggedAfter: 0,
  openAddedMadeStaged: 0,
  openAddedWarmupLogged: 0,
  openAddedStagedLogged: 0,
  addedWarmupUnlogged: 0,
  addedStagedUnlogged: 0,
  newEntryDroppedBeforeOthers: 0,
  openAddedDropDeleted: 0,
  unloggedWithoutStaleDrafts: 0,
}

/** What the app writes when a row is logged: a head gets the number its row shows, a warmup its place, a drop its head's number. */
function logOf(row: ResolvedRow, server: FakeServer, rows: readonly ResolvedRow[], serial: number, emptyWarmup: boolean): SetLog | null {
  const exerciseId = exerciseIdOf(row.exerciseKey)
  const base = headLog(row.exerciseKey, 1)
  if (row.kind === 'stage') {
    const head = rows.find((r) => r.key === row.headKey)
    const headLog_ = head?.logId ? server.logs.find((l) => l.id === head.logId) : undefined
    if (!headLog_) return null
    const taken = server.logs.filter((l) => l.parentSetId === headLog_.id).map((l) => l.stageIndex)
    return { ...base, id: `walk.${serial}`, exerciseId, weekPlanSetId: null, parentSetId: headLog_.id, isDropset: true, stageIndex: Math.max(0, ...taken) + 1, setNumber: headLog_.setNumber, stageKind: null }
  }
  return {
    ...base,
    id: `walk.${serial}`,
    exerciseId,
    weekPlanSetId: row.weekPlanSetId,
    setNumber: row.number,
    isWarmup: row.kind === 'warmup',
    stageKind: row.type?.kind === 'staged' ? row.type.stageKind : null,
    ...(row.kind === 'warmup' && emptyWarmup ? { weight: null, reps: null } : {}),
  }
}

/**
 * What stays of a set's logs when it is logged again: where it sits, what it holds. A warmup's stored number is not
 * maintained (the rows number warmups by their place, and a set made a warmup keeps the number it had), so it is not compared.
 */
const heldBy = (logs: readonly SetLog[]) =>
  logs
    .filter((l) => l.parentSetId === null)
    .map((l) => [l.weekPlanSetId ?? (l.isWarmup ? 'added warmup' : `added ${l.setNumber}`), l.isWarmup ? 0 : l.setNumber, l.weight, l.reps, l.isWarmup] as const)
    .sort((a, b) => a[1] - b[1] || JSON.stringify(a).localeCompare(JSON.stringify(b)))

/** The row of the same set among `rows`: a logged one by its log, an open added one by its draft or its place among the new ones; an added set's key moves with the numbers. */
function sameSet(rows: readonly ResolvedRow[], row: ResolvedRow): ResolvedRow | undefined {
  if (row.logId !== null) return rows.find((r) => r.logId === row.logId)
  if (!row.added) return rows.find((r) => r.key === row.key)
  return rows.find(
    (r) => r.exerciseKey === row.exerciseKey && r.added && r.kind !== 'stage' && r.logId === null && r.draftKey?.localId === row.draftKey?.localId && r.addedIndex === row.addedIndex,
  )
}

/** The head rows' kinds, numbers and types in the order drawn: what the user reads, without the positional keys of the added sets. */
const readings = (rows: readonly ResolvedRow[]) => rows.filter((r) => r.kind !== 'stage').map((r) => [r.exerciseKey, r.kind, r.number, r.type] as const)

/**
 * `mixed`: every kind of step on cards that start with their plan. `added`: the cards start with three sets added to each of
 * three of them, and the steps favour what is done to those (their types, logging them out of order, unlogging them), which is
 * where DECISIONS 161 lives and which a short mixed walk reaches too rarely.
 */
function walk(seed: number, steps: number, mode: 'mixed' | 'added' = 'mixed'): string[] {
  const rng = walker(seed)
  // The workout screen's own state for the cards (DECISIONS 161): how many sets were added to each, the type of each new one, and the
  // drafts of the ones unlogged again (with their types). The walk does with every answer what the screen will.
  let cards: OrderExercise[] = WALK_CARDS().map((c) => (mode === 'added' && c.addedSets !== undefined ? { ...c, addedSets: 3, addedTypes: [NEW_ADDED_TYPE, NEW_ADDED_TYPE, NEW_ADDED_TYPE] } : c))
  const server = new FakeServer({ logs: [] })
  const trace: string[] = []
  const orderNow = () => orderOf(cards, WALK_BLOCKS)
  const withCard = (key: string, change: (c: OrderExercise) => OrderExercise) => (cards = cards.map((c) => (c.key === key ? change(c) : c)))
  let serial = 0
  for (let step = 0; step < steps; step++) {
    const view = viewOf(orderNow(), server.logs, server.held())
    const rows = view.rows
    const op =
      mode === 'added'
        ? rng.pick(['logNext', 'logNext', 'log', 'log', 'log', 'log', 'typeAdded', 'typeAdded', 'typeAdded', 'typeAdded', 'typeAdded', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogSet', 'unlogDrop', 'delete', 'add', 'type'] as const)
        : rng.pick(['logNext', 'logNext', 'logNext', 'log', 'log', 'log', 'type', 'type', 'typeAdded', 'typeAdded', 'typeAdded', 'delete', 'delete', 'add', 'add', 'add', 'unlogDrop', 'unlogDrop', 'unlogSet', 'unlogSet', 'unlogSet'] as const)
    // a drop can be logged once its set is (a row of a set still to do is open too, and logging it would write nothing)
    const open = rows.filter((r) => r.state === 'unlogged' && (r.kind !== 'stage' || rows.some((h) => h.key === r.headKey && h.logId !== null)))
    const heads = rows.filter((r) => r.kind !== 'stage' && r.state !== 'skipped')
    if ((op === 'log' || op === 'logNext') && open.length > 0) {
      const row = op === 'logNext' ? open[0] : rng.pick(open)
      const log = logOf(row, server, rows, ++serial, rng.chance(0.5))
      if (log) {
        server.insertLog(log)
        // a set added in the session is logged with the type it has, and a staged one with its pending row (the drops it still has to log)
        if (row.added && row.type?.kind === 'staged') server.upsertChange({ change: pending(log, row.type.stageKind, row.type.stageCount), id: null })
        if (row.added && row.addedIndex !== null && (cards.find((c) => c.key === row.exerciseKey)?.addedTypes?.length ?? 0) > row.addedIndex + 1) reached.newEntryDroppedBeforeOthers++
        if (row.added && row.logId === null && row.kind === 'warmup') reached.openAddedWarmupLogged++
        if (row.added && row.logId === null && row.type?.kind === 'staged') reached.openAddedStagedLogged++
        cards = dropOpenAdded(cards, row)
        trace.push(`log ${row.key}`)
        if (row.added && row.kind !== 'stage') {
          const now = resolveRows(orderNow(), server.logs, server.held()).find((r) => r.logId === log.id)
          expect(now, `${step}: ${row.key} is logged as the type it had`).toMatchObject({ kind: row.kind === 'warmup' ? 'warmup' : 'working', type: row.type })
        }
      }
    } else if (op === 'add') {
      const key = rng.pick(['bench', 'row', 'lat'])
      withCard(key, (c) => ({ ...c, addedSets: (c.addedSets ?? 0) + 1, addedTypes: [...(c.addedTypes ?? []), NEW_ADDED_TYPE] }))
      trace.push(`add ${key}`)
    } else if ((op === 'type' || op === 'typeAdded') && heads.length > 0) {
      const candidates = op === 'typeAdded' ? heads.filter((r) => r.added) : heads
      if (candidates.length === 0) continue
      const row = rng.pick(candidates)
      const pick = rng.pick([{ kind: 'normal' }, { kind: 'warmup' }, { kind: 'warmup' }, staged('dropset', rng.chance(0.5) ? 1 : 2), staged('rest_pause', 3)] as const)
      const needs = typeChangeNeedsNumbers({ row, pick, session: view })
      // the numbers are asked for first (152): without them the rule refuses to answer
      if (needs) expect(() => applySetTypeChange({ row, pick, session: view }), `${step}: ${row.key} to ${JSON.stringify(pick)} needs numbers`).toThrow(RangeError)
      const effects = applySetTypeChange({ row, pick, session: view, numbers: needs ? { weight: 40, reps: 6 } : undefined })
      server.applySetType(effects, row)
      if (row.added && row.state === 'unlogged' && effects.changed) {
        if (effects.type.kind === 'warmup') reached.openAddedMadeWarmup++
        if (effects.type.kind === 'staged') reached.openAddedMadeStaged++
        if (effects.type.kind === 'warmup' && effects.renumber.length > 0) reached.openAddedMadeWarmupWithLoggedAfter++
      }
      // the card keeps the type of an open added set (an answer's `type` is what to keep)
      cards = keepType(cards, row, effects.type)
      const after = sameSet(resolveRows(orderNow(), server.logs, server.held()), row)
      if (after && row.state !== 'unlogged' && effects.changed) expect(after.type, `${step}: ${row.key} to ${JSON.stringify(pick)}`).toEqual(effects.type)
      if (row.state === 'unlogged' && (row.weekPlanSetId !== null || row.added) && effects.changed) {
        expect(after!.type, `${step}: open ${row.key} to ${JSON.stringify(pick)}`).toEqual(effects.type)
        // G54: an open set made a Warmup is a warmup row at once, and any other type is a working row
        expect(after!.kind, `${step}: open ${row.key} is a ${effects.type.kind} row`).toBe(effects.type.kind === 'warmup' ? 'warmup' : 'working')
      }
      trace.push(`type ${row.key} ${JSON.stringify(pick)}`)
    } else if (op === 'delete' && rows.length > 0) {
      const row = rng.pick(rows)
      const effects = deleteEffects(row, view)
      server.applyDelete(effects)
      if (row.added && row.kind !== 'stage') {
        withCard(row.exerciseKey, (c) => ({ ...c, addedSets: Math.max(0, (c.addedSets ?? 0) - 1) }))
        cards = dropOpenAdded(cards, row)
      }
      // a drop of an open added set: the set keeps one drop fewer, as the card's own state
      if (row.kind === 'stage' && effects.type !== null) {
        const head = rows.find((r) => r.key === row.headKey)!
        if (head.added) {
          cards = keepType(cards, head, effects.type)
          if (head.logId === null) reached.openAddedDropDeleted++
        }
      }
      const after = resolveRows(orderNow(), server.logs, server.held())
      if (row.weekPlanSetId !== null) expect(after.map((r) => r.key), `${step}: deleted ${row.key}`).not.toContain(row.key)
      if (row.kind === 'stage') {
        const head = sameSet(after, rows.find((r) => r.key === row.headKey)!)
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
    } else if (op === 'unlogSet') {
      const every = rows.filter((r) => r.kind !== 'stage' && r.state === 'logged' && canUnlog(r, view))
      const candidates = mode === 'added' && every.some((r) => r.added) && rng.chance(0.85) ? every.filter((r) => r.added) : every
      if (candidates.length > 0) {
        const row = rng.pick(candidates)
        const effects = unlogEffects(row, view)
        // no other set's number changes: the answer holds no number patch, and the heads read as they did
        expect(Object.keys(effects).sort(), `${step}: unlog of ${row.key} holds no renumbering`).toEqual(['changes', 'deleteOrder', 'draft'])
        // an added set's draft holds its type (DECISIONS 161); a planned set's holds none
        expect('type' in effects.draft.values, `${step}: the draft of ${row.key}`).toBe(row.added)
        if (row.added && row.kind === 'warmup') reached.addedWarmupUnlogged++
        if (row.added && row.type?.kind === 'staged') reached.addedStagedUnlogged++
        const keptCards = row.added ? cards.map((c) => (c.key === row.exerciseKey ? { ...c, drafts: [...(c.drafts ?? []), effects.draft] } : c)) : cards
        const copy = new FakeServer({ logs: server.logs, changes: server.held() })
        copy.applyUnlog(effects)
        const reopened = resolveRows(orderOf(keptCards, WALK_BLOCKS), copy.logs, copy.held())
        // …nothing moves, a Warmup included: the same keys, kinds, numbers and types, the set itself open again as the type it was. Not
        // while a draft is out of date (a delete or a Warmup switch before it changed the number it was kept at, and 151's reading
        // (2) leaves the draft alone): the open drafts are then put in the order of their positions, which is not the order of the numbers
        const stale = rows.some((r) => r.kind === 'working' && r.draftPosition !== null && r.draftPosition !== r.number)
        const places = (rs: readonly ResolvedRow[]) => rs.filter((r) => r.kind !== 'stage').map((r) => [r.key, r.kind, r.number, r.type] as const)
        const reopenedRow = reopened.find((r) => r.key === row.key)!
        if (!stale) {
          expect(places(reopened), `${step}: unlog of ${row.key} moves nothing`).toEqual(places(rows))
          // …and logging it again with the number the open row shows (and its type) is an exact undo of the head's log
          expect(reopenedRow, `${step}: ${row.key} is open again`).toMatchObject({ state: 'unlogged', number: row.number, kind: row.kind, type: row.type })
          const original = server.logs.find((l) => l.id === row.logId)!
          const again = { ...original, id: 'again', setNumber: reopenedRow.number }
          copy.insertLog(again)
          // (the copy numbers the rows it makes from 1 again, so the id is given: a made one would replace a row the server made)
          if (row.added && row.type?.kind === 'staged') copy.upsertChange({ change: pending(again, row.type.stageKind, row.type.stageCount), id: 'chg.again' })
          expect(heldBy(copy.logs.filter((l) => l.parentSetId === null)), `${step}: unlog and log of ${row.key} restores the set`).toEqual(
            heldBy(server.logs.filter((l) => l.parentSetId === null)),
          )
          // the working sets read as they did (a Warmup logged again may swap places with another Warmup of a stale number: only its row key differs)
          const relogged = resolveRows(orderOf(dropOpenAdded(keptCards, reopenedRow), WALK_BLOCKS), copy.logs, copy.held())
          expect(readings(relogged).filter((r) => r[1] === 'working'), `${step}: the working sets after ${row.key} is unlogged and logged again`).toEqual(
            readings(rows).filter((r) => r[1] === 'working'),
          )
          reached.unloggedWithoutStaleDrafts++
        }
        server.applyUnlog(effects)
        cards = keptCards
        trace.push(`unlogset ${row.key}`)
      }
    }

    // what must hold after every step
    const now = resolveRows(orderNow(), server.logs, server.held())
    expect(new Set(now.map((r) => r.key)).size, `${step}: row keys are unique\n${trace.join('\n')}`).toBe(now.length)
    for (const exercise of WALK_EXERCISES) {
      const logged = server.logs
        .filter((l) => l.exerciseId === exerciseIdOf(exercise) && l.parentSetId === null && !l.isWarmup)
        .map((l) => l.setNumber)
      expect(new Set(logged).size, `${step}: no two logged working sets of ${exercise} hold one number (${logged.join(' ')})\n${trace.join('\n')}`).toBe(logged.length)
      const shown = now.filter((r) => r.exerciseKey === exercise && r.kind === 'working').map((r) => r.number)
      // the numbers of the working sets are exactly 1 to n, whichever are logged: no two alike, no gap; a Warmup, open or logged, is not one
      expect([...shown].sort((a, b) => a - b), `${step}: the working sets of ${exercise} read ${shown.join(' ')}\n${trace.join('\n')}`).toEqual(shown.map((_, i) => i + 1))
      // …and, while no draft is out of date, in the order of the plan
      const stale = now.some((r) => r.exerciseKey === exercise && r.kind === 'working' && r.draftPosition !== null && r.draftPosition !== r.number)
      if (!stale) expect(shown, `${step}: the working sets of ${exercise} keep their places (${shown.join(' ')})\n${trace.join('\n')}`).toEqual(shown.map((_, i) => i + 1))
    }
    const rowsNow = new Set(now.map((r) => r.key))
    for (const change of server.held()) {
      if (change.kind === 'deleted') expect(rowsNow.has(`set:${change.weekPlanSetId}`), `${step}: ${change.weekPlanSetId} is deleted`).toBe(false)
    }
    // G54: a warmup is never the current set, and with the lock on its LOG never asks
    const current = currentSet(orderNow(), server.logs, server.held())
    expect(current?.kind, `${step}: the current set is no warmup\n${trace.join('\n')}`).not.toBe('warmup')
    expect(current, `${step}: the current set is the first open row that is no warmup`).toEqual(now.find((r) => r.kind !== 'warmup' && r.state === 'unlogged') ?? null)
    for (const row of now) {
      const decision = lockDecision({ logInOrder: true, current, tapped: row })
      if (row.kind === 'warmup') expect(decision, `${step}: LOG on the warmup ${row.key}`).toBe('log')
    }
    void finishWarning(orderNow(), server.logs, server.held())
  }
  return trace
}

describe('a walk through many sessions', () => {
  it('every write the rules return is accepted by the tables, every working set keeps its number and its place, and a deleted set stays deleted', () => {
    let steps = 0
    for (let seed = 1; seed <= 400; seed++) steps += walk(seed, 14).length
    expect(steps).toBeGreaterThan(2000)
  })

  it('…also with sets added to the cards from the start, whose types are changed, logged out of order and unlogged (DECISIONS 161)', () => {
    let steps = 0
    for (const key of Object.keys(reached) as Array<keyof typeof reached>) reached[key] = 0
    for (let seed = 1; seed <= 400; seed++) steps += walk(seed, 20, 'added').length
    expect(steps).toBeGreaterThan(3000)
    // the walks got to every case of an added set's type (a walk that never makes an added set a Warmup proves nothing about it)
    expect(Object.entries(reached).filter(([, count]) => count <= 20), `the cases the walks barely reached (${JSON.stringify(reached)})`).toEqual([])
  })

  it('the walks exercise every kind of step', () => {
    const kinds = new Set<string>()
    for (let seed = 1; seed <= 400; seed++) for (const step of walk(seed, 14)) kinds.add(step.split(' ')[0])
    expect([...kinds].sort()).toEqual(['add', 'delete', 'log', 'type', 'unlog', 'unlogset'])
  })
})
