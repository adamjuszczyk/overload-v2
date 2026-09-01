import { describe, it, expect } from 'vitest'
import { resolveQaRoute, QA_ROUTES } from './qaCategory'
import type { QaCategory } from '../../types'

const ALL_CATEGORIES: QaCategory[] = ['in_session', 'general', 'planning', 'app_mechanics']

describe('QA_ROUTES', () => {
  it('has exactly one entry per QaCategory literal, no more, no fewer', () => {
    expect(Object.keys(QA_ROUTES).sort()).toEqual([...ALL_CATEGORIES].sort())
  })
})

describe('resolveQaRoute', () => {
  it('routes in_session to Haiku 4.5 with no effort set', () => {
    const route = resolveQaRoute('in_session')
    expect(route.model).toBe('claude-haiku-4-5-20251001')
    expect(route.assembler).toBe('assembleInSessionContext')
    expect(route.maxTokens).toBe(2000)
    expect(route.effort).toBeUndefined()
  })

  it('routes general to Haiku 4.5 with no effort set', () => {
    const route = resolveQaRoute('general')
    expect(route.model).toBe('claude-haiku-4-5-20251001')
    expect(route.assembler).toBe('assembleGeneralContext')
    expect(route.maxTokens).toBe(2000)
    expect(route.effort).toBeUndefined()
  })

  it('routes app_mechanics to Haiku 4.5 with no effort set', () => {
    const route = resolveQaRoute('app_mechanics')
    expect(route.model).toBe('claude-haiku-4-5-20251001')
    expect(route.assembler).toBe('assembleAppMechanicsContext')
    expect(route.maxTokens).toBe(2000)
    expect(route.effort).toBeUndefined()
  })

  it('routes planning to Sonnet 5, a higher max_tokens, and effort: medium', () => {
    const route = resolveQaRoute('planning')
    expect(route.model).toBe('claude-sonnet-5')
    expect(route.assembler).toBe('assemblePlanningContext')
    expect(route.maxTokens).toBe(8000)
    expect(route.effort).toBe('medium')
  })

  it('is planning-only for effort — no other category ever sets it', () => {
    for (const category of ALL_CATEGORIES) {
      if (category === 'planning') continue
      expect(resolveQaRoute(category).effort).toBeUndefined()
    }
  })

  it('is Haiku-only for the 2,000 max_tokens ceiling — planning always gets more room', () => {
    for (const category of ALL_CATEGORIES) {
      if (category === 'planning') {
        expect(resolveQaRoute(category).maxTokens).toBeGreaterThan(2000)
      } else {
        expect(resolveQaRoute(category).maxTokens).toBe(2000)
      }
    }
  })

  it('never mixes up the Sonnet model id with a date-suffixed form', () => {
    // TASKS §0.1 correction 1 — claude-sonnet-5 takes no date suffix; a
    // future edit pattern-matching the Haiku pin would produce an invalid id.
    expect(resolveQaRoute('planning').model).toBe('claude-sonnet-5')
    expect(resolveQaRoute('planning').model).not.toMatch(/-\d{8}$/)
  })
})
