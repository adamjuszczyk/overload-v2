// compare-schema.mjs
//
// Compares two schema snapshots written by scripts/schema-snapshot.sql — the
// live database and a from-scratch replay of supabase/migrations — and prints
// every difference. Objects are matched by identity and compared field by
// field, so ordering inside the JSON (jsonb doesn't keep it) never matters.
//
// Usage:  node scripts/compare-schema.mjs [--exclude FILE] <live.json> <replay.json>
//   --exclude FILE  names to ignore on both sides, one per line (# comments).
//                   `name` matches an object or anything on a table of that
//                   name; `category:key` matches one object's identity key
//                   (e.g. `columns:exercises.legacy_col`, `schemas:cron`);
//                   `*` is a wildcard. Every line must match something, so a
//                   stale or mistyped exclusion fails instead of hiding nothing.
// Input:  the raw query result in any of the shapes the tools produce — the
//         snapshot object, `[{"snapshot": …}]` (supabase db query -o json),
//         `{rows: [...]}`, or the snapshot as a JSON string.
// Exit:   0 = identical (extension version changes are printed, not counted)
//         1 = at least one difference
//         2 = couldn't compare (bad arguments or unreadable snapshot)

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

// Identity of an object in each category, and the table/name it belongs to
// (what a bare exclusion name is matched against).
export const CATEGORIES = {
  schemas:            { key: o => o.name,                                      owners: o => [o.name] },
  extensions:         { key: o => o.name,                                      owners: o => [o.name] },
  tables:             { key: o => o.name,                                      owners: o => [o.name] },
  columns:            { key: o => `${o.table}.${o.name}`,                      owners: o => [o.table] },
  constraints:        { key: o => `${o.table}.${o.name}`,                      owners: o => [o.table, o.name] },
  indexes:            { key: o => `${o.table}.${o.name}`,                      owners: o => [o.table, o.name] },
  policies:           { key: o => `${o.schema}.${o.table}.${o.name}`,          owners: o => [o.table] },
  functions:          { key: o => `${o.name}(${o.args})`,                      owners: o => [o.name] },
  views:              { key: o => o.name,                                      owners: o => [o.name] },
  triggers:           { key: o => `${o.schema}.${o.table}.${o.name}`,          owners: o => [o.table, o.name] },
  types:              { key: o => o.name,                                      owners: o => [o.name] },
  sequences:          { key: o => o.name,                                      owners: o => [o.name, String(o.owned_by ?? '').split('.')[0]] },
  grants:             { key: o => `${o.object} → ${o.grantee} ${o.privilege}`, owners: o => [grantObjectName(o.object)] },
  default_privileges: { key: o => `${o.role} in ${o.schema} on ${o.object_type} → ${o.grantee} ${o.privilege}`, owners: () => [] },
  comments:           { key: o => o.object,                                    owners: o => [commentObjectName(o.object)] },
};

// "table v2_foo" / "function f(uuid, uuid)" → "v2_foo" / "f"
function grantObjectName(object) {
  return String(object).replace(/^\S+\s+/, '').replace(/\(.*$/, '');
}
// "relation x" / "column x.y" / "function f(a)" → "x" / "x" / "f"
function commentObjectName(object) {
  return grantObjectName(object).split('.')[0];
}

export function loadSnapshot(text) {
  let v = typeof text === 'string' ? JSON.parse(text) : text;
  if (v && !Array.isArray(v) && Array.isArray(v.rows)) v = v.rows;
  if (Array.isArray(v)) {
    if (v.length !== 1) throw new Error(`expected exactly one row, got ${v.length}`);
    v = v[0];
  }
  if (v && typeof v === 'object' && 'snapshot' in v) v = v.snapshot;
  if (typeof v === 'string') v = JSON.parse(v);
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not a snapshot object');
  const missing = Object.keys(CATEGORIES).filter(c => !Array.isArray(v[c]));
  if (missing.length) throw new Error(`snapshot is missing: ${missing.join(', ')}`);
  return v;
}

export function parseExclusions(text) {
  return text.split('\n').map(l => l.replace(/#.*$/, '').trim()).filter(Boolean).map(line => {
    const m = /^([a-z_]+):(.+)$/.exec(line);
    const category = m && CATEGORIES[m[1]] ? m[1] : null;
    const pattern = category ? m[2] : line;
    const re = new RegExp('^' + pattern.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
    return { line, category, re };
  });
}

function excludedBy(exclusions, category, obj) {
  const key = CATEGORIES[category].key(obj);
  const owners = CATEGORIES[category].owners(obj).filter(Boolean);
  return exclusions.find(e => e.category
    ? e.category === category && e.re.test(key)
    : owners.some(n => e.re.test(n)));
}

// Recursively sorted keys, so two equal objects always stringify the same.
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  }
  return v;
}
const same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

// Drops excluded objects (recording which exclusions were used) and re-ranks
// column positions among the columns that remain, so excluding a column
// doesn't shift every column after it.
function prepare(snapshot, exclusions, used) {
  const out = {};
  for (const category of Object.keys(CATEGORIES)) {
    out[category] = snapshot[category].filter(o => {
      const e = excludedBy(exclusions, category, o);
      if (e) used.add(e.line);
      return !e;
    }).map(o => ({ ...o }));
  }
  const byTable = new Map();
  for (const c of [...out.columns].sort((a, b) => a.position - b.position)) {
    const n = (byTable.get(c.table) ?? 0) + 1;
    byTable.set(c.table, n);
    c.position = n;
  }
  return out;
}

export function compare(a, b, exclusions = []) {
  const used = new Set();
  const A = prepare(a, exclusions, used);
  const B = prepare(b, exclusions, used);
  const differences = [];
  const notes = [];
  for (const category of Object.keys(CATEGORIES)) {
    const keyOf = CATEGORIES[category].key;
    const mapA = new Map(A[category].map(o => [keyOf(o), o]));
    const mapB = new Map(B[category].map(o => [keyOf(o), o]));
    for (const [key, oa] of mapA) {
      const ob = mapB.get(key);
      if (!ob) { differences.push({ category, key, kind: 'only-a' }); continue; }
      const fields = [...new Set([...Object.keys(oa), ...Object.keys(ob)])].sort()
        .filter(f => !same(oa[f], ob[f]));
      if (category === 'extensions' && fields.length === 1 && fields[0] === 'version') {
        notes.push({ category, key, field: 'version', a: oa.version, b: ob.version });
        continue;
      }
      for (const field of fields) differences.push({ category, key, kind: 'field', field, a: oa[field], b: ob[field] });
    }
    for (const key of mapB.keys()) if (!mapA.has(key)) differences.push({ category, key, kind: 'only-b' });
  }
  const unused = exclusions.filter(e => !used.has(e.line)).map(e => e.line);
  return { differences, notes, unused };
}

function show(v) { return v === undefined ? '(absent)' : JSON.stringify(v); }

function main(argv) {
  const args = [...argv];
  let excludeFile = null;
  const i = args.indexOf('--exclude');
  if (i !== -1) { excludeFile = args[i + 1]; args.splice(i, 2); }
  if (args.length !== 2 || (i !== -1 && !excludeFile)) {
    console.error('usage: node scripts/compare-schema.mjs [--exclude FILE] <live.json> <replay.json>');
    return 2;
  }
  let a, b, exclusions = [];
  try {
    a = loadSnapshot(readFileSync(args[0], 'utf8').replace(/^﻿/, ''));
    b = loadSnapshot(readFileSync(args[1], 'utf8').replace(/^﻿/, ''));
    if (excludeFile) exclusions = parseExclusions(readFileSync(excludeFile, 'utf8'));
  } catch (e) {
    console.error(`compare-schema: couldn't read the input — ${e.message}. Treat as a difference.`);
    return 2;
  }
  const la = basename(args[0]), lb = basename(args[1]);
  console.log(`compare-schema: ${la} (server ${a.meta?.server_version ?? '?'}) vs ${lb} (server ${b.meta?.server_version ?? '?'})`);
  if (exclusions.length) console.log(`compare-schema: ${exclusions.length} exclusion(s) from ${excludeFile}`);

  const { differences, notes, unused } = compare(a, b, exclusions);
  for (const n of notes) console.log(`  note  extensions ${n.key}: version ${n.a} in ${la}, ${n.b} in ${lb} (not counted)`);
  let current = null;
  for (const d of differences) {
    if (d.category !== current) { current = d.category; console.log(`\n${current}:`); }
    if (d.kind === 'only-a') console.log(`  only in ${la}: ${d.key}`);
    else if (d.kind === 'only-b') console.log(`  only in ${lb}: ${d.key}`);
    else console.log(`  ${d.key} — ${d.field}:\n      ${la}: ${show(d.a)}\n      ${lb}: ${show(d.b)}`);
  }
  for (const line of unused) console.log(`\nexclusion matched nothing: ${line}`);

  const total = differences.length + unused.length;
  if (total === 0) {
    const counts = Object.keys(CATEGORIES).map(c => `${b[c].length} ${c}`).join(', ');
    console.log(`\ncompare-schema: IDENTICAL — ${counts} (before exclusions).`);
    return 0;
  }
  console.log(`\ncompare-schema: ${differences.length} difference(s)${unused.length ? `, ${unused.length} unused exclusion(s)` : ''}. Not identical.`);
  return 1;
}

if (process.argv[1] && basename(process.argv[1]) === 'compare-schema.mjs') {
  process.exit(main(process.argv.slice(2)));
}
