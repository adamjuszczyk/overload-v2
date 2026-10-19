// A stand-in for the two tables the workout rules write to (`v2_set_logs` and `v2_session_set_changes`),
// so a test can APPLY what a rule returns and then read the session the way the screen will (RULES.md: "A
// write path's output is proven through the reader that draws it"). It models what the real tables refuse,
// not just what they accept, because a rule that returns a payload the table would refuse is wrong (RULES.md:
// "A test's stand-in executor mirrors the tables' cascades and set-nulls too"):
//   - v2_set_logs: the client deletes a head's drops first (the cascade guard of `setGroupLogic.ts`: a failure
//     partway must leave a head with fewer drops, never orphans), so a head deleted before its drops is refused
//     here although the real foreign key cascades (010); deleting a log takes the `pending_stages` row keyed by
//     it (on delete cascade);
//   - v2_session_set_changes (042): the checks (kind, keys, deleted carries no type, a warmup is never staged,
//     a stage kind comes with its count) and the two partial unique indexes: one row per planned set per
//     session, one per log. An upsert works on the row's own id: the same planned set under a new id is
//     refused (23505), exactly as the table does.
//   - v2_set_logs also keeps 035's check (`v2_set_logs_check`: `is_skipped or is_warmup or (weight is not null and reps is
//     not null)`), which the first version of this stand-in left out: a warmup may be logged with no weight and no reps,
//     and a patch that makes it a working set without bringing both is refused 23514 (DECISIONS 152).
// Nothing here decides anything a rule decides: every expectation in a test is written out by hand.

import type { SetLog } from '../../types'
import {
  changeColumns,
  typeOfColumns,
  type ChangeColumns,
  type ChangeWrite,
  type DeleteEffects,
  type HeldChange,
  type NumberPatch,
  type ResolvedRow,
  type SetTypeChange,
  type UnlogEffects,
} from './workoutRules'

export class PgError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(`${code} ${message}`)
    this.code = code
  }
}

/** A stored row of `v2_session_set_changes`: every column the rules touch, and its id. */
export interface StoredChange extends ChangeColumns {
  id: string
}

/** 035's check on one set log: a working set has a weight and reps; a warmup or a skipped set may have none. */
function checkLog(log: Pick<SetLog, 'id' | 'isSkipped' | 'isWarmup' | 'weight' | 'reps'>): void {
  if (!(log.isSkipped || log.isWarmup || (log.weight !== null && log.reps !== null))) {
    throw new PgError('23514', `violates check constraint "v2_set_logs_check" (log ${log.id})`)
  }
}

/** 042's checks on one row. */
function checkRow(row: ChangeColumns): void {
  const keys =
    ((row.kind === 'deleted' || row.kind === 'retyped') && row.weekPlanSetId !== null && row.setLogId === null) ||
    (row.kind === 'pending_stages' && row.setLogId !== null && row.weekPlanSetId === null)
  if (!keys) throw new PgError('23514', 'violates check constraint "v2_session_set_changes_keys_check"')
  if (row.kind === 'deleted' && (row.isWarmup || row.stageKind !== null || row.stageCount !== 0)) {
    throw new PgError('23514', 'violates check constraint "v2_session_set_changes_deleted_check"')
  }
  if (row.isWarmup && row.stageKind !== null) throw new PgError('23514', 'violates check constraint "v2_session_set_changes_warmup_check"')
  if ((row.stageKind !== null) !== (row.stageCount > 0)) throw new PgError('23514', 'violates check constraint "v2_session_set_changes_stage_pair_check"')
  if (row.stageCount < 0) throw new PgError('23514', 'violates check constraint "v2_session_set_changes_stage_count_check"')
}

export class FakeServer {
  logs: SetLog[]
  rows: StoredChange[] = []
  private made = 0

  constructor(init: { logs: SetLog[]; changes?: HeldChange[] }) {
    this.logs = init.logs.map((log) => ({ ...log }))
    for (const log of this.logs) checkLog(log)
    for (const change of init.changes ?? []) this.rows.push({ ...changeColumns(change), id: change.id })
  }

  /** A copy of the tables, which goes on making new row ids where this one would (a copy that started again from 1 would reuse them). */
  clone(): FakeServer {
    const copy = new FakeServer({ logs: this.logs, changes: this.held() })
    copy.made = this.made
    return copy
  }

  /** The change rows as the app reads them back: the union of chunk 36 with each row's id. */
  held(): HeldChange[] {
    return this.rows.map((r): HeldChange => {
      switch (r.kind) {
        case 'deleted':
          return { kind: 'deleted', weekPlanSetId: r.weekPlanSetId!, id: r.id }
        case 'retyped':
          return { kind: 'retyped', weekPlanSetId: r.weekPlanSetId!, type: typeOfColumns(r), id: r.id }
        case 'pending_stages':
          return { kind: 'pending_stages', setLogId: r.setLogId!, stageKind: r.stageKind!, stageCount: r.stageCount, id: r.id }
      }
    })
  }

  /** An insert of one log, as LOG writes it: 035's check, a unique id, a drop's head already there. */
  insertLog(log: SetLog): void {
    checkLog(log)
    if (this.logs.some((l) => l.id === log.id)) throw new PgError('23505', `duplicate key value violates unique constraint "v2_set_logs_pkey" (${log.id})`)
    if (log.parentSetId !== null && !this.logs.some((l) => l.id === log.parentSetId)) throw new PgError('23503', `log ${log.id} names no head ${log.parentSetId}`)
    this.logs.push({ ...log })
  }

  deleteLog(id: string): void {
    if (!this.logs.some((l) => l.id === id)) throw new PgError('P0002', `no log ${id}`)
    if (this.logs.some((l) => l.parentSetId === id)) throw new PgError('23503', `log ${id} is deleted before its drops`)
    this.logs = this.logs.filter((l) => l.id !== id)
    this.rows = this.rows.filter((r) => r.setLogId !== id)
  }

  patchLog(id: string, patch: Partial<Pick<SetLog, 'setNumber' | 'isWarmup' | 'stageKind' | 'weight' | 'reps'>>): void {
    const current = this.logs.find((l) => l.id === id)
    if (!current) throw new PgError('P0002', `no log ${id}`)
    const next = { ...current, ...patch }
    checkLog(next)
    this.logs = this.logs.map((l) => (l.id === id ? next : l))
  }

  /** An upsert by id, as the sync queue sends it: the whole row, on the row's own id or a new one. */
  upsertChange(write: ChangeWrite): StoredChange {
    const id = write.id ?? `chg.new.${++this.made}`
    return this.put({ ...changeColumns(write.change), id })
  }

  /** A partial update of one row by id (PostgREST `update … where id`): only the columns named change. */
  updateChange(id: string, patch: Partial<ChangeColumns>): StoredChange {
    const current = this.rows.find((r) => r.id === id)
    if (!current) throw new PgError('P0002', `no change ${id}`)
    return this.put({ ...current, ...patch })
  }

  private put(row: StoredChange): StoredChange {
    checkRow(row)
    if (row.setLogId !== null && !this.logs.some((l) => l.id === row.setLogId)) throw new PgError('23503', `change names no log ${row.setLogId}`)
    const clash = this.rows.find(
      (r) => r.id !== row.id && ((row.weekPlanSetId !== null && r.weekPlanSetId === row.weekPlanSetId) || (row.setLogId !== null && r.setLogId === row.setLogId)),
    )
    if (clash) throw new PgError('23505', 'duplicate key value violates a unique index on (session_id, week_plan_set_id) or (session_id, set_log_id)')
    const at = this.rows.findIndex((r) => r.id === row.id)
    if (at >= 0) this.rows[at] = row
    else this.rows.push(row)
    return row
  }

  private renumber(patches: readonly NumberPatch[]): void {
    for (const p of patches) this.patchLog(p.id, { setNumber: p.setNumber })
  }

  /** What chunk 61 writes for DELETE: the log deletes in order, the numbers, the kind patch and the change rows. */
  applyDelete(effects: DeleteEffects): void {
    for (const log of effects.deleteOrder) this.deleteLog(log.id)
    this.renumber(effects.renumber)
    if (effects.headPatch) this.patchLog(effects.headPatch.id, { stageKind: effects.headPatch.stageKind })
    for (const write of effects.changes) this.upsertChange(write)
  }

  /** What chunk 62 writes for a type change on `row`: the head's log, the drops that go, the numbers and the change rows. */
  applySetType(effects: SetTypeChange, row: Pick<ResolvedRow, 'logId'>): void {
    if (effects.headPatch) {
      if (row.logId === null) throw new Error('a head patch needs the row\'s log')
      this.patchLog(row.logId, effects.headPatch)
    }
    for (const stage of effects.stagesToDelete) this.deleteLog(stage.id)
    this.renumber(effects.renumber)
    for (const write of effects.changes) this.upsertChange(write)
  }

  /** What chunk 63 writes for UNLOG: the log deletes in order and the change rows (the draft is the phone's). */
  applyUnlog(effects: UnlogEffects): void {
    for (const log of effects.deleteOrder) this.deleteLog(log.id)
    for (const write of effects.changes) this.upsertChange(write)
  }
}

