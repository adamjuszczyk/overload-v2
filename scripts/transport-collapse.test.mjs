// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { collapse, expand, longestRun, RUN_MIN } from './transport-collapse.mjs';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

test('finds the migrations', () => {
  assert.ok(files.length >= 26, `only ${files.length} migrations found`);
});

for (const f of files) {
  test(`${f}: transport expands back exactly and keeps no run of ${RUN_MIN}+`, () => {
    const original = readFileSync(`${dir}/${f}`, 'utf8');
    const transport = collapse(original);
    assert.equal(expand(transport), original);
    assert.ok(longestRun(transport) < RUN_MIN, `run of ${longestRun(transport)} survives`);
  });
}

test('box-drawing banner and non-BMP characters round-trip', () => {
  const s = '-- ═══ x ' + '─'.repeat(75) + '\n' + '😀'.repeat(5) + ' a  b\n\n\n\n';
  assert.equal(expand(collapse(s)), s);
});

test('refuses input that already contains the marker prefix', () => {
  assert.throws(() => collapse('select 1; -- @@R2500x3@@'));
});
