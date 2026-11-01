import { afterEach, describe, expect, it, vi } from 'vitest'

// version.ts reads the build's define when it loads, and an import is hoisted above any statement: the stub goes in a hoisted block.
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1'))
import { compareVersions } from './version'

// TASKS.md 1.2.1, chunk 71 / Data model, "The app's version": `compareVersions(a, b)` reads dot-separated numbers, a missing part reads
// 0, so `1.2` = `1.2.0` < `1.2.1`. The Settings sheet (chunk 71) and the update gate (chunk 73) both stand on it, so each case here is a
// pair one of them meets: the version a phone last saw against the one it runs, and the running version against `min_version`.

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('compareVersions', () => {
  // [a, b, a compared with b]
  const CASES: [string, string, -1 | 0 | 1][] = [
    // a missing part reads 0
    ['1.2', '1.2.0', 0],
    ['1.2.0', '1.2', 0],
    ['1', '1.0.0', 0],
    ['1.2', '1.2.1', -1],
    ['1.2.1', '1.2', 1],
    ['1.2.0', '1.2.1', -1],
    // the same
    ['1.2.1', '1.2.1', 0],
    // parts are numbers, not text: 10 is more than 9
    ['1.10.0', '1.9.9', 1],
    ['1.9.9', '1.10.0', -1],
    ['1.2.10', '1.2.9', 1],
    ['10.0.0', '9.99.99', 1],
    // the left-most part that differs decides
    ['2.0.0', '1.99.99', 1],
    ['1.3.0', '1.2.99', 1],
    ['1.2.1', '1.3', -1],
    // "no mark yet" is '0' where the sheet compares (App: `lastSeen ?? '0'`)
    ['1.2.1', '0', 1],
    ['0', '1.2.1', -1],
    ['0', '0.0.0', 0],
    // a part that is not a whole number reads 0, and a stray space is ignored
    ['1.2.x', '1.2', 0],
    ['1.2.1', '', 1],
    ['', '', 0],
    [' 1.2.1 ', '1.2.1', 0],
    ['1.2.1-beta', '1.2', 0],
  ]

  it.each(CASES)('%j compared with %j is %i', (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected)
  })

  it('swapping the two flips the answer, for every pair above', () => {
    for (const [a, b, expected] of CASES) expect(compareVersions(b, a)).toBe(expected === 0 ? 0 : -expected)
  })

  it('orders a shuffled list oldest to newest', () => {
    const shuffled = ['1.10.0', '1.2.1', '1.2', '0', '1.9.9', '2', '1.2.10', '1.3']
    expect([...shuffled].sort(compareVersions)).toEqual(['0', '1.2', '1.2.1', '1.2.10', '1.3', '1.9.9', '1.10.0', '2'])
  })
})

// The version itself comes from the build (`define`), read once when the module loads.
describe('APP_VERSION', () => {
  async function loadWith(version: string | undefined) {
    vi.resetModules()
    vi.unstubAllGlobals()
    if (version !== undefined) vi.stubGlobal('__APP_VERSION__', version)
    return import('./version')
  }

  it('is the build-time define, whatever it holds', async () => {
    expect((await loadWith('1.2.1')).APP_VERSION).toBe('1.2.1')
    expect((await loadWith('7.8.9')).APP_VERSION).toBe('7.8.9')
  })

  it('has no default: with no define the module refuses to load, so a version nobody set cannot pass or fail a gate', async () => {
    await expect(loadWith(undefined)).rejects.toThrow(ReferenceError)
  })
})
