import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { WeekPlan } from '../../types'
import {
  fetchWeekPlans,
  fetchAllWeekPlansForMeso,
  fetchWeekPlanById,
  createWeekPlan,
  setDeload,
  addSet,
  updateSet,
  removeSet,
  copyFromPreviousWeek,
} from './weekPlanService'

function key(mesoId: string, weekNumber: number) {
  return ['v2_weekPlans', mesoId, weekNumber] as const
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useWeekPlans(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  return useQuery({
    queryKey: key(mesoId, weekNumber),
    queryFn: () => fetchWeekPlans(mesoId, weekNumber),
    enabled: !!user && !!mesoId,
  })
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useSetDeload(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: ({ weekPlanId, isDeload }: { weekPlanId: string; isDeload: boolean }) =>
      setDeload(weekPlanId, isDeload),
    onMutate: async ({ weekPlanId, isDeload }) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: WeekPlan[] | undefined) =>
        old?.map((wp) => (wp.id === weekPlanId ? { ...wp, isDeload } : wp)),
      )
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

export function useAddSet(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: async ({
      workoutDayId,
      weekPlanId,
      programExerciseId,
      setNumber,
    }: {
      workoutDayId: string
      weekPlanId?: string
      programExerciseId: string
      setNumber: number
    }) => {
      let planId = weekPlanId
      if (!planId) {
        const plan = await createWeekPlan(user!.id, mesoId, workoutDayId, weekNumber)
        planId = plan.id
      }
      return addSet(user!.id, planId, programExerciseId, setNumber)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

export function useUpdateSet(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: ({
      id,
      changes,
    }: {
      id: string
      changes: { targetRir?: number | null; isDropset?: boolean }
    }) => updateSet(id, changes),
    onMutate: async ({ id, changes }) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: WeekPlan[] | undefined) =>
        old?.map((wp) => ({
          ...wp,
          sets: wp.sets.map((s) =>
            s.id === id
              ? {
                  ...s,
                  ...('targetRir' in changes ? { targetRir: changes.targetRir } : {}),
                  ...('isDropset' in changes ? { isDropset: changes.isDropset } : {}),
                }
              : s,
          ),
        })),
      )
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

export function useRemoveSet(mesoId: string, weekNumber: number) {
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: (id: string) => removeSet(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk })
      const prev = queryClient.getQueryData(qk)
      queryClient.setQueryData(qk, (old: WeekPlan[] | undefined) =>
        old?.map((wp) => ({ ...wp, sets: wp.sets.filter((s) => s.id !== id) })),
      )
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(qk, ctx?.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

export function useCopyFromPreviousWeek(mesoId: string, weekNumber: number) {
  const { user } = useAuth()
  const qk = key(mesoId, weekNumber)
  return useMutation({
    mutationFn: () => copyFromPreviousWeek(user!.id, mesoId, weekNumber),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk }),
  })
}

export function useAllWeekPlans(mesoId: string) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_allWeekPlans', mesoId],
    queryFn: () => fetchAllWeekPlansForMeso(mesoId),
    enabled: !!user && !!mesoId,
  })
}

export function useWeekPlanById(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['v2_weekPlan', id],
    queryFn: () => fetchWeekPlanById(id!),
    enabled: !!user && !!id,
  })
}
