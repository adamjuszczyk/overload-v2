import type { MuscleGroup, StageVolumeRule, WeekPlan, WeeklySchedule } from '../../types'
import { MUSCLE_GROUP_LABELS } from '../../lib/exerciseTags'
import { DAYS_ORDER } from './weekViewLogic'

// Chunk 55 (TASKS-1.2 "VOLUME"; SPEC [1.2] Volume per muscle (14); board 3): what the VOLUME sheet decides apart from the counting, which is
// chunk 44's `volumeRows`, and which only `VolumeSheet.tsx` may import (G51's test). Pure, so each rule is tested once, here, and the sheet only
// draws what these say.

/**
 * How many sessions a week's plan row stands for: the weekdays of the schedule in force that week that hold its workout (a G14 workout on
 * Tue and Thu shares one plan row and is two sessions, so its sets count twice). A sequence run has no weekday schedule (`null`): each slot is
 * its own plan row and one session. A workout the week's schedule no longer holds on any day stands for none.
 */
export function occurrencesOf(plan: Pick<WeekPlan, 'workoutDayId'>, schedule: WeeklySchedule | null): number {
  if (schedule === null) return 1
  return DAYS_ORDER.filter((day) => schedule[day] === plan.workoutDayId).length
}

/**
 * Every exercise a planned set or a log can name, with its muscle group: the exercises last week's logs name (a swap or an exercise added in
 * the session), read when the sheet opened, then the plans' own exercise lists (this week's and last week's) for the rest. The plans' joined
 * exercise can be older than the read (Plan keeps its weeks for minutes), so where both name one, the read's group counts. One that is on
 * neither side isn't counted under a group (`volumeRows` files it under Other).
 */
export function volumeExercises(
  plans: ReadonlyArray<Pick<WeekPlan, 'exercises'>>,
  logged: ReadonlyArray<{ id: string; muscleGroup: MuscleGroup }>,
): Array<{ id: string; muscleGroup: MuscleGroup }> {
  const byId = new Map<string, MuscleGroup>()
  for (const exercise of logged) if (!byId.has(exercise.id)) byId.set(exercise.id, exercise.muscleGroup)
  for (const plan of plans) {
    for (const row of plan.exercises) {
      if (row.exercise && !byId.has(row.exerciseId)) byId.set(row.exerciseId, row.exercise.muscleGroup)
    }
  }
  return [...byId].map(([id, muscleGroup]) => ({ id, muscleGroup }))
}

/**
 * P1.2-2 (D31): "VOLUME when last week has no sessions at all (planned forward from an empty week): last week's column shows '—' for every
 * muscle". Read as an empty week (DECISIONS 42, 131): no plan row of it holds a set and no session of it exists. A week that was planned and
 * not done is not empty: it counts what it counts (0 once it has ended, its plan while it runs: DECISIONS 133), with its "YOU PLANNED" notes.
 */
export function lastWeekIsEmpty(lastWeek: ReadonlyArray<Pick<WeekPlan, 'sets'>>, sessionCount: number): boolean {
  return sessionCount === 0 && lastWeek.every((plan) => plan.sets.length === 0)
}

/** Board 3's rows are muscle groups written as words: `Chest`, `Other` (the app's labels are upper case). */
export function muscleName(muscle: MuscleGroup): string {
  const label = MUSCLE_GROUP_LABELS[muscle]
  return label.charAt(0) + label.slice(1).toLowerCase()
}

/** What a drop counts as, in the footer's words: the rule's own fraction (TASKS 55). */
const DROP_WORDS: Record<StageVolumeRule, string> = {
  whole: "doesn't count",
  each: 'counts as 1 set',
  half: 'counts as ½ set',
}

/** Board 3's footer, with last week's name and the Settings rule's own fraction. */
export function volumeFooter({ unit, lastWeek, rule }: { unit: 'week' | 'cycle'; lastWeek: number; rule: StageVolumeRule }): string {
  const name = unit === 'week' ? 'Week' : 'Cycle'
  return `${name} ${lastWeek} counts the sets you actually did. Warmups don't count. A drop ${DROP_WORDS[rule]} — you can change that in Settings.`
}
