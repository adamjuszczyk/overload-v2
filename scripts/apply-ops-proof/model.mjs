// apply-ops-proof/model.mjs (chunk 47): the pieces of the SQL proof of migration 043's `v2_apply_ops` that need no
// Docker, so scripts/apply-ops-proof.test.mjs can test them: ids, the op builders, the fixture, the session's helper
// functions, and how the function is read out of the migration file and mutated for a break proof.
//
// Nothing here talks to a database. scripts/apply-ops-proof.mjs runs what this builds.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATION = path.resolve(HERE, '../../supabase/migrations/043_p12_apply_ops.sql')

// ─── ids ─────────────────────────────────────────────────────────────────────────────────────────────────────────

// A name → a uuid, the same one every run (md5 of the name, laid out as 8-4-4-4-12). Scenarios write `{{a_pe1}}` and get
// the literal; a fixture row, an op and an assertion that mean the same row spell it the same way.
export function uuidOf(name) {
  const h = createHash('md5').update(`c47:${name}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

// `{{name}}` → the uuid, in any text (SQL or JSON). An unknown shape is left alone, so a typo shows up as a SQL error.
export function resolveIds(text) {
  return text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (_, name) => uuidOf(name))
}

export const USER_A = '{{uA}}'
export const USER_B = '{{uB}}'

// ─── op builders (JSON, ids as {{names}}) ──────────────────────────────────────────────────────────────────────────

export const ins = (table, row) => ({ op: 'insert', table, row })
export const upd = (table, id, patch) => ({ op: 'update', table, id, patch })
export const del = (table, id) => ({ op: 'delete', table, id })

// An op list as an SQL literal: the JSON, single quotes doubled, cast to jsonb.
export const opsSql = (...ops) => `'${JSON.stringify(ops.flat()).replace(/'/g, "''")}'::jsonb`
// Any JSON value as an SQL literal (for the odd p_ops that is not a list).
export const jsonSql = (value) => `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`

const TS = '2026-10-16T08:00:00+00:00'

// Full insert rows: every column the table has, as chunk 45's planner writes them (jsonb_populate_record gives NULL, not the
// default, for a column a row leaves out). `over` replaces columns. user_id is a stranger's on purpose: the function must
// overwrite it with the caller's.
const STRANGER = 'ffffffff-ffff-4fff-8fff-ffffffffffff'
export const rows = {
  v2_program_exercises: (id, over = {}) => ({
    id, user_id: STRANGER, workout_day_id: '{{a_wd1}}', exercise_id: '{{a_ex1}}', position: 5, weight_unit: null,
    superset_block_id: null, rest_seconds: null, rest_after_seconds: null, tempo: null, week_only: false, removed_at: null,
    replaces_program_exercise_id: null, ...over,
  }),
  v2_program_sets: (id, over = {}) => ({
    id, user_id: STRANGER, program_exercise_id: '{{a_pe1}}', position: 5, is_warmup: false, stage_kind: null,
    stage_rest_seconds: null, parent_program_set_id: null, stage_index: 0, rep_min: 8, rep_max: 10, is_amrap: false,
    rest_seconds: null, removed_at: null, created_at: TS, ...over,
  }),
  v2_program_superset_blocks: (id, over = {}) => ({
    id, user_id: STRANGER, workout_day_id: '{{a_wd1}}', rest_within_round_seconds: 15, rest_after_round_seconds: 90,
    created_at: TS, ...over,
  }),
  v2_workout_warmup_items: (id, over = {}) => ({
    id, user_id: STRANGER, workout_day_id: '{{a_wd1}}', position: 7, body: 'Hip openers', ...over,
  }),
  v2_run_schedules: (id, over = {}) => ({
    id, user_id: STRANGER, mesocycle_id: '{{a_meso}}', from_week: 3, schedule: { monday: '{{a_wd1}}', thursday: '{{a_wd2}}' },
    created_at: TS, ...over,
  }),
  v2_week_plan_exercises: (id, over = {}) => ({
    id, user_id: STRANGER, week_plan_id: '{{a_wp1}}', program_exercise_id: '{{a_pe3}}', position: 4,
    carry_program_exercise_id: null, carry_position: null, created_at: TS, ...over,
  }),
  v2_week_plan_sets: (id, over = {}) => ({
    id, user_id: STRANGER, week_plan_id: '{{a_wp1}}', program_exercise_id: '{{a_pe1}}', set_number: 5, target_rir: 2,
    target_rir_max: null, is_dropset: false, parent_week_plan_set_id: null, stage_index: 0, is_warmup: false,
    program_set_id: null, stage_kind: null, target_weight: 60, rep_min: 8, rep_max: 10, is_amrap: false, tags: null, ...over,
  }),
  v2_week_review_decisions: (id, over = {}) => ({
    id, user_id: STRANGER, week_plan_id: '{{a_wp2}}', item_key: 'number:new', decision: 'ignored', created_at: TS, ...over,
  }),
  v2_session_set_changes: (id, over = {}) => ({
    id, user_id: STRANGER, session_id: '{{a_sess}}', kind: 'deleted', week_plan_set_id: '{{a_ws1}}', set_log_id: null,
    is_warmup: false, stage_kind: null, stage_count: 0, created_at: TS, updated_at: TS, ...over,
  }),
}

// The nine tables an insert may name, in the order a list can hold them (parents first).
export const INSERTABLE = [
  'v2_program_superset_blocks', 'v2_program_exercises', 'v2_program_sets', 'v2_workout_warmup_items', 'v2_run_schedules',
  'v2_week_plan_exercises', 'v2_week_plan_sets', 'v2_week_review_decisions', 'v2_session_set_changes',
]
// Every table the function may name.
export const TABLES = [
  'v2_program_exercises', 'v2_program_sets', 'v2_program_superset_blocks', 'v2_workout_warmup_items', 'v2_workout_days',
  'v2_programs', 'v2_run_schedules', 'v2_week_plans', 'v2_week_plan_exercises', 'v2_week_plan_sets',
  'v2_week_review_decisions', 'v2_session_set_changes',
]

// ─── the fixture ─────────────────────────────────────────────────────────────────────────────────────────────────

// One user's data, every one of the twelve tables, ids named `<p>_…` (p = 'a' for the caller, 'b' for the stranger whose
// rows the caller must never touch). Inserted by the user themselves, under RLS, so a fixture row exists only if the
// policy lets its owner write it.
export function fixtureSql(p) {
  const n = (s) => `{{${p}_${s}}}`
  return `
insert into exercises (id, user_id, name, muscle_group) values
  ('${n('ex1')}', auth.uid(), 'Bench ${p}', 'chest'), ('${n('ex2')}', auth.uid(), 'Row ${p}', 'back');
insert into v2_programs (id, user_id, name, schedule, kind) values
  ('${n('prog')}', auth.uid(), 'Run ${p}', '{"monday": "${n('wd1')}", "thursday": "${n('wd2')}"}'::jsonb, 'run');
insert into v2_workout_days (id, program_id, user_id, name, position) values
  ('${n('wd1')}', '${n('prog')}', auth.uid(), 'Push', 0), ('${n('wd2')}', '${n('prog')}', auth.uid(), 'Pull', 1);
insert into v2_program_superset_blocks (id, user_id, workout_day_id) values ('${n('blk')}', auth.uid(), '${n('wd1')}');
insert into v2_program_exercises (id, workout_day_id, user_id, exercise_id, position, superset_block_id) values
  ('${n('pe1')}', '${n('wd1')}', auth.uid(), '${n('ex1')}', 0, null),
  ('${n('pe2')}', '${n('wd1')}', auth.uid(), '${n('ex2')}', 1, '${n('blk')}'),
  ('${n('pe3')}', '${n('wd2')}', auth.uid(), '${n('ex1')}', 0, null);
insert into v2_program_sets (id, user_id, program_exercise_id, position, stage_kind, parent_program_set_id, stage_index, rep_min, rep_max) values
  ('${n('ps1')}', auth.uid(), '${n('pe1')}', 1, null, null, 0, 8, 10),
  ('${n('ps2')}', auth.uid(), '${n('pe1')}', 2, 'dropset', null, 0, 6, 8),
  ('${n('ps2s')}', auth.uid(), '${n('pe1')}', 2, null, '${n('ps2')}', 1, null, null);
insert into v2_workout_warmup_items (id, user_id, workout_day_id, position, body) values
  ('${n('wu1')}', auth.uid(), '${n('wd1')}', 0, 'Arm circles'), ('${n('wu2')}', auth.uid(), '${n('wd1')}', 1, 'Band pull-aparts');
insert into v2_mesocycles (id, user_id, name, program_id, start_date) values ('${n('meso')}', auth.uid(), 'Run ${p}', '${n('prog')}', '2026-10-05');
insert into v2_run_schedules (id, user_id, mesocycle_id, from_week, schedule) values
  ('${n('rs')}', auth.uid(), '${n('meso')}', 1, '{"monday": "${n('wd1')}"}'::jsonb);
insert into v2_week_plans (id, user_id, mesocycle_id, workout_day_id, week_number) values
  ('${n('wp1')}', auth.uid(), '${n('meso')}', '${n('wd1')}', 1),
  ('${n('wp2')}', auth.uid(), '${n('meso')}', '${n('wd1')}', 2),
  ('${n('wp3')}', auth.uid(), '${n('meso')}', '${n('wd2')}', 1);
insert into v2_week_plan_exercises (id, user_id, week_plan_id, program_exercise_id, position) values
  ('${n('wpe1')}', auth.uid(), '${n('wp1')}', '${n('pe1')}', 0), ('${n('wpe2')}', auth.uid(), '${n('wp1')}', '${n('pe2')}', 1);
insert into v2_week_plan_sets (id, user_id, week_plan_id, program_exercise_id, set_number, target_weight, rep_min, rep_max, stage_kind, parent_week_plan_set_id, stage_index, is_dropset, tags) values
  ('${n('ws1')}', auth.uid(), '${n('wp1')}', '${n('pe1')}', 1, 50, 8, 10, null, null, 0, false, '{tempo,pause}'),
  ('${n('ws2')}', auth.uid(), '${n('wp1')}', '${n('pe1')}', 2, 50, 6, 8, 'dropset', null, 0, false, null),
  ('${n('ws2s')}', auth.uid(), '${n('wp1')}', '${n('pe1')}', 2, 40, 8, 10, null, '${n('ws2')}', 1, true, null);
insert into v2_week_review_decisions (id, user_id, week_plan_id, item_key, decision) values ('${n('dec')}', auth.uid(), '${n('wp2')}', 'number:1', 'used');
insert into v2_sessions (id, user_id, mesocycle_id, week_plan_id, workout_day_id, date, status) values
  ('${n('sess')}', auth.uid(), '${n('meso')}', '${n('wp1')}', '${n('wd1')}', '2026-10-06', 'in_progress');
insert into v2_set_logs (id, user_id, session_id, exercise_id, week_plan_set_id, set_number, weight, reps, logged_at) values
  ('${n('log')}', auth.uid(), '${n('sess')}', '${n('ex1')}', '${n('ws1')}', 1, 50, 8, now());
insert into v2_session_set_changes (id, user_id, session_id, kind, week_plan_set_id) values ('${n('chg')}', auth.uid(), '${n('sess')}', 'deleted', '${n('ws2')}');
`
}

// How many rows the fixture puts in each table, per user (the fixture's own check, scenario F00).
export const FIXTURE_COUNTS = {
  exercises: 2, v2_programs: 1, v2_workout_days: 2, v2_program_superset_blocks: 1, v2_program_exercises: 3, v2_program_sets: 3,
  v2_workout_warmup_items: 2, v2_mesocycles: 1, v2_run_schedules: 1, v2_week_plans: 3, v2_week_plan_exercises: 2,
  v2_week_plan_sets: 3, v2_week_review_decisions: 1, v2_sessions: 1, v2_set_logs: 1, v2_session_set_changes: 1,
}

// ─── the session's helper functions ──────────────────────────────────────────────────────────────────────────────

// Created in pg_temp for each psql session, as the admin, before the role switch. `__FN__` is the function under test.
// zz_run never raises: it returns the count, or the SQLSTATE and message. The subtransaction its handler opens is what
// rolls back a failed call's earlier ops, which is what a failed request's transaction does.
export function helperSql(fn) {
  return `
create function pg_temp.zz_as(p_uid uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true); end $$;

create function pg_temp.zz_fp() returns text language sql as $$
  select md5(concat_ws('|', ${[...TABLES, 'v2_sessions', 'v2_set_logs']
    .map((t) => `(select coalesce(string_agg(to_jsonb(x)::text, ',' order by x.id), '') from public.${t} x)`)
    .join(',\n    ')}))
$$;

-- Both users' fingerprints, whoever is signed in, and the caller put back.
create function pg_temp.zz_snap() returns text language plpgsql as $$
declare v_cur text := current_setting('request.jwt.claim.sub', true); fa text; fb text;
begin
  perform pg_temp.zz_as('{{uA}}'::uuid); fa := pg_temp.zz_fp();
  perform pg_temp.zz_as('{{uB}}'::uuid); fb := pg_temp.zz_fp();
  perform set_config('request.jwt.claim.sub', coalesce(v_cur, ''), true);
  return fa || ':' || fb;
end $$;

create function pg_temp.zz_run(p_ops jsonb, out n integer, out err text) language plpgsql as $$
begin
  n := ${fn}(p_ops);
exception when others then
  n := null;
  err := sqlstate || ': ' || sqlerrm;
end $$;

create function pg_temp.zz_assert(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin if p_cond is not true then raise exception 'ASSERT: %', p_msg; end if; end $$;

-- The call succeeds and applied p_want ops.
create function pg_temp.zz_ok(p_ops jsonb, p_want integer) returns void language plpgsql as $$
declare r record;
begin
  select * into r from pg_temp.zz_run(p_ops);
  if r.err is not null then raise exception 'EXPECTED SUCCESS, GOT %', r.err; end if;
  if r.n is distinct from p_want then raise exception 'EXPECTED % OPS, GOT %', p_want, r.n; end if;
end $$;

-- The call fails with this text in its message (and this SQLSTATE, when given); the fingerprints are the caller's to compare.
create function pg_temp.zz_expect(p_ops jsonb, p_part text, p_code text default null) returns void language plpgsql as $$
declare r record;
begin
  select * into r from pg_temp.zz_run(p_ops);
  if r.err is null then raise exception 'EXPECTED AN ERROR WITH "%", GOT n=%', p_part, r.n; end if;
  if position(p_part in r.err) = 0 then raise exception 'WRONG ERROR: wanted "%", got "%"', p_part, r.err; end if;
  if p_code is not null and left(r.err, 5) <> p_code then raise exception 'WRONG SQLSTATE: wanted %, got "%"', p_code, r.err; end if;
end $$;

-- Runs a statement and returns its error as "SQLSTATE: message", or null (for the safeupdate control).
create function pg_temp.zz_try(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null;
exception when others then return sqlstate || ': ' || sqlerrm; end $$;

-- What the catalog says about the function under test.
create function pg_temp.zz_meta(out secdef boolean, out cfg text[], out acl_authenticated boolean, out acl_anon boolean, out acl_public boolean)
language plpgsql as $$
declare p oid := '${fn}(jsonb)'::regprocedure::oid;
begin
  select prosecdef, proconfig into secdef, cfg from pg_proc where oid = p;
  acl_authenticated := has_function_privilege('authenticated', p, 'execute');
  acl_anon := has_function_privilege('anon', p, 'execute');
  acl_public := exists (select 1 from pg_proc pr, aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) a
                         where pr.oid = p and a.grantee = 0 and a.privilege_type = 'EXECUTE');
end $$;

-- The new column and its foreign key, as the catalog has them.
create function pg_temp.zz_column(out data_type text, out is_nullable text, out column_default text, out fk_def text)
language plpgsql as $$
begin
  select c.data_type, c.is_nullable, c.column_default into data_type, is_nullable, column_default
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'v2_program_exercises' and c.column_name = 'replaces_program_exercise_id';
  select replace(pg_get_constraintdef(k.oid), 'public.', '') into fk_def
    from pg_constraint k
   where k.conrelid = 'public.v2_program_exercises'::regclass and k.contype = 'f'
     and k.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = 'public.v2_program_exercises'::regclass and a.attname = 'replaces_program_exercise_id')];
end $$;

-- Every row of a table but one (as the signed-in user sees the table), as one hash: what an update or a delete of that row
-- must leave alone.
create function pg_temp.zz_others(p_table text, p_id uuid) returns text language plpgsql as $$
declare v text;
begin
  execute format('select md5(coalesce(string_agg(to_jsonb(x)::text, '','' order by x.id), '''')) from public.%I x where x.id <> $1', p_table)
    into v using p_id;
  return v;
end $$;

create function pg_temp.zz_same(p_before text, p_after text, p_what text) returns void language plpgsql as $$
begin if p_before is distinct from p_after then raise exception 'ROWS CHANGED: %', p_what; end if; end $$;

create function pg_temp.zz_changed(p_before text, p_after text, p_what text) returns void language plpgsql as $$
begin if p_before is not distinct from p_after then raise exception 'EXPECTED A CHANGE (the check would be vacuous): %', p_what; end if; end $$;
`
}

// ─── the function, read out of the migration ─────────────────────────────────────────────────────────────────────────

const FN_START = 'create or replace function v2_apply_ops('
const GRANT_END = 'grant execute on function v2_apply_ops(jsonb) to authenticated;'

// The text a break edits: the `create or replace function v2_apply_ops … $fn$;` and the two statements that set who may run
// it (revoke, grant). Read from the migration file, never from a copy of it.
export function readInstallText(file = MIGRATION) {
  const sql = readFileSync(file, 'utf8')
  const start = sql.indexOf(FN_START)
  const end = sql.indexOf(GRANT_END)
  if (start < 0 || end < start) throw new Error(`${file}: the function and its grants were not found`)
  if (sql.indexOf(FN_START, start + 1) >= 0) throw new Error(`${file}: more than one ${FN_START}`)
  return sql.slice(start, end + GRANT_END.length)
}

// The install text under another name, in pg_temp (a session's own copy: nothing is left in the database).
// A function made in public gets execute for anon, authenticated and service_role from Supabase's default privileges, besides
// PUBLIC's own; one made in pg_temp gets PUBLIC's alone. The copy is given the same three grants right after its body, so
// the migration's revoke and grant act on the same starting point as they do in public (break B53 needs it).
// `defaults: false` is a database with no default privileges at all (a new Supabase branch, RULES: staging's first days).
export function asCopy(installText, name = 'zz_fn', { defaults = true } = {}) {
  const renamed = installText.replaceAll('function v2_apply_ops(', `function pg_temp.${name}(`)
  const end = '\n$fn$;'
  if (renamed.split(end).length !== 2) throw new Error('the function body does not end in exactly one $fn$;')
  if (!defaults) return renamed
  return renamed.replace(end, `${end}\ngrant execute on function pg_temp.${name}(jsonb) to anon, authenticated, service_role;`)
}

// A break: one exact replacement that must match once (RULES: "a break that never fired reads as caught").
export function applyBreak(installText, brk) {
  for (const [from, to] of brk.edits) {
    const at = installText.indexOf(from)
    if (at < 0) throw new Error(`break ${brk.id}: "${from.slice(0, 60)}" is not in the function`)
    if (installText.indexOf(from, at + 1) >= 0) throw new Error(`break ${brk.id}: "${from.slice(0, 60)}" matches more than once`)
    installText = installText.slice(0, at) + to + installText.slice(at + from.length)
  }
  return installText
}

// The SQL with comments and blank space taken out (for the comment-only control: the function must not have changed).
export function withoutComments(sql) {
  return sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim()
}
