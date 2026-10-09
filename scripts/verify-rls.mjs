// verify-rls.mjs
//
// Read-only RLS check. For every table the app reads or writes, runs one select
// as the anon key with no session and one signed in as the test account.
//
// The anon probe expects zero rows: any row is a LEAK (except PUBLIC_BY_DESIGN
// tables, where rows are expected and a PASS).
//
// The signed-in probe does not expect zero rows — the test account turns out to
// own some rows itself (DECISIONS.md 75: on 2026-10-09 it was confirmed to own 46
// of 335 `exercises` rows; RLS was working, the "owns no data" assumption behind
// the old any-row rule was wrong). It is instead classified by ownership, through
// two server-side counts rather than by fetching rows: a count of how many
// visible rows are NOT the test account's own (a null user_id counts as not its
// own) is the LEAK signal, and a count of every visible row gives the "N own
// row(s)" detail when none are foreign. Counting server-side, instead of
// fetching rows and filtering them here, matters because PostgREST caps a
// response at max_rows (supabase/config.toml): fetching would silently miss a
// foreign row past that cap on a table where the test account can see more rows
// than that — a false PASS, which is worse than no check (CONTEXT.md, Checks
// that lied #31). A table or view with no user_id column can't be classified
// this way (NO_USER_ID_COLUMN below) and keeps the old any-row rule instead, the
// same rule the anon probe always uses.
//
// Reads only: this script never inserts, updates, deletes or calls an RPC.
//
// Result per probe:
//   PASS  no foreign rows counted (signed-in, table has a user_id column —
//         "N own row(s)"); a permission-denied error (Postgres 42501); or a
//         PUBLIC_BY_DESIGN table
//   LEAK  a nonzero foreign-row count (signed-in, table has a user_id column);
//         or, for the anon probe and any NO_USER_ID_COLUMN table, any row at all
//         (unless PUBLIC_BY_DESIGN)
//   FAIL  any other error — unreachable database, bad key, missing table, a
//         sign-in that didn't return the test account's own id (or one that
//         doesn't look like a UUID), a null count with no error, anything
//         unexpected. An error that is not permission-denied is never a pass:
//         "could not ask" and "asked and was refused" are different.
//
// Usage: node scripts/verify-rls.mjs
// Env:   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, RLS_TEST_EMAIL, RLS_TEST_PASSWORD
// Exit:  0 = every probe passed, 1 = any leak, failure or missing variable
//
// TABLES must list every table or view the app reads or writes — find them with
//   grep -rhoE "\.from\('[a-z_0-9]+'\)" src api | sort -u
// A new table that is not added here is not checked.

import { createClient } from '@supabase/supabase-js';

const TABLES = [
  'exercises',
  'v2_coach_curation_runs',
  'v2_coach_memory_entries',
  'v2_coach_meso_analyses',
  'v2_coach_meso_tag_priorities',
  'v2_coach_notes',
  'v2_coach_phase_entries',
  'v2_coach_qa_exchanges',
  'v2_coach_session_analyses',
  'v2_coach_week_analyses',
  'v2_coach_weight_entries',
  'v2_exercise_libraries',
  'v2_exercise_library_items',
  'v2_history_session_summary',
  'v2_mesocycles',
  'v2_program_exercises',
  'v2_program_priorities',
  'v2_program_sequence_items',
  'v2_program_sets',
  'v2_program_superset_blocks',
  'v2_programs',
  'v2_session_exercise_swaps',
  'v2_session_type_history',
  'v2_sessions',
  'v2_set_logs',
  'v2_user_settings',
  'v2_week_plan_exercises',
  'v2_week_plan_sets',
  'v2_week_plans',
  'v2_workout_days',
  'v2_workout_warmup_items',
];

// Global curated catalogs (migration 019): RLS is `for select using (true)` on
// purpose, there is no user_id, and they are readable by everyone. Zero rows is
// not the expectation for them, so rows do not count as a leak (DECISIONS.md 29:
// intentionally readable by everyone, anon included, because they hold shared
// content). They are still probed both ways, and any error other than
// permission-denied still fails.
const PUBLIC_BY_DESIGN = new Set(['v2_exercise_libraries', 'v2_exercise_library_items']);

// Tables/views in TABLES with no user_id column. The ownership check below needs
// one to compare against, so for these the signed-in probe keeps the old any-row
// rule too (DECISIONS.md 75), same as the anon probe — it cannot tell an owned row
// from a foreign one, so it falls back to "zero rows expected" (with the
// PUBLIC_BY_DESIGN carve-out above, which both of these also are).
//
// Checked against the replayed schema, not guessed from migration source:
//   bash scripts/replay-migrations.sh --keep
//   docker exec -i -e PGPASSWORD=postgres <container> psql -h 127.0.0.1 -U postgres \
//     -d postgres -X -c "select table_name, exists (select 1 from
//       information_schema.columns c where c.table_schema = t.table_schema and
//       c.table_name = t.table_name and c.column_name = 'user_id') as has_user_id
//       from information_schema.tables t where table_schema = 'public'"
// On 2026-10-09: every other name in TABLES has a user_id column; only these two
// do not. Re-run this check before adding or removing a name here.
const NO_USER_ID_COLUMN = new Set(['v2_exercise_libraries', 'v2_exercise_library_items']);

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'RLS_TEST_EMAIL', 'RLS_TEST_PASSWORD'];

// The Supabase URL and key must be stripped of non-ASCII / invisible characters
// (CONTEXT.md, Repo facts); a pasted key can carry them and 401 for no visible reason.
const clean = (v) => (v ?? '').replace(/[^\x21-\x7e]/g, '');

// Pure classification of an already-computed probe result — no I/O, so it can be
// unit-tested directly (scripts/verify-rls.test.mjs) without a database or
// network. probe()/probeOwnership() below do the Supabase call and error
// handling, then hand the clean counts/rows to this function.
//
//   mode 'ownership' (signed-in, table has a user_id column): total and foreign
//   are both server-side counts (probeOwnership never fetches row contents —
//   see its own comment for why).
//     total or foreign is null/undefined    -> FAIL (no count returned)
//     foreign > 0                           -> LEAK "F of N row(s) not owned..."
//     foreign === 0                         -> PASS "N own row(s)" (N may be 0)
//
//   mode 'any-row' (the anon probe always; the signed-in probe on a
//   NO_USER_ID_COLUMN table, which cannot be classified by ownership):
//     zero rows                             -> PASS "0 rows"
//     any row, table is publicByDesign      -> PASS "N row(s), public by design"
//     any row, otherwise                    -> LEAK "N row(s) returned"
export function classifyProbe({ mode, rows, count, publicByDesign, total, foreign }) {
  if (mode === 'ownership') {
    if (total == null || foreign == null) return { status: 'FAIL', detail: 'no count returned' };
    if (foreign > 0) {
      return { status: 'LEAK', detail: `${foreign} of ${total} row(s) not owned by the test account` };
    }
    return { status: 'PASS', detail: `${total} own row(s)` };
  }
  const anyRowTotal = Math.max(count ?? 0, rows.length);
  if (anyRowTotal === 0) return { status: 'PASS', detail: '0 rows' };
  if (publicByDesign) return { status: 'PASS', detail: `${anyRowTotal} row(s), public by design` };
  return { status: 'LEAK', detail: `${anyRowTotal} row(s) returned` };
}

// A Postgrest/Supabase error is a PASS when it is permission-denied — RLS doing
// its job — and a FAIL for anything else. Shared by both probes below.
function handleError(error) {
  if (error.code === '42501' || /permission denied/i.test(error.message ?? '')) {
    return { status: 'PASS', detail: 'permission denied' };
  }
  const code = error.code ? ` [${error.code}]` : '';
  return { status: 'FAIL', detail: `error${code}: ${error.message || 'unknown error'}` };
}

// The anon probe always, and the signed-in probe on a NO_USER_ID_COLUMN table:
// neither can be classified by ownership, so only whether any row came back
// matters, never its contents. One select, one row at most, with an exact count.
// Only counts are ever kept or printed — never row contents.
async function probe(client, table) {
  try {
    const { data, count, error } = await client.from(table).select('*', { count: 'exact' }).limit(1);
    if (error) return handleError(error);
    if (!Array.isArray(data)) return { status: 'FAIL', detail: 'no error and no data array returned' };
    return classifyProbe({ mode: 'any-row', rows: data, count, publicByDesign: PUBLIC_BY_DESIGN.has(table) });
  } catch (err) {
    return { status: 'FAIL', detail: `threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// A UUID shape, checked before ownerId is interpolated into the `.or()` filter
// string below — not an RFC 4122 version check, just enough to refuse anything
// that isn't hex-and-dashes so nothing else can reach that string.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The signed-in probe on a table that has a user_id column: classified by two
// server-side counts, never by fetching row contents. Fetching rows and
// filtering them here would silently miss a foreign row past PostgREST's
// max_rows cap (supabase/config.toml) on a table where the test account can see
// more rows than that — a false PASS, worse than no check at all (CONTEXT.md,
// Checks that lied #31). So: one head-only count of rows NOT owned by the test
// account (a null user_id counts as not owned), and one head-only count of
// every visible row, used only for the "N own row(s)" detail. head: true means
// no row contents are ever requested, and only these two numbers are ever kept
// or printed — never a user_id value, other row contents, or the test account's
// email, password or any token.
export async function probeOwnership(client, table, ownerId) {
  if (typeof ownerId !== 'string' || !UUID_RE.test(ownerId)) {
    return { status: 'FAIL', detail: 'test account id is not a UUID, refusing to query' };
  }
  try {
    const foreignRes = await client
      .from(table)
      .select('user_id', { count: 'exact', head: true })
      .or(`user_id.neq.${ownerId},user_id.is.null`);
    if (foreignRes.error) return handleError(foreignRes.error);

    const totalRes = await client.from(table).select('user_id', { count: 'exact', head: true });
    if (totalRes.error) return handleError(totalRes.error);

    return classifyProbe({ mode: 'ownership', total: totalRes.count, foreign: foreignRes.count });
  } catch (err) {
    return { status: 'FAIL', detail: `threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function main() {
  const missing = REQUIRED.filter((name) => !process.env[name] || !process.env[name].trim());
  if (missing.length > 0) {
    console.error(`verify-rls: missing environment variable(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  const url = clean(process.env.VITE_SUPABASE_URL);
  const anonKey = clean(process.env.VITE_SUPABASE_ANON_KEY);
  const email = process.env.RLS_TEST_EMAIL.trim();
  const password = process.env.RLS_TEST_PASSWORD;
  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

  const anon = createClient(url, anonKey, clientOptions);
  const authed = createClient(url, anonKey, clientOptions);

  // A failed sign-in, or one that doesn't return the test account's own id, means
  // the signed-in probes cannot run — the ownership check has nothing to compare
  // against. Every one of them is a FAIL, never a pass, and the anon probes still
  // run. Never printed: the email, the password, or any token.
  let signInError = null;
  let ownerId = null;
  try {
    const { data, error } = await authed.auth.signInWithPassword({ email, password });
    if (error) signInError = error.message || 'sign-in failed';
    else if (!data?.session?.access_token) signInError = 'sign-in returned no session';
    else if (!data?.user?.id) signInError = 'sign-in returned no user id';
    else ownerId = data.user.id;
  } catch (err) {
    signInError = `sign-in threw: ${err instanceof Error ? err.message : String(err)}`;
  }
  if (signInError) console.error(`verify-rls: could not sign in as the test account: ${signInError}`);

  const pad = Math.max(...TABLES.map((t) => t.length));
  const results = [];
  for (const table of TABLES) {
    const anonResult = await probe(anon, table);
    const authResult = signInError
      ? { status: 'FAIL', detail: `not probed, sign-in failed: ${signInError}` }
      : NO_USER_ID_COLUMN.has(table)
        ? await probe(authed, table)
        : await probeOwnership(authed, table, ownerId);
    results.push({ table, anon: anonResult, authed: authResult });
    console.log(`${table.padEnd(pad)}  anon: ${anonResult.status} (${anonResult.detail})`);
    console.log(`${' '.repeat(pad)}  user: ${authResult.status} (${authResult.detail})`);
  }

  const probes = results.flatMap((r) => [r.anon, r.authed]);
  const leaks = probes.filter((p) => p.status === 'LEAK').length;
  const fails = probes.filter((p) => p.status === 'FAIL').length;
  console.log(
    `\nverify-rls: ${TABLES.length} tables, ${probes.length} probes — ` +
      `${probes.length - leaks - fails} pass, ${leaks} leak, ${fails} fail`,
  );
  if (leaks > 0 || fails > 0) {
    console.log('verify-rls: FAILED');
    process.exit(1);
  }
  console.log('verify-rls: ok');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`verify-rls: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
