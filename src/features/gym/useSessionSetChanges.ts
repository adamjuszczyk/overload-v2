// Chunk 61 (TASKS-1.2 61): what the workout screen does with the session's change rows (`sessionSetChangesService.ts`): read them with the
// session, hold a write's result in the session's cache at once, write them online or through the sync queue. Plain functions over the
// app's own `queryClient`, as `patchSetNumbers` is: nothing here mounts a hook, so a screen that never deletes a set pays nothing for it.
import { queryClient } from '../../lib/queryClient'
import { db } from '../../lib/db'
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
    const record = toSessionSetChangeRecord({ created_at: at, ...row } as unknown as DbSessionSetChange)
    if (record !== null) {
      // A read of the session that left before this row was written would bring back the session without it: it is stopped first, as
      // `useUpdateSetLog` stops it before its own optimistic write.
      await queryClient.cancelQueries({ queryKey: ['v2_session', sessionId] })
      queryClient.setQueryData(['v2_session', sessionId], (old: Session | undefined) => withChangeRecords(old, [record]))
    }
  }
  if (online && writes.length > 0) void queryClient.invalidateQueries({ queryKey: ['v2_session', sessionId] })
}
