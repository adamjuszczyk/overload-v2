// @vitest-environment jsdom
// Chunk 61 — the set ⋯ sheet, the edit panel and DELETE at the workout screen (TASKS-1.2 61; SPEC [1.2] "Delete set (18b)", "The set's ⋯ (C9)", Tags / cues,
// "Offline (G47)"; boards W7, W8, W9, W2b). The screen is GymSession on a session of two exercises, with the data hooks mocked at their boundary: what the
// screen hands `useDeleteSetLog`, `useUpdateSetLog`, `writeSetChanges`, the sync queue's `queueSetLogPatch` and Plan's `updateSet` is what it writes, and the
// session's own rows are what it reads. A card-level pass over the same flows is `ExerciseCard.delete.test.tsx`; this file holds what only the screen decides:
// what it reads (the session's change rows), which writers it gives the cards, and what online or offline changes in them.
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
  for (const fn of [hooks.deleteLog, hooks.updateMutate, hooks.updateAsync, hooks.writeChanges, hooks.queuePatch, hooks.flush, hooks.updateSet]) fn.mockReset()
  hooks.deleteLog.mockResolvedValue(undefined)
  hooks.updateAsync.mockResolvedValue(undefined)
  hooks.writeChanges.mockResolvedValue(undefined)
  hooks.queuePatch.mockResolvedValue(true)
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
const NOW = '2026-01-06T09:00:00Z'
const deleted = (id: string, weekPlanSetId: string): SessionSetChangeRecord => ({ id, userId: 'u1', sessionId: 'session-1', createdAt: NOW, updatedAt: NOW, kind: 'deleted', weekPlanSetId })

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
  useLogSet: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useUpdateSetLog: () => ({ mutate: hooks.updateMutate, mutateAsync: hooks.updateAsync }),
  useDeleteSetLog: () => ({ mutateAsync: hooks.deleteLog }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: hooks.queuePatch, flushSyncQueue: hooks.flush }))
vi.mock('./useSessionSetChanges', async (original) => ({ ...(await original<typeof import('./useSessionSetChanges')>()), writeSetChanges: hooks.writeChanges }))
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
const latLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[data-row-key]'))
    .filter((el) => (el.getAttribute('data-row-key') ?? '').startsWith('set:lat'))
    .map((el) => el.querySelector('span')?.textContent)

describe('the session\'s change rows are read with it and drawn', () => {
  it('a planned set the session deleted is out of its card, and the sets after it are renumbered; without its change row it is there (the control)', () => {
    const control = open(logs(), [])
    expect(latLabels(control.container)).toEqual(['01', '02', '03', '↳', '04', '↳', '05'])
    control.unmount()
    const { container } = open(logs(), [deleted('chg-1', 'lat-4')])
    expect(rowOf(container, 'set:lat-4')).toBeNull()
    expect(rowOf(container, 'set:lat-4:stage:1')).toBeNull()
    expect(latLabels(container)).toEqual(['01', '02', '03', '↳', '04'])
    expect(rowOf(container, 'set:lat-5').querySelector('span')?.textContent).toBe('04') // 05 is 04 now
  })
})

describe('DELETE, as the screen sends it (online)', () => {
  const allLogged = () => [
    ...logs(),
    logOf({ id: 'l-lat-4', weekPlanSetId: 'lat-4', setNumber: 4, stageKind: 'dropset' }),
    logOf({ id: 'l-lat-4-d1', weekPlanSetId: 'lat-4-d1', setNumber: 4, parentSetId: 'l-lat-4', stageIndex: 1, isDropset: true, weight: 40, reps: 8, rir: 0 }),
  ]
  const deleteSecond = async (container: HTMLElement) => {
    fireEvent.click(within(rowOf(container, 'set:lat-2')).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(container, 'set:lat-2')).getByText('DELETE'))
    await press(within(screen.getByRole('alertdialog')).getByText('DELETE SET'))
  }

  it('the log goes through `useDeleteSetLog` with its head named for a drop, the change row through `writeSetChanges` for this session as this user, online', async () => {
    const { container } = open(allLogged())
    await deleteSecond(container)
    expect(hooks.deleteLog.mock.calls).toEqual([[{ id: 'l-lat-2', parentSetId: null }]])
    expect(hooks.writeChanges).toHaveBeenCalledTimes(1)
    expect(hooks.writeChanges).toHaveBeenCalledWith({ sessionId: 'session-1', userId: 'u1', online: true, writes: [{ change: { kind: 'deleted', weekPlanSetId: 'lat-2' }, id: null }] })
    expect(hooks.updateSet).not.toHaveBeenCalled() // the plan's rows are Plan's: the only write to them from the workout is CUES
  })

  it('a logged head with its drop: the drop is deleted first and names its head (the queue needs it), then the head', async () => {
    const { container } = open(allLogged())
    fireEvent.click(within(rowOf(container, 'set:lat-3')).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(container, 'set:lat-3')).getByText('DELETE'))
    await press(within(screen.getByRole('alertdialog')).getByText('DELETE SET'))
    expect(hooks.deleteLog.mock.calls).toEqual([[{ id: 'l-lat-3-d1', parentSetId: 'l-lat-3' }], [{ id: 'l-lat-3', parentSetId: null }]])
  })

  it('the renumber is 58a\'s patch item, one per log, heads and their drops, online: 03 and its drop are 02, 04 and its drop 03, and the queue is sent', async () => {
    const { container } = open(allLogged())
    await deleteSecond(container)
    // 02 is gone: 03 (head and drop) becomes 02, 04 (head and drop) becomes 03. 01 is untouched.
    expect(hooks.queuePatch.mock.calls).toEqual([
      [{ id: 'l-lat-3', sessionId: 'session-1', parentSetId: null }, 2],
      [{ id: 'l-lat-3-d1', sessionId: 'session-1', parentSetId: 'l-lat-3' }, 2],
      [{ id: 'l-lat-4', sessionId: 'session-1', parentSetId: null }, 3],
      [{ id: 'l-lat-4-d1', sessionId: 'session-1', parentSetId: 'l-lat-4' }, 3],
    ])
    expect(hooks.flush).toHaveBeenCalledTimes(1)
    // the screen's own corrections wait for the delete: nothing it listed was queued before the delete's own patches
    expect(hooks.queuePatch.mock.calls.every(([log]) => ['l-lat-3', 'l-lat-3-d1', 'l-lat-4', 'l-lat-4-d1'].includes(log.id))).toBe(true)
  })

  it('offline: the same writes go as queued items (the flag says so), and nothing is sent: the queue is not flushed', async () => {
    hooks.online = false
    const { container } = open(allLogged())
    await deleteSecond(container)
    expect(hooks.deleteLog).toHaveBeenCalledTimes(1) // `useDeleteSetLog` queues it offline: the screen calls it either way
    expect(hooks.writeChanges).toHaveBeenCalledWith(expect.objectContaining({ online: false }))
    expect(hooks.queuePatch).toHaveBeenCalledTimes(4)
    expect(hooks.flush).not.toHaveBeenCalled()
  })

  it('the edit panel\'s SAVE sends `useUpdateSetLog` the patch, as it did; offline it says "Requires a connection" and sends nothing', async () => {
    const { container, unmount } = open(allLogged())
    fireEvent.click(within(rowOf(container, 'set:lat-2')).getByLabelText('Edit set'))
    fireEvent.change(within(rowOf(container, 'set:lat-2')).getByLabelText('Reps'), { target: { value: '10' } })
    fireEvent.click(within(rowOf(container, 'set:lat-2')).getByText('SAVE'))
    expect(hooks.updateMutate.mock.calls).toEqual([[{ id: 'l-lat-2', changes: { weight: 55, reps: 10, rir: 2, formRating: null } }]])
    unmount()
    hooks.updateMutate.mockClear()
    hooks.online = false
    const offline = open(allLogged())
    fireEvent.click(within(rowOf(offline.container, 'set:lat-2')).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(offline.container, 'set:lat-2')).getByText('SAVE'))
    expect(hooks.updateMutate).not.toHaveBeenCalled()
    expect(within(rowOf(offline.container, 'set:lat-2')).getByText('Requires a connection')).toBeTruthy()
  })

  it('the last drop of a logged head: the head\'s stage kind is cleared through `useUpdateSetLog` (a patch of `stageKind` and nothing else), after the drop\'s own log', async () => {
    const onlyDrop = [...logs()]
    const { container } = open(onlyDrop)
    fireEvent.click(within(rowOf(container, 'set:lat-3:stage:1')).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(container, 'set:lat-3:stage:1')).getByText('DELETE'))
    await press(within(screen.getByRole('alertdialog')).getByText('DELETE SET'))
    expect(hooks.deleteLog.mock.calls).toEqual([[{ id: 'l-lat-3-d1', parentSetId: 'l-lat-3' }]])
    expect(hooks.updateAsync.mock.calls).toEqual([[{ id: 'l-lat-3', changes: { stageKind: null } }]])
    expect(hooks.writeChanges).toHaveBeenCalledWith(expect.objectContaining({ writes: [{ change: { kind: 'retyped', weekPlanSetId: 'lat-3', type: { kind: 'normal' } }, id: null }] }))
    expect(hooks.updateSet).not.toHaveBeenCalled()
  })

  it('offline that same delete writes nothing: no log, no row, no head patch', async () => {
    hooks.online = false
    const { container } = open(logs())
    fireEvent.click(within(rowOf(container, 'set:lat-3:stage:1')).getByLabelText('Edit set'))
    fireEvent.click(within(rowOf(container, 'set:lat-3:stage:1')).getByText('DELETE'))
    await press(within(screen.getByRole('alertdialog')).getByText('DELETE SET'))
    expect(hooks.deleteLog).not.toHaveBeenCalled()
    expect(hooks.updateAsync).not.toHaveBeenCalled()
    expect(hooks.writeChanges).not.toHaveBeenCalled()
    expect(within(screen.getByRole('alertdialog')).getByText('Requires a connection')).toBeTruthy()
  })
})

describe('CUES (board W7 → 8): the planned set\'s tags in this week\'s plan, through the service Plan uses, and nothing else', () => {
  const week3 = (): WeekPlan => ({ ...plan(), id: 'wp-w3', weekNumber: 3, sets: plan().sets.map((s) => ({ ...s, id: `${s.id}-w3`, weekPlanId: 'wp-w3', parentWeekPlanSetId: s.parentWeekPlanSetId === null ? null : `${s.parentWeekPlanSetId}-w3` })) })
  const openCues = (container: HTMLElement, key: string) => {
    fireEvent.click(within(rowOf(container, key)).getByLabelText('Set options'))
    fireEvent.click(within(screen.getByRole('dialog')).getByText('CUES').closest('button') as HTMLButtonElement)
  }
  const sheets = () => screen.getAllByRole('dialog')
  const tick = (label: string) => fireEvent.click(within(sheets()[sheets().length - 1]).getByText(label).closest('[role="checkbox"]') as HTMLElement)
  const done = () => press(within(sheets()[sheets().length - 1]).getByText('DONE'))

  it('a cue ticked and DONE writes `{ tags }` to this week\'s row of that set, once, with the cue it had kept and the new one after it', async () => {
    hooks.allPlans = [plan(), week3()]
    const { container } = open()
    openCues(container, 'set:lat-4')
    expect(sheets().length).toBe(2) // the cues sheet stacks on the ⋯ sheet
    tick('Focus on execution')
    await done()
    expect(hooks.updateSet.mock.calls).toEqual([['lat-4', { tags: ['focus on execution'] }]])
    expect(hooks.updateAsync).not.toHaveBeenCalled() // the log is not written
    expect(hooks.updateMutate).not.toHaveBeenCalled()
    expect(hooks.writeChanges).not.toHaveBeenCalled() // and no change row: a cue is the plan's, never the session's
  })

  it('the sheet names the period as the run does: WEEK 2 on a weekday run, CYCLE 2 on a sequence run', () => {
    hooks.allPlans = [plan(), week3()]
    const weekday = open()
    openCues(weekday.container, 'set:lat-4')
    expect(sheets()[1].textContent).toContain('SET 04 · WEEK 2')
    expect(sheets()[1].textContent).not.toContain('CYCLE')
    cleanup()
    scheduleType = 'sequence'
    const sequence = open()
    openCues(sequence.container, 'set:lat-4')
    expect(sheets()[1].textContent).toContain('SET 04 · CYCLE 2')
    expect(sheets()[1].textContent).not.toContain('WEEK 2')
  })

  it('shows the set\'s own cue ticked in the row ("Push here") and writes only the difference: untick it and the tags go to null', async () => {
    hooks.allPlans = [plan(), week3()]
    const { container } = open(logs().slice(0, 2))
    fireEvent.click(within(rowOf(container, 'set:lat-3')).getByLabelText('Set options'))
    expect(within(screen.getByRole('dialog')).getByText('Push here')).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByText('CUES').closest('button') as HTMLButtonElement)
    tick('Push here')
    await done()
    expect(hooks.updateSet.mock.calls).toEqual([['lat-3', { tags: null }]])
  })

  it('"Use for all" adds the cue to every working head of the exercise this workout still has, never to a warmup, a drop, another exercise or another week', async () => {
    hooks.allPlans = [plan(), week3()]
    const { container } = open(logs(), [deleted('chg-1', 'lat-5')])
    openCues(container, 'set:lat-4')
    tick('Maintain strength')
    fireEvent.click(within(sheets()[1]).getByRole('checkbox', { name: /^Use for all/ }))
    expect(within(sheets()[1]).getByRole('checkbox', { name: 'Use for all 4 sets of Lat Pulldown' })).toBeTruthy() // 05 is deleted: not counted
    await done()
    const written = hooks.updateSet.mock.calls.map(([id, changes]) => [id, changes.tags])
    expect(written).toEqual([
      ['lat-4', ['maintain strength']],
      ['lat-1', ['maintain strength']],
      ['lat-2', ['maintain strength']],
      ['lat-3', ['push here', 'maintain strength']],
    ])
    for (const [id] of written) expect(String(id)).not.toMatch(/-w3$|^ez-|-d1$|^lat-5$/)
  })

  it('the new tags are in both plan caches at once (the screen draws from either) and both are read again; a refused write puts them back', async () => {
    const week = plan()
    queryClient.setQueryData(['v2_weekPlans', 'm1', 2], [week])
    queryClient.setQueryData(['v2_allWeekPlans', 'm1'], [week, week3()])
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined)
    hooks.updateSet.mockRejectedValueOnce(new Error('permission denied'))
    const { container } = open()
    openCues(container, 'set:lat-4')
    tick('Maintain strength')
    await done()
    const tagsOf = (key: readonly unknown[], id: string) => (queryClient.getQueryData(key) as WeekPlan[]).flatMap((w) => w.sets).find((s) => s.id === id)?.tags
    // refused: both caches hold what they held, and the person is told why
    expect(tagsOf(['v2_weekPlans', 'm1', 2], 'lat-4')).toBeUndefined()
    expect(tagsOf(['v2_allWeekPlans', 'm1'], 'lat-4')).toBeUndefined()
    expect(invalidate.mock.calls.map(([filter]) => (filter as { queryKey: unknown[] }).queryKey)).toEqual([['v2_weekPlans', 'm1'], ['v2_allWeekPlans', 'm1']])
    expect(useToastStore.getState().message).toBe("Couldn't save the cue. permission denied")
    cleanup()
    useToastStore.getState().clear()
    // accepted: both hold the new tags before the write is answered
    let answer!: () => void
    hooks.updateSet.mockImplementationOnce(() => new Promise<void>((resolve) => void (answer = resolve)))
    const second = open()
    openCues(second.container, 'set:lat-4')
    tick('Maintain strength')
    await done()
    expect(tagsOf(['v2_weekPlans', 'm1', 2], 'lat-4')).toEqual(['maintain strength'])
    expect(tagsOf(['v2_allWeekPlans', 'm1'], 'lat-4')).toEqual(['maintain strength'])
    expect(tagsOf(['v2_allWeekPlans', 'm1'], 'lat-4-w3')).toBeUndefined() // next week's row is not the set
    await act(async () => answer())
    invalidate.mockRestore()
  })
})
