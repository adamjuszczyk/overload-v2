// check-migration.mjs
//
// Decides whether the migrations on this branch can be merged into main without
// me. The rules live in migration-rules.mjs; this file only gathers the files
// and reports.
//
// Usage:  git fetch origin && node scripts/check-migration.mjs [baseRef]
//         baseRef defaults to the repo's default branch (main or master).
// Exit:   0 = nothing to flag (merge as usual)
//         1 = flagged (don't merge — blocking DECISIONS.md entry, merge is mine)
//         2 = couldn't check (treat exactly like 1)

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { classify } from './migration-rules.mjs';

const MIGRATIONS_DIR = 'supabase/migrations';

// The repo's default branch as origin knows it — main in some repos, master in others.
function defaultBase() {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (ref) return ref;
  } catch {}
  for (const b of ['origin/main', 'origin/master']) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', b], { stdio: 'ignore' });
      return b;
    } catch {}
  }
  return 'origin/main';
}

function main() {
  // A missing folder would look like "no migrations" and pass silently. Refuse instead.
  if (!existsSync(MIGRATIONS_DIR)) {
    console.error(`check-migration: no ${MIGRATIONS_DIR} folder here. Can't check — treat as flagged.`);
    process.exit(2);
  }
  const base = process.argv[2] || defaultBase();
  let listing;
  try {
    listing = execFileSync('git', ['diff', '--name-status', `${base}...HEAD`, '--', MIGRATIONS_DIR], { encoding: 'utf8' });
  } catch (e) {
    console.error(`check-migration: couldn't compare against ${base}. Treat as flagged.`);
    console.error(String(e.message || e));
    process.exit(2);
  }

  const files = listing.split('\n').filter(Boolean).map(line => {
    const cols = line.split('\t');
    const status = cols[0][0];
    const path = cols[cols.length - 1];
    if (!path.endsWith('.sql')) return null;
    return { path, status, sql: status === 'D' ? null : readFileSync(path, 'utf8') };
  }).filter(Boolean);

  if (files.length === 0) {
    console.log('check-migration: no migration changes on this branch.');
    process.exit(0);
  }

  const { safe, flagged } = classify(files);
  if (safe) {
    console.log(`check-migration: SAFE — ${files.length} new migration file(s), every statement is on the safe list. Merge as usual.`);
    process.exit(0);
  }
  console.log('check-migration: FLAGGED — do not merge. This merge is mine.\n');
  for (const f of flagged) {
    console.log(`- ${f.file}: ${f.reason}`);
    console.log(`    ${f.statement.length > 200 ? f.statement.slice(0, 200) + '…' : f.statement}`);
  }
  process.exit(1);
}

main();
