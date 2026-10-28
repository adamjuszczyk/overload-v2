// seed-version.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// Adam (2026-10-20): "add one line to the end of seed.sql that prints a seed
// version, so a wrong seed shows the moment I run it." He pastes supabase/seed.sql
// into the staging SQL editor, which shows the result of the LAST statement in
// its result grid, so the version has to be a final `select ... as seed_version;`.
// A statement appended after it would hide the version again, which is what this
// pins. It pins the line's shape and its place, not the string: whoever changes
// the seed changes the string (the comment above the line says so), and no test
// can know whether the seed changed. Text checks only; the executed proof is the
// seed run through psql on a local replay (the chunk report).
//
// Not touched here: staging-config.test.mjs and seed-accounts.test.mjs (the staging guards).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = readFileSync(join(root, 'supabase/seed.sql'), 'utf8');
const lines = seed.replace(/\s+$/, '').split('\n');
const last = lines[lines.length - 1];
const above = lines[lines.length - 2];

test('the seed ends with one line that selects its version as seed_version, under a one-line comment', () => {
  assert.match(last, /^select '[^';$]+' as seed_version;$/, 'the last line is `select \'<version>\' as seed_version;`');
  assert.match(above, /^-- \S.*$/, 'the line above it is a one-line comment (whoever changes the seed changes the version)');
});

test('nothing else in the seed is named seed_version', () => {
  assert.equal(seed.match(/\bseed_version\b/g)?.length, 1);
});

test('the version reads "overload seed <date> chunk <id>" (or "seed-fix <decision>" for a seed-only fix), a string a person can compare at a glance', () => {
  const version = /^select '([^']+)' as seed_version;$/.exec(last)?.[1] ?? '';
  const m = /^overload seed (\d{4})-(\d{2})-(\d{2}) (?:chunk|seed-fix) (\d+[a-z]?)$/.exec(version);
  assert.ok(m, `"${version}" has the shape overload seed YYYY-MM-DD chunk N (or seed-fix N)`);
  const date = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  assert.equal(date.toISOString().slice(0, 10), `${m[1]}-${m[2]}-${m[3]}`, 'a real calendar date');
});
