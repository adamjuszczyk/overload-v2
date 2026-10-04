// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportedStatements, compareExports, FROZEN_EXPORT_FILES } from './check-frozen-code.mjs';

const src = `import x from 'y';
const hidden = 1;
export function a(n: number) { return n + 1; }
export const b = 2, c = 3;
export interface I { k: string }
export type T = 'p' | 'q';
`;

test('collects every exported top-level statement by name', () => {
  assert.deepEqual([...exportedStatements(src).keys()].sort(), ['I', 'T', 'a', 'b', 'c']);
});

test('identical source passes, a new export passes', () => {
  assert.deepEqual(compareExports(src, src, 'f.ts'), []);
  assert.deepEqual(compareExports(src, src + 'export const d = 4;\n', 'f.ts'), []);
});

test('a changed export body fails, naming it', () => {
  assert.deepEqual(compareExports(src, src.replace('n + 1', 'n + 2'), 'f.ts'), ['f.ts: export a changed']);
});

test('a removed export fails, naming it', () => {
  assert.deepEqual(compareExports(src, src.replace("export type T = 'p' | 'q';\n", ''), 'f.ts'), ['f.ts: export T removed']);
});

test('the real frozen files parse and have exports', () => {
  for (const f of FROZEN_EXPORT_FILES) {
    assert.ok(exportedStatements(readFileSync(f, 'utf8'), f).size > 0, `${f}: no exports found`);
  }
});
