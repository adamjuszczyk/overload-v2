import { db } from '../../lib/db'
import type { SyncQueueItem } from '../../lib/db'
import { useOfflineStore } from '../offline/offlineStore'
import { dropQueuedWritesNamingSession } from '../offline/useSyncQueue'

// What this phone's sync queue does once a finished program has been deleted whole (chunk 75; SPEC Screens → Finished program: full delete, "On
// success: drops the queued writes naming each of the run's sessions"; DECISIONS 249 row 22; DECISIONS 272). It lives here and not in
// `useSyncQueue.ts` (chunk 73 is editing that file), and only READS Dexie's `sync_queue` for what it adds; every session's own writes go out through
// that file's `dropQueuedWritesNamingSession`, which is what History's delete of one session calls (queue-fix 230).
//
// Why the queue needs this at all: the delete removed the sessions on the server (their logs, change rows and session analyses by cascade). A queued
// upsert of one of their logs or change rows is refused `23503` for ever, and a queued finish of a session would create it again. Called after the
// request has been answered, never before: a delete that fails drops nothing.
//
// Two things the program's session list read before the delete (from the server) cannot name:
//   - a session of the program that exists only in this queue (started offline on this phone, not yet sent): its `v2_sessions` upsert names the
//     program in `mesocycle_id`, and so would be refused `23503` once the program is gone (pre-read 75-3);
//   - a Coach note queued offline on one of the sessions. `dropQueuedWritesNamingSession` keeps a queued note and only clears its session (the
//     user's own words survive a deleted session: 017, ON DELETE SET NULL), but a full delete takes the program's notes with it (DECISIONS 249 row
//     14), so they leave the queue here, before the sessions' drops would unlink them (DECISIONS 272; pre-read 75-5).

type NoteLike = { id?: unknown; session_id?: unknown } | null

/** The ids of the sessions of this program that exist only in the queue: its queued `v2_sessions` upserts that name the program in `mesocycle_id`. */
export async function queuedSessionIdsOfRun(mesocycleId: string): Promise<string[]> {
  const ids = new Set<string>()
  for (const item of await db.sync_queue.toArray()) {
    if (item.table !== 'v2_sessions' || item.operation !== 'upsert') continue
    const payload = item.payload as { id?: unknown; mesocycle_id?: unknown } | null
    if (payload && payload.mesocycle_id === mesocycleId && typeof payload.id === 'string') ids.add(payload.id)
  }
  return [...ids]
}

const namesOneOf = (item: SyncQueueItem, sessionIds: ReadonlySet<string>) => {
  const note = item.payload as NoteLike
  return item.table === 'v2_coach_notes' && item.operation === 'upsert' && typeof note?.session_id === 'string' && sessionIds.has(note.session_id)
}

/**
 * Removes the queued Coach notes that name one of these sessions. Returns how many left. A note that names any other session, or none, stays.
 * (A pass already running holds its own list of the queue and may still send a note it read: the server then refuses it `23503`, the session being
 * gone, and the item is no longer queued to be tried again.)
 */
export async function dropQueuedCoachNotesNamingSessions(sessionIds: readonly string[]): Promise<number> {
  const ids = new Set(sessionIds)
  const notes = (await db.sync_queue.toArray()).filter((item) => namesOneOf(item, ids))
  const { removePending } = useOfflineStore.getState()
  for (const note of notes) {
    await db.sync_queue.delete(note.id!)
    const id = (note.payload as NoteLike)?.id
    if (typeof id === 'string') removePending(id)
  }
  if (notes.length > 0) {
    // The "couldn't sync" notice is made again from what is left: a note that had given up leaves it with the note.
    const gone = new Set(notes.map((note) => note.id!))
    const { syncFailures, setSyncFailures } = useOfflineStore.getState()
    setSyncFailures(syncFailures.filter((failure) => !gone.has(failure.queueId)))
  }
  return notes.length
}

/**
 * Everything this phone's queue holds for a deleted finished program: the notes queued on its sessions, then each session's own writes. `serverIds`
 * are the sessions read from the server before the delete; the queue adds the ones only it knows. Returns every session id dealt with, for the
 * caches to forget. It never throws: a step the phone's database refuses is logged and the next one still runs, so the delete that was done is
 * never reported as failed (as `useDeleteSession` treats its drop), and a half-done clean-up leaves no more than the delete left before this existed.
 */
export async function dropQueuedWritesOfDeletedRun(mesocycleId: string, serverIds: readonly string[]): Promise<string[]> {
  let queuedOnly: string[] = []
  try {
    queuedOnly = await queuedSessionIdsOfRun(mesocycleId)
  } catch (err) {
    console.error('[sync] could not read the sessions of a deleted program from the queue', err)
  }
  const ids = [...new Set([...serverIds, ...queuedOnly])]
  // The notes first: a session's drop clears the session from a note it finds and keeps the note, and a note with no session is no longer the program's to find.
  await dropQueuedCoachNotesNamingSessions(ids).catch((err) => console.error('[sync] could not drop the queued notes of a deleted program', err))
  for (const id of ids) {
    await dropQueuedWritesNamingSession(id).catch((err) => console.error('[sync] could not drop the queued writes of a deleted program', err))
  }
  return ids
}
