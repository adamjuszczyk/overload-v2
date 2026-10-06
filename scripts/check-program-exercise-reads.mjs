// check-program-exercise-reads.mjs
//
// Chunk 9 (TASKS.md "Edit a week's exercises" — "One read path" / "A check,
// not a review item"): src/features/programs/runProgramExercises.ts is the
// only code that reads v2_program_exercises for a run's current (program
// tab) exercise list — "the program tab's list excludes week_only and
// removed_at rows". This scans src/ and api/ (.ts/.tsx, test files
// excluded — same convention as check-embeds.mjs) for three things:
//
//   1. A direct `.from('v2_program_exercises')` chained (within a bounded
//      gap, never crossing another `.from(`) to a `.select(` — any read of
//      the table's own rows, embedded or not. A write with no `.select()`
//      chained (a plain `.update()`/`.delete()`, or an `.insert()` that
//      doesn't ask for the row back) is not a read and is not matched —
//      this check is about reads, not every access to the table.
//   2. An embedded `v2_program_exercises(` or
//      `v2_program_exercises!fkey_name(` fragment inside some OTHER
//      table's `.select(...)` string — the PostgREST embed shape Coach's
//      own files and weekPlanService.ts's week-list reads both use.
//   3. A `.from(<non-literal>)` call anywhere (not just on this table) —
//      `Array.from` excluded — so a dynamic table name can't silently read
//      v2_program_exercises from outside the allowlist below. Each one
//      found must be proven (by its own type or its own call sites, both
//      checked by hand when added) never to resolve to
//      'v2_program_exercises'.
//
// Every match must be inside runProgramExercises.ts itself (the helper —
// skipped entirely, not even counted) or on one of the two allowlists
// below, each entry with its own reason. Adding an exception is a visible
// diff to this file.
//
// Usage:  node scripts/check-program-exercise-reads.mjs
//         node scripts/check-program-exercise-reads.mjs --list   print every match, check nothing
// Exit:   0 = every match is the helper or an allowed exception
//         1 = something isn't — the file(s) are named
//         2 = the scan itself looks broken (zero matches at all — should
//             never happen; Coach's own files alone guarantee several)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const READ_PATH_FILE = 'src/features/programs/runProgramExercises.ts';

// ─── Allowed exceptions — a direct read or an embedded fragment ───────────
// The start function and every migration are SQL, not scanned at all (this
// script only walks .ts/.tsx) — not an exception entry, just out of scope.
export const ALLOWED_READS = [
  {
    file: 'src/features/coach/mesoAnalysisInput.ts',
    reason:
      "Coach (frozen, SPEC: unchanged by this build) — reads a planned set's slot identity " +
      '(exercise_id) through its v2_program_exercises foreign key, which is correct with ' +
      'week-only slots: a week-only row is a normal row with a real exercise_id.',
  },
  {
    file: 'src/features/coach/qaContext.ts',
    reason: 'Coach (frozen) — same foreign-key slot-identity read as mesoAnalysisInput.ts.',
  },
  {
    file: 'api/coach/ask.ts',
    reason: 'Coach (frozen) — same foreign-key slot-identity read, server-side.',
  },
  {
    file: 'src/features/plan/weekPlanService.ts',
    reason:
      "\"A week's list comes through v2_week_plan_exercises\" — already correct before chunk 9 " +
      '(chunk 7): a week-only slot is a normal v2_program_exercises row, so the FK embed ' +
      '(v2_program_exercises!v2_week_plan_exercises_program_exercise_id_fkey) needs no ' +
      'special-casing. Restructuring this heavily-tested, performance-sensitive fetch path into ' +
      'two round trips just to relocate the embed string would add real regression risk for no ' +
      'behavioural change — see runProgramExercises.ts\'s own header for the full reasoning.',
  },
  {
    file: 'src/features/programs/programService.ts',
    reason:
      "addProgramExercise's own insert().select() — a brand-new row with explicit week_only: " +
      'false (the column default) and no removed_at; its own return value needs no filtering, ' +
      'since nothing about this one call can ever produce a week-only or removed row. ' +
      '(fetchProgramExercises/deleteProgramExercise delegate to the helper and carry no ' +
      'exception of their own.)',
  },
  {
    file: 'src/features/history/historyService.ts',
    reason:
      "Session-history display — builds a position map for labelling, across EVERY program " +
      "exercise of a workout day regardless of week_only/removed_at. Not a run's current list; " +
      'unaffected by this chunk.',
  },
  {
    file: 'src/features/library/reassignService.ts',
    reason:
      'Exercise reassignment preview/merge — counts/collisions across every program-exercise row ' +
      'referencing a given exercise_id, cross-program by design (a lost/merged exercise\'s history, ' +
      'not a run\'s current volume). Unaffected by this chunk.',
  },
  {
    file: 'src/features/library/exerciseService.ts',
    reason:
      'Exercise delete preview/cleanup — same cross-program reasoning as reassignService.ts.',
  },
];

// ─── Allowed exceptions — a `.from(<non-literal>)` call ───────────────────
export const ALLOWED_DYNAMIC_FROM = [
  {
    file: 'src/features/coach/qaContext.ts',
    reason:
      'A code comment ("every `.from(...)` call in this file names...") — the literal `...` inside ' +
      'it reads as a non-string argument to this scan\'s regex; there is no call there at all.',
  },
  {
    file: 'src/features/library/reassignService.ts',
    reason:
      "countAnalysesReferencing(table: 'v2_coach_session_analyses' | 'v2_coach_week_analyses', ...) " +
      "— table's own TYPE is a two-value union, neither of them v2_program_exercises; it cannot " +
      'resolve to it, checked at every call site.',
  },
  {
    file: 'src/features/offline/useSyncQueue.ts',
    reason:
      'flushSyncQueue reads item.table from the offline sync queue (Dexie). Every push site today ' +
      "uses a literal table name (useSession.ts: 'v2_sessions'/'v2_set_logs'; useCoachNotes.ts: " +
      "'v2_coach_notes') — grepped, never v2_program_exercises. Re-check this exception if a " +
      'future caller ever queues a program-exercise write through here.',
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

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

// A direct `.from('v2_program_exercises')` chained (never crossing another
// `.from(`) to a `.select(`. Same gap-matching shape as check-embeds.mjs's
// own findEmbeds, minus its "the select string must contain a paren"
// requirement — a plain, un-embedded select (e.g. historyService.ts's
// `.select('exercise_id, position')`) is still a read of this table.
const DIRECT_RE = /\.from\(\s*(['"`])v2_program_exercises\1\s*\)((?:(?!\.from\()[\s\S]){0,600}?)\.select\(/g;

// `v2_program_exercises(` or `v2_program_exercises!fkey_name(` anywhere —
// the PostgREST embed shape, wherever it appears (its own `.from()` names a
// DIFFERENT table; that is the whole point of an embed). Cannot collide
// with a direct `.from('v2_program_exercises')` token: a quote character
// always sits between the table name and the closing `)` there, never an
// open paren.
const EMBEDDED_RE = /v2_program_exercises(?:![A-Za-z0-9_]+)?\(/g;

// `.from(<non-literal>)` anywhere, Array.from excluded. Matches a bare
// identifier, a property access (item.table), a function call, or — the
// one accepted false positive, see ALLOWED_DYNAMIC_FROM — plain comment
// text that happens to parse as one.
const DYNAMIC_FROM_RE = /(?<!Array)\.from\(\s*([^'"`)][^)]*)\)/g;

export function findReads(source) {
  const reads = [];
  for (const m of source.matchAll(DIRECT_RE)) reads.push({ kind: 'direct', index: m.index });
  for (const m of source.matchAll(EMBEDDED_RE)) reads.push({ kind: 'embedded', index: m.index });
  return reads;
}

export function findDynamicFrom(source) {
  return [...source.matchAll(DYNAMIC_FROM_RE)].map((m) => ({ index: m.index, snippet: m[1].trim() }));
}

function main() {
  const args = process.argv.slice(2);
  const files = ['src', 'api'].flatMap((d) => walk(d));

  const readsByFile = new Map();
  const dynamicByFile = new Map();
  let totalReads = 0;
  let totalDynamic = 0;

  for (const file of files) {
    if (file === READ_PATH_FILE) continue; // the helper itself — not an exception, the destination
    const source = readFileSync(file, 'utf8');

    const reads = findReads(source);
    if (reads.length) {
      readsByFile.set(file, reads.map((r) => ({ ...r, line: lineOf(source, r.index) })));
      totalReads += reads.length;
    }

    const dynamics = findDynamicFrom(source);
    if (dynamics.length) {
      dynamicByFile.set(file, dynamics.map((d) => ({ ...d, line: lineOf(source, d.index) })));
      totalDynamic += dynamics.length;
    }
  }

  if (args[0] === '--list') {
    for (const [file, reads] of readsByFile) {
      for (const r of reads) console.log(`${file}:${r.line} ${r.kind}`);
    }
    for (const [file, dynamics] of dynamicByFile) {
      for (const d of dynamics) console.log(`${file}:${d.line} dynamic-from(${d.snippet})`);
    }
    return;
  }

  if (totalReads === 0 && totalDynamic === 0) {
    console.error(
      'check-program-exercise-reads: found no matches at all — the scan looks broken ' +
        '(Coach\'s own files alone should match). Treat as failed.',
    );
    process.exit(2);
  }

  const allowedReadFiles = new Map(ALLOWED_READS.map((a) => [a.file, a.reason]));
  const allowedDynamicFiles = new Map(ALLOWED_DYNAMIC_FROM.map((a) => [a.file, a.reason]));

  const problems = [];
  for (const [file, reads] of readsByFile) {
    if (allowedReadFiles.has(file)) continue;
    for (const r of reads) problems.push(`${file}:${r.line} — ${r.kind} read of v2_program_exercises outside ${READ_PATH_FILE}`);
  }
  for (const [file, dynamics] of dynamicByFile) {
    if (allowedDynamicFiles.has(file)) continue;
    for (const d of dynamics) problems.push(`${file}:${d.line} — dynamic .from(${d.snippet}) not on the allowlist (could resolve to v2_program_exercises)`);
  }

  if (problems.length) {
    console.log('check-program-exercise-reads: FAILED');
    for (const p of problems) console.log(`- ${p}`);
    process.exit(1);
  }

  console.log(
    `check-program-exercise-reads: ok — ${totalReads} read(s) of v2_program_exercises ` +
      `(${readsByFile.size} file(s), every one the helper or an allowed exception) and ` +
      `${totalDynamic} dynamic .from() call(s) (${dynamicByFile.size} file(s), every one allowlisted).`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
