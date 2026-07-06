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

export function useSyncQueueRunner() {
  const isOnline = useOnlineStatus()
  const removePending = useOfflineStore((s) => s.removePending)
  const prevOnline = useRef(isOnline)

  useEffect(() => {
    if (isOnline && !prevOnline.current) {
      flushSyncQueue(removePending)
    }
    prevOnline.current = isOnline
  }, [isOnline, removePending])
}

async function flushSyncQueue(removePending: (id: string) => void) {
  const items = await db.sync_queue.orderBy('createdAt').toArray()
  for (const item of items) {
    try {
      if (item.operation === 'upsert') {
        const { error } = await supabase
          .from(item.table)
          .upsert(item.payload as Record<string, unknown>)
        if (error) throw error
      }
      await db.sync_queue.delete(item.id!)
      const payload = item.payload as { id?: string }
      if (payload?.id) removePending(payload.id)
    } catch (err) {
      console.error('[sync] failed for item', item.id, err)
    }
  }

  // Refresh session data so UI reflects the synced logs
  queryClient.invalidateQueries({ queryKey: ['v2_session'] })
}
