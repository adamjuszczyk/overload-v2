// staging-smoke.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// The empty account's checks in staging-smoke.mjs (DECISIONS 125, Adam: "'Empty' means no programs, runs or
// sessions; the smoke asserts exactly that, and that the account's exercises are the defaults"; and on 2026-10-19,
// after the re-seed: "The smoke accepts either no exercises or exactly the defaults"), run against a stand-in for
// the signed-in account that answers the smoke's own PostgREST paths. The live proof is the smoke on staging itself
// (every check PASS), and its control there: a throwaway exercise that isn't a default, added to the empty account,
// fails exactly the exercises check (chunk 44's review, with the defaults; chunk 51b's second review, alone).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPTY_OWNS_NONE, emptyAccountChecks, judgeDefaultExercises, judgeEmptyAccountExercises, loadDefaultExercises } from './staging-smoke.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const smoke = readFileSync(join(root, 'scripts/staging-smoke.mjs'), 'utf8');

// The app's list read straight off its source text, not through the smoke's loader, so a loader that drops,
// changes or reorders an entry can't agree with it by construction.
const source = readFileSync(join(root, 'src/features/library/defaultExercises.ts'), 'utf8');
const fromSource = [...source.matchAll(/\{\s*name:\s*'([^']+)',\s*muscleGroup:\s*'([a-z]+)'\s*\}/g)].map((m) => ({ name: m[1], muscleGroup: m[2] }));

const defaults = await loadDefaultExercises();
const asRow = (d) => ({ name: d.name, muscle_group: d.muscleGroup });
const EXERCISES_CHECK = "seed: empty: no exercises, or exactly the app's defaults";
const NONE_YET = `0 exercises: none yet (the app creates its ${defaults.length} defaults at the account's first app sign-in)`;

// The empty account as the smoke reads it: a count per table, the exercises as rows.
function account({ exercises = defaults.map(asRow), programs = 0, runs = 0, sessions = 0, readsFail = false } = {}) {
  const counts = { v2_programs: programs, v2_mesocycles: runs, v2_sessions: sessions, exercises: exercises.length };
  return {
    count: async (path) => (readsFail ? null : counts[path.split('?')[0]] ?? null),
    rows: async (path) => (readsFail || !path.startsWith('exercises?') ? null : exercises.map((e) => ({ ...e }))),
  };
}
// The checks that fail, with their detail.
const failing = async (who, list = defaults) =>
  (await emptyAccountChecks(who, list)).filter(([, ok]) => !ok).map(([name, , detail]) => `${name} — ${detail}`);

test('the smoke loads the app\'s own DEFAULT_EXERCISES: every entry of src/features/library/defaultExercises.ts, in order', () => {
  assert.ok(fromSource.length > 0, 'no entry read off the source');
  assert.deepEqual(defaults, fromSource);
});

test('the list is never typed into the smoke: it names no default beyond the two its test-account checks look up', () => {
  const named = fromSource.filter((d) => smoke.includes(`'${d.name}'`)).map((d) => d.name).sort();
  assert.deepEqual(named, ['Barbell Bench Press', 'Seated Cable Row']);
  assert.doesNotMatch(smoke, /muscleGroup:\s*'/);
  assert.match(smoke, /ssrLoadModule\(DEFAULTS_MODULE\)/);
  assert.match(smoke, /DEFAULTS_MODULE = '\/src\/features\/library\/defaultExercises\.ts'/);
});

test('Adam\'s three counts: programs, runs and sessions, nothing else', () => {
  assert.deepEqual(EMPTY_OWNS_NONE.map(([, path]) => path.split('?')[0]), ['v2_programs', 'v2_mesocycles', 'v2_sessions']);
});

test('the empty account as the app leaves it passes: no programs, runs or sessions, and every default once', async () => {
  const results = await emptyAccountChecks(account(), defaults);
  assert.deepEqual(results, [
    ['seed: empty: owns no programs (v2_programs)', true, '0'],
    ['seed: empty: owns no runs (v2_mesocycles)', true, '0'],
    ['seed: empty: owns no sessions (v2_sessions)', true, '0'],
    [EXERCISES_CHECK, true, `${defaults.length} exercises, ${defaults.length} defaults: 0 default(s) missing, 0 not a default or a second copy of one`],
  ]);
});

test('the empty account as the re-seed leaves it passes too: no programs, runs or sessions, and no exercises yet (Adam, 2026-10-19)', async () => {
  const results = await emptyAccountChecks(account({ exercises: [] }), defaults);
  assert.deepEqual(results, [
    ['seed: empty: owns no programs (v2_programs)', true, '0'],
    ['seed: empty: owns no runs (v2_mesocycles)', true, '0'],
    ['seed: empty: owns no sessions (v2_sessions)', true, '0'],
    [EXERCISES_CHECK, true, NONE_YET],
  ]);
});

test('control: an exercise that is not a default fails the exercises check, and nothing else', async () => {
  const exercises = [...defaults.map(asRow), { name: 'ZZ_TEST throwaway', muscle_group: 'other' }];
  assert.deepEqual(await failing(account({ exercises })), [
    `${EXERCISES_CHECK} — ${defaults.length + 1} exercises, ${defaults.length} defaults: 0 default(s) missing, 1 not a default or a second copy of one`,
  ]);
});

test('control: a program on the empty account fails, and nothing else', async () => {
  assert.deepEqual(await failing(account({ programs: 1 })), ['seed: empty: owns no programs (v2_programs) — 1']);
});

test('a run or a session on the empty account fails', async () => {
  assert.deepEqual(await failing(account({ runs: 1 })), ['seed: empty: owns no runs (v2_mesocycles) — 1']);
  assert.deepEqual(await failing(account({ sessions: 2 })), ['seed: empty: owns no sessions (v2_sessions) — 2']);
});

test('a default missing, a default twice, a default renamed or in another group, one default alone, or one exercise alone that is not a default fails', async () => {
  const rows = defaults.map(asRow);
  const cases = {
    missing: rows.slice(1),
    twice: [...rows, rows[0]],
    renamed: [{ ...rows[0], name: `${rows[0].name} (mine)` }, ...rows.slice(1)],
    'another group': [{ ...rows[0], muscle_group: rows[0].muscle_group === 'chest' ? 'back' : 'chest' }, ...rows.slice(1)],
    'one default alone': rows.slice(0, 1),
    'one exercise alone that is not a default': [{ name: 'ZZ_TEST throwaway', muscle_group: 'other' }],
  };
  for (const [label, exercises] of Object.entries(cases)) {
    const failed = await failing(account({ exercises }));
    assert.equal(failed.length, 1, label);
    assert.ok(failed[0].startsWith(`${EXERCISES_CHECK} — `), `${label}: ${failed[0]}`);
  }
});

test('the judge counts what is missing and what is extra', () => {
  const rows = defaults.map(asRow);
  assert.deepEqual(judgeDefaultExercises([...rows.slice(2), rows[2], { name: 'ZZ', muscle_group: 'core' }], defaults), {
    ok: false,
    detail: `${defaults.length} exercises, ${defaults.length} defaults: 2 default(s) missing, 2 not a default or a second copy of one`,
  });
  assert.equal(judgeDefaultExercises([], []).ok, false, 'an empty default list never passes');
});

test('the empty account\'s judge: none passes, exactly the defaults pass, anything between fails, and nothing passes without the defaults', () => {
  const rows = defaults.map(asRow);
  assert.deepEqual(judgeEmptyAccountExercises([], defaults), { ok: true, detail: NONE_YET });
  assert.deepEqual(judgeEmptyAccountExercises(rows, defaults), judgeDefaultExercises(rows, defaults));
  assert.equal(judgeEmptyAccountExercises(rows, defaults).ok, true);
  assert.equal(judgeEmptyAccountExercises(rows.slice(0, 1), defaults).ok, false, 'one default alone');
  assert.equal(judgeEmptyAccountExercises(rows.slice(0, -1), defaults).ok, false, 'all but one');
  assert.equal(judgeEmptyAccountExercises([], []).ok, false, 'no exercises, and no defaults to hold them against');
});

test('a failed read, a read cut short or a list that could not be loaded fails rather than passes', async () => {
  assert.deepEqual(await failing(account({ readsFail: true })), [
    'seed: empty: owns no programs (v2_programs) — read failed',
    'seed: empty: owns no runs (v2_mesocycles) — read failed',
    'seed: empty: owns no sessions (v2_sessions) — read failed',
    `${EXERCISES_CHECK} — read failed`,
  ]);
  const short = account();
  const fullCount = short.count;
  short.count = async (path) => (path.startsWith('exercises?') ? defaults.length + 1000 : fullCount(path));
  assert.deepEqual(await failing(short), [`${EXERCISES_CHECK} — read ${defaults.length} of ${defaults.length + 1000} rows`]);
  // no rows read while the count says there are some: a read cut short to nothing is not "no exercises"
  const none = account({ exercises: [] });
  const noneCount = none.count;
  none.count = async (path) => (path.startsWith('exercises?') ? 5 : noneCount(path));
  assert.deepEqual(await failing(none), [`${EXERCISES_CHECK} — read 0 of 5 rows`]);
  assert.deepEqual(await failing(account(), null), [`${EXERCISES_CHECK} — the app's DEFAULT_EXERCISES could not be loaded`]);
  assert.deepEqual(await failing(account({ exercises: [] }), null), [`${EXERCISES_CHECK} — the app's DEFAULT_EXERCISES could not be loaded`]);
});
