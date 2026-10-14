// seed-accounts.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// supabase/seed.sql refuses to run on a database holding any account other than
// the staging accounts, so the list that guard allows is a safety property: it
// must stay the five synthetic example.com addresses the seed itself creates
// (TASKS-1.2 chunk 36 widened it from two to five). staging-config.test.mjs
// (the staging guards, not edited by this chunk) pins that the guard exists;
// this pins what it allows and that the seed, its clean-up and the smoke script
// agree on the five. Text checks only: the end-to-end proof is the seed replayed
// on a local stack with scripts/staging-smoke.mjs run against it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = readFileSync(join(root, 'supabase/seed.sql'), 'utf8');
const smoke = readFileSync(join(root, 'scripts/staging-smoke.mjs'), 'utf8');

const FIVE = {
  c_email: ['staging-test@example.com', '7e57ac00-0000-4000-8000-000000000001'],
  c_other_email: ['staging-other@example.com', '7e57ac00-0000-4000-8000-000000000002'],
  c_stable_email: ['staging-stable@example.com', '7e57ac00-0000-4000-8000-000000000003'],
  c_seq_email: ['staging-sequence@example.com', '7e57ac00-0000-4000-8000-000000000004'],
  c_empty_email: ['staging-empty@example.com', '7e57ac00-0000-4000-8000-000000000005'],
};
const ID_CONSTANT = { c_email: 'c_new_id', c_other_email: 'c_other_id', c_stable_email: 'c_stable_id', c_seq_email: 'c_seq_id', c_empty_email: 'c_empty_id' };

// `name constant text := 'value';` / `name constant uuid := 'value';`
const constant = (name) => new RegExp(`\\b${name}\\s+constant\\s+(?:text|uuid)\\s*:=\\s*'([^']+)'`).exec(seed)?.[1];

test('the seed declares exactly the five staging accounts, ids …0001 to …0005, all example.com', () => {
  for (const [name, [email, id]] of Object.entries(FIVE)) {
    assert.equal(constant(name), email, `${name}`);
    assert.equal(constant(ID_CONSTANT[name]), id, `${ID_CONSTANT[name]}`);
    assert.match(email, /^staging-[a-z]+@example\.com$/);
  }
  const declared = [...seed.matchAll(/\bc_[a-z_]*email\s+constant\s+text/g)].map((m) => m[0].split(/\s/)[0]);
  assert.deepEqual(declared.sort(), Object.keys(FIVE).sort(), 'no sixth email constant');
});

test('the guard allows exactly those five addresses and nothing else', () => {
  const guard = /email is null\s+or email not in \(([^)]*)\)/.exec(seed);
  assert.ok(guard, 'could not find the guard\'s allowed list');
  const names = guard[1].split(',').map((s) => s.trim()).filter(Boolean);
  assert.deepEqual(names.sort(), Object.keys(FIVE).sort());
  // a literal address inside the list would be a way to widen it unseen
  assert.doesNotMatch(guard[1], /@/);
});

test('the clean-up deletes all five accounts\' data and creates them in the order the password copy needs', () => {
  assert.match(seed, /using array\[t, o, u_stable, u_seq, u_empty\]/);
  // the test account (ord 1) is created before the three whose hash is copied from it (ord >= 3)
  assert.match(seed, /\(1, c_email, c_new_id\)/);
  assert.match(seed, /case when acct\.ord >= 3\s+then \(select u\.encrypted_password from auth\.users u where u\.email = c_email\)/);
});

test('the smoke script signs in to the three accounts the seed adds, by the same addresses', () => {
  for (const key of ['c_stable_email', 'c_seq_email', 'c_empty_email']) {
    assert.ok(smoke.includes(FIVE[key][0]), `staging-smoke.mjs does not name ${FIVE[key][0]}`);
  }
});
