// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { PRIMITIVES, ALLOWED, usesAnyPrimitive, hasWarmupFilter } from './check-warmup-consumers.mjs';

test('usesAnyPrimitive matches a call to each listed primitive', () => {
  for (const name of PRIMITIVES) {
    assert.ok(usesAnyPrimitive(`const x = ${name}(logs)`), `${name} should match as a call`);
  }
});

test('usesAnyPrimitive matches a definition too (setGroupLogic.ts itself)', () => {
  assert.ok(usesAnyPrimitive('export function groupSetLogs(logs) { return [] }'));
});

test('usesAnyPrimitive does not match an unrelated identifier', () => {
  assert.equal(usesAnyPrimitive('const x = headsOnlyish(logs)'), false);
  assert.equal(usesAnyPrimitive('const x = computeTotal(logs)'), false);
});

test('hasWarmupFilter: break proof — a real consumer shape with no warmup mention fails', () => {
  const noFilter = `
    import { groupSetLogs } from './setGroupLogic'
    export function totalSets(logs) {
      return groupSetLogs(logs).length
    }
  `;
  assert.equal(usesAnyPrimitive(noFilter), true);
  assert.equal(hasWarmupFilter(noFilter), false);
});

test('hasWarmupFilter: the same shape, with the fix this chunk makes everywhere, passes', () => {
  const withFilter = `
    import { groupSetLogs } from './setGroupLogic'
    export function totalSets(logs) {
      return groupSetLogs(logs).filter((g) => !g.head.isWarmup).length
    }
  `;
  assert.equal(hasWarmupFilter(withFilter), true);
});

test('hasWarmupFilter also recognises the snake_case DB column name (is_warmup)', () => {
  assert.equal(hasWarmupFilter('rows.filter((r) => !r.is_warmup)'), true);
});

test('every ALLOWED entry names a real file in this repo', () => {
  for (const { file } of ALLOWED) {
    assert.ok(existsSync(file), `${file}: does not exist — stale allowlist entry`);
  }
});

test('every ALLOWED entry has a non-empty reason', () => {
  for (const { file, reason } of ALLOWED) {
    assert.ok(reason && reason.trim().length > 0, `${file}: empty reason`);
  }
});
