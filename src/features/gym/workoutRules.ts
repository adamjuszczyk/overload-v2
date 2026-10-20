// Chunk 46 (TASKS-1.2 "Workout logging rules as pure functions"; SPEC [1.2] "Logging mechanics" (current
// set, log lock 18a, unlog 18c, delete set 18b, set type during a workout 19 / 19c, finishing 11 / C6),
// "Supersets" (ADD ROUND, Defaults 9), "Set types and staged sets", "Objects stored → Set log", G46, G47 and
// G54) — the workout screen's new decisions as one tested module. No React, no Supabase, no store, no clock:
// chunks 58a to 64 fetch the plan, the logs and the session's changes, call these, and write what they say.
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
//     added sets (`weekPlanSetId` null) by their place (below), through the card's list of the sets added in
//     the session (`OrderExercise.added`), the logs and the drafts.
// A set that was logged takes its type from its log (SPEC Objects stored: "set kind and stage kind as
// done"), so a logged planned dropset switched to Normal has no drop rows left although the plan still
// holds them; a null kind on a head with planned drops, or with logged drops, still reads as a dropset
// (`resolveStageKind`, pre-1.1 data).
//
// ─── What a row's number is (DECISIONS 170, Adam 2026-10-18, and 173, 2026-10-19) ─────────────────
// 170: "Set numbers are never claimed or stored per rule. Each set has a fixed place in the session order: planned sets by
// planned position, added sets by when they were added. A set's displayed number is its rank among the non-deleted,
// non-warmup working sets in that order (warmups numbered apart, as now). LOG stores the number the row shows; a delete or
// warmup switch that changes logged sets' numbers patches them, as 146 (a) already writes."
// 173: "Warmups follow the same numbering rule as working sets: when a warmup's displayed number changes (delete, switch to
// or from Warmup), its log's stored number is patched, so a log never keeps a number its row no longer shows."
//   - A card's sets in their places: the plan's sets in the order of their planned `setNumber` (warmups among them, the
//     deleted ones gone), then the sets added in the session in the order they were added (their places, below). Logging,
//     unlogging, a type change and a delete of another set leave every set where it was.
//   - A working set's number is its rank among the card's working sets in that order, logged, skipped or open alike; a
//     Warmup's is its rank among the card's warmups (W1, W2: numbered apart); a drop shows its head's. So each list reads
//     1 to n with no two alike, a set's number changes only when a set before it leaves or joins its list, and the number a
//     log holds is never read for it.
//   - So DECISIONS 151 holds as it stands: unlog moves no set and changes no number; and 146 (a): a set switched to Warmup
//     leaves the working ranks (the sets after it close the gap) and takes its rank among the warmups (the warmups after it
//     move up one); one switched from Warmup does the opposite; a delete takes the set out of its list.
//   - The writers keep every stored number equal to the number shown, warmups included (173): LOG stores `row.number`, and
//     DELETE and a switch to or from Warmup return every log of the card whose stored number is not its set's number
//     afterwards (`renumber`): with stored numbers that are the ranks, exactly the logged sets after the changed one in the
//     lists it leaves and joins, each down or up one, a working set with its drops, and the changed set's own log.
//   - DECISIONS 178 (Adam, 2026-10-19): the logged sets whose stored number differs from their row's are reported
//     (`numberCorrections`); the workout screen writes them when it draws an in-progress or reopened session (58a). They
//     arise where a set left the card with no writer in between: a session reopened, or a list lost, with an added set that
//     was never logged (or unlogged) before them; and 1.1's logs, numbered in the order they were logged. A swap is not one of
//     them: it leaves a gap where a set moved from (46r's Q1, below). 185 (c) (Adam, 2026-10-20): "A phone never corrects a stored
//     number after a set only it holds": the report leaves out every log after an open added set in its list.
//   - DECISIONS 183 (a) (Adam, 2026-10-20): "One numbering for the exercise's place in the session, covering moved and added
//     sets." Its option: "the original card's sets that didn't move, then the moved sets in the order they stood, then any set
//     added to the new card, each numbered by its rank in that list. W5: Lat Pulldown 01, 02; Machine Pulldown 03; + ADD SET
//     there, 04. … The original card draws no row for a set that moved." So the numbers above are counted over a slot
//     (`ResolvedRow.slotKey`): a card a swap made (it holds only the moved sets and the sets added to it after: `numberedHeads`)
//     and the card it replaced are one list, so a delete or a Warmup switch on either renumbers both. Its follow-ups (Adam, the
//     same day): "A swap into an exercise that already has added sets: the moved sets come after them. A swap never renumbers
//     sets that are already logged." and "The same exercise on two cards in one session: each card is numbered on its own, as
//     today's display does." So a card that held sets of its own when a swap brought sets into it keeps its own numbering, the
//     moved sets after its added ones, and every card no swap made is a slot of its own; a set added to an exercise on two
//     cards is drawn on one of them only.
//   - 46r's Q1 (Adam, 2026-10-20): "A swap never changes the number of a set that's already logged, on either card. If moving
//     open sets leaves a gap on the original card, the gap shows; that's accepted (rare, and no stored data is wrong)." So a set
//     a swap moved away leaves a gap in its place on the card it left: never drawn, of the type it had there (`ResolvedRow.
//     gapsBefore`). A set's number is 1 + the sets of its list drawn before it in its slot + the gaps of its list before it on
//     its own card: the sets after a gap keep their numbers (Lat Pulldown 01 and 03 logged, 02 and 04 moved: 01, 03, and the new
//     card 03, 04), and the moved sets are numbered after the sets drawn before them. A card's sets are swapped once (today's app
//     offers no second swap of a slot, and 025 keeps one swap row per planned slot): the card a swap moves sets from is then the
//     last card of its slot, so a swap changes the number of no set that stays, logged or open, on any card. A delete or a
//     Warmup switch renumbers the sets after it as on any card, the gaps holding their places.
//
// ─── An added set's place (DECISIONS 173, 174, 177, 179; `v2_set_logs.added_place`, migration 044) ───
// 174: "an added set's place among the sets added to its exercise in that session, from 1, in the order they were added.
// Written when the added set's log is first written (the sync queue carries it offline), kept on re-log after an unlog (the
// draft holds it until then). Planned sets leave it null. A log with null added_place that has no planned set (anything
// logged before 045) orders as the app orders it today (logged time, then id)." Its writers (Adam, the same day): "It's
// assigned once, when an added set is created … No chunk ever changes it afterwards: delete, warmup switch and renumbering
// never touch added_place, because numbers are derived from the order, not stored in it."
//   - The rule: `nextAddedPlace(order, exerciseId, logs)` gives a new added set 1 + the highest place the phone knows for its
//     exercise: every card of it (list entries, drafts), the session's head logs of the exercise, and the places a swap's
//     record names for it. It is called when the set is created (58a: + ADD SET, + ADD ROUND through `addRound`; 59: "Add a
//     set"; a swap through `movedSetEntries`) and nowhere else. A set added in a reopened session, or on another phone, so
//     comes after every earlier one that still has a log or a draft (173).
//   - A swap for today (179: "Sets moved by a swap for today count as added sets of the new exercise. Each gets its place at
//     the swap, in their order, after any sets already added to that exercise"): `movedSetEntries` gives the moved sets
//     their entries on the new card, places from `nextAddedPlace` on, in the order they stood, and the swap's record
//     (`SwapRecord`: which sets moved and where to; 183 (a)), which 59 writes with the swap; 59 writes each one's place with
//     its log. The card they moved from draws no row for them, the swap's skip of them included: it keeps a gap in each one's
//     place (46r's Q1), and its sets are not swapped again.
//   - The order: a card's added sets by place, whichever record holds the place (the card's entry, the log, or a draft). Two
//     sets in one place come only from two phones adding at once: they go by their log's id, which every phone reads the same
//     (so two phones order the same logs alike, and their corrections, 178, agree), and a set not logged yet, which only one
//     phone holds, by its own id. Such an open set moves the numbers its own phone shows after it, not another phone's, so
//     its phone corrects none of the logs after it (185 (c)) and the other phone corrects each once.
//   - 177: "Only an added set's own log carries added_place; its drop and stage logs leave it null." So a place is read from
//     a head log only (`parentSetId` null), and a drop's log is never taken for an added set, nor for one logged before 044.
//   - Logged before 044 (a head log of no planned set whose place is null, or absent: `SetLog.addedPlace` is optional,
//     read as null): before every set that has a place (those were added later, by 1.2), in the order of `loggedAt`, then
//     id. The draft of such a set, unlogged under 1.2, has no place either: it keeps its log's time and is drawn in its place
//     among them (DECISIONS 184 (b), Adam 2026-10-20: "The unlog moves nothing; the re-log may"), and the re-log writes the
//     time it happens (63), so the set then moves to after the other sets logged before 044.
//   - Nothing here writes or patches a place: `renumber`, `numberCorrections`, `deleteEffects` and `applySetTypeChange`
//     carry set numbers and types only. LOG writes `row.addedPlace` on an added set's head log (58a; the skips 59 and 61),
//     and null on every other log; UNLOG's draft holds it (`draft.values.place`) for the re-log (63).
//
// ─── An added set's type (DECISIONS 161, Adam 2026-10-16) ─────────────────────────────────────────
// "An added set's draft also keeps its type, so an unlog is undone exactly and nothing moves; 46's rules see every added
// set's type." A set added in the session (ADD SET, ADD ROUND) has no planned set and, until it is logged, no log or
// change row to hold its type (TASKS 62: the card's own state), so the card hands it to the rules with the set itself:
//   - each entry of `OrderExercise.added` has the set's `type` as the card keeps it: what it was added as (Normal for ADD
//     SET), then every answer's `type` for that set (SET TYPE, a drop deleted on its own), logged or not. It is read while
//     the set has no log, and it is required on every entry: an entry without one is refused (TypeError), because a
//     Warmup would pass for a working set (RULES.md);
//   - a set that was logged and unlogged again keeps a draft, and the draft holds its type and its place
//     (`HeldDraft.values`), which chunk 63 stores from `unlogEffects`' `draft.values`. The draft is what brings the set
//     back, with its type and in its place, when the card's list is gone (a reload before 63 keeps the list). A draft of an
//     added set without a type, or without a place (null for one logged before 044), is refused;
//   - a logged set has its type in its log (`is_warmup`, `stage_kind`, the `pending_stages` row).
// The type belongs to the set, and so does its row key (`added:<card>:<localId>`), which nothing moves.
// So an open added Warmup is a warmup row like any other: never the current set, its LOG never asks (G54), and it holds
// no working number, so the working sets read 1 to n without it (146 (a)); an open added dropset has its drops as open
// rows. `applySetTypeChange` says the type to keep (`type`) and, for a switch to or from Warmup, the logs that move. LOG
// of such a set writes the log with `typeColumns(row.type)` (`isWarmup`, `stageKind`) and, for a staged type, the
// `pending_stages` row; without that row it reads as Normal once logged.
// LOG STORES `row.number`: the number the row shows, never "the logged heads + 1" (58a's `handleLogHead`, 63's
// re-log and a skip all write it). That is what keeps the stored numbers the ranks of the sets, and a set logged
// again an exact undo.
//
// ─── What the card keeps for the sets added in the session (DECISIONS 170, 161, 174) ─────────────
// `OrderExercise.added`, one entry per set (its order in the list means nothing: the places order the sets); the card
// changes it at:
//   - ADD SET, ADD ROUND (`addRound`), "Add a set" (59): a new entry `{ localId: <a new id>, logId: null, type: Normal,
//     place: nextAddedPlace(order, card.exerciseId, logs) }`; a swap for today: the entries `movedSetEntries` answers, on the
//     card it made (with the record as its `swappedFrom`: one swap's, a card holds one) (59);
//   - LOG and SKIP: the entry's `logId` is the new log's id (the draft, if any, goes); the log carries `row.addedPlace`;
//   - UNLOG: `logId` back to null, the draft `unlogEffects` answers kept beside it;
//   - SET TYPE and a drop deleted on its own: the entry's `type` is the answer's `type`;
//   - DELETE: the entry goes (with its draft).
// An entry whose log isn't among the logs yet, or any more (the logs and the card can lag one another for a render),
// is an open set with the entry's type. The card keeps the list for the session and across a reload with the drafts
// (chunk 63). A set the list doesn't name (a log or a draft, after a reload before 63, a reopened session or another
// phone's set) is drawn in its place all the same, keyed by its log's id or its draft's `localId`. Before this phone writes
// anything for it that the card must keep (UNLOG; LOG or SKIP of a set only a draft holds; a type for a set with no log),
// the card takes it into its list with that id, so it keeps its key across the new log:
// `{ localId: row.localId, logId: row.logId, type: row.type, place: row.addedPlace }`. A set logged before 044 has no place
// and is not taken in: its key is its log's (or its draft's), and a new log gives it a new one. A logged set the list
// doesn't name needs nothing taken in for a type change or a delete (its log holds its type). After a session ends its
// list and its drafts go (G46): an added set that has no log then is gone with them.
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
//   - an added set that is not logged yet has no row to write: its type is the card's own state, and the `type` of the
//     answer is what the card keeps (DECISIONS 161);
//   - a set switched to or from Warmup renumbers both lists as a delete does (DECISIONS 146 (a), 173): `renumber` lists
//     the logs whose `set_number` is not their set's rank afterwards (see the numbers above), the switched set's own log
//     among them. An open set has no log of its own to change, but the logged sets after it move with it (an open set
//     keeps its place, so a logged set can come after it); an open added set is one of these like a planned one;
//   - a logged warmup with no weight or reps made a working set carries the two numbers with the type, in the
//     same patch, because the table refuses a working set without them (DECISIONS 152 (a), Adam 2026-10-16: the
//     panel asks for them first): `typeChangeNeedsNumbers` says when, and `applySetTypeChange` refuses to answer
//     without `numbers`.
//
// ─── Delete, unlog, finish ───────────────────────────────────────────────────────────────────────
// - `deleteEffects` says everything DELETE does, so that a deleted set never comes back as an open row
//   (SPEC 18b: "The remaining sets renumber", 13c: a deleted planned set counts as Skipped):
//     * a set that has logs: the drops from the last, then the head (the cascade order of
//       `setGroupLogic.ts`); every later set of its list (working sets with their drops, or warmups: 173) takes its rank
//       among the sets left, one down (F4: a renumbered head's drops used to keep their old number). Open sets keep
//       their places, so 01, 02 and 05 logged with 03 and 04 open, 02 deleted, leaves 05 as 04. An open set that is
//       deleted moves the logged sets after it the same way (151);
//     * a planned set, logged or not: a `deleted` change that replaces its `retyped` change (the plan has
//       the slot, and only the change row says it is gone). An added set needs none: the card takes it off
//       its list;
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
//   draft holds the type (DECISIONS 161) and its place (174). Nothing it returns touches the rest timer or the
//   session's status (Defaults 6). It renumbers nothing: the set is open again at its number, as the type it was, and no
//   other set moves (DECISIONS 151, 161); logging it again stores that number (and, for an added set, that place).
// - `finishWarning`: the unlogged planned sets, by exercise and number (board W18); deleted sets are not
//   in the order, skipped ones are settled.
//
// ─── How the screens call it (58a to 64) ──────────────────────────────────────────────────────────
//   const order = sessionOrder(cards, blocks)              // the cards as drawn: plan, swaps, added exercises, each card's added
//                                                          // sets with their places and types (170, 161, 174), the drafts
//   const rows = resolveRows(order, logs, changes)         // what every card draws; one list
//   numberCorrections(order, logs, changes)                // the stored numbers to write when the screen draws (178, 58a)
//   const current = currentSet(order, logs, changes)       // the first unlogged working set or drop of `rows`
//   lockDecision({ logInOrder, current, tapped })          // 'log', or the question's words for the sheet
//   nextAddedPlace(order, exerciseId, logs) / addRound(order, rows, blockId, logs) / movedSetEntries(order, logs, target, moved)
//                                                          // a new added set's place (58a, 59), once, when it is made
//   const session = { rows, logs, changes }                // `changes` with the stored rows' ids (`HeldChange`)
//   typeChangeNeedsNumbers({ row, pick, session })         // a numberless warmup made a working set: ask for the numbers first
//   applySetTypeChange({ row, pick, session, numbers })    // a picked type -> the log patch, drops, change rows, numbers
//   deleteEffects(row, session) / canUnlog(row, session) / unlogEffects(row, session)
//   finishWarning(order, logs, changes)
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
// - Unlog keeps in an added set's draft key the number the set showed (`position`, as TASKS 63's key has it). Nothing reads
//   it for the number (a set's number is its rank, 170) or for the order (its place, 174). The caller drops a draft when
//   the set is logged again or deleted.
// - A set type pick with fewer drops than are logged deletes the extra logged drops after the question
//   (19c asks for Normal; the same question is asked here).
// - An added set that is not logged yet keeps its type in the card (above); once logged, the caller writes
//   its `pending_stages`. An added set can be switched to Warmup like any set, logged or not: its row is drawn as a
//   warmup.
// - An added Warmup sits among the added sets in its place (170), like any set: it is W-numbered by that place among
//   the card's warmups, and made Normal again it takes its rank among the working sets from there, the logged sets after
//   it moving up one.
// - The stored numbers of logs that no 1.2 writer wrote (1.1's "the logged heads + 1", which numbered sets in the order
//   they were logged) are not what their rows show: a row shows its rank. `numberCorrections` names them, and so does the
//   first delete or Warmup switch on that card (`renumber` names every log of the card whose stored number is not its rank).
// - The stored `stage_index` of the drops left after a drop is deleted is not renumbered (rows read the
//   drops by count, and `nextStageIndex` already allows gaps).
// - A set of an exercise on two cards that no card's list names and no swap's record places (a log from another phone, or seen
//   after a reload or a reopen, of a set added to one of them by hand) is drawn on the card that was the exercise's latest when
//   it was added (its place says when): a set added to a swap's card after the swap stays there, and one added to the
//   exercise's other card after the swap is drawn on the swap's card (183's follow-up says each card is numbered on its own,
//   not which card such a set is on).
// - A gap a swap left (46r's Q1) holds its place for every set after it on its card, a set added to that card after the swap
//   included (Lat Pulldown 01 logged and 02 moved: a set added there then is 03). Q1 speaks of the sets already logged; the
//   gap's place is fixed, so a set that comes after it is numbered after it whenever it came.
// - A card's sets are swapped once: a second swap of one card is refused (`movedSetEntries`, `sessionOrder`). Q1's words give it
//   no single answer: the first swap's card stands between the card and the second swap's sets, so either that card's sets move
//   down a number for each set the second swap moves (its logged ones too), or, counting the second swap's gaps for them, the
//   second swap's sets take numbers that card already shows.
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
import { cascadeDeleteOrder, groupByParent } from './setGroupLogic'

// ─── The shapes it reads ─────────────────────────────────────────────────────────────────────────
// Each is the fields read, picked from the app's own types: a real `WeekPlanSet`, `SetLog` and
// `SessionSetChange` are accepted as they are.

/** A planned set of the session's week plan (heads, drops and warmups alike). */
export type PlannedSet = Pick<WeekPlanSet, 'id' | 'setNumber' | 'parentWeekPlanSetId' | 'stageIndex' | 'isWarmup' | 'stageKind'>

/**
 * A set log of the session. `addedPlace` is optional as on `SetLog` (absent reads as null); `loggedAt` orders an added set
 * logged before 044, which has no place (DECISIONS 174).
 */
export type LoggedSet = Pick<
  SetLog,
  | 'id'
  | 'sessionId'
  | 'exerciseId'
  | 'weekPlanSetId'
  | 'setNumber'
  | 'parentSetId'
  | 'stageIndex'
  | 'isWarmup'
  | 'isSkipped'
  | 'stageKind'
  | 'addedPlace'
  | 'loggedAt'
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
  /**
   * The sets added in the session (ADD SET, ADD ROUND, "Add a set", the sets a swap for today moved here), logged or not,
   * each with its place (DECISIONS 170: "added sets by when they were added"; 174: the place, `nextAddedPlace`'s answer
   * when the set was made). The places order them, after the planned sets; the list's own order, a log or a number never
   * moves one (the header says how the card keeps it). Left out, or empty, the card lists none: the sets the session's logs
   * and drafts hold are drawn all the same, in their places.
   */
  added?: readonly AddedSet[]
  /**
   * The drafts the phone holds for the session (G46). Only the draft of a set added in the session and unlogged again is
   * read: a listed set's draft is named on its row (`draftKey`), which is how the screen finds it; a draft that no listed
   * set has (`localId`) is a set of its own, drawn in its draft's place with its draft's type (DECISIONS 161 and 174:
   * `values.type` and `values.place`, both required), so the set is still a row after a reload. A draft of a planned set,
   * of a drop or of another exercise is ignored. A draft's key names its exercise, not its card, so every card of an
   * exercise is handed the same drafts (the session's, as the phone holds them), and of an exercise on two cards each draft
   * is drawn on the one card that `drawsAdded` names (183's follow-up); a draft handed to one of them only is drawn there or
   * nowhere.
   */
  drafts?: readonly HeldDraft[]
  /**
   * A card a swap for today moved sets to (W5: "SWAPPED FROM LAT PULLDOWN"): the record of which sets moved, which chunk 59
   * writes with the swap (DECISIONS 183 (a): "The original card draws no row for a set that moved, so the swap has to record
   * which sets moved"). The moved sets are also entries of this card's `added` list (`movedSetEntries`), while it keeps one.
   * One swap's record: a card's sets are swapped once, so no two cards' records name one card they moved from.
   */
  swappedFrom?: SwapRecord
}

/**
 * What a swap for today moved, as chunk 59 records it (DECISIONS 164, 179, 183 (a)). `fromKey` is the card the sets moved
 * from (drawn before this one). `moved` names each set that moved, in the order they stood there: what it was on that card
 * (`from`) and the place it took among the sets added to this card's exercise (`place`, 179), which its log carries once
 * logged. The card it moved from draws no row for it, its skip included, and keeps a gap in its place (46r's Q1); this card draws
 * it, also when its list is gone (a reload, a reopened session, another phone); and a card the swap made continues the numbering
 * of the card it replaced.
 */
export interface SwapRecord {
  fromKey: string
  moved: readonly MovedSet[]
}

export interface MovedSet {
  from: MovedSetRef
  place: number
}

/**
 * A set of the card a swap moved sets from, as the record names it: a planned set by its id, a set added in the session by
 * its place among the sets added to that card's exercise (DECISIONS 174: the place its log, a skip included, carries).
 */
export type MovedSetRef = { weekPlanSetId: string } | { addedPlace: number }

/**
 * A set added in the session, as the card keeps it (DECISIONS 170, 161, 174). `localId` is the set's own id, made when it
 * was added and kept until it is deleted: the row's key and its draft's key carry it. `logId` is its head log's id while it
 * is logged or skipped, null while it is open. `type` is the set's type as the card keeps it (what it was added as, then
 * each answer's `type` for it), read while the set has no log; required, because a Warmup would otherwise pass for a
 * working set. `place` is its place among the sets added to its exercise in the session, from 1 (`nextAddedPlace`, or
 * `movedSetEntries` for a swap; for a set taken in from its log or draft, the row's `addedPlace`), never changed; required
 * and refused unless a whole number from 1, because a set without one would be drawn in a place nobody gave it.
 */
export interface AddedSet {
  localId: string
  logId: string | null
  type: SessionSetChangeType
  place: number
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
  /**
   * What the row shows: a working set's rank among its slot's working sets, a warmup's among its warmups (DECISIONS 170, 183
   * (a)), counting the gaps before it on its card (`gapsBefore`); a drop shows its head's.
   */
  number: number
  /**
   * The gaps before the set on its own card (46r's Q1, Adam 2026-10-20: "If moving open sets leaves a gap on the original card,
   * the gap shows"): the places of the sets a swap for today moved away from it that come before this set, in the working list
   * and in the warmups' (a set switched to or from Warmup takes its number in the other list after these). Its number counts
   * the ones of its own list; a drop has its head's. The writers that renumber read them, as the rows are numbered.
   */
  gapsBefore: { working: number; warmup: number }
  /**
   * The set's place in its slot's list (DECISIONS 170, 183 (a)): card by card, the plan's sets in the order of their planned
   * position (warmups and working sets together), then the sets added in the session in the order they were added, counted
   * from 1 over the sets that are left; a drop has its head's. Only the order means anything. It does not change when a set is
   * switched to or from Warmup, which is what places a set among the working numbers when it joins them (146 (a)).
   */
  planIndex: number
  /**
   * The slot the set is numbered in (DECISIONS 183 (a): "one numbering for the exercise's place in the session"): the key of
   * its first card. A card a swap for today made shares the slot of the card it replaced; every other card is a slot of its own.
   */
  slotKey: string
  /**
   * A set added in the session: its own id (`AddedSet.localId`; for a set the card's list doesn't name, its log's id or its
   * draft's), which its row key and its draft's key carry and nothing changes. Null on a planned set and on a drop.
   */
  localId: string | null
  /**
   * A set added in the session: its place among the sets added to its exercise (DECISIONS 174; `v2_set_logs.added_place`),
   * from its card's entry, its log or its draft. What LOG writes on its log, what its draft keeps for the re-log, and what
   * the card takes it into its list with. Null on a planned set, on a drop (177) and on a set logged before 044 (none).
   */
  addedPlace: number | null
  /** An open added set that keeps a draft on the phone (G46): that draft's key, by which the screen finds the draft. Null on every other row. */
  draftKey: AddedSetKey | null
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
export const addedRowKey = (exerciseKey: string, localId: string): string => `added:${exerciseKey}:${localId}`
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
  // A swap's record names the card the sets moved from (183 (a)): a record that names no other card is a caller bug, because
  // the card it made would be numbered as if no swap had been; and so are two records from one card, whose sets are swapped
  // once (46r's Q1: the gaps a swap leaves keep the numbers of that card's slot only while it is the slot's last card).
  const swappedFrom = new Set<string>()
  for (const exercise of exercises) {
    const from = exercise.swappedFrom?.fromKey
    if (from === undefined) continue
    if (from === exercise.key || !byKey.has(from)) throw new RangeError(`${exercise.key} was swapped from ${from}, which is no other card`)
    if (swappedFrom.has(from)) throw new RangeError(`two swaps moved sets from ${from}: a card's sets are swapped once`)
    swappedFrom.add(from)
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
  logById: Map<string, LoggedSet>
  headLogs: LoggedSet[]
  headLogByPlan: Map<string, LoggedSet>
  stagesByParent: Map<string, LoggedSet[]>
  deleted: Set<string>
  retyped: Map<string, RetypedChange>
  pending: Map<string, PendingStagesChange>
}

function indexSession(logs: readonly LoggedSet[], changes: readonly SessionSetChange[]): SessionIndex {
  const session: SessionIndex = {
    logById: new Map(),
    headLogs: [],
    headLogByPlan: new Map(),
    stagesByParent: new Map(),
    deleted: new Set(),
    retyped: new Map(),
    pending: new Map(),
  }
  for (const log of logs) {
    if (!session.logById.has(log.id)) session.logById.set(log.id, log)
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
  planIndex: number
  slotKey: string
  localId: string | null
  addedPlace: number | null
  draftKey: AddedSetKey | null
  /** A set a swap for today moved away from this card: the gap it leaves in its place (46r's Q1), counted and never drawn. */
  gap: boolean
  gapsBefore: { working: number; warmup: number }
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

/** A place as the card hands it over: a whole number from 1 (DECISIONS 174's column refuses less). */
function entryPlace(place: unknown, what: string): number {
  if (typeof place === 'number' && Number.isInteger(place) && place >= 1) return place
  throw new TypeError(`${what} has no place (a whole number from 1)`)
}

/** A draft's place: the set's, or null for a set logged before 044 (it had none). Absent is refused, like a missing type. */
function draftPlace(place: unknown, what: string): number | null {
  return place === null ? null : entryPlace(place, what)
}

/**
 * The time a draft of a set logged before 044 is drawn by (DECISIONS 184 (b), Adam 2026-10-20: "The unlog moves nothing"; its
 * option: "The draft keeps the log's time, so the unlog moves nothing"): the log's, which the draft keeps. Such a set has no
 * place, so without its time it would be drawn somewhere nobody put it: refused. A draft that has a place is drawn by it.
 */
function draftTime(place: number | null, loggedAt: unknown, what: string): number | null {
  if (place !== null) return null
  if (typeof loggedAt !== 'string') throw new TypeError(`${what} has no place and keeps no time (a set logged before 044 keeps its log's time)`)
  return timeOf(loggedAt)
}

/**
 * A log's place (DECISIONS 174, 177): an added set's head log carries it; absent (`SetLog.addedPlace` is optional) reads as
 * null, as null does; anything else the column would refuse is a caller bug.
 */
function logPlace(log: LoggedSet): number | null {
  const place = log.addedPlace
  return place === undefined || place === null ? null : entryPlace(place, `the log ${log.id}`)
}

/**
 * A set added in the session before it is a head: its own id, its log while it has one, the type it has while open, its
 * draft, its place, and, for one logged before 044 (no place), the time it is ordered by (its log's, or the one its draft kept).
 */
interface AddedSlot {
  localId: string
  log: LoggedSet | null
  openType: SessionSetChangeType
  draftKey: AddedSetKey | null
  place: number | null
  time: number | null
  /** A set a swap moved away from this card: its gap (46r's Q1). */
  gap: boolean
}

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/** A logged time, for the order of the sets logged before 044 (an unreadable one first, as REVIEW reads it). */
const timeOf = (iso: string): number => {
  const t = Date.parse(iso)
  return Number.isNaN(t) ? -Infinity : t
}

/** Is this a head log of a set added in the session to the exercise? (A drop's log never is: DECISIONS 177.) */
const isAddedHeadOf = (exerciseId: string) => (log: LoggedSet): boolean =>
  log.parentSetId === null && log.weekPlanSetId === null && log.exerciseId === exerciseId

interface AddedDraftOf {
  draft: AddedDraft
  type: SessionSetChangeType
  place: number | null
  time: number | null
}

/** The drafts of the card's own added sets, by local id, each with its type and place (both required: 161, 174) and, without a place, its time (184). */
function addedDrafts(exercise: OrderExercise): Map<string, AddedDraftOf> {
  const drafts = new Map<string, AddedDraftOf>()
  for (const draft of exercise.drafts ?? []) {
    if (!isAddedDraft(draft) || draft.key.exerciseId !== exercise.exerciseId) continue
    if (drafts.has(draft.key.localId)) throw new RangeError(`${exercise.name} holds two drafts of the added set ${draft.key.localId}`)
    const what = `the draft of the set ${draft.key.localId} added to ${exercise.name}`
    const place = draftPlace(draft.values?.place, what)
    drafts.set(draft.key.localId, { draft, type: heldType(draft.values?.type, what), place, time: draftTime(place, draft.values?.loggedAt, what) })
  }
  return drafts
}

// ─── A swap for today, and an exercise on more than one card (DECISIONS 183 (a) and its follow-ups) ─────

/** The cards in the order the screen draws them: a block's members in block order, where the block stands. */
function cardsOf(order: SessionOrder): OrderExercise[] {
  return order.units.flatMap((unit) => (unit.kind === 'single' ? [unit.exercise] : [...unit.members]))
}

/**
 * Which card draws a set added to an exercise that is on more than one card (183's follow-up, Adam 2026-10-20: "The same
 * exercise on two cards in one session: each card is numbered on its own, as today's display does"): a set is drawn on one
 * card, so it has one row, one number and one log number to keep. It is the card whose list names it (its own id, or its log's),
 * else the card a swap moved it to (its place is in that card's `swappedFrom.moved`), else (a reading: the words don't say) the
 * card that was the exercise's latest when the set was added: places are given in the order sets are added, so the card made by
 * the last swap whose moved places are below the set's, or else the exercise's own card (the first that no swap made); a set
 * logged before 044 (no place) is the own card's. On an exercise with one card that card draws every set added to it, as before.
 */
interface Owners {
  byId: Map<string, string>
  byPlace: Map<number, string>
  own: string
  /** Each card of the exercise with the first place it was given: 0 for a card no swap made, its lowest moved place else. */
  since: ReadonlyArray<{ key: string; since: number }>
}

/** What a swap for today did to the cards (183 (a)): the sets it moved away, which no card draws, the gaps they leave, and who draws what. */
interface Structure {
  owners: Map<string, Owners>
  /** The planned sets a swap moved away: "The original card draws no row for a set that moved." */
  movedPlanned: Set<string>
  /** The added sets a swap moved away, by their exercise and place (their log, if the swap skipped them, holds the place). */
  movedAdded: Map<string, Set<number>>
  /** The places of the added sets a swap moved away, by the card they left: each keeps a gap there (46r's Q1). */
  gapPlaces: Map<string, number[]>
}

function structureOf(cards: readonly OrderExercise[]): Structure {
  const byKey = new Map(cards.map((card) => [card.key, card]))
  const movedPlanned = new Set<string>()
  const movedAdded = new Map<string, Set<number>>()
  const gapPlaces = new Map<string, number[]>()
  for (const card of cards) {
    const swap = card.swappedFrom
    if (swap === undefined) continue
    const from = byKey.get(swap.fromKey)
    if (from === undefined) throw new RangeError(`${card.name} was swapped from ${swap.fromKey}, which is not a card of the session`)
    for (const { from: set, place } of swap.moved) {
      entryPlace(place, `a set moved to ${card.name}`)
      if ('weekPlanSetId' in set) movedPlanned.add(set.weekPlanSetId)
      else {
        const at = entryPlace(set.addedPlace, `a set moved from ${from.name}`)
        const places = movedAdded.get(from.exerciseId) ?? new Set<number>()
        places.add(at)
        movedAdded.set(from.exerciseId, places)
        const left = gapPlaces.get(from.key) ?? []
        if (!left.includes(at)) gapPlaces.set(from.key, [...left, at])
      }
    }
  }
  const byExercise = new Map<string, OrderExercise[]>()
  for (const card of cards) byExercise.set(card.exerciseId, [...(byExercise.get(card.exerciseId) ?? []), card])
  const owners = new Map<string, Owners>()
  for (const [exerciseId, group] of byExercise) {
    if (group.length < 2) continue
    const byId = new Map<string, string>()
    const byPlace = new Map<number, string>()
    const claim = <K,>(map: Map<K, string>, id: K, key: string) => {
      const had = map.get(id)
      if (had !== undefined && had !== key) throw new RangeError(`two cards of ${exerciseId} claim the added set ${String(id)}`)
      map.set(id, key)
    }
    for (const card of group) {
      for (const entry of card.added ?? []) {
        claim(byId, entry.localId, card.key)
        if (entry.logId !== null) claim(byId, entry.logId, card.key)
      }
      for (const { place } of card.swappedFrom?.moved ?? []) claim(byPlace, place, card.key)
    }
    const since = group.map((card) => ({ key: card.key, since: card.swappedFrom === undefined ? 0 : Math.min(...card.swappedFrom.moved.map((m) => m.place)) }))
    owners.set(exerciseId, { byId, byPlace, own: (group.find((card) => card.swappedFrom === undefined) ?? group[0]).key, since })
  }
  return { owners, movedPlanned, movedAdded, gapPlaces }
}

/** Does `exercise`'s card draw the added set `id` (a log's id or a draft's local id) at `place`? */
function drawsAdded(structure: Structure, exercise: OrderExercise, id: string, place: number | null): boolean {
  if (place !== null && structure.movedAdded.get(exercise.exerciseId)?.has(place) === true) return false
  const owners = structure.owners.get(exercise.exerciseId)
  if (owners === undefined) return true
  const latest = (at: number): string | undefined =>
    owners.since.reduce<{ key: string; since: number } | undefined>((best, card) => (card.since < at && (best === undefined || card.since > best.since) ? card : best), undefined)?.key
  const owner = owners.byId.get(id) ?? (place === null ? owners.own : owners.byPlace.get(place) ?? latest(place) ?? owners.own)
  return owner === exercise.key
}

/**
 * The sets added in the session to `exercise`, in their places (DECISIONS 170, 173, 174): every set the card's list names,
 * every head log of an added set it doesn't name (a reload, a reopened session, another phone), and every draft no listed set
 * has, each where its place puts it, two in one place by their log's id (an open set's own id). The sets logged before 044 (no
 * place) come first, in the order they were logged (`loggedAt`, then id); the draft of such a set, unlogged under 1.2, keeps
 * its log's time and is drawn in its place among them (DECISIONS 184 (b)). Every set with a place was added after those.
 * Nothing else orders them: the list's own order, a log's number or a draft's position never moves a set. A set a swap moved
 * away is not drawn: the card it left keeps a gap in its place (`gap`, 46r's Q1). A set of an exercise on two cards is drawn on
 * the one card that `drawsAdded` names (183).
 */
function addedSlots(exercise: OrderExercise, session: SessionIndex, structure: Structure): AddedSlot[] {
  const ownAdded = isAddedHeadOf(exercise.exerciseId)
  const drafts = addedDrafts(exercise)
  const movedAway = (place: number | null) => place !== null && structure.movedAdded.get(exercise.exerciseId)?.has(place) === true

  const slots: AddedSlot[] = []
  const listed = new Set<string>() // the sets' own ids
  const named = new Set<string>() // the logs the list names
  for (const entry of exercise.added ?? []) {
    if (listed.has(entry.localId)) throw new RangeError(`${exercise.name} lists the added set ${entry.localId} twice`)
    listed.add(entry.localId)
    const what = `the set ${entry.localId} added to ${exercise.name}`
    const openType = heldType(entry.type, what)
    const place = entryPlace(entry.place, what)
    let log: LoggedSet | null = null
    if (entry.logId !== null) {
      if (named.has(entry.logId)) throw new RangeError(`two sets added to ${exercise.name} name the log ${entry.logId}`)
      named.add(entry.logId)
      const found = session.logById.get(entry.logId)
      // A log that isn't among the logs (not yet, or not any more) leaves the set open for this render, with its type.
      if (found !== undefined) {
        if (!ownAdded(found)) throw new RangeError(`the set ${entry.localId} added to ${exercise.name} names the log ${entry.logId}, which is not a set added to it`)
        log = found
      }
    }
    if (movedAway(place)) continue
    slots.push({ localId: entry.localId, log, openType, draftKey: log === null ? drafts.get(entry.localId)?.draft.key ?? null : null, place, time: null, gap: false })
  }
  // The sets a swap moved away from this card leave a gap in each one's place (46r's Q1), of the type it had here: its log's (the
  // swap's skip of it), else the card's entry's, else its draft's; Normal when only the swap's record names it.
  for (const place of structure.gapPlaces.get(exercise.key) ?? []) {
    const entry = (exercise.added ?? []).find((e) => e.place === place)
    const log = (entry !== undefined && entry.logId !== null ? session.logById.get(entry.logId) : undefined) ?? session.headLogs.find((l) => ownAdded(l) && logPlace(l) === place)
    const draft = [...drafts.values()].find((d) => d.place === place)
    const type = log !== undefined ? (log.isWarmup ? WARMUP : NORMAL) : entry !== undefined ? heldType(entry.type, `the set ${entry.localId} added to ${exercise.name}`) : (draft?.type ?? NORMAL)
    slots.push({ localId: entry?.localId ?? log?.id ?? draft?.draft.key.localId ?? '', log: null, openType: type, draftKey: null, place, time: null, gap: true })
  }
  // A log whose id is a listed set's own id is that set's (a card that took the set over from its log keeps the id), so it is
  // not drawn a second time while its unlog has not reached the logs.
  const unlisted = session.headLogs.filter((log) => ownAdded(log) && !named.has(log.id) && !listed.has(log.id) && drawsAdded(structure, exercise, log.id, logPlace(log)))
  const unlistedIds = new Set(unlisted.map((log) => log.id))
  for (const log of unlisted) {
    const place = logPlace(log)
    slots.push({ localId: log.id, log, openType: NORMAL, draftKey: null, place, time: place === null ? timeOf(log.loggedAt) : null, gap: false })
  }
  for (const { draft, type, place, time } of drafts.values()) {
    if (listed.has(draft.key.localId) || unlistedIds.has(draft.key.localId) || !drawsAdded(structure, exercise, draft.key.localId, place)) continue
    slots.push({ localId: draft.key.localId, log: null, openType: type, draftKey: draft.key, place, time, gap: false })
  }

  // Before 044 (no place): the logs and the drafts of such sets by time, then by id; then every set with a place, by place. Two
  // sets in one place (two phones adding at once) go by their log's id, which every phone reads the same, so no two phones order
  // them differently and correct each other's numbers back and forth (178); an open set, which only this phone holds, by its own.
  const tieKey = (slot: AddedSlot): string => slot.log?.id ?? slot.localId
  return slots.sort(
    (a, b) =>
      (a.place === null ? 0 : 1) - (b.place === null ? 0 : 1) ||
      (a.place !== null && b.place !== null ? a.place - b.place : 0) ||
      (a.place === null && b.place === null ? (a.time ?? -Infinity) - (b.time ?? -Infinity) || 0 : 0) ||
      byId(tieKey(a), tieKey(b)),
  )
}

/**
 * A card's heads in its own order (the plan's sets, then the added ones in their places), not numbered yet, with the gaps the
 * sets a swap moved away leave in their places (`gap`: counted, never drawn; 46r's Q1).
 */
function exerciseHeads(exercise: OrderExercise, session: SessionIndex, structure: Structure): Head[] {
  const heads: Head[] = []

  // The plan's sets, in the plan's order, minus the ones the session deleted; a set a swap moved away is a gap (183 (a), Q1).
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
      planIndex: 0,
      slotKey: exercise.key,
      localId: null,
      addedPlace: null,
      draftKey: null,
      gap: structure.movedPlanned.has(planned.id),
      gapsBefore: { working: 0, warmup: 0 },
    })
  }

  // The sets added in the session come after the planned ones, in their places, which are the order they were added in
  // (DECISIONS 170, 174). A logged one has the type of its log; an open one the type the card keeps for it (DECISIONS 161),
  // or, for a set the card doesn't list, its draft's. A set added and then switched to Warmup is still that set in that
  // place, drawn as a warmup.
  for (const { localId, log, openType, draftKey, place, gap } of addedSlots(exercise, session, structure)) {
    const stageLogs = log ? session.stagesByParent.get(log.id) ?? [] : []
    heads.push({
      key: addedRowKey(exercise.key, localId),
      exercise,
      weekPlanSetId: null,
      added: true,
      log,
      stageLogs,
      type: log ? loggedHeadType(log, null, undefined, session.pending.get(log.id), stageLogs.length) : openType,
      plannedType: null,
      retyped: false,
      number: 0,
      planIndex: 0,
      slotKey: exercise.key,
      localId,
      addedPlace: place,
      draftKey,
      gap,
      gapsBefore: { working: 0, warmup: 0 },
    })
  }
  return heads
}

/** Every card's heads, numbered: each slot (the cards one numbering covers) as one list, in its cards' order. */
interface Numbered {
  /** Each card's heads that are drawn (no gap), numbered. */
  heads: Map<string, Head[]>
  /** Each slot's cards in their numbering order, by the slot's first card (its key is the rows' `slotKey`). */
  slots: Map<string, string[]>
  /** Each card's gaps (46r's Q1), all of them: what a set appended to the card counts. */
  gaps: Map<string, { working: number; warmup: number }>
}

/**
 * DECISIONS 170, 173 and 183 (a). A card a swap for today made continues the numbering of the card it replaced: "one
 * numbering for the exercise's place in the session, covering moved and added sets: the original card's sets that didn't move,
 * then the moved sets in the order they stood, then any set added to the new card, each numbered by its rank in that list."
 * Such a card holds only what the swap moved to it and what was added after: it has no planned set, no added set of its own in
 * a place before the first moved one, and it is drawn after the card it replaced. A card that held sets of its own before the
 * swap brought sets into it keeps its own numbering, the moved sets after its added ones (183's follow-up: "A swap into an
 * exercise that already has added sets: the moved sets come after them. A swap never renumbers sets that are already logged."),
 * and so does every card no swap made: the same exercise on two cards is numbered on each on its own. In each list a working
 * set's number is its rank among the working sets, logged, skipped or open alike, and a warmup's its rank among the warmups,
 * where a set a swap moved away still counts in its place for the sets after it on its own card (46r's Q1, Adam 2026-10-20: "A
 * swap never changes the number of a set that's already logged, on either card. If moving open sets leaves a gap on the
 * original card, the gap shows"), and the sets of the slot's later cards count the moved sets where they are drawn now. So
 * the sets that didn't move keep their numbers (01, 03), and the moved sets come after the sets drawn before them (03, 04).
 */
function numberedHeads(order: SessionOrder, session: SessionIndex): Numbered {
  const cards = cardsOf(order)
  const structure = structureOf(cards)
  const all = new Map(cards.map((card) => [card.key, exerciseHeads(card, session, structure)]))
  const at = new Map(cards.map((card, i) => [card.key, i]))
  const parent = new Map<string, string>()
  for (const card of cards) {
    const swap = card.swappedFrom
    if (swap === undefined || card.plannedSets.length > 0 || at.get(swap.fromKey)! >= at.get(card.key)!) continue
    const first = swap.moved.length > 0 ? Math.min(...swap.moved.map((m) => m.place)) : -Infinity
    if (all.get(card.key)!.some((head) => head.added && !head.gap && (head.addedPlace === null || head.addedPlace < first))) continue
    parent.set(card.key, swap.fromKey)
  }
  // A slot's cards in the order the screen draws them, top to bottom (a card a swap made is drawn after the card it replaced).
  const rootOf = (key: string): string => {
    const from = parent.get(key)
    return from === undefined ? key : rootOf(from)
  }
  const slots = new Map<string, string[]>()
  for (const card of cards) {
    const root = rootOf(card.key)
    slots.set(root, [...(slots.get(root) ?? []), card.key])
  }
  const heads = new Map<string, Head[]>()
  const gaps = new Map<string, { working: number; warmup: number }>()
  for (const [slotKey, keys] of slots) {
    // The sets drawn so far in the slot, of each list; a gap counts only on its own card (the card a swap moves sets from is the
    // last of its slot, so no card stands between it and the sets it moved).
    let warmups = 0
    let workings = 0
    let index = 0
    for (const key of keys) {
      const own = { working: 0, warmup: 0 }
      const drawn: Head[] = []
      for (const head of all.get(key)!) {
        const warmup = head.type.kind === 'warmup'
        if (head.gap) {
          if (warmup) own.warmup++
          else own.working++
          continue
        }
        head.planIndex = ++index
        head.slotKey = slotKey
        head.gapsBefore = { ...own }
        head.number = warmup ? ++warmups + own.warmup : ++workings + own.working
        drawn.push(head)
      }
      heads.set(key, drawn)
      gaps.set(key, own)
    }
  }
  return { heads, slots, gaps }
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
    slotKey: head.slotKey,
    gapsBefore: head.gapsBefore,
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
      localId: head.localId,
      addedPlace: head.addedPlace,
      draftKey: head.draftKey,
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
        localId: null,
        addedPlace: null,
        draftKey: null,
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
  const { heads } = numberedHeads(order, indexSession(logs, changes))
  const split = (key: string) => {
    const all = heads.get(key)!
    return { warmups: all.filter((head) => head.type.kind === 'warmup'), workings: all.filter((head) => head.type.kind !== 'warmup') }
  }
  const rows: ResolvedRow[] = []
  for (const unit of order.units) {
    if (unit.kind === 'single') {
      const { warmups, workings } = split(unit.exercise.key)
      for (const head of [...warmups, ...workings]) rows.push(...rowsOf(head, null))
      continue
    }
    const members = unit.members.map((member) => split(member.key))
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

/**
 * DECISIONS 170 and 173 (with 146 (a) and SPEC 18b, "the remaining sets renumber"): a working set's number is its rank among
 * its card's working sets, a warmup's among its card's warmups. When `row`'s set leaves the card (`'deleted'`), or moves from
 * one list to the other (`'toWarmup'`, `'fromWarmup'`), every log of the card whose stored `set_number` is not its set's rank
 * afterwards is given it: a working set with its drops (the app writes a drop with its head's `set_number`), a warmup, and the
 * moved set's own log (173: "a log never keeps a number its row no longer shows"). With stored numbers that are the ranks
 * (LOG stores the number its row shows) those are exactly the logged sets after it in the lists it leaves and joins, each
 * down or up one; the open ones follow by themselves, and an open set between them holds its place (DECISIONS 151), as does
 * a gap a swap left (46r's Q1: a rank counts the gaps before the set on its card, `gapsBefore`, in the list it is in then).
 * `going`: logs that are being deleted, which keep no number.
 */
function renumberCard(
  row: ResolvedRow,
  change: 'deleted' | 'toWarmup' | 'fromWarmup',
  session: Pick<SessionView, 'rows' | 'logs'>,
  going: ReadonlySet<string> = new Set(),
): NumberPatch[] {
  // The set's slot (183 (a)): a card a swap made and the card it replaced are one list, so a change on either moves both. The
  // gaps a swap left before a set on its card hold their places (46r's Q1), whatever the change: a set's number counts them.
  const sets = session.rows.filter((r) => r.slotKey === row.slotKey && r.kind !== 'stage').sort((a, b) => a.planIndex - b.planIndex)
  const patches: NumberPatch[] = []
  let warmups = 0
  let workings = 0
  for (const set of sets) {
    // The kind each set has afterwards: the changed one leaves the card or moves; every other keeps its own.
    const warmup = set.key !== row.key ? set.kind === 'warmup' : change === 'deleted' ? null : change === 'toWarmup'
    if (warmup === null) continue
    const rank = warmup ? ++warmups + set.gapsBefore.warmup : ++workings + set.gapsBefore.working
    if (set.logId === null) continue
    const head = logOf(set, session.logs)
    for (const log of [head, ...stagesOf(session.logs, head.id)]) {
      if (!going.has(log.id) && log.setNumber !== rank) patches.push({ id: log.id, setNumber: rank })
    }
  }
  return patches
}

/**
 * DECISIONS 178 (Adam, 2026-10-19): "Chunk 46's rules report the logged sets whose stored number differs from the number
 * their row shows; the workout screen writes the corrected numbers when it draws the session's rows. It writes only where
 * they differ, so drawing the same session again writes nothing." Every log drawn on a row (a set, logged or skipped; a
 * warmup; a drop, which shows its head's number) whose stored `set_number` is not its row's number, with that number, in
 * the order of the rows; empty when they all agree. Nothing else changes: not a place (174), not a type.
 * DECISIONS 185 (c) (Adam, 2026-10-20): "A phone never corrects a stored number after a set only it holds." Its option:
 * "Never correct a log that comes after an open added set on its card; every other correction as 178 says." An open added
 * set (never logged, or unlogged: a draft) is only on the phone that holds it (G46), so the numbers after it are this phone's
 * alone: every log that comes after one in its list (its slot, 183 (a)) is left out, whatever it holds. Another phone, which
 * doesn't hold the set, corrects them once; once the set is logged (every phone then sees it) or deleted, nobody needs to.
 */
export function numberCorrections(order: SessionOrder, logs: readonly LoggedSet[], changes: readonly SessionSetChange[] = []): NumberPatch[] {
  const held = new Map(logs.map((log) => [log.id, log]))
  const rows = resolveRows(order, logs, changes)
  const firstOpenAdded = new Map<string, number>()
  for (const row of rows) {
    if (!row.added || row.kind === 'stage' || row.state !== 'unlogged') continue
    firstOpenAdded.set(row.slotKey, Math.min(row.planIndex, firstOpenAdded.get(row.slotKey) ?? Infinity))
  }
  const patches: NumberPatch[] = []
  for (const row of rows) {
    if (row.logId === null || row.planIndex > (firstOpenAdded.get(row.slotKey) ?? Infinity)) continue
    const log = held.get(row.logId)
    if (log !== undefined && log.setNumber !== row.number) patches.push({ id: log.id, setNumber: row.number })
  }
  return patches
}

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
   * A set switched to or from Warmup, logged or not: the logs whose `set_number` is not their set's rank afterwards
   * (DECISIONS 146 (a), 170, 173). To Warmup the logged working sets after it move down one, as a delete moves them, and the
   * logged warmups after it up one; from Warmup the other way round. A logged set's own log takes its rank in the list it
   * joins (its W number, or its working number). The open sets follow by themselves, and so does the open set itself: it
   * has no log, so nothing of its own to write. A set added in the session and not logged yet is one of these like a
   * planned set (its type is the card's: DECISIONS 161). With a type change on a logged set they need a connection, as it
   * does (G47); for a set not logged yet they queue offline, like a delete (DECISIONS 168 (a)). A patch holds a number
   * only, never a place (174).
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
    // draft's: `type` is what to keep, DECISIONS 161). The logged sets after a set that moves between the working sets and
    // the warmups move with it, planned or added (an open set keeps its place, so a logged set can come after it: DECISIONS
    // 151), in both lists (173).
    const renumber = (next.kind === 'warmup') !== (current.kind === 'warmup') ? renumberCard(row, next.kind === 'warmup' ? 'toWarmup' : 'fromWarmup', session) : []
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
  // A log that is being deleted has no number to change. The set's own log takes its rank in the list it joins (173).
  const going = new Set(stagesToDelete.map((stage) => stage.id))
  const renumber =
    (next.kind === 'warmup') !== (current.kind === 'warmup') ? renumberCard(row, next.kind === 'warmup' ? 'toWarmup' : 'fromWarmup', session, going) : []
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
  /**
   * Later sets of the same exercise in the deleted set's list, with the number that closes the gap: their rank among the sets
   * left (170), a working set with its drops, a warmup after a deleted warmup (173). A number only, never a place (174).
   */
  renumber: NumberPatch[]
  /**
   * The `v2_session_set_changes` rows that keep what was deleted out of the session. A planned set (logged or
   * not): `deleted`, replacing its `retyped` row. A drop of a planned set: the set's `retyped` row with one drop
   * fewer; of a logged set: its `pending_stages` row with one drop fewer, none when it was the last. An added
   * set needs none (its card takes it off its list of added sets).
   */
  changes: ChangeWrite[]
  /** The last drop of a logged set deleted: the set is a normal set, so its log loses its stage kind (147 (a)). */
  headPatch: { id: string; stageKind: null } | null
  /** A drop deleted: its set's type afterwards. A set added in the session and not logged yet keeps its type as the card's own state, which this is. */
  type: SessionSetChangeType | null
}

/**
 * SPEC 18b: deleting a set or a drop, logged or not (`row` from `resolveRows`, `session` as the rest of the
 * module reads it). The deleted set never comes back: its log is deleted and the later sets of its list take the
 * numbers that close the gap (a drop carries its head's `set_number`; a warmup closes the warmups' gap, 173), and the
 * change rows say it is gone. A drop deleted on its own renumbers nothing.
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
  }
  // The set leaves its list, logged or not (an open set keeps its place, so a logged set can come after it: DECISIONS 151): the
  // working sets after a working set close the gap, and the warmups after a warmup (173).
  effects.renumber = renumberCard(row, 'deleted', session, new Set(effects.deleteOrder.map((log) => log.id)))
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
 * `retyped` change and a drop follows its set, so only an added set's own draft holds one. It keeps its place too
 * (DECISIONS 174: "kept on re-log after an unlog (the draft holds it until then)"): the re-log writes it on the new log
 * (63), and a draft no listed set has is drawn there; null for a set logged before 044, which had none.
 */
export interface AddedSetDraft extends SetDraft {
  type: SessionSetChangeType
  place: number | null
  /**
   * When the set was logged (DECISIONS 184 (b), Adam 2026-10-20: "The unlog moves nothing; the re-log may"): a set logged
   * before 044 has no place and is ordered by its log's time, so its draft keeps that time and is drawn in its place among
   * the others. The re-log writes the time it happens (63), which moves the set to after the other sets logged before 044.
   */
  loggedAt: string
}

/**
 * A draft as the phone holds it, as far as the rows read it: `OrderExercise.drafts` is the session's stored drafts. The draft
 * of a set added in the session must say its type and its place, and keeps its log's time (read only without a place: 184);
 * the rows read nothing else from a draft (the numbers are for the box).
 */
export type HeldDraft =
  | { key: AddedSetKey; values: Pick<AddedSetDraft, 'type' | 'place' | 'loggedAt'> }
  | { key: PlannedSetKey | DropDraftKey; values?: unknown }

export interface UnlogEffects {
  /** The logs to delete: a set's skipped drops from the last, then the set; a drop, the skipped drops after it from the last, then the drop. */
  deleteOrder: LoggedSet[]
  /** The draft to keep on the phone: the set's numbers and, for a set added in the session, its type and place (161, 174). */
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

// A set's draft key: the planned set, or for an added set its own id (the card's; for a set it doesn't list, its log's), its
// exercise and the number its row shows (`position`, TASKS 63's key). Nothing reads the position: the number is the set's
// rank (170) and its place is in the draft's values (174).
function setKeyOf(head: Pick<ResolvedRow, 'weekPlanSetId' | 'localId' | 'number'>, log: LoggedSet): PlannedSetKey | AddedSetKey {
  return head.weekPlanSetId !== null
    ? { sessionId: log.sessionId, weekPlanSetId: head.weekPlanSetId }
    : { sessionId: log.sessionId, localId: head.localId ?? log.id, exerciseId: log.exerciseId, position: head.number }
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
    // An added set has no planned set to key a change on, so its draft holds the type it has now (DECISIONS 161) and its
    // place (174), which the re-log writes again, and its log's time, by which a set logged before 044 stays in its place (184).
    draft:
      'localId' in key
        ? { key, values: { ...values, type: heldType(row.type, `the set ${row.key}`), place: row.addedPlace, loggedAt: log.loggedAt } }
        : { key, values },
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

// ─── Adding sets: the place a new set takes (DECISIONS 173, 174, 179, 183) ──────────────────────

/**
 * DECISIONS 174 (Adam, 2026-10-19: "chunk 46 owns the rule (a pure function assigning the next place when an added set is
 * created)"): the place of a set added now to the exercise `exerciseId`, 1 + the highest place the phone knows for that
 * exercise ("an added set's place among the sets added to its exercise in that session"): every card of it, with its list's
 * entries and its drafts, the session's head logs of sets added to it (a drop's log carries none and is not read: 177), and
 * the places a swap's record names for it (a set moved to it, or moved away from it: 183 (a)), so no place is given twice on
 * one phone, also when the exercise is on two cards. 1 when it knows none (an exercise whose added sets were all logged
 * before 044 has none either: those come first all the same). So a set added in a reopened session comes after every earlier
 * one that still has a log or a draft. Called once, when the set is made (58a: + ADD SET, + ADD ROUND through `addRound`; 59:
 * "Add a set"; a swap through `movedSetEntries`); a place is never changed afterwards.
 */
export function nextAddedPlace(order: SessionOrder, exerciseId: string, logs: readonly LoggedSet[]): number {
  const cards = cardsOf(order)
  let highest = 0
  for (const card of cards) {
    if (card.exerciseId === exerciseId) {
      for (const entry of card.added ?? []) highest = Math.max(highest, entryPlace(entry.place, `the set ${entry.localId} added to ${card.name}`))
      for (const { place } of addedDrafts(card).values()) highest = Math.max(highest, place ?? 0)
    }
    const swap = card.swappedFrom
    if (swap === undefined) continue
    const fromExercise = cards.find((c) => c.key === swap.fromKey)?.exerciseId
    for (const { from, place } of swap.moved) {
      if (card.exerciseId === exerciseId) highest = Math.max(highest, entryPlace(place, `a set moved to ${card.name}`))
      if (fromExercise === exerciseId && 'addedPlace' in from) highest = Math.max(highest, entryPlace(from.addedPlace, `a set moved from ${swap.fromKey}`))
    }
  }
  for (const log of logs) {
    if (isAddedHeadOf(exerciseId)(log)) highest = Math.max(highest, logPlace(log) ?? 0)
  }
  return highest + 1
}

/** What a swap moves to an exercise: the new card's entries for the sets, and the swap's record of them. */
export interface SwapMoves {
  /** The new card's list entries for the moved sets (open, with their types and places): what it appends to `added`. */
  entries: AddedSet[]
  /** The record (59 writes it): the card they came from and, for each, what it was there and its place here. */
  record: SwapRecord
}

/**
 * DECISIONS 164, 179 and 183 (a) (Adam, 2026-10-16 to 2026-10-20). 164: "the original's open sets move to the new exercise
 * with their numbers, type, drops and targets, as W5 draws." 179: "Sets moved by a swap for today count as added sets of the
 * new exercise. Each gets its place at the swap, in their order, after any sets already added to that exercise." 183's
 * follow-up: "A swap into an exercise that already has added sets: the moved sets come after them." `moved` are the open sets
 * of one card that the swap moves (their rows, from `resolveRows`), each with the id the new card gives it; `target` is the
 * exercise they move to. Each moved set keeps its type (its drops come with it) and gets a place from `nextAddedPlace` for
 * that exercise on, in the order they stood (by their place on their card, whatever order they are given in). The card they
 * move to (a card of their own, drawn after the card they left: W5; or a card that holds no record yet) appends `entries` to
 * its list and keeps `record` as its `swappedFrom`; 59 writes the record with the swap and each set's place with its log. The
 * card they left keeps a gap in each one's place (46r's Q1). A logged, skipped or drop row, rows of two cards, rows of a card
 * whose sets a swap already moved (a card's sets are swapped once), a set added before 044 (it has no place to be named by)
 * and an id another card of the exercise lists are refused.
 */
export function movedSetEntries(
  order: SessionOrder,
  logs: readonly LoggedSet[],
  target: { exerciseId: string; name: string },
  moved: ReadonlyArray<{ row: ResolvedRow; localId: string }>,
): SwapMoves {
  const fromKey = moved[0]?.row.exerciseKey ?? ''
  if (cardsOf(order).some((card) => card.swappedFrom?.fromKey === fromKey)) throw new RangeError(`a swap already moved the sets of ${fromKey}: a card's sets are swapped once`)
  const taken = new Set(cardsOf(order).filter((card) => card.exerciseId === target.exerciseId).flatMap((card) => (card.added ?? []).map((entry) => entry.localId)))
  const sets = [...moved].sort((a, b) => a.row.planIndex - b.row.planIndex)
  const first = nextAddedPlace(order, target.exerciseId, logs)
  const entries: AddedSet[] = []
  const record: MovedSet[] = []
  sets.forEach(({ row, localId }, i) => {
    if (row.exerciseKey !== fromKey) throw new RangeError(`a swap moves the sets of one card: ${row.key} is not on ${fromKey}`)
    if (row.kind === 'stage' || row.type === null || row.state !== 'unlogged') throw new RangeError(`a swap moves open sets only: ${row.key} is not one`)
    if (taken.has(localId)) throw new RangeError(`${target.name} already lists the set ${localId}`)
    taken.add(localId)
    let from: MovedSetRef
    if (row.weekPlanSetId !== null) from = { weekPlanSetId: row.weekPlanSetId }
    else if (row.addedPlace !== null) from = { addedPlace: row.addedPlace }
    else throw new RangeError(`${row.key} was added before 044: it has no place for the swap's record to name it by`)
    const type = heldType(row.type, `the set ${row.key} moved to ${target.name}`)
    entries.push({ localId, logId: null, type, place: first + i })
    record.push({ from, place: first + i })
  })
  return { entries, record: { fromKey, moved: record } }
}

/**
 * SPEC Defaults 9: "+ ADD ROUND" adds one set to every member of the superset (board W1), whatever each
 * member has (3 and 2 sets become 4 and 3). Returns the new set of each member in block order, with the
 * number it takes and its place (`nextAddedPlace` for that member's exercise: DECISIONS 174); the caller adds one entry to
 * each member's list (`OrderExercise.added`: a new id, no log, Normal, that place), where it takes that number (DECISIONS 170):
 * after the working sets of its slot up to and on its card (183 (a)) and the gaps on its card (46r's Q1).
 */
export function addRound(
  order: SessionOrder,
  rows: readonly ResolvedRow[],
  blockId: string,
  logs: readonly LoggedSet[],
): Array<{ exerciseKey: string; exerciseId: string; position: number; place: number }> {
  const unit = order.units.find((u): u is Extract<OrderUnit, { kind: 'block' }> => u.kind === 'block' && u.id === blockId)
  if (unit === undefined) throw new RangeError(`no superset block ${blockId}`)
  const { slots, gaps } = numberedHeads(order, indexSession(logs, []))
  const slotOf = new Map([...slots].flatMap(([slotKey, keys]) => keys.map((key, i) => [key, { slotKey, keys: keys.slice(0, i + 1) }] as const)))
  return unit.members.map((member) => {
    const { keys } = slotOf.get(member.key)!
    return {
      exerciseKey: member.key,
      exerciseId: member.exerciseId,
      position: rows.filter((row) => keys.includes(row.exerciseKey) && row.kind === 'working').length + gaps.get(member.key)!.working + 1,
      place: nextAddedPlace(order, member.exerciseId, logs),
    }
  })
}
