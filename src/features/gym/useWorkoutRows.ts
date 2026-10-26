// Chunk 58a — the workout screen's one picture of its rows (TASKS-1.2 58a; chunk 46r's `workoutRules.ts`, "How the screens call it").
// GymSession hands this hook the cards it draws, in order, and the session's logs; it returns what every card draws
// (`resolveRows`), the current set, and the writers of the card's own state: the sets added in the session (`OrderExercise.added`:
// DECISIONS 170, 161, 174), each with the place `nextAddedPlace` gave it once, when it was made. The list lives here, once for the
// session, because the rules number a set over its slot, and the current set is the first unlogged one over every card.
// Nothing here writes to the server: `useSetNumberCorrections.ts` writes the corrected numbers, the cards write the logs.
import { useRef, useState } from 'react'
import type { ProgramExercise, SessionSetChange, SetLog, WeekPlanSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary'
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
  type SwapRecord,
} from './workoutRules'

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
   * What the rows say is left (46r's `finishWarning`: the planned working sets still unlogged, a deleted one not among them), or null when nothing
   * is. The finish screen's warning reads this (chunk 64).
   */
  finish: FinishWarning | null
  /**
   * Auto-finish's question (chunk 61, DECISIONS 166 (a)): nothing is left to log. The finish warning is empty AND no open row is a drop of a
   * planned set or a planned warmup (`holdsAutoFinish`); the warning alone lists the planned working sets only, so an open planned drop or an
   * open planned warmup would let the session complete by itself (61's review 1, F2). The warning stays in it: 64 adds a swap's moved planned
   * sets to the warning (DECISIONS 201 (a)) and auto-finish follows.
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
   * The session's stored change rows, with their ids (chunk 61): what `deleteEffects` reads to say which row a write replaces. The rows the
   * rules draw also hold the phone's own: a delete in progress (`holdChanges`) and a moved dropset's drops (`holdStages`).
   */
  changes: readonly HeldChange[]
  /**
   * A delete's change rows, drawn from now on, before they are written (chunk 61): the planned set is out of the order and its drops with
   * it, whatever a read of the session says while the writes are on their way (the log is deleted first, so a read between the two writes
   * has the set's log gone and its change row not there yet, which draws an open row). Returns the way to let them go, once the rows are in
   * the session's cache (or the write failed).
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
   * A staged added set (a moved dropset) that was just logged keeps its drops on this phone: the change row that would say how many
   * (`pending_stages`) has no writer before chunk 62, and without it the set reads as Normal once logged and its open drops vanish.
   * Phone-local, like the card's list; gone with a reload.
   */
  holdStages: (logId: string, stageKind: StageKind, stageCount: number) => void
}

const NORMAL = Object.freeze({ kind: 'normal' as const })
const NO_CHANGES: readonly HeldChange[] = Object.freeze([])

export function useWorkoutRows({
  cards,
  blocks,
  logs,
  changes = NO_CHANGES,
  initialAdded = {},
}: {
  cards: readonly WorkoutCard[]
  blocks: readonly OrderSuperset[]
  logs: readonly SetLog[]
  /** The session's stored change rows (`v2_session_set_changes`, read with the session: chunk 61); none when it has none. */
  changes?: readonly HeldChange[]
  /** The card lists as they stand when the screen mounts (none on the workout screen today: the list starts empty; chunk 63 restores it from Dexie). */
  initialAdded?: Record<string, readonly AddedSet[]>
}): WorkoutRows {
  // The list is the card's own state (G46): it is read by the rules at every render, and by `addSet` at the moment of the tap,
  // through a ref, so two taps in one instant give two places.
  const [added, setAdded] = useState<Record<string, readonly AddedSet[]>>(initialAdded)
  const addedRef = useRef(added)
  const [held, setHeld] = useState<readonly SessionSetChange[]>([])
  // A delete's change rows while its writes are on their way (chunk 61).
  const [inFlight, setInFlight] = useState<readonly SessionSetChange[]>([])
  const [busy, setBusy] = useState(0)
  const track = <T,>(write: Promise<T>): Promise<T> => {
    setBusy((n) => n + 1)
    return write.finally(() => setBusy((n) => n - 1))
  }

  const build = (list: Record<string, readonly AddedSet[]>): SessionOrder =>
    sessionOrder(
      cards.map(
        (card): OrderExercise => ({
          key: card.key,
          exerciseId: card.programExercise.exerciseId,
          name: card.programExercise.exercise?.name ?? card.programExercise.exerciseId,
          plannedSets: card.plannedSets,
          added: list[card.key] ?? [],
          ...(card.swappedFrom !== undefined ? { swappedFrom: card.swappedFrom } : {}),
        }),
      ),
      blocks,
    )

  // What the rules read as the session's changes, later over earlier where two say something about one set: a moved dropset's drops the phone
  // holds (59), then the session's stored rows (a row written since replaces them), then a delete in progress, which is the newest word.
  const allChanges = [...held, ...changes, ...inFlight]

  const order = build(added)
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
    const place = nextAddedPlace(build(addedRef.current), card.programExercise.exerciseId, logs)
    const entry: AddedSet = { localId: crypto.randomUUID(), logId: null, type: NORMAL, place }
    commit({ ...addedRef.current, [cardKey]: [...(addedRef.current[cardKey] ?? []), entry] })
    return entry
  }

  function addRoundTo(blockId: string): Array<{ cardKey: string; entry: AddedSet }> {
    const latest = build(addedRef.current)
    const made = addRound(latest, resolveRows(latest, logs, held), blockId, logs).map(({ exerciseKey, place }) => ({
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

  function addEntries(cardKey: string, entries: readonly AddedSet[]) {
    if (entries.length === 0) return
    commit({ ...addedRef.current, [cardKey]: [...(addedRef.current[cardKey] ?? []), ...entries] })
  }

  function removeEntries(cardKey: string) {
    const { [cardKey]: _gone, ...rest } = addedRef.current
    commit(rest)
  }

  function holdStages(logId: string, stageKind: StageKind, stageCount: number) {
    setHeld((list) => [...list.filter((change) => change.kind !== 'pending_stages' || change.setLogId !== logId), { kind: 'pending_stages', setLogId: logId, stageKind, stageCount }])
  }

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
    holdStages,
  }
}
