import type { DayOfWeek, ScheduleType, WeeklySchedule } from '../../types'

// Chunk 33 (SPEC.md Programs and runs [P1.1], G39): "Starting a run needs a
// schedule: at least one workout on a weekday (`weekday`), or one workout in
// the sequence (`sequence`). Start isn't possible without one." The ONE check
// every START and Plan's no-schedule line share, so the two can never
// disagree about whether a program has a schedule:
//   - the planner's START (PlannerPage.tsx);
//   - the Programs page's START RUN sheet (ProgramsPage.tsx);
//   - Plan's "NO WORKOUTS SCHEDULED" line for a run started before Start
//     needed one (PlanPage.tsx).
//
// "A workout" is a workout that exists: a weekday (or a slot) pointing at a
// workout day the program no longer has doesn't count, which is also what Plan
// has always drawn (its switcher lists only the weekdays and slots that
// resolve to a workout). The schedule type decides which list is read: a
// sequence program is scheduled by its sequence alone and a weekday program by
// its weekday map alone, so a stale weekday map left under a program that was
// switched to a sequence (the switch converts nothing) never makes it startable.
const WEEKDAYS: readonly DayOfWeek[] = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]

export interface ScheduleInputs {
  // Undefined (or null) reads as 'weekday', the column default every program
  // predating the schedule type has.
  scheduleType?: ScheduleType | null
  // v2_programs.schedule: a workout day id (or null) per weekday. Only read
  // for a weekday program.
  schedule?: Partial<WeeklySchedule> | null
  // The program's own workouts.
  workoutDays: readonly { id: string }[]
  // v2_program_sequence_items: a workout day id, or null for a rest slot. Only
  // read for a sequence program.
  sequenceItems: readonly { workoutDayId: string | null }[]
}

export function hasScheduledWorkout({ scheduleType, schedule, workoutDays, sequenceItems }: ScheduleInputs): boolean {
  const workoutIds = new Set(workoutDays.map((day) => day.id))
  if ((scheduleType ?? 'weekday') === 'sequence') {
    return sequenceItems.some((item) => item.workoutDayId !== null && workoutIds.has(item.workoutDayId))
  }
  return WEEKDAYS.some((dow) => {
    const workoutDayId = schedule?.[dow]
    return !!workoutDayId && workoutIds.has(workoutDayId)
  })
}

// The reason line under a START that can't start (DECISIONS 85, provisional).
export const NO_SCHEDULE_START_REASON = 'Schedule at least one workout to start'
