import { create } from 'zustand'

interface OfflineStore {
  pendingIds: Set<string>
  failedIds: Set<string>       // gave up after repeated sync failures — surfaced to user
  addPending: (id: string) => void
  removePending: (id: string) => void
  addFailed: (id: string) => void
}

export const useOfflineStore = create<OfflineStore>((set) => ({
  pendingIds: new Set(),
  failedIds: new Set(),
  addPending: (id) =>
    set((s) => ({ pendingIds: new Set([...s.pendingIds, id]) })),
  removePending: (id) =>
    set((s) => {
      const next = new Set(s.pendingIds)
      next.delete(id)
      return { pendingIds: next }
    }),
  addFailed: (id) =>
    set((s) => ({ failedIds: new Set([...s.failedIds, id]) })),
}))
