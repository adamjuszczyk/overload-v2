// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session } from '../../types'

// Chunk 7 (TASKS.md "Each planned session owns its exercise list — refactor,
// no visible change"): proves GymSession renders byte-identical output
// before and after this chunk, for the same underlying data, and that it is
// actually reading the NEW source (weekPlan.exercises) rather than
// coincidentally matching.
//
// __fixtures__/gymsession-chunk6-render.html is the frozen "before":
// captured by rendering build/chunk-6's own GymSession.tsx (commit 5f0b03e)
// with this exact fixture data, mocking useProgramExercises (chunk 6's only
// exercise source) to return [pe1, pe2] and ./ExerciseCard to a deterministic
// stub (id|name|position|plannedSetIds) — see this chunk's report for the
// exact throwaway capture script (run once on a build/chunk-6 worktree,
// output copied here, never committed there).
//
// This test renders the SAME component tree on THIS branch with the SAME
// fixture, but swaps which mock carries the real data: useProgramExercises
// (the fallback, used only when there is no week plan) now returns a
// deliberately WRONG list, and weekPlan.exercises (the new source) carries
// the real [pe1, pe2] instead. If GymSession still read useProgramExercises
// while a week plan exists, the stub card would show "DECOY EXERCISE"
// instead of Bench Press/Incline Press, and this test would fail.

afterEach(() => cleanup())

const workoutDay: WorkoutDay = {
  id: 'wd-1',
  programId: 'prog-1',
  userId: 'user-1',
  name: 'Push Day',
  position: 0,
  exercises: [],
}

const pe1: ProgramExercise = {
  id: 'pe-1',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-1',
  position: 0,
  weightUnit: null,
  exercise: {
    id: 'ex-1',
    userId: 'user-1',
    name: 'Bench Press',
    muscleGroup: 'chest',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
}

const pe2: ProgramExercise = {
  id: 'pe-2',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-2',
  position: 1,
  weightUnit: null,
  exercise: {
    id: 'ex-2',
    userId: 'user-1',
    name: 'Incline Press',
    muscleGroup: 'chest',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
}

// Deliberately wrong — see file header. Only the fallback
// (useProgramExercises) ever returns this.
const decoyExercise: ProgramExercise = {
  id: 'pe-decoy',
  workoutDayId: 'wd-1',
  userId: 'user-1',
  exerciseId: 'ex-decoy',
  position: 0,
  weightUnit: null,
  exercise: {
    id: 'ex-decoy',
    userId: 'user-1',
    name: 'DECOY EXERCISE',
    muscleGroup: 'other',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  },
}

const weekPlan: WeekPlan = {
  id: 'wp-1',
  userId: 'user-1',
  mesocycleId: 'meso-1',
  workoutDayId: 'wd-1',
  weekNumber: 1,
  isDeload: false,
  notes: null,
  sets: [
    {
      id: 'set-1',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 1,
      targetRir: 2,
      isDropset: false,
      parentWeekPlanSetId: null,
      stageIndex: 0,
      isWarmup: false,
    },
    {
      id: 'set-1-drop',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 1,
      targetRir: 0,
      isDropset: true,
      parentWeekPlanSetId: 'set-1',
      stageIndex: 1,
      isWarmup: false,
    },
  ],
  // The week's own exercise list (chunk 7) — the real data.
  exercises: [pe1, pe2],
  createdAt: '2026-01-01T00:00:00Z',
}

const session: Session = {
  id: 'session-1',
  userId: 'user-1',
  mesocycleId: 'meso-1',
  weekPlanId: 'wp-1',
  weekPlan: undefined,
  workoutDayId: 'wd-1',
  workoutDay: undefined,
  date: '2026-01-05',
  status: 'in_progress',
  note: null,
  startedAt: '2026-01-05T10:00:00Z',
  completedAt: null,
  createdAt: '2026-01-05T10:00:00Z',
  setLogs: [],
  energyRating: null,
  pumpRating: null,
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
vi.mock('./ExerciseCard', () => ({
  default: (props: { programExercise: ProgramExercise; plannedSets: { id: string }[] }) => (
    <div data-testid="exercise-card">
      {props.programExercise.id}|{props.programExercise.exercise?.name}|{props.programExercise.position}|
      {props.plannedSets.map((s) => s.id).join(',')}
    </div>
  ),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// The fallback source only — deliberately wrong, see decoyExercise above.
vi.mock('../programs/usePrograms', () => ({ useProgramExercises: () => ({ data: [decoyExercise] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn() }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({
    data: new Map(),
    isLoading: false,
    isError: false,
    isFromCache: false,
    retry: vi.fn(),
  }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url))
const EXPECTED_HTML = readFileSync(join(FIXTURE_DIR, '__fixtures__', 'gymsession-chunk6-render.html'), 'utf8')

describe('GymSession — renders from the week\'s own exercise list, byte-identical to build/chunk-6', () => {
  it('matches the frozen build/chunk-6 render exactly, for the same underlying data', () => {
    const { container } = render(
      <GymSession
        sessionId="session-1"
        workoutDay={workoutDay}
        weekPlan={weekPlan}
        weekNumber={1}
        today="2026-01-05"
      />,
    )
    expect(container.innerHTML).toBe(EXPECTED_HTML)
  })

  it('sanity: the frozen fixture itself names both exercises in order (guards against an empty/truncated fixture passing vacuously)', () => {
    expect(EXPECTED_HTML).toContain('pe-1|Bench Press|0|set-1,set-1-drop')
    expect(EXPECTED_HTML).toContain('pe-2|Incline Press|1|')
    expect(EXPECTED_HTML).not.toContain('DECOY')
  })
})
