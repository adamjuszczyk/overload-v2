import { describe, expect, it } from 'vitest'
import { reachableFrom, resolveImport, runtimeImports } from './moduleGraph'

// The reader that `textOnAccent.static.test.ts` stands on for "which screens use this component". Each test feeds it a few lines
// of source in one of the shapes the app writes, so a change that stops it seeing a shape (or makes it see one that isn't loaded
// at run time) fails here and not silently there.

const importsOf = (source: string, file = 'sample.tsx') => runtimeImports(source, file)

describe('runtimeImports: the modules a file loads when it runs', () => {
  it('a static import, a default import and a namespace import', () => {
    expect(
      importsOf(`
        import A from './a'
        import { b, c } from './b'
        import * as d from '../d.js'
        import E, { f } from './e'
      `),
    ).toEqual(['./a', './b', '../d.js', './e'])
  })

  it('a side-effect import is loaded for what it does', () => {
    expect(importsOf(`import './setup'`)).toEqual(['./setup'])
  })

  it('`import type` is erased: a screen that takes only a type from a file does not use that file', () => {
    expect(
      importsOf(`
        import type { A } from './types-only'
        import type B from './type-default'
        import type * as C from './type-namespace'
      `),
    ).toEqual([])
  })

  it('an import whose every specifier is `type` is erased too, and one value among them keeps it', () => {
    expect(
      importsOf(`
        import { type A, type B } from './only-types'
        import { type C, d } from './one-value'
        import E, { type F } from './default-and-type'
      `),
    ).toEqual(['./one-value', './default-and-type'])
  })

  it('`export ... from` loads the module, unless it only re-exports types', () => {
    expect(
      importsOf(`
        export { a } from './a'
        export * from './b'
        export * as c from './c'
        export type { D } from './d'
        export { type E } from './e'
        export { type F, g } from './fg'
      `),
    ).toEqual(['./a', './b', './c', './fg'])
  })

  it('an export without `from` loads nothing', () => {
    expect(importsOf(`export const a = 1\nexport { a as b }`)).toEqual([])
  })

  it('a dynamic import with a literal path counts, one built at run time does not', () => {
    expect(
      importsOf(`
        const A = lazy(() => import('./A'))
        const B = await import(\`./B\`)
        const C = await import(name)
        const D = await import(\`./\${name}\`)
      `),
    ).toEqual(['./A', './B'])
  })

  it('a comment or a string that quotes an import is no import', () => {
    expect(
      importsOf(`
        // import { a } from './in-a-comment'
        /* import b from './in-a-block-comment' */
        const text = "import c from './in-a-string'"
        export const d = text
      `),
    ).toEqual([])
  })

  it('reads a .ts file that has no JSX, and a .tsx file that has', () => {
    expect(importsOf(`import { a } from './a'\nexport const x = <T,>(v: T) => v`, 'sample.ts')).toEqual(['./a'])
    expect(importsOf(`import { a } from './a'\nexport const X = () => <a.B>{a}</a.B>`, 'sample.tsx')).toEqual(['./a'])
  })
})

describe('resolveImport: the source file a relative specifier names', () => {
  const files = new Set([
    'features/plan/PlanPage.tsx',
    'features/gym/RatingChips.tsx',
    'lib/plannerVocabulary.ts',
    'components/pickers/index.ts',
    'components/ui/index.tsx',
    'lib/plain.ts',
  ])
  const from = 'features/plan/PlanPage.tsx'

  it('finds a file with or without its extension, and `.js` for the `.ts` or `.tsx` file the app writes it for', () => {
    expect(resolveImport(from, '../gym/RatingChips', files)).toBe('features/gym/RatingChips.tsx')
    expect(resolveImport(from, '../gym/RatingChips.js', files)).toBe('features/gym/RatingChips.tsx')
    expect(resolveImport(from, '../../lib/plannerVocabulary.js', files)).toBe('lib/plannerVocabulary.ts')
    expect(resolveImport(from, '../../lib/plannerVocabulary.ts', files)).toBe('lib/plannerVocabulary.ts')
    expect(resolveImport(from, '../../lib/plain', files)).toBe('lib/plain.ts')
  })

  it('finds a folder by its index file', () => {
    expect(resolveImport(from, '../../components/pickers', files)).toBe('components/pickers/index.ts')
    expect(resolveImport(from, '../../components/ui', files)).toBe('components/ui/index.tsx')
  })

  it('leaves out a package, an alias, and a relative path that names no source file', () => {
    expect(resolveImport(from, 'react', files)).toBeNull()
    expect(resolveImport(from, '@scope/pkg', files)).toBeNull()
    expect(resolveImport(from, './PlanPage.css', files)).toBeNull()
    expect(resolveImport(from, '../gym/Missing', files)).toBeNull()
  })
})

describe('reachableFrom: everything a root loads, and which roots load it', () => {
  const sources = new Map<string, string>([
    ['screens/A.tsx', `import { shared } from '../parts/shared'\nimport type { OnlyType } from '../parts/types'\nexport const A = () => shared`],
    ['screens/B.tsx', `import { shared } from '../parts/shared'\nimport { own } from '../parts/own.js'\nexport const B = () => own + shared`],
    ['screens/C.tsx', `import { c } from '../parts/c'\nexport const C = () => c`],
    ['parts/shared.ts', `import { deep } from './deep'\nexport const shared = deep`],
    ['parts/deep.ts', `import { shared } from './shared'\nexport const deep = 1\nexport const back = shared`], // a cycle
    ['parts/own.ts', `export const own = 2`],
    ['parts/types.ts', `export type OnlyType = string`],
    ['parts/c.ts', `export const c = 3`],
  ])

  it('follows imports through files, and a file two roots load names both', () => {
    const reached = reachableFrom(['screens/A.tsx', 'screens/B.tsx'], sources)
    expect([...reached.keys()].sort()).toEqual(['parts/deep.ts', 'parts/own.ts', 'parts/shared.ts', 'screens/A.tsx', 'screens/B.tsx'])
    expect([...reached.get('parts/shared.ts')!].sort()).toEqual(['screens/A.tsx', 'screens/B.tsx'])
    expect([...reached.get('parts/deep.ts')!].sort()).toEqual(['screens/A.tsx', 'screens/B.tsx'])
    expect([...reached.get('parts/own.ts')!]).toEqual(['screens/B.tsx'])
  })

  it('does not reach a file that only a type import names, nor one that no root loads', () => {
    const reached = reachableFrom(['screens/A.tsx', 'screens/B.tsx'], sources)
    expect(reached.has('parts/types.ts')).toBe(false)
    expect(reached.has('parts/c.ts')).toBe(false)
    expect(reached.has('screens/C.tsx')).toBe(false)
  })

  it('stops at a cycle', () => {
    const reached = reachableFrom(['parts/shared.ts'], sources)
    expect([...reached.keys()].sort()).toEqual(['parts/deep.ts', 'parts/shared.ts'])
  })

  it('throws for a root that is not among the sources, so a renamed screen cannot leave the test reading nothing', () => {
    expect(() => reachableFrom(['screens/Gone.tsx'], sources)).toThrow(/screens\/Gone\.tsx/)
  })
})
