export * from '@app/features/gym/sessionDrafts'
import type { DraftStore, StoredDraft, AddedLists } from '@app/features/gym/sessionDrafts'
// Drafts kept in memory, not in IndexedDB.
const drafts = new Map<string, StoredDraft>()
let lists: AddedLists = {}
export function dexieDraftStore(_sessionId: string): DraftStore {
  return {
    load: async () => ({ drafts: [...drafts.values()], lists }),
    putDraft: async (d) => { drafts.set((d as any).id, d) },
    deleteDrafts: async (ids) => { ids.forEach((id) => drafts.delete(id)) },
    saveLists: async (l) => { lists = l },
  }
}
export function resetDrafts() { drafts.clear(); lists = {} }
