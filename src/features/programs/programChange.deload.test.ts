import { describe, it, expect, vi } from 'vitest'
import { draftFromRunCopy, planProgramChange, type Op, type ProgramEdit, type SavedPlanSet } from './programChange'
import {
  type Db,
  type World,
  addExerciseTo,
  applyOpsToDb,
  deepFreeze,
  editSetsOf,
  idGen,
  inputOf,
  inserts,
  moveExercise,
  newSet,
  patchExercise,
  planOf,
  planSession,
  removeExerciseFrom,
  runCopyOf,
  swapExerciseIn,
  updates,
  weekSetOf,
  withReps,
} from './programChange.testutil'
import { asEntries, compareEntries, markDeload, shapeOf, unmarkDeload } from './programChange.deload.testutil'
import { sequenceWorld, stableWorld, weekDependentWorld } from './programChange.worlds.testutil'

// weekPlanService.ts imports the real Supabase client when it loads; nothing here reaches it (every write goes through
// the helper's injected ops).
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

// DECISIONS 142 (Adam, 2026-10-15): "A CHANGE THE PROGRAM save also applies its landing rules to the saved pre-deload copy
// of a not-started deload session, so UNMARK restores the plan with the change in it. Migration 043's executor may write
// v2_week_plans for that one column only, as an update only: no insert or delete on v2_week_plans, no other column."
//
// A session marked deload with rules on keeps its pre-deload sets in `v2_week_plans.deload_restore`; UNMARK deletes the
// session's sets and writes that copy back (the app's own `applyDeloadRestore`, run here through programChange.deload.testutil.ts).
// Before this rule a save that removed or swapped an exercise left UNMARK writing back sets of a row the session no longer
// lists, and left a swapped-in or added exercise with none (the reviewer's executed probe, chunk 45 review 1).
//
// The bench: the stable world's Full Body, week 3, marked deload with sets −50 % (one set of each exercise is left in the
// session; the copy holds all of them). Week 2's Full Body is the same plan, not marked: the twin.

const draftOf = (w: World, planning = w.planningType): ProgramEdit => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), planning)

const copyOf = (db: Db, planId: string): SavedPlanSet[] => db.v2_week_plans.find((p) => p.id === planId)!.deload_restore as SavedPlanSet[]
const entriesOf = (entries: readonly SavedPlanSet[], exerciseRowId: string) => entries.filter((e) => e.programExerciseId === exerciseRowId)
const copyOps = (ops: readonly Op[]) => updates(ops, 'v2_week_plans')

// The new program-exercise row a save made for an exercise, and its default sets (heads, in position order).
const newRow = (ops: readonly Op[], exerciseId: string) => inserts(ops, 'v2_program_exercises').find((o) => o.row.exercise_id === exerciseId)!.row.id
const newHeadIds = (ops: readonly Op[], rowId: string) =>
  inserts(ops, 'v2_program_sets')
    .filter((o) => o.row.program_exercise_id === rowId && o.row.parent_program_set_id === null)
    .sort((a, b) => a.row.position - b.row.position)
    .map((o) => o.row.id)

async function stableDeloadWorld(): Promise<World> {
  const w = stableWorld()
  await markDeload(w.db, 'p3-fb')
  return w
}

describe('a save that changes the exercises of a session marked deload: UNMARK restores the plan with the change in it', () => {
  // The reviewer's probe: remove Incline, swap Leg Press, add an exercise with two sets.
  const saveOf = (w: World) => {
    let d = draftOf(w)
    d = removeExerciseFrom(d, 'fb', 'pe-inc')
    d = swapExerciseIn(d, 'fb', 'pe-leg', 'ex-hack')
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-new', sets: [newSet('10'), newSet('10')] })
    return planOf(w, d)
  }

  it('the save writes the session\'s saved plan: one update of `deload_restore` on its plan row, and nothing else on that table', async () => {
    const w = await stableDeloadWorld()
    const { ops, summary } = saveOf(w)
    const onPlans = ops.filter((o) => o.table === 'v2_week_plans')
    expect(onPlans).toHaveLength(1) // Tuesday and Thursday share the one plan row (G14): one copy, one op
    expect(onPlans[0]).toMatchObject({ op: 'update', table: 'v2_week_plans', id: 'p3-fb' })
    expect(Object.keys((onPlans[0] as { patch: object }).patch)).toEqual(['deload_restore'])
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p2-fb', 'p3-fb'])
  })

  it('a removed exercise\'s sets are gone from the copy', async () => {
    const w = await stableDeloadWorld()
    const before = copyOf(w.db, 'p3-fb')
    expect(entriesOf(before, 'pe-inc')).toHaveLength(2)
    const after = applyOpsToDb(w.db, saveOf(w).ops)
    expect(entriesOf(copyOf(after, 'p3-fb'), 'pe-inc')).toEqual([])
  })

  it('a swapped exercise\'s sets are the new row\'s: counts, kinds and rep targets kept, weight, RIR and cues cleared, links to the new row\'s own program sets', async () => {
    const w = await stableDeloadWorld()
    const { ops } = saveOf(w)
    const hack = newRow(ops, 'ex-hack')
    const after = applyOpsToDb(w.db, ops)
    const entries = entriesOf(copyOf(after, 'p3-fb'), hack)
    expect(entries.map((e) => [e.setNumber, e.stageIndex, e.repMin, e.repMax])).toEqual([[1, 0, 10, 12], [2, 0, 10, 12], [3, 0, 10, 12]])
    expect(entries.map((e) => [e.targetWeight, e.targetRir, e.tags])).toEqual([[null, null, null], [null, null, null], [null, null, null]])
    expect(entries.map((e) => e.programSetId)).toEqual(newHeadIds(ops, hack)) // not the old Leg Press's program sets
    expect(entriesOf(copyOf(after, 'p3-fb'), 'pe-leg')).toEqual([]) // nothing left on the old row
  })

  it('an added exercise on a stable run arrives in the copy with the default\'s sets, linked to its program sets, no numbers', async () => {
    const w = await stableDeloadWorld()
    const { ops } = saveOf(w)
    const added = newRow(ops, 'ex-new')
    const entries = entriesOf(copyOf(applyOpsToDb(w.db, ops), 'p3-fb'), added)
    expect(entries.map((e) => [e.setNumber, e.stageIndex, e.repMin, e.repMax, e.isWarmup, e.isDropset])).toEqual([[1, 0, 10, 10, false, false], [2, 0, 10, 10, false, false]])
    expect(entries.map((e) => e.programSetId)).toEqual(newHeadIds(ops, added))
    expect(entries.map((e) => [e.targetWeight, e.targetRir, e.tags])).toEqual([[null, null, null], [null, null, null]])
  })

  it('what the save does not touch stays exactly as it was saved: Lat Pulldown and Plank, weights, RIR and cues included, in their order', async () => {
    const w = await stableDeloadWorld()
    const before = copyOf(w.db, 'p3-fb')
    const after = copyOf(applyOpsToDb(w.db, saveOf(w).ops), 'p3-fb')
    for (const row of ['pe-lat', 'pe-plank']) expect(entriesOf(after, row)).toEqual(entriesOf(before, row))
    expect(entriesOf(after, 'pe-lat').map((e) => [e.targetWeight, e.targetRir, e.tags])).toEqual([[60, 2, ['push here']], [60, 2, ['push here']]])
    expect(after.map((e) => e.programExerciseId).filter((id, i, all) => all.indexOf(id) === i).slice(0, 3)).toEqual([expect.stringMatching(/^n\d+$/), 'pe-lat', 'pe-plank']) // the swapped row keeps the old row's place in the list
  })

  it('UNMARK then restores a session whose every listed exercise has its sets and which holds no set of a row it does not list', async () => {
    const w = await stableDeloadWorld()
    const { ops } = saveOf(w)
    const hack = newRow(ops, 'ex-hack')
    const added = newRow(ops, 'ex-new')
    const after = applyOpsToDb(w.db, ops)
    await unmarkDeload(after, 'p3-fb')
    const shape = shapeOf(after, 'p3-fb')
    expect(shape.orphanSets).toEqual([])
    expect(shape.emptyExercises).toEqual([])
    expect(shape.list).toEqual([
      { exercise: hack, heads: 3 }, // the old Leg Press's three sets, not the one the deload left
      { exercise: 'pe-lat', heads: 2 },
      { exercise: 'pe-plank', heads: 2 },
      { exercise: added, heads: 2 },
    ])
    expect(after.v2_week_plan_sets.filter((s) => s.week_plan_id === 'p3-fb' && s.program_exercise_id === 'pe-lat').map((s) => s.target_weight)).toEqual([60, 60])
    expect(after.v2_week_plans.find((p) => p.id === 'p3-fb')).toMatchObject({ is_deload: false, deload_restore: null })
  })

  it('the session itself changed as any not-started session does: the swapped row has the one set the deload left, the added exercise the default\'s two', async () => {
    const w = await stableDeloadWorld()
    const { ops } = saveOf(w)
    const after = applyOpsToDb(w.db, ops)
    expect(shapeOf(after, 'p3-fb').list).toEqual([
      { exercise: newRow(ops, 'ex-hack'), heads: 1 },
      { exercise: 'pe-lat', heads: 1 },
      { exercise: 'pe-plank', heads: 1 },
      { exercise: newRow(ops, 'ex-new'), heads: 2 },
    ])
  })

  it('a week-dependent run: the same removal and swap; the exercise added to a week-dependent run has no sets, so the copy has none for it', async () => {
    const w = weekDependentWorld()
    await markDeload(w.db, 'p3-pull')
    let d = draftOf(w)
    d = removeExerciseFrom(d, 'pull', 'pe-face')
    d = swapExerciseIn(d, 'pull', 'pe-pd', 'ex-row')
    d = addExerciseTo(d, 'pull', { exerciseId: 'ex-curl' })
    const { ops } = planOf(w, d)
    const row = newRow(ops, 'ex-row')
    const curl = newRow(ops, 'ex-curl')
    const after = applyOpsToDb(w.db, ops)
    const copy = copyOf(after, 'p3-pull')
    expect(entriesOf(copy, 'pe-face')).toEqual([])
    expect(entriesOf(copy, 'pe-pd')).toEqual([])
    expect(entriesOf(copy, curl)).toEqual([])
    // The swapped exercise has the old one's sets: a warmup, a working set, a dropset head and its drop; no number.
    const taken = entriesOf(copy, row)
    expect(taken.map((e) => [e.setNumber, e.stageIndex, e.isWarmup, e.stageKind, e.isDropset])).toEqual([
      [1, 0, true, null, false],
      [2, 0, false, null, false],
      [3, 0, false, 'dropset', false],
      [3, 1, false, null, true],
    ])
    expect(taken.every((e) => e.targetWeight === null && e.targetRir === null && e.tags === null)).toBe(true)
    await unmarkDeload(after, 'p3-pull')
    const shape = shapeOf(after, 'p3-pull')
    expect(shape.orphanSets).toEqual([])
    expect(shape.list).toEqual([{ exercise: row, heads: 3 }, { exercise: curl, heads: 0 }])
    expect(shape.emptyExercises).toEqual([curl]) // "New. It lands in week N with no sets"
  })

  it('a sequence run: each slot that is marked has its own copy and own op; the others have none', async () => {
    const w = sequenceWorld()
    await markDeload(w.db, 'c3-s1')
    await markDeload(w.db, 'c3-s3')
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'a', 'pe-row'))
    expect(copyOps(ops).map((o) => o.id)).toEqual(['c3-s1', 'c3-s3'])
    const after = applyOpsToDb(w.db, ops)
    for (const slot of ['c3-s1', 'c3-s3']) expect(entriesOf(copyOf(after, slot), 'pe-row')).toEqual([])
    await unmarkDeload(after, 'c3-s1')
    expect(shapeOf(after, 'c3-s1').orphanSets).toEqual([])
  })
})

describe('the stable default\'s sets reach the saved plan set by set, where it still matches the default', () => {
  // Leg Press: three sets of 10–12 (program sets pe-leg-s1..s3). Week 3 is marked deload, so its session holds only the first;
  // the copy holds all three. Before marking, the user changed set 2 of week 3 to 6–8 for that week only.
  async function worldWithThisWeekOnly(): Promise<World> {
    const w = stableWorld()
    Object.assign(weekSetOf(w, 'p3-fb', 'pe-leg-s2'), { rep_min: 6, rep_max: 8 })
    await markDeload(w.db, 'p3-fb')
    return w
  }
  const legSets = (db: Db, plan: string) =>
    db.v2_week_plan_sets
      .filter((s) => s.week_plan_id === plan && s.program_exercise_id === 'pe-leg' && s.parent_week_plan_set_id === null)
      .sort((a, b) => a.set_number - b.set_number)

  it('a rep target changed on the default lands on the copy\'s sets that still equal it and not on the one changed for that week only', async () => {
    const w = await worldWithThisWeekOnly()
    const d = editSetsOf(draftOf(w), 'fb', 'pe-leg', (sets) => sets.map((s) => withReps(s, '8-10')))
    const { ops } = planOf(w, d)
    const copy = entriesOf(copyOf(applyOpsToDb(w.db, ops), 'p3-fb'), 'pe-leg')
    expect(copy.map((e) => [e.setNumber, e.repMin, e.repMax])).toEqual([[1, 8, 10], [2, 6, 8], [3, 8, 10]])
    expect(copy.map((e) => e.targetWeight)).toEqual([60, 60, 60]) // weights on sets that stay are kept
  })

  it('UNMARK then brings the new targets back, the week-only one included as the user set it', async () => {
    const w = await worldWithThisWeekOnly()
    const { ops } = planOf(w, editSetsOf(draftOf(w), 'fb', 'pe-leg', (sets) => sets.map((s) => withReps(s, '8-10'))))
    const after = applyOpsToDb(w.db, ops)
    await unmarkDeload(after, 'p3-fb')
    expect(legSets(after, 'p3-fb').map((s) => [s.rep_min, s.rep_max, s.target_weight, s.target_rir])).toEqual([[8, 10, 60, 2], [6, 8, 60, 2], [8, 10, 60, 2]])
  })

  it('a set the default drops leaves the copy where it matched, and a set the default adds comes in where the copy still has the default\'s count', async () => {
    const w = await worldWithThisWeekOnly()
    let d = editSetsOf(draftOf(w), 'fb', 'pe-leg', (sets) => [...sets.slice(0, 2), newSet('8-10')]) // set 3 dropped, a new one in its place
    d = editSetsOf(d, 'fb', 'pe-inc', (sets) => sets.slice(0, 1)) // Incline: set 2 dropped
    const after = applyOpsToDb(w.db, planOf(w, d).ops)
    const copy = copyOf(after, 'p3-fb')
    expect(entriesOf(copy, 'pe-inc').map((e) => e.setNumber)).toEqual([1])
    expect(entriesOf(copy, 'pe-leg').map((e) => [e.setNumber, e.repMin, e.repMax, e.programSetId === null ? 'no link' : 'linked'])).toEqual([
      [1, 10, 12, 'linked'],
      [2, 6, 8, 'linked'], // untouched
      [4, 8, 10, 'linked'], // the added one: numbered after the highest the copy had, as in a session (a gap where set 3 was; sets are numbered by ordinal on screen)
    ])
    expect(entriesOf(copy, 'pe-leg').find((e) => e.setNumber === 4)!.programSetId).not.toBe('pe-leg-s3')
  })

  it('a default set added where the copy no longer has the default\'s count is left out of the copy: the user removed a set that week', async () => {
    const w = stableWorld()
    w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => s.id !== 'p3-fb-pe-leg-s3') // Leg Press has two sets that week
    await markDeload(w.db, 'p3-fb')
    const { ops } = planOf(w, editSetsOf(draftOf(w), 'fb', 'pe-leg', (sets) => [...sets, newSet('8')]))
    const copy = entriesOf(copyOf(applyOpsToDb(w.db, ops), 'p3-fb'), 'pe-leg')
    expect(copy.map((e) => e.setNumber)).toEqual([1, 2])
    // while a week that has all three takes the added set
    const w2 = await stableDeloadWorld()
    const taken = entriesOf(copyOf(applyOpsToDb(w2.db, planOf(w2, editSetsOf(draftOf(w2), 'fb', 'pe-leg', (sets) => [...sets, newSet('8')])).ops), 'p3-fb'), 'pe-leg')
    expect(taken.map((e) => e.setNumber)).toEqual([1, 2, 3, 4])
  })

  it('a session whose own sets the save leaves alone but whose saved plan it changes is a changed session, and its one op is the saved plan', async () => {
    const w = await stableDeloadWorld()
    // Incline gets a third default set. The deload left the session one Incline set, not the default's two: its own rows
    // take nothing; the copy has the default's two and takes the third.
    const { ops, summary } = planOf(w, editSetsOf(draftOf(w), 'fb', 'pe-inc', (sets) => [...sets, newSet('12')]))
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p2-fb', 'p3-fb'])
    expect(ops.filter((o) => 'row' in o && (o.row as { week_plan_id?: string }).week_plan_id === 'p3-fb')).toEqual([])
    expect(copyOps(ops).map((o) => o.id)).toEqual(['p3-fb'])
    expect(entriesOf((copyOps(ops)[0].patch as { deload_restore: SavedPlanSet[] }).deload_restore, 'pe-inc').map((e) => e.setNumber)).toEqual([1, 2, 3])
    expect(summary.setsLeftAlone).toBe(1) // the session's own: the third set is not added where the count is not the default's
  })

  it('a set\'s kind and a dropset\'s drop change in the copy the way they change in a session: Curl\'s drop to 6–8, its head to a warmup-free rest-pause', async () => {
    const w = stableWorld()
    await markDeload(w.db, 'p3-arms') // Curl: the deload keeps one of its two sets
    const d = editSetsOf(draftOf(w), 'arms', 'pe-curl', (sets) =>
      sets.map((s, i) => (i === 1 ? { ...s, stageKind: 'rest_pause' as const, stages: s.stages.map((st) => ({ ...st, repMin: 6, repMax: 8 })) } : s)),
    )
    const after = applyOpsToDb(w.db, planOf(w, d).ops)
    const curl = entriesOf(copyOf(after, 'p3-arms'), 'pe-curl')
    expect(curl.map((e) => [e.setNumber, e.stageIndex, e.stageKind, e.repMin, e.repMax, e.targetWeight])).toEqual([
      [1, 0, null, 10, 12, 60],
      [2, 0, 'rest_pause', 10, 12, 60],
      [2, 1, null, 6, 8, 50],
    ])
  })
})

describe('what a save leaves alone', () => {
  it.each(['done', 'in_progress'] as const)('the saved plan of a deload session that is %s is not touched, as the session is not', async (status) => {
    const w = await stableDeloadWorld()
    const edit = removeExerciseFrom(swapExerciseIn(draftOf(w), 'fb', 'pe-leg', 'ex-hack'), 'fb', 'pe-inc')
    const { ops, summary } = planOf(w, edit, { statuses: { 'p3-fb': status } })
    expect(copyOps(ops)).toEqual([])
    expect(summary.keptSessions.map((k) => [k.weekPlanId, k.status])).toEqual([['p3-fb', status]])
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p2-fb'])
  })

  it('a deload session of a workout the save does not change keeps its saved plan', async () => {
    const w = stableWorld()
    await markDeload(w.db, 'p3-fb')
    await markDeload(w.db, 'p3-arms')
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'))
    expect(copyOps(ops).map((o) => o.id)).toEqual(['p3-fb'])
  })

  it('a session marked deload with the rules off has no saved plan: it changes like any session and no op names its plan row', async () => {
    const w = stableWorld()
    w.db.v2_week_plans.find((p) => p.id === 'p3-fb')!.is_deload = true // flag only: nothing saved
    const { ops, summary } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'))
    expect(copyOps(ops)).toEqual([])
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p2-fb', 'p3-fb'])
    expect(ops.some((o) => o.op === 'delete' && o.table === 'v2_week_plan_sets')).toBe(true)
  })

  it('a save that changes nothing in the saved plan writes nothing to it: a rest (run-wide), a reorder (the sets do not move), an exercise the session never had', async () => {
    const w = await stableDeloadWorld()
    const rest = planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', { restSeconds: 90 }))
    expect(rest.ops).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-leg', patch: { rest_seconds: 90 } }])
    const moved = planOf(w, moveExercise(draftOf(w), 'fb', 0, 1))
    expect(moved.ops.length).toBeGreaterThan(0)
    expect(copyOps(moved.ops)).toEqual([])
    const w2 = stableWorld()
    w2.db.v2_week_plan_sets = w2.db.v2_week_plan_sets.filter((s) => !(s.week_plan_id === 'p3-fb' && s.program_exercise_id === 'pe-inc'))
    w2.db.v2_week_plan_exercises = w2.db.v2_week_plan_exercises.filter((e) => !(e.week_plan_id === 'p3-fb' && e.program_exercise_id === 'pe-inc'))
    await markDeload(w2.db, 'p3-fb')
    const { ops } = planOf(w2, removeExerciseFrom(draftOf(w2), 'fb', 'pe-inc'))
    expect(copyOps(ops)).toEqual([]) // the session never had Incline: nothing to take out of its copy
  })

  it('weeks before the current one are not passed and not changed', async () => {
    const w = stableWorld()
    await markDeload(w.db, 'p1-fb')
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'))
    expect(copyOps(ops)).toEqual([])
  })

  it('an entry for an exercise the session does not list is left as it is: only rows the session has are changed (as for its sets)', async () => {
    const w = await stableDeloadWorld()
    w.db.v2_week_plan_exercises = w.db.v2_week_plan_exercises.filter((e) => !(e.week_plan_id === 'p3-fb' && e.program_exercise_id === 'pe-inc'))
    const before = copyOf(w.db, 'p3-fb')
    expect(entriesOf(before, 'pe-inc')).toHaveLength(2) // stale entries: the session no longer lists Incline
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'))
    expect(copyOps(ops)).toEqual([])
  })

  it('a stage with no head in the copy (never restored) is passed through untouched while the rest of the copy changes', async () => {
    const w = await stableDeloadWorld()
    const copy = w.db.v2_week_plans.find((p) => p.id === 'p3-fb')!.deload_restore!
    const stray: SavedPlanSet = { ...copy[0], programExerciseId: 'pe-lat', setNumber: 9, stageIndex: 2, isDropset: true }
    copy.push(stray)
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'fb', 'pe-inc'))
    const after = (copyOps(ops)[0].patch as { deload_restore: SavedPlanSet[] }).deload_restore
    expect(after).toContainEqual(stray)
    expect(after.some((e) => e.programExerciseId === 'pe-inc')).toBe(false)
  })

  it('an RIR range\'s high end is cleared with the low end by a swap where the entry carries it, and a copy saved without it gains no key', async () => {
    const w = await stableDeloadWorld()
    const copy = w.db.v2_week_plans.find((p) => p.id === 'p3-fb')!.deload_restore!
    for (const e of copy.filter((x) => x.programExerciseId === 'pe-leg')) Object.assign(e, { targetRir: 1, targetRirMax: 3 })
    // Incline's entries carry no `targetRirMax` key (an older copy)
    const { ops } = planOf(w, swapExerciseIn(swapExerciseIn(draftOf(w), 'fb', 'pe-leg', 'ex-hack'), 'fb', 'pe-inc', 'ex-fly'))
    const after = (copyOps(ops)[0].patch as { deload_restore: SavedPlanSet[] }).deload_restore
    const hack = after.filter((e) => e.programExerciseId === newRow(ops, 'ex-hack'))
    expect(hack.map((e) => [e.targetRir, e.targetRirMax])).toEqual([[null, null], [null, null], [null, null]])
    const fly = after.filter((e) => e.programExerciseId === newRow(ops, 'ex-fly'))
    expect(fly).toHaveLength(2)
    for (const e of fly) expect('targetRirMax' in e).toBe(false)
  })
})

describe('the saved plan takes the save exactly as a plain session does (the twin)', () => {
  // Two planned weeks of Full Body, built the same way; week 3 is marked deload, week 4 is not. After any save, week 3's saved
  // plan must be, entry for entry, what week 4's sets are. (The same code lands both; this is what keeps it that way.)
  const SAVES: Array<[string, (d: ProgramEdit) => ProgramEdit]> = [
    ['an exercise removed', (d) => removeExerciseFrom(d, 'fb', 'pe-inc')],
    ['an exercise swapped', (d) => swapExerciseIn(d, 'fb', 'pe-leg', 'ex-hack')],
    ['a superset member swapped', (d) => swapExerciseIn(d, 'fb', 'pe-lat', 'ex-row')],
    ['an exercise added with sets, between two others', (d) => addExerciseTo(d, 'fb', { exerciseId: 'ex-new', sets: [newSet('10'), newSet('12', { isWarmup: true })] }, 1)],
    ['the exercises reordered', (d) => moveExercise(d, 'fb', 0, 1)],
    ['a rep target changed on every set of one exercise', (d) => editSetsOf(d, 'fb', 'pe-leg', (sets) => sets.map((s) => withReps(s, '6-8')))],
    ['a default set dropped and one added', (d) => editSetsOf(d, 'fb', 'pe-inc', (sets) => [sets[0], newSet('12-15'), newSet('15')])],
    ['a default set made a dropset with a stage', (d) => editSetsOf(d, 'fb', 'pe-leg', (sets) => sets.map((s, i) => (i === 2 ? { ...s, stageKind: 'dropset' as const, stages: [{ id: null, repMin: 6, repMax: 8, isAmrap: false }] } : s)))],
    ['everything at once', (d) => editSetsOf(addExerciseTo(removeExerciseFrom(swapExerciseIn(d, 'fb', 'pe-leg', 'ex-hack'), 'fb', 'pe-inc'), 'fb', { exerciseId: 'ex-new', sets: [newSet('10')] }), 'fb', 'pe-plank', (sets) => [...sets, newSet('amrap')])],
  ]

  async function twinWorld(thisWeekOnly: boolean): Promise<World> {
    const w = stableWorld()
    planSession(w, 'p4-fb', 'fb', 4)
    if (thisWeekOnly) {
      // the same changes for that week only in both weeks: a set made lighter on reps, one removed, one added
      for (const plan of ['p3-fb', 'p4-fb']) {
        Object.assign(weekSetOf(w, plan, 'pe-leg-s2'), { rep_min: 6, rep_max: 8 })
        w.db.v2_week_plan_sets = w.db.v2_week_plan_sets.filter((s) => s.id !== `${plan}-pe-inc-s2`)
      }
    }
    await markDeload(w.db, 'p3-fb')
    return w
  }

  it.each(SAVES.flatMap(([name, make]) => [[name, make, false] as const, [`${name}, after a week-only change`, make, true] as const]))(
    '%s',
    async (_name, make, thisWeekOnly) => {
      const w = await twinWorld(thisWeekOnly)
      const { ops } = planOf(w, make(draftOf(w)))
      const after = applyOpsToDb(w.db, ops)
      const saved = copyOf(after, 'p3-fb')
      const plain = asEntries(after, 'p4-fb')
      const noRange = (e: SavedPlanSet) => {
        const { targetRirMax, ...rest } = e
        void targetRirMax
        return rest
      }
      expect(plain.length).toBeGreaterThan(0)
      expect([...saved].sort(compareEntries).map(noRange)).toEqual(plain)
    },
  )
})

describe('the saved plan\'s part of the op list', () => {
  it('draws no id: the save\'s ids are the same with and without saved plans, and so are all its other ops', async () => {
    const w = await stableDeloadWorld()
    let d = draftOf(w)
    d = swapExerciseIn(d, 'fb', 'pe-leg', 'ex-hack')
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-new', sets: [newSet('10'), newSet('10')] })
    const input = inputOf(w, d)
    const withCopy = planProgramChange({ ...input, newId: idGen() })
    const without = planProgramChange({ ...input, newId: idGen(), sessions: input.sessions.map((s) => ({ ...s, deloadRestore: null })) })
    expect(withCopy.ops.filter((o) => o.table !== 'v2_week_plans')).toEqual(without.ops)
    expect(withCopy.ops.length).toBe(without.ops.length + 1)
    expect(withCopy.summary).toEqual(without.summary)
  })

  it('the update comes after the session\'s own set ops of its plan and is the only op on `v2_week_plans`, whatever the save', async () => {
    const w = await stableDeloadWorld()
    for (const make of [
      (d: ProgramEdit) => removeExerciseFrom(d, 'fb', 'pe-inc'),
      (d: ProgramEdit) => swapExerciseIn(d, 'fb', 'pe-leg', 'ex-hack'),
      (d: ProgramEdit) => addExerciseTo(d, 'fb', { exerciseId: 'ex-new', sets: [newSet('10')] }),
      (d: ProgramEdit) => editSetsOf(d, 'fb', 'pe-leg', (sets) => sets.map((s) => withReps(s, '6-8'))),
    ]) {
      const { ops } = planOf(w, make(draftOf(w)))
      const onPlans = ops.filter((o) => o.table === 'v2_week_plans')
      expect(onPlans.map((o) => o.op)).toEqual(['update'])
      for (const o of onPlans) expect(Object.keys((o as { patch: object }).patch)).toEqual(['deload_restore'])
    }
  })

  it('the input is not changed', async () => {
    const w = await stableDeloadWorld()
    const input = deepFreeze(inputOf(w, swapExerciseIn(draftOf(w), 'fb', 'pe-leg', 'ex-hack')))
    expect(() => planProgramChange(input)).not.toThrow()
  })

  it('the rows come in any order and the saved plan comes out the same set of entries', async () => {
    const w = await stableDeloadWorld()
    let d = draftOf(w)
    d = swapExerciseIn(d, 'fb', 'pe-leg', 'ex-hack')
    d = removeExerciseFrom(d, 'fb', 'pe-inc')
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-new', sets: [newSet('10'), newSet('10')] })
    d = editSetsOf(d, 'fb', 'pe-plank', (sets) => sets.slice(0, 1))
    const input = inputOf(w, d)
    const reversed = {
      ...input,
      runCopy: { ...input.runCopy, exercises: [...input.runCopy.exercises].reverse(), sets: [...input.runCopy.sets].reverse() },
      sessions: [...input.sessions].reverse().map((s) => ({
        ...s,
        exercises: [...s.exercises].reverse(),
        sets: [...s.sets].reverse(),
        deloadRestore: s.deloadRestore ? [...s.deloadRestore].reverse() : s.deloadRestore,
      })),
    }
    const savedOf = (ops: readonly Op[]) => [...(copyOps(ops)[0].patch as { deload_restore: SavedPlanSet[] }).deload_restore].sort(compareEntries)
    expect(savedOf(planProgramChange({ ...reversed, newId: idGen() }).ops)).toEqual(savedOf(planProgramChange({ ...input, newId: idGen() }).ops))
  })
})
