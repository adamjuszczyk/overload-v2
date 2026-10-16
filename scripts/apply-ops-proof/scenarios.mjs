// apply-ops-proof/scenarios.mjs (chunk 47): what the proof asserts about `v2_apply_ops`, as plpgsql bodies. Each runs as
// the signed-in `authenticated` user A, under RLS, inside a transaction that is rolled back, on the fixture of model.mjs
// (A's rows `a_…`, a stranger B's `b_…`, one of everything in each of the twelve tables). A body never raises on purpose:
// the runner wraps it, and a failed assertion becomes `RESULT|<id>|FAIL|<why>`.
//
// What the assertions are built from (helperSql in model.mjs):
//   zz_expect(ops, text[, sqlstate])  the call fails, with this text (and state) in its message
//   zz_ok(ops, n)                     the call succeeds and applied n ops
//   zz_snap() / zz_same / zz_changed  both users' rows, before and after: a refusal left nothing behind, and (the
//                                     control) a success did change them, so "unchanged" is never a vacuous pass
//
// Fixture dates and ids are fixed: nothing here depends on today.

import { FIXTURE_COUNTS, INSERTABLE, TABLES, del, ins, jsonSql, opsSql, rows, upd } from './model.mjs'

const A = (s) => `{{a_${s}}}`
const B = (s) => `{{b_${s}}}`
const N = (s) => `{{n_${s}}}`
const q = (s) => s.replace(/'/g, "''")

// A refusal: the call fails with `part` in its message, and not one row of either user changed.
const refused = (ops, part, code) => `
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_expect(${ops}, '${q(part)}'${code ? `, '${code}'` : ''});
  perform pg_temp.zz_same(s0, pg_temp.zz_snap(), '${q(part)} left rows behind');`
// An assertion about rows (as the signed-in user: RLS shows A's rows only).
const assert = (cond, msg) => `
  perform pg_temp.zz_assert(${cond}, '${q(msg)}');`
const has = (table, id, where = 'true') => `exists (select 1 from public.${table} x where x.id = '${id}' and ${where})`
const gone = (table, id) => `not exists (select 1 from public.${table} x where x.id = '${id}')`

// One valid insert per insertable table (full rows, a stranger's user_id), ids n_<table>.
const idFor = (table) => N(table.replace(/^v2_/, ''))
const freshRow = (table, over = {}) => rows[table](idFor(table), over)

// A scenario's id, group, title, and body.
export const SCENARIOS = []
const add = (id, title, body, extra = {}) => SCENARIOS.push({ id, title, body, ...extra })

// ═══ F  the fixture and the harness ═══════════════════════════════════════════════════════════════════════════════
{
  let b = ''
  for (const who of ['uA', 'uB']) {
    b += `
  perform pg_temp.zz_as('{{${who}}}');`
    for (const [t, n] of Object.entries(FIXTURE_COUNTS)) {
      b += `
  select count(*) into k from public.${t} where user_id = auth.uid();
  perform pg_temp.zz_assert(k = ${n}, '${who} sees ' || k || ' rows of ${t}, wanted ${n}');`
    }
  }
  b += `
  perform pg_temp.zz_as('{{uA}}');
  perform pg_temp.zz_assert(auth.uid() = '{{uA}}'::uuid, 'the claim is A');
  perform pg_temp.zz_assert(current_user = 'authenticated', 'the role is authenticated');
  -- RLS: A cannot see B's rows (a fixture that did not separate the two would make every foreign-row proof vacuous)
  perform pg_temp.zz_assert(not ${has('v2_programs', B('prog'))}, 'A sees B''s program');
  perform pg_temp.zz_assert(not ${has('v2_week_plan_sets', B('ws1'))}, 'A sees B''s planned set');
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_assert(split_part(s0, ':', 1) <> split_part(s0, ':', 2), 'the two users'' fingerprints differ');`
  add('F00', 'the fixture: 16 tables, two users, each sees only their own rows', b, { group: 'harness' })
}

add('F01', 'the control of every "rows unchanged" below: a call that succeeds changes the fingerprint, and a refused one does not', `
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_ok(${opsSql(upd('v2_program_exercises', A('pe1'), { tempo: '3010' }))}, 1);
  perform pg_temp.zz_changed(s0, pg_temp.zz_snap(), 'an update');
  s1 := pg_temp.zz_snap();
  perform pg_temp.zz_expect(${opsSql(upd('v2_program_exercises', A('pe1'), { id: 'x' }))}, 'protected');
  perform pg_temp.zz_same(s1, pg_temp.zz_snap(), 'a refused call');`, { group: 'harness' })

add('F02', 'the run is under pg-safeupdate as the signed-in role: a bare UPDATE and a bare DELETE are refused', `
  perform pg_temp.zz_assert(pg_temp.zz_try('update public.v2_programs set name = name') like '%requires a WHERE clause%', 'a bare update was not refused');
  perform pg_temp.zz_assert(pg_temp.zz_try('delete from public.v2_workout_warmup_items') like '%requires a WHERE clause%', 'a bare delete was not refused');
  perform pg_temp.zz_assert(pg_temp.zz_try('update public.v2_programs set name = name where true') is null, 'where true was refused');`, { group: 'harness' })

// ═══ G  who may call it, and what a list is ═══════════════════════════════════════════════════════════════════════════
add('G01', 'an empty list returns 0 and changes nothing', `
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_ok('[]'::jsonb, 0);
  perform pg_temp.zz_same(s0, pg_temp.zz_snap(), 'an empty list');`, { group: 'caller' })

add('G02', 'not signed in: no user, no call (the claim empty, and the claim missing)', `
  perform pg_temp.zz_as(null);
  perform pg_temp.zz_expect('[]'::jsonb, 'not signed in');
  perform set_config('request.jwt.claim.sub', '', true);
  perform pg_temp.zz_expect(${opsSql(upd('v2_programs', A('prog'), { name: 'x' }))}, 'not signed in');
  perform set_config('request.jwt.claim.sub', null, true);
  perform pg_temp.zz_expect('[]'::jsonb, 'not signed in');
  perform pg_temp.zz_as('{{uA}}');
  perform pg_temp.zz_assert(${has('v2_programs', A('prog'), `x.name = 'Run a'`)}, 'the program was renamed');`, { group: 'caller' })

add('G03', 'the anon role is refused at the grant, not by the first check', `
  set local role anon;
  select * into r from pg_temp.zz_run('[]'::jsonb);
  set local role authenticated;
  perform pg_temp.zz_assert(r.err like '42501: permission denied for function%', 'anon got: ' || coalesce(r.err, 'n=' || r.n));`, { group: 'caller' })

add('G04', 'the function is security invoker with a fixed search_path, and only authenticated may execute it', `
  select * into r from pg_temp.zz_meta();
  perform pg_temp.zz_assert(r.secdef is false, 'security definer');
  perform pg_temp.zz_assert(r.cfg = array['search_path=public'], 'search_path is ' || coalesce(r.cfg::text, 'unset'));
  perform pg_temp.zz_assert(r.acl_authenticated and not r.acl_anon and not r.acl_public, 'grants: authenticated ' || r.acl_authenticated || ', anon ' || r.acl_anon || ', public ' || r.acl_public);`, { group: 'caller' })

for (const [label, lit, part] of [
  ['an object', jsonSql({ op: 'delete' }), 'ops must be a list'],
  ['a string', jsonSql('x'), 'ops must be a list'],
  ['a number', jsonSql(5), 'ops must be a list'],
  ['a JSON null', `'null'::jsonb`, 'ops must be a list'],
  ['an SQL NULL', 'null::jsonb', 'ops must be a list'],
]) {
  add(`G05-${label.replace(/\W+/g, '')}`, `p_ops is ${label}, not a list: refused`, refused(lit, part), { group: 'list' })
}

add('G06', 'an op that is not an object is refused and named by its place (op 1, op 3)', `${refused(opsSql(1), 'op 1 is not an object')}${refused(opsSql(upd('v2_programs', A('prog'), { name: 'r' }), upd('v2_programs', A('prog'), { name: 's' }), 'x'), 'op 3 is not an object')}${refused(opsSql(null), 'op 1 is not an object')}${refused(opsSql([[]]), 'op 1 is not an object')}`, { group: 'list' })

add('G07', 'an op that is not insert, update or delete is refused, by name (case counts, a missing "op" reads as none)', `${refused(opsSql({ op: 'upsert', table: 'v2_programs', id: A('prog'), patch: { name: 'x' } }), 'unknown op: upsert')}${refused(opsSql({ op: 'INSERT', table: 'v2_program_exercises', row: rows.v2_program_exercises(N('x')) }), 'unknown op: INSERT')}${refused(opsSql({ table: 'v2_programs', id: A('prog') }), 'unknown op: none')}${refused(opsSql({ op: '', table: 'v2_programs', id: A('prog') }), 'unknown op: ')}`, { group: 'list' })

// ═══ T  the tables ═══════════════════════════════════════════════════════════════════════════════════════════════════
{
  const strangers = ['v2_set_logs', 'v2_sessions', 'v2_mesocycles', 'v2_user_settings', 'exercises', 'auth.users', 'v2_programs where true', 'V2_PROGRAMS', 'v2_programs; drop table v2_programs', '"v2_programs"', 'public.v2_programs', '']
  let b = ''
  for (const t of strangers) {
    b += refused(opsSql({ op: 'update', table: t, id: A('prog'), patch: { name: 'x' } }), 'table not allowed')
    b += refused(opsSql({ op: 'delete', table: t, id: A('prog') }), 'table not allowed')
    b += refused(opsSql({ op: 'insert', table: t, row: { id: N('x'), user_id: '{{uA}}' } }), 'table not allowed')
  }
  b += refused(opsSql({ op: 'delete', id: A('prog') }), 'table not allowed')
  b += refused(opsSql({ op: 'delete', table: 5, id: A('prog') }), 'table not allowed')
  b += refused(opsSql({ op: 'delete', table: ['v2_programs'], id: A('prog') }), 'table not allowed')
  add('T01', 'a table not on the list is refused, for insert, update and delete (set logs, sessions, auth.users, an injection-shaped name, a number, none)', b, { group: 'tables' })
}
add('T02', 'a refused table in the middle of a list takes the ops before it with it (the TASKS case: the second op names a set log)', `
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_expect(${opsSql(upd('v2_week_plan_sets', A('ws1'), { target_weight: 77 }), { op: 'update', table: 'v2_set_logs', id: A('log'), patch: { weight: 1 } })}, 'table not allowed', 'P0001');
  perform pg_temp.zz_same(s0, pg_temp.zz_snap(), 'the first op persisted');
  perform pg_temp.zz_assert(${has('v2_week_plan_sets', A('ws1'), 'x.target_weight = 50')}, 'the set weight');
  perform pg_temp.zz_assert(${has('v2_set_logs', A('log'), 'x.weight = 50')}, 'the set log');`, { group: 'tables' })

// ═══ A  a list lands as a whole ══════════════════════════════════════════════════════════════════════════════════════
const NEW_SCHEDULE = { monday: A('wd2'), friday: A('wd1') }
add('A01', 'the TASKS list: 12 ops over six tables apply, the count is returned and the rows are there (a stranger\'s user_id is the caller\'s; a head\'s delete takes its stage)', `
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_ok(${opsSql(
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe'), { exercise_id: A('ex2'), position: 2, replaces_program_exercise_id: A('pe2') })),
    ins('v2_program_sets', rows.v2_program_sets(N('ps1'), { program_exercise_id: N('pe'), position: 1 })),
    ins('v2_program_sets', rows.v2_program_sets(N('ps2'), { program_exercise_id: N('pe'), position: 2, stage_kind: 'dropset' })),
    ins('v2_week_plan_exercises', rows.v2_week_plan_exercises(N('wpe'), { program_exercise_id: N('pe'), position: 2 })),
    ins('v2_week_plan_sets', rows.v2_week_plan_sets(N('ws1'), { program_exercise_id: N('pe'), set_number: 1, tags: ['pause', 'slow'] })),
    ins('v2_week_plan_sets', rows.v2_week_plan_sets(N('ws2'), { program_exercise_id: N('pe'), set_number: 2, program_set_id: N('ps1') })),
    upd('v2_program_exercises', A('pe2'), { removed_at: '2026-10-16T09:00:00+00:00' }),
    upd('v2_week_plan_sets', A('ws1'), { target_weight: 55, tags: null }),
    upd('v2_workout_days', A('wd1'), { name: 'Push A' }),
    upd('v2_programs', A('prog'), { schedule: NEW_SCHEDULE }),
    del('v2_week_plan_sets', A('ws2')),
    upd('v2_program_exercises', A('pe3'), { position: 4 }),
  )}, 12);
  perform pg_temp.zz_changed(s0, pg_temp.zz_snap(), 'the list');
  perform pg_temp.zz_assert(${has('v2_program_exercises', N('pe'), `x.user_id = '{{uA}}' and x.replaces_program_exercise_id = '${A('pe2')}' and x.position = 2`)}, 'the new exercise row');
  perform pg_temp.zz_assert(${has('v2_program_sets', N('ps2'), `x.stage_kind = 'dropset' and x.user_id = '{{uA}}'`)}, 'the dropset head');
  perform pg_temp.zz_assert(${has('v2_week_plan_exercises', N('wpe'), `x.user_id = '{{uA}}'`)}, 'the week row');
  perform pg_temp.zz_assert(${has('v2_week_plan_sets', N('ws2'), `x.program_set_id = '${N('ps1')}'`)}, 'the second planned set, pointing at the program set made before it');
  perform pg_temp.zz_assert(${has('v2_program_exercises', A('pe2'), 'x.removed_at is not null')}, 'the soft removal');
  perform pg_temp.zz_assert(${has('v2_week_plan_sets', A('ws1'), 'x.target_weight = 55 and x.tags is null')}, 'the first planned set (weight, tags to null)');
  perform pg_temp.zz_assert(${has('v2_workout_days', A('wd1'), `x.name = 'Push A'`)}, 'the workout name');
  perform pg_temp.zz_assert(${has('v2_programs', A('prog'), `x.schedule = '${JSON.stringify(NEW_SCHEDULE)}'::jsonb`)}, 'the schedule');
  perform pg_temp.zz_assert(${gone('v2_week_plan_sets', A('ws2'))}, 'the deleted head is gone');
  perform pg_temp.zz_assert(${has('v2_program_exercises', A('pe3'), 'x.position = 4')}, 'the last update');
  perform pg_temp.zz_assert(not exists (select 1 from public.v2_week_plan_sets x where x.parent_week_plan_set_id = '${A('ws2')}'), 'the head''s stage was not taken with it');`, { group: 'whole' })

add('A02', 'a list whose fifth op names another user\'s row fails with "row not found" and ops 1-4 are not there (the error text first, then the rows)', `
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_expect(${opsSql(
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe'))),
    upd('v2_workout_days', A('wd1'), { name: 'Renamed' }),
    del('v2_workout_warmup_items', A('wu1')),
    ins('v2_workout_warmup_items', rows.v2_workout_warmup_items(N('wu'))),
    upd('v2_program_exercises', B('pe1'), { tempo: '2020' }),
    upd('v2_programs', A('prog'), { name: 'Never' }),
  )}, 'row not found: v2_program_exercises/${B('pe1')}', 'P0001');
  perform pg_temp.zz_same(s0, pg_temp.zz_snap(), 'ops 1-4 persisted');
  perform pg_temp.zz_assert(${gone('v2_program_exercises', N('pe'))} and ${has('v2_workout_days', A('wd1'), `x.name = 'Push'`)} and ${has('v2_workout_warmup_items', A('wu1'))}, 'ops 1-4 are visible');`, { group: 'whole' })

add('A03', 'a table\'s own refusal on op 7 (a foreign key) takes ops 1-6 with it, and the error is the table\'s', `
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_expect(${opsSql(
    ins('v2_workout_warmup_items', rows.v2_workout_warmup_items(N('wu1'), { position: 11 })),
    ins('v2_workout_warmup_items', rows.v2_workout_warmup_items(N('wu2'), { position: 12 })),
    upd('v2_programs', A('prog'), { name: 'Renamed' }),
    upd('v2_workout_days', A('wd2'), { name: 'Renamed too' }),
    del('v2_week_review_decisions', A('dec')),
    ins('v2_program_sets', rows.v2_program_sets(N('ps'))),
    ins('v2_week_plan_exercises', rows.v2_week_plan_exercises(N('wpe'), { week_plan_id: N('no_such_plan') })),
  )}, 'violates foreign key constraint', '23503');
  perform pg_temp.zz_same(s0, pg_temp.zz_snap(), 'ops 1-6 persisted');`, { group: 'whole' })

add('A04', 'in the order the list gives: a row can reference one inserted before it, and the same two ops the other way round fail', `
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_ok(${opsSql(
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe'))),
    ins('v2_program_sets', rows.v2_program_sets(N('ps'), { program_exercise_id: N('pe') })),
    ins('v2_program_sets', rows.v2_program_sets(N('ps_stage'), { program_exercise_id: N('pe'), parent_program_set_id: N('ps'), stage_index: 1 })),
  )}, 3);
  perform pg_temp.zz_changed(s0, pg_temp.zz_snap(), 'the parents-first list');
  s1 := pg_temp.zz_snap();
  perform pg_temp.zz_expect(${opsSql(
    ins('v2_program_sets', rows.v2_program_sets(N('ps2'), { program_exercise_id: N('pe2') })),
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe2'))),
  )}, 'violates foreign key constraint', '23503');
  perform pg_temp.zz_same(s1, pg_temp.zz_snap(), 'the children-first list left rows');`, { group: 'whole' })

add('A05', 'ops on the same row apply in list order: the last write wins, and a delete then an insert of the same id is a replacement', `
  perform pg_temp.zz_ok(${opsSql(upd('v2_workout_days', A('wd1'), { name: 'first' }), upd('v2_workout_days', A('wd1'), { name: 'second' }))}, 2);
  perform pg_temp.zz_assert(${has('v2_workout_days', A('wd1'), `x.name = 'second'`)}, 'the later patch won');
  perform pg_temp.zz_ok(${opsSql(del('v2_workout_warmup_items', A('wu1')), ins('v2_workout_warmup_items', rows.v2_workout_warmup_items(A('wu1'), { position: 0, body: 'Replaced' })))}, 2);
  perform pg_temp.zz_assert(${has('v2_workout_warmup_items', A('wu1'), `x.body = 'Replaced'`)}, 'deleted, then inserted again');
  perform pg_temp.zz_ok(${opsSql(ins('v2_workout_warmup_items', rows.v2_workout_warmup_items(N('wu'))), del('v2_workout_warmup_items', N('wu')))}, 2);
  perform pg_temp.zz_assert(${gone('v2_workout_warmup_items', N('wu'))}, 'inserted, then deleted');`, { group: 'whole' })

add('A06', 'all twelve tables in one list (REVIEW\'s decision and a session\'s change row included): 12 ops, 12 tables', (() => {
  const list = [
    ins('v2_program_superset_blocks', rows.v2_program_superset_blocks(N('blk'))),
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe'), { superset_block_id: N('blk') })),
    ins('v2_program_sets', rows.v2_program_sets(N('ps'), { program_exercise_id: N('pe') })),
    ins('v2_workout_warmup_items', rows.v2_workout_warmup_items(N('wu'))),
    ins('v2_run_schedules', rows.v2_run_schedules(N('rs'))),
    ins('v2_week_plan_exercises', rows.v2_week_plan_exercises(N('wpe'), { program_exercise_id: N('pe') })),
    ins('v2_week_plan_sets', rows.v2_week_plan_sets(N('ws'), { program_exercise_id: N('pe'), program_set_id: N('ps') })),
    ins('v2_week_review_decisions', rows.v2_week_review_decisions(N('dec'))),
    ins('v2_session_set_changes', rows.v2_session_set_changes(N('chg'), { week_plan_set_id: N('ws') })),
    upd('v2_workout_days', A('wd2'), { name: 'Pull A' }),
    upd('v2_programs', A('prog'), { name: 'Run a (edited)' }),
    upd('v2_week_plans', A('wp2'), { deload_restore: [{ programExerciseId: A('pe1'), setNumber: 1 }] }),
  ]
  const tables = new Set(list.map((o) => o.table))
  if (tables.size !== 12 || list.length !== 12) throw new Error('A06 must name every table once')
  return `
  perform pg_temp.zz_ok(${opsSql(list)}, 12);
  perform pg_temp.zz_assert(${has('v2_week_review_decisions', N('dec'), `x.user_id = '{{uA}}'`)} and ${has('v2_session_set_changes', N('chg'), `x.user_id = '{{uA}}'`)} and ${has('v2_run_schedules', N('rs'))} and ${has('v2_program_superset_blocks', N('blk'))}, 'the inserts');
  perform pg_temp.zz_assert(${has('v2_week_plans', A('wp2'), `x.deload_restore @> '[{"setNumber": 1}]'::jsonb`)}, 'the deload copy');`
})(), { group: 'whole' })

// ═══ I  inserts ══════════════════════════════════════════════════════════════════════════════════════════════════════
{
  let b = ''
  for (const t of ['v2_programs', 'v2_workout_days', 'v2_week_plans']) {
    b += refused(opsSql(ins(t, { id: N('x'), user_id: '{{uA}}', name: 'x' })), `insert not allowed on ${t}`)
  }
  b += refused(opsSql(ins('v2_programs', { id: N('x'), user_id: '{{uA}}' }), upd('v2_programs', A('prog'), { name: 'y' })), 'insert not allowed on v2_programs')
  add('I01', 'no insert into v2_programs, v2_workout_days or v2_week_plans, whatever the row, and the list it was in is gone', b, { group: 'insert' })
}
add('I02', 'an insert that names another user\'s id lands with the caller\'s (B\'s id is overwritten; B gains nothing)', (() => {
  const tables = INSERTABLE
  let b = '  s0 := pg_temp.zz_snap();\n  perform pg_temp.zz_as(\'{{uB}}\'); s1 := pg_temp.zz_fp(); perform pg_temp.zz_as(\'{{uA}}\');'
  b += `
  perform pg_temp.zz_ok(${opsSql(tables.map((t) => ins(t, { ...freshRow(t), user_id: '{{uB}}' })))}, ${tables.length});`
  for (const t of tables) b += assert(has(t, idFor(t), `x.user_id = '{{uA}}'`), `${t}: the row is A's`)
  b += `
  perform pg_temp.zz_as('{{uB}}');
  perform pg_temp.zz_same(s1, pg_temp.zz_fp(), 'B gained a row');`
  for (const t of tables) b += assert(gone(t, idFor(t)), `${t}: B sees the row`)
  b += `
  perform pg_temp.zz_as('{{uA}}');`
  return b
})(), { group: 'insert' })

add('I03', 'every insertable table takes its full row (a family tested member by member; v2_program_exercises has a dropped column, which a positional insert must step over)', (() => {
  let b = ''
  for (const t of INSERTABLE) b += `
  perform pg_temp.zz_ok(${opsSql(ins(t, freshRow(t, { user_id: '{{uA}}' })))}, 1);${assert(has(t, idFor(t)), `${t}: not inserted`)}`
  return b
})(), { group: 'insert' })

add('I04', 'an insert needs a row: missing, null, a string, a list', (() => {
  let b = ''
  for (const bad of [undefined, null, 'x', [1], 5]) b += refused(opsSql({ op: 'insert', table: 'v2_program_exercises', row: bad }), 'insert needs a row')
  return b
})(), { group: 'insert' })

add('I05', 'a row that names a column the table hasn\'t got is refused, and the column is named (it would be dropped without a word)', (() => {
  let b = ''
  for (const t of ['v2_program_exercises', 'v2_week_plan_sets', 'v2_session_set_changes']) {
    b += refused(opsSql(ins(t, { ...freshRow(t), bogus_column: 1 })), `row names an unknown column: ${t}.bogus_column`)
  }
  b += refused(opsSql(ins('v2_program_exercises', { ...freshRow('v2_program_exercises'), Tempo: '3010', zebra: 1 })), 'row names an unknown column: v2_program_exercises.Tempo')
  // system columns are not columns a row may name either
  for (const sys of ['ctid', 'tableoid', 'xmin', 'cmax']) b += refused(opsSql(ins('v2_program_exercises', { ...freshRow('v2_program_exercises'), [sys]: '(0,1)' })), `row names an unknown column: v2_program_exercises.${sys}`)
  // v2_program_exercises has a dropped column (attnum 6, from 027/028): the name Postgres keeps for it is not a column a row may name
  b += `
  select attname into t from pg_attribute where attrelid = 'public.v2_program_exercises'::regclass and attisdropped limit 1;
  perform pg_temp.zz_assert(t is not null, 'v2_program_exercises has no dropped column to try');
  s0 := pg_temp.zz_snap();
  perform pg_temp.zz_expect(jsonb_build_array(jsonb_build_object('op', 'insert', 'table', 'v2_program_exercises', 'row', ${jsonSql(freshRow('v2_program_exercises'))} || jsonb_build_object(t, 1))), 'row names an unknown column: v2_program_exercises.' || t);
  perform pg_temp.zz_same(s0, pg_temp.zz_snap(), 'a row naming a dropped column left rows behind');`
  return b
})(), { group: 'insert' })

add('I06', 'a column the row leaves out is NULL, not its default: created_at on four tables and the id itself are refused 23502 (RULES: a row names every NOT NULL column)', (() => {
  let b = ''
  for (const t of ['v2_program_sets', 'v2_program_superset_blocks', 'v2_run_schedules', 'v2_week_plan_exercises', 'v2_week_review_decisions', 'v2_session_set_changes']) {
    const { created_at, ...withoutCreatedAt } = freshRow(t) // eslint-disable-line no-unused-vars
    b += refused(opsSql(ins(t, withoutCreatedAt)), 'violates not-null constraint', '23502')
  }
  const { id, ...withoutId } = freshRow('v2_program_exercises') // eslint-disable-line no-unused-vars
  b += refused(opsSql(ins('v2_program_exercises', withoutId)), 'null value in column "id"', '23502')
  const { workout_day_id, ...withoutParent } = freshRow('v2_program_exercises') // eslint-disable-line no-unused-vars
  b += refused(opsSql(ins('v2_program_exercises', withoutParent)), 'null value in column "workout_day_id"', '23502')
  return b
})(), { group: 'insert' })

add('I07', 'an id that exists is refused (23505) whoever owns it, and a table\'s other refusals (a CHECK, a unique index) are its own', `${refused(opsSql(ins('v2_program_exercises', rows.v2_program_exercises(A('pe1')))), 'duplicate key value', '23505')}${refused(opsSql(ins('v2_program_exercises', rows.v2_program_exercises(B('pe1')))), 'duplicate key value', '23505')}${refused(opsSql(ins('v2_program_sets', rows.v2_program_sets(N('ps'), { position: 0 }))), 'violates check constraint', '23514')}${refused(opsSql(ins('v2_workout_warmup_items', rows.v2_workout_warmup_items(N('wu'), { position: 0 }))), 'duplicate key value', '23505')}${refused(opsSql(ins('v2_run_schedules', rows.v2_run_schedules(N('rs'), { from_week: 1 }))), 'duplicate key value', '23505')}`, { group: 'insert' })

add('I08', 'the swap\'s link (DECISIONS 143): an insert naming replaces_program_exercise_id lands with it; a link to nothing is refused; a chain of two swaps holds', `
  perform pg_temp.zz_ok(${opsSql(
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe_b'), { replaces_program_exercise_id: A('pe1') })),
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe_c'), { replaces_program_exercise_id: N('pe_b') })),
  )}, 2);${assert(has('v2_program_exercises', N('pe_b'), `x.replaces_program_exercise_id = '${A('pe1')}'`), 'B replaces A')}${assert(has('v2_program_exercises', N('pe_c'), `x.replaces_program_exercise_id = '${N('pe_b')}'`), 'C replaces B')}${assert(has('v2_program_exercises', A('pe2'), 'x.replaces_program_exercise_id is null'), 'a row that replaced nothing reads null')}
${refused(opsSql(ins('v2_program_exercises', rows.v2_program_exercises(N('pe_d'), { replaces_program_exercise_id: N('nothing') }))), 'violates foreign key constraint', '23503')}`, { group: 'insert' })

// ═══ U  updates ══════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const sample = { v2_program_exercises: A('pe1'), v2_program_sets: A('ps1'), v2_program_superset_blocks: A('blk'), v2_workout_warmup_items: A('wu1'), v2_workout_days: A('wd1'), v2_programs: A('prog'), v2_run_schedules: A('rs'), v2_week_plan_exercises: A('wpe1'), v2_week_plan_sets: A('ws1'), v2_week_review_decisions: A('dec'), v2_session_set_changes: A('chg') }
  let b = ''
  for (const [t, id] of Object.entries(sample)) {
    b += refused(opsSql(upd(t, id, { user_id: '{{uB}}' })), 'patch sets a protected column')
    b += refused(opsSql(upd(t, id, { id: N('new') })), 'patch sets a protected column')
  }
  b += refused(opsSql(upd('v2_program_exercises', A('pe1'), { tempo: '3010', user_id: '{{uB}}' })), 'patch sets a protected column')
  b += refused(opsSql(upd('v2_program_exercises', A('pe1'), { id: A('pe1') })), 'patch sets a protected column')
  b += refused(opsSql(upd('v2_program_exercises', A('pe1'), { user_id: null })), 'patch sets a protected column')
  add('U01', 'a patch never sets user_id or id (every table; beside a good column; to its own value; to null)', b, { group: 'update' })
}
// A harmless valid patch for a row of each table, and the fixture row it is aimed at.
const PATCHES = {
  v2_program_exercises: { tempo: '1111' }, v2_program_sets: { rep_min: 5 }, v2_program_superset_blocks: { rest_within_round_seconds: 5 }, v2_workout_warmup_items: { body: 'Taken' },
  v2_workout_days: { name: 'Taken' }, v2_programs: { name: 'Taken' }, v2_run_schedules: { from_week: 9 }, v2_week_plans: { deload_restore: null },
  v2_week_plan_exercises: { position: 9 }, v2_week_plan_sets: { target_weight: 99 }, v2_week_review_decisions: { decision: 'ignored' }, v2_session_set_changes: { kind: 'deleted' },
}
const SAMPLE = { v2_program_exercises: 'pe1', v2_program_sets: 'ps1', v2_program_superset_blocks: 'blk', v2_workout_warmup_items: 'wu1', v2_workout_days: 'wd1', v2_programs: 'prog', v2_run_schedules: 'rs', v2_week_plans: 'wp1', v2_week_plan_exercises: 'wpe1', v2_week_plan_sets: 'ws1', v2_week_review_decisions: 'dec', v2_session_set_changes: 'chg' }
{
  const patches = PATCHES
  const ids = SAMPLE
  let b = ''
  for (const t of TABLES) b += refused(opsSql(upd(t, B(ids[t]), patches[t])), `row not found: ${t}/${B(ids[t])}`, 'P0001')
  b += refused(opsSql(upd('v2_programs', N('nobody'), { name: 'x' })), `row not found: v2_programs/${N('nobody')}`)
  b += refused(opsSql({ op: 'update', table: 'v2_programs', patch: { name: 'x' } }), 'row not found: v2_programs/')
  add('U02', 'an update of a row the caller doesn\'t own, or that isn\'t there, is "row not found: <table>/<id>" in every table, and the stranger\'s rows are as they were', b, { group: 'update' })
}
add('U03', 'a patch lands as the column\'s type reads it: integer, boolean, text, numeric, timestamptz, text[] (a list, then null), jsonb (an object), and JSON null as SQL NULL', `
  perform pg_temp.zz_ok(${opsSql(
    upd('v2_program_exercises', A('pe1'), { position: 9, week_only: true, tempo: '4010', rest_seconds: 90, weight_unit: 'lbs', removed_at: '2026-10-16T09:30:00+00:00' }),
    upd('v2_week_plan_sets', A('ws1'), { target_weight: 52.5, tags: ['a', 'b c'], target_rir: 1, target_rir_max: 3, is_amrap: false }),
    upd('v2_programs', A('prog'), { schedule: { tuesday: A('wd2'), thursday: null }, name: "It's a run" }),
  )}, 3);${assert(has('v2_program_exercises', A('pe1'), `x.position = 9 and x.week_only and x.tempo = '4010' and x.rest_seconds = 90 and x.weight_unit = 'lbs' and x.removed_at = '2026-10-16T09:30:00+00:00'::timestamptz`), 'integer, boolean, text, timestamptz')}${assert(has('v2_week_plan_sets', A('ws1'), `x.target_weight = 52.5 and x.tags = array['a','b c'] and x.target_rir = 1 and x.target_rir_max = 3`), 'numeric, text[], range')}${assert(has('v2_programs', A('prog'), `x.schedule = '{"tuesday": "${A('wd2')}", "thursday": null}'::jsonb and x.name = 'It''s a run'`), 'jsonb object with a null inside, quote in text')}
  perform pg_temp.zz_ok(${opsSql(
    upd('v2_week_plan_sets', A('ws1'), { tags: null, target_weight: null, target_rir_max: null }),
    upd('v2_program_exercises', A('pe1'), { rest_seconds: null, removed_at: null, weight_unit: null }),
  )}, 2);${assert(has('v2_week_plan_sets', A('ws1'), 'x.tags is null and x.target_weight is null and x.target_rir_max is null'), 'JSON null is SQL NULL (an array column, a number)')}${assert(has('v2_program_exercises', A('pe1'), 'x.rest_seconds is null and x.removed_at is null and x.weight_unit is null'), 'JSON null is SQL NULL (integer, timestamptz, text)')}`, { group: 'update' })

add('U04', 'an update needs a patch (missing, null, a list, a string) and the patch needs something in it ({})', `${refused(opsSql(upd('v2_programs', A('prog'), {})), 'patch is empty')}${refused(opsSql({ op: 'update', table: 'v2_programs', id: A('prog') }), 'update needs a patch')}${refused(opsSql({ op: 'update', table: 'v2_programs', id: A('prog'), patch: null }), 'update needs a patch')}${refused(opsSql({ op: 'update', table: 'v2_programs', id: A('prog'), patch: ['name'] }), 'update needs a patch')}${refused(opsSql({ op: 'update', table: 'v2_programs', id: A('prog'), patch: 'name' }), 'update needs a patch')}`, { group: 'update' })

add('U05', 'a column the table hasn\'t got is the database\'s own refusal (42703), a wrong value is 22P02, a CHECK 23514, a foreign key 23503, a unique 23505 - each takes the list with it', `${refused(opsSql(upd('v2_program_exercises', A('pe1'), { tempo: '1', no_such_column: 1 })), 'no_such_column', '42703')}${refused(opsSql(upd('v2_program_exercises', A('pe1'), { position: 'abc' })), 'invalid input syntax for type integer', '22P02')}${refused(opsSql(upd('v2_week_plan_sets', A('ws1'), { rep_min: 0 })), 'violates check constraint', '23514')}${refused(opsSql(upd('v2_week_plan_exercises', A('wpe1'), { program_exercise_id: N('nothing') })), 'violates foreign key constraint', '23503')}${refused(opsSql(upd('v2_workout_warmup_items', A('wu2'), { position: 0 })), 'duplicate key value', '23505')}${refused(opsSql(upd('v2_program_exercises', A('pe1'), { position: null })), 'null value in column "position"', '23502')}${refused(opsSql(upd('v2_programs', A('prog'), { name: 'ok' }), upd('v2_programs', A('prog'), { schedule: null })), 'null value in column "schedule"', '23502')}`, { group: 'update' })

add('U06', 'an update changes exactly its row: every other row of the table, the caller\'s and the stranger\'s, is as it was (each table)', (() => {
  let b = ''
  for (const t of TABLES) {
    const id = A(SAMPLE[t])
    b += `
  perform pg_temp.zz_as('{{uA}}'); s0 := pg_temp.zz_others('${t}', '${id}'); perform pg_temp.zz_as('{{uB}}'); s1 := pg_temp.zz_others('${t}', '00000000-0000-4000-8000-000000000000'); perform pg_temp.zz_as('{{uA}}');
  perform pg_temp.zz_ok(${opsSql(upd(t, id, PATCHES[t]))}, 1);
  perform pg_temp.zz_same(s0, pg_temp.zz_others('${t}', '${id}'), '${t}: another row of the caller changed');
  perform pg_temp.zz_as('{{uB}}'); perform pg_temp.zz_same(s1, pg_temp.zz_others('${t}', '00000000-0000-4000-8000-000000000000'), '${t}: the stranger''s rows changed'); perform pg_temp.zz_as('{{uA}}');`
  }
  // an id of one table, aimed at another: not found (the table is part of the address)
  b += refused(opsSql(upd('v2_programs', A('wd1'), { name: 'x' })), `row not found: v2_programs/${A('wd1')}`)
  b += refused(opsSql(del('v2_workout_days', A('wu1'))), `row not found: v2_workout_days/${A('wu1')}`)
  return b
})(), { group: 'update' })

// ═══ W  v2_week_plans: one column, as an update (DECISIONS 142) ═════════════════════════════════════════════════════
{
  const SAVED = [{ programExerciseId: A('pe1'), setNumber: 1, stageIndex: 0, isWarmup: false, isDropset: false, stageKind: null, programSetId: A('ps1'), repMin: 8, repMax: 10, isAmrap: false, targetWeight: 50, targetRir: 2, targetRirMax: null, tags: null }]
  add('W01', 'v2_week_plans takes no insert and no delete', `${refused(opsSql(ins('v2_week_plans', { id: N('wp'), user_id: '{{uA}}', mesocycle_id: A('meso'), workout_day_id: A('wd1'), week_number: 9, is_deload: false, notes: null, created_at: '2026-10-16T08:00:00+00:00', sequence_position: null, deload_restore: null })), 'insert not allowed on v2_week_plans')}${refused(opsSql(del('v2_week_plans', A('wp1'))), 'delete not allowed on v2_week_plans')}${refused(opsSql(del('v2_week_plans', B('wp1'))), 'delete not allowed on v2_week_plans')}${refused(opsSql(del('v2_week_plans', N('nothing'))), 'delete not allowed on v2_week_plans')}`, { group: 'week_plans' })

  let b = ''
  for (const [col, val] of Object.entries({
    is_deload: true, week_number: 9, workout_day_id: A('wd2'), mesocycle_id: A('meso'), notes: 'x', created_at: '2026-01-01T00:00:00+00:00', sequence_position: 3,
    user_id: '{{uB}}', id: N('wp'),
  })) {
    b += refused(opsSql(upd('v2_week_plans', A('wp1'), { [col]: val })), 'patch sets a protected column')
    b += refused(opsSql(upd('v2_week_plans', A('wp1'), { deload_restore: SAVED, [col]: val })), 'patch sets a protected column')
  }
  b += refused(opsSql(upd('v2_week_plans', A('wp1'), { bogus: 1 })), 'patch sets a protected column')
  b += assert(has('v2_week_plans', A('wp1'), 'x.deload_restore is null and not x.is_deload and x.week_number = 1'), 'the plan row is as it was')
  add('W02', 'a patch of any column of v2_week_plans but deload_restore is refused like a protected column - each column, and beside deload_restore - and the row is as it was', b, { group: 'week_plans' })

  add('W03', 'an update of deload_restore lands: to a list (stored as the list), to a longer list, to SQL NULL (not JSON null)', `
  perform pg_temp.zz_ok(${opsSql(upd('v2_week_plans', A('wp1'), { deload_restore: SAVED }))}, 1);${assert(has('v2_week_plans', A('wp1'), `x.deload_restore = '${JSON.stringify(SAVED)}'::jsonb and jsonb_typeof(x.deload_restore) = 'array' and not x.is_deload`), 'the list')}
  perform pg_temp.zz_ok(${opsSql(upd('v2_week_plans', A('wp1'), { deload_restore: [...SAVED, ...SAVED] }))}, 1);${assert(has('v2_week_plans', A('wp1'), `jsonb_array_length(x.deload_restore) = 2`), 'the longer list')}
  perform pg_temp.zz_ok(${opsSql(upd('v2_week_plans', A('wp1'), { deload_restore: null }))}, 1);${assert(has('v2_week_plans', A('wp1'), 'x.deload_restore is null'), 'SQL NULL (UNMARK reads Array.isArray: a JSON null is not the same)')}
  perform pg_temp.zz_ok(${opsSql(upd('v2_week_plans', A('wp1'), { deload_restore: [] }))}, 1);${assert(has('v2_week_plans', A('wp1'), `x.deload_restore = '[]'::jsonb`), 'an empty list stays an empty list')}`, { group: 'week_plans' })

  add('W04', 'an update of another user\'s v2_week_plans row, or a missing one, is "row not found"', `${refused(opsSql(upd('v2_week_plans', B('wp1'), { deload_restore: null })), `row not found: v2_week_plans/${B('wp1')}`)}${refused(opsSql(upd('v2_week_plans', N('nothing'), { deload_restore: null })), 'row not found: v2_week_plans/')}`, { group: 'week_plans' })
}

// ═══ D  deletes ══════════════════════════════════════════════════════════════════════════════════════════════════════
add('D01', 'a delete of a planned head takes its stages by the foreign key; a program exercise takes its sets and its week rows', `
  perform pg_temp.zz_ok(${opsSql(del('v2_week_plan_sets', A('ws2')))}, 1);${assert(gone('v2_week_plan_sets', A('ws2')) + ' and ' + gone('v2_week_plan_sets', A('ws2s')), 'the head and its stage')}${assert(has('v2_week_plan_sets', A('ws1')), 'the other set stays')}
  perform pg_temp.zz_ok(${opsSql(del('v2_program_exercises', A('pe1')))}, 1);${assert(gone('v2_program_exercises', A('pe1')) + ' and ' + gone('v2_program_sets', A('ps1')) + ' and ' + gone('v2_program_sets', A('ps2s')) + ' and ' + gone('v2_week_plan_exercises', A('wpe1')) + ' and ' + gone('v2_week_plan_sets', A('ws1')), 'the exercise, its default sets, its week row and its planned set')}`, { group: 'delete' })

{
  const ids = { v2_program_exercises: 'pe1', v2_program_sets: 'ps1', v2_program_superset_blocks: 'blk', v2_workout_warmup_items: 'wu1', v2_workout_days: 'wd1', v2_programs: 'prog', v2_run_schedules: 'rs', v2_week_plan_exercises: 'wpe1', v2_week_plan_sets: 'ws1', v2_week_review_decisions: 'dec', v2_session_set_changes: 'chg' }
  let b = ''
  for (const [t, id] of Object.entries(ids)) b += refused(opsSql(del(t, B(id))), `row not found: ${t}/${B(id)}`, 'P0001')
  b += refused(opsSql(del('v2_programs', N('nobody'))), `row not found: v2_programs/${N('nobody')}`)
  b += refused(opsSql({ op: 'delete', table: 'v2_programs' }), 'row not found: v2_programs/')
  b += refused(opsSql(del('v2_workout_warmup_items', A('wu1')), del('v2_workout_warmup_items', A('wu1'))), `row not found: v2_workout_warmup_items/${A('wu1')}`)
  add('D02', 'a delete of a row the caller doesn\'t own, that isn\'t there or that this very list already deleted is "row not found", in every table', b, { group: 'delete' })
}
add('D03', 'the swap\'s link (DECISIONS 143): really deleting the replaced row leaves the new row, with the link null (on delete set null); the replaced row\'s own link goes with it', `
  perform pg_temp.zz_ok(${opsSql(
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe_b'), { replaces_program_exercise_id: A('pe3') })),
    ins('v2_program_exercises', rows.v2_program_exercises(N('pe_c'), { replaces_program_exercise_id: N('pe_b') })),
  )}, 2);
  perform pg_temp.zz_ok(${opsSql(del('v2_program_exercises', N('pe_b')))}, 1);${assert(has('v2_program_exercises', N('pe_c'), 'x.replaces_program_exercise_id is null'), 'C stays and its link is null')}${assert(has('v2_program_exercises', A('pe3')), 'the oldest row is untouched')}
  perform pg_temp.zz_ok(${opsSql(ins('v2_program_exercises', rows.v2_program_exercises(N('pe_d'), { replaces_program_exercise_id: A('pe3') })), del('v2_program_exercises', A('pe3')))}, 2);${assert(has('v2_program_exercises', N('pe_d'), 'x.replaces_program_exercise_id is null'), 'deleting the replaced row in the same list')}`, { group: 'delete' })

add('D04', 'a delete removes exactly its row: the other rows of the table, the caller\'s and the stranger\'s, are as they were (the tables whose rows nothing else hangs on)', (() => {
  let b = ''
  for (const [t, id] of [['v2_workout_warmup_items', 'wu1'], ['v2_week_review_decisions', 'dec'], ['v2_session_set_changes', 'chg'], ['v2_week_plan_exercises', 'wpe1'], ['v2_run_schedules', 'rs'], ['v2_program_sets', 'ps1'], ['v2_week_plan_sets', 'ws2s']]) {
    b += `
  perform pg_temp.zz_as('{{uA}}'); s0 := pg_temp.zz_others('${t}', '${A(id)}'); perform pg_temp.zz_as('{{uB}}'); s1 := pg_temp.zz_others('${t}', '00000000-0000-4000-8000-000000000000'); perform pg_temp.zz_as('{{uA}}');
  perform pg_temp.zz_ok(${opsSql(del(t, A(id)))}, 1);${assert(gone(t, A(id)), `${t}: the row is still there`)}
  perform pg_temp.zz_same(s0, pg_temp.zz_others('${t}', '${A(id)}'), '${t}: another row of the caller went');
  perform pg_temp.zz_as('{{uB}}'); perform pg_temp.zz_same(s1, pg_temp.zz_others('${t}', '00000000-0000-4000-8000-000000000000'), '${t}: the stranger''s rows changed'); perform pg_temp.zz_as('{{uA}}');`
  }
  return b
})(), { group: 'delete' })

add('P01', 'a long list: 1,000 inserts and 1,000 updates in one call finish inside the role\'s 8 s statement_timeout, and every op is counted', `
  perform pg_temp.zz_assert((select setting from pg_settings where name = 'statement_timeout') = '8000', 'statement_timeout is ' || (select setting from pg_settings where name = 'statement_timeout'));
  t := clock_timestamp()::text;
  select * into r from pg_temp.zz_run((
    select jsonb_agg(o order by ord) from (
      select i as ord, jsonb_build_object('op', 'insert', 'table', 'v2_week_plan_sets', 'row',
        jsonb_build_object('id', md5('p01:' || i)::uuid, 'user_id', '${'{{uB}}'}', 'week_plan_id', '${A('wp1')}', 'program_exercise_id', '${A('pe1')}', 'set_number', 100 + i,
          'target_rir', null, 'target_rir_max', null, 'is_dropset', false, 'parent_week_plan_set_id', null, 'stage_index', 0, 'is_warmup', false,
          'program_set_id', null, 'stage_kind', null, 'target_weight', 60, 'rep_min', 8, 'rep_max', 10, 'is_amrap', false, 'tags', null)) as o
        from generate_series(1, 1000) i
      union all
      select 1000 + i, jsonb_build_object('op', 'update', 'table', 'v2_week_plan_sets', 'id', md5('p01:' || i)::uuid, 'patch', jsonb_build_object('target_weight', 62.5, 'tags', jsonb_build_array('x')))
        from generate_series(1, 1000) i
    ) q));
  perform pg_temp.zz_assert(r.err is null and r.n = 2000, 'got ' || coalesce(r.err, r.n::text));
  select count(*) into k from public.v2_week_plan_sets x where x.set_number > 100 and x.target_weight = 62.5;
  perform pg_temp.zz_assert(k = 1000, 'rows with the second write: ' || k);
  note := '2000 ops in ' || round(extract(epoch from clock_timestamp() - t::timestamptz)::numeric, 2) || ' s';`, { group: 'whole' })

// ═══ S  the function itself ══════════════════════════════════════════════════════════════════════════════════════════
add('S01', 'the column: nullable uuid with no default, a foreign key to the table itself that sets null on delete', `
  select * into r from pg_temp.zz_column();
  perform pg_temp.zz_assert(r.data_type = 'uuid' and r.is_nullable = 'YES' and r.column_default is null, 'column ' || r.data_type || ' ' || r.is_nullable || ' ' || coalesce(r.column_default, 'no default'));
  perform pg_temp.zz_assert(r.fk_def = 'FOREIGN KEY (replaces_program_exercise_id) REFERENCES v2_program_exercises(id) ON DELETE SET NULL', 'fk: ' || coalesce(r.fk_def, 'none'));`, { group: 'schema' })
