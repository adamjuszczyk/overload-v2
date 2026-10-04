// check-frozen-code.mjs
//
// Phase 1 of the Planner Extension must not touch Coach, and must keep the
// existing exports of referenceLogic.ts and setGroupLogic.ts byte-identical
// (Coach imports both). New exports in those two files are allowed.
//
// Usage:  node scripts/check-frozen-code.mjs [baseRef]
//         baseRef defaults to FROZEN_BASE, master as it was when the build started.
// Exit:   0 = nothing frozen changed; 1 = something did; 2 = couldn't check.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

export const FROZEN_BASE = 'e747183749350c697c5de55c6b64727c0fb66544';
export const FROZEN_DIRS = ['src/features/coach', 'api/coach'];
export const FROZEN_EXPORT_FILES = ['src/features/gym/referenceLogic.ts', 'src/features/gym/setGroupLogic.ts'];

const git = (args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Every top-level statement carrying `export`, plus `export { … }` lists, keyed by name, as exact source text.
export function exportedStatements(source, fileName = 'x.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = new Map();
  for (const st of sf.statements) {
    const text = source.slice(st.getStart(sf), st.end);
    const exported = ts.canHaveModifiers(st) && (ts.getModifiers(st) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) { out.set(`export@${text}`, text); continue; }
    if (!exported) continue;
    const names = ts.isVariableStatement(st)
      ? st.declarationList.declarations.map((d) => d.name.getText(sf))
      : [st.name ? st.name.getText(sf) : `default@${text}`];
    for (const n of names) out.set(n, text);
  }
  return out;
}

// Statements outside the exports that an export depends on are not compared;
// a changed private helper is caught only through the behaviour tests.
export function compareExports(baseSrc, headSrc, file) {
  const base = exportedStatements(baseSrc, file);
  const head = exportedStatements(headSrc, file);
  const problems = [];
  for (const [name, text] of base) {
    if (!head.has(name)) problems.push(`${file}: export ${name} removed`);
    else if (head.get(name) !== text) problems.push(`${file}: export ${name} changed`);
  }
  return problems;
}

function main() {
  const base = process.argv[2] || FROZEN_BASE;
  try { git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]); } catch {
    console.error(`check-frozen-code: base ${base} not found. Can't check — treat as failed.`); process.exit(2);
  }
  const problems = [];
  const changed = git(['diff', '--name-only', base, '--', ...FROZEN_DIRS]).split('\n').filter(Boolean);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...FROZEN_DIRS]).split('\n').filter(Boolean);
  for (const f of [...changed, ...untracked]) problems.push(`${f}: Coach code changed`);
  for (const f of FROZEN_EXPORT_FILES) {
    let baseSrc;
    try { baseSrc = git(['show', `${base}:${f}`]); } catch { console.error(`check-frozen-code: ${f} missing at ${base}.`); process.exit(2); }
    let headSrc;
    try { headSrc = readFileSync(f, 'utf8'); } catch { problems.push(`${f}: file removed`); continue; }
    problems.push(...compareExports(baseSrc, headSrc, f));
  }
  if (problems.length) {
    console.log('check-frozen-code: FAILED');
    for (const p of problems) console.log('- ' + p);
    process.exit(1);
  }
  console.log(`check-frozen-code: ok — no Coach change and every existing export of ${FROZEN_EXPORT_FILES.length} files identical since ${base.slice(0, 7)}.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
