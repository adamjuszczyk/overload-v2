// @vitest-environment jsdom
//
// Chunk 59 (TASKS-1.2 59; DECISIONS 163, 194; G47): the skips "Skip the rest of this exercise" and a swap write go through `useLogSet`, so
// offline they are queue items. A skip of a warmup carries `is_warmup`, and a skip of an added set its place and its own id, in the
// queued upsert and in the device's row: after a reload the skip alone holds the kind and the place of the gap a moved set left (46r's
// P1 and P1b), so a skip that reached the server without them would read as a working set logged before 044.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

let online = false
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => online }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

const inserted: Array<Record<string, unknown>> = []
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: string[]) => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table: args[0], ...row })
        return { select: () => ({ single: async () => ({ data: { ...row, logged_at: '2026-10-21T10:00:00Z', exercises: null }, error: null }) }) }
      },
    }),
  },
}))

const cachedRows: Array<Record<string, unknown>> = []
const queued: Array<{ table: string; operation: string; payload: Record<string, unknown> }> = []
vi.mock('../../lib/db', () => ({
  db: {
    set_logs: { put: async (row: Record<string, unknown>) => void cachedRows.push(row) },
    sync_queue: { add: async (item: { table: string; operation: string; payload: Record<string, unknown> }) => void queued.push(item) },
  },
}))

const { useLogSet } = await import('./useSession')
const { queryClient } = await import('../../lib/queryClient')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>

const skip = {
  exerciseId: 'ex-1', weekPlanSetId: null as string | null, setNumber: 1, weight: null, reps: null, rir: null, note: null, isDropset: false,
  parentSetId: null as string | null, stageIndex: 0, isSkipped: true, restSeconds: null, setSeconds: null, enteredUnit: null, formRating: null, stageKind: null,
}

async function write(extra: Record<string, unknown>) {
  const { result } = renderHook(() => useLogSet('s1'), { wrapper })
  await act(async () => {
    await result.current.mutateAsync({ ...skip, ...extra } as never)
  })
}

beforeEach(() => {
  inserted.length = 0
  cachedRows.length = 0
  queued.length = 0
  queryClient.clear()
  queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: [] })
})

describe('offline: a skip of a moved or added set is a queue item that holds what the screen needs after a reload', () => {
  beforeEach(() => {
    online = false
  })

  it('a skipped added Warmup: is_skipped, is_warmup, added_place and its own id in the queued upsert, and in the device\'s row', async () => {
    await write({ id: 'skip-a', isWarmup: true, addedPlace: 1, setNumber: 1 })
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ table: 'v2_set_logs', operation: 'upsert', payload: { id: 'skip-a', is_skipped: true, is_warmup: true, added_place: 1, week_plan_set_id: null, set_number: 1 } })
    expect(cachedRows[0]).toMatchObject({ id: 'skip-a', isSkipped: true, isWarmup: true, addedPlace: 1 })
  })

  it('a skipped planned working set: the payload it always was, no place and no warmup flag set', async () => {
    await write({ weekPlanSetId: 'set-2', setNumber: 2 })
    expect(queued[0].payload).toMatchObject({ week_plan_set_id: 'set-2', is_skipped: true, is_warmup: false })
    expect('added_place' in queued[0].payload).toBe(false)
    expect('addedPlace' in cachedRows[0]).toBe(false)
  })
})

describe('online: the same skip is the same row', () => {
  beforeEach(() => {
    online = true
  })
  it('an added Warmup\'s skip is inserted with its warmup flag, its place and its id', async () => {
    await write({ id: 'skip-a', isWarmup: true, addedPlace: 1 })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ table: 'v2_set_logs', id: 'skip-a', is_skipped: true, is_warmup: true, added_place: 1, week_plan_set_id: null })
  })
})
