// @vitest-environment jsdom
//
// Chunk 15 (SPEC "Warmup sets" — "Never counted in volume, set counts, or
// 'last time' matching"): renders the REAL GymSession → ExerciseCard →
// SetRow tree (same precedent as GymSession.superset.test.tsx) for one
// exercise with a planned warmup plus two planned working sets, and proves
// the numbering/logging boundary end to end — this is the one layer D30's
// own fixture (zero warmups) can't exercise. A SEPARATE file from D30's
// own: nothing here touches gymsession-d30-render.html or its test.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => {
  cleanup()
  logSetMutateAsync.mockClear()
})

const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}

const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
  exercise: {
    id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
    createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
    status: 'active', sourceLibraryId: null, lostAt: null,
  },
}

const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
  isDeload: false, notes: null,
  sets: [
    { id: 'wps-warmup', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: null, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: true },
    { id: 'wps-work-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false },
    { id: 'wps-work-2', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 2, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false },
  ],
  exercises: [pe1],
  createdAt: '2026-01-01T00:00:00Z',
}

// Mutable, module-level — same pattern as GymSession.superset.test.tsx's
// own `session`: the mocked useLogSet mutation writes a real row here so
// the NEXT render (RTL's `rerender`) sees it, the way a real cache update
// would.
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
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
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
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }),
  // Chunk 16 (SPEC "Rest") — not this test's own concern (warmup numbering);
  // empty so nothing about the rest chain affects it.
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

function renderSession() {
  return render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>,
  )
}

describe('GymSession — warmup sets are never counted in working-set numbering (chunk 15)', () => {
  it('renders a WARMUP section plus two working rows numbered 01/02 (not 02/03)', () => {
    session = { ...session, setLogs: [] }
    const { container } = renderSession()

    expect(within(container as HTMLElement).getByText('WARMUP')).toBeTruthy()
    const badges = Array.from(container.querySelectorAll('[data-unlogged-set]')).map(
      (el) => el.textContent?.match(/^\s*(\d{2})/)?.[1],
    )
    // The warmup row carries no [data-unlogged-set] marker at all (SetRow's
    // isWarmup branch never sets it) — only the two working rows do.
    expect(badges).toEqual(['01', '02'])
  })

  it('logging the warmup writes is_warmup: true and does not shift the working rows', async () => {
    session = { ...session, setLogs: [] }
    const { container, rerender } = renderSession()

    const logButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'LOG')
    // First LOG button in DOM order belongs to the warmup row (rendered
    // before the working-set section).
    await fireEvent.click(logButtons[0])
    await Promise.resolve()

    expect(logSetMutateAsync).toHaveBeenCalledTimes(1)
    const payload = logSetMutateAsync.mock.calls[0][0] as Record<string, unknown>
    expect(payload.isWarmup).toBe(true)

    rerender(
      <MemoryRouter>
        <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
      </MemoryRouter>,
    )

    // Working rows are still 01/02 — the now-logged warmup never occupied
    // a slot in that sequence.
    const badges = Array.from(container.querySelectorAll('[data-unlogged-set]')).map(
      (el) => el.textContent?.match(/^\s*(\d{2})/)?.[1],
    )
    expect(badges).toEqual(['01', '02'])
  })

  it('logging the first working set after the warmup writes set_number: 1, not 2', async () => {
    session = { ...session, setLogs: [] }
    const { container } = renderSession()

    const logButtons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent === 'LOG')
    // logButtons[1] is the first WORKING row's LOG button (index 0 is the
    // warmup's). The working row needs weight/reps filled in first.
    const workingRow = logButtons[1].closest('div')!.parentElement!
    const [weightInput] = within(workingRow).getAllByRole('textbox') as HTMLInputElement[]
    fireEvent.change(weightInput, { target: { value: '100' } })
    const repsField = within(workingRow).getAllByRole('spinbutton')[0]
    fireEvent.change(repsField, { target: { value: '8' } })
    fireEvent.click(logButtons[1])

    expect(logSetMutateAsync).toHaveBeenCalledTimes(1)
    const payload = logSetMutateAsync.mock.calls[0][0] as Record<string, unknown>
    expect(payload.setNumber).toBe(1)
    expect(payload.isWarmup).toBeUndefined()
  })
})
