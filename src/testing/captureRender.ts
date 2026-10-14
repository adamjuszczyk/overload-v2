import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect } from 'vitest'

// The convention every 1.2 screen chunk uses to get a render fixture for
// `scripts/screenshot-fixture.mjs` (TASKS-1.2 chunk 37): a screen's jsdom render,
// written out as a body fragment, the way GymSession.d30.test.tsx compares
// `container.innerHTML`.
//
//   1. In the screen's render test, after `render(...)`:
//        const { container } = render(<ThePage />)
//        captureRender('plan-week-1', container)
//      Pass `document.body` instead when the screen is a sheet rendered through a
//      portal (React Testing Library mounts portals outside `container`).
//   2. CAPTURE_RENDER=1 npx vitest run <that test file>
//        → writes <the test's folder>/__fixtures__/plan-week-1.html
//   3. npm run build, then
//        npm run shot -- <that fixture> design/1.2/built/<board-id>.png
//
// Opt-in: with CAPTURE_RENDER unset (or anything but `1`) captureRender writes
// nothing, so the suite never writes files by default.

/** The environment variable that turns capturing on (`CAPTURE_RENDER=1`). */
export const CAPTURE_ENV_VAR = 'CAPTURE_RENDER'

// A bare file name, no extension and no separators: the file can only land in the fixtures folder.
const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/

export function isCaptureEnabled(): boolean {
  return process.env[CAPTURE_ENV_VAR] === '1'
}

/** Where a test file's fixtures live: a `__fixtures__` folder beside it. */
export function fixtureDirFor(testPath: string): string {
  return join(dirname(testPath), '__fixtures__')
}

function assertFixtureName(name: string): void {
  if (!NAME_PATTERN.test(name)) {
    throw new Error(`captureRender: "${name}" is not a fixture name (letters, digits, - and _ only; no folder, no extension)`)
  }
}

/** The file captureRender(name, …) writes: `<dir>/<name>.html`, `dir` defaulting to the calling test's `__fixtures__` folder. */
export function fixtureFile(name: string, options: { dir?: string } = {}): string {
  assertFixtureName(name)
  let dir = options.dir
  if (dir === undefined) {
    const testPath = expect.getState().testPath
    if (!testPath) throw new Error('captureRender: no running Vitest test to take the fixtures folder from; pass { dir }')
    dir = fixtureDirFor(testPath)
  }
  return join(dir, `${name}.html`)
}

/**
 * Writes `element.innerHTML` (exactly, no trailing newline) to `<name>.html` in
 * the calling test's `__fixtures__` folder and returns the path; returns null,
 * writing nothing, unless CAPTURE_RENDER=1. The name is checked either way, so a
 * bad name fails in a normal run, not only when capturing.
 */
export function captureRender(name: string, element: { innerHTML: string }, options: { dir?: string } = {}): string | null {
  assertFixtureName(name)
  if (!isCaptureEnabled()) return null
  const file = fixtureFile(name, options)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, element.innerHTML)
  console.info(`captureRender: wrote ${file}`)
  return file
}
