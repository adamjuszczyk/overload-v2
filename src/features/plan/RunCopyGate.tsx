import type { ReactNode } from 'react'
import type { ProgramExercise } from '../../types'
import { useProgramSets } from '../planner/usePlanner'
import type { RunCopy } from './weekPlanning'

// Chunk 54b (replaces chunk 31's WeekDiffGate). Plan already holds everything a week is compared with except one thing: the run copy's
// SETS, which a stable week's marks and its "THIS WEEK ONLY" lines are compared with (the default's set count, kinds, stages and rep
// targets). This is where they are read, and only for a week that needs them: a week-dependent week is compared with last week's plan,
// which Plan already has (useAllWeekPlans), and makes no read for it. A hook can't be conditional, so the read is a component of its
// own, mounted only then.
//
// Until the run copy has been read (its exercises or its sets) it hands `null` on: no marks and no THIS WEEK ONLY at all, rather than a
// wrong one (everything "added" against a list that simply hasn't arrived). A run copy with no exercises has no sets to read, and is
// compared as it is: empty.

export function RunCopyGate({
  needed,
  runCopyExercises,
  children,
}: {
  needed: boolean
  // The run's copy of this workout (its current exercises, in program order), or undefined while it hasn't been read.
  runCopyExercises: ProgramExercise[] | undefined
  children: (runCopy: RunCopy | null) => ReactNode
}) {
  if (!needed) return <>{children(null)}</>
  if (runCopyExercises === undefined) return <>{children(null)}</>
  if (runCopyExercises.length === 0) return <>{children({ exercises: [], sets: [] })}</>
  return <RunCopySetsReader exercises={runCopyExercises}>{children}</RunCopySetsReader>
}

function RunCopySetsReader({ exercises, children }: { exercises: ProgramExercise[]; children: (runCopy: RunCopy | null) => ReactNode }) {
  // Every set of the run's copy comes back, the ones the default has dropped (`removedAt`) included: the comparisons leave those out.
  const { data } = useProgramSets(exercises.map((pe) => pe.id))
  return <>{children(data === undefined ? null : { exercises, sets: data })}</>
}
