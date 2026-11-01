import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chunk 73 (SPEC.md 1.2.1, Screens → Update to continue [11]: "It replaces the RELOAD banner (PwaUpdateNotice), which is removed."; TASKS.md chunk 73,
// D: "Absence: PwaUpdateNotice imported nowhere; no 'UPDATE AVAILABLE' string in the bundle"). The structural half of that, on the source: the banner and
// the hook that fed it are gone as files, nothing imports or mocks them (a test that mocks a module that no longer exists passes silently while the real
// one loads unmocked: RULES.md, chunk 64's builder), and the one registration of the service worker is made once, in App(). The bundle itself is
// grepped in the chunk's report after `npm run build`. The names are built from parts so that this file does not name them whole.
//
// Source text, not behaviour: every file under src/, comments removed where a string is looked for.

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const NOTICE = ['Pwa', 'Update', 'Notice'].join('')
const HOOK = ['use', 'Pwa', 'Update'].join('')
const BANNER_WORDS = ['UPDATE', ' ', 'AVAILABLE'].join('')
const DISMISS = ['Dismiss', ' update ', 'notice'].join('')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.tsx?$/.test(name) ? [path] : []
  })
}
const codeOf = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const ALL = walk(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }))
const NON_TEST = ALL.filter((f) => !/\.test\.tsx?$/.test(f.path) && !/\.testutil\.tsx?$/.test(f.path)).map((f) => ({ path: f.path, code: codeOf(f.text) }))
// A module specifier: a quoted relative path with no space in it (an import, a dynamic import, a vi.mock), not a sentence that mentions the name.
const namesAModule = (name: string) => new RegExp(`['"\`]\\.{1,2}/[^'"\`\\s]*${name}[^'"\`\\s]*['"\`]`)

describe('the RELOAD banner and its hook are gone (chunk 73)', () => {
  it('the scan reads real code (so the absences below are not vacuous)', () => {
    expect(NON_TEST.length).toBeGreaterThan(100)
    expect(NON_TEST.map((f) => f.path)).toContain('features/pwa/useServiceWorker.ts')
    expect(NON_TEST.map((f) => f.path)).toContain('App.tsx')
  })

  it('neither file exists any more', () => {
    const paths = ALL.map((f) => f.path)
    expect(paths.filter((p) => p.includes(NOTICE) || p.includes(HOOK))).toEqual([])
  })

  it('no file, tests and their mocks included, names either as a module', () => {
    const naming = ALL.filter((f) => namesAModule(NOTICE).test(f.text) || namesAModule(HOOK).test(f.text)).map((f) => f.path)
    expect(naming).toEqual([])
  })

  it('no screen text of the banner is left in the app: not its words, not its dismiss button', () => {
    const words = NON_TEST.filter((f) => f.code.includes(BANNER_WORDS) || f.code.includes(DISMISS)).map((f) => f.path)
    expect(words).toEqual([])
  })
})

describe('the service worker is registered once, in App(), whatever the app is showing', () => {
  const calls = NON_TEST.filter((f) => /\buseServiceWorker\(\)(?!\s*:)/.test(f.code)).map((f) => f.path)

  it('exactly one call in the app, and it is App.tsx\'s', () => {
    expect(calls).toEqual(['App.tsx'])
  })

  it('and it is App()\'s, not AppRoutes\' (the routes sit under the gates, App() above them)', () => {
    const app = NON_TEST.find((f) => f.path === 'App.tsx')!.code
    const at = app.search(/\buseServiceWorker\(\)(?!\s*:)/)
    expect(at).toBeGreaterThan(app.indexOf('export default function App()'))
    expect(at).toBeLessThan(app.indexOf('export function AppRoutes()'))
  })
})
