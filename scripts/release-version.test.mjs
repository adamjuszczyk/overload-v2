// release-version.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// One version, in every place that states it (TASKS.md, Facts to verify 5; Overload 1.2.1). Chunk 70 starts the file
// with the place the database holds: migration 048 seeds the one v2_app_status row with `min_version` '1.2.1', the oldest
// app version allowed to run (SPEC Rules 4: every release raises it). Chunk 71 adds the others, which move together
// at every release and must be equal: package.json's `version` (the one place it is set), what vite.config.ts defines as
// __APP_VERSION__ (the build reads package.json), the newest entry of src/data/releaseNotes.ts, and the prototype's own
// define. The seeded min_version is the one place that does not move with them: a migration is never edited once applied,
// and a later release raises the row with SQL (SPEC Rules 4), so the app must never be OLDER than what 048 seeded (equal
// at 1.2.1); a gate that refused a freshly deployed app would lock everyone out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { loadConfigFromFile } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(join(root, 'supabase', 'migrations', '048_p121_release_state_and_deletes.sql'), 'utf8');

// The status row 048 seeds: `insert into v2_app_status (id, maintenance, min_version) values (true, false, '<version>')`.
function seededMinVersion(sql) {
  const code = sql.replace(/--[^\n]*/g, '');
  const insert = /insert\s+into\s+v2_app_status\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i.exec(code);
  if (!insert) return undefined;
  const columns = insert[1].split(',').map((c) => c.trim());
  const values = insert[2].split(',').map((v) => v.trim());
  const at = columns.indexOf('min_version');
  return at < 0 ? undefined : /^'([^']*)'$/.exec(values[at])?.[1];
}

test('the seeded min_version is 1.2.1', () => {
  assert.equal(seededMinVersion(migration), '1.2.1');
});

test('control: the reader sees another version, and a missing column or insert, as not 1.2.1', () => {
  assert.equal(seededMinVersion(migration.replace("false, '1.2.1')", "false, '1.2.0')")), '1.2.0');
  assert.equal(seededMinVersion(migration.replace('(id, maintenance, min_version)', '(id, maintenance, updated_at)')), undefined);
  assert.equal(seededMinVersion('-- no insert here'), undefined);
});

// ─── package.json: the one place the version is set ──────────────────────────────────────────────────────────────────

const packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/** Dot-separated numbers compared part by part, a missing part reading 0 (src/lib/version.ts's rule, which is TypeScript with a build-time define and not importable here). */
function compare(a, b) {
  const parts = (v) => v.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const [m, n] = [x[i] ?? 0, y[i] ?? 0];
    if (m !== n) return m < n ? -1 : 1;
  }
  return 0;
}

test('package.json states the version as dotted numbers, and it is 1.2.1', () => {
  assert.match(packageVersion, /^\d+(\.\d+){1,2}$/);
  assert.equal(packageVersion, '1.2.1');
});

test('the app is not older than the minimum migration 048 seeds (equal at 1.2.1)', () => {
  const seeded = seededMinVersion(migration);
  assert.notEqual(seeded, undefined);
  assert.ok(compare(packageVersion, seeded) >= 0, `package.json says ${packageVersion}, older than the seeded min_version ${seeded}`);
});

test('control: the comparison reads 1.2 = 1.2.0 < 1.2.1 and 1.10.0 > 1.9.9, as src/lib/version.ts does', () => {
  assert.equal(compare('1.2', '1.2.0'), 0);
  assert.equal(compare('1.2', '1.2.1'), -1);
  assert.equal(compare('1.10.0', '1.9.9'), 1);
  assert.ok(compare('1.2.0', '1.2.1') < 0, 'an app at 1.2.0 is older than the seeded 1.2.1, and the test above would fail it');
});

// ─── the newest release-notes entry ─────────────────────────────────────────────────────────────────────────────────

/** The `version` of the first entry of `RELEASES` in src/data/releaseNotes.ts (newest first), read from the syntax tree; undefined when there is none. */
function newestReleaseVersion(source) {
  const file = ts.createSourceFile('releaseNotes.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found;
  const visit = (node) => {
    if (found === undefined && ts.isVariableDeclaration(node) && node.name.getText() === 'RELEASES' && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
      const first = node.initializer.elements[0];
      if (first && ts.isObjectLiteralExpression(first)) {
        for (const property of first.properties) {
          if (ts.isPropertyAssignment(property) && property.name.getText() === 'version' && ts.isStringLiteral(property.initializer)) found = property.initializer.text;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const releaseNotesSource = readFileSync(join(root, 'src', 'data', 'releaseNotes.ts'), 'utf8');

test("the newest entry of the release notes is package.json's version", () => {
  assert.equal(newestReleaseVersion(releaseNotesSource), packageVersion);
});

test('control: the reader sees another first entry, and no RELEASES at all, as not the version', () => {
  assert.equal(newestReleaseVersion(releaseNotesSource.replace("version: '1.2.1'", "version: '1.2.2'")), '1.2.2');
  assert.equal(newestReleaseVersion('export const OTHER = [{ version: "1.2.1" }]'), undefined);
  assert.equal(newestReleaseVersion('export const RELEASES = []'), undefined);
});

// ─── what the build defines ─────────────────────────────────────────────────────────────────────────────────────────

/** `define.__APP_VERSION__` as the vite config in `dir` resolves it (the config reads the package.json beside it). */
async function definedAppVersion(dir) {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(dir, 'vite.config.ts'), dir);
  return loaded?.config?.define?.__APP_VERSION__;
}

test("vite.config.ts defines __APP_VERSION__ as package.json's version", async () => {
  assert.equal(await definedAppVersion(root), JSON.stringify(packageVersion));
});

// The control and the second direction: the same config next to a package.json of another version defines that one (so the define follows
// the file and not a constant), and refuses one that is not dotted numbers.
async function withPackageVersion(version, run) {
  const dir = mkdtempSync(join(tmpdir(), 'overload-version-'));
  try {
    copyFileSync(join(root, 'vite.config.ts'), join(dir, 'vite.config.ts'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'control', version }));
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
    return await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('control: the define follows the package.json beside the config', async () => {
  assert.equal(await withPackageVersion('7.8.9', definedAppVersion), JSON.stringify('7.8.9'));
  assert.equal(await withPackageVersion('1.2', definedAppVersion), JSON.stringify('1.2'));
});

test('control: the build refuses a package.json version that is not dotted numbers', async () => {
  for (const version of ['1', '1.2.x', 'latest', '1.2.1.4', '']) {
    await assert.rejects(() => withPackageVersion(version, definedAppVersion), /dotted numbers/, `version ${JSON.stringify(version)}`);
  }
});

test("the prototype defines the same version (prototype/vite.config.ts), so its screens read the app's", () => {
  const defined = (source) => /__APP_VERSION__:\s*JSON\.stringify\('([^']*)'\)/.exec(source)?.[1];
  const prototype = readFileSync(join(root, 'prototype', 'vite.config.ts'), 'utf8');
  assert.equal(defined(prototype), packageVersion);
  // control: another version, and no define at all, read as not the version
  assert.equal(defined(prototype.replace("JSON.stringify('1.2.1')", "JSON.stringify('1.2.0')")), '1.2.0');
  assert.equal(defined(prototype.replace('__APP_VERSION__', '__OTHER__')), undefined);
});
