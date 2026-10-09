// verify-rls.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// Unit tests for classifyProbe() and probeOwnership(), verify-rls.mjs's signed-in
// ownership check (DECISIONS.md 75: the signed-in probe flags only rows the test
// account does not own, instead of treating any returned row as a leak).
//
// classifyProbe() is pure (no I/O): in 'ownership' mode it takes total/foreign as
// already-computed server-side counts, never row contents — fetching rows and
// filtering them client-side would silently miss a foreign row past PostgREST's
// max_rows cap (CONTEXT.md, Checks that lied #31). probeOwnership() does do I/O
// (two Supabase calls for those counts), but takes its client as a parameter, so
// it's tested here against a minimal mock client — still no database, no network.
//
// Importing verify-rls.mjs is safe: every side-effecting thing it does — the
// environment-variable check, the sign-in, the per-table loop and its
// console/process.exit calls — lives inside main(), which only runs when the
// file is executed directly (see the `import.meta.url` guard at its end, the
// same pattern as check-embeds.mjs / probe-live-columns.mjs /
// transport-collapse.mjs). verify-rls-tables.test.mjs instead reads this file as
// text, for an unrelated reason (checking the TABLES list, not these functions).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyProbe, probeOwnership } from './verify-rls.mjs';

const OWNER = 'f00dcafe-0000-4000-8000-000000000001';

// --- classifyProbe, mode 'ownership': signed-in, table has a user_id column,
// classified by two already-computed server-side counts — never row contents ---

test('ownership: no foreign rows is a pass, "N own row(s)"', () => {
  assert.deepEqual(classifyProbe({ mode: 'ownership', total: 46, foreign: 0 }), {
    status: 'PASS',
    detail: '46 own row(s)',
  });
});

test('ownership: a foreign count is a leak', () => {
  const result = classifyProbe({ mode: 'ownership', total: 6, foreign: 1 });
  assert.deepEqual(result, { status: 'LEAK', detail: '1 of 6 row(s) not owned by the test account' });
});

test('ownership: a foreign count is a leak even with a total in the thousands', () => {
  // The old rule fetched rows (capped by PostgREST's max_rows) and filtered them
  // here, so a foreign row past that cap was silently missed. These are both
  // server-side counts — a huge total changes nothing about the classification.
  const result = classifyProbe({ mode: 'ownership', total: 5000, foreign: 3 });
  assert.deepEqual(result, { status: 'LEAK', detail: '3 of 5000 row(s) not owned by the test account' });
});

test('ownership: a null total count is a fail, not a pass', () => {
  assert.equal(classifyProbe({ mode: 'ownership', total: null, foreign: 0 }).status, 'FAIL');
});

test('ownership: a null foreign count is a fail, not a pass', () => {
  assert.equal(classifyProbe({ mode: 'ownership', total: 10, foreign: null }).status, 'FAIL');
});

test('ownership: zero total rows is a pass, "0 own row(s)"', () => {
  assert.deepEqual(classifyProbe({ mode: 'ownership', total: 0, foreign: 0 }), { status: 'PASS', detail: '0 own row(s)' });
});

// --- classifyProbe, mode 'any-row': the anon probe always, and a
// NO_USER_ID_COLUMN table's signed-in probe (e.g. v2_exercise_libraries /
// v2_exercise_library_items) — unchanged by this fix ---

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

// --- probeOwnership against a minimal mock client: no Supabase instance, no
// network. select() hands back an object that is awaitable directly (the plain
// total-count call) and also has an .or(filter) method (the foreign-count call);
// either way, every call is recorded with its table/column/opts/filter so a test
// can assert the exact request shape probeOwnership makes. ---

function mockClient(responses) {
  const calls = [];
  let next = 0;
  const client = {
    from(table) {
      return {
        select(column, opts) {
          const response = responses[next++];
          const record = (filter) => {
            calls.push({ table, column, opts, filter });
            return response;
          };
          return {
            or(filter) {
              return Promise.resolve(record(filter));
            },
            then(onFulfilled, onRejected) {
              return Promise.resolve(record(null)).then(onFulfilled, onRejected);
            },
          };
        },
      };
    },
  };
  return { client, calls };
}

test('probeOwnership: issues the foreign-count filter (both halves) with head:true, then a plain head:true total', async () => {
  const { client, calls } = mockClient([
    { data: null, count: 1, error: null }, // foreign count: the .or()-filtered call
    { data: null, count: 47, error: null }, // total count: the plain call
  ]);
  const result = await probeOwnership(client, 'exercises', OWNER);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], {
    table: 'exercises',
    column: 'user_id',
    opts: { count: 'exact', head: true },
    filter: `user_id.neq.${OWNER},user_id.is.null`,
  });
  assert.deepEqual(calls[1], {
    table: 'exercises',
    column: 'user_id',
    opts: { count: 'exact', head: true },
    filter: null,
  });
  assert.deepEqual(result, { status: 'LEAK', detail: '1 of 47 row(s) not owned by the test account' });
});

test('probeOwnership: a non-UUID ownerId is refused before any query reaches the client', async () => {
  const { client, calls } = mockClient([]);
  const result = await probeOwnership(client, 'exercises', 'not-a-uuid; drop table exercises;--');
  assert.equal(calls.length, 0);
  assert.equal(result.status, 'FAIL');
});
