// check-embeds.mjs
//
// Every app query that embeds a related table (`.select('…, other(…)')`) must
// still resolve after a migration. A new foreign key between two tables that
// already had one makes an un-hinted embed ambiguous, and PostgREST answers
// PGRST201 instead of rows — migration 027 did exactly that to
// v2_mesocycles → v2_programs and the app showed no mesocycles (2026-10-04).
// The migration replay can't see it: it is PostgREST's relationship resolution,
// not SQL.
//
// This script finds every `.from('t') … .select('…(…)…')` in src/ and api/ and
// asks a PostgREST server to resolve it with limit=0, so no rows can come back.
//
// Usage:  node scripts/check-embeds.mjs            live: VITE_SUPABASE_URL + anon key,
//                                                  every request filtered to Adam's user_id
//         node scripts/check-embeds.mjs --local URL   a local PostgREST (scripts/check-embeds-local.sh)
//         node scripts/check-embeds.mjs --list     print what it found, probe nothing
// Exit:   0 = every embed resolves; 1 = any doesn't; 2 = couldn't run.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ADAM = '12e79b69-9891-4f53-a7cf-650edd83659f';
// Tables with no user_id column: probed without the Adam filter (limit=0 still returns nothing).
export const NO_USER_ID = new Set(['v2_exercise_libraries', 'v2_exercise_library_items']);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

// One `.from('table')` followed, before the next `.from(`, by a `.select('literal')`
// whose literal contains a parenthesis (an embed).
export function findEmbeds(source, file = '') {
  const found = [];
  // The gap may not cross another `.from(`: otherwise a select-less query would
  // stretch into the next one and swallow it (found 2026-10-04 on sessionService.ts).
  const re = /\.from\(\s*(['"`])([a-z0-9_]+)\1\s*\)((?:(?!\.from\()[\s\S]){0,600}?)\.select\(\s*(['"`])([\s\S]*?)\4/g;
  let m;
  while ((m = re.exec(source))) {
    const select = m[5].replace(/\s+/g, '');
    if (!select.includes('(')) continue;
    found.push({ file, line: source.slice(0, m.index).split('\n').length, table: m[2], select });
  }
  return found;
}

export function probeUrl(base, e, { live }) {
  const filter = live && !NO_USER_ID.has(e.table) ? `&user_id=eq.${ADAM}` : '';
  return `${base}/rest/v1/${e.table}?select=${encodeURIComponent(e.select)}${filter}&limit=0`;
}

async function main() {
  const args = process.argv.slice(2);
  const embeds = ['src', 'api'].flatMap((d) => walk(d)).flatMap((f) => findEmbeds(readFileSync(f, 'utf8'), f));
  if (embeds.length === 0) { console.error('check-embeds: found no embedding selects — the scan is broken. Treat as failed.'); process.exit(2); }
  if (args[0] === '--list') { for (const e of embeds) console.log(`${e.file}:${e.line} ${e.table} ${e.select}`); return; }
  const live = args[0] !== '--local';
  const clean = (v) => (v ?? '').replace(/[^\x21-\x7e]/g, '');
  const base = (live ? clean(process.env.VITE_SUPABASE_URL) : args[1] ?? '').replace(/\/$/, '');
  const key = live ? clean(process.env.VITE_SUPABASE_ANON_KEY) : '';
  if (!base || (live && !key)) { console.error('check-embeds: no target (VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY, or --local URL).'); process.exit(2); }
  // A local PostgREST serves at the root, not under /rest/v1.
  const urlBase = live ? base : base.replace(/\/rest\/v1$/, '');
  let bad = 0;
  for (const e of embeds) {
    const url = live ? probeUrl(urlBase, e, { live }) : probeUrl(urlBase, e, { live }).replace('/rest/v1/', '/');
    let status, body;
    try {
      const res = await fetch(url, { headers: key ? { apikey: key, Authorization: `Bearer ${key}` } : {} });
      status = res.status; body = await res.json().catch(() => null);
    } catch (err) { status = 'ERR'; body = { code: String(err.message || err) }; }
    const ok = status === 200 && Array.isArray(body);
    if (!ok) bad++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${status} ${ok ? '' : (body?.code ?? '') + ' '}${e.file}:${e.line} ${e.table}`);
  }
  console.log(`check-embeds: ${embeds.length} embedding selects, ${embeds.length - bad} resolve, ${bad} don't (${live ? 'live, Adam-filtered' : 'local ' + base}).`);
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
