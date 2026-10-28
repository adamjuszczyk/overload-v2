// verify-rls-tables.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// verify-rls.mjs only checks the tables in its TABLES list, so a table the app
// reads that is missing from the list is silently unchecked. This test keeps the
// list and the app in step, in both directions:
//   - every table or view named in a .from('…') call in src/ or api/ is in TABLES
//   - every name in TABLES is still used by such a call, or by an embed or a
//     v2_apply_ops op in the app's own files (chunk 54a's review, below)
//
// It reads verify-rls.mjs as text rather than importing it: the script runs main()
// on import and needs the Supabase environment variables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIRS = ['src', 'api'];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (SOURCE_EXT.test(entry)) yield full;
  }
}

const files = SOURCE_DIRS.flatMap((d) => [...walk(join(root, d))]);

// .from('name'), .from("name") or .from(`name`) — whitespace and newlines allowed.
// Array.from / Buffer.from take strings that are not tables, so they are excluded.
const LITERAL_FROM = /(?<!Array|Buffer)\.from\(\s*(['"`])([A-Za-z0-9_]+)\1\s*\)/g;
// .from(someIdentifier) — the table name is not visible at the call site.
const DYNAMIC_FROM = /(?<!Array|Buffer)\.from\(\s*([A-Za-z_$][\w$.]*)\s*\)/g;

const used = new Map(); // table -> Set of files naming it
const dynamic = new Map(); // file -> Set of argument expressions
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(root, file);
  for (const m of text.matchAll(LITERAL_FROM)) {
    if (!used.has(m[2])) used.set(m[2], new Set());
    used.get(m[2]).add(rel);
  }
  for (const m of text.matchAll(DYNAMIC_FROM)) {
    if (!dynamic.has(rel)) dynamic.set(rel, new Set());
    dynamic.get(rel).add(m[1]);
  }
}

// The other ways the app still uses a table, which keep its name in TABLES (chunk 54a's review). Chunk 54a removed the last
// .from('v2_week_plan_exercises'), while weekPlanService.ts and changeProgramService.ts still read it by embed and
// programChange.ts still writes it through v2_apply_ops. RLS applies to both (an embed is read as the caller, and
// v2_apply_ops is security invoker), so the name keeps its probe. Read from each app file's syntax tree, so a comment never
// counts; a test or a test utility never counts either (a stand-in that names a table is not a use).
//   - embed: a string holding `name(` or `name!hint(`, the name at its start or after a space, a comma, a colon (an alias)
//     or an opening parenthesis (PostgREST's resource embedding in a select);
//   - op: x.insert('name', …), x.update('name', …) or x.remove('name', …) (programChange.ts's op list), or an object literal
//     that has an `op` and a string `table` (copySheetLogic.ts's).
const EMBED = /(?:^|[\s,(:])([A-Za-z0-9_]+)\s*(?:!\s*[A-Za-z0-9_]+\s*)?\(/g;
const OP_METHODS = new Set(['insert', 'update', 'remove']);
const isAppFile = (rel) => !/\.(test|testutil)\.|(^|[\\/])testing[\\/]/.test(rel);

function otherUsesIn(fileName, text) {
  const found = [];
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false);
  const property = (obj, name) =>
    obj.properties.find((p) => ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
  const visit = (node) => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      for (const m of node.text.matchAll(EMBED)) found.push({ table: m[1], how: 'embed' });
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      OP_METHODS.has(node.expression.name.text) &&
      node.arguments.length > 0 &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      found.push({ table: node.arguments[0].text, how: 'op' });
    }
    if (ts.isObjectLiteralExpression(node)) {
      const table = property(node, 'table');
      if (property(node, 'op') && table && ts.isStringLiteralLike(table.initializer)) found.push({ table: table.initializer.text, how: 'op' });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

const otherUse = new Map(); // table -> Set of 'file (embed|op)', app files only
for (const file of files) {
  const rel = relative(root, file);
  if (!isAppFile(rel)) continue;
  for (const { table, how } of otherUsesIn(file, readFileSync(file, 'utf8'))) {
    if (!otherUse.has(table)) otherUse.set(table, new Set());
    otherUse.get(table).add(`${rel} (${how})`);
  }
}

function readTables() {
  const text = readFileSync(join(root, 'scripts', 'verify-rls.mjs'), 'utf8');
  const block = text.match(/const TABLES = \[([\s\S]*?)\];/);
  assert.ok(block, 'could not find the TABLES array in scripts/verify-rls.mjs');
  const names = [...block[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
  assert.ok(names.length > 0, 'TABLES in scripts/verify-rls.mjs is empty');
  return names;
}

const tables = readTables();

test('the scan finds the app\'s .from() calls', () => {
  // Guards against the test passing because the scan matched nothing.
  assert.ok(files.length > 50, `only ${files.length} source files scanned`);
  assert.ok(used.size >= 20, `only ${used.size} distinct tables found`);
  assert.ok(used.has('v2_sessions'));
});

test('TABLES has no duplicate names', () => {
  const dupes = tables.filter((t, i) => tables.indexOf(t) !== i);
  assert.deepEqual(dupes, []);
});

test('every table or view used by the app is in verify-rls.mjs TABLES', () => {
  const missing = [...used.keys()].filter((t) => !tables.includes(t)).sort();
  assert.deepEqual(
    missing,
    [],
    `used in .from() but not probed — add to TABLES in scripts/verify-rls.mjs: ${missing
      .map((t) => `${t} (${[...used.get(t)].join(', ')})`)
      .join('; ')}`,
  );
});

test('verify-rls.mjs TABLES names no table the app has stopped using', () => {
  const stale = tables.filter((t) => !used.has(t) && !otherUse.has(t)).sort();
  assert.deepEqual(stale, [], `in TABLES but not used by any .from(), embed or v2_apply_ops op in src/ or api/: ${stale.join(', ')}`);
});

test('the embed and op scan finds the app\'s embeds and ops', () => {
  // Guards against the stale check above passing because this scan matched everything or nothing.
  const by = (how) => [...otherUse.entries()].filter(([, where]) => [...where].some((w) => w.endsWith(`(${how})`))).map(([t]) => t);
  assert.ok(by('embed').length >= 5, `only ${by('embed').length} embedded tables found`);
  assert.ok(by('embed').includes('v2_week_plan_sets'));
  assert.ok(by('op').includes('v2_week_plan_sets'));
  const fromOnly = tables.filter((t) => !otherUse.has(t));
  assert.ok(fromOnly.length >= 10, `only ${fromOnly.length} of TABLES have no embed or op: something reads too much as one`);
});

test('what counts as an embed or an op, and what never does', () => {
  const uses = (text, name = 'x.ts') => otherUsesIn(name, text).map(({ table, how }) => `${how}:${table}`).sort();
  assert.deepEqual(uses(`supabase.from('a').select('*, b(*), alias:c!c_fk(id, d(*))')`), ['embed:b', 'embed:c', 'embed:d']);
  assert.deepEqual(uses('const s = `id, e(*)`'), ['embed:e']);
  assert.deepEqual(uses(`out.update('f', id, { position: 1 }); out.insert('g', row); out.remove('h', id)`), ['op:f', 'op:g', 'op:h']);
  assert.deepEqual(uses(`const op = { op: 'update', table: 'i', id, patch }`), ['op:i']);
  // Never a use: a comment, a queue item with no op, a builder call given an object, a plain word in a string.
  assert.deepEqual(uses(`// j(…) and k!fk( in a comment\n/* l(*) */`), []);
  assert.deepEqual(uses(`queue.push({ table: 'm', payload })`), []);
  assert.deepEqual(uses(`supabase.from('a').update({ n: 1 }).eq('id', id)`), []);
  assert.deepEqual(uses(`toast('Saved the o set')`), []);
  // A test or a test utility is never an app file.
  assert.deepEqual(['src/a.test.ts', 'src/b.testutil.ts', 'src/testing/c.ts', 'src/features/d.ts'].map(isAppFile), [false, false, false, true]);
});

// A dynamic .from(variable) hides its table name from the scan above. The two that
// exist today only receive names that have literal .from() calls elsewhere (typed as
// a union / queue table); a new one needs a human to check what it can be given.
test('dynamic .from(variable) calls are only the two known ones', () => {
  const found = [...dynamic.entries()]
    .flatMap(([file, args]) => [...args].map((a) => `${file}: .from(${a})`))
    .sort();
  assert.deepEqual(found, [
    'src/features/library/reassignService.ts: .from(table)',
    'src/features/offline/useSyncQueue.ts: .from(item.table)',
  ]);
});
