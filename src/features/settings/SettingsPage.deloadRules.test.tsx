// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { UserSettings } from '../../types'
import { DEFAULT_SETTINGS } from './settingsStore'
import { DEFAULT_DELOAD_SETS_RULE } from '../../lib/plannerVocabulary.js'

// Chunk 22 — Settings' own DELOAD RULES section (SPEC.md "Settings" —
// "default deload rules"), off by default. Renders the REAL
// DeloadRulesEditor.tsx (the same component the program override mounts —
// reviewer's note 7: "same editor component"); only useSettings/useAuth
// are mocked, same minimal seam every other page-level test in this app
// uses.

afterEach(() => cleanup())
beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 375 })
})

let settings: UserSettings = { ...DEFAULT_SETTINGS }
const updateDeloadRulesMutate = vi.fn()

vi.mock('./useSettings', () => ({
  useSettings: () => ({ data: settings }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
  useUpdateDeloadRules: () => ({ mutate: updateDeloadRulesMutate }),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }))

// SettingsPage's own ABOUT section reads these two vite `define` globals
// (vite.config.ts) — real under the app's own Vite build, but vitest.config.ts
// runs no such define step, so they're undefined under plain `vitest run`
// for this, the first test file to import SettingsPage.tsx directly.
vi.stubGlobal('__BUILD_HASH__', 'test')
vi.stubGlobal('__BUILD_TIME__', '2026-01-01T00:00:00.000Z')

const { default: SettingsPage } = await import('./SettingsPage')

afterEach(() => {
  settings = { ...DEFAULT_SETTINGS }
  updateDeloadRulesMutate.mockReset()
})

describe('SettingsPage — DELOAD RULES section (chunk 22)', () => {
  it('renders the section, off by default (no rule editor visible)', () => {
    render(<SettingsPage />)
    expect(screen.getByText('DELOAD RULES')).toBeTruthy()
    expect(screen.queryByText('PERCENT')).toBeNull()
  })

  it('turning SETS on calls useUpdateDeloadRules with the default sets rule', () => {
    render(<SettingsPage />)
    fireEvent.click(screen.getByLabelText('Sets'))
    expect(updateDeloadRulesMutate).toHaveBeenCalledWith({ sets: { ...DEFAULT_DELOAD_SETS_RULE } })
  })

  it('an existing global rules value renders the editor pre-filled', () => {
    settings = { ...DEFAULT_SETTINGS, deloadRules: { reps: { delta: -2 } } }
    render(<SettingsPage />)
    expect(screen.getByText('-2')).toBeTruthy()
  })

  it('every other section still renders unchanged (purely additive — the new section adds, never replaces)', () => {
    render(<SettingsPage />)
    expect(screen.getByText('APPEARANCE')).toBeTruthy()
    expect(screen.getByText('REST TIMER')).toBeTruthy()
    expect(screen.getByText('WARMUP SETS')).toBeTruthy()
    expect(screen.getByText('PLANNING')).toBeTruthy()
    expect(screen.getByText('ACCOUNT')).toBeTruthy()
  })
})

describe('SettingsPage — 375px', () => {
  it('no rendered element carries a fixed pixel width wider than 375px, with the deload section fully expanded', () => {
    settings = {
      ...DEFAULT_SETTINGS,
      deloadRules: {
        sets: { mode: 'percent', value: 50, rounding: 'down' },
        weight: { percent: 75, rounding: 'down', step: 2.5, stepUnit: 'kg' },
        reps: { delta: -2 },
        rir: { delta: 1 },
      },
    }
    const { container } = render(<SettingsPage />)
    const offenders: string[] = []
    for (const el of container.querySelectorAll<HTMLElement>('[style]')) {
      for (const prop of ['width', 'minWidth'] as const) {
        const value = el.style[prop]
        const m = /^(\d+(?:\.\d+)?)px$/.exec(value)
        if (m && Number(m[1]) > 375) offenders.push(`${el.tagName}.${prop}=${value}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
