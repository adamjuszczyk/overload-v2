// check-wording.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// Chunk 69 (SPEC.md, Language [1.2]): the UI never says "meso", "mesocycle" or "run" (C12: the running copy is
// the "current program", finished ones are "finished programs"); "Tags are 'cues' in the UI"; the planner screen
// and its button say "change the program", never "change the plan". This is the standing check that no screen
// went back: it reads every .ts / .tsx file under src/ with the TypeScript parser and fails on any of those words
// in what a person can read.
//
// What it reads (and what it doesn't)
//   - Read: JSX text (the words between tags), and every string literal and template piece in the file, which is
//     where a screen's words live (JSX attributes such as placeholder, aria-label and title; constants, object
//     labels, ternaries, returned and thrown messages: an Error's message reaches the screen through the
//     "real reason" lines, SPEC Errors). console.* messages count too, to keep the rule one rule.
//   - Not read: comments (they are not parsed as tokens); code identifiers, routes, table names and query keys
//     (SPEC: "Internal names (tables, code, routes) don't change"), which never appear as JSX text and, as strings,
//     look like code. A string counts as CODE, not words, when it is ONE token (no whitespace) that does not start
//     with a capital: 'tags', 'meso-1', '/meso/:mesocycleId/priorities', 'v2_mesocycles', 'mesocycleId',
//     'runService'. So is an argument of a query call (.from, .select, .eq, .order, .rpc, ...): a column list such as
//     'id, tags, mesocycle_id' is names. The same word in JSX text, in a text attribute (placeholder, title,
//     aria-label, alt, label, ...), or as a capitalised or multi-word string ('RUN', 'Tags', 'NO MESO',
//     "the run's workouts") is words.
//   - Not scanned: src/features/coach/** (Coach is frozen; this is also what keeps the G50 exception in place:
//     MesoPrioritiesPage.tsx, a pre-1.1 finished program's priorities page, "opens as it is, wording included",
//     SPEC G50, lives there), test files (*.test.ts / *.test.tsx), test support (*.testutil.ts / *.testutil.tsx,
//     src/testing/, __fixtures__ and __tests__ folders) and .d.ts files.
//   - The words are whole words, so STAGE is not "tag", "mesocycleId" is not "mesocycle" and "running" is not "run".
//     "tag" covers tag, tags, untagged, tagged and tagging; "meso" covers meso, mesos, mesocycle and mesocycles.
//
// The allowlist (ALLOWED below) is the only way a hit passes. Each entry names the file, the exact text, the rule
// and why, and a test fails if an entry no longer matches anything (a stale exception is a hole). Today it holds
// the Library's two muscle-tag labels, DECISIONS 215 (a): EDIT TAGS and UNTAGGED are about an exercise's muscle
// tags (SPEC Library), not the set tags that SPEC renames to cues. Adding an entry is a visible diff to this file.
//
// How it is proven: the tree test below fails on `staging` before chunk 69 (it lists every old string, file by
// file) and passes after; the "call patterns" tests run the scanner over small sources, one per way a string
// reaches a screen (JSX text, a text after an element, an attribute, a ternary, an object label, a template, a
// thrown message), each of which must be caught, beside the code-like strings it must let through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ─── The rules ─────────────────────────────────────────────────────────────────────────────────────────────────────
export const FAMILIES = [
  { id: 'meso', re: /\bmeso(?:s|cycles?)?\b/i, rule: 'SPEC Language [1.2] (C12): the UI never says "meso" or "mesocycle"; it says "program"' },
  { id: 'run', re: /\bruns?\b/i, rule: 'SPEC Language [1.2] (C12): the UI never says "run"; it is the "current program" / a "finished program"' },
  { id: 'tag', re: /\b(?:un)?tag(?:s|ged|ging)?\b/i, rule: 'SPEC Language [1.2]: tags are "cues" in the UI' },
  { id: 'change-the-plan', re: /\bchange\s+(?:the\s+)?plan\b/i, rule: 'SPEC Language [1.2]: the planner and its button say "change the program", never "change the plan"' },
];

// Attributes whose value is a name, a path, a class or a style, never words.
const NON_TEXT_ATTRS = new Set([
  'className', 'style', 'id', 'key', 'ref', 'htmlFor', 'name', 'type', 'to', 'href', 'path', 'role', 'rel', 'target',
  'inputMode', 'autoComplete', 'autoCapitalize', 'pattern', 'viewBox', 'd', 'fill', 'stroke', 'xmlns', 'width', 'height', 'src', 'srcSet', 'method',
]);
// Attributes whose value is read by a person (or a screen reader), whatever it looks like.
const TEXT_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'aria-description', 'aria-placeholder', 'alt', 'label', 'children', 'description', 'caption', 'message', 'text']);

// The allowlist: { file, family, text, reason }. `text` is the whole string as the scanner reads it (trimmed, whitespace
// collapsed). An entry that matches nothing fails the "no stale entry" test.
export const ALLOWED = [
  {
    file: 'src/features/library/LibraryPage.tsx',
    family: 'tag',
    text: 'EDIT TAGS',
    reason: "DECISIONS 215 (a), Adam 2026-10-22 (kept until his review pass): the Library's view switch edits an exercise's MUSCLE tags (SPEC Library: \"muscle tags\"), not the set tags that SPEC renames to cues",
  },
  {
    file: 'src/features/library/ExerciseTagList.tsx',
    family: 'tag',
    text: 'UNTAGGED',
    reason: "DECISIONS 215 (a), Adam 2026-10-22: the Library's group of exercises with no muscle tag; muscle tags, not cues",
  },
];

// ─── Which files ───────────────────────────────────────────────────────────────────────────────────────────────────
/** True for a file the scan reads: a .ts / .tsx under src/ that is not Coach's, a test, test support or a declaration. */
export function isScanned(relPath) {
  const p = relPath.split(sep).join('/');
  if (!p.startsWith('src/')) return false;
  if (!/\.tsx?$/.test(p) || /\.d\.ts$/.test(p)) return false;
  if (p.startsWith('src/features/coach/')) return false; // frozen; also where G50's page lives
  if (p.startsWith('src/testing/')) return false;
  if (/\.test\.tsx?$/.test(p) || /\.testutil\.tsx?$/.test(p)) return false;
  if (/(^|\/)(__fixtures__|__tests__)\//.test(p)) return false;
  return true;
}

function listFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(full, out);
    else out.push(full);
  }
  return out;
}

// ─── The scanner ───────────────────────────────────────────────────────────────────────────────────────────────────
const TRANSPARENT = new Set([
  ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.JsxExpression, ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.BinaryExpression, ts.SyntaxKind.AsExpression, ts.SyntaxKind.NonNullExpression,
]);

/** The name of the JSX attribute this string is the value of (through a ternary, `??`, `&&`, parentheses), or null. */
function attributeNameOf(node) {
  let p = node.parent;
  while (p && TRANSPARENT.has(p.kind)) p = p.parent;
  return p && ts.isJsxAttribute(p) ? p.name.getText() : null;
}

/** One token that doesn't start with a capital: a field, key, route, table, class or id, not words. */
function looksLikeCode(text) {
  return !/\s/.test(text) && !/^[A-Z]/.test(text);
}

// A query's column list or filter is a name, not words: .select('id, tags, mesocycle_id'), .eq('mesocycle_id', id), .rpc('v2_plan_week').
const QUERY_CALLS = new Set([
  'from', 'select', 'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike', 'not', 'or', 'filter', 'match',
  'order', 'contains', 'containedBy', 'overlaps', 'textSearch', 'rpc',
]);
function isQueryArgument(node) {
  const call = node.parent;
  return ts.isCallExpression(call) && call.arguments.includes(node) && ts.isPropertyAccessExpression(call.expression) && QUERY_CALLS.has(call.expression.name.text);
}

/**
 * Every place a file's source says a word the UI must not say, and how many strings and texts were read.
 * @returns {{ hits: { line: number, family: string, text: string }[], tokens: number }}
 */
export function scanSourceFull(fileName, text) {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
  const hits = [];
  let tokens = 0;

  const consider = (node, raw, isJsxText) => {
    const words = raw.replace(/\s+/g, ' ').trim();
    if (words === '') return;
    tokens++;
    if (!isJsxText) {
      if (isQueryArgument(node)) return;
      const attr = attributeNameOf(node);
      if (attr !== null && (NON_TEXT_ATTRS.has(attr) || attr.startsWith('data-'))) return;
      const forced = attr !== null && TEXT_ATTRS.has(attr);
      if (!forced && looksLikeCode(words)) return;
    }
    for (const family of FAMILIES) {
      if (family.re.test(words)) {
        hits.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, family: family.id, text: words });
      }
    }
  };

  const visit = (node) => {
    if (node.kind === ts.SyntaxKind.JsxText) consider(node, node.text, true);
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const p = node.parent;
      const inModuleSpecifier = ts.isImportDeclaration(p) || ts.isExportDeclaration(p) || ts.isModuleDeclaration(p);
      if (!ts.isLiteralTypeNode(p) && !inModuleSpecifier) consider(node, node.text, false);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) consider(node, node.text, false);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { hits, tokens };
}

/** Every place a file's source says a word the UI must not say. */
export function scanSource(fileName, text) {
  return scanSourceFull(fileName, text).hits;
}

/** Scan the real tree: every hit that is not allowlisted, every allowlist entry that was used, and how much was read. */
export function scanTree(rootDir = root) {
  const files = listFiles(join(rootDir, 'src')).map((f) => relative(rootDir, f).split(sep).join('/')).filter(isScanned).sort();
  const found = [];
  const used = new Set();
  let tokens = 0;
  for (const file of files) {
    const scanned = scanSourceFull(file, readFileSync(join(rootDir, file), 'utf8'));
    tokens += scanned.tokens;
    for (const hit of scanned.hits) {
      const index = ALLOWED.findIndex((a) => a.file === file && a.family === hit.family && a.text === hit.text);
      if (index !== -1) used.add(index);
      else found.push({ file, ...hit });
    }
  }
  return { files, found, used, tokens };
}

// ─── The tree ──────────────────────────────────────────────────────────────────────────────────────────────────────
const tree = scanTree();

test('no screen says meso, mesocycle, run, tag, or "change the plan" (the sweep over src/, Coach and tests excepted)', () => {
  const lines = tree.found.map((h) => `${h.file}:${h.line} [${h.family}] ${JSON.stringify(h.text)}`);
  assert.equal(lines.length, 0, `${lines.length} user-visible string(s) say a word SPEC Language [1.2] retires:\n  ${lines.join('\n  ')}`);
});

test('the scan really read the screens: the files this chunk edited are in it, Coach and the tests are not', () => {
  for (const f of [
    'src/features/history/HistorySessions.tsx',
    'src/features/history/ExerciseHistoryView.tsx',
    'src/features/progress/ProgressPage.tsx',
    'src/features/progress/MesoProgress.tsx',
    'src/features/progress/ExerciseProgress.tsx',
    'src/features/gym/TodayPage.tsx',
    'src/features/plan/PlanPage.tsx',
    'src/features/plan/PrioritiesEditor.tsx',
    'src/features/planner/PlannerPage.tsx',
    'src/features/library/LibraryPage.tsx',
    'src/features/library/ExerciseTagList.tsx',
  ]) assert.ok(tree.files.includes(f), `${f} is scanned`);
  assert.ok(!tree.files.some((f) => f.startsWith('src/features/coach/')), 'no Coach file is scanned');
  assert.ok(!tree.files.some((f) => /\.test\.|\.testutil\./.test(f)), 'no test file is scanned');
  assert.ok(tree.files.length > 150, `${tree.files.length} files scanned`);
  assert.ok(tree.tokens > 3000, `${tree.tokens} strings and texts read: the parser found the words`);
});

test('G50: the pre-1.1 priorities page keeps its wording because it lives in Coach\'s frozen folder, which the scan skips', () => {
  const page = 'src/features/coach/MesoPrioritiesPage.tsx';
  assert.equal(isScanned(page), false);
  assert.ok(scanSource(page, readFileSync(join(root, page), 'utf8')).some((h) => h.family === 'meso'), 'the page still says MESO: it is the one exception');
});

test('every allowlist entry still matches something and says why', () => {
  ALLOWED.forEach((entry, i) => {
    assert.ok(tree.used.has(i), `allowlist entry for ${entry.file} ${JSON.stringify(entry.text)} matches nothing: remove it`);
    assert.ok(entry.reason.length > 40, `allowlist entry ${i} gives its reason`);
  });
});

test('which files are scanned: src/ code only, never Coach, tests or test support', () => {
  const yes = ['src/features/gym/TodayPage.tsx', 'src/App.tsx', 'src/features/programs/programChange.ts', 'src/lib/db.ts'];
  const no = [
    'src/features/coach/MesoPrioritiesPage.tsx', 'src/features/coach/coachGate.ts',
    'src/features/gym/TodayPage.runSchedule.test.tsx', 'src/features/plan/fakeWeekPlanDb.testutil.ts', 'src/testing/captureRender.ts',
    'src/features/gym/__fixtures__/w1.html', 'api/coach/analyse.ts', 'scripts/check-wording.test.mjs', 'src/vite-env.d.ts',
  ];
  for (const p of yes) assert.equal(isScanned(p), true, p);
  for (const p of no) assert.equal(isScanned(p), false, p);
});

// ─── The call patterns: one source per way a string reaches a screen ──────────────────────────────────────────────────
const hitsOf = (name, code) => scanSource(name, code).map((h) => `${h.family}:${h.text}`);

test('JSX text is read, including the words after an element on the same paragraph', () => {
  assert.deepEqual(hitsOf('a.tsx', 'const A = () => <p>NO MESO</p>'), ['meso:NO MESO']);
  assert.deepEqual(hitsOf('a.tsx', "const A = () => <p>This deletes <b>{name}</b>'s plan, no longer linked to this mesocycle.</p>"), ['meso:\'s plan, no longer linked to this mesocycle.']);
  assert.deepEqual(hitsOf('a.tsx', 'const A = () => <button>END RUN</button>'), ['run:END RUN']);
  assert.deepEqual(hitsOf('a.tsx', 'const A = () => <span>EDIT TAGS</span>'), ['tag:EDIT TAGS']);
  assert.deepEqual(hitsOf('a.tsx', 'const A = () => <span>tags</span>'), ['tag:tags'], 'a lowercase word between tags is still words');
});

test('an attribute a person reads is read, one that is a name or a path is not', () => {
  assert.deepEqual(hitsOf('a.tsx', 'const A = () => <input placeholder="Search sessions or mesos…" />'), ['meso:Search sessions or mesos…']);
  assert.deepEqual(hitsOf('a.tsx', 'const A = () => <button aria-label="tags" title={x ? "meso" : "ok"} />'), ['tag:tags', 'meso:meso'], 'a one-word aria-label or title is words');
  assert.deepEqual(hitsOf('a.tsx', 'const A = () => <div className="meso-card tag" data-testid="meso-card" id="run" to="/meso/x" path="/meso/:id" />'), []);
});

test('a string in an expression is read: ternary, ??, object label, array, return, template and thrown message', () => {
  assert.deepEqual(hitsOf('a.tsx', "const A = () => <p>{s.mesocycleName ?? 'NO MESO'}</p>"), ['meso:NO MESO']);
  assert.deepEqual(hitsOf('a.tsx', "const A = () => <p>{ok ? 'Create a program' : 'Start a mesocycle to begin'}</p>"), ['meso:Start a mesocycle to begin']);
  assert.deepEqual(hitsOf('a.ts', "export const TABS = [{ id: 'meso', label: 'MESO OVERVIEW' }]"), ['meso:MESO OVERVIEW'], "the id 'meso' is code; the label is words");
  assert.deepEqual(hitsOf('a.ts', "export const f = (n: number) => n === 0 ? 'No runs yet' : 'A run'"), ['run:No runs yet', 'run:A run']);
  assert.deepEqual(hitsOf('a.ts', 'export const f = (n: number) => `${n} sets in the active run`'), ['run:sets in the active run']);
  assert.deepEqual(hitsOf('a.ts', "export function f() { throw new RangeError(\"the draft's workouts must be the run's workouts\") }"), ["run:the draft's workouts must be the run's workouts"]);
  assert.deepEqual(hitsOf('a.ts', "export const g = () => 'completed run'"), ['run:completed run']);
  assert.deepEqual(hitsOf('a.ts', "export const g = () => 'CHANGE THE PLAN'"), ['change-the-plan:CHANGE THE PLAN']);
  assert.deepEqual(hitsOf('a.ts', 'export const g = () => `Change plan`'), ['change-the-plan:Change plan']);
});

test('names, keys, routes, tables, types, imports and comments are not words', () => {
  const code = [
    "import { useMesos } from '../programs/useMesos'",
    "import type { Mesocycle } from '../../types'",
    "export type Tab = 'exercise' | 'meso' | 'run' | 'tags'",
    "const KEYS = ['mesocycles', 'mesocycle', 'tags', 'run']",
    "const q = supabase.from('v2_mesocycles').select('id, tags, mesocycle_id').eq('mesocycle_id', mesocycleId)",
    "const route = `/meso/${id}/priorities`; const r2 = '/meso/:mesocycleId/priorities'",
    "const fixture = { mesocycleId: 'meso-1', kind: 'run', source: 'tags' }",
    'const css = { color: "var(--run)" }',
    '// NO MESO   END RUN   EDIT TAGS',
    '/* DELETE MESOCYCLE?  the run  tags */',
    'const mesoService = runService(tags, mesocycleId)',
    "const stage = 'STAGE'; const s = 'stages'; const running = 'Running'; const ok = 'Programs'; const cues = 'CUES'",
  ];
  assert.deepEqual(hitsOf('a.ts', code.join('\n')), [], 'every name, key, route, query column list, type, import and comment passes');
  // ...but the same list handed to anything that is not a query is words
  assert.deepEqual(hitsOf('a.ts', "show('id, tags, mesocycle_id')"), ['tag:id, tags, mesocycle_id']);
});

test('"change the program", "cues", "program", "current program" and STAGE say nothing wrong', () => {
  assert.deepEqual(hitsOf('a.tsx', 'const A = () => <div><button>CHANGE THE PROGRAM</button><p>CUES</p><p>NO CURRENT PROGRAM</p><p>STAGE</p><p>Start a program in Plan → Programs</p></div>'), []);
});
