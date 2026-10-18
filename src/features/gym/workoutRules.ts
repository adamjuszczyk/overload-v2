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
//     added sets (`weekPlanSetId` null) by their `setNumber` against the exercise's added rows and the drafts
//     the phone holds for added sets that were unlogged.
// A set that was logged takes its type from its log (SPEC Objects stored: "set kind and stage kind as
// done"), so a logged planned dropset switched to Normal has no drop rows left although the plan still
// holds them; a null kind on a head with planned drops, or with logged drops, still reads as a dropset
// (`resolveStageKind`, pre-1.1 data).
//
// ─── What a row's number is (DECISIONS 151, Adam 2026-10-16) ─────────────────────────────────────
// "An unlogged set keeps its number and its place. Logging it again stores it with that same number, so unlog
// then log is an exact undo (SPEC 18c). No other set's number changes on unlog. The open row shows its own
// number (a planned set's position; an added set's number from its draft), never 'the next after the logged ones'."
//   - A logged or skipped working set shows the `setNumber` it was logged with, and holds it.
//   - An open one takes the lowest number that no working set of its exercise holds, in the order of the plan (a
//     planned set first, then an added set that keeps a draft, then a new one). With the numbers the sets were
//     logged with being their places (every set LOGGED from 58a on: see below) that is its position, whichever
//     of the sets around it are logged: unlog 02 of 01 to 03 and it is still 02, with 04 after the logged 03. With
//     numbers that are gapless in the order sets were logged (1.1's rule) it is the number after them, as the cards
//     number a set today.
//   - An added set is numbered with the planned ones and put in the order of its number; one that was unlogged keeps
//     its draft (`OrderExercise.drafts`), which is how it is still a row after a reload, and its row says which
//     (`draftKey`, and `draftPosition` for its position).
//   - A drop shows its head's number. Warmups are numbered among themselves, by their place; an open added Warmup takes
//     no working number, and sits among the added sets where its number would have been (its draft's position, or the
//     lowest free number at its turn), so a switch to Warmup and back leaves every set in its place.
//
// ─── An added set's type (DECISIONS 161, Adam 2026-10-16) ─────────────────────────────────────────
// "An added set's draft also keeps its type, so an unlog is undone exactly and nothing moves; 46's rules see every added
// set's type." A set added in the session (ADD SET, ADD ROUND) has no planned set and, until it is logged, no log or
// change row to hold its type (TASKS 62: the card's own state), so the card hands it to the rules:
//   - a set that was logged and unlogged again keeps a draft, and the draft holds its type: `HeldDraft.values.type`,
//     which chunk 63 stores from `unlogEffects`' `draft.values.type`. A draft of an added set without one is refused;
//   - a set never logged keeps its type in the card: `OrderExercise.addedTypes`, the types of the card's new added sets
//     (not logged, no draft) in the order they were added, and a row says which it is (`addedIndex`, the index into that
//     list). The type belongs to the set and not to its row key (`added:<card>:<n>`, which moves when numbers do). The
//     card removes an entry when its set is logged or deleted; an entry that is missing reads Normal, which is what ADD
//     SET gives, and an extra one is ignored (the lists can lag one another for a render);
//   - a logged set has its type in its log (`is_warmup`, `stage_kind`, the `pending_stages` row).
// So an open added Warmup is a warmup row like any other: never the current set, its LOG never asks (G54), and it holds
// no working number, so the working sets read 1 to n without it (146 (a)); an open added dropset has its drops as open
// rows. `applySetTypeChange` says the type to keep (`type`) and, for a switch to or from Warmup, the logged sets that
// move. LOG of such a set writes the log with `typeColumns(row.type)` (`isWarmup`, `stageKind`) and, for a staged type,
// the `pending_stages` row; without that row it reads as Normal once logged.
// LOG STORES `row.number`: the number the row shows, never "the logged heads + 1" (58a's `handleLogHead`, 63's
// re-log and a skip all write it). That is what makes the stored numbers the places of the sets, and a set logged
// again an exact undo.
//
// ─── Current set and the lock ────────────────────────────────────────────────────────────────────
// - The current set is the first unlogged working set or drop in the order (SPEC: "the first unlogged
//   working set or stage in the session's order"). A skipped set is settled, not unlogged ("it stays open
//   until you log or skip it"); the drops of a skipped head are dead and never current.
// - A warmup never takes part, whichever way it is shown, and its LOG never asks (G54).
// - With the lock on (`logInOrder`) only the current set's LOG logs straight away; LOG on any other row
//   asks "Log A2 before set 03?" (board W7b); with it off every LOG logs.
//
// ─── The session's change rows (042; Adam's data-model rules, 2026-10-14 and 15) ─────────────────
// `v2_session_set_changes` holds what a session did to a set that its log can't say. The rules every
// writer here follows, so that chunks 61 to 63 only have to carry them out:
//   - ONE change row per planned set per session (`deleted` or `retyped`; a partial unique index refuses
//     a second one), and one `pending_stages` row per log;
//   - a `retyped` row is keyed by the planned set WHETHER OR NOT THE SET IS LOGGED (141 (a)); an added set
//     never gets one (it has no planned set; its log carries its type);
//   - a later delete turns the `retyped` row into `deleted` in ONE write that clears the type, with the
//     row's own id (a second row for the set is refused, and a kind-only update of a row that holds a
//     warmup or a stage kind is refused by 042's checks): `ChangeWrite.id` is that id (null: a new row,
//     the writer makes the id) and `changeColumns` is the whole row to write;
//   - every function that writes reads the changes AS THE SESSION HOLDS THEM (`HeldChange`: the change
//     with the stored row's id) and says which row each change it returns replaces.
//
// ─── What a set type change writes ───────────────────────────────────────────────────────────────
// `applySetTypeChange` is the one place a picked type becomes storage (Checks that lied #15: no writer
// maps a type on its own). `typeColumns` / `typeOfColumns` are the same mapping for a change row.
//   - an upcoming planned set: a `retyped` change keyed by the planned set (nothing on the plan);
//   - a logged head: its log's `is_warmup` / `stage_kind` are patched and, for a staged type, a
//     `pending_stages` change keyed by the log holds the head's total drop count; Normal and Warmup
//     remove the drops, and logged drops are deleted only after the confirm (19c). A logged PLANNED head
//     also gets the `retyped` change, keyed by its planned set (141 (a): next week's REVIEW reads the
//     type as done through the change rows);
//   - an added set that is not logged yet has no row to write: its type is the card's own state (or its draft's), and
//     the `type` of the answer is what the card keeps (DECISIONS 161);
//   - a set switched to or from Warmup renumbers the working sets as a delete does (DECISIONS 146 (a)):
//     `renumber` lists the logs whose `set_number` changes. An open set has no log of its own to change, but
//     the logged sets after it move with it (an open set keeps its place, so a logged set can come after it); an open
//     added set is one of these like a planned one;
//   - a logged warmup with no weight or reps made a working set carries the two numbers with the type, in the
//     same patch, because the table refuses a working set without them (DECISIONS 152 (a), Adam 2026-10-16: the
//     panel asks for them first): `typeChangeNeedsNumbers` says when, and `applySetTypeChange` refuses to answer
//     without `numbers`.
//
// ─── Delete, unlog, finish ───────────────────────────────────────────────────────────────────────
// - `deleteEffects` says everything DELETE does, so that a deleted set never comes back as an open row
//   (SPEC 18b: "The remaining sets renumber", 13c: a deleted planned set counts as Skipped):
//     * a set that has logs: the drops from the last, then the head (the cascade order of
//       `setGroupLogic.ts`); every later head of the same exercise and its drops move down one (F4: a
//       renumbered head's drops used to keep their old number). Open sets keep their places, so "one less" is
//       right and "consecutive from the gap" is not: 01, 02 and 05 logged with 03 and 04 open, 02 deleted,
//       leaves 05 as 04. An open set that is deleted moves the logged sets after it the same way (151);
//     * a planned set, logged or not: a `deleted` change that replaces its `retyped` change (the plan has
//       the slot, and only the change row says it is gone). An added set needs none: the card lowers its
//       count of added sets;
//     * a drop on its own, logged or not (board W8): its set has one drop fewer, kept by the change rows
//       (a `pending_stages` row for a logged head, the `retyped` row for a planned one); a set left with
//       no drop is a Normal set (DECISIONS 147 (a)): a logged head loses its stage kind and a planned
//       set gets a `retyped` Normal row. The drops left are the first ones: rows read them by count.
// - `canUnlog` / `unlogEffects`: a set with logged (done) drops after it cannot be unlogged; skipped
//   drops go with it. A logged drop can be unlogged under the same rule (DECISIONS 147 (b)): not while a
//   later drop of its set is logged. The kept numbers are a draft on the phone (G46), never a server
//   row; the draft's key is the set's own (the planned set, or for an added set its local id, exercise and
//   position) and, for a drop, its number under the set. A type a planned set was logged with, and the plan
//   doesn't have, travels as a `retyped` change so unlog never loses it; an added set has no planned set, so its
//   draft holds the type (DECISIONS 161). Nothing it returns touches the rest timer or the session's status
//   (Defaults 6). It renumbers nothing: the set is open again at its number, as the type it was, and no other
//   set moves (DECISIONS 151, 161); logging it again stores that number.
// - `finishWarning`: the unlogged planned sets, by exercise and number (board W18); deleted sets are not
//   in the order, skipped ones are settled.
//
// ─── How the screens call it (58a to 64) ──────────────────────────────────────────────────────────
//   const order = sessionOrder(cards, blocks)              // the cards as drawn: plan, swaps, added exercises, the phone's drafts,
//                                                          // and the type of every added set that has no log (161)
//   const rows = resolveRows(order, logs, changes)         // what every card draws; one list
//   const current = currentSet(order, logs, changes)       // the first unlogged working set or drop of `rows`
//   lockDecision({ logInOrder, current, tapped })          // 'log', or the question's words for the sheet
//   const session = { rows, logs, changes }                // `changes` with the stored rows' ids (`HeldChange`)
//   typeChangeNeedsNumbers({ row, pick, session })         // a numberless warmup made a working set: ask for the numbers first
//   applySetTypeChange({ row, pick, session, numbers })    // a picked type -> the log patch, drops, change rows, numbers
//   deleteEffects(row, session) / canUnlog(row, session) / unlogEffects(row, session)
//   finishWarning(order, logs, changes) / addRound(order, rows, blockId)
// None of them writes: each returns what the caller writes. The order of the writes is the caller's
// (chunk 61 chooses it for the offline queue: until a deleted set's change row has landed, a refetch
// draws the set as an open row).
//
// ─── Where SPEC is silent (readings built; DECISIONS asks) ─────────────────────────────────────────
// - Finish: an unlogged planned warmup and an unlogged drop of a logged set are not listed (warmups are
//   never counted in set counts; stages are never separate sets).
// - Unlog: a skipped drop doesn't stop the unlog of its set and goes with it; the same for the skipped drops
//   after a drop that is unlogged (rows read a set's drops by count, so a log left after it would move up
//   into the place of the drop that is open again).
// - Unlog keeps the number of an added set in its draft's key (`position`), and of a planned set nowhere: the planned
//   set's number is its position, which the rows work out (151). A draft's position can fall out of date when
//   sets before the added set are deleted or switched to or from Warmup while it is open; the rows number it by
//   the lowest number free then, and `draftKey` still finds its draft. The caller drops a draft's key when the
//   set is logged again or deleted.
// - A set type pick with fewer drops than are logged deletes the extra logged drops after the question
//   (19c asks for Normal; the same question is asked here).
// - An added set that is not logged yet keeps its type in the card or its draft (above); once logged, the caller writes
//   its `pending_stages`. An added set can be switched to Warmup like any set, logged or not: its row is drawn as a
//   warmup.
// - Where an open added Warmup sits among the added sets (which sets get which `added:<card>:<n>` key and which Warmup is
//   W1): at the number it had (a logged one's, or its draft's position), else at the lowest free number at its turn, and a
//   warmup before a working set on a tie, logged or not. SPEC keeps no record of the order sets were added in, so a Warmup that was never logged and
//   is made Normal again joins the working sets at that place.
// - The stored `stage_index` of the drops left after a drop is deleted is not renumbered (rows read the
//   drops by count, and `nextStageIndex` already allows gaps); a warmup's stored `set_number` is not
//   kept (warmups are numbered by their place), so switching a set to Warmup leaves its own number alone.
//
// ─── Provisional, D31 (display wording where no board gives it) ───────────────────────────────────
// A plain row is called "set 03" in the lock's question (the board names a superset member "A2"); a drop
// "set 03 drop 1" ("stage 1" for the kinds that are not dropsets); the finish sentence joins the numbers
// of one exercise with "and" and separates exercises with a semicolon.

import type {
  FormRating,
  SessionSetChange,
  SessionSetChangeRecord,
  SessionSetChangeType,
  SetLog,
  WeekPlanSet,
  WeightUnit,
} from '../../types'
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

/** A change as the session holds it: the union of chunk 36, with the id of the stored row it came from. */
export type HeldChange = SessionSetChange & Pick<SessionSetChangeRecord, 'id'>

/**
 * A `v2_session_set_changes` row to write. `id` is the id of the row the session already holds for the same
 * planned set (or, for `pending_stages`, the same log), which this write replaces; null when there is none and
 * the writer makes the id. A second row for one planned set is refused (23505), and the sync queue upserts by
 * id, so a write that replaces a row must carry that row's id. `changeColumns(change)` is the whole row.
 */
export interface ChangeWrite {
  change: SessionSetChange
  id: string | null
}

/** What the rules that write need to read: the rows as drawn (`resolveRows`), the logs and the changes held. */
export interface SessionView {
  rows: readonly ResolvedRow[]
  logs: readonly LoggedSet[]
  changes: readonly HeldChange[]
}

/** A set log with its weight and reps. */
export type NumberedSet = LoggedSet & Pick<SetLog, 'weight' | 'reps'>

/** The session as `applySetTypeChange` reads it: its logs carry the weight and reps a warmup made a working set must have. */
export type TypeChangeView = Omit<SessionView, 'logs'> & { logs: readonly NumberedSet[] }

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
  /**
   * The types of the sets added in the session that are neither logged nor kept as a draft ("new" ones), in the order they
   * were added (DECISIONS 161): the card's own state for them (TASKS 62). The n-th new set has the n-th type, and its row
   * says so (`addedIndex`), so the type belongs to the set and not to its row key or its number. The card removes an entry
   * when its set is logged or deleted. A set with no entry is Normal (what ADD SET gives; the lists can lag one another
   * for a render); an entry past the last new set is ignored.
   */
  addedTypes?: readonly SessionSetChangeType[]
  /**
   * The drafts the phone holds for the session (G46). Only the draft of a set added in the session and unlogged again is
   * read, and each is a slot of its own, so the set is still a row after a reload and takes its number before a new
   * slot does (DECISIONS 151: "an added set's number from its draft"; the key's `position` is the number it was logged
   * with). Its type is the draft's (DECISIONS 161: `values.type`, required). The row carries `draftKey`, which is how
   * the screen finds the draft. A draft of a planned set, of a drop or of another exercise is ignored.
   */
  drafts?: readonly HeldDraft[]
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
  /**
   * The set's place among its exercise's sets in the order the plan gives them (warmups and working sets
   * together, then the sets added in the session), counted from 1 over the sets that are left; a drop has its
   * head's. Only the order means anything. It does not change when a set is switched to or from Warmup, which
   * is what places a set among the working numbers when it joins them (DECISIONS 146 (a)).
   */
  planIndex: number
  /**
   * A set added in the session that was unlogged and keeps a draft on the phone (G46): the `position` of that draft's
   * key, which is how the screen finds the draft. The number the row shows is the lowest one free, which is the draft's
   * position unless the sets before it have been deleted or switched to or from Warmup since. Null on every other row.
   */
  draftPosition: number | null
  /**
   * The key of that draft: the screen finds the draft by it. `draftPosition` is not enough once a Warmup keeps a number a
   * working set takes later (two drafts of one exercise can then name one position); the `localId` tells them apart.
   */
  draftKey: AddedSetKey | null
  /**
   * A set added in the session that is neither logged nor kept as a draft: its index in `OrderExercise.addedTypes`, which
   * is how the screen finds the type the card keeps for it (DECISIONS 161). Null on every other row.
   */
  addedIndex: number | null
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

/**
 * The columns of a `v2_session_set_changes` row, whole: every column the type touches is named, so a write
 * that turns a `retyped` row into `deleted` clears the warmup flag, the stage kind and the stage count in the
 * same statement (042 refuses a `deleted` row that still holds a type, and a kind-only update of such a row).
 */
export interface ChangeColumns extends TypeColumns {
  kind: SessionSetChange['kind']
  weekPlanSetId: string | null
  setLogId: string | null
}

export function changeColumns(change: SessionSetChange): ChangeColumns {
  switch (change.kind) {
    case 'deleted':
      return { kind: 'deleted', weekPlanSetId: change.weekPlanSetId, setLogId: null, ...typeColumns(NORMAL) }
    case 'retyped':
      return { kind: 'retyped', weekPlanSetId: change.weekPlanSetId, setLogId: null, ...typeColumns(change.type) }
    case 'pending_stages':
      return {
        kind: 'pending_stages',
        weekPlanSetId: null,
        setLogId: change.setLogId,
        isWarmup: false,
        stageKind: change.stageKind,
        stageCount: change.stageCount,
      }
  }
}

// The row the session holds for a planned set (`deleted` or `retyped`: one per set) and for a log
// (`pending_stages`), and the write that replaces it. A change with no row yet is written with no id.
const heldForPlannedSet = (changes: readonly HeldChange[], weekPlanSetId: string): HeldChange | undefined =>
  changes.find((c) => (c.kind === 'deleted' || c.kind === 'retyped') && c.weekPlanSetId === weekPlanSetId)

const heldForLog = (changes: readonly HeldChange[], setLogId: string): HeldChange | undefined =>
  changes.find((c) => c.kind === 'pending_stages' && c.setLogId === setLogId)

function retypedWrite(weekPlanSetId: string, type: SessionSetChangeType, changes: readonly HeldChange[]): ChangeWrite {
  return { change: { kind: 'retyped', weekPlanSetId, type }, id: heldForPlannedSet(changes, weekPlanSetId)?.id ?? null }
}

function deletedWrite(weekPlanSetId: string, changes: readonly HeldChange[]): ChangeWrite {
  return { change: { kind: 'deleted', weekPlanSetId }, id: heldForPlannedSet(changes, weekPlanSetId)?.id ?? null }
}

function pendingWrite(setLogId: string, stageKind: StageKind, stageCount: number, changes: readonly HeldChange[]): ChangeWrite {
  return { change: { kind: 'pending_stages', setLogId, stageKind, stageCount }, id: heldForLog(changes, setLogId)?.id ?? null }
}

// The type of a head that has a log: the log is authoritative for the kind, the change or the plan only
// say how many drops (see the header). `planned` is null for an added set.
//   - A log with a stage kind is a staged set of that kind; how many drops it has is the most specific
//     count that names the same kind: the `pending_stages` row (keyed by the log), else the `retyped` row
//     (keyed by the planned set), else the plan's, never fewer than the drops logged.
//   - A log with no kind is Normal, unless the head is a pre-1.1 dropset (drops planned for a head with no
//     kind, or drops logged under it): then it reads as a dropset, counted the same way. A `retyped` row that
//     says Normal settles it the other way (a kindless dropset switched to Normal, or whose last drop was
//     deleted: DECISIONS 141 (b), 147 (a)) unless drops are logged: a drop that exists is never hidden.
function loggedHeadType(
  log: LoggedSet,
  planned: { stageKind: StageKind | null; stageCount: number } | null,
  retyped: RetypedChange | undefined,
  pending: PendingStagesChange | undefined,
  loggedStages: number,
): SessionSetChangeType {
  if (log.isWarmup) return WARMUP
  const logKind = log.stageKind ?? null
  if (logKind === null && loggedStages === 0 && retyped !== undefined && retyped.type.kind === 'normal') return NORMAL
  const plannedKind = planned !== null ? planned.stageKind : null
  const plannedCount = planned !== null ? planned.stageCount : 0
  const legacy = logKind === null && plannedKind === null && plannedCount > 0
  const kind: StageKind | null = logKind ?? (legacy || loggedStages > 0 ? resolveStageKind(null) : null)
  if (kind === null) return NORMAL
  let said = 0
  if (pending !== undefined && pending.stageKind === kind) said = pending.stageCount
  else if (retyped !== undefined && retyped.type.kind === 'staged' && retyped.type.stageKind === kind) said = retyped.type.stageCount
  else if (plannedKind === logKind) said = plannedCount
  const count = Math.max(said, loggedStages)
  return count > 0 ? { kind: 'staged', stageKind: kind, stageCount: count } : NORMAL
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
  /** Where it sits among the added sets: the number it holds or would take (a warmup holds none). Only added sets are sorted by it. */
  place: number
  planIndex: number
  draftKey: AddedSetKey | null
  addedIndex: number | null
}

/** A type as the card or a draft hands it over, checked and copied (the rows share the frozen Normal and Warmup). */
function heldType(type: SessionSetChangeType | undefined, what: string): SessionSetChangeType {
  switch (type?.kind) {
    case 'normal':
      return NORMAL
    case 'warmup':
      return WARMUP
    case 'staged':
      if (!Number.isInteger(type.stageCount) || type.stageCount < 1) throw new RangeError(`${what}: a staged set has at least one drop`)
      return { kind: 'staged', stageKind: type.stageKind, stageCount: type.stageCount }
    default:
      throw new TypeError(`${what} has no type`)
  }
}

/** The draft of a set added in the session: its key names a local id and no drop. */
type AddedDraft = Extract<HeldDraft, { key: AddedSetKey }>
const isAddedDraft = (draft: HeldDraft): draft is AddedDraft => 'localId' in draft.key && !('drop' in draft.key)

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
      place: 0,
      planIndex: 0, // set below, once the added sets are in their places
      draftKey: null,
      addedIndex: null,
    })
  }

  // The sets added in the session come after the planned ones. A logged one is the slot of the number it was logged with; an
  // unlogged one that keeps a draft (DECISIONS 151) is a slot of its own, found by the draft's `position`, with the type the
  // draft holds (DECISIONS 161); the rest are new slots (ADD SET, or a draft the phone no longer holds), each with the type the
  // card keeps for it. They are numbered with the planned sets below, and then put in the order of their numbers, so a slot
  // keeps its place whichever of them were logged first. A set added and then switched to Warmup is still that row (drawn as a
  // warmup: the type is the log's, or the card's or draft's while it is open).
  const addedLogs = session.headLogs.filter((log) => log.exerciseId === exercise.exerciseId && log.weekPlanSetId === null)
  const drafted = (exercise.drafts ?? [])
    .filter((draft): draft is AddedDraft => isAddedDraft(draft) && draft.key.exerciseId === exercise.exerciseId)
    .sort((a, b) => a.key.position - b.key.position)
  const planned = heads.length
  const slots: Array<{ log: LoggedSet | null; openType: SessionSetChangeType; draftKey: AddedSetKey | null; addedIndex: number | null }> = [
    ...addedLogs.map((log) => ({ log, openType: NORMAL, draftKey: null, addedIndex: null })),
    ...drafted.map((draft) => ({
      log: null,
      openType: heldType(draft.values?.type, `the draft of the set added at ${draft.key.position} of ${exercise.name}`),
      draftKey: draft.key,
      addedIndex: null,
    })),
  ]
  for (let fresh = 0; slots.length < (exercise.addedSets ?? 0); fresh++) {
    const type = exercise.addedTypes?.[fresh]
    slots.push({ log: null, openType: type === undefined ? NORMAL : heldType(type, `the ${fresh + 1}th new set added to ${exercise.name}`), draftKey: null, addedIndex: fresh })
  }
  for (const { log, openType, draftKey, addedIndex } of slots) {
    const stageLogs = log ? session.stagesByParent.get(log.id) ?? [] : []
    heads.push({
      key: '',
      exercise,
      weekPlanSetId: null,
      added: true,
      log,
      stageLogs,
      type: log ? loggedHeadType(log, null, undefined, session.pending.get(log.id), stageLogs.length) : openType,
      plannedType: null,
      retyped: false,
      number: 0,
      place: 0,
      planIndex: 0,
      draftKey,
      addedIndex,
    })
  }

  // DECISIONS 151: a working set that is logged or skipped shows the number it was logged with and holds it; an open one of the plan
  // takes the lowest number no other working set of its exercise holds, in the order of the plan. An open added set shows its
  // number from its draft (151) whenever that number is free and is no more than the count of working sets, so it comes back to
  // the place it left even with new sets open before it; a draft that no longer fits (the sets before it were deleted or switched
  // to Warmup since) takes the lowest number free, never two rows alike and never a hole. The new sets (no draft) take the numbers
  // that are left, in the order they were added. So an open set keeps its place whatever is logged around it (unlog 02 of 01 to
  // 03 and it is still 02), and the numbers of sets logged one after the other (1.1's, and any whose logs are gapless) read as they
  // always did. A warmup holds no working number; it keeps a place among the added sets all the same (`place`): the number it was
  // logged with (a logged one's, or its draft's), else the one it would take at its turn.
  const held = new Set<number>()
  for (const log of session.headLogs) if (log.exerciseId === exercise.exerciseId && !log.isWarmup) held.add(log.setNumber)
  const taken = new Set(held)
  const lowestFree = (): number => {
    let n = 1
    while (taken.has(n)) n += 1
    return n
  }
  const takeLowest = (head: Head): void => {
    head.number = lowestFree()
    taken.add(head.number)
  }
  const openWorking = (head: Head): boolean => head.log === null && head.type.kind !== 'warmup'
  const workingCount = heads.filter((head) => head.type.kind !== 'warmup').length
  for (const head of heads) if (head.log && head.type.kind !== 'warmup') head.number = head.log.setNumber
  for (const head of heads.slice(0, planned)) if (openWorking(head)) takeLowest(head)
  for (const head of heads.slice(planned)) {
    const claim = head.draftKey?.position ?? null
    if (openWorking(head) && claim !== null && claim <= workingCount && !taken.has(claim)) {
      head.number = claim
      taken.add(claim)
    }
  }
  for (const head of heads.slice(planned)) {
    if (head.type.kind === 'warmup') head.place = head.log ? head.log.setNumber : head.draftKey?.position ?? lowestFree()
    else if (openWorking(head) && head.number === 0) takeLowest(head)
  }
  for (const head of heads) if (head.type.kind !== 'warmup') head.place = head.number
  // The added sets in the order of their places; on a tie a warmup comes first (it left the working numbers at that number, and the
  // set after it closed the gap or took the number, 146 (a)), logged or not, so unlogging it moves no key); any other tie keeps the
  // order the slots were made in. Then each one's key and place.
  const warmupFirst = (head: Head): number => (head.type.kind === 'warmup' ? 0 : 1)
  const addedHeads = heads.splice(planned).sort((a, b) => a.place - b.place || warmupFirst(a) - warmupFirst(b))
  addedHeads.forEach((head, i) => {
    head.key = addedRowKey(exercise.key, i + 1)
  })
  heads.push(...addedHeads)
  heads.forEach((head, i) => {
    head.planIndex = i + 1
  })

  // A head that is a warmup now (planned so, retyped so, or logged so) is not one of the working sets.
  const warmups = heads.filter((head) => head.type.kind === 'warmup')
  const workings = heads.filter((head) => head.type.kind !== 'warmup')
  warmups.forEach((head, i) => {
    head.number = i + 1
  })
  return { warmups, workings }
}

type Block = NonNullable<ResolvedRow['block']>

function rowsOf(head: Head, block: Block | null): ResolvedRow[] {
  const state: RowState = head.log === null ? 'unlogged' : head.log.isSkipped ? 'skipped' : 'logged'
  const stageKind = head.type.kind === 'staged' ? head.type.stageKind : null
  const common = {
    exerciseKey: head.exercise.key,
    exerciseId: head.exercise.exerciseId,
    exerciseName: head.exercise.name,
    added: head.added,
    number: head.number,
    planIndex: head.planIndex,
    block,
  }
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
      draftPosition: head.draftKey?.position ?? null,
      draftKey: head.draftKey,
      addedIndex: head.addedIndex,
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
        draftPosition: null,
        draftKey: null,
        addedIndex: null,
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

// ─── What the writing rules read ─────────────────────────────────────────────────────────────────

/** A log whose `set_number` changes, with the number it takes. */
export interface NumberPatch {
  id: string
  setNumber: number
}

/** The log a row stands for. A row that has none, or one the session doesn't hold, is a caller bug. */
function logOf<L extends LoggedSet>(row: Pick<ResolvedRow, 'key' | 'logId'>, logs: readonly L[]): L {
  if (row.logId === null) throw new RangeError(`the row ${row.key} has no log`)
  const log = logs.find((l) => l.id === row.logId)
  if (log === undefined) throw new RangeError(`the log ${row.logId} of the row ${row.key} is not among the session's logs`)
  return log
}

/** The logs under a head, by stage index. */
const stagesOf = <L extends LoggedSet>(logs: readonly L[], headId: string): L[] =>
  logs.filter((log) => log.parentSetId === headId).sort((a, b) => a.stageIndex - b.stageIndex)

/** The session's head logs, each with its drops. */
const groupsOf = (logs: readonly LoggedSet[]): SetGroup<LoggedSet>[] =>
  groupByParent(
    [...logs],
    (l) => l.id,
    (l) => l.parentSetId,
    (l) => l.stageIndex,
  )

// A head and its drops all carry the head's number (the app writes a drop with its head's `set_number`).
function numbersOf(group: SetGroup<LoggedSet>, setNumber: number): NumberPatch[] {
  const patches: NumberPatch[] = []
  if (group.head.setNumber !== setNumber) patches.push({ id: group.head.id, setNumber })
  for (const stage of group.stages) if (stage.setNumber !== setNumber) patches.push({ id: stage.id, setNumber })
  return patches
}

/**
 * SPEC 18b: a working set numbered `number` leaves its exercise's working sets (deleted, or switched to Warmup). The
 * logged sets after it move down one, with their drops; the open ones after it follow by themselves. It is one
 * less for each, not "consecutive from the gap": an open set between them holds its place (DECISIONS 151).
 */
function closeGap(exerciseId: string, number: number, groups: readonly SetGroup<LoggedSet>[]): NumberPatch[] {
  return groups
    .filter((g) => g.head.exerciseId === exerciseId && !g.head.isWarmup && g.head.setNumber > number)
    .sort((a, b) => a.head.setNumber - b.head.setNumber)
    .flatMap((g) => numbersOf(g, g.head.setNumber - 1))
}

/**
 * DECISIONS 146 (a): a set joins its exercise's working sets as number `place`, and the logged working sets from there on
 * move up one. `entering` is its log with the drops under it, when it has a log (a warmup that is still to do has
 * none, and its number is worked out when it is logged).
 */
function makeRoom(
  entering: SetGroup<LoggedSet> | null,
  exerciseId: string,
  place: number,
  groups: readonly SetGroup<LoggedSet>[],
): NumberPatch[] {
  const after = groups
    .filter((g) => g.head.exerciseId === exerciseId && !g.head.isWarmup && g.head.setNumber >= place)
    .sort((a, b) => a.head.setNumber - b.head.setNumber)
  return [...(entering === null ? [] : numbersOf(entering, place)), ...after.flatMap((g) => numbersOf(g, g.head.setNumber + 1))]
}

// Where a set that joins the working sets takes its number: after the working sets that come before it in the plan's
// order, whether they are logged, skipped or still open (an open set keeps its place, DECISIONS 151; a warmup is
// planned first, so a warmup made Normal is usually the first).
const placeInPlan = (row: ResolvedRow, rows: readonly ResolvedRow[]): number =>
  1 + rows.filter((r) => r.exerciseKey === row.exerciseKey && r.kind === 'working' && r.planIndex < row.planIndex).length

// ─── A set type changed during a workout ─────────────────────────────────────────────────────────

export interface SetTypeChange {
  /** The type the set has afterwards. A set added in the session and not logged yet keeps it in the card or its draft (DECISIONS 161). */
  type: SessionSetChangeType
  /** False when the pick is the type it already has: nothing to write. */
  changed: boolean
  /**
   * A logged head: the patch for its log row (`is_warmup`, `stage_kind`); null for a set with no log. A warmup that
   * was logged with no weight or reps and is made a working set also carries the two numbers, in the same write:
   * the table refuses a working set without them (DECISIONS 152).
   */
  headPatch: { isWarmup: boolean; stageKind: StageKind | null; weight?: number; reps?: number } | null
  /** The drops that appear under it, by number (1-based). */
  stagesToAdd: number[]
  /** The logged drops to delete, the last first (Normal, Warmup, or fewer drops than are logged). */
  stagesToDelete: Array<Pick<LoggedSet, 'id' | 'stageIndex' | 'isSkipped'>>
  /** Done drops would be deleted: ask first (19c). */
  needsConfirm: boolean
  /** How many done drops the question names. */
  confirmCount: number
  /**
   * The `v2_session_set_changes` rows to write. A planned set gets a `retyped` row keyed by it, logged or not
   * (141 (a)); a logged head given a staged type also gets a `pending_stages` row keyed by its log (the head's
   * total drops); an added set gets no `retyped` row. Each says which stored row it replaces.
   */
  changes: ChangeWrite[]
  /**
   * A set switched to or from Warmup, logged or not: the logs whose `set_number` changes (DECISIONS 146 (a)). To
   * Warmup the logged working sets after it move down one, as a delete moves them; from Warmup it takes its place
   * among the working sets and the logged ones from there on move up one. The open sets after it follow by
   * themselves, and so does the open set itself: it has no log, so nothing of its own to write. A set added in the
   * session and not logged yet is one of these like a planned set (its type is the card's, or its draft's: DECISIONS
   * 161). These are edits of logged sets: online-only with a type change on a logged set (G47).
   */
  renumber: NumberPatch[]
}

/** The weight (kg, as stored) and reps typed in the edit panel. */
export interface TypedNumbers {
  weight: number
  reps: number
}

/**
 * DECISIONS 152 (a): a warmup logged with no weight or reps (SPEC lets it be) can't be made a working set by
 * the type alone, because the table refuses a working set without both numbers (035's `v2_set_logs_check`). True
 * when `pick` would do that to `row`: the edit panel asks for weight and reps first, and `applySetTypeChange`
 * takes them as `numbers`. False for every other change, a warmup that holds both numbers included.
 */
export function typeChangeNeedsNumbers({
  row,
  pick,
  session,
}: {
  row: ResolvedRow
  pick: SessionSetChangeType
  session: TypeChangeView
}): boolean {
  if (row.type === null || row.type.kind !== 'warmup' || pick.kind === 'warmup' || row.state !== 'logged') return false
  const log = logOf(row, session.logs)
  return log.weight === null || log.reps === null
}

/**
 * SPEC 19: a set's type changed for this workout only. `row` is the set's row (from `resolveRows`), `pick`
 * the type chosen (a picker's `SetType` is accepted; its rest between stages is not stored), `session` what
 * the session holds (the logged drops under a logged head are read from its logs). Writes nothing; the
 * caller applies what it returns.
 */
export function applySetTypeChange({
  row,
  pick,
  session,
  numbers,
}: {
  row: ResolvedRow
  pick: SessionSetChangeType
  session: TypeChangeView
  /** Read only when `typeChangeNeedsNumbers` is true, and then required (DECISIONS 152). */
  numbers?: TypedNumbers
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
    return { type: current, changed: false, headPatch: null, stagesToAdd: [], stagesToDelete: [], needsConfirm: false, confirmCount: 0, changes: [], renumber: [] }
  }
  const before = current.kind === 'staged' ? current.stageCount : 0
  const after = next.kind === 'staged' ? next.stageCount : 0
  const stagesToAdd = Array.from({ length: Math.max(0, after - before) }, (_, i) => before + i + 1)
  // A planned set records its type on the session, keyed by the planned set, whether or not it is logged.
  const retyped: ChangeWrite[] = row.weekPlanSetId === null ? [] : [retypedWrite(row.weekPlanSetId, next, session.changes)]

  if (row.state === 'unlogged') {
    // No log row yet: a planned set records the change on the session, an added set keeps it as the card's own state (or its
    // draft's: `type` is what to keep, DECISIONS 161). The logged sets after a set that joins or leaves the working sets
    // move with it, planned or added (an open set keeps its place, so a logged set can come after it: DECISIONS 151).
    let renumber: NumberPatch[] = []
    if ((next.kind === 'warmup') !== (current.kind === 'warmup')) {
      const groups = groupsOf(session.logs)
      renumber =
        next.kind === 'warmup' ? closeGap(row.exerciseId, row.number, groups) : makeRoom(null, row.exerciseId, placeInPlan(row, session.rows), groups)
    }
    return { type: next, changed: true, headPatch: null, stagesToAdd, stagesToDelete: [], needsConfirm: false, confirmCount: 0, changes: retyped, renumber }
  }

  const log = logOf(row, session.logs)
  // The table refuses a working set without weight and reps: they come with the type (DECISIONS 152).
  let typed: TypedNumbers | null = null
  if (typeChangeNeedsNumbers({ row, pick: next, session })) {
    if (numbers === undefined) throw new RangeError('a warmup logged without weight or reps needs both to become a working set')
    if (!Number.isFinite(numbers.weight) || !Number.isInteger(numbers.reps)) throw new RangeError('the weight and reps of a working set are numbers')
    typed = { weight: numbers.weight, reps: numbers.reps }
  }
  const logged = stagesOf(session.logs, log.id)
  const stagesToDelete = logged.slice(Math.min(logged.length, after)).reverse()
  const confirmCount = stagesToDelete.filter((stage) => !stage.isSkipped).length
  const columns = typeColumns(next)
  const pending: ChangeWrite[] = next.kind === 'staged' ? [pendingWrite(log.id, next.stageKind, next.stageCount, session.changes)] : []
  let renumber: NumberPatch[] = []
  if ((next.kind === 'warmup') !== (current.kind === 'warmup')) {
    const groups = groupsOf(session.logs)
    const patches =
      next.kind === 'warmup'
        ? closeGap(log.exerciseId, log.setNumber, groups)
        : makeRoom({ head: log, stages: logged }, log.exerciseId, placeInPlan(row, session.rows), groups)
    // A log that is being deleted has no number to change.
    const going = new Set(stagesToDelete.map((stage) => stage.id))
    renumber = patches.filter((patch) => !going.has(patch.id))
  }
  return {
    type: next,
    changed: true,
    headPatch: { isWarmup: columns.isWarmup, stageKind: columns.stageKind, ...(typed === null ? {} : typed) },
    stagesToAdd,
    stagesToDelete,
    needsConfirm: confirmCount > 0,
    confirmCount,
    changes: [...retyped, ...pending],
    renumber,
  }
}

// ─── Delete a set ────────────────────────────────────────────────────────────────────────────────

export interface DeleteEffects {
  /** The logs to delete, in this order: the drops from the last, then the head. */
  deleteOrder: LoggedSet[]
  /** How many logged drops go with the head: the confirm says so (W9). */
  stageCount: number
  /** Later heads of the same exercise, and their drops, with the number that closes the gap. */
  renumber: NumberPatch[]
  /**
   * The `v2_session_set_changes` rows that keep what was deleted out of the session. A planned set (logged or
   * not): `deleted`, replacing its `retyped` row. A drop of a planned set: the set's `retyped` row with one drop
   * fewer; of a logged set: its `pending_stages` row with one drop fewer, none when it was the last. An added
   * set needs none (its card lowers its count of added sets).
   */
  changes: ChangeWrite[]
  /** The last drop of a logged set deleted: the set is a normal set, so its log loses its stage kind (147 (a)). */
  headPatch: { id: string; stageKind: null } | null
  /** A drop deleted: its set's type afterwards. A set added in the session and not logged yet keeps its type as the card's own state, which this is. */
  type: SessionSetChangeType | null
}

/**
 * SPEC 18b: deleting a set or a drop, logged or not (`row` from `resolveRows`, `session` as the rest of the
 * module reads it). The deleted set never comes back: its log is deleted and the later heads take the numbers
 * that close the gap (a drop carries its head's `set_number`), and the change rows say it is gone. A drop
 * deleted on its own, and a warmup, renumber nothing.
 */
export function deleteEffects(row: ResolvedRow, session: SessionView): DeleteEffects {
  return row.kind === 'stage' ? deleteDropEffects(row, session) : deleteSetEffects(row, session)
}

function deleteSetEffects(row: ResolvedRow, session: SessionView): DeleteEffects {
  const effects: DeleteEffects = { deleteOrder: [], stageCount: 0, renumber: [], changes: [], headPatch: null, type: null }
  if (row.logId !== null) {
    const gone = logOf(row, session.logs)
    const stages = stagesOf(session.logs, gone.id)
    effects.deleteOrder = cascadeDeleteOrder({ head: gone, stages }, (log) => log.stageIndex)
    effects.stageCount = stages.length
    if (!gone.isWarmup) effects.renumber = closeGap(gone.exerciseId, gone.setNumber, groupsOf(session.logs))
  } else if (row.kind === 'working') {
    // An open set leaves the working numbers too, and a logged set can come after it (DECISIONS 151).
    effects.renumber = closeGap(row.exerciseId, row.number, groupsOf(session.logs))
  }
  if (row.weekPlanSetId !== null) effects.changes.push(deletedWrite(row.weekPlanSetId, session.changes))
  return effects
}

function deleteDropEffects(row: ResolvedRow, session: SessionView): DeleteEffects {
  const head = session.rows.find((r) => r.key === row.headKey)
  if (head === undefined || head.type === null || head.type.kind !== 'staged') {
    throw new RangeError(`the drop ${row.key} has no staged set to belong to`)
  }
  const left = head.type.stageCount - 1
  const type: SessionSetChangeType = left > 0 ? { kind: 'staged', stageKind: head.type.stageKind, stageCount: left } : NORMAL
  const effects: DeleteEffects = {
    deleteOrder: row.logId === null ? [] : [logOf(row, session.logs)],
    stageCount: 0,
    renumber: [],
    changes: [],
    headPatch: null,
    type,
  }
  if (head.weekPlanSetId !== null) effects.changes.push(retypedWrite(head.weekPlanSetId, type, session.changes))
  if (head.logId !== null) {
    const headLog = logOf(head, session.logs)
    if (type.kind === 'staged') effects.changes.push(pendingWrite(headLog.id, type.stageKind, type.stageCount, session.changes))
    else if (headLog.stageKind !== null) effects.headPatch = { id: headLog.id, stageKind: null }
  }
  return effects
}

// ─── Unlog ───────────────────────────────────────────────────────────────────────────────────────

/** A set log with the numbers a draft keeps. */
export type UnloggableSet = NumberedSet & Pick<SetLog, 'rir' | 'formRating' | 'enteredUnit'>

/** The session as `unlogEffects` reads it: its logs carry the numbers the draft keeps. */
export type UnlogView = Omit<SessionView, 'logs'> & { logs: readonly UnloggableSet[] }

/** The numbers kept on the phone when a set is unlogged (G46 (a)). */
export interface SetDraft {
  weight: number | null
  reps: number | null
  rir: number | null
  formRating: FormRating | null
  enteredUnit: WeightUnit | null
}

/** A planned set's draft is keyed by it; an added set's by its local id with its exercise and position. */
export type PlannedSetKey = { sessionId: string; weekPlanSetId: string }
export type AddedSetKey = { sessionId: string; localId: string; exerciseId: string; position: number }
/** A drop's draft is keyed by its set's key plus its number under the set (DECISIONS 147 (b)). */
export type DropDraftKey = (PlannedSetKey & { drop: number }) | (AddedSetKey & { drop: number })
export type SetDraftKey = PlannedSetKey | AddedSetKey | DropDraftKey

/**
 * A set added in the session also keeps its type in its draft, so unlogging it is undone exactly and nothing moves
 * (DECISIONS 161, Adam 2026-10-16): a Warmup comes back a Warmup, a dropset with its drops. A planned set's type is its
 * `retyped` change and a drop follows its set, so only an added set's own draft holds one.
 */
export interface AddedSetDraft extends SetDraft {
  type: SessionSetChangeType
}

/**
 * A draft as the phone holds it, as far as the rows read it: `OrderExercise.drafts` is the session's stored drafts. The draft
 * of a set added in the session must say its type; the rows read nothing else from a draft (the numbers are for the box).
 */
export type HeldDraft =
  | { key: AddedSetKey; values: Pick<AddedSetDraft, 'type'> }
  | { key: PlannedSetKey | DropDraftKey; values?: unknown }

export interface UnlogEffects {
  /** The logs to delete: a set's skipped drops from the last, then the set; a drop, the skipped drops after it from the last, then the drop. */
  deleteOrder: LoggedSet[]
  /** The draft to keep on the phone: the set's numbers and, for a set added in the session, its type (DECISIONS 161). */
  draft: { key: AddedSetKey; values: AddedSetDraft } | { key: PlannedSetKey | DropDraftKey; values: SetDraft }
  /** A type the set was logged with and the plan doesn't have: its `retyped` row, replacing the one it holds. */
  changes: ChangeWrite[]
}

/**
 * SPEC 18c: a set with done drops after it can't be unlogged until they are gone (UNLOG is disabled and says
 * so); a drop can't be unlogged while a later drop of its set is done (DECISIONS 147 (b)). Skipped drops are not
 * done. A row with no log has nothing to unlog.
 */
export function canUnlog(row: ResolvedRow, session: Pick<SessionView, 'logs'>): boolean {
  if (row.logId === null) return false
  const log = logOf(row, session.logs)
  if (row.kind === 'stage') {
    return session.logs.every((other) => other.parentSetId !== log.parentSetId || other.stageIndex <= log.stageIndex || other.isSkipped)
  }
  return stagesOf(session.logs, log.id).every((stage) => stage.isSkipped)
}

// A set's draft key: the planned set, or for an added set its local id (its log's), exercise and position.
function setKeyOf(head: Pick<ResolvedRow, 'weekPlanSetId'>, log: LoggedSet): PlannedSetKey | AddedSetKey {
  return head.weekPlanSetId !== null
    ? { sessionId: log.sessionId, weekPlanSetId: head.weekPlanSetId }
    : { sessionId: log.sessionId, localId: log.id, exerciseId: log.exerciseId, position: log.setNumber }
}

/**
 * SPEC 18c, G46, DECISIONS 147 (b), 161: what unlogging a logged set or drop does (`row` from `resolveRows`). The log
 * is deleted (a set's skipped drops first) and its numbers become a draft. A planned set unlogged after its type was
 * changed keeps that type as a `retyped` change, so the retype survives; a set logged as planned adds none. A set
 * added in the session has no planned set, so its draft also holds its type: it comes back as what it was.
 * It says nothing about the rest timer or the session's status: unlogging never touches either.
 */
export function unlogEffects(row: ResolvedRow, session: UnlogView): UnlogEffects {
  if (row.logId === null) throw new RangeError('only a logged set can be unlogged')
  if (!canUnlog(row, session)) {
    throw new RangeError(row.kind === 'stage' ? 'a drop with a later drop logged cannot be unlogged' : 'a set with logged drops after it cannot be unlogged')
  }
  const log = logOf(row, session.logs)
  const values: SetDraft = { weight: log.weight, reps: log.reps, rir: log.rir, formRating: log.formRating, enteredUnit: log.enteredUnit }
  if (row.kind === 'stage') {
    const head = session.rows.find((r) => r.key === row.headKey)
    const headLog = session.logs.find((l) => l.id === log.parentSetId)
    if (head === undefined || headLog === undefined || row.stageNumber === null) throw new RangeError(`the drop ${row.key} has no set to belong to`)
    // The drops after it are all skipped (`canUnlog`) and go first, last to first: rows read a set's drops by
    // count, so a skipped log left behind would move up into the place of the drop that is open again.
    const after = stagesOf(session.logs, headLog.id).filter((stage) => stage.stageIndex > log.stageIndex)
    return {
      deleteOrder: [...after.reverse(), log],
      draft: { key: { ...setKeyOf(head, headLog), drop: row.stageNumber }, values },
      changes: [],
    }
  }
  if (row.type === null) throw new RangeError('only a set has a type; a drop follows its head')
  const key = setKeyOf(row, log)
  const effects: UnlogEffects = {
    deleteOrder: cascadeDeleteOrder({ head: log, stages: stagesOf(session.logs, log.id) }, (stage) => stage.stageIndex),
    // An added set has no planned set to key a change on, so its draft holds the type it has now (DECISIONS 161).
    draft: 'localId' in key ? { key, values: { ...values, type: heldType(row.type, `the set ${row.key}`) } } : { key, values },
    changes: [],
  }
  const differs = row.plannedType !== null && !sameType(row.type, row.plannedType)
  if (row.weekPlanSetId !== null && (differs || row.retyped)) {
    effects.changes.push(retypedWrite(row.weekPlanSetId, row.type, session.changes))
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
