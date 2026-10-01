// verify-rls.mjs
//
// Read-only RLS check. For every table the app reads or writes, runs one select
// as the anon key with no session and one signed in as the test account. The
// test account owns no data, so both probes must return zero rows. Any row
// returned is a leak.
//
// Reads only: this script never inserts, updates, deletes or calls an RPC.
//
// Result per probe:
//   PASS  zero rows, or a permission-denied error (Postgres 42501)
//   LEAK  one or more rows came back
//   FAIL  any other error — unreachable database, bad key, missing table,
//         anything unexpected. An error that is not permission-denied is never
//         a pass: "could not ask" and "asked and was refused" are different.
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
  'v2_programs',
  'v2_session_exercise_swaps',
  'v2_session_type_history',
  'v2_sessions',
  'v2_set_logs',
  'v2_user_settings',
  'v2_week_plan_sets',
  'v2_week_plans',
  'v2_workout_days',
];

// Global curated catalogs (migration 019): RLS is `for select using (true)` on
// purpose, there is no user_id, and they are readable by everyone. Zero rows is
// not the expectation for them, so rows do not count as a leak (DECISIONS.md 29:
// intentionally readable by everyone, anon included, because they hold shared
// content). They are still probed both ways, and any error other than
// permission-denied still fails.
const PUBLIC_BY_DESIGN = new Set(['v2_exercise_libraries', 'v2_exercise_library_items']);

const REQUIRED = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'RLS_TEST_EMAIL', 'RLS_TEST_PASSWORD'];

// The Supabase URL and key must be stripped of non-ASCII / invisible characters
// (CONTEXT.md, Repo facts); a pasted key can carry them and 401 for no visible reason.
const clean = (v) => (v ?? '').replace(/[^\x21-\x7e]/g, '');

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

// One select, one row at most, with an exact count. Only counts are ever kept or
// printed — never row contents.
async function probe(client, table) {
  try {
    const { data, count, error } = await client.from(table).select('*', { count: 'exact' }).limit(1);
    if (error) {
      if (error.code === '42501' || /permission denied/i.test(error.message ?? '')) {
        return { status: 'PASS', detail: 'permission denied' };
      }
      const code = error.code ? ` [${error.code}]` : '';
      return { status: 'FAIL', detail: `error${code}: ${error.message || 'unknown error'}` };
    }
    const rows = Math.max(count ?? 0, Array.isArray(data) ? data.length : 0);
    if (rows > 0) {
      if (PUBLIC_BY_DESIGN.has(table)) return { status: 'PASS', detail: `${rows} row(s), public by design` };
      return { status: 'LEAK', detail: `${rows} row(s) returned` };
    }
    if (!Array.isArray(data)) return { status: 'FAIL', detail: 'no error and no data array returned' };
    return { status: 'PASS', detail: '0 rows' };
  } catch (err) {
    return { status: 'FAIL', detail: `threw: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function main() {
  const anon = createClient(url, anonKey, clientOptions);
  const authed = createClient(url, anonKey, clientOptions);

  // A failed sign-in means the signed-in probes cannot run. Every one of them is a FAIL,
  // never a pass, and the anon probes still run.
  let signInError = null;
  try {
    const { data, error } = await authed.auth.signInWithPassword({ email, password });
    if (error) signInError = error.message || 'sign-in failed';
    else if (!data?.session?.access_token) signInError = 'sign-in returned no session';
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
      : await probe(authed, table);
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

main().catch((err) => {
  console.error(`verify-rls: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
