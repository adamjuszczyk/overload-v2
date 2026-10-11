import { useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { makeWeekDefault } from './makeDefaultService'

// Chunk 32 — "Make this week the new default" (SPEC Weeks and copying [P1.1]).
//
// networkMode 'always' (the house rule for write mutations): under the default 'online'
// TanStack Query pauses an offline mutation instead of running it, so the confirm would
// hang. The action is online-only; offline the call fails and the error is shown.
//
// It returns the call's answer (which workouts kept their default) and does nothing else:
// no read of the new default, no write to any other week. An error of the call is thrown
// as it came and nothing has been written.
export function useMakeWeekDefault(mesoId: string) {
  return useMutation({
    networkMode: 'always',
    mutationFn: ({ weekNumber }: { weekNumber: number }) => makeWeekDefault(mesoId, weekNumber),
    // The call rewrote the run's copy and the source sessions' links to it: whatever
    // shows the run's copy (the program tab's list, the program sets every reader holds,
    // the exercise rows) and every cached week plan (the source sessions' sets point at
    // other program sets now; Plan's highlighting compares weeks with the copy) is stale.
    // Returned, so the mutation stays pending until they have refetched: the screen is
    // fresh by the time the button is live again.
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
