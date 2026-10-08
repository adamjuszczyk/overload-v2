// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog, Exercise } from '../../types'
import type { ReferenceSession } from './sessionService'

// Screen-layer test (Lessons: "a screen-layer test asserting what
// ExerciseReference receives and shows"; reviewer's note 4: "Swapped-in,
// extra and superset members all resolve by their own exercise_id") —
// renders the REAL GymSession -> SupersetBlock/ExerciseCard -> ExerciseReference
// tree (same precedent as GymSession.superset.test.tsx, trimmed to a
// static render — no interaction needed here) with a mocked
// useExerciseReferenceSessions Map holding FOUR distinctly-keyed,
// discriminating entries (a plain superset member, its block partner, a
// confirmed swap's replacement, and an extra/unplanned exercise), each
// with its own unique weight×reps so a wrong Map.get(...) key anywhere in
// this wiring would show the wrong numbers under the wrong card.

afterEach(() => cleanup())
beforeEach(() => useExerciseReferenceSessionsMock.mockClear())

// Scopes an assertion to exactly ONE exercise's own card/member — not the
// whole screen (where every card's content coexists) and, inside a
// superset block, not the block's OTHER member either (members share one
// outer `.rounded-xl` block container with no per-member class at all —
// SupersetBlock.tsx's own `<div key={member.programExercise.id}>`).
// Climbing exactly 4 ancestors from the exercise's own name span lands on:
// a plain/swapped/extra card's own `.rounded-xl` root (ExerciseCard.tsx has
// one fewer wrapping div than a block member), OR, inside a block, that
// member's own unclassed wrapper div (one level inside the shared block
// root) — either way, precisely this exercise's own subtree, confirmed by
// probing the real rendered DOM before relying on it (see this chunk's
// report).
function cardScopeFor(exerciseName: string): HTMLElement {
  let el: HTMLElement = screen.getByText(exerciseName)
  for (let i = 0; i < 4; i++) el = el.parentElement!
  return el
}

const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}

function makeExercise(id: string, exerciseId: string, name: string, position: number, supersetBlockId: string | null): ProgramExercise {
  return {
    id, workoutDayId: 'wd-1', userId: 'user-1', exerciseId, position, weightUnit: null,
    supersetBlockId,
    exercise: {
      id: exerciseId, userId: 'user-1', name, muscleGroup: 'chest', isArchived: false,
      createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
      status: 'active', sourceLibraryId: null, lostAt: null,
    },
  }
}

// peA/peB: a 2-member superset block. peC: a plain slot that gets swapped.
const peA = makeExercise('pe-a', 'ex-a', 'Bench Press', 0, 'block-1')
const peB = makeExercise('pe-b', 'ex-b', 'Barbell Row', 1, 'block-1')
const peC = makeExercise('pe-c', 'ex-c', 'Overhead Press', 2, null)

const EXTRA: Exercise = {
  id: 'ex-extra', userId: 'user-1', name: 'Cable Fly', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
}

function planSet(id: string, programExerciseId: string, setNumber: number): WeekPlan['sets'][number] {
  return {
    id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId, setNumber,
    targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
  }
}

const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
  isDeload: false, notes: null,
  sets: [planSet('set-a1', 'pe-a', 1), planSet('set-b1', 'pe-b', 1), planSet('set-c1', 'pe-c', 1)],
  exercises: [peA, peB, peC],
  createdAt: '2026-01-01T00:00:00Z',
}

// A log for ex-extra, with its own populated `.exercise` — the one thing
// GymSession.tsx's extraExerciseById construction requires to surface an
// unplanned exercise as its own card (no "+ ADD EXERCISE" interaction
// needed for a static render test).
const extraLog: SetLog = {
  id: 'log-extra', userId: 'user-1', sessionId: 'session-1', exerciseId: 'ex-extra', exercise: EXTRA,
  weekPlanSetId: null, setNumber: 1, weight: 40, reps: 20, rir: 1, note: null, isDropset: false,
  parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null,
  isSkipped: false, loggedAt: '2026-01-05T10:00:00Z', restSeconds: null, formRating: null,
}

const session: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
  workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
  startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:00:00Z',
  setLogs: [extraLog], energyRating: null, pumpRating: null,
}

const sessionSwaps = [
  {
    id: 'swap-1', sessionId: 'session-1', programExerciseId: 'pe-c',
    originalExerciseId: 'ex-c', originalExerciseName: 'Overhead Press',
    replacementExerciseId: 'ex-replacement', replacementExerciseName: 'Incline Press',
    createdAt: '2026-01-05T10:05:00Z',
  },
]

// Four distinctly-keyed ReferenceSession lists — a wrong Map.get(...) key
// anywhere in the wiring would show the WRONG one of these four under the
// wrong card, which the assertions below check for directly.
function refSession(sessionId: string, date: string, weight: number, reps: number): ReferenceSession {
  return {
    sessionId, date, completedAt: null, mesocycleId: 'meso-1',
    logs: [{
      head: {
        id: `${sessionId}-log`, userId: 'user-1', sessionId, exerciseId: 'irrelevant-here',
        weekPlanSetId: null, setNumber: 1, weight, reps, rir: 2, note: null, isDropset: false,
        parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null,
        isSkipped: false, loggedAt: `${date}T10:00:00Z`, restSeconds: null, formRating: null,
      },
      stages: [],
    }],
  }
}

const referenceMap = new Map<string, ReferenceSession[]>([
  ['ex-a', [refSession('ref-a', '2025-12-30', 101, 1)]], // LAST WEEK (today is 2026-01-05, Monday)
  ['ex-b', [refSession('ref-b', '2025-12-01', 102, 2)]], // LAST TIME
  ['ex-replacement', []], // FIRST TIME
  ['ex-extra', [refSession('ref-extra', '2025-12-01', 104, 4)]], // LAST TIME
])

const useExerciseReferenceSessionsMock = vi.fn((_workoutDayId: string, _exerciseIds: string[], _currentSessionId: string | null) => ({
  data: referenceMap,
  isLoading: false,
  isError: false,
  isFromCache: false,
  retry: vi.fn(),
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
// Empty, same as GymSession.superset.test.tsx's own precedent — the swap's
// replacement then resolves through resolveReplacementExercise's stub
// fallback (built from the swap row's own denormalised name/id), not a
// real Exercise lookup; irrelevant to what this test actually checks
// (which Map entry ends up under which card).
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
  useExerciseReferenceSessions: (workoutDayId: string, exerciseIds: string[], currentSessionId: string | null) =>
    useExerciseReferenceSessionsMock(workoutDayId, exerciseIds, currentSessionId),
  useSessionSwaps: () => ({ data: sessionSwaps }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')

function renderSession() {
  return render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>,
  )
}

describe('GymSession — reference sessions resolve by each card\'s own exercise_id (swap/extra/superset alike)', () => {
  it('a superset member (A) shows its own Map entry, scoped to its own member subtree — not its block partner\'s (B)', () => {
    renderSession()
    const scope = within(cardScopeFor('Bench Press'))
    expect(scope.getByText('LAST WEEK')).toBeTruthy()
    expect(scope.getByText('101×1')).toBeTruthy() // ex-a's own number
    expect(scope.queryByText('102×2')).toBeNull() // not B's, inside A's own scope
  })

  it('the OTHER superset member (B) shows its own Map entry, scoped to its own member subtree — not A\'s', () => {
    renderSession()
    const scope = within(cardScopeFor('Barbell Row'))
    expect(scope.getByText('LAST TIME')).toBeTruthy()
    expect(scope.getByText('102×2')).toBeTruthy()
    expect(scope.queryByText('101×1')).toBeNull() // not A's, inside B's own scope
  })

  it('a swapped-in replacement exercise shows ITS OWN Map entry (keyed by the replacement\'s exercise_id, not the original\'s), and none of the other three', () => {
    renderSession()
    // ex-replacement's own Map entry is [] -> FIRST TIME, not ex-c's
    // (never queried at all — ex-c isn't in referenceMap) and not any of
    // the other three exercises' numbers.
    const scope = within(cardScopeFor('Incline Press'))
    expect(scope.getByText('FIRST TIME')).toBeTruthy()
    expect(scope.queryByText('101×1')).toBeNull()
    expect(scope.queryByText('102×2')).toBeNull()
    expect(scope.queryByText('104×4')).toBeNull()
  })

  it('an extra/unplanned exercise (surfaced via its own log) shows its own Map entry, and none of the other three', () => {
    renderSession()
    const scope = within(cardScopeFor('Cable Fly'))
    expect(scope.getByText('LAST TIME')).toBeTruthy()
    expect(scope.getByText('104×4')).toBeTruthy()
    expect(scope.queryByText('101×1')).toBeNull()
    expect(scope.queryByText('102×2')).toBeNull()
    expect(scope.queryByText('FIRST TIME')).toBeNull()
  })

  it('all four numbers render simultaneously on the page, one per card, with no collisions', () => {
    renderSession()
    expect(screen.getByText('101×1')).toBeTruthy()
    expect(screen.getByText('102×2')).toBeTruthy()
    expect(screen.getByText('104×4')).toBeTruthy()
    expect(screen.getByText('FIRST TIME')).toBeTruthy()
  })

  it('the batched query is called once (not per card) with exactly this screen\'s exercise ids', () => {
    renderSession()
    expect(useExerciseReferenceSessionsMock).toHaveBeenCalledTimes(1)
    const [, exerciseIds] = useExerciseReferenceSessionsMock.mock.calls[0]
    // The template's own ids (ex-a, ex-b, AND ex-c — GymSession.tsx's
    // existing, unchanged-by-this-chunk convention keeps a swapped slot's
    // ORIGINAL exerciseId in `activeExercises` regardless of the swap, so
    // its own reference history is still resolvable too, not just the
    // replacement's: "Swap replacements ... are included too, so a real
    // prior occurrence of one still resolves a real reference instead of
    // silently falling back to first_time just because the id was never
    // asked about" — GymSession.tsx's own comment on this exact line),
    // PLUS the swap's replacement (ex-replacement) and the extra exercise
    // (ex-extra).
    expect(new Set(exerciseIds)).toEqual(new Set(['ex-a', 'ex-b', 'ex-c', 'ex-replacement', 'ex-extra']))
  })
})
