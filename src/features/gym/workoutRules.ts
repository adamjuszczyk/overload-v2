// Chunk 46 (TASKS-1.2 "Workout logging rules as pure functions"; SPEC [1.2] "Logging mechanics" (current
// set, log lock 18a, unlog 18c, delete set 18b, set type during a workout 19 / 19c, finishing 11 / C6),
// "Supersets" (ADD ROUND, Defaults 9), "Set types and staged sets", G46, G47 and G54) — the workout
// screen's new decisions as one tested module. No React, no Supabase, no store, no clock: chunks 58a to
// 64 fetch the plan, the logs and the session's changes, call these, and write what they say.
//
// ─── The one picture of the screen: `resolveRows` ────────────────────────────────────────────────
// `sessionOrder(exercises, supersets)` describes the session's structure (cards and superset blocks, in
// the order the screen draws them). `resolveRows(order, logs, changes)` reads the logs and the session's
// `v2_session_set_changes` over it and returns every row the screen draws, top to bottom, with its state:
// that list IS the session's order. A card draws the rows of its exercise from it, so the current set,
// the lock's question, the finish warning and the rows on screen cannot disagree. It reads:
//   - the plan: a planned head with its stage rows; a warmup;
//   - `deleted` changes: the planned set (and its drops) is not in the order at all; a superset's rounds
//     are formed again from the sets that are left (delete A2 and A3 becomes the member's second set);
//   - `retyped` changes: the set has the type the change says; its planned drops are replaced by the
//     change's count, a warmup leaves the working sets, Normal has none (SPEC 19);
//   - `pending_stages` changes: a logged head with drops still to log (the change's count is the head's
//     total number of drops, logged ones included);
//   - logs: heads by `weekPlanSetId` (identity), a head's drops by count (the n-th logged drop is drop n),
//     added sets (`weekPlanSetId` null) by their `setNumber` order against the exercise's added rows.
// A set that was logged takes its type from its log (SPEC Objects stored: "set kind and stage kind as
// done"), so a logged planned dropset switched to Normal has no drop rows left although the plan still
// holds them; a null kind on a head with planned drops, or with logged drops, still reads as a dropset
// (`resolveStageKind`, pre-1.1 data).
//
// ─── What a row's number is ──────────────────────────────────────────────────────────────────────
// As the cards number them today (`useExerciseCardState.ts`, unchanged by 1.2): a logged head shows the
// `setNumber` it was logged with; an unlogged one shows the exercise's logged heads (warmups out) + its
// place among the unlogged ones, so rows run 01, 02, 03 whatever the plan's own numbers say. A drop shows
// its head's number. Warmups are numbered among themselves.
//
// ─── Current set and the lock ────────────────────────────────────────────────────────────────────
// - The current set is the first unlogged working set or drop in the order (SPEC: "the first unlogged
//   working set or stage in the session's order"). A skipped set is settled, not unlogged ("it stays open
//   until you log or skip it"); the drops of a skipped head are dead and never current.
// - A warmup never takes part, whichever way it is shown, and its LOG never asks (G54).
// - With the lock on (`logInOrder`) only the current set's LOG logs straight away; LOG on any other row
//   asks "Log A2 before set 03?" (board W7b); with it off every LOG logs.
//
// ─── What a set type change writes ───────────────────────────────────────────────────────────────
// `applySetTypeChange` is the one place a picked type becomes storage (Checks that lied #15: no writer
// maps a type on its own). `typeColumns` / `typeOfColumns` are the same mapping for a change row.
//   - an upcoming planned set: a `retyped` change keyed by the planned set (nothing on the plan);
//   - a logged head: its log's `is_warmup` / `stage_kind` are patched and, for a staged type, a
//     `pending_stages` change keyed by the log holds the head's total drop count; Normal and Warmup
//     remove the drops, and logged drops are deleted only after the confirm (19c);
//   - an added set that is not logged yet has no row to write: its type is local state.
//
// ─── Delete, unlog, finish ───────────────────────────────────────────────────────────────────────
// - `deleteEffects`: the drops from the last, then the head (the cascade order of `setGroupLogic.ts`);
//   every later head of the same exercise and its drops take the numbers that close the gap (F4: a
//   renumbered head's drops used to keep their old number). A lone drop renumbers nothing.
// - `canUnlog` / `unlogEffects`: a set with logged (done) drops after it cannot be unlogged; skipped
//   drops go with it. The kept numbers are a draft on the phone (G46), never a server row; the draft's
//   key is the planned set, or for an added set its local id, exercise and position. A type the set was
//   logged with, and the plan doesn't have, travels as a `retyped` change so unlog never loses it. Nothing
//   it returns touches the rest timer or the session's status (Defaults 6).
// - `finishWarning`: the unlogged planned sets, by exercise and number (board W18); deleted sets are not
//   in the order, skipped ones are settled.
//
// ─── How the screens call it (58a to 64) ──────────────────────────────────────────────────────────
//   const order = sessionOrder(cards, blocks)              // the cards as drawn: plan, swaps, added exercises
//   const rows = resolveRows(order, logs, changes)         // what every card draws; one list
//   const current = currentSet(order, logs, changes)       // the first unlogged working set or drop of `rows`
//   lockDecision({ logInOrder, current, tapped })          // 'log', or the question's words for the sheet
//   applySetTypeChange({ row, pick, loggedStages })        // a picked type -> the log patch, drops, change row
//   deleteEffects(group, siblings) / canUnlog / unlogEffects(group, row)
//   finishWarning(order, logs, changes) / addRound(order, rows, blockId)
// None of them writes: each returns what the caller writes.
//
// ─── Where SPEC is silent (readings built; DECISIONS asks) ─────────────────────────────────────────
// - Delete of a logged planned set: the log goes and the later sets renumber (TASKS 46); nothing here
//   records the planned set as deleted, so its slot comes back as an open set (as today's delete does)
//   unless chunk 61 also writes a `deleted` change.
// - Finish: an unlogged planned warmup and an unlogged drop of a logged set are not listed (warmups are
//   never counted in set counts; stages are never separate sets).
// - Unlog: a skipped drop doesn't stop it and goes with the set; a drop itself can't be unlogged here
//   (what its draft is keyed by is not defined).
// - A set type pick with fewer drops than are logged deletes the extra logged drops after the question
//   (19c asks for Normal; the same question is asked here). Switching a logged set to or from Warmup
//   patches its log and renumbers nothing (warmups are numbered apart).
// - An added set that is not logged yet keeps its type as local state; once logged, the caller writes its
//   `pending_stages`. An added set unlogged again loses a type it was given: no planned set to key it on.
//
// ─── Provisional, D31 (display wording where no board gives it) ───────────────────────────────────
// A plain row is called "set 03" in the lock's question (the board names a superset member "A2"); a drop
// "set 03 drop 1" ("stage 1" for the kinds that are not dropsets); the finish sentence joins the numbers
// of one exercise with "and" and separates exercises with a semicolon.

import type { FormRating, SessionSetChange, SessionSetChangeType, SetLog, WeekPlanSet, WeightUnit } from '../../types'
import { resolveStageKind, type StageKind } from '../../lib/plannerVocabulary'
import { buildSupersetRounds } from './supersetRounds'
import { cascadeDeleteOrder, groupByParent, type SetGroup } from './setGroupLogic'

// ─── The shapes it reads ─────────────────────────────────────────────────────────────────────────
// Each is the fields read, picked from the app's own types: a real `WeekPlanSet`, `SetLog` and
// `SessionSetChange` are accepted as they are.

/** A planned set of the session's week plan (heads, drops and warmups alike). */
export type PlannedSet = Pick<WeekPlanSet, 'id' | 'setNumber' | 'parentWeekPlanSetId' | 'stageIndex' | 'isWarmup' | 'stageKind'>

/** A set log of the session. */
export type LoggedSet = Pick<
  SetLog,
  'id' | 'sessionId' | 'exerciseId' | 'weekPlanSetId' | 'setNumber' | 'parentSetId' | 'stageIndex' | 'isWarmup' | 'isSkipped' | 'stageKind'
>

/** One card of the workout: an exercise with its planned sets. */
export interface OrderExercise {
  /** The card's identity (the program exercise row's id; an added exercise's card has its own). */
  key: string
  /** What its logs carry (`SetLog.exerciseId`): a swapped card is the replacement's. */
  exerciseId: string
  name: string
  /** Every planned set of this exercise in the session's plan: heads, drops and warmups. */
  plannedSets: readonly PlannedSet[]
  /** Sets added in the session (ADD SET, ADD ROUND), logged or not: the screen's `extraSlotCount`. */
  addedSets?: number
}

/** A superset block as the screen draws it (a member with a swap left its block), members in block order. */
export interface OrderSuperset {
  id: string
  members: readonly string[]
}

export type OrderUnit =
  | { kind: 'single'; exercise: OrderExercise }
  | { kind: 'block'; id: string; members: readonly OrderExercise[] }

/** The session's structure; `resolveRows` turns it into the rows. */
export interface SessionOrder {
  readonly units: readonly OrderUnit[]
}

export type RowKind = 'working' | 'warmup' | 'stage'
/** `skipped` is settled (a log marked skipped); only `unlogged` is still to do. */
export type RowState = 'logged' | 'skipped' | 'unlogged'

export interface ResolvedRow {
  /** Identity for the screen's matching (`plannedRowKey`, `addedRowKey`, `stageRowKey`). */
  key: string
  kind: RowKind
  state: RowState
  exerciseKey: string
  exerciseId: string
  exerciseName: string
  /** The planned set behind a head; null for an added set and for a drop. */
  weekPlanSetId: string | null
  /** A set added in the session (no plan behind it). */
  added: boolean
  /** What the row shows (see the header); a drop shows its head's. */
  number: number
  /** The log behind a logged or skipped row. */
  logId: string | null
  /** A head's type as it is now (plan, change and log together); null on a drop. */
  type: SessionSetChangeType | null
  /** What the plan says it is; null for an added set and a drop. */
  plannedType: SessionSetChangeType | null
  /** A `retyped` change exists for the planned set. */
  retyped: boolean
  /** The kind of a staged head, and of the head a drop belongs to. */
  stageKind: StageKind | null
  /** A drop: its head's key and its place under it (1-based). */
  headKey: string | null
  stageNumber: number | null
  /** A superset member's place: block, letter (A, B, …) and round. */
  block: { id: string; letter: string; round: number } | null
}

type RetypedChange = Extract<SessionSetChange, { kind: 'retyped' }>
type PendingStagesChange = Extract<SessionSetChange, { kind: 'pending_stages' }>

// ─── Small helpers ───────────────────────────────────────────────────────────────────────────────

// Shared by every row of a kind, so frozen: nobody can change one row's type by reaching into another's.
const NORMAL: SessionSetChangeType = Object.freeze({ kind: 'normal' as const })
const WARMUP: SessionSetChangeType = Object.freeze({ kind: 'warmup' as const })

const pad2 = (n: number): string => String(n).padStart(2, '0')

/** A, B, … Z, then #27, #28 (SupersetBlock.tsx's label, which this replaces in 58a). */
export function memberLetter(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : `#${index + 1}`
}

export const plannedRowKey = (weekPlanSetId: string): string => `set:${weekPlanSetId}`
export const addedRowKey = (exerciseKey: string, position: number): string => `added:${exerciseKey}:${position}`
export const stageRowKey = (headKey: string, stageNumber: number): string => `${headKey}:stage:${stageNumber}`

// ─── A set type and how it is stored ─────────────────────────────────────────────────────────────
// Chunk 39's `SetType` is assignable to `SessionSetChangeType`; this is the one mapping to and from the
// columns (`is_warmup`, `stage_kind`, `stage_count`) a log row and a change row hold, so the writers of
// chunks 54a, 61, 62 and 67 take it from here instead of each mapping a picked type on its own.

export interface TypeColumns {
  isWarmup: boolean
  stageKind: StageKind | null
  /** Only a change row stores it; a log row has the drops themselves. */
  stageCount: number
}

export function typeColumns(type: SessionSetChangeType): TypeColumns {
  switch (type.kind) {
    case 'warmup':
      return { isWarmup: true, stageKind: null, stageCount: 0 }
    case 'normal':
      return { isWarmup: false, stageKind: null, stageCount: 0 }
    case 'staged':
      return { isWarmup: false, stageKind: type.stageKind, stageCount: type.stageCount }
  }
}

export function typeOfColumns(columns: TypeColumns): SessionSetChangeType {
  if (columns.isWarmup) return WARMUP
  if (columns.stageKind !== null && columns.stageCount > 0) {
    return { kind: 'staged', stageKind: columns.stageKind, stageCount: columns.stageCount }
  }
  return NORMAL
}

/** The same type (the rest between stages is not part of what a session stores). */
export function sameType(a: SessionSetChangeType, b: SessionSetChangeType): boolean {
  if (a.kind !== 'staged' || b.kind !== 'staged') return a.kind === b.kind
  return a.stageKind === b.stageKind && a.stageCount === b.stageCount
}

function plannedTypeOf(planned: PlannedSet, plannedStages: number): SessionSetChangeType {
  if (planned.isWarmup) return WARMUP
  if (plannedStages > 0) {
    return { kind: 'staged', stageKind: resolveStageKind(planned.stageKind ?? null), stageCount: plannedStages }
  }
  return NORMAL
}

// The type of a head that has a log: the log is authoritative for the kind, the change or the plan only
// say how many drops (see the header). `planned` is null for an added set.
function loggedHeadType(
  log: LoggedSet,
  planned: { stageKind: StageKind | null; stageCount: number } | null,
  retyped: RetypedChange | undefined,
  pending: PendingStagesChange | undefined,
  loggedStages: number,
): SessionSetChangeType {
  if (log.isWarmup) return WARMUP
  const kind = log.stageKind ?? null
  if (kind !== null) {
    let said = 0
    if (pending !== undefined && pending.stageKind === kind) said = pending.stageCount
    else if (retyped !== undefined && retyped.type.kind === 'staged' && retyped.type.stageKind === kind) said = retyped.type.stageCount
    else if (planned !== null && planned.stageKind === kind) said = planned.stageCount
    const count = Math.max(said, loggedStages)
    return count > 0 ? { kind: 'staged', stageKind: kind, stageCount: count } : NORMAL
  }
  // A null kind: Normal, unless the head is a pre-1.1 dropset (drops planned or logged under it).
  const legacy = planned !== null && planned.stageKind === null ? planned.stageCount : 0
  const count = Math.max(legacy, loggedStages)
  return count > 0 ? { kind: 'staged', stageKind: resolveStageKind(null), stageCount: count } : NORMAL
}

// ─── The session's structure ─────────────────────────────────────────────────────────────────────

/**
 * The cards in the order the screen draws them, a superset block standing where its first member is.
 * `supersets` names the blocks the screen draws; a block with fewer than two members it can find is not a
 * block, and a member it cannot find is left out (the lists can lag one another for a render). Two cards
 * with one key, or one card in two blocks, is a caller bug and throws.
 */
export function sessionOrder(exercises: readonly OrderExercise[], supersets: readonly OrderSuperset[] = []): SessionOrder {
  const byKey = new Map<string, OrderExercise>()
  for (const exercise of exercises) {
    if (byKey.has(exercise.key)) throw new RangeError(`two exercises share the key ${exercise.key}`)
    byKey.set(exercise.key, exercise)
  }
  const blockOf = new Map<string, { id: string; members: OrderExercise[] }>()
  for (const superset of supersets) {
    const members: OrderExercise[] = []
    for (const key of superset.members) {
      const member = byKey.get(key)
      if (member === undefined) continue
      if (blockOf.has(key) || members.includes(member)) throw new RangeError(`the exercise ${key} is in two superset blocks`)
      members.push(member)
    }
    if (members.length < 2) continue
    const block = { id: superset.id, members }
    for (const member of members) blockOf.set(member.key, block)
  }
  const units: OrderUnit[] = []
  const emitted = new Set<string>()
  for (const exercise of exercises) {
    const block = blockOf.get(exercise.key)
    if (block === undefined) {
      units.push({ kind: 'single', exercise })
    } else if (!emitted.has(block.id)) {
      emitted.add(block.id)
      units.push({ kind: 'block', id: block.id, members: block.members })
    }
  }
  return { units }
}

// ─── Reading the logs and changes over the structure ──────────────────────────────────────────────

interface SessionIndex {
  headLogs: LoggedSet[]
  headLogByPlan: Map<string, LoggedSet>
  stagesByParent: Map<string, LoggedSet[]>
  deleted: Set<string>
  retyped: Map<string, RetypedChange>
  pending: Map<string, PendingStagesChange>
}

function indexSession(logs: readonly LoggedSet[], changes: readonly SessionSetChange[]): SessionIndex {
  const session: SessionIndex = {
    headLogs: [],
    headLogByPlan: new Map(),
    stagesByParent: new Map(),
    deleted: new Set(),
    retyped: new Map(),
    pending: new Map(),
  }
  for (const log of logs) {
    if (log.parentSetId !== null) {
      const stages = session.stagesByParent.get(log.parentSetId)
      if (stages) stages.push(log)
      else session.stagesByParent.set(log.parentSetId, [log])
      continue
    }
    session.headLogs.push(log)
    if (log.weekPlanSetId !== null && !session.headLogByPlan.has(log.weekPlanSetId)) session.headLogByPlan.set(log.weekPlanSetId, log)
  }
  for (const stages of session.stagesByParent.values()) stages.sort((a, b) => a.stageIndex - b.stageIndex)
  for (const change of changes) {
    if (change.kind === 'deleted') session.deleted.add(change.weekPlanSetId)
    else if (change.kind === 'retyped') session.retyped.set(change.weekPlanSetId, change)
    else session.pending.set(change.setLogId, change)
  }
  return session
}

// A head slot before it is a row: the plan's (or an added) set with what the session did to it.
interface Head {
  key: string
  exercise: OrderExercise
  weekPlanSetId: string | null
  added: boolean
  log: LoggedSet | null
  stageLogs: LoggedSet[]
  type: SessionSetChangeType
  plannedType: SessionSetChangeType | null
  retyped: boolean
  number: number
}

function exerciseHeads(exercise: OrderExercise, session: SessionIndex): { warmups: Head[]; workings: Head[] } {
  const heads: Head[] = []

  // The plan's sets, in the plan's order, minus the ones the session deleted.
  const groups = groupByParent(
    [...exercise.plannedSets],
    (s) => s.id,
    (s) => s.parentWeekPlanSetId,
    (s) => s.stageIndex,
  )
    .filter((group) => !session.deleted.has(group.head.id))
    .sort((a, b) => a.head.setNumber - b.head.setNumber)
  for (const { head: planned, stages } of groups) {
    const plannedStages = stages.length
    const plannedType = plannedTypeOf(planned, plannedStages)
    const retyped = session.retyped.get(planned.id)
    const log = session.headLogByPlan.get(planned.id) ?? null
    const stageLogs = log ? session.stagesByParent.get(log.id) ?? [] : []
    const type = log
      ? loggedHeadType(log, { stageKind: planned.stageKind ?? null, stageCount: plannedStages }, retyped, session.pending.get(log.id), stageLogs.length)
      : retyped !== undefined
        ? retyped.type
        : plannedType
    heads.push({
      key: plannedRowKey(planned.id),
      exercise,
      weekPlanSetId: planned.id,
      added: false,
      log,
      stageLogs,
      type,
      plannedType,
      retyped: retyped !== undefined,
      number: 0,
    })
  }

  // The sets added in the session come after the planned ones; the n-th added row is the n-th added log.
  const addedLogs = session.headLogs
    .filter((log) => log.exerciseId === exercise.exerciseId && log.weekPlanSetId === null && !log.isWarmup)
    .sort((a, b) => a.setNumber - b.setNumber)
  const addedCount = Math.max(exercise.addedSets ?? 0, addedLogs.length)
  for (let i = 0; i < addedCount; i++) {
    const log = addedLogs[i] ?? null
    const stageLogs = log ? session.stagesByParent.get(log.id) ?? [] : []
    heads.push({
      key: addedRowKey(exercise.key, i + 1),
      exercise,
      weekPlanSetId: null,
      added: true,
      log,
      stageLogs,
      type: log ? loggedHeadType(log, null, undefined, session.pending.get(log.id), stageLogs.length) : NORMAL,
      plannedType: null,
      retyped: false,
      number: 0,
    })
  }

  // A head that is a warmup now (planned so, retyped so, or logged so) is not one of the working sets.
  const warmups = heads.filter((head) => head.type.kind === 'warmup')
  const workings = heads.filter((head) => head.type.kind !== 'warmup')
  const loggedHeads = session.headLogs.filter((log) => log.exerciseId === exercise.exerciseId && !log.isWarmup).length
  let unlogged = 0
  for (const head of workings) {
    if (head.log) head.number = head.log.setNumber
    else head.number = loggedHeads + ++unlogged
  }
  warmups.forEach((head, i) => {
    head.number = i + 1
  })
  return { warmups, workings }
}

type Block = NonNullable<ResolvedRow['block']>

function rowsOf(head: Head, block: Block | null): ResolvedRow[] {
  const state: RowState = head.log === null ? 'unlogged' : head.log.isSkipped ? 'skipped' : 'logged'
  const stageKind = head.type.kind === 'staged' ? head.type.stageKind : null
  const common = { exerciseKey: head.exercise.key, exerciseId: head.exercise.exerciseId, exerciseName: head.exercise.name, added: head.added, number: head.number, block }
  const rows: ResolvedRow[] = [
    {
      ...common,
      key: head.key,
      kind: head.type.kind === 'warmup' ? 'warmup' : 'working',
      state,
      weekPlanSetId: head.weekPlanSetId,
      logId: head.log?.id ?? null,
      type: head.type,
      plannedType: head.plannedType,
      retyped: head.retyped,
      stageKind,
      headKey: null,
      stageNumber: null,
    },
  ]
  if (head.type.kind === 'staged') {
    for (let n = 1; n <= head.type.stageCount; n++) {
      const log = head.stageLogs[n - 1]
      let stageState: RowState
      if (log !== undefined) stageState = log.isSkipped ? 'skipped' : 'logged'
      else if (state === 'skipped') continue // a skipped head's drops are dead: nothing is left to log
      else stageState = 'unlogged'
      rows.push({
        ...common,
        key: stageRowKey(head.key, n),
        kind: 'stage',
        state: stageState,
        weekPlanSetId: null,
        logId: log?.id ?? null,
        type: null,
        plannedType: null,
        retyped: false,
        stageKind: head.type.stageKind,
        headKey: head.key,
        stageNumber: n,
      })
    }
  }
  return rows
}

/**
 * Every row the screen draws, top to bottom: each card's warmups, then its working sets with their drops;
 * a superset block's warmups (member by member) and then its rounds, A1 B1 A2 B2 … (SPEC "Supersets": "The
 * current set zigzags through rounds"). The rounds are the ones `supersetRounds.ts` forms, over the sets that
 * are left after the session's deletes and type changes.
 */
export function resolveRows(order: SessionOrder, logs: readonly LoggedSet[], changes: readonly SessionSetChange[] = []): ResolvedRow[] {
  const session = indexSession(logs, changes)
  const rows: ResolvedRow[] = []
  for (const unit of order.units) {
    if (unit.kind === 'single') {
      const { warmups, workings } = exerciseHeads(unit.exercise, session)
      for (const head of [...warmups, ...workings]) rows.push(...rowsOf(head, null))
      continue
    }
    const members = unit.members.map((member) => exerciseHeads(member, session))
    for (const member of members) for (const head of member.warmups) rows.push(...rowsOf(head, null))
    for (const round of buildSupersetRounds(members.map((member) => member.workings))) {
      for (const cell of round.cells) {
        rows.push(...rowsOf(cell.head, { id: unit.id, letter: memberLetter(cell.memberIndex), round: round.roundNumber }))
      }
    }
  }
  return rows
}

/** The first unlogged working set or drop in the session's order (warmups never; a skipped set is settled). */
export function currentSet(order: SessionOrder, logs: readonly LoggedSet[], changes: readonly SessionSetChange[] = []): ResolvedRow | null {
  return resolveRows(order, logs, changes).find((row) => row.kind !== 'warmup' && row.state === 'unlogged') ?? null
}

// ─── The log lock ────────────────────────────────────────────────────────────────────────────────

const STAGE_WORD = (stageKind: StageKind | null): string => (stageKind === 'dropset' || stageKind === null ? 'drop' : 'stage')

type LabelRow = Pick<ResolvedRow, 'kind' | 'number' | 'block' | 'stageKind' | 'stageNumber'>

/** How a row is named in a sentence: "A2" for a superset member, "set 03" for any other, "set 03 drop 1" for a drop. */
export function rowLabel(row: LabelRow): string {
  if (row.kind === 'warmup') return 'warmup'
  const head = row.block ? `${row.block.letter}${row.block.round}` : `set ${pad2(row.number)}`
  return row.kind === 'stage' ? `${head} ${STAGE_WORD(row.stageKind)} ${row.stageNumber}` : head
}

/** The set the lock names as next: the exercise and its number ("Lat Pulldown 03"). */
function nextName(row: Pick<ResolvedRow, 'kind' | 'number' | 'exerciseName' | 'stageKind' | 'stageNumber'>): string {
  const name = `${row.exerciseName} ${pad2(row.number)}`
  return row.kind === 'stage' ? `${name} ${STAGE_WORD(row.stageKind)} ${row.stageNumber}` : name
}

export type LockDecision = 'log' | { ask: string; next: string; label: string }

/**
 * What LOG on `tapped` does (SPEC 18a, G54). Log straight away when the lock is off, on the current set,
 * and always on a warmup; otherwise ask, naming the row and the one that is next ("Log A2 before set 03?",
 * "Lat Pulldown 03"); `label` is the tapped row's name for the LOG A2 button.
 */
export function lockDecision({
  logInOrder,
  current,
  tapped,
}: {
  logInOrder: boolean
  current: ResolvedRow | null
  tapped: ResolvedRow
}): LockDecision {
  if (tapped.kind === 'warmup') return 'log'
  if (!logInOrder) return 'log'
  if (current === null || tapped.state !== 'unlogged' || tapped.key === current.key) return 'log'
  return { ask: `Log ${rowLabel(tapped)} before ${rowLabel(current)}?`, next: nextName(current), label: rowLabel(tapped) }
}

// ─── A set type changed during a workout ─────────────────────────────────────────────────────────

export interface SetTypeChange {
  /** The type the set has afterwards. */
  type: SessionSetChangeType
  /** False when the pick is the type it already has: nothing to write. */
  changed: boolean
  /** A logged head: the patch for its log row (`is_warmup`, `stage_kind`); null for a set with no log. */
  headPatch: { isWarmup: boolean; stageKind: StageKind | null } | null
  /** The drops that appear under it, by number (1-based). */
  stagesToAdd: number[]
  /** The logged drops to delete, the last first (Normal, Warmup, or fewer drops than are logged). */
  stagesToDelete: Array<Pick<LoggedSet, 'id' | 'stageIndex' | 'isSkipped'>>
  /** Done drops would be deleted: ask first (19c). */
  needsConfirm: boolean
  /** How many done drops the question names. */
  confirmCount: number
  /** The `v2_session_set_changes` row to upsert: `retyped` for a planned set not logged yet, `pending_stages` for a logged head. */
  change?: SessionSetChange
}

/**
 * SPEC 19: a set's type changed for this workout only. `row` is the set's row (from `resolveRows`), `pick`
 * the type chosen (a picker's `SetType` is accepted; its rest between stages is not stored), `loggedStages`
 * the logged drops under a logged head. Writes nothing; the caller applies what it returns.
 */
export function applySetTypeChange({
  row,
  pick,
  loggedStages = [],
}: {
  row: Pick<ResolvedRow, 'state' | 'weekPlanSetId' | 'logId' | 'type'>
  pick: SessionSetChangeType
  loggedStages?: ReadonlyArray<Pick<LoggedSet, 'id' | 'stageIndex' | 'isSkipped'>>
}): SetTypeChange {
  if (row.type === null) throw new RangeError('only a set has a type; a drop follows its head')
  if (row.state === 'skipped') throw new RangeError('a skipped set has no type to change')
  const next: SessionSetChangeType =
    pick.kind === 'staged' ? { kind: 'staged', stageKind: pick.stageKind, stageCount: pick.stageCount } : { kind: pick.kind }
  if (next.kind === 'staged' && (!Number.isInteger(next.stageCount) || next.stageCount < 1)) {
    throw new RangeError('a staged set has at least one drop')
  }
  const current = row.type
  if (sameType(current, next)) {
    return { type: current, changed: false, headPatch: null, stagesToAdd: [], stagesToDelete: [], needsConfirm: false, confirmCount: 0 }
  }
  const before = current.kind === 'staged' ? current.stageCount : 0
  const after = next.kind === 'staged' ? next.stageCount : 0
  const stagesToAdd = Array.from({ length: Math.max(0, after - before) }, (_, i) => before + i + 1)

  if (row.state === 'unlogged') {
    // No log row yet: a planned set records the change on the session, an added set keeps it as local state.
    const change: SessionSetChange | undefined =
      row.weekPlanSetId === null ? undefined : { kind: 'retyped', weekPlanSetId: row.weekPlanSetId, type: next }
    return { type: next, changed: true, headPatch: null, stagesToAdd, stagesToDelete: [], needsConfirm: false, confirmCount: 0, change }
  }

  if (row.logId === null) throw new RangeError('a logged set has its log')
  const logged = [...loggedStages].sort((a, b) => a.stageIndex - b.stageIndex)
  const stagesToDelete = logged.slice(Math.min(logged.length, after)).reverse()
  const confirmCount = stagesToDelete.filter((stage) => !stage.isSkipped).length
  const columns = typeColumns(next)
  const change: SessionSetChange | undefined =
    next.kind === 'staged' ? { kind: 'pending_stages', setLogId: row.logId, stageKind: next.stageKind, stageCount: next.stageCount } : undefined
  return {
    type: next,
    changed: true,
    headPatch: { isWarmup: columns.isWarmup, stageKind: columns.stageKind },
    stagesToAdd,
    stagesToDelete,
    needsConfirm: confirmCount > 0,
    confirmCount,
    change,
  }
}

// ─── Delete a set ────────────────────────────────────────────────────────────────────────────────

export interface DeleteEffects {
  /** The logs to delete, in this order: the drops from the last, then the head. */
  deleteOrder: LoggedSet[]
  /** How many logged drops go with the head: the confirm says so (W9). */
  stageCount: number
  /** Later heads of the same exercise, and their drops, with the number that closes the gap. */
  renumber: Array<{ id: string; setNumber: number }>
}

/**
 * SPEC 18b: deleting a logged set. `group` is the set's head and drops, `siblings` the exercise's head
 * groups (the deleted one may be among them). Every later head takes the numbers that close the gap and its
 * drops take its number (a drop carries its head's `set_number`). A drop deleted on its own, and a warmup,
 * renumber nothing.
 */
export function deleteEffects(group: SetGroup<LoggedSet>, siblings: readonly SetGroup<LoggedSet>[]): DeleteEffects {
  const gone = group.head
  const renumber: DeleteEffects['renumber'] = []
  if (gone.parentSetId === null && !gone.isWarmup) {
    const later = siblings
      .filter(
        (sibling) =>
          sibling.head.exerciseId === gone.exerciseId &&
          !sibling.head.isWarmup &&
          sibling.head.setNumber > gone.setNumber,
      )
      .sort((a, b) => a.head.setNumber - b.head.setNumber)
    later.forEach((sibling, i) => {
      const setNumber = gone.setNumber + i
      if (sibling.head.setNumber !== setNumber) renumber.push({ id: sibling.head.id, setNumber })
      for (const stage of sibling.stages) if (stage.setNumber !== setNumber) renumber.push({ id: stage.id, setNumber })
    })
  }
  return { deleteOrder: cascadeDeleteOrder(group, (log) => log.stageIndex), stageCount: group.stages.length, renumber }
}

// ─── Unlog ───────────────────────────────────────────────────────────────────────────────────────

/** A set log with the numbers a draft keeps. */
export type UnloggableSet = LoggedSet & Pick<SetLog, 'weight' | 'reps' | 'rir' | 'formRating' | 'enteredUnit'>

/** The numbers kept on the phone when a set is unlogged (G46 (a)). */
export interface SetDraft {
  weight: number | null
  reps: number | null
  rir: number | null
  formRating: FormRating | null
  enteredUnit: WeightUnit | null
}

/** A planned set's draft is keyed by it; an added set's by its local id with its exercise and position. */
export type SetDraftKey =
  | { sessionId: string; weekPlanSetId: string }
  | { sessionId: string; localId: string; exerciseId: string; position: number }

export interface UnlogEffects {
  /** The logs to delete: skipped drops from the last, then the head. */
  deleteOrder: LoggedSet[]
  draft: { key: SetDraftKey; values: SetDraft }
  /** A type the set was logged with and the plan doesn't have: a `retyped` change keyed by the planned set. */
  change?: SessionSetChange
}

/** SPEC 18c: a set with done drops after it can't be unlogged until they are gone (UNLOG is disabled and says so). */
export function canUnlog(group: SetGroup<LoggedSet>): boolean {
  return group.stages.every((stage) => stage.isSkipped)
}

/**
 * SPEC 18c, G46: what unlogging a logged set does. `row` is the set's row (from `resolveRows`). The log is
 * deleted (its skipped drops first) and its numbers become a draft. A set unlogged after its type was
 * changed keeps that type as a `retyped` change, so the retype survives; a set logged as planned adds none.
 * It says nothing about the rest timer or the session's status: unlogging never touches either.
 */
export function unlogEffects(
  group: SetGroup<UnloggableSet>,
  row: Pick<ResolvedRow, 'weekPlanSetId' | 'type' | 'plannedType' | 'retyped'>,
): UnlogEffects {
  if (group.head.parentSetId !== null) throw new RangeError('unlog is for a set; the draft key of a drop is not defined')
  if (!canUnlog(group)) throw new RangeError('a set with logged drops after it cannot be unlogged')
  const head = group.head
  const key: SetDraftKey =
    row.weekPlanSetId !== null
      ? { sessionId: head.sessionId, weekPlanSetId: row.weekPlanSetId }
      : { sessionId: head.sessionId, localId: head.id, exerciseId: head.exerciseId, position: head.setNumber }
  const effects: UnlogEffects = {
    deleteOrder: cascadeDeleteOrder(group, (log) => log.stageIndex),
    draft: {
      key,
      values: { weight: head.weight, reps: head.reps, rir: head.rir, formRating: head.formRating, enteredUnit: head.enteredUnit },
    },
  }
  const differs = row.type !== null && row.plannedType !== null && !sameType(row.type, row.plannedType)
  if (row.weekPlanSetId !== null && row.type !== null && (differs || row.retyped)) {
    effects.change = { kind: 'retyped', weekPlanSetId: row.weekPlanSetId, type: row.type }
  }
  return effects
}

// ─── Finishing ───────────────────────────────────────────────────────────────────────────────────

export interface FinishWarning {
  count: number
  /** The unlogged planned sets by exercise, in the session's order; numbers as the rows show them. */
  groups: Array<{ exerciseKey: string; exerciseName: string; numbers: number[] }>
  /** "2 planned sets aren't logged yet: EZ Bar Curl 01 and 02." (board W18) */
  text: string
  /** GO BACK scrolls to this row. */
  firstKey: string
}

function joinNumbers(numbers: number[]): string {
  const padded = numbers.map(pad2)
  if (padded.length < 2) return padded.join('')
  return `${padded.slice(0, -1).join(', ')} and ${padded[padded.length - 1]}`
}

/**
 * SPEC 11 / C6: the planned sets still unlogged when the session is finished, or null when there are none.
 * A planned set is a working set the plan has (not an added one, not a warmup, not a drop); a deleted one is
 * not in the order and a skipped one is settled.
 */
export function finishWarning(order: SessionOrder, logs: readonly LoggedSet[], changes: readonly SessionSetChange[] = []): FinishWarning | null {
  const open = resolveRows(order, logs, changes).filter((row) => row.kind === 'working' && row.state === 'unlogged' && row.weekPlanSetId !== null)
  if (open.length === 0) return null
  const groups: FinishWarning['groups'] = []
  for (const row of open) {
    const group = groups.find((g) => g.exerciseKey === row.exerciseKey)
    if (group) group.numbers.push(row.number)
    else groups.push({ exerciseKey: row.exerciseKey, exerciseName: row.exerciseName, numbers: [row.number] })
  }
  const count = open.length
  const lead = count === 1 ? "1 planned set isn't" : `${count} planned sets aren't`
  const text = `${lead} logged yet: ${groups.map((g) => `${g.exerciseName} ${joinNumbers(g.numbers)}`).join('; ')}.`
  return { count, groups, text, firstKey: open[0].key }
}

// ─── ADD ROUND ───────────────────────────────────────────────────────────────────────────────────

/**
 * SPEC Defaults 9: "+ ADD ROUND" adds one set to every member of the superset (board W1), whatever each
 * member has (3 and 2 sets become 4 and 3). Returns the new set of each member in block order, with the
 * place it takes; the caller adds one pending set to each.
 */
export function addRound(
  order: SessionOrder,
  rows: readonly ResolvedRow[],
  blockId: string,
): Array<{ exerciseKey: string; exerciseId: string; position: number }> {
  const unit = order.units.find((u): u is Extract<OrderUnit, { kind: 'block' }> => u.kind === 'block' && u.id === blockId)
  if (unit === undefined) throw new RangeError(`no superset block ${blockId}`)
  return unit.members.map((member) => ({
    exerciseKey: member.key,
    exerciseId: member.exerciseId,
    position: rows.filter((row) => row.exerciseKey === member.key && row.kind === 'working').length + 1,
  }))
}
