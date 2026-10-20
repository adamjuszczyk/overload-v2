import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { fetchProgramExercises } from '../programs/programService'
import { fetchProgramSets } from '../planner/plannerService'
import type { ProgramSet } from '../../types'
import { planWeek } from './weekPlanService'

// Chunk 52 (TASKS-1.2 "Plan's header" → PlanForwardCard; SPEC Weeks and copying [1.2]: "when a week (cycle) gets planned: when it
// starts, or earlier when the user taps PLAN FORWARD on it. Opening it doesn't plan it").

// PLAN FORWARD: plans the one week the caller names (PlanPage passes the week of `weekTiles`' `planForward` tile, never the current
// week plus one or the highest planned week plus one), through the same RPC the current week is planned by. `networkMode: 'always'`
// (every write mutation): offline the call fails and the card shows the error, instead of pausing on "PLANNING…" for good.
//
// The mutation settles only when the lists have been read again: the week's own plans and the run's whole list (which the week
// tiles are drawn from). So a card never stays over a week that has just been planned, and the week after it is already a tile when
// the button comes back.
export function usePlanForward(mesoId: string) {
  return useMutation({
    networkMode: 'always',
    mutationFn: async (weekNumber: number) => {
      const planned = await planWeek(mesoId, weekNumber)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['v2_weekPlans', mesoId, weekNumber] }),
        queryClient.invalidateQueries({ queryKey: ['v2_allWeekPlans', mesoId] }),
      ])
      return planned
    },
  })
}

// P1.2-10 (provisional, D31): a stable run plans its weeks from its default, so when the default holds no set at all in the workouts
// the week will have, PLAN FORWARD has nothing to plan from. A set the default dropped (`removedAt`) is not part of it.
export function defaultHasSets(sets: readonly Pick<ProgramSet, 'removedAt'>[]): boolean {
  return sets.some((set) => set.removedAt == null)
}

// Read only when the card is on a stable run. The key sits under the program sets' own prefix, so the planner's writes and CHANGE THE
// PROGRAM's save (which invalidate `v2_programSets`) refresh it.
export function useDefaultHasSets(workoutDayIds: readonly string[], enabled: boolean) {
  const { user } = useAuth()
  const ids = [...new Set(workoutDayIds)].sort()
  return useQuery({
    queryKey: ['v2_programSets', 'defaultHasSets', ids.join(',')],
    queryFn: async () => {
      const exercises = (await Promise.all(ids.map((id) => fetchProgramExercises(id)))).flat()
      return defaultHasSets(await fetchProgramSets(exercises.map((exercise) => exercise.id)))
    },
    enabled: enabled && !!user && ids.length > 0,
  })
}
