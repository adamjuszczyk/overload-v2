import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cloneDb, runCopyOf, scheduleRowsOf, sessionsOf, USER, type World } from './programChange.testutil'
import { stableWorld, weekDependentWorld } from './programChange.worlds.testutil'
import type { ChangeSession, RunChangeStatus } from './programChange'
import { fakePostgrest, type FakePostgrest, type Row, type Tables } from './fakePostgrest.testutil'

// Chunk 51a: the reads behind CHANGE THE PROGRAM and behind SAVE (`changeProgramService.ts`, with `fetchRunCopyExerciseRows` and
// `fetchProgram` under it). The screen's tests mock this module, so what it reads, and from where, is proven here.
//
// The tables are chunk 45's test worlds (database rows, snake_case); `runCopyOf`, `sessionsOf` and `scheduleRowsOf` in
// programChange.testutil.ts are what those rows MEAN to `planProgramChange`. The reads must hand it the same thing from the
// same rows, so each test serves the world's rows from a stand-in for PostgREST (`fakePostgrest.testutil.ts`: filters filter,
// `.select()` projects, embeds resolve through a declared relationship, one answer is capped at 1000 rows, every request is
// logged) next to rows that belong somewhere else: the saved program the run was copied from, another run's plans, sessions and
// schedule rows, plan rows of earlier weeks. A read that takes the wrong rows or the wrong columns shows as a difference.

const h = vi.hoisted(() => ({ client: null as unknown }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (table: string) => (h.client as FakePostgrest['client']).from(table) },
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: null, loading: false, signOut: vi.fn() }) }))

const { fetchChangeProgramSource, fetchPlanRowStatuses } = await import('./changeProgramService')

const OTHER_MESO = 'meso-other'
const EXERCISE_IDS = ['ex-bench', 'ex-pd', 'ex-face', 'ex-squat', 'ex-leg', 'ex-inc', 'ex-lat', 'ex-plank', 'ex-curl', 'ex-dip', 'ex-row', 'ex-x']

const exerciseRows = (): Row[] =>
  EXERCISE_IDS.map((id) => ({
    id,
    user_id: USER,
    name: `Exercise ${id}`,
    muscle_group: 'back',
    is_archived: false,
    created_at: '2026-01-01T00:00:00Z',
    muscle_subgroup: null,
    movement_pattern: null,
    status: 'active',
    source_library_id: null,
    lost_at: null,
  }))

// A session row the way v2_sessions holds one.
const sessionRow = (id: string, mesoId: string, planId: string | null, status: string): Row => ({ id, user_id: USER, mesocycle_id: mesoId, week_plan_id: planId, status })

// Rows that are not this run's, so that a read of the wrong source has something to take.
function strangers(w: World): Tables {
  return {
    // the saved program the run was copied from: its own workouts, exercises, sets, blocks and routine
    v2_programs: [{ id: 'saved', user_id: USER, name: 'Saved', kind: 'saved', schedule_type: w.scheduleType, planning_type: w.planningType, schedule: { monday: 'saved-w' } }],
    v2_workout_days: [{ id: 'saved-w', user_id: USER, program_id: 'saved', name: 'Saved workout', position: 0 }],
    v2_program_exercises: [
      { id: 'saved-pe', user_id: USER, workout_day_id: 'saved-w', exercise_id: 'ex-x', position: 0, weight_unit: null, superset_block_id: 'saved-blk', rest_seconds: null, rest_after_seconds: null, tempo: null, week_only: false, removed_at: null },
    ],
    v2_program_sets: [
      { id: 'saved-set', user_id: USER, program_exercise_id: 'saved-pe', position: 1, is_warmup: false, stage_kind: null, stage_rest_seconds: null, parent_program_set_id: null, stage_index: 0, rep_min: 8, rep_max: 10, is_amrap: false, rest_seconds: null, removed_at: null },
    ],
    v2_program_superset_blocks: [{ id: 'saved-blk', user_id: USER, workout_day_id: 'saved-w', rest_within_round_seconds: 5, rest_after_round_seconds: 5 }],
    v2_workout_warmup_items: [{ id: 'saved-item', user_id: USER, workout_day_id: 'saved-w', position: 0, body: 'Saved warmup' }],
    // another run: a plan row in week 3 with a set and an exercise row, a session, a schedule row
    v2_week_plans: [{ id: 'other-plan', user_id: USER, mesocycle_id: OTHER_MESO, workout_day_id: 'saved-w', week_number: 3, is_deload: false, sequence_position: null }],
    v2_week_plan_exercises: [{ id: 'other-x', user_id: USER, week_plan_id: 'other-plan', program_exercise_id: 'saved-pe', position: 0 }],
    v2_week_plan_sets: [
      { id: 'other-set', user_id: USER, week_plan_id: 'other-plan', program_exercise_id: 'saved-pe', set_number: 1, stage_index: 0, is_warmup: false, parent_week_plan_set_id: null, stage_kind: null, program_set_id: 'saved-set', rep_min: 8, rep_max: 10, is_amrap: false },
    ],
    v2_sessions: [sessionRow('other-session', OTHER_MESO, 'other-plan', 'completed')],
    v2_run_schedules: [{ id: 'other-rs', user_id: USER, mesocycle_id: OTHER_MESO, from_week: 4, schedule: { monday: 'saved-w' }, created_at: '2026-10-01T00:00:00Z' }],
  }
}

// The world's rows plus the strangers, plus a run schedule row of this run and the sessions that give the plan rows their statuses.
function tablesOf(w: World, statuses: Record<string, RunChangeStatus>, extra: Tables = {}): Tables {
  const mine = cloneDb(w.db) as unknown as Tables
  mine.v2_run_schedules = [{ id: 'rs-1', user_id: USER, mesocycle_id: w.mesocycleId, from_week: 3, schedule: { monday: w.db.v2_workout_days[0].id }, created_at: '2026-10-02T00:00:00Z' }]
  mine.exercises = exerciseRows()
  mine.v2_sessions = Object.entries(statuses)
    .filter(([, st]) => st !== 'not_started')
    .map(([planId, st], i) => sessionRow(`ses-${i}`, w.mesocycleId, planId, st === 'done' ? 'completed' : 'in_progress'))
  const other = strangers(w)
  const out: Tables = {}
  for (const table of new Set([...Object.keys(mine), ...Object.keys(other), ...Object.keys(extra)])) {
    out[table] = [...(mine[table] ?? []), ...(other[table] ?? []), ...(extra[table] ?? [])]
  }
  return out
}

let fake: FakePostgrest
function serve(tables: Tables): void {
  fake = fakePostgrest(tables)
  h.client = fake.client
}
const read = (w: World, over: { currentWeek?: number } = {}) =>
  fetchChangeProgramSource({ mesoId: w.mesocycleId, programId: w.programId, planningType: w.planningType, currentWeek: over.currentWeek ?? w.currentWeek })

const byId = <T extends { id: string }>(list: readonly T[]): T[] => [...list].sort((a, b) => a.id.localeCompare(b.id))
function pick<T extends object>(row: T, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k] ?? null]))
}
const EXERCISE_KEYS = ['id', 'workoutDayId', 'exerciseId', 'position', 'weightUnit', 'supersetBlockId', 'restSeconds', 'restAfterSeconds', 'tempo', 'weekOnly', 'removedAt']
const SET_KEYS = ['id', 'programExerciseId', 'position', 'isWarmup', 'stageKind', 'stageRestSeconds', 'parentProgramSetId', 'stageIndex', 'repMin', 'repMax', 'isAmrap', 'restSeconds', 'removedAt']
const sessionsCanon = (list: readonly ChangeSession[]) =>
  byId(list).map((s) => ({
    ...s,
    exercises: [...s.exercises].sort((a, b) => a.weekPlanExerciseId.localeCompare(b.weekPlanExerciseId)),
    sets: byId(s.sets),
  }))

beforeEach(() => {
  h.client = null
})

describe('the run copy and its sessions are read as chunk 45 reads the same rows', () => {
  it('a week-dependent run: workouts, rows, blocks, routine, schedule, sessions with their statuses', async () => {
    const w = weekDependentWorld()
    const statuses: Record<string, RunChangeStatus> = { 'p2-push': 'done', 'p2-pull': 'in_progress' }
    serve(tablesOf(w, statuses))
    const got = await read(w)
    const want = { runCopy: runCopyOf(w.db, w.programId, w.mesocycleId), sessions: sessionsOf(w.db, w.mesocycleId, statuses, w.currentWeek) }

    expect(got.runCopy.programId).toBe(w.programId)
    expect(got.runCopy.mesocycleId).toBe(w.mesocycleId)
    expect(got.runCopy.schedule).toEqual(want.runCopy.schedule)
    expect(got.runCopy.workouts).toEqual(want.runCopy.workouts)
    expect(byId(got.runCopy.exercises).map((r) => pick(r, EXERCISE_KEYS))).toEqual(byId(want.runCopy.exercises).map((r) => pick(r, EXERCISE_KEYS)))
    expect(byId(got.runCopy.blocks)).toEqual(byId(want.runCopy.blocks))
    expect(byId(got.runCopy.routine)).toEqual(byId(want.runCopy.routine))
    expect(sessionsCanon(got.sessions)).toEqual(sessionsCanon(want.sessions))
    // the statuses are the ones the sessions give
    expect(got.sessions.find((s) => s.id === 'p2-push')?.status).toBe('done')
    expect(got.sessions.find((s) => s.id === 'p2-pull')?.status).toBe('in_progress')
    expect(got.sessions.find((s) => s.id === 'p2-legs')?.status).toBe('not_started')
  })

  it('a stable run: the same, and the default sets of its live rows', async () => {
    const w = stableWorld()
    const statuses: Record<string, RunChangeStatus> = { 'p2-fb': 'done' }
    serve(tablesOf(w, statuses))
    const got = await read(w)
    const want = runCopyOf(w.db, w.programId, w.mesocycleId)

    expect(byId(got.runCopy.exercises).map((r) => pick(r, EXERCISE_KEYS))).toEqual(byId(want.exercises).map((r) => pick(r, EXERCISE_KEYS)))
    expect(want.sets.length).toBeGreaterThan(0)
    expect(byId(got.runCopy.sets).map((r) => pick(r, SET_KEYS))).toEqual(byId(want.sets).map((r) => pick(r, SET_KEYS)))
    expect(byId(got.runCopy.blocks)).toEqual(byId(want.blocks))
    expect(byId(got.runCopy.routine)).toEqual(byId(want.routine))
    expect(sessionsCanon(got.sessions)).toEqual(sessionsCanon(sessionsOf(w.db, w.mesocycleId, statuses, w.currentWeek)))
  })

  it("the run's own schedule rows and no other run's", async () => {
    const w = stableWorld()
    serve(tablesOf(w, {}))
    const got = await read(w)
    expect(got.scheduleRows.map((r) => r.id)).toEqual(['rs-1'])
    expect(got.scheduleRows.map((r) => ({ ...r, createdAt: '' }))).toEqual(
      scheduleRowsOf({ ...w.db, v2_run_schedules: [{ id: 'rs-1', user_id: USER, mesocycle_id: w.mesocycleId, from_week: 3, schedule: { monday: w.db.v2_workout_days[0].id } }] }, w.mesocycleId),
    )
  })

  it('names the exercises its rows name, and no exercise the run does not use', async () => {
    const w = weekDependentWorld()
    serve(tablesOf(w, {}))
    const got = await read(w)
    const used = new Set(w.db.v2_program_exercises.map((r) => r.exercise_id))
    expect(new Set(got.exercises.map((e) => e.id))).toEqual(used)
    expect(got.exercises.find((e) => e.id === 'ex-pd')?.name).toBe('Exercise ex-pd')
  })

  it("the saved program's rows are not the run copy's: its workouts, rows, sets, block and routine item stay out", async () => {
    const w = stableWorld()
    serve(tablesOf(w, {}))
    const got = await read(w)
    expect(got.runCopy.workouts.map((x) => x.id)).not.toContain('saved-w')
    expect(got.runCopy.exercises.map((x) => x.id)).not.toContain('saved-pe')
    expect(got.runCopy.sets.map((x) => x.id)).not.toContain('saved-set')
    expect(got.runCopy.blocks.map((x) => x.id)).not.toContain('saved-blk')
    expect(got.runCopy.routine.map((x) => x.id)).not.toContain('saved-item')
    // and the schedule is the run copy's, not the saved program's
    expect(got.runCopy.schedule.monday).toBeNull()
    expect(got.runCopy.schedule.tuesday).toBe('fb')
  })
})

describe('which planned sessions are read', () => {
  it('from the current week on: an earlier week is not read, and the week asked for is the one passed', async () => {
    const w = stableWorld() // weeks 1, 2 and 3 planned
    serve(tablesOf(w, {}))
    expect(new Set((await read(w)).sessions.map((s) => s.weekNumber))).toEqual(new Set([2, 3]))
    expect(fake.to('v2_week_plans')[0].filters).toContainEqual({ op: 'gte', column: 'week_number', value: 2 })
    serve(tablesOf(w, {}))
    expect(new Set((await read(w, { currentWeek: 3 })).sessions.map((s) => s.weekNumber))).toEqual(new Set([3]))
  })

  it("this run's plan rows only: another run's plan row in the same weeks is not read, and the read is asked for this run", async () => {
    const w = weekDependentWorld()
    serve(tablesOf(w, {}))
    const got = await read(w)
    expect(got.sessions.map((s) => s.id)).not.toContain('other-plan')
    expect(fake.to('v2_week_plans')[0].filters).toContainEqual({ op: 'eq', column: 'mesocycle_id', value: w.mesocycleId })
  })

  it("a plan row's status: done beats in progress, a skipped session is done, a session only planned is not started", async () => {
    const w = stableWorld()
    const tables = tablesOf(w, {}, {
      v2_sessions: [
        sessionRow('a1', w.mesocycleId, 'p2-fb', 'in_progress'),
        sessionRow('a2', w.mesocycleId, 'p2-fb', 'completed'), // G14: one plan row, two weekdays, two sessions
        sessionRow('b1', w.mesocycleId, 'p3-fb', 'skipped'),
        sessionRow('c1', w.mesocycleId, 'p2-arms', 'in_progress'),
        sessionRow('d1', w.mesocycleId, 'p3-arms', 'planned'),
        sessionRow('e1', w.mesocycleId, null, 'completed'), // an ad-hoc session has no plan row
      ],
    })
    serve(tables)
    const got = await read(w)
    const status = (id: string) => got.sessions.find((s) => s.id === id)?.status
    expect(status('p2-fb')).toBe('done')
    expect(status('p3-fb')).toBe('done')
    expect(status('p2-arms')).toBe('in_progress')
    expect(status('p3-arms')).toBe('not_started')
    expect(fake.to('v2_sessions')[0].filters).toContainEqual({ op: 'eq', column: 'mesocycle_id', value: w.mesocycleId })
  })

  it("a session marked deload brings its saved pre-deload plan; one that is not, null", async () => {
    const w = weekDependentWorld()
    const saved = [
      { programExerciseId: 'pe-pd', setNumber: 1, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: null, programSetId: 'ps-1', repMin: 8, repMax: 10, isAmrap: false, targetWeight: 60, targetRir: 2, targetRirMax: null, tags: ['push here'] },
    ]
    const tables = tablesOf(w, {})
    tables.v2_week_plans = tables.v2_week_plans.map((p) => (p.id === 'p3-pull' ? { ...p, deload_restore: saved } : p))
    serve(tables)
    const got = await read(w)
    expect(got.sessions.find((s) => s.id === 'p3-pull')?.deloadRestore).toEqual(saved)
    expect(got.sessions.find((s) => s.id === 'p2-pull')?.deloadRestore).toBeNull()
  })

  it("a session's exercise rows carry the id of their own row, and its sets their links", async () => {
    const w = weekDependentWorld()
    serve(tablesOf(w, {}))
    const got = await read(w)
    const pull = got.sessions.find((s) => s.id === 'p3-pull')!
    expect(pull.exercises.map((e) => e.weekPlanExerciseId).sort()).toEqual(['p3-pull-x-pe-face', 'p3-pull-x-pe-pd'])
    const head = pull.sets.find((s) => s.stageKind === 'dropset')!
    const drop = pull.sets.find((s) => s.stageIndex === 1)!
    expect(head.programSetId).toBe('pe-pd-s3')
    expect(drop).toMatchObject({ parentWeekPlanSetId: head.id, programSetId: 'pe-pd-s3-t1', isAmrap: true, programExerciseId: 'pe-pd' })
    expect(pull.sets.filter((s) => s.isWarmup).length).toBe(1)
  })
})

describe('every row of the run copy comes back, flagged', () => {
  it('a week-only row and a removed row are in the run copy, with their flags, and so are their exercises', async () => {
    const w = stableWorld()
    const tables = tablesOf(w, {}, {
      v2_program_exercises: [
        { id: 'pe-weekonly', user_id: USER, workout_day_id: 'fb', exercise_id: 'ex-row', position: 9, weight_unit: null, superset_block_id: null, rest_seconds: null, rest_after_seconds: null, tempo: null, week_only: true, removed_at: null },
        { id: 'pe-removed', user_id: USER, workout_day_id: 'fb', exercise_id: 'ex-x', position: 8, weight_unit: 'kg', superset_block_id: null, rest_seconds: 60, rest_after_seconds: null, tempo: null, week_only: false, removed_at: '2026-10-01T09:00:00Z' },
      ],
      v2_program_sets: [
        { id: 'removed-set', user_id: USER, program_exercise_id: 'pe-removed', position: 1, is_warmup: false, stage_kind: null, stage_rest_seconds: null, parent_program_set_id: null, stage_index: 0, rep_min: 5, rep_max: 5, is_amrap: false, rest_seconds: null, removed_at: null },
      ],
    })
    serve(tables)
    const got = await read(w)
    const row = (id: string) => got.runCopy.exercises.find((r) => r.id === id)
    expect(row('pe-weekonly')).toMatchObject({ weekOnly: true, removedAt: null })
    expect(row('pe-removed')).toMatchObject({ weekOnly: false, removedAt: '2026-10-01T09:00:00Z', restSeconds: 60, weightUnit: 'kg' })
    expect(row('pe-leg')).toMatchObject({ weekOnly: false, removedAt: null })
    expect(got.exercises.map((e) => e.id)).toEqual(expect.arrayContaining(['ex-row', 'ex-x']))
    // a row that is not live has no default sets read
    expect(got.runCopy.sets.map((s) => s.id)).not.toContain('removed-set')
    const asked = fake.to('v2_program_sets').flatMap((r) => r.filters.filter((f) => f.op === 'in').flatMap((f) => f.value as string[]))
    expect(asked).toContain('pe-leg')
    expect(asked).not.toContain('pe-removed')
    expect(asked).not.toContain('pe-weekonly')
  })

  it("a week-dependent run's default sets are not read at all", async () => {
    const w = weekDependentWorld()
    serve(tablesOf(w, {}))
    const got = await read(w)
    expect(got.runCopy.sets).toEqual([])
    expect(fake.to('v2_program_sets')).toEqual([])
  })
})

describe('every read of a table that grows pages (RULES.md, Checks that lied #31)', () => {
  it('a session with no plan row (one started from Today, not from a plan) is no plan row\'s status', async () => {
    const w = stableWorld()
    serve(tablesOf(w, {}, { v2_sessions: [sessionRow('adhoc', w.mesocycleId, null, 'completed'), sessionRow('s-1', w.mesocycleId, 'p3-fb', 'completed')] }))
    const statuses = await fetchPlanRowStatuses(w.mesocycleId)
    expect([...statuses.keys()]).toEqual(['p3-fb'])
  })

  it("the statuses of the sessions: a second page is asked for when the first is full, and its rows count", async () => {
    const w = stableWorld()
    const bulk = Array.from({ length: 500 }, (_, i) => sessionRow(`a-${String(i).padStart(4, '0')}`, w.mesocycleId, `gone-${i}`, 'in_progress'))
    serve(tablesOf(w, {}, { v2_sessions: [...bulk, sessionRow('zz-last', w.mesocycleId, 'p3-fb', 'completed')] }))
    const statuses = await fetchPlanRowStatuses(w.mesocycleId)
    expect(statuses.get('p3-fb')).toBe('done')
    expect(statuses.size).toBe(501)
    expect(fake.to('v2_sessions').map((r) => r.range)).toEqual([[0, 499], [500, 999]])
  })

  it('the planned sessions: 100 to a page, the rows of the second page are read', async () => {
    const w = stableWorld()
    const bulk = Array.from({ length: 101 }, (_, i) => ({ id: `a-${String(i).padStart(3, '0')}`, user_id: USER, mesocycle_id: w.mesocycleId, workout_day_id: 'fb', week_number: 6, is_deload: false, sequence_position: null }))
    serve(tablesOf(w, {}, { v2_week_plans: bulk }))
    const got = await read(w)
    expect(got.sessions.length).toBe(101 + 4)
    // the world's own plan rows sort after the bulk ones: they are on the second page, with their sets
    expect(got.sessions.find((s) => s.id === 'p3-arms')?.sets.length).toBeGreaterThan(0)
    expect(fake.to('v2_week_plans').map((r) => r.range)).toEqual([[0, 99], [100, 199]])
  })

  it("the run copy's exercise rows: 500 to a page, the rows of the second page are read", async () => {
    const w = stableWorld()
    const bulk = Array.from({ length: 501 }, (_, i) => ({ id: `a-${String(i).padStart(4, '0')}`, user_id: USER, workout_day_id: 'fb', exercise_id: 'ex-x', position: 100 + i, weight_unit: null, superset_block_id: null, rest_seconds: null, rest_after_seconds: null, tempo: null, week_only: true, removed_at: null }))
    serve(tablesOf(w, {}, { v2_program_exercises: bulk }))
    const got = await read(w)
    expect(got.runCopy.exercises.length).toBe(501 + w.db.v2_program_exercises.length)
    expect(got.runCopy.exercises.map((r) => r.id)).toContain('pe-dip')
    expect(fake.to('v2_program_exercises').map((r) => r.range)).toEqual([[0, 499], [500, 999]])
  })

  it('the default sets: 20 exercise rows to a request, and a request pages', async () => {
    const w = stableWorld()
    const live = Array.from({ length: 25 }, (_, i) => ({ id: `live-${i}`, user_id: USER, workout_day_id: 'arms', exercise_id: 'ex-x', position: 20 + i, weight_unit: null, superset_block_id: null, rest_seconds: null, rest_after_seconds: null, tempo: null, week_only: false, removed_at: null }))
    const sets = Array.from({ length: 501 }, (_, i) => ({ id: `s-${String(i).padStart(4, '0')}`, user_id: USER, program_exercise_id: 'live-3', position: i + 1, is_warmup: false, stage_kind: null, stage_rest_seconds: null, parent_program_set_id: null, stage_index: 0, rep_min: 8, rep_max: 10, is_amrap: false, rest_seconds: null, removed_at: null }))
    serve(tablesOf(w, {}, { v2_program_exercises: live, v2_program_sets: sets }))
    const got = await read(w)
    const liveCount = w.db.v2_program_exercises.length + 25
    const asked = fake.to('v2_program_sets').map((r) => (r.filters.find((f) => f.op === 'in')!.value as string[]).length)
    expect(asked.every((n) => n <= 20)).toBe(true)
    expect(asked.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(liveCount) // every live row is asked about, the request holding live-3 twice (its second page)
    expect(got.runCopy.sets.filter((s) => s.programExerciseId === 'live-3').length).toBe(501)
    expect(got.runCopy.sets.length).toBe(501 + w.db.v2_program_sets.length)
    expect(fake.to('v2_program_sets').some((r) => r.range?.[0] === 500)).toBe(true)
  })
})

describe('a read that fails fails the read', () => {
  const cases: Array<[string, () => World]> = [
    ['v2_programs', weekDependentWorld],
    ['v2_program_exercises', weekDependentWorld],
    ['v2_week_plans', weekDependentWorld],
    ['v2_sessions', weekDependentWorld],
    ['v2_program_sets', stableWorld],
  ]
  for (const [table, world] of cases) {
    it(`${table}: the error the server gave is thrown, not an empty run`, async () => {
      const w = world()
      serve(tablesOf(w, {}))
      fake.failWith(table, `boom in ${table}`)
      await expect(read(w)).rejects.toMatchObject({ message: `boom in ${table}` })
    })
  }
})
