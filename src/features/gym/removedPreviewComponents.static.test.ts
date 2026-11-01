import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chunk 77 (TASKS "Facts to verify" 8: "Both components are imported only by PreviewExerciseCard.tsx, which only SessionPreview.tsx imports"): the preview is
// drawn with the workout's parts now, and the three components the old one was made of are gone: the card, the targets panel (its "planned RIR" line and
// its "TARGET RIR n" rows) and the old last-time panel. This proves they are imported nowhere, in the app, in a test or in a test mock (a `vi.mock` of a
// path that no longer exists passes silently while the real module loads: RULES), and that their files are not back.

const SRC = fileURLToPath(new URL('../../', import.meta.url))
const GYM = join(SRC, 'features', 'gym')
const REMOVED = ['PreviewExerciseCard', 'PlanTargetsPanel', 'ExerciseReference']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__fixtures__' ? [] : sourceFiles(path)
    return /\.[jt]sx?$/.test(name) ? [path] : []
  })
}

// A module specifier ending in one of the names, in the shapes a module is named by: `from '…'` (import and re-export), `import('…')`, `vi.mock('…'`.
const NAMES = REMOVED.join('|')
const SPECIFIER = new RegExp(`(?:\\bfrom\\s*|\\bimport\\s*\\(\\s*|\\bvi\\.(?:mock|doMock|importActual)\\s*\\(\\s*)['"][^'"\\n]*/(?:${NAMES})(?:\\.[jt]sx?)?['"]`)

describe('the preview\'s old components are gone', () => {
  it('their files are not in the app', () => {
    for (const name of REMOVED) {
      for (const extension of ['tsx', 'ts']) expect(existsSync(join(GYM, `${name}.${extension}`)), `${name}.${extension}`).toBe(false)
    }
  })

  it('no source, test or test mock under src/ imports them', () => {
    // This file is left out of its own scan: its samples below are the shapes the scan must catch.
    const scanned = sourceFiles(SRC).filter((path) => path !== fileURLToPath(import.meta.url))
    expect(scanned.length).toBeGreaterThan(300)
    const importers = scanned.filter((path) => SPECIFIER.test(readFileSync(path, 'utf8'))).map((path) => relative(SRC, path).split(sep).join('/'))
    expect(importers).toEqual([])
  })

  it('the scan sees every shape a module is named by, and nothing that only resembles a name', () => {
    for (const named of [
      "import PlanTargetsPanel from './PlanTargetsPanel'",
      "import ExerciseReference, { x } from '../gym/ExerciseReference.tsx'",
      "export { default } from './PreviewExerciseCard'",
      "const { default: Card } = await import('./PreviewExerciseCard')",
      "vi.mock('./ExerciseReference', () => ({ default: () => null }))",
      'vi.mock("./PlanTargetsPanel", () => ({}))',
    ]) {
      expect(SPECIFIER.test(named), named).toBe(true)
    }
    for (const other of [
      "import { resolveExerciseReference } from './referenceLogic'",
      "import { useExerciseReferenceSessions } from './useSession'",
      "import x from './ExerciseReferenceNote'",
      "import y from './NotPreviewExerciseCards'",
      '// an old comment: PlanTargetsPanel is gone',
    ]) {
      expect(SPECIFIER.test(other), other).toBe(false)
    }
  })
})
