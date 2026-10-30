// maintenance-trigger.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// Migration 048 (chunk 70, Overload 1.2.1; SPEC "Maintenance check" [10] and Rules 3; DECISIONS 253, 264): one check
// decides maintenance, in the database, and one statement-level trigger on every public table that carries a user_id
// column puts that check in front of every write, the writes inside an RPC included, without editing the RPCs. Text
// checks of the migration only. The executed proof is the replay on the real image (chunk 70's report): 40 triggers
// from the catalog, none missing on a table with a user_id, every function refused with OL001 while maintenance is on,
// and the breaks.
//
// What the text can pin: the trigger is made from the catalog (a table-name list or prefix would let a table slip
// through), there is one trigger function and one check, the two delete functions call it first, the five functions
// already in the app are not redefined, the file changes no existing row, v2_app_status has one row and no write path.
// Each check has a control below: the same check run on a copy of the migration with the property broken must report it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES_AHEAD_OF_THE_APP } from './verify-rls.mjs';
import { splitStatements } from './migration-rules.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = join(root, 'supabase', 'migrations');
const FILE = '048_p121_release_state_and_deletes.sql';
const sql = readFileSync(join(migrationsDir, FILE), 'utf8');
const verifyRls = readFileSync(join(root, 'scripts', 'verify-rls.mjs'), 'utf8');

// ── Reading SQL ───────────────────────────────────────────────────────────────────────────────────────────────────────
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, '');
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
const noStrings = (s) => s.replace(/'(?:[^']|'')*'/g, "''");

// Every `create or replace function` in the file: name -> { header, body } (the body between its $$ marks).
function functionsOf(code) {
  const out = new Map();
  for (const m of code.matchAll(/create\s+or\s+replace\s+function\s+([a-z0-9_]+)\s*\(/gi)) {
    const open = code.indexOf('$$', m.index);
    const close = code.indexOf('$$', open + 2);
    out.set(m[1], { header: oneLine(code.slice(m.index, open)), body: oneLine(code.slice(open + 2, close)) });
  }
  return out;
}

// The words a loop's WHERE clause may use to choose tables: the schema, the kind, and "has a live user_id column".
const CATALOG_WORDS = new Set([
  'n', 'nspname', 'c', 'relkind', 'exists', 'select', 'from', 'pg_attribute', 'a', 'attrelid', 'oid', 'attname',
  'attisdropped', 'and', 'not', 'where',
]);

// Everything the maintenance check must be, as a list of what is wrong (empty = right).
function maintenanceProblems(text) {
  const problems = [];
  const code = stripComments(text);
  const statements = splitStatements(text);
  const doBlocks = statements.filter((s) => /^do \$\$/i.test(s));
  if (doBlocks.length !== 1) problems.push(`expected exactly one do block, found ${doBlocks.length}`);
  const block = doBlocks[0] ?? '';

  // The trigger is made from the catalog: a loop over pg_class whose WHERE names the schema, the kind and a live user_id
  // column, and nothing about the table's own name.
  const loop = /for r in (select .+?) loop/i.exec(block)?.[1] ?? '';
  const where = /\swhere\s(.+?)(?:\sorder by\s|$)/i.exec(loop)?.[1] ?? '';
  if (!/from pg_class c join pg_namespace n on n\.oid = c\.relnamespace/i.test(loop)) problems.push('the loop does not read pg_class joined to pg_namespace');
  if (!/n\.nspname = 'public'/i.test(where)) problems.push("the loop does not filter on n.nspname = 'public'");
  if (!/c\.relkind = 'r'/i.test(where)) problems.push("the loop does not filter on c.relkind = 'r'");
  if (!/exists \(select 1 from pg_attribute a where a\.attrelid = c\.oid and a\.attname = 'user_id' and not a\.attisdropped\)/i.test(where)) {
    problems.push('the loop does not ask the catalog for a live user_id column');
  }
  const words = noStrings(where).toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [];
  const foreign = [...new Set(words.filter((w) => !CATALOG_WORDS.has(w)))];
  if (foreign.length > 0) problems.push(`the loop's WHERE uses more than the catalog's schema, kind and user_id: ${foreign.join(', ')}`);

  // Dropped first, then created: statement level, all three events, through the one trigger function.
  if (!/execute format\('drop trigger if exists v2_maintenance_check on public\.%I', r\.relname\)/i.test(block)) problems.push('the loop does not drop v2_maintenance_check first');
  const create = /execute format\('create trigger v2_maintenance_check before insert or update or delete on public\.%I for each statement execute function v2_refuse_during_maintenance\(\)', r\.relname\)/i;
  if (!create.test(block)) problems.push('the loop does not create v2_maintenance_check as a statement-level before insert or update or delete trigger on the one function');

  // One trigger function, one check, one place that reads the status row.
  const fns = functionsOf(code);
  const triggerFns = [...fns].filter(([, f]) => /returns trigger/i.test(f.header)).map(([name]) => name);
  if (triggerFns.length !== 1 || triggerFns[0] !== 'v2_refuse_during_maintenance') problems.push(`expected one trigger function, v2_refuse_during_maintenance; found ${triggerFns.join(', ') || 'none'}`);
  const uses = code.match(/v2_refuse_during_maintenance/g)?.length ?? 0;
  if (uses !== 2) problems.push(`v2_refuse_during_maintenance should be named twice (its definition, the loop's trigger); found ${uses}`);
  if (fns.get('v2_refuse_during_maintenance')?.body !== 'begin perform v2_assert_not_in_maintenance(); return null; end;') problems.push('the trigger function is not just "perform v2_assert_not_in_maintenance(); return null"');
  const assertBody = fns.get('v2_assert_not_in_maintenance')?.body ?? '';
  const roleGate = assertBody.indexOf("if v2_request_role() is distinct from 'authenticated' then return; end if;");
  const statusRead = assertBody.indexOf('from v2_app_status');
  if (roleGate < 0 || statusRead < 0 || roleGate > statusRead) problems.push('the check does not return for any role but authenticated before it reads the status row');
  if ((code.match(/errcode\s*=\s*'OL001'/gi) ?? []).length !== 1 || !/errcode = 'OL001'/i.test(assertBody)) problems.push('OL001 is not raised exactly once, in v2_assert_not_in_maintenance');
  const readers = [...fns].filter(([, f]) => /from v2_app_status/i.test(f.body)).map(([name]) => name);
  if (readers.join() !== 'v2_assert_not_in_maintenance') problems.push(`the status row is read by ${readers.join(', ') || 'no function'}, not by the one check alone`);

  // The two new writers check at their top; the read-only count does not; nothing the app already calls is redefined.
  const firstStatement = (body) => oneLine(/\bbegin\b([^;]*);/.exec(body ?? '')?.[1] ?? '');
  for (const name of ['v2_delete_saved_program', 'v2_delete_finished_run']) {
    if (firstStatement(fns.get(name)?.body) !== 'perform v2_assert_not_in_maintenance()') problems.push(`${name} does not begin with perform v2_assert_not_in_maintenance()`);
  }
  if (/v2_assert_not_in_maintenance/.test(fns.get('v2_finished_run_counts')?.body ?? '')) problems.push('the read-only count asks the maintenance check (a read passes during maintenance)');
  const existing = ['v2_apply_ops', 'v2_plan_week', 'v2_start_run', 'v2_copy_program', 'reassign_exercise_history', 'v2_make_week_default'];
  const redefined = existing.filter((name) => fns.has(name));
  if (redefined.length > 0) problems.push(`redefines functions the app already calls: ${redefined.join(', ')} (DECISIONS 253)`);
  return problems;
}

// ── The migration, as it is ──────────────────────────────────────────────────────────────────────────────────────────
test('the maintenance check is built as DECISIONS 253 and SPEC [10] say: from the catalog, one trigger function, one check', () => {
  assert.deepEqual(maintenanceProblems(sql), []);
});

// Controls: the same check on copies of the migration with one property broken. Each must report that property.
const mutate = (from, to) => {
  assert.equal(sql.split(from).length - 1, 1, `the control's anchor must be in the migration exactly once: ${from.slice(0, 60)}`);
  return sql.replace(from, () => to);
};
const CATALOG_FILTER = "and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped)";
const CONTROLS = {
  'a table-name prefix instead of the catalog': () => [mutate(CATALOG_FILTER, "and c.relname like 'v2\\_%'"), /uses more than the catalog|does not ask the catalog/],
  'a hard-coded table list': () => [mutate(CATALOG_FILTER, "and c.relname in ('v2_programs', 'v2_sessions', 'v2_set_logs')"), /uses more than the catalog|does not ask the catalog/],
  'the catalog filter beside a name exclusion': () => [mutate(CATALOG_FILTER, `${CATALOG_FILTER} and c.relname <> 'exercises'`), /uses more than the catalog/],
  'dropped columns counted': () => [mutate(' and not a.attisdropped', ''), /does not ask the catalog/],
  'every schema': () => [mutate("n.nspname = 'public' and ", ''), /nspname/],
  'views and partitioned tables too': () => [mutate("c.relkind = 'r'", "c.relkind in ('r', 'v')"), /relkind|uses more than/],
  'a row-level trigger': () => [mutate('for each statement', 'for each row'), /statement-level/],
  'an insert-only trigger': () => [mutate('before insert or update or delete', 'before insert'), /statement-level/],
  'a second trigger function': () => [`${sql}\ncreate or replace function v2_refuse_during_maintenance_two() returns trigger language plpgsql as $$ begin return null; end; $$;`, /one trigger function/],
  'the trigger created under another name': () => [mutate("execute format('create trigger v2_maintenance_check", "execute format('create trigger v2_maintenance_check_other"), /does not create v2_maintenance_check/],
  'the role gate removed': () => [mutate("if v2_request_role() is distinct from 'authenticated' then return; end if;", ''), /does not return for any role/],
  'a second place that raises OL001': () => [mutate('perform v2_assert_not_in_maintenance();\n  select * into v_program', "perform v2_assert_not_in_maintenance();\n  if false then raise exception 'x' using errcode = 'OL001'; end if;\n  select * into v_program"), /OL001 is not raised exactly once/],
  'the saved-program delete without its check': () => [mutate('begin\n  perform v2_assert_not_in_maintenance();\n  select * into v_program', 'begin\n  select * into v_program'), /v2_delete_saved_program does not begin/],
  'the full delete without its check': () => [mutate('begin\n  perform v2_assert_not_in_maintenance();\n  select * into v_run', 'begin\n  select * into v_run'), /v2_delete_finished_run does not begin/],
  'an existing function redefined': () => [`${sql}\ncreate or replace function v2_apply_ops(p_ops jsonb) returns integer language sql as $$ select 0 $$;`, /redefines functions the app already calls: v2_apply_ops/],
};
for (const [label, build] of Object.entries(CONTROLS)) {
  test(`control: ${label} is reported`, () => {
    const [text, expected] = build();
    const problems = maintenanceProblems(text);
    assert.ok(problems.some((p) => expected.test(p)), `expected a problem matching ${expected}, got: ${JSON.stringify(problems)}`);
  });
}

// ── Which tables the loop reaches ────────────────────────────────────────────────────────────────────────────────────
// The tables each migration creates, and whether each carries a user_id column (a column of the create, or an added one).
function bodyAt(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '(') depth += 1;
    else if (code[i] === ')' && --depth === 0) return code.slice(open + 1, i);
  }
  return '';
}
function topLevelItems(body) {
  const items = [];
  let depth = 0, cur = '', quote = null;
  for (const ch of body) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { items.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}
function tablesOf(files) {
  const tables = new Map(); // name -> { userId, file }
  const views = new Set();
  for (const { name: file, text } of files) {
    const code = stripComments(text);
    for (const m of code.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)\s*\(/gi)) {
      const items = topLevelItems(bodyAt(code, m.index + m[0].length - 1));
      tables.set(m[1], { userId: items.some((it) => /^user_id\b/i.test(it)), file });
    }
    for (const m of code.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?([a-z0-9_]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?user_id\b/gi)) {
      tables.set(m[1], { userId: true, file: tables.get(m[1])?.file ?? file });
    }
    for (const m of code.matchAll(/\bcreate\s+(?:or\s+replace\s+)?view\s+(?:public\.)?([a-z0-9_]+)/gi)) views.add(m[1]);
    for (const m of code.matchAll(/\bdrop\s+table\s+(?:if\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)) tables.delete(m[1]);
  }
  return { tables, views };
}
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()
  .map((name) => ({ name, text: readFileSync(join(migrationsDir, name), 'utf8') }));
const { tables, views } = tablesOf(migrationFiles);

// verify-rls.mjs's TABLES, read as text the way verify-rls-ahead.test.mjs reads it (it is not exported).
const listedTables = [...(verifyRls.match(/const TABLES = \[([\s\S]*?)\];/)?.[1] ?? '').matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
const READ_ONLY_LIBRARIES = new Set(['v2_exercise_libraries', 'v2_exercise_library_items']);

test('the scan finds the 40 tables with a user_id column that SPEC counts at 1.2\'s schema, exercises included', () => {
  const withUserId = [...tables].filter(([, t]) => t.userId).map(([name]) => name);
  assert.equal(withUserId.length, 40);
  assert.ok(withUserId.includes('exercises'));
  assert.deepEqual([...tables].filter(([, t]) => !t.userId).map(([name]) => name).sort(), ['v2_app_status', 'v2_exercise_libraries', 'v2_exercise_library_items']);
  assert.deepEqual([...views].sort(), ['v2_exercise_set_history', 'v2_history_session_summary', 'v2_session_type_history']);
});

test('every table verify-rls lists, but the two read-only libraries and the views, carries a user_id column, so the loop covers it', () => {
  assert.ok(listedTables.length > 30, 'could not read TABLES');
  const uncovered = listedTables.filter((name) => !READ_ONLY_LIBRARIES.has(name) && !views.has(name) && !tables.get(name)?.userId);
  assert.deepEqual(uncovered, [], `listed by verify-rls, not a library or a view, and no user_id column: ${uncovered.join(', ')}`);
});

test('the one table without a user_id that the check reads, v2_app_status, is not covered and is probed ahead of the app', () => {
  assert.equal(tables.get('v2_app_status')?.userId, false);
  assert.equal(tables.get('v2_app_status')?.file, FILE);
  assert.deepEqual(TABLES_AHEAD_OF_THE_APP, ['v2_app_status']);
  // verify-rls reads a public-by-design table by the any-row rule, and a table without user_id cannot be classified by ownership.
  for (const name of ['PUBLIC_BY_DESIGN', 'NO_USER_ID_COLUMN']) {
    const set = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(verifyRls)?.[1] ?? '';
    assert.match(set, /'v2_app_status'/, `${name} in verify-rls.mjs lacks v2_app_status: the signed-in probe would FAIL on a missing user_id column and the anon probe would call its one row a LEAK`);
  }
});

// The loop runs once, when 048 is applied: a table a later migration creates is not reached by it. So a later migration
// that makes a table gain a user_id column (a create, or an added column on a table that had none) creates the trigger
// itself, and this fails until it does.
function laterTablesWithoutTheTrigger(files, after = 48) {
  const missing = [];
  files.forEach(({ name, text }, i) => {
    if (Number(name.slice(0, 3)) <= after) return;
    const before = tablesOf(files.slice(0, i)).tables;
    const now = tablesOf(files.slice(0, i + 1)).tables;
    const covered = /v2_maintenance_check/.test(stripComments(text));
    for (const [table, t] of now) if (t.userId && !before.get(table)?.userId && !covered) missing.push(`${name}: ${table}`);
  });
  return missing;
}
test('a table that gains a user_id column in a migration after 048 gets the trigger from that migration', () => {
  assert.deepEqual(laterTablesWithoutTheTrigger(migrationFiles), []);
  // the controls: a later migration that makes such a table and says nothing about the trigger is reported, one that names it is not
  const withLater = (text) => [...migrationFiles, { name: '049_next.sql', text }];
  const made = 'create table v2_next (id uuid primary key, user_id uuid not null references auth.users(id));';
  assert.deepEqual(laterTablesWithoutTheTrigger(withLater(made)), ['049_next.sql: v2_next']);
  assert.deepEqual(laterTablesWithoutTheTrigger(withLater(`${made}\ncreate trigger v2_maintenance_check before insert or update or delete on v2_next for each statement execute function v2_refuse_during_maintenance();`)), []);
  assert.deepEqual(laterTablesWithoutTheTrigger(withLater('create table v2_next (id uuid primary key, name text);')), [], 'a table with no user_id is not one the check reaches');
  assert.deepEqual(laterTablesWithoutTheTrigger(withLater('alter table v2_programs add column if not exists user_id uuid;')), [], 'a column a covered table already has is no new table');
  assert.deepEqual(laterTablesWithoutTheTrigger(withLater('alter table v2_exercise_libraries add column user_id uuid;')), ['049_next.sql: v2_exercise_libraries'], 'a table that gains the column is reached by no loop');
});

// ── v2_app_status: one row, read by anyone, written by nobody through the API ────────────────────────────────────────
test('v2_app_status holds one row, is read by anyone and has no write path; the seeded row names no user', () => {
  const code = stripComments(sql);
  const create = /create table if not exists v2_app_status \(([\s\S]*?)\);/i.exec(code)?.[1] ?? '';
  const columns = Object.fromEntries(topLevelItems(create).map((it) => [it.split(/\s+/)[0], oneLine(it)]));
  assert.deepEqual(Object.keys(columns), ['id', 'maintenance', 'min_version', 'exempt_user_ids', 'updated_at']);
  assert.match(columns.id, /^id boolean primary key default true check \(id\)$/, 'a boolean key that can only be true: one row');
  assert.match(columns.exempt_user_ids, /^exempt_user_ids uuid\[\] not null default '\{\}'$/);
  assert.match(columns.maintenance, /not null default false$/, 'off until Adam turns it on');
  const statements = splitStatements(sql).filter((s) => /\bv2_app_status\b/.test(s) && !/^create (or replace )?function|^do /i.test(s));
  const policies = statements.filter((s) => /^create policy/i.test(s));
  assert.equal(policies.length, 1, 'one policy');
  assert.match(policies[0], /^create policy "Anyone reads the app status" on v2_app_status for select using \(true\)$/);
  assert.ok(statements.includes('alter table v2_app_status enable row level security'));
  // The revokes matter (the platform's default privileges grant every API role ALL, under which a write with no policy is a silent zero-row no-op).
  assert.ok(statements.includes('revoke all on v2_app_status from public, anon, authenticated, service_role'));
  const grants = statements.filter((s) => /^grant /i.test(s));
  assert.deepEqual(grants, ['grant select on v2_app_status to anon, authenticated, service_role'], 'select and nothing else is granted');
  const inserts = statements.filter((s) => /^insert into/i.test(s));
  assert.deepEqual(inserts, ["insert into v2_app_status (id, maintenance, min_version) values (true, false, '1.2.1') on conflict (id) do nothing"], 'the seeded row: no exempt ids, and a second run does not reset it');
});

// ── The file changes no existing row ─────────────────────────────────────────────────────────────────────────────────
// The builder's grep, as a test: with comments, $$ bodies and string literals blanked, what is left outside the functions.
function outsideTheBodies(text) {
  const code = noStrings(stripComments(text).replace(/\$\$[\s\S]*?\$\$/g, () => ' $$ $$ '));
  return code.split(';').map(oneLine).filter(Boolean);
}
test('outside the function bodies the file only creates, grants, adds one nullable column and inserts the status row', () => {
  const statements = outsideTheBodies(sql);
  const kinds = (re) => statements.filter((s) => re.test(s));
  assert.deepEqual(kinds(/^(update|delete|truncate)\b/i), [], 'no update, delete or truncate outside a function body');
  assert.deepEqual(kinds(/^insert\b/i), ["insert into v2_app_status (id, maintenance, min_version) values (true, false, '') on conflict (id) do nothing"]);
  assert.deepEqual(kinds(/^drop\b/i), ['drop policy if exists "Anyone reads the app status" on v2_app_status'], 'the only drop is the new table\'s own policy, so a second run can make it again');
  assert.deepEqual(kinds(/^alter\b/i), [
    'alter table v2_app_status enable row level security',
    'alter table v2_programs add column if not exists deleted_at timestamptz',
  ], 'no alter column, type, rename or drop column; the one added column is nullable, with no default');
  assert.deepEqual(kinds(/\b(alter column|set data type|rename|cascade)\b/i), []);
  // the control: an update, a delete or a column with a default outside a body is reported
  assert.ok(outsideTheBodies(`${sql}\nupdate v2_programs set name = name where true;`).some((s) => /^update/i.test(s)));
  assert.ok(outsideTheBodies(`${sql}\ndelete from v2_sessions where true;`).some((s) => /^delete/i.test(s)));
  assert.ok(outsideTheBodies(sql.replace('add column if not exists deleted_at timestamptz', "add column if not exists deleted_at timestamptz default now()")).some((s) => /default now/.test(s)));
});
