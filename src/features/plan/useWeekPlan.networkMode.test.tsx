// @vitest-environment jsdom
//
// B3 (5 of 5): nine plan mutations in useWeekPlan.ts used TanStack's default
// networkMode ('online'), so offline they PAUSED (mutateAsync never settles)
// instead of attempting the call and failing, against the house rule that
// every write mutation is 'always' (useWeekPlan.test.tsx, usePlanWeek's
// chunk 8 block). Each hook below is fired while TanStack thinks it is
// offline and must not pause.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

const service = {
  createWeekPlan: vi.fn(),
  addSet: vi.fn(),
  addStage: vi.fn(),
  removeSet: vi.fn(),
  swapWeekExercise: vi.fn(),
  addWeekExercise: vi.fn(),
  removeWeekExercise: vi.fn(),
  reorderWeekExercises: vi.fn(),
}
vi.mock('./weekPlanService', () => ({
  createWeekPlan: (...a: unknown[]) => service.createWeekPlan(...a),
  addSet: (...a: unknown[]) => service.addSet(...a),
  addStage: (...a: unknown[]) => service.addStage(...a),
  removeSet: (...a: unknown[]) => service.removeSet(...a),
  swapWeekExercise: (...a: unknown[]) => service.swapWeekExercise(...a),
  addWeekExercise: (...a: unknown[]) => service.addWeekExercise(...a),
  removeWeekExercise: (...a: unknown[]) => service.removeWeekExercise(...a),
  reorderWeekExercises: (...a: unknown[]) => service.reorderWeekExercises(...a),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }))

const hooks = await import('./useWeekPlan')

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
}

afterEach(() => {
  onlineManager.setOnline(true)
  for (const fn of Object.values(service)) fn.mockReset()
  queryClient.clear()
})

const cases: Array<[string, () => { mutate: (v: never) => void; isPaused: boolean; isSuccess: boolean }, unknown, keyof typeof service]> = []
function add(
  name: string,
  useHook: () => unknown,
  variables: unknown,
  svc: keyof typeof service,
) {
  cases.push([name, useHook as never, variables, svc])
}
add('useAddSet', () => hooks.useAddSet('m1', 1), { workoutDayId: 'wd', weekPlanId: 'wp', programExerciseId: 'pe', setNumber: 1 }, 'addSet')
add('useAddStage', () => hooks.useAddStage('m1', 1), { weekPlanId: 'wp', programExerciseId: 'pe', parentId: 's1', setNumber: 1, stageIndex: 1 }, 'addStage')
add('useRemoveSet', () => hooks.useRemoveSet('m1', 1), 's1', 'removeSet')
add('useSwapWeekExercise', () => hooks.useSwapWeekExercise('m1', 1), { weekPlanId: 'wp', programExerciseId: 'pe', replacementExerciseId: 'ex2' }, 'swapWeekExercise')
add('useAddWeekExercise', () => hooks.useAddWeekExercise('m1', 1), { weekPlanId: 'wp', workoutDayId: 'wd', exerciseId: 'ex', position: 3 }, 'addWeekExercise')
add('useRemoveWeekExercise', () => hooks.useRemoveWeekExercise('m1', 1), { weekPlanId: 'wp', programExerciseId: 'pe' }, 'removeWeekExercise')
add('useReorderWeekExercises', () => hooks.useReorderWeekExercises('m1', 1), { weekPlanId: 'wp', moves: [] }, 'reorderWeekExercises')

describe('plan mutations — networkMode: always (B3)', () => {
  it.each(cases)('%s never pauses when TanStack thinks it is offline', async (_name, useHook, variables, svc) => {
    service[svc].mockResolvedValue({})
    const { result } = renderHook(() => useHook(), { wrapper })

    onlineManager.setOnline(false)
    act(() => {
      result.current.mutate(variables as never)
    })

    // Default networkMode ('online'): isPaused stays true and the service is
    // never called until back online.
    await waitFor(() => expect(result.current.isPaused).toBe(false))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(service[svc]).toHaveBeenCalledTimes(1)
  })
})
