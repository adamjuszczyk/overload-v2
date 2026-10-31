// @vitest-environment jsdom
// DECISIONS 239, at the workout screen (RC37 of the release checklist, executed on staging: "an added set logged offline whose sends failed read as not logged (empty boxes, LOG, the
// current set) until RETRY, also after a reload", and LOG on it wrote the set a second time). Everything between the screen and the server is the real thing here except the two
// network edges: `GymSession` and its rows, the real `useActiveSession` / `readActiveSession` (the query function the screen reads its session with), the real `useLogSet`,
// `flushSyncQueue` and queue code, the app's own `queryClient`. Mocked: the device's database (an in-memory queue that applies a write on a later tick and returns copies, chunk 57's
// fakes), the server's read of the session (`fetchSession`: the rows the server holds) and the Supabase client's writes (an upsert that fails as many times as the test says).
//
// The state each test starts from is what an offline LOG leaves: the log is queued on the phone (its id pending, SYNC) and not on the server. The phone is online again, and the
// pass that sends it fails once with the session's reads going through.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { versionCheckAnswers } from '../release/versionGate.testutil'
import { render, cleanup, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog } from '../../types'

afterEach(() => cleanup())

const workoutDay: WorkoutDay = { id: 'wd-1', programId: 'prog-1', userId: 'user-1', name: 'Push Day', position: 0, exercises: [] }
const exercise = (id: string, name: string) => ({
  id, userId: 'user-1', name, muscleGroup: 'chest' as const, isArchived: false, createdAt: '2026-01-01T00:00:00Z',
  muscleSubgroups: null, movementPattern: null, status: 'active' as const, sourceLibraryId: null, lostAt: null,
})
const pe1: ProgramExercise = { id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null, exercise: exercise('ex-1', 'Bench Press') }
const planSet = (n: number) => ({
  id: `set-${n}`, weekPlanId: 'wp-1', userId: 'user-1', programExerciseId: 'pe-1', setNumber: n, targetRir: 2, targetWeight: 60, repMin: 8, repMax: 8,
  isDropset: false, parentWeekPlanSetId: null, stageIndex: 0, isWarmup: false,
})
const weekPlan: WeekPlan = {
  id: 'wp-1', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 1, isDeload: false, notes: null,
  sets: [1, 2, 3].map(planSet) as WeekPlan['sets'], exercises: [pe1], createdAt: '2026-01-01T00:00:00Z',
}
const sessionRow = {
  id: 'session-1', userId: 'user-1', mesocycleId: 'meso-1', weekPlanId: 'wp-1', weekPlan: undefined, workoutDayId: 'wd-1', workoutDay: undefined,
  date: '2026-01-05', status: 'in_progress' as const, note: null, startedAt: '2026-01-05T10:00:00Z', completedAt: null,
  createdAt: '2026-01-05T10:00:00Z', energyRating: null, pumpRating: null,
}

// ─── The server, the device's database and the Supabase client's writes ────────────────────────────────────────────────────────────
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
type DbRow = Record<string, unknown>
let queue: QueueItem[] = []
let nextQueueId = 1
let serverLogs: SetLog[] = []
let upsertsToFail = 0 // how many more upserts the server fails (a network error)
const requests: string[] = []
let readsInFlight = 0
let sessionReads = 0
const ioTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A row of `v2_set_logs` as the server keeps it, as the app maps it. */
const toLog = (row: DbRow): SetLog => ({
  id: row.id as string, userId: 'user-1', sessionId: row.session_id as string, exerciseId: row.exercise_id as string, exercise: exercise('ex-1', 'Bench Press'),
  weekPlanSetId: (row.week_plan_set_id as string | null) ?? null, setNumber: row.set_number as number, weight: (row.weight as number | null) ?? null, reps: (row.reps as number | null) ?? null,
  rir: (row.rir as number | null) ?? null, note: null, isDropset: false, parentSetId: null, stageIndex: 0, isWarmup: false, setSeconds: null, enteredUnit: null,
  isSkipped: (row.is_skipped as boolean | undefined) ?? false, loggedAt: row.logged_at as string, restSeconds: null, formRating: null, stageKind: null, addedPlace: null,
})
const loggedRow = (n: number, at: string): DbRow => ({
  id: `log-${n}`, user_id: 'user-1', session_id: 'session-1', exercise_id: 'ex-1', week_plan_set_id: `set-${n}`, set_number: n, weight: 60, reps: 8, rir: null, note: null,
  is_dropset: false, parent_set_id: null, stage_index: 0, is_skipped: false, logged_at: at, rest_seconds: null, set_seconds: null, entered_unit: null, form_rating: null,
  stage_kind: null, is_warmup: false,
})

vi.mock('../../lib/db', () => ({
  db: {
    sync_queue: {
      orderBy: () => ({ toArray: async () => structuredClone([...queue].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id)) }),
      toArray: async () => structuredClone(queue),
      add: async (item: Omit<QueueItem, 'id'>) => {
        await ioTick()
        queue.push({ ...structuredClone(item), id: nextQueueId++ })
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
    set_logs: { put: async () => { await ioTick() }, update: async () => { await ioTick(); return 1 }, delete: async () => { await ioTick() } },
  },
}))
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      // the flush sends the queued log
      upsert: async (row: DbRow) => {
        await ioTick()
        if (upsertsToFail > 0) {
          upsertsToFail -= 1
          requests.push(`upsert ${table}:${row.id as string} -> network error`)
          return { error: { message: 'Failed to fetch' } }
        }
        requests.push(`upsert ${table}:${row.id as string} -> ok`)
        serverLogs = [...serverLogs.filter((l) => l.id !== row.id), toLog(row)]
        return { error: null }
      },
      // LOG, online (`logSet`)
      insert: (row: DbRow) => ({
        select: () => ({
          single: async () => {
            await ioTick()
            requests.push(`insert ${table}:${row.id as string} (planned set ${String(row.week_plan_set_id)}) -> ok`)
            serverLogs = [...serverLogs, toLog(row)]
            return { data: { ...row, exercises: null }, error: null }
          },
        }),
      }),
    }),
  },
}))
// The server's read of the session: the rows it holds (the app's `fetchSession` is what `readActiveSession` calls; the merge of the queue is the app's own).
vi.mock('./sessionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sessionService')>()),
  fetchSession: async (): Promise<Session> => {
    sessionReads += 1
    readsInFlight += 1
    const rows = serverLogs.map((l) => ({ ...l }))
    await ioTick() // the network
    readsInFlight -= 1
    return { ...sessionRow, setLogs: rows }
  },
}))

// ─── The screen's own dependencies, as GymSession.numberCorrections.refetch.test.tsx has them, with the real session hooks ─────────────
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
vi.mock('./useSession', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useSession')>()), // the real useActiveSession, useLogSet, useUpdateSetLog, useDeleteSetLog
  useLastSessionLogs: () => ({ data: [], isLoading: false }),
  useExerciseReferenceSessions: () => ({ data: new Map(), isLoading: false, isError: false, isFromCache: false, retry: vi.fn() }),
  useSessionSwaps: () => ({ data: [] }),
  useRecordExerciseSwap: () => ({ mutate: vi.fn() }),
}))

const { default: GymSession } = await import('./GymSession')
const { queryClient } = await import('../../lib/queryClient')
const { flushSyncQueue } = await import('../offline/useSyncQueue')
const { useOfflineStore } = await import('../offline/offlineStore')

const screen = () => (
  <QueryClientProvider client={queryClient}>
    <MemoryRouter>
      <GymSession sessionId="session-1" workoutDay={workoutDay} weekPlan={weekPlan} weekNumber={1} today="2026-01-05" />
    </MemoryRouter>
  </QueryClientProvider>
)
const tick = (ms = 5) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
/** Lets the screen react to everything on its way (reads answer, the queue's writes land, effects run) until requests, queue items and reads have not changed for 15 ticks. */
async function quiet() {
  let last = ''
  let still = 0
  for (let i = 0; i < 200 && still < 15; i += 1) {
    await tick()
    const now = `${requests.length}|${JSON.stringify(queue.map((q) => [q.id, q.attempts]))}|${sessionReads}|${serverLogs.length}`
    still = now === last && readsInFlight === 0 ? still + 1 : 0
    last = now
  }
}
const pass = () => act(async () => { await flushSyncQueue() })
/** What the screen draws: how many rows are logged, which row is the current set (with a LOG button), how many other open rows, the SYNC marks. */
function drawn() {
  const rows = (state: string) => [...document.querySelectorAll(`[data-row-state="${state}"]`)]
  return {
    logged: rows('logged').length,
    current: document.querySelectorAll('[data-current-set]').length,
    upcoming: rows('upcoming').length,
    sync: [...document.querySelectorAll('[data-row-state="logged"]')].filter((r) => r.textContent?.includes('SYNC')).length,
  }
}
const currentRow = () => document.querySelector('[data-current-set]') as HTMLElement

beforeEach(() => {
  requests.length = 0
  sessionReads = 0
  readsInFlight = 0
  upsertsToFail = 0
  nextQueueId = 1
  // Set 1 is on the server. Set 2 was logged offline: its upsert is queued on this phone, its id is pending (SYNC), and the server has never seen it.
  serverLogs = [toLog(loggedRow(1, '2026-01-05T10:05:00Z'))]
  queue = [{ id: nextQueueId++, table: 'v2_set_logs', operation: 'upsert', payload: loggedRow(2, '2026-01-05T10:10:00Z'), createdAt: '2026-01-05T10:10:00.000Z' }]
  queryClient.clear()
  versionCheckAnswers() // the version check has answered: this version may send the queue (chunk 73)
  queryClient.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } })
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set(['log-2']) })
})

describe('a set logged offline whose first send failed is still a logged row on the workout screen (DECISIONS 239)', () => {
  it('after the pass that failed it and the read that follows: the row is logged and marked SYNC, the current set is the next one, and set 2 offers no LOG; after the next pass it has gone to the server once', async () => {
    upsertsToFail = 1 // the reconnect pass's first send of log-2 fails; the session's reads go through
    render(screen())
    await quiet()
    // the first draw (a reload with the log still queued): sets 1 and 2 logged, 2 marked SYNC, set 3 the current set
    expect(drawn()).toEqual({ logged: 2, current: 1, upcoming: 0, sync: 1 })

    const readsBefore = sessionReads
    await pass()
    await quiet()
    expect(requests).toEqual(['upsert v2_set_logs:log-2 -> network error'])
    expect(sessionReads).toBeGreaterThan(readsBefore) // the pass ended by reading the session again, from the server alone as far as the server goes
    expect(serverLogs.map((l) => l.id)).toEqual(['log-1']) // the server does not have log-2
    expect(queue.map((q) => [q.payload.id, q.attempts])).toEqual([['log-2', 1]])
    expect(drawn()).toEqual({ logged: 2, current: 1, upcoming: 0, sync: 1 }) // and the screen still draws it as a logged set

    await pass() // the next pass sends it
    await quiet()
    expect(requests).toEqual(['upsert v2_set_logs:log-2 -> network error', 'upsert v2_set_logs:log-2 -> ok'])
    expect(serverLogs.map((l) => l.id)).toEqual(['log-1', 'log-2'])
    expect(queue).toEqual([])
    expect(drawn()).toEqual({ logged: 2, current: 1, upcoming: 0, sync: 0 }) // SYNC gone, still two logged rows
  })

  it('LOG pressed after the failed pass logs the NEXT set, once: the server ends with one log per set (the old read drew set 2 open again and LOG wrote it a second time)', async () => {
    upsertsToFail = 1
    render(screen())
    await quiet()
    await pass()
    await quiet()
    const lastRead = sessionReads
    // the current set is set 3: its LOG writes the plan's targets (60 x 8) for planned set 3
    fireEvent.click(within(currentRow()).getByRole('button', { name: /^LOG$/ }))
    await quiet()
    expect(sessionReads).toBeGreaterThan(lastRead)
    await pass() // the queued log goes now
    await quiet()
    expect(requests.filter((r) => r.startsWith('insert'))).toEqual(['insert v2_set_logs:' + (serverLogs.find((l) => l.weekPlanSetId === 'set-3')?.id ?? '?') + ' (planned set set-3) -> ok'])
    const perSet = serverLogs.map((l) => l.weekPlanSetId).sort()
    expect(perSet).toEqual(['set-1', 'set-2', 'set-3']) // one log for each planned set; set 2 not twice
    expect(queue).toEqual([])
    expect(drawn().logged).toBe(3)
  })
})
