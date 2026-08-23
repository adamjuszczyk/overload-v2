import type { MovementPattern, MuscleGroup, MuscleSubgroup, WeekAnalysisBucket } from '../../types/index.js'

// Pure tag bucketing (COACH-WEEK-ANALYSIS-TASKS.md §4 step 4 / §1.6).
// Mechanical regrouping only, per SPEC §5's "mechanical regrouping, not
// blending" — every occurrence's real numbers travel unmodified into every
// bucket it belongs to. This module computes NO aggregate of any kind. Not
// a style preference: §1.6 states it as a hard constraint, because a
// per-muscle-group blended number is exactly the metric SPEC §5/§8 rejects
// outright. Grouping only, nothing that averages more than one occurrence
// together, ever.

// Local input contract — deliberately narrower than the eventual
// WeekAnalysisOccurrence (TASKS §3.2): this module only needs an
// occurrence's identity and its tags, never its match/reference data. Same
// locally-scoped-input convention positionMatch.ts already uses for its own
// pure-module contracts, rather than putting an internal shape in
// types/index.ts.
export interface TaggableOccurrence {
  occurrenceId: string
  exerciseId: string
  // null exactly when no `exercises` row was found for this occurrence at
  // all (TASKS §7.12 — structurally possible, not just theoretical, since
  // v2_program_exercises.exercise_id carries no user scoping). Kept
  // distinct from "a row exists but every tag on it is empty" so the
  // fallback logic below has exactly one thing to check, not two.
  tags: {
    muscleGroup: MuscleGroup | null
    muscleSubgroups: MuscleSubgroup[] | null
    movementPattern: MovementPattern | null
  } | null
}

export interface BucketedOccurrence {
  occurrenceId: string
  exerciseId: string
  // Which bucket keys (subgroup and/or pattern) this occurrence landed in —
  // code's mechanical decision, never the model's (SPEC §8).
  bucketKeys: string[]
}

export interface WeekBuckets {
  occurrences: BucketedOccurrence[]
  bySubgroup: WeekAnalysisBucket[]
  byPattern: WeekAnalysisBucket[]
}

const UNTAGGED_LABEL = 'untagged'

interface SubgroupSlot {
  key: string
  label: string
  isFallback: boolean
}

// SPEC §5's fallback chain: real muscle_subgroup tags (one bucket per tag,
// unmodified and in full — a multi-tagged exercise appears in every bucket
// it names) -> muscleGroup fallback -> 'untagged' when there is nothing at
// all to fall back to (no tags row, TASKS §7.12; or a tags row with
// muscleGroup itself null).
function subgroupSlotsFor(occ: TaggableOccurrence): SubgroupSlot[] {
  if (!occ.tags) {
    return [{ key: `subgroup:${UNTAGGED_LABEL}`, label: UNTAGGED_LABEL, isFallback: true }]
  }
  const { muscleSubgroups, muscleGroup } = occ.tags
  if (muscleSubgroups && muscleSubgroups.length > 0) {
    return muscleSubgroups.map((sg) => ({ key: `subgroup:${sg}`, label: sg, isFallback: false }))
  }
  const fallbackLabel = muscleGroup ?? UNTAGGED_LABEL
  return [{ key: `subgroup:${fallbackLabel}`, label: fallbackLabel, isFallback: true }]
}

interface PatternSlot {
  key: string
  label: string
}

// §7.9 — movement_pattern has no fallback, unlike muscle_subgroup. No tags
// row, or a null pattern, means this occurrence simply doesn't appear on
// the pattern axis at all — never a manufactured 'unknown' bucket that
// would look like a real, populated category.
function patternSlotFor(occ: TaggableOccurrence): PatternSlot | null {
  const pattern = occ.tags?.movementPattern
  if (!pattern) return null
  return { key: `pattern:${pattern}`, label: pattern }
}

export function bucketOccurrences(occurrences: TaggableOccurrence[]): WeekBuckets {
  const subgroupBuckets = new Map<string, WeekAnalysisBucket>()
  const patternBuckets = new Map<string, WeekAnalysisBucket>()
  const bucketed: BucketedOccurrence[] = []

  for (const occ of occurrences) {
    const bucketKeys: string[] = []

    for (const slot of subgroupSlotsFor(occ)) {
      let bucket = subgroupBuckets.get(slot.key)
      if (!bucket) {
        bucket = { key: slot.key, kind: 'muscle_subgroup', label: slot.label, isFallback: slot.isFallback, occurrenceIds: [] }
        subgroupBuckets.set(slot.key, bucket)
      }
      bucket.occurrenceIds.push(occ.occurrenceId)
      bucketKeys.push(slot.key)
    }

    const patternSlot = patternSlotFor(occ)
    if (patternSlot) {
      let bucket = patternBuckets.get(patternSlot.key)
      if (!bucket) {
        bucket = { key: patternSlot.key, kind: 'movement_pattern', label: patternSlot.label, isFallback: false, occurrenceIds: [] }
        patternBuckets.set(patternSlot.key, bucket)
      }
      bucket.occurrenceIds.push(occ.occurrenceId)
      bucketKeys.push(patternSlot.key)
    }

    bucketed.push({ occurrenceId: occ.occurrenceId, exerciseId: occ.exerciseId, bucketKeys })
  }

  return {
    occurrences: bucketed,
    bySubgroup: [...subgroupBuckets.values()],
    byPattern: [...patternBuckets.values()],
  }
}
