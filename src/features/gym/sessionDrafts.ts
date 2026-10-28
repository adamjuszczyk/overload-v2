// Chunk 63 (TASKS-1.2 63; SPEC [1.2] "Unlog (18c)", G46 (a): "The numbers stay in the row as a draft on that phone (Dexie, like warmup ticks) until the set is logged again,
// which writes a new log, or the session ends. Nothing on the server changes shape"; DECISIONS 147 (b), 151, 161, 174, 184 (b)): what the workout keeps on the phone for
// sets that are not logged, and how it keeps it.
//
// Two Dexie tables (`lib/db.ts`, version 3), neither of them ever sent to Supabase or put in the sync queue (`sessionDrafts.static.test.ts` reads the source for it):
//   - `session_set_drafts`: one row per unlogged set (or per unlogged drop of a set): the draft `unlogEffects` (46r) answers, whole, under its union key. The row's id is the
//     session and the set's OWN id (the planned set, or an added set's local id, plus the drop's number for a drop), never the key's `position`: that is the number the row
//     showed when it was unlogged, and a number moves when a set before it is deleted. The key is stored as it was answered.
//   - `session_added_sets`: one row per session: the card's list of the sets added in the session (`OrderExercise.added`, 46r's header "What the card keeps"), so every added
//     set keeps its place and its type across a reload, a never-logged one included (DECISIONS 170: an added set's place is when it was added, which only the card knows).
//     It includes the sets a swap for today moved (`useWorkoutRows.addEntries`), so an open moved set is drawn on the swap's card again after a reload (chunk 59's review).
//
// Both are cleared when the session ends (`clearSessionDrafts`, `useCompleteSession`'s success). A device without IndexedDB, or a table that fails, never stops the workout:
// a read gives nothing and a write is logged, and the screen keeps its drafts in memory for as long as it is open.
import { db } from '../../lib/db'
import type { AddedSet, AddedSetDraft, HeldDraft, SetDraft, SetDraftKey } from './workoutRules'

/** A draft as the phone holds it. `id` is `storedDraftId(key)`. */
export interface StoredDraft {
  id: string
  sessionId: string
  key: SetDraftKey
  values: SetDraft | AddedSetDraft
}

/** The card's list, by card key (`OrderExercise.key`). */
export type AddedLists = Record<string, readonly AddedSet[]>

/** A draft's identity inside its session: the set's own id and, for a drop, its number under the set. Not the key's `position`. */
export function draftIdentity(key: SetDraftKey): string {
  const base = 'weekPlanSetId' in key ? `p:${key.weekPlanSetId}` : `a:${key.localId}`
  return 'drop' in key ? `${base}:d${key.drop}` : base
}

/** The Dexie row id of a draft: its session and `draftIdentity`. */
export const storedDraftId = (key: SetDraftKey): string => `${key.sessionId}|${draftIdentity(key)}`

/** The drafts as the rules read them (`OrderExercise.drafts`). */
export const heldDraftsOf = (drafts: readonly StoredDraft[]): HeldDraft[] => drafts.map((draft) => ({ key: draft.key, values: draft.values }) as HeldDraft)

/** What `useWorkoutRows` reads and writes the phone's copy through. `dexieDraftStore` is the real one; a test hands it a stand-in. */
export interface DraftStore {
  load: () => Promise<{ drafts: StoredDraft[]; lists: AddedLists }>
  putDraft: (draft: StoredDraft) => Promise<void>
  deleteDrafts: (ids: readonly string[]) => Promise<void>
  saveLists: (lists: AddedLists) => Promise<void>
}

// ─── What a stored row must be to be read at all ─────────────────────────────────────────────────
// 46r's rules refuse (RangeError) an added set's draft or list entry without a type and a place, so a damaged row would stop the whole screen from drawing until the
// session ended. A row that cannot be read is left out here, with a warning, and the session goes on without it.

const isWholeFrom1 = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1

function usableType(type: unknown): boolean {
  if (typeof type !== 'object' || type === null) return false
  const t = type as { kind?: unknown; stageKind?: unknown; stageCount?: unknown }
  if (t.kind === 'normal' || t.kind === 'warmup') return true
  return t.kind === 'staged' && typeof t.stageKind === 'string' && typeof t.stageCount === 'number' && Number.isInteger(t.stageCount) && t.stageCount >= 1
}

function usableDraft(draft: StoredDraft): boolean {
  if (typeof draft.id !== 'string' || typeof draft.key !== 'object' || draft.key === null || typeof draft.values !== 'object' || draft.values === null) return false
  if (!('localId' in draft.key) || 'drop' in draft.key) return true // a planned set's, a drop's: the rules ignore them, the box reads the numbers
  const values = draft.values as Partial<AddedSetDraft>
  const place = values.place
  return usableType(values.type) && (place === null || isWholeFrom1(place)) && (place !== null || (typeof values.loggedAt === 'string' && !Number.isNaN(Date.parse(values.loggedAt))))
}

function usableEntry(entry: AddedSet): boolean {
  return typeof entry?.localId === 'string' && (entry.logId === null || typeof entry.logId === 'string') && usableType(entry.type) && isWholeFrom1(entry.place)
}

/** The lists with every entry the rules could not read left out. */
export function usableLists(lists: unknown): AddedLists {
  const out: AddedLists = {}
  if (typeof lists !== 'object' || lists === null) return out
  for (const [cardKey, entries] of Object.entries(lists as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue
    const seen = new Set<string>()
    const kept = (entries as AddedSet[]).filter((entry) => {
      if (!usableEntry(entry) || seen.has(entry.localId)) return false
      seen.add(entry.localId)
      return true
    })
    if (kept.length !== entries.length) console.warn(`[drafts] left out ${entries.length - kept.length} unreadable set(s) of the card ${cardKey}`)
    if (kept.length > 0) out[cardKey] = kept
  }
  return out
}

export function usableDrafts(drafts: readonly StoredDraft[]): StoredDraft[] {
  const kept = drafts.filter(usableDraft)
  if (kept.length !== drafts.length) console.warn(`[drafts] left out ${drafts.length - kept.length} unreadable draft(s)`)
  return kept
}

// ─── Dexie ───────────────────────────────────────────────────────────────────────────────────────

// The tables are looked up when used, so a test that stands in for `lib/db` with the tables it needs leaves the others out without breaking a screen that never reads them.
type Tables = {
  session_set_drafts?: {
    where: (index: string) => { equals: (value: string) => { toArray: () => Promise<Array<{ id: string; sessionId: string; key: unknown; values: unknown }>>; delete: () => Promise<unknown> } }
    put: (row: { id: string; sessionId: string; key: unknown; values: unknown }) => Promise<unknown>
    bulkDelete: (ids: string[]) => Promise<unknown>
  }
  session_added_sets?: {
    get: (sessionId: string) => Promise<{ sessionId: string; lists: unknown } | undefined>
    put: (row: { sessionId: string; lists: unknown }) => Promise<unknown>
    delete: (sessionId: string) => Promise<unknown>
  }
}
const tables = (): Tables => db as unknown as Tables

// A device with no IndexedDB (jsdom, an old private window) has nothing to read or keep: that is not an error worth a line in the console on every draw.
function report(what: string, err: unknown): void {
  if ((err as { name?: string } | null)?.name === 'MissingAPIError') return
  console.error(`[drafts] ${what}`, err)
}

export function dexieDraftStore(sessionId: string): DraftStore {
  return {
    async load() {
      const { session_set_drafts: draftTable, session_added_sets: listTable } = tables()
      if (draftTable === undefined || listTable === undefined) return { drafts: [], lists: {} }
      try {
        const rows = await draftTable.where('sessionId').equals(sessionId).toArray()
        const list = await listTable.get(sessionId)
        const drafts = rows.map((row): StoredDraft => ({ id: row.id, sessionId: row.sessionId, key: row.key as SetDraftKey, values: row.values as SetDraft }))
        return { drafts: usableDrafts(drafts), lists: usableLists(list?.lists) }
      } catch (err) {
        report('could not read the drafts of this session', err)
        return { drafts: [], lists: {} }
      }
    },
    async putDraft(draft) {
      const draftTable = tables().session_set_drafts
      if (draftTable === undefined) return
      try {
        await draftTable.put({ id: draft.id, sessionId: draft.sessionId, key: draft.key, values: draft.values })
      } catch (err) {
        report('could not keep a draft on this phone', err)
      }
    },
    async deleteDrafts(ids) {
      const draftTable = tables().session_set_drafts
      if (draftTable === undefined || ids.length === 0) return
      try {
        await draftTable.bulkDelete([...ids])
      } catch (err) {
        report('could not remove a draft', err)
      }
    },
    async saveLists(lists) {
      const listTable = tables().session_added_sets
      if (listTable === undefined) return
      try {
        await listTable.put({ sessionId, lists })
      } catch (err) {
        report('could not keep the sets added in this session', err)
      }
    },
  }
}

/** The session ended (G46): its drafts and its list of added sets go. Best effort, never throws. */
export async function clearSessionDrafts(sessionId: string): Promise<void> {
  const { session_set_drafts: draftTable, session_added_sets: listTable } = tables()
  try {
    if (draftTable !== undefined) await draftTable.where('sessionId').equals(sessionId).delete()
    if (listTable !== undefined) await listTable.delete(sessionId)
  } catch (err) {
    report('could not clear the drafts of a finished session', err)
  }
}
