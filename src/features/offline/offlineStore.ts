import { create } from 'zustand'

interface OfflineStore {
  pendingIds: Set<string>
  addPending: (id: string) => void
  removePending: (id: string) => void
}

export const useOfflineStore = create<OfflineStore>((set) => ({
  pendingIds: new Set(),
  addPending: (id) =>
    set((s) => ({ pendingIds: new Set([...s.pendingIds, id]) })),
  removePending: (id) =>
    set((s) => {
      const next = new Set(s.pendingIds)
      next.delete(id)
      return { pendingIds: next }
    }),
}))
