import { useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { makeWeekDefault, fetchRunCopyDefaults, fetchSourceSetLinks } from './makeDefaultService'
import type { DefaultExercise, MakeDefaultResult, SourceSetLinks } from './makeWeekDefault'

// Chunk 32 — "Make this week the new default" (SPEC Weeks and copying [P1.1]).
//
// networkMode 'always' (the house rule for write mutations): under the default 'online'
// TanStack Query pauses an offline mutation instead of running it, so the confirm would
// hang. The action is online-only; offline the call fails and the error is shown.
//
// What it returns: the call's answer (the old default of every workout whose default it
// rewrote), the NEW default of those workouts, read from the run's copy afterwards — what
// "Apply this change to planned weeks ahead" turns into change records — and what the
// source sessions' planned sets name now (`sourceAfter`, by session id), which with what
// they named before the call pairs the sets of a swapped slot exactly. Those two reads are
// best effort: the default is already written by then (and cannot be undone), so a read
// that fails is `null` here. No new default means "no offer", never a failed action; no
// `sourceAfter` means a swapped slot's sets are paired by ordinal within kind instead.
// An error of the call itself is thrown as it came and nothing has been written.
export interface MakeWeekDefaultOutcome {
  result: MakeDefaultResult
  newDefaults: Map<string, DefaultExercise[]> | null
  sourceAfter?: Map<string, SourceSetLinks> | null
}

export function useMakeWeekDefault(mesoId: string) {
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ weekNumber }: { weekNumber: number }): Promise<MakeWeekDefaultOutcome> => {
      const result = await makeWeekDefault(mesoId, weekNumber)
      if (result.workouts.length === 0) return { result, newDefaults: null, sourceAfter: null }
      // Each read on its own: one that fails is null, whatever it failed with.
      const readOrNull = async <T>(read: () => Promise<T>): Promise<T | null> => {
        try {
          return await read()
        } catch {
          return null
        }
      }
      const [newDefaults, sourceAfter] = await Promise.all([
        readOrNull<Map<string, DefaultExercise[]>>(() => fetchRunCopyDefaults(result.workouts.map((w) => w.workoutDayId))),
        readOrNull<Map<string, SourceSetLinks>>(() => fetchSourceSetLinks(result.workouts.map((w) => w.sourceWeekPlanId))),
      ])
      return { result, newDefaults, sourceAfter }
    },
    // The call rewrote the run's copy and the source sessions' links to it: whatever
    // shows the run's copy (the program tab's list, the program sets every reader holds,
    // the exercise rows) and every cached week plan (the source sessions' sets point at
    // other program sets now; Plan's highlighting compares weeks with the copy) is stale.
    // Returned, so the mutation stays pending until they have refetched: the offer that
    // follows is built from the data the screen then shows.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2_programExercises'] }),
        queryClient.invalidateQueries({ queryKey: ['v2_programSets'] }),
        queryClient.invalidateQueries({ queryKey: ['v2_weekPlans'] }),
        queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans'] }),
        queryClient.invalidateQueries({ queryKey: ['v2_weekPlan'] }),
      ]),
  })
}
