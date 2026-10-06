// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session } from '../../types'

// Adam's standing rule (D30): any chunk changing how the workout screen
// reads exercises must prove a plain-session jsdom render is byte-identical
// between master and this branch — "plain sets, an existing dropset".
//
// GymSession.renderParity.test.tsx (chunk 7) already proves the exercise
// LIST comes from weekPlan.exercises, but it stubs ./ExerciseCard down to a
// one-line id|name|position|setIds string, so its fixture's own dropset
// (set-1/set-1-drop) is never actually rendered by anything — the stub
// doesn't know what a dropset is. This file renders the REAL ExerciseCard
// (and everything under it — SetGroup, SetRow, ExerciseHeader,
// ExerciseReference, PlanTargetsPanel) for a fixture with two plain sets
// plus one existing dropset (a head and one stage), no supersets, no
// warmups, no tags, no tempo, no rest overrides — ProgramExercise/
// WeekPlanSet (types/index.ts) carry no superset/tag/tempo/rest-override
// fields at all on the gym-session side, so a plain object fixture with
// isWarmup: false throughout already satisfies "none of those".
//
// __fixtures__/gymsession-d30-render.html is the frozen "before": captured
// by rendering master 071151b's own GymSession.tsx (confirmed byte-identical
// to this branch's — git diff origin/master...HEAD touches no file in
// GymSession's render path, only usePrograms.ts's unrelated
// useReorderProgramExercises, 3 lines) with this exact fixture, in a
// separate git worktree, via a throwaway capture script (never committed
// there — same convention as the chunk-6/7 fixture's own header).
//
// Only ExerciseCard is left real; everything this screen fetches via a
// hook (session, history, references, auth, online status, programs
// fallback) is still mocked to the same deterministic values the chunk-7
// renderParity test already uses — this test is about ExerciseCard's own
// rendering, not about data-fetching.

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
  targetReps: 8,
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

const weekPlan: WeekPlan = {
  id: 'wp-1',
  userId: 'user-1',
  mesocycleId: 'meso-1',
  workoutDayId: 'wd-1',
  weekNumber: 1,
  isDeload: false,
  notes: null,
  sets: [
    // Two plain sets (no dropset, no warmup).
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
      id: 'set-2',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 2,
      targetRir: 2,
      isDropset: false,
      parentWeekPlanSetId: null,
      stageIndex: 0,
      isWarmup: false,
    },
    // One existing dropset: a head plus one stage.
    {
      id: 'set-3',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 3,
      targetRir: 2,
      isDropset: false,
      parentWeekPlanSetId: null,
      stageIndex: 0,
      isWarmup: false,
    },
    {
      id: 'set-3-drop',
      weekPlanId: 'wp-1',
      userId: 'user-1',
      programExerciseId: 'pe-1',
      setNumber: 3,
      targetRir: 0,
      isDropset: true,
      parentWeekPlanSetId: 'set-3',
      stageIndex: 1,
      isWarmup: false,
    },
  ],
  exercises: [pe1],
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
// The floating global rest timer only — D30's own rest-timer-duration proof
// is RestTimer.d30.test.tsx's job, not this render-parity test's. Nothing
// here starts a rest period (no set is logged), so RestTimerInline (SetGroup
// — anchored, not floating) never renders regardless: real, unmocked
// restTimerStore.ts starts with startedAt: null, anchorId: null.
vi.mock('./RestTimer', () => ({ default: () => null }))
vi.mock('./SessionComplete', () => ({ default: () => null }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./SwapExerciseSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
// The fallback source only — unused here (weekPlan is present), same as the
// chunk-7 renderParity test's own decoy precedent, minus the decoy itself
// (this file isn't proving which source wins, chunk 7's own test already
// does — just that the real card renders a dropset correctly).
vi.mock('../programs/usePrograms', () => ({ useProgramExercises: () => ({ data: [] }) }))
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
const EXPECTED_HTML = readFileSync(join(FIXTURE_DIR, '__fixtures__', 'gymsession-d30-render.html'), 'utf8')

describe('GymSession — D30: a plain session with an existing dropset renders byte-identical to master 071151b', () => {
  it('matches the frozen master render exactly, real ExerciseCard/SetGroup/SetRow and all', () => {
    const { container } = render(
      <MemoryRouter>
        <GymSession
          sessionId="session-1"
          workoutDay={workoutDay}
          weekPlan={weekPlan}
          weekNumber={1}
          today="2026-01-05"
        />
      </MemoryRouter>,
    )
    expect(container.innerHTML).toBe(EXPECTED_HTML)
  })

  it('sanity: the frozen fixture itself actually rendered the dropset\'s stage row, not just the two plain sets (guards against an empty/truncated fixture passing vacuously)', () => {
    expect(EXPECTED_HTML).toContain('Bench Press')
    // Three plain heads (01/02/03) plus set-3's own stage row, rendered
    // with SetRow's "↳" indent marker and its distinct (unlogged-head-gated)
    // LOCKED state and its own TARGET RIR 0 — all absent from a plain set.
    expect(EXPECTED_HTML).toContain('↳')
    expect(EXPECTED_HTML).toContain('LOCKED')
    expect(EXPECTED_HTML).toContain('TARGET RIR 0')
  })
})
