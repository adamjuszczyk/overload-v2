// Chunk 61 (TASKS-1.2 61; migration 042; SPEC [1.2] "Delete set (18b)", "Offline (G47)"): the workout's reads and writes of
// `v2_session_set_changes`, the rows that say what this session did to a set its log can't say (a planned set deleted, given another type,
// a logged head's pending drops). The rules are `workoutRules.ts`'s: `deleteEffects` returns `ChangeWrite`s (a change and the id of the row it
// replaces, or null), `changeColumns` is the whole row, `typeOfColumns` the one mapping from the columns back to a type. This file only turns
// them into rows and sends them; it decides nothing.
//
//   - READ: the rows come embedded with the session (`fetchSession`: `v2_session_set_changes(*)`), so one request gives the logs and the
//     changes as the database held them at one instant (two requests could show a deleted set as an open row in between).
//   - WRITE, online: one upsert by `id` (`upsertSetChange`); a row that replaces another carries that row's id (042 refuses a second row for a
//     planned set, `23505`, and a kind-only update of a `retyped` row that holds a type, `23514`), and names every type column, so a
//     `retyped` row turned into `deleted` is ONE write that clears its type.
//   - WRITE, offline (G47): the same row as a `sync_queue` upsert (`useSessionSetChanges.ts`), sent later with the queue's other writes.
import { supabase } from '../../lib/supabase'
import type { StageKind } from '../../lib/plannerVocabulary'
import type { SessionSetChangeRecord } from '../../types'
import { changeColumns, typeOfColumns, type ChangeWrite } from './workoutRules'

/** A `v2_session_set_changes` row as PostgREST returns it. */
export interface DbSessionSetChange {
  id: string
  user_id: string
  session_id: string
  kind: string
  week_plan_set_id: string | null
  set_log_id: string | null
  is_warmup?: boolean | null
  stage_kind?: string | null
  stage_count?: number | null
  created_at: string
  updated_at: string
}

/** The table's name, in the one place the screen's writers and the queue's item both read it. */
export const SESSION_SET_CHANGES_TABLE = 'v2_session_set_changes'

/**
 * A stored row as the rules read it. A row that lacks the key its kind needs is left out (042's checks make none). A `retyped` row's type
 * comes from `typeOfColumns`, the same mapping `changeColumns` writes with.
 */
export function toSessionSetChangeRecord(row: DbSessionSetChange): SessionSetChangeRecord | null {
  const base = { id: row.id, userId: row.user_id, sessionId: row.session_id, createdAt: row.created_at, updatedAt: row.updated_at }
  if (row.kind === 'deleted' && row.week_plan_set_id) return { ...base, kind: 'deleted', weekPlanSetId: row.week_plan_set_id }
  if (row.kind === 'retyped' && row.week_plan_set_id) {
    const type = typeOfColumns({ isWarmup: row.is_warmup === true, stageKind: (row.stage_kind ?? null) as StageKind | null, stageCount: row.stage_count ?? 0 })
    return { ...base, kind: 'retyped', weekPlanSetId: row.week_plan_set_id, type }
  }
  if (row.kind === 'pending_stages' && row.set_log_id && row.stage_kind) {
    return { ...base, kind: 'pending_stages', setLogId: row.set_log_id, stageKind: row.stage_kind as StageKind, stageCount: row.stage_count ?? 0 }
  }
  return null
}

/** Every stored row of a session that the rules can read, in the order the embed returned them. */
export const toSessionSetChangeRecords = (rows: readonly DbSessionSetChange[] | null | undefined): SessionSetChangeRecord[] =>
  (rows ?? []).flatMap((row) => {
    const record = toSessionSetChangeRecord(row)
    return record === null ? [] : [record]
  })

export interface ChangeRowContext {
  userId: string
  sessionId: string
  /** The time of the write, ISO: `updated_at`, and `created_at` of a row that is new. */
  now: string
}

/**
 * The row to write for one change: every column the kind touches (`changeColumns`), so a `deleted` row clears the warmup flag, the stage
 * kind and the count in the same statement. The id is the stored row's when the write replaces one, else a new one; `created_at` is named
 * only for a row that is new (an upsert writes the columns its payload names, and an existing row keeps its own).
 */
export function changeRow(write: ChangeWrite, ctx: ChangeRowContext, newId: () => string = () => crypto.randomUUID()): Record<string, unknown> {
  const columns = changeColumns(write.change)
  return {
    id: write.id ?? newId(),
    user_id: ctx.userId,
    session_id: ctx.sessionId,
    kind: columns.kind,
    week_plan_set_id: columns.weekPlanSetId,
    set_log_id: columns.setLogId,
    is_warmup: columns.isWarmup,
    stage_kind: columns.stageKind,
    stage_count: columns.stageCount,
    updated_at: ctx.now,
    ...(write.id === null ? { created_at: ctx.now } : {}),
  }
}

/** Online: the row, as one upsert by id. Throws what the server says. */
export async function upsertSetChange(row: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('v2_session_set_changes').upsert(row)
  if (error) throw error
}
