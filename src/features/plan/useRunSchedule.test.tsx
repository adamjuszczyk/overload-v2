// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

// Chunk 50: the read behind "which weekdays are in force that week" (`v2_run_schedules`, migration 042). The rows are
// data the page draws and the scheduler decides on, so the test asserts the request (table, run, order, page size) and
// what a row becomes, with the key chunk 51b's save invalidates.

vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const calls: Array<{ method: string; args: unknown[] }> = []
let pages: Array<Array<Record<string, unknown>> | { error: { message: string } }> = []

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      calls.push({ method: 'from', args: [table] })
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'order']) {
        chain[m] = (...args: unknown[]) => {
          calls.push({ method: m, args })
          return chain
        }
      }
      chain.range = async (...args: unknown[]) => {
        calls.push({ method: 'range', args })
        const next = pages.shift() ?? []
        return 'error' in next ? { data: null, error: next.error } : { data: next, error: null }
      }
      return chain
    },
  },
}))

const { fetchRunSchedules, toRunSchedule, useRunSchedule, RUN_SCHEDULES_KEY } = await import('./useRunSchedule')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

afterEach(() => {
  calls.length = 0
  pages = []
  queryClient.clear()
})

// The ids are not shaped like a Tailwind utility on purpose (RULES.md: a numbered id such as a grid row adds a rule to the stylesheet).
const dbRow = (fromWeek: number, schedule: Record<string, string | null>, id = `stored${fromWeek}`) => ({
  id,
  user_id: 'user-1',
  mesocycle_id: 'meso-1',
  from_week: fromWeek,
  schedule,
  created_at: '2026-09-01T10:00:00Z',
})

describe('toRunSchedule', () => {
  it('maps the columns to the RunSchedule the resolver reads', () => {
    const full = {
      monday: null, tuesday: 'wd-push', wednesday: null, thursday: null, friday: null, saturday: null, sunday: null,
    }
    expect(toRunSchedule(dbRow(3, full))).toEqual({
      id: 'stored3', userId: 'user-1', mesocycleId: 'meso-1', fromWeek: 3, schedule: full, createdAt: '2026-09-01T10:00:00Z',
    })
  })

  it('a schedule that leaves weekdays out reads them as null (the seed writes sparse maps), always seven days', () => {
    const row = toRunSchedule(dbRow(1, { friday: 'wd-push' }))
    expect(Object.keys(row.schedule).sort()).toEqual(['friday', 'monday', 'saturday', 'sunday', 'thursday', 'tuesday', 'wednesday'])
    expect(row.schedule.friday).toBe('wd-push')
    expect(row.schedule.monday).toBeNull()
  })

  it('a null schedule column reads as no workout on any day, not a crash', () => {
    expect(Object.values(toRunSchedule({ ...dbRow(1, {}), schedule: null }).schedule).every((id) => id === null)).toBe(true)
  })
})

describe('fetchRunSchedules', () => {
  it('asks v2_run_schedules for this run\'s rows, oldest week first', async () => {
    pages = [[dbRow(1, { tuesday: 'wd-push' }), dbRow(3, { wednesday: 'wd-push' })]]
    const rows = await fetchRunSchedules('meso-1')
    expect(rows.map((r) => r.fromWeek)).toEqual([1, 3])
    expect(calls).toContainEqual({ method: 'from', args: ['v2_run_schedules'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['mesocycle_id', 'meso-1'] })
    expect(calls).toContainEqual({ method: 'order', args: ['from_week'] })
  })

  it('a run with no rows answers [] (a real answer: the run copy applies in every week)', async () => {
    pages = [[]]
    expect(await fetchRunSchedules('meso-1')).toEqual([])
  })

  it('pages until a short page, so a long history is not cut at PostgREST\'s row cap', async () => {
    const full = Array.from({ length: 500 }, (_, i) => dbRow(i + 1, { monday: 'wd-push' }))
    pages = [full, [dbRow(501, { tuesday: 'wd-push' })]]
    const rows = await fetchRunSchedules('meso-1')
    expect(rows).toHaveLength(501)
    expect(rows[500].fromWeek).toBe(501)
    expect(calls.filter((c) => c.method === 'range').map((c) => c.args)).toEqual([[0, 499], [500, 999]])
  })

  it('throws the server\'s error, so a failed read is not taken for "no rows"', async () => {
    pages = [{ error: { message: 'permission denied for table v2_run_schedules' } }]
    await expect(fetchRunSchedules('meso-1')).rejects.toMatchObject({ message: 'permission denied for table v2_run_schedules' })
  })
})

describe('useRunSchedule', () => {
  it('reads the run under [\'v2_runSchedules\', mesoId], the key chunk 51b\'s save invalidates', async () => {
    pages = [[dbRow(1, { tuesday: 'wd-push' })]]
    const { result } = renderHook(() => useRunSchedule('meso-1'), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    expect(RUN_SCHEDULES_KEY).toBe('v2_runSchedules')
    expect(queryClient.getQueryData(['v2_runSchedules', 'meso-1'])).toHaveLength(1)
  })

  it('an invalidation of that key reads the rows again (a save in 51b shows in Today and Plan at once)', async () => {
    pages = [[dbRow(1, { tuesday: 'wd-push' })], [dbRow(1, { tuesday: 'wd-push' }), dbRow(3, { wednesday: 'wd-push' })]]
    const { result } = renderHook(() => useRunSchedule('meso-1'), { wrapper })
    await waitFor(() => expect(result.current.data).toHaveLength(1))
    await queryClient.invalidateQueries({ queryKey: ['v2_runSchedules', 'meso-1'] })
    await waitFor(() => expect(result.current.data).toHaveLength(2))
  })

  it('with no run (mesoId undefined) it reads nothing and answers nothing', async () => {
    pages = [[dbRow(1, { tuesday: 'wd-push' })]]
    const { result } = renderHook(() => useRunSchedule(undefined), { wrapper })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(result.current.data).toBeUndefined()
    expect(calls).toEqual([])
  })
})
