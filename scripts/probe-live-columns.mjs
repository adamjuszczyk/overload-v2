// probe-live-columns.mjs
//
// Read-only live schema probe after a migration deploys. For every table in a
// spec file it asks PostgREST, with the anon key and no session, for the listed
// columns filtered to Adam's user_id with limit=0 — rows can never come back
// (anon + RLS + limit 0) — and expects 200 []. A made-up column per table is the
// control and must answer 400 / 42703, so "missing" and "present" give different
// signals. Tables marked new also get one Adam-filtered select without a limit,
// which must answer 200 [] (anon sees no rows).
//
// Usage:  node scripts/probe-live-columns.mjs <spec.json>
//   spec: { "new": ["v2_x", …], "columns": { "v2_x": ["id", "col", …], … } }
// Needs:  VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY.
// Exit:   0 = every probe as expected; 1 = any unexpected answer; 2 = couldn't run.

import { readFileSync } from 'node:fs';

export const ADAM = '12e79b69-9891-4f53-a7cf-650edd83659f';
export const CONTROL_COLUMN = 'zz_probe_no_such_column';
const clean = (v) => (v ?? '').replace(/[^\x21-\x7e]/g, '');

export function probeUrls(base, table, columns, { isNew }) {
  const t = `${base}/rest/v1/${table}`;
  const urls = [
    { kind: 'columns', expect: 200, url: `${t}?select=${columns.join(',')}&user_id=eq.${ADAM}&limit=0` },
    { kind: 'control', expect: 400, url: `${t}?select=${CONTROL_COLUMN}&user_id=eq.${ADAM}&limit=0` },
  ];
  if (isNew) urls.push({ kind: 'anon rows', expect: 200, url: `${t}?select=id&user_id=eq.${ADAM}` });
  return urls;
}

export function judge(probe, status, body) {
  if (probe.expect === 200) return status === 200 && Array.isArray(body) && body.length === 0;
  return status === 400 && body && body.code === '42703';
}

async function main() {
  const specPath = process.argv[2];
  if (!specPath) { console.error('usage: node scripts/probe-live-columns.mjs <spec.json>'); process.exit(2); }
  const base = clean(process.env.VITE_SUPABASE_URL).replace(/\/$/, '');
  const key = clean(process.env.VITE_SUPABASE_ANON_KEY);
  if (!base || !key) { console.error('probe-live-columns: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing.'); process.exit(2); }
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));
  const isNew = new Set(spec.new ?? []);
  let bad = 0, total = 0;
  for (const [table, columns] of Object.entries(spec.columns)) {
    for (const p of probeUrls(base, table, columns, { isNew: isNew.has(table) })) {
      total++;
      let status, body;
      try {
        const res = await fetch(p.url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        status = res.status;
        body = await res.json().catch(() => null);
      } catch (e) { status = 'ERR'; body = String(e.message || e); }
      const ok = judge(p, status, body);
      if (!ok) bad++;
      const detail = Array.isArray(body) ? `[${body.length} rows]` : body?.code ?? JSON.stringify(body)?.slice(0, 80);
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${table.padEnd(28)} ${p.kind.padEnd(9)} ${status} ${detail}${p.kind === 'columns' ? ` (${columns.length} columns)` : ''}`);
    }
  }
  console.log(`probe-live-columns: ${total} probes, ${total - bad} as expected, ${bad} not.`);
  process.exit(bad ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
