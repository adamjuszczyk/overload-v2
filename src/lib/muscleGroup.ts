import type { MuscleGroup } from '../types'

// v1 rows can have a null muscle_group (the column was added for v2 and
// backfilled after the fact). Treat missing values as 'other' instead of
// letting a null reach .toUpperCase() and crash the UI.
export function toMuscleGroup(raw: string | null | undefined): MuscleGroup {
  return (raw as MuscleGroup) ?? 'other'
}
