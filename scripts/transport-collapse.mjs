// transport-collapse.mjs
//
// Placeholder-collapse transport for migrations applied by hand in the Supabase
// SQL Editor. A plain paste of long repetitive character runs (box-drawing
// banners) lost characters in migration 021, so every run of RUN_MIN or more
// identical characters is replaced by a marker @@R<hex codepoint>x<count>@@,
// the transport text is pasted, and the browser expands it back before running.
//
// Usage:  node scripts/transport-collapse.mjs <migration.sql> [out.txt]
// Prints the lengths and SHA-256 of the transport and the original, and the
// console snippet that expands the editor text and prints the same two hashes.
// Exit 1 if the round trip is not exact or a long run survives.

import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const RUN_MIN = 4;
const MARKER_PREFIX = '@@R';

// The expansion is kept as source text so the console snippet and this script
// run exactly the same code.
export const EXPAND_SRC =
  "t => t.replace(/@@R([0-9a-f]+)x([0-9]+)@@/g, (_, c, n) => String.fromCodePoint(parseInt(c, 16)).repeat(Number(n)))";
export const expand = (0, eval)(EXPAND_SRC);

export function collapse(text) {
  if (text.includes(MARKER_PREFIX)) throw new Error(`input already contains ${MARKER_PREFIX}; pick another marker`);
  const chars = Array.from(text);
  let out = '';
  for (let i = 0; i < chars.length; ) {
    let j = i;
    while (j < chars.length && chars[j] === chars[i]) j++;
    const n = j - i;
    out += n >= RUN_MIN ? `@@R${chars[i].codePointAt(0).toString(16)}x${n}@@` : chars[i].repeat(n);
    i = j;
  }
  return out;
}

export function longestRun(text) {
  const chars = Array.from(text);
  let best = 0;
  for (let i = 0; i < chars.length; ) {
    let j = i;
    while (j < chars.length && chars[j] === chars[i]) j++;
    best = Math.max(best, j - i);
    i = j;
  }
  return best;
}

export const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
export const charCount = (s) => s.length; // UTF-16 units, as Monaco's getValue().length counts

export function consoleSnippet() {
  return [
    '(async () => {',
    '  const m = window.monaco.editor.getModels()[0];',
    "  const h = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');",
    '  const t = m.getValue();',
    "  console.log('transport', t.length, await h(t));",
    `  m.setValue((${EXPAND_SRC})(t));`,
    '  const y = m.getValue();',
    "  console.log('expanded', y.length, await h(y));",
    '})()',
  ].join('\n');
}

function main() {
  const [src, out] = process.argv.slice(2);
  if (!src) { console.error('usage: node scripts/transport-collapse.mjs <migration.sql> [out.txt]'); process.exit(2); }
  const original = readFileSync(src, 'utf8');
  const transport = collapse(original);
  const roundTrip = expand(transport) === original;
  const run = longestRun(transport);
  if (out) writeFileSync(out, transport);
  const noNl = (s) => (s.endsWith('\n') ? s.slice(0, -1) : s);
  console.log(`source     ${src}`);
  console.log(`transport  ${charCount(transport)} chars  sha256 ${sha256(transport)}`);
  console.log(`           (without its final newline: ${charCount(noNl(transport))} chars  sha256 ${sha256(noNl(transport))})`);
  console.log(`expanded   ${charCount(original)} chars  sha256 ${sha256(original)}`);
  console.log(`           (without its final newline: ${charCount(noNl(original))} chars  sha256 ${sha256(noNl(original))})`);
  console.log(`longest run left in transport: ${run} (must be < ${RUN_MIN})`);
  console.log(`round trip exact: ${roundTrip}`);
  console.log('\nconsole snippet:\n' + consoleSnippet());
  if (!roundTrip || run >= RUN_MIN) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
