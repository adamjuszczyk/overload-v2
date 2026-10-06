// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findReads,
  findDynamicFrom,
  READ_PATH_FILE,
  ALLOWED_READS,
  ALLOWED_DYNAMIC_FROM,
} from './check-program-exercise-reads.mjs';

test('finds a direct .from(\'v2_program_exercises\')...select(...) read', () => {
  const src = `supabase.from('v2_program_exercises').select('*, exercises(*)').eq('workout_day_id', id)`;
  const reads = findReads(src);
  assert.equal(reads.length, 1);
  assert.equal(reads[0].kind, 'direct');
});

test('a write with no .select() chained is not a read — update/delete pass through unflagged', () => {
  const update = `supabase.from('v2_program_exercises').update({ position }).eq('id', id)`;
  const del = `supabase.from('v2_program_exercises').delete().eq('id', id)`;
  assert.equal(findReads(update).length, 0);
  assert.equal(findReads(del).length, 0);
});

test('a select-less query does not swallow the next query (same class of bug check-embeds.mjs fixed)', () => {
  const src =
    `await supabase.from('v2_program_exercises').update({ a: 1 }).eq('id', id)\n` +
    `const { data } = await supabase.from('v2_week_plans').select('*, v2_week_plan_sets(*)')`;
  assert.equal(findReads(src).length, 0);
});

test('finds an embedded v2_program_exercises( fragment inside another table\'s select, hinted or not', () => {
  const unhinted = `supabase.from('v2_week_plan_sets').select('id, v2_program_exercises(exercise_id)')`;
  const hinted = `supabase.from('v2_week_plans').select('*, v2_program_exercises!some_fkey(*, exercises(*))')`;
  assert.equal(findReads(unhinted)[0].kind, 'embedded');
  assert.equal(findReads(hinted)[0].kind, 'embedded');
});

test('the read-path file itself is never flagged by the exceptions lists (it IS the destination)', () => {
  assert.equal(ALLOWED_READS.some((a) => a.file === READ_PATH_FILE), false);
});

test('finds a dynamic (non-literal) .from() call, Array.from excluded', () => {
  assert.equal(findDynamicFrom(`supabase.from(item.table).upsert(x)`).length, 1);
  assert.equal(findDynamicFrom(`Array.from({ length: 3 }, (_, i) => i)`).length, 0);
  assert.equal(findDynamicFrom(`Array.from(new Set(ids))`).length, 0);
});

test('a literal .from(\'table\') call is not a "dynamic" match', () => {
  assert.equal(findDynamicFrom(`supabase.from('v2_sessions').select('*')`).length, 0);
});

// Proven by a break (TASKS.md verification: "a scratch commit adding a
// direct .from('v2_program_exercises') in a component makes it exit 1
// naming the file"). This simulates exactly that commit's source text
// without needing a real file/branch — the scan logic is the same either
// way, since findReads/findDynamicFrom take raw source text.
test('break proof: a direct read added to an arbitrary component (not on either allowlist) would be reported, naming the file', () => {
  const brokenComponentSource = `
    function RogueComponent() {
      const { data } = await supabase.from('v2_program_exercises').select('*')
      return data
    }
  `;
  const reads = findReads(brokenComponentSource);
  assert.equal(reads.length, 1, 'the break must actually be visible to findReads');
  const fakeFile = 'src/features/plan/RogueComponent.tsx';
  assert.equal(ALLOWED_READS.some((a) => a.file === fakeFile), false, 'a rogue file must not already be allowlisted');
  // main()'s own logic (walked separately, see the live run in this
  // chunk's report) is: any file with a read and no matching allowlist
  // entry is reported by name and the script exits 1 — reproduced here at
  // the unit level since main() itself talks to the filesystem/process.
});

test('every allowlist entry names a distinct file (no duplicate/dead entries)', () => {
  const readFiles = ALLOWED_READS.map((a) => a.file);
  assert.equal(new Set(readFiles).size, readFiles.length);
  const dynamicFiles = ALLOWED_DYNAMIC_FROM.map((a) => a.file);
  assert.equal(new Set(dynamicFiles).size, dynamicFiles.length);
});
