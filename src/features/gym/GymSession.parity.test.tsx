// @vitest-environment jsdom
// Chunk 58a — behaviour parity (R4, Adam 2026-10-13; TASKS-1.2 Process notes, replacing D30's byte-identical render): a plain session
// (one exercise, three sets, one legacy null-kind dropset; no supersets, warmups, tags, tempo or overrides) logs the same row, times the
// same rests and finishes the same way as before the chunk. `__fixtures__/plain-session-log-payload.json` is the frozen "before": it was
// captured by driving the PRE-chunk workout screen (staging at 30a7c42) through this very fixture — each LOG with weight and reps typed
// (an untouched row takes the plan's targets since DECISIONS 162 (a), where the old screen took last time's), the `logSet` payload, the
// rest timer's state after it (the resolved target), and FINISH SESSION → COMPLETE's patch. Nothing here reads the markup.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => cleanup())

const FROZEN = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '__fixtures__', 'plain-session-log-payload.json'), 'utf8')) as {
  steps: Array<{ typed: { weight: string; reps: string }; payload: Record<string, unknown>; rest: { running: boolean; targetSeconds: number | null } }>
  finish: Record<string, unknown>
}

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
  exercise: {
    id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
    createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
    status: 'active', sourceLibraryId: null, lostAt: null,
  },
}
const plan = (id: string, setNumber: number, targetRir: number, extra: Record<string, unknown> = {}) => ({
  id, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber, targetRir,
  isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})
const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, isDeload: false, notes: null,
  sets: [
    plan('set-1', 1, 2), plan('set-2', 2, 2), plan('set-3', 3, 2),
    // the legacy dropset: a head with no stage kind and one planned stage
    plan('set-3-drop', 3, 0, { isDropset: true, parentWeekPlanSetId: 'set-3', stageIndex: 1 }),
  ] as WeekPlan['sets'],
  exercises: [pe1],
  createdAt: '2026-01-01T00:00:00Z',
}
let session: Session
const logged: Record<string, unknown>[] = []
const completed: Record<string, unknown>[] = []
const logSetMutateAsync = vi.fn((params: Record<string, unknown>) => {
  logged.push(JSON.parse(JSON.stringify(params)))
  const log: SetLog = {
    id: `log-${(session.setLogs?.length ?? 0) + 1}`, userId: 'user-1', sessionId: 'session-1',
    exerciseId: params.exerciseId as string, weekPlanSetId: params.weekPlanSetId as string | null,
    setNumber: params.setNumber as number, weight: (params.weight as number | null) ?? null, reps: (params.reps as number | null) ?? null,
    rir: (params.rir as number | null) ?? null, note: null, isDropset: (params.isDropset as boolean | undefined) ?? false,
    parentSetId: (params.parentSetId as string | null) ?? null, stageIndex: (params.stageIndex as number | undefined) ?? 0,
    isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false, loggedAt: '2026-01-05T10:05:00Z',
    restSeconds: null, formRating: null, stageKind: (params.stageKind as SetLog['stageKind']) ?? null,
  }
  session = { ...session, setLogs: [...(session.setLogs ?? []), log] }
  return Promise.resolve(log)
})
const completeMutateAsync = vi.fn((params: Record<string, unknown>) => {
  completed.push(JSON.parse(JSON.stringify(params)))
  return Promise.resolve()
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
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: logSetMutateAsync }),
  useCompleteSession: () => ({ mutateAsync: completeMutateAsync, isPending: false }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')
const { useRestTimerStore } = await import('./restTimerStore')
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../settings/settingsStore')

const jsx = () => (
  <MemoryRouter>
    <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
  </MemoryRouter>
)

// Types into the current row (the only row with boxes) and presses its LOG.
async function logCurrentRow(container: HTMLElement, weight: string, reps: string) {
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

beforeEach(() => {
  session = {
    id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
    workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
    startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:05:00Z',
    setLogs: [], energyRating: null, pumpRating: null,
  }
  logged.length = 0
  completed.length = 0
  logSetMutateAsync.mockClear()
  useRestTimerStore.setState({ startedAt: null, isVisible: true, anchorId: null, targetSeconds: null })
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, targetRestSeconds: 90 })
})

afterEach(() => vi.useRealTimers())

describe('GymSession — behaviour parity with the pre-58a screen on the plain-session fixture (R4)', () => {
  it('the frozen fixture is the plain session it claims to be: four logs, the first three heads and a drop under the third (a vacuous fixture proves nothing)', () => {
    expect(FROZEN.steps.map((s) => s.payload.weekPlanSetId)).toEqual(['set-1', 'set-2', 'set-3', 'set-3-drop'])
    expect(FROZEN.steps.map((s) => s.payload.isDropset)).toEqual([false, false, false, true])
    expect(FROZEN.steps.map((s) => s.payload.stageKind)).toEqual([null, null, null, null])
    expect(FROZEN.steps.map((s) => s.payload.restSeconds)).toEqual([null, 95, 100, 20])
    expect(FROZEN.finish).toEqual({ id: 'session-1', note: null, energyRating: null, pumpRating: null })
  })

  it('each LOG writes the payload the screen wrote before (stage_kind null, is_dropset, rest_seconds, the number the row shows), and no key the old payload lacked', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'))
    const { container, rerender } = render(jsx())
    for (const step of FROZEN.steps) {
      vi.setSystemTime(new Date(Date.now() + ((step.payload.restSeconds as number | null) ?? 0) * 1000))
      await logCurrentRow(container, step.typed.weight, step.typed.reps)
      rerender(jsx())
      const payload = logged[logged.length - 1]
      expect(payload).toEqual(step.payload)
      // The same keys, no more: a planned set's payload leaves added_place (and the log's own id) out.
      expect(Object.keys(payload).sort()).toEqual(Object.keys(step.payload).sort())
    }
    expect(logged).toHaveLength(4)
  })

  it('the rest target after each LOG is the one before: the global timer, also for the legacy null-kind dropset (D30: a null stage kind is not promoted to dropset for rest)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-05T10:00:00Z'))
    const { container, rerender } = render(jsx())
    for (const step of FROZEN.steps) {
      vi.setSystemTime(new Date(Date.now() + ((step.payload.restSeconds as number | null) ?? 0) * 1000))
      await logCurrentRow(container, step.typed.weight, step.typed.reps)
      rerender(jsx())
      const rest = useRestTimerStore.getState()
      expect({ running: rest.startedAt !== null, targetSeconds: rest.targetSeconds }).toEqual(step.rest)
    }
    // the head of the legacy dropset (step 3) and its drop (step 4) both read the Settings value
    expect(FROZEN.steps[2].rest.targetSeconds).toBe(useSettingsStore.getState().targetRestSeconds)
  })

  it('FINISH SESSION then COMPLETE writes the session patch it wrote before', async () => {
    const { container } = render(jsx())
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'FINISH SESSION')!)
    const complete = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'COMPLETE')
    expect(complete).toBeTruthy()
    await act(async () => {
      fireEvent.click(complete!)
      await Promise.resolve()
    })
    expect(completed).toEqual([FROZEN.finish])
  })
})
