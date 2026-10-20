// A workout session driven the way chunks 58a to 64 will drive the rules (DECISIONS 170's sequence test, 173's, and the fixed
// cases beside it): every step asks the module, writes its answer to the stand-in for the tables (`FakeServer`: 035's, 042's
// and 044's checks, the unique indexes, the drops-first foreign key) and does to the card's own state what the card does with
// it (workoutRules.ts' header, "What the card keeps for the sets added in the session"). Beside that it keeps its own record of
// where every set is, which the module never sees: the plan's sets in their planned order, then the added sets in the order
// they were added, a deleted one taken out, and, at a reopen or a reload, the sets that end with the phone's state taken out;
// a swap for today moves the open sets of a card to a card of their own (chunk 46r, DECISIONS 183 (a)), and the record keeps
// which cards one numbering covers (the slots). Nothing here decides what a rule decides.

import type { SessionSetChangeType, SetLog, WeekPlanSet } from '../../types'
import { reviewItems } from '../plan/review'
import {
  applySetTypeChange,
  canUnlog,
  deleteEffects,
  movedSetEntries,
  nextAddedPlace,
  numberCorrections,
  plannedRowKey,
  addedRowKey,
  resolveRows,
  typeChangeNeedsNumbers,
  typeColumns,
  unlogEffects,
  type AddedSetKey,
  type DeleteEffects,
  type HeldDraft,
  type NumberPatch,
  type OrderExercise,
  type OrderSuperset,
  type ResolvedRow,
  type SetTypeChange,
  type UnlogEffects,
} from './workoutRules'
import { FakeServer } from './workoutRules.server.testutil'
import {
  addSet,
  deletedAdded,
  dropDraft,
  exerciseIdOf,
  headLog,
  keepType,
  lists,
  loggedAdded,
  orderOf,
  pending,
  SESSION,
  takeIn,
  unloggedAdded,
  viewOf,
} from './workoutRules.testutil'

/** What LOG writes besides the type and the number: the walk varies them so that a draft that loses one is seen. */
export interface LogValues {
  weight: number | null
  reps: number | null
  rir: number | null
}

/** A set added before 044 (no place): its order is its log's time (174), and only a draft holds it while it is unlogged. */
const isOld = (row: Pick<ResolvedRow, 'added' | 'kind' | 'addedPlace'>): boolean => row.added && row.kind !== 'stage' && row.addedPlace === null

export class Session {
  cards: OrderExercise[]
  blocks: OrderSuperset[]
  server: FakeServer
  /** Where every set is, by its row key, card by card: the plan's order, then the order the sets were added in (170). */
  places: Map<string, string[]>
  /** The slot each card is numbered in (183 (a)): a card a swap made shares the slot of the card it replaced. */
  slotOf: Map<string, string>
  /** The row keys of the sets added before 044 (no place), card by card, in the order they were logged (174, 184). */
  old: Map<string, string[]>
  private serial = 0

  constructor(cards: OrderExercise[], blocks: OrderSuperset[] = [], logs: SetLog[] = []) {
    this.cards = cards
    this.blocks = blocks
    this.server = new FakeServer({ logs })
    this.slotOf = new Map(cards.map((c) => [c.key, c.key]))
    const oldLogs = (c: OrderExercise) =>
      logs
        .filter((l) => l.exerciseId === c.exerciseId && l.weekPlanSetId === null && l.parentSetId === null && (l.addedPlace ?? null) === null)
        .sort((a, b) => Date.parse(a.loggedAt) - Date.parse(b.loggedAt) || (a.id < b.id ? -1 : 1))
        .map((l) => addedRowKey(c.key, l.id))
    this.old = new Map(cards.map((c) => [c.key, oldLogs(c)]))
    this.places = new Map(
      cards.map((c) => {
        const heads = c.plannedSets.filter((s) => s.parentWeekPlanSetId === null).sort((a, b) => a.setNumber - b.setNumber)
        const added = [...(c.added ?? [])].sort((a, b) => a.place - b.place)
        return [c.key, [...heads.map((s) => plannedRowKey(s.id)), ...oldLogs(c), ...added.map((a) => addedRowKey(c.key, a.localId))]]
      }),
    )
  }

  /** The same session, to try a step on without touching this one. */
  copy(): Session {
    const other = Object.create(Session.prototype) as Session
    Object.assign(other, {
      cards: this.cards,
      blocks: this.blocks,
      server: this.server.clone(),
      places: new Map([...this.places].map(([k, v]) => [k, [...v]])),
      slotOf: new Map(this.slotOf),
      old: new Map([...this.old].map(([k, v]) => [k, [...v]])),
      serial: this.serial,
      clock: this.clock,
      lastCorrections: [],
    })
    return other
  }

  order() {
    return orderOf(this.cards, this.blocks)
  }

  rows(): ResolvedRow[] {
    return resolveRows(this.order(), this.server.logs, this.server.held())
  }

  view() {
    return viewOf(this.order(), this.server.logs, this.server.held())
  }

  row(key: string): ResolvedRow {
    const found = this.rows().find((r) => r.key === key)
    if (found === undefined) throw new Error(`no row ${key}; the rows are ${this.rows().map((r) => r.key).join(', ')}`)
    return found
  }

  card(key: string): OrderExercise {
    return this.cards.find((c) => c.key === key)!
  }

  /** The cards of a slot, in the order the screen draws them (the sequence's own record, 183 (a)). */
  slotCards(slot: string): string[] {
    return this.cards.filter((c) => this.slotOf.get(c.key) === slot).map((c) => c.key)
  }

  /**
   * ADD SET (and a member's share of ADD ROUND): a new set on the card, Normal, at the place the rule gives it when it is made
   * (`nextAddedPlace` for the card's exercise, DECISIONS 174; 58a calls it the same way). Returns its row key.
   */
  add(cardKey: string, localId = `n${++this.serial}`): string {
    const place = nextAddedPlace(this.order(), this.card(cardKey).exerciseId, this.server.logs)
    this.cards = addSet(this.cards, cardKey, localId, place)
    this.places.get(cardKey)!.push(addedRowKey(cardKey, localId))
    return addedRowKey(cardKey, localId)
  }

  /**
   * LOG on the row `key`, as 58a, 60 and 63 write it: a set stores the number its row shows (SPEC 151) with its type, an
   * added set its place (`row.addedPlace`, DECISIONS 174) and, staged, its `pending_stages` row; a planned set's log leaves
   * the place out, and so does a drop's (177), which stores its head's number and the next stage index. `values` are what the
   * row holds (a draft's, when it is logged again). A set the card doesn't list (a draft after a reload) is taken in first;
   * one added before 044 can't be (no place): its draft goes, and the new log, which has the time it happens (63, 184 (b)),
   * puts it after the card's other sets added before 044. Returns the log.
   */
  log(key: string, values: LogValues = { weight: 50, reps: 10, rir: 2 }, more: Partial<SetLog> = {}): SetLog {
    const row = this.row(key)
    if (row.state !== 'unlogged') throw new Error(`${key} is not open`)
    const base = headLog(row.exerciseKey, 1)
    const id = `walk.${++this.serial}`
    if (row.kind === 'stage') {
      const head = this.row(row.headKey!)
      const headLog_ = this.server.logs.find((l) => l.id === head.logId)
      if (headLog_ === undefined) throw new Error(`${key}: its set is not logged`)
      const taken = this.server.logs.filter((l) => l.parentSetId === headLog_.id).map((l) => l.stageIndex)
      // the number its row shows, its set's (a set whose stored number the draw left after a set only this phone holds, 185 (c),
      // shows another number than it stores)
      const log: SetLog = { ...base, ...values, ...more, id, exerciseId: headLog_.exerciseId, weekPlanSetId: null, parentSetId: headLog_.id, isDropset: true, stageIndex: Math.max(0, ...taken) + 1, setNumber: row.number, stageKind: null, isWarmup: false, loggedAt: more.loggedAt ?? this.now() }
      this.server.insertLog(log)
      return log
    }
    const columns = typeColumns(row.type!)
    const log: SetLog = {
      ...base,
      ...values,
      ...more,
      id,
      exerciseId: row.exerciseId,
      weekPlanSetId: row.weekPlanSetId,
      setNumber: row.number,
      isWarmup: columns.isWarmup,
      stageKind: columns.stageKind,
      loggedAt: more.loggedAt ?? this.now(),
      ...(row.added ? { addedPlace: row.addedPlace } : {}),
    }
    this.server.insertLog(log)
    if (row.added) {
      if (row.type!.kind === 'staged') this.server.upsertChange({ change: pending(log, row.type!.stageKind, row.type!.stageCount), id: null })
      if (isOld(row) && !lists(this.cards, row)) {
        this.cards = dropDraft(this.cards, row)
        // the sequence's own record: the set is now the last of the card's sets added before 044
        const old = this.old.get(row.exerciseKey)!.filter((k) => k !== key)
        const places = this.places.get(row.exerciseKey)!.filter((k) => k !== key)
        const newKey = addedRowKey(row.exerciseKey, id)
        const after = old.length === 0 ? places.findIndex((k) => k.startsWith('added:')) : places.indexOf(old[old.length - 1]) + 1
        places.splice(after < 0 ? places.length : after, 0, newKey)
        this.places.set(row.exerciseKey, places)
        this.old.set(row.exerciseKey, [...old, newKey])
      } else this.cards = loggedAdded(takeIn(this.cards, row), row, log.id)
    }
    return log
  }

  /** SET TYPE on the row `key`: the log patch, the drops that go, the numbers and the change rows; an added set's type kept by the card. */
  retype(key: string, pick: SessionSetChangeType, numbers?: { weight: number; reps: number }): SetTypeChange {
    const view = this.view()
    const row = view.rows.find((r) => r.key === key)!
    const needs = typeChangeNeedsNumbers({ row, pick, session: view })
    const effects = applySetTypeChange({ row, pick, session: view, numbers: needs ? (numbers ?? { weight: 40, reps: 6 }) : undefined })
    this.server.applySetType(effects, row)
    if (row.added && row.kind !== 'stage') this.keep(row, effects.type)
    return effects
  }

  /**
   * The card keeps an added set's type (SET TYPE, a drop deleted on its own): an open set the card doesn't list (a draft after a
   * reload) is taken in first; one added before 044 keeps it in its draft; a logged one the card doesn't list has it in its log.
   */
  private keep(row: ResolvedRow, type: SessionSetChangeType): void {
    if (row.logId !== null && !lists(this.cards, row)) return
    if (isOld(row) && !lists(this.cards, row)) {
      this.cards = this.cards.map((c) => ({
        ...c,
        drafts: (c.drafts ?? []).map((d) => ('localId' in d.key && !('drop' in d.key) && d.key.localId === row.localId ? { key: d.key as AddedSetKey, values: { ...(d.values as { place: null; loggedAt: string }), type } } : d)),
      }))
      return
    }
    this.cards = keepType(takeIn(this.cards, row), row, type)
  }

  /** DELETE on the row `key`: the deletes, the numbers, the kind patch and the change rows; an added set leaves the card's list. */
  delete(key: string): DeleteEffects {
    const view = this.view()
    const row = view.rows.find((r) => r.key === key)!
    const effects = deleteEffects(row, view)
    this.server.applyDelete(effects)
    if (row.kind === 'stage') {
      const head = view.rows.find((r) => r.key === row.headKey)!
      if (head.added) this.keep(head, effects.type!)
    } else {
      if (row.added) this.cards = lists(this.cards, row) ? deletedAdded(this.cards, row) : dropDraft(this.cards, row)
      const places = this.places.get(row.exerciseKey)!
      places.splice(places.indexOf(row.key), 1)
      this.old.set(row.exerciseKey, this.old.get(row.exerciseKey)!.filter((k) => k !== row.key))
    }
    return effects
  }

  canUnlog(key: string): boolean {
    return canUnlog(this.row(key), this.view())
  }

  /**
   * UNLOG on the row `key`: the log deletes and the change rows; an added set's entry names no log and keeps the draft (a set the
   * card doesn't list is taken in first, with its log's id as its own, so it keeps its key; one added before 044 can't be taken
   * in, and its draft alone holds it, with its log's time: 184 (b)).
   */
  unlog(key: string): UnlogEffects {
    const view = this.view()
    const row = view.rows.find((r) => r.key === key)!
    const effects = unlogEffects(row, view)
    this.server.applyUnlog(effects)
    if (isOld(row) && !lists(this.cards, row)) {
      this.cards = this.cards.map((c) => (c.key === row.exerciseKey ? { ...c, drafts: [...(c.drafts ?? []), effects.draft as HeldDraft] } : c))
    } else if (row.added && row.kind !== 'stage') this.cards = unloggedAdded(takeIn(this.cards, row), row, effects.draft as HeldDraft)
    else if (row.kind === 'stage' && this.row(row.headKey!).added) {
      // a drop's draft is the phone's too; the rows don't read it (its set is still logged), but it is kept as the card keeps it
      this.cards = this.cards.map((c) => (c.key === row.exerciseKey ? { ...c, drafts: [...(c.drafts ?? []), effects.draft as HeldDraft] } : c))
    }
    return effects
  }

  /** LOG again on an unlogged row with its draft's numbers (63's re-log). */
  relog(key: string, draft: UnlogEffects['draft']): SetLog {
    const { weight, reps, rir, formRating, enteredUnit } = draft.values
    return this.log(key, { weight, reps, rir }, { formRating, enteredUnit })
  }

  /**
   * A swap for today on the card `fromKey`, as chunk 59 makes it (DECISIONS 164, 179, 183 (a)): its open sets move to the
   * exercise `to` (its logs carry `ex.<to>`) on a card of their own drawn after the cards already in its slot, or on the card an
   * earlier swap from the same card to the same exercise made; today's swap skips them on the old card (a skipped log of a
   * planned set, and of an added one with its place); the new card lists them and keeps the swap's record (`swappedFrom`).
   * Returns the card the sets moved to. A card that holds an open set added before 044 can't be swapped here: the record has
   * no place to name it by (`movedSetEntries` refuses it).
   */
  swap(fromKey: string, to: string): string {
    const open = this.rows().filter((r) => r.exerciseKey === fromKey && r.kind !== 'stage' && r.state === 'unlogged')
    const exerciseId = exerciseIdOf(to)
    const reuse = this.cards.find((c) => c.swappedFrom?.fromKey === fromKey && c.exerciseId === exerciseId)
    const key = reuse?.key ?? `${to}~${++this.serial}`
    const moves = movedSetEntries(this.order(), this.server.logs, { exerciseId, name: to }, open.map((row) => ({ row, localId: `m${++this.serial}` })))
    for (const row of open) {
      const id = `walk.${++this.serial}`
      this.server.insertLog({
        ...headLog(fromKey, 1),
        id,
        exerciseId: row.exerciseId,
        weekPlanSetId: row.weekPlanSetId,
        setNumber: row.number,
        isSkipped: true,
        weight: null,
        reps: null,
        isWarmup: row.kind === 'warmup',
        stageKind: null,
        loggedAt: this.now(),
        ...(row.added ? { addedPlace: row.addedPlace } : {}),
      })
      if (row.added) this.cards = loggedAdded(takeIn(this.cards, row), row, id)
    }
    const places = this.places.get(fromKey)!.filter((k) => !open.some((r) => r.key === k))
    this.places.set(fromKey, places)
    const movedKeys = moves.entries.map((e) => addedRowKey(key, e.localId))
    if (reuse !== undefined) {
      const record = { fromKey, moved: [...reuse.swappedFrom!.moved, ...moves.record.moved] }
      this.cards = this.cards.map((c) => (c.key === key ? { ...c, added: [...(c.added ?? []), ...moves.entries], swappedFrom: record } : c))
      this.places.get(key)!.push(...movedKeys)
    } else {
      const slot = this.slotOf.get(fromKey)!
      const last = Math.max(...this.slotCards(slot).map((k) => this.cards.findIndex((c) => c.key === k)))
      const made: OrderExercise = { key, exerciseId, name: to, plannedSets: [], added: moves.entries, swappedFrom: moves.record }
      this.cards = [...this.cards.slice(0, last + 1), made, ...this.cards.slice(last + 1)]
      this.places.set(key, movedKeys)
      this.slotOf.set(key, slot)
      this.old.set(key, [])
      // a member with a swap leaves its block, as today's screen moves a swapped member out of its round grid
      this.blocks = this.blocks.map((b) => ({ ...b, members: b.members.filter((m) => m !== fromKey) }))
    }
    return key
  }

  /** The card the row `key` is on, as the card keeps it now. */
  cardOf(key: string): OrderExercise {
    return this.cards.find((c) => c.key === this.row(key).exerciseKey)!
  }

  /**
   * What REVIEW (chunk 43's `reviewItems`, the one reader of a set log's number besides the workout) makes of this session
   * next week, were it finished now: the keys of its items for the sets added in the session (`added-set:<session>:
   * <exercise>:<w?><number>`, built from each log's stored number). A set log's number is written here and read there
   * (RULES.md: "a value that one module writes and only another reads is probed through that reader").
   */
  reviewAddedSetKeys(): string[] {
    const plan = (id: string, weekNumber: number) => ({
      id,
      workoutDayId: 'wd',
      weekNumber,
      exercises: this.cards.map((c, i) => ({ id: c.key, exerciseId: c.exerciseId, position: i, exercise: { name: c.name } })),
      sets: this.cards.flatMap((c) => c.plannedSets as unknown as WeekPlanSet[]),
    })
    const groups = reviewItems({
      weekNumber: 2,
      lastWeek: {
        sessions: [{ id: SESSION, weekPlanId: 'wp1', status: 'completed', date: '2026-10-12', setLogs: this.server.logs, sessionSetChanges: this.server.held() }],
        plan: [plan('wp1', 1)],
      },
      thisWeek: [plan('wp2', 2)],
      decisions: [],
    })
    return groups.flatMap((g) => g.items).filter((e) => e.item.kind === 'added_set').map((e) => e.key)
  }

  /**
   * The screen draws the session (58a): it writes 46's corrections (DECISIONS 178, 185), which are returned and kept, each
   * with the number its log held before, in `lastCorrections`.
   */
  draw(): NumberPatch[] {
    const patches = numberCorrections(this.order(), this.server.logs, this.server.held())
    this.lastCorrections = patches.map((p) => ({ ...p, was: this.server.logs.find((l) => l.id === p.id)!.setNumber }))
    this.server.applyCorrections(patches)
    return patches
  }

  /**
   * The session ends and is reopened (CONTINUE SESSION after COMPLETE, TASKS 64), or is opened on another phone: the phone's
   * state for it is gone (G46: the drafts end with the session; the card's list with them), the logs and the change rows stay.
   * An added set with no log is gone; one with a log is drawn from it, keyed by it. Then the screen draws the session, and 58a
   * writes 46's corrections (DECISIONS 178), which are returned.
   */
  reopen(): NumberPatch[] {
    return this.dropPhoneState(false)
  }

  /**
   * The screen reloads before chunk 63 keeps the card's list (or its cache of the list is gone): the list goes, the drafts stay.
   * An added set with neither a log nor a draft is gone. Then the screen draws, and 58a writes the corrections (178).
   */
  reload(): NumberPatch[] {
    return this.dropPhoneState(true)
  }

  private dropPhoneState(keepDrafts: boolean): NumberPatch[] {
    const rows = this.rows()
    const placeOf = new Map<string, number | null>()
    for (const [cardKey, places] of this.places) {
      const next: string[] = []
      for (const key of places) {
        const row = rows.find((r) => r.key === key)!
        const kept = !row.added ? key : row.logId !== null ? addedRowKey(cardKey, row.logId) : keepDrafts && row.draftKey !== null ? key : null
        if (kept === null) continue
        next.push(kept)
        if (row.added) placeOf.set(kept, row.addedPlace)
      }
      this.places.set(cardKey, next)
      this.old.set(cardKey, this.old.get(cardKey)!.filter((k) => next.includes(k)))
    }
    this.followLatestCard(placeOf)
    this.cards = this.cards.map((c) => ({ ...c, added: [], drafts: keepDrafts ? (c.drafts ?? []) : [] }))
    return this.draw()
  }

  /**
   * With no list, a set of an exercise on two cards that no swap's record places can't be told apart by what the server holds
   * (183's follow-up doesn't say which card it is on). The module draws it on the card that was the exercise's latest when it
   * was added (its place says when: the card made by the last swap whose moved places are below it, else the exercise's own
   * card); the sequence's record follows that reading, then keeps each card's sets with a place in place order.
   */
  private followLatestCard(placeOf: Map<string, number | null>): void {
    const groups = new Map<string, OrderExercise[]>()
    for (const c of this.cards) groups.set(c.exerciseId, [...(groups.get(c.exerciseId) ?? []), c])
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const since = group.map((c) => ({ key: c.key, since: c.swappedFrom === undefined ? 0 : Math.min(...c.swappedFrom.moved.map((m) => m.place)) }))
      const latest = (place: number) => since.reduce<{ key: string; since: number } | undefined>((best, x) => (x.since < place && (best === undefined || x.since > best.since) ? x : best), undefined)!.key
      for (const c of group) {
        const keep: string[] = []
        for (const key of this.places.get(c.key)!) {
          const place = placeOf.get(key) ?? null
          const to = place === null || c.swappedFrom?.moved.some((m) => m.place === place) ? c.key : latest(place)
          if (to === c.key) keep.push(key)
          else {
            const moved = addedRowKey(to, key.slice(`added:${c.key}:`.length))
            this.places.get(to)!.push(moved)
            placeOf.set(moved, place)
          }
        }
        this.places.set(c.key, keep)
      }
    }
    for (const [cardKey, places] of this.places) {
      const fixed = places.filter((k) => (placeOf.get(k) ?? null) === null)
      const placed = places.filter((k) => (placeOf.get(k) ?? null) !== null).sort((a, b) => placeOf.get(a)! - placeOf.get(b)!)
      this.places.set(cardKey, [...fixed, ...placed])
    }
  }

  /** The corrections the last draw wrote, each with the number its log held before (178: only where they differ). */
  lastCorrections: Array<NumberPatch & { was: number }> = []

  /** The clock: each write happens a second after the one before (63's re-log writes the time it happens: 184 (b)). */
  private clock = Date.parse('2026-10-12T18:00:00Z')

  private now(): string {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }
}
