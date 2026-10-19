// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'
import type { Op } from '../programs/programChange'

// Chunk 52 (TASKS-1.2 "Plan's header" → CopySheet; SPEC Data model: "Client writes to existing `v2_week_plan_sets` rows ..., one
// `v2_apply_ops` call so a sheet's copy lands or fails as a whole"). COPY's one write: the op list the sheet built goes to `applyOps`
// exactly as given, in one request; the caches its tables made stale are read again before the mutation settles; and a failure is the
// mutation's own error, with nothing read again. The screen-level proofs (which ops, for which ticks) are PlanPage.copySheet.test.tsx's.

const applyOpsMock = vi.fn()
vi.mock('../programs/applyOps', () => ({ applyOps: (...args: unknown[]) => applyOpsMock(...args) }))

const { useCopyNumbers } = await import('./useCopyNumbers')

afterEach(() => {
  onlineManager.setOnline(true)
  applyOpsMock.mockReset()
  queryClient.clear()
  vi.restoreAllMocks()
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

const OPS: Op[] = [
  { op: 'update', table: 'v2_week_plan_sets', id: 's-1', patch: { target_weight: 60 } },
  { op: 'update', table: 'v2_week_plan_sets', id: 's-2', patch: { target_rir: 2, target_rir_max: null } },
]

describe('useCopyNumbers', () => {
  it('sends the op list to applyOps exactly as given, once (the same array: nothing filtered, merged or added), and answers what it answered', async () => {
    applyOpsMock.mockResolvedValue(2)
    const { result } = renderHook(() => useCopyNumbers(), { wrapper })
    let applied = 0
    await act(async () => {
      applied = await result.current.mutateAsync(OPS)
    })
    expect(applyOpsMock).toHaveBeenCalledTimes(1)
    expect(applyOpsMock.mock.calls[0][0]).toBe(OPS)
    expect(applied).toBe(2)
  })

  it('reads the week plans again, which a change to week-plan sets makes stale: the week\'s, the run\'s whole list and the one-plan read', async () => {
    applyOpsMock.mockResolvedValue(2)
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCopyNumbers(), { wrapper })
    await act(async () => {
      await result.current.mutateAsync(OPS)
    })
    const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: string[] }).queryKey[0]).sort()
    expect(keys).toEqual(['v2_allWeekPlans', 'v2_weekPlan', 'v2_weekPlans'])
  })

  it('does not settle until those reads are done, so the sheet closes on the numbers it wrote', async () => {
    applyOpsMock.mockResolvedValue(2)
    const releases: Array<() => void> = []
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(() => new Promise<void>((resolve) => releases.push(resolve)))
    const { result } = renderHook(() => useCopyNumbers(), { wrapper })
    act(() => {
      result.current.mutate(OPS)
    })
    await waitFor(() => expect(applyOpsMock).toHaveBeenCalled())
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(result.current.isPending).toBe(true)
    await act(async () => {
      releases.forEach((release) => release())
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('a failure is the error as it came; no cache is read again, because nothing was written', async () => {
    applyOpsMock.mockRejectedValue({ message: 'row not found: v2_week_plan_sets/s-2', code: 'P0001' })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { result } = renderHook(() => useCopyNumbers(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync(OPS)).rejects.toEqual({ message: 'row not found: v2_week_plan_sets/s-2', code: 'P0001' })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toEqual({ message: 'row not found: v2_week_plan_sets/s-2', code: 'P0001' })
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('offline it still attempts the call and fails fast: the sheet shows the error with its choices kept, not a button stuck on COPYING… (networkMode always)', async () => {
    onlineManager.setOnline(false)
    applyOpsMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useCopyNumbers(), { wrapper })
    await act(async () => {
      await expect(result.current.mutateAsync(OPS)).rejects.toThrow('Failed to fetch')
    })
    expect(applyOpsMock).toHaveBeenCalledTimes(1)
  })
})
