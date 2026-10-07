// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import PlanTargetsPanel from './PlanTargetsPanel'
import type { WeekPlanSet } from '../../types'

// Chunk 19 (SPEC "Targets" — "PlanTargetsPanel shows weight targets
// alongside RIR"). "No placeholder when absent" is this component's own
// pre-existing convention for RIR ("—") — weight gets the OPPOSITE
// convention (nothing at all when absent), per the D30 "no target shows no
// target" rule, since every set before this chunk has no target_weight.

afterEach(() => cleanup())

function makeSet(overrides: Partial<WeekPlanSet>): WeekPlanSet {
  return {
    id: 'wps1', weekPlanId: 'wp1', userId: 'u1', programExerciseId: 'pe1',
    setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
    ...overrides,
  }
}

describe('PlanTargetsPanel — weight target alongside RIR (chunk 19)', () => {
  it('no weight target: shows RIR only, nothing weight-related at all', () => {
    render(<PlanTargetsPanel plannedSets={[makeSet({})]} />)

    expect(screen.getByText('RIR 2')).toBeTruthy()
    expect(screen.queryByText(/kg|lbs/)).toBeNull()
  })

  it('a weight target shows alongside RIR, in the resolved unit (kg default)', () => {
    render(<PlanTargetsPanel plannedSets={[makeSet({ targetWeight: 100 })]} />)

    expect(screen.getByText('RIR 2')).toBeTruthy()
    expect(screen.getByText('100kg')).toBeTruthy()
  })

  it('resolves to the passed weightUnit (lbs) — the exercise\'s own override', () => {
    render(<PlanTargetsPanel plannedSets={[makeSet({ targetWeight: 102.06 })]} weightUnit="lbs" />)

    expect(screen.getByText('225lbs')).toBeTruthy()
  })

  it('NO PLAN (empty) is unaffected by any of this', () => {
    render(<PlanTargetsPanel plannedSets={[]} />)
    expect(screen.getByText('NO PLAN')).toBeTruthy()
  })
})
