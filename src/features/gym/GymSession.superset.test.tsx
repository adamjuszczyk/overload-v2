// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, fireEvent, within, act, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog, Exercise } from '../../types'

// Chunk 13 (TASKS.md "Supersets" — reviewer's note 3): "the existing
// 'current set' button follows the first [data-unlogged-set] in DOM order.
// Render rounds in zigzag order so it visits A1 → B1 → A2 …, and prove it
// with a jsdom test that logs A1, then checks the next target is B1." This
// renders the REAL GymSession → SupersetBlock → SetGroup/SetRow tree (same
// precedent as GymSession.d30.test.tsx, minus the dropset fixture, plus a
// 2-exercise superset block), and is a SEPARATE file from D30's own —
// nothing here touches gymsession-d30-render.html or its test.

afterEach(() => cleanup())

const workoutDay: WorkoutDay = {
  id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [],
}

function makeExercise(id: string, exerciseId: string, name: string, position: number): ProgramExercise {
  return {
    id, workoutDayId: 'wd-1', userId: 'user-1', exerciseId, position, weightUnit: null,
    supersetBlockId: 'block-1',
    exercise: {
      id: exerciseId, userId: 'user-1', name, muscleGroup: 'chest', isArchived: false,
      createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
      status: 'active', sourceLibraryId: null, lostAt: null,
    },
  }
}

const peA = makeExercise('pe-a', 'ex-a', 'Bench Press', 0)
const peB = makeExercise('pe-b', 'ex-b', 'Barbell Row', 1)

function planSet(id: string, programExerciseId: string, setNumber: number): WeekPlan['sets'][number] {
  return {
    id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId, setNumber,
    targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
  }
}

const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
  isDeload: false, notes: null,
  sets: [
    planSet('set-a1', 'pe-a', 1),
    planSet('set-a2', 'pe-a', 2),
    planSet('set-b1', 'pe-b', 1),
    planSet('set-b2', 'pe-b', 2),
  ],
  exercises: [peA, peB],
  createdAt: '2026-01-01T00:00:00Z',
}

// Mutable, module-level — the mocked useActiveSession/useLogSet pair below
// both read/write this so a "logged set" the mocked mutation produces is
// visible to GymSession on the NEXT render (RTL's `rerender`, called after
// awaiting the mutation), the same way a real session would see it after
// TanStack Query's cache updates and this component re-renders.
let session: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
  workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
  startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:00:00Z',
  setLogs: [], energyRating: null, pumpRating: null,
}

// Review fix — "starting a swap on a member makes it leave the block for
// this session (your existing fallback)". Mutable, same pattern as
// `session` above: useRecordExerciseSwap's mock pushes a real row here;
// useSessionSwaps reads it fresh, so GymSession's own existing
// swapByProgramExerciseId/grouping logic (unchanged) sees it on the next
// render, exactly as it would from a real optimistic-cache update.
let sessionSwaps: {
  id: string; sessionId: string; programExerciseId: string | null
  originalExerciseId: string | null; originalExerciseName: string
  replacementExerciseId: string | null; replacementExerciseName: string
  createdAt: string
}[] = []

const REPLACEMENT: Exercise = {
  id: 'ex-replacement', userId: 'user-1', name: 'Incline Press', muscleGroup: 'chest', isArchived: false,
  createdAt: '', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null,
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
// A functional stub (not `() => null` — D30's own precedent — since this
// file's own swap test needs to actually confirm one), same shape as
// SupersetBlock.test.tsx's own.
vi.mock('./SwapExerciseSheet', () => ({
  default: ({ onConfirm, onClose }: { onConfirm: (ex: Exercise) => void; onClose: () => void }) => (
    <div>
      <button onClick={() => onConfirm(REPLACEMENT)}>CONFIRM PICK</button>
      <button onClick={onClose}>close sheet</button>
    </div>
  ),
}))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({ useProgramExercises: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({
    mutateAsync: vi.fn((params: Record<string, unknown>) => {
      const log: SetLog = {
        id: `log-${(session.setLogs?.length ?? 0) + 1}`,
        userId: 'user-1',
        sessionId: 'session-1',
        exerciseId: params.exerciseId as string,
        weekPlanSetId: params.weekPlanSetId as string | null,
        setNumber: params.setNumber as number,
        weight: params.weight as number | null,
        reps: params.reps as number | null,
        rir: params.rir as number | null,
        note: null,
        isDropset: false,
        parentSetId: null,
        stageIndex: 0,
        isWarmup: false,
        setSeconds: null,
        enteredUnit: null,
        isSkipped: false,
        loggedAt: '2026-01-05T10:05:00Z',
        restSeconds: null,
        formRating: null,
      }
      session = { ...session, setLogs: [...(session.setLogs ?? []), log] }
      return Promise.resolve(log)
    }),
  }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({
    data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn(),
  }),
  useSessionSwaps: () => ({ data: sessionSwaps }),
  useRecordExerciseSwap: () => ({
    mutate: vi.fn((params: { programExerciseId: string; originalExercise: Exercise; replacementExercise: Exercise }) => {
      sessionSwaps = [...sessionSwaps, {
        id: `swap-${sessionSwaps.length + 1}`,
        sessionId: 'session-1',
        programExerciseId: params.programExerciseId,
        originalExerciseId: params.originalExercise.id,
        originalExerciseName: params.originalExercise.name,
        replacementExerciseId: params.replacementExercise.id,
        replacementExerciseName: params.replacementExercise.name,
        createdAt: '2026-01-05T10:10:00Z',
      }]
    }),
  }),
}))

const { default: GymSession } = await import('./GymSession')

function renderSession() {
  return render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>,
  )
}

describe('GymSession — superset current-set zigzag (TASKS.md chunk 13 note 3)', () => {
  it('the first current set is A1; after logging it, the next current set is B1', async () => {
    session = { ...session, setLogs: [] }
    const { container, rerender } = renderSession()

    const unloggedBefore = container.querySelector('[data-unlogged-set]') as HTMLElement
    const labelBefore = unloggedBefore.parentElement!.parentElement!.querySelector('p')!.textContent!
    expect(labelBefore).toContain('BENCH PRESS') // A1 is first

    const weightInput = within(unloggedBefore).getAllByRole('textbox')[0]
    const repsInput = within(unloggedBefore).getByRole('spinbutton')
    fireEvent.change(weightInput, { target: { value: '60' } })
    fireEvent.change(repsInput, { target: { value: '10' } })
    await act(async () => {
      fireEvent.click(within(unloggedBefore).getByText('LOG'))
      await Promise.resolve()
      await Promise.resolve()
    })

    rerender(
      <MemoryRouter>
        <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
      </MemoryRouter>,
    )

    const unloggedAfter = container.querySelector('[data-unlogged-set]') as HTMLElement
    expect(unloggedAfter).not.toBe(unloggedBefore)
    const labelAfter = unloggedAfter.parentElement!.parentElement!.querySelector('p')!.textContent!
    expect(labelAfter).toContain('BARBELL ROW') // B1 is next, not A2
  })
})

describe('GymSession — review fix: starting a swap on a block member makes it leave the block for this session', () => {
  it('confirming a swap on A renders it as its own merged card, leaving only B inside the SUPERSET block', async () => {
    session = { ...session, setLogs: [] }
    sessionSwaps = []
    const { container, rerender } = renderSession()

    // Both members' own SWAP triggers live inside the block
    // (useExerciseCardState — the review fix) — A is first.
    const swapButtons = screen.getAllByLabelText('Swap exercise for this session')
    expect(swapButtons).toHaveLength(2)
    fireEvent.click(swapButtons[0])

    await act(async () => {
      fireEvent.click(screen.getByText('CONFIRM PICK'))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sessionSwaps).toHaveLength(1)
    expect(sessionSwaps[0]).toMatchObject({ programExerciseId: 'pe-a', originalExerciseName: 'Bench Press' })

    rerender(
      <MemoryRouter>
        <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
      </MemoryRouter>,
    )

    // A's slot is now its own merged single card (GymSession's existing,
    // unchanged swapped-card rendering — ExerciseHeader's own marker), not
    // inside the SUPERSET block any more; B is still there alone — fewer
    // than 2 members, so it too falls back to a plain single card (not a
    // "SUPERSET" of one).
    expect(container.textContent).toContain('SWAPPED FROM BENCH PRESS')
    expect(container.textContent).not.toContain('SUPERSET')
    expect(container.textContent).toContain('Incline Press')
    expect(container.textContent).toContain('Barbell Row')
  })
})
