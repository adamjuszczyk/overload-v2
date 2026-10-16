import { describe, it, expect } from 'vitest'
import { draftFromRunCopy, type DraftExercise } from './programChange'
import { moveUnit } from '../../lib/supersetGroups'
import {
  type World,
  NOW,
  addExercise,
  addExerciseTo,
  applyOpsToDb,
  deletes,
  editExercises,
  editSetsOf,
  inserts,
  moveExercise,
  newSet,
  onlyRunCopy,
  onlySessions,
  patchExercise,
  planOf,
  removeExerciseFrom,
  runCopyOf,
  swapExerciseIn,
  updates,
  withReps,
} from './programChange.testutil'
import { sequenceWorld, stableWorld, weekDependentWorld } from './programChange.worlds.testutil'

// Chunk 45 — how exercise-level changes land (SPEC [1.2] Programs and runs → "How a save lands"): added, removed,
// swapped and reordered exercises, on the run copy and on every session that has not started. Each fixture checks the
// ops AND the rows they leave when executed (programChange.testutil.ts's `applyOpsToDb` refuses what the tables refuse).

const draftOf = (w: World) => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)

// A session's exercise rows after the ops, in the order Plan draws them.
const listOf = (db: ReturnType<typeof applyOpsToDb>, planId: string) =>
  db.v2_week_plan_exercises
    .filter((e) => e.week_plan_id === planId)
    .sort((a, b) => a.position - b.position)
    .map((e) => e.program_exercise_id)
const setsOf = (db: ReturnType<typeof applyOpsToDb>, planId: string, exerciseId: string) =>
  db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId && s.program_exercise_id === exerciseId)

describe('removed exercise — "removed with its planned sets from every not-done session"', () => {
  it('stable: the run-copy row gets removed_at (never a delete), each session loses the row and its sets', () => {
    const w = stableWorld()
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'), { statuses: { 'p2-fb': 'done' } })
    expect(onlyRunCopy(ops)).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-inc', patch: { removed_at: '2026-10-15T12:00:00.000Z' } }])
    // only week 3: the done session keeps its plan
    expect(deletes(onlySessions(ops)).map((o) => `${o.op} ${o.table} ${o.id}`)).toEqual([
      'delete v2_week_plan_sets p3-fb-pe-inc-s2',
      'delete v2_week_plan_sets p3-fb-pe-inc-s1',
      'delete v2_week_plan_exercises p3-fb-x-pe-inc',
    ])
    const after = applyOpsToDb(w.db, ops)
    expect(listOf(after, 'p3-fb')).toEqual(['pe-leg', 'pe-lat', 'pe-plank'])
    expect(setsOf(after, 'p3-fb', 'pe-inc')).toEqual([])
    expect(listOf(after, 'p2-fb')).toEqual(['pe-leg', 'pe-inc', 'pe-lat', 'pe-plank']) // done: as planned
    expect(after.v2_program_exercises.find((e) => e.id === 'pe-inc')!.removed_at).toBe('2026-10-15T12:00:00.000Z')
  })

  it('week-dependent: the same rows go, whatever sets the sessions hold', () => {
    const w = weekDependentWorld()
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'pull', 'pe-face'), { statuses: { 'p2-pull': 'in_progress' } })
    expect(updates(ops, 'v2_program_exercises').map((o) => [o.id, o.patch])).toEqual([['pe-face', { removed_at: '2026-10-15T12:00:00.000Z' }]])
    expect(deletes(ops).map((o) => o.id)).toEqual(['p3-pull-pe-face-s2', 'p3-pull-pe-face-s1', 'p3-pull-x-pe-face'])
  })

  it('stages go before their head (the head last), so nothing is left pointing at a head that is gone', () => {
    const w = stableWorld()
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'arms', 'pe-curl'), { statuses: { 'p3-arms': 'done' } })
    const ids = deletes(ops, 'v2_week_plan_sets').map((o) => o.id)
    expect(ids).toEqual(['p2-arms-pe-curl-s2-t1', 'p2-arms-pe-curl-s2', 'p2-arms-pe-curl-s1'])
    expect(applyOpsToDb(w.db, ops).v2_week_plan_sets.filter((s) => s.week_plan_id === 'p2-arms' && s.program_exercise_id === 'pe-curl')).toEqual([])
  })

  it('a head with several stages loses them from the highest index down, then the head', () => {
    const w = stableWorld()
    for (const planId of ['p2-arms', 'p3-arms']) {
      const stage = w.db.v2_week_plan_sets.find((s) => s.id === `${planId}-pe-curl-s2-t1`)!
      w.db.v2_week_plan_sets.push({ ...stage, id: `${planId}-pe-curl-s2-t2`, stage_index: 2 })
    }
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'arms', 'pe-curl'), { statuses: { 'p3-arms': 'done' } })
    expect(deletes(ops, 'v2_week_plan_sets').map((o) => o.id)).toEqual(['p2-arms-pe-curl-s2-t2', 'p2-arms-pe-curl-s2-t1', 'p2-arms-pe-curl-s2', 'p2-arms-pe-curl-s1'])
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('a stage whose head is already missing goes too: nothing of the exercise is left in the session', () => {
    const w = stableWorld()
    w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => s.id !== 'p3-arms-pe-curl-s2') // the head is gone, its stage is not
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'arms', 'pe-curl'), { statuses: { 'p2-arms': 'done' } })
    expect(deletes(ops, 'v2_week_plan_sets').map((o) => o.id)).toEqual(['p3-arms-pe-curl-s2-t1', 'p3-arms-pe-curl-s1'])
  })

  it('removing an exercise leaves the other exercises\' sets exactly as they were, weights included', () => {
    const w = stableWorld()
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-leg'))
    const after = applyOpsToDb(w.db, ops)
    for (const planId of ['p2-fb', 'p3-fb']) {
      for (const id of ['pe-inc', 'pe-lat', 'pe-plank']) {
        expect(setsOf(after, planId, id)).toEqual(setsOf(w.db, planId, id))
      }
    }
  })

  it('a row the session does not have is not asked for: a delete of a missing row would fail the whole save', () => {
    const w = stableWorld()
    w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => !(s.week_plan_id === 'p3-fb' && s.program_exercise_id === 'pe-inc'))
    w.db.v2_week_plan_exercises = w.db.v2_week_plan_exercises.filter((e) => !(e.week_plan_id === 'p3-fb' && e.program_exercise_id === 'pe-inc'))
    const { ops, summary } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'))
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
    expect(ops.some((o) => o.op === 'delete' && o.id.startsWith('p3-fb'))).toBe(false)
    // and a session the save changes nothing in is not listed as changed
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p2-fb'])
  })
})

describe('added exercise — "appended where it was placed, in every not-done session of that workout"', () => {
  const ADDED = { exerciseId: 'ex-new' }

  it('week-dependent: it lands with no sets, as a run-copy row and a row in each session', () => {
    const w = weekDependentWorld()
    const sets = [newSet('8-10'), newSet('8-10')] // the draft names default sets; a week-dependent run "holds no sets"
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'push', { ...ADDED, sets }), { statuses: { 'p2-push': 'done' } })
    expect(inserts(ops, 'v2_program_exercises').map((o) => o.row)).toEqual([
      {
        id: 'n1',
        user_id: 'u-test',
        workout_day_id: 'push',
        exercise_id: 'ex-new',
        position: 1,
        weight_unit: null,
        superset_block_id: null,
        rest_seconds: null,
        rest_after_seconds: null,
        tempo: null,
        week_only: false,
        removed_at: null,
        replaces_program_exercise_id: null,
      },
    ])
    expect(inserts(ops, 'v2_program_sets')).toEqual([]) // no program sets
    expect(inserts(ops, 'v2_week_plan_sets')).toEqual([]) // and no planned sets: "New. It lands in week N with no sets; add them in Plan."
    expect(inserts(ops, 'v2_week_plan_exercises').map((o) => o.row)).toEqual([{ id: 'n2', user_id: 'u-test', week_plan_id: 'p3-push', program_exercise_id: 'n1', position: 1, created_at: NOW }])
    const after = applyOpsToDb(w.db, ops)
    expect(listOf(after, 'p3-push')).toEqual(['pe-bench', 'n1'])
    expect(listOf(after, 'p2-push')).toEqual(['pe-bench']) // done
  })

  it('stable: the default\'s sets, as program sets and as each session\'s sets, linked to them', () => {
    const w = stableWorld()
    const sets = [newSet('8-10'), newSet('8-10', { stageKind: 'dropset', stages: [{ id: null, repMin: 6, repMax: 8, isAmrap: false }] })]
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'arms', { ...ADDED, sets }), { statuses: { 'p2-arms': 'in_progress' } })

    const program = inserts(ops, 'v2_program_sets').map((o) => o.row)
    expect(program).toHaveLength(3) // two heads and a stage
    expect(program.map((r) => [r.position, r.is_warmup, r.stage_kind, r.parent_program_set_id === null ? 'head' : 'stage', r.stage_index, r.rep_min, r.rep_max])).toEqual([
      [1, false, null, 'head', 0, 8, 10],
      [2, false, 'dropset', 'head', 0, 8, 10],
      [2, false, null, 'stage', 1, 6, 8], // a stage shares its head's position
    ])
    expect(program[2].parent_program_set_id).toBe(program[1].id)
    expect(program.every((r) => r.program_exercise_id === inserts(ops, 'v2_program_exercises')[0].row.id)).toBe(true)

    // week 3 only (week 2's Arms is in progress)
    const planned = inserts(ops, 'v2_week_plan_sets').map((o) => o.row)
    expect(planned.map((r) => [r.week_plan_id, r.set_number, r.is_dropset, r.stage_index, r.stage_kind, r.rep_min, r.rep_max])).toEqual([
      ['p3-arms', 1, false, 0, null, 8, 10],
      ['p3-arms', 2, false, 0, 'dropset', 8, 10],
      ['p3-arms', 2, true, 1, null, 6, 8],
    ])
    expect(planned.map((r) => r.program_set_id)).toEqual(program.map((r) => r.id)) // each is linked to its program set
    expect(planned[2].parent_week_plan_set_id).toBe(planned[1].id) // a stage under its head
    // a new set has no weight, no RIR (either end) and no cues, whatever the others in the week carry
    for (const r of planned) expect([r.target_weight, r.target_rir, r.target_rir_max, r.tags]).toEqual([null, null, null, null])
    expect(applyOpsToDb(w.db, ops).v2_week_plan_sets.filter((s) => s.week_plan_id === 'p3-arms' && s.program_exercise_id === inserts(ops, 'v2_program_exercises')[0].row.id)).toHaveLength(3)
  })

  it('stable: a warmup stays a warmup and a staged set with no kind written reads as a dropset, in the default and in each session alike', () => {
    const w = stableWorld()
    const sets = [newSet('12', { isWarmup: true }), newSet('8-10', { stageKind: null, stages: [{ id: null, repMin: 6, repMax: 8, isAmrap: false }] })]
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'arms', { ...ADDED, sets }), { statuses: { 'p2-arms': 'done' } })
    const program = inserts(ops, 'v2_program_sets').map((o) => o.row)
    expect(program.map((r) => [r.is_warmup, r.stage_kind, r.parent_program_set_id === null ? 'head' : 'stage'])).toEqual([
      [true, null, 'head'],
      [false, 'dropset', 'head'],
      [false, null, 'stage'],
    ])
    const planned = inserts(ops, 'v2_week_plan_sets').map((o) => o.row)
    expect(planned.map((r) => [r.week_plan_id, r.is_warmup, r.stage_kind, r.is_dropset])).toEqual([
      ['p3-arms', true, null, false],
      ['p3-arms', false, 'dropset', false],
      ['p3-arms', false, null, true],
    ])
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('stable: a set\'s rest after, a staged set\'s rest between stages and a warmup are written as the draft says', () => {
    const w = stableWorld()
    const sets = [newSet('12', { isWarmup: true, restSeconds: 30 }), newSet('8-10', { restSeconds: 150, stageKind: 'rest_pause', stageRestSeconds: 20, stages: [{ id: null, repMin: null, repMax: null, isAmrap: true }] })]
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'arms', { ...ADDED, sets }), { statuses: { 'p2-arms': 'done', 'p3-arms': 'done' } })
    const program = inserts(ops, 'v2_program_sets').map((o) => o.row)
    expect(program.map((r) => [r.position, r.is_warmup, r.stage_kind, r.rest_seconds, r.stage_rest_seconds, r.is_amrap, r.parent_program_set_id === null])).toEqual([
      [1, true, null, 30, null, false, true],
      [2, false, 'rest_pause', 150, 20, false, true],
      [2, false, null, null, null, true, false], // a stage carries no kind, no stage rest and no rest of its own
    ])
    expect(inserts(ops, 'v2_week_plan_sets')).toEqual([]) // both of the added exercise's sessions are done
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('stable with no sets in the draft: it lands with none, as week-dependent does', () => {
    const w = stableWorld()
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'arms', ADDED))
    expect(inserts(ops, 'v2_program_sets')).toEqual([])
    expect(inserts(ops, 'v2_week_plan_sets')).toEqual([])
    expect(inserts(ops, 'v2_week_plan_exercises')).toHaveLength(2) // weeks 2 and 3
  })

  it('placed in the middle: it takes that place in the run copy and in every session, the rows after it move down', () => {
    const w = stableWorld()
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'fb', { ...ADDED, sets: [newSet('8')] }, 1))
    const after = applyOpsToDb(w.db, ops)
    const added = inserts(ops, 'v2_program_exercises')[0].row.id
    for (const planId of ['p2-fb', 'p3-fb']) expect(listOf(after, planId)).toEqual(['pe-leg', added, 'pe-inc', 'pe-lat', 'pe-plank'])
    const run = after.v2_program_exercises.filter((e) => e.workout_day_id === 'fb' && !e.removed_at).sort((a, b) => a.position - b.position)
    expect(run.map((e) => e.id)).toEqual(['pe-leg', added, 'pe-inc', 'pe-lat', 'pe-plank'])
    expect(new Set(run.map((e) => e.position)).size).toBe(5)
  })

  it('appended at the end it keeps the others\' positions as they are (nothing renumbered)', () => {
    const w = stableWorld()
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'fb', { ...ADDED, sets: [newSet('8')] }))
    expect(updates(ops, 'v2_program_exercises')).toEqual([])
    expect(updates(ops, 'v2_week_plan_exercises')).toEqual([])
    expect(inserts(ops, 'v2_program_exercises')[0].row.position).toBe(4)
    expect(inserts(ops, 'v2_week_plan_exercises').map((o) => o.row.position)).toEqual([4, 4])
  })

  it('two exercises added in one save each get their own row in every session, one after the other', () => {
    const w = stableWorld()
    let d = addExerciseTo(draftOf(w), 'fb', { exerciseId: 'ex-one', sets: [newSet('8')] })
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-two', sets: [newSet('10')] })
    const { ops } = planOf(w, d)
    const [one, two] = inserts(ops, 'v2_program_exercises').map((o) => o.row.id)
    expect([...new Set(inserts(ops, 'v2_week_plan_exercises').map((o) => o.row.id))]).toHaveLength(4) // two exercises in each of two sessions
    const after = applyOpsToDb(w.db, ops) // (a session can't hold one exercise twice: the unique index would refuse it)
    for (const planId of ['p2-fb', 'p3-fb']) expect(listOf(after, planId)).toEqual(['pe-leg', 'pe-inc', 'pe-lat', 'pe-plank', one, two])
    expect(setsOf(after, 'p3-fb', one).map((s) => s.rep_min)).toEqual([8])
    expect(setsOf(after, 'p3-fb', two).map((s) => s.rep_min)).toEqual([10])
  })

  it('an added exercise has the unit, rest and tempo the draft gives it and sits in no superset unless the draft says so', () => {
    const w = stableWorld()
    const draft = addExerciseTo(draftOf(w), 'arms', { ...ADDED, weightUnit: 'lbs', restSeconds: 120, restAfterSeconds: 180, tempo: '3-1-1-0' })
    const row = inserts(planOf(w, draft).ops, 'v2_program_exercises')[0].row
    expect([row.weight_unit, row.rest_seconds, row.rest_after_seconds, row.tempo, row.superset_block_id, row.week_only]).toEqual(['lbs', 120, 180, '3-1-1-0', null, false])
  })

  it('an added exercise can join a superset: the run copy row names the block', () => {
    const w = stableWorld()
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'fb', { ...ADDED, supersetBlockId: 'blk' }, 4))
    expect(inserts(ops, 'v2_program_exercises')[0].row.superset_block_id).toBe('blk')
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })
})

// DECISIONS 143 (Adam, 2026-10-15) and migration 043: a swap inserts a new run-copy row and soft-removes the old one, so the new
// row has to say which row it took the place of (`replaces_program_exercise_id`), or a week-dependent week copied after the save
// can't give the swapped-in exercise the old exercise's sets. The copy itself is proven end to end in
// programChange.copyAfterSave.test.ts; these are the rows the save writes.
describe('swapped exercise — the link: the new row names the row it replaced', () => {
  it.each([
    ['stable', stableWorld, 'fb', 'pe-inc'],
    ['week-dependent', weekDependentWorld, 'pull', 'pe-pd'],
    ['sequence', sequenceWorld, 'a', 'pe-row'],
  ] as const)('%s: the swap\'s insert carries the old row\'s id, and the old row is soft-removed, not deleted, so the link has a row to point at', (_name, make, workout, oldId) => {
    const w = make()
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), workout, oldId, 'ex-new'))
    const made = inserts(ops, 'v2_program_exercises')
    expect(made.map((o) => [o.row.exercise_id, o.row.replaces_program_exercise_id])).toEqual([['ex-new', oldId]])
    expect(updates(ops, 'v2_program_exercises').filter((o) => o.id === oldId).map((o) => o.patch)).toEqual([{ removed_at: NOW }])
    expect(deletes(ops, 'v2_program_exercises')).toEqual([])
    const after = applyOpsToDb(w.db, ops)
    expect(after.v2_program_exercises.find((e) => e.id === made[0].row.id)!.replaces_program_exercise_id).toBe(oldId)
    expect(after.v2_program_exercises.find((e) => e.id === oldId)).toBeDefined()
  })

  it('only a swap links: an added exercise names no row, no kept row is given a link, and a removed one is not linked to anything', () => {
    const w = stableWorld()
    let d = addExerciseTo(draftOf(w), 'fb', { exerciseId: 'ex-new', sets: [newSet('8-10')] })
    d = removeExerciseFrom(d, 'fb', 'pe-plank')
    d = patchExercise(d, 'fb', 'pe-leg', { tempo: '3-0-1-0' })
    const { ops } = planOf(w, d)
    expect(inserts(ops, 'v2_program_exercises').map((o) => o.row.replaces_program_exercise_id)).toEqual([null])
    for (const o of updates(ops, 'v2_program_exercises')) expect(Object.keys(o.patch)).not.toContain('replaces_program_exercise_id')
  })

  it('two swaps in one save: each new row names its own old row', () => {
    const w = stableWorld()
    let d = swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new-a')
    d = swapExerciseIn(d, 'arms', 'pe-dip', 'ex-new-b')
    const { ops } = planOf(w, d)
    expect(
      inserts(ops, 'v2_program_exercises')
        .map((o) => [o.row.exercise_id, o.row.replaces_program_exercise_id])
        .sort(),
    ).toEqual([['ex-new-a', 'pe-inc'], ['ex-new-b', 'pe-dip']])
  })

  it('a swap of a row that was itself a swap names that row (a chain A <- B <- C), not the one before it', () => {
    const w = stableWorld()
    // pe-inc took the place of an older row that a previous save soft-removed
    addExercise(w, 'pe-first', 'fb', 'ex-first', 9, [], { removed_at: '2026-10-01T00:00:00.000Z' })
    w.db.v2_program_exercises.find((e) => e.id === 'pe-inc')!.replaces_program_exercise_id = 'pe-first'
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-third'))
    const made = inserts(ops, 'v2_program_exercises')
    expect(made.map((o) => o.row.replaces_program_exercise_id)).toEqual(['pe-inc'])
    const after = applyOpsToDb(w.db, ops)
    // the chain is intact: C -> B -> A
    const byId = new Map(after.v2_program_exercises.map((e) => [e.id, e]))
    expect(byId.get(made[0].row.id)!.replaces_program_exercise_id).toBe('pe-inc')
    expect(byId.get('pe-inc')!.replaces_program_exercise_id).toBe('pe-first')
  })
})

describe('swapped exercise — "the new exercise takes the old one\'s sets (count, kinds, stages, rep targets); weights, RIR and cues are cleared"', () => {
  it('stable: a new run-copy row at the old position, the old row removed; each session\'s row and sets pointed at the new row, numbers cleared', () => {
    const w = stableWorld()
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new'), { statuses: { 'p2-fb': 'done' } })
    const created = inserts(ops, 'v2_program_exercises')[0].row
    expect([created.workout_day_id, created.exercise_id, created.position, created.week_only, created.replaces_program_exercise_id]).toEqual(['fb', 'ex-new', 1, false, 'pe-inc']) // the old position, and the row it replaced
    expect(updates(ops, 'v2_program_exercises')).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-inc', patch: { removed_at: '2026-10-15T12:00:00.000Z' } }])

    // week 3 only
    expect(updates(ops, 'v2_week_plan_exercises').map((o) => [o.id, o.patch])).toEqual([['p3-fb-x-pe-inc', { program_exercise_id: created.id }]])
    const patches = updates(ops, 'v2_week_plan_sets').map((o) => [o.id, o.patch.program_exercise_id, o.patch.target_weight, o.patch.target_rir, o.patch.target_rir_max, o.patch.tags])
    expect(patches).toEqual([
      ['p3-fb-pe-inc-s1', created.id, null, null, null, null],
      ['p3-fb-pe-inc-s2', created.id, null, null, null, null],
    ])
    expect(deletes(ops)).toEqual([]) // the sets are kept, not re-made
    expect(inserts(ops, 'v2_week_plan_sets')).toEqual([])
  })

  it('counts, kinds, stages and rep targets are not touched: no patch names them', () => {
    const w = stableWorld()
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), 'arms', 'pe-curl', 'ex-new'))
    const named = new Set(updates(ops, 'v2_week_plan_sets').flatMap((o) => Object.keys(o.patch)))
    expect([...named].sort()).toEqual(['program_exercise_id', 'program_set_id', 'tags', 'target_rir', 'target_rir_max', 'target_weight'].sort())
    const after = applyOpsToDb(w.db, ops)
    const created = inserts(ops, 'v2_program_exercises')[0].row.id
    for (const planId of ['p2-arms', 'p3-arms']) {
      const sets = setsOf(after, planId, created).sort((a, b) => a.set_number - b.set_number || a.stage_index - b.stage_index)
      expect(sets.map((s) => [s.set_number, s.stage_index, s.is_dropset, s.stage_kind, s.rep_min, s.rep_max])).toEqual([
        [1, 0, false, null, 10, 12],
        [2, 0, false, 'dropset', 10, 12],
        [2, 1, true, null, 8, 10], // the dropset's stage kept its place under its head
      ])
      expect(sets.every((s) => s.target_weight === null && s.target_rir === null && s.tags === null)).toBe(true)
      expect(setsOf(after, planId, 'pe-curl')).toEqual([])
    }
  })

  it('the weights, RIR and cues of the other exercises in the session stay', () => {
    const w = stableWorld()
    const after = applyOpsToDb(w.db, planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new')).ops)
    for (const planId of ['p2-fb', 'p3-fb']) {
      for (const id of ['pe-leg', 'pe-lat', 'pe-plank']) expect(setsOf(after, planId, id)).toEqual(setsOf(w.db, planId, id))
      expect(setsOf(w.db, planId, 'pe-inc').every((s) => s.target_weight === 60 && s.target_rir === 2)).toBe(true) // the fixture had numbers to clear
    }
  })

  it('stable: the new row has its own copy of the default\'s sets, and each session set points at its copy', () => {
    const w = stableWorld()
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), 'arms', 'pe-curl', 'ex-new'))
    const created = inserts(ops, 'v2_program_exercises')[0].row.id
    const copies = inserts(ops, 'v2_program_sets').map((o) => o.row)
    expect(copies.map((r) => [r.program_exercise_id, r.position, r.stage_index, r.stage_kind, r.rep_min, r.rep_max])).toEqual([
      [created, 1, 0, null, 10, 12],
      [created, 2, 0, 'dropset', 10, 12],
      [created, 2, 1, null, 8, 10],
    ])
    expect(copies[2].parent_program_set_id).toBe(copies[1].id)
    const after = applyOpsToDb(w.db, ops)
    const linked = setsOf(after, 'p3-arms', created).sort((a, b) => a.set_number - b.set_number || a.stage_index - b.stage_index)
    expect(linked.map((s) => s.program_set_id)).toEqual(copies.map((r) => r.id)) // by position, stages under their head
    // the run copy's old row and its sets are still there, only not part of the run any more
    expect(after.v2_program_sets.filter((s) => s.program_exercise_id === 'pe-curl' && !s.removed_at)).toHaveLength(3)
  })

  it('a session that does not have the exercise is skipped by a swap: nothing is written to it, and the save still lands', () => {
    const w = stableWorld()
    w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => !(s.week_plan_id === 'p3-fb' && s.program_exercise_id === 'pe-inc'))
    w.db.v2_week_plan_exercises = w.db.v2_week_plan_exercises.filter((e) => !(e.week_plan_id === 'p3-fb' && e.program_exercise_id === 'pe-inc'))
    const { ops, summary } = planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new'))
    expect(ops.some((o) => 'id' in o && o.id.startsWith('p3-fb'))).toBe(false)
    expect(inserts(ops, 'v2_week_plan_exercises')).toEqual([])
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p2-fb'])
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('stable: a swap whose draft names no sets takes the old exercise\'s default as it is', () => {
    const w = stableWorld()
    const noSets = editExercises(swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new'), 'fb', (list) =>
      list.map((e) => {
        if (e.kind !== 'swapped') return e
        const { sets: _sets, ...rest } = e
        void _sets
        return rest as DraftExercise
      }),
    )
    expect(noSets.workouts.find((x) => x.id === 'fb')!.exercises[1]).not.toHaveProperty('sets')
    const { ops } = planOf(w, noSets)
    expect(inserts(ops, 'v2_program_sets').map((o) => [o.row.position, o.row.rep_min, o.row.rep_max])).toEqual([[1, 8, 10], [2, 8, 10]]) // Incline's two sets of 8-10
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('stable: a set added to a session for that week only has no program set of its own exercise: no link', () => {
    const w = stableWorld()
    w.db.v2_week_plan_sets.push({ ...w.db.v2_week_plan_sets.find((s) => s.id === 'p3-fb-pe-inc-s2')!, id: 'extra', set_number: 3, program_set_id: null })
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new'))
    const extra = updates(ops, 'v2_week_plan_sets').find((o) => o.id === 'extra')!
    expect(extra.patch.program_exercise_id).toBe(inserts(ops, 'v2_program_exercises')[0].row.id)
    expect('program_set_id' in extra.patch).toBe(false) // it had none and gets none
  })

  it('stable: a set that names a program set the default has dropped is nobody\'s copy: the swap clears its link too', () => {
    const w = stableWorld()
    w.db.v2_program_sets.push({ ...w.db.v2_program_sets.find((s) => s.id === 'pe-inc-s2')!, id: 'pe-inc-old', position: 3, removed_at: '2026-10-01T00:00:00.000Z' })
    w.db.v2_week_plan_sets.push({ ...w.db.v2_week_plan_sets.find((s) => s.id === 'p3-fb-pe-inc-s2')!, id: 'extra', set_number: 3, program_set_id: 'pe-inc-old' })
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new'))
    expect(updates(ops, 'v2_week_plan_sets').find((o) => o.id === 'extra')!.patch.program_set_id).toBeNull()
    expect(applyOpsToDb(w.db, ops).v2_week_plan_sets.find((s) => s.id === 'extra')!.program_set_id).toBeNull()
  })

  it('week-dependent: sets re-pointed and cleared, no program set made and no link written (a week-dependent run holds no sets)', () => {
    const w = weekDependentWorld()
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), 'pull', 'pe-pd', 'ex-new'), { statuses: { 'p2-pull': 'done' } })
    const created = inserts(ops, 'v2_program_exercises')[0].row.id
    expect(inserts(ops, 'v2_program_sets')).toEqual([])
    const patches = updates(ops, 'v2_week_plan_sets')
    expect(patches.map((o) => o.id)).toEqual(['p3-pull-pe-pd-s1', 'p3-pull-pe-pd-s2', 'p3-pull-pe-pd-s3', 'p3-pull-pe-pd-s3-t1'])
    for (const o of patches) {
      expect(o.patch).toEqual({ program_exercise_id: created, target_weight: null, target_rir: null, target_rir_max: null, tags: null })
    }
    expect(patches).toHaveLength(4) // warmup, working set, dropset head and its stage
    const after = applyOpsToDb(w.db, ops)
    expect(setsOf(after, 'p3-pull', created).map((s) => [s.set_number, s.stage_index, s.is_warmup, s.stage_kind, s.rep_min, s.rep_max, s.is_amrap])).toEqual([
      [1, 0, true, null, 12, 12, false],
      [2, 0, false, null, 8, 10, false],
      [3, 0, false, 'dropset', 8, 10, false],
      [3, 1, false, null, null, null, true],
    ])
  })

  it('a swapped exercise keeps the old row\'s superset block; its rest, tempo and unit are the draft\'s (a swap clears them)', () => {
    const w = stableWorld()
    const rest = patchExercise(draftOf(w), 'fb', 'pe-lat', { restSeconds: 120, tempo: '3-1-1-0', weightUnit: 'lbs' })
    const { ops } = planOf(w, swapExerciseIn(rest, 'fb', 'pe-lat', 'ex-new'))
    const created = inserts(ops, 'v2_program_exercises')[0].row
    expect([created.superset_block_id, created.rest_seconds, created.rest_after_seconds, created.tempo, created.weight_unit]).toEqual(['blk', null, null, null, null])
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })

  it('swapped and then given a tempo in the same edit: the new row has it', () => {
    const w = stableWorld()
    const swapped = swapExerciseIn(draftOf(w), 'fb', 'pe-leg', 'ex-new')
    const { ops } = planOf(w, patchExercise(swapped, 'fb', 'pe-leg', { tempo: '4-0-1-0' }))
    expect(inserts(ops, 'v2_program_exercises')[0].row.tempo).toBe('4-0-1-0')
  })

  it('the new row takes the old row\'s own position, whatever the positions are: nothing else is renumbered', () => {
    const w = stableWorld()
    const at = { 'pe-leg': 0, 'pe-inc': 5, 'pe-lat': 7, 'pe-plank': 8 } as Record<string, number> // not dense
    for (const e of w.db.v2_program_exercises) if (e.workout_day_id === 'fb') e.position = at[e.id]
    for (const e of w.db.v2_week_plan_exercises) if (e.week_plan_id.endsWith('-fb')) e.position = at[e.program_exercise_id]
    const { ops } = planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new'))
    expect(inserts(ops, 'v2_program_exercises')[0].row.position).toBe(5)
    expect(updates(ops, 'v2_program_exercises').map((o) => o.id)).toEqual(['pe-inc']) // only the removal stamp
    expect(updates(ops, 'v2_week_plan_exercises').every((o) => Object.keys(o.patch).join() === 'program_exercise_id')).toBe(true)
  })

  it('swapped and its default edited in the same save: a set the draft drops goes from the session, a set it adds comes after', () => {
    const w = stableWorld()
    const swapped = swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new')
    const swappedEntry = swapped.workouts.find((x) => x.id === 'fb')!.exercises[1] as DraftExercise
    const sets = draftOf(w).workouts.find((x) => x.id === 'fb')!.exercises[1].sets!
    const dropFirst = patchExercise(swapped, 'fb', 'pe-inc', { sets: sets.slice(1) } as Partial<DraftExercise>)
    expect(swappedEntry.kind).toBe('swapped')
    const { ops } = planOf(w, dropFirst)
    expect(deletes(ops, 'v2_week_plan_sets').map((o) => o.id)).toEqual(['p2-fb-pe-inc-s1', 'p3-fb-pe-inc-s1'])
    expect(updates(ops, 'v2_week_plan_sets').some((o) => o.id === 'p3-fb-pe-inc-s1')).toBe(false) // gone, so nothing is written to it
    const added = patchExercise(swapped, 'fb', 'pe-inc', { sets: [...sets, newSet('12')] } as Partial<DraftExercise>)
    const next = planOf(w, added).ops
    expect(inserts(next, 'v2_week_plan_sets').map((o) => [o.row.week_plan_id, o.row.set_number, o.row.program_exercise_id === inserts(next, 'v2_program_exercises')[0].row.id])).toEqual([
      ['p2-fb', 3, true],
      ['p3-fb', 3, true],
    ])
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
    expect(() => applyOpsToDb(w.db, next)).not.toThrow()
  })

  it('a swap is not "remove one, add one": the same edit made that way carries no sets over', () => {
    const w = stableWorld()
    const asSwap = planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-leg', 'ex-new')).ops
    const asRemoveAdd = planOf(w, addExerciseTo(removeExerciseFrom(draftOf(w), 'fb', 'pe-leg'), 'fb', { exerciseId: 'ex-new' }, 0)).ops
    expect(updates(asSwap, 'v2_week_plan_sets').length).toBeGreaterThan(0)
    expect(updates(asRemoveAdd, 'v2_week_plan_sets')).toEqual([])
    expect(deletes(asRemoveAdd, 'v2_week_plan_sets').length).toBeGreaterThan(0)
  })
})

describe('reordered exercises — "the new order applies to every not-done session"; "a superset moves as one block"', () => {
  it('moving Incline Dumbbell Press first: the run copy and each session take the order, and rows no one moved keep their numbers\' order', () => {
    const w = stableWorld()
    const { ops } = planOf(w, moveExercise(draftOf(w), 'fb', 1, 0), { statuses: { 'p2-fb': 'done' } })
    const after = applyOpsToDb(w.db, ops)
    expect(listOf(after, 'p3-fb')).toEqual(['pe-inc', 'pe-leg', 'pe-lat', 'pe-plank'])
    expect(listOf(after, 'p2-fb')).toEqual(['pe-leg', 'pe-inc', 'pe-lat', 'pe-plank']) // done
    const run = after.v2_program_exercises.filter((e) => e.workout_day_id === 'fb').sort((a, b) => a.position - b.position)
    expect(run.map((e) => e.id)).toEqual(['pe-inc', 'pe-leg', 'pe-lat', 'pe-plank'])
    expect(inserts(ops)).toEqual([]) // positions only
    expect(deletes(ops)).toEqual([])
  })

  it('a superset moves as one block: its members stay next to each other, in the same order, in every session', () => {
    const w = stableWorld()
    const items = draftOf(w).workouts.find((x) => x.id === 'fb')!.exercises.map((e) => ({ ...e, id: (e as { id: string }).id }))
    // supersetGroups.ts's moveUnit is what a screen moves a card with: Lat Pulldown is in the block with Plank
    const moved = moveUnit(items, 2, 'up') as unknown as DraftExercise[]
    expect(moved.map((e) => (e as { id: string }).id)).toEqual(['pe-leg', 'pe-lat', 'pe-plank', 'pe-inc'])
    const { ops } = planOf(w, editExercises(draftOf(w), 'fb', () => moved))
    const after = applyOpsToDb(w.db, ops)
    for (const planId of ['p2-fb', 'p3-fb']) expect(listOf(after, planId)).toEqual(['pe-leg', 'pe-lat', 'pe-plank', 'pe-inc'])
    const blockMembers = after.v2_week_plan_exercises.filter((e) => e.week_plan_id === 'p3-fb' && ['pe-lat', 'pe-plank'].includes(e.program_exercise_id)).map((e) => e.position).sort()
    expect(blockMembers[1] - blockMembers[0]).toBe(1)
  })

  it('an exercise added in the same save as a move lands at its place in the draft order, in every session that has not started', () => {
    const w = stableWorld()
    let d = moveExercise(draftOf(w), 'fb', 1, 0) // Incline, Leg Press, Lat Pulldown, Plank
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-new', sets: [newSet('8')] }, 2) // Incline, Leg Press, NEW, Lat Pulldown, Plank
    const { ops } = planOf(w, d, { statuses: { 'p2-fb': 'done' } })
    const after = applyOpsToDb(w.db, ops)
    const added = inserts(ops, 'v2_program_exercises')[0].row.id
    expect(listOf(after, 'p3-fb')).toEqual(['pe-inc', 'pe-leg', added, 'pe-lat', 'pe-plank'])
    expect(listOf(after, 'p2-fb')).toEqual(['pe-leg', 'pe-inc', 'pe-lat', 'pe-plank']) // done: as planned
    expect(inserts(ops, 'v2_week_plan_exercises').map((o) => [o.row.week_plan_id, o.row.program_exercise_id])).toEqual([['p3-fb', added]])
    expect(setsOf(after, 'p3-fb', added)).toHaveLength(1)
    const run = after.v2_program_exercises.filter((e) => e.workout_day_id === 'fb' && !e.removed_at).sort((a, b) => a.position - b.position)
    expect(run.map((e) => e.id)).toEqual(['pe-inc', 'pe-leg', added, 'pe-lat', 'pe-plank'])
  })

  it('a session that lacks an exercise the draft moves is skipped over, and an exercise added next to it still lands in the right place', () => {
    const w = stableWorld()
    w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => !(s.week_plan_id === 'p3-fb' && s.program_exercise_id === 'pe-inc'))
    w.db.v2_week_plan_exercises = w.db.v2_week_plan_exercises.filter((e) => !(e.week_plan_id === 'p3-fb' && e.program_exercise_id === 'pe-inc'))
    let d = moveExercise(draftOf(w), 'fb', 1, 0) // Incline, Leg Press, Lat Pulldown, Plank
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-new' }, 1) // Incline, NEW, Leg Press, Lat Pulldown, Plank
    const { ops } = planOf(w, d)
    const after = applyOpsToDb(w.db, ops)
    const added = inserts(ops, 'v2_program_exercises')[0].row.id
    expect(listOf(after, 'p3-fb')).toEqual([added, 'pe-leg', 'pe-lat', 'pe-plank']) // no Incline here
    expect(listOf(after, 'p2-fb')).toEqual(['pe-inc', added, 'pe-leg', 'pe-lat', 'pe-plank'])
  })

  it('a draft that splits a superset is refused: the members of a block are next to each other', () => {
    const w = stableWorld()
    const split = moveExercise(draftOf(w), 'fb', 3, 0) // Plank away from Lat Pulldown
    expect(() => planOf(w, split)).toThrow(/not next to each other/)
  })

  it('a reorder alone writes positions and nothing else, on the run copy and on each session', () => {
    const w = weekDependentWorld()
    const { ops } = planOf(w, moveExercise(draftOf(w), 'pull', 0, 1))
    expect(new Set(ops.map((o) => `${o.op} ${o.table}`))).toEqual(new Set(['update v2_program_exercises', 'update v2_week_plan_exercises']))
    for (const o of updates(ops)) expect(Object.keys(o.patch)).toEqual(['position'])
  })

  it('a row a session holds that the run copy doesn\'t list (1.1\'s week-only exercise) keeps its place after the rows this save orders', () => {
    const w = stableWorld()
    w.db.v2_program_exercises.push({ ...w.db.v2_program_exercises.find((e) => e.id === 'pe-leg')!, id: 'pe-weekonly', week_only: true, position: 9 })
    w.db.v2_week_plan_exercises.push({ id: 'p3-fb-x-weekonly', user_id: 'u-test', week_plan_id: 'p3-fb', program_exercise_id: 'pe-weekonly', position: 9 })
    const { ops } = planOf(w, moveExercise(draftOf(w), 'fb', 1, 0))
    const after = applyOpsToDb(w.db, ops)
    expect(listOf(after, 'p3-fb')).toEqual(['pe-inc', 'pe-leg', 'pe-lat', 'pe-plank', 'pe-weekonly'])
    expect(deletes(ops)).toEqual([]) // and it is not removed
  })

  it('and when that row sat among the others, it still ends up after the rows this save orders', () => {
    const w = stableWorld()
    w.db.v2_program_exercises.push({ ...w.db.v2_program_exercises.find((e) => e.id === 'pe-leg')!, id: 'pe-weekonly', week_only: true, position: 9 })
    const at = { 'pe-leg': 0, 'pe-inc': 1, 'pe-weekonly': 2, 'pe-lat': 3, 'pe-plank': 4 } as Record<string, number> // 1.1's week-only row in the middle of week 3
    for (const e of w.db.v2_week_plan_exercises) if (e.week_plan_id === 'p3-fb') e.position = at[e.program_exercise_id]
    w.db.v2_week_plan_exercises.push({ id: 'p3-fb-x-weekonly', user_id: 'u-test', week_plan_id: 'p3-fb', program_exercise_id: 'pe-weekonly', position: 2 })
    const { ops } = planOf(w, moveExercise(draftOf(w), 'fb', 1, 0))
    expect(listOf(applyOpsToDb(w.db, ops), 'p3-fb')).toEqual(['pe-inc', 'pe-leg', 'pe-lat', 'pe-plank', 'pe-weekonly'])
  })

  it('nothing changed in the order: no op at all', () => {
    const w = stableWorld()
    expect(planOf(w, draftOf(w)).ops).toEqual([])
  })
})

describe('a session that has its own order (a week planned in 1.1 and reordered in the week)', () => {
  // Week 3's Full Body was reordered by itself: Lat Pulldown, Leg Press, Incline, Plank. The run copy says Leg Press first.
  function ownOrder(): World {
    const w = stableWorld()
    const at = { 'pe-lat': 0, 'pe-leg': 1, 'pe-inc': 2, 'pe-plank': 3 } as Record<string, number>
    for (const e of w.db.v2_week_plan_exercises) if (e.week_plan_id === 'p3-fb') e.position = at[e.program_exercise_id]
    return w
  }

  it('a save that moves nothing leaves the session\'s own order alone: a removal drops the row and renumbers nothing', () => {
    const w = ownOrder()
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'))
    expect(updates(ops, 'v2_week_plan_exercises')).toEqual([])
    expect(listOf(applyOpsToDb(w.db, ops), 'p3-fb')).toEqual(['pe-lat', 'pe-leg', 'pe-plank'])
    expect(listOf(applyOpsToDb(w.db, ops), 'p2-fb')).toEqual(['pe-leg', 'pe-lat', 'pe-plank']) // the one that mirrors the run copy
  })

  it('an added exercise goes after the row of the exercise before it in the draft, whatever order the session has', () => {
    const w = ownOrder()
    const end = applyOpsToDb(w.db, planOf(w, addExerciseTo(draftOf(w), 'fb', { exerciseId: 'ex-new' })).ops)
    const added = (db: ReturnType<typeof applyOpsToDb>) => db.v2_program_exercises.find((e) => e.exercise_id === 'ex-new')!.id
    expect(listOf(end, 'p3-fb')).toEqual(['pe-lat', 'pe-leg', 'pe-inc', 'pe-plank', added(end)]) // after Plank, the last in the draft
    const middle = applyOpsToDb(w.db, planOf(w, addExerciseTo(draftOf(w), 'fb', { exerciseId: 'ex-new' }, 1)).ops)
    expect(listOf(middle, 'p3-fb')).toEqual(['pe-lat', 'pe-leg', added(middle), 'pe-inc', 'pe-plank']) // after Leg Press, which the draft puts first
    const top = applyOpsToDb(w.db, planOf(w, addExerciseTo(draftOf(w), 'fb', { exerciseId: 'ex-new' }, 0)).ops)
    expect(listOf(top, 'p3-fb')[0]).toBe(added(top)) // nothing before it in the draft: first
  })

  it('an exercise the session lacks is skipped when looking for what comes before: the next one before it that it has', () => {
    const w = ownOrder()
    w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => !(s.week_plan_id === 'p3-fb' && s.program_exercise_id === 'pe-leg'))
    w.db.v2_week_plan_exercises = w.db.v2_week_plan_exercises.filter((e) => !(e.week_plan_id === 'p3-fb' && e.program_exercise_id === 'pe-leg'))
    const after = applyOpsToDb(w.db, planOf(w, addExerciseTo(draftOf(w), 'fb', { exerciseId: 'ex-new' }, 2)).ops) // after Incline in the draft
    expect(listOf(after, 'p3-fb')).toEqual(['pe-lat', 'pe-inc', after.v2_program_exercises.find((e) => e.exercise_id === 'ex-new')!.id, 'pe-plank'])
  })

  it('a save that does move an exercise puts the rows in the draft\'s order: "the new order applies to every not-done session"', () => {
    const w = ownOrder()
    const after = applyOpsToDb(w.db, planOf(w, moveExercise(draftOf(w), 'fb', 1, 0)).ops)
    expect(listOf(after, 'p3-fb')).toEqual(['pe-inc', 'pe-leg', 'pe-lat', 'pe-plank'])
  })

  it('a swap keeps its row\'s place in the session', () => {
    const w = ownOrder()
    const after = applyOpsToDb(w.db, planOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-inc', 'ex-new')).ops)
    expect(listOf(after, 'p3-fb')).toEqual(['pe-lat', 'pe-leg', after.v2_program_exercises.find((e) => e.exercise_id === 'ex-new')!.id, 'pe-plank'])
  })
})

describe('positions that tie (a list some other writer numbered badly)', () => {
  it('a list nobody changed is left alone; one that has to change anyway is numbered afresh, tied rows in the order they came', () => {
    const w = stableWorld()
    w.db.v2_program_exercises.find((e) => e.id === 'pe-lat')!.position = 1 // 0, 1, 1, 3: Lat Pulldown ties with Incline
    w.db.v2_program_exercises.find((e) => e.id === 'pe-plank')!.position = 3
    expect(planOf(w, draftOf(w)).ops).toEqual([])
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-plank'))
    expect(updates(ops, 'v2_program_exercises').filter((o) => o.patch.position !== undefined).map((o) => [o.id, o.patch.position])).toEqual([['pe-lat', 2]])
  })

  it('the same in a session: a save that changes only the default\'s sets leaves a tie alone; one that drops a row numbers the rest afresh', () => {
    const w = stableWorld()
    for (const e of w.db.v2_week_plan_exercises) if (e.week_plan_id === 'p3-fb') e.position = { 'pe-leg': 0, 'pe-inc': 1, 'pe-lat': 1, 'pe-plank': 3 }[e.program_exercise_id]! // Lat ties with Incline
    const shapeOnly = planOf(w, editSetsOf(draftOf(w), 'fb', 'pe-inc', (sets) => sets.map((s, i) => (i === 0 ? withReps(s, '6-8') : s))))
    expect(updates(shapeOnly.ops, 'v2_week_plan_sets').length).toBeGreaterThan(0) // the save did something in the session
    expect(updates(shapeOnly.ops, 'v2_week_plan_exercises')).toEqual([])
    const drop = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-plank'))
    expect(updates(drop.ops, 'v2_week_plan_exercises').map((o) => [o.id, o.patch.position])).toEqual([['p3-fb-x-pe-lat', 2]])
  })
})

describe('several exercise changes in one save', () => {
  it('swap + remove + add + move in one workout land together and leave rows the database accepts', () => {
    const w = stableWorld()
    let draft = draftOf(w)
    draft = swapExerciseIn(draft, 'fb', 'pe-leg', 'ex-hack')
    draft = removeExerciseFrom(draft, 'fb', 'pe-inc')
    draft = addExerciseTo(draft, 'fb', { exerciseId: 'ex-new', sets: [newSet('12-15')] }, 1)
    const { ops } = planOf(w, draft, { statuses: { 'p2-fb': 'in_progress' } })
    const after = applyOpsToDb(w.db, ops)
    const swapped = inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === 'ex-hack')!.row.id
    const added = inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === 'ex-new')!.row.id
    expect(listOf(after, 'p3-fb')).toEqual([swapped, added, 'pe-lat', 'pe-plank'])
    expect(listOf(after, 'p2-fb')).toEqual(['pe-leg', 'pe-inc', 'pe-lat', 'pe-plank']) // in progress: as it is
  })
})
