// check-migration-order.mjs
//
// Supabase identifies a migration by the digits before the first `_` in its
// file name, compared as text. Deploying from master applies the files whose
// version comes after the last applied one, so:
//   - a reused number is treated as already applied and silently never runs;
//   - a number at or below the last applied one stops the deploy
//     ("Found local migration files to be inserted before the last migration
//     on remote database").
// This check fails on both before they reach master. Edits to existing
// migration files are flagged by check-migration.mjs, not here.
//
// Usage:  git fetch origin && node scripts/check-migration-order.mjs [baseRef]
//         baseRef defaults to the repo's default branch (main or master).
// Exit:   0 = every file is NNN_name.sql, versions unique, new files after base
//         1 = flagged
//         2 = couldn't check (treat exactly like 1)

import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';
const NAME = /^(\d{3})_[^/]+\.sql$/;

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function defaultBase() {
  try {
    const ref = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']).trim();
    if (ref) return ref;
  } catch {}
  for (const b of ['origin/main', 'origin/master']) {
    try { git(['rev-parse', '--verify', '--quiet', b]); return b; } catch {}
  }
  return 'origin/main';
}

function main() {
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`check-migration-order: no ${MIGRATIONS_DIR} folder here. Can't check — treat as flagged.`);
    return 2;
  }
  const base = process.argv[2] || defaultBase();

  let baseFiles, added;
  try {
    baseFiles = git(['ls-tree', '--name-only', `${base}:${MIGRATIONS_DIR}`]).split('\n').filter(Boolean);
  } catch (e) {
    // The folder may legitimately not exist on base; anything else is a failure to check.
    try { git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]); baseFiles = []; } catch {
      console.error(`check-migration-order: couldn't read ${base}. Treat as flagged.`);
      return 2;
    }
  }
  try {
    added = git(['diff', '--name-only', '--diff-filter=AR', `${base}...HEAD`, '--', MIGRATIONS_DIR])
      .split('\n').filter(Boolean).map(p => p.slice(MIGRATIONS_DIR.length + 1));
  } catch (e) {
    console.error(`check-migration-order: couldn't compare against ${base}. Treat as flagged.`);
    console.error(String(e.message || e));
    return 2;
  }

  const files = readdirSync(MIGRATIONS_DIR, { withFileTypes: true }).filter(d => d.isFile()).map(d => d.name).sort();
  const problems = [];

  for (const f of files) {
    if (!NAME.test(f)) problems.push(`${f}: not NNN_name.sql (three digits, an underscore, a name, .sql)`);
  }

  const byVersion = new Map();
  for (const f of files.filter(f => NAME.test(f))) {
    const v = NAME.exec(f)[1];
    byVersion.set(v, [...(byVersion.get(v) ?? []), f]);
  }
  for (const [v, fs] of byVersion) {
    if (fs.length > 1) problems.push(`version ${v} is used by ${fs.length} files (${fs.join(', ')}); Supabase would run only one of them`);
  }

  const baseVersions = baseFiles.map(f => NAME.exec(f)?.[1]).filter(Boolean).sort();
  const highest = baseVersions.at(-1);
  for (const f of added.filter(f => NAME.test(f)).sort()) {
    const v = NAME.exec(f)[1];
    if (highest !== undefined && v <= highest) {
      problems.push(`${f}: version ${v} is not after ${highest}, the highest on ${base}; the next free number is ${String(Number(highest) + 1).padStart(3, '0')}`);
    }
  }

  if (problems.length === 0) {
    console.log(`check-migration-order: OK — ${files.length} migration file(s), versions unique; ${added.length} new on this branch, all after ${highest ?? '(none on base)'}.`);
    return 0;
  }
  console.log('check-migration-order: FLAGGED\n');
  for (const p of problems) console.log(`- ${p}`);
  return 1;
}

process.exit(main());
