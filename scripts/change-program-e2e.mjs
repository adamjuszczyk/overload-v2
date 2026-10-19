#!/usr/bin/env node
// change-program-e2e.mjs (chunk 51a)
//
// TASKS-1.2 chunk 51a, Verification: "W, end to end on the replayed database: fixture 051-a ... the op list for 'swap Lat Pulldown,
// remove Face Pull, add Cable Curl at the end, rest 120 s on Cable Curl, rename Tuesday's workout' applied through `v2_apply_ops`;
// then: Monday's rows unchanged (md5 before/after equal); Tuesday's unchanged; Thursday and week 3 hold the swap with cleared
// weights, no Face Pull, Cable Curl last with no sets; the run copy holds the rest and the name; the saved program is
// byte-identical (fingerprint of its rows). Executed, printed, not read."
//
// One psql session, one transaction, rolled back at the end (nothing is left behind):
//   1. as a signed-in throwaway user, with pg-safeupdate loaded, the fixture: three pull workouts (Pull 1 on Monday, Pull 2 on
//      Tuesday, Pull 3 on Thursday: each Lat Pulldown with a warmup, a working set with a rest of 150 s and a dropset head with an
//      AMRAP drop, and Face Pull x2), a saved program, a run started through the migrations' own `v2_start_run`, weeks 1-3 planned
//      with `v2_plan_week` (week 1 given numbers, which the copies carry), and week 2's sessions: Monday done, Tuesday in progress,
//      Thursday not started;
//   2. the rows are read out as JSON, and the APP'S OWN TypeScript (Vite's SSR loader, nothing built) reads them as a screen would:
//      `changeProgramDraft.ts` makes the edit, `planProgramChange` (chunk 45) makes the op list;
//   3. the list goes through `v2_apply_ops` (043) in the same session, and the rows are read out again.
// The assertions below compare the two readings. Nothing is read by eye: the script prints each assertion and exits non-zero.
//
// Usage:  bash scripts/replay-migrations.sh --keep         (Docker; start dockerd first)
//         node scripts/change-program-e2e.mjs                 the scenario: every assertion must hold
//         node scripts/change-program-e2e.mjs --breaks        each break (the op list made wrong in one exact way) must fail an assertion
//         node scripts/change-program-e2e.mjs --list          the assertions and the breaks, no database
//         --container NAME   needed only when more than one kept replay container is running
// Exit:   0 everything held / every break was caught · 1 an assertion failed or a break survived · 2 couldn't run.

import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import { findContainer } from './apply-ops-proof.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')

// ─── The fixture ─────────────────────────────────────────────────────────────────────────────────────────────────────

const TABLES = [
  'v2_programs', 'v2_workout_days', 'v2_mesocycles', 'v2_program_exercises', 'v2_program_sets', 'v2_program_superset_blocks',
  'v2_workout_warmup_items', 'v2_run_schedules', 'v2_week_plans', 'v2_week_plan_exercises', 'v2_week_plan_sets', 'v2_sessions', 'exercises',
]

export const dumpSql = (name) =>
  `select '@@${name}@@ ' || jsonb_build_object(${TABLES.map((t) => `'${t}', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb) from ${t} t)`).join(', ')})::text;`

const SESSION_HEAD = `
\\set ON_ERROR_STOP on
load 'safeupdate';
do $c$ begin
  begin
    update public.exercises set name = name;
    raise exception 'CANARY-NOT-ACTIVE';
  exception when others then
    if sqlerrm like '%requires a WHERE clause%' then raise notice 'CANARY|PASS'; else raise notice 'CANARY|FAIL|%', sqlerrm; end if;
  end;
end $c$;
begin;
select gen_random_uuid() as uid \\gset
insert into auth.users (id, email) values (:'uid', 'change-program-e2e@example.invalid');
select set_config('request.jwt.claim.sub', :'uid', true) \\gset
select set_config('request.jwt.claims', json_build_object('sub', :'uid', 'role', 'authenticated')::text, true) \\gset
set local role authenticated;
set local statement_timeout = '8s';
`

// TASKS' F1-a, three times over: the same Pull workout on three weekdays, so that one edit reaches a done session (Monday), a
// session in progress (Tuesday) and a session not started (Thursday) of week 2, and all three of week 3.
const FIXTURE = `
do $fx$
declare
  v_uid uuid := auth.uid();
  v_lat uuid; v_face uuid; v_machine uuid; v_curl uuid;
  v_prog uuid; v_meso uuid; v_run uuid;
  v_wd uuid; v_pe_lat uuid; v_pe_face uuid; v_head uuid;
  v_names text[] := array['Pull 1', 'Pull 2', 'Pull 3'];
  v_days text[]  := array['monday', 'tuesday', 'thursday'];
  v_sched jsonb := '{}'::jsonb;
  v_i integer;
  r record;
begin
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Lat Pulldown', 'back') returning id into v_lat;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Face Pull', 'shoulders') returning id into v_face;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Machine Pulldown', 'back') returning id into v_machine;
  insert into exercises (user_id, name, muscle_group) values (v_uid, 'Cable Curl', 'biceps') returning id into v_curl;
  insert into v2_programs (user_id, name, kind, schedule_type, planning_type) values (v_uid, 'Pull Week', 'saved', 'weekday', 'week_dependent') returning id into v_prog;
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
  select program_id into v_run from v2_mesocycles where id = v_meso;

  -- week 1, planned and given numbers (every working set a weight and a RIR); weeks 2 and 3 copy them
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
    end if;
  end loop;
end $fx$;
`

// ─── One psql session, kept open so the app's TypeScript can answer between the two halves ──────────────────────────────

class Psql {
  constructor(container) {
    this.child = spawn(
      'docker',
      ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-tA'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    )
    this.out = ''
    this.err = ''
    this.closed = null
    this.waiters = []
    this.child.stdout.on('data', (d) => {
      this.out += d
      this.flush()
    })
    this.child.stderr.on('data', (d) => (this.err += d))
    this.child.on('close', (code) => {
      this.closed = code ?? 1
      this.flush()
    })
  }

  firstError() {
    return (
      this.err
        .split('\n')
        .map((l) => l.replace(/^psql:<stdin>:\d+: /, '').trim())
        .find((l) => /ERROR|FATAL/.test(l)) ?? this.err.split('\n').find((l) => l.trim() && !l.includes('UNDICI') && !l.includes('NOTICE')) ?? ''
    )
  }

  flush() {
    for (const w of [...this.waiters]) {
      const at = this.out.indexOf(`@@${w.name}@@ `)
      if (at >= 0) {
        const end = this.out.indexOf('\n', at)
        if (end >= 0) {
          this.waiters.splice(this.waiters.indexOf(w), 1)
          w.resolve(this.out.slice(at + w.name.length + 5, end))
        }
      } else if (this.closed !== null) {
        this.waiters.splice(this.waiters.indexOf(w), 1)
        w.reject(new Error(this.firstError() || `psql ended (exit ${this.closed}) before ${w.name}`))
      }
    }
  }

  write(sql) {
    this.child.stdin.write(`${sql}\n`)
  }

  marker(name) {
    return new Promise((resolve, reject) => {
      this.waiters.push({ name, resolve, reject })
      this.flush()
    })
  }

  async end() {
    this.child.stdin.end()
    if (this.closed === null) await new Promise((r) => this.child.on('close', r))
  }
}

// ─── Reading the rows the way a screen does, and judging what happened ───────────────────────────────────────────────

const md5 = (rows) => createHash('md5').update(rows.map((r) => JSON.stringify(r)).sort().join('\n')).digest('hex')

// The users's rows of one table that belong to a workout day / a plan row, to fingerprint (every column, so any change shows).
const byPlan = (db, planId) => ({
  exercises: db.v2_week_plan_exercises.filter((x) => x.week_plan_id === planId),
  sets: db.v2_week_plan_sets.filter((x) => x.week_plan_id === planId),
})

export function facts(db) {
  const name = new Map(db.exercises.map((e) => [e.id, e.name]))
  const saved = db.v2_programs.find((p) => p.kind === 'saved')
  const run = db.v2_programs.find((p) => p.kind === 'run')
  const savedDays = db.v2_workout_days.filter((w) => w.program_id === saved.id)
  const runDays = db.v2_workout_days.filter((w) => w.program_id === run.id)
  const peOf = (days) => db.v2_program_exercises.filter((e) => days.some((d) => d.id === e.workout_day_id))
  const savedExercises = peOf(savedDays)
  const status = new Map(
    db.v2_sessions.map((s) => [s.week_plan_id, s.status === 'in_progress' ? 'in_progress' : s.status === 'planned' ? 'not_started' : 'done']),
  )
  const plans = db.v2_week_plans.map((p) => ({
    id: p.id,
    week: p.week_number,
    workout: runDays.find((d) => d.id === p.workout_day_id)?.name,
    status: status.get(p.id) ?? 'not_started',
  }))
  return { name, saved, run, savedDays, runDays, savedExercises, plans, peOf }
}

const savedFingerprint = (db) => {
  const f = facts(db)
  const setIds = new Set(f.savedExercises.map((e) => e.id))
  return md5([
    ...db.v2_programs.filter((p) => p.id === f.saved.id),
    ...f.savedDays,
    ...f.savedExercises,
    ...db.v2_program_sets.filter((s) => setIds.has(s.program_exercise_id)),
    ...db.v2_program_superset_blocks.filter((b) => f.savedDays.some((d) => d.id === b.workout_day_id)),
    ...db.v2_workout_warmup_items.filter((i) => f.savedDays.some((d) => d.id === i.workout_day_id)),
  ])
}

// The assertions. Each is `{ id, title, ok, why }`; `ctx` = { pre, post, ops, applied }.
export function evaluate({ pre, post, ops, applied }) {
  const a = facts(pre)
  const b = facts(post)
  const out = []
  const check = (id, title, ok, why = '') => out.push({ id, title, ok: Boolean(ok), why: ok ? '' : why })
  const planOf = (f, week, workout) => f.plans.find((p) => p.week === week && p.workout === workout)
  const live = (f, db, workout) =>
    db.v2_program_exercises
      .filter((e) => e.workout_day_id === f.runDays.find((d) => d.name === workout || d.name === `${workout} (Tue)`)?.id && !e.removed_at)
      .sort((x, y) => x.position - y.position)
  const names = (f, rows) => rows.map((r) => f.name.get(r.exercise_id))
  const sessionExercises = (f, db, planId) =>
    db.v2_week_plan_exercises
      .filter((x) => x.week_plan_id === planId)
      .sort((x, y) => x.position - y.position)
      .map((x) => ({ ...x, exercise_id: db.v2_program_exercises.find((p) => p.id === x.program_exercise_id)?.exercise_id }))

  // preconditions: the fixture is the one TASKS describes, or nothing below means anything
  const w2 = ['Pull 1', 'Pull 2', 'Pull 3'].map((n) => planOf(a, 2, n))
  check('P1', 'week 2: Pull 1 done, Pull 2 in progress, Pull 3 not started; week 3 not started', w2.map((p) => p?.status).join() === 'done,in_progress,not_started' && ['Pull 1', 'Pull 2', 'Pull 3'].every((n) => planOf(a, 3, n)?.status === 'not_started'), `statuses: ${w2.map((p) => p?.status).join()}`)
  const heldWeights = ['Pull 3'].every((n) => byPlan(pre, planOf(a, 2, n).id).sets.some((s) => s.target_weight !== null))
  check('P2', 'before the save the not-started sessions carry weights (so "cleared" can be seen)', heldWeights, 'no weights before the save')
  check('A0', 'v2_apply_ops reports one applied op per op sent', applied === ops.length, `sent ${ops.length}, applied ${applied}`)

  // untouched: done, in progress, past
  for (const [id, workout, why] of [['A1', 'Pull 1', "Monday's (done)"], ['A2', 'Pull 2', "Tuesday's (in progress)"]]) {
    const p = planOf(a, 2, workout)
    const before = byPlan(pre, p.id)
    const after = byPlan(post, p.id)
    check(id, `${why} rows are unchanged (md5 of its exercise and set rows before = after)`, md5(before.exercises) === md5(after.exercises) && md5(before.sets) === md5(after.sets), `${why} rows changed`)
  }
  const week1 = a.plans.filter((p) => p.week === 1)
  check('A3', "week 1's rows are unchanged", week1.every((p) => md5(byPlan(pre, p.id).exercises) === md5(byPlan(post, p.id).exercises) && md5(byPlan(pre, p.id).sets) === md5(byPlan(post, p.id).sets)), 'a week before the current one changed')

  // landed: Thursday of week 2 and all of week 3
  const landed = [planOf(a, 2, 'Pull 3'), ...['Pull 1', 'Pull 2', 'Pull 3'].map((n) => planOf(a, 3, n))]
  const machineSets = (planId) => post.v2_week_plan_sets.filter((s) => s.week_plan_id === planId && post.v2_program_exercises.find((p) => p.id === s.program_exercise_id) && b.name.get(post.v2_program_exercises.find((p) => p.id === s.program_exercise_id).exercise_id) === 'Machine Pulldown')
  check(
    'A4',
    'Thursday and week 3: the session lists Machine Pulldown then Cable Curl, and no Face Pull or Lat Pulldown',
    landed.every((p) => names(b, sessionExercises(b, post, p.id)).join() === 'Machine Pulldown,Cable Curl'),
    landed.map((p) => `${p.workout} w${p.week}: ${names(b, sessionExercises(b, post, p.id)).join('/')}`).join(' | '),
  )
  check(
    'A5',
    "the swap kept the old exercise's sets (a warmup, a working set, a dropset head and its AMRAP drop) and cleared every weight, RIR and cue",
    landed.every((p) => {
      const sets = machineSets(p.id).sort((x, y) => x.set_number - y.set_number || x.stage_index - y.stage_index)
      return (
        sets.length === 4 &&
        sets[0].is_warmup === true &&
        sets[2].stage_kind === 'dropset' &&
        sets[3].parent_week_plan_set_id === sets[2].id &&
        sets[3].is_amrap === true &&
        sets.every((s) => s.target_weight === null && s.target_rir === null && s.target_rir_max === null && s.tags === null)
      )
    }),
    'the swapped exercise has the wrong sets or kept numbers',
  )
  check(
    'A6',
    'Cable Curl was added with no sets',
    landed.every((p) => post.v2_week_plan_sets.filter((s) => s.week_plan_id === p.id && b.name.get(post.v2_program_exercises.find((x) => x.id === s.program_exercise_id)?.exercise_id) === 'Cable Curl').length === 0),
    'Cable Curl has sets',
  )
  check('A7', 'no set row of Face Pull or Lat Pulldown is left in a changed session', landed.every((p) => post.v2_week_plan_sets.filter((s) => s.week_plan_id === p.id).every((s) => ['Machine Pulldown'].includes(b.name.get(post.v2_program_exercises.find((x) => x.id === s.program_exercise_id)?.exercise_id)))), 'an old exercise still has sets')

  // the run copy
  const runOk = ['Pull 1', 'Pull 2', 'Pull 3'].every((w) => {
    const rows = live(b, post, w)
    const curl = rows[1]
    return names(b, rows).join() === 'Machine Pulldown,Cable Curl' && curl?.rest_seconds === 120 && curl?.weight_unit === 'kg'
  })
  check('A8', 'the run copy: each workout lists Machine Pulldown then Cable Curl, and Cable Curl has a rest of 120 s', runOk, ['Pull 1', 'Pull 2', 'Pull 3'].map((w) => `${w}: ${names(b, live(b, post, w)).join('/')} rest ${live(b, post, w)[1]?.rest_seconds}`).join(' | '))
  const removedOk = ['Pull 1', 'Pull 2', 'Pull 3'].every((w) => {
    const day = b.runDays.find((d) => d.name === w || d.name === `${w} (Tue)`)
    const rows = post.v2_program_exercises.filter((e) => e.workout_day_id === day.id)
    const old = rows.filter((e) => ['Lat Pulldown', 'Face Pull'].includes(b.name.get(e.exercise_id)))
    const machine = rows.find((e) => b.name.get(e.exercise_id) === 'Machine Pulldown')
    const lat = old.find((e) => b.name.get(e.exercise_id) === 'Lat Pulldown')
    return old.length === 2 && old.every((e) => e.removed_at) && machine?.replaces_program_exercise_id === lat?.id
  })
  check('A9', 'the old rows are soft-removed (removed_at), and the swapped-in row names the row it replaced', removedOk, 'a removed row is live, or the link is missing')
  check('A10', "Tuesday's workout is renamed and the other two are not", b.runDays.map((d) => d.name).sort().join() === 'Pull 1,Pull 2 (Tue),Pull 3', b.runDays.map((d) => d.name).join())
  check('A11', 'a week-dependent run holds no default sets for the new exercises', post.v2_program_sets.filter((s) => ['Machine Pulldown', 'Cable Curl'].includes(b.name.get(post.v2_program_exercises.find((x) => x.id === s.program_exercise_id)?.exercise_id))).length === 0, 'default sets were written')

  // the saved program
  check('A12', 'the saved program is byte-identical (md5 of its program, workouts, exercises, sets, blocks and routine rows)', savedFingerprint(pre) === savedFingerprint(post), 'the saved program changed')
  check('A13', "no row of the run's schedule changed", md5(pre.v2_run_schedules) === md5(post.v2_run_schedules) && md5(pre.v2_programs.filter((p) => p.kind === 'run')) === md5(post.v2_programs.filter((p) => p.kind === 'run')), 'the schedule changed')
  return out
}

// ─── The breaks: the op list made wrong in one exact way; each must fail an assertion ────────────────────────────────

const isSetUpdate = (o) => o.op === 'update' && o.table === 'v2_week_plan_sets'
export const BREAKS = [
  { id: 'E01', title: "drop the sessions' set updates (the swapped exercise's sets stay on the old rows)", fails: ['A5', 'A7'], mutate: (ops) => ops.filter((o) => !isSetUpdate(o)) },
  {
    id: 'E02',
    title: "keep the weights, RIR and cues on the swapped exercise's sets",
    fails: ['A5'],
    mutate: (ops) => ops.map((o) => (isSetUpdate(o) ? { ...o, patch: Object.fromEntries(Object.entries(o.patch).filter(([k]) => !['target_weight', 'target_rir', 'target_rir_max', 'tags'].includes(k))) } : o)).filter((o) => !(isSetUpdate(o) && Object.keys(o.patch).length === 0)),
  },
  {
    id: 'E03',
    title: "delete a face-pull row of Monday's session (a done one)",
    fails: ['A1'],
    mutate: (ops, ctx) => [...ops, { op: 'delete', table: 'v2_week_plan_exercises', id: ctx.planExerciseOf(ctx.plan(2, 'Pull 1'), 'Face Pull') }],
  },
  {
    id: 'E04',
    title: "delete a face-pull row of Tuesday's session (one in progress)",
    fails: ['A2'],
    mutate: (ops, ctx) => [...ops, { op: 'delete', table: 'v2_week_plan_exercises', id: ctx.planExerciseOf(ctx.plan(2, 'Pull 2'), 'Face Pull') }],
  },
  {
    id: 'E05',
    title: "change a row of the saved program",
    fails: ['A12'],
    mutate: (ops, ctx) => [...ops, { op: 'update', table: 'v2_program_exercises', id: ctx.savedExercise('Lat Pulldown'), patch: { rest_seconds: 5 } }],
  },
  { id: 'E06', title: "leave out the swap's link to the row it replaced", fails: ['A9'], mutate: (ops) => ops.map((o) => (o.op === 'insert' && o.table === 'v2_program_exercises' ? { ...o, row: { ...o.row, replaces_program_exercise_id: null } } : o)) },
  { id: 'E07', title: 'leave out the soft removals (removed_at)', fails: ['A9', 'A8'], mutate: (ops) => ops.filter((o) => !(o.op === 'update' && o.table === 'v2_program_exercises' && 'removed_at' in o.patch)) },
  { id: 'E08', title: "leave out Tuesday's rename", fails: ['A10'], mutate: (ops) => ops.filter((o) => !(o.table === 'v2_workout_days')) },
  { id: 'E09', title: "leave Cable Curl's rest out of its row", fails: ['A8'], mutate: (ops) => ops.map((o) => (o.op === 'insert' && o.table === 'v2_program_exercises' && o.row.rest_seconds === 120 ? { ...o, row: { ...o.row, rest_seconds: null } } : o)) },
  { id: 'E10', title: "leave out the sessions' new exercise rows", fails: ['A4'], mutate: (ops) => ops.filter((o) => !(o.op === 'insert' && o.table === 'v2_week_plan_exercises')) },
  { id: 'E11', title: "write default sets for a week-dependent run's new exercise", fails: ['A11'], mutate: (ops, ctx) => [...ops, ctx.defaultSetInsert()] },
  { id: 'E12', title: "write the run's schedule", fails: ['A13'], mutate: (ops, ctx) => [...ops, { op: 'update', table: 'v2_programs', id: ctx.runProgramId, patch: { schedule: {} } }] },
]
export const CONTROLS = [
  { id: 'C01', control: true, title: 'a no-op: the rename written twice, which changes nothing', mutate: (ops) => [...ops, ...ops.filter((o) => o.table === 'v2_workout_days')] },
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
    const [change, draft, util] = await Promise.all([
      server.ssrLoadModule('/src/features/programs/programChange.ts'),
      server.ssrLoadModule('/src/features/programs/changeProgramDraft.ts'),
      server.ssrLoadModule('/src/features/programs/programChange.testutil.ts'),
    ])
    return { change, draft, util }
  } finally {
    await server.close()
  }
}

// The edit, made the way the screen makes it (changeProgramDraft.ts), on every Pull workout, and the list it saves as.
export function opsFor({ app, db, userId }) {
  const { initialDraft, swapExercise, removeExercise, addExercise, setExerciseRest, renameWorkout, exerciseKey } = app.draft
  const f = facts(db)
  const exerciseId = (n) => db.exercises.find((e) => e.name === n).id
  const runCopy = app.util.runCopyOf(db, f.run.id, db.v2_mesocycles[0].id)
  let state = initialDraft(runCopy, 'week_dependent')
  for (const day of f.runDays) {
    const rowOf = (n) => db.v2_program_exercises.find((e) => e.workout_day_id === day.id && f.name.get(e.exercise_id) === n)
    state = swapExercise(state, day.id, exerciseKey(rowOf('Lat Pulldown').id), exerciseId('Machine Pulldown'))
    state = removeExercise(state, day.id, exerciseKey(rowOf('Face Pull').id))
    state = addExercise(state, day.id, exerciseId('Cable Curl'), 'kg')
    const list = state.edit.workouts.find((w) => w.id === day.id).exercises
    state = setExerciseRest(state, day.id, list[list.length - 1].key, 'restSeconds', 120)
  }
  state = renameWorkout(state, f.runDays.find((d) => d.name === 'Pull 2').id, 'Pull 2 (Tue)')
  const statuses = {}
  for (const p of f.plans) if (p.status !== 'not_started') statuses[p.id] = p.status
  const plan = app.change.planProgramChange({
    userId,
    now: new Date().toISOString(),
    newId: () => globalThis.crypto.randomUUID(),
    planningType: 'week_dependent',
    scheduleType: 'weekday',
    currentWeek: 2,
    runCopy,
    scheduleRows: app.util.scheduleRowsOf(db, db.v2_mesocycles[0].id),
    sessions: app.util.sessionsOf(db, db.v2_mesocycles[0].id, statuses, 2),
    edit: state.edit,
  })
  return plan.ops
}

function contextFor(pre, userId) {
  const f = facts(pre)
  return {
    runProgramId: f.run.id,
    plan: (week, workout) => f.plans.find((p) => p.week === week && p.workout === workout).id,
    planExerciseOf: (planId, name) => pre.v2_week_plan_exercises.find((x) => x.week_plan_id === planId && f.name.get(pre.v2_program_exercises.find((p) => p.id === x.program_exercise_id).exercise_id) === name).id,
    savedExercise: (name) => f.savedExercises.find((e) => f.name.get(e.exercise_id) === name).id,
    defaultSetInsert: () => {
      throw new Error('set per run (see runOne)')
    },
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
    const ctx = contextFor(pre, userId)
    // E11's extra op needs a new exercise row's id: it is the list's own insert of Cable Curl.
    ctx.defaultSetInsert = () => {
      const curl = ops.find((o) => o.op === 'insert' && o.table === 'v2_program_exercises' && o.row.rest_seconds === 120)
      return { op: 'insert', table: 'v2_program_sets', row: { id: globalThis.crypto.randomUUID(), user_id: userId, program_exercise_id: curl.row.id, position: 1, is_warmup: false, stage_kind: null, stage_rest_seconds: null, parent_program_set_id: null, stage_index: 0, rep_min: 8, rep_max: 10, is_amrap: false, rest_seconds: null, removed_at: null, created_at: new Date().toISOString() } }
    }
    if (mutate) ops = mutate(ops, ctx)
    s.write(`select '@@APPLIED@@ ' || v2_apply_ops($ops$${JSON.stringify(ops)}$ops$::jsonb)::text;`)
    const applied = Number(await s.marker('APPLIED'))
    s.write(dumpSql('POST'))
    const post = JSON.parse(await s.marker('POST'))
    s.write('rollback;\n\\q')
    await s.end()
    return { ok: true, pre, post, ops, applied, original }
  } catch (e) {
    s.write('rollback;\n\\q')
    await s.end().catch(() => undefined)
    return { ok: false, error: String(e.message).split('\n')[0], canary: /CANARY\|PASS/.test(s.err) }
  }
}

function rowCounts(container) {
  const sql = 'select ' + TABLES.concat(['auth.users']).map((t) => `(select count(*) from ${t})`).join(" || '/' || ")
  const r = spawnSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-X', '-tA', '-c', sql], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
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

const short = (s, n = 170) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.list) {
    for (const b of [...CONTROLS, ...BREAKS]) console.log(`${b.id}  ${b.control ? 'control' : 'break  '}  ${b.title}${b.fails ? `  -> fails ${b.fails.join(', ')}` : '  -> must pass everything'}`)
    return 0
  }
  const container = findContainer(o.container)
  const probe = spawnSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-X', '-tA', '-c', "select to_regprocedure('public.v2_apply_ops(jsonb)') is not null"], { encoding: 'utf8' })
  if (probe.stdout.trim() !== 't') {
    console.error(`change-program-e2e: ${container} has no v2_apply_ops (replay the migrations with 043 first)`)
    return 2
  }
  const app = await loadApp()
  const before = rowCounts(container)
  console.log(`change-program-e2e: container ${container}`)

  const base = await runOne(container, app, null)
  if (!base.ok) {
    console.error(`change-program-e2e: the fixture or the apply failed: ${base.error}`)
    return 2
  }
  const rows = evaluate(base)
  console.log(`change-program-e2e: ${base.ops.length} ops through v2_apply_ops (pg-safeupdate loaded, signed in as the throwaway user)`)
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(4)} ${r.ok ? short(r.title) : `${short(r.title, 90)}  <- ${short(r.why)}`}`)
  let bad = rows.filter((r) => !r.ok).length

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
    console.log(`change-program-e2e: ${BREAKS.length} breaks and ${CONTROLS.length} control, ${wrong} not as expected.`)
    bad += wrong
  }
  const after = rowCounts(container)
  const clean = before !== null && before === after
  console.log(`change-program-e2e: no row left behind (${TABLES.length + 1} tables counted before and after: ${before} → ${after}): ${clean ? 'ok' : 'NOT CLEAN'}`)
  if (!clean) bad++
  console.log(`change-program-e2e: ${bad === 0 ? 'everything held' : `${bad} did not`}`)
  return bad === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`change-program-e2e: ${process.env.CHANGE_PROGRAM_E2E_DEBUG ? e?.stack : String(e?.message ?? e).split('\n')[0]}`)
      process.exit(2)
    },
  )
}
