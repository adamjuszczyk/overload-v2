// staging-smoke.mjs
//
// End-to-end check of the staging Supabase branch, as the staging test
// account (CONTEXT.md, "Staging"). Never runs against production
// (staging-guard.mjs). Prints counts and pass/fail lines only: no row
// contents, no token, no password.
//
//   1. Sign-ups are off: a sign-up attempt with a one-character password is
//      answered "signup_disabled" (with sign-ups on, the server answers
//      "weak_password" and creates nothing, so the probe never makes an account).
//   2. The test account signs in.
//   3. The seed is there: the account's saved programs, runs (one active),
//      sessions and set logs, against supabase/seed.sql's shapes; and none of
//      the second synthetic account's rows are visible to it.
//   4. pg-safeupdate behaves as in production: a DELETE with no WHERE, sent
//      as the signed-in account, is rejected (Postgres 21000). It is aimed at
//      v2_coach_notes, where the seed puts no rows, so even a wrongly accepted
//      delete removes nothing; the check reads the count before and after.
//
// Env:   STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY, STAGING_TEST_PASSWORD
//        (STAGING_TEST_EMAIL defaults to staging-test@example.com)
// Usage: node scripts/staging-smoke.mjs
// Exit:  0 = every check passed, 1 = any failure or missing variable

import { assertNotProduction } from './staging-guard.mjs';

const url = (process.env.STAGING_SUPABASE_URL ?? '').replace(/[^\x20-\x7E]/g, '').trim().replace(/\/+$/, '');
const anon = (process.env.STAGING_SUPABASE_ANON_KEY ?? '').replace(/[^\x20-\x7E]/g, '').trim();
const email = process.env.STAGING_TEST_EMAIL || 'staging-test@example.com';
const password = process.env.STAGING_TEST_PASSWORD ?? '';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  for (const [k, v] of [['STAGING_SUPABASE_URL', url], ['STAGING_SUPABASE_ANON_KEY', anon], ['STAGING_TEST_PASSWORD', password]]) {
    if (!v) { console.error(`staging-smoke: ${k} is not set`); process.exit(1); }
  }
  const ref = assertNotProduction(url);
  console.log(`staging-smoke: project ${ref} (not production)`);
  const base = { apikey: anon, 'Content-Type': 'application/json' };

  // 1. Sign-ups off
  const probe = `signup-probe-${Date.now()}@example.com`;
  const su = await fetch(`${url}/auth/v1/signup`, { method: 'POST', headers: base, body: JSON.stringify({ email: probe, password: 'x' }) });
  const suBody = await su.json().catch(() => ({}));
  const suCode = suBody.error_code ?? suBody.code ?? su.status;
  check('sign-ups are off', suCode === 'signup_disabled', `answer: ${suCode}`);

  // 2. Sign in
  const si = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: base, body: JSON.stringify({ email, password }) });
  const siBody = await si.json().catch(() => ({}));
  const token = siBody.access_token;
  const uid = siBody.user?.id;
  check('test account signs in', Boolean(token) && /^[0-9a-f-]{36}$/.test(uid ?? ''), token ? '' : `HTTP ${si.status} ${siBody.error_code ?? ''}`);
  if (!token) return;
  const auth = { ...base, Authorization: `Bearer ${token}` };

  const count = async (path) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { method: 'HEAD', headers: { ...auth, Prefer: 'count=exact', Range: '0-0' } });
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') ?? '');
    return r.ok && m ? Number(m[1]) : null;
  };

  // 3. The seed
  const shapes = [
    ['saved programs (seed: 6)', 'v2_programs?select=id&kind=eq.saved', (n) => n >= 6],
    ['runs (seed: 3)', 'v2_mesocycles?select=id', (n) => n >= 3],
    ['active run (exactly 1)', 'v2_mesocycles?select=id&status=eq.active', (n) => n === 1],
    ['sessions (seed: 28)', 'v2_sessions?select=id', (n) => n >= 28],
    ['set logs (seed: 201)', 'v2_set_logs?select=id', (n) => n >= 200],
    ['stage logs', 'v2_set_logs?select=id&parent_set_id=not.is.null', (n) => n > 0],
    ['skipped set logs', 'v2_set_logs?select=id&is_skipped=is.true', (n) => n > 0],
    ['in-progress session', 'v2_sessions?select=id&status=eq.in_progress', (n) => n === 1],
    ['superset blocks', 'v2_program_superset_blocks?select=id', (n) => n > 0],
    ['old-table marks (pre-1.1 run)', 'v2_coach_meso_tag_priorities?select=id', (n) => n > 0],
    // staging-other@example.com owns rows in each of these (seed.sql); the
    // test account must see none of them.
    ['other account\'s programs visible', `v2_programs?select=id&user_id=neq.${uid}`, (n) => n === 0],
    ['other account\'s set logs visible', `v2_set_logs?select=id&user_id=neq.${uid}`, (n) => n === 0],
    ['other account\'s exercises visible', `exercises?select=id&user_id=neq.${uid}`, (n) => n === 0],
    ['other account\'s notes visible', `v2_coach_notes?select=id&user_id=neq.${uid}`, (n) => n === 0],
  ];
  for (const [name, path, ok] of shapes) {
    const n = await count(path);
    check(`seed: ${name}`, n !== null && ok(n), n === null ? 'read failed' : `${n}`);
  }

  // 4. pg-safeupdate
  const before = await count('v2_coach_notes?select=id');
  const del = await fetch(`${url}/rest/v1/v2_coach_notes`, { method: 'DELETE', headers: auth });
  const delBody = await del.json().catch(() => ({}));
  const after = await count('v2_coach_notes?select=id');
  check('DELETE without WHERE is rejected (pg-safeupdate)', !del.ok && delBody.code === '21000',
    `HTTP ${del.status} ${delBody.code ?? ''}; v2_coach_notes rows before ${before}, after ${after}`);
}

main()
  .catch((e) => { console.error(`staging-smoke: ${e.message}`); results.push(false); })
  .finally(() => {
    const failed = results.filter((r) => !r).length;
    console.log(failed ? `staging-smoke: ${failed} check(s) failed` : 'staging-smoke: all checks passed');
    process.exit(failed || results.length === 0 ? 1 : 0);
  });
