// Run: node --test "scripts/*.test.mjs"
//
// Tests for check-sheet-overflow.mjs. The pure helpers are tested directly; the rest run the
// real command in the preinstalled Chromium on tiny fixtures that carry their own stylesheet
// (--css), so no `npm run build` is needed. Each measure is shown failing on the case it
// exists for, and the control (--wide) is shown failing where the document's own width,
// the standing check, still reads the viewport. A missing Chromium fails here, it does not skip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WIDTH, LONG_NAME, SAMPLE_NAMES, UsageError, lengthen, parseCli, sheetFixtures } from './check-sheet-overflow.mjs';

const SCRIPT = fileURLToPath(new URL('./check-sheet-overflow.mjs', import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'check-sheet-overflow-test-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

function writeFile(dir, name, text) {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
}

const CSS_FILE = writeFile(TMP, 'test.css', '*{margin:0;box-sizing:border-box}html,body{background:#fff}');

// A sheet the way BottomSheet draws one: a fixed layer at the bottom, full width, 16 px side padding.
const sheet = (inner) =>
  `<div role="dialog" aria-label="Test" style="position: fixed; left: 0; right: 0; bottom: 0; padding: 10px 16px 24px; background: #fff">${inner}</div>`;
const FITS = sheet('<p>Cues for this set</p><div role="group" aria-label="Cues"><button type="button" style="width: 100%">Push here</button></div>');

let seq = 0;
const fixture = (html) => writeFile(TMP, `f-${++seq}.html`, html);

// Runs the real command. Node's own startup warnings (NODE_USE_ENV_PROXY) are not the script's output.
function run(args, cwd = process.cwd()) {
  const env = { ...process.env };
  delete env.NODE_USE_ENV_PROXY;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env, encoding: 'utf8', timeout: 90000 });
  const own = (text) => text.split('\n').filter((l) => l.trim() !== '' && !/^\(node:\d+\)|^\(Use `node --trace-warnings/.test(l));
  return { status: r.status, out: own(r.stdout).join('\n'), err: own(r.stderr).join('\n') };
}

test('parseCli: 375 px by default, the flags, and a usage error for a bad width', () => {
  assert.equal(DEFAULT_WIDTH, 375);
  assert.deepEqual(parseCli([]), { fixtures: [], width: 375, css: undefined, wide: false, long: false });
  assert.deepEqual(parseCli(['a.html', '--wide', '--long', '--width', '390', '--css', 'x.css', 'b.html']), {
    fixtures: ['a.html', 'b.html'],
    width: 390,
    css: 'x.css',
    wide: true,
    long: true,
  });
  assert.throws(() => parseCli(['--width', 'wide']), UsageError);
  assert.throws(() => parseCli(['--colour']), UsageError);
});

test('lengthen: every sample exercise name becomes one 80-letter word, and nothing else changes', () => {
  assert.equal(LONG_NAME, 'X'.repeat(80));
  const text = SAMPLE_NAMES.map((n) => `<span>${n} · SET 03</span>`).join('');
  const long = lengthen(text);
  for (const name of SAMPLE_NAMES) assert.ok(!long.includes(name), name);
  assert.equal(long.split(LONG_NAME).length - 1, SAMPLE_NAMES.length);
  assert.equal(lengthen('<p>Bench Press</p>'), '<p>Bench Press</p>');
});

test('sheetFixtures: the captured fixtures under src that hold a dialog, and only those', () => {
  const cwd = join(TMP, 'tree');
  writeFile(cwd, 'src/a/__fixtures__/sheet.html', FITS);
  writeFile(cwd, 'src/a/__fixtures__/page.html', '<main>no dialog here</main>');
  writeFile(cwd, 'src/b/__fixtures__/other-sheet.html', FITS);
  writeFile(cwd, 'src/c/not-a-fixture.html', FITS);
  assert.deepEqual(sheetFixtures(cwd), [join(cwd, 'src/a/__fixtures__/sheet.html'), join(cwd, 'src/b/__fixtures__/other-sheet.html')]);
  assert.deepEqual(sheetFixtures(join(TMP, 'nowhere')), []);
});

test('a sheet whose content fits reads ok, exit 0', () => {
  const r = run(['--css', CSS_FILE, fixture(FITS)]);
  assert.equal(r.status, 0, r.out + r.err);
  assert.match(r.out, /^ok {3}375px .*dialog 0\.\.375; document 375$/m);
  assert.match(r.out, /check-sheet-overflow: ok \(1 fixture\(s\) at 375 px\)/);
});

test('the control: a 700 px block in the dialog fails, while the document is still as wide as the viewport (what the standing check reads)', () => {
  const r = run(['--css', CSS_FILE, '--wide', fixture(FITS)]);
  assert.equal(r.status, 1, r.out + r.err);
  assert.match(r.out, /^FAIL 375px \[wide\] .*document 375; .*sticks out: <div> ""/m);
  assert.match(r.out, /1 of 1 failed/);
});

test('an element past the dialog edge fails: sticks out', () => {
  const r = run(['--css', CSS_FILE, fixture(sheet('<div style="width: 500px; height: 10px"></div>'))]);
  assert.equal(r.status, 1, r.out + r.err);
  assert.match(r.out, /sticks out: <div> ""/);
});

test('a word too long for its box fails although every element stays inside: wider inside', () => {
  const row = `<div style="display: flex; gap: 8px"><span style="flex: 1 1 auto; min-width: 0">${'X'.repeat(80)}</span><span>›</span></div>`;
  const r = run(['--css', CSS_FILE, fixture(sheet(row))]);
  assert.equal(r.status, 1, r.out + r.err);
  assert.match(r.out, /wider inside: <span> "XXXX/);
  assert.doesNotMatch(r.out, /sticks out/);
});

test('a text field holding more text than it shows is fine (it scrolls its own text); a field wider than the sheet is not', () => {
  const typed = run(['--css', CSS_FILE, fixture(sheet(`<input type="text" style="width: 100%" value="${'X'.repeat(80)}">`))]);
  assert.equal(typed.status, 0, typed.out + typed.err);
  const wideField = run(['--css', CSS_FILE, fixture(sheet('<input type="text" style="width: 600px" value="x">'))]);
  assert.equal(wideField.status, 1, wideField.out + wideField.err);
  assert.match(wideField.out, /sticks out: <input>/);
});

test('a fixture with no dialog fails and says so', () => {
  const r = run(['--css', CSS_FILE, fixture('<main><p>a page, not a sheet</p></main>')]);
  assert.equal(r.status, 1, r.out + r.err);
  assert.match(r.out, /no role="dialog" in the fixture/);
});

test("couldn't run: no fixture given and none found, or no stylesheet, exit 2", () => {
  const empty = join(TMP, 'empty');
  mkdirSync(empty, { recursive: true });
  const none = run(['--css', CSS_FILE], empty);
  assert.equal(none.status, 2, none.out + none.err);
  assert.match(none.err, /no fixture given and none under src/);
  const noCss = run([fixture(FITS)], empty);
  assert.equal(noCss.status, 2, noCss.out + noCss.err);
  assert.match(noCss.err, /run `npm run build` first/);
});
