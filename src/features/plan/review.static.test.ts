import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// Chunk 43: what review.ts must not become, read from its source (the approach of the other pure
// modules' static tests): pure (no Supabase, React, store, clock or randomness of its own), one matcher
// (weekPlanning's, not a second one), and the key function the one place a decision's key is built.

const here = dirname(fileURLToPath(import.meta.url))
const read = (name: string) => readFileSync(join(here, name), 'utf8')
const withoutComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

const importsOf = (source: string): string[] =>
  [...withoutComments(source).matchAll(/import\s+(?:type\s+)?(?:[\s\S]*?)\sfrom\s+'([^']+)'/g)].map((m) => m[1])

const ALLOWED = ['date-fns', '../../types', '../../lib/plannerVocabulary', '../../lib/weightUnit', './weekPlanning']

describe('review.ts is a pure module', () => {
  const source = read('review.ts')

  it('imports only the date library, the app\'s types and vocabulary, the unit conversion and weekPlanning', () => {
    const imports = importsOf(source)
    expect(imports.length).toBeGreaterThanOrEqual(5)
    expect(imports.filter((i) => !ALLOWED.includes(i))).toEqual([])
  })

  it('the check finds a forbidden import (it is not vacuous)', () => {
    const bad = `import { supabase } from '../../lib/supabase'\nimport { useSettingsStore } from '../settings/settingsStore'\nimport React from 'react'`
    expect(importsOf(bad)).toEqual(['../../lib/supabase', '../settings/settingsStore', 'react'])
    expect(importsOf(bad).filter((i) => !ALLOWED.includes(i))).toHaveLength(3)
  })

  it('reads no clock and draws no random number; the only id it makes is the default generator for a new row', () => {
    const code = withoutComments(source)
    for (const pattern of [/Date\.now\(/, /new Date\(/, /Math\.random\(/, /localStorage/, /\bfetch\(/, /supabase/i, /useSettingsStore/]) {
      expect(code, String(pattern)).not.toMatch(pattern)
    }
    expect(code.match(/crypto\.randomUUID\(\)/g)).toHaveLength(1)
  })
})

describe('one matcher, one key function', () => {
  const source = read('review.ts')
  const code = withoutComments(source)

  it('matches last week\'s exercises and sets to this week\'s with weekPlanning\'s own pairing', () => {
    expect(code).toMatch(/import \{[^}]*\bpairByExercise\b[^}]*\bpairSets\b[^}]*\} from '\.\/weekPlanning'/)
    // exported there since chunk 43, not copied here
    const planning = read('weekPlanning.ts')
    expect(planning).toMatch(/export function pairByExercise\(/)
    expect(planning).toMatch(/export function pairSets\(/)
    expect(code).not.toMatch(/function pair(ByExercise|Sets)\b/)
  })

  it('every decision key is built by itemKey: no other template in the module starts a key', () => {
    const prefixes = [...code.matchAll(/`(num|skipped|type|added-set|added-ex|swap):/g)].map((m) => m[1])
    // An added set has two templates since chunk 56: its place, and its number for a set logged before 044 (DECISIONS 195 (a)); both are `itemKey`'s.
    expect(prefixes.sort()).toEqual(['added-ex', 'added-set', 'added-set', 'num', 'skipped', 'swap', 'type'])
  })
})
