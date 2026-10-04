// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findEmbeds, probeUrl, ADAM } from './check-embeds.mjs';

test('finds an embed and ignores a select with no embed', () => {
  const src = `a.from('t1').select('id, name')\nb.from('t2').eq('x', 1).select('*, other(id)')`;
  const f = findEmbeds(src, 'f.ts');
  assert.equal(f.length, 1);
  assert.deepEqual([f[0].table, f[0].select, f[0].line], ['t2', '*,other(id)', 2]);
});

test('a select-less query does not swallow the next query (the sessionService.ts:466 case)', () => {
  const src = `await supabase.from('v2_sessions').update({ a: 1 }).eq('id', id)\n` +
    `const { data } = await supabase\n  .from('v2_set_logs')\n  .select('*, exercises(*), v2_sessions(id, status)')`;
  const f = findEmbeds(src, 'f.ts');
  assert.equal(f.length, 1);
  assert.equal(f[0].table, 'v2_set_logs');
  assert.equal(f[0].select, '*,exercises(*),v2_sessions(id,status)');
});

test('live probes are Adam-filtered and limit=0; the library tables skip the filter', () => {
  const u = probeUrl('https://x', { table: 'v2_mesocycles', select: '*,v2_programs(id)' }, { live: true });
  assert.match(u, new RegExp(`user_id=eq\\.${ADAM}&limit=0$`));
  assert.doesNotMatch(probeUrl('https://x', { table: 'v2_exercise_libraries', select: 'a(b)' }, { live: true }), /user_id/);
  assert.doesNotMatch(probeUrl('https://x', { table: 'v2_mesocycles', select: 'a(b)' }, { live: false }), /user_id/);
});
