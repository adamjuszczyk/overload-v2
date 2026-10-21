// @vitest-environment jsdom
//
// Chunk 58a (TASKS-1.2 "Added place", DECISIONS 174, 177; 46m's mapping): LOG of an added set writes its place — in `useLogSet`'s
// payload, the upsert, the Dexie row and so the offline queue item — and nothing else does. A planned set's payload leaves the key out,
// as does a drop's, so the rows a plain session writes are what they were. `useLogSet` also takes the log's id from the caller when it
// is given one (an added set's list entry names its log before the request goes out).
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
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table, ...row })
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

const base = {
  exerciseId: 'ex-1', weekPlanSetId: null as string | null, setNumber: 4, weight: 50, reps: 9, rir: null, note: null, isDropset: false,
  parentSetId: null as string | null, stageIndex: 0, isSkipped: false, restSeconds: null, setSeconds: null, enteredUnit: null, formRating: null,
  stageKind: null,
}

async function log(extra: Record<string, unknown>) {
  const { result } = renderHook(() => useLogSet('s1'), { wrapper })
  let out: unknown
  await act(async () => {
    out = await result.current.mutateAsync({ ...base, ...extra } as never)
  })
  return out as { id: string; addedPlace?: number | null }
}

beforeEach(() => {
  inserted.length = 0
  cachedRows.length = 0
  queued.length = 0
  queryClient.clear()
  queryClient.setQueryData(['v2_session', 's1'], { id: 's1', setLogs: [] })
})

describe('offline: the queue item and the Dexie row carry an added set\'s place', () => {
  beforeEach(() => {
    online = false
  })

  it('an added set\'s head log: added_place 1 in the queued upsert, addedPlace 1 in the device\'s row and in the log it returns, under the id it was given', async () => {
    const out = await log({ addedPlace: 1, id: 'given-id' })
    expect(queued).toHaveLength(1)
    expect(queued[0]).toMatchObject({ table: 'v2_set_logs', operation: 'upsert', payload: { id: 'given-id', added_place: 1, set_number: 4, week_plan_set_id: null } })
    expect(cachedRows[0]).toMatchObject({ id: 'given-id', addedPlace: 1 })
    expect(out).toMatchObject({ id: 'given-id', addedPlace: 1 })
    // and the screen's own copy, from the first render after the tap
    expect(queryClient.getQueryData<{ setLogs: Array<{ id: string; addedPlace: number | null }> }>(['v2_session', 's1'])!.setLogs[0]).toMatchObject({ id: 'given-id', addedPlace: 1 })
  })

  it('the place travels with the item: a second added set is place 2 in its own item', async () => {
    await log({ addedPlace: 1, id: 'a' })
    await log({ addedPlace: 2, id: 'b', setNumber: 5 })
    expect(queued.map((q) => [q.payload.id, q.payload.added_place])).toEqual([['a', 1], ['b', 2]])
  })

  it('a planned set\'s item and row leave the key out (absence): the payload a plain session wrote before the chunk', async () => {
    await log({ weekPlanSetId: 'set-1', setNumber: 1 })
    expect('added_place' in queued[0].payload).toBe(false)
    expect('addedPlace' in cachedRows[0]).toBe(false)
    expect(Object.keys(queued[0].payload).sort()).toEqual(
      ['entered_unit', 'exercise_id', 'form_rating', 'id', 'is_dropset', 'is_skipped', 'is_warmup', 'logged_at', 'note', 'parent_set_id', 'reps', 'rest_seconds', 'rir', 'session_id', 'set_number', 'set_seconds', 'stage_index', 'stage_kind', 'user_id', 'week_plan_set_id', 'weight'].sort(),
    )
  })

  it('a drop\'s item carries no place either (DECISIONS 177)', async () => {
    await log({ parentSetId: 'head-log', stageIndex: 1, isDropset: true })
    expect('added_place' in queued[0].payload).toBe(false)
    expect('addedPlace' in cachedRows[0]).toBe(false)
  })
})

describe('online: the insert carries an added set\'s place', () => {
  beforeEach(() => {
    online = true
  })

  it('an added set\'s head log inserts added_place under the given id', async () => {
    await log({ addedPlace: 2, id: 'given-id' })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ table: 'v2_set_logs', id: 'given-id', added_place: 2, set_number: 4 })
  })

  it('a planned set\'s insert has no added_place key, and a drop\'s none', async () => {
    await log({ weekPlanSetId: 'set-1', setNumber: 1 })
    await log({ parentSetId: 'head', stageIndex: 1, isDropset: true })
    expect(inserted.every((row) => !('added_place' in row))).toBe(true)
  })

  it('a write that names no id gets one of its own, the same in the screen\'s optimistic copy and the insert', async () => {
    await log({ weekPlanSetId: 'set-1', setNumber: 1 })
    const optimistic = queryClient.getQueryData<{ setLogs: Array<{ id: string }> }>(['v2_session', 's1'])!.setLogs[0].id
    expect(inserted[0].id).toBe(optimistic)
  })
})
