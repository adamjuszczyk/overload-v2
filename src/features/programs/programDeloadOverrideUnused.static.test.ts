import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

// Chunk 48 (SPEC Objects stored → Program [1.2]: "The stored deload-rules override is no longer read
// or written (16b). The column stays; no destructive migration. Any existing override falls back to
// Settings silently."; SPEC Removals: "the deload override column stays unread"). The behaviour is
// proven where each reader and writer was (programService.test.ts, PlanPage.deload*.test.tsx,
// StepVolume.test.tsx); this is the structural half: no code under src/ names the column or a writer
// of it, so a later chunk that reads or writes it (51a, 65, 67 all touch programs) has to say so here.
//
// Source text, not behaviour: it reads every non-test file under src/, comments removed. The one file
// that may name `deload_rules` is Settings' own service, whose column is a different table's
// (v2_user_settings.deload_rules, the rules a deload applies).

const SRC = fileURLToPath(new URL('../../', import.meta.url))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    const isSource = /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.testutil\.tsx?$/.test(name)
    return isSource ? [path] : []
  })
}

// The code of a file with its comments taken out (block comments, JSX comments, line comments).
function codeOf(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const FILES = sourceFiles(SRC).map((path) => ({ path: relative(SRC, path).split(sep).join('/'), code: codeOf(readFileSync(path, 'utf8')) }))
const filesMentioning = (pattern: RegExp) => FILES.filter((f) => pattern.test(f.code)).map((f) => f.path).sort()

describe('a program\'s stored deload-rules override is neither read nor written (chunk 48)', () => {
  it('the scan reads real code (so the absences below are not vacuous)', () => {
    expect(FILES.length).toBeGreaterThan(100)
    expect(filesMentioning(/\bv2_programs\b/)).toContain('features/programs/programService.ts')
    // Comments are stripped: programService.ts says in prose why the column is not selected, and that prose is not code.
    expect(readFileSync(join(SRC, 'features/programs/programService.ts'), 'utf8')).toContain('deload_rules')
    expect(FILES.find((f) => f.path === 'features/programs/programService.ts')!.code).not.toContain('deload_rules')
  })

  it('only Settings\' own service names the column in code (v2_user_settings.deload_rules)', () => {
    expect(filesMentioning(/\bdeload_rules\b/)).toEqual(['features/settings/settingsService.ts'])
  })

  it('nothing defines or calls a writer of a program\'s override', () => {
    expect(filesMentioning(/\b(use)?UpdateProgramDeloadRules\b/i)).toEqual([])
  })

  it('the Program type carries no deloadRules (the user\'s Settings rules are UserSettings.deloadRules)', () => {
    const types = FILES.find((f) => f.path === 'types/index.ts')!.code
    const program = /export interface Program \{[\s\S]*?\n\}/.exec(types)![0]
    expect(program).toContain('planningType')
    expect(program).not.toContain('deloadRules')
    expect(/export interface UserSettings \{[\s\S]*?\n\}/.exec(types)![0]).toContain('deloadRules')
  })
})
