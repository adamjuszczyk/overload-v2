// Chunk 61 (TASKS-1.2 61): what the workout screen does with the session's change rows (`sessionSetChangesService.ts`): read them with the
// session, hold a write's result in the session's cache at once, write them online or through the sync queue. Plain functions over the
// app's own `queryClient`, as `patchSetNumbers` is: nothing here mounts a hook, so a screen that never deletes a set pays nothing for it.
import { queryClient } from '../../lib/queryClient'
import { db } from '../../lib/db'
import { flushSyncQueue } from '../offline/useSyncQueue'
import type { Session, SessionSetChangeRecord } from '../../types'
import { SESSION_SET_CHANGES_TABLE, changeRow, toSessionSetChangeRecord, upsertSetChange, type DbSessionSetChange } from './sessionSetChangesService'
import type { ChangeWrite, HeldChange } from './workoutRules'

const NONE: readonly HeldChange[] = Object.freeze([])

/** The session's stored change rows as the rules read them (`HeldChange`: the change with its row's id). One list for as long as the session holds it. */
export const changesOf = (session: Pick<Session, 'setChanges'> | undefined): readonly HeldChange[] => session?.setChanges ?? NONE

const sameRow = (a: SessionSetChangeRecord, b: SessionSetChangeRecord): boolean => {
  if (a.id === b.id) return true
  // One change row per planned set per session (`deleted` or `retyped`), one `pending_stages` row per log: 042's partial unique indexes.
  if (a.kind === 'pending_stages' || b.kind === 'pending_stages') return a.kind === 'pending_stages' && b.kind === 'pending_stages' && a.setLogId === b.setLogId
  return a.weekPlanSetId === b.weekPlanSetId
}

/** The session with `records` held in place of the rows they replace. */
export function withChangeRecords(session: Session | undefined, records: readonly SessionSetChangeRecord[]): Session | undefined {
  if (!session) return session
  const kept = (session.setChanges ?? []).filter((existing) => !records.some((record) => sameRow(existing, record)))
  return { ...session, setChanges: [...kept, ...records] }
}

/**
 * Offline (G47): the same row, as the upsert the sync queue sends with the rest. The queue upserts by `id` and writes the columns the
 * payload names, so a row that replaces another carries that row's id (`changeRow`). It names its session in its payload, which is how the
 * finish waits for it (`hasQueuedWritesFor`) and the "couldn't sync" notice finds it.
 */
export async function queueSetChange(row: Record<string, unknown>, createdAt: string): Promise<void> {
  await db.sync_queue.add({ table: SESSION_SET_CHANGES_TABLE, operation: 'upsert', payload: row, createdAt })
}

/**
 * Writes the changes `deleteEffects` (or, from 62, `applySetTypeChange`) returns, in their order, one row each: online as an awaited
 * upsert (the first refusal stops the rest and is thrown), offline as a queued upsert (G47). Each row is in the session's cache as soon as
 * it is written or queued, so the screen shows it without waiting for a read; online the session is read again once they are all sent.
 */
export async function writeSetChanges({
  sessionId,
  userId,
  writes,
  online,
  now = () => new Date().toISOString(),
}: {
  sessionId: string
  userId: string
  writes: readonly ChangeWrite[]
  online: boolean
  now?: () => string
}): Promise<void> {
  for (const write of writes) {
    const at = now()
    const row = changeRow(write, { userId, sessionId, now: at })
    if (online) await upsertSetChange(row)
    else await queueSetChange(row, at)
    await holdInCache(sessionId, row, at)
  }
  if (online && writes.length > 0) void queryClient.invalidateQueries({ queryKey: ['v2_session', sessionId] })
}

/** The written row, in the session's cache from now on. A read of the session that left before the row was written would bring the session back
 *  without it: it is stopped first, as `useUpdateSetLog` stops it before its own optimistic write. */
async function holdInCache(sessionId: string, row: Record<string, unknown>, at: string): Promise<void> {
  const record = toSessionSetChangeRecord({ created_at: at, ...row } as unknown as DbSessionSetChange)
  if (record === null) return
  await queryClient.cancelQueries({ queryKey: ['v2_session', sessionId] })
  queryClient.setQueryData(['v2_session', sessionId], (old: Session | undefined) => withChangeRecords(old, [record]))
}

/**
 * Chunk 62 (SPEC 19; DECISIONS 161; TASKS 62: "online and through the queue"): the same rows as `writeSetChanges`, always as queued upserts, then the queue is
 * sent when the phone is online. It is the `pending_stages` row of a set added in the session (or moved by a swap) and logged as a staged head: LOG
 * does not wait for its answer and has nowhere to show a refusal, so the row goes where a failure is retried (five passes, then the "couldn't sync" notice)
 * instead of being lost, and it follows the log's own upsert in the queue. The rows are in the session's cache as soon as they are queued.
 */
export async function queueSetChanges({
  sessionId,
  userId,
  writes,
  flush,
  now = () => new Date().toISOString(),
}: {
  sessionId: string
  userId: string
  writes: readonly ChangeWrite[]
  flush: boolean
  now?: () => string
}): Promise<void> {
  for (const write of writes) {
    const at = now()
    const row = changeRow(write, { userId, sessionId, now: at })
    await queueSetChange(row, at)
    await holdInCache(sessionId, row, at)
  }
  if (flush && writes.length > 0) await flushSyncQueue()
}
