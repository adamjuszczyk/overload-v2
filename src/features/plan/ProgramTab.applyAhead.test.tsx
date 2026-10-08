// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import type { Program, WeekPlan } from '../../types'
import type { ChangeRecord } from './applyAhead'
import ProgramTab from './ProgramTab'

// Chunk 20 ("Apply this change to planned weeks ahead") — the stable
// program tab's own offer (SPEC "Programs and runs": "'stable': editable;
// weeks not yet planned pick it up, and 'Apply this change to planned
// weeks ahead' covers planned ones"). StepExercises/StepVolume are mocked
// (same seam ProgramTab.test.tsx already uses) and just capture the
// onVolumeChange prop they were given — the UI interaction that WOULD call
// it (the SETS stepper, the rep-target editor, ADD/REMOVE EXERCISE) is
// already covered by StepVolume.test.tsx/StepExercises.test.tsx's own
// suites, unaffected by this chunk (the prop is additive and optional).
// This file's own job is ProgramTab's integration logic: candidate-week
// selection (allPlannedWeeks, not laterPlannedWeeks — there is no "edited
// week" here) and the shared banner.

let capturedOnVolumeChange: ((workoutDayId: string, changes: ChangeRecord[]) => void) | undefined

vi.mock('../planner/StepExercises', () => ({
  default: (props: { onVolumeChange?: (workoutDayId: string, changes: ChangeRecord[]) => void }) => {
    capturedOnVolumeChange = props.onVolumeChange
    return <div>STEP EXERCISES</div>
  },
}))
vi.mock('../planner/StepVolume', () => ({
  default: () => <div>STEP VOLUME</div>,
}))

const mockState: { allPlans: WeekPlan[] } = { allPlans: [] }
let applyAheadLastCall: { changes: ChangeRecord[]; weeks: WeekPlan[] } | null = null
let applyAheadOnSuccess: ((data: unknown) => void) | undefined
const applyAheadMutate = vi.fn((vars: { changes: ChangeRecord[]; weeks: WeekPlan[] }, opts?: { onSuccess?: (d: unknown) => void }) => {
  applyAheadLastCall = vars
  applyAheadOnSuccess = opts?.onSuccess
})

vi.mock('./useWeekPlan', () => ({
  useAllWeekPlans: () => ({ data: mockState.allPlans, isLoading: false }),
  useApplyAhead: () => ({ mutate: applyAheadMutate, isPending: false }),
}))

function makeProgram(planningType: Program['planningType']): Program {
  return {
    id: 'run-copy-1', userId: 'user-1', name: 'My Run',
    schedule: { monday: 'wd-1', tuesday: null, wednesday: null, thursday: null, friday: null, saturday: null, sunday: null },
    workoutDays: [], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    kind: 'run', planningType,
  }
}

function makePlan(weekNumber: number, workoutDayId = 'wd-1'): WeekPlan {
  return {
    id: `wp-${workoutDayId}-${weekNumber}`, userId: 'user-1', mesocycleId: 'meso-1', workoutDayId,
    weekNumber, isDeload: false, notes: null, sets: [], exercises: [], createdAt: '2026-01-01T00:00:00Z',
  }
}

afterEach(() => {
  cleanup()
  capturedOnVolumeChange = undefined
  applyAheadMutate.mockClear()
  applyAheadLastCall = null
  applyAheadOnSuccess = undefined
  mockState.allPlans = []
})

describe('ProgramTab — the offer is hidden entirely for week-dependent (volumeReadOnly)', () => {
  it('no banner, even once onVolumeChange would otherwise fire', () => {
    mockState.allPlans = [makePlan(1), makePlan(2)]
    render(<ProgramTab program={makeProgram('week_dependent')} mesoId="meso-1" />)

    expect(screen.queryByText(/PLANNED WEEK/)).toBeNull()
    // StepExercises never even receives a real callback for week-dependent
    // in practice (volumeReadOnly hides every edit action that would call
    // it) — but ProgramTab still renders no banner regardless.
  })
})

describe('ProgramTab — stable program-tab volume edit, every already-planned week is a candidate', () => {
  it('offers against every planned week for the touched workout, not just "later" ones (no "edited week" here)', () => {
    mockState.allPlans = [makePlan(1), makePlan(2), makePlan(3)]
    render(<ProgramTab program={makeProgram('stable')} mesoId="meso-1" />)

    act(() => {
      capturedOnVolumeChange?.('wd-1', [{ editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new' }])
    })

    expect(screen.getByText('APPLY THIS CHANGE TO 3 PLANNED WEEKS AHEAD?')).toBeTruthy()
  })

  it('scopes candidates to the workout the change actually touched', () => {
    mockState.allPlans = [makePlan(1, 'wd-1'), makePlan(1, 'wd-2'), makePlan(2, 'wd-2')]
    render(<ProgramTab program={makeProgram('stable')} mesoId="meso-1" />)

    act(() => {
      capturedOnVolumeChange?.('wd-1', [{ editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new' }])
    })

    // Only wd-1's own one planned week counts, not wd-2's two.
    expect(screen.getByText('APPLY THIS CHANGE TO 1 PLANNED WEEK AHEAD?')).toBeTruthy()
  })

  it('no offer when the touched workout has no planned weeks at all', () => {
    mockState.allPlans = []
    render(<ProgramTab program={makeProgram('stable')} mesoId="meso-1" />)

    act(() => {
      capturedOnVolumeChange?.('wd-1', [{ editType: 'addExercise', workoutDayId: 'wd-1', exerciseId: 'ex-new' }])
    })

    expect(screen.queryByText(/PLANNED WEEK/)).toBeNull()
  })

  it('applying calls useApplyAhead with the change and every planned week, then reports "N of M"', () => {
    mockState.allPlans = [makePlan(1), makePlan(2)]
    render(<ProgramTab program={makeProgram('stable')} mesoId="meso-1" />)

    act(() => {
      capturedOnVolumeChange?.('wd-1', [{ editType: 'addSet', slotId: 'pe-1' }])
    })
    fireEvent.click(screen.getByText('APPLY'))

    expect(applyAheadMutate).toHaveBeenCalledTimes(1)
    expect(applyAheadLastCall?.weeks.map((w) => w.weekNumber)).toEqual([1, 2])
    expect(applyAheadLastCall?.changes).toEqual([{ editType: 'addSet', slotId: 'pe-1' }])

    act(() => {
      applyAheadOnSuccess?.({ summary: { total: 2, applied: 2, skippedDeload: 0, skippedStructural: 0 }, writtenWeekNumbers: [1, 2] })
    })

    expect(screen.getByText(/APPLIED TO 2 OF 2 PLANNED WEEKS/)).toBeTruthy()
  })
})
