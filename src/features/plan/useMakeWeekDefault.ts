import { useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { makeWeekDefault, fetchRunCopyDefaults } from './makeDefaultService'
import type { DefaultExercise, MakeDefaultResult } from './makeWeekDefault'

// Chunk 32 — "Make this week the new default" (SPEC Weeks and copying [P1.1]).
//
// networkMode 'always' (the house rule for write mutations): under the default 'online'
// TanStack Query pauses an offline mutation instead of running it, so the confirm would
// hang. The action is online-only; offline the call fails and the error is shown.
//
// What it returns: the call's answer (the old default of every workout whose default it
// rewrote) and the NEW default of those workouts, read from the run's copy afterwards —
// what "Apply this change to planned weeks ahead" turns into change records. That second
// read is best effort: the default is already written by then (and cannot be undone), so
// a read that fails is `null` here and means "no offer", never a failed action. An error
// of the call itself is thrown as it came and nothing has been written.
export interface MakeWeekDefaultOutcome {
  result: MakeDefaultResult
  newDefaults: Map<string, DefaultExercise[]> | null
}

export function useMakeWeekDefault(mesoId: string) {
  return useMutation({
    networkMode: 'always',
    mutationFn: async ({ weekNumber }: { weekNumber: number }): Promise<MakeWeekDefaultOutcome> => {
      const result = await makeWeekDefault(mesoId, weekNumber)
      let newDefaults: Map<string, DefaultExercise[]> | null = null
      if (result.workouts.length > 0) {
        try {
          newDefaults = await fetchRunCopyDefaults(result.workouts.map((w) => w.workoutDayId))
        } catch {
          newDefaults = null
        }
      }
      return { result, newDefaults }
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
