// @vitest-environment jsdom
// Chunk 58a, fix-forward (review 1, finding 1) — the number correction when its PATCH can't reach the server while the phone reads as
// online. The review executed this on staging: the request failed, the queue's pass ended with `invalidateQueries(['v2_session'])`, the
// session was read again with the old number, the screen listed the same correction again and queued it again, and so on: 681 queue
// items for one log in about 70 s, and after the first gave up nothing was sent until RETRY.
//
// Everything between the screen and the server is the real thing here: `GymSession` and its number corrections, the real
// `queueSetLogPatch` / `flushSyncQueue` with their invalidation, the app's own `queryClient`, the real `useActiveSession` query key
// (`['v2_session', id]`, `staleTime: 0`) refetching from a fake server. The fakes are chunk 57's: the device's database applies a write
// on a later tick and returns copies, and the server keeps the row, fails the PATCH as many times as the test says, then takes it.
// (The queue's own rules: useSyncQueue.patch.test.ts; the screen's use of the hook with a spy: GymSession.numberCorrections.test.tsx.)
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider, useQuery } from '@tanstack/react-query'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => cleanup())

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const exercise = (id: string, name: string) => ({
  id, userId: 'user-1', name, muscleGroup: 'chest' as const, isArchived: false, createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null, movementPattern: null, status: 'active' as const, sourceLibraryId: null, lostAt: null,
})
const pe1: ProgramExercise = { id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null, exercise: exercise('ex-1', 'Bench Press') }
const planSet = (n: number) => ({
  id: `set-${n}`, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: n, targetRir: 2,
  isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
})
const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, isDeload: false, notes: null,
  sets: [1, 2, 3].map(planSet) as WeekPlan['sets'], exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
}
const log = (over: Partial<SetLog> & { id: string }): SetLog => ({
  userId: 'user-1', sessionId: 'session-1', exerciseId: 'ex-1', weekPlanSetId: null, setNumber: 1, weight: 60, reps: 8, rir: null, note: null,
  isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null, isSkipped: false,
  loggedAt: '2026-01-05T10:05:00Z', restSeconds: null, formRating: null, stageKind: null, addedPlace: null, ...over,
})
const head = (n: number) => log({ id: `log-${n}`, weekPlanSetId: `set-${n}`, setNumber: n })
const sessionRow = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
  date: '2026-01-05', status: 'in_progress' as const, note: null, startedAt: '2026-01-05T10:00:00Z', completedAt: null,
  createdAt: '2026-01-05T10:00:00Z', energyRating: null, pumpRating: null,
}

// ─── The server and the device's database (chunk 57's fakes) ─────────────────────────────────────────────────────────────────────
interface QueueItem {
  id: number
  table: string
  operation: 'upsert' | 'delete' | 'patch'
  payload: Record<string, unknown>
  createdAt: string
  attempts?: number
  gaveUp?: boolean
  sendStarted?: boolean
  sessionId?: string
  parentSetId?: string
}
let queue: QueueItem[] = []
let nextQueueId = 1
let serverLogs: SetLog[] = []
let patchesToFail = 0 // how many more PATCH requests the server fails
const patchRequests: Array<{ id: string; set_number: number; failed: boolean }> = []
let sessionReads = 0 // every read of the session from the server
let readsInFlight = 0
const ioTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({ toArray: async () => [...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id).map((q) => ({ ...q })) }),
      toArray: async () => queue.map((q) => ({ ...q })),
      add: async (item: Omit<QueueItem, 'id'>) => {
        await ioTick()
        queue.push({ ...item, id: nextQueueId++ })
      },
      delete: async (id: number) => {
        await ioTick()
        queue = queue.filter((q) => q.id !== id)
      },
      update: async (id: number, patch: Partial<QueueItem>) => {
        await ioTick()
        queue = queue.map((q) => (q.id === id ? { ...q, ...patch } : q))
      },
    },
    set_logs: { update: async () => { await ioTick(); return 1 }, delete: async () => { await ioTick() } },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: { set_number: number }) => ({
        eq: async (_column: string, id: string) => {
          await ioTick()
          if (patchesToFail > 0) {
            patchesToFail -= 1
            patchRequests.push({ id, set_number: patch.set_number, failed: true })
            return { error: { message: 'Failed to fetch' } }
          }
          patchRequests.push({ id, set_number: patch.set_number, failed: false })
          serverLogs = serverLogs.map((l) => (l.id === id ? { ...l, setNumber: patch.set_number } : l))
          return { error: null }
        },
      }),
    }),
  },
}))

// ─── The screen's own dependencies, as GymSession.numberCorrections.test.tsx has them, except the session query ─────────────────────
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
vi.mock('./SwapExerciseSheet', () => ({ default: () => null }))
vi.mock('../library/useExercises', () => ({ useExercises: () => ({ data: [] }) }))
vi.mock('../programs/usePrograms', () => ({
  useProgramExercises: () => ({ data: [] }), useSupersetBlockRests: () => ({ data: [] }), useWarmupRoutineItems: () => ({ data: [] }),
}))
vi.mock('../planner/usePlanner', () => ({ useProgramSets: () => ({ data: [] }) }))
vi.mock('./useSession', () => ({
  // The real hook's query: the same key (so the queue's `invalidateQueries(['v2_session'])` reaches it) and `staleTime: 0`; only the
  // read is the fake server's.
  useActiveSession: (sessionId: string) =>
    useQuery({
      queryKey: ['v2_session', sessionId],
      queryFn: async (): Promise<Session> => {
        sessionReads += 1
        readsInFlight += 1
        await ioTick() // the network
        readsInFlight -= 1
        return { ...sessionRow, setLogs: serverLogs.map((l) => ({ ...l })) }
      },
      staleTime: 0,
    }),
  useLogSet: () => ({ mutateAsync: () => Promise.resolve(log({ id: 'unused' })) }),
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useUpdateSetLog: () => ({ mutate: vi.fn() }),
  useDeleteSetLog: () => ({ mutateAsync: vi.fn() }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')
const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue, retrySyncFailures, MAX_SYNC_ATTEMPTS } = await import('../offline/useSyncQueue')
const { useOfflineStore } = await import('../offline/offlineStore')

const screen = () => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>
  </QueryClientProvider>
)
const tick = (ms = 5) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
/**
 * Lets the screen react to everything that is on its way (reads answer, the queue's writes land, effects run) until requests, queue
 * items, attempts and reads have not changed for 25 ticks. A loop never gets there: it runs out the 300 ticks, and the counts the
 * test then reads are the loop's.
 */
async function quiet() {
  let last = ''
  let still = 0
  for (let i = 0; i < 300 && still < 25; i += 1) {
    await tick()
    const now = `${patchRequests.length}|${JSON.stringify(queue.map((q) => [q.id, q.attempts, q.gaveUp]))}|${sessionReads}`
    still = now === last && readsInFlight === 0 ? still + 1 : 0
    last = now
  }
}
const patchItems = () => queue.filter((q) => q.operation === 'patch')
const pass = () => act(async () => { await flushSyncQueue() })

beforeEach(() => {
  queue = []
  nextQueueId = 1
  patchRequests.length = 0
  patchesToFail = 0
  sessionReads = 0
  readsInFlight = 0
  // DECISIONS 178's own case: bench 01–03 logged, two sets added and logged as 04 and 05, the first unlogged and the session finished
  // and continued. The second is the fourth set now; its log still holds 5.
  serverLogs = [head(1), head(2), head(3), log({ id: 'log-b', setNumber: 5, addedPlace: 2 })]
  queryClient.clear()
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
})

// A loop never settles (`quiet()` runs out its ticks), so under the break these tests must reach their assertions, not the 5 s default.
describe('a number correction whose PATCH keeps failing while the phone is online (review 1, finding 1)', { timeout: 60_000 }, () => {
  it('leaves one queue item over any number of passes and refetches, goes out when the server answers, and the queue is empty and the server holds the number', async () => {
    patchesToFail = 3
    render(screen())
    await quiet()
    // the first draw queued the correction once and sent it; the request failed, the session was read again with the old number, and
    // the screen listed the same correction again: that is not a second item, and not another request
    expect(patchRequests).toEqual([{ id: 'log-b', set_number: 4, failed: true }])
    expect(patchItems()).toHaveLength(1)
    expect(patchItems()[0]).toMatchObject({ payload: { id: 'log-b', set_number: 4 }, attempts: 1 })
    expect(sessionReads).toBeGreaterThanOrEqual(2) // the refetch after the failed pass did bring the old number back
    expect(serverLogs.find((l) => l.id === 'log-b')?.setNumber).toBe(5)

    // more passes while it keeps failing (the next LOG's flush, the app coming back, a reconnect): each is one request and one refetch
    await pass()
    await quiet()
    expect(patchRequests).toHaveLength(2)
    expect(patchItems()).toHaveLength(1)
    await pass()
    await quiet()
    expect(patchRequests).toHaveLength(3)
    expect(patchItems()).toHaveLength(1)
    expect(patchItems()[0]).toMatchObject({ attempts: 3 })

    // the server answers: the one item goes out, the queue is empty, the server holds the number, and nothing is listed any more
    await pass()
    await quiet()
    expect(patchRequests.map((r) => r.failed)).toEqual([true, true, true, false])
    expect(queue).toEqual([])
    expect(serverLogs.find((l) => l.id === 'log-b')?.setNumber).toBe(4)
    const reads = sessionReads
    await quiet()
    expect(patchRequests).toHaveLength(4)
    expect(queue).toEqual([])
    expect(sessionReads).toBe(reads) // no loop of reads either
  })

  it('once its patch is on the server the correction is written again if the stored number changes again (another phone): a draw is a new draw when the queue no longer holds it', async () => {
    render(screen())
    await quiet()
    expect(patchRequests).toEqual([{ id: 'log-b', set_number: 4, failed: false }])
    expect(queue).toEqual([])
    serverLogs = serverLogs.map((l) => (l.id === 'log-b' ? { ...l, setNumber: 5 } : l)) // the other phone puts 5 back
    await act(async () => { await queryClient.invalidateQueries({ queryKey: ['v2_session'] }) })
    await quiet()
    expect(patchRequests.map((r) => [r.set_number, r.failed])).toEqual([[4, false], [4, false]])
    expect(queue).toEqual([])
    expect(serverLogs.find((l) => l.id === 'log-b')?.setNumber).toBe(4)
  })

  it('after the item gives up nothing is queued or sent again however often the session is read; RETRY sends the same one item', async () => {
    patchesToFail = MAX_SYNC_ATTEMPTS
    render(screen())
    await quiet()
    for (let again = 1; again < MAX_SYNC_ATTEMPTS; again += 1) {
      await pass()
      await quiet()
    }
    expect(patchRequests).toHaveLength(MAX_SYNC_ATTEMPTS)
    expect(patchItems()).toHaveLength(1)
    expect(patchItems()[0]).toMatchObject({ attempts: MAX_SYNC_ATTEMPTS, gaveUp: true })

    // it has given up: further passes and refetches send nothing and add nothing (the item holds its log until RETRY)
    await pass()
    await queryClient.invalidateQueries({ queryKey: ['v2_session'] })
    await quiet()
    expect(patchRequests).toHaveLength(MAX_SYNC_ATTEMPTS)
    expect(patchItems()).toHaveLength(1)

    await act(async () => { await retrySyncFailures() })
    await quiet()
    expect(patchRequests).toHaveLength(MAX_SYNC_ATTEMPTS + 1)
    expect(patchRequests[MAX_SYNC_ATTEMPTS].failed).toBe(false)
    expect(queue).toEqual([])
    expect(serverLogs.find((l) => l.id === 'log-b')?.setNumber).toBe(4)
  })
})
