// compare-schema.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// Each test injects one difference the script claims to catch and checks that
// it fails on it (and passes without it), through the real CLI.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CATEGORIES } from './compare-schema.mjs';

const SCRIPT = new URL('./compare-schema.mjs', import.meta.url).pathname;

function base() {
  return {
    meta: { server_version: '17.6', taken_at: 'x' },
    schemas: [{ name: 'public', owner: 'pg_database_owner' }],
    extensions: [{ name: 'pgcrypto', schema: 'extensions', version: '1.3' }],
    tables: [
      { name: 'v2_programs', kind: 'r', owner: 'postgres', rls: true, rls_forced: false, options: [] },
      { name: 'ns_widgets', kind: 'r', owner: 'postgres', rls: true, rls_forced: false, options: [] },
    ],
    columns: [
      { table: 'v2_programs', name: 'id', position: 1, type: 'uuid', not_null: true, default: 'gen_random_uuid()', identity: null, generated: null, collation: null },
      { table: 'v2_programs', name: 'name', position: 2, type: 'text', not_null: true, default: null, identity: null, generated: null, collation: null },
      { table: 'ns_widgets', name: 'id', position: 1, type: 'uuid', not_null: true, default: null, identity: null, generated: null, collation: null },
    ],
    constraints: [{ table: 'v2_programs', name: 'v2_programs_pkey', type: 'p', definition: 'PRIMARY KEY (id)', deferrable: false, deferred: false, validated: true }],
    indexes: [{ table: 'v2_programs', name: 'v2_programs_pkey', definition: 'CREATE UNIQUE INDEX v2_programs_pkey ON public.v2_programs USING btree (id)' }],
    policies: [{ schema: 'public', table: 'v2_programs', name: 'own', permissive: 'PERMISSIVE', roles: ['public'], command: 'ALL', using: '(user_id = auth.uid())', with_check: '(user_id = auth.uid())' }],
    functions: [{ name: 'f', args: 'p uuid', kind: 'f', returns: 'void', language: 'plpgsql', security_definer: false, volatility: 'v', strict: false, config: [], owner: 'postgres', body_md5: 'abc', body_length: 10 }],
    views: [{ name: 'v2_view', kind: 'v', owner: 'postgres', options: ['security_invoker=true'], definition: ' SELECT 1;' }],
    triggers: [{ schema: 'public', table: 'v2_programs', name: 't', enabled: 'O', definition: 'CREATE TRIGGER t …' }],
    types: [{ name: 'mood', kind: 'e', labels: ['a', 'b'], base: null, not_null: false, default: null }],
    sequences: [{ name: 's', type: 'bigint', start: 1, increment: 1, min: 1, max: 9, cache: 1, cycle: false, owned_by: null }],
    grants: [{ object: 'table v2_programs', grantee: 'authenticated', privilege: 'SELECT', grantable: false }],
    default_privileges: [{ role: 'postgres', schema: 'public', object_type: 'r', grantee: 'anon', privilege: 'SELECT', grantable: false }],
    comments: [{ object: 'relation v2_programs', comment: 'programs' }],
  };
}

const dir = mkdtempSync(join(tmpdir(), 'compare-schema-'));
let n = 0;
function run(a, b, exclude) {
  const fa = join(dir, `a${++n}.json`), fb = join(dir, `b${n}.json`);
  writeFileSync(fa, Buffer.isBuffer(a) ? a : typeof a === 'string' ? a : JSON.stringify(a));
  writeFileSync(fb, typeof b === 'string' ? b : JSON.stringify(b));
  const args = [SCRIPT];
  if (exclude !== undefined) {
    const fe = join(dir, `e${n}.txt`);
    writeFileSync(fe, exclude);
    args.push('--exclude', fe);
  }
  args.push(fa, fb);
  try {
    return { code: 0, out: execFileSync(process.execPath, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) };
  }
}

test('identical snapshots pass', () => {
  const r = run(base(), base());
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /IDENTICAL/);
});

test('every category catches a changed field, a missing object and an extra object', () => {
  for (const category of Object.keys(CATEGORIES)) {
    const changed = base();
    const obj = changed[category][0];
    const field = Object.keys(obj).find(k => !['name', 'table', 'schema', 'args', 'object', 'grantee', 'privilege', 'role', 'object_type', 'version', 'position'].includes(k));
    obj[field] = typeof obj[field] === 'boolean' ? !obj[field] : `${JSON.stringify(obj[field])}-changed`;
    let r = run(base(), changed);
    assert.equal(r.code, 1, `${category}.${field} change not caught:\n${r.out}`);
    assert.match(r.out, new RegExp(`${category}:`));

    const removed = base();
    removed[category] = removed[category].slice(1);
    r = run(base(), removed);
    assert.equal(r.code, 1, `${category} missing object not caught:\n${r.out}`);
    assert.match(r.out, /only in a\d+\.json/);

    const added = base();
    added[category] = [...added[category], { ...added[category][0], name: 'zz_extra', object: 'table zz_extra', table: 'zz_extra', grantee: 'zz_extra' }];
    r = run(base(), added);
    assert.equal(r.code, 1, `${category} extra object not caught:\n${r.out}`);
    assert.match(r.out, /only in b\d+\.json/);
  }
});

test('key order inside objects and arrays of objects does not matter', () => {
  const b = base();
  b.tables.reverse();
  b.columns = b.columns.map(c => Object.fromEntries(Object.entries(c).reverse())).reverse();
  assert.equal(run(base(), b).code, 0);
});

test('column order is compared', () => {
  const b = base();
  b.columns[0].position = 2;
  b.columns[1].position = 1;
  const r = run(base(), b);
  assert.equal(r.code, 1);
  assert.match(r.out, /position/);
});

test('an extension version change is a note, not a difference; a missing extension is a difference', () => {
  const b = base();
  b.extensions[0].version = '1.4';
  let r = run(base(), b);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /note {2}extensions pgcrypto: version 1.3/);
  const c = base();
  c.extensions = [];
  r = run(base(), c);
  assert.equal(r.code, 1);
});

test('exclusions: a bare name drops the table and everything on it; category:key drops one object', () => {
  const replay = base();
  replay.tables = replay.tables.filter(t => t.name !== 'ns_widgets');
  replay.columns = replay.columns.filter(c => c.table !== 'ns_widgets');
  assert.equal(run(base(), replay).code, 1, 'Northstar table should differ without the exclusion');
  assert.equal(run(base(), replay, '# Northstar\nns_widgets\n').code, 0);
  assert.equal(run(base(), replay, 'ns_*\n').code, 0, 'wildcard');

  // a column only one side has, excluded by category:key; positions re-ranked
  const live = base();
  live.columns.splice(1, 0, { ...live.columns[0], name: 'legacy', position: 2 });
  live.columns[2].position = 3;
  assert.equal(run(live, base(), 'ns_widgets\n').code, 1);
  assert.equal(run(live, base(), 'ns_widgets\ncolumns:v2_programs.legacy\n').code, 0);
});

test('an exclusion that matches nothing fails', () => {
  const r = run(base(), base(), 'no_such_table\n');
  assert.equal(r.code, 1);
  assert.match(r.out, /exclusion matched nothing: no_such_table/);
});

test('accepts every input shape the tools produce', () => {
  const s = base();
  assert.equal(run([{ snapshot: s }], s).code, 0, 'supabase db query -o json');
  assert.equal(run({ rows: [{ snapshot: s }] }, s).code, 0, 'rows envelope');
  assert.equal(run([{ snapshot: JSON.stringify(s) }], s).code, 0, 'snapshot as a string');
  assert.equal(run('\uFEFF' + JSON.stringify(s), s).code, 0, 'BOM');
  const ps = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(JSON.stringify([{ snapshot: s }], null, 2).replace(/\n/g, '\r\n'), 'utf16le')]);
  assert.equal(run(ps, s).code, 0, 'UTF-16LE with BOM and CRLF (Windows PowerShell >)');
});

test('unreadable or incomplete input exits 2, never 0', () => {
  assert.equal(run('not json', base()).code, 2);
  assert.equal(run([], base()).code, 2);
  const partial = base();
  delete partial.policies;
  assert.equal(run(partial, base()).code, 2);
});
