// Real kg↔lbs conversion (v3 §2.4, fixes AUDIT E5 — SetRow.tsx used to render
// `{weightUnit}` as a label and never actually convert). Canonical storage is
// always kg; every other unit is a display/entry concern layered on top.
import type { WeightUnit } from '../types'

// The internationally defined exact pound, used as the single source of
// truth for both directions — kgToLbs divides by it, lbsToKg multiplies by
// it, so they're true inverses at full float precision rather than two
// independently-rounded approximations of each other.
const KG_PER_LB = 0.45359237

export function kgToLbs(kg: number): number {
  return Math.round((kg / KG_PER_LB) * 10) / 10
}

export function lbsToKg(lbs: number): number {
  return Math.round(lbs * KG_PER_LB * 100) / 100
}

// Rounding matches the storage column (numeric(6,2)): lbs display to 1
// decimal, kg display to 2.
export function toDisplayWeight(storedKg: number, unit: WeightUnit): number {
  return unit === 'kg' ? Math.round(storedKg * 100) / 100 : kgToLbs(storedKg)
}

// The write-time counterpart — converts a value entered in `unit` back to kg
// for storage.
export function toStorageWeight(enteredValue: number, unit: WeightUnit): number {
  return unit === 'kg' ? Math.round(enteredValue * 100) / 100 : lbsToKg(enteredValue)
}

// Resolution order (TASKS.md §2.4 / §4 item 28):
// v2_program_exercises.weight_unit → v2_user_settings.weight_unit → 'kg'.
export function resolveWeightUnit(
  programExerciseUnit: WeightUnit | null | undefined,
  globalUnit: WeightUnit | null | undefined,
): WeightUnit {
  return programExerciseUnit ?? globalUnit ?? 'kg'
}

// Volume (Σ weight×reps) scales linearly with the same kg↔lbs factor as a
// single weight value — reps are unit-independent, and the conversion
// factor distributes over the sum: Σ(kg × factor × reps) = factor × Σ(kg ×
// reps). Unlike toDisplayWeight, this has no fixed decimal rounding —
// callers already round a volume total to whatever precision they display
// it at (e.g. Math.round for a whole-number total).
export function toDisplayVolume(storedKgVolume: number, unit: WeightUnit): number {
  return unit === 'kg' ? storedKgVolume : storedKgVolume / KG_PER_LB
}

// Edit round-trip guard (v3 §2.4's stated risk): re-deriving kg from a
// *rounded display* value drifts — 100kg -> 220.5lbs -> lbsToKg(220.5) is
// 100.01kg, not 100. If the value being saved is exactly what `originalKg`
// would already display as (i.e. the user didn't actually change the
// number), the original kg is returned untouched instead of reconstructed
// from the lossy display figure — the round-trip goes through the stored kg
// value, never through the displayed one. Only a genuinely different typed
// value gets converted (and rounded) fresh.
export function resolveEditedWeightKg(
  originalKg: number,
  unit: WeightUnit,
  editedDisplayValue: number,
): number {
  if (toDisplayWeight(originalKg, unit) === editedDisplayValue) return originalKg
  return toStorageWeight(editedDisplayValue, unit)
}
