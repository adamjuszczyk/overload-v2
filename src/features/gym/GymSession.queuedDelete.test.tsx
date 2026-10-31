// @vitest-environment jsdom
// SPEC.md 1.2.1 Rules 6 [17] (DECISIONS 243, 269 (a)), at the workout screen: what an offline DELETE leaves in the read that follows a failed pass. The planned-set DELETE (RC31's and
// RC32's shapes) queues the deletion record of the planned set (a `v2_session_set_changes` upsert) and, for a set that was logged, the delete of its log; the server has neither until a
// pass sends them. With only the first two lines of Rules 6 the read drew the planned set as an OPEN row and LOG on it landed a log that the deletion record, once sent, hides from the
// workout, while History and Volume count it (`setDelete.ts`: that must never happen). The read now applies the queued deletion record too: the set stays gone and LOG is not offered on it.
// The third test is the UNLOG shape (DECISIONS 243, the second line of Rules 6): the log's delete is queued and no deletion record, so the set reads as open at once and LOG logs it once.
//
// Everything between the screen and the server is the real thing but the two network edges, as in `GymSession.queuedLog.test.tsx` (DECISIONS 239): `GymSession` and its rows, the real
// `useActiveSession` / `readActiveSession`, the real `useLogSet`, `flushSyncQueue`, `queueSetChange` and `queueSetLogDelete`, the app's own `queryClient`. Mocked: the device's database (an
// in-memory queue that applies a write on a later tick and returns copies, chunk 57's fakes), the server's read of the session (`fetchSession`: the logs and the change rows it holds) and the
// Supabase client's writes. The phone is online again and the pass that sends the offline writes fails once, with the session's reads going through.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { versionCheckAnswers } from '../release/versionGate.testutil'
import { render, cleanup, act, fireEvent, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ProgramExercise, WeekPlan, WorkoutDay, Session, SetLog } from '../../types'
import type { DbSessionSetChange } from './sessionSetChangesService'

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
let serverChanges: DbRow[] = [] // the change rows the server holds
let upsertsToFail = 0 // how many more upserts the server fails (a network error)
let deletesToFail = 0 // how many more deletes it fails
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
      // the flush sends the queued writes
      upsert: async (row: DbRow) => {
        await ioTick()
        if (upsertsToFail > 0) {
          upsertsToFail -= 1
          requests.push(`upsert ${table}:${row.id as string} -> network error`)
          return { error: { message: 'Failed to fetch' } }
        }
        requests.push(`upsert ${table}:${row.id as string} -> ok`)
        if (table === 'v2_session_set_changes') serverChanges = [...serverChanges.filter((c) => c.id !== row.id), { ...row }]
        else serverLogs = [...serverLogs.filter((l) => l.id !== row.id), toLog(row)]
        return { error: null }
      },
      // an UNLOG or DELETE sent from the queue: `delete().eq('id', id)`
      delete: () => ({
        eq: async (_column: string, id: string) => {
          await ioTick()
          if (deletesToFail > 0) {
            deletesToFail -= 1
            requests.push(`delete ${table}:${id} -> network error`)
            return { error: { message: 'Failed to fetch' } }
          }
          requests.push(`delete ${table}:${id} -> ok`)
          serverLogs = serverLogs.filter((l) => l.id !== id)
          return { error: null }
        },
      }),
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
    return { ...sessionRow, setLogs: rows, setChanges: toSessionSetChangeRecords(serverChanges as unknown as DbSessionSetChange[]) }
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
const { flushSyncQueue, queueSetLogDelete } = await import('../offline/useSyncQueue')
const { queueSetChange } = await import('./useSessionSetChanges')
const { changeRow, toSessionSetChangeRecords } = await import('./sessionSetChangesService')
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
  deletesToFail = 0
  nextQueueId = 1
  serverLogs = [toLog(loggedRow(1, '2026-01-05T10:05:00Z'))] // set 1 is logged and on the server
  serverChanges = []
  queue = []
  queryClient.clear()
  versionCheckAnswers() // the version check has answered: this version may send the queue (chunk 73)
  queryClient.setDefaultOptions({ queries: { retry: false, refetchOnWindowFocus: false } })
  useOfflineStore.setState({ syncFailures: [], failedIds: new Set(), pendingIds: new Set() })
})

/** The deletion record of a planned set, queued as the offline DELETE queues it (`writeSetChanges`' offline branch: `changeRow`, then `queueSetChange`). */
async function queueDeletionOf(planSetId: string) {
  const now = new Date().toISOString() // after the log's delete (`setDelete.ts`: the logs go first, then the change rows)
  await queueSetChange(changeRow({ change: { kind: 'deleted', weekPlanSetId: planSetId }, id: null }, { userId: 'user-1', sessionId: 'session-1', now }), now)
}
/** The planned set a LOG writes, from the insert request it makes. */
const loggedPlannedSets = () => requests.filter((r) => r.startsWith('insert')).map((r) => /\(planned set ([^)]+)\)/.exec(r)?.[1])

describe('a planned set deleted offline stays gone on the workout screen, and LOG cannot land on it (SPEC.md 1.2.1 Rules 6, third line; DECISIONS 269 (a))', () => {
  it('set 2 was open and deleted offline: its deletion record is queued and its first send fails; after the failed pass and the read that follows, set 2 is not drawn and LOG logs set 3; no log of set 2 reaches the server', async () => {
    await queueDeletionOf('set-2')
    upsertsToFail = 1 // the reconnect pass's first send of the deletion record fails; the session's reads go through
    render(screen())
    await quiet()
    // the first draw (a reload with the record still queued): set 1 logged, set 2 gone, set 3 the current set
    expect(drawn()).toEqual({ logged: 1, current: 1, upcoming: 0, sync: 0 })

    const readsBefore = sessionReads
    await pass()
    await quiet()
    expect(requests).toEqual([expect.stringMatching(/^upsert v2_session_set_changes:.* -> network error$/)])
    expect(sessionReads).toBeGreaterThan(readsBefore) // the pass ended by reading the session again, from the server alone as far as the server goes
    expect(serverChanges).toEqual([]) // the server does not have the record
    expect(queue.map((q) => [q.table, q.attempts])).toEqual([['v2_session_set_changes', 1]])
    expect(drawn()).toEqual({ logged: 1, current: 1, upcoming: 0, sync: 0 }) // and the screen still does not draw set 2

    fireEvent.click(within(currentRow()).getByRole('button', { name: /^LOG$/ }))
    await quiet()
    expect(loggedPlannedSets()).toEqual(['set-3']) // the current set is set 3: LOG was not offered on set 2
    await pass() // the next pass sends the record
    await quiet()
    expect(serverChanges.map((c) => [c.kind, c.week_plan_set_id])).toEqual([['deleted', 'set-2']])
    expect(serverLogs.map((l) => l.weekPlanSetId).sort()).toEqual(['set-1', 'set-3']) // nothing for set 2: History and Volume count none
    expect(queue).toEqual([])
    expect(drawn()).toEqual({ logged: 2, current: 0, upcoming: 0, sync: 0 })
  })

  it('set 2 was logged and deleted offline (its log\'s delete and the deletion record queued): after the failed pass the log is gone, set 2 is not drawn, LOG logs set 3, and the queue sends both', async () => {
    serverLogs = [toLog(loggedRow(1, '2026-01-05T10:05:00Z')), toLog(loggedRow(2, '2026-01-05T10:10:00Z'))]
    await queueSetLogDelete({ id: 'log-2', sessionId: 'session-1' })
    await queueDeletionOf('set-2')
    upsertsToFail = 1 // the deletion record's first send fails (the log's delete goes first and goes)
    render(screen())
    await quiet()
    expect(drawn()).toEqual({ logged: 1, current: 1, upcoming: 0, sync: 0 }) // set 1 logged, set 2 gone with its log, set 3 the current set

    await pass()
    await quiet()
    expect(requests).toEqual(['delete v2_set_logs:log-2 -> ok', expect.stringMatching(/^upsert v2_session_set_changes:.* -> network error$/)])
    expect(serverLogs.map((l) => l.id)).toEqual(['log-1']) // the server's log of set 2 is deleted
    expect(drawn()).toEqual({ logged: 1, current: 1, upcoming: 0, sync: 0 }) // the read after the pass: set 2 is not an open row

    fireEvent.click(within(currentRow()).getByRole('button', { name: /^LOG$/ }))
    await quiet()
    expect(loggedPlannedSets()).toEqual(['set-3'])
    await pass()
    await quiet()
    expect(serverChanges.map((c) => [c.kind, c.week_plan_set_id])).toEqual([['deleted', 'set-2']])
    expect(serverLogs.map((l) => l.weekPlanSetId).sort()).toEqual(['set-1', 'set-3'])
    expect(queue).toEqual([])
  })
  it('an UNLOG of set 2 offline (its log\'s delete queued, no deletion record): after the failed pass set 2 reads as open, not logged; LOG logs set 2 once, and the server ends with one log for it (DECISIONS 243)', async () => {
    serverLogs = [toLog(loggedRow(1, '2026-01-05T10:05:00Z')), toLog(loggedRow(2, '2026-01-05T10:10:00Z'))]
    await queueSetLogDelete({ id: 'log-2', sessionId: 'session-1' })
    deletesToFail = 1 // the reconnect pass's first send of the delete fails; the session's reads go through
    render(screen())
    await quiet()
    expect(drawn()).toEqual({ logged: 1, current: 1, upcoming: 1, sync: 0 }) // set 1 logged, set 2 open (the current set), set 3 open

    await pass()
    await quiet()
    expect(requests).toEqual(['delete v2_set_logs:log-2 -> network error'])
    expect(serverLogs.map((l) => l.id)).toEqual(['log-1', 'log-2']) // the server still holds the log it will delete
    expect(drawn()).toEqual({ logged: 1, current: 1, upcoming: 1, sync: 0 }) // and the read after the pass draws set 2 as not logged

    fireEvent.click(within(currentRow()).getByRole('button', { name: /^LOG$/ }))
    await quiet()
    expect(loggedPlannedSets()).toEqual(['set-2'])
    await pass() // the delete of the old log goes now
    await quiet()
    expect(serverLogs.map((l) => l.weekPlanSetId).sort()).toEqual(['set-1', 'set-2']) // one log for set 2
    expect(serverLogs.map((l) => l.id)).not.toContain('log-2')
    expect(queue).toEqual([])
    expect(drawn().logged).toBe(2)
  })
})
