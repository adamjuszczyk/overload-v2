// check-context-size.mjs
//
// Fails when CONTEXT.md is over the ceiling in BUILD.md. The reviewer runs every
// script at every chunk boundary, so the ceiling enforces itself.
// Hitting it means prune — move what's no longer true into HISTORY.md — not raise.
//
// Usage: node scripts/check-context-size.mjs
// Exit:  0 = under the ceiling, 1 = over it, 2 = CONTEXT.md not found

import { statSync } from 'node:fs';

const CEILING_KB = 75;
const limit = CEILING_KB * 1024;

let size;
try {
  size = statSync('CONTEXT.md').size;
} catch {
  console.error('check-context-size: CONTEXT.md not found in the repo root.');
  process.exit(2);
}

const kb = (size / 1024).toFixed(1);
if (size > limit) {
  console.log(`check-context-size: OVER — CONTEXT.md is ${kb} KB, ceiling is ${CEILING_KB} KB. Prune: move anything no longer true into HISTORY.md.`);
  process.exit(1);
}
console.log(`check-context-size: ok — CONTEXT.md is ${kb} KB of ${CEILING_KB} KB.`);
