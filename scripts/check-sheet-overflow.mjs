// check-sheet-overflow.mjs
//
// The 375 px check for a sheet. screenshot-fixture.mjs measures the document's scrollWidth,
// which a `position: fixed` layer never changes, so a 700 px block inside a BottomSheet still
// reads "scrollWidth 375 (viewport 375): ok" there (CONTEXT.md, rules: "The 375 px scrollWidth
// check is blind inside a sheet"). This opens each fixture that holds a dialog (role="dialog")
// in the preinstalled Chromium and measures inside every dialog instead:
//   1. the dialog lies inside the viewport;
//   2. no element in it that has a box reaches past the dialog's left or right edge;
//   3. no element in it is wider inside than it shows (scrollWidth > clientWidth: content that
//      scrolls sideways, or that overflow clips). Check 2 alone misses this: a flex item that
//      can't get narrower keeps its own box in place while its parent scrolls. A text field's
//      typed text is not counted here (a field scrolls its own text by design); the field's
//      box is, by check 2. Something meant to scroll sideways is reported too: say so in the
//      review rather than silencing the check.
// Written by chunk 39's reviewer (2026-10-15), committed by chunk 40's.
//
// Usage:  node scripts/check-sheet-overflow.mjs [--width <px>] [--css <built.css>] [--wide] [--long] [fixture.html ...]
//   fixtures  body fragments written by src/testing/captureRender.ts; none given: every
//             src/**/__fixtures__/*.html that holds role="dialog".
//   --width   the viewport width in px (default 375).
//   --css     the built stylesheet; default: the one file matching dist/assets/index-*.css
//             (run `npm run build` first; a source edited after the build is warned about).
//   --wide    the control: adds a 700 px block inside every dialog, so every fixture must FAIL.
//             A check that passes its control is blind.
//   --long    swaps the boards' sample exercise names (Lat Pulldown, Incline Dumbbell Press,
//             Seated Cable Row) for 80 X's: a word with no break opportunity (a hyphenated
//             name breaks at its hyphens and proves nothing).
// Prints:  one line per fixture, `ok` or `FAIL`, with the dialog's box and the first problems.
//          Only the first line of any error is printed (Playwright's call logs carry request
//          headers, CONTEXT.md "Reviewer's own rules").
// Exit:    0 = every fixture ok; 1 = a fixture failed; 2 = couldn't run (usage, no fixture,
//          stylesheet or browser).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { findChromium, firstLine, readFragment, resolveCss, staleSource, stripFontImports, wrapDocument } from './screenshot-fixture.mjs';

export const DEFAULT_WIDTH = 375;
export const VIEWPORT_HEIGHT = 844;
export const SAMPLE_NAMES = ['Lat Pulldown', 'Incline Dumbbell Press', 'Seated Cable Row'];
export const LONG_NAME = 'X'.repeat(80);
export const USAGE = 'usage: node scripts/check-sheet-overflow.mjs [--width <px>] [--css <built.css>] [--wide] [--long] [fixture.html ...]';

export class UsageError extends Error {}

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { width: { type: 'string' }, css: { type: 'string' }, wide: { type: 'boolean' }, long: { type: 'boolean' } },
    });
  } catch (err) {
    throw new UsageError(`${firstLine(err)}\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  const width = values.width === undefined ? DEFAULT_WIDTH : Number(values.width);
  if (!Number.isInteger(width) || width < 200 || width > 2000) throw new UsageError(`--width must be a whole number of px between 200 and 2000, got ${values.width}\n${USAGE}`);
  return { fixtures: positionals, width, css: values.css, wide: Boolean(values.wide), long: Boolean(values.long) };
}

/** Every captured fixture under <cwd>/src that holds a dialog: the sheets, in a stable order. */
export function sheetFixtures(cwd = process.cwd()) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(path);
      } else if (basename(dir) === '__fixtures__' && entry.name.endsWith('.html') && readFileSync(path, 'utf8').includes('role="dialog"')) {
        found.push(path);
      }
    }
  };
  const src = join(cwd, 'src');
  if (existsSync(src)) walk(src);
  return found.sort();
}

/** The fragment with every sample exercise name made one 80-letter word. */
export function lengthen(fragment) {
  return SAMPLE_NAMES.reduce((text, name) => text.split(name).join(LONG_NAME), fragment);
}

// Runs in the page. Returns the dialogs' boxes and every problem found, or an error.
function measureInPage(injectWide) {
  const dialogs = [...document.querySelectorAll('[role="dialog"]')];
  if (dialogs.length === 0) return { error: 'no role="dialog" in the fixture' };
  const problems = [];
  const boxes = [];
  const describe = (el) => `<${el.tagName.toLowerCase()}> "${(el.textContent || '').trim().slice(0, 24)}"`;
  for (const dialog of dialogs) {
    if (injectWide) {
      const target = dialog.querySelector('[role="group"]') ?? dialog;
      const wideBlock = document.createElement('div');
      wideBlock.setAttribute('data-control', 'wide');
      wideBlock.style.width = '700px';
      wideBlock.style.height = '10px';
      target.appendChild(wideBlock);
    }
    const box = dialog.getBoundingClientRect();
    boxes.push(`${Math.round(box.left)}..${Math.round(box.right)}`);
    if (box.left < -0.5 || box.right > window.innerWidth + 0.5) problems.push(`dialog ${Math.round(box.left)}..${Math.round(box.right)} outside the viewport (${window.innerWidth})`);
    for (const el of dialog.querySelectorAll('*')) {
      if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.left < box.left - 0.5 || r.right > box.right + 0.5) {
        problems.push(`sticks out: ${describe(el)} ${Math.round(r.left)}..${Math.round(r.right)} vs ${Math.round(box.left)}..${Math.round(box.right)}`);
      }
    }
    for (const el of [dialog, ...dialog.querySelectorAll('*')]) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea') continue;
      if (getComputedStyle(el).display === 'inline') continue;
      if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 0.5) problems.push(`wider inside: ${describe(el)} ${el.scrollWidth}>${el.clientWidth}`);
    }
  }
  const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  return { dialogs: boxes, documentWidth, count: problems.length, problems: problems.slice(0, 4) };
}

/** Measures each fixture in one browser; returns one result per fixture. */
export async function checkFixtures({ fixtures, css, width, wide, long, executablePath }) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') throw new Error('playwright-core is not installed: run `npm ci`');
    throw err;
  }
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = [];
  try {
    for (const file of fixtures) {
      const raw = readFragment(file);
      const fragment = long ? lengthen(raw) : raw;
      const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT }, deviceScaleFactor: 1 });
      // No network, whatever the fixture or the stylesheet asks for.
      await context.route('**/*', (route) => {
        const url = route.request().url();
        return url.startsWith('data:') || url.startsWith('about:') ? route.continue() : route.abort();
      });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        await page.setContent(wrapDocument({ fragment, css, theme: 'light' }), { waitUntil: 'load' });
        const measured = await page.evaluate(measureInPage, wide);
        results.push({ file, ok: !measured.error && measured.count === 0, ...measured });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  return results;
}

export async function main(argv, cwd = process.cwd()) {
  const opts = parseCli(argv);
  const fixtures = opts.fixtures.length > 0 ? opts.fixtures : sheetFixtures(cwd);
  if (fixtures.length === 0) throw new Error('no fixture given and none under src/**/__fixtures__ holds role="dialog"');
  const cssPath = resolveCss(opts.css, cwd);
  const css = stripFontImports(readFileSync(cssPath, 'utf8'));
  const stale = opts.css ? null : staleSource(cssPath, cwd);
  if (stale) console.log(`warning: ${relative(cwd, stale)} was edited after ${relative(cwd, cssPath)} was built; run \`npm run build\` or this measures stale styles`);
  const results = await checkFixtures({ fixtures, css, width: opts.width, wide: opts.wide, long: opts.long, executablePath: findChromium() });
  const tags = `${opts.wide ? '[wide] ' : ''}${opts.long ? '[long] ' : ''}`;
  for (const r of results) {
    const detail = r.error ? r.error : `dialog ${r.dialogs.join(', ')}; document ${r.documentWidth}${r.count ? `; ${r.count} problem(s): ${r.problems.join(' | ')}` : ''}`;
    const shown = relative(cwd, r.file).startsWith('..') ? r.file : relative(cwd, r.file);
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${opts.width}px ${tags}${shown} ${detail}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`check-sheet-overflow: ${failed === 0 ? 'ok' : `${failed} of ${results.length} failed`} (${results.length} fixture(s) at ${opts.width} px${opts.wide ? ', with the 700 px control' : ''})`);
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`check-sheet-overflow: ${err instanceof UsageError ? err.message : firstLine(err)}`);
      process.exitCode = 2;
    },
  );
}
