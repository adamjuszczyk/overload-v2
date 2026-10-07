// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, waitFor, screen } from '@testing-library/react'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session } from '../../types'

// Chunk 7 (TASKS.md "Each planned session owns its exercise list") —
// offlineCache.ts now primes the week's own exercise list onto the cached
// week plan (db.week_plans row's new `exercises` field), and GymSession's
// offline fallback reads it. This proves the real round trip: prime the
// cache (online), then render the same session OFFLINE with both live
// sources empty (the online query returning nothing, same as the existing
// "Supabase returns nothing" fallback this already had for programExercises)
// and get the SAME exercise list back from Dexie.
//
// db.ts/supabase are mocked (an in-memory fake table and a chainable
// empty-result stub respectively) rather than this file's hook modules —
// primeOfflineCache (offlineCache.ts) is the real production function,
// called directly, not through GymSession's own priming effect, so the
// write side under test is exactly what ships.

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ─── Fake Dexie ───────────────────────────────────────────────────────────────
// Minimal in-memory stand-in for the two tables this test touches — real
// IndexedDB isn't available in jsdom. Shared module path ('../../lib/db'),
// so both offlineCache.ts's writes and GymSession.tsx's own reads hit the
// same store.
type Row = Record<string, unknown>
function makeTable() {
  const store = new Map<string, Row>()
  return {
    get: async (id: string) => store.get(id),
    put: async (row: Row) => {
      store.set(row.id as string, row)
      return row.id as string
    },
  }
}
const fakeDb = {
  workout_days: makeTable(),
  week_plans: makeTable(),
  sessions: makeTable(),
  set_logs: makeTable(),
  exercises: makeTable(),
}
vi.mock('../../lib/db', () => ({ db: fakeDb }))

// ─── Fake Supabase ──────────────────────────────────────────────────────────
// primeOfflineCache's own reference-session/exercise-list caching (steps 3-4)
// makes real supabase calls not relevant to this test — a chainable stub
// that resolves every query to an empty, errorless result keeps those steps
// a no-op without needing a real network or a real Postgres.
function makeEmptyChain(): PromiseLike<{ data: unknown[]; error: null }> & Record<string, unknown> {
  const chain: Record<string, unknown> = {}
  const methods = ['select', 'eq', 'neq', 'in', 'order']
  for (const m of methods) chain[m] = () => chain
  chain.then = (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: [], error: null })
  return chain as PromiseLike<{ data: unknown[]; error: null }> & Record<string, unknown>
}
vi.mock('../../lib/supabase', () => ({ supabase: { from: () => makeEmptyChain() } }))

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
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
      {props.programExercise.id}|{props.programExercise.exercise?.name}|{props.programExercise.position}
    </div>
  ),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
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

// isOnline and the fallback program-exercises hook are the two things that
// differ between the "priming" render and the "offline reload" render below
// — mutable so each test controls them independently without re-mocking.
let isOnline = true
let fallbackProgramExercisesData: ProgramExercise[] = []
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => isOnline }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: fallbackProgramExercisesData }),
  // Chunk 16 (SPEC "Rest") — not this test's own concern (offline exercise-
  // list fallback); empty so nothing about the rest chain affects it.
  useSupersetBlockRests: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))

const { default: GymSession } = await import('./GymSession')
const { primeOfflineCache } = await import('../offline/offlineCache')

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

// The weekPlan GymSession is given once offline — same id as what was
// primed, but with an EMPTY exercises field, simulating "the live week-plan
// round trip also failed offline and this is a minimal cached shell", the
// same thing an empty fallbackProgramExercisesData simulates for the
// pre-chunk-7 programExercises path.
const weekPlanOffline: WeekPlan = {
  id: 'wp-1',
  userId: 'user-1',
  mesocycleId: 'meso-1',
  workoutDayId: 'wd-1',
  weekNumber: 1,
  isDeload: false,
  notes: null,
  sets: [],
  exercises: [],
  createdAt: '2026-01-01T00:00:00Z',
}

// Primed into db.workout_days (via primeOfflineCache's `programExercises`
// param) as a stand-in for "the program's own list at priming time" —
// deliberately DIFFERENT from weekPlanWhilePriming.exercises below, so a
// test reading the wrong cache (workout_days instead of week_plans) shows
// this instead of the real list, and fails instead of passing by
// coincidence (found during this chunk's own "break the test" check — see
// the chunk 7 report).
const decoyProgramExercise: ProgramExercise = {
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

// What was actually primed while online — the real weekPlan.exercises list
// (chunk 7's new source), with its own planned sets.
const weekPlanWhilePriming: WeekPlan = {
  ...weekPlanOffline,
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
  ],
  exercises: [pe1, pe2],
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

describe('offline: prime the cache, then reload the session offline — same exercise list', () => {
  it('primeOfflineCache writes weekPlan.exercises (not programExercises) onto the cached week plan row', async () => {
    await primeOfflineCache({
      userId: 'user-1',
      sessionId: 'session-1',
      workoutDay,
      weekPlan: weekPlanWhilePriming,
      programExercises: [decoyProgramExercise],
    })

    const cachedPlan = await fakeDb.week_plans.get('wp-1')
    expect(cachedPlan?.exercises).toEqual([pe1, pe2])
    // The sibling cache (db.workout_days) is keyed off programExercises
    // instead, confirming the two are genuinely different sources, not
    // coincidentally identical.
    const cachedDay = await fakeDb.workout_days.get('wd-1')
    expect(cachedDay?.exercises).toEqual([decoyProgramExercise])
  })

  it('GymSession, rendered offline with both live sources empty, renders the primed WEEK PLAN exercise list from Dexie, not the workout day\'s own cache', async () => {
    // 1. Prime while "online" (the write side — same call as above, a fresh
    //    table so this test is independent of the one before it).
    //    programExercises (-> db.workout_days) is the DECOY here on purpose:
    //    if the offline read ever fell back to the workout-day cache
    //    instead of the week-plan cache, this test would see the decoy and
    //    fail, instead of passing by coincidence.
    await primeOfflineCache({
      userId: 'user-1',
      sessionId: 'session-1',
      workoutDay,
      weekPlan: weekPlanWhilePriming,
      programExercises: [decoyProgramExercise],
    })

    // 2. Go offline. Both live sources return nothing — useProgramExercises
    //    (the fallback) and weekPlan.exercises itself (the cached shell) —
    //    exactly like the pre-chunk-7 "Supabase returns nothing" case this
    //    offline fallback already handled, extended to the new source.
    isOnline = false
    fallbackProgramExercisesData = []

    render(
      <GymSession
        sessionId="session-1"
        workoutDay={workoutDay}
        weekPlan={weekPlanOffline}
        weekNumber={1}
        today="2026-01-05"
      />,
    )

    // 3. The Dexie fallback resolves asynchronously (a .then() off
    //    db.week_plans.get) — wait for the primed list to appear.
    await waitFor(() => {
      expect(screen.getAllByTestId('exercise-card')).toHaveLength(2)
    })
    const cards = screen.getAllByTestId('exercise-card').map((el) => el.textContent)
    expect(cards).toEqual(['pe-1|Bench Press|0', 'pe-2|Incline Press|1'])
  })
})
