import { describe, it, expect, afterEach, vi } from 'vitest'
import { isCoachUser } from './coachGate'

// Covers the "everyone else sees the locked placeholder" path
// (COACH-ANALYSIS-SPEC.md §3) live-tested against only one real account
// this session — see CONTEXT.md. This is the exact boolean both
// CoachPage.tsx and Nav.tsx gate on.

const GATED_ID = '12e79b69-9891-4f53-a7cf-650edd83659f'
const OTHER_ID = 'a12527e1-a4c0-420f-b902-2eefdd8ff6d3'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('isCoachUser', () => {
  it('is true for the gated user id', () => {
    vi.stubEnv('VITE_COACH_USER_ID', GATED_ID)
    expect(isCoachUser(GATED_ID)).toBe(true)
  })

  it('is false for any other account', () => {
    vi.stubEnv('VITE_COACH_USER_ID', GATED_ID)
    expect(isCoachUser(OTHER_ID)).toBe(false)
  })

  it('is false when logged out (undefined userId)', () => {
    vi.stubEnv('VITE_COACH_USER_ID', GATED_ID)
    expect(isCoachUser(undefined)).toBe(false)
  })

  it('is false for everyone, including the would-be gated id, when the env var is unset', () => {
    vi.stubEnv('VITE_COACH_USER_ID', '')
    expect(isCoachUser(GATED_ID)).toBe(false)
    expect(isCoachUser(undefined)).toBe(false)
  })
})
