import { useEffect, useState } from 'react'
import { liveQuery } from 'dexie'
import { db } from '../../lib/db'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]: "When the phone has unsent offline changes, it adds: 'Changes you made offline are kept and
// sent then.'"). How many writes this phone still has to send: the length of the sync queue, which holds every write not yet sent, a held one
// (refused `OL001`) and one that gave up included. `liveQuery` re-reads the count whenever the queue changes, so the line comes and goes by
// itself as writes are queued and sent; it never reads anything but the count.
export function useQueuedWriteCount(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    const subscription = liveQuery(() => db.sync_queue.count()).subscribe({
      next: setCount,
      // A count that cannot be read draws no line: the screen never fails over it.
      error: (error: unknown) => console.error('[queue] counting the unsent writes failed', error),
    })
    return () => subscription.unsubscribe()
  }, [])

  return count
}
