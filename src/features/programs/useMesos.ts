import { useQuery, useMutation } from '@tanstack/react-query'
import { format } from 'date-fns'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import type { FinishedRunCounts } from '../../types'
import { fetchMesos, completeMeso, deleteFinishedRun, fetchFinishedRunCounts, fetchFinishedRunSessionIds } from './mesoService'
import { finishedRunInvalidations, finishedRunRemovals } from './finishedRunCaches'
import { dropQueuedWritesOfDeletedRun } from './finishedRunQueue'
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

// Chunk 75 (1.2.1 item 8b; SPEC Screens → Finished program: full delete): what the confirmation counts before it lets DELETE go. One query for both
// reads, so DELETE is on only when the counts AND the program's session ids (what the phone's queue clean-up needs, and can no longer read once the
// delete has taken the sessions) have both answered; either failing keeps it off, with the reason. `enabled` is true only while the confirmation is
// open and the phone is online (SPEC: offline, "The counts aren't read"). Never retried and never kept: a count read a minute ago, or one a failed
// read left behind, is not what a delete that cannot be undone may name (`retry: false`, `staleTime: 0`, `gcTime: 0`: closing the confirmation
// drops the answer, and opening it again counts again).
export const FINISHED_RUN_COUNTS_KEY = 'v2_finishedRunCounts'

export interface FinishedRunRead {
  counts: FinishedRunCounts
  sessionIds: string[]
}

export function useFinishedRunCounts(id: string, enabled: boolean) {
  return useQuery({
    queryKey: [FINISHED_RUN_COUNTS_KEY, id],
    queryFn: async (): Promise<FinishedRunRead> => {
      const [counts, sessionIds] = await Promise.all([fetchFinishedRunCounts(id), fetchFinishedRunSessionIds(id)])
      return { counts, sessionIds }
    },
    enabled: enabled && !!id,
    // Like every read this confirmation depends on, it runs when it is asked for and says so when it fails, rather than waiting on TanStack's
    // own idea of the connection (the confirmation decides `enabled` from the phone's, and says "offline" itself).
    networkMode: 'always',
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })
}

// Chunk 66 and chunk 75: DELETE THIS FINISHED PROGRAM (PR15) and History's program-filter delete both come here (`FullDeleteConfirm`), and the finished
// page navigates to PROGRAMS the moment the delete resolves. So, like START and FINISH (chunk 65): `networkMode: 'always'` (CONTEXT.md, Offline:
// every write mutation is; deleting is online-only, so offline it fails with the real reason, SPEC Errors (15), instead of pausing for ever behind
// DELETING…), and the invalidations are returned, so the mutation stays pending until the lists have been read again and PROGRAMS doesn't open on
// the list as it was, with the deleted program still under FINISHED. A refetch that fails doesn't fail a delete that happened.
//
// The request is `v2_delete_finished_run` and nothing else. Once it has gone through (never before: a delete that fails drops nothing) the phone's
// queue is cleaned inside `mutationFn`, as History's session delete does (queue-fix 230): `dropQueuedWritesOfDeletedRun` takes the queued writes
// that name each of the program's sessions (the ids read with the counts, and the ones only the queue knows) and the notes queued on them. It never
// throws, so a clean-up the phone's database refuses is logged and doesn't turn a delete that happened into a failed one. Then the caches
// (`finishedRunCaches.ts`: History's session delete and the finish together, and Coach's lists).
export function useDeleteFinishedRun() {
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ id, sessionIds }: { id: string; sessionIds: readonly string[] }) => {
      await deleteFinishedRun(id)
      return dropQueuedWritesOfDeletedRun(id, sessionIds)
    },
    onSuccess: (dealtWith) => {
      for (const queryKey of finishedRunRemovals(dealtWith)) queryClient.removeQueries({ queryKey })
      return Promise.all(finishedRunInvalidations().map((queryKey) => queryClient.invalidateQueries({ queryKey })))
    },
  })
}
