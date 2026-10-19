import { posix } from 'node:path'
import ts from 'typescript'

// The reader behind "which screens use this component" in `textOnAccent.static.test.ts` (DECISIONS 154, Adam 2026-10-16:
// `--on-accent` applies to the screens 1.2 rebuilds and the shared components they use; screens 1.2 doesn't touch keep their
// current code). It reads the syntax tree of a source file for the modules the file loads at run time, and follows the
// relative ones from a screen's file to everything that screen can load.
//
// Run-time imports only. `import type`, `export type` and an import or export whose every specifier is marked `type` are
// erased when the file is compiled, so a screen that takes only a type from a file doesn't use that file. A static import, an
// `export ... from` and a dynamic `import('./x')` with a literal path all count (a lazily loaded component is still used).
// Comments and strings are not code, so a comment that quotes an import is no import. Paths that are not relative (a package,
// `react`) and relative ones that name no source file (`./x.css`) are left out.

/** The module specifiers a file loads at run time, in the order written. */
export function runtimeImports(source: string, file: string): string[] {
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind)
  const found: string[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      if (!clause) found.push(node.moduleSpecifier.text) // `import './setup'`: loaded for what it does
      else if (!clause.isTypeOnly) {
        const named = clause.namedBindings
        const onlyTypes = !clause.name && named !== undefined && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly)
        if (!onlyTypes) found.push(node.moduleSpecifier.text)
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const named = node.exportClause
      const onlyTypes = node.isTypeOnly || (named !== undefined && ts.isNamedExports(named) && named.elements.length > 0 && named.elements.every((e) => e.isTypeOnly))
      if (!onlyTypes) found.push(node.moduleSpecifier.text)
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) found.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return found
}

/** The source file a relative specifier names, or null. `files` holds paths with forward slashes; the app writes `./x.js` for `./x.ts`. */
export function resolveImport(from: string, specifier: string, files: ReadonlySet<string>): string | null {
  if (!specifier.startsWith('.')) return null
  const base = posix.normalize(posix.join(posix.dirname(from), specifier))
  const bare = base.replace(/\.js$/, '')
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${bare}.ts`, `${bare}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (files.has(candidate)) return candidate
  }
  return null
}

/**
 * Every file the roots load at run time, themselves included, with the roots that reach it. `sources` maps a path (relative to
 * one folder, forward slashes) to its text. A root that is not among them throws: a screen that was renamed must not leave a
 * test reading nothing.
 */
export function reachableFrom(roots: readonly string[], sources: ReadonlyMap<string, string>): Map<string, Set<string>> {
  const files = new Set(sources.keys())
  const edges = new Map<string, string[]>()
  const loads = (file: string): string[] => {
    let list = edges.get(file)
    if (!list) {
      list = runtimeImports(sources.get(file)!, file).flatMap((specifier) => resolveImport(file, specifier, files) ?? [])
      edges.set(file, list)
    }
    return list
  }
  const reached = new Map<string, Set<string>>()
  for (const root of roots) {
    if (!files.has(root)) throw new Error(`reachableFrom: root ${root} is not among the source files`)
    const stack = [root]
    while (stack.length > 0) {
      const file = stack.pop()!
      const by = reached.get(file) ?? new Set<string>()
      if (by.has(root)) continue
      by.add(root)
      reached.set(file, by)
      stack.push(...loads(file))
    }
  }
  return reached
}
