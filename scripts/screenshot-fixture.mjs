// screenshot-fixture.mjs
//
// One command that turns a captured render of a screen into a 390 px light-theme
// PNG (to lay beside its board under design/1.2/png/) and a text dump of what the
// screen says, in DOM order — so every screen chunk's board check is mechanical to
// produce and the same for everyone. The reviewer compares the PNG and the dump
// with the board for the same elements, order and wording; never pixel-matched.
// Fonts are the fallbacks (no network); the reviewer's staging screenshots after a
// merge have the real fonts and the real data.
//
// Usage:  node scripts/screenshot-fixture.mjs <fixture.html> <out.png> [--dark] [--css <built.css>] [--width <px>]
//         npm run shot -- <fixture.html> <out.png> [...]
//   fixture  a body fragment: the innerHTML of a jsdom render, the way
//            GymSession.d30.test.tsx compares `container.innerHTML`. Write one with
//            src/testing/captureRender.ts (`CAPTURE_RENDER=1 npx vitest run <test>`
//            → src/**/__fixtures__/<name>.html).
//   out.png  a full-page PNG at a 390 x 844 viewport, light theme (data-theme="light"
//            on <html>, as the app sets it). Next to it, out.txt = document.body.innerText,
//            the visible text in DOM order. Parent folders are created. On a screen taller
//            than 844 px a `position: fixed` bar is drawn at the bottom of the first 844 px
//            (that is how a full-page capture works), not at the end of the picture.
//   --dark   data-theme="dark" instead.
//   --css    the built stylesheet; default: the one file matching dist/assets/index-*.css
//            (run `npm run build` first; a source file edited after the build is warned
//            about, because the picture would show the old styles). The Google Fonts
//            @import is stripped from it, and every network request the page makes is
//            blocked: the render never touches the network.
//   --width  the viewport width in px (default 390). `--width 375` is the standing
//            375 px overflow check; give it a scratch out.png, not the committed one.
// Prints:  the files written, then `scrollWidth <n> (viewport <w>): ok` or `... OVERFLOW`.
//          Only the first line of any error is printed (Playwright's call logs carry
//          request headers, CONTEXT.md "Reviewer's own rules").
// Browser: the Chromium preinstalled under $PLAYWRIGHT_BROWSERS_PATH (default
//          /opt/pw-browsers), driven through playwright-core. This script never runs
//          `playwright install` and never downloads anything.
// Exit:    0 = rendered, no horizontal overflow; 1 = rendered (files written) but
//          scrollWidth exceeds the viewport; 2 = couldn't run (usage, fixture, stylesheet,
//          browser or render error).

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const DEFAULT_WIDTH = 390;
export const VIEWPORT_HEIGHT = 844;
export const DEFAULT_CSS_PATTERN = 'dist/assets/index-*.css';
export const DEFAULT_BROWSERS_PATH = '/opt/pw-browsers';
export const USAGE = 'usage: node scripts/screenshot-fixture.mjs <fixture.html> <out.png> [--dark] [--css <built.css>] [--width <px>]';

/** First line of anything thrown; the only part of an error this script ever prints (a UsageError is its own text, printed whole). */
export function firstLine(err) {
  return String(err?.message ?? err).split('\n')[0].trim();
}

/** A mistake in the command line itself: its message (with the usage line) is ours, so it is printed whole. */
export class UsageError extends Error {}

export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: { dark: { type: 'boolean' }, css: { type: 'string' }, width: { type: 'string' } },
    });
  } catch (err) {
    // parseArgs' message runs on into advice about `--`; its first sentence is the part that names the mistake.
    throw new UsageError(`${firstLine(err).split('. ')[0]}\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 2) throw new UsageError(USAGE);
  const [fixture, out] = positionals;
  if (!/\.png$/i.test(out)) throw new UsageError(`the output must be a .png path, got ${out}\n${USAGE}`);
  let width = DEFAULT_WIDTH;
  if (values.width !== undefined) {
    width = /^\d+$/.test(values.width) ? Number(values.width) : NaN;
    if (!(width >= 200 && width <= 2000)) throw new UsageError(`--width must be a whole number of px between 200 and 2000, got ${values.width}\n${USAGE}`);
  }
  return { fixture, out, dark: values.dark === true, css: values.css, width };
}

/** out.png → out.txt (same folder, same name). */
export function textPathFor(outPng) {
  return outPng.replace(/\.png$/i, '.txt');
}

// `@import"https://fonts.googleapis.com/css2?family=A:wght@400;500&display=swap";` (the
// minified form the build emits — note the semicolons INSIDE the quoted URL, which a
// `[^;]*;` pattern would cut at), `@import url('…');` and `@import url(…) layer(x);`.
const IMPORT_RULE = /@import\s*(?:url\(\s*(?:"[^"]*"|'[^']*'|[^)]*?)\s*\)|"[^"]*"|'[^']*')[^;{}]*;/g;

/** The built CSS with its Google Fonts @import removed; every other rule is left exactly as it was. */
export function stripFontImports(css) {
  return css.replace(IMPORT_RULE, (rule) => (/fonts\.googleapis\.com/i.test(rule) ? '' : rule));
}

/** @import rules still in the CSS after stripFontImports (they would reach for the network; the page blocks them). */
export function remainingImports(css) {
  return css.match(IMPORT_RULE) ?? [];
}

export function wrapDocument({ fragment, css, theme }) {
  if (theme !== 'light' && theme !== 'dark') throw new Error(`theme must be light or dark, got ${theme}`);
  return `<!doctype html>
<html lang="en" data-theme="${theme}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>fixture</title>
<style>${css}</style>
</head>
<body><div id="root">${fragment}</div></body>
</html>
`;
}

export function readFragment(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(err?.code === 'ENOENT' ? `fixture not found: ${path}` : `can't read the fixture ${path}: ${firstLine(err)}`);
  }
  if (text.trim() === '') throw new Error(`fixture is empty: ${path}`);
  if (/^\s*(<!doctype|<html)/i.test(text)) {
    throw new Error(`${path} is a whole document; a fixture is a body fragment (the innerHTML of a render, see src/testing/captureRender.ts)`);
  }
  return text;
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*');
  return new RegExp(`^${escaped}$`);
}

/** The stylesheet to inline: --css as given, or the single file matching dist/assets/index-*.css (a `*` is expanded here, in the file name only). */
export function resolveCss(cssArg, cwd = process.cwd()) {
  const spec = cssArg ?? DEFAULT_CSS_PATTERN;
  const abs = isAbsolute(spec) ? spec : resolve(cwd, spec);
  if (!basename(abs).includes('*')) {
    if (!existsSync(abs)) throw new Error(`stylesheet not found: ${spec}${cssArg ? '' : ' (run `npm run build` first)'}`);
    return abs;
  }
  const dir = dirname(abs);
  const pattern = globToRegExp(basename(abs));
  const matches = existsSync(dir) ? readdirSync(dir).filter((n) => pattern.test(n)).sort() : [];
  if (matches.length === 0) throw new Error(`no stylesheet matches ${spec}: run \`npm run build\` first, or pass --css <file>`);
  if (matches.length > 1) throw new Error(`${matches.length} stylesheets match ${spec} (${matches.join(', ')}): pass --css <file>`);
  return join(dir, matches[0]);
}

/**
 * A source file under <cwd>/src that was edited after the stylesheet was built, or null. The stylesheet is
 * built from the classes the sources use, so a picture rendered with an older one can show styles the app
 * no longer has. Tests, fixtures and src/testing don't contribute classes and are not looked at.
 */
export function staleSource(cssPath, cwd = process.cwd()) {
  const srcDir = join(cwd, 'src');
  if (!existsSync(srcDir)) return null;
  const builtAt = statSync(cssPath).mtimeMs;
  let newest = null;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['__fixtures__', 'node_modules', 'testing'].includes(entry.name)) walk(path);
      } else if (/\.(tsx?|css|html)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
        const editedAt = statSync(path).mtimeMs;
        if (editedAt > builtAt && (newest === null || editedAt > newest.editedAt)) newest = { path, editedAt };
      }
    }
  };
  walk(srcDir);
  return newest ? newest.path : null;
}

/** The preinstalled Chromium (highest chromium-<build> under the browsers folder). Never downloads one. */
export function findChromium(env = process.env) {
  const root = env.PLAYWRIGHT_BROWSERS_PATH || DEFAULT_BROWSERS_PATH;
  let names = [];
  try {
    names = readdirSync(root);
  } catch {
    // fall through to the error below
  }
  const builds = names
    .map((n) => /^chromium-(\d+)$/.exec(n))
    .filter(Boolean)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  for (const [dirName] of builds) {
    for (const sub of ['chrome-linux', 'chrome-linux64']) {
      const exe = join(root, dirName, sub, 'chrome');
      if (existsSync(exe)) return exe;
    }
  }
  throw new Error(`no preinstalled Chromium under ${root} (set PLAYWRIGHT_BROWSERS_PATH); this script never downloads a browser`);
}

/** Width and height from a PNG's IHDR chunk. */
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Renders the document in the preinstalled Chromium; writes outPng and outTxt; returns what it measured. */
export async function renderFixture({ html, outPng, outTxt, width, executablePath }) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND') throw new Error('playwright-core is not installed: run `npm ci`');
    throw err;
  }
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT }, deviceScaleFactor: 1 });
    // No network, whatever the fixture or the stylesheet asks for: block it and say which hosts were refused.
    const blockedHosts = new Set();
    let blocked = 0;
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
      blocked += 1;
      try {
        blockedHosts.add(new URL(url).host || 'unknown');
      } catch {
        blockedHosts.add('unknown');
      }
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    const text = await page.evaluate(() => document.body.innerText);
    const scrollWidth = await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth));
    mkdirSync(dirname(outPng), { recursive: true });
    await page.screenshot({ path: outPng, fullPage: true, animations: 'disabled' });
    writeFileSync(outTxt, text.endsWith('\n') ? text : `${text}\n`);
    return { text, scrollWidth, blocked, blockedHosts: [...blockedHosts].sort() };
  } finally {
    await browser.close();
  }
}

export async function main(argv, cwd = process.cwd()) {
  const opts = parseCli(argv);
  const fragment = readFragment(opts.fixture);
  const cssPath = resolveCss(opts.css, cwd);
  const css = stripFontImports(readFileSync(cssPath, 'utf8'));
  const html = wrapDocument({ fragment, css, theme: opts.dark ? 'dark' : 'light' });
  const executablePath = findChromium();
  const outTxt = textPathFor(opts.out);
  const result = await renderFixture({ html, outPng: opts.out, outTxt, width: opts.width, executablePath });

  const size = pngSize(readFileSync(opts.out));
  // The count is of lines with text on them (innerText also puts a blank line between paragraphs).
  const lines = result.text.split('\n').filter((l) => l.trim() !== '').length;
  console.log(`screenshot-fixture: ${opts.out} (${size.width} x ${size.height}, ${opts.dark ? 'dark' : 'light'}) and ${outTxt} (${lines} text ${lines === 1 ? 'line' : 'lines'})`);
  if (result.text.trim() === '') console.log('warning: the page has no visible text; is the fixture an empty render?');
  const stillImported = remainingImports(css);
  if (stillImported.length > 0) console.log(`warning: ${stillImported.length} @import rule(s) remain in the stylesheet (blocked)`);
  const stale = staleSource(cssPath, cwd);
  if (stale) console.log(`warning: ${relative(cwd, stale)} was edited after ${relative(cwd, cssPath)} was built; run \`npm run build\` or this picture may show stale styles`);
  if (result.blocked > 0) console.log(`blocked ${result.blocked} network request(s) to: ${result.blockedHosts.join(', ')}`);
  const overflow = result.scrollWidth > opts.width;
  console.log(`scrollWidth ${result.scrollWidth} (viewport ${opts.width}): ${overflow ? 'OVERFLOW' : 'ok'}`);
  return overflow ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`screenshot-fixture: ${err instanceof UsageError ? err.message : firstLine(err)}`);
      process.exitCode = 2;
    },
  );
}
