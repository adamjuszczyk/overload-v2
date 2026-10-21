// Chunk 58a — the workout screen's one picture of its rows (TASKS-1.2 58a; chunk 46r's `workoutRules.ts`, "How the screens call it").
// GymSession hands this hook the cards it draws, in order, and the session's logs; it returns what every card draws
// (`resolveRows`), the current set, and the writers of the card's own state: the sets added in the session (`OrderExercise.added`:
// DECISIONS 170, 161, 174), each with the place `nextAddedPlace` gave it once, when it was made. The list lives here, once for the
// session, because the rules number a set over its slot, and the current set is the first unlogged one over every card.
// Nothing here writes to the server: `useSetNumberCorrections.ts` writes the corrected numbers, the cards write the logs.
import { useRef, useState } from 'react'
import type { ProgramExercise, SetLog, WeekPlanSet } from '../../types'
import {
  addRound,
  currentSet,
  nextAddedPlace,
  numberCorrections,
  resolveRows,
  sessionOrder,
  type AddedSet,
  type NumberPatch,
  type OrderExercise,
  type OrderSuperset,
  type ResolvedRow,
  type SessionOrder,
} from './workoutRules'

/** One card of the workout as GymSession draws it. `key` is the card's identity, the same on every phone and after a reload. */
export interface WorkoutCard {
  key: string
  programExercise: ProgramExercise
  /** The week plan's sets of this card's exercise (heads, drops and warmups); none on a card the plan doesn't have. */
  plannedSets: readonly WeekPlanSet[]
}

export interface WorkoutRows {
  order: SessionOrder
  rows: ResolvedRow[]
  current: ResolvedRow | null
  /** The number patches the rows call for (DECISIONS 178, 185 (c)): logged sets whose stored number is not the row's. */
  corrections: NumberPatch[]
  /** + ADD SET: a new open set on the card, with its place (DECISIONS 174); its entry. */
  addSet: (cardKey: string) => AddedSet
  /** + ADD ROUND: one new open set on every member of the block (SPEC Defaults 9), each with its own place. */
  addRoundTo: (blockId: string) => Array<{ cardKey: string; entry: AddedSet }>
  /** Writes in flight that the screen's own corrections wait for (a delete's cascade and its renumber), and the way to name one. */
  busy: number
  track: <T>(write: Promise<T>) => Promise<T>
  /** An added set's log is `logId` from now on (LOG and SKIP): the card's list names it, so the log is never drawn a second time. */
  linkLog: (cardKey: string, localId: string, logId: string) => void
}

const NORMAL = Object.freeze({ kind: 'normal' as const })

export function useWorkoutRows({
  cards,
  blocks,
  logs,
}: {
  cards: readonly WorkoutCard[]
  blocks: readonly OrderSuperset[]
  logs: readonly SetLog[]
}): WorkoutRows {
  // The list is the card's own state (G46): it is read by the rules at every render, and by `addSet` at the moment of the tap,
  // through a ref, so two taps in one instant give two places.
  const [added, setAdded] = useState<Record<string, readonly AddedSet[]>>({})
  const addedRef = useRef(added)
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
        }),
      ),
      blocks,
    )

  const order = build(added)
  const rows = resolveRows(order, logs)
  const current = currentSet(order, logs)

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
    const made = addRound(latest, resolveRows(latest, logs), blockId, logs).map(({ exerciseKey, place }) => ({
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

  return { order, rows, current, corrections: numberCorrections(order, logs), busy, track, addSet, addRoundTo, linkLog }
}
