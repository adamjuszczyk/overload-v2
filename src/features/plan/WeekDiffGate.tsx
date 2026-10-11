import type { ReactNode } from 'react'
import type { ProgramExercise, ProgramSet } from '../../types'
import { useProgramSets } from '../planner/usePlanner'
import type { WeekDiff } from './weekDiff'

// Chunk 31 (TASKS-1.1 "Differences from the week's source are highlighted").
// Plan already holds everything a week is compared with except one thing: the run
// copy's SETS, which week 1 of either type and every stable week are compared with
// (their rep targets, warmups, stages and set count). This is where they are read —
// and only for a week that is compared with the run's copy: a week-dependent week
// after week 1 is compared with last week, which Plan already has (useAllWeekPlans),
// and makes no read for it. A hook can't be conditional, so the read is a component
// of its own, mounted only then.
//
// Until the run's copy has been read (its exercises or its sets), nothing is
// compared: no highlighting at all rather than a wrong one (everything "added"
// against a list that simply hasn't arrived). A run copy with no exercises has no
// sets to read, and is compared as it is: empty.

type RunCopy = { exercises: ProgramExercise[]; programSets: ProgramSet[] }

export function WeekDiffGate({
  needsRunCopy,
  runCopyExercises,
  compute,
  children,
}: {
  needsRunCopy: boolean
  // The run's copy of this workout (its current exercises, in program order), or
  // undefined while it hasn't been read.
  runCopyExercises: ProgramExercise[] | undefined
  // weekDiff.ts's computeWeekDiff for this week, given the run's copy when it needs it.
  compute: (runCopy: RunCopy | null) => WeekDiff | null
  children: (diff: WeekDiff | null) => ReactNode
}) {
  if (!needsRunCopy) return <>{children(compute(null))}</>
  if (runCopyExercises === undefined) return <>{children(null)}</>
  if (runCopyExercises.length === 0) return <>{children(compute({ exercises: [], programSets: [] }))}</>
  return (
    <RunCopySetsReader exercises={runCopyExercises} compute={compute}>
      {children}
    </RunCopySetsReader>
  )
}

function RunCopySetsReader({
  exercises,
  compute,
  children,
}: {
  exercises: ProgramExercise[]
  compute: (runCopy: RunCopy | null) => WeekDiff | null
  children: (diff: WeekDiff | null) => ReactNode
}) {
  // Every set of the run's copy comes back, the ones the default has dropped
  // (`removedAt`) included: weekDiff.ts leaves those out of the comparison.
  const { data } = useProgramSets(exercises.map((pe) => pe.id))
  return <>{children(data === undefined ? null : compute({ exercises, programSets: data }))}</>
}
