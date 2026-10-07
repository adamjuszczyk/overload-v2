// Phase-1 planner vocabulary and formats (TASKS.md chunk 2; SPEC.md "Program
// set", "Deload rules", "Tags", "Tempo") — same precedent as priorityTags.ts,
// exerciseTags.ts, weightUnit.ts, ratingScales.ts, setGroupLogic.ts: pure, no
// React, no Supabase, the one place phase 1's fixed vocabularies and formats
// are decided, so later chunks read the same values instead of each
// hard-coding its own copy.
//
// Deliberately zero imports: TASKS.md says this chunk "depends on 1 only by
// build order; no runtime dependency" (chunk 1 is migration 027, already
// live), and nothing yet imports this module either — wiring it into the
// UI/Supabase layer is later chunks' work, not this one's.
//
// Scope note: this module holds vocabulary and formats only. Deciding when a
// head "has stages" at all (a join against sibling rows) belongs to
// setGroupLogic.ts/referenceLogic.ts; actually *applying* a deload rule's
// adjustment belongs to deloadRules.ts (chunk 22). Neither is touched here —
// see the judgement-call notes below for exactly where this module's
// boundary sits.

// ─── Stage kind ──────────────────────────────────────────────────────────────

// Storage values: exactly SPEC's "Program set" stage-kind CHECK, same order
// SPEC lists them in.
export type StageKind = 'dropset' | 'rest_pause' | 'myo_reps' | 'cluster'

export const STAGE_KINDS: readonly StageKind[] = ['dropset', 'rest_pause', 'myo_reps', 'cluster']

// Judgement call: exact display label text isn't specified anywhere. Using
// SPEC's own written form for the two hyphenated kinds ("rest-pause",
// "myo-reps") rather than inventing different wording, uppercased to match
// this codebase's existing all-caps label convention (exerciseTags.ts's
// MUSCLE_GROUP_LABELS, ratingScales.ts's *_SCALE.labels).
export const STAGE_KIND_LABELS: Record<StageKind, string> = {
  dropset: 'DROPSET',
  rest_pause: 'REST-PAUSE',
  myo_reps: 'MYO-REPS',
  cluster: 'CLUSTER',
}

// Default rest between stages (SPEC "Program set"; v2_program_sets'
// stage_rest_seconds is a "design field" — null on a row means "use this
// default", an explicit value overrides it): dropset none (stages run back
// to back); the other three kinds 15s.
export const DEFAULT_STAGE_REST_SECONDS: Record<StageKind, number | null> = {
  dropset: null,
  rest_pause: 15,
  myo_reps: 15,
  cluster: 15,
}

// Weight carry-over between stages: dropset drops the weight each stage;
// the other three carry the same weight across stages.
export const STAGE_KIND_CARRIES_WEIGHT: Record<StageKind, boolean> = {
  dropset: false,
  rest_pause: true,
  myo_reps: true,
  cluster: true,
}

// ─── Set kind (storage mapping) ─────────────────────────────────────────────

// Not a new column anywhere (TASKS.md "Data models", verbatim): warmup =
// is_warmup true (exists since migration 006); staged = a head with stage
// rows, carrying a stage kind; working = neither.
export type SetKind = 'working' | 'warmup' | 'staged'

export const SET_KINDS: readonly SetKind[] = ['working', 'warmup', 'staged']

export interface SetKindHeadFields {
  isWarmup: boolean
  stageKind: StageKind | null
}

// Derives a head row's SetKind from its own two storage fields.
//
// Judgement call: scoped to exactly the two fields TASKS.md names ("staged
// <-> head stage_kind") — this does NOT take a `hasStages` join, so on its
// own it reads a legacy head (stage rows exist, but the stage_kind column
// was never populated because it didn't exist yet) as 'working', not
// 'staged'. Detecting "this head has stage rows at all" needs the sibling
// rows (setGroupLogic.ts's grouping, elsewhere) — out of scope for a
// single-row pure function. Once a caller knows a head has stages by that
// other means, resolveStageKind below gives the right stage kind for a null
// column, which is this module's encoding of "a legacy head ... reads as a
// dropset." Flagged in the chunk 2 report.
export function deriveSetKind(head: SetKindHeadFields): SetKind {
  if (head.isWarmup) return 'warmup'
  if (head.stageKind != null) return 'staged'
  return 'working'
}

// TASKS.md "Data models", verbatim: "A legacy head that has stages but no
// stage_kind reads as a dropset." Apply this only once the caller already
// knows (by some other means) that the head has stage rows.
export function resolveStageKind(stageKind: StageKind | null): StageKind {
  return stageKind ?? 'dropset'
}

// ─── Preset tags ─────────────────────────────────────────────────────────────

// SPEC "Tags": preset list, in SPEC's own order, plus custom free text (the
// free-text half is per-set user input, a UI concern, out of scope here).
// Unlike stage kinds, a preset tag's storage value *is* its display text,
// verbatim — SPEC gives these as the literal strings shown on the set's row
// during the workout, not a snake_case code with a separate label.
export const PRESET_TAGS = [
  'push here',
  'maintain strength',
  'focus on execution',
  'push back',
] as const

export type PresetTag = (typeof PRESET_TAGS)[number]

// ─── Rep target <-> rep_min / rep_max / is_amrap ───────────────────────────

// SPEC "Program set": "rep target: number = min = max; range = min < max;
// AMRAP = flag, no numbers; none = all empty." TASKS.md's Checks (verified
// on scratch, R1: max needs min and >= min; AMRAP carries no numbers) are
// satisfied by construction in repTargetToColumns below, not re-validated
// here — enforcing them against arbitrary input is a caller/DB concern.
export type RepTarget =
  | { type: 'number'; value: number }
  | { type: 'range'; min: number; max: number }
  | { type: 'amrap' }
  | { type: 'none' }

export interface RepTargetColumns {
  repMin: number | null
  repMax: number | null
  isAmrap: boolean
}

export function repTargetToColumns(target: RepTarget): RepTargetColumns {
  switch (target.type) {
    case 'number':
      return { repMin: target.value, repMax: target.value, isAmrap: false }
    case 'range':
      return { repMin: target.min, repMax: target.max, isAmrap: false }
    case 'amrap':
      return { repMin: null, repMax: null, isAmrap: true }
    case 'none':
      return { repMin: null, repMax: null, isAmrap: false }
  }
}

// is_amrap is authoritative when true — AMRAP "carries no numbers" even if
// a row somehow also has stray min/max, matching the Check rather than
// re-deriving a contradiction. A partially-null pair (one of repMin/repMax
// set, the other not — not a state the Checks allow, but not this
// function's job to enforce) degrades to 'none' rather than throwing, same
// defensive-default precedent as toMuscleGroup/resolveWeightUnit elsewhere
// in src/lib/.
export function columnsToRepTarget(columns: RepTargetColumns): RepTarget {
  if (columns.isAmrap) return { type: 'amrap' }
  if (columns.repMin == null || columns.repMax == null) return { type: 'none' }
  if (columns.repMin === columns.repMax) return { type: 'number', value: columns.repMin }
  return { type: 'range', min: columns.repMin, max: columns.repMax }
}

export const REP_TARGET_AMRAP_TEXT = 'AMRAP'
export const REP_TARGET_NONE_TEXT = 'none'

// Format always emits an en dash (U+2013) for a range, per the brief.
export function formatRepTarget(target: RepTarget): string {
  switch (target.type) {
    case 'number':
      return String(target.value)
    case 'range':
      return `${target.min}–${target.max}`
    case 'amrap':
      return REP_TARGET_AMRAP_TEXT
    case 'none':
      return REP_TARGET_NONE_TEXT
  }
}

// Conservative-parsing judgement calls (the brief leaves these open):
// - Per DECISIONS 34 (owner, 2026-10-04): 'AMRAP' / 'none' accept any input
//   casing ('amrap', 'Amrap', 'aMrAp', 'NONE', 'None', ...) and are folded
//   to the matching type; formatRepTarget still only ever emits the
//   canonical 'AMRAP' / 'none' text.
// - Only the input's outer whitespace is trimmed; no internal whitespace is
//   accepted around the separator ("8 - 12" is rejected, not reformatted).
// - The range separator accepts a hyphen or an en dash on input (the brief,
//   verbatim) — nothing else (no em dash).
// - A range requires a strictly-greater max, matching SPEC's "range = min <
//   max": "8-8" is rejected, not read as the plain number 8 — a single
//   number must be entered as "8" instead. This is stricter than the DB
//   check alone (rep_max >= rep_min, which also allows the equal case); this
//   parser's range syntax never produces that degenerate case.
// - Both sides must be plain positive integers: no sign, no decimal point,
//   no exponent form, so "0", a negative, and a non-integer are all
//   rejected by the same two patterns below rather than as special cases.
const REP_RANGE_PATTERN = /^(\d+)[-–](\d+)$/
const REP_NUMBER_PATTERN = /^\d+$/

export function parseRepTarget(input: string): RepTarget | null {
  const trimmed = input.trim()
  if (trimmed.toUpperCase() === REP_TARGET_AMRAP_TEXT) return { type: 'amrap' }
  if (trimmed.toLowerCase() === REP_TARGET_NONE_TEXT) return { type: 'none' }

  const rangeMatch = REP_RANGE_PATTERN.exec(trimmed)
  if (rangeMatch) {
    const min = Number(rangeMatch[1])
    const max = Number(rangeMatch[2])
    return min > 0 && max > min ? { type: 'range', min, max } : null
  }

  if (REP_NUMBER_PATTERN.test(trimmed)) {
    const value = Number(trimmed)
    return value > 0 ? { type: 'number', value } : null
  }

  return null
}

// ─── AMRAP's RIR default (chunk 19) ─────────────────────────────────────────

// SPEC "Targets" — "AMRAP: counts as a normal working set everywhere. Its
// RIR defaults to 0 (RPE 10), editable." Reviewer's note (chunk 19): applied
// only at the moment a week-plan set's rep target actually CHANGES to AMRAP
// through Plan's own editor (the one caller that ever changes is_amrap there)
// — never retroactively on an unrelated edit, and never overwriting an
// existing RIR (0 included: once a value is there, explicit or defaulted,
// it is never touched again by this function). The caller is responsible for
// only invoking this when the target actually changed (same "no-op on an
// unchanged commit" discipline as every other editor in this chunk); this
// function itself has no notion of "did it change", only "what should the
// RIR be, given the new target and the RIR that exists right now". Returns
// repTargetToColumns' own columns, plus `targetRir` ONLY when a default is
// being applied — omitted (not merely undefined-valued) otherwise, so a
// caller building an update patch with the `'targetRir' in columns` test
// (this file's own convention, e.g. weekPlanService.ts's updateSet) never
// touches the column when no default applies. v2_plan_week (the SQL
// planner) makes no such decision of its own and is untouched by this.
export function applyAmrapRirDefault(
  target: RepTarget,
  currentTargetRir: number | null,
): RepTargetColumns & { targetRir?: number } {
  const columns = repTargetToColumns(target)
  return columns.isAmrap && currentTargetRir == null
    ? { ...columns, targetRir: 0 }
    : columns
}

// ─── Tags (chunk 19) ─────────────────────────────────────────────────────────
// SPEC "Tags" — "Per set, several allowed, in the week plan. Preset list
// (...) plus custom text." PRESET_TAGS above is the preset half; these three
// pure functions are the one place "trimmed; blank refused; no duplicates"
// and "apply to all... never removes other tags" are decided, so Plan's own
// editor (PlanPage.tsx) and any later caller never re-derive the rule
// differently. A tags column reads as "no tags" the same way absent/null
// reads everywhere else in this module — these functions take and return
// `string[] | null`, never `[]` for "none" (addTag/removeTag collapse an
// empty result back to null, same "nothing renders nothing" convention as
// rep target's own 'none').

// Adds `input` to `tags`, or returns null when nothing should be written:
// blank (after trimming) is refused, and a tag already present is refused
// too (no duplicates on one set) — the caller's contract is "null = do not
// write", exactly like parseRepTarget's own null for "refused". A
// genuinely-new tag is appended (order-preserving, existing tags first).
export function addTag(tags: readonly string[] | null | undefined, input: string): string[] | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  const current = tags ?? []
  if (current.includes(trimmed)) return null
  return [...current, trimmed]
}

// Removes `tag` from `tags`. Always succeeds (removing something not present
// is a harmless no-op, same final shape); collapses back to null once the
// last tag is gone, rather than writing an empty array.
export function removeTag(tags: readonly string[] | null | undefined, tag: string): string[] | null {
  const next = (tags ?? []).filter((t) => t !== tag)
  return next.length === 0 ? null : next
}

export interface TaggableHead {
  id: string
  tags: readonly string[] | null | undefined
  isWarmup: boolean
}

export interface TagUpdate {
  id: string
  tags: string[]
}

// SPEC "Tags" — "'Apply to all sets' fills one tag across an exercise's
// sets." Reviewer's note: "adds one tag to every working head set of that
// exercise in that week (not warmups; not stages, since stages are never
// independent sets). It is idempotent, and it never removes other tags."
// `heads` is the caller's own heads-only list for one exercise/week (the
// same headsOnly/groupWeekPlanSets convention setGroupLogic.ts already
// establishes — stages are never passed in at all, so this function has no
// stage-exclusion logic of its own to get wrong); this one adds the warmup
// exclusion and the per-head addTag call, and returns only the heads that
// actually change — a head already carrying `tag` (or any warmup) is simply
// left out, so calling this again with the same result is a no-op (nothing
// to write), the same idempotence addTag's own duplicate-refusal gives a
// single set.
export function applyTagToAllHeads(heads: readonly TaggableHead[], tag: string): TagUpdate[] {
  const updates: TagUpdate[] = []
  for (const head of heads) {
    if (head.isWarmup) continue
    const next = addTag(head.tags, tag)
    if (next !== null) updates.push({ id: head.id, tags: next })
  }
  return updates
}

// ─── Tempo ───────────────────────────────────────────────────────────────────

// SPEC "Program exercise" / "Tempo": "tempo (optional, text in the form
// 3-1-1-0, X allowed)", shown next to the exercise during the workout.
// Lives on v2_program_exercises (not v2_program_sets, hence no row for it
// in TASKS.md's Program set table); a text column, max length 20 (the
// brief, verbatim: "anything longer than the column's 20 chars after
// normalising").
export const TEMPO_FIELD_COUNT = 4
export const TEMPO_MAX_LENGTH = 20

// Conservative-parsing judgement calls (the brief leaves these open):
// - Per DECISIONS 34 (owner, 2026-10-04): lowercase 'x' is accepted and
//   normalised to uppercase 'X' on output — SPEC's own written form stays
//   the canonical shape every caller sees, while typing the easy lowercase
//   key isn't rejected.
// - Only the input's outer whitespace is trimmed before validating; no
//   internal whitespace is accepted ("3 - 1 - 1 - 0" is rejected).
// - The length check (<= 20) runs on the trimmed string — "normalising"
//   here is exactly that outer trim, plus upper-casing an 'x' field; a
//   validly-formatted tempo is otherwise returned unchanged.
// - Fields are separated by a plain hyphen only — unlike rep targets, SPEC
//   never shows an en dash for tempo, so none is accepted here.
// - Each field is one or more ASCII digits, or exactly one 'X'/'x' — never
//   mixed ('3X'), never empty, never more than one letter.
// - An empty or whitespace-only input returns null, the same as any other
//   invalid string. Tempo is optional (SPEC); a caller treats a genuinely
//   blank field as "no tempo" before calling this, rather than reading that
//   meaning into a null return.
const TEMPO_FIELD_PATTERN = /^(\d+|[Xx])$/

export function normaliseTempo(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed.length > TEMPO_MAX_LENGTH) return null

  const fields = trimmed.split('-')
  if (fields.length !== TEMPO_FIELD_COUNT) return null
  if (!fields.every((field) => TEMPO_FIELD_PATTERN.test(field))) return null

  return fields.map((field) => field.toUpperCase()).join('-')
}

// ─── Deload rules — starting values ────────────────────────────────────────

// Shape per TASKS.md "Data models" (validated in full by deloadRules.ts,
// chunk 22 — not built here): { sets, weight, reps, rir }, each
// independent and optional; an absent key means that rule is off. This
// module holds only the two *starting* values TASKS.md actually states for
// turning a rule on — not the full shape, and not reps/rir (TASKS.md gives
// no starting value for either of those when switched on, only their
// per-use delta shape, which has no "default delta" stated).
//
// "Sets never go below 1" (TASKS.md) is a floor applied when a sets rule is
// *used*, not a starting value — deliberately not encoded here; it belongs
// with deloadRules.ts's application logic.
export type DeloadRounding = 'down' | 'up'

export interface DeloadSetsRuleDefaults {
  mode: 'percent' | 'count'
  value: number
  rounding: DeloadRounding
}

// TASKS.md, verbatim: "Turning rules on starts from { sets: { mode:
// percent, value: 50, rounding: down } } (SPEC: sets -50%, everything else
// unchanged)."
export const DEFAULT_DELOAD_SETS_RULE = {
  mode: 'percent',
  value: 50,
  rounding: 'down',
} as const satisfies DeloadSetsRuleDefaults

// Starting percentage per DECISIONS 33 (owner, 2026-10-04): the weight
// deload rule starts at 75%. Field order and naming match the JSON shape
// the plan uses for the weight rule (TASKS.md "Data models"): `{ "percent",
// "rounding", "step", "stepUnit" }`.
export interface DeloadWeightRuleDefaults {
  percent: number
  rounding: DeloadRounding
  step: number
  stepUnit: 'kg' | 'lbs'
}

export const DEFAULT_DELOAD_WEIGHT_RULE = {
  percent: 75,
  rounding: 'down',
  step: 2.5,
  stepUnit: 'kg',
} as const satisfies DeloadWeightRuleDefaults
