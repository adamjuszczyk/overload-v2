import { describe, expect, it } from 'vitest'
import { planProgramChange, type DraftExercise, type Op } from './programChange'
import { applyOpsToDb, cloneDb, idGen, inputOf, planOf, runCopyOf, type World } from './programChange.testutil'
import { stableWorld, weekDependentWorld } from './programChange.worlds.testutil'
import {
  addExercise,
  addRoutineItem,
  canLinkBelow,
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
  type DraftState,
} from './changeProgramDraft'

// Chunk 51a: the screen's draft and its edits. Every test hands the draft to `planProgramChange` (chunk 45) the way SAVE does,
// on the worlds chunk 45's tests use, and reads what would be written: the draft is only as good as the op list it makes. The
// last tests walk random sequences of edits and demand that every state is one the planner accepts and the database's
// constraints (the stand-in executor models them) let through.

function start(w: World): DraftState {
  return initialDraft(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)
}
const opsOf = (w: World, s: DraftState): Op[] => planOf(w, s.edit).ops
const workoutOf = (s: DraftState, id: string) => s.edit.workouts.find((x) => x.id === id)!
const keysOf = (s: DraftState, id: string) => workoutOf(s, id).exercises.map((e) => e.key)

describe('the draft a screen starts from', () => {
  it.each([
    ['a week-dependent run', weekDependentWorld],
    ['a stable run', stableWorld],
  ])('%s: saving it unchanged writes nothing, and it does not differ from itself', (_name, make) => {
    const w = make()
    const s = start(w)
    expect(opsOf(w, s)).toEqual([])
    expect(draftDiffers(s, start(w))).toBe(false)
  })

  it('gives every exercise and routine item a key of its own, from its row', () => {
    const s = start(weekDependentWorld())
    expect(keysOf(s, 'pull')).toEqual(['e:pe-pd', 'e:pe-face'])
    expect(workoutOf(s, 'pull').routine.map((r) => r.key)).toEqual(['r:pull-r1'])
  })
})

describe('add', () => {
  it('appends a new exercise with the unit as a resolved literal, no sets on a week-dependent run', () => {
    const w = weekDependentWorld()
    const s = addExercise(start(w), 'pull', 'ex-curl', 'lbs')
    const entry = workoutOf(s, 'pull').exercises[2]
    expect(entry).toMatchObject({ kind: 'added', exerciseId: 'ex-curl', weightUnit: 'lbs', supersetBlockId: null, restSeconds: null, tempo: null })
    const ops = opsOf(w, s)
    expect(ops.filter((o) => o.op === 'insert' && o.table === 'v2_program_exercises')).toHaveLength(1)
    expect(ops.some((o) => o.op === 'insert' && o.table === 'v2_program_sets')).toBe(false)
  })

  it('keys two new exercises apart', () => {
    const s = addExercise(addExercise(start(weekDependentWorld()), 'pull', 'ex-a', 'kg'), 'pull', 'ex-b', 'kg')
    const keys = keysOf(s, 'pull')
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('swap', () => {
  it('turns a kept exercise into a swapped one in the same place, keeping its block and clearing the rest', () => {
    const w = stableWorld()
    const before = start(w)
    const s = swapExercise(before, 'fb', 'e:pe-lat', 'ex-new')
    const entry = workoutOf(s, 'fb').exercises.find((e) => e.key === 'e:pe-lat')!
    expect(entry).toMatchObject({ kind: 'swapped', replaces: 'pe-lat', exerciseId: 'ex-new', supersetBlockId: 'blk', restSeconds: null, restAfterSeconds: null, tempo: null, weightUnit: null })
    expect(keysOf(s, 'fb')).toEqual(keysOf(before, 'fb'))
    const inserted = opsOf(w, s).filter((o) => o.op === 'insert' && o.table === 'v2_program_exercises')
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ row: { exercise_id: 'ex-new', replaces_program_exercise_id: 'pe-lat', superset_block_id: 'blk', position: 2 } })
  })

  it('a swap starts with no rest, tempo or unit of its own, whatever the old exercise had', () => {
    const w = weekDependentWorld()
    let s = start(w)
    s = setExerciseRest(s, 'pull', 'e:pe-pd', 'restSeconds', 150)
    s = setExerciseRest(s, 'pull', 'e:pe-pd', 'restAfterSeconds', 60)
    s = setExerciseTempo(s, 'pull', 'e:pe-pd', '3-0-1-0')
    s = setExerciseUnit(s, 'pull', 'e:pe-pd', 'lbs')
    s = swapExercise(s, 'pull', 'e:pe-pd', 'ex-new')
    expect(workoutOf(s, 'pull').exercises[0]).toMatchObject({ kind: 'swapped', restSeconds: null, restAfterSeconds: null, tempo: null, weightUnit: null })
  })

  it('swapping a swapped exercise again changes which exercise it is, nothing else', () => {
    const w = weekDependentWorld()
    const once = swapExercise(start(w), 'pull', 'e:pe-pd', 'ex-one')
    const twice = swapExercise(once, 'pull', 'e:pe-pd', 'ex-two')
    expect(workoutOf(twice, 'pull').exercises[0]).toMatchObject({ kind: 'swapped', replaces: 'pe-pd', exerciseId: 'ex-two' })
  })

  it('swapping a new exercise changes which exercise it is and stays new', () => {
    const added = addExercise(start(weekDependentWorld()), 'pull', 'ex-one', 'kg')
    const key = keysOf(added, 'pull')[2]
    const swapped = swapExercise(added, 'pull', key, 'ex-two')
    expect(workoutOf(swapped, 'pull').exercises[2]).toMatchObject({ kind: 'added', exerciseId: 'ex-two' })
  })
})

describe('remove and UNDO', () => {
  it('a removed exercise leaves the list and is remembered where it stood; UNDO puts it back, and the draft is the original again', () => {
    const w = weekDependentWorld()
    const original = start(w)
    const gone = removeExercise(original, 'pull', 'e:pe-pd')
    expect(keysOf(gone, 'pull')).toEqual(['e:pe-face'])
    expect(gone.removed.map((r) => [r.workoutId, r.entry.key, r.at])).toEqual([['pull', 'e:pe-pd', 0]])
    const removedRow = opsOf(w, gone).filter((o) => o.op === 'update' && o.table === 'v2_program_exercises')
    expect(removedRow).toHaveLength(1)
    expect(removedRow[0]).toMatchObject({ id: 'pe-pd', patch: expect.objectContaining({ removed_at: expect.any(String) }) })
    const back = undoRemove(gone, 'e:pe-pd')
    expect(keysOf(back, 'pull')).toEqual(['e:pe-pd', 'e:pe-face'])
    expect(back.removed).toEqual([])
    expect(draftDiffers(back, original)).toBe(false)
    expect(opsOf(w, back)).toEqual([])
  })

  it('removing an exercise that was only added in this draft forgets it: nothing to undo', () => {
    const added = addExercise(start(weekDependentWorld()), 'pull', 'ex-one', 'kg')
    const gone = removeExercise(added, 'pull', keysOf(added, 'pull')[2])
    expect(gone.removed).toEqual([])
    expect(keysOf(gone, 'pull')).toEqual(['e:pe-pd', 'e:pe-face'])
  })

  it('UNDO of a superset member goes next to the others even after they moved', () => {
    const w = stableWorld()
    const gone = removeExercise(start(w), 'fb', 'e:pe-lat') // blk: lat, plank
    const moved = moveExercise(moveExercise(gone, 'fb', 'e:pe-plank', 'up'), 'fb', 'e:pe-plank', 'up')
    const back = undoRemove(moved, 'e:pe-lat')
    const list = workoutOf(back, 'fb').exercises
    const i = list.findIndex((e) => e.key === 'e:pe-lat')
    const j = list.findIndex((e) => e.key === 'e:pe-plank')
    expect(Math.abs(i - j)).toBe(1)
    expect(() => planOf(w, back.edit)).not.toThrow()
  })

  it('removing a superset member and putting it back with the block gone to one member is still a valid draft', () => {
    const w = stableWorld()
    const gone = removeExercise(start(w), 'fb', 'e:pe-lat')
    expect(() => planOf(w, gone.edit)).not.toThrow()
  })
})

describe('order', () => {
  it('MOVE UP / DOWN moves one exercise a place, a superset as one block', () => {
    const w = stableWorld() // leg, inc, [lat, plank]
    const s = start(w)
    expect(keysOf(moveExercise(s, 'fb', 'e:pe-inc', 'down'), 'fb')).toEqual(['e:pe-leg', 'e:pe-lat', 'e:pe-plank', 'e:pe-inc'])
    expect(keysOf(moveExercise(s, 'fb', 'e:pe-plank', 'up'), 'fb')).toEqual(['e:pe-leg', 'e:pe-lat', 'e:pe-plank', 'e:pe-inc'])
    expect(keysOf(moveExercise(s, 'fb', 'e:pe-leg', 'up'), 'fb')).toEqual(keysOf(s, 'fb'))
    expect(keysOf(moveExercise(s, 'fb', 'e:pe-lat', 'down'), 'fb')).toEqual(keysOf(s, 'fb'))
  })

  it('dragging a unit to another place', () => {
    const w = stableWorld()
    const s = start(w)
    expect(keysOf(moveExerciseToUnit(s, 'fb', 'e:pe-lat', 0), 'fb')).toEqual(['e:pe-lat', 'e:pe-plank', 'e:pe-leg', 'e:pe-inc'])
    expect(keysOf(moveExerciseToUnit(s, 'fb', 'e:pe-leg', 2), 'fb')).toEqual(['e:pe-inc', 'e:pe-lat', 'e:pe-plank', 'e:pe-leg'])
    expect(keysOf(moveExerciseToUnit(s, 'fb', 'e:pe-leg', 9), 'fb')).toEqual(['e:pe-inc', 'e:pe-lat', 'e:pe-plank', 'e:pe-leg'])
    expect(keysOf(moveExerciseToUnit(s, 'fb', 'e:pe-lat', -1), 'fb')).toEqual(['e:pe-lat', 'e:pe-plank', 'e:pe-leg', 'e:pe-inc'])
    expect(moveExerciseToUnit(s, 'fb', 'e:pe-inc', 1)).toEqual(s)
    expect(() => planOf(w, moveExerciseToUnit(s, 'fb', 'e:pe-lat', 0).edit)).not.toThrow()
  })

  it('a reorder reaches the op list as new positions on the run copy', () => {
    const w = weekDependentWorld()
    const ops = opsOf(w, moveExercise(start(w), 'pull', 'e:pe-pd', 'down'))
    const moved = ops.filter((o) => o.op === 'update' && o.table === 'v2_program_exercises')
    expect(moved.map((o) => (o.op === 'update' ? [o.id, (o.patch as { position?: number }).position] : null)).sort()).toEqual([['pe-face', 0], ['pe-pd', 1]])
  })
})

describe('supersets', () => {
  it('SUPERSET links an exercise with the one below it in a new block', () => {
    const w = weekDependentWorld()
    const s = linkWithBelow(start(w), 'pull', 'e:pe-pd')
    const [a, b] = workoutOf(s, 'pull').exercises
    expect(a.supersetBlockId).not.toBeNull()
    expect(a.supersetBlockId).toBe(b.supersetBlockId)
    expect(s.edit.blocks.map((x) => x.id)).toContain(a.supersetBlockId)
    const inserted = opsOf(w, s).filter((o) => o.op === 'insert' && o.table === 'v2_program_superset_blocks')
    expect(inserted).toHaveLength(1)
  })

  it('SUPERSET on the exercise above a superset joins it', () => {
    const w = stableWorld() // leg, inc, [lat, plank]
    const s = linkWithBelow(start(w), 'fb', 'e:pe-inc')
    expect(workoutOf(s, 'fb').exercises.map((e) => e.supersetBlockId)).toEqual([null, 'blk', 'blk', 'blk'])
  })

  it('SUPERSET is offered only where there is an exercise below that is not linked already', () => {
    const w = stableWorld() // leg, inc, [lat, plank]
    const wk = workoutOf(start(w), 'fb')
    expect(canLinkBelow(wk, 'e:pe-leg')).toBe(true)
    expect(canLinkBelow(wk, 'e:pe-lat')).toBe(false) // linked with plank already
    expect(canLinkBelow(wk, 'e:pe-plank')).toBe(false) // last
    const s = start(w)
    expect(linkWithBelow(s, 'fb', 'e:pe-plank')).toBe(s)
  })

  it('the toggle between two members splits there: a lone member goes free, the rest keep the block', () => {
    const w = stableWorld()
    const s = splitAfter(start(w), 'fb', 'e:pe-lat')
    expect(workoutOf(s, 'fb').exercises.map((e) => e.supersetBlockId)).toEqual([null, null, null, null])
    // three members: split after the first leaves the first free and the other two together
    let three = linkWithBelow(start(w), 'fb', 'e:pe-inc') // inc joins blk
    three = splitAfter(three, 'fb', 'e:pe-inc')
    expect(workoutOf(three, 'fb').exercises.map((e) => e.supersetBlockId)).toEqual([null, null, 'blk', 'blk'])
    expect(() => planOf(w, three.edit)).not.toThrow()
  })

  it('UNLINK frees every member', () => {
    const w = stableWorld()
    const s = unlinkBlock(start(w), 'fb', 'blk')
    expect(workoutOf(s, 'fb').exercises.every((e) => e.supersetBlockId === null)).toBe(true)
    const ops = opsOf(w, s)
    expect(ops.filter((o) => o.op === 'update' && o.table === 'v2_program_exercises')).toHaveLength(2)
  })

  it('linking and splitting again leaves the draft as it was', () => {
    const w = weekDependentWorld()
    const original = start(w)
    const back = splitAfter(linkWithBelow(original, 'pull', 'e:pe-pd'), 'pull', 'e:pe-pd')
    expect(draftDiffers(back, original)).toBe(false)
    expect(opsOf(w, back)).toEqual([])
  })

  it('a block rest is changed on the block', () => {
    const w = stableWorld()
    const s = setBlockRest(setBlockRest(start(w), 'blk', 'restWithinRoundSeconds', 15), 'blk', 'restAfterRoundSeconds', null)
    expect(s.edit.blocks.find((b) => b.id === 'blk')).toMatchObject({ restWithinRoundSeconds: 15, restAfterRoundSeconds: null })
    expect(() => setBlockRest(start(w), 'nope', 'restWithinRoundSeconds', 15)).toThrow(RangeError)
    const patch = opsOf(w, s).filter((o) => o.op === 'update' && o.table === 'v2_program_superset_blocks')
    expect(patch).toHaveLength(1)
    expect(patch[0]).toMatchObject({ id: 'blk', patch: { rest_within_round_seconds: 15, rest_after_round_seconds: null } })
  })
})

describe("an exercise's rest, rest after, tempo and unit", () => {
  it('each reaches the run copy row as the column it is', () => {
    const w = weekDependentWorld()
    let s = start(w)
    s = setExerciseRest(s, 'pull', 'e:pe-pd', 'restSeconds', 120)
    s = setExerciseRest(s, 'pull', 'e:pe-pd', 'restAfterSeconds', 45)
    s = setExerciseTempo(s, 'pull', 'e:pe-pd', '3-0-1-0')
    s = setExerciseUnit(s, 'pull', 'e:pe-pd', 'lbs')
    const patch = opsOf(w, s).filter((o) => o.op === 'update' && o.table === 'v2_program_exercises')
    expect(patch).toHaveLength(1)
    expect(patch[0]).toMatchObject({ id: 'pe-pd', patch: { rest_seconds: 120, rest_after_seconds: 45, tempo: '3-0-1-0', weight_unit: 'lbs' } })
  })

  it('refuses a tempo the planner would refuse', () => {
    expect(() => setExerciseTempo(start(weekDependentWorld()), 'pull', 'e:pe-pd', '3-0-1')).toThrow(RangeError)
  })

  it('an unknown exercise is an error, not a silent no-op', () => {
    expect(() => setExerciseRest(start(weekDependentWorld()), 'pull', 'e:nope', 'restSeconds', 30)).toThrow(RangeError)
  })
})

describe('the warmup routine', () => {
  it('add, edit, move and remove', () => {
    const w = stableWorld() // fb: Band pull-aparts, Dead hang
    let s = addRoutineItem(start(w), 'fb', '5 min bike')
    expect(workoutOf(s, 'fb').routine.map((r) => r.body)).toEqual(['Band pull-aparts', 'Dead hang', '5 min bike'])
    s = editRoutineItem(s, 'fb', 'r:fb-r2', 'Dead hang, 45 s')
    s = moveRoutineItem(s, 'fb', 'r:fb-r1', 'down')
    expect(workoutOf(s, 'fb').routine.map((r) => r.body)).toEqual(['Dead hang, 45 s', 'Band pull-aparts', '5 min bike'])
    s = removeRoutineItem(s, 'fb', workoutOf(s, 'fb').routine[2].key)
    expect(workoutOf(s, 'fb').routine.map((r) => r.body)).toEqual(['Dead hang, 45 s', 'Band pull-aparts'])
    expect(moveRoutineItem(s, 'fb', 'r:fb-r1', 'down')).toEqual(s) // last: nothing to do
    expect(() => planOf(w, s.edit)).not.toThrow()
  })
})

describe('does the draft differ?', () => {
  it('a rename does; renaming back does not', () => {
    const w = weekDependentWorld()
    const original = start(w)
    const renamed = renameWorkout(original, 'pull', 'Pull A')
    expect(draftDiffers(renamed, original)).toBe(true)
    expect(draftDiffers(renameWorkout(renamed, 'pull', 'Pull'), original)).toBe(false)
  })

  it('the keys do not count: the same content under other keys is the same draft', () => {
    const original = start(weekDependentWorld())
    const first = addExercise(original, 'pull', 'ex-a', 'kg')
    const again = addExercise(removeExercise(addExercise(original, 'pull', 'ex-a', 'kg'), 'pull', keysOf(first, 'pull')[2]), 'pull', 'ex-a', 'kg')
    expect(keysOf(again, 'pull')[2]).not.toBe(keysOf(first, 'pull')[2])
    expect(draftContent(again)).toEqual(draftContent(first))
    expect(draftDiffers(again, first)).toBe(false)
  })

  it('the keys do not count (removing what was added)', () => {
    const original = start(weekDependentWorld())
    const other = addExercise(original, 'pull', 'ex-a', 'kg') // counter moves, keys are new
    expect(draftContent(other)).not.toEqual(draftContent(original))
    expect(draftContent(removeExercise(other, 'pull', keysOf(other, 'pull')[2]))).toEqual(draftContent(original))
  })
})

// ─── Walks ────────────────────────────────────────────────────────────────────────────────────────────────────────────

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

function randomEdit(s: DraftState, r: () => number, step: number): DraftState {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const wk = pick(s.edit.workouts)
  const ex: DraftExercise & { key: string } | undefined = wk.exercises.length > 0 ? pick(wk.exercises) : undefined
  const kind = Math.floor(r() * 16)
  switch (kind) {
    case 0:
      return addExercise(s, wk.id, `ex-add-${step}`, r() < 0.5 ? 'kg' : 'lbs')
    case 1:
      return ex ? swapExercise(s, wk.id, ex.key, `ex-swap-${step}`) : s
    case 2:
      return ex ? removeExercise(s, wk.id, ex.key) : s
    case 3:
      return s.removed.length > 0 ? undoRemove(s, pick(s.removed).entry.key) : s
    case 4:
    case 5:
      return ex ? moveExercise(s, wk.id, ex.key, r() < 0.5 ? 'up' : 'down') : s
    case 6:
      return ex ? moveExerciseToUnit(s, wk.id, ex.key, Math.floor(r() * 5)) : s
    case 7:
      return ex ? linkWithBelow(s, wk.id, ex.key) : s
    case 8:
      return ex ? splitAfter(s, wk.id, ex.key) : s
    case 9: {
      const blocks = [...new Set(wk.exercises.map((e) => e.supersetBlockId).filter((b): b is string => b !== null))]
      return blocks.length > 0 ? unlinkBlock(s, wk.id, pick(blocks)) : s
    }
    case 10:
      return ex ? setExerciseRest(s, wk.id, ex.key, r() < 0.5 ? 'restSeconds' : 'restAfterSeconds', r() < 0.3 ? null : 15 * (1 + Math.floor(r() * 40))) : s
    case 11:
      return ex ? setExerciseTempo(s, wk.id, ex.key, r() < 0.5 ? null : '3-0-1-0') : s
    case 12:
      return addRoutineItem(s, wk.id, `item ${step}`)
    case 13:
      return wk.routine.length > 0 ? moveRoutineItem(s, wk.id, pick(wk.routine).key, r() < 0.5 ? 'up' : 'down') : s
    case 14:
      return wk.routine.length > 0 ? (r() < 0.5 ? removeRoutineItem(s, wk.id, pick(wk.routine).key) : editRoutineItem(s, wk.id, pick(wk.routine).key, `edited ${step}`)) : s
    default:
      return renameWorkout(s, wk.id, `Name ${step}`)
  }
}

describe.each([
  ['a week-dependent run', weekDependentWorld],
  ['a stable run', stableWorld],
])('random walks on %s', (_name, make) => {
  it('every state of 120 walks of 25 edits is a draft the planner accepts and the tables take', () => {
    const w = make()
    for (let walk = 0; walk < 120; walk++) {
      const r = rng(walk + 1)
      let s = start(w)
      for (let step = 0; step < 25; step++) {
        s = randomEdit(s, r, step)
        let ops: Op[] = []
        try {
          ops = planProgramChange({ ...inputOf(w, s.edit), newId: idGen(`w${walk}s${step}-`) }).ops
          applyOpsToDb(cloneDb(w.db), ops)
          // DECISIONS 157: a save never deletes a run's program or one of its workouts (only week plan rows and routine items).
          if (ops.some((o) => o.op === 'delete' && (o.table === 'v2_programs' || o.table === 'v2_workout_days'))) throw new Error('a delete on programs or workout days')
        } catch (e) {
          throw new Error(`walk ${walk}, step ${step}: ${(e as Error).message}`)
        }
      }
    }
  })
})
