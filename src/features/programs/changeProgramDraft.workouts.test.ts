import { describe, expect, it, vi } from 'vitest'
import type { WeightUnit } from '../../types'
import { planProgramChange, type Op } from './programChange'
import { applyOpsToDb, cloneDb, idGen, inputOf, runCopyOf, type World } from './programChange.testutil'
import { UNEVEN_WORKOUTS, unevenWorkoutsWorld } from './programChange.worlds.testutil'
import {
  addExercise,
  addRoutineItem,
  draftContent,
  draftDiffers,
  editRoutineItem,
  initialDraft,
  linkWithBelow,
  moveExercise,
  moveExerciseToUnit,
  moveRoutineItem,
  removeExercise,
  removeRoutineItem,
  renameWorkout,
  setBlockRest,
  setExerciseRest,
  setExerciseTempo,
  setExerciseUnit,
  splitAfter,
  swapExercise,
  undoRemove,
  unlinkBlock,
  type DraftEntry,
  type DraftState,
} from './changeProgramDraft'

// DECISIONS 176 (a tests-only follow-up): chunk 51a's exercise-level edits, as pure functions, on a draft of FOUR workouts. A walk of
// random edits across them keeps, beside every step, a model of the draft made with plain array operations, and compares the whole
// state after every step: the draft's workouts (names, exercises in order with their block, rests, tempo and unit, routines), the
// removed list, and the blocks' rests. An edit that lands on another workout, another exercise or another place is a different state.
// (RULES.md, chunk 51b's retry: a walk whose expectation is taken from the draft the edit made can't see which item an edit picked.)
//
// The walk takes its targets from the model and names them to the draft by key. Rows of the run copy have the keys `e:<row>` and
// `r:<id>`; an exercise or an item the draft made is found by what the walk gave it (an exercise id of its own, a body of its own).

// The walks are 400 of 25 edits and 400 of 30 in phases (UNDO's cases, chunk 51c), then an enumeration of every order of removing and putting back: a few
// seconds each, with a timeout far above them.
vi.setConfig({ testTimeout: 30000 })

// ─── The model ───────────────────────────────────────────────────────────────────────────────────────────────────────────

type Kind = 'kept' | 'swapped' | 'added'
interface Entry {
  kind: Kind
  key: string | null // the draft's key for a row of the run copy; an exercise the draft made has none the model can know
  exerciseId: string | null // of a swapped or added exercise; a kept one is told by its key
  block: string | null
  rest: number | null
  restAfter: number | null
  tempo: string | null
  unit: WeightUnit | null
}
interface Item {
  key: string | null
  body: string
}
interface MWorkout {
  id: string
  name: string
  exercises: Entry[]
  routine: Item[]
}
interface Removed {
  workoutId: string
  entry: Entry
  at: number
}
interface Model {
  workouts: MWorkout[]
  blocks: Map<string, [number | null, number | null]>
  removed: Removed[]
}

function initialModel(): Model {
  const blocks = new Map<string, [number | null, number | null]>()
  const workouts = UNEVEN_WORKOUTS.map((wk): MWorkout => {
    blocks.set(wk.block.id, [wk.block.within, wk.block.after])
    return {
      id: wk.id,
      name: wk.name,
      exercises: wk.exercises.map((x): Entry => ({ kind: 'kept', key: `e:${x.row}`, exerciseId: null, block: x.block ?? null, rest: x.rest, restAfter: x.restAfter, tempo: x.tempo, unit: x.unit })),
      routine: wk.routine.map((body, i): Item => ({ key: `r:${wk.id}-r${i + 1}`, body })),
    }
  })
  return { workouts, blocks, removed: [] }
}

// A unit is a run of two or more neighbours in one block, or a single exercise.
function unitsOf(list: readonly Entry[]): Entry[][] {
  const units: Entry[][] = []
  for (const e of list) {
    const last = units[units.length - 1]
    if (last && e.block !== null && last[0].block === e.block) last.push(e)
    else units.push([e])
  }
  return units
}
// The run of neighbours that share the block of list[i] (just list[i] when it has none).
function runAround(list: readonly Entry[], i: number): [number, number] {
  const b = list[i].block
  if (b === null) return [i, i]
  let a = i
  let z = i
  while (a > 0 && list[a - 1].block === b) a--
  while (z < list.length - 1 && list[z + 1].block === b) z++
  return [a, z]
}
// Where UNDO puts a removed entry back in the model's list, by plain array operations (never the draft's own function): the place it
// stood in, or the end of the list when the list is shorter now, and not inside a superset (chunk 51c, DECISIONS 191). A superset's
// member whose others are in the list goes next to them: before the first when its place is at or before it, else after the last. Any
// other entry whose place is between two neighbours of one superset goes after that superset; a place right before or right after a
// superset stays.
function placeBackInModel(list: readonly Entry[], x: Removed): number {
  const at = Math.min(x.at, list.length)
  const mates = x.entry.block === null ? [] : list.flatMap((e, j) => (e.block === x.entry.block ? [j] : []))
  if (mates.length > 0) return at <= mates[0] ? mates[0] : mates[mates.length - 1] + 1
  const between = at > 0 && at < list.length && list[at - 1].block !== null && list[at - 1].block === list[at].block
  return between ? runAround(list, at)[1] + 1 : at
}
// Which case of that rule an UNDO is, read off the model's list before the entry goes back; the focused walk counts them.
const UNDO_CASES = ['a member, the others of its superset there', 'a member, its superset gone, place inside another superset', 'a member, its superset gone, place outside', 'in no superset, place inside a superset', 'in no superset, place outside'] as const
// The fewest times the focused walk must reach each case, in each workout and over the four (about half of what its seeded walks reach). The
// case that needs a second superset in the workout, after the first has gone, is counted over the four.
const FLOOR: Record<(typeof UNDO_CASES)[number], { each: number; all: number }> = {
  'a member, the others of its superset there': { each: 50, all: 0 },
  'a member, its superset gone, place inside another superset': { each: 0, all: 10 },
  'a member, its superset gone, place outside': { each: 30, all: 0 },
  'in no superset, place inside a superset': { each: 3, all: 0 },
  'in no superset, place outside': { each: 100, all: 0 },
}
function undoCaseOf(list: readonly Entry[], x: Removed): (typeof UNDO_CASES)[number] {
  const at = Math.min(x.at, list.length)
  const between = at > 0 && at < list.length && list[at - 1].block !== null && list[at - 1].block === list[at].block
  if (x.entry.block !== null && list.some((e) => e.block === x.entry.block)) return UNDO_CASES[0]
  if (x.entry.block !== null) return between ? UNDO_CASES[1] : UNDO_CASES[2]
  return between ? UNDO_CASES[3] : UNDO_CASES[4]
}

// ─── Two views of a state, made comparable ─────────────────────────────────────────────────────────────────────────────────

type Cell = string | number | null
interface View {
  workouts: Array<{ id: string; name: string; exercises: Cell[][]; routine: Cell[][] }>
  blocks: Array<Cell[]>
  removed: Cell[][]
}
// A block is told by the order in which the lists meet it, so a block the draft names `b+3` and the model `nb7` read the same.
function tagger(): (b: string | null) => string | null {
  const seen = new Map<string, string>()
  return (b) => {
    if (b === null) return null
    if (!seen.has(b)) seen.set(b, `block ${seen.size + 1}`)
    return seen.get(b)!
  }
}
function viewOfModel(m: Model): View {
  const tag = tagger()
  const used: Array<[string, string]> = []
  const workouts = m.workouts.map((w) => ({
    id: w.id,
    name: w.name,
    exercises: w.exercises.map((e) => {
      const t = tag(e.block)
      if (e.block !== null && !used.some(([x]) => x === t)) used.push([t!, e.block])
      return [e.kind === 'added' ? 'added' : e.key, e.exerciseId, t, e.rest, e.restAfter, e.tempo, e.unit]
    }),
    routine: w.routine.map((r) => [r.key ?? 'new', r.body]),
  }))
  const blocks = used.map(([t, id]) => [t, ...m.blocks.get(id)!])
  const removed = m.removed.map((r) => [r.workoutId, r.entry.kind === 'added' ? 'added' : r.entry.key, r.at])
  return { workouts, blocks, removed }
}
function viewOfDraft(s: DraftState): View {
  const tag = tagger()
  const used: Array<[string, string]> = []
  const workouts = s.edit.workouts.map((w) => ({
    id: w.id,
    name: w.name,
    exercises: w.exercises.map((e) => {
      const t = tag(e.supersetBlockId)
      if (e.supersetBlockId !== null && !used.some(([x]) => x === t)) used.push([t!, e.supersetBlockId])
      return [e.kind === 'added' ? 'added' : e.key, e.kind === 'kept' ? null : e.exerciseId, t, e.restSeconds, e.restAfterSeconds, e.tempo, e.weightUnit]
    }),
    routine: w.routine.map((r) => [r.id === null ? 'new' : r.key, r.body]),
  }))
  const blocks = used.map(([t, id]) => {
    const b = s.edit.blocks.find((x) => x.id === id)!
    return [t, b.restWithinRoundSeconds, b.restAfterRoundSeconds]
  })
  const removed = s.removed.map((r) => [r.workoutId, r.entry.kind === 'added' ? 'added' : r.entry.key, r.at])
  return { workouts, blocks, removed }
}

// ─── The edits, each as a draft function and as plain array operations on the model ───────────────────────────────────────────────

const KINDS = [
  'add',
  'swap',
  'remove',
  'undo',
  'move',
  'drag',
  'link',
  'split',
  'unlink',
  'rest',
  'tempo',
  'unit',
  'blockRest',
  'routineAdd',
  'routineEdit',
  'routineMove',
  'routineRemove',
  'rename',
] as const
type EditKind = (typeof KINDS)[number]

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// The draft's key for an entry of the model: a row of the run copy has it; one the draft made is found by its exercise id.
function keyOf(s: DraftState, workoutId: string, e: Entry): string {
  if (e.key !== null) return e.key
  return s.edit.workouts.find((w) => w.id === workoutId)!.exercises.find((x) => x.kind === 'added' && x.exerciseId === e.exerciseId)!.key
}
function routineKeyOf(s: DraftState, workoutId: string, r: Item): string {
  if (r.key !== null) return r.key
  return s.edit.workouts.find((w) => w.id === workoutId)!.routine.find((x) => x.id === null && x.body === r.body)!.key
}
// The draft's id of a block of the model: the one its first member carries in the draft.
function blockIdOf(s: DraftState, workoutId: string, w: MWorkout, block: string): string {
  const member = w.exercises.find((e) => e.block === block)!
  const key = keyOf(s, workoutId, member)
  return s.edit.workouts.find((x) => x.id === workoutId)!.exercises.find((x) => x.key === key)!.supersetBlockId!
}

interface Step {
  kind: EditKind
  changed: boolean
  workoutId: string
  undo?: string // an UNDO's case (`undoCaseOf`), read off the model before the entry went back
}

let blockCounter = 0

// One random edit: picked from the model's own state, applied to the draft by the draft's function and to the model by plain array
// operations. Returns the new draft and whether the edit changed anything.
function step(s: DraftState, m: Model, r: () => number, n: number, kinds: readonly EditKind[] = KINDS, only?: string): Step & { state: DraftState } {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const w = only === undefined ? pick(m.workouts) : m.workouts.find((x) => x.id === only)!
  const wid = w.id
  const kind = pick(kinds)
  const before = JSON.stringify(viewOfModel(m))
  let state = s
  let undo: string | undefined
  const nothing = () => ({ kind, changed: false, workoutId: wid, state })
  const e = w.exercises.length > 0 ? pick(w.exercises) : undefined
  const i = e ? w.exercises.indexOf(e) : -1
  switch (kind) {
    case 'add': {
      const unit: WeightUnit = r() < 0.5 ? 'kg' : 'lbs'
      state = addExercise(s, wid, `ex-add-${n}`, unit)
      w.exercises.push({ kind: 'added', key: null, exerciseId: `ex-add-${n}`, block: null, rest: null, restAfter: null, tempo: null, unit })
      break
    }
    case 'swap': {
      if (!e) return nothing()
      const key = keyOf(s, wid, e)
      state = swapExercise(s, wid, key, `ex-swap-${n}`)
      if (e.kind === 'kept') Object.assign(e, { kind: 'swapped', exerciseId: `ex-swap-${n}`, rest: null, restAfter: null, tempo: null, unit: null })
      else e.exerciseId = `ex-swap-${n}`
      break
    }
    case 'remove': {
      if (!e) return nothing()
      state = removeExercise(s, wid, keyOf(s, wid, e))
      w.exercises.splice(i, 1)
      if (e.kind !== 'added') m.removed.push({ workoutId: wid, entry: e, at: i })
      break
    }
    case 'undo': {
      // Any removed entry can come back, a superset's member and one whose place is inside a superset made since included: the model
      // puts it where `placeBackInModel` says (51c; before 51c this walk left out members and those places, which the draft put
      // between two members of a superset and SAVE refused).
      if (m.removed.length === 0) return nothing()
      const gone = pick(m.removed)
      state = undoRemove(s, gone.entry.key!)
      m.removed.splice(m.removed.indexOf(gone), 1)
      const home = m.workouts.find((x) => x.id === gone.workoutId)!
      undo = undoCaseOf(home.exercises, gone)
      home.exercises.splice(placeBackInModel(home.exercises, gone), 0, gone.entry)
      break
    }
    case 'move': {
      if (!e) return nothing()
      const dir = r() < 0.5 ? 'up' : 'down'
      state = moveExercise(s, wid, keyOf(s, wid, e), dir)
      const units = unitsOf(w.exercises)
      const from = units.findIndex((u) => u.includes(e))
      const to = dir === 'up' ? from - 1 : from + 1
      if (to < 0 || to >= units.length) break
      ;[units[from], units[to]] = [units[to], units[from]]
      w.exercises = units.flat()
      break
    }
    case 'drag': {
      if (!e) return nothing()
      const toUnit = Math.floor(r() * 8) - 1
      state = moveExerciseToUnit(s, wid, keyOf(s, wid, e), toUnit)
      const units = unitsOf(w.exercises)
      const from = units.findIndex((u) => u.includes(e))
      const target = Math.max(0, Math.min(units.length - 1, toUnit))
      if (target === from) break
      const [unit] = units.splice(from, 1)
      units.splice(target, 0, unit)
      w.exercises = units.flat()
      break
    }
    case 'link': {
      if (!e) return nothing()
      state = linkWithBelow(s, wid, keyOf(s, wid, e))
      if (i >= w.exercises.length - 1) break
      if (e.block !== null && e.block === w.exercises[i + 1].block) break
      const [la, lz] = runAround(w.exercises, i)
      const [ra, rz] = runAround(w.exercises, i + 1)
      const block = w.exercises[la].block ?? w.exercises[ra].block ?? `nb${++blockCounter}`
      if (!m.blocks.has(block)) m.blocks.set(block, [null, null])
      for (let j = la; j <= lz; j++) w.exercises[j].block = block
      for (let j = ra; j <= rz; j++) w.exercises[j].block = block
      break
    }
    case 'split': {
      if (!e) return nothing()
      state = splitAfter(s, wid, keyOf(s, wid, e))
      if (i >= w.exercises.length - 1 || e.block === null || e.block !== w.exercises[i + 1].block) break
      const [a, z] = runAround(w.exercises, i)
      const shared = e.block
      const leftSize = i - a + 1
      const rightSize = z - i
      const leftKeeps = leftSize >= 2
      const rightBlock = rightSize < 2 ? null : leftKeeps ? `nb${++blockCounter}` : shared
      if (rightBlock !== null && !m.blocks.has(rightBlock)) m.blocks.set(rightBlock, [null, null])
      for (let j = a; j <= i; j++) w.exercises[j].block = leftKeeps ? shared : null
      for (let j = i + 1; j <= z; j++) w.exercises[j].block = rightBlock
      break
    }
    case 'unlink': {
      const blocks = [...new Set(w.exercises.map((x) => x.block).filter((b): b is string => b !== null))]
      if (blocks.length === 0) return nothing()
      const block = pick(blocks)
      state = unlinkBlock(s, wid, blockIdOf(s, wid, w, block))
      for (const x of w.exercises) if (x.block === block) x.block = null
      break
    }
    case 'rest': {
      if (!e) return nothing()
      const field = r() < 0.5 ? 'restSeconds' : 'restAfterSeconds'
      const seconds = r() < 0.25 ? null : 15 * (1 + Math.floor(r() * 40))
      state = setExerciseRest(s, wid, keyOf(s, wid, e), field, seconds)
      if (field === 'restSeconds') e.rest = seconds
      else e.restAfter = seconds
      break
    }
    case 'tempo': {
      if (!e) return nothing()
      const tempo = r() < 0.3 ? null : pick(['3-0-1-0', '2-1-1-0', '4-0-2-0', 'X-0-1-0'])
      state = setExerciseTempo(s, wid, keyOf(s, wid, e), tempo)
      e.tempo = tempo
      break
    }
    case 'unit': {
      if (!e) return nothing()
      const unit = pick<WeightUnit | null>([null, 'kg', 'lbs'])
      state = setExerciseUnit(s, wid, keyOf(s, wid, e), unit)
      e.unit = unit
      break
    }
    case 'blockRest': {
      const blocks = [...new Set(w.exercises.map((x) => x.block).filter((b): b is string => b !== null))]
      if (blocks.length === 0) return nothing()
      const block = pick(blocks)
      const field = r() < 0.5 ? 'restWithinRoundSeconds' : 'restAfterRoundSeconds'
      const seconds = r() < 0.25 ? null : 15 * (1 + Math.floor(r() * 12))
      state = setBlockRest(s, blockIdOf(s, wid, w, block), field, seconds)
      const rests = m.blocks.get(block)!
      if (field === 'restWithinRoundSeconds') rests[0] = seconds
      else rests[1] = seconds
      break
    }
    case 'routineAdd': {
      const body = `item ${n}`
      state = addRoutineItem(s, wid, body)
      w.routine.push({ key: null, body })
      break
    }
    case 'routineEdit': {
      if (w.routine.length === 0) return nothing()
      const item = pick(w.routine)
      const body = `edited ${n}`
      state = editRoutineItem(s, wid, routineKeyOf(s, wid, item), body)
      item.body = body
      break
    }
    case 'routineMove': {
      if (w.routine.length === 0) return nothing()
      const item = pick(w.routine)
      const dir = r() < 0.5 ? 'up' : 'down'
      state = moveRoutineItem(s, wid, routineKeyOf(s, wid, item), dir)
      const at = w.routine.indexOf(item)
      const to = dir === 'up' ? at - 1 : at + 1
      if (to < 0 || to >= w.routine.length) break
      ;[w.routine[at], w.routine[to]] = [w.routine[to], w.routine[at]]
      break
    }
    case 'routineRemove': {
      if (w.routine.length === 0) return nothing()
      const item = pick(w.routine)
      state = removeRoutineItem(s, wid, routineKeyOf(s, wid, item))
      w.routine.splice(w.routine.indexOf(item), 1)
      break
    }
    case 'rename': {
      state = renameWorkout(s, wid, `Name ${n}`)
      w.name = `Name ${n}`
      break
    }
  }
  return { kind, changed: JSON.stringify(viewOfModel(m)) !== before, workoutId: wid, state, undo }
}

// ─── The walk ────────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('a draft of four workouts, edit by edit, against a model made with plain array operations', () => {
  const start = (w: World): DraftState => initialDraft(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)

  it('the model starts equal to the draft', () => {
    const w = unevenWorkoutsWorld()
    expect(viewOfDraft(start(w))).toEqual(viewOfModel(initialModel()))
  })

  // An edit names a workout and, for an exercise, one of its keys: a workout the draft doesn't have, or an exercise the workout doesn't hold, is a
  // mistake in the caller and an error that says which, never an edit that lands somewhere else or nowhere.
  it('an unknown workout is an error naming it, for every edit', () => {
    const s = start(unevenWorkoutsWorld())
    const key = 'e:pe-bench'
    const edits: Array<[string, () => unknown]> = [
      ['renameWorkout', () => renameWorkout(s, 'nope', 'X')],
      ['addExercise', () => addExercise(s, 'nope', 'ex-x', 'kg')],
      ['swapExercise', () => swapExercise(s, 'nope', key, 'ex-x')],
      ['removeExercise', () => removeExercise(s, 'nope', key)],
      ['moveExercise', () => moveExercise(s, 'nope', key, 'down')],
      ['moveExerciseToUnit', () => moveExerciseToUnit(s, 'nope', key, 1)],
      ['linkWithBelow', () => linkWithBelow(s, 'nope', key)],
      ['splitAfter', () => splitAfter(s, 'nope', key)],
      ['unlinkBlock', () => unlinkBlock(s, 'nope', 'blk-push')],
      ['setExerciseRest', () => setExerciseRest(s, 'nope', key, 'restSeconds', 30)],
      ['setExerciseTempo', () => setExerciseTempo(s, 'nope', key, '3-0-1-0')],
      ['setExerciseUnit', () => setExerciseUnit(s, 'nope', key, 'kg')],
      ['addRoutineItem', () => addRoutineItem(s, 'nope', 'X')],
      ['editRoutineItem', () => editRoutineItem(s, 'nope', 'r:push-r1', 'X')],
      ['moveRoutineItem', () => moveRoutineItem(s, 'nope', 'r:push-r1', 'down')],
      ['removeRoutineItem', () => removeRoutineItem(s, 'nope', 'r:push-r1')],
    ]
    for (const [name, edit] of edits) expect({ name, error: (() => { try { edit() } catch (e) { return `${(e as Error).name}: ${(e as Error).message}` } return 'no error' })() }).toEqual({ name, error: 'RangeError: the draft has no workout nope' })
  })

  it('an exercise the workout does not hold is an error naming it, for the edits that go by an exercise; another workout’s exercise is one', () => {
    const s = start(unevenWorkoutsWorld())
    const other = 'e:pe-row' // Pull's, not Push's
    const edits: Array<[string, () => unknown]> = [
      ['swapExercise', () => swapExercise(s, 'push', other, 'ex-x')],
      ['removeExercise', () => removeExercise(s, 'push', other)],
      ['moveExercise', () => moveExercise(s, 'push', other, 'down')],
      ['moveExerciseToUnit', () => moveExerciseToUnit(s, 'push', other, 1)],
      ['splitAfter', () => splitAfter(s, 'push', other)],
      ['setExerciseRest', () => setExerciseRest(s, 'push', other, 'restSeconds', 30)],
      ['setExerciseTempo', () => setExerciseTempo(s, 'push', other, '3-0-1-0')],
      ['setExerciseUnit', () => setExerciseUnit(s, 'push', other, 'kg')],
    ]
    for (const [name, edit] of edits) expect({ name, error: (() => { try { edit() } catch (e) { return `${(e as Error).name}: ${(e as Error).message}` } return 'no error' })() }).toEqual({ name, error: expect.stringMatching(/^RangeError: workout push has no exercise e:pe-row$/) })
    expect(() => undoRemove(s, 'e:pe-bench')).toThrow(new RangeError('no removed exercise e:pe-bench'))
    expect(() => setBlockRest(s, 'blk-nope', 'restWithinRoundSeconds', 15)).toThrow(new RangeError('the draft has no superset block blk-nope'))
  })

  // What CANCEL and SAVE compare (`draftContent`): the blocks are read with no order (`fetchSupersetBlockRests`), so two reads of the same rows may
  // list them differently, and a block nothing points at is not part of the program.
  it('what CANCEL and SAVE compare does not depend on the order the blocks were read in, ignores a block nothing uses, and sees a rest that changed', () => {
    const s = start(unevenWorkoutsWorld())
    expect(s.edit.blocks.map((b) => b.id)).toEqual(['blk-push', 'blk-pull', 'blk-legs', 'blk-arms'])
    const withBlocks = (order: number[]): DraftState => ({ ...s, edit: { ...s.edit, blocks: order.map((i) => s.edit.blocks[i]) } })
    // all 24 orders the four blocks could be read in
    const permutations = (xs: number[]): number[][] => (xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((rest) => [x, ...rest])))
    const orders = permutations([0, 1, 2, 3])
    expect(orders).toHaveLength(24)
    for (const order of orders) {
      expect({ order, same: draftContent(withBlocks(order)) === draftContent(s) }).toEqual({ order, same: true })
      expect(draftDiffers(withBlocks(order), s)).toBe(false)
    }
    const orphan: DraftState = { ...s, edit: { ...s.edit, blocks: [...s.edit.blocks, { id: 'blk-orphan', restWithinRoundSeconds: 5, restAfterRoundSeconds: 5 }] } }
    expect(draftDiffers(orphan, s)).toBe(false)
    // a block's rest changed, or an exercise moved to another block, is a difference
    expect(draftDiffers(setBlockRest(s, 'blk-legs', 'restAfterRoundSeconds', 45), s)).toBe(true)
    expect(draftDiffers(setBlockRest(s, 'blk-legs', 'restWithinRoundSeconds', 30), s)).toBe(false) // as it was
    expect(draftDiffers(unlinkBlock(s, 'legs', 'blk-legs'), s)).toBe(true)
  })

  // One walk: `steps` random edits of `kinds` on the four workouts as the run copy holds them. After every edit the draft is the model (the
  // whole state, so a write to the wrong place shows whichever place it was) and each superset is in one piece; the walk ends on a draft
  // the planner accepts and the tables take. `seen` is told of each edit.
  function walkOnce(w: World, walk: number, steps: number, kinds: (n: number) => readonly EditKind[], seen: (done: Step) => void, only?: string): void {
    const r = rng(walk + 1)
    let s = start(w)
    const m = initialModel()
    blockCounter = 0
    const trace: string[] = []
    for (let n = 0; n < steps; n++) {
      const done = step(s, m, r, walk * 100 + n, kinds(n), only)
      s = done.state
      trace.push(`${done.kind} in ${done.workoutId}${done.changed ? '' : ' (no change)'}`)
      for (const wk of s.edit.workouts) {
        const blocks = wk.exercises.map((x) => x.supersetBlockId).filter((b): b is string => b !== null)
        for (const b of new Set(blocks)) {
          const places = wk.exercises.map((x, j) => (x.supersetBlockId === b ? j : -1)).filter((j) => j >= 0)
          if (places[places.length - 1] - places[0] + 1 !== places.length) throw new Error(`walk ${walk}: the members of ${b} in ${wk.id} are not next to each other (${places.join(',')}) after: ${trace.join(' | ')}`)
        }
      }
      seen(done)
      expect({ walk, n, kind: done.kind, view: viewOfDraft(s) }).toEqual({ walk, n, kind: done.kind, view: viewOfModel(m) })
    }
    const ops: Op[] = planProgramChange({ ...inputOf(w, s.edit), newId: idGen(`w${walk}-`) }).ops
    applyOpsToDb(cloneDb(w.db), ops)
  }

  it('400 walks of 25 edits: after every edit the draft is the model, and it reached every kind of edit in every workout', () => {
    const w = unevenWorkoutsWorld()
    const reached = new Map<string, number>()
    for (let walk = 0; walk < 400; walk++) {
      walkOnce(w, walk, 25, () => KINDS, (done) => {
        if (done.changed) reached.set(`${done.kind} in ${done.workoutId}`, (reached.get(`${done.kind} in ${done.workoutId}`) ?? 0) + 1)
      })
    }
    // every kind that can change something did, in every workout, many times over
    const missing: string[] = []
    for (const wk of UNEVEN_WORKOUTS) for (const kind of KINDS) if ((reached.get(`${kind} in ${wk.id}`) ?? 0) < 20) missing.push(`${kind} in ${wk.id}: ${reached.get(`${kind} in ${wk.id}`) ?? 0}`)
    expect(missing).toEqual([])
  })

  // The walk above puts a removed exercise back in about one step of eight, and the places that matter (inside a superset made since) are a
  // small part of those. This one stays in one workout per walk and goes in phases: three removals, some regrouping (SUPERSET, the toggle
  // between members, UNLINK, MOVE, a drag), the removed put back in a random order, then a mix, so every case of the rule is reached in every
  // workout, many times over (chunk 51c; DECISIONS 191), and each entry lands where the model puts it.
  const MIX: readonly EditKind[] = ['remove', 'remove', 'remove', 'undo', 'undo', 'undo', 'link', 'link', 'split', 'unlink', 'move', 'drag', 'add', 'swap']
  const focusedKinds = (n: number): readonly EditKind[] =>
    n < 3 ? ['remove'] : n < 8 ? ['link', 'link', 'split', 'unlink', 'move', 'drag'] : n < 13 ? ['undo'] : MIX
  it('400 walks of 30 edits in phases (remove, regroup, put back, mix): UNDO reached every case of its rule in every workout', () => {
    const w = unevenWorkoutsWorld()
    const reached = new Map<string, number>()
    for (let walk = 0; walk < 400; walk++) {
      walkOnce(w, 1000 + walk, 30, focusedKinds, (done) => {
        if (done.undo) reached.set(`${done.undo} in ${done.workoutId}`, (reached.get(`${done.undo} in ${done.workoutId}`) ?? 0) + 1)
      }, UNEVEN_WORKOUTS[walk % UNEVEN_WORKOUTS.length].id)
    }
    const counts = UNDO_CASES.flatMap((c) => UNEVEN_WORKOUTS.map((wk) => `${c} in ${wk.id}: ${reached.get(`${c} in ${wk.id}`) ?? 0}`))
    const total = (c: string) => UNEVEN_WORKOUTS.reduce((n, wk) => n + (reached.get(`${c} in ${wk.id}`) ?? 0), 0)
    const missing = UNDO_CASES.flatMap((c) => [
      ...UNEVEN_WORKOUTS.filter((wk) => (reached.get(`${c} in ${wk.id}`) ?? 0) < FLOOR[c].each).map((wk) => `${c} in ${wk.id}`),
      ...(total(c) < FLOOR[c].all ? [`${c} in all four`] : []),
    ])
    expect({ missing, counts }).toEqual({ missing: [], counts })
  })
})

// ─── UNDO and the supersets of the list now (chunk 51c; DECISIONS 191) ─────────────────────────────────────────────────────────
// UNDO used to put an exercise back at the index it stood at when it was removed, even where a superset stands now. Two ways to get
// there: the exercises that stood before it come back first, which moves the place by one (recipe 1), or a superset grows over the place
// (recipe 2). The list then had an exercise between two members of a superset, which `planProgramChange` refuses and SAVE shows as
// "Couldn't save the changes." The rule now: an exercise whose place is strictly inside a superset goes after it; a superset's member
// goes next to the others when they are there; a place right before or after a superset stays.

describe('UNDO never puts an exercise inside a superset', () => {
  const world = unevenWorkoutsWorld()
  const original = (): DraftState => initialDraft(runCopyOf(world.db, world.programId, world.mesocycleId), world.planningType)
  const keysIn = (s: DraftState, workoutId: string): string[] => s.edit.workouts.find((x) => x.id === workoutId)!.exercises.map((e) => e.key)
  const blockOfKey = (s: DraftState, workoutId: string, key: string): string | null => s.edit.workouts.find((x) => x.id === workoutId)!.exercises.find((e) => e.key === key)!.supersetBlockId
  // the draft goes to the planner as SAVE hands it over, and what the planner makes of it goes to the tables' stand-in
  const accepted = (s: DraftState): void => {
    applyOpsToDb(cloneDb(world.db), planProgramChange({ ...inputOf(world, s.edit), newId: idGen('u-') }).ops)
  }
  const rowsOf = (workoutId: string): string[] => UNEVEN_WORKOUTS.find((x) => x.id === workoutId)!.exercises.map((x) => `e:${x.row}`)

  it('recipe 1 (Push): the exercise above the pair and the one below it removed, put back in the order they were removed, are back where they were', () => {
    const base = original()
    const gone = removeExercise(removeExercise(base, 'push', 'e:pe-bench'), 'push', 'e:pe-pushdown')
    expect(keysIn(gone, 'push')).toEqual(['e:pe-ohp', 'e:pe-lateral'])
    expect(gone.removed.map((r) => [r.entry.key, r.at])).toEqual([['e:pe-bench', 0], ['e:pe-pushdown', 2]])
    const first = undoRemove(gone, 'e:pe-bench')
    expect(keysIn(first, 'push')).toEqual(['e:pe-bench', 'e:pe-ohp', 'e:pe-lateral'])
    // Triceps Pushdown stood at place 2, which is now between Overhead Press and Lateral Raise (places 1 and 2): after the pair
    const back = undoRemove(first, 'e:pe-pushdown')
    expect(keysIn(back, 'push')).toEqual(['e:pe-bench', 'e:pe-ohp', 'e:pe-lateral', 'e:pe-pushdown'])
    expect(['e:pe-bench', 'e:pe-ohp', 'e:pe-lateral', 'e:pe-pushdown'].map((k) => blockOfKey(back, 'push', k))).toEqual([null, 'blk-push', 'blk-push', null])
    expect(back.removed).toEqual([])
    expect(draftDiffers(back, base)).toBe(false)
    accepted(back)
  })

  it('recipe 2 (Legs): the exercise removed from above a pair, and the exercise above it linked with the pair, comes back after the three', () => {
    const base = original()
    const gone = removeExercise(base, 'legs', 'e:pe-rdl')
    const linked = linkWithBelow(gone, 'legs', 'e:pe-squat') // Back Squat joins the pair below it
    expect(keysIn(linked, 'legs')).toEqual(['e:pe-squat', 'e:pe-lcurl', 'e:pe-calf'])
    expect(['e:pe-squat', 'e:pe-lcurl', 'e:pe-calf'].map((k) => blockOfKey(linked, 'legs', k))).toEqual(['blk-legs', 'blk-legs', 'blk-legs'])
    // Romanian Deadlift stood at place 1: between Back Squat and Leg Curl, now two members of one superset
    const back = undoRemove(linked, 'e:pe-rdl')
    expect(keysIn(back, 'legs')).toEqual(['e:pe-squat', 'e:pe-lcurl', 'e:pe-calf', 'e:pe-rdl'])
    expect(['e:pe-squat', 'e:pe-lcurl', 'e:pe-calf', 'e:pe-rdl'].map((k) => blockOfKey(back, 'legs', k))).toEqual(['blk-legs', 'blk-legs', 'blk-legs', null])
    accepted(back)
    // and the other workouts are as they were
    expect(keysIn(back, 'push')).toEqual(rowsOf('push'))
  })

  it('a superset that moved over the place since the removal: the exercise comes back after it, not inside it (Pull: Biceps Curl, with the trio moved below Shrug)', () => {
    const gone = removeExercise(original(), 'pull', 'e:pe-bcurl') // the trio, then Shrug; Biceps Curl stood at place 3
    const moved = moveExercise(gone, 'pull', 'e:pe-row', 'down') // the trio is one block: it goes below Shrug
    expect(keysIn(moved, 'pull')).toEqual(['e:pe-shrug', 'e:pe-row', 'e:pe-pd', 'e:pe-face'])
    const back = undoRemove(moved, 'e:pe-bcurl')
    expect(keysIn(back, 'pull')).toEqual(['e:pe-shrug', 'e:pe-row', 'e:pe-pd', 'e:pe-face', 'e:pe-bcurl'])
    accepted(back)
  })

  it('the general case: B removed from A, B, C, D (no superset), A linked with C, then B put back: B comes back after A and C, which are one block now', () => {
    const unlinked = unlinkBlock(original(), 'arms', 'blk-arms') // Cable Curl, Hammer Curl, Dip, Skull Crusher, Wrist Curl: none in a superset
    const gone = removeExercise(unlinked, 'arms', 'e:pe-hammer') // A = Cable Curl, B = Hammer Curl (place 1), C = Dip
    const linked = linkWithBelow(gone, 'arms', 'e:pe-curl') // A and C: Cable Curl and Dip
    expect(keysIn(linked, 'arms')).toEqual(['e:pe-curl', 'e:pe-dip', 'e:pe-skull', 'e:pe-wrist'])
    const block = blockOfKey(linked, 'arms', 'e:pe-curl')
    expect(block).not.toBeNull()
    expect(blockOfKey(linked, 'arms', 'e:pe-dip')).toBe(block)
    const back = undoRemove(linked, 'e:pe-hammer')
    expect(keysIn(back, 'arms')).toEqual(['e:pe-curl', 'e:pe-dip', 'e:pe-hammer', 'e:pe-skull', 'e:pe-wrist'])
    expect(['e:pe-curl', 'e:pe-dip', 'e:pe-hammer'].map((k) => blockOfKey(back, 'arms', k))).toEqual([block, block, null])
    accepted(back)
  })

  // As the code was built: the middle member of a trio comes back last in its block, the first one before the others, the last one after.
  it('a superset’s member goes next to the others: a trio’s middle member comes back last in its block, as it always has', () => {
    const gone = removeExercise(original(), 'pull', 'e:pe-pd')
    expect(keysIn(gone, 'pull')).toEqual(['e:pe-row', 'e:pe-face', 'e:pe-bcurl', 'e:pe-shrug'])
    const back = undoRemove(gone, 'e:pe-pd')
    expect(keysIn(back, 'pull')).toEqual(['e:pe-row', 'e:pe-face', 'e:pe-pd', 'e:pe-bcurl', 'e:pe-shrug'])
    expect(['e:pe-row', 'e:pe-face', 'e:pe-pd'].map((k) => blockOfKey(back, 'pull', k))).toEqual(['blk-pull', 'blk-pull', 'blk-pull'])
    // the first and the last member of the trio go back where they stood
    expect(keysIn(undoRemove(removeExercise(original(), 'pull', 'e:pe-row'), 'e:pe-row'), 'pull')).toEqual(rowsOf('pull'))
    expect(keysIn(undoRemove(removeExercise(original(), 'pull', 'e:pe-face'), 'e:pe-face'), 'pull')).toEqual(rowsOf('pull'))
    accepted(back)
  })

  // The control: UNDO in stack order (the last removed first) puts back the list as it was, whatever was removed, in every workout. The one
  // exception is the middle member of a trio (Pull's Lat Pulldown), which comes back last in its block, in any order (the test above).
  it('UNDO in stack order restores the original list for every way of removing any of the exercises of each workout, a trio’s middle member apart', () => {
    const base = original()
    let ways = 0
    const bad: string[] = []
    for (const wk of UNEVEN_WORKOUTS) {
      const rows = rowsOf(wk.id)
      const visit = (s: DraftState, left: string[], gone: string[]): void => {
        if (gone.length > 0 && !gone.includes('e:pe-pd')) {
          ways++
          const back = [...gone].reverse().reduce((t, k) => undoRemove(t, k), s)
          if (keysIn(back, wk.id).join() !== rows.join() || draftDiffers(back, base)) bad.push(`${wk.id}: removed ${gone.join(' ')} -> ${keysIn(back, wk.id).join(' ')}`)
        }
        for (const k of left) visit(removeExercise(s, wk.id, k), left.filter((x) => x !== k), [...gone, k])
      }
      visit(base, rows, [])
    }
    expect({ bad: bad.slice(0, 3), count: bad.length }).toEqual({ bad: [], count: 0 })
    // the ordered ways of removing one or more of 4 exercises: 4 + 12 + 24 + 24 (Push and Legs, and Pull without Lat Pulldown); of 5: 5 + 20 + 60 + 120 + 120 (Arms)
    expect(ways).toBe(3 * (4 + 12 + 24 + 24) + (5 + 20 + 60 + 120 + 120))
  })

  // ── Where the place falls: tables over every place a removal can have stood in, for lists written out letter by letter ──
  type Layout = ReadonlyArray<readonly [string, string | null]>
  const entry = (key: string, block: string | null): DraftEntry => ({ kind: 'added', exerciseId: `ex-${key}`, supersetBlockId: block, restSeconds: null, restAfterSeconds: null, tempo: null, weightUnit: null, key })
  // A draft of one workout, 'w', holding `layout` in order, and `x` (its key and superset) removed from the place `at`.
  const drafted = (layout: Layout, x: readonly [string, string | null], at: number): DraftState => {
    const base = original()
    return {
      ...base,
      edit: { ...base.edit, workouts: [{ id: 'w', name: 'W', exercises: layout.map(([k, b]) => entry(k, b)), routine: [] }] },
      removed: [{ workoutId: 'w', entry: entry(x[0], x[1]), at }],
    }
  }
  const comesBack = (layout: Layout, x: readonly [string, string | null], at: number): string => keysIn(undoRemove(drafted(layout, x, at), x[0]), 'w').join(' ')

  // two supersets, a b and c d, then two single exercises: the places 0..6 are the seven gaps of the list
  const TWO: Layout = [['a', 'b1'], ['b', 'b1'], ['c', 'b2'], ['d', 'b2'], ['e', null], ['f', null]]
  const FREE_IN_TWO: ReadonlyArray<readonly [number, string]> = [
    [0, 'X a b c d e f'], // before the first superset
    [1, 'a b X c d e f'], // between a and b: after the first superset
    [2, 'a b X c d e f'], // between the two supersets: stays (right after the first, right before the second)
    [3, 'a b c d X e f'], // between c and d: after the second superset
    [4, 'a b c d X e f'], // right after the second superset: stays
    [5, 'a b c d e X f'],
    [6, 'a b c d e f X'],
    [7, 'a b c d e f X'], // the list is shorter now: last
    [99, 'a b c d e f X'],
  ]
  it.each(FREE_IN_TWO)('an exercise in no superset removed from place %i of the list a b | c d | e f comes back: %s', (at, expected) => {
    expect(comesBack(TWO, ['X', null], at)).toBe(expected)
  })

  // a superset's member with its others in the list: next to them, before the first when its place is at or before it, else after the last
  it.each([
    [0, 'a b X c d e f'],
    [1, 'a b X c d e f'], // its place is inside the first superset: it goes to its own (c d), not after the first
    [2, 'a b X c d e f'], // at the first member: before it
    [3, 'a b c d X e f'], // between c and d, its own members: after them
    [4, 'a b c d X e f'],
    [5, 'a b c d X e f'],
    [99, 'a b c d X e f'],
  ] as const)('a member of the second superset removed from place %i comes back next to c d: %s', (at, expected) => {
    const back = undoRemove(drafted(TWO, ['X', 'b2'], at), 'X')
    expect(keysIn(back, 'w').join(' ')).toBe(expected)
    expect(blockOfKey(back, 'w', 'X')).toBe('b2')
  })

  // a member whose superset has no other member in the list now is any other exercise: it must not split a superset it falls inside
  it.each(FREE_IN_TWO)('a member of a superset with no other member in the list, removed from place %i, comes back as any other exercise would: %s', (at, expected) => {
    const back = undoRemove(drafted(TWO, ['X', 'b3'], at), 'X')
    expect(keysIn(back, 'w').join(' ')).toBe(expected)
    expect(blockOfKey(back, 'w', 'X')).toBe('b3')
  })

  it('a member whose superset moved away goes to it, wherever its place is now (even inside another superset)', () => {
    const away: Layout = [['a', 'b1'], ['b', 'b1'], ['e', null], ['f', null], ['c', 'b2'], ['d', 'b2']]
    expect(comesBack(away, ['X', 'b2'], 1)).toBe('a b e f X c d') // place 1 is inside a b, but X belongs with c d
    expect(comesBack(away, ['X', 'b2'], 5)).toBe('a b e f c d X') // place 5 is inside c d, its own: after them
    expect(comesBack(away, ['X', 'b2'], 99)).toBe('a b e f c d X')
  })

  // one superset that is the whole list, and one that is the end of the list
  it.each([
    [0, 'X a b c'],
    [1, 'a b c X'],
    [2, 'a b c X'],
    [3, 'a b c X'],
    [4, 'a b c X'],
  ])('an exercise in no superset removed from place %i of a list that is one superset of three comes back: %s', (at, expected) => {
    expect(comesBack([['a', 'b1'], ['b', 'b1'], ['c', 'b1']], ['X', null], at)).toBe(expected)
  })
  it.each([
    [0, 'X e a b'],
    [1, 'e X a b'],
    [2, 'e a b X'], // between a and b
    [3, 'e a b X'],
  ])('an exercise in no superset removed from place %i of the list e | a b comes back: %s', (at, expected) => {
    expect(comesBack([['e', null], ['a', 'b1'], ['b', 'b1']], ['X', null], at)).toBe(expected)
  })

  // ── Every way of removing, regrouping and putting back ──
  // For each workout: remove any of its exercises (any number, any order), change its supersets once (SUPERSET on an exercise, the toggle
  // between two members, UNLINK, one place up or down), then put the removed back in every order. After every UNDO each superset of the
  // workout is in one piece (read here by plain loops, not by the planner), and every list this ends on is one the planner accepts and the
  // tables take.
  it('every way of removing some of a workout, regrouping it once and putting the removed back in any order leaves each superset in one piece', () => {
    const inOnePiece = (s: DraftState, wid: string): string | null => {
      const list = s.edit.workouts.find((x) => x.id === wid)!.exercises
      for (const b of new Set(list.map((e) => e.supersetBlockId))) {
        if (b === null) continue
        const at = list.flatMap((e, j) => (e.supersetBlockId === b ? [j] : []))
        if (at[at.length - 1] - at[0] + 1 !== at.length) return `${b} at ${at.join(',')}`
      }
      return null
    }
    const regroupings = (s: DraftState, wid: string): DraftState[] => {
      const list = s.edit.workouts.find((x) => x.id === wid)!.exercises
      const content = draftContent(s)
      const made = [s]
      const add = (t: DraftState): void => {
        if (draftContent(t) !== content) made.push(t)
      }
      for (const e of list) {
        add(linkWithBelow(s, wid, e.key))
        add(splitAfter(s, wid, e.key))
        add(moveExercise(s, wid, e.key, 'up'))
        add(moveExercise(s, wid, e.key, 'down'))
      }
      for (const b of new Set(list.map((e) => e.supersetBlockId))) if (b !== null) add(unlinkBlock(s, wid, b))
      return made
    }
    const finals = new Map<string, DraftState>()
    const bad: string[] = []
    let undos = 0
    for (const wk of UNEVEN_WORKOUTS) {
      const putBack = (s: DraftState, left: string[], trace: string): void => {
        if (left.length === 0) {
          finals.set(`${wk.id} ${JSON.stringify(s.edit.workouts.find((x) => x.id === wk.id)!.exercises.map((e) => [e.key, e.supersetBlockId]))}`, s)
          return
        }
        for (const k of left) {
          const t = undoRemove(s, k)
          undos++
          const split = inOnePiece(t, wk.id)
          if (split !== null) bad.push(`${trace} then UNDO ${k}: ${split}`)
          putBack(t, left.filter((x) => x !== k), `${trace} then UNDO ${k}`)
        }
      }
      const remove = (s: DraftState, left: string[], gone: string[]): void => {
        if (gone.length > 0) regroupings(s, wk.id).forEach((t, i) => putBack(t, gone, `${wk.id}: remove ${gone.join(' ')}, regrouping ${i}`))
        for (const k of left) remove(removeExercise(s, wk.id, k), left.filter((x) => x !== k), [...gone, k])
      }
      remove(original(), rowsOf(wk.id), [])
    }
    expect({ bad: bad.slice(0, 3), count: bad.length }).toEqual({ bad: [], count: 0 })
    expect(undos).toBeGreaterThan(100000)
    for (const s of finals.values()) accepted(s)
    expect(finals.size).toBeGreaterThan(100)
  })
})
