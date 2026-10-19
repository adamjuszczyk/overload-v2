// staging-smoke.mjs
//
// End-to-end check of the staging Supabase branch, as the staging accounts
// (CONTEXT.md, "Staging"). Never runs against production (staging-guard.mjs).
// Prints counts and pass/fail lines only: no row contents, no token, no
// password.
//
//   1. Sign-ups are off: a sign-up attempt with a one-character password is
//      answered "signup_disabled" (with sign-ups on, the server answers
//      "weak_password" and creates nothing, so the probe never makes an account).
//   2. The four accounts that sign in each sign in with the one password:
//      staging-test, staging-stable, staging-sequence, staging-empty (the seed
//      copies the test account's password hash onto the other three).
//   3. The seed is there, as supabase/seed.sql builds it. Every count is read
//      as the account that owns the rows (RLS shows an account only its own):
//        test      the account's saved programs, runs (one active), sessions
//                  and set logs; and week 2's Upper A, done differently from
//                  its plan in five ways (REVIEW's and VOLUME's last week),
//                  each shown by a count that is 0 without it: bench set 2 at
//                  82.5 kg x 7, bench set 3 at 80 kg x 5, the cable row's set
//                  skipped, a lateral raise set logged as a dropset with one
//                  drop, a cable pushdown head with no planned set behind it
//        stable    exactly one active STABLE weekday run, its week 1 done
//                  (three sessions on two plan rows: Full Body on Tue and Thu
//                  shares one, Arms the other), week 2 planned, nothing in it
//                  done (no session on a week-2 plan row)
//        sequence  exactly one active SEQUENCE run, cycle 1 done (four
//                  workouts, the A repeat included), cycle 2 planned, nothing
//                  in it done
//        empty     no programs, runs or sessions, and either no exercises or
//                  exactly the app's defaults (DECISIONS 125, Adam: "'Empty'
//                  means no programs, runs or sessions; the smoke asserts
//                  exactly that, and that the account's exercises are the
//                  defaults"; and on 2026-10-19, after the re-seed: "The smoke
//                  accepts either no exercises or exactly the defaults"). The
//                  app gives an account with no exercises its default ones
//                  when it signs in (useSeedDefaultExercisesIfEmpty), so a
//                  re-seeded account owns none until someone signs in to the
//                  app as it, and the defaults from then on. The list is the
//                  app's own DEFAULT_EXERCISES
//                  (src/features/library/defaultExercises.ts), loaded through
//                  Vite's SSR loader and never typed here: none at all, or
//                  every default once (name and muscle group) and nothing
//                  else; anything between fails, and so does a list that
//                  couldn't be loaded. A
//                  program's workout days, a run's week plans and a session's
//                  set logs can't exist without their program, run or session
//                  (not-null foreign keys), so the three counts cover them; a
//                  settings row isn't part of "empty".
//      and none of another account's rows is visible to any of the four
//      (staging-other, and each of the others, own rows these must not see).
//   4. pg-safeupdate behaves as in production: a DELETE with no WHERE, sent
//      as the signed-in test account, is rejected (Postgres 21000). It is
//      aimed at v2_coach_notes, where the seed puts no rows, so even a wrongly
//      accepted delete removes nothing; the check reads the count before and
//      after.
//
// The seed's shapes are a snapshot of what it builds: once someone works in
// the staging app (finishing the stable run, starting another, logging sets)
// a count can move; the check for a shape the seed alone creates is a floor
// (">= 1"), not a total, except where the shape is "exactly one active run" or
// the empty account's.
//
// Env:   STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_TEST_PASSWORD
//        (STAGING_TEST_EMAIL defaults to staging-test@example.com)
// Usage: node scripts/staging-smoke.mjs   (after npm ci: Vite loads the app's
//        default exercise list)
// Exit:  0 = every check passed, 1 = any failure or missing variable

import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertNotProduction } from './staging-guard.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const url = (process.env.STAGING_SUPABASE_URL ?? '').replace(/[^\x20-\x7E]/g, '').trim().replace(/\/+$/, '');
const anon = (process.env.STAGING_SUPABASE_ANON_KEY ?? '').replace(/[^\x20-\x7E]/g, '').trim();
const email = process.env.STAGING_TEST_EMAIL || 'staging-test@example.com';
const password = process.env.STAGING_TEST_PASSWORD ?? '';

// The accounts that sign in (the fifth, staging-other, never does).
const OTHERS = {
  stable: 'staging-stable@example.com',
  sequence: 'staging-sequence@example.com',
  empty: 'staging-empty@example.com',
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

// ─── The empty account (DECISIONS 125) ───────────────────────────────────────
// Exported for staging-smoke.test.mjs, which runs them against a stand-in for
// the signed-in account; main() runs them against staging.

// The app's default exercises, read from the app's own source through Vite's
// SSR loader (CONTEXT.md: a Node script that runs the app's TypeScript loads it
// that way), so the list is the app's and never a copy typed into this script.
export const DEFAULTS_MODULE = '/src/features/library/defaultExercises.ts';

export async function loadDefaultExercises(root = REPO) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    const { DEFAULT_EXERCISES } = await server.ssrLoadModule(DEFAULTS_MODULE);
    if (!Array.isArray(DEFAULT_EXERCISES) || DEFAULT_EXERCISES.length === 0) {
      throw new Error(`${DEFAULTS_MODULE} exports no DEFAULT_EXERCISES`);
    }
    return DEFAULT_EXERCISES.map(({ name, muscleGroup }) => ({ name, muscleGroup }));
  } finally {
    await server.close();
  }
}

// The account's exercises against the defaults, as (name, muscle group) pairs
// with their repeats counted: every default exactly once and nothing else.
// The detail is counts only, like every line this script prints.
export function judgeDefaultExercises(rows, defaults) {
  const tally = (pairs) => {
    const counts = new Map();
    for (const pair of pairs) {
      const key = JSON.stringify(pair);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const wanted = tally(defaults.map((d) => [d.name, d.muscleGroup]));
  const owned = tally(rows.map((r) => [r.name, r.muscle_group]));
  let missing = 0;
  for (const [key, n] of wanted) missing += Math.max(0, n - (owned.get(key) ?? 0));
  let extra = 0;
  for (const [key, n] of owned) extra += Math.max(0, n - (wanted.get(key) ?? 0));
  return {
    ok: defaults.length > 0 && missing === 0 && extra === 0,
    detail: `${rows.length} exercises, ${defaults.length} defaults: ${missing} default(s) missing, ${extra} not a default or a second copy of one`,
  };
}

// The empty account's exercises (DECISIONS 125; Adam, 2026-10-19: "The smoke accepts either no exercises or exactly the
// defaults"): none at all, as a re-seeded account has until its first app sign-in, or exactly the defaults, as it has from then
// on. Anything between fails. The defaults must have loaded either way, so a smoke that can't read the app's list never passes.
export function judgeEmptyAccountExercises(rows, defaults) {
  if (rows.length === 0) {
    return {
      ok: defaults.length > 0,
      detail: `0 exercises: none yet (the app creates its ${defaults.length} defaults at the account's first app sign-in)`,
    };
  }
  return judgeDefaultExercises(rows, defaults);
}

// Adam's three: no programs, no runs, no sessions.
export const EMPTY_OWNS_NONE = [
  ['programs (v2_programs)', 'v2_programs?select=id'],
  ['runs (v2_mesocycles)', 'v2_mesocycles?select=id'],
  ['sessions (v2_sessions)', 'v2_sessions?select=id'],
];

// [name, ok, detail] for each of the empty account's checks. `who` is the
// signed-in account as signIn returns it (count, rows); `defaults` the loaded
// list, or null when it couldn't be loaded, which fails the check.
export async function emptyAccountChecks(who, defaults) {
  const out = [];
  for (const [what, path] of EMPTY_OWNS_NONE) {
    const n = await who.count(path);
    out.push([`seed: empty: owns no ${what}`, n === 0, n === null ? 'read failed' : `${n}`]);
  }
  const name = 'seed: empty: no exercises, or exactly the app\'s defaults';
  if (!defaults) {
    out.push([name, false, 'the app\'s DEFAULT_EXERCISES could not be loaded']);
    return out;
  }
  const total = await who.count('exercises?select=id');
  const rows = await who.rows('exercises?select=name,muscle_group');
  if (total === null || rows === null) out.push([name, false, 'read failed']);
  else if (rows.length !== total) out.push([name, false, `read ${rows.length} of ${total} rows`]);
  else {
    const { ok, detail } = judgeEmptyAccountExercises(rows, defaults);
    out.push([name, ok, detail]);
  }
  return out;
}

async function main() {
  for (const [k, v] of [['STAGING_SUPABASE_URL', url], ['STAGING_SUPABASE_ANON_KEY', anon], ['STAGING_TEST_PASSWORD', password]]) {
    if (!v) { console.error(`staging-smoke: ${k} is not set`); process.exit(1); }
  }
  const ref = assertNotProduction(url);
  console.log(`staging-smoke: project ${ref} (not production)`);
  const base = { apikey: anon, 'Content-Type': 'application/json' };
  let defaults = null;
  try {
    defaults = await loadDefaultExercises();
  } catch (e) {
    console.error(`staging-smoke: the app's DEFAULT_EXERCISES could not be loaded: ${String(e?.message ?? e).split('\n')[0]}`);
  }

  // 1. Sign-ups off
  const probe = `signup-probe-${Date.now()}@example.com`;
  const su = await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: base, body: JSON.stringify({ email: probe, password: 'x' }) });
  const suBody = await su.json().catch(() => ({}));
  const suCode = suBody.error_code ?? suBody.code ?? su.status;
  check('sign-ups are off', suCode === 'signup_disabled', `answer: ${suCode}`);

  // 2. Sign in: the test account first (everything below needs it), then the other three
  const signIn = async (account, label) => {
    const si = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: base, body: JSON.stringify({ email: account, password }) });
    const siBody = await si.json().catch(() => ({}));
    const token = siBody.access_token;
    const uid = siBody.user?.id;
    check(`${label} account signs in`, Boolean(token) && /^[0-9a-f-]{36}$/.test(uid ?? ''), token ? '' : `HTTP ${si.status} ${siBody.error_code ?? ''}`);
    if (!token) return null;
    const auth = { ...base, Authorization: `Bearer ${token}` };
    const count = async (path) => {
      const r = await fetch(`${url}/rest/v1/${path}`, { method: 'HEAD', headers: { ...auth, Prefer: 'count=exact', Range: '0-0' } });
      const m = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
      return r.ok && m ? Number(m[1]) : null;
    };
    const rows = async (path) => {
      const r = await fetch(`${url}/rest/v1/${path}`, { headers: auth });
      const body = await r.json().catch(() => null);
      return r.ok && Array.isArray(body) ? body : null;
    };
    return { uid, auth, count, rows };
  };
  const test = await signIn(email, 'test');
  if (!test) return;
  const others = {};
  for (const [label, account] of Object.entries(OTHERS)) others[label] = await signIn(account, label);

  // A seed check: read a count as `who`, judge it.
  const seedCheck = async (who, name, path, ok) => {
    const n = await who.count(path);
    check(`seed: ${name}`, n !== null && ok(n), n === null ? 'read failed' : `${n}`);
  };

  // 3a. The test account's seed
  const shapes = [
    ['saved programs (seed: 6)', 'v2_programs?select=id&kind=eq.saved', (n) => n >= 6],
    ['runs (seed: 3)', 'v2_mesocycles?select=id', (n) => n >= 3],
    ['active run (exactly 1)', 'v2_mesocycles?select=id&status=eq.active', (n) => n === 1],
    ['sessions (seed: 28)', 'v2_sessions?select=id', (n) => n >= 28],
    ['set logs (seed: 203)', 'v2_set_logs?select=id', (n) => n >= 200],
    ['stage logs', 'v2_set_logs?select=id&parent_set_id=not.is.null', (n) => n > 0],
    ['skipped set logs', 'v2_set_logs?select=id&is_skipped=is.true', (n) => n > 0],
    ['in-progress session', 'v2_sessions?select=id&status=eq.in_progress', (n) => n === 1],
    ['superset blocks', 'v2_program_superset_blocks?select=id', (n) => n > 0],
    ['old-table marks (pre-1.1 run)', 'v2_coach_meso_tag_priorities?select=id', (n) => n > 0],
    // staging-other@example.com owns rows in each of these (seed.sql); the
    // test account must see none of them.
    ['other account\'s programs visible', `v2_programs?select=id&user_id=neq.${test.uid}`, (n) => n === 0],
    ['other account\'s set logs visible', `v2_set_logs?select=id&user_id=neq.${test.uid}`, (n) => n === 0],
    ['other account\'s exercises visible', `exercises?select=id&user_id=neq.${test.uid}`, (n) => n === 0],
    ['other account\'s notes visible', `v2_coach_notes?select=id&user_id=neq.${test.uid}`, (n) => n === 0],
  ];
  for (const [name, path, ok] of shapes) await seedCheck(test, name, path, ok);

  // Week 2's Upper A (done), five differences from its plan. Each count is 0
  // without its difference. Exercises are found by name (the account's own).
  const exerciseId = async (name) => (await test.rows(`exercises?select=id&name=eq.${encodeURIComponent(name)}`))?.[0]?.id ?? null;
  const bench = await exerciseId('Barbell Bench Press');
  const row = await exerciseId('Seated Cable Row');
  const raise = await exerciseId('Dumbbell Lateral Raise');
  const pushdown = await exerciseId('Cable Triceps Pushdown');
  check('seed: the exercises week 2 Upper A uses are found', Boolean(bench && row && raise && pushdown));
  if (bench && row && raise && pushdown) {
    const diffs = [
      ['bench set 2 logged 82.5 kg x 7 (planned 80 kg, 6-8)', `exercise_id=eq.${bench}&weight=eq.82.5&reps=eq.7`],
      ['bench set 3 logged 80 kg x 5 (reps below the range)', `exercise_id=eq.${bench}&weight=eq.80&reps=eq.5`],
      ['cable row set skipped', `exercise_id=eq.${row}&is_skipped=is.true`],
      ['lateral raise set logged as a dropset', `exercise_id=eq.${raise}&stage_kind=eq.dropset&parent_set_id=is.null`],
      ['lateral raise has one logged drop', `exercise_id=eq.${raise}&parent_set_id=not.is.null`],
      ['pushdown head with no planned set (20 kg x 15)', `exercise_id=eq.${pushdown}&week_plan_set_id=is.null&parent_set_id=is.null&weight=eq.20&reps=eq.15`],
    ];
    for (const [name, filter] of diffs) await seedCheck(test, `week 2 Upper A: ${name}`, `v2_set_logs?select=id&${filter}`, (n) => n >= 1);
  }

  // 3b. staging-stable: its own STG Full Body, an active stable run
  const st = others.stable;
  if (st) {
    await seedCheck(st, 'stable: active run (exactly 1)', 'v2_mesocycles?select=id&status=eq.active', (n) => n === 1);
    await seedCheck(st, 'stable: the run is a stable weekday program', 'v2_programs?select=id&kind=eq.run&planning_type=eq.stable&schedule_type=eq.weekday', (n) => n === 1);
    await seedCheck(st, 'stable: week 1 done (3 completed sessions)', 'v2_sessions?select=id&status=eq.completed', (n) => n >= 3);
    await seedCheck(st, 'stable: nothing started or skipped', 'v2_sessions?select=id&status=neq.completed', (n) => n === 0);
    // The inner embed keeps only sessions whose plan row is a week-2 row.
    await seedCheck(st, 'stable: nothing done in week 2', 'v2_sessions?select=id,v2_week_plans!inner(week_number)&v2_week_plans.week_number=eq.2', (n) => n === 0);
    await seedCheck(st, 'stable: week 1 planned (2 workouts)', 'v2_week_plans?select=id&week_number=eq.1', (n) => n >= 2);
    await seedCheck(st, 'stable: week 2 planned (2 workouts)', 'v2_week_plans?select=id&week_number=eq.2', (n) => n >= 2);
    const done = await st.rows('v2_sessions?select=week_plan_id&status=eq.completed');
    const plans = done ? new Set(done.map((s) => s.week_plan_id)).size : null;
    check('seed: stable: Full Body on Tue and Thu shares one plan row (3 sessions, 2 plan rows)', done !== null && done.length >= 3 && plans === 2, `${done?.length ?? '?'} sessions on ${plans ?? '?'} plan rows`);
    await seedCheck(st, 'stable: set logs of week 1', 'v2_set_logs?select=id', (n) => n >= 20);
  }

  // 3c. staging-sequence: its own STG Rotation, an active sequence run
  const sq = others.sequence;
  if (sq) {
    await seedCheck(sq, 'sequence: active run (exactly 1)', 'v2_mesocycles?select=id&status=eq.active', (n) => n === 1);
    await seedCheck(sq, 'sequence: the run is a sequence program', 'v2_programs?select=id&kind=eq.run&schedule_type=eq.sequence', (n) => n === 1);
    await seedCheck(sq, 'sequence: cycle 1 done (4 completed sessions)', 'v2_sessions?select=id&status=eq.completed', (n) => n >= 4);
    await seedCheck(sq, 'sequence: nothing started or skipped', 'v2_sessions?select=id&status=neq.completed', (n) => n === 0);
    await seedCheck(sq, 'sequence: nothing done in cycle 2', 'v2_sessions?select=id,v2_week_plans!inner(week_number)&v2_week_plans.week_number=eq.2', (n) => n === 0);
    // The inner embed keeps only plan rows whose workout is Rotation A, at slot 1 and at slot 4.
    await seedCheck(sq, 'sequence: Rotation A in both its slots (1 and 4) of cycle 1', 'v2_week_plans?select=id,v2_workout_days!inner(name)&week_number=eq.1&sequence_position=in.(1,4)&v2_workout_days.name=eq.Rotation%20A', (n) => n >= 2);
    await seedCheck(sq, 'sequence: cycle 1 has 4 workout slots', 'v2_week_plans?select=id&week_number=eq.1', (n) => n >= 4);
    await seedCheck(sq, 'sequence: cycle 2 planned (4 workout slots)', 'v2_week_plans?select=id&week_number=eq.2', (n) => n >= 4);
  }

  // 3d. staging-empty: no programs, runs or sessions, and no exercises or
  // exactly the app's default ones (DECISIONS 125)
  const em = others.empty;
  if (em) {
    for (const [name, ok, detail] of await emptyAccountChecks(em, defaults)) check(name, ok, detail);
  }

  // 3e. No account sees another account's programs (RLS), each as itself
  for (const [label, who] of Object.entries({ stable: st, sequence: sq, empty: em })) {
    if (who) await seedCheck(who, `${label}: other accounts' programs visible`, `v2_programs?select=id&user_id=neq.${who.uid}`, (n) => n === 0);
  }

  // 4. pg-safeupdate
  const before = await test.count('v2_coach_notes?select=id');
  const del = await fetch(`${url}/rest/v1/v2_coach_notes`, { method: 'DELETE', headers: test.auth });
  const delBody = await del.json().catch(() => ({}));
  const after = await test.count('v2_coach_notes?select=id');
  check('DELETE without WHERE is rejected (pg-safeupdate)', !del.ok && delBody.code === '21000',
    `HTTP ${del.status} ${delBody.code ?? ''}; v2_coach_notes rows before ${before}, after ${after}`);
}

// Only when run as a script: staging-smoke.test.mjs imports the empty account's checks.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e) => { console.error(`staging-smoke: ${e.message}`); results.push(false); })
    .finally(() => {
      const failed = results.filter((r) => !r).length;
      console.log(failed ? `staging-smoke: ${failed} check(s) failed` : 'staging-smoke: all checks passed');
      process.exit(failed || results.length === 0 ? 1 : 0);
    });
}
