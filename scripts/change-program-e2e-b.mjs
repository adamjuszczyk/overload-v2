#!/usr/bin/env node
// change-program-e2e-b.mjs (chunk 51b)
//
// TASKS-1.2 chunk 51b, Verification: "W, end to end on the replayed database: fixture 051-b — the F1-b run (stable) with week 2 (Monday
// done, Tuesday in progress, Thursday planned, one of Thursday's sets changed this week only) and week 3 planned forward: the op list for
// 'set 2 rep target 10–12, add a set to Face Pull, add Cable Curl at the end with two sets, Tuesday → Wednesday' applied through
// `v2_apply_ops`; then: Monday and Tuesday unchanged; Thursday's set 2 at 10–12 where it matched and the this-week-only set untouched;
// week 3 fully updated; Thursday and week 3 list Cable Curl last with its two sets (DECISIONS 171); `v2_run_schedules` has `from_week 1`
// (Tuesday) and `from_week 3` (Wednesday); the run copy's `schedule` says Wednesday; Today's scheduler (50) resolved for week 3 puts the
// workout on Wednesday and for week 2 on Tuesday (printed). The saved program byte-identical."
//
// The same machinery as chunk 51a's change-program-e2e.mjs (it exports what is shared), on a different fixture: one psql session, one
// transaction, rolled back at the end (nothing is left behind):
//   1. as a signed-in throwaway user, with pg-safeupdate loaded, the fixture: three STABLE pull workouts (Pull 1 on Monday, Pull 2 on
//      Tuesday, Pull 3 on Thursday: each Lat Pulldown with a warmup, a working set with a rest of 150 s and a dropset head with an AMRAP
//      drop, and Face Pull x2), a saved program, a run started through the migrations' own `v2_start_run`, weeks 1-3 planned with
//      `v2_plan_week` (week 1 given numbers, which the copies carry), week 2's sessions (Monday done, Tuesday in progress, Thursday not
//      started) and one of Thursday's sets changed for that week only (Face Pull's set 2 at 12-15, where the default says 15-20);
//   2. the rows are read out as JSON, and the APP'S OWN TypeScript (Vite's SSR loader, nothing built) reads them as a screen would:
//      `changeProgramDraft.ts` makes the edit on every Pull workout, and `planProgramChange` (chunk 45) makes the op list;
//   3. the list goes through `v2_apply_ops` (043) in the same session, and the rows are read out again.
// The assertions compare the two readings, and Today's scheduler's own resolver (`runSchedule.ts`) is asked for the workout's days in
// weeks 1-4. Nothing is read by eye: the script prints each assertion and exits non-zero.
//
// Usage:  bash scripts/replay-migrations.sh --keep         (Docker; start dockerd first)
//         node scripts/change-program-e2e-b.mjs               the scenario: every assertion must hold
//         node scripts/change-program-e2e-b.mjs --breaks      each break (the op list made wrong in one exact way) must fail an assertion
//         node scripts/change-program-e2e-b.mjs --list        the assertions and the breaks, no database
//         --container NAME   needed only when more than one kept replay container is running
// Exit:   0 everything held / every break was caught · 1 an assertion failed or a break survived · 2 couldn't run.

import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { findContainer } from './apply-ops-proof.mjs'
import { Psql, SESSION_HEAD, TABLES, byPlan, dumpSql, facts, md5, rowCounts, savedFingerprint, short } from './change-program-e2e.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

// ─── The fixture ─────────────────────────────────────────────────────────────────────────────────────────────────────

// TASKS' F1-b (a stable run), three times over: the same Pull workout on three weekdays, so that one edit reaches a done session (Monday),
// a session in progress (Tuesday) and a session not started (Thursday) of week 2, and all three of week 3.
const FIXTURE = `
do $fx$
declare
  v_uid uuid := auth.uid();
  v_lat uuid; v_face uuid; v_curl uuid;
  v_prog uuid; v_meso uuid;
  v_wd uuid; v_pe_lat uuid; v_pe_face uuid; v_head uuid;
  v_names text[] := array['Pull 1', 'Pull 2', 'Pull 3'];
  v_days text[]  := array['monday', 'tuesday', 'thursday'];
  v_sched jsonb := '{}'::jsonb;
  v_i integer;
  r record;
begin
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Lat Pulldown', 'back') returning id into v_lat;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Face Pull', 'shoulders') returning id into v_face;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Cable Curl', 'biceps') returning id into v_curl;
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type) values (v_uid, 'Pull Week', 'saved', 'weekday', 'stable') returning id into v_prog;
  for v_i in 1..3 loop
    insert into v2_workout_days (program_id, user_id, name, position) values (v_prog, v_uid, v_names[v_i], v_i) returning id into v_wd;
    v_sched := v_sched || jsonb_build_object(v_days[v_i], v_wd);
    insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_wd, v_uid, v_lat, 1) returning id into v_pe_lat;
    insert into v2_program_exercises (workout_day_id, user_id, exercise_id, position) values (v_wd, v_uid, v_face, 2) returning id into v_pe_face;
    insert into v2_program_sets (user_id, program_exercise_id, position, is_warmup, rep_min, rep_max) values (v_uid, v_pe_lat, 1, true, 12, 12);
    insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max, rest_seconds) values (v_uid, v_pe_lat, 2, 8, 10, 150);
    insert into v2_program_sets (user_id, program_exercise_id, position, stage_kind, rep_min, rep_max) values (v_uid, v_pe_lat, 3, 'dropset', 8, 10) returning id into v_head;
    insert into v2_program_sets (user_id, program_exercise_id, position, parent_program_set_id, stage_index, is_amrap) values (v_uid, v_pe_lat, 3, v_head, 1, true);
    insert into v2_program_sets (user_id, program_exercise_id, position, rep_min, rep_max) values (v_uid, v_pe_face, 1, 15, 20), (v_uid, v_pe_face, 2, 15, 20);
    insert into v2_workout_warmup_items (user_id, workout_day_id, position, body) values (v_uid, v_wd, 0, 'Band pull-aparts, 2 x 15');
  end loop;
  update v2_programs set schedule = v_sched where id = v_prog;

  v_meso := v2_start_run(v_prog, 'Pull Week run', date '2026-10-05');

  -- week 1, planned and given numbers (every working set a weight and a RIR); weeks 2 and 3 take the default's sets and the numbers
  perform v2_plan_week(v_meso, 1);
  update v2_week_plan_sets set target_weight = 55, target_rir = 2 where week_plan_id in (select id from v2_week_plans where mesocycle_id = v_meso and week_number = 1);
  perform v2_plan_week(v_meso, 2);
  perform v2_plan_week(v_meso, 3);

  -- week 2's sessions: Monday done, Tuesday in progress, Thursday not started (no session)
  for r in select wp.id as plan_id, wd.name from v2_week_plans wp join v2_workout_days wd on wd.id = wp.workout_day_id where wp.mesocycle_id = v_meso and wp.week_number = 2 loop
    if r.name = 'Pull 1' then
      insert into v2_sessions (user_id, mesocycle_id, week_plan_id, workout_day_id, date, status, completed_at)
        select v_uid, v_meso, r.plan_id, workout_day_id, date '2026-10-12', 'completed', now() from v2_week_plans where id = r.plan_id;
    elsif r.name = 'Pull 2' then
      insert into v2_sessions (user_id, mesocycle_id, week_plan_id, workout_day_id, date, status, started_at)
        select v_uid, v_meso, r.plan_id, workout_day_id, date '2026-10-13', 'in_progress', now() from v2_week_plans where id = r.plan_id;
    elsif r.name = 'Pull 3' then
      -- one of Thursday's sets changed for that week only: Face Pull's set 2 at 12-15, where the default says 15-20 ("THIS WEEK ONLY")
      update v2_week_plan_sets s set rep_min = 12, rep_max = 15
        where s.week_plan_id = r.plan_id and s.set_number = 2 and s.parent_week_plan_set_id is null
          and s.program_exercise_id in (select pe.id from v2_program_exercises pe where pe.exercise_id = v_face);
    end if;
  end loop;
end $fx$;
`

// ─── Reading the rows the way a screen does, and judging what happened ───────────────────────────────────────────────

const setRows = (db, planId, name, nameOf) =>
  db.v2_week_plan_sets
    .filter((s) => s.week_plan_id === planId && nameOf(db.v2_program_exercises.find((p) => p.id === s.program_exercise_id)?.exercise_id) === name)
    .sort((x, y) => x.set_number - y.set_number || x.stage_index - y.stage_index)
const heads = (rows) => rows.filter((s) => s.parent_week_plan_set_id === null)
const reps = (r) => (r.is_amrap ? 'AMRAP' : r.rep_min === null ? 'none' : r.rep_min === r.rep_max ? String(r.rep_min) : `${r.rep_min}-${r.rep_max}`)
const daysOf = (schedule, id) => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].filter((d) => schedule[d] === id)

// The assertions. Each is `{ id, title, ok, why }`; `ctx` = { pre, post, ops, applied, app }.
export function evaluate({ pre, post, ops, applied, app }) {
  const a = facts(pre)
  const b = facts(post)
  const out = []
  const check = (id, title, ok, why = '') => out.push({ id, title, ok: Boolean(ok), why: ok ? '' : why })
  const nameA = (id) => a.name.get(id)
  const nameB = (id) => b.name.get(id)
  const planOf = (f, week, workout) => f.plans.find((p) => p.week === week && p.workout === workout)
  const WORKOUTS = ['Pull 1', 'Pull 2', 'Pull 3']

  // preconditions: the fixture is the one TASKS describes, or nothing below means anything
  const w2 = WORKOUTS.map((n) => planOf(a, 2, n))
  check('P1', 'week 2: Pull 1 done, Pull 2 in progress, Pull 3 not started; week 3 not started', w2.map((p) => p?.status).join() === 'done,in_progress,not_started' && WORKOUTS.every((n) => planOf(a, 3, n)?.status === 'not_started'), `statuses: ${w2.map((p) => p?.status).join()}`)
  const thu = planOf(a, 2, 'Pull 3')
  const thuLat = heads(setRows(pre, thu.id, 'Lat Pulldown', nameA))
  check('P2', 'before the save Thursday’s working sets carry weights and RIR (so "kept" can be seen)', thuLat[1]?.target_weight !== null && thuLat[1]?.target_rir !== null, 'no numbers before the save')
  const thuFace = heads(setRows(pre, thu.id, 'Face Pull', nameA))
  check('P3', 'before the save Thursday’s Face Pull set 2 is 12-15 (this week only) and set 1 is 15-20, like the default', reps(thuFace[1]) === '12-15' && reps(thuFace[0]) === '15-20', `Thursday's Face Pull: ${thuFace.map(reps).join(', ')}`)
  check('A0', 'v2_apply_ops reports one applied op per op sent', applied === ops.length, `sent ${ops.length}, applied ${applied}`)

  // untouched: done, in progress, past, and every plan row
  for (const [id, workout, why] of [['A1', 'Pull 1', "Monday's (done)"], ['A2', 'Pull 2', "Tuesday's (in progress)"]]) {
    const p = planOf(a, 2, workout)
    const before = byPlan(pre, p.id)
    const after = byPlan(post, p.id)
    check(id, `${why} rows are unchanged (md5 of its exercise and set rows before = after)`, md5(before.exercises) === md5(after.exercises) && md5(before.sets) === md5(after.sets), `${why} rows changed`)
  }
  check('A3', "week 1's rows are unchanged", a.plans.filter((p) => p.week === 1).every((p) => md5(byPlan(pre, p.id).exercises) === md5(byPlan(post, p.id).exercises) && md5(byPlan(pre, p.id).sets) === md5(byPlan(post, p.id).sets)), 'a week before the current one changed')

  // Thursday (week 2, not started): what landed, and what did not
  const thuLatAfter = heads(setRows(post, thu.id, 'Lat Pulldown', nameB))
  check('A4', "Thursday's Lat Pulldown set 2 is at 10-12 where it matched the default, its weight and RIR kept; its other sets are as they were", reps(thuLatAfter[1]) === '10-12' && thuLatAfter[1].target_weight === thuLat[1].target_weight && thuLatAfter[1].target_rir === thuLat[1].target_rir && [0, 2].every((i) => reps(thuLatAfter[i]) === reps(thuLat[i])), `Lat Pulldown: ${thuLatAfter.map(reps).join(', ')}`)
  const thuFaceAfter = heads(setRows(post, thu.id, 'Face Pull', nameB))
  check('A5', "Thursday's Face Pull set 2, changed for that week only, is untouched (the very same row), and set 1 is as it was", JSON.stringify(thuFaceAfter[1]) === JSON.stringify(thuFace[1]) && reps(thuFaceAfter[0]) === '15-20', `Face Pull: ${thuFaceAfter.map(reps).join(', ')}`)
  check('A6', 'Thursday’s Face Pull has a third set, 10-12 (the set before it), with no weight or RIR, linked to the default’s new set', thuFaceAfter.length === 3 && reps(thuFaceAfter[2]) === '10-12' && thuFaceAfter[2].target_weight === null && thuFaceAfter[2].target_rir === null && thuFaceAfter[2].program_set_id !== null, `Face Pull heads: ${thuFaceAfter.map(reps).join(', ')}`)

  // Cable Curl: last, with its two sets, in Thursday and in week 3 (DECISIONS 171)
  const lastExercise = (db, f, planId) => {
    const list = db.v2_week_plan_exercises.filter((x) => x.week_plan_id === planId).sort((x, y) => x.position - y.position)
    const row = db.v2_program_exercises.find((p) => p.id === list[list.length - 1]?.program_exercise_id)
    return row ? f.name.get(row.exercise_id) : null
  }
  const curlOk = (planId) => {
    const sets = heads(setRows(post, planId, 'Cable Curl', nameB))
    return lastExercise(post, b, planId) === 'Cable Curl' && sets.length === 2 && reps(sets[0]) === 'none' && reps(sets[1]) === '10-12' && sets.every((s) => s.target_weight === null && s.target_rir === null && s.program_set_id !== null)
  }
  const landed = [thu, ...WORKOUTS.map((n) => planOf(a, 3, n))]
  check('A7', 'Thursday and week 3 list Cable Curl last with its two sets (the second a range, none of the numbers), each linked to the default’s set', landed.every((p) => curlOk(p.id)), landed.map((p) => `${p.workout} w${p.week}: last ${lastExercise(post, b, p.id)}, ${heads(setRows(post, p.id, 'Cable Curl', nameB)).length} sets`).join(' | '))
  const notThere = [planOf(a, 2, 'Pull 1'), planOf(a, 2, 'Pull 2')]
  check('A8', 'neither Monday nor Tuesday has Cable Curl (a session that is done or in progress gets no new exercise)', notThere.every((p) => setRows(post, p.id, 'Cable Curl', nameB).length === 0 && !post.v2_week_plan_exercises.some((x) => x.week_plan_id === p.id && nameB(post.v2_program_exercises.find((r) => r.id === x.program_exercise_id)?.exercise_id) === 'Cable Curl')), 'a started session got Cable Curl')

  // week 3: fully updated
  const week3Ok = WORKOUTS.every((n) => {
    const p = planOf(a, 3, n)
    const lat = heads(setRows(post, p.id, 'Lat Pulldown', nameB))
    const face = heads(setRows(post, p.id, 'Face Pull', nameB))
    const latBefore = heads(setRows(pre, p.id, 'Lat Pulldown', nameA))
    return reps(lat[1]) === '10-12' && lat[1].target_weight === latBefore[1].target_weight && reps(face[1]) === '10-12' && face.length === 3 && reps(face[2]) === '10-12'
  })
  check('A9', 'week 3 is fully updated: Lat Pulldown and Face Pull set 2 at 10-12 (weights kept), Face Pull has its third set', week3Ok, 'week 3 is not what the new default says')

  // the run copy: the default's rows
  const defaultOk = WORKOUTS.every((n) => {
    const day = b.runDays.find((d) => d.name === n)
    const live = post.v2_program_exercises.filter((e) => e.workout_day_id === day.id && !e.removed_at).sort((x, y) => x.position - y.position)
    const headsOf = (e) => post.v2_program_sets.filter((s) => s.program_exercise_id === e.id && s.parent_program_set_id === null && !s.removed_at).sort((x, y) => x.position - y.position)
    const [lat, face, curl] = live
    return (
      live.map((e) => nameB(e.exercise_id)).join() === 'Lat Pulldown,Face Pull,Cable Curl' &&
      headsOf(lat).map(reps).join() === '12,10-12,8-10' &&
      headsOf(face).map(reps).join() === '15-20,10-12,10-12' &&
      headsOf(curl).map(reps).join() === 'none,10-12' &&
      headsOf(curl).map((s) => s.position).join() === '1,2' &&
      post.v2_program_sets.some((s) => s.program_exercise_id === lat.id && s.parent_program_set_id !== null && s.is_amrap && !s.removed_at)
    )
  })
  check('A10', 'the run copy’s default: Lat Pulldown set 2 at 10-12 (the warmup and the dropset as they were), Face Pull 15-20, 10-12, 10-12, and Cable Curl last with its two sets', defaultOk, 'the default is not the edit')

  // the weekdays
  const rows = [...post.v2_run_schedules].sort((x, y) => x.from_week - y.from_week)
  const pull2 = b.runDays.find((d) => d.name === 'Pull 2').id
  check(
    'A11',
    "v2_run_schedules has from_week 1 (Pull 2 on Tuesday) and from_week 3 (Wednesday), and the run copy's schedule says Wednesday",
    rows.map((r) => r.from_week).join() === '1,3' && daysOf(rows[0].schedule, pull2).join() === 'tuesday' && daysOf(rows[1].schedule, pull2).join() === 'wednesday' && daysOf(post.v2_programs.find((p) => p.kind === 'run').schedule, pull2).join() === 'wednesday',
    `rows ${rows.map((r) => `${r.from_week}:${daysOf(r.schedule, pull2).join('/')}`).join(' | ')}; run copy ${daysOf(post.v2_programs.find((p) => p.kind === 'run').schedule, pull2).join('/')}`,
  )
  const resolve = (week) => daysOf(app.runSchedule.scheduleForWeek(app.util.scheduleRowsOf(post, post.v2_mesocycles[0].id), app.util.runCopyOf(post, b.run.id, post.v2_mesocycles[0].id).schedule, week), pull2).join('/')
  const resolved = [1, 2, 3, 4].map(resolve)
  check('A12', `Today's scheduler (the schedule in force per week) puts Pull 2 on Tuesday in weeks 1 and 2 and on Wednesday from week 3 (resolved: ${resolved.map((d, i) => `week ${i + 1} ${d}`).join(', ')})`, resolved.join() === 'tuesday,tuesday,wednesday,wednesday', `resolved: ${resolved.join()}`)
  check('A13', 'no plan row changed: the weekdays are stored apart from the sessions (md5 of v2_week_plans and v2_sessions before = after)', md5(pre.v2_week_plans) === md5(post.v2_week_plans) && md5(pre.v2_sessions) === md5(post.v2_sessions), 'a plan row or a session changed')

  // the saved program
  check('A14', 'the saved program is byte-identical (md5 of its program, workouts, exercises, sets, blocks and routine rows)', savedFingerprint(pre) === savedFingerprint(post), 'the saved program changed')
  return out
}

// ─── The breaks: the op list made wrong in one exact way; each must fail an assertion ────────────────────────────────

const isSetUpdate = (o) => o.op === 'update' && o.table === 'v2_week_plan_sets'
const isScheduleInsert = (o) => o.op === 'insert' && o.table === 'v2_run_schedules'
export const BREAKS = [
  { id: 'E01', title: "drop the sessions' set updates (the rep target never reaches a session)", fails: ['A4', 'A9'], mutate: (ops) => ops.filter((o) => !isSetUpdate(o)) },
  {
    id: 'E02',
    title: "land the change on Thursday's THIS WEEK ONLY set too (Face Pull set 2 written to 10-12)",
    fails: ['A5'],
    mutate: (ops, ctx) => [...ops, { op: 'update', table: 'v2_week_plan_sets', id: ctx.thursdayFaceSet2, patch: { rep_min: 10, rep_max: 12, is_amrap: false } }],
  },
  {
    id: 'E03',
    title: "leave out the added exercise's session set rows (DECISIONS 171)",
    fails: ['A7'],
    mutate: (ops, ctx) => ops.filter((o) => !(o.op === 'insert' && o.table === 'v2_week_plan_sets' && ctx.curlRowIds.has(o.row.program_exercise_id))),
  },
  { id: 'E04', title: 'write the new days from week N (2), not N + 1', fails: ['A11', 'A12'], mutate: (ops) => ops.map((o) => (isScheduleInsert(o) && o.row.from_week === 3 ? { ...o, row: { ...o.row, from_week: 2 } } : o)) },
  { id: 'E05', title: 'leave out the from_week 1 row (the old days)', fails: ['A11', 'A12'], mutate: (ops) => ops.filter((o) => !(isScheduleInsert(o) && o.row.from_week === 1)) },
  { id: 'E06', title: "leave out the run copy's schedule", fails: ['A11'], mutate: (ops) => ops.filter((o) => !(o.op === 'update' && o.table === 'v2_programs')) },
  { id: 'E07', title: 'change a row of the saved program', fails: ['A14'], mutate: (ops, ctx) => [...ops, { op: 'update', table: 'v2_program_exercises', id: ctx.savedExercise('Lat Pulldown'), patch: { rest_seconds: 5 } }] },
  { id: 'E08', title: "delete a set row of Monday's session (a done one)", fails: ['A1'], mutate: (ops, ctx) => [...ops, { op: 'delete', table: 'v2_week_plan_sets', id: ctx.setOf(ctx.plan(2, 'Pull 1'), 'Face Pull', 2) }] },
  { id: 'E09', title: "change a set row of Tuesday's session (one in progress)", fails: ['A2'], mutate: (ops, ctx) => [...ops, { op: 'update', table: 'v2_week_plan_sets', id: ctx.setOf(ctx.plan(2, 'Pull 2'), 'Lat Pulldown', 2), patch: { rep_min: 10, rep_max: 12 } }] },
  { id: 'E10', title: "leave out the added exercise's own default sets (the sessions' rows then name sets that don't exist)", fails: ['(apply refused)'], mutate: (ops) => ops.filter((o) => !(o.op === 'insert' && o.table === 'v2_program_sets')) },
  { id: 'E11', title: "leave out Face Pull's new set on the default (the sessions' third set links to nothing)", fails: ['(apply refused)'], mutate: (ops, ctx) => ops.filter((o) => !(o.op === 'insert' && o.table === 'v2_program_sets' && o.row.position === 3 && ctx.facePullRowIds.has(o.row.program_exercise_id))) },
  { id: 'E12', title: 'write a plan row (a session row for the weekday change; 043 lets a plan row take its saved pre-deload plan and nothing else)', fails: ['A13'], mutate: (ops, ctx) => [...ops, { op: 'update', table: 'v2_week_plans', id: ctx.plan(3, 'Pull 2'), patch: { deload_restore: [] } }] },
]
export const CONTROLS = [
  {
    id: 'C01',
    control: true,
    title: "a no-op: a run workout renamed to the name it has, which changes nothing",
    mutate: (ops, ctx) => [...ops, { op: 'update', table: 'v2_workout_days', id: ctx.runWorkout.id, patch: { name: ctx.runWorkout.name } }],
  },
]

// ─── Running it ──────────────────────────────────────────────────────────────────────────────────────────────────────

async function loadApp() {
  const { createServer } = await import('vite')
  const server = await createServer({
    root: REPO,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    const [change, draft, util, runSchedule] = await Promise.all([
      server.ssrLoadModule('/src/features/programs/programChange.ts'),
      server.ssrLoadModule('/src/features/programs/changeProgramDraft.ts'),
      server.ssrLoadModule('/src/features/programs/programChange.testutil.ts'),
      server.ssrLoadModule('/src/features/programs/runSchedule.ts'),
    ])
    return { change, draft, util, runSchedule }
  } finally {
    await server.close()
  }
}

// The edit, made the way the screen makes it (changeProgramDraft.ts), on every Pull workout, and the list it saves as.
export function opsFor({ app, db, userId }) {
  const { initialDraft, setSetRepTarget, addSet, addExercise, toggleWorkoutDay, exerciseKey } = app.draft
  const f = facts(db)
  const exerciseId = (n) => db.exercises.find((e) => e.name === n).id
  const mesoId = db.v2_mesocycles[0].id
  const runCopy = app.util.runCopyOf(db, f.run.id, mesoId)
  let state = initialDraft(runCopy, 'stable')
  const range = { type: 'range', min: 10, max: 12 }
  for (const day of f.runDays) {
    const rowOf = (n) => db.v2_program_exercises.find((e) => e.workout_day_id === day.id && f.name.get(e.exercise_id) === n)
    const lat = exerciseKey(rowOf('Lat Pulldown').id)
    const face = exerciseKey(rowOf('Face Pull').id)
    state = setSetRepTarget(state, day.id, lat, 1, range) // "set 2 rep target 10-12" (the working set; the warmup is the first)
    state = setSetRepTarget(state, day.id, face, 1, range)
    state = addSet(state, day.id, face) // "add a set to Face Pull": it follows set 2, so it is 10-12 too
    state = addExercise(state, day.id, exerciseId('Cable Curl'), 'kg') // "add Cable Curl at the end with two sets"
    const curl = state.edit.workouts.find((w) => w.id === day.id).exercises.at(-1).key
    state = addSet(addSet(state, day.id, curl), day.id, curl)
    state = setSetRepTarget(state, day.id, curl, 1, range) // the second made a range
  }
  const pull2 = f.runDays.find((d) => d.name === 'Pull 2').id
  state = toggleWorkoutDay(state, pull2, 'wednesday', true) // "Tuesday → Wednesday"
  state = toggleWorkoutDay(state, pull2, 'tuesday', true)
  const statuses = {}
  for (const p of f.plans) if (p.status !== 'not_started') statuses[p.id] = p.status
  const plan = app.change.planProgramChange({
    userId,
    now: new Date().toISOString(),
    newId: () => globalThis.crypto.randomUUID(),
    planningType: 'stable',
    scheduleType: 'weekday',
    currentWeek: 2,
    runCopy,
    scheduleRows: app.util.scheduleRowsOf(db, mesoId),
    sessions: app.util.sessionsOf(db, mesoId, statuses, 2),
    edit: state.edit,
  })
  return plan.ops
}

function contextFor(pre, userId, ops) {
  const f = facts(pre)
  const nameOfRow = (rowId) => f.name.get(pre.v2_program_exercises.find((p) => p.id === rowId)?.exercise_id)
  const plan = (week, workout) => f.plans.find((p) => p.week === week && p.workout === workout).id
  const setOf = (planId, exercise, setNumber) => pre.v2_week_plan_sets.find((s) => s.week_plan_id === planId && s.set_number === setNumber && s.parent_week_plan_set_id === null && nameOfRow(s.program_exercise_id) === exercise).id
  return {
    plan,
    setOf,
    thursdayFaceSet2: setOf(plan(2, 'Pull 3'), 'Face Pull', 2),
    runWorkout: f.runDays[0],
    savedExercise: (name) => f.savedExercises.find((e) => f.name.get(e.exercise_id) === name).id,
    // the new Cable Curl rows are in the list itself (their ids were drawn when it was made); Face Pull's rows are the run copy's
    curlRowIds: new Set(ops.filter((o) => o.op === 'insert' && o.table === 'v2_program_exercises').map((o) => o.row.id)),
    facePullRowIds: new Set(pre.v2_program_exercises.filter((e) => f.runDays.some((d) => d.id === e.workout_day_id) && f.name.get(e.exercise_id) === 'Face Pull').map((e) => e.id)),
    userId,
  }
}

async function runOne(container, app, mutate) {
  const s = new Psql(container)
  try {
    s.write(SESSION_HEAD)
    s.write(FIXTURE)
    s.write(dumpSql('PRE'))
    const pre = JSON.parse(await s.marker('PRE'))
    const userId = pre.v2_programs[0].user_id
    let ops = opsFor({ app, db: pre, userId })
    const original = ops.length
    if (mutate) ops = mutate(ops, contextFor(pre, userId, ops))
    s.write(`select '@@APPLIED@@ ' || v2_apply_ops($ops$${JSON.stringify(ops)}$ops$::jsonb)::text;`)
    const applied = Number(await s.marker('APPLIED'))
    s.write(dumpSql('POST'))
    const post = JSON.parse(await s.marker('POST'))
    s.write('rollback;\n\\q')
    await s.end()
    // the session's own canary (SESSION_HEAD): a bare UPDATE must have been refused, i.e. pg-safeupdate was loaded for the whole run
    return { ok: true, pre, post, ops, applied, original, app, canary: /CANARY\|PASS/.test(s.err) }
  } catch (e) {
    s.write('rollback;\n\\q')
    await s.end().catch(() => undefined)
    return { ok: false, error: String(e.message).split('\n')[0], canary: /CANARY\|PASS/.test(s.err) }
  }
}

function parseArgs(argv) {
  const o = { breaks: false, list: false, container: null }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--breaks') o.breaks = true
    else if (argv[i] === '--list') o.list = true
    else if (argv[i] === '--container') o.container = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  return o
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.list) {
    for (const b of [...CONTROLS, ...BREAKS]) console.log(`${b.id}  ${b.control ? 'control' : 'break  '}  ${b.title}${b.fails ? `  -> fails ${b.fails.join(', ')}` : '  -> must pass everything'}`)
    return 0
  }
  const container = findContainer(o.container)
  const probe = spawnSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-X', '-tA', '-c', "select to_regprocedure('public.v2_apply_ops(jsonb)') is not null"], { encoding: 'utf8' })
  if (probe.stdout.trim() !== 't') {
    console.error(`change-program-e2e-b: ${container} has no v2_apply_ops (replay the migrations with 043 first)`)
    return 2
  }
  const app = await loadApp()
  const before = rowCounts(container)
  console.log(`change-program-e2e-b: container ${container}`)

  const base = await runOne(container, app, null)
  if (!base.ok) {
    console.error(`change-program-e2e-b: the fixture or the apply failed: ${base.error}`)
    return 2
  }
  const rows = evaluate(base)
  console.log(`change-program-e2e-b: ${base.ops.length} ops through v2_apply_ops, signed in as the throwaway user; pg-safeupdate canary (a bare UPDATE refused): ${base.canary ? 'PASS' : 'NOT SEEN'}`)
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(4)} ${r.ok ? short(r.title, 230) : `${short(r.title, 90)}  <- ${short(r.why)}`}`)
  let bad = rows.filter((r) => !r.ok).length + (base.canary ? 0 : 1)

  if (o.breaks) {
    let wrong = 0
    for (const b of [...CONTROLS, ...BREAKS]) {
      const r = await runOne(container, app, b.mutate)
      let failed
      let note = ''
      if (!r.ok) {
        failed = ['(apply refused)']
        note = ` ${short(r.error, 100)}`
      } else {
        failed = evaluate(r).filter((x) => !x.ok).map((x) => x.id)
      }
      let verdict
      if (b.control) {
        verdict = failed.length === 0 ? 'OK     the control passes everything' : `WRONG  the control failed ${failed.join(', ')}`
        if (failed.length > 0) wrong++
      } else {
        const missing = b.fails.filter((id) => !failed.includes(id))
        verdict = failed.length === 0 ? 'NOT CAUGHT' : missing.length ? `CAUGHT, but ${missing.join(', ')} did not fail` : 'CAUGHT'
        if (failed.length === 0 || missing.length > 0) wrong++
      }
      console.log(`${b.id}  ${verdict.padEnd(12)} ${short(b.title, 100)}${failed.length ? `\n      failed: ${failed.join(', ')}${note}` : ''}`)
    }
    console.log(`change-program-e2e-b: ${BREAKS.length} breaks and ${CONTROLS.length} control, ${wrong} not as expected.`)
    bad += wrong
  }
  const after = rowCounts(container)
  const clean = before !== null && before === after
  console.log(`change-program-e2e-b: no row left behind (${TABLES.length + 1} tables counted before and after: ${before} → ${after}): ${clean ? 'ok' : 'NOT CLEAN'}`)
  if (!clean) bad++
  console.log(`change-program-e2e-b: ${bad === 0 ? 'everything held' : `${bad} did not`}`)
  return bad === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`change-program-e2e-b: ${process.env.CHANGE_PROGRAM_E2E_DEBUG ? e?.stack : String(e?.message ?? e).split('\n')[0]}`)
      process.exit(2)
    },
  )
}
