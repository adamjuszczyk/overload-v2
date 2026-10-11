// @vitest-environment jsdom
//
// B6: two quick taps on APPLY ran "apply ahead" twice and duplicated added
// sets. apply() had no guard of its own; the button's `disabled` follows
// isPending, which only updates on the next render, so a second tap in the
// same event-loop task still got through. The real hook chain runs below
// (useApplyAheadOffer → useApplyAhead → the planned-week writes); only the
// service call that writes a set is faked, and counted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { WeekPlan, ProgramExercise } from '../../types'
import type { ChangeRecord } from './applyAhead'

vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))
vi.mock('../../hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }))

let releaseWrite: () => void = () => {}
const addSetMock = vi.fn(
  () =>
    new Promise<void>((resolve) => {
      releaseWrite = resolve
    }),
)
vi.mock('./weekPlanService', () => ({ addSet: (...a: unknown[]) => addSetMock(...(a as [])) }))

const { useApplyAheadOffer } = await import('./ApplyAheadOffer')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

const pe1: ProgramExercise = {
  id: 'pe-1', workoutDayId: 'wd-1', userId: 'user-1', exerciseId: 'ex-1', position: 0, weightUnit: null,
}
const laterWeek: WeekPlan = {
  id: 'wp-2', userId: 'user-1', mesocycleId: 'meso-1', workoutDayId: 'wd-1', weekNumber: 2,
  isDeload: false, notes: null, createdAt: '2026-01-01T00:00:00Z', exercises: [pe1], sets: [],
}
const change: ChangeRecord = { editType: 'addSet', slotId: 'pe-1', exerciseId: 'ex-1' }

afterEach(() => addSetMock.mockClear())

describe('useApplyAheadOffer — apply() is single-flight (B6)', () => {
  it('two taps in one task write the added set once', async () => {
    const { result } = renderHook(() => useApplyAheadOffer('meso-1', 'wd-1:1'), { wrapper })
    act(() => result.current.setOffer([change], [laterWeek], false))

    act(() => {
      result.current.apply()
      result.current.apply()
    })
    await waitFor(() => expect(addSetMock).toHaveBeenCalled())
    releaseWrite()
    await waitFor(() => expect(result.current.outcome).not.toBeNull())

    expect(addSetMock).toHaveBeenCalledTimes(1)
    expect(result.current.outcome?.summary.applied).toBe(1)
  })

  it('a later offer can be applied once the first has finished', async () => {
    const { result } = renderHook(() => useApplyAheadOffer('meso-1', 'wd-1:1'), { wrapper })
    act(() => result.current.setOffer([change], [laterWeek], false))
    act(() => {
      result.current.apply()
    })
    await waitFor(() => expect(addSetMock).toHaveBeenCalledTimes(1))
    releaseWrite()
    await waitFor(() => expect(result.current.outcome).not.toBeNull())

    act(() => result.current.setOffer([change], [laterWeek], false))
    act(() => {
      result.current.apply()
    })
    await waitFor(() => expect(addSetMock).toHaveBeenCalledTimes(2))
    releaseWrite()
    await waitFor(() => expect(result.current.isPending).toBe(false))
  })

  it('a failed apply can be tried again', async () => {
    addSetMock.mockImplementationOnce(() => Promise.reject(new Error('network down')))
    const { result } = renderHook(() => useApplyAheadOffer('meso-1', 'wd-1:1'), { wrapper })
    act(() => result.current.setOffer([change], [laterWeek], false))
    act(() => {
      result.current.apply()
    })
    await waitFor(() => expect(result.current.outcome?.error).toBeTruthy())

    act(() => result.current.setOffer([change], [laterWeek], false))
    act(() => {
      result.current.apply()
    })
    await waitFor(() => expect(addSetMock).toHaveBeenCalledTimes(2))
    releaseWrite()
  })
})
