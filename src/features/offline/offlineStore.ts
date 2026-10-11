import { create } from 'zustand'

// A queued write that can't sync: one that stopped retrying, or one held
// behind it (same record, or a record it depends on). Still in the queue.
export interface SyncFailure {
  queueId: number
  table: string
  recordId: string | null
  // The session it belongs to (a set log's session, a session row itself, a
  // session-scoped coach note); null for anything else. Decides the screen.
  sessionId: string | null
}

interface OfflineStore {
  pendingIds: Set<string>
  failedIds: Set<string>       // record ids of syncFailures — SetRow's SYNC FAILED marker
  syncFailures: SyncFailure[]
  addPending: (id: string) => void
  removePending: (id: string) => void
  setSyncFailures: (failures: SyncFailure[]) => void
}

export const useOfflineStore = create<OfflineStore>((set) => ({
  pendingIds: new Set(),
  failedIds: new Set(),
  syncFailures: [],
  addPending: (id) =>
    set((s) => ({ pendingIds: new Set([...s.pendingIds, id]) })),
  removePending: (id) =>
    set((s) => {
      const next = new Set(s.pendingIds)
      next.delete(id)
      return { pendingIds: next }
    }),
  setSyncFailures: (failures) =>
    set({
      syncFailures: failures,
      failedIds: new Set(failures.map((f) => f.recordId).filter((id): id is string => id != null)),
    }),
}))
