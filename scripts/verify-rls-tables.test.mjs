// verify-rls-tables.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// verify-rls.mjs only checks the tables in its TABLES list, so a table the app
// reads that is missing from the list is silently unchecked. This test keeps the
// list and the app in step, in both directions:
//   - every table or view named in a .from('…') call in src/ or api/ is in TABLES
//   - every name in TABLES is still used by such a call
//
// It reads verify-rls.mjs as text rather than importing it: the script runs main()
// on import and needs the Supabase environment variables.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  const stale = tables.filter((t) => !used.has(t)).sort();
  assert.deepEqual(stale, [], `in TABLES but not used by any .from() in src/ or api/: ${stale.join(', ')}`);
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
