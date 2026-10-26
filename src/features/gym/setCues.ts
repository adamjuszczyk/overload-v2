// Chunk 61 (TASKS-1.2 61; SPEC [1.2] Tags / cues: "A cue edited during a workout changes that set in this week's plan; a workout on days that share
// one plan shows it on both"): what CUES in the set ⋯ writes. The writes are Plan's: `cuePatches` (`planSetRows.ts`) makes the list from what the
// cues sheet returned, `updateSet` (`weekPlanService.ts`) sends each one to the week set's `tags`. Nothing is written to the log, and nothing to
// any other week's row: a cue is on this week's plan row, "never copied, so this week only".
//
// The workout shows a set's cues from the week plan it was handed (Today's scheduler reads `['v2_weekPlans', mesoId, week]` and the run's every-week
// list `['v2_allWeekPlans', mesoId]`), so the new tags go into both at once and both are read again when the writes are done, whichever of them the
// screen is drawing from. A write that is refused puts the old tags back and is thrown.
import { queryClient } from '../../lib/queryClient'
import type { WeekPlan } from '../../types'
import type { SetPatch } from '../plan/planSetRows'
import { updateSet } from '../plan/weekPlanService'

const keysOf = (mesocycleId: string) => [['v2_weekPlans', mesocycleId], ['v2_allWeekPlans', mesocycleId]] as const

const withTags = (plans: WeekPlan[] | undefined, patches: readonly SetPatch[]): WeekPlan[] | undefined =>
  plans?.map((plan) => ({
    ...plan,
    sets: plan.sets.map((set) => {
      const patch = patches.find((p) => p.id === set.id)
      return patch !== undefined && 'tags' in patch.changes ? { ...set, tags: patch.changes.tags } : set
    }),
  }))

/** Writes the cue patches of one edit, in order, one request each; the first refusal stops the rest, puts every cache back and is thrown. */
export async function writeCuePatches(patches: readonly SetPatch[], mesocycleId: string | null): Promise<void> {
  if (patches.length === 0) return
  const keys = mesocycleId === null ? [] : keysOf(mesocycleId)
  const before = keys.flatMap((queryKey) => queryClient.getQueriesData<WeekPlan[]>({ queryKey }))
  for (const queryKey of keys) queryClient.setQueriesData<WeekPlan[]>({ queryKey }, (old) => withTags(old, patches))
  try {
    for (const patch of patches) await updateSet(patch.id, patch.changes)
  } catch (err) {
    for (const [queryKey, data] of before) queryClient.setQueryData(queryKey, data)
    throw err
  } finally {
    for (const queryKey of keys) void queryClient.invalidateQueries({ queryKey })
  }
}
