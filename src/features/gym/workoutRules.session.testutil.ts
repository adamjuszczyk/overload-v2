// A workout session driven the way chunks 58a to 64 will drive the rules (DECISIONS 170's sequence test, and the fixed cases
// beside it): every step asks the module, writes its answer to the stand-in for the tables (`FakeServer`: 035's and 042's
// checks, the unique indexes, the drops-first foreign key) and does to the card's own state what the card does with it
// (workoutRules.ts' header, "What the card keeps for the sets added in the session"). Beside that it keeps its own record of
// where every set is, which the module never sees: the plan's sets in their planned order, then the added sets in the order
// they were added, a deleted one taken out. Nothing here decides what a rule decides.

import type { SessionSetChangeType, SetLog } from '../../types'
import {
  applySetTypeChange,
  canUnlog,
  deleteEffects,
  plannedRowKey,
  addedRowKey,
  resolveRows,
  typeChangeNeedsNumbers,
  typeColumns,
  unlogEffects,
  type DeleteEffects,
  type HeldDraft,
  type OrderExercise,
  type OrderSuperset,
  type ResolvedRow,
  type SetTypeChange,
  type UnlogEffects,
} from './workoutRules'
import { FakeServer } from './workoutRules.server.testutil'
import { addSet, deletedAdded, exerciseIdOf, headLog, keepType, loggedAdded, orderOf, pending, unloggedAdded, viewOf } from './workoutRules.testutil'

/** What LOG writes besides the type and the number: the walk varies them so that a draft that loses one is seen. */
export interface LogValues {
  weight: number | null
  reps: number | null
  rir: number | null
}

export class Session {
  cards: OrderExercise[]
  readonly blocks: OrderSuperset[]
  server: FakeServer
  /** Where every set is, by its row key, card by card: the plan's order, then the order the sets were added in (170). */
  places: Map<string, string[]>
  private serial = 0

  constructor(cards: OrderExercise[], blocks: OrderSuperset[] = [], logs: SetLog[] = []) {
    this.cards = cards
    this.blocks = blocks
    this.server = new FakeServer({ logs })
    this.places = new Map(
      cards.map((c) => {
        const heads = c.plannedSets.filter((s) => s.parentWeekPlanSetId === null).sort((a, b) => a.setNumber - b.setNumber)
        return [c.key, [...heads.map((s) => plannedRowKey(s.id)), ...(c.added ?? []).map((a) => addedRowKey(c.key, a.localId))]]
      }),
    )
  }

  /** The same session, to try a step on without touching this one. */
  copy(): Session {
    const other = Object.create(Session.prototype) as Session
    Object.assign(other, { cards: this.cards, blocks: this.blocks, server: this.server.clone(), places: new Map([...this.places].map(([k, v]) => [k, [...v]])), serial: this.serial })
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

  /** ADD SET (and a member's share of ADD ROUND): a new set at the end of the card, Normal. Returns its row key. */
  add(cardKey: string, localId = `n${++this.serial}`): string {
    this.cards = addSet(this.cards, cardKey, localId)
    this.places.get(cardKey)!.push(addedRowKey(cardKey, localId))
    return addedRowKey(cardKey, localId)
  }

  /**
   * LOG on the row `key`, as 58a, 60 and 63 write it: a set stores the number its row shows (SPEC 151) with its type, an
   * added staged set its `pending_stages` row; a drop its head's number and the next stage index. `values` are what the row
   * holds (a draft's, when it is logged again). Returns the log.
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
      const log: SetLog = { ...base, ...values, ...more, id, exerciseId: headLog_.exerciseId, weekPlanSetId: null, parentSetId: headLog_.id, isDropset: true, stageIndex: Math.max(0, ...taken) + 1, setNumber: headLog_.setNumber, stageKind: null, isWarmup: false }
      this.server.insertLog(log)
      return log
    }
    const columns = typeColumns(row.type!)
    const log: SetLog = { ...base, ...values, ...more, id, exerciseId: exerciseIdOf(row.exerciseKey), weekPlanSetId: row.weekPlanSetId, setNumber: row.number, isWarmup: columns.isWarmup, stageKind: columns.stageKind }
    this.server.insertLog(log)
    if (row.added) {
      if (row.type!.kind === 'staged') this.server.upsertChange({ change: pending(log, row.type!.stageKind, row.type!.stageCount), id: null })
      this.cards = loggedAdded(this.cards, row, log.id)
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
    if (row.added) this.cards = keepType(this.cards, row, effects.type)
    return effects
  }

  /** DELETE on the row `key`: the deletes, the numbers, the kind patch and the change rows; an added set leaves the card's list. */
  delete(key: string): DeleteEffects {
    const view = this.view()
    const row = view.rows.find((r) => r.key === key)!
    const effects = deleteEffects(row, view)
    this.server.applyDelete(effects)
    if (row.kind === 'stage') {
      const head = view.rows.find((r) => r.key === row.headKey)!
      if (head.added) this.cards = keepType(this.cards, head, effects.type!)
    } else {
      if (row.added) this.cards = deletedAdded(this.cards, row)
      const places = this.places.get(row.exerciseKey)!
      places.splice(places.indexOf(row.key), 1)
    }
    return effects
  }

  canUnlog(key: string): boolean {
    return canUnlog(this.row(key), this.view())
  }

  /** UNLOG on the row `key`: the log deletes and the change rows; an added set's entry names no log and keeps the draft. */
  unlog(key: string): UnlogEffects {
    const view = this.view()
    const row = view.rows.find((r) => r.key === key)!
    const effects = unlogEffects(row, view)
    this.server.applyUnlog(effects)
    if (row.added && row.kind !== 'stage') this.cards = unloggedAdded(this.cards, row, effects.draft as HeldDraft)
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

  /** The card the row `key` is on, as the card keeps it now. */
  cardOf(key: string): OrderExercise {
    return this.cards.find((c) => c.key === this.row(key).exerciseKey)!
  }
}
