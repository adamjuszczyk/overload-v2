// @vitest-environment jsdom
// Chunk 62 — SET TYPE at the workout screen (TASKS-1.2 62; SPEC [1.2] "Set type during a workout (19)", "Offline (G47)"; boards W7a, W7, W2b; DECISIONS 141, 152, 161, 168 (a)).
// The screen is GymSession on a session of two exercises, with the data hooks mocked at their boundary, as GymSession.setSheet.test.tsx has them: what the screen hands
// `useUpdateSetLog`, `writeSetChanges`, `queueSetChanges`, the sync queue's `queueSetLogPatch`, `useLogSet` and Plan's `updateSet` is what it writes. A card-level pass over
// the same flows is ExerciseCard.setType.test.tsx; the same writers against the real producers and a fake server: useSyncQueue.setType.test.tsx. This file holds what
// only the screen decides: which writers it gives the cards, as which user and session, and what online or offline changes in them.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, act, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { ProgramExercise, Session, SessionSetChangeRecord, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { queryClient } from '../../lib/queryClient'
import { useToastStore } from '../notifications/toastStore'

const hooks = vi.hoisted(() => ({
  online: true,
  deleteLog: vi.fn(),
  updateMutate: vi.fn(),
  updateAsync: vi.fn(),
  writeChanges: vi.fn(),
  queuePatch: vi.fn(),
  queueKindClear: vi.fn(),
  queueChanges: vi.fn(),
  logSet: vi.fn(),
  flush: vi.fn(),
  updateSet: vi.fn(),
  allPlans: [] as unknown[],
}))

afterEach(() => {
  cleanup()
  useRestTimerStore.getState().stop()
  useSetTimerStore.getState().stop()
  useToastStore.getState().clear()
  queryClient.clear()
})
beforeEach(() => {
  scheduleType = 'weekday'
  hooks.online = true
  for (const fn of [hooks.deleteLog, hooks.updateMutate, hooks.updateAsync, hooks.writeChanges, hooks.queuePatch, hooks.queueKindClear, hooks.queueChanges, hooks.logSet, hooks.flush, hooks.updateSet]) fn.mockReset()
  hooks.deleteLog.mockResolvedValue(undefined)
  hooks.updateAsync.mockResolvedValue(undefined)
  hooks.writeChanges.mockResolvedValue(undefined)
  hooks.queuePatch.mockResolvedValue(true)
  hooks.queueKindClear.mockResolvedValue(undefined)
  hooks.queueChanges.mockResolvedValue(undefined)
  hooks.logSet.mockResolvedValue({})
  hooks.flush.mockResolvedValue(undefined)
  hooks.updateSet.mockResolvedValue(undefined)
  hooks.allPlans = []
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, logInOrder: true, restTimerEnabled: true, targetRestSeconds: 120 })
})

// ─── The session ──────────────────────────────────────────────────────────────────────────────────
const ex = (id: string, name: string, muscleGroup: string) => ({
  id, userId: 'u1', name, muscleGroup: muscleGroup as never, isArchived: false, createdAt: '2026-01-01T00:00:00Z', muscleSubgroups: null,
  movementPattern: null, status: 'active' as const, sourceLibraryId: null, lostAt: null,
})
const pe = (id: string, exerciseId: string, name: string, muscleGroup: string, position: number): ProgramExercise => ({
  id, workoutDayId: 'wd-1', userId: 'u1', exerciseId, position, weightUnit: null, exercise: ex(exerciseId, name, muscleGroup),
})
const set = (id: string, programExerciseId: string, setNumber: number, extra: Partial<WeekPlanSet> = {}): WeekPlanSet => ({
  id, weekPlanId: 'wp-1', userId: 'u1', programExerciseId, setNumber, targetRir: 1, isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false, ...extra,
})
const logOf = (over: Partial<SetLog> & { id: string }): SetLog => ({
  userId: 'u1', sessionId: 'session-1', exerciseId: 'ex-lat', weekPlanSetId: null, setNumber: 1, weight: 55, reps: 9, rir: 2, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2026-01-06T09:20:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})

const peLat = pe('xe-lat', 'ex-lat', 'Lat Pulldown', 'back', 0)
const peEz = pe('xe-ez', 'ex-ez', 'EZ Bar Curl', 'biceps', 1)
// Lat Pulldown: 01, 02 logged; 03 and 04 are dropsets with one drop each (03 and its drop logged, 04 open); 05 plain and open. EZ Bar Curl: a warmup and two sets.
const plan = (): WeekPlan => ({
  id: 'wp-1', userId: 'u1', mesocycleId: 'm1', workoutDayId: 'wd-1', weekNumber: 2, isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z', exercises: [peLat, peEz],
  sets: [
    set('lat-1', 'xe-lat', 1, { targetWeight: 55, repMin: 9, repMax: 9 }),
    set('lat-2', 'xe-lat', 2, { targetWeight: 55, repMin: 8, repMax: 8 }),
    set('lat-3', 'xe-lat', 3, { targetWeight: 52.5, repMin: 8, repMax: 10, stageKind: 'dropset', tags: ['push here'] }),
    set('lat-3-d1', 'xe-lat', 3, { isDropset: true, parentWeekPlanSetId: 'lat-3', stageIndex: 1, targetWeight: 40, isAmrap: true, targetRir: 0 }),
    set('lat-4', 'xe-lat', 4, { targetWeight: 52.5, repMin: 8, repMax: 10, stageKind: 'dropset' }),
    set('lat-4-d1', 'xe-lat', 4, { isDropset: true, parentWeekPlanSetId: 'lat-4', stageIndex: 1, targetWeight: 40, isAmrap: true, targetRir: 0 }),
    set('lat-5', 'xe-lat', 5, { targetWeight: 50, repMin: 10, repMax: 10 }),
    set('ez-w', 'xe-ez', 1, { isWarmup: true, targetWeight: 20, repMin: 12, repMax: 12 }),
    set('ez-1', 'xe-ez', 1, { targetWeight: 30, repMin: 8, repMax: 8 }),
    set('ez-2', 'xe-ez', 2, { targetWeight: 30, repMin: 8, repMax: 8 }),
  ],
})
const logs = (): SetLog[] => [
  logOf({ id: 'l-lat-1', weekPlanSetId: 'lat-1', setNumber: 1 }),
  logOf({ id: 'l-lat-2', weekPlanSetId: 'lat-2', setNumber: 2 }),
  logOf({ id: 'l-lat-3', weekPlanSetId: 'lat-3', setNumber: 3, stageKind: 'dropset', weight: 52.5, reps: 10 }),
  logOf({ id: 'l-lat-3-d1', weekPlanSetId: 'lat-3-d1', setNumber: 3, parentSetId: 'l-lat-3', stageIndex: 1, isDropset: true, weight: 40, reps: 8, rir: 0 }),
]

let session: Session
const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'p1', userId: 'u1', name: 'PULL 1', position: 0, exercises: [] }

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => hooks.online }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useAutoFinishSession', () => ({ useAutoFinishSession: () => {} }))
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
  useLogSet: () => ({ mutateAsync: hooks.logSet }),
  useUpdateSetLog: () => ({ mutate: hooks.updateMutate, mutateAsync: hooks.updateAsync }),
  useDeleteSetLog: () => ({ mutateAsync: hooks.deleteLog }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: hooks.queuePatch, queueSetLogStageKindClear: hooks.queueKindClear, flushSyncQueue: hooks.flush }))
vi.mock('./useSessionSetChanges', async (original) => ({ ...(await original<typeof import('./useSessionSetChanges')>()), writeSetChanges: hooks.writeChanges, queueSetChanges: hooks.queueChanges }))
vi.mock('../plan/weekPlanService', () => ({ updateSet: hooks.updateSet }))
vi.mock('../plan/useWeekPlan', () => ({ useAllWeekPlans: () => ({ data: hooks.allPlans }) }))

const { default: GymSession } = await import('./GymSession')

let weekPlan: WeekPlan = plan()
let scheduleType: 'weekday' | 'sequence' = 'weekday'
const jsx = () => (
  <MemoryRouter>
    <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={2} today="2026-01-06" scheduleType={scheduleType} />
  </MemoryRouter>
)
function open(sessionLogs: SetLog[] = logs(), setChanges?: SessionSetChangeRecord[], status: Session['status'] = 'in_progress') {
  weekPlan = plan()
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
    date: '2026-01-06', status, note: null, startedAt: '2026-01-06T09:10:00Z', completedAt: null, createdAt: '2026-01-06T09:10:00Z',
    setLogs: sessionLogs, ...(setChanges === undefined ? {} : { setChanges }), energyRating: null, pumpRating: null,
  }
  const view = render(jsx())
  return { ...view, refresh: () => act(async () => view.rerender(jsx())) }
}
const rowOf = (container: HTMLElement, key: string) => container.querySelector(`[data-row-key="${key}"]`) as HTMLElement
const press = (el: Element) =>
  act(async () => {
    fireEvent.click(el)
    for (let i = 0; i < 20; i++) await Promise.resolve()
  })
const pickType = (name: string) => press(within(screen.getByRole('dialog')).getByText(name))
const openPicker = (container: HTMLElement, key: string, from: 'sheet' | 'pen') => {
  if (from === 'sheet') {
    fireEvent.click(within(rowOf(container, key)).getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('SET TYPE'))
  } else {
    fireEvent.click(within(rowOf(container, key)).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(container, key)).getByText('SET TYPE'))
  }
}

describe('SET TYPE on a logged set, as the screen sends it (online)', () => {
  it('the log goes through `useUpdateSetLog` as one patch of its two type columns, the rows through `writeSetChanges` for this session as this user; the plan is never written', async () => {
    const { container } = open()
    openPicker(container, 'set:lat-2', 'pen')
    await pickType('Dropset')
    expect(hooks.updateAsync.mock.calls).toEqual([[{ id: 'l-lat-2', changes: { isWarmup: false, stageKind: 'dropset' } }]])
    expect(hooks.writeChanges).toHaveBeenCalledTimes(1)
    expect(hooks.writeChanges).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'u1',
      online: true,
      writes: [
        { change: { kind: 'retyped', weekPlanSetId: 'lat-2', type: { kind: 'staged', stageKind: 'dropset', stageCount: 1 } }, id: null },
        { change: { kind: 'pending_stages', setLogId: 'l-lat-2', stageKind: 'dropset', stageCount: 1 }, id: null },
      ],
    })
    expect(hooks.updateSet).not.toHaveBeenCalled() // next week sees it only through REVIEW: no write to the plan's rows
    expect(hooks.queueChanges).not.toHaveBeenCalled()
  })

  it('a warmup logged with no weight or reps: SAVE is one `useUpdateSetLog` patch holding the type and both numbers, and the screen never sends the type alone', async () => {
    const numberless = [...logs(), logOf({ id: 'l-ez-w', exerciseId: 'ex-ez', weekPlanSetId: 'ez-w', setNumber: 1, isWarmup: true, weight: null, reps: null, rir: null })]
    const { container } = open(numberless)
    openPicker(container, 'set:ez-w', 'pen')
    await pickType('Normal')
    expect(hooks.updateAsync).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.change(within(rowOf(container, 'set:ez-w')).getByLabelText('Weight'), { target: { value: '25' } })
    fireEvent.change(within(rowOf(container, 'set:ez-w')).getByLabelText('Reps'), { target: { value: '8' } })
    await press(within(rowOf(container, 'set:ez-w')).getByText('SAVE'))
    expect(hooks.updateAsync.mock.calls).toEqual([[{ id: 'l-ez-w', changes: { isWarmup: false, stageKind: null, weight: 25, reps: 8 } }]])
  })

  it('offline the SET TYPE row of a logged set is off: nothing is sent, nothing queued', async () => {
    hooks.online = false
    const { container } = open()
    fireEvent.click(within(rowOf(container, 'set:lat-2')).getByLabelText('Edit set'))
    const row = within(rowOf(container, 'set:lat-2')).getByText('SET TYPE').closest('button') as HTMLButtonElement
    expect(row.disabled).toBe(true)
    fireEvent.click(row)
    expect(screen.queryByText('What is this set?')).toBeNull()
    expect(hooks.updateAsync).not.toHaveBeenCalled()
    expect(hooks.writeChanges).not.toHaveBeenCalled()
    expect(hooks.queuePatch).not.toHaveBeenCalled()
  })
})

describe('SET TYPE on an upcoming set, as the screen sends it', () => {
  // Lat Pulldown 01–03 (and 03's drop) are logged; 04 is open with its drop; 05 is logged here, so a set after the open one moves with it
  const withLogged05 = () => [...logs(), logOf({ id: 'l-lat-5', weekPlanSetId: 'lat-5', setNumber: 5 })]

  it('online: the `retyped` row through `writeSetChanges`, then the logged set after it renumbered as 58a\'s patch item and the queue sent; no log is patched', async () => {
    const { container } = open(withLogged05())
    openPicker(container, 'set:lat-4', 'sheet')
    await pickType('Warmup')
    expect(hooks.writeChanges).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'u1',
      online: true,
      writes: [{ change: { kind: 'retyped', weekPlanSetId: 'lat-4', type: { kind: 'warmup' } }, id: null }],
    })
    expect(hooks.queuePatch.mock.calls).toEqual([[{ id: 'l-lat-5', sessionId: 'session-1', parentSetId: null }, 4]])
    expect(hooks.flush).toHaveBeenCalledTimes(1)
    expect(hooks.updateAsync).not.toHaveBeenCalled()
    expect(hooks.updateSet).not.toHaveBeenCalled()
  })

  it('offline (168 (a)): the same row is written with the offline flag, which queues it, and the renumber is queued and not sent', async () => {
    hooks.online = false
    const { container } = open(withLogged05())
    openPicker(container, 'set:lat-4', 'sheet')
    await pickType('Warmup')
    expect(hooks.writeChanges).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'u1',
      online: false,
      writes: [{ change: { kind: 'retyped', weekPlanSetId: 'lat-4', type: { kind: 'warmup' } }, id: null }],
    })
    expect(hooks.queuePatch.mock.calls).toEqual([[{ id: 'l-lat-5', sessionId: 'session-1', parentSetId: null }, 4]])
    expect(hooks.flush).not.toHaveBeenCalled()
  })
})

describe('LOG of a set added in the session and given a staged type: its `pending_stages` row is queued after the log (DECISIONS 161)', () => {
  const addAndLog = async (container: HTMLElement) => {
    useSettingsStore.setState({ logInOrder: false }) // (with the lock on, LOG on a set that isn't the current one asks first: 60's, not this file's)
    const lat =container.querySelectorAll('.rounded-xl.overflow-hidden')[0] as HTMLElement
    fireEvent.click(within(lat).getByText('ADD SET'))
    const added = Array.from(lat.querySelectorAll('[data-row-key]')).find((el) => (el.getAttribute('data-row-key') ?? '').startsWith('added:')) as HTMLElement
    const key = added.getAttribute('data-row-key')!
    fireEvent.click(within(added).getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('SET TYPE'))
    await pickType('Dropset')
    fireEvent.keyDown(document, { key: 'Escape' })
    const row = rowOf(container, key)
    fireEvent.change(within(row).getByLabelText('Weight'), { target: { value: '50' } })
    fireEvent.change(within(row).getByLabelText('Reps'), { target: { value: '9' } })
    await press(within(row).getByText('LOG'))
  }

  it('the log is written as a dropset head and the row follows it through `queueSetChanges`, keyed by the new log, sent at once online', async () => {
    const { container } = open()
    await addAndLog(container)
    expect(hooks.logSet).toHaveBeenCalledTimes(1)
    const sent = hooks.logSet.mock.calls[0][0] as { id: string; stageKind: string; addedPlace: number }
    expect(sent).toMatchObject({ stageKind: 'dropset', addedPlace: 1, weekPlanSetId: null })
    expect(hooks.queueChanges).toHaveBeenCalledWith({
      sessionId: 'session-1',
      userId: 'u1',
      flush: true,
      writes: [{ change: { kind: 'pending_stages', setLogId: sent.id, stageKind: 'dropset', stageCount: 1 }, id: null }],
    })
    expect(hooks.writeChanges).not.toHaveBeenCalled()
  })

  it('offline the row is queued and the queue is not sent (the log\'s own upsert is queued ahead of it)', async () => {
    hooks.online = false
    const { container } = open()
    await addAndLog(container)
    expect(hooks.queueChanges).toHaveBeenCalledTimes(1)
    expect(hooks.queueChanges.mock.calls[0][0]).toMatchObject({ flush: false })
  })
})
