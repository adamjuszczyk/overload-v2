import { useQuery, useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { fetchMesos, completeMeso, deleteMeso } from './mesoService'
import { startRun } from './runService'

const MESOS_KEY = ['v2_mesos']

export function useMesos() {
  const { user } = useAuth()
  return useQuery({
    queryKey: MESOS_KEY,
    queryFn: fetchMesos,
    enabled: !!user,
  })
}

// Replaces useCreateMeso (chunk 6, TASKS.md): one atomic, race-safe RPC
// (v2_start_run) instead of the old completeAllActiveMesos + createMeso
// two-request path — no user id to pass (the function reads auth.uid()
// itself). Starting a run also creates a brand new v2_programs row (the
// run's own copy), which the old path never did, so this invalidates
// ['v2_programs'] too — a cache PlanPage/ProgramBuilderPage/ProgramPage all
// read by a program id that didn't exist before this call. That key's
// invalidation also reaches ['v2_programs', 'saved'] (TanStack Query
// matches by prefix), so usePrograms.ts's useSavedPrograms needs no
// separate invalidation of its own.
export function useStartRun() {
  return useMutation({
    mutationFn: ({ name, programId }: { name: string; programId: string }) => {
      const today = format(new Date(), 'yyyy-MM-dd')
      return startRun(programId, name, today)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MESOS_KEY })
      queryClient.invalidateQueries({ queryKey: ['v2_programs'] })
    },
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
      // v2_sessions.mesocycle_id is `on delete set null`, not cascade — a
      // deleted meso's sessions survive, just orphaned, so any exercise's
      // already-cached e1rmSessions can keep tagging them with the
      // now-deleted meso's id until this invalidates. Same gap class (and
      // same fix) useDeleteSession/useCompleteSession already apply for the
      // identical reason — found by adversarial review, generically more
      // relevant now that ExerciseHistoryView.tsx reads v2_exerciseProgress
      // as its primary data source, not a secondary one.
      queryClient.invalidateQueries({ queryKey: ['v2_exerciseProgress'] })
      queryClient.invalidateQueries({ queryKey: ['v2_mesoProgress'] })
      queryClient.invalidateQueries({ queryKey: ['v2_positionMatchedHeadline'] })
      queryClient.invalidateQueries({ queryKey: ['v2_positionMatchTable'] })
    },
  })
}
