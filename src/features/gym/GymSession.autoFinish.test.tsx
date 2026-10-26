// @vitest-environment jsdom
// Chunk 61 — auto-finish at the workout screen (TASKS-1.2 61 Scope: "`useAutoFinishSession` waits for what the workout's rows say is left, the same view as
// the finish warning (`finishWarning(order, logs, changes)` null), instead of a log on every planned set id"; DECISIONS 166 (a), Adam 2026-10-16). The REAL
// auto-finish hook runs inside GymSession here: what the screen tells it is what is asserted, by whether the session completes. The hook's own rules
// (threshold, grace window, the setting) are `useAutoFinishSession.test.tsx`.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, Session, SessionSetChangeRecord, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'

const complete = vi.hoisted(() => ({ mutate: vi.fn() }))

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./useScrollToCurrentSet', () => ({ useScrollToCurrentSet: () => ({ containerRef: () => {}, direction: null, scrollToCurrentSet: () => {} }) }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./WarmupRoutineChecklist', () => ({ default: () => null }))
vi.mock('../offline/SyncFailedNotice', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({ useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }) }))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useUpdateSetLog: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useCompleteSession: () => complete,
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn().mockResolvedValue(false), flushSyncQueue: vi.fn() }))

const { default: GymSession } = await import('./GymSession')

const MIN = 60_000
const START = new Date('2026-01-06T09:25:00Z').getTime() // the logs below are stamped 09:20 and 09:21
const peLat: ProgramExercise = {
  id: 'xe-lat', workoutDayId: 'wd-1', userId: 'u1', exerciseId: 'ex-lat', position: 0, weightUnit: null,
  exercise: { id: 'ex-lat', userId: 'u1', name: 'Lat Pulldown', muscleGroup: 'back', isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null, movementPattern: null, status: 'active', sourceLibraryId: null, lostAt: null },
}
const set = (id: string, setNumber: number): WeekPlanSet => ({ id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId: 'xe-lat', setNumber, targetRir: 1, targetWeight: 55, repMin: 8, repMax: 8, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false })
const plan: WeekPlan = { id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z', exercises: [peLat], sets: [set('lat-1', 1), set('lat-2', 2), set('lat-3', 3)] }
const log = (id: string, weekPlanSetId: string, setNumber: number, loggedAt: string): SetLog => ({
  id, userId: 'u1', sessionId: 'session-1', exerciseId: 'ex-lat', weekPlanSetId, setNumber, weight: 55, reps: 8, rir: 1, note: null, isDropset: false, parentSetId: null,
  stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false, loggedAt, restSeconds: null, formRating: null, stageKind: null, addedPlace: null,
})
const deleted = (weekPlanSetId: string): SessionSetChangeRecord => ({ id: 'chg-1', userId: 'u1', sessionId: 'session-1', createdAt: '2026-01-06T09:00:00Z', updatedAt: '2026-01-06T09:00:00Z', kind: 'deleted', weekPlanSetId })
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [] }

let session: Session
function mount(logs: SetLog[], setChanges: SessionSetChangeRecord[]) {
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: '2026-01-06', status: 'in_progress', note: null,
    startedAt: '2026-01-06T09:10:00Z', completedAt: null, createdAt: '2026-01-06T09:10:00Z', setLogs: logs, setChanges, energyRating: null, pumpRating: null,
  }
  return render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={plan} weekNumber={2} today="2026-01-06" />
    </MemoryRouter>,
  )
}
const advance = (minutes: number) => act(async () => void vi.advanceTimersByTime(minutes * MIN))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(START)
  complete.mutate.mockReset()
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, autoFinishMinutes: 10 })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('auto-finish follows the rows (DECISIONS 166 (a))', () => {
  it('with one planned set deleted and every other set logged, the session completes after the threshold', async () => {
    mount([log('l1', 'lat-1', 1, '2026-01-06T09:20:00Z'), log('l3', 'lat-3', 2, '2026-01-06T09:21:00Z')], [deleted('lat-2')])
    await advance(5)
    expect(complete.mutate).not.toHaveBeenCalled() // the grace window since the screen opened
    await advance(6)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
    expect(complete.mutate.mock.calls[0][0]).toEqual({ id: 'session-1', note: null })
  })

  it('the same session with that set still open (no change row) is not finished: it waits for the set', async () => {
    mount([log('l1', 'lat-1', 1, '2026-01-06T09:20:00Z'), log('l3', 'lat-3', 3, '2026-01-06T09:21:00Z')], [])
    await advance(60)
    expect(complete.mutate).not.toHaveBeenCalled()
  })

  it('a skipped set is settled: every set logged or skipped finishes it, as before', async () => {
    mount([log('l1', 'lat-1', 1, '2026-01-06T09:20:00Z'), { ...log('l2', 'lat-2', 2, '2026-01-06T09:20:30Z'), isSkipped: true, weight: null, reps: null }, log('l3', 'lat-3', 3, '2026-01-06T09:21:00Z')], [])
    await advance(11)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
  })
})
