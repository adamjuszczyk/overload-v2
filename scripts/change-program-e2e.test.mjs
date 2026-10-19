import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BREAKS, CONTROLS, dumpSql, evaluate, facts } from './change-program-e2e.mjs'

// scripts/change-program-e2e.mjs (chunk 51a) judges what `v2_apply_ops` did to a replayed database; the database run is the proof.
// What can be tested without Docker is the judge: given the rows before and after, does each assertion hold when it should and
// fail when the rows are wrong in the one way it names? A judge that passes whatever it is shown would let the run say "held".
// These tests build the two readings by hand (the outcome TASKS 51a describes) and break the "after" one at a time.

const clone = (x) => JSON.parse(JSON.stringify(x))
const uid = 'u1'

function world() {
  const ex = [['L', 'Lat Pulldown'], ['F', 'Face Pull'], ['M', 'Machine Pulldown'], ['C', 'Cable Curl']].map(([id, name]) => ({ id, name, user_id: uid }))
  const programs = [
    { id: 'S', kind: 'saved', name: 'Pull Week', user_id: uid, schedule: { monday: 'S1', tuesday: 'S2', thursday: 'S3' } },
    { id: 'R', kind: 'run', name: 'Pull Week run', user_id: uid, schedule: { monday: 'R1', tuesday: 'R2', thursday: 'R3' } },
  ]
  const days = [1, 2, 3].flatMap((i) => [
    { id: `S${i}`, program_id: 'S', name: `Pull ${i}`, position: i, user_id: uid },
    { id: `R${i}`, program_id: 'R', name: `Pull ${i}`, position: i, user_id: uid },
  ])
  const pe = []
  const ps = []
  for (const side of ['S', 'R']) {
    for (const i of [1, 2, 3]) {
      pe.push({ id: `${side}L${i}`, workout_day_id: `${side}${i}`, exercise_id: 'L', position: 1, rest_seconds: null, weight_unit: null, removed_at: null, replaces_program_exercise_id: null, user_id: uid })
      pe.push({ id: `${side}F${i}`, workout_day_id: `${side}${i}`, exercise_id: 'F', position: 2, rest_seconds: null, weight_unit: null, removed_at: null, replaces_program_exercise_id: null, user_id: uid })
      ps.push({ id: `${side}L${i}s1`, program_exercise_id: `${side}L${i}`, position: 1, is_warmup: true, user_id: uid })
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
      const base = { week_plan_id: id, program_exercise_id: `RL${i}`, target_weight: 55, target_rir: 2, target_rir_max: null, tags: ['push'], is_amrap: false, user_id: uid }
      wps.push({ ...base, id: `${id}-l1`, set_number: 1, stage_index: 0, is_warmup: true, stage_kind: null, parent_week_plan_set_id: null })
      wps.push({ ...base, id: `${id}-l2`, set_number: 2, stage_index: 0, is_warmup: false, stage_kind: null, parent_week_plan_set_id: null })
      wps.push({ ...base, id: `${id}-l3`, set_number: 3, stage_index: 0, is_warmup: false, stage_kind: 'dropset', parent_week_plan_set_id: null })
      wps.push({ ...base, id: `${id}-l4`, set_number: 3, stage_index: 1, is_warmup: false, stage_kind: null, parent_week_plan_set_id: `${id}-l3`, is_amrap: true })
      wps.push({ ...base, id: `${id}-f1`, program_exercise_id: `RF${i}`, set_number: 1, stage_index: 0, is_warmup: false, stage_kind: null, parent_week_plan_set_id: null })
    }
  }
  const sessions = [
    { id: 's1', week_plan_id: 'p21', status: 'completed', user_id: uid },
    { id: 's2', week_plan_id: 'p22', status: 'in_progress', user_id: uid },
  ]
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
    v2_sessions: sessions,
  }
}

// What the save does, written by hand on the rows: the outcome 051-a asks for.
function saved(pre) {
  const post = clone(pre)
  const run = post.v2_program_exercises
  for (const i of [1, 2, 3]) {
    for (const id of [`RL${i}`, `RF${i}`]) run.find((e) => e.id === id).removed_at = '2026-10-15T12:00:00Z'
    run.push({ id: `RM${i}`, workout_day_id: `R${i}`, exercise_id: 'M', position: 1, rest_seconds: null, weight_unit: null, removed_at: null, replaces_program_exercise_id: `RL${i}`, user_id: uid })
    run.push({ id: `RC${i}`, workout_day_id: `R${i}`, exercise_id: 'C', position: 2, rest_seconds: 120, weight_unit: 'kg', removed_at: null, replaces_program_exercise_id: null, user_id: uid })
  }
  post.v2_workout_days.find((d) => d.id === 'R2').name = 'Pull 2 (Tue)'
  const landed = [['2', '3'], ['3', '1'], ['3', '2'], ['3', '3']].map(([w, i]) => `p${w}${i}`)
  for (const id of landed) {
    const i = id[2]
    post.v2_week_plan_exercises = post.v2_week_plan_exercises.filter((x) => x.week_plan_id !== id)
    post.v2_week_plan_exercises.push({ id: `${id}-xM`, week_plan_id: id, program_exercise_id: `RM${i}`, position: 1, user_id: uid }, { id: `${id}-xC`, week_plan_id: id, program_exercise_id: `RC${i}`, position: 2, user_id: uid })
    post.v2_week_plan_sets = post.v2_week_plan_sets.filter((s) => s.id !== `${id}-f1`)
    for (const s of post.v2_week_plan_sets.filter((x) => x.week_plan_id === id)) Object.assign(s, { program_exercise_id: `RM${i}`, target_weight: null, target_rir: null, tags: null })
  }
  return post
}

const ok = (pre, post) => evaluate({ pre, post, ops: [1, 2], applied: 2 })
const failed = (rows) => rows.filter((r) => !r.ok).map((r) => r.id)

test('the outcome 051-a asks for passes every assertion', () => {
  const pre = world()
  assert.deepEqual(failed(ok(pre, saved(pre))), [])
})

test('facts reads the statuses and the programs the assertions are about', () => {
  const f = facts(world())
  assert.equal(f.saved.id, 'S')
  assert.equal(f.run.id, 'R')
  assert.equal(f.plans.find((p) => p.week === 2 && p.workout === 'Pull 1').status, 'done')
  assert.equal(f.plans.find((p) => p.week === 2 && p.workout === 'Pull 2').status, 'in_progress')
  assert.equal(f.plans.find((p) => p.week === 2 && p.workout === 'Pull 3').status, 'not_started')
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
broken("a session in progress lost an exercise", (p) => (p.v2_week_plan_exercises = p.v2_week_plan_exercises.filter((x) => x.id !== 'p22-xF')), ['A2'])
broken('week 1 changed', (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p11-l1').is_warmup = false), ['A3'])
broken('Thursday kept Face Pull', (p) => p.v2_week_plan_exercises.push({ id: 'x', week_plan_id: 'p23', program_exercise_id: 'RF3', position: 3, user_id: uid }), ['A4'])
broken('a swapped set kept its weight', (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p31-l2').target_weight = 55), ['A5'])
broken('a swapped set kept its cue', (p) => (p.v2_week_plan_sets.find((s) => s.id === 'p32-l2').tags = ['push']), ['A5'])
broken('the swapped exercise lost a set', (p) => (p.v2_week_plan_sets = p.v2_week_plan_sets.filter((s) => s.id !== 'p33-l4')), ['A5'])
broken('Cable Curl has a set', (p) => p.v2_week_plan_sets.push({ id: 'cs', week_plan_id: 'p23', program_exercise_id: 'RC3', set_number: 1, stage_index: 0, target_weight: null, user_id: uid }), ['A6'])
broken('the old exercise still has a set', (p) => p.v2_week_plan_sets.push({ id: 'old', week_plan_id: 'p31', program_exercise_id: 'RF1', set_number: 1, stage_index: 0, user_id: uid }), ['A7'])
broken("Cable Curl's rest is missing", (p) => (p.v2_program_exercises.find((e) => e.id === 'RC1').rest_seconds = null), ['A8'])
broken("an old row is live", (p) => (p.v2_program_exercises.find((e) => e.id === 'RF2').removed_at = null), ['A9'])
broken("the swap's link is missing", (p) => (p.v2_program_exercises.find((e) => e.id === 'RM3').replaces_program_exercise_id = null), ['A9'])
broken('the rename did not happen', (p) => (p.v2_workout_days.find((d) => d.id === 'R2').name = 'Pull 2'), ['A10'])
broken('a default set was written', (p) => p.v2_program_sets.push({ id: 'ds', program_exercise_id: 'RM1', position: 1, user_id: uid }), ['A11'])
broken('the saved program changed', (p) => (p.v2_program_exercises.find((e) => e.id === 'SL1').rest_seconds = 5), ['A12'])
broken('the run schedule changed', (p) => (p.v2_programs.find((x) => x.id === 'R').schedule = {}), ['A13'])

test('a count of applied ops that differs from the ops sent fails A0', () => {
  const pre = world()
  assert.ok(failed(evaluate({ pre, post: saved(pre), ops: [1, 2, 3], applied: 2 })).includes('A0'))
})

test('a fixture that is not the one TASKS describes fails its preconditions', () => {
  const pre = world()
  pre.v2_sessions = []
  assert.ok(failed(ok(pre, saved(pre))).includes('P1'))
  const flat = world()
  flat.v2_week_plan_sets.forEach((s) => (s.target_weight = null))
  assert.ok(failed(ok(flat, saved(flat))).includes('P2'))
})

test('every break names assertions the judge has, and the dump asks for every table once', () => {
  const ids = new Set(evaluate({ pre: world(), post: saved(world()), ops: [], applied: 0 }).map((r) => r.id))
  for (const b of BREAKS) for (const id of b.fails) assert.ok(ids.has(id), `${b.id} names ${id}`)
  assert.equal(new Set([...BREAKS, ...CONTROLS].map((b) => b.id)).size, BREAKS.length + CONTROLS.length)
  const sql = dumpSql('X')
  for (const t of ['v2_programs', 'v2_week_plan_sets', 'v2_sessions', 'exercises']) assert.equal(sql.split(`'${t}'`).length - 1, 1)
})
