// Builders for workoutRules' tests: the app's own types (WeekPlanSet, SetLog, SessionSetChange), so the
// tests also prove the rules accept what the workout screen will hand them. Nothing here decides anything:
// every expected value in a test is written out by hand.

import type { SessionSetChange, SessionSetChangeType, SetLog, WeekPlanSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary'
import {
  resolveRows,
  sessionOrder,
  type AddedSet,
  type AddedSetKey,
  type HeldChange,
  type HeldDraft,
  type OrderExercise,
  type OrderSuperset,
  type ResolvedRow,
  type SessionOrder,
  type SessionView,
  type SetDraftKey,
} from './workoutRules'

export const SESSION = 's1'

/** The id of a planned set: set `index` (1-based, warmups counted: the plan's own numbering) of a card, or its drop. */
export function planId(key: string, index: number, drop?: number): string {
  return drop === undefined ? `${key}.${index}` : `${key}.${index}.${drop}`
}

/** What a card's logs carry as their exercise. */
export const exerciseIdOf = (key: string): string => `ex.${key}`

const STAGE_TOKENS = { d: 'dropset', m: 'myo_reps', r: 'rest_pause', c: 'cluster' } as const

/**
 * A card's planned sets as the plan holds them (real `WeekPlanSet`s), from space-separated tokens in set
 * order: `n` a normal working set, `a` an AMRAP set, `w` a warmup, a staged head with its drops written as
 * kind letter + count (`d2` a dropset with two drops, `m3` myo-reps, `r1` rest-pause, `c2` a cluster), and
 * `l1` a pre-1.1 dropset: its head carries no stage kind and has one planned drop.
 */
export function plannedSets(key: string, spec: string): WeekPlanSet[] {
  const base = (id: string, setNumber: number): WeekPlanSet => ({
    id,
    weekPlanId: 'plan',
    userId: 'u1',
    programExerciseId: key,
    setNumber,
    targetRir: null,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
  })
  const sets: WeekPlanSet[] = []
  spec
    .split(/\s+/)
    .filter(Boolean)
    .forEach((token, i) => {
      const index = i + 1
      const id = planId(key, index)
      if (token === 'w') sets.push({ ...base(id, index), isWarmup: true })
      else if (token === 'n') sets.push(base(id, index))
      else if (token === 'a') sets.push({ ...base(id, index), isAmrap: true })
      else {
        const legacy = token[0] === 'l'
        const kind = legacy ? null : STAGE_TOKENS[token[0] as keyof typeof STAGE_TOKENS]
        const drops = Number(token.slice(1))
        if ((!legacy && !kind) || !Number.isInteger(drops)) throw new Error(`unknown set token "${token}"`)
        sets.push(legacy ? base(id, index) : { ...base(id, index), stageKind: kind })
        for (let d = 1; d <= drops; d++) {
          sets.push({ ...base(planId(key, index, d), index), parentWeekPlanSetId: id, stageIndex: d, isDropset: true })
        }
      }
    })
  return sets
}

/**
 * A draft as the phone holds it: a bare key of a set added in the session is a draft of a Normal set (what a test that is
 * not about the type means), a bare key of anything else needs nothing more, and a `{ key, values }` entry is taken as it is.
 * A test about the type writes the entry, or uses `draftOf`.
 */
export function heldDraft(entry: SetDraftKey | HeldDraft): HeldDraft {
  if ('key' in entry) return entry
  return 'localId' in entry && !('drop' in entry) ? { key: entry, values: { type: { kind: 'normal' } } } : { key: entry }
}

/** The draft of a set added in the session with the type it keeps (DECISIONS 161). */
export const draftOf = (key: AddedSetKey, type: SessionSetChangeType): HeldDraft => ({ key, values: { type } })

/** The id a card gives the `n`-th set added to it in a test (1-based): its row key is `added:<card>:a<n>`. */
export const addedId = (n: number): string => `a${n}`

/**
 * A set added in the session as a test writes it in `card`'s list: a log of an added set (the set is logged, by that log), a
 * type (the set is open, with that type), or the entry itself. Unless the entry says otherwise, the n-th one's id is `a<n>`.
 */
export type AddedSpec = SetLog | SessionSetChangeType | AddedSet

function addedEntry(spec: AddedSpec, n: number): AddedSet {
  if ('localId' in spec) return spec
  if ('id' in spec) return { localId: addedId(n), logId: spec.id, type: { kind: spec.isWarmup ? 'warmup' : 'normal' } }
  return { localId: addedId(n), logId: null, type: spec }
}

/**
 * A card: its key doubles as its name's seed (`Bench` for `bench`) unless a name is given. `added` is the card's list of the
 * sets added in the session, in the order they were added (DECISIONS 170): a number is that many open Normal sets (ADD SET),
 * a list names each one (`AddedSpec`). `drafts` are the drafts the phone holds (bare keys read as Normal sets).
 */
export function card(
  key: string,
  spec: string,
  o: { name?: string; added?: number | readonly AddedSpec[]; drafts?: readonly (SetDraftKey | HeldDraft)[] } = {},
): OrderExercise {
  const name = o.name ?? key.charAt(0).toUpperCase() + key.slice(1)
  const added = typeof o.added === 'number' ? Array.from({ length: o.added }, (): AddedSpec => ({ kind: 'normal' })) : o.added
  return {
    key,
    exerciseId: exerciseIdOf(key),
    name,
    plannedSets: plannedSets(key, spec),
    ...(added === undefined ? {} : { added: added.map((entry, i) => addedEntry(entry, i + 1)) }),
    ...(o.drafts === undefined ? {} : { drafts: o.drafts.map(heldDraft) }),
  }
}

export function orderOf(exercises: OrderExercise[], supersets: OrderSuperset[] = []): SessionOrder {
  return sessionOrder(exercises, supersets)
}

/**
 * A row in one short string, read off its fields (not off the module's own labels): the card, where it sits
 * (`W1` a warmup, `A2` a superset member's round, `03` any other set, `.1` after it for a drop) and its state
 * (`✓` logged, `×` skipped, `·` unlogged).
 */
export function brief(row: ResolvedRow): string {
  const place =
    row.kind === 'warmup' ? `W${row.number}` : row.block ? `${row.block.letter}${row.block.round}` : String(row.number).padStart(2, '0')
  const drop = row.kind === 'stage' ? `.${row.stageNumber}` : ''
  const mark = row.state === 'logged' ? '✓' : row.state === 'skipped' ? '×' : '·'
  return `${row.exerciseKey} ${place}${drop}${mark}`
}

// ─── The card's own state for the sets added in the session (DECISIONS 170, 161) ─────────────────
// What the workout screen keeps beside the logs: its list of the sets added in the session, in the order they were added,
// each with its log while it has one and its type, and the drafts. A test that applies a rule's answer calls these to do
// what the card does with it (workoutRules.ts' header, "What the card keeps"), then reads the rows again from the cards.

/** The entry of the added set a row stands for, with its card; a row that is no added head is a caller's mistake here. */
function entryOf(cards: readonly OrderExercise[], row: Pick<ResolvedRow, 'exerciseKey' | 'added' | 'kind' | 'localId' | 'key'>) {
  if (!row.added || row.kind === 'stage' || row.localId === null) throw new Error(`${row.key} is not a set added in the session`)
  const exercise = cards.find((c) => c.key === row.exerciseKey)
  const at = exercise?.added?.findIndex((a) => a.localId === row.localId) ?? -1
  if (exercise === undefined || at < 0) throw new Error(`the card ${row.exerciseKey} does not list ${row.localId}`)
  return { exercise, at }
}

function withEntry(cards: readonly OrderExercise[], row: ResolvedRow, change: (entry: AddedSet, drafts: readonly HeldDraft[]) => { entry: AddedSet | null; drafts: readonly HeldDraft[] }) {
  const { exercise, at } = entryOf(cards, row)
  const { entry, drafts } = change(exercise.added![at], exercise.drafts ?? [])
  const added = exercise.added!.flatMap((a, i) => (i !== at ? [a] : entry === null ? [] : [entry]))
  return cards.map((c) => (c === exercise ? { ...c, added, drafts } : c))
}

const isDraftOf = (localId: string) => (draft: HeldDraft): boolean => 'localId' in draft.key && !('drop' in draft.key) && draft.key.localId === localId

/**
 * SET TYPE or a drop deleted on its own, on an added set (logged or not): the card keeps the answer's `type` as the set's, and
 * in its draft when it keeps one (the draft is what holds the type across a reload). Any other row is returned as it was: a
 * planned set's type is its change row.
 */
export function keepType(cards: readonly OrderExercise[], row: ResolvedRow, type: SessionSetChangeType): OrderExercise[] {
  if (!row.added || row.kind === 'stage') return [...cards]
  return withEntry(cards, row, (entry, drafts) => ({
    entry: { ...entry, type },
    drafts: drafts.map((d) => (isDraftOf(entry.localId)(d) ? { key: d.key as AddedSetKey, values: { type } } : d)),
  }))
}

/** LOG (or SKIP) of an added set: its entry names the new log, and its draft goes. */
export function loggedAdded(cards: readonly OrderExercise[], row: ResolvedRow, logId: string): OrderExercise[] {
  return withEntry(cards, row, (entry, drafts) => ({ entry: { ...entry, logId }, drafts: drafts.filter((d) => !isDraftOf(entry.localId)(d)) }))
}

/** UNLOG of an added set: its entry names no log, and the draft `unlogEffects` answered is kept beside it. */
export function unloggedAdded(cards: readonly OrderExercise[], row: ResolvedRow, draft: HeldDraft): OrderExercise[] {
  return withEntry(cards, row, (entry, drafts) => ({ entry: { ...entry, logId: null }, drafts: [...drafts.filter((d) => !isDraftOf(entry.localId)(d)), draft] }))
}

/** DELETE of an added set: its entry goes, and its draft with it. */
export function deletedAdded(cards: readonly OrderExercise[], row: ResolvedRow): OrderExercise[] {
  return withEntry(cards, row, (entry, drafts) => ({ entry: null, drafts: drafts.filter((d) => !isDraftOf(entry.localId)(d)) }))
}

/** ADD SET (or a member's share of ADD ROUND): a new entry at the end of the card's list, open, with the type given (Normal). */
export function addSet(cards: readonly OrderExercise[], key: string, localId: string, type: SessionSetChangeType = { kind: 'normal' }): OrderExercise[] {
  return cards.map((c) => (c.key === key ? { ...c, added: [...(c.added ?? []), { localId, logId: null, type }] } : c))
}

// ─── Logs ────────────────────────────────────────────────────────────────────────────────────────

export interface LogOptions {
  /**
   * The `set_number` it was logged with: for a head the planned index (right for a card without warmups; pass the
   * number the screen showed otherwise, warmups apart), for an added set its place among the added ones.
   */
  number?: number
  skipped?: boolean
  warmup?: boolean
  /** The head's stage kind as logged (the type as done); null (the default) is Normal or a pre-1.1 head. */
  stageKind?: StageKind | null
  weight?: number | null
  reps?: number | null
  rir?: number | null
}

function baseLog(id: string, exerciseId: string, o: LogOptions): SetLog {
  const skipped = o.skipped ?? false
  return {
    id,
    userId: 'u1',
    sessionId: SESSION,
    exerciseId,
    weekPlanSetId: null,
    setNumber: o.number ?? 1,
    weight: skipped ? null : o.weight === undefined ? 50 : o.weight,
    reps: skipped ? null : o.reps === undefined ? 10 : o.reps,
    rir: o.rir === undefined ? 2 : o.rir,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: o.warmup ?? false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: skipped,
    loggedAt: '2026-10-12T18:00:00Z',
    restSeconds: null,
    formRating: null,
    stageKind: o.stageKind ?? null,
  }
}

/** The log of planned set `index` of a card (a head). */
export function headLog(key: string, index: number, o: LogOptions = {}): SetLog {
  return { ...baseLog(`log.${key}.${index}`, exerciseIdOf(key), { number: index, ...o }), weekPlanSetId: planId(key, index) }
}

/** The log of a set added in the session: no planned set behind it. */
export function addedLog(key: string, n: number, o: LogOptions = {}): SetLog {
  return baseLog(`log.${key}.added${n}`, exerciseIdOf(key), { number: n, ...o })
}

/** A logged drop under a head; carries the head's `set_number`, as the app writes it. */
export function dropLog(parent: SetLog, stageIndex: number, o: LogOptions = {}): SetLog {
  return {
    ...baseLog(`${parent.id}.d${stageIndex}`, parent.exerciseId, { number: parent.setNumber, ...o }),
    parentSetId: parent.id,
    isDropset: true,
    stageIndex,
    stageKind: null,
  }
}

// ─── Changes ─────────────────────────────────────────────────────────────────────────────────────

export const deleted = (key: string, index: number): SessionSetChange => ({ kind: 'deleted', weekPlanSetId: planId(key, index) })

export const retyped = (key: string, index: number, type: SessionSetChangeType): SessionSetChange => ({
  kind: 'retyped',
  weekPlanSetId: planId(key, index),
  type,
})

export const pending = (log: SetLog, stageKind: StageKind, stageCount: number): SessionSetChange => ({
  kind: 'pending_stages',
  setLogId: log.id,
  stageKind,
  stageCount,
})

export const staged = (stageKind: StageKind, stageCount: number): SessionSetChangeType => ({ kind: 'staged', stageKind, stageCount })

/** A change as the session holds it: the change with the id of its stored row. */
export const held = (change: SessionSetChange, id: string): HeldChange => ({ ...change, id })

// ─── The session as the writing rules read it ───────────────────────────────────────────────────

/** The rows as `resolveRows` draws them from the order, the logs and the changes held, with the logs and changes themselves. */
export function viewOf(order: SessionOrder, logs: SetLog[], changes: HeldChange[] = []): SessionView & { logs: SetLog[] } {
  return { rows: resolveRows(order, logs, changes), logs, changes }
}

/** The row with this key, or an error naming the keys there are. */
export function rowKeyed(view: Pick<SessionView, 'rows'>, key: string): ResolvedRow {
  const found = view.rows.find((r) => r.key === key)
  if (!found) throw new Error(`no row ${key}; the rows are ${view.rows.map((r) => r.key).join(', ')}`)
  return found
}

/** Freezes a value and everything inside it: a function handed this can read it and nothing else. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}
