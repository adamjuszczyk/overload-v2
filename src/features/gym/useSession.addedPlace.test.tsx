// @vitest-environment jsdom
//
// Chunk 46 (TASKS-1.2: the column is read "in its mappers (`toSetLog`, the Dexie `set_logs` cache)"; DECISIONS 174): the
// three places in useSession.ts that map between a `SetLog` and Dexie's cached row carry `addedPlace` both ways: the cache
// write of the last session's logs, and the two offline reads back (the last session's logs, the reference panel's
// sessions). A place is kept; null and a row cached before this shipped (no key) read as null. The LOG write's own Dexie row
// is chunk 58a's and is not here.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SetLog } from '../../types'

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => false }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../lib/supabase', () => ({ supabase: { from: (...args: unknown[]) => void args } }))

const fetched: { last: SetLog[] | Error } = { last: [] }
vi.mock('./sessionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./sessionService')>()),
  fetchLastSessionLogs: async () => {
    if (fetched.last instanceof Error) throw fetched.last
    return fetched.last
  },
  fetchReferenceSessionsByExercise: async () => {
    throw new Error('offline')
  },
}))

const written: Array<Record<string, unknown>> = []
const cachedLogs: Array<Record<string, unknown>> = []
const cachedSessions = [{ id: 'done1', userId: 'u1', date: '2026-10-05', status: 'completed', mesocycleId: 'm1', weekPlanId: 'wp0', workoutDayId: 'wd1', completedAt: '2026-10-05T19:00:00Z' }]
vi.mock('../../lib/db', () => ({
  db: {
    set_logs: {
      put: async (row: Record<string, unknown>) => void written.push(row),
      where: () => ({
        equals: () => ({ sortBy: async () => [...cachedLogs] }),
        anyOf: () => ({ toArray: async () => [...cachedLogs] }),
      }),
    },
    sessions: { where: () => ({ equals: () => ({ toArray: async () => cachedSessions }) }) },
  },
}))

const { useLastSessionLogs, useExerciseReferenceSessions } = await import('./useSession')

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const setLog = (id: string, extra: Partial<SetLog>): SetLog => ({
  id,
  userId: 'u1',
  sessionId: 'done1',
  exerciseId: 'ex.bench',
  weekPlanSetId: null,
  setNumber: 4,
  weight: 50,
  reps: 10,
  rir: 2,
  note: null,
  isDropset: false,
  parentSetId: null,
  stageIndex: 0,
  isWarmup: false,
  setSeconds: null,
  enteredUnit: null,
  isSkipped: false,
  loggedAt: '2026-10-05T18:00:00Z',
  restSeconds: null,
  formRating: null,
  stageKind: null,
  ...extra,
})

/** A cached row as Dexie holds it; `place` undefined: a row cached before chunk 46 (no key). */
const cachedRow = (id: string, setNumber: number, place?: number | null) => ({
  id,
  sessionId: 'done1',
  exerciseId: 'ex.bench',
  weekPlanSetId: null,
  setNumber,
  weight: 50,
  reps: 10,
  rir: 2,
  note: null,
  isDropset: false,
  parentSetId: null,
  stageIndex: 0,
  isWarmup: false,
  setSeconds: null,
  enteredUnit: null,
  isSkipped: false,
  loggedAt: `2026-10-05T18:0${setNumber}:00Z`,
  restSeconds: null,
  sessionStatus: 'completed',
  formRating: null,
  stageKind: null,
  ...(place === undefined ? {} : { addedPlace: place }),
})

afterEach(() => {
  written.length = 0
  cachedLogs.length = 0
  fetched.last = []
})

describe('useSession.ts carries addedPlace through the Dexie set_logs cache (DECISIONS 174)', () => {
  it('the cache write of the last session\'s logs: a place is kept, null and a log without the key are cached as null', async () => {
    const without = setLog('l3', { setNumber: 6 })
    delete without.addedPlace
    fetched.last = [setLog('l1', { addedPlace: 2 }), setLog('l2', { addedPlace: null, setNumber: 5 }), without]
    const { result } = renderHook(() => useLastSessionLogs('ex.bench', 's-now'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(written.map((r) => [r.id, r.addedPlace])).toEqual([
      ['l1', 2],
      ['l2', null],
      ['l3', null],
    ])
  })

  it('the offline read of the last session\'s logs: a place is kept, a row cached without the key reads null', async () => {
    fetched.last = new Error('offline')
    cachedLogs.push(cachedRow('c1', 4, 3), cachedRow('c2', 5, null), cachedRow('c3', 6))
    const { result } = renderHook(() => useLastSessionLogs('ex.bench', 's-now'), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.map((l) => [l.id, l.addedPlace])).toEqual([
      ['c1', 3],
      ['c2', null],
      ['c3', null],
    ])
  })

  it('the offline read behind the reference panel: the same', async () => {
    cachedLogs.push(cachedRow('c1', 4, 3), cachedRow('c2', 5, null), cachedRow('c3', 6))
    const { result } = renderHook(() => useExerciseReferenceSessions('wd1', ['ex.bench'], 's-now'), { wrapper })
    await waitFor(() => expect(result.current.isFromCache).toBe(true))
    const heads = result.current.data.get('ex.bench')![0].logs.map((g) => g.head)
    expect(heads.map((l) => [l.id, l.addedPlace])).toEqual([
      ['c1', 3],
      ['c2', null],
      ['c3', null],
    ])
  })
})
