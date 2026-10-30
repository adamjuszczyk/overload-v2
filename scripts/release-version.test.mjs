// release-version.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// One version, in every place that states it (TASKS.md, Facts to verify 5; Overload 1.2.1). Chunk 70 starts the file
// with the place the database holds: migration 048 seeds the one v2_app_status row with `min_version` '1.2.1', the oldest
// app version allowed to run (SPEC Rules 4: every release raises it). Chunk 71 adds the others: package.json's version,
// __APP_VERSION__, and the newest release-notes entry, all equal to this one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(join(root, 'supabase', 'migrations', '048_p121_release_state_and_deletes.sql'), 'utf8');

// The status row 048 seeds: `insert into v2_app_status (id, maintenance, min_version) values (true, false, '<version>')`.
function seededMinVersion(sql) {
  const code = sql.replace(/--[^\n]*/g, '');
  const insert = /insert\s+into\s+v2_app_status\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i.exec(code);
  if (!insert) return undefined;
  const columns = insert[1].split(',').map((c) => c.trim());
  const values = insert[2].split(',').map((v) => v.trim());
  const at = columns.indexOf('min_version');
  return at < 0 ? undefined : /^'([^']*)'$/.exec(values[at])?.[1];
}

test('the seeded min_version is 1.2.1', () => {
  assert.equal(seededMinVersion(migration), '1.2.1');
});

test('control: the reader sees another version, and a missing column or insert, as not 1.2.1', () => {
  assert.equal(seededMinVersion(migration.replace("false, '1.2.1')", "false, '1.2.0')")), '1.2.0');
  assert.equal(seededMinVersion(migration.replace('(id, maintenance, min_version)', '(id, maintenance, updated_at)')), undefined);
  assert.equal(seededMinVersion('-- no insert here'), undefined);
});
