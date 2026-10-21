// Chunk 58a — DECISIONS 178 (Adam, 2026-10-19), 185 (c) and 197 (Adam, 2026-10-20): "the workout screen writes the corrected numbers
// when it draws the session's rows. It writes only where they differ, so drawing the same session again writes nothing. It writes
// only from the workout screen for an in-progress or reopened session, never from History, Plan or any read-only view. Offline,
// the writes queue." What it writes is exactly what chunk 46r's `numberCorrections` lists (which leaves out every log after an
// open added set on its card, 185 (c)): this file adds no rule of its own.
//
// Every correction goes through the sync queue as a `patch` item (`queueSetLogPatch`), online or not, then the queue is sent at once
// when the phone is online: one path, so the offline path is the one that is exercised. A whole-row save of the log (the queue's
// upsert) was checked first (DECISIONS 197) and can't carry it: it would bring back a log another phone deleted and write this
// phone's copy of the weight and reps over another phone's edit (`useSyncQueue.patch.test.ts`).
import { useEffect, useRef } from 'react'
import { queryClient } from '../../lib/queryClient'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { flushSyncQueue, queueSetLogPatch } from '../offline/useSyncQueue'
import type { Session, SetLog } from '../../types'
import type { NumberPatch } from './workoutRules'

/**
 * Writes number patches for logs of one session: each is queued (behind the earlier writes to its log) and, once every one is queued,
 * the queue is sent when `flush` says the phone is online. The screen's own copy of each log changes after its patch is queued, so
 * the next draw lists nothing for it. A patch the queue already holds (`queueSetLogPatch` says so) adds no item, and when none was
 * added the queue is not sent either: the session is read again after every pass, so a draw that lists a correction whose request
 * keeps failing would otherwise send, fail and read again without end (58a's review 1, finding 1). Chunks 61 (a delete's renumber)
 * and 62 (a Warmup switch's) call this too.
 */
export async function patchSetNumbers({
  sessionId,
  patches,
  logs,
  flush,
}: {
  sessionId: string
  patches: readonly NumberPatch[]
  logs: readonly Pick<SetLog, 'id' | 'parentSetId'>[]
  flush: boolean
}): Promise<void> {
  const byId = new Map(logs.map((log) => [log.id, log]))
  let added = 0
  for (const patch of patches) {
    if (await queueSetLogPatch({ id: patch.id, sessionId, parentSetId: byId.get(patch.id)?.parentSetId ?? null }, patch.setNumber)) added += 1
    queryClient.setQueryData(['v2_session', sessionId], (old: Session | undefined) =>
      old ? { ...old, setLogs: old.setLogs?.map((log) => (log.id === patch.id ? { ...log, setNumber: patch.setNumber } : log)) } : old,
    )
  }
  if (flush && added > 0) await flushSyncQueue()
}

export function useSetNumberCorrections({
  sessionId,
  enabled,
  corrections,
  logs,
  busy,
}: {
  sessionId: string
  /** The workout screen of an in-progress session: false for anything else, which writes nothing. */
  enabled: boolean
  corrections: readonly NumberPatch[]
  logs: readonly Pick<SetLog, 'id' | 'parentSetId'>[]
  /** Writes of the screen's own that are still on their way (a delete and its renumber): the corrections wait for them. */
  busy: number
}) {
  const isOnline = useOnlineStatus()
  // The patches on their way (an id and the number it takes): a draw that lists one again meanwhile (a refetch before the queue
  // was sent) doesn't queue it twice.
  const sending = useRef(new Set<string>())
  const signature = corrections.map((patch) => `${patch.id}:${patch.setNumber}`).join(',')

  useEffect(() => {
    if (!enabled || busy > 0 || corrections.length === 0) return
    const fresh = corrections.filter((patch) => !sending.current.has(`${patch.id}:${patch.setNumber}`))
    if (fresh.length === 0) return
    for (const patch of fresh) sending.current.add(`${patch.id}:${patch.setNumber}`)
    patchSetNumbers({ sessionId, patches: fresh, logs, flush: isOnline })
      .catch((err) => console.error('[workout] number correction failed', err))
      .finally(() => {
        for (const patch of fresh) sending.current.delete(`${patch.id}:${patch.setNumber}`)
      })
    // Only what the rows list decides a write: a refetch that lists the same patches again is not a new draw of them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, busy, signature])
}
