// Chunk 58a — the workout screen's one picture of its rows (TASKS-1.2 58a; chunk 46r's `workoutRules.ts`, "How the screens call it").
// GymSession hands this hook the cards it draws, in order, and the session's logs; it returns what every card draws
// (`resolveRows`), the current set, and the writers of the card's own state: the sets added in the session (`OrderExercise.added`:
// DECISIONS 170, 161, 174), each with the place `nextAddedPlace` gave it once, when it was made. The list lives here, once for the
// session, because the rules number a set over its slot, and the current set is the first unlogged one over every card.
// Nothing here writes to the server: `useSetNumberCorrections.ts` writes the corrected numbers, the cards write the logs.
// Chunk 63 (G46 (a), TASKS-1.2 63): the list and the session's drafts (the numbers of the sets that were unlogged) are also kept on the phone (Dexie, through a
// `DraftStore`, `sessionDrafts.ts`) and read back when the screen mounts, so an unlogged or never-logged added set, a swap's moved sets and a draft all survive a reload.
// The screen draws at once, without waiting for IndexedDB; what the phone held is merged in when it arrives (`hydrated`), and nothing is written back before then.
import { useEffect, useRef, useState } from 'react'
import type { ProgramExercise, SessionSetChange, SessionSetChangeType, SetLog, WeekPlanSet } from '../../types'
import {
  addRound,
  currentSet,
  finishWarning,
  holdsAutoFinish,
  nextAddedPlace,
  numberCorrections,
  resolveRows,
  sessionOrder,
  type AddedSet,
  type FinishWarning,
  type HeldChange,
  type NumberPatch,
  type OrderExercise,
  type OrderSuperset,
  type ResolvedRow,
  type SessionOrder,
  type SetDraft,
  type SetDraftKey,
  type SwapRecord,
  type UnlogEffects,
} from './workoutRules'
import { draftIdentity, heldDraftsOf, storedDraftId, type AddedLists, type DraftStore, type StoredDraft } from './sessionDrafts'

/** One card of the workout as GymSession draws it. `key` is the card's identity, the same on every phone and after a reload. */
export interface WorkoutCard {
  key: string
  programExercise: ProgramExercise
  /** The week plan's sets of this card's exercise (heads, drops and warmups); none on a card the plan doesn't have. */
  plannedSets: readonly WeekPlanSet[]
  /** A card a swap for today made (chunk 59): the record of the sets the swap moved to it, read from the swap's row (46r's `SwapRecord`). */
  swappedFrom?: SwapRecord
}

export interface WorkoutRows {
  order: SessionOrder
  rows: ResolvedRow[]
  current: ResolvedRow | null
  /**
   * What the rows say is left (46r's `finishWarning`: the planned working sets still unlogged, a deleted one not among them, a set a swap moved from a
   * planned set among them since chunk 64: DECISIONS 201 (a)), or null when nothing is. The finish screen's warning reads this.
   */
  finish: FinishWarning | null
  /**
   * Auto-finish's question (chunk 61, DECISIONS 166 (a)): nothing is left to log. The finish warning is empty AND no open row is a drop of a
   * planned set or a planned warmup (`holdsAutoFinish`); the warning alone lists the planned working sets only, so an open planned drop or an
   * open planned warmup would let the session complete by itself (61's review 1, F2). The warning stays in it: since chunk 64 it lists a swap's
   * moved planned sets too (DECISIONS 201 (a)), and auto-finish follows. A set a swap moved from a planned set counts as planned in
   * `holdsAutoFinish` too (`ResolvedRow.movedFromPlan`: 64's review 1, F1), so its open drops and a moved planned warmup hold it.
   */
  nothingLeft: boolean
  /** The number patches the rows call for (DECISIONS 178, 185 (c)): logged sets whose stored number is not the row's. */
  corrections: NumberPatch[]
  /** + ADD SET: a new open set on the card, with its place (DECISIONS 174); its entry. */
  addSet: (cardKey: string) => AddedSet
  /** + ADD ROUND: one new open set on every member of the block (SPEC Defaults 9), each with its own place. */
  addRoundTo: (blockId: string) => Array<{ cardKey: string; entry: AddedSet }>
  /** Writes in flight that the screen's own corrections wait for (a delete's cascade and its renumber), and the way to name one. */
  busy: number
  track: <T>(write: Promise<T>) => Promise<T>
  /**
   * The session's stored change rows, with their ids (chunk 61): what `deleteEffects` and `applySetTypeChange` read to say which row a write
   * replaces. The rows the rules draw also hold the phone's own: a delete or a type change in progress (`holdChanges`).
   */
  changes: readonly HeldChange[]
  /**
   * A delete's or a type change's change rows, drawn from now on, before they are written (chunks 61 and 62): the planned set is out of the
   * order and its drops with it, or has the type it was given, whatever a read of the session says while the writes are on their way (a
   * delete removes the log first, so a read between the two writes has the set's log gone and its change row not there yet, which draws an
   * open row; a logged head given a staged type has its log patched before its `pending_stages` row exists, which draws a normal set).
   * Returns the way to let them go, once the rows are in the session's cache (or the write failed).
   */
  holdChanges: (changes: readonly SessionSetChange[]) => () => void
  /** A set added in the session is deleted (DECISIONS 170: "DELETE: the entry goes"): its entry leaves the card's list, logged or not. */
  removeAdded: (cardKey: string, localId: string) => void
  /** An added set's log is `logId` from now on (LOG and SKIP): the card's list names it, so the log is never drawn a second time. */
  linkLog: (cardKey: string, localId: string, logId: string) => void
  /**
   * A swap for today's moved sets (chunk 59): the entries `movedSetEntries` made for the card the swap makes, listed under that card's key.
   * Listed before the swap is saved, they are drawn only once the card exists (the swap's row in the cache), so a swap that isn't saved
   * shows nothing; `removeEntries` takes them back then.
   */
  addEntries: (cardKey: string, entries: readonly AddedSet[]) => void
  removeEntries: (cardKey: string) => void
  /**
   * SET TYPE on a set added in the session that isn't logged yet (chunk 62; DECISIONS 161: "an added set's draft also keeps its type"): the
   * entry's `type` is what the rules read until the set has a log, and LOG writes it. A set the list doesn't name throws: the type would be lost.
   */
  setAddedType: (cardKey: string, localId: string, type: SessionSetChangeType) => void
  /** The phone's copy has been read (or there is none to read): the screen's own writes that depend on the list, such as the number corrections, wait for it. */
  hydrated: boolean
  /** The numbers an unlogged row keeps on this phone (G46), or null: a planned set's by its id, an added set's by its local id, a drop's by its set and its number. */
  draftOf: (row: ResolvedRow) => SetDraft | null
  /** UNLOG: the draft `unlogEffects` answers is held at once (the row that comes back reads it in its first draw) and kept on the phone; resolves when it is. */
  keepDraft: (draft: UnlogEffects['draft']) => Promise<void>
  /** UNLOG that did not go through: the draft is let go (memory and phone). */
  discardDraft: (key: SetDraftKey) => Promise<void>
  /**
   * LOG or SKIP of a row that may hold a draft: the draft leaves the screen's copy now (so the new log is never drawn beside it) and `forget` removes it from the phone once the
   * write went through; `restore` puts it back if the write failed. A row with no draft answers two no-ops.
   */
  releaseDraft: (row: ResolvedRow) => { restore: () => void; forget: () => Promise<void> }
  /** DELETE of a set or a drop: its draft goes (a set's drops' too); the drafts of the drops after a deleted drop move down one with their drops. */
  dropDraftsOf: (row: ResolvedRow) => Promise<void>
  /** UNLOG of an added set: its entry names no log from now on (the draft is beside it). */
  unlinkLog: (cardKey: string, localId: string) => void
  /** UNLOG of an added set the card's list does not name (a reload, a reopened session): the card takes it in with its own id, so it keeps its key across the new log (46r's header). */
  takeIn: (cardKey: string, entry: AddedSet) => void
}

/** What a draft of nothing releases. */
const NO_RELEASE = Object.freeze({ restore: () => {}, forget: () => Promise.resolve() })

const NORMAL = Object.freeze({ kind: 'normal' as const })
const NO_CHANGES: readonly HeldChange[] = Object.freeze([])

export function useWorkoutRows({
  cards,
  blocks,
  logs,
  changes = NO_CHANGES,
  initialAdded = {},
  store,
  persist = true,
}: {
  cards: readonly WorkoutCard[]
  blocks: readonly OrderSuperset[]
  logs: readonly SetLog[]
  /** The session's stored change rows (`v2_session_set_changes`, read with the session: chunk 61); none when it has none. */
  changes?: readonly HeldChange[]
  /** The card lists as they stand when the screen mounts (none on the workout screen today: the list starts empty; chunk 63 restores it from Dexie). */
  initialAdded?: Record<string, readonly AddedSet[]>
  /** Where the list and the drafts are kept on the phone (chunk 63). Left out, they live in memory for as long as the screen is mounted. */
  store?: DraftStore
  /** Whether the list may be written to the phone: the workout screen of a session that is in progress (a finished session's are cleared). */
  persist?: boolean
}): WorkoutRows {
  // The list is the card's own state (G46): it is read by the rules at every render, and by `addSet` at the moment of the tap,
  // through a ref, so two taps in one instant give two places.
  const [added, setAdded] = useState<Record<string, readonly AddedSet[]>>(initialAdded)
  const addedRef = useRef(added)
  // The drafts (G46) are the screen's copy of what the phone holds; `store` keeps the phone's.
  const [drafts, setDrafts] = useState<readonly StoredDraft[]>([])
  const draftsRef = useRef<readonly StoredDraft[]>(drafts)
  const [hydrated, setHydrated] = useState(store === undefined)
  // The list as last read from or written to the phone, as JSON: an unchanged list is not written again.
  const savedLists = useRef<string | null>(null)
  // A delete's or a type change's change rows while its writes are on their way (chunks 61 and 62).
  const [inFlight, setInFlight] = useState<readonly SessionSetChange[]>([])
  const [busy, setBusy] = useState(0)
  const track = <T,>(write: Promise<T>): Promise<T> => {
    setBusy((n) => n + 1)
    return write.finally(() => setBusy((n) => n - 1))
  }

  // Every card of an exercise is handed all the session's drafts: a draft names its exercise, not its card, and the rules draw each on one card.
  const build = (list: Record<string, readonly AddedSet[]>, held: readonly StoredDraft[]): SessionOrder =>
    sessionOrder(
      cards.map(
        (card): OrderExercise => ({
          key: card.key,
          exerciseId: card.programExercise.exerciseId,
          name: card.programExercise.exercise?.name ?? card.programExercise.exerciseId,
          plannedSets: card.plannedSets,
          added: list[card.key] ?? [],
          drafts: heldDraftsOf(held),
          ...(card.swappedFrom !== undefined ? { swappedFrom: card.swappedFrom } : {}),
        }),
      ),
      blocks,
    )

  // What the rules read as the session's changes, later over earlier where two say something about one set: the session's stored rows, then a
  // delete or a type change in progress, which is the newest word.
  const allChanges = [...changes, ...inFlight]

  const order = build(added, drafts)
  const rows = resolveRows(order, logs, allChanges)
  const finish = finishWarning(order, logs, allChanges)
  const current = currentSet(order, logs, allChanges)

  function commit(next: Record<string, readonly AddedSet[]>) {
    addedRef.current = next
    setAdded(next)
  }

  function addSet(cardKey: string): AddedSet {
    const card = cards.find((c) => c.key === cardKey)
    if (card === undefined) throw new RangeError(`no card ${cardKey}`)
    const place = nextAddedPlace(build(addedRef.current, draftsRef.current), card.programExercise.exerciseId, logs)
    const entry: AddedSet = { localId: crypto.randomUUID(), logId: null, type: NORMAL, place }
    commit({ ...addedRef.current, [cardKey]: [...(addedRef.current[cardKey] ?? []), entry] })
    return entry
  }

  function addRoundTo(blockId: string): Array<{ cardKey: string; entry: AddedSet }> {
    const latest = build(addedRef.current, draftsRef.current)
    const made = addRound(latest, resolveRows(latest, logs, allChanges), blockId, logs).map(({ exerciseKey, place }) => ({
      cardKey: exerciseKey,
      entry: { localId: crypto.randomUUID(), logId: null, type: NORMAL, place } satisfies AddedSet,
    }))
    const next = { ...addedRef.current }
    for (const { cardKey, entry } of made) next[cardKey] = [...(next[cardKey] ?? []), entry]
    commit(next)
    return made
  }

  function linkLog(cardKey: string, localId: string, logId: string) {
    const list = addedRef.current[cardKey]
    if (list === undefined || !list.some((entry) => entry.localId === localId)) return
    commit({ ...addedRef.current, [cardKey]: list.map((entry) => (entry.localId === localId ? { ...entry, logId } : entry)) })
  }

  // The card a swap makes does not exist before the swap is saved, so its list holds the swap's entries and nothing else: a list left on the phone by a swap that never
  // got saved (the app closed first) is replaced, not added to, or the retry would draw every moved set twice.
  function addEntries(cardKey: string, entries: readonly AddedSet[]) {
    if (entries.length === 0) return
    commit({ ...addedRef.current, [cardKey]: [...entries] })
  }

  function removeEntries(cardKey: string) {
    const { [cardKey]: _gone, ...rest } = addedRef.current
    commit(rest)
  }

  function setAddedType(cardKey: string, localId: string, type: SessionSetChangeType) {
    const list = addedRef.current[cardKey]
    if (list === undefined || !list.some((entry) => entry.localId === localId)) throw new RangeError(`the card ${cardKey} lists no added set ${localId}`)
    commit({ ...addedRef.current, [cardKey]: list.map((entry) => (entry.localId === localId ? { ...entry, type } : entry)) })
  }

  function unlinkLog(cardKey: string, localId: string) {
    const list = addedRef.current[cardKey]
    if (list === undefined || !list.some((entry) => entry.localId === localId && entry.logId !== null)) return
    commit({ ...addedRef.current, [cardKey]: list.map((entry) => (entry.localId === localId ? { ...entry, logId: null } : entry)) })
  }

  function takeIn(cardKey: string, entry: AddedSet) {
    const list = addedRef.current[cardKey] ?? []
    if (list.some((e) => e.localId === entry.localId || (entry.logId !== null && e.logId === entry.logId))) return
    commit({ ...addedRef.current, [cardKey]: [...list, entry] })
  }

  // ─── The drafts (G46) ──────────────────────────────────────────────────────────────────────────
  function commitDrafts(next: readonly StoredDraft[]) {
    draftsRef.current = next
    setDrafts(next)
  }

  // A row's draft identity: a head's own (the planned set, or the added set's local id), a drop's the head's plus its number (DECISIONS 147 (b)).
  const headIdentity = (head: ResolvedRow | undefined): string | null =>
    head === undefined ? null : head.weekPlanSetId !== null ? `p:${head.weekPlanSetId}` : head.localId !== null ? `a:${head.localId}` : null
  const identityOf = (row: ResolvedRow): string | null => {
    if (row.kind !== 'stage') return headIdentity(row)
    const base = headIdentity(rows.find((r) => r.key === row.headKey))
    return base === null || row.stageNumber === null ? null : `${base}:d${row.stageNumber}`
  }
  const draftByIdentity = new Map(drafts.map((draft) => [draftIdentity(draft.key), draft]))

  function draftOf(row: ResolvedRow): SetDraft | null {
    const id = row.state === 'unlogged' ? identityOf(row) : null
    return id === null ? null : (draftByIdentity.get(id)?.values ?? null)
  }

  function keepDraft(draft: UnlogEffects['draft']): Promise<void> {
    const row: StoredDraft = { id: storedDraftId(draft.key), sessionId: draft.key.sessionId, key: draft.key, values: draft.values }
    commitDrafts([...draftsRef.current.filter((d) => d.id !== row.id), row])
    return store === undefined ? Promise.resolve() : store.putDraft(row)
  }

  function discardDraft(key: SetDraftKey): Promise<void> {
    const id = storedDraftId(key)
    commitDrafts(draftsRef.current.filter((d) => d.id !== id))
    return store === undefined ? Promise.resolve() : store.deleteDrafts([id])
  }

  function releaseDraft(row: ResolvedRow): { restore: () => void; forget: () => Promise<void> } {
    const id = identityOf(row)
    const held = id === null ? undefined : draftsRef.current.find((d) => draftIdentity(d.key) === id)
    if (held === undefined) return NO_RELEASE
    commitDrafts(draftsRef.current.filter((d) => d.id !== held.id))
    return {
      restore: () => commitDrafts([...draftsRef.current.filter((d) => d.id !== held.id), held]),
      forget: () => (store === undefined ? Promise.resolve() : store.deleteDrafts([held.id])),
    }
  }

  async function dropDraftsOf(row: ResolvedRow): Promise<void> {
    const id = identityOf(row)
    if (id === null) return
    const gone: StoredDraft[] = []
    const moved: StoredDraft[] = []
    for (const draft of draftsRef.current) {
      const own = draftIdentity(draft.key)
      if (row.kind === 'stage') {
        const base = id.slice(0, id.lastIndexOf(':d'))
        if (!own.startsWith(`${base}:d`) || !('drop' in draft.key)) continue
        if (draft.key.drop === row.stageNumber) gone.push(draft)
        else if (draft.key.drop > row.stageNumber!) {
          // the drops after a deleted drop move down one, and so do their drafts (the drops left are the first ones: 46r's `deleteEffects`)
          const key = { ...draft.key, drop: draft.key.drop - 1 }
          moved.push({ ...draft, id: storedDraftId(key), key })
          gone.push(draft)
        }
      } else if (own === id || own.startsWith(`${id}:d`)) gone.push(draft)
    }
    if (gone.length === 0) return
    const goneIds = new Set(gone.map((d) => d.id))
    commitDrafts([...draftsRef.current.filter((d) => !goneIds.has(d.id) && !moved.some((m) => m.id === d.id)), ...moved])
    if (store === undefined) return
    await store.deleteDrafts([...goneIds])
    for (const draft of moved) await store.putDraft(draft)
  }

  // What the phone held is merged in when it arrives: what this phone did meanwhile wins, the stored lists and drafts fill in the rest.
  useEffect(() => {
    if (store === undefined) return
    let live = true
    store.load().then(({ drafts: stored, lists }) => {
      if (!live) return
      savedLists.current = JSON.stringify(lists)
      const current = addedRef.current
      const merged: Record<string, readonly AddedSet[]> = { ...lists }
      for (const [cardKey, own] of Object.entries(current)) {
        const kept = (lists[cardKey] ?? []).filter((entry) => !own.some((e) => e.localId === entry.localId))
        merged[cardKey] = [...kept, ...own]
      }
      commit(merged)
      const own = draftsRef.current
      commitDrafts([...stored.filter((d) => !own.some((o) => o.id === d.id)), ...own])
      setHydrated(true)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store])

  // The list is kept on the phone whenever it changes (once the phone's own copy has been read, so a stored list is never overwritten by an empty one).
  useEffect(() => {
    if (store === undefined || !hydrated || !persist) return
    const json = JSON.stringify(added)
    if (json === savedLists.current) return
    savedLists.current = json
    void store.saveLists(added as AddedLists)
  }, [store, hydrated, persist, added])

  function holdChanges(list: readonly SessionSetChange[]): () => void {
    setInFlight((prev) => [...prev, ...list])
    return () => setInFlight((prev) => prev.filter((change) => !list.includes(change)))
  }

  function removeAdded(cardKey: string, localId: string) {
    const list = addedRef.current[cardKey]
    if (list === undefined || !list.some((entry) => entry.localId === localId)) return
    commit({ ...addedRef.current, [cardKey]: list.filter((entry) => entry.localId !== localId) })
  }

  return {
    order,
    rows,
    current,
    finish,
    nothingLeft: finish === null && !rows.some(holdsAutoFinish),
    corrections: numberCorrections(order, logs, allChanges),
    busy,
    track,
    changes,
    holdChanges,
    addSet,
    addRoundTo,
    linkLog,
    addEntries,
    removeEntries,
    removeAdded,
    setAddedType,
    hydrated,
    draftOf,
    keepDraft,
    discardDraft,
    releaseDraft,
    dropDraftsOf,
    unlinkLog,
    takeIn,
  }
}
