import { describe, expect, it, vi } from 'vitest'
import type { WeightUnit } from '../../types'
import { planProgramChange, type Op } from './programChange'
import { applyOpsToDb, cloneDb, idGen, inputOf, runCopyOf, type World } from './programChange.testutil'
import { UNEVEN_WORKOUTS, unevenWorkoutsWorld } from './programChange.worlds.testutil'
import {
  addExercise,
  addRoutineItem,
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

// The walk is 400 walks of 25 edits: a few seconds, with a timeout far above them.
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
}

let blockCounter = 0

// One random edit: picked from the model's own state, applied to the draft by the draft's function and to the model by plain array
// operations. Returns the new draft and whether the edit changed anything.
function step(s: DraftState, m: Model, r: () => number, n: number): Step & { state: DraftState } {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const w = pick(m.workouts)
  const wid = w.id
  const kind = pick(KINDS)
  const before = JSON.stringify(viewOfModel(m))
  let state = s
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
      // A single exercise (no superset) is put back where it stood, or last when the list is shorter now. Not into the middle of a
      // superset made since: the draft puts it there all the same, and SAVE refuses the result (the builder's report, DECISIONS 176's
      // finding), so the walk leaves those removals where they are rather than pin the place.
      const candidates = m.removed.filter((x) => {
        if (x.entry.block !== null) return false
        const list = m.workouts.find((y) => y.id === x.workoutId)!.exercises
        const at = Math.min(x.at, list.length)
        return !(at > 0 && at < list.length && list[at - 1].block !== null && list[at - 1].block === list[at].block)
      })
      if (candidates.length === 0) return nothing()
      const gone = pick(candidates)
      state = undoRemove(s, gone.entry.key!)
      m.removed.splice(m.removed.indexOf(gone), 1)
      const home = m.workouts.find((x) => x.id === gone.workoutId)!
      home.exercises.splice(Math.min(gone.at, home.exercises.length), 0, gone.entry)
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
  return { kind, changed: JSON.stringify(viewOfModel(m)) !== before, workoutId: wid, state }
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

  it('400 walks of 25 edits: after every edit the draft is the model, and it reached every kind of edit in every workout', () => {
    const w = unevenWorkoutsWorld()
    const reached = new Map<string, number>()
    for (let walk = 0; walk < 400; walk++) {
      const r = rng(walk + 1)
      let s = start(w)
      const m = initialModel()
      blockCounter = 0
      const trace: string[] = []
      for (let n = 0; n < 25; n++) {
        const done = step(s, m, r, walk * 100 + n)
        s = done.state
        trace.push(`${done.kind} in ${done.workoutId}${done.changed ? '' : ' (no change)'}`)
        for (const wk of s.edit.workouts) {
          const blocks = wk.exercises.map((x) => x.supersetBlockId).filter((b): b is string => b !== null)
          for (const b of new Set(blocks)) {
            const places = wk.exercises.map((x, j) => (x.supersetBlockId === b ? j : -1)).filter((j) => j >= 0)
            if (places[places.length - 1] - places[0] + 1 !== places.length) throw new Error(`walk ${walk}: the members of ${b} in ${wk.id} are not next to each other (${places.join(',')}) after: ${trace.join(' | ')}`)
          }
        }
        if (done.changed) reached.set(`${done.kind} in ${done.workoutId}`, (reached.get(`${done.kind} in ${done.workoutId}`) ?? 0) + 1)
        // the whole state, so a write to the wrong place shows whichever place it was
        expect({ walk, n, kind: done.kind, view: viewOfDraft(s) }).toEqual({ walk, n, kind: done.kind, view: viewOfModel(m) })
      }
      // the draft the walk ends on is one the planner accepts and the tables take
      const ops: Op[] = planProgramChange({ ...inputOf(w, s.edit), newId: idGen(`w${walk}-`) }).ops
      applyOpsToDb(cloneDb(w.db), ops)
    }
    // every kind that can change something did, in every workout, many times over
    const missing: string[] = []
    for (const wk of UNEVEN_WORKOUTS) for (const kind of KINDS) if ((reached.get(`${kind} in ${wk.id}`) ?? 0) < 20) missing.push(`${kind} in ${wk.id}: ${reached.get(`${kind} in ${wk.id}`) ?? 0}`)
    expect(missing).toEqual([])
  })
})
