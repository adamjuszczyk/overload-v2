// @vitest-environment jsdom
//
// Chunk 19 review fix (first retry) — the reviewer's own break showed that
// hard-coding 'kg' in SetRow.tsx's weight hint (instead of
// useWeightDisplay(programExercise.weightUnit)'s resolvedUnit) left every
// existing test green, because none of them gave the exercise its own lbs
// override. This file renders the REAL GymSession -> ExerciseCard/
// SupersetBlock -> SetRow/PlanTargetsPanel tree (same precedent as
// GymSession.tempo.test.tsx/GymSession.restChain.test.tsx) with an
// lbs-resolved program exercise and a kg-stored weight target, and proves
// BOTH SetRow's hint and PlanTargetsPanel show lbs end to end — the real
// read path (weekPlanService.ts's mapper -> ProgramExercise.weightUnit ->
// useWeightDisplay), not a unit test's own hand-built prop.
//
// A SEPARATE file from D30's own: nothing here touches
// gymsession-d30-render.html or its test, and that fixture's own pe1 has no
// weightUnit override (null) and no targetWeight at all, so D30 stays
// byte-identical regardless of anything in this file.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, WeekPlan, WeekPlanSet, WorkoutDay, Session } from '../../types'

afterEach(() => cleanup())

const session: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
  workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
  startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:00:00Z',
  setLogs: [], energyRating: null, pumpRating: null,
}

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({
  useScrollToCurrentSet: () => ({ containerRef: { current: null }, direction: null, scrollToCurrentSet: () => {} }),
}))
vi.mock('./RestTimer', () => ({ default: () => null }))
vi.mock('./SessionComplete', () => ({ default: () => null }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./SwapExerciseSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }),
  useSupersetBlockRests: () => ({ data: [] }),
  useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn() }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({
    data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn(),
  }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')

function sessionJsx(workoutDay: WorkoutDay, weekPlan: WeekPlan) {
  return (
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>
  )
}

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

function makeExercise(overrides: Partial<ProgramExercise> & { id: string; exerciseId: string; name: string }): ProgramExercise {
  const { name, ...rest } = overrides
  return {
    workoutDayId: 'wd-1', userId: 'user-1', position: 0, weightUnit: null,
    exercise: {
      id: overrides.exerciseId, userId: 'user-1', name, muscleGroup: 'chest', isArchived: false,
      createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
      status: 'active', sourceLibraryId: null, lostAt: null,
    },
    ...rest,
  }
}

function planSet(id: string, programExerciseId: string, setNumber: number, overrides: Partial<WeekPlanSet> = {}): WeekPlanSet {
  return {
    id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId, setNumber,
    targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
    ...overrides,
  }
}

describe('GymSession — weight target unit, real session (plain card)', () => {
  it('an LBS-resolved exercise shows its kg-stored weight target in lbs — SetRow\'s hint AND PlanTargetsPanel, never kg', () => {
    const pe1 = makeExercise({ id: 'pe-1', exerciseId: 'ex-1', name: 'Bench Press', weightUnit: 'lbs' })
    const weekPlan: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null,
      sets: [planSet('set-1', 'pe-1', 1, { targetWeight: 102.06 })],
      exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
    }
    render(sessionJsx(workoutDay, weekPlan))

    expect(screen.getByText('Bench Press')).toBeTruthy()
    // SetRow's own hint, in the not-yet-logged input row.
    expect(screen.getByText('TARGET WEIGHT 225lbs')).toBeTruthy()
    // PlanTargetsPanel, alongside RIR.
    expect(screen.getByText('225lbs')).toBeTruthy()
    // Never shown in kg anywhere on this screen for this exercise.
    expect(screen.queryByText(/102\.06/)).toBeNull()
    expect(screen.queryByText('100kg')).toBeNull()
  })

  it('a KG-resolved exercise (the default) still shows kg, proving this is a real resolution, not lbs hard-coded the other way', () => {
    const pe1 = makeExercise({ id: 'pe-1', exerciseId: 'ex-1', name: 'Squat' }) // weightUnit: null -> global default, kg
    const weekPlan: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null,
      sets: [planSet('set-1', 'pe-1', 1, { targetWeight: 100 })],
      exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
    }
    render(sessionJsx(workoutDay, weekPlan))

    expect(screen.getByText('TARGET WEIGHT 100kg')).toBeTruthy()
    expect(screen.getByText('100kg')).toBeTruthy() // PlanTargetsPanel
  })
})

describe('GymSession — weight target unit, real session (superset member)', () => {
  const ssWorkoutDay: WorkoutDay = { id: 'wd-ss', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

  it('an lbs-resolved member of a superset block shows its weight target in lbs too (SupersetBlock\'s own PlanTargetsPanel/SetRow)', () => {
    const peA = makeExercise({ id: 'pe-a', exerciseId: 'ex-a', name: 'Bench Press', workoutDayId: 'wd-ss', position: 0, supersetBlockId: 'block-1', weightUnit: 'lbs' })
    const peB = makeExercise({ id: 'pe-b', exerciseId: 'ex-b', name: 'Barbell Row', workoutDayId: 'wd-ss', position: 1, supersetBlockId: 'block-1' })
    const weekPlan: WeekPlan = {
      id: 'wp-ss', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-ss', weekNumber: 1,
      isDeload: false, notes: null,
      sets: [planSet('set-a1', 'pe-a', 1, { targetWeight: 102.06 }), planSet('set-b1', 'pe-b', 1)],
      exercises: [peA, peB], createdAt: '2026-01-01T00:00:00Z',
    }
    render(sessionJsx(ssWorkoutDay, weekPlan))

    expect(screen.getByText('Bench Press')).toBeTruthy()
    expect(screen.getByText('Barbell Row')).toBeTruthy()
    expect(screen.getByText('TARGET WEIGHT 225lbs')).toBeTruthy()
    expect(screen.getByText('225lbs')).toBeTruthy() // A's own PlanTargetsPanel
    expect(screen.queryByText(/102\.06/)).toBeNull()
  })
})
