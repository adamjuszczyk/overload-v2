// @vitest-environment jsdom
//
// Chunk 25 (reviewer's note 5 — "Wire the run's real schedule_type
// through, and add a screen-layer test that a sequence run shows LAST TIME
// and no EARLIER THIS WEEK"). A trimmed sibling of GymSession.
// referenceByExercise.test.tsx (chunk 23's own real-tree render), one
// plain exercise instead of its full superset/swap/extra fixture — this
// file's only question is which LABEL the reference panel shows for the
// SAME underlying data, under the two scheduleType values GymSession can
// now be given.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session } from '../../types'
import type { ReferenceSession } from './sessionService'

afterEach(() => cleanup())
beforeEach(() => useExerciseReferenceSessionsMock.mockClear())

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

const pe: ProgramExercise = {
  id: 'pe-a', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-a', position: 0, weightUnit: null,
  exercise: {
    id: 'ex-a', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
    createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
    status: 'active', sourceLibraryId: null, lostAt: null,
  },
}

const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
  isDeload: false, notes: null,
  sets: [{ id: 'set-a1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-a', setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false }],
  exercises: [pe],
  createdAt: '2026-01-01T00:00:00Z',
}

const session: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
  workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
  startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:00:00Z',
  setLogs: [], energyRating: null, pumpRating: null,
}

// Today is Monday 2026-01-05; this match is from the IMMEDIATELY preceding
// week (Monday 2025-12-29's own calendar week, matching the weekday
// 'last_week' window referenceLogic.ts already proves elsewhere) — exactly
// the fixture shape that resolves to LAST WEEK under weekday rules and
// MUST resolve to LAST TIME instead under sequence rules (SPEC "'Last
// time' reference" — "Sequence: always LAST TIME + elapsed time. EARLIER
// THIS WEEK is hidden.").
function refSession(): ReferenceSession {
  return {
    sessionId: 'ref-1', date: '2025-12-30', completedAt: null, mesocycleId: 'meso-1',
    logs: [{
      head: {
        id: 'ref-1-log', userId: 'user-1', sessionId: 'ref-1', exerciseId: 'ex-a',
        weekPlanSetId: null, setNumber: 1, weight: 100, reps: 5, rir: 2, note: null, isDropset: false,
        parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null,
        isSkipped: false, loggedAt: '2025-12-30T10:00:00Z', restSeconds: null, formRating: null,
      },
      stages: [],
    }],
  }
}

const referenceMap = new Map<string, ReferenceSession[]>([['ex-a', [refSession()]]])

const useExerciseReferenceSessionsMock = vi.fn(() => ({
  data: referenceMap, isLoading: false, isError: false, isFromCache: false, retry: vi.fn(),
}))

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
  useExerciseReferenceSessions: () => useExerciseReferenceSessionsMock(),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')

function renderSession(scheduleType?: 'weekday' | 'sequence') {
  return render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" scheduleType={scheduleType} />
    </MemoryRouter>,
  )
}

describe('GymSession — ExerciseReference scheduleType wiring (chunk 25, reviewer\'s note 5)', () => {
  it('scheduleType omitted (every pre-chunk-25 caller) defaults to weekday — shows LAST WEEK for this fixture, exactly as before', () => {
    renderSession(undefined)
    expect(screen.getByText('LAST WEEK')).toBeTruthy()
    expect(screen.queryByText('LAST TIME')).toBeNull()
  })

  it('scheduleType="weekday" explicitly behaves identically', () => {
    renderSession('weekday')
    expect(screen.getByText('LAST WEEK')).toBeTruthy()
  })

  it('scheduleType="sequence" shows LAST TIME instead of LAST WEEK for the exact same underlying data (SPEC: "Sequence: always LAST TIME")', () => {
    renderSession('sequence')
    expect(screen.getByText('LAST TIME')).toBeTruthy()
    expect(screen.queryByText('LAST WEEK')).toBeNull()
  })

  it('scheduleType="sequence" never shows EARLIER THIS WEEK (SPEC: "EARLIER THIS WEEK is hidden")', () => {
    renderSession('sequence')
    expect(screen.queryByText('EARLIER THIS WEEK')).toBeNull()
  })

  it('the header reads CYCLE, not WEEK, for a sequence run', () => {
    renderSession('sequence')
    expect(screen.getByText('CYCLE 1')).toBeTruthy()
    expect(screen.queryByText('WEEK 1')).toBeNull()
  })

  it('the header still reads WEEK for a weekday run (default)', () => {
    renderSession(undefined)
    expect(screen.getByText('WEEK 1')).toBeTruthy()
  })
})
