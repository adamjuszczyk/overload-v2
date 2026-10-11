import { useEffect, useRef } from 'react'
import { db } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useOfflineStore } from './offlineStore'
import { deriveCompletedAt, shouldClassifyAsSkipped } from '../gym/sessionCompletion'

export function useSyncQueueInit() {
  const addPending = useOfflineStore((s) => s.addPending)

  useEffect(() => {
    db.sync_queue.toArray().then((items) => {
      for (const item of items) {
        const payload = item.payload as { id?: string }
        if (payload?.id) addPending(payload.id)
      }
    })
  }, []) // run once on mount
}

const MAX_SYNC_ATTEMPTS = 3

export function useSyncQueueRunner() {
  const isOnline = useOnlineStatus()
  // null, not isOnline — "not yet observed", distinct from a real online/
  // offline reading. Found by adversarial review: seeding this from
  // isOnline itself meant a cold start that begins already online (the PWA
  // was closed while offline at the gym, then reopened later at home
  // already on WiFi) never registers as a false->true transition, since
  // both isOnline and prevOnline.current are true on that very first
  // render — flushSyncQueue never ran, silently stranding anything queued
  // offline (e.g. this session's own completed_at fix for an
  // offline-completed session) in db.sync_queue indefinitely. Seeding to
  // null makes the first render flush whenever the app happens to already
  // be online at mount, in addition to the genuine offline->online
  // transition case this already handled.
  const prevOnline = useRef<boolean | null>(null)

  useEffect(() => {
    if (isOnline && !prevOnline.current) {
      flushSyncQueue().catch((err) => console.error('[sync] flush failed', err))
    }
    prevOnline.current = isOnline
  }, [isOnline])
}

// B3: a finish queued offline guessed its status and completed_at from the
// logs this device could see. Every set queued before it has been sent by the
// time it is replayed (FIFO), so the server's logs are the full list: derive
// both again from them, the same way the online finish does. A failed read
// throws, which counts as a failed attempt like any other, never a guess.
async function withFinishDerivedFromServer(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('v2_set_logs')
    .select('logged_at, is_skipped')
    .eq('session_id', payload.id as string)
  if (error) throw error
  const logs = (data ?? []) as Array<{ logged_at: string; is_skipped: boolean }>
  return {
    ...payload,
    status: shouldClassifyAsSkipped(logs.map((l) => ({ isSkipped: l.is_skipped }))) ? 'skipped' : 'completed',
    completed_at: deriveCompletedAt(logs.map((l) => ({ loggedAt: l.logged_at }))),
  }
}

async function flushOnce() {
  const { removePending, addFailed } = useOfflineStore.getState()
  const items = await db.sync_queue.orderBy('createdAt').toArray()
  for (const item of items) {
    const payload = item.payload as { id?: string }
    try {
      if (item.operation === 'upsert') {
        const { error } = await supabase
          .from(item.table)
          .upsert(
            item.recomputeFinish
              ? await withFinishDerivedFromServer(item.payload as Record<string, unknown>)
              : (item.payload as Record<string, unknown>),
          )
        if (error) throw error
      }
      await db.sync_queue.delete(item.id!)
      if (payload?.id) removePending(payload.id)
    } catch (err) {
      const attempts = (item.attempts ?? 0) + 1
      if (attempts >= MAX_SYNC_ATTEMPTS) {
        // Dead-letter: stop retrying and surface the failure instead of
        // silently spinning forever on an item that will never sync.
        console.error('[sync] giving up on item after', attempts, 'attempts', item.id, err)
        await db.sync_queue.delete(item.id!)
        if (payload?.id) {
          removePending(payload.id)
          addFailed(payload.id)
        }
      } else {
        await db.sync_queue.update(item.id!, { attempts })
        console.error('[sync] attempt', attempts, 'failed for item', item.id, err)
      }
    }
  }

  // Refresh session data so UI reflects the synced logs
  queryClient.invalidateQueries({ queryKey: ['v2_session'] })
}

// B3: only one flush runs at a time. A flush reads the queue, then deletes
// each item after its upsert; a second flush started in that window read the
// same items and replayed them, so an old write (a session's in_progress
// upsert) could land after the newer one (its completion). A call made while
// one runs does not start a second: it asks for one more pass after the
// current one (items queued meanwhile) and shares the running promise, so
// awaiting it still means "the queue as it was when I called is sent".
let inFlight: Promise<void> | null = null
let passRequested = false

export function flushSyncQueue(): Promise<void> {
  if (inFlight) {
    passRequested = true
    return inFlight
  }
  inFlight = (async () => {
    try {
      do {
        passRequested = false
        await flushOnce()
      } while (passRequested)
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

// B3: true while the queue still holds a write for this session (one of its
// set logs, or the session row itself). A finish uses it after flushing: any
// left means the server doesn't have the session's full logs yet.
export async function hasQueuedWritesFor(sessionId: string): Promise<boolean> {
  const items = await db.sync_queue.toArray()
  return items.some((item) => {
    const payload = item.payload as { id?: string; session_id?: string } | null
    return payload?.session_id === sessionId || (item.table === 'v2_sessions' && payload?.id === sessionId)
  })
}
