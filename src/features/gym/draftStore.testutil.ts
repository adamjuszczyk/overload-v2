// A test stand-in for what the phone keeps for the workout (chunk 63, `sessionDrafts.ts`'s `DraftStore`): the drafts and the card's list in a world the test owns, so a screen
// can be mounted again over the same world, which is a reload. Like Dexie it answers copies, and a write lands on a LATER tick (RULES: a fake that applies a write before its
// first `await` can't tell an awaited write from one that isn't), so a test that reads the world waits for it (`settle`).
import type { AddedLists, DraftStore, StoredDraft } from './sessionDrafts'

export interface DraftWorld {
  drafts: Map<string, StoredDraft>
  lists: AddedLists | null
  /** Every write the phone was asked for, in order. */
  log: string[]
}

export const newDraftWorld = (): DraftWorld => ({ drafts: new Map(), lists: null, log: [] })

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export function fakeDraftStore(world: DraftWorld): DraftStore {
  return {
    load: async () => {
      await tick()
      return { drafts: structuredClone([...world.drafts.values()]), lists: structuredClone(world.lists ?? {}) }
    },
    putDraft: async (draft) => {
      await tick()
      world.log.push(`put ${draft.id}`)
      world.drafts.set(draft.id, structuredClone(draft))
    },
    deleteDrafts: async (ids) => {
      await tick()
      for (const id of ids) {
        world.log.push(`delete ${id}`)
        world.drafts.delete(id)
      }
    },
    saveLists: async (lists) => {
      await tick()
      world.log.push('lists')
      world.lists = structuredClone(lists)
    },
  }
}
