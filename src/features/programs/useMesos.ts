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
//
// Chunk 65 (SPEC Programs and runs [1.2], Starting: "lands on Plan, week 1"): both START buttons navigate to Plan the moment this
// resolves, and Plan decides what to open from the run list. The invalidations are returned, so the mutation stays pending until the runs
// and programs have been read again: Plan then opens on the new run, not on the list as it was before the start (a stale list would
// show "no program running" for the moment between). A refetch that fails doesn't fail the start: `invalidateQueries` swallows it.
// `networkMode: 'always'`, like every write (CONTEXT.md, Offline): starting is online-only, so offline it fails with the real reason
// (SPEC Errors (15): PR10) instead of pausing for ever.
export function useStartRun() {
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ name, programId }: { name: string; programId: string }) => {
      const today = format(new Date(), 'yyyy-MM-dd')
      return startRun(programId, name, today)
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: MESOS_KEY }),
        queryClient.invalidateQueries({ queryKey: ['v2_programs'] }),
      ]),
  })
}

// FINISH (chunk 65; SPEC Programs and runs [1.2], Finishing (8c)): `networkMode: 'always'` for the same reason as the start. The
// invalidation is returned, so FINISHING… lasts until the list shows the run finished.
export function useCompleteMeso() {
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: string) => completeMeso(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: MESOS_KEY }),
  })
}

// Chunk 66: DELETE THIS FINISHED PROGRAM (PR15) is its second caller (History's meso filter is the first), and it navigates to PROGRAMS the
// moment the delete resolves. So, like START and FINISH (chunk 65): `networkMode: 'always'` (CONTEXT.md, Offline: every write mutation is;
// deleting is online-only, so offline it fails with the real reason, SPEC Errors (15), instead of pausing for ever behind DELETING…), and the
// invalidations are returned, so the mutation stays pending until the run list has been read again and PROGRAMS doesn't open on the list as
// it was, with the deleted run still under FINISHED. A refetch that fails doesn't fail a delete that happened.
export function useDeleteMeso() {
  return useMutation({
    networkMode: 'always',
    mutationFn: (id: string) => deleteMeso(id),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: MESOS_KEY }),
        queryClient.invalidateQueries({ queryKey: ['v2_history'] }),
        // v2_sessions.mesocycle_id is `on delete set null`, not cascade — a
        // deleted meso's sessions survive, just orphaned, so any exercise's
        // already-cached e1rmSessions can keep tagging them with the
        // now-deleted meso's id until this invalidates. Same gap class (and
        // same fix) useDeleteSession/useCompleteSession already apply for the
        // identical reason — found by adversarial review, generically more
        // relevant now that ExerciseHistoryView.tsx reads v2_exerciseProgress
        // as its primary data source, not a secondary one.
        queryClient.invalidateQueries({ queryKey: ['v2_exerciseProgress'] }),
        queryClient.invalidateQueries({ queryKey: ['v2_mesoProgress'] }),
        queryClient.invalidateQueries({ queryKey: ['v2_positionMatchedHeadline'] }),
        queryClient.invalidateQueries({ queryKey: ['v2_positionMatchTable'] }),
      ]),
  })
}
