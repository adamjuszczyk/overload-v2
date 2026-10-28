// Run: node --test "scripts/*.test.mjs"
//
// Staging safety, checked on every PR: the seed and the test-data scripts can
// never reach production (CONTEXT.md, "Staging").
//   * supabase/config.toml: no [remotes.*] block names production's project
//     ref (a remote block is what turns on seed and config for a persistent
//     branch, production included); a [remotes.staging] block, once present,
//     seeds from seed.sql and turns sign-ups off without turning email
//     sign-in off.
//   * supabase/seed.sql keeps its guard.
//   * staging-guard.mjs refuses production and anything it can't recognise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertNotProduction, PRODUCTION_SUPABASE_REF } from './staging-guard.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal TOML reader for config.toml: section -> { key: raw value }.
export function sections(text) {
  const out = { '': {} };
  let current = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) { current = header[1].trim(); out[current] ??= {}; continue; }
    const kv = /^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/.exec(line);
    if (kv) out[current][kv[1]] = kv[2].trim();
  }
  return out;
}

const config = sections(readFileSync(join(root, 'supabase/config.toml'), 'utf8'));
const remotes = Object.keys(config).filter((s) => /^remotes\.[^.]+$/.test(s));

test('no [remotes.*] block names production', () => {
  for (const r of remotes) {
    const id = (config[r].project_id ?? '').replace(/"/g, '');
    assert.notEqual(id, PRODUCTION_SUPABASE_REF, `[${r}] names production's project ref`);
    assert.match(id, /^[a-z0-9]{20}$/, `[${r}] project_id must be a branch's project ref`);
  }
});

test('the root config never seeds and keeps production\'s own settings untouched', () => {
  // Root [db.seed] only drives local `supabase db reset`; Supabase ignores it
  // on production. Kept off so a local reset doesn't seed by surprise either.
  assert.equal(config['db.seed']?.enabled, 'false');
});

test('[remotes.staging], once present, seeds from seed.sql with sign-ups off', () => {
  if (!remotes.includes('remotes.staging')) return; // added when the branch exists
  assert.equal(config['remotes.staging.db.seed']?.enabled, 'true');
  assert.match(config['remotes.staging.db.seed']?.sql_paths ?? '', /"\.\/seed\.sql"/);
  assert.equal(config['remotes.staging.auth']?.enable_signup, 'false');
  // [auth.email] enable_signup is the email provider itself, not sign-ups:
  // false disables email sign-in for every account (seen 2026-10-14).
  assert.notEqual(config['remotes.staging.auth.email']?.enable_signup, 'false');
});

test('seed.sql keeps its guard', () => {
  const seed = readFileSync(join(root, 'supabase/seed.sql'), 'utf8');
  assert.match(seed, /12e79b69-9891-4f53-a7cf-650edd83659f/, 'production owner marker');
  assert.match(seed, /refuses to run: this database holds an account other than/);
  assert.match(seed, /staging-test@example\.com/);
});

test('staging-guard refuses production and unrecognised URLs', () => {
  assert.throws(() => assertNotProduction(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`), /PRODUCTION/);
  assert.throws(() => assertNotProduction(`https://${PRODUCTION_SUPABASE_REF.toUpperCase()}.supabase.co/`), /PRODUCTION/);
  assert.throws(() => assertNotProduction(''), /not a Supabase project URL/);
  assert.throws(() => assertNotProduction('http://127.0.0.1:54321'), /not a Supabase project URL/);
  assert.equal(assertNotProduction('https://abcdefghijklmnopqrst.supabase.co'), 'abcdefghijklmnopqrst');
});

test('the app and the scripts name the same production ref', () => {
  const app = readFileSync(join(root, 'src/lib/appEnv.ts'), 'utf8');
  assert.match(app, new RegExp(`PRODUCTION_SUPABASE_REF = '${PRODUCTION_SUPABASE_REF}'`));
});
