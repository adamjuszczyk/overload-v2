// @vitest-environment jsdom
//
// Chunk 21 (SPEC "Deload" — "'DELOAD' for that session, not 'DELOAD
// WEEK'"). GymSession.tsx's own header already read `{weekPlan?.isDeload ?
// 'DELOAD · ' : ''}WEEK {weekNumber}` before this chunk (unchanged by it —
// the brief's own Fact section found it already correct, just never
// live-exercised: L1, "no week plan has ever been marked deload"). This
// file is the positive proof the brief calls for ("jsdom: ... the workout
// screen show 'DELOAD' only on marked sessions, and never 'DELOAD WEEK'")
// and one of the break-proof targets ("the label's condition, shown on a
// non-deload session").
//
// A SEPARATE file from D30's own (GymSession.d30.test.tsx) — that fixture's
// session isn't deload and stays byte-identical regardless of anything
// here; this file renders its own minimal session, same seam as
// GymSession.weightTarget.test.tsx.
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
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={3} today="2026-01-05" />
    </MemoryRouter>
  )
}

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
  exercise: { id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
}

function planSet(id: string, programExerciseId: string, setNumber: number): WeekPlanSet {
  return {
    id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId, setNumber,
    targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
  }
}

function makeWeekPlan(isDeload: boolean): WeekPlan {
  return {
    id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 3,
    isDeload, notes: null, sets: [planSet('set-1', 'pe-1', 1)], exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
  }
}

describe('GymSession — the session header labels DELOAD per session, never DELOAD WEEK (chunk 21)', () => {
  it('a deload session\'s own plan row shows "DELOAD · WEEK 3", not "DELOAD WEEK"', () => {
    render(sessionJsx(workoutDay, makeWeekPlan(true)))
    expect(screen.getByText('DELOAD · WEEK 3')).toBeTruthy()
    expect(screen.queryByText(/DELOAD WEEK/)).toBeNull()
  })

  it('a non-deload session shows plain "WEEK 3", no DELOAD text anywhere', () => {
    render(sessionJsx(workoutDay, makeWeekPlan(false)))
    expect(screen.getByText('WEEK 3')).toBeTruthy()
    expect(screen.queryByText(/DELOAD/)).toBeNull()
  })
})
