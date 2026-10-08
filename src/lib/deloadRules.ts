// Chunk 22 (TASKS.md "Deload rules" / SPEC.md "Deload [P1]") — the pure
// deload-rules engine: validating the stored shape, resolving which rules
// are effective (program override vs. global default), finding the base
// occurrence a deload session is calculated from, and the calculator
// itself. No React, no Supabase — same precedent as plannerVocabulary.ts/
// weekSources.ts/applyAhead.ts (this codebase's existing pure-logic
// modules); the I/O that gathers what these functions need, and the writes
// that apply their output, live in weekPlanService.ts.
//
// Scope boundary (reviewer's notes, chunk 22): this file owns the RULES
// SHAPE, the CALCULATION, and the BASE-OCCURRENCE WALK-BACK. It does not
// decide "has this head got stages" from a join (setGroupLogic.ts's own
// job elsewhere) — callers already hand this module per-row shapes that
// carry their own parentId/stageIndex, and grouping here is a small local
// re-derivation (not an import of setGroupLogic.ts — see the note above
// calculateDeloadSets) so this module stays a standalone src/lib leaf.

import {
  columnsToRepTarget,
  repTargetToColumns,
  type RepTarget,
  type StageKind,
} from './plannerVocabulary.js'
import { kgToLbs, lbsToKg } from './weightUnit'

// ─── Shape (TASKS.md "Data models" — "Deload rules shape") ────────────────
// An absent key means that rule is off. Validated in full by
// validateDeloadRules below; nothing elsewhere in the app constructs one of
// these by hand except through that function or this module's own
// calculator inputs.

export type DeloadRounding = 'down' | 'up'

export interface DeloadSetsRule {
  mode: 'percent' | 'count'
  value: number
  rounding: DeloadRounding
}

export interface DeloadWeightRule {
  percent: number
  rounding: DeloadRounding
  step: number
  stepUnit: 'kg' | 'lbs'
}

export interface DeloadRepsRule {
  delta: number
}

export interface DeloadRirRule {
  delta: number
}

export interface DeloadRules {
  sets?: DeloadSetsRule
  weight?: DeloadWeightRule
  reps?: DeloadRepsRule
  rir?: DeloadRirRule
}

// ─── Validation ─────────────────────────────────────────────────────────────
// Conservative-parsing judgement call (same posture as plannerVocabulary.ts's
// own parseRepTarget/normaliseTempo): a value that doesn't match the shape
// rejects the WHOLE object (returns null), rather than silently dropping
// just the bad key and keeping the rest. This column is written only by
// this app's own editor (DeloadRulesEditor.tsx / the program override), so
// a malformed value only ever means corrupted/foreign data — treating it
// the same as "no rules on" is the safe default, never a guess at which
// part of it might still be trustworthy.

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function isRounding(v: unknown): v is DeloadRounding {
  return v === 'down' || v === 'up'
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function validateSetsRule(v: unknown): DeloadSetsRule | null {
  if (!isPlainObject(v)) return null
  if (v.mode !== 'percent' && v.mode !== 'count') return null
  if (!isFiniteNumber(v.value)) return null
  if (!isRounding(v.rounding)) return null
  return { mode: v.mode, value: v.value, rounding: v.rounding }
}

function validateWeightRule(v: unknown): DeloadWeightRule | null {
  if (!isPlainObject(v)) return null
  if (!isFiniteNumber(v.percent)) return null
  if (!isRounding(v.rounding)) return null
  if (!isFiniteNumber(v.step) || v.step <= 0) return null
  if (v.stepUnit !== 'kg' && v.stepUnit !== 'lbs') return null
  return { percent: v.percent, rounding: v.rounding, step: v.step, stepUnit: v.stepUnit }
}

function validateDeltaRule(v: unknown): { delta: number } | null {
  if (!isPlainObject(v)) return null
  if (!isFiniteNumber(v.delta)) return null
  return { delta: v.delta }
}

// Rejects a malformed shape (returns null) rather than guessing at it.
// `null`/`undefined` input is valid and means "no rules on" (not rejected).
// A valid object with every key absent (`{}`) canonicalises to null too —
// same "nothing on" value either way, so a caller never has to treat the
// two differently (resolveEffectiveDeloadRules below relies on exactly
// this: a program override that is a *present but empty* object still
// validates to null, meaning "this program's own rules are all off",
// distinct from the override column itself being null, "use the global
// default" — see that function's own comment).
export function validateDeloadRules(raw: unknown): DeloadRules | null {
  if (raw === null || raw === undefined) return null
  if (!isPlainObject(raw)) return null

  const result: DeloadRules = {}

  if (raw.sets !== undefined) {
    const v = validateSetsRule(raw.sets)
    if (v === null) return null
    result.sets = v
  }
  if (raw.weight !== undefined) {
    const v = validateWeightRule(raw.weight)
    if (v === null) return null
    result.weight = v
  }
  if (raw.reps !== undefined) {
    const v = validateDeltaRule(raw.reps)
    if (v === null) return null
    result.reps = v
  }
  if (raw.rir !== undefined) {
    const v = validateDeltaRule(raw.rir)
    if (v === null) return null
    result.rir = v
  }

  if (result.sets === undefined && result.weight === undefined && result.reps === undefined && result.rir === undefined) {
    return null
  }
  return result
}

// Resolves which rules are effective (reviewer's note 1): "the run's
// v2_programs.deload_rules if non-null, else the user's
// v2_user_settings.deload_rules, else none." The precedence is decided on
// the RAW column values first (so a program override that is a validly
// *empty* object, `{}` — "this program's rules are all off" — still wins
// over a global default that has real rules on, since `{}` is non-null);
// validation runs once, after that choice, on whichever raw value won.
export function resolveEffectiveDeloadRules(
  programDeloadRules: unknown,
  userDeloadRules: unknown,
): DeloadRules | null {
  const chosenRaw = programDeloadRules ?? userDeloadRules ?? null
  return validateDeloadRules(chosenRaw)
}

// ─── Base occurrence (reviewer's note 2) ───────────────────────────────────

export interface DeloadOccurrenceRecord {
  weekNumber: number
  isDeload: boolean
  // "A session for that week plan with at least one non-skipped logged
  // working set" (reviewer's note 2) — computed by the caller (it needs
  // v2_set_logs), handed in already resolved so this stays a plain search
  // over small records, the same shape weekSources.ts's own
  // PlannedWeekRecord/findLastUsableWeek takes.
  happened: boolean
}

export type DeloadBaseResolution =
  | { kind: 'week'; weekNumber: number }
  // No usable earlier occurrence exists at all — "use the session's own
  // current planned sets as the base" (reviewer's note 2).
  | { kind: 'none' }

// That workout's most recent EARLIER occurrence, in the same run, that is
// not deload and happened. If the immediately previous one didn't happen
// (skipped, moved away, never started), walks further back. Same
// "most-recent-match wins" search as weekSources.ts's findLastUsableWeek,
// with "happened" (not "non-empty") as this chunk's own usability test —
// a planned-but-never-run week is not usable here even though copy-forward
// would happily copy its structure.
export function resolveDeloadBaseOccurrence(
  occurrences: DeloadOccurrenceRecord[],
  markedWeekNumber: number,
): DeloadBaseResolution {
  let best: number | null = null
  for (const o of occurrences) {
    if (o.weekNumber >= markedWeekNumber) continue
    if (o.isDeload) continue
    if (!o.happened) continue
    if (best === null || o.weekNumber > best) best = o.weekNumber
  }
  return best === null ? { kind: 'none' } : { kind: 'week', weekNumber: best }
}

// ─── Logged-set helpers (pure reductions over a flat v2_set_logs read) ─────
// Both consume the SAME raw log rows (a caller fetches once, by
// week_plan_set_id, across every candidate occurrence's planned sets —
// weekPlanService.ts's own comment on fetchSetLogsForPlannedSets explains
// why one combined query serves both).

export interface DeloadSetLogRecord {
  weekPlanSetId: string | null
  weight: number | null
  isSkipped: boolean
  isWarmup: boolean
  parentSetId: string | null
}

// "A non-skipped logged working set" — never a warmup, never a stage (a
// stage is never an independent set — CONTEXT.md's stage-exclusion rule).
export function occurrenceHasWorkingLog(
  logs: readonly DeloadSetLogRecord[],
  plannedSetIds: readonly string[],
): boolean {
  const ids = new Set(plannedSetIds)
  return logs.some(
    (l) => l.weekPlanSetId != null && ids.has(l.weekPlanSetId) && !l.isSkipped && !l.isWarmup && l.parentSetId == null,
  )
}

// "The weight actually logged against that planned set" (reviewer's note
// 1) — the first non-skipped log pointing at this exact planned set, or
// null if none. No stated tie-break for more than one match (a redone or
// re-logged set); first-found is this module's own, documented choice.
export function resolveLoggedWeightKg(
  logs: readonly DeloadSetLogRecord[],
  plannedSetId: string,
): number | null {
  const match = logs.find((l) => l.weekPlanSetId === plannedSetId && !l.isSkipped)
  return match?.weight ?? null
}

// ─── Calculator (reviewer's note 1) ────────────────────────────────────────

export interface DeloadSourceSet {
  id: string
  programExerciseId: string
  setNumber: number
  parentId: string | null
  stageIndex: number
  isWarmup: boolean
  stageKind: StageKind | null
  programSetId: string | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetRir: number | null
  tags: string[] | null
  isDropset: boolean
  // This set's own planned weight (kg) — the weight rule's fallback base,
  // and a warmup's (or an off weight-rule's) untouched, passed-through
  // value.
  plannedWeight: number | null
  // The weight actually logged against this exact planned set (kg), via
  // week_plan_set_id — resolveLoggedWeightKg's own result, already resolved
  // by the caller so this module needs no log rows of its own.
  loggedWeight: number | null
}

export interface DeloadCalculatedSet {
  // This calculated row's own SOURCE set id, carried through so the I/O
  // layer can remap a stage's parent to the NEW id its (also newly
  // inserted) head gets — see weekPlanService.ts's insertCalculatedPlanSets.
  sourceId: string
  parentSourceId: string | null
  programExerciseId: string
  setNumber: number
  stageIndex: number
  isWarmup: boolean
  stageKind: StageKind | null
  programSetId: string | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetRir: number | null
  tags: string[] | null
  isDropset: boolean
  targetWeight: number | null
}

// Sets rule: percent or count, rounding down/up, never below 1 — unless
// there was nothing to begin with (count 0), which stays 0 (there is no
// set left to "keep one of").
export function calculateDeloadSetCount(count: number, rule: DeloadSetsRule): number {
  if (count === 0) return 0
  const target =
    rule.mode === 'percent'
      ? (() => {
          const raw = count * (1 - rule.value / 100)
          return rule.rounding === 'down' ? Math.floor(raw) : Math.ceil(raw)
        })()
      : count - rule.value
  return Math.max(1, Math.min(count, target))
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Weight rule: percent of base, rounded down/up to a precision step in the
// rule's own unit; stored kg always. Base weight of `null` ("no base
// weight means none is set" — reviewer's note 1) short-circuits before
// this is ever called (see transformOne below).
export function calculateDeloadWeightKg(baseKg: number, rule: DeloadWeightRule): number {
  const rawKg = baseKg * (rule.percent / 100)
  const valueInStepUnit = rule.stepUnit === 'kg' ? rawKg : kgToLbs(rawKg)
  const steps = valueInStepUnit / rule.step
  const roundedSteps = rule.rounding === 'down' ? Math.floor(steps) : Math.ceil(steps)
  const roundedInStepUnit = roundedSteps * rule.step
  return rule.stepUnit === 'kg' ? round2(roundedInStepUnit) : lbsToKg(roundedInStepUnit)
}

// Reps rule: shifts both ends of a range and a single number, never below
// 1; does nothing to AMRAP (or to "none" — nothing to shift).
export function calculateDeloadRepTarget(target: RepTarget, rule: DeloadRepsRule): RepTarget {
  switch (target.type) {
    case 'number':
      return { type: 'number', value: Math.max(1, target.value + rule.delta) }
    case 'range': {
      const min = Math.max(1, target.min + rule.delta)
      const max = Math.max(1, target.max + rule.delta)
      // Collapses to a plain number if clamping brought both ends to the
      // same floor — keeps this module's output honouring the same "a
      // number is min = max" invariant repTargetToColumns/columnsToRepTarget
      // already enforce everywhere else, rather than emitting a
      // degenerate min===max "range" no other code in this app ever
      // produces.
      return min === max ? { type: 'number', value: min } : { type: 'range', min, max }
    }
    case 'amrap':
    case 'none':
      return target
  }
}

// RIR rule: +n. No stated floor (unlike sets/reps' explicit "never below
// 1") — applied as a plain addition. A set with no RIR target has nothing
// to add to and stays null ("no base weight means none is set" is this
// module's own weight-specific wording; the same "nothing there, nothing
// to adjust" posture applies to RIR here, by the same reasoning).
export function calculateDeloadRir(targetRir: number | null, rule: DeloadRirRule): number | null {
  return targetRir == null ? null : targetRir + rule.delta
}

function transformOne(s: DeloadSourceSet, rules: DeloadRules): DeloadCalculatedSet {
  const shared = {
    sourceId: s.id,
    parentSourceId: s.parentId,
    programExerciseId: s.programExerciseId,
    setNumber: s.setNumber,
    stageIndex: s.stageIndex,
    isWarmup: s.isWarmup,
    stageKind: s.stageKind,
    programSetId: s.programSetId,
    tags: s.tags,
    isDropset: s.isDropset,
  }

  // Warmups: never touched, never counted — every other field passes
  // through verbatim, including weight (no base-weight/logged-weight
  // lookup even considered for a warmup, by design).
  if (s.isWarmup) {
    return {
      ...shared,
      repMin: s.repMin,
      repMax: s.repMax,
      isAmrap: s.isAmrap,
      targetRir: s.targetRir,
      targetWeight: s.plannedWeight,
    }
  }

  const currentTarget = columnsToRepTarget({ repMin: s.repMin, repMax: s.repMax, isAmrap: s.isAmrap })
  const newTarget = rules.reps ? calculateDeloadRepTarget(currentTarget, rules.reps) : currentTarget
  const newCols = repTargetToColumns(newTarget)

  const newRir = rules.rir ? calculateDeloadRir(s.targetRir, rules.rir) : s.targetRir

  let newWeight: number | null
  if (rules.weight) {
    const baseWeight = s.loggedWeight ?? s.plannedWeight ?? null
    newWeight = baseWeight == null ? null : calculateDeloadWeightKg(baseWeight, rules.weight)
  } else {
    newWeight = s.plannedWeight
  }

  return {
    ...shared,
    repMin: newCols.repMin,
    repMax: newCols.repMax,
    isAmrap: newCols.isAmrap,
    targetRir: newRir,
    targetWeight: newWeight,
  }
}

// The full calculation over a base occurrence's whole set list (every
// exercise together — "the calculation... happens once for that row",
// reviewer's note 6). Groups by programExerciseId internally (a small
// local re-derivation of the head/stage relationship, not an import of
// setGroupLogic.ts — see this file's header) because the sets rule's
// "how many working sets" count, and which ones are "the last", are each
// scoped to one exercise at a time, never the whole session.
//
// Sets rule: "removes the last working sets" by POSITION (setNumber) —
// keeps the FIRST N (lowest setNumber) working heads, drops the rest,
// taking every dropped head's own stages with it (a staged set counts as
// one). Warmup heads are never counted and never dropped, regardless of
// where their own setNumber falls relative to the working heads.
export function calculateDeloadSets(sourceSets: readonly DeloadSourceSet[], rules: DeloadRules): DeloadCalculatedSet[] {
  const byExercise = new Map<string, DeloadSourceSet[]>()
  for (const s of sourceSets) {
    const list = byExercise.get(s.programExerciseId)
    if (list) list.push(s)
    else byExercise.set(s.programExerciseId, [s])
  }

  const result: DeloadCalculatedSet[] = []

  for (const exSets of byExercise.values()) {
    const heads = exSets.filter((s) => s.parentId == null).sort((a, b) => a.setNumber - b.setNumber)
    const workingHeads = heads.filter((h) => !h.isWarmup)
    const warmupHeadIds = new Set(heads.filter((h) => h.isWarmup).map((h) => h.id))

    const keepCount = rules.sets ? calculateDeloadSetCount(workingHeads.length, rules.sets) : workingHeads.length
    const keptWorkingIds = new Set(workingHeads.slice(0, keepCount).map((h) => h.id))

    for (const head of heads) {
      if (!warmupHeadIds.has(head.id) && !keptWorkingIds.has(head.id)) continue // dropped — and its stages with it
      result.push(transformOne(head, rules))
      const stages = exSets
        .filter((s) => s.parentId === head.id)
        .sort((a, b) => a.stageIndex - b.stageIndex)
      for (const stage of stages) {
        result.push(transformOne(stage, rules))
      }
    }
  }

  return result
}

// ─── Deload restore snapshot (reviewer's note 3) ───────────────────────────
// "Every column needed to restore them exactly" — deliberately carries no
// row id and no parent_week_plan_set_id: by the time a restore runs, the
// pre-mark ids no longer exist (the rows were deleted during marking), so
// grouping is reconstructed instead from (programExerciseId, setNumber,
// stageIndex) — stages share their head's setNumber by this app's own
// convention (weekPlanService.ts's addStage) and stageIndex 0 is always the
// head (027's own column meaning) — the same id-free identity restore
// needs anyway. An equality diff of every OTHER column against the
// pre-mark rows is exactly what the scratch-SQL proof in this chunk's
// report checks.

export interface DeloadRestoreEntry {
  programExerciseId: string
  setNumber: number
  stageIndex: number
  isWarmup: boolean
  isDropset: boolean
  stageKind: StageKind | null
  programSetId: string | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetWeight: number | null
  targetRir: number | null
  tags: string[] | null
}

// Input shape for the snapshot — the same fields DeloadSourceSet carries,
// minus the two that only matter for calculating (plannedWeight/
// loggedWeight collapse into targetWeight — the row's own current value,
// whichever it happens to be at the moment it's snapshotted) and the
// id/parentId pair (snapshot is id-free, see above).
export interface DeloadSnapshotSourceRow {
  programExerciseId: string
  setNumber: number
  stageIndex: number
  isWarmup: boolean
  isDropset: boolean
  stageKind: StageKind | null
  programSetId: string | null
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
  targetWeight: number | null
  targetRir: number | null
  tags: string[] | null
}

export function buildDeloadRestoreSnapshot(rows: readonly DeloadSnapshotSourceRow[]): DeloadRestoreEntry[] {
  return rows.map((r) => ({
    programExerciseId: r.programExerciseId,
    setNumber: r.setNumber,
    stageIndex: r.stageIndex,
    isWarmup: r.isWarmup,
    isDropset: r.isDropset,
    stageKind: r.stageKind,
    programSetId: r.programSetId,
    repMin: r.repMin,
    repMax: r.repMax,
    isAmrap: r.isAmrap,
    targetWeight: r.targetWeight,
    targetRir: r.targetRir,
    tags: r.tags,
  }))
}

// Organises a flat snapshot back into heads (stageIndex 0) + each head's
// own stages (by the same (programExerciseId, setNumber) key), ordered by
// stageIndex — what the I/O layer needs to insert heads first (so each
// stage's new parent id is resolvable) without re-deriving the grouping key
// itself. Pure and tested directly (the convention this module's identity
// scheme relies on), same reasoning setGroupLogic.ts's groupByParent is
// tested directly elsewhere.
export interface DeloadRestoreGroup {
  head: DeloadRestoreEntry
  stages: DeloadRestoreEntry[]
}

export function groupDeloadRestoreEntries(entries: readonly DeloadRestoreEntry[]): DeloadRestoreGroup[] {
  const headKey = (e: { programExerciseId: string; setNumber: number }) => `${e.programExerciseId}::${e.setNumber}`
  const heads = entries.filter((e) => e.stageIndex === 0)
  const stagesByHeadKey = new Map<string, DeloadRestoreEntry[]>()
  for (const e of entries) {
    if (e.stageIndex === 0) continue
    const key = headKey(e)
    const list = stagesByHeadKey.get(key)
    if (list) list.push(e)
    else stagesByHeadKey.set(key, [e])
  }
  return heads.map((head) => ({
    head,
    stages: (stagesByHeadKey.get(headKey(head)) ?? []).sort((a, b) => a.stageIndex - b.stageIndex),
  }))
}
