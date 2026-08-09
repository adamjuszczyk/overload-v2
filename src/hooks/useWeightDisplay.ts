// Wraps src/lib/weightUnit.ts's pure conversion for components (TASKS.md §4
// item 27). Resolution order: an explicit per-program-exercise unit wins;
// omitting it (or passing null/undefined — "inherit") falls back to the
// global Settings unit, per TASKS.md §2.4 / §4 item 28. Progress and History
// call this with no argument, which resolves straight to the global Settings
// unit (SPEC §8.1 — "All Progress/History numbers convert to the Settings
// unit for display").
import { useSettingsStore } from '../features/settings/settingsStore'
import {
  resolveWeightUnit,
  toDisplayWeight,
  toStorageWeight,
  resolveEditedWeightKg,
  toDisplayVolume,
} from '../lib/weightUnit'
import type { WeightUnit } from '../types'

export function useWeightDisplay(programExerciseUnit?: WeightUnit | null) {
  const globalUnit = useSettingsStore((s) => s.weightUnit)
  const unit = resolveWeightUnit(programExerciseUnit, globalUnit)

  return {
    unit,
    toDisplay: (storedKg: number) => toDisplayWeight(storedKg, unit),
    toStorage: (enteredValue: number) => toStorageWeight(enteredValue, unit),
    resolveEdited: (originalKg: number, editedDisplayValue: number) =>
      resolveEditedWeightKg(originalKg, unit, editedDisplayValue),
    toDisplayVolume: (storedKgVolume: number) => toDisplayVolume(storedKgVolume, unit),
  }
}
