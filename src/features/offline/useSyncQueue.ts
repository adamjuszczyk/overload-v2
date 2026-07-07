import { useEffect, useRef } from 'react'
import { db } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useOfflineStore } from './offlineStore'

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
  const removePending = useOfflineStore((s) => s.removePending)
  const addFailed = useOfflineStore((s) => s.addFailed)
  const prevOnline = useRef(isOnline)

  useEffect(() => {
    if (isOnline && !prevOnline.current) {
      flushSyncQueue(removePending, addFailed)
    }
    prevOnline.current = isOnline
  }, [isOnline, removePending, addFailed])
}

async function flushSyncQueue(
  removePending: (id: string) => void,
  addFailed: (id: string) => void,
) {
  const items = await db.sync_queue.orderBy('createdAt').toArray()
  for (const item of items) {
    const payload = item.payload as { id?: string }
    try {
      if (item.operation === 'upsert') {
        const { error } = await supabase
          .from(item.table)
          .upsert(item.payload as Record<string, unknown>)
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
