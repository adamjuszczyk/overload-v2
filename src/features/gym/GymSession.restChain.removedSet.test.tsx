// @vitest-environment jsdom
//
// Chunk 32 (TASKS-1.1 "Nothing visible changes in weeks already planned" / "Who reads removed
// sets"). "Make this week the new default" soft-removes a program set the default drops
// (v2_program_sets.removed_at, migration 040) instead of deleting it: a week planned earlier
// still has that set, still links to the program set, and the workout screen still finds the
// set's own rest and a staged head's stage rest through it. A hard delete would null the link
// (027's `on delete set null`) and the set would silently fall back to its exercise's rest.
//
// The workout screen is NOT changed by this chunk (D30: GymSession.restChain.test.tsx and every
// other workout-screen test pass unmodified). This is the one new case: the REAL GymSession ->
// ExerciseCard -> SetGroup -> SetRow tree, with a program set that carries removedAt in the
// program sets it reads (fetchProgramSets keeps returning such rows), and the resolved rest
// timer target after each log. Same harness as GymSession.restChain.test.tsx.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, ProgramSet, ProgramSupersetBlock, WeekPlan, WeekPlanSet, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => cleanup())

let session: Session = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined,
  workoutDayId: 'wd-1', workoutDay: undefined, date: '2026-01-05', status: 'in_progress', note: null,
  startedAt: '2026-01-05T10:00:00Z', completedAt: null, createdAt: '2026-01-05T10:00:00Z',
  setLogs: [], energyRating: null, pumpRating: null,
}
let programSetsFixture: ProgramSet[] = []
const blockRestsFixture: ProgramSupersetBlock[] = []

function programSet(overrides: Partial<ProgramSet> & { id: string; programExerciseId: string }): ProgramSet {
  return {
    userId: 'user-1', position: 1, isWarmup: false, stageKind: null, stageRestSeconds: null,
    parentProgramSetId: null, stageIndex: 0, repMin: null, repMax: null, isAmrap: false,
    restSeconds: null, createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
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
vi.mock('./FinishScreen', () => ({ default: () => null }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }),
  useSupersetBlockRests: () => ({ data: blockRestsFixture }),
  useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: programSetsFixture }) }))
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
const { useRestTimerStore } = await import('./restTimerStore')
const { useSettingsStore, DEFAULT_SETTINGS } = await import('../settings/settingsStore')

beforeEach(() => {
  useRestTimerStore.setState({ startedAt: null, isVisible: true, anchorId: null, targetSeconds: null })
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, targetRestSeconds: 90 })
  session = { ...session, setLogs: [] }
})

function sessionJsx(workoutDay: WorkoutDay, weekPlan: WeekPlan) {
  return (
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>
  )
}

// Logs the first currently-loggable row (the harness of GymSession.restChain.test.tsx).
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
const bench: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
  restSeconds: 40, restAfterSeconds: 90,
  exercise: {
    id: 'ex-1', userId: 'user-1', name: 'Bench Press', muscleGroup: 'chest', isArchived: false,
    createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null,
    status: 'active', sourceLibraryId: null, lostAt: null,
  },
}
const DROPPED = '2026-10-11T10:00:00Z'

function twoPlainSets(set2ProgramSetId: string | null): WeekPlanSet[] {
  return [
    { id: 'wps-1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId: null },
    { id: 'wps-2', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 2, targetRir: 2, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, programSetId: set2ProgramSetId },
  ]
}
function weekPlan(sets: WeekPlanSet[]): WeekPlan {
  return {
    id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1,
    isDeload: false, notes: null, sets, exercises: [bench], createdAt: '2026-01-01T00:00:00Z',
  }
}

describe('GymSession — a planned set whose program set the default has since dropped (removed_at)', () => {
  // Break: filter removed program sets out of what the workout screen reads (GymSession's allProgramSets) ->
  // set 2 falls through to "rest after" (90) and this fails.
  it('still finds the set\'s own rest through it: the soft-removed program set\'s override is the target — not the exercise\'s rest-after on its last set', async () => {
    programSetsFixture = [programSet({ id: 'ps-2', programExerciseId: 'pe-1', restSeconds: 7, removedAt: DROPPED })]
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan(twoPlainSets('ps-2'))))

    await logFirstActiveRow(container, '60', '10') // set 1: no override
    expect(useRestTimerStore.getState().targetSeconds).toBe(40) // the exercise's own rest

    rerender(sessionJsx(workoutDay, weekPlan(twoPlainSets('ps-2'))))
    await logFirstActiveRow(container, '62.5', '8') // set 2: its program set was dropped from the default after this week was planned
    expect(useRestTimerStore.getState().targetSeconds).toBe(7)
  })

  // The control that gives the case above its meaning: this is what a HARD delete would do (027: the week
  // set's program_set_id is set to null), so the same set loses its rest. Break proof for "delete instead
  // of soft-remove": the rest is gone and the set follows its exercise's rest-after.
  it('(control) a program set that was deleted instead — the link nulled by the foreign key — would have lost it', async () => {
    programSetsFixture = []
    const { container, rerender } = render(sessionJsx(workoutDay, weekPlan(twoPlainSets(null))))
    await logFirstActiveRow(container, '60', '10')
    rerender(sessionJsx(workoutDay, weekPlan(twoPlainSets(null))))
    await logFirstActiveRow(container, '62.5', '8')
    expect(useRestTimerStore.getState().targetSeconds).toBe(90) // rest after, on the exercise's last set
  })

  it('a staged head\'s own stage rest is found through a dropped program set too (stage rest 33 s, not the kind\'s default 15 s)', async () => {
    const plain: ProgramExercise = { ...bench, restSeconds: null, restAfterSeconds: null }
    const head: WeekPlanSet = {
      id: 'wps-head', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 2, isDropset: false,
      parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, stageKind: 'rest_pause', programSetId: 'ps-head',
    }
    const stage1: WeekPlanSet = {
      id: 'wps-s1', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 0, isDropset: true,
      parentWeekPlanSetId: 'wps-head', stageIndex: 1, isWarmup: false, programSetId: 'ps-s1',
    }
    const stage2: WeekPlanSet = {
      id: 'wps-s2', weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: 1, targetRir: 0, isDropset: true,
      parentWeekPlanSetId: 'wps-head', stageIndex: 2, isWarmup: false, programSetId: 'ps-s2',
    }
    programSetsFixture = [
      programSet({ id: 'ps-head', programExerciseId: 'pe-1', stageKind: 'rest_pause', stageRestSeconds: 33, removedAt: DROPPED }),
      programSet({ id: 'ps-s1', programExerciseId: 'pe-1', parentProgramSetId: 'ps-head', stageIndex: 1, removedAt: DROPPED }),
      programSet({ id: 'ps-s2', programExerciseId: 'pe-1', parentProgramSetId: 'ps-head', stageIndex: 2, removedAt: DROPPED }),
    ]
    const plan: WeekPlan = { ...weekPlan([head, stage1, stage2]), exercises: [plain] }
    const { container } = render(sessionJsx(workoutDay, plan))
    await logFirstActiveRow(container, '100', '8') // the head: a next stage is to come -> the stage rest
    expect(useRestTimerStore.getState().targetSeconds).toBe(33)
  })
})
