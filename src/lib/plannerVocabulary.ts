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
// - 'AMRAP' / 'none' must match case exactly as written above; lowercase
//   ('amrap') or mixed case is rejected, not folded.
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
  if (trimmed === REP_TARGET_AMRAP_TEXT) return { type: 'amrap' }
  if (trimmed === REP_TARGET_NONE_TEXT) return { type: 'none' }

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
// - Only uppercase 'X' is accepted, matching SPEC's own literal written
//   form; lowercase 'x' is rejected, not folded.
// - Only the input's outer whitespace is trimmed before validating; no
//   internal whitespace is accepted ("3 - 1 - 1 - 0" is rejected).
// - The length check (<= 20) runs on the trimmed string — "normalising"
//   here is exactly that outer trim and nothing else; a validly-formatted
//   tempo is otherwise returned unchanged.
// - Fields are separated by a plain hyphen only — unlike rep targets, SPEC
//   never shows an en dash for tempo, so none is accepted here.
// - Each field is one or more ASCII digits, or exactly 'X' — never mixed
//   ('3X'), never empty, never more than one letter.
// - An empty or whitespace-only input returns null, the same as any other
//   invalid string. Tempo is optional (SPEC); a caller treats a genuinely
//   blank field as "no tempo" before calling this, rather than reading that
//   meaning into a null return.
const TEMPO_FIELD_PATTERN = /^(\d+|X)$/

export function normaliseTempo(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0 || trimmed.length > TEMPO_MAX_LENGTH) return null

  const fields = trimmed.split('-')
  if (fields.length !== TEMPO_FIELD_COUNT) return null
  if (!fields.every((field) => TEMPO_FIELD_PATTERN.test(field))) return null

  return trimmed
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

// Deliberately missing `percent`. TASKS.md states only that the weight rule
// "starts at rounding down to 2.5 kg" when switched on — rounding and step
// only. The deload-rules shape shown elsewhere in TASKS.md includes
// `"percent": 90` in its example, but that is illustrating the JSON shape's
// fields, not stated as the switched-on starting value, and no default
// percent is given anywhere in the brief. Inventing a number here is a real
// product decision, not a formatting detail — left out on purpose and
// flagged in the chunk 2 report rather than guessed at.
export interface DeloadWeightRuleDefaults {
  rounding: DeloadRounding
  step: number
  stepUnit: 'kg' | 'lbs'
}

export const DEFAULT_DELOAD_WEIGHT_RULE = {
  rounding: 'down',
  step: 2.5,
  stepUnit: 'kg',
} as const satisfies DeloadWeightRuleDefaults
