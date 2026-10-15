import { describe, it, expect } from 'vitest'
import {
  draftFromRunCopy,
  planProgramChange,
  type Op,
  type ProgramChangeInput,
  type ProgramEdit,
  type RunChangeStatus,
} from './programChange'
import {
  type Db,
  type World,
  NOW,
  USER,
  addExerciseTo,
  applyOpsToDb,
  cloneDb,
  editSetsOf,
  editWorkout,
  idGen,
  inputOf,
  inserts,
  moveExercise,
  newSet,
  patchExercise,
  planOf,
  removeExerciseFrom,
  runCopyOf,
  swapExerciseIn,
  withReps,
} from './programChange.testutil'
import { sequenceWorld, stableWorld, weekDependentWorld } from './programChange.worlds.testutil'

// Chunk 45 — whole saves, run on the tables (programChange.testutil.ts's `applyOpsToDb`, which refuses what the tables
// refuse): "SAVE CHANGES writes everything at once", and a draft that changes nothing writes nothing ("CANCEL leaves
// without saving").

const draftOf = (w: World): ProgramEdit => draftFromRunCopy(runCopyOf(w.db, w.programId, w.mesocycleId), w.planningType)

describe('a draft that changes nothing writes nothing', () => {
  it.each([
    ['the stable run', stableWorld],
    ['the week-dependent run', weekDependentWorld],
    ['the sequence run', sequenceWorld],
  ])('%s', (_name, make) => {
    const w = make()
    expect(planOf(w, draftOf(w)).ops).toEqual([])
    expect(planOf(w, draftOf(w), { statuses: { [w.db.v2_week_plans[0].id]: 'done' } }).ops).toEqual([])
  })

  it('a run whose rows were numbered the way the seed numbers them: exercises from 1, a gap in a set\'s positions, a routine from 5', () => {
    const w = stableWorld()
    for (const e of w.db.v2_program_exercises) e.position += 1 // the seed's exercises start at 1
    for (const e of w.db.v2_week_plan_exercises) e.position += 1
    w.db.v2_program_sets.find((s) => s.id === 'pe-leg-s3')!.position = 5 // 1, 2, 5
    w.db.v2_week_plan_sets.find((s) => s.id === 'p3-fb-pe-leg-s3')!.set_number = 5
    for (const r of w.db.v2_workout_warmup_items) r.position += 5
    expect(planOf(w, draftOf(w)).ops).toEqual([])
    // and one real change in it writes just that
    const { ops } = planOf(w, patchExercise(draftOf(w), 'fb', 'pe-leg', { restSeconds: 90 }))
    expect(ops).toEqual([{ op: 'update', table: 'v2_program_exercises', id: 'pe-leg', patch: { rest_seconds: 90 } }])
  })

  it('a draft the screen builds twice from the same run is the same draft', () => {
    const w = stableWorld()
    expect(draftOf(w)).toEqual(draftOf(w))
  })
})

describe('a stable run saved with everything changed at once', () => {
  const w = stableWorld()
  const statuses = { 'p2-fb': 'in_progress', 'p3-arms': 'done' } as const

  // Full Body: swap Leg Press, drop Incline, add Hip Thrust (two sets) after the swap, give Lat Pulldown a rest, change
  // the block's rest, a new warmup item, a rename; Arms: the dropset's drop gets a lower rep target, Dip's set 2 goes;
  // the weekdays: Arms moves Saturday → Friday.
  const edit = (): ProgramEdit => {
    let d = draftOf(w)
    d = swapExerciseIn(d, 'fb', 'pe-leg', 'ex-hack')
    d = removeExerciseFrom(d, 'fb', 'pe-inc')
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-hip', sets: [newSet('8-10'), newSet('8-10')] }, 1)
    d = patchExercise(d, 'fb', 'pe-lat', { restSeconds: 120 })
    d = { ...d, blocks: d.blocks.map((b) => (b.id === 'blk' ? { ...b, restAfterRoundSeconds: 150 } : b)) }
    d = editWorkout(d, 'fb', (wo) => ({ ...wo, name: 'Full Body A', routine: [...wo.routine, { id: null, body: 'Jump rope' }] }))
    d = editSetsOf(d, 'arms', 'pe-curl', (sets) => sets.map((s, i) => (i === 1 ? { ...s, stages: s.stages.map((st) => ({ ...st, repMin: 6, repMax: 8 })) } : s)))
    d = editSetsOf(d, 'arms', 'pe-dip', (sets) => sets.slice(0, 1))
    return { ...d, schedule: { ...d.schedule, saturday: null, friday: 'arms' } }
  }

  const { ops, summary } = planOf(w, edit(), { statuses })
  const after = applyOpsToDb(w.db, ops)

  it('the whole list runs on the tables as they are', () => {
    expect(ops.length).toBeGreaterThan(25)
  })

  it('every session that has not started has the new list and sets; done and in-progress ones are exactly as they were', () => {
    const rowsOf = (db: Db, planId: string) => ({
      exercises: db.v2_week_plan_exercises.filter((e) => e.week_plan_id === planId),
      sets: db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId),
    })
    for (const planId of ['p2-fb', 'p3-arms', 'p1-fb', 'p1-arms']) expect(rowsOf(after, planId)).toEqual(rowsOf(w.db, planId))
    expect(after.v2_week_plan_exercises.filter((e) => e.week_plan_id === 'p3-fb').sort((a, b) => a.position - b.position).map((e) => e.program_exercise_id.replace(/^n\d+$/, 'new'))).toEqual(['new', 'new', 'pe-lat', 'pe-plank'])
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p2-arms', 'p3-fb'])
    expect(summary.keptSessions.map((k) => [k.weekPlanId, k.status])).toEqual([['p2-fb', 'in_progress'], ['p3-arms', 'done']])
  })

  it('Arms\' sessions: the dropset\'s drop and Dip\'s set 2 changed where they still matched; Curl\'s weights stay', () => {
    expect(after.v2_week_plan_sets.find((s) => s.id === 'p2-arms-pe-curl-s2-t1')).toMatchObject({ rep_min: 6, rep_max: 8, target_weight: 50, target_rir: 1 })
    expect(after.v2_week_plan_sets.some((s) => s.id === 'p2-arms-pe-dip-s2')).toBe(false)
    expect(after.v2_week_plan_sets.some((s) => s.id === 'p3-arms-pe-dip-s2')).toBe(true) // that one is done
    expect(after.v2_week_plan_sets.find((s) => s.id === 'p2-arms-pe-dip-s1')).toMatchObject({ target_weight: 60, target_rir: 2, tags: ['push here'] })
  })

  it('the run copy: the new exercises, soft removals, the rest, the block, the name, the routine and the days', () => {
    const run = after.v2_program_exercises
    expect(run.find((e) => e.id === 'pe-leg')!.removed_at).not.toBeNull()
    expect(run.find((e) => e.id === 'pe-inc')!.removed_at).not.toBeNull()
    expect(run.find((e) => e.id === 'pe-lat')!.rest_seconds).toBe(120)
    expect(after.v2_program_superset_blocks.find((b) => b.id === 'blk')!.rest_after_round_seconds).toBe(150)
    expect(after.v2_workout_days.find((d) => d.id === 'fb')!.name).toBe('Full Body A')
    expect(after.v2_workout_warmup_items.filter((r) => r.workout_day_id === 'fb').sort((a, b) => a.position - b.position).map((r) => r.body)).toEqual(['Band pull-aparts', 'Dead hang', 'Jump rope'])
    expect(after.v2_run_schedules.map((r) => r.from_week).sort()).toEqual([1, 3])
    expect(after.v2_programs[0].schedule).toMatchObject({ friday: 'arms', saturday: null })
    expect(summary.scheduleStartWeek).toBe(3)
  })

  it('what it never touches: the other workout\'s rows it was not asked about, and weights on sets that stay', () => {
    expect(after.v2_week_plan_sets.find((s) => s.id === 'p3-fb-pe-lat-s1')).toEqual(w.db.v2_week_plan_sets.find((s) => s.id === 'p3-fb-pe-lat-s1'))
    expect(after.v2_program_sets.filter((s) => s.program_exercise_id === 'pe-lat')).toEqual(w.db.v2_program_sets.filter((s) => s.program_exercise_id === 'pe-lat'))
  })

  it('the same edit twice gives the same list, and the input db was not changed', () => {
    const again = planOf(w, edit(), { statuses })
    expect(again.ops).toEqual(ops)
    expect(JSON.stringify(w.db)).toBe(JSON.stringify(cloneDb(w.db)))
  })
})

describe('a week-dependent run saved with several changes at once (Monday done, Tuesday in progress, Thursday not started)', () => {
  const w = weekDependentWorld()
  const statuses = { 'p2-push': 'done', 'p2-pull': 'in_progress' } as const

  it('swap and remove in Legs and Pull, add in Push: only the sessions that have not started change, and numbers go only where an exercise was swapped', () => {
    let d = draftOf(w)
    d = swapExerciseIn(d, 'legs', 'pe-squat', 'ex-hack')
    d = removeExerciseFrom(d, 'pull', 'pe-face')
    d = addExerciseTo(d, 'push', { exerciseId: 'ex-fly' })
    const { ops, summary } = planOf(w, d, { statuses })
    const after = applyOpsToDb(w.db, ops)
    expect(summary.changedSessions.map((s) => s.weekPlanId)).toEqual(['p2-legs', 'p3-push', 'p3-pull', 'p3-legs'])
    // Thursday's Legs (week 2, not started): the squat sets are the new exercise's, with no numbers; Monday and Tuesday untouched
    const created = after.v2_program_exercises.find((e) => e.exercise_id === 'ex-hack')!.id
    const legs = after.v2_week_plan_sets.filter((s) => s.week_plan_id === 'p2-legs')
    expect(legs.map((s) => [s.program_exercise_id === created, s.target_weight, s.target_rir, s.tags, s.rep_min])).toEqual(Array(3).fill([true, null, null, null, 5]))
    for (const planId of ['p2-push', 'p2-pull']) {
      expect(after.v2_week_plan_sets.filter((s) => s.week_plan_id === planId)).toEqual(w.db.v2_week_plan_sets.filter((s) => s.week_plan_id === planId))
    }
    // the Push session\'s new exercise has no sets
    const fly = after.v2_program_exercises.find((e) => e.exercise_id === 'ex-fly')!.id
    expect(after.v2_week_plan_sets.some((s) => s.program_exercise_id === fly)).toBe(false)
    expect(after.v2_week_plan_exercises.filter((e) => e.week_plan_id === 'p3-push').map((e) => e.program_exercise_id)).toEqual(['pe-bench', fly])
  })
})

describe('what the weekday of a sequence run does: nothing', () => {
  it('an exercise change on a sequence run changes sessions by slot and writes no schedule', () => {
    const w = sequenceWorld()
    const { ops } = planOf(w, removeExerciseFrom(draftOf(w), 'a', 'pe-row'), { statuses: { 'c2-s0': 'done' } })
    expect(ops.some((o) => o.table === 'v2_run_schedules' || o.table === 'v2_programs')).toBe(false)
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })
})

describe('every insert names every NOT NULL column of its table (jsonb_populate_record writes NULL for one it leaves out)', () => {
  // The columns each table declares NOT NULL (migrations 001-042; a column with a default is still listed: the default is
  // not applied to a column the row doesn't name). Written out here, not read from the executor that checks them.
  const NOT_NULL: Record<string, string[]> = {
    v2_program_exercises: ['id', 'user_id', 'workout_day_id', 'exercise_id', 'position', 'week_only'],
    v2_program_sets: ['id', 'user_id', 'program_exercise_id', 'position', 'is_warmup', 'stage_index', 'is_amrap', 'created_at'],
    v2_program_superset_blocks: ['id', 'user_id', 'workout_day_id', 'created_at'],
    v2_workout_warmup_items: ['id', 'user_id', 'workout_day_id', 'position', 'body'],
    v2_run_schedules: ['id', 'user_id', 'mesocycle_id', 'from_week', 'schedule', 'created_at'],
    v2_week_plan_exercises: ['id', 'user_id', 'week_plan_id', 'program_exercise_id', 'position', 'created_at'],
    v2_week_plan_sets: ['id', 'user_id', 'week_plan_id', 'program_exercise_id', 'set_number', 'is_dropset', 'stage_index', 'is_warmup', 'is_amrap'],
  }

  it('a save that inserts into all seven tables it can: every row carries its table\'s columns, and the four created_at are the save\'s time', () => {
    const w = stableWorld()
    let d = draftOf(w)
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-hip', sets: [newSet('8-10'), newSet('6-8', { stageKind: 'dropset', stages: [{ id: null, repMin: 4, repMax: 6, isAmrap: false }] })] }, 1)
    d = { ...d, blocks: [...d.blocks, { id: 'draft-block', restWithinRoundSeconds: null, restAfterRoundSeconds: 60 }] }
    d = patchExercise(d, 'arms', 'pe-curl', { supersetBlockId: 'draft-block' })
    d = patchExercise(d, 'arms', 'pe-dip', { supersetBlockId: 'draft-block' })
    d = editWorkout(d, 'fb', (wo) => ({ ...wo, routine: [...wo.routine, { id: null, body: 'Jump rope' }] }))
    d = { ...d, schedule: { ...d.schedule, saturday: null, friday: 'arms' } }
    const { ops } = planOf(w, d)
    expect([...new Set(inserts(ops).map((o) => o.table))].sort()).toEqual(Object.keys(NOT_NULL).sort())
    for (const o of inserts(ops)) {
      const row = o.row as unknown as Record<string, unknown>
      for (const column of NOT_NULL[o.table]) expect(row[column], `${o.table}.${column}`).not.toBeUndefined()
      for (const [column, value] of Object.entries(row)) expect(value, `${o.table}.${column}`).not.toBeUndefined()
      if (NOT_NULL[o.table].includes('created_at')) expect(row.created_at, `${o.table}.created_at`).toBe(NOW)
    }
    expect(() => applyOpsToDb(w.db, ops)).not.toThrow()
  })
})

describe('the executor stands in for 043 honestly: it refuses what the database would', () => {
  // The checks the tests above rely on, shown to bite. (The same op lists are also run on a real Postgres in chunk 45's
  // scratch run, reported with the chunk.)
  it('a row that is not there', () => {
    const w = stableWorld()
    expect(() => applyOpsToDb(w.db, [{ op: 'delete', table: 'v2_week_plan_exercises', id: 'nope' }])).toThrow(/row not found/)
    expect(() => applyOpsToDb(w.db, [{ op: 'update', table: 'v2_program_exercises', id: 'nope', patch: { tempo: null } }])).toThrow(/row not found/)
  })

  it('a unique index: two warmup items on one position, one exercise twice in a session, a week twice in a run\'s schedule', () => {
    const w = stableWorld()
    expect(() => applyOpsToDb(w.db, [{ op: 'update', table: 'v2_workout_warmup_items', id: 'fb-r2', patch: { position: 0 } }])).toThrow(/unique/)
    expect(() =>
      applyOpsToDb(w.db, [{ op: 'insert', table: 'v2_week_plan_exercises', row: { id: 'dup', user_id: USER, week_plan_id: 'p3-fb', program_exercise_id: 'pe-leg', position: 9, created_at: NOW } }]),
    ).toThrow(/unique/)
    const sched = { monday: null, tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null }
    const two = [
      { op: 'insert', table: 'v2_run_schedules', row: { id: 'a', user_id: USER, mesocycle_id: 'meso', from_week: 3, schedule: sched, created_at: NOW } },
      { op: 'insert', table: 'v2_run_schedules', row: { id: 'b', user_id: USER, mesocycle_id: 'meso', from_week: 3, schedule: sched, created_at: NOW } },
    ] as const
    expect(() => applyOpsToDb(w.db, [...two])).toThrow(/unique/)
  })

  it('a foreign key with nothing behind it, and a check', () => {
    const w = stableWorld()
    expect(() =>
      applyOpsToDb(w.db, [{ op: 'insert', table: 'v2_week_plan_exercises', row: { id: 'x', user_id: USER, week_plan_id: 'p3-fb', program_exercise_id: 'nowhere', position: 9, created_at: NOW } }]),
    ).toThrow(/foreign key/)
    expect(() => applyOpsToDb(w.db, [{ op: 'update', table: 'v2_program_sets', id: 'pe-leg-s1', patch: { rep_min: 12, rep_max: 8 } }])).toThrow(/rep_max_check/)
    expect(() => applyOpsToDb(w.db, [{ op: 'update', table: 'v2_program_sets', id: 'pe-leg-s1', patch: { is_warmup: true, stage_kind: 'dropset' } }])).toThrow(/warmup_check/)
  })

  it('a table not on the list, an insert into a program, a patch that names an id, a column that does not exist', () => {
    const w = stableWorld()
    expect(() => applyOpsToDb(w.db, [{ op: 'delete', table: 'v2_set_logs' as never, id: 'x' }])).toThrow(/table not allowed/)
    expect(() => applyOpsToDb(w.db, [{ op: 'insert', table: 'v2_programs' as never, row: { id: 'x', user_id: USER } as never }])).toThrow(/insert not allowed/)
    expect(() => applyOpsToDb(w.db, [{ op: 'update', table: 'v2_program_exercises', id: 'pe-leg', patch: { id: 'z' } as never }])).toThrow(/protected/)
    expect(() => applyOpsToDb(w.db, [{ op: 'update', table: 'v2_program_exercises', id: 'pe-leg', patch: { rest_secs: 5 } as never }])).toThrow(/unknown column/)
  })

  it('all or none: a list that fails on its last op leaves the database as it was', () => {
    const w = stableWorld()
    const before = JSON.stringify(w.db)
    expect(() =>
      applyOpsToDb(w.db, [
        { op: 'update', table: 'v2_program_exercises', id: 'pe-leg', patch: { tempo: '3-1-1-0' } },
        { op: 'delete', table: 'v2_week_plan_exercises', id: 'nope' },
      ]),
    ).toThrow(/row not found/)
    expect(JSON.stringify(w.db)).toBe(before)
  })

  it('a stage goes with its head, and a program set that is hard-deleted nulls the planned sets\' link', () => {
    const w = stableWorld()
    const after = applyOpsToDb(w.db, [{ op: 'delete', table: 'v2_week_plan_sets', id: 'p3-arms-pe-curl-s2' }])
    expect(after.v2_week_plan_sets.some((s) => s.id === 'p3-arms-pe-curl-s2-t1')).toBe(false)
    const unlinked = applyOpsToDb(w.db, [{ op: 'delete', table: 'v2_program_sets', id: 'pe-dip-s1' }])
    expect(unlinked.v2_week_plan_sets.find((s) => s.id === 'p3-arms-pe-dip-s1')!.program_set_id).toBeNull()
  })

  it('an insert row that leaves a NOT NULL column out: jsonb_populate_record writes NULL there, not the default', () => {
    const w = stableWorld()
    const { ops } = planOf(w, addExerciseTo(draftOf(w), 'arms', { exerciseId: 'ex-new', sets: [newSet('8')] }))
    for (const table of ['v2_program_sets', 'v2_week_plan_exercises'] as const) {
      const stripped = ops.map((o) => (o.op === 'insert' && o.table === table ? { ...o, row: Object.fromEntries(Object.entries(o.row).filter(([k]) => k !== 'created_at')) } : o)) as Op[]
      expect(() => applyOpsToDb(w.db, stripped), table).toThrow(/has no created_at/)
    }
  })

  it('what a delete takes with it, as the tables\' foreign keys have it: a program exercise\'s sets and planned rows go (cascade); a deleted block lets its exercises go (set null)', () => {
    const w = stableWorld()
    const after = applyOpsToDb(w.db, [{ op: 'delete', table: 'v2_program_exercises', id: 'pe-dip' }])
    expect(after.v2_program_exercises.some((e) => e.id === 'pe-dip')).toBe(false)
    expect(after.v2_program_sets.some((s) => s.program_exercise_id === 'pe-dip')).toBe(false)
    expect(after.v2_week_plan_exercises.some((r) => r.program_exercise_id === 'pe-dip')).toBe(false)
    expect(after.v2_week_plan_sets.some((r) => r.program_exercise_id === 'pe-dip')).toBe(false)
    expect(after.v2_program_sets.some((s) => s.program_exercise_id === 'pe-curl')).toBe(true) // and no other exercise's
    const unblocked = applyOpsToDb(w.db, [{ op: 'delete', table: 'v2_program_superset_blocks', id: 'blk' }])
    expect(unblocked.v2_program_exercises.filter((e) => e.superset_block_id !== null)).toEqual([])
    expect(unblocked.v2_program_exercises).toHaveLength(w.db.v2_program_exercises.length)
  })

  it('the op list planProgramChange makes is the one the executor was written against: ids drawn in the order they are inserted', () => {
    const w = stableWorld()
    const d = addExerciseTo(draftOf(w), 'arms', { exerciseId: 'ex-new', sets: [withReps(newSet('8'), '8-12')] })
    const { ops } = planProgramChange(inputOf(w, d, { newId: idGen('k') }))
    expect(ops.filter((o) => o.op === 'insert').map((o) => (o as { row: { id: string } }).row.id)[0]).toBe('k1')
  })
})

describe('the order the rows come in does not matter: every input array reversed gives the same ops and the same summary', () => {
  const reversed = (input: ProgramChangeInput): ProgramChangeInput => ({
    ...input,
    runCopy: {
      ...input.runCopy,
      workouts: [...input.runCopy.workouts].reverse(),
      exercises: [...input.runCopy.exercises].reverse(),
      sets: [...input.runCopy.sets].reverse(),
      blocks: [...input.runCopy.blocks].reverse(),
      routine: [...input.runCopy.routine].reverse(),
    },
    scheduleRows: [...input.scheduleRows].reverse(),
    sessions: [...input.sessions].reverse().map((s) => ({ ...s, exercises: [...s.exercises].reverse(), sets: [...s.sets].reverse() })),
  })
  const same = (w: World, edit: ProgramEdit, statuses: Record<string, RunChangeStatus> = {}) => {
    const a = planProgramChange(inputOf(w, edit, { statuses }))
    const b = planProgramChange(reversed(inputOf(w, edit, { statuses })))
    expect(a.ops.length).toBeGreaterThan(0)
    expect(b.ops).toEqual(a.ops)
    expect(b.summary).toEqual(a.summary)
  }

  it.each([
    ['the stable run', stableWorld],
    ['the week-dependent run', weekDependentWorld],
    ['the sequence run', sequenceWorld],
  ])('the draft a screen starts from is the same from rows in any order: %s', (_name, make) => {
    const w = make()
    const input = inputOf(w, draftOf(w))
    expect(draftFromRunCopy(reversed(input).runCopy, w.planningType)).toEqual(draftFromRunCopy(input.runCopy, w.planningType))
  })

  it('a stable run: swap, remove, add, rest, block, name, routine, default sets and weekdays in one save', () => {
    const w = stableWorld()
    let d = draftOf(w)
    d = swapExerciseIn(d, 'fb', 'pe-leg', 'ex-hack')
    d = removeExerciseFrom(d, 'fb', 'pe-inc')
    d = addExerciseTo(d, 'fb', { exerciseId: 'ex-hip', sets: [newSet('8-10'), newSet('8-10')] }, 1)
    d = patchExercise(d, 'fb', 'pe-lat', { restSeconds: 120 })
    d = editWorkout(d, 'fb', (wo) => ({ ...wo, name: 'Full Body A', routine: [{ id: 'fb-r2', body: 'Dead hang' }, { id: 'fb-r1', body: 'Band pull-aparts' }, { id: null, body: 'Jump rope' }] }))
    d = editSetsOf(d, 'arms', 'pe-curl', (sets) => sets.map((s, i) => (i === 1 ? { ...s, stages: s.stages.map((st) => ({ ...st, repMin: 6, repMax: 8 })) } : s)))
    d = editSetsOf(d, 'arms', 'pe-dip', (sets) => sets.slice(0, 1))
    d = { ...d, schedule: { ...d.schedule, saturday: null, friday: 'arms' } }
    same(w, d, { 'p2-fb': 'in_progress', 'p3-arms': 'done' })
  })

  it('a stable run: an exercise with a dropset swapped (its head and its stage share a set number)', () => {
    const w = stableWorld()
    same(w, swapExerciseIn(draftOf(w), 'arms', 'pe-curl', 'ex-new-curl'), { 'p3-arms': 'done' })
  })

  it('a stable run: exercises reordered, a set added, the default\'s sets swapped round', () => {
    const w = stableWorld()
    let d = moveExercise(draftOf(w), 'fb', 0, 1)
    d = editSetsOf(d, 'fb', 'pe-inc', (sets) => [...sets, newSet('6-8')])
    d = editSetsOf(d, 'arms', 'pe-curl', (sets) => [sets[1], sets[0]])
    same(w, d)
  })

  it('a stable run: the warm-up routine emptied and refilled, a superset linked, an exercise added in the same save as a move', () => {
    const w = stableWorld()
    let d = editWorkout(draftOf(w), 'fb', (wo) => ({ ...wo, routine: [{ id: null, body: 'Jump rope' }] }))
    d = { ...d, blocks: [...d.blocks, { id: 'draft-block', restWithinRoundSeconds: null, restAfterRoundSeconds: 60 }] }
    d = patchExercise(d, 'arms', 'pe-curl', { supersetBlockId: 'draft-block' })
    d = patchExercise(d, 'arms', 'pe-dip', { supersetBlockId: 'draft-block' })
    d = addExerciseTo(moveExercise(d, 'fb', 1, 0), 'fb', { exerciseId: 'ex-new', sets: [newSet('8')] }, 2)
    same(w, d)
  })

  it('a week-dependent run', () => {
    const w = weekDependentWorld()
    let d = swapExerciseIn(draftOf(w), 'legs', 'pe-squat', 'ex-hack')
    d = removeExerciseFrom(d, 'pull', 'pe-face')
    d = addExerciseTo(d, 'push', { exerciseId: 'ex-fly' })
    same(w, { ...d, schedule: { ...d.schedule, monday: null, wednesday: 'push' } }, { 'p2-push': 'done', 'p2-pull': 'in_progress' })
  })

  it('a sequence run', () => {
    const w = sequenceWorld()
    const d = addExerciseTo(removeExerciseFrom(draftOf(w), 'a', 'pe-row'), 'a', { exerciseId: 'ex-pull', sets: [newSet('8-10')] })
    same(w, d, { 'c2-s0': 'done', 'c2-s1': 'in_progress' })
  })
})
