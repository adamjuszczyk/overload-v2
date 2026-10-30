// @vitest-environment jsdom
//
// Chunk 59 (DECISIONS 200 (a), Adam 2026-10-20: "the swap row is saved before any set is skipped"; SPEC Errors (15)): `useRecordExerciseSwap`
// is the first write of a swap, and it is online only. Offline it fails at once with the reason the client gave and writes nothing; it
// shows nothing before the server has the row (no optimistic card: a swap that isn't saved leaves every set as it was); the row it puts
// into the cache is the one the server answered, record and all.
import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.hoisted(() => vi.stubGlobal('__APP_VERSION__', '1.2.1')) // chunk 73: the sync queue reads the app's version before it sends
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider, onlineManager } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Exercise } from '../../types'

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

const inserted: Array<Record<string, unknown>> = []
let release: (() => void) | null = null
let answer: { data: Record<string, unknown> | null; error: unknown } | Error = { data: null, error: null }
let hold = false
vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (...args: string[]) => ({
      insert: (payload: Record<string, unknown>) => {
        inserted.push({ table: args[0], ...payload })
        return {
          select: () => ({
            single: async () => {
              if (hold) await new Promise<void>((resolve) => void (release = resolve))
              if (answer instanceof Error) throw answer
              return answer
            },
          }),
        }
      },
    }),
  },
}))
vi.mock('../../lib/db', () => ({ db: {} }))

const { useRecordExerciseSwap } = await import('./useSession')
const { queryClient } = await import('../../lib/queryClient')

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
const exercise = (id: string, name: string): Exercise => ({
  id, userId: 'user-1', name, muscleGroup: 'chest', isArchived: false, createdAt: '', muscleSubgroups: null, movementPattern: null,
  status: 'active', sourceLibraryId: null, lostAt: null,
})
const RECORD = { fromKey: 'pe-1', moved: [{ from: { weekPlanSetId: 'set-2' }, place: 1 }] }
const params = { programExerciseId: 'pe-1', originalExercise: exercise('ex-1', 'Bench Press'), replacementExercise: exercise('ex-2', 'Incline Press'), movedSets: RECORD }
const row = { id: 'swap-1', session_id: 's1', program_exercise_id: 'pe-1', original_exercise_id: 'ex-1', original_exercise_name: 'Bench Press', replacement_exercise_id: 'ex-2', replacement_exercise_name: 'Incline Press', created_at: '2026-01-05T10:00:00Z', moved_sets: RECORD }
const KEY = ['v2_sessionSwaps', 's1']

beforeEach(() => {
  inserted.length = 0
  release = null
  hold = false
  answer = { data: row, error: null }
  onlineManager.setOnline(true)
  queryClient.clear()
})

describe('useRecordExerciseSwap', () => {
  it('saves the row with its record and puts the server\'s row into the cache, record read back', async () => {
    const { result } = renderHook(() => useRecordExerciseSwap('s1'), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(params)
    })
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ table: 'v2_session_exercise_swaps', session_id: 's1', program_exercise_id: 'pe-1', moved_sets: RECORD })
    const cached = queryClient.getQueryData<Array<{ id: string; movedSets: unknown }>>(KEY)!
    expect(cached.map((s) => [s.id, s.movedSets])).toEqual([['swap-1', RECORD]])
  })

  it('shows nothing before the server has the row: while the insert is out the cache holds no swap (break: an optimistic row)', async () => {
    hold = true
    const { result } = renderHook(() => useRecordExerciseSwap('s1'), { wrapper })
    let settled: Promise<unknown> = Promise.resolve()
    await act(async () => {
      settled = result.current.mutateAsync(params)
      for (let i = 0; i < 6; i++) await Promise.resolve()
    })
    expect(inserted).toHaveLength(1) // the request is out
    expect(queryClient.getQueryData(KEY)).toBeUndefined()
    await act(async () => {
      release!()
      await settled
    })
    expect(queryClient.getQueryData<unknown[]>(KEY)).toHaveLength(1)
  })

  it('a refusal rejects with the server\'s own error and leaves the cache as it was', async () => {
    const refusal = { message: 'duplicate key value violates unique constraint "v2_session_exercise_swaps_slot_uk"', code: '23505' }
    answer = { data: null, error: refusal }
    queryClient.setQueryData(KEY, [])
    const { result } = renderHook(() => useRecordExerciseSwap('s1'), { wrapper })
    let error: unknown
    await act(async () => {
      await result.current.mutateAsync(params).catch((e: unknown) => void (error = e))
    })
    expect(error).toBe(refusal)
    expect(queryClient.getQueryData(KEY)).toEqual([])
  })

  it('offline it is tried at once and fails with the reason the client gave, nothing written (break: the default network mode holds the request until the phone is back)', async () => {
    onlineManager.setOnline(false)
    answer = new TypeError('Failed to fetch')
    const { result } = renderHook(() => useRecordExerciseSwap('s1'), { wrapper })
    let error: unknown
    await act(async () => {
      void result.current.mutateAsync(params).catch((e: unknown) => void (error = e))
      for (let i = 0; i < 12; i++) await Promise.resolve()
    })
    expect(inserted).toHaveLength(1) // the request went out although the phone is offline
    expect(error).toBeInstanceOf(TypeError)
    expect((error as Error).message).toBe('Failed to fetch')
    expect(queryClient.getQueryData(KEY)).toBeUndefined()
  })
})
