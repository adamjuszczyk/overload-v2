import type { Program } from '../../types'
import { useWorkoutDays, useSequenceItems } from './usePrograms'
import { hasScheduledWorkout } from './hasSchedule'

// Chunk 33 (SPEC.md Programs and runs [P1.1], G39) — whether a program has a
// scheduled workout, read the way every START needs it: the planner's own, and
// the Programs page's sheet (a saved program's START there starts a run
// without opening the planner). hasSchedule.ts is the rule; this only gathers
// what it reads (the program's workouts, and, for a sequence program only, its
// sequence — a weekday program makes no sequence read at all).
//
// null = not known yet (no program, or a read that hasn't answered): a START
// must wait for the answer and show no reason line meanwhile, rather than flash
// "Schedule at least one workout to start" on a program that has one.
export function useProgramHasSchedule(program: Program | null | undefined): boolean | null {
  const programId = program?.id ?? ''
  const isSequence = (program?.scheduleType ?? 'weekday') === 'sequence'
  const { data: workoutDays } = useWorkoutDays(programId)
  const { data: sequenceItems } = useSequenceItems(isSequence ? programId : '')

  if (!program || workoutDays === undefined) return null
  if (isSequence && sequenceItems === undefined) return null
  return hasScheduledWorkout({
    scheduleType: program.scheduleType,
    schedule: program.schedule,
    workoutDays,
    sequenceItems: sequenceItems ?? [],
  })
}
