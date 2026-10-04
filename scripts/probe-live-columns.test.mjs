// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probeUrls, judge, ADAM, CONTROL_COLUMN } from './probe-live-columns.mjs';

test('every probe is filtered to Adam; column and control probes carry limit=0', () => {
  const urls = probeUrls('https://x', 'v2_t', ['id', 'a'], { isNew: true });
  assert.equal(urls.length, 3);
  for (const u of urls) assert.match(u.url, new RegExp(`user_id=eq\\.${ADAM}`));
  assert.match(urls[0].url, /select=id,a&.*limit=0$/);
  assert.match(urls[1].url, new RegExp(`select=${CONTROL_COLUMN}&.*limit=0$`));
  assert.equal(probeUrls('https://x', 'v2_t', ['id'], { isNew: false }).length, 2);
});

test('judge: 200 [] passes, a row or a 400 fails a column probe; only 400/42703 passes the control', () => {
  const col = { expect: 200 }, ctl = { expect: 400 };
  assert.equal(judge(col, 200, []), true);
  assert.equal(judge(col, 200, [{ id: 1 }]), false);
  assert.equal(judge(col, 400, { code: '42703' }), false);
  assert.equal(judge(ctl, 400, { code: '42703' }), true);
  assert.equal(judge(ctl, 200, []), false);
  assert.equal(judge(ctl, 400, { code: 'PGRST' }), false);
});

test('the 027 spec lists 72 columns over 15 tables, six of them new', () => {
  const spec = JSON.parse(readFileSync('scripts/probe-specs/027.json', 'utf8'));
  assert.equal(Object.values(spec.columns).flat().length, 72);
  assert.equal(Object.keys(spec.columns).length, 15);
  assert.equal(spec.new.length, 6);
  for (const t of spec.new) assert.ok(spec.columns[t].includes('id'));
});
