import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BREAKS, CONTROLS, evaluate } from './change-program-e2e-b.mjs'

// scripts/change-program-e2e-b.mjs (chunk 51b) judges what `v2_apply_ops` did to a replayed database for the stable run of fixture 051-b;
// the database run is the proof. What can be tested without Docker is the judge: given the rows before and after, does each assertion hold
// when it should and fail when the rows are wrong in the one way it names? A judge that passes whatever it is shown would let the run say
// "held". These tests build the two readings by hand (the outcome TASKS 51b describes) and break the "after" one at a time.

const clone = (x) => JSON.parse(JSON.stringify(x))
const uid = 'u1'
const MONDAY = { monday: 'R1', tuesday: 'R2', thursday: 'R3' }
const AFTER = { monday: 'R1', wednesday: 'R2', thursday: 'R3' }

// What the app's own resolver and run-copy reader do, in the few lines the judge asks of them (the run asks the real modules).
const app = {
  runSchedule: {
    scheduleForWeek: (rows, runSchedule, week) => {
      let best = null
      for (const r of rows) if (r.fromWeek <= week && (best === null || r.fromWeek > best.fromWeek)) best = r
      return best === null ? runSchedule : best.schedule
    },
  },
  util: {
    scheduleRowsOf: (db) => db.v2_run_schedules.map((r) => ({ fromWeek: r.from_week, schedule: r.schedule })),
    runCopyOf: (db, programId) => ({ schedule: db.v2_programs.find((p) => p.id === programId).schedule }),
  },
}

const dp = (id, program_exercise_id, position, over = {}) => ({
  id, program_exercise_id, position, is_warmup: false, stage_kind: null, parent_program_set_id: null, stage_index: 0, rep_min: null, rep_max: null, is_amrap: false, removed_at: null, user_id: uid, ...over,
})
const ws = (id, week_plan_id, program_exercise_id, set_number, over = {}) => ({
  id, week_plan_id, program_exercise_id, set_number, stage_index: 0, is_warmup: false, stage_kind: null, parent_week_plan_set_id: null, program_set_id: null,
  rep_min: null, rep_max: null, is_amrap: false, target_weight: 55, target_rir: 2, target_rir_max: null, tags: null, user_id: uid, ...over,
})

function world() {
  const ex = [['L', 'Lat Pulldown'], ['F', 'Face Pull'], ['C', 'Cable Curl']].map(([id, name]) => ({ id, name, user_id: uid }))
  const programs = [
    { id: 'S', kind: 'saved', name: 'Pull Week', user_id: uid, schedule: MONDAY },
    { id: 'R', kind: 'run', name: 'Pull Week run', user_id: uid, schedule: MONDAY },
  ]
  const days = [1, 2, 3].flatMap((i) => [
    { id: `S${i}`, program_id: 'S', name: `Pull ${i}`, position: i, user_id: uid },
    { id: `R${i}`, program_id: 'R', name: `Pull ${i}`, position: i, user_id: uid },
  ])
  const pe = []
  const ps = []
  for (const side of ['S', 'R']) {
    for (const i of [1, 2, 3]) {
      const l = `${side}L${i}`
      const f = `${side}F${i}`
      pe.push({ id: l, workout_day_id: `${side}${i}`, exercise_id: 'L', position: 1, rest_seconds: null, weight_unit: null, removed_at: null, user_id: uid })
      pe.push({ id: f, workout_day_id: `${side}${i}`, exercise_id: 'F', position: 2, rest_seconds: null, weight_unit: null, removed_at: null, user_id: uid })
      ps.push(dp(`${l}-s1`, l, 1, { is_warmup: true, rep_min: 12, rep_max: 12 }), dp(`${l}-s2`, l, 2, { rep_min: 8, rep_max: 10 }), dp(`${l}-s3`, l, 3, { stage_kind: 'dropset', rep_min: 8, rep_max: 10 }))
      ps.push(dp(`${l}-t1`, l, 3, { parent_program_set_id: `${l}-s3`, stage_index: 1, is_amrap: true }))
      ps.push(dp(`${f}-s1`, f, 1, { rep_min: 15, rep_max: 20 }), dp(`${f}-s2`, f, 2, { rep_min: 15, rep_max: 20 }))
    }
  }
  const plans = []
  const wpe = []
  const wps = []
  for (const w of [1, 2, 3]) {
    for (const i of [1, 2, 3]) {
      const id = `p${w}${i}`
      plans.push({ id, mesocycle_id: 'MESO', workout_day_id: `R${i}`, week_number: w, user_id: uid })
      wpe.push({ id: `${id}-xL`, week_plan_id: id, program_exercise_id: `RL${i}`, position: 1, user_id: uid })
      wpe.push({ id: `${id}-xF`, week_plan_id: id, program_exercise_id: `RF${i}`, position: 2, user_id: uid })
      wps.push(ws(`${id}-l1`, id, `RL${i}`, 1, { is_warmup: true, program_set_id: `RL${i}-s1`, rep_min: 12, rep_max: 12 }))
      wps.push(ws(`${id}-l2`, id, `RL${i}`, 2, { program_set_id: `RL${i}-s2`, rep_min: 8, rep_max: 10 }))
      wps.push(ws(`${id}-l3`, id, `RL${i}`, 3, { stage_kind: 'dropset', program_set_id: `RL${i}-s3`, rep_min: 8, rep_max: 10 }))
      wps.push(ws(`${id}-l4`, id, `RL${i}`, 3, { stage_index: 1, parent_week_plan_set_id: `${id}-l3`, program_set_id: `RL${i}-t1`, is_amrap: true }))
      wps.push(ws(`${id}-f1`, id, `RF${i}`, 1, { program_set_id: `RF${i}-s1`, rep_min: 15, rep_max: 20 }))
      // Thursday of week 2 (Pull 3): Face Pull's set 2 was changed for that week only
      wps.push(ws(`${id}-f2`, id, `RF${i}`, 2, id === 'p23' ? { program_set_id: `RF${i}-s2`, rep_min: 12, rep_max: 15 } : { program_set_id: `RF${i}-s2`, rep_min: 15, rep_max: 20 }))
    }
  }
  return {
    exercises: ex,
    v2_programs: programs,
    v2_workout_days: days,
    v2_mesocycles: [{ id: 'MESO', program_id: 'R', user_id: uid }],
    v2_program_exercises: pe,
    v2_program_sets: ps,
    v2_program_superset_blocks: [],
    v2_workout_warmup_items: [],
    v2_run_schedules: [],
    v2_week_plans: plans,
    v2_week_plan_exercises: wpe,
    v2_week_plan_sets: wps,
    v2_sessions: [
      { id: 's1', week_plan_id: 'p21', status: 'completed', user_id: uid },
      { id: 's2', week_plan_id: 'p22', status: 'in_progress', user_id: uid },
    ],
  }
}

// What the save does, written by hand on the rows: the outcome 051-b asks for.
function saved(pre) {
  const post = clone(pre)
  for (const i of [1, 2, 3]) {
    const run = post.v2_program_sets
    run.find((s) => s.id === `RL${i}-s2`).rep_min = 10
    run.find((s) => s.id === `RL${i}-s2`).rep_max = 12
    for (const id of [`RF${i}-s2`]) Object.assign(run.find((s) => s.id === id), { rep_min: 10, rep_max: 12 })
    run.push(dp(`RF${i}-s3`, `RF${i}`, 3, { rep_min: 10, rep_max: 12 }))
    post.v2_program_exercises.push({ id: `RC${i}`, workout_day_id: `R${i}`, exercise_id: 'C', position: 3, rest_seconds: null, weight_unit: 'kg', removed_at: null, user_id: uid })
    run.push(dp(`RC${i}-s1`, `RC${i}`, 1), dp(`RC${i}-s2`, `RC${i}`, 2, { rep_min: 10, rep_max: 12 }))
  }
  post.v2_run_schedules = [
    { id: 'r1', mesocycle_id: 'MESO', from_week: 1, schedule: { ...MONDAY }, user_id: uid },
    { id: 'r3', mesocycle_id: 'MESO', from_week: 3, schedule: { ...AFTER }, user_id: uid },
  ]
  post.v2_programs.find((p) => p.id === 'R').schedule = { ...AFTER }
  for (const id of ['p23', 'p31', 'p32', 'p33']) {
    const i = id[2]
    const sets = post.v2_week_plan_sets
    sets.find((s) => s.id === `${id}-l2`).rep_min = 10
    sets.find((s) => s.id === `${id}-l2`).rep_max = 12
    if (id !== 'p23') Object.assign(sets.find((s) => s.id === `${id}-f2`), { rep_min: 10, rep_max: 12 })
    sets.push(ws(`${id}-f3`, id, `RF${i}`, 3, { program_set_id: `RF${i}-s3`, rep_min: 10, rep_max: 12, target_weight: null, target_rir: null }))
    post.v2_week_plan_exercises.push({ id: `${id}-xC`, week_plan_id: id, program_exercise_id: `RC${i}`, position: 3, user_id: uid })
    sets.push(ws(`${id}-c1`, id, `RC${i}`, 1, { program_set_id: `RC${i}-s1`, target_weight: null, target_rir: null }))
    sets.push(ws(`${id}-c2`, id, `RC${i}`, 2, { program_set_id: `RC${i}-s2`, rep_min: 10, rep_max: 12, target_weight: null, target_rir: null }))
  }
  return post
}

const ok = (pre, post) => evaluate({ pre, post, ops: [1, 2], applied: 2, app })
const failed = (rows) => rows.filter((r) => !r.ok).map((r) => r.id)

test('the outcome 051-b asks for passes every assertion', () => {
  const pre = world()
  assert.deepEqual(failed(ok(pre, saved(pre))), [])
})

test('the scheduler line prints what was resolved for each week', () => {
  const pre = world()
  const a12 = ok(pre, saved(pre)).find((r) => r.id === 'A12')
  assert.match(a12.title, /week 1 tuesday, week 2 tuesday, week 3 wednesday, week 4 wednesday/)
})

const broken = (name, mutate, ids) =>
  test(`fails ${ids.join(' and ')} when ${name}`, () => {
    const pre = world()
    const post = saved(pre)
    mutate(post)
    const got = failed(ok(pre, post))
    for (const id of ids) assert.ok(got.includes(id), `${id} should have failed, failed: ${got.join(',') || 'none'}`)
  })

broken("a done session's set changed", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p21-l2').target_weight = 60), ['A1'])
broken('a session in progress got a new set', (p) => p.v2_week_plan_sets.push(ws('x', 'p22', 'RF2', 3, { rep_min: 10, rep_max: 12 })), ['A2'])
broken('week 1 changed', (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p11-l1').is_warmup = false), ['A3'])
broken("Thursday's Lat Pulldown set 2 never changed", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p23-l2').rep_min = 8), ['A4'])
broken("Thursday's Lat Pulldown set 2 lost its weight", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p23-l2').target_weight = null), ['A4'])
broken("Thursday's other Lat Pulldown set changed", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p23-l1').rep_min = 10), ['A4'])
broken("Thursday's THIS WEEK ONLY set was written", (p) => Object.assign(p.v2_week_plan_sets.find((s) => s.id === 'p23-f2'), { rep_min: 10, rep_max: 12 }), ['A5'])
broken("Thursday's THIS WEEK ONLY set lost its weight", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p23-f2').target_weight = null), ['A5'])
broken("Thursday's Face Pull set 1 changed", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p23-f1').rep_min = 10), ['A5'])
broken('Thursday got no third Face Pull set', (p) => (p.v2_week_plan_sets = p.v2_week_plan_sets.filter((s) => s.id !== 'p23-f3')), ['A6'])
broken('the third Face Pull set kept a weight', (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p23-f3').target_weight = 55), ['A6'])
broken('the third Face Pull set links to nothing', (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p23-f3').program_set_id = null), ['A6'])
broken('Thursday has no Cable Curl sets (the added exercise landed with none)', (p) => (p.v2_week_plan_sets = p.v2_week_plan_sets.filter((s) => !s.id.startsWith('p23-c'))), ['A7'])
broken('week 3 has no Cable Curl row', (p) => (p.v2_week_plan_exercises = p.v2_week_plan_exercises.filter((x) => x.id !== 'p31-xC')), ['A7'])
broken("Cable Curl's second set is not a range", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p32-c2').rep_min = null), ['A7'])
broken('Cable Curl is not last', (p) => (p.v2_week_plan_exercises.find((x) => x.id === 'p33-xC').position = 0), ['A7'])
broken('Cable Curl landed in a session in progress', (p) => p.v2_week_plan_exercises.push({ id: 'y', week_plan_id: 'p22', program_exercise_id: 'RC2', position: 3, user_id: uid }), ['A8'])
broken('Cable Curl landed in a done session (sets only)', (p) => p.v2_week_plan_sets.push(ws('z', 'p21', 'RC1', 1)), ['A8'])
broken("week 3's Lat Pulldown set 2 is not 10-12", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p32-l2').rep_min = 8), ['A9'])
broken("week 3's Face Pull set 2 is not 10-12", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p31-f2').rep_min = 15), ['A9'])
broken("week 3's third Face Pull set is missing", (p) => (p.v2_week_plan_sets = p.v2_week_plan_sets.filter((s) => s.id !== 'p33-f3')), ['A9'])
broken("week 3's weights were cleared", (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p31-l2').target_weight = null), ['A9'])
broken("the default's Lat Pulldown set 2 is not 10-12", (p) => (p.v2_program_sets.find((s) => s.id === 'RL2-s2').rep_min = 8), ['A10'])
broken("the default's Face Pull has two sets", (p) => (p.v2_program_sets = p.v2_program_sets.filter((s) => s.id !== 'RF3-s3')), ['A10'])
broken("the default's Face Pull third set is dropped (removed_at)", (p) => (p.v2_program_sets.find((s) => s.id === 'RF1-s3').removed_at = 'x'), ['A10'])
broken("the default's Cable Curl has one set", (p) => (p.v2_program_sets = p.v2_program_sets.filter((s) => s.id !== 'RC2-s2')), ['A10'])
broken("the default's dropset lost its drop", (p) => (p.v2_program_sets = p.v2_program_sets.filter((s) => s.id !== 'RL1-t1')), ['A10'])
broken('the new days start from week 2', (p) => (p.v2_run_schedules[1].from_week = 2), ['A11', 'A12'])
broken("the old days' row is missing", (p) => (p.v2_run_schedules = p.v2_run_schedules.slice(1)), ['A11', 'A12'])
broken("the run copy's schedule still says Tuesday", (p) => (p.v2_programs.find((x) => x.id === 'R').schedule = { ...MONDAY }), ['A11'])
broken('week 3 resolves to Tuesday', (p) => (p.v2_run_schedules[1].schedule = { ...MONDAY }), ['A11', 'A12'])
broken('a plan row changed', (p) => (p.v2_week_plans.find((x) => x.id === 'p33').week_number = 4), ['A13'])
broken('a session changed', (p) => (p.v2_sessions[1].status = 'completed'), ['A13'])
broken('the saved program changed', (p) => (p.v2_program_exercises.find((e) => e.id === 'SL1').rest_seconds = 5), ['A14'])
broken("the saved program's set changed", (p) => (p.v2_program_sets.find((s) => s.id === 'SF2-s2').rep_min = 10), ['A14'])

test('a count of applied ops that differs from the ops sent fails A0', () => {
  const pre = world()
  assert.ok(failed(evaluate({ pre, post: saved(pre), ops: [1, 2, 3], applied: 2, app })).includes('A0'))
})

test('a fixture that is not the one TASKS describes fails its preconditions', () => {
  const pre = world()
  pre.v2_sessions = []
  assert.ok(failed(ok(pre, saved(pre))).includes('P1'))
  const flat = world()
  flat.v2_week_plan_sets.forEach((s) => (s.target_weight = null))
  assert.ok(failed(ok(flat, saved(flat))).includes('P2'))
  const noWeekOnly = world()
  Object.assign(noWeekOnly.v2_week_plan_sets.find((s) => s.id === 'p23-f2'), { rep_min: 15, rep_max: 20 })
  assert.ok(failed(ok(noWeekOnly, saved(noWeekOnly))).includes('P3'))
})

test('every break names assertions the judge has, and every id is its own', () => {
  const ids = new Set(evaluate({ pre: world(), post: saved(world()), ops: [], applied: 0, app }).map((r) => r.id))
  for (const b of BREAKS) for (const id of b.fails) assert.ok(id === '(apply refused)' || ids.has(id), `${b.id} names ${id}`)
  assert.equal(new Set([...BREAKS, ...CONTROLS].map((b) => b.id)).size, BREAKS.length + CONTROLS.length)
})
