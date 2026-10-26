// @vitest-environment jsdom
// Chunk 64 — auto-finish follows the finish warning's view (DECISIONS 166 (a); 201 (a): "auto-finish can complete the session with it open"; TASKS 64: "61's auto-finish waits for the
// same view"). The REAL `useAutoFinishSession` runs inside GymSession over a swap's moved sets, as `GymSession.autoFinish.test.tsx` runs it over the plain cases (the hook's own rules,
// the threshold and the grace window, are `useAutoFinishSession.test.tsx`'s): a planned set a swap moved and left open holds the session, a set moved from an added set does not
// ("a set added in the session and never logged doesn't hold it, as today"), and the same session with the moved sets logged finishes (the harness's control).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { Session, SessionSetChangeRecord, SetLog } from '../../types'
import type { ExerciseSwap } from './sessionService'
import type { AddedSet } from './workoutRules'
import { useSettingsStore, DEFAULT_SETTINGS } from '../settings/settingsStore'
import { EZ_DONE, LAT_1_2, NORMAL, deletedChange, log, skipped, swapRow, weekPlan, workoutDay } from './finishWorld.testutil'

const complete = vi.hoisted(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, error: null as unknown }))
const phone = vi.hoisted(() => ({ world: { drafts: new Map(), lists: null, log: [] } as import('./draftStore.testutil').DraftWorld }))

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../offline/offlineCache', () => ({ primeOfflineCache: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../coach/coachGate', () => ({ isCoachUser: () => false }))
vi.mock('./useSessionDuration', () => ({ useSessionDuration: () => 0 }))
vi.mock('./WorkoutSidebarSheet', () => ({ default: () => null }))
vi.mock('./WarmupRoutineChecklist', () => ({ default: () => null }))
vi.mock('../offline/SyncFailedNotice', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({ useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }) }))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('../offline/useSyncQueue', () => ({ queueSetLogPatch: vi.fn().mockResolvedValue(false), flushSyncQueue: vi.fn() }))
vi.mock('./sessionDrafts', async (importOriginal) => {
  const { fakeDraftStore } = await import('./draftStore.testutil')
  return { ...(await importOriginal<typeof import('./sessionDrafts')>()), dexieDraftStore: () => fakeDraftStore(phone.world) }
})
vi.mock('./useSession', () => ({
  useActiveSession: () => ({ data: session }),
  useLogSet: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
  useUpdateSetLog: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useCompleteSession: () => complete,
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: swaps }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')

const MIN = 60_000
const START = new Date('2026-01-06T09:35:00Z').getTime() // the logs below are stamped 09:30
let session: Session
let swaps: ExerciseSwap[] = []

async function mount(logs: SetLog[], opts: { changes?: SessionSetChangeRecord[]; swaps: ExerciseSwap[]; lists?: Record<string, AddedSet[]> }) {
  swaps = opts.swaps
  phone.world.lists = opts.lists ?? null
  session = {
    id: 'session-1', userId: 'u1', mesocycleId: 'm1', weekPlanId: 'wp-1', workoutDayId: 'wd-1', date: '2026-01-06', status: 'in_progress', note: null, startedAt: '2026-01-06T09:10:00Z',
    completedAt: null, createdAt: '2026-01-06T09:10:00Z', setLogs: logs, setChanges: opts.changes ?? [], energyRating: null, pumpRating: null,
  }
  const view = render(
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan()} weekNumber={2} today="2026-01-06" />
    </MemoryRouter>,
  )
  // the phone's copy is read on a real tick (only the clock, the interval and its clear are faked)
  await act(async () => { for (let i = 0; i < 6; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
  return view
}
const advance = (minutes: number) => act(async () => void vi.advanceTimersByTime(minutes * MIN))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(START)
  complete.mutate.mockReset()
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, autoFinishMinutes: 10 })
  phone.world.drafts.clear()
  phone.world.lists = null
})
afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  await act(async () => { for (let i = 0; i < 4; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0)) })
})

const card = 'xe-lat:replacement'
const TWO_MOVED = [{ localId: 'm1', logId: null, type: NORMAL, place: 1 }, { localId: 'm2', logId: null, type: NORMAL, place: 2 }]
const PLANNED_MOVED = swapRow({ fromKey: 'xe-lat', moved: [{ from: { weekPlanSetId: 'lat-3' }, place: 1 }, { from: { weekPlanSetId: 'lat-4' }, place: 2 }] })
const SWAP_SKIPS = [skipped(log('s3', 'lat-3', 3, 'ex-lat')), skipped(log('s4', 'lat-4', 4, 'ex-lat'))]

describe('auto-finish and the sets a swap for today moved (DECISIONS 201 (a))', () => {
  it('the control: the moved sets logged on the new card, every other set logged, the session completes after the threshold', async () => {
    await mount([...EZ_DONE, ...LAT_1_2, ...SWAP_SKIPS, log('m-1', null, 3, 'ex-machine', { addedPlace: 1 }), log('m-2', null, 4, 'ex-machine', { addedPlace: 2 })], { swaps: [PLANNED_MOVED] })
    await advance(5)
    expect(complete.mutate).not.toHaveBeenCalled() // the grace window since the screen opened
    await advance(6)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
    expect(complete.mutate.mock.calls[0][0]).toEqual({ id: 'session-1', note: null })
  })

  it('the planned sets a swap moved are still open on the new card: it waits for them, for as long as they are (break: leave a moved planned set out of the finish warning)', async () => {
    await mount([...EZ_DONE, ...LAT_1_2, ...SWAP_SKIPS], { swaps: [PLANNED_MOVED], lists: { [card]: TWO_MOVED } })
    await advance(60)
    expect(complete.mutate).not.toHaveBeenCalled()
  })

  it('one of the two moved planned sets still open holds it too', async () => {
    await mount([...EZ_DONE, ...LAT_1_2, ...SWAP_SKIPS, log('m-1', null, 3, 'ex-machine', { addedPlace: 1 })], { swaps: [PLANNED_MOVED], lists: { [card]: TWO_MOVED } })
    await advance(60)
    expect(complete.mutate).not.toHaveBeenCalled()
  })

  it('a set moved from an ADDED set, open, does not hold it: "a set added in the session and never logged doesn\'t hold it, as today" (absence)', async () => {
    const swap = swapRow({ fromKey: 'xe-lat', moved: [{ from: { addedPlace: 1 }, place: 1 }] })
    // every planned set is logged; the added set on Lat Pulldown was moved (skipped there, with its place) and is open on Machine Pulldown
    await mount([...EZ_DONE, ...LAT_1_2, log('l-lat3', 'lat-3', 3, 'ex-lat'), log('l-lat4', 'lat-4', 4, 'ex-lat'), skipped(log('s-added', null, 5, 'ex-lat', { addedPlace: 1 }))], {
      swaps: [swap],
      lists: { [card]: [TWO_MOVED[0]] },
    })
    await advance(11)
    expect(complete.mutate).toHaveBeenCalledTimes(1)
  })

  it('a planned set deleted in the workout is out of it, a moved planned set open is in: the session waits for the moved one only', async () => {
    const swap = swapRow({ fromKey: 'xe-lat', moved: [{ from: { weekPlanSetId: 'lat-3' }, place: 1 }] })
    await mount([...EZ_DONE, ...LAT_1_2, skipped(log('s3', 'lat-3', 3, 'ex-lat'))], { changes: [deletedChange('lat-4')], swaps: [swap], lists: { [card]: [TWO_MOVED[0]] } })
    await advance(60)
    expect(complete.mutate).not.toHaveBeenCalled()
  })
})
