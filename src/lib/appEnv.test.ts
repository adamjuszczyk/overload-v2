import { describe, it, expect } from 'vitest'
import { resolveAppEnv, supabaseRefOf, assertStagingNotOnProduction, PRODUCTION_SUPABASE_REF } from './appEnv'

describe('resolveAppEnv', () => {
  it('reads staging, in any case and with spaces', () => {
    expect(resolveAppEnv('staging')).toBe('staging')
    expect(resolveAppEnv(' Staging ')).toBe('staging')
  })
  it('treats anything else, unset included, as the real app', () => {
    for (const raw of [undefined, null, '', 'production', 'stage', 'preview', 1]) {
      expect(resolveAppEnv(raw)).toBe('production')
    }
  })
})

describe('supabaseRefOf', () => {
  it('returns the project ref of a Supabase URL', () => {
    expect(supabaseRefOf(`https://${PRODUCTION_SUPABASE_REF}.supabase.co`)).toBe(PRODUCTION_SUPABASE_REF)
    expect(supabaseRefOf('https://abcdefghijklmnopqrst.supabase.co/')).toBe('abcdefghijklmnopqrst')
  })
  it('returns null for anything else', () => {
    expect(supabaseRefOf('http://127.0.0.1:54321')).toBeNull()
    expect(supabaseRefOf('https://example.com')).toBeNull()
  })
})

describe('assertStagingNotOnProduction', () => {
  const prodUrl = `https://${PRODUCTION_SUPABASE_REF}.supabase.co`
  it('refuses a staging build on the production database', () => {
    expect(() => assertStagingNotOnProduction('staging', prodUrl)).toThrow(/production database/)
  })
  it('allows a staging build on another project', () => {
    expect(() => assertStagingNotOnProduction('staging', 'https://abcdefghijklmnopqrst.supabase.co')).not.toThrow()
  })
  it('never blocks the real app', () => {
    expect(() => assertStagingNotOnProduction('production', prodUrl)).not.toThrow()
  })
})
