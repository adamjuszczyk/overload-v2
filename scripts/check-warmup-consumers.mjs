// check-warmup-consumers.mjs
//
// Chunk 15 (SPEC "Warmup sets" — "Never counted in volume, set counts, or
// 'last time' matching"). Every set count, number or aggregate in this app
// is built through one of a small set of grouping/matching primitives
// (CONTEXT.md's stage-exclusion rule: "Enforce via setGroupLogic.ts ... or
// the 009/011 views, never ad hoc") — groupSetLogs/groupWeekPlanSets/
// headsOnly (setGroupLogic.ts), buildLoggedSlots/matchSessionsByPosition/
// buildPositionMatchTable (positionMatch.ts), and headSets
// (plannerService.ts, the program-set table's own equivalent of
// headsOnly, since v2_program_sets predates setGroupLogic.ts's generic
// accessor shape). This script finds every file in src/ and api/ that
// calls one of those (test files excluded, same convention as
// check-program-exercise-reads.mjs/check-embeds.mjs) and checks it also
// mentions `isWarmup` or `is_warmup` somewhere — a coarse, auditable proxy
// for "this file filters warmups out of whatever it counts", not a
// semantic proof (a file could mention the word without truly filtering —
// the same class of limitation check-frozen-code.mjs's export-text
// comparison already has, and the same tradeoff check-program-exercise-
// reads.mjs's regex scan makes). A real regression — a brand-new consumer
// added later with no warmup awareness at all — is exactly what this
// catches.
//
// Every match must mention isWarmup/is_warmup, or be on the allowlist
// below with its own reason (same two-list shape as check-program-
// exercise-reads.mjs's ALLOWED_READS). Adding an exception is a visible
// diff to this file.
//
// Usage:  node scripts/check-warmup-consumers.mjs
//         node scripts/check-warmup-consumers.mjs --list   print every match, check nothing
// Exit:   0 = every consumer mentions isWarmup/is_warmup, or is an allowed
//             exception with a reason
//         1 = something isn't — the file(s) are named
//         2 = the scan itself looks broken (zero matches at all — should
//             never happen; sessionService.ts/useExerciseCardState.ts
//             alone guarantee several)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// The set-count/grouping primitives this scan looks for a call to. Order
// doesn't matter; each is matched as a bare identifier immediately
// followed by `(`, so a definition (`export function groupSetLogs(...)`)
// and a call (`groupSetLogs(logs)`) both match alike — deliberate: the one
// file that defines these (setGroupLogic.ts) is itself on the allowlist
// below, with its own reason, so it doesn't matter which shape matched it.
export const PRIMITIVES = [
  'groupSetLogs',
  'groupWeekPlanSets',
  'headsOnly',
  'buildLoggedSlots',
  'matchSessionsByPosition',
  'buildPositionMatchTable',
  'headSets',
];

// ─── Allowed exceptions ────────────────────────────────────────────────────
export const ALLOWED = [
  {
    file: 'src/features/coach/analysisInput.ts',
    reason:
      'Coach (frozen, accepted in SPEC G1 — TASKS.md "Chunk 15": "Coach stays untouched, so Mesocycle ' +
      'Analysis and the Q&A planning context ... will count numbered warmups as working sets").',
  },
  {
    file: 'src/features/coach/mesoAnalysisInput.ts',
    reason: 'Coach (frozen, accepted in SPEC G1) — same as analysisInput.ts above.',
  },
  {
    file: 'src/features/coach/mesoWeekRollup.ts',
    reason: 'Coach (frozen, accepted in SPEC G1) — same.',
  },
  {
    file: 'src/features/coach/qaContext.ts',
    reason: 'Coach (frozen, accepted in SPEC G1) — same.',
  },
  {
    file: 'src/features/coach/weekAnalysisInput.ts',
    reason: 'Coach (frozen, accepted in SPEC G1) — same.',
  },
  {
    file: 'src/features/gym/setGroupLogic.ts',
    reason:
      'Defines groupSetLogs/groupWeekPlanSets/headsOnly generically (frozen — Coach imports this file, ' +
      'check-frozen-code.mjs enforces its exports byte-identical). It has no count or display of its own ' +
      'to filter; warmup exclusion is every CALL SITE\'s own job (see this chunk\'s report for the full list), ' +
      'never this file\'s — adding an isWarmup-aware parameter here would be a frozen-export change.',
  },
];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e) && !/\.test\.tsx?$/.test(e)) out.push(p);
  }
  return out;
}

const CALL_RE = new RegExp(`\\b(${PRIMITIVES.join('|')})\\s*\\(`);
const WARMUP_RE = /isWarmup|is_warmup/;

export function usesAnyPrimitive(source) {
  return CALL_RE.test(source);
}

export function hasWarmupFilter(source) {
  return WARMUP_RE.test(source);
}

function main() {
  const args = process.argv.slice(2);
  const files = ['src', 'api'].flatMap((d) => walk(d));

  const consumers = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    if (usesAnyPrimitive(source)) {
      consumers.push({ file, hasFilter: hasWarmupFilter(source) });
    }
  }

  if (args[0] === '--list') {
    for (const c of consumers) console.log(`${c.file}  ${c.hasFilter ? '(has isWarmup/is_warmup)' : '(NO warmup mention)'}`);
    return 0;
  }

  if (consumers.length === 0) {
    console.error(
      'check-warmup-consumers: found no matches at all — the scan looks broken ' +
        '(sessionService.ts/useExerciseCardState.ts alone should match). Treat as failed.',
    );
    return 2;
  }

  const allowedFiles = new Map(ALLOWED.map((a) => [a.file, a.reason]));
  const problems = [];
  const report = [];
  for (const c of consumers) {
    if (c.hasFilter) {
      report.push(`${c.file} — has its own isWarmup/is_warmup filter`);
      continue;
    }
    const reason = allowedFiles.get(c.file);
    if (reason) {
      report.push(`${c.file} — exception: ${reason}`);
      continue;
    }
    problems.push(c.file);
  }

  // Every allowlisted file must actually have been found by the scan —
  // otherwise the allowlist is stale (names a file that no longer calls
  // any primitive, which would silently hide a real miss if that file
  // later re-added such a call without this script noticing the allowlist
  // itself needs revisiting).
  const consumerFiles = new Set(consumers.map((c) => c.file));
  for (const { file } of ALLOWED) {
    if (!consumerFiles.has(file)) problems.push(`${file}: allowlisted but no longer calls any primitive — remove this entry`);
  }

  console.log(`check-warmup-consumers: ${consumers.length} set-count consumer(s) found:`);
  for (const line of report) console.log(`  - ${line}`);

  if (problems.length) {
    console.log('check-warmup-consumers: FAILED');
    for (const p of problems) console.log(`- ${p}`);
    return 1;
  }

  console.log(
    `check-warmup-consumers: ok — every consumer either filters warmups itself or is an allowed, reasoned exception.`,
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exit(main());
