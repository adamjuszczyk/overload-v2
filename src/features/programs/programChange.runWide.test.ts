import { describe, it, expect } from 'vitest'
import { draftFromRunCopy, planProgramChange, type ProgramEdit } from './programChange'
import {
  NOW,
  USER,
  type World,
  addExerciseTo,
  applyOpsToDb,
  deletes,
  editExercises,
  editWorkout,
  idGen,
  inputOf,
  inserts,
  onlySessions,
  patchExercise,
  planOf,
  removeExerciseFrom,
  runCopyOf,
  swapExerciseIn,
  updates,
} from './programChange.testutil'
import { stableWorld, weekDependentWorld } from './programChange.worlds.testutil'

// Chunk 45 — the run-wide fields (SPEC [1.2] Programs and runs → "Rest, tempo, unit, superset rests, superset grouping
// and the warmup routine are run-wide: one value, every not-done session"; workout names; Rest [1.2]: "In a run, rest is
// run-wide"). Sessions read all of them live from the run copy, so a save writes the run copy only: the tests assert the
// run copy's rows AND that no session row is named.

const draftOf = (w: World) => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)

describe('an exercise\'s rest, rest after, tempo and unit', () => {
  it('each field is written on the run copy\'s exercise row, and only the fields that changed', () => {
    const w = stableWorld()
    const cases: Array<[Parameters<typeof patchExercise>[3], Record<string, unknown>]> = [
      [{ restSeconds: 120 }, { rest_seconds: 120 }],
      [{ restAfterSeconds: 180 }, { rest_after_seconds: 180 }],
      [{ tempo: '3-1-1-0' }, { tempo: '3-1-1-0' }],
      [{ weightUnit: 'lbs' }, { weight_unit: 'lbs' }],
      [{ weightUnit: 'kg' }, { weight_unit: 'kg' }],
    ]
    for (const [change, patch] of cases) {
      const { ops } = planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', change))
      expect(ops).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-leg', patch }])
    }
  })

  it('all four at once are one update', () => {
    const w = stableWorld()
    const { ops } = planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', { restSeconds: 120, restAfterSeconds: 180, tempo: '3-1-1-0', weightUnit: 'lbs' }))
    expect(ops).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-leg', patch: { rest_seconds: 120, rest_after_seconds: 180, tempo: '3-1-1-0', weight_unit: 'lbs' } }])
  })

  it('a field cleared is written as null (back to the global rest, no tempo, the Settings unit)', () => {
    const w = stableWorld()
    Object.assign(w.db.v2_program_exercises.find((e) => e.id === 'pe-leg')!, { rest_seconds: 90, tempo: '2-0-1-0', weight_unit: 'lbs' })
    const { ops } = planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', { restSeconds: null, tempo: null, weightUnit: null }))
    expect(updates(ops)[0].patch).toEqual({ rest_seconds: null, tempo: null, weight_unit: null })
  })

  it('no session row is named: the sessions read them from the run copy', () => {
    const w = stableWorld()
    const { ops } = planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', { restSeconds: 120, tempo: '3-1-1-0', weightUnit: 'lbs' }))
    expect(onlySessions(ops)).toEqual([])
  })

  it('the same on a week-dependent run', () => {
    const w = weekDependentWorld()
    const { ops } = planOf(w, patchExercise(draftOf(w), 'pull', 'pe-face', { restSeconds: 60, tempo: 'X-0-1-0' }))
    expect(ops).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-face', patch: { rest_seconds: 60, tempo: 'X-0-1-0' } }])
  })

  it('a rest the database would refuse, and a tempo that isn\'t one, are refused here', () => {
    const w = stableWorld()
    for (const change of [{ restSeconds: -1 }, { restSeconds: 90.5 }, { restAfterSeconds: -5 }]) {
      expect(() => planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', change))).toThrow(/rest is whole seconds/)
    }
    for (const tempo of ['3-1-1', '3-1-1-0-0', 'abc', 'x-0-1-0', ' 3-1-1-0', '3-1-1-0 ']) {
      expect(() => planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', { tempo }))).toThrow(/not a tempo/)
    }
  })

  it('a rest of 0 is a rest (no pause), not an error; and the message names the exercise that was wrong', () => {
    const w = stableWorld()
    const { ops } = planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', { restSeconds: 0, restAfterSeconds: 0 }))
    expect(ops).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-leg', patch: { rest_seconds: 0, rest_after_seconds: 0 } }])
    expect(() => planOf(w, patchExercise(draftOf(w), 'fb', 'pe-inc', { restSeconds: -1 }))).toThrow(/workout fb, exercise 2: a rest is whole seconds/)
    expect(() => planOf(w, patchExercise(draftOf(w), 'fb', 'pe-plank', { tempo: 'abc' }))).toThrow(/workout fb, exercise 4: tempo "abc" is not a tempo/)
  })
})

describe('superset blocks — grouping and rests are run-wide', () => {
  it('SUPERSET links an exercise with the one below it: a new block, and the exercise rows name it', () => {
    const w = stableWorld()
    let draft = draftOf(w)
    draft = { ...draft, blocks: [...draft.blocks, { id: 'draft-block', restWithinRoundSeconds: null, restAfterRoundSeconds: 60 }] }
    draft = patchExercise(draft, 'arms', 'pe-curl', { supersetBlockId: 'draft-block' })
    draft = patchExercise(draft, 'arms', 'pe-dip', { supersetBlockId: 'draft-block' })
    const { ops } = planOf(w, draft)
    expect(ops).toEqual([
      { op: 'insert', table: 'v2_program_superset_blocks', row: { id: 'n1', user_id: USER, workout_day_id: 'arms', rest_within_round_seconds: null, rest_after_round_seconds: 60, created_at: NOW } },
      { op: 'update', table: 'v2_program_exercises', id: 'pe-curl', patch: { superset_block_id: 'n1' } },
      { op: 'update', table: 'v2_program_exercises', id: 'pe-dip', patch: { superset_block_id: 'n1' } },
    ])
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('UNLINK splits the whole superset: every member\'s block is cleared (the block row is left, with no members)', () => {
    const w = stableWorld()
    const { ops } = planOf(w, patchExercise(patchExercise(draftOf(w), 'fb', 'pe-lat', { supersetBlockId: null }), 'fb', 'pe-plank', { supersetBlockId: null }))
    expect(ops).toEqual([
      { op: 'update', table: 'v2_program_exercises', id: 'pe-lat', patch: { superset_block_id: null } },
      { op: 'update', table: 'v2_program_exercises', id: 'pe-plank', patch: { superset_block_id: null } },
    ])
  })

  it('the link toggle between members splits a superset there or joins it again', () => {
    const w = stableWorld()
    // a third member, so there is a gap to split at
    w.db.v2_program_exercises.push({ ...w.db.v2_program_exercises.find((e) => e.id === 'pe-plank')!, id: 'pe-third', exercise_id: 'ex-third', position: 4 })
    const split = patchExercise(
      patchExercise({ ...draftOf(w), blocks: [...draftOf(w).blocks, { id: 'second', restWithinRoundSeconds: null, restAfterRoundSeconds: null }] }, 'fb', 'pe-plank', { supersetBlockId: 'second' }),
      'fb',
      'pe-third',
      { supersetBlockId: 'second' },
    )
    const { ops } = planOf(w, split)
    expect(inserts(ops, 'v2_program_superset_blocks')).toHaveLength(1)
    expect(updates(ops, 'v2_program_exercises').map((o) => [o.id, o.patch.superset_block_id])).toEqual([['pe-plank', 'n1'], ['pe-third', 'n1']])
    // and joined again from the other side: the one below takes the block above
    const joined = patchExercise(draftOf(w), 'fb', 'pe-inc', { supersetBlockId: 'blk' })
    expect(planOf(w, joined).ops).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-inc', patch: { superset_block_id: 'blk' } }])
  })

  it('a block\'s rests are written on the block row: within a round and after a round', () => {
    const w = stableWorld()
    const rests = (within: number | null, after: number | null) => ({ ...draftOf(w), blocks: [{ id: 'blk', restWithinRoundSeconds: within, restAfterRoundSeconds: after }] })
    expect(planOf(w, rests(null, 120)).ops).toEqual([{ op: 'update', table: 'v2_program_superset_blocks', id: 'blk', patch: { rest_after_round_seconds: 120 } }])
    expect(planOf(w, rests(30, 90)).ops).toEqual([{ op: 'update', table: 'v2_program_superset_blocks', id: 'blk', patch: { rest_within_round_seconds: 30 } }])
    expect(planOf(w, rests(30, null)).ops).toEqual([{ op: 'update', table: 'v2_program_superset_blocks', id: 'blk', patch: { rest_within_round_seconds: 30, rest_after_round_seconds: null } }])
    expect(planOf(w, rests(null, 90)).ops).toEqual([])
  })

  it('a block no exercise names is not created', () => {
    const w = stableWorld()
    const { ops } = planOf(w, { ...draftOf(w), blocks: [...draftOf(w).blocks, { id: 'unused', restWithinRoundSeconds: 10, restAfterRoundSeconds: 10 }] })
    expect(ops).toEqual([])
  })

  it('a superset\'s grouping and rests change no session', () => {
    const w = stableWorld()
    const draft = { ...patchExercise(draftOf(w), 'fb', 'pe-inc', { supersetBlockId: 'blk' }), blocks: [{ id: 'blk', restWithinRoundSeconds: 30, restAfterRoundSeconds: 120 }] }
    expect(onlySessions(planOf(w, draft).ops)).toEqual([])
  })

  it('refused: a block the draft doesn\'t have, one used in two workouts, members that are not neighbours', () => {
    const w = stableWorld()
    expect(() => planOf(w, patchExercise(draftOf(w), 'arms', 'pe-dip', { supersetBlockId: 'nowhere' }))).toThrow(/not in the draft/)
    expect(() => planOf(w, patchExercise(draftOf(w), 'arms', 'pe-dip', { supersetBlockId: 'blk' }))).toThrow(/used in two workouts/)
    expect(() => planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', { supersetBlockId: 'blk' }))).toThrow(/not next to each other/)
  })

  it('refused: a block listed twice, and a rest on a block that isn\'t whole seconds', () => {
    const w = stableWorld()
    const b = draftOf(w).blocks
    expect(() => planOf(w, { ...draftOf(w), blocks: [...b, ...b] })).toThrow(/twice/)
    expect(() => planOf(w, { ...draftOf(w), blocks: [{ id: 'blk', restWithinRoundSeconds: -1, restAfterRoundSeconds: null }] })).toThrow(/whole seconds/)
  })
})

describe('the warmup routine — items in order, unique by (workout, position)', () => {
  const routine = (w: World, ...items: Array<{ id: string | null; body: string }>) => editWorkout(draftOf(w), 'fb', (wo) => ({ ...wo, routine: items }))
  const R1 = { id: 'fb-r1', body: 'Band pull-aparts' }
  const R2 = { id: 'fb-r2', body: 'Dead hang' }
  const order = (db: ReturnType<typeof applyOpsToDb>) => db.v2_workout_warmup_items.filter((r) => r.workout_day_id === 'fb').sort((a, b) => a.position - b.position).map((r) => r.body)

  it('an item added goes at the end with the next position', () => {
    const w = stableWorld()
    const { ops } = planOf(w, routine(w, R1, R2, { id: null, body: '  Jump rope ' }))
    expect(ops).toEqual([{ op: 'insert', table: 'v2_workout_warmup_items', row: { id: 'n1', user_id: USER, workout_day_id: 'fb', position: 2, body: 'Jump rope' } }])
  })

  it('an item edited in place is a body update on its own row', () => {
    const w = stableWorld()
    expect(planOf(w, routine(w, R1, { id: 'fb-r2', body: 'Dead hang 30 s' })).ops).toEqual([{ op: 'update', table: 'v2_workout_warmup_items', id: 'fb-r2', patch: { body: 'Dead hang 30 s' } }])
  })

  it('an item removed is deleted, and the one after it keeps its position (positions need not be dense)', () => {
    const w = stableWorld()
    const { ops } = planOf(w, routine(w, R2))
    expect(ops).toEqual([{ op: 'delete', table: 'v2_workout_warmup_items', id: 'fb-r1' }])
    expect(order(applyOpsToDb(w.db, ops))).toEqual(['Dead hang'])
  })

  it('MOVE UP / MOVE DOWN swaps two items without ever putting two on one position, which the unique index would refuse', () => {
    const w = stableWorld()
    const { ops } = planOf(w, routine(w, R2, R1))
    // parked above every position in play, then placed: two phases
    expect(ops.map((o) => `${o.op} ${(o as { id: string }).id} ${JSON.stringify((o as { patch?: unknown }).patch)}`)).toEqual([
      'update fb-r2 {"position":2}',
      'update fb-r1 {"position":3}',
      'update fb-r2 {"position":0}',
      'update fb-r1 {"position":1}',
    ])
    expect(order(applyOpsToDb(w.db, ops))).toEqual(['Dead hang', 'Band pull-aparts'])
  })

  it('removing an item and adding one and moving another, in one save, in an order the index allows', () => {
    const w = stableWorld()
    addExtra(w, ['Plank', 'Hip circles'])
    const { ops } = planOf(w, routine(w, { id: 'fb-r4', body: 'Hip circles' }, { id: null, body: 'New first' }, R2, { id: 'fb-r3', body: 'Plank' }))
    const after = applyOpsToDb(w.db, ops)
    expect(order(after)).toEqual(['Hip circles', 'New first', 'Dead hang', 'Plank'])
    expect(deletes(ops).map((o) => o.id)).toEqual(['fb-r1'])
  })

  it('a new item put first takes the others down; its insert comes last, into a place that is free by then', () => {
    const w = stableWorld()
    const { ops } = planOf(w, routine(w, { id: null, body: 'First' }, R1, R2))
    expect(ops[ops.length - 1]).toMatchObject({ op: 'insert', row: { position: 0, body: 'First' } })
    expect(order(applyOpsToDb(w.db, ops))).toEqual(['First', 'Band pull-aparts', 'Dead hang'])
  })

  it('positions that already are what the draft needs are never written: gaps from an older save are left', () => {
    const w = stableWorld()
    w.db.v2_workout_warmup_items.find((r) => r.id === 'fb-r2')!.position = 4
    expect(planOf(w, draftOf(w)).ops).toEqual([])
    expect(planOf(w, routine(w, R1, R2, { id: null, body: 'Last' })).ops).toEqual([
      { op: 'insert', table: 'v2_workout_warmup_items', row: { id: 'n1', user_id: USER, workout_day_id: 'fb', position: 5, body: 'Last' } },
    ])
  })

  it('a blank item, an item that isn\'t this workout\'s, and one listed twice are refused', () => {
    const w = stableWorld()
    expect(() => planOf(w, routine(w, R1, { id: null, body: '   ' }))).toThrow(/can't be blank/)
    expect(() => planOf(w, routine(w, R1, { id: 'arms-r1', body: 'x' }))).toThrow(/not one of its items/)
    expect(() => planOf(w, routine(w, R1, R1))).toThrow(/listed twice/)
  })

  it('a routine edit changes no session, and another workout\'s routine is not touched', () => {
    const w = stableWorld()
    addRoutineTo(w, 'arms', ['Arm circles'])
    const { ops } = planOf(w, routine(w, R2, R1))
    expect(onlySessions(ops)).toEqual([])
    expect(ops.some((o) => 'id' in o && o.id.startsWith('arms'))).toBe(false)
  })
})

describe('workout names — run copy only', () => {
  it('a rename is an update on the workout day, trimmed', () => {
    const w = stableWorld()
    const { ops } = planOf(w, editWorkout(draftOf(w), 'arms', (wo) => ({ ...wo, name: '  Arms and Shoulders ' })))
    expect(ops).toEqual([{ op: 'update', table: 'v2_workout_days', id: 'arms', patch: { name: 'Arms and Shoulders' } }])
    expect(applyOpsToDb(w.db, ops).v2_workout_days.find((d) => d.id === 'arms')!.name).toBe('Arms and Shoulders')
  })

  it('the same name writes nothing; a blank one is refused', () => {
    const w = stableWorld()
    expect(planOf(w, editWorkout(draftOf(w), 'arms', (wo) => ({ ...wo, name: ' Arms ' }))).ops).toEqual([])
    expect(() => planOf(w, editWorkout(draftOf(w), 'arms', (wo) => ({ ...wo, name: '  ' })))).toThrow(/blank/)
  })
})

describe('a draft that is not a draft of this run is refused', () => {
  it('the workouts must be the run\'s, each once', () => {
    const w = stableWorld()
    const d = draftOf(w)
    expect(() => planOf(w, { ...d, workouts: d.workouts.slice(1) })).toThrow(/never added or removed/)
    expect(() => planOf(w, { ...d, workouts: [...d.workouts, d.workouts[0]] })).toThrow(/twice/)
    expect(() => planOf(w, { ...d, workouts: [d.workouts[0], { ...d.workouts[1], id: 'other' }] })).toThrow(/never added or removed/)
  })

  it('an exercise must be one of its workout\'s, used once', () => {
    const w = stableWorld()
    expect(() => planOf(w, editExercises(draftOf(w), 'fb', (l) => [...l, ...l.slice(0, 1)]))).toThrow(/used twice/)
    expect(() => planOf(w, patchExercise(draftOf(w), 'arms', 'pe-curl', { id: 'pe-leg' } as never))).toThrow(/not one of its exercises/)
    expect(() => planOf(w, addExerciseTo(draftOf(w), 'fb', { exerciseId: '' }))).toThrow(/no exercise given/)
  })

  it('an exercise can\'t be kept and swapped at once', () => {
    const w = stableWorld()
    const draft = swapExerciseIn(draftOf(w), 'fb', 'pe-leg', 'ex-x')
    const kept = editExercises(draft, 'fb', (l) => [...l, { ...l[0], kind: 'kept', id: 'pe-leg' } as never])
    expect(() => planOf(w, kept)).toThrow(/used twice/)
  })

  it('the current week must be a whole number from 1', () => {
    const w = stableWorld()
    expect(() => planOf(w, draftOf(w), { currentWeek: 0 })).toThrow(RangeError)
    expect(() => planOf(w, draftOf(w), { currentWeek: 2.5 })).toThrow(RangeError)
  })
})

describe('every op is something 043\'s executor takes', () => {
  // One save that touches every table the module writes.
  function bigEdit(w: World): ProgramEdit {
    let draft = draftOf(w)
    draft = swapExerciseIn(draft, 'fb', 'pe-leg', 'ex-hack')
    draft = removeExerciseFrom(draft, 'fb', 'pe-inc')
    draft = addExerciseTo(draft, 'fb', { exerciseId: 'ex-new', restSeconds: 90, sets: [{ id: null, isWarmup: false, stageKind: null, repMin: 8, repMax: 10, isAmrap: false, restSeconds: null, stageRestSeconds: null, stages: [] }] }, 1)
    draft = patchExercise(draft, 'arms', 'pe-dip', { tempo: '2-0-1-0' })
    draft = editWorkout(draft, 'arms', (wo) => ({ ...wo, name: 'Arms+', routine: [{ id: null, body: 'Arm circles' }] }))
    return { ...draft, schedule: { ...draft.schedule, friday: 'arms' } }
  }

  it('every insert carries the user\'s id and an id of its own, none repeated and none an existing row\'s', () => {
    const w = stableWorld()
    const { ops } = planOf(w, bigEdit(w))
    const made = inserts(ops)
    expect(made.length).toBeGreaterThan(8)
    expect(made.every((o) => o.row.user_id === USER)).toBe(true)
    const ids = made.map((o) => o.row.id)
    expect(new Set(ids).size).toBe(ids.length)
    const existing = new Set(Object.values(w.db).flat().map((r: { id: string }) => r.id))
    expect(ids.every((id) => /^n\d+$/.test(id) && !existing.has(id))).toBe(true)
  })

  it('every id comes from the function the caller gives, and from nowhere else', () => {
    const w = stableWorld()
    let drawn = 0
    const counting = () => `x${++drawn}`
    const { ops } = planProgramChange(inputOf(w, bigEdit(w), { newId: counting }))
    expect(inserts(ops).map((o) => o.row.id).every((id) => /^x\d+$/.test(id))).toBe(true)
    expect(drawn).toBeGreaterThanOrEqual(inserts(ops).length) // an id may be drawn for a row that is never inserted, never fewer
  })

  it('no patch names an id or a user id, and the whole list is plain JSON (no undefined)', () => {
    const w = stableWorld()
    const { ops } = planOf(w, bigEdit(w))
    for (const o of updates(ops)) {
      expect('id' in o.patch).toBe(false)
      expect('user_id' in o.patch).toBe(false)
    }
    expect(JSON.parse(JSON.stringify(ops))).toEqual(ops)
  })

  it('the list runs on the tables as they are: foreign keys, checks and the unique indexes all hold', () => {
    const w = stableWorld()
    expect(() => applyOpsToDb(w.db, planOf(w, bigEdit(w)).ops)).not.toThrow()
    const ww = weekDependentWorld()
    expect(() => applyOpsToDb(ww.db, planOf(ww, swapExerciseIn(addExerciseTo(draftOf(ww), 'pull', { exerciseId: 'ex-new' }), 'pull', 'pe-face', 'ex-x')).ops)).not.toThrow()
  })

  it('the saved program is never touched: no op names one of its rows', () => {
    const w = stableWorld()
    // a saved program with the same shape, which the run was started from
    w.db.v2_programs.push({ id: 'saved', user_id: USER, name: 'STG Full Body', kind: 'saved', schedule_type: 'weekday', planning_type: 'stable', schedule: {} })
    w.db.v2_workout_days.push({ id: 'saved-fb', user_id: USER, program_id: 'saved', name: 'Full Body', position: 0 })
    w.db.v2_program_exercises.push({ ...w.db.v2_program_exercises.find((e) => e.id === 'pe-leg')!, id: 'saved-leg', workout_day_id: 'saved-fb' })
    const before = JSON.stringify([w.db.v2_programs[1], w.db.v2_workout_days[2], w.db.v2_program_exercises.find((e) => e.id === 'saved-leg')])
    const { ops } = planOf(w, bigEdit(w))
    const after = applyOpsToDb(w.db, ops)
    expect(JSON.stringify([after.v2_programs[1], after.v2_workout_days[2], after.v2_program_exercises.find((e) => e.id === 'saved-leg')])).toBe(before)
    expect(ops.some((o) => 'id' in o && (o.id.startsWith('saved') || o.id === 'saved'))).toBe(false)
  })
})

// A routine of extra items for fb: fb-r3, fb-r4 …
function addExtra(w: World, bodies: string[]): void {
  bodies.forEach((body, i) => w.db.v2_workout_warmup_items.push({ id: `fb-r${i + 3}`, user_id: USER, workout_day_id: 'fb', position: 2 + i, body }))
}
function addRoutineTo(w: World, workoutId: string, bodies: string[]): void {
  bodies.forEach((body, i) => w.db.v2_workout_warmup_items.push({ id: `${workoutId}-r${i + 1}`, user_id: USER, workout_day_id: workoutId, position: i, body }))
}
void idGen
