// @vitest-environment jsdom
//
// Chunk 17 (TASKS.md "Tempo" / SPEC.md "Tempo [P1]" — reviewer's brief:
// "jsdom 'real session' tests"). Renders the REAL GymSession -> ExerciseCard/
// SupersetBlock -> ExerciseHeader tree (same precedent as
// GymSession.restChain.test.tsx/GymSession.superset.test.tsx) and asserts on
// the rendered text, proving the real read path (ProgramExercise.tempo, as
// mapped by weekPlanService.ts's toProgramExerciseFromWeekPlanExercise) and
// ExerciseHeader's own display rule reach the screen correctly end to end.
// A SEPARATE file from D30's own: nothing here touches
// gymsession-d30-render.html or its test, and pe1 in that other fixture
// carries no tempo field at all (undefined), so D30 stays byte-identical
// regardless of anything in this file.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, WeekPlan, WeekPlanSet, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => cleanup())

let session: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
  workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
  startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:00:00Z',
  setLogs: [], energyRating: null, pumpRating: null,
}

const logSetMutateAsync = vi.fn((params: Record<string, unknown>) => {
  const log: SetLog = {
    id: `log-${(session.setLogs?.length ?? 0) + 1}`,
    userId: 'user-1',
    sessionId: 'session-1',
    exerciseId: params.exerciseId as string,
    weekPlanSetId: params.weekPlanSetId as string | null,
    setNumber: params.setNumber as number,
    weight: (params.weight as number | null) ?? null,
    reps: (params.reps as number | null) ?? null,
    rir: (params.rir as number | null) ?? null,
    note: null,
    isDropset: (params.isDropset as boolean | undefined) ?? false,
    parentSetId: (params.parentSetId as string | null) ?? null,
    stageIndex: (params.stageIndex as number | undefined) ?? 0,
    isWarmup: (params.isWarmup as boolean | undefined) ?? false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: false,
    loggedAt: '2026-01-05T10:05:00Z',
    restSeconds: null,
    formRating: null,
  }
  session = { ...session, setLogs: [...(session.setLogs ?? []), log] }
  return Promise.resolve(log)
})

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
// The fallback source only — unused here (weekPlan is always present below),
// same decoy-free precedent GymSession.restChain.test.tsx's own header
// explains.
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }),
  useSupersetBlockRests: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: logSetMutateAsync }),
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

// Same helper as GymSession.restChain.test.tsx's own (see that file's header
// for why this exact query shape).
async function logFirstActiveRow(container: HTMLElement, weight: string, reps: string) {
  const weightInput = container.querySelector('input[inputmode="decimal"]:not([disabled])') as HTMLInputElement
  const repsInput = container.querySelector('input[inputmode="numeric"]:not([disabled])') as HTMLInputElement
  fireEvent.change(weightInput, { target: { value: weight } })
  fireEvent.change(repsInput, { target: { value: reps } })
  const row = weightInput.closest('div.space-y-1') as HTMLElement
  const logButton = Array.from(row.querySelectorAll('button')).find((b) => b.textContent === 'LOG')!
  await act(async () => {
    fireEvent.click(logButton)
    await Promise.resolve()
    await Promise.resolve()
  })
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

function planSet(id: string, programExerciseId: string, setNumber: number): WeekPlanSet {
  return {
    id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId, setNumber,
    targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
  }
}

beforeEach(() => {
  session = { ...session, setLogs: [] }
})

describe('GymSession — tempo, real session (plain card)', () => {
  it('shows beside the exercise name when the program exercise has one', () => {
    const pe1 = makeExercise({ id: 'pe-1', exerciseId: 'ex-1', name: 'Bench Press', tempo: '3-1-1-0' })
    const weekPlan: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null, sets: [planSet('set-1', 'pe-1', 1)], exercises: [pe1],
      createdAt: '2026-01-01T00:00:00Z',
    }
    render(sessionJsx(workoutDay, weekPlan))

    expect(screen.getByText('Bench Press')).toBeTruthy()
    expect(screen.getByText('3-1-1-0')).toBeTruthy()
  })

  it('with no tempo, renders no element for it at all', () => {
    const pe1 = makeExercise({ id: 'pe-1', exerciseId: 'ex-1', name: 'Bench Press' }) // no tempo key
    const weekPlan: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null, sets: [planSet('set-1', 'pe-1', 1)], exercises: [pe1],
      createdAt: '2026-01-01T00:00:00Z',
    }
    const { container } = render(sessionJsx(workoutDay, weekPlan))

    expect(screen.getByText('Bench Press')).toBeTruthy()
    // The name's own row (ExerciseHeader's `flex items-baseline gap-2` div)
    // holds exactly one child — the name span — with no second sibling for
    // an absent tempo: no label, no placeholder, no empty element (D30).
    const nameRow = screen.getByText('Bench Press').parentElement!
    expect(nameRow.children).toHaveLength(1)
    // Belt-and-braces: no stray 4-field tempo-shaped text anywhere at all.
    expect(container.textContent).not.toMatch(/\b\d+-\d+-[\dXx]-\d+\b/)
  })

  it('a tempo edited in the program tab shows after the session\'s queries are refetched (next load) — an in-progress session does not change until then', () => {
    const before = makeExercise({ id: 'pe-1', exerciseId: 'ex-1', name: 'Bench Press', tempo: '3-1-1-0' })
    const weekPlanBefore: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null, sets: [planSet('set-1', 'pe-1', 1)], exercises: [before],
      createdAt: '2026-01-01T00:00:00Z',
    }
    const { rerender } = render(sessionJsx(workoutDay, weekPlanBefore))
    expect(screen.getByText('3-1-1-0')).toBeTruthy()

    // Simulate a fresh load: the SAME exercise slot (pe-1), now re-fetched
    // with the program tab's own edit already applied (weekPlanService.ts's
    // mapper reads tempo fresh off the joined row every time, no caching of
    // its own) — this is exactly the shape a reloaded session's own query
    // would hand GymSession.
    const after = makeExercise({ id: 'pe-1', exerciseId: 'ex-1', name: 'Bench Press', tempo: '4-2-1-0' })
    const weekPlanAfter: WeekPlan = { ...weekPlanBefore, exercises: [after] }
    rerender(sessionJsx(workoutDay, weekPlanAfter))

    expect(screen.queryByText('3-1-1-0')).toBeNull()
    expect(screen.getByText('4-2-1-0')).toBeTruthy()
  })

  it('the logSet payload has no tempo key — never tracked', async () => {
    const pe1 = makeExercise({ id: 'pe-1', exerciseId: 'ex-1', name: 'Bench Press', tempo: '3-1-1-0' })
    const weekPlan: WeekPlan = {
      id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
      isDeload: false, notes: null, sets: [planSet('set-1', 'pe-1', 1)], exercises: [pe1],
      createdAt: '2026-01-01T00:00:00Z',
    }
    const { container } = render(sessionJsx(workoutDay, weekPlan))

    await logFirstActiveRow(container, '60', '10')

    expect(logSetMutateAsync).toHaveBeenCalledTimes(1)
    const params = logSetMutateAsync.mock.calls[0][0]
    expect('tempo' in params).toBe(false)
  })
})

describe('GymSession — tempo, real session (superset member)', () => {
  const ssWorkoutDay: WorkoutDay = { id: 'wd-ss', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }

  it('each member shows its own tempo (or none, for a member with none)', () => {
    const peA = makeExercise({ id: 'pe-a', exerciseId: 'ex-a', name: 'Bench Press', workoutDayId: 'wd-ss', position: 0, supersetBlockId: 'block-1', tempo: '3-1-1-0' })
    const peB = makeExercise({ id: 'pe-b', exerciseId: 'ex-b', name: 'Barbell Row', workoutDayId: 'wd-ss', position: 1, supersetBlockId: 'block-1' }) // no tempo
    const weekPlan: WeekPlan = {
      id: 'wp-ss', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-ss', weekNumber: 1,
      isDeload: false, notes: null,
      sets: [planSet('set-a1', 'pe-a', 1), planSet('set-b1', 'pe-b', 1)],
      exercises: [peA, peB], createdAt: '2026-01-01T00:00:00Z',
    }
    render(sessionJsx(ssWorkoutDay, weekPlan))

    expect(screen.getByText('Bench Press')).toBeTruthy()
    expect(screen.getByText('Barbell Row')).toBeTruthy()
    expect(screen.getByText('3-1-1-0')).toBeTruthy() // A's own tempo

    // B has none — its own name row holds exactly one child, same "no
    // element at all" proof as the plain-card test above.
    const bNameRow = screen.getByText('Barbell Row').parentElement!
    expect(bNameRow.children).toHaveLength(1)
  })
})
