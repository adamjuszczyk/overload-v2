// verify-rls.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// Unit tests for classifyProbe(), the pure classification verify-rls.mjs applies
// to an already-fetched probe result (DECISIONS.md 75: the signed-in probe now
// flags only rows the test account does not own, instead of treating any
// returned row as a leak).
//
// Importing verify-rls.mjs is safe here: every side-effecting thing it does — the
// environment-variable check, the sign-in, the per-table loop and its
// console/process.exit calls — lives inside main(), which only runs when the file
// is executed directly (see the `import.meta.url` guard at its end, the same
// pattern as check-embeds.mjs / probe-live-columns.mjs / transport-collapse.mjs).
// Importing it for classifyProbe alone runs none of that: no env vars needed, no
// network, no process.exit. verify-rls-tables.test.mjs instead reads this file as
// text, for an unrelated reason (checking the TABLES list, not this function).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProbe } from './verify-rls.mjs';

const OWNER = 'f00dcafe-0000-4000-8000-000000000001';
const OTHER = 'f00dcafe-0000-4000-8000-000000000002';
const own = (n) => Array.from({ length: n }, () => ({ user_id: OWNER }));

// --- signed-in, table has a user_id column: classified by ownership ---

test('ownership: rows the test account owns are a pass, "N own row(s)"', () => {
  assert.deepEqual(classifyProbe({ mode: 'ownership', rows: own(46), ownerId: OWNER }), {
    status: 'PASS',
    detail: '46 own row(s)',
  });
});

test('ownership: one foreign row among own rows is a leak', () => {
  const rows = [...own(3), { user_id: OTHER }, ...own(2)];
  const result = classifyProbe({ mode: 'ownership', rows, ownerId: OWNER });
  assert.deepEqual(result, { status: 'LEAK', detail: '1 of 6 row(s) not owned by the test account' });
});

test('ownership: a null user_id is a leak, not an own row', () => {
  const result = classifyProbe({ mode: 'ownership', rows: [{ user_id: null }], ownerId: OWNER });
  assert.deepEqual(result, { status: 'LEAK', detail: '1 of 1 row(s) not owned by the test account' });
});

test('ownership: zero rows is a pass', () => {
  assert.deepEqual(classifyProbe({ mode: 'ownership', rows: [], ownerId: OWNER }), { status: 'PASS', detail: '0 rows' });
});

// --- any-row mode: the anon probe always, and a NO_USER_ID_COLUMN table's
// signed-in probe (e.g. v2_exercise_libraries / v2_exercise_library_items) ---

test('any-row: anon probe, any row is a leak', () => {
  const result = classifyProbe({ mode: 'any-row', rows: [{ id: 1 }], count: 1, publicByDesign: false });
  assert.deepEqual(result, { status: 'LEAK', detail: '1 row(s) returned' });
});

test('any-row: a public-by-design table is a pass even with rows', () => {
  const result = classifyProbe({ mode: 'any-row', rows: [{ id: 1 }], count: 12, publicByDesign: true });
  assert.deepEqual(result, { status: 'PASS', detail: '12 row(s), public by design' });
});

test('any-row: zero rows is a pass', () => {
  assert.deepEqual(classifyProbe({ mode: 'any-row', rows: [], count: 0, publicByDesign: false }), {
    status: 'PASS',
    detail: '0 rows',
  });
});

test('a no-user_id table keeps the old any-row rule for the signed-in probe too', () => {
  // v2_exercise_libraries / v2_exercise_library_items (NO_USER_ID_COLUMN in
  // verify-rls.mjs) have no user_id column, so their signed-in probe calls
  // classifyProbe in 'any-row' mode, the same path the anon probe always uses —
  // not the 'ownership' path exercised above. Signed-in data, old rule:
  const leak = classifyProbe({ mode: 'any-row', rows: [{ id: 1 }], count: 1, publicByDesign: false });
  assert.equal(leak.status, 'LEAK');
  const pass = classifyProbe({ mode: 'any-row', rows: [{ id: 1 }], count: 1, publicByDesign: true });
  assert.equal(pass.status, 'PASS');
});
