// @vitest-environment jsdom
//
// B3 (5 of 5): plan mutations in useWeekPlan.ts used TanStack's default
// networkMode ('online'), so offline they PAUSED (mutateAsync never settles)
// instead of attempting the call and failing, against the house rule that
// every write mutation is 'always' (useWeekPlan.test.tsx, usePlanWeek's
// chunk 8 block). Each hook below is fired while TanStack thinks it is
// offline and must not pause. (Chunk 54a took the week's exercise-level
// hooks, ADD STAGE's and the warmup's out, and added useChangeSetType.)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryClient } from '../../lib/queryClient'

const service = {
  addSet: vi.fn(),
  applySetTypeOps: vi.fn(),
  removeSet: vi.fn(),
  updateSet: vi.fn(),
}
vi.mock('./weekPlanService', () => ({
  addSet: (...a: unknown[]) => service.addSet(...a),
  applySetTypeOps: (...a: unknown[]) => service.applySetTypeOps(...a),
  removeSet: (...a: unknown[]) => service.removeSet(...a),
  updateSet: (...a: unknown[]) => service.updateSet(...a),
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
const NORMAL = { isWarmup: false, stageKind: null, repMin: 8, repMax: 8, isAmrap: false, targetWeight: null, targetRir: null, targetRirMax: null }
add('useAddSet', () => hooks.useAddSet('m1', 1), { weekPlanId: 'wp', programExerciseId: 'pe', setNumber: 1, defaults: NORMAL }, 'addSet')
add('useChangeSetType', () => hooks.useChangeSetType('m1', 1), { ops: [{ kind: 'removeStage', id: 's1' }] }, 'applySetTypeOps')
add('useUpdateSet', () => hooks.useUpdateSet('m1', 1), { id: 's1', changes: { targetRir: 1, targetRirMax: 2 } }, 'updateSet')
add('useRemoveSet', () => hooks.useRemoveSet('m1', 1), 's1', 'removeSet')

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
