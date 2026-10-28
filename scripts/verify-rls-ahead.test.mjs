// verify-rls-ahead.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// verify-rls.mjs probes TABLES (every table the app reads or writes; kept in
// step with the app by verify-rls-tables.test.mjs) and TABLES_AHEAD_OF_THE_APP
// (tables a migration created before any app code uses them: migration 042's
// three, TASKS-1.2 chunk 36). This test keeps the second list honest:
//   - every table migration 042 creates is probed, in one list or the other
//     (a new table that nobody lists is not RLS-checked at all)
//   - every name in the ahead list is created by some migration (a typo or a
//     dropped table would make verify-rls FAIL on staging instead of probing)
//   - no name is in both lists, no duplicates (a table moves to TABLES when
//     the app first calls `.from()` on it; verify-rls-tables.test.mjs fails
//     until it does, and this test fails until the ahead entry is deleted)
//
// verify-rls.mjs is imported for the exported ahead list (safe: main() only
// runs when the file is executed directly); TABLES is read as text, the way
// verify-rls-tables.test.mjs reads it, because it is not exported.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TABLES_AHEAD_OF_THE_APP } from './verify-rls.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readTables() {
  const text = readFileSync(join(root, 'scripts', 'verify-rls.mjs'), 'utf8');
  const block = text.match(/const TABLES = \[([\s\S]*?)\];/);
  assert.ok(block, 'could not find the TABLES array in scripts/verify-rls.mjs');
  return [...block[1].matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]);
}

// Names after `create table` (comments dropped first, so a comment that
// mentions one doesn't count).
function createdTables(sql) {
  const code = sql.replace(/--[^\n]*/g, '');
  return [...code.matchAll(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z0-9_]+)/gi)].map((m) => m[1]);
}

const migrationsDir = join(root, 'supabase', 'migrations');
const migrationFiles = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql'));
const created042 = createdTables(readFileSync(join(migrationsDir, '042_p12_schema.sql'), 'utf8'));
const createdAnywhere = new Set(migrationFiles.flatMap((f) => createdTables(readFileSync(join(migrationsDir, f), 'utf8'))));
const tables = readTables();

test('the scan finds migration 042\'s three tables', () => {
  assert.deepEqual([...created042].sort(), ['v2_run_schedules', 'v2_session_set_changes', 'v2_week_review_decisions']);
});

test('every table migration 042 creates is probed by verify-rls (TABLES or the ahead list)', () => {
  const unprobed = created042.filter((t) => !tables.includes(t) && !TABLES_AHEAD_OF_THE_APP.includes(t));
  assert.deepEqual(unprobed, [], `created by 042 but not probed: ${unprobed.join(', ')}`);
});

test('every name in the ahead list is created by a migration', () => {
  const unknown = TABLES_AHEAD_OF_THE_APP.filter((t) => !createdAnywhere.has(t));
  assert.deepEqual(unknown, [], `in TABLES_AHEAD_OF_THE_APP but no migration creates it: ${unknown.join(', ')}`);
});

test('no name is in both TABLES and the ahead list, and neither list repeats a name', () => {
  const both = TABLES_AHEAD_OF_THE_APP.filter((t) => tables.includes(t));
  assert.deepEqual(both, [], `in both lists (delete it from TABLES_AHEAD_OF_THE_APP): ${both.join(', ')}`);
  const dupes = TABLES_AHEAD_OF_THE_APP.filter((t, i) => TABLES_AHEAD_OF_THE_APP.indexOf(t) !== i);
  assert.deepEqual(dupes, []);
});
