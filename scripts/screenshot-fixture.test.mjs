// Run: node --test "scripts/*.test.mjs"
//
// Tests for screenshot-fixture.mjs. The pure helpers are tested directly; the rest
// run the real command in the preinstalled Chromium (the fixtures below carry their
// own tiny stylesheet, so no `npm run build` is needed — except the one test that
// reads the built stylesheet, which says so). A check that can pass while the
// browser never ran is not a check, so a missing Chromium fails here, it does not skip.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import {
  DEFAULT_WIDTH,
  findChromium,
  parseCli,
  pngSize,
  readFragment,
  remainingImports,
  resolveCss,
  stripFontImports,
  textPathFor,
  wrapDocument,
} from './screenshot-fixture.mjs';

const SCRIPT = fileURLToPath(new URL('./screenshot-fixture.mjs', import.meta.url));
const TMP = mkdtempSync(join(tmpdir(), 'screenshot-fixture-test-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
const scratchDir = (label) => {
  const dir = join(TMP, `${label}-${++seq}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

// The Google Fonts import exactly as the production build emits it: minified, the
// URL quoted and full of semicolons.
const GOOGLE_FONTS_IMPORT =
  '@import"https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Archivo+Expanded:wght@600;700;800;900&family=JetBrains+Mono:wght@400;500;600;700;800&display=swap";';

// A tiny stand-in for the built stylesheet: the import first, then the page background
// from a token that differs by theme (the app's tokens.css does the same).
const LIGHT_BASE = [249, 249, 248];
const DARK_BASE = [6, 6, 7];
const TEST_CSS = `${GOOGLE_FONTS_IMPORT}:root{--base:#060607}[data-theme=light]{--base:#f9f9f8}*{margin:0;box-sizing:border-box}html,body{background:var(--base)}`;

function writeFile(dir, name, text) {
  const path = join(dir, name);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
  return path;
}

// Runs the real command. Node's own startup warnings (this container sets NODE_USE_ENV_PROXY,
// which makes every Node process print an experimental-feature notice) are not the script's output.
function run(args, { cwd = process.cwd(), env = {} } = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_USE_ENV_PROXY;
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, env: childEnv, encoding: 'utf8', timeout: 90000 });
  const own = (text) => text.split('\n').filter((l) => l.trim() !== '' && !/^\(node:\d+\)|^\(Use `node --trace-warnings/.test(l));
  return { status: r.status, out: own(r.stdout), err: own(r.stderr), stdout: r.stdout, stderr: r.stderr };
}

// 8-bit RGB / RGBA, non-interlaced PNGs only: what Chromium's screenshots are.
function readPng(path) {
  const buf = readFileSync(path);
  const { width, height } = pngSize(buf);
  let off = 8;
  let colourType;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      colourType = data[9];
      assert.equal(data[8], 8, 'bit depth 8');
      assert.equal(data[12], 0, 'not interlaced');
    }
    if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  assert.ok(colourType === 2 || colourType === 6, `colour type ${colourType}`);
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      px[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth][filter]) & 255;
    }
  }
  return { width, height, pixel: (x, y) => [...px.subarray(y * stride + x * bpp, y * stride + x * bpp + 3)] };
}

const textLines = (png) => readFileSync(textPathFor(png), 'utf8').replace(/\n$/, '').split('\n');

// ─── Pure helpers ───────────────────────────────────────────────────────────

test('parseCli: the two paths, the defaults and the three flags', () => {
  assert.deepEqual(parseCli(['f.html', 'o.png']), { fixture: 'f.html', out: 'o.png', dark: false, css: undefined, width: 390 });
  assert.equal(DEFAULT_WIDTH, 390);
  assert.deepEqual(parseCli(['f.html', 'o.png', '--dark', '--css', 'x.css', '--width', '375']), {
    fixture: 'f.html',
    out: 'o.png',
    dark: true,
    css: 'x.css',
    width: 375,
  });
  assert.equal(parseCli(['--css=y.css', '--width=420', 'f.html', 'o.png']).css, 'y.css');
  assert.equal(parseCli(['--css=y.css', '--width=420', 'f.html', 'o.png']).width, 420);
});

test('parseCli: refuses what it cannot run, naming the usage', () => {
  for (const bad of [[], ['f.html'], ['a.html', 'b.png', 'c.png'], ['f.html', 'o.jpg'], ['f.html', 'o.png', '--bogus']]) {
    assert.throws(() => parseCli(bad), /usage: node scripts\/screenshot-fixture\.mjs/, JSON.stringify(bad));
  }
  for (const width of ['abc', '37', '2001', '3.5', '']) {
    assert.throws(() => parseCli(['f.html', 'o.png', '--width', width]), /--width must be a whole number/, width);
  }
  assert.throws(() => parseCli(['f.html', 'o.png', '--width=-5']), /--width must be a whole number/);
  assert.throws(() => parseCli(['f.html', 'o.png', '--width', '-5']), /usage: node scripts\/screenshot-fixture\.mjs/, 'node\'s own parser refuses a dash-led value');
});

test('textPathFor: the dump sits beside the image, same name', () => {
  assert.equal(textPathFor('design/1.2/built/1.png'), 'design/1.2/built/1.txt');
  assert.equal(textPathFor('X.PNG'), 'X.txt');
});

test('stripFontImports: removes the production build\'s import whole (the semicolons inside its URL included) and leaves the next rule alone', () => {
  const after = stripFontImports(`${GOOGLE_FONTS_IMPORT}:root{--base: #060607}`);
  assert.equal(after, ':root{--base: #060607}');
  assert.deepEqual(remainingImports(after), []);
});

test('stripFontImports: the other ways to write it, with a media or layer tail, and nothing else touched', () => {
  const rule = ':root{--a:1}.x{content:"@import"}';
  for (const imp of [
    "@import url('https://fonts.googleapis.com/css2?family=A:wght@400;500&display=swap');",
    '@import url("https://fonts.googleapis.com/css2?family=A:wght@400;500");',
    '@import url(https://fonts.googleapis.com/css2?family=A:wght@400;500&display=swap);',
    '@import url(https://fonts.googleapis.com/css2?family=A) layer(base);',
    '@import "https://fonts.googleapis.com/css2?family=A:wght@400;500" screen ;',
  ]) {
    assert.equal(stripFontImports(imp + rule), rule, imp);
  }
  assert.equal(stripFontImports(rule), rule);
  assert.equal(stripFontImports(`${GOOGLE_FONTS_IMPORT}${GOOGLE_FONTS_IMPORT}${rule}`), rule);
});

test('stripFontImports: an import of anything else stays, and is reported', () => {
  const other = '@import"https://example.com/other.css";';
  const after = stripFontImports(`${GOOGLE_FONTS_IMPORT}${other}:root{--a:1}`);
  assert.equal(after, `${other}:root{--a:1}`);
  assert.deepEqual(remainingImports(after), [other]);
});

test('stripFontImports on the real built stylesheet (needs `npm run build`; skipped when there is none)', { skip: !existsSync('dist/assets') || readdirSync('dist/assets').filter((n) => /^index-.*\.css$/.test(n)).length !== 1 }, () => {
  const name = readdirSync('dist/assets').find((n) => /^index-.*\.css$/.test(n));
  const css = readFileSync(join('dist/assets', name), 'utf8');
  assert.match(css, /^@import"https:\/\/fonts\.googleapis\.com\//, 'the build still starts with the Google Fonts import');
  const after = stripFontImports(css);
  assert.deepEqual(remainingImports(after), []);
  assert.equal(after.length, css.length - css.indexOf(':root{'), 'only the import was removed');
  assert.ok(after.startsWith(':root{--base:'), after.slice(0, 40));
});

test('wrapDocument: the fragment in the root element, the theme on <html> as App.tsx sets it, the stylesheet inline', () => {
  const light = wrapDocument({ fragment: '<p>HELLO</p>', css: 'p{color:red}', theme: 'light' });
  assert.match(light, /<html lang="en" data-theme="light">/);
  assert.match(light, /<style>p\{color:red\}<\/style>/);
  assert.match(light, /<body><div id="root"><p>HELLO<\/p><\/div><\/body>/);
  assert.match(wrapDocument({ fragment: '', css: '', theme: 'dark' }), /data-theme="dark"/);
  assert.throws(() => wrapDocument({ fragment: '', css: '', theme: 'sepia' }), /light or dark/);
});

test('readFragment: a body fragment passes; a missing, empty or whole-document fixture is refused', () => {
  const dir = scratchDir('fragments');
  assert.equal(readFragment(writeFile(dir, 'ok.html', '<p>x</p>')), '<p>x</p>');
  assert.throws(() => readFragment(join(dir, 'missing.html')), /fixture not found/);
  assert.throws(() => readFragment(writeFile(dir, 'empty.html', ' \n ')), /fixture is empty/);
  assert.throws(() => readFragment(writeFile(dir, 'doc.html', '<!DOCTYPE html><html><body><p>x</p></body></html>')), /whole document/);
  assert.throws(() => readFragment(writeFile(dir, 'doc2.html', '  <html><body></body></html>')), /whole document/);
});

test('resolveCss: the single dist/assets/index-*.css by default, --css as given, and says what is wrong otherwise', () => {
  const cwd = scratchDir('css');
  assert.throws(() => resolveCss(undefined, cwd), /no stylesheet matches dist\/assets\/index-\*\.css: run `npm run build`/);
  writeFile(cwd, 'dist/assets/index-abc123.css', 'a{}');
  writeFile(cwd, 'dist/assets/vendor-xyz.css', 'b{}');
  writeFile(cwd, 'dist/assets/index-abc123.js', 'c');
  assert.equal(resolveCss(undefined, cwd), join(cwd, 'dist/assets/index-abc123.css'));
  writeFile(cwd, 'dist/assets/index-def456.css', 'd{}');
  assert.throws(() => resolveCss(undefined, cwd), /2 stylesheets match.*index-abc123\.css, index-def456\.css.*pass --css/);
  const own = writeFile(cwd, 'mine.css', 'e{}');
  assert.equal(resolveCss('mine.css', cwd), own);
  assert.equal(resolveCss(own, cwd), own);
  assert.equal(resolveCss('dist/assets/index-d*.css', cwd), join(cwd, 'dist/assets/index-def456.css'));
  assert.throws(() => resolveCss('nope.css', cwd), /stylesheet not found: nope\.css$/);
});

test('findChromium: the highest chromium-<build> under the browsers folder; never a download', () => {
  const root = scratchDir('browsers');
  assert.throws(() => findChromium({ PLAYWRIGHT_BROWSERS_PATH: root }), /no preinstalled Chromium under .*never downloads a browser/);
  for (const build of ['1194', '1200']) writeFile(root, `chromium-${build}/chrome-linux/chrome`, '#!/bin/sh\n');
  writeFile(root, 'chromium_headless_shell-1300/chrome-linux/headless_shell', '');
  writeFile(root, 'chromium-notabuild/chrome-linux/chrome', '');
  assert.equal(findChromium({ PLAYWRIGHT_BROWSERS_PATH: root }), join(root, 'chromium-1200/chrome-linux/chrome'));
  writeFile(root, 'chromium-1300/chrome-linux64/chrome', '#!/bin/sh\n');
  assert.equal(findChromium({ PLAYWRIGHT_BROWSERS_PATH: root }), join(root, 'chromium-1300/chrome-linux64/chrome'));
});

test('pngSize: reads the IHDR, refuses anything else', () => {
  const ihdr = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(ihdr);
  ihdr.writeUInt32BE(390, 16);
  ihdr.writeUInt32BE(844, 20);
  assert.deepEqual(pngSize(ihdr), { width: 390, height: 844 });
  assert.throws(() => pngSize(Buffer.from('GIF89a, not a PNG at all, really not')), /not a PNG/);
});

// ─── The command, in Chromium ───────────────────────────────────────────────

const TEST_CSS_FILE = writeFile(TMP, 'test.css', TEST_CSS);

function shoot(name, fragment, extraArgs = [], runOptions = {}) {
  const dir = scratchDir(name);
  const fixture = writeFile(dir, 'fixture.html', fragment);
  const png = join(dir, 'out.png');
  const result = run([fixture, png, '--css', TEST_CSS_FILE, ...extraArgs], runOptions);
  return { ...result, png, dir };
}

test('renders a 390 px PNG and a text dump in DOM order, visible text only', () => {
  const r = shoot(
    'order',
    // column-reverse draws CHARLIE first; the dump follows the DOM, not the paint order
    '<div>ALPHA</div><div style="display:none">HIDDEN</div><div style="display:flex;flex-direction:column-reverse"><div>BRAVO</div><div>CHARLIE</div></div><button>DELTA</button>',
  );
  assert.equal(r.status, 0, r.err.join('\n'));
  assert.equal(r.err.length, 0);
  assert.ok(existsSync(r.png));
  const size = pngSize(readFileSync(r.png));
  assert.equal(size.width, 390);
  assert.ok(size.height >= 844, `full page is at least the 844 px viewport, got ${size.height}`);
  assert.deepEqual(textLines(r.png), ['ALPHA', 'BRAVO', 'CHARLIE', 'DELTA']);
  assert.equal(readFileSync(textPathFor(r.png), 'utf8'), 'ALPHA\nBRAVO\nCHARLIE\nDELTA\n');
  assert.match(r.out[0], /^screenshot-fixture: .*out\.png \(390 x \d+, light\) and .*out\.txt \(4 text lines\)$/);
  assert.ok(r.out.includes('scrollWidth 390 (viewport 390): ok'), r.out.join('\n'));
});

test('a screen taller than the viewport is captured whole, not cut at 844 px', () => {
  const r = shoot('tall', '<div style="height:2000px;background:#08c">TALL</div>');
  assert.equal(r.status, 0, r.out.join('\n'));
  const png = readPng(r.png);
  assert.equal(png.width, 390);
  assert.equal(png.height, 2000);
  assert.deepEqual(png.pixel(10, 1990), [0x00, 0x88, 0xcc], 'the bottom of the screen is in the picture');
});

test('animations are stopped at their first frame, so a spinner is the same picture every run', () => {
  const fragment =
    '<style>@keyframes slide{from{margin-left:0}to{margin-left:200px}}.mover{width:50px;height:50px;background:#000;animation:slide 1s linear infinite}</style><div class="mover"></div>';
  const first = shoot('anim-1', fragment);
  const second = shoot('anim-2', fragment);
  for (const r of [first, second]) {
    assert.equal(r.status, 0, r.out.join('\n'));
    assert.deepEqual(readPng(r.png).pixel(10, 10), [0, 0, 0], 'the square is where the animation starts');
    assert.deepEqual(readPng(r.png).pixel(150, 10), LIGHT_BASE);
  }
  assert.ok(readFileSync(first.png).equals(readFileSync(second.png)), 'two runs, the same bytes');
});

test('the text dump is in order: the same strings swapped in the fixture come out swapped', () => {
  const forward = shoot('forward', '<div>FIRST</div><div>SECOND</div><div>THIRD</div>');
  const swapped = shoot('swapped', '<div>FIRST</div><div>THIRD</div><div>SECOND</div>');
  assert.deepEqual(textLines(forward.png), ['FIRST', 'SECOND', 'THIRD']);
  assert.deepEqual(textLines(swapped.png), ['FIRST', 'THIRD', 'SECOND']);
});

test('overflow: a 500 px element is reported and fails the run; a 390 px element is not (same pipeline, different signal)', () => {
  const wide = shoot('wide', '<div style="width:500px;height:40px;background:#c00">WIDE</div>');
  assert.equal(wide.status, 1, wide.out.join('\n'));
  assert.ok(wide.out.includes('scrollWidth 500 (viewport 390): OVERFLOW'), wide.out.join('\n'));
  assert.ok(existsSync(wide.png) && existsSync(textPathFor(wide.png)), 'the files are still written, to look at');
  assert.equal(pngSize(readFileSync(wide.png)).width, 500, 'and the picture shows the overflow');

  const exact = shoot('exact', '<div style="width:390px;height:40px;background:#0a0">EXACT</div>');
  assert.equal(exact.status, 0, exact.out.join('\n'));
  assert.ok(exact.out.includes('scrollWidth 390 (viewport 390): ok'), exact.out.join('\n'));
  assert.ok(!exact.out.some((l) => /OVERFLOW/.test(l)));
});

test('--width 375 is the 375 px check: a 380 px element passes at 390 and overflows at 375', () => {
  const fragment = '<div style="width:380px;height:40px">NARROW</div>';
  const at390 = shoot('w390', fragment);
  const at375 = shoot('w375', fragment, ['--width', '375']);
  assert.equal(at390.status, 0);
  assert.ok(at390.out.includes('scrollWidth 390 (viewport 390): ok'), at390.out.join('\n'));
  assert.equal(at375.status, 1);
  assert.ok(at375.out.includes('scrollWidth 380 (viewport 375): OVERFLOW'), at375.out.join('\n'));
  assert.equal(pngSize(readFileSync(at375.png)).width, 380);
});

test('the theme: light by default, dark with --dark, read from the PNG\'s corner pixel (and the stylesheet after the import survived)', () => {
  const light = shoot('light', '<div>THEME</div>');
  const dark = shoot('dark', '<div>THEME</div>', ['--dark']);
  assert.equal(light.status, 0);
  assert.equal(dark.status, 0);
  assert.deepEqual(readPng(light.png).pixel(0, 0), LIGHT_BASE);
  assert.deepEqual(readPng(dark.png).pixel(0, 0), DARK_BASE);
  assert.notDeepEqual(readPng(light.png).pixel(0, 0), readPng(dark.png).pixel(0, 0));
  assert.match(dark.out[0], /\(390 x \d+, dark\)/);
});

test('no network: the render asks for nothing, and what the fixture reaches for is refused and named', async () => {
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('x');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const dir = scratchDir('network');
    const fixture = writeFile(dir, 'fixture.html', `<img src="http://127.0.0.1:${port}/probe.png" width="10" height="10"><div>NETWORK</div>`);
    const png = join(dir, 'out.png');
    // spawnSync would block this event loop, and with it the server; the browser's requests would never be answered.
    const env = { ...process.env };
    delete env.NODE_USE_ENV_PROXY;
    const child = spawn(process.execPath, [SCRIPT, fixture, png, '--css', TEST_CSS_FILE], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    const status = await new Promise((resolve) => child.on('close', resolve));
    assert.equal(status, 0, stdout);
    assert.equal(hits, 0, 'the page reached the server');
    assert.ok(stdout.includes(`blocked 1 network request(s) to: 127.0.0.1:${port}`), stdout);
    assert.deepEqual(textLines(png), ['NETWORK']);
  } finally {
    server.close();
  }
});

test('the stylesheet: --css beats the default dist/assets/index-*.css, which is found from the working directory', () => {
  const cwd = scratchDir('cwd');
  writeFile(cwd, 'dist/assets/index-test.css', TEST_CSS);
  const fixture = writeFile(cwd, 'fixture.html', '<div>CSS</div>');
  const byDefault = run([fixture, join(cwd, 'default.png')], { cwd });
  const other = writeFile(cwd, 'other.css', `${GOOGLE_FONTS_IMPORT}*{margin:0}html,body{background:#123456}`);
  const explicit = run([fixture, join(cwd, 'explicit.png'), '--css', other], { cwd });
  assert.equal(byDefault.status, 0, byDefault.err.join('\n'));
  assert.equal(explicit.status, 0, explicit.err.join('\n'));
  assert.deepEqual(readPng(join(cwd, 'default.png')).pixel(0, 0), LIGHT_BASE);
  assert.deepEqual(readPng(join(cwd, 'explicit.png')).pixel(0, 0), [0x12, 0x34, 0x56]);
});

test('out.png may sit in folders that do not exist yet', () => {
  const dir = scratchDir('nested');
  const fixture = writeFile(dir, 'fixture.html', '<div>NESTED</div>');
  const png = join(dir, 'design', '1.2', 'built', 'x.png');
  assert.equal(run([fixture, png, '--css', TEST_CSS_FILE]).status, 0);
  assert.ok(existsSync(png) && existsSync(join(dir, 'design', '1.2', 'built', 'x.txt')));
});

// ─── When it cannot run: exit 2, one line, nothing written ──────────────────

test('exit 2 and one line for a missing fixture, a missing stylesheet and a usage mistake; nothing written', () => {
  const dir = scratchDir('failures');
  const png = join(dir, 'out.png');
  const noFixture = run([join(dir, 'missing.html'), png, '--css', TEST_CSS_FILE]);
  const noCss = run([writeFile(dir, 'f.html', '<p>x</p>'), png, '--css', join(dir, 'missing.css')]);
  const usage = run([writeFile(dir, 'f2.html', '<p>x</p>')]);
  assert.deepEqual([noFixture.status, noCss.status, usage.status], [2, 2, 2]);
  assert.deepEqual(noFixture.err, [`screenshot-fixture: fixture not found: ${join(dir, 'missing.html')}`]);
  assert.deepEqual(noCss.err, [`screenshot-fixture: stylesheet not found: ${join(dir, 'missing.css')}`]);
  assert.match(usage.err[0], /^screenshot-fixture: usage: node scripts\/screenshot-fixture\.mjs/);
  assert.ok(!existsSync(png) && !existsSync(textPathFor(png)));
});

test('no preinstalled Chromium: exit 2, says where it looked, downloads nothing', () => {
  const empty = scratchDir('nobrowser');
  const r = shoot('nobrowser-run', '<p>x</p>', [], { env: { PLAYWRIGHT_BROWSERS_PATH: empty } });
  assert.equal(r.status, 2);
  assert.deepEqual(r.err, [`screenshot-fixture: no preinstalled Chromium under ${empty} (set PLAYWRIGHT_BROWSERS_PATH); this script never downloads a browser`]);
  assert.deepEqual(readdirSync(empty), [], 'nothing was downloaded into the browsers folder');
});

test('a browser that fails to start: only the first line of Playwright\'s error is printed, not its call log', async () => {
  const browsers = scratchDir('failing-browser');
  const fake = writeFile(browsers, 'chromium-9999/chrome-linux/chrome', '#!/bin/sh\necho "fake chrome refusing to start" >&2\nexit 1\n');
  chmodSync(fake, 0o755);

  // The control: this injection really does produce the long, logged error the rule is about
  // (Checks that lied #22: an injected failure that never fired proves nothing).
  const { chromium } = await import('playwright-core');
  await assert.rejects(chromium.launch({ executablePath: fake, headless: true }), (e) => {
    const lines = String(e.message).split('\n');
    return lines.length > 4 && /Call log/.test(e.message) && lines.some((l) => l.includes(fake));
  });

  const r = shoot('failing-browser-run', '<p>x</p>', [], { env: { PLAYWRIGHT_BROWSERS_PATH: browsers } });
  assert.equal(r.status, 2);
  assert.equal(r.err.length, 1, r.err.join('\n'));
  assert.match(r.err[0], /^screenshot-fixture: browserType\.launch: /);
  assert.ok(!/Call log|launching|--disable/.test(r.stderr), r.stderr);
  assert.ok(!r.stderr.includes(fake), 'the executable path from the call log is not printed either');
  assert.ok(!existsSync(r.png));
});

// ─── The committed example ──────────────────────────────────────────────────

test('design/1.2/built/example-plan-fixture: the committed example is a 390 px PNG and the prototype\'s text dump', () => {
  const png = 'design/1.2/built/example-plan-fixture.png';
  assert.ok(existsSync(png) && existsSync(textPathFor(png)), 'the example is committed');
  assert.equal(pngSize(readFileSync(png)).width, 390);
  const lines = textLines(png);
  assert.equal(lines.length, 31);
  assert.deepEqual(lines.slice(0, 4), ['TEST MESO', 'PRIORITIES', 'PLAN', 'WEEK 1']);
});
