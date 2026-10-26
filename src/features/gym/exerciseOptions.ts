// Chunk 59 (TASKS-1.2 59; SPEC [1.2] Logging mechanics "Swap during a workout (C7)" and "The set's ⋯ (C9)"; DECISIONS 163, 164, 179,
// 183, 199 and 200; boards W10, W11): what the exercise ⋯ offers, which sets "Skip the rest of this exercise" and "Swap for today"
// write a skip for, and the swap's moved sets with their record. Pure: no React, no Supabase, no clock. The card
// (`useExerciseCardState`) calls it with the session's rows and writes what it says, in the order it says.
//
// - "Skip the rest of this exercise" (163 (a), Adam 2026-10-16: "also skips its open added sets and its unlogged warmups") skips every
//   open set of the card: its warmups, its working sets, the sets added in the session, each head with the open drops under it, and
//   the open drops under a head that is logged. A skipped head's drops are dead and have no rows (46r), so nothing more is written
//   for them.
// - "Swap for today" (164 (a), 179, 183 (a); Q1; 46r's `movedSetEntries`) moves the card's open sets to the new exercise as added
//   sets of it, in the order they stood, each with the place it takes after the sets already added to that exercise, and skips them
//   on the card they left (each skip carries the set's `is_warmup` and, for an added set, its place: after a reload that skip alone
//   holds the kind of the gap a moved added set leaves, DECISIONS 194). A set added before 1.2 (no place) can't be named by the
//   record and stays on its card, open (TASKS 59). A logged set never moves and never changes its number (Q1).

import { MUSCLE_GROUP_LABELS } from '../../lib/exerciseTags'
import { movedSetEntries, type AddedSet, type LoggedSet, type ResolvedRow, type SessionOrder, type SwapRecord } from './workoutRules'

/** One set of the card to skip: the head (a warmup or a working set, planned or added) and the open drops under it. */
export interface SkipItem {
  head: ResolvedRow
  /** The head is open and gets a skip of its own. False when it is logged and only drops under it are open. */
  skipHead: boolean
  /** The open drops under the head, in order. */
  drops: ResolvedRow[]
}

export interface SkipPlan {
  items: SkipItem[]
  /** How many skips are written: every head to skip and every drop. */
  count: number
}

const countOf = (items: readonly SkipItem[]): number => items.reduce((n, item) => n + (item.skipHead ? 1 : 0) + item.drops.length, 0)

/** The open sets of one card, in the order the screen draws them (`rows` is `resolveRows`' list, which is the session's order). */
export function planSkipRest(rows: readonly ResolvedRow[], cardKey: string): SkipPlan {
  const own = rows.filter((row) => row.exerciseKey === cardKey)
  const items: SkipItem[] = []
  for (const head of own) {
    if (head.kind === 'stage' || head.state === 'skipped') continue
    const skipHead = head.state === 'unlogged'
    const drops = own.filter((row) => row.kind === 'stage' && row.headKey === head.key && row.state === 'unlogged')
    if (!skipHead && drops.length === 0) continue
    items.push({ head, skipHead, drops })
  }
  return { items, count: countOf(items) }
}

// ─── Swap for today ──────────────────────────────────────────────────────────────────────────────

/** A set the record can name: a planned set by its id, or a set added in the session by its place. A set added before 044 has neither. */
export const canMove = (row: ResolvedRow): boolean => row.weekPlanSetId !== null || row.addedPlace !== null

export interface SwapPlan {
  /** What is skipped on the card the sets leave: each moved set's head with its drops, and the open drops of a logged head. */
  skip: SkipPlan
  /** The moved sets (the card's open heads that can move), in the order they stood, each with the id the new card gives it. */
  moved: Array<{ row: ResolvedRow; localId: string }>
  /** The new card's list entries for them (open, with their types and places). */
  entries: AddedSet[]
  /** The swap's record, which is written with the swap's row. */
  record: SwapRecord
}

/**
 * The swap of the card `cardKey` for the exercise `target`, as it is written: the record and the moved sets' entries first (the
 * swap's row is saved before any set is skipped, DECISIONS 200), then `skip`. With nothing open to move the record names no set
 * (`moved: []`), and the card it names is still the one the swap leaves.
 */
export function planSwap({
  order,
  rows,
  logs,
  cardKey,
  target,
  newId,
}: {
  order: SessionOrder
  rows: readonly ResolvedRow[]
  logs: readonly LoggedSet[]
  cardKey: string
  target: { exerciseId: string; name: string }
  /** A new id for each set that moves (the new card's list names it). */
  newId: () => string
}): SwapPlan {
  const items = planSkipRest(rows, cardKey).items.filter((item) => !item.skipHead || canMove(item.head))
  const moved = items.filter((item) => item.skipHead).map((item) => ({ row: item.head, localId: newId() }))
  const { entries, record } = moved.length === 0 ? { entries: [], record: { fromKey: cardKey, moved: [] } } : movedSetEntries(order, logs, target, moved)
  return { skip: { items, count: countOf(items) }, moved, entries, record }
}

// ─── The sheet's words (W10, W11) ────────────────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')

/** A head as the sheet names it: a working set "03", a warmup "W1". */
export const setName = (row: ResolvedRow): string => (row.kind === 'warmup' ? `W${row.number}` : pad(row.number))

const join = (names: readonly string[]): string => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

/**
 * Board W10's line under "Skip the rest of this exercise": "Set 03 and its drop will be marked skipped." Where the board draws one
 * case, the others are provisional (D31): "Set 03 will…", "Set 03 and its 2 drops will…", "Sets 02 and 03 (and their drops) will…", and
 * "The drop of set 03 will…" for a drop under a set that is logged.
 */
export function skipDescription(plan: SkipPlan): string {
  const heads = plan.items.filter((item) => item.skipHead)
  const dropOnly = plan.items.filter((item) => !item.skipHead)
  const parts: string[] = []
  if (heads.length > 0) {
    const drops = heads.reduce((n, item) => n + item.drops.length, 0)
    const names = heads.map((item) => setName(item.head))
    const tail = drops === 0 ? '' : heads.length === 1 ? (drops === 1 ? ' and its drop' : ` and its ${drops} drops`) : ' and their drops'
    parts.push(`${heads.length === 1 ? 'Set' : 'Sets'} ${join(names)}${tail}`)
  }
  if (dropOnly.length > 0) {
    const drops = dropOnly.reduce((n, item) => n + item.drops.length, 0)
    parts.push(`the ${drops === 1 ? 'drop' : 'drops'} of ${dropOnly.length === 1 ? 'set' : 'sets'} ${join(dropOnly.map((item) => setName(item.head)))}`)
  }
  const text = `${parts.join(' and ')} will be marked skipped.`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The confirm's button: "SKIP 2 SETS" (the board's: set 03 and its drop). */
export const skipLabel = (count: number): string => `SKIP ${count} ${count === 1 ? 'SET' : 'SETS'}`

/** The sheet's eyebrow: "BACK · 2 OF 3 SETS DONE", the card's working sets logged over all it draws (a drop is never a set of its own). */
export function optionsEyebrow(rows: readonly ResolvedRow[], cardKey: string, muscleGroup: string | null | undefined): string {
  const group = muscleGroup == null ? '' : ((MUSCLE_GROUP_LABELS as Record<string, string>)[muscleGroup] ?? muscleGroup.replace(/_/g, ' ').toUpperCase())
  const sets = rows.filter((row) => row.exerciseKey === cardKey && row.kind === 'working')
  const done = sets.filter((row) => row.state === 'logged').length
  const progress = sets.length === 0 ? '' : `${done} OF ${sets.length} SETS DONE`
  return [group, progress].filter((part) => part !== '').join(' · ')
}

/**
 * W11's line over the button: "The set left moves to Machine Pulldown. Next week's plan stays the same." Before a pick it is the
 * plan's half alone (the picker's own wording). The plural and the empty case are provisional (D31): "The 2 sets left move to …",
 * and with nothing open "No set is left to move: …".
 */
export function swapNote(movedCount: number, pickedName: string | null): string {
  const plan = "Next week's plan stays the same."
  if (pickedName === null) return plan
  if (movedCount === 0) return `No set is left to move. ${pickedName} takes the place of this exercise today. ${plan}`
  return movedCount === 1 ? `The set left moves to ${pickedName}. ${plan}` : `The ${movedCount} sets left move to ${pickedName}. ${plan}`
}
