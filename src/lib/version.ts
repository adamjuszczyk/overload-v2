// The app's version and how two versions compare (1.2.1: Settings' WHAT'S NEW, and the release gates of chunks 72 and 73).
//
// `package.json`'s `version` is the one place the version is set (SPEC.md, "The app's version"). vite.config.ts reads it into the build
// as `__APP_VERSION__`, a `define` beside the build hash and time, and this file is the one place the app reads it. With no define there
// is no version: a test that imports this file stubs the global first (`vi.stubGlobal('__APP_VERSION__', '1.2.1')`), and the import
// throws a ReferenceError otherwise rather than fall back to a made-up version, which would pass or fail the gates wrongly.
export const APP_VERSION: string = __APP_VERSION__

/** The parts of a version as numbers: `'1.2.1'` is `[1, 2, 1]`. A part that is not a whole number (`''`, `'x'`, `'1-beta'`) reads 0. */
function partsOf(version: string): number[] {
  return version
    .trim()
    .split('.')
    .map((part) => (/^\d+$/.test(part) ? parseInt(part, 10) : 0))
}

/**
 * Which of two versions is newer: -1 when `a` is older than `b`, 1 when it is newer, 0 when they are the same version.
 * Dot-separated numbers compared part by part, left to right, as numbers (`1.10.0` is newer than `1.9.9`). A missing part reads 0, so
 * `1.2` and `1.2.0` are the same version and both are older than `1.2.1` (SPEC.md, "The app's version").
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const left = partsOf(a)
  const right = partsOf(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const x = left[i] ?? 0
    const y = right[i] ?? 0
    if (x !== y) return x < y ? -1 : 1
  }
  return 0
}
