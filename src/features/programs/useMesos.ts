import { useQuery, useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import {
  fetchMesos,
  createMeso,
  completeAllActiveMesos,
  completeMeso,
  deleteMeso,
} from './mesoService'

const MESOS_KEY = ['v2_mesos']

export function useMesos() {
  const { user } = useAuth()
  return useQuery({
    queryKey: MESOS_KEY,
    queryFn: fetchMesos,
    enabled: !!user,
  })
}

export function useCreateMeso() {
  const { user } = useAuth()
  return useMutation({
    mutationFn: async ({ name, programId }: { name: string; programId: string }) => {
      // Enforce one-active-at-a-time at the application layer
      await completeAllActiveMesos(user!.id)
      const today = format(new Date(), 'yyyy-MM-dd')
      return createMeso(user!.id, name, programId, today)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MESOS_KEY }),
  })
}

export function useCompleteMeso() {
  return useMutation({
    mutationFn: (id: string) => completeMeso(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MESOS_KEY }),
  })
}

export function useDeleteMeso() {
  return useMutation({
    mutationFn: (id: string) => deleteMeso(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MESOS_KEY })
      queryClient.invalidateQueries({ queryKey: ['v2_history'] })
    },
  })
}
