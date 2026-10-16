// What the three 1.2 pickers decide (TASKS-1.2 chunk 39; SPEC "Set types and staged sets [1.2]",
// "Targets [1.2]", "Rest [1.2]", "Warmup sets" (G49), Defaults 7): the set type picker (board 5),
// the rep target picker (6) and the RIR target picker (7), each one component that Plan, CHANGE THE
// PROGRAM, the stepped planner and the workout all use; and, since chunk 40, what the cues sheet
// (board 8) decides. Pure, no React, no I/O; the pickers return a value and the caller decides what
// to write (the week set, the program set or the session). Imports only `plannerVocabulary.ts`, so a
// picker never reaches into a feature folder.
//
// Wording is the boards' (`design/1.2/source/SetKindPicker.dc.html`, `RepTargetPicker.dc.html`,
// `RirTargetPicker.dc.html`, `TagSheet.dc.html`): `pickerLogic.test.ts` reads those files and checks
// every string here against them, so a changed board shows up as a failing test rather than as a
// drift nobody sees.

import {
  DEFAULT_STAGE_REST_SECONDS,
  PRESET_TAGS,
  STAGE_KINDS,
  addTag,
  formatRepTarget,
  removeTag,
  type RepTarget,
  type StageKind,
} from '../../lib/plannerVocabulary'

// ─── Wording (the boards') ───────────────────────────────────────────────────────────────────

export const SET_TYPE_TEXT = {
  title: 'What is this set?',
  restBetween: 'REST BETWEEN',
  restAfter: 'Rest after this set',
  restAfterNote: 'Every week from now on.',
  cues: 'Cues',
  remove: 'REMOVE THIS SET',
  workoutNote: "Changes this workout only. Next week's plan stays as it is; the change shows up in REVIEW when you plan it.",
  defaultRest: 'DEFAULT',
  noTimer: 'NO TIMER',
} as const

export const REP_TARGET_TEXT = {
  title: 'Rep target',
  numberLabel: 'REPS',
  from: 'FROM',
  to: 'TO',
  none: 'No rep target',
  amrap: 'AMRAP',
  amrapNote: 'As many reps as possible. An empty RIR becomes 0.',
  clear: 'CLEAR TARGET',
} as const

export const RIR_TARGET_TEXT = {
  title: 'RIR target',
  numberLabel: 'REPS IN RESERVE',
  from: 'FROM',
  to: 'TO',
  none: 'No RIR target',
  rangeNote: 'Either number is on plan. Pick on the day.',
  clear: 'CLEAR TARGET',
} as const

/** Board 8's (`TagSheet.dc.html`): the cues sheet. */
export const CUES_TEXT = {
  title: 'Cues for this set',
  note: "Shown on the set when it's next in the workout. Not copied to next week.",
  yours: 'YOURS',
  newCue: '+ NEW CUE',
  done: 'DONE',
} as const

/** What the cues sheet says where no board draws it: the input that "+ NEW CUE" opens (provisional under D31). */
export const CUE_INPUT_TEXT = {
  label: 'New cue',
  add: 'ADD',
} as const

// ─── Set type ────────────────────────────────────────────────────────────────────────────────

/** What a row of the set type list is called: the two plain types, then the four staged kinds. */
export type SetTypeId = 'normal' | 'warmup' | StageKind

export interface SetTypeOption {
  id: SetTypeId
  name: string
  description: string
  /** The stepper under a picked staged kind (board 5: DROPS, PAUSES, MINI-SETS, CLUSTERS); null where a type has no stages. */
  stageLabel: string | null
}

const STAGED_OPTIONS: Record<StageKind, { name: string; description: string; stageLabel: string }> = {
  dropset: { name: 'Dropset', description: 'Straight into a lighter weight, no rest.', stageLabel: 'DROPS' },
  rest_pause: { name: 'Rest-pause', description: 'Same weight, a few breaths, more reps.', stageLabel: 'PAUSES' },
  myo_reps: { name: 'Myo-reps', description: 'An activation set, then short mini-sets.', stageLabel: 'MINI-SETS' },
  cluster: { name: 'Cluster', description: 'The reps split by short rests inside the set.', stageLabel: 'CLUSTERS' },
}

/** Board 5's list, in its order: Normal, Warmup, then the stage kinds in `STAGE_KINDS` order. */
export const SET_TYPE_OPTIONS: readonly SetTypeOption[] = [
  { id: 'normal', name: 'Normal', description: 'A straight working set.', stageLabel: null },
  { id: 'warmup', name: 'Warmup', description: 'Lighter, not counted as volume. Usually the first sets.', stageLabel: null },
  ...STAGE_KINDS.map((kind): SetTypeOption => ({ id: kind, ...STAGED_OPTIONS[kind] })),
]

/** The rows a picker offers: all six, or the ones the caller allows (G55: a warmup row in Plan offers Normal and Warmup only). */
export function setTypeOptionsFor(allowedKinds?: readonly SetTypeId[]): readonly SetTypeOption[] {
  if (!allowedKinds) return SET_TYPE_OPTIONS
  return SET_TYPE_OPTIONS.filter((option) => allowedKinds.includes(option.id))
}

// A set's type as the picker holds it (Adam's data-model review, 3d): a warmup can't carry stages
// and a staged set always has at least one, because the union has no way to say otherwise.
// `stageRestSeconds` is the rest between stages; null is "the kind's own default" (dropset none,
// the others 15 s, `DEFAULT_STAGE_REST_SECONDS`), the way `v2_program_sets.stage_rest_seconds`
// reads. A SetType is assignable to `SessionSetChangeType` (types/index.ts), which stores the same
// without the rest.
export type SetType =
  | { kind: 'normal' }
  | { kind: 'warmup' }
  | { kind: 'staged'; stageKind: StageKind; stageCount: number; stageRestSeconds: number | null }

/** Which row of the list a type is: its stage kind when it is staged. */
export function setTypeId(type: SetType): SetTypeId {
  return type.kind === 'staged' ? type.stageKind : type.kind
}

/**
 * What picking a row of the list does (SPEC: "Picking a staged kind adds its first stage; ... Switching
 * back to Normal or Warmup removes the stages. A warmup can never be staged."). Normal and Warmup drop
 * the stages; a staged kind keeps the count and the rest of a set that was already staged (the old
 * STAGE KIND chip never touched them either) or starts a plain set at one stage on the kind's own rest.
 */
export function applySetType(current: SetType, pick: SetTypeId): SetType {
  if (pick === 'normal') return { kind: 'normal' }
  if (pick === 'warmup') return { kind: 'warmup' }
  if (current.kind === 'staged') return current.stageKind === pick ? current : { ...current, stageKind: pick }
  return { kind: 'staged', stageKind: pick, stageCount: 1, stageRestSeconds: null }
}

/** Two values that say the same thing, so a tap on the row already picked writes nothing. */
export function sameSetType(a: SetType, b: SetType): boolean {
  if (a.kind !== 'staged' || b.kind !== 'staged') return a.kind === b.kind
  return a.stageKind === b.stageKind && a.stageCount === b.stageCount && a.stageRestSeconds === b.stageRestSeconds
}

// Provisional under D31: SPEC gives the stepper no top end. A set has at least one stage;
// ten is far past any real dropset, rest-pause, myo-reps or cluster scheme.
export const STAGE_COUNT_MIN = 1
export const STAGE_COUNT_MAX = 10

/** The DROPS / PAUSES / MINI-SETS / CLUSTERS stepper: one more or one fewer, never fewer than one, and a plain or warmup set has none. */
export function stepStageCount(current: SetType, delta: 1 | -1): SetType {
  if (current.kind !== 'staged') return current
  const next = current.stageCount + delta
  if (delta > 0 ? next > STAGE_COUNT_MAX : next < STAGE_COUNT_MIN) return current
  return { ...current, stageCount: next }
}

/** REST BETWEEN's stepper on a staged set; the kind's own default (null) is what it starts from and returns to. */
export function stepStageRest(current: SetType, direction: 1 | -1): SetType {
  if (current.kind !== 'staged') return current
  const base = DEFAULT_STAGE_REST_SECONDS[current.stageKind] ?? 0
  const stageRestSeconds = stepRest(current.stageRestSeconds, direction, base)
  return stageRestSeconds === current.stageRestSeconds ? current : { ...current, stageRestSeconds }
}

// ─── Rest steppers ───────────────────────────────────────────────────────────────────────────

// The step and the ceiling of the app's existing rest stepper (planner/StepVolume.tsx's RestStepper:
// 15 s a tap, 10 min at most). Provisional under D31 until a board says otherwise.
export const REST_STEP_SECONDS = 15
export const REST_MAX_SECONDS = 600

/**
 * One tap of a rest stepper. `value` null is "the default": the exercise's or the global rest for
 * "Rest after this set", the kind's own for REST BETWEEN. `base` is what that default amounts to in
 * seconds (0 = no timer), so a first + goes one step past it and a - that would land on or below it
 * goes back to the default, never to a rest of zero seconds (a 0 starts a timer that ends at once;
 * only null means "no timer", `restChain.ts`). - on the default is a no-op.
 */
export function stepRest(value: number | null, direction: 1 | -1, base = 0): number | null {
  if (direction < 0) {
    if (value === null) return null
    const next = value - REST_STEP_SECONDS
    return next <= base ? null : next
  }
  const current = value ?? base
  return current >= REST_MAX_SECONDS ? value : Math.min(REST_MAX_SECONDS, current + REST_STEP_SECONDS)
}

/** `m:ss`, the form the boards draw (0:15, 2:00, 1:30). */
export function formatRestClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(whole / 60)
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`
}

/** What "Rest after this set" reads: DEFAULT while the set has none of its own. */
export function restAfterText(seconds: number | null): string {
  return seconds === null ? SET_TYPE_TEXT.defaultRest : formatRestClock(seconds)
}

/** What REST BETWEEN reads: its own value, else the kind's default (NO TIMER for a dropset, 0:15 for the others). */
export function stageRestText(kind: StageKind, seconds: number | null): string {
  const shown = seconds ?? DEFAULT_STAGE_REST_SECONDS[kind]
  return shown === null ? SET_TYPE_TEXT.noTimer : formatRestClock(shown)
}

// ─── Which rows each variant shows ───────────────────────────────────────────────────────────

/** Where the set type picker is opened from; the variant decides the rows (SPEC "Rest [1.2]", "Set types and staged sets [1.2]"). */
export type SetTypePickerContext = 'plan-week-dependent' | 'plan-stable' | 'planner' | 'change-program' | 'workout'

/**
 * The rows under the type list. The list and the stage stepper under a picked staged kind belong to
 * every variant, so they aren't here.
 * - Plan, week-dependent: REST BETWEEN and "Rest after this set · Every week from now on", both only
 *   for a set that names a program set of its own exercise (`canEditRest`, G45 c; SPEC: a set without
 *   one "shows no rest row and no REST BETWEEN"), Cues, REMOVE THIS SET.
 * - Plan, stable: the stepper but no REST BETWEEN and no rest row (rest after lives in CHANGE THE
 *   PROGRAM's REST AFTER column, and a staged set made for one stable week uses its kind's default),
 *   Cues, REMOVE THIS SET.
 * - The stepped planner and CHANGE THE PROGRAM: REST BETWEEN (always: their sets are program sets),
 *   REMOVE THIS SET.
 * - The workout: the types and the stepper only, and the line "Changes this workout only ...".
 */
export interface SetTypePickerRows {
  restBetween: boolean
  restAfter: boolean
  cues: boolean
  remove: boolean
  workoutNote: boolean
}

export function setTypePickerRows(context: SetTypePickerContext, options: { canEditRest: boolean }): SetTypePickerRows {
  switch (context) {
    case 'plan-week-dependent':
      return { restBetween: options.canEditRest, restAfter: options.canEditRest, cues: true, remove: true, workoutNote: false }
    case 'plan-stable':
      return { restBetween: false, restAfter: false, cues: true, remove: true, workoutNote: false }
    case 'planner':
    case 'change-program':
      return { restBetween: true, restAfter: false, cues: false, remove: true, workoutNote: false }
    case 'workout':
      return { restBetween: false, restAfter: false, cues: false, remove: false, workoutNote: true }
  }
}

// ─── The line above a picker's title ─────────────────────────────────────────────────────────

/** `WEEK 2`, or `CYCLE 2` on a sequence program; nothing without a number (the planner's pickers name no week). */
export function periodTail(weekNumber: number | undefined, isCycle = false): string | undefined {
  return weekNumber === undefined ? undefined : `${isCycle ? 'CYCLE' : 'WEEK'} ${weekNumber}`
}

/** `[EXERCISE] · SET 03 · WEEK 2` (board 5), `... · THIS WORKOUT` (W7a), `... · SET 04` (PP3c); the sheet draws it in capitals. */
export function pickerEyebrow(parts: { exerciseName: string; setNumber: number; tail?: string }): string {
  const setLabel = `SET ${String(parts.setNumber).padStart(2, '0')}`
  return [parts.exerciseName, setLabel, parts.tail].filter((part): part is string => Boolean(part)).join(' · ')
}

/**
 * The set type picker's eyebrow: `... · WEEK 2` in Plan (`CYCLE 2` on a sequence program), `... · THIS
 * WORKOUT` in the workout (W7a), and nothing after the set number in the stepped planner and CHANGE THE
 * PROGRAM (PP3c names no week).
 */
export function setTypeEyebrow(
  context: SetTypePickerContext,
  parts: { exerciseName: string; setNumber: number; weekNumber?: number; isCycle?: boolean },
): string {
  const inPlan = context === 'plan-week-dependent' || context === 'plan-stable'
  const tail = context === 'workout' ? 'THIS WORKOUT' : inPlan ? periodTail(parts.weekNumber, parts.isCycle) : undefined
  return pickerEyebrow({ exerciseName: parts.exerciseName, setNumber: parts.setNumber, tail })
}

// ─── RIR target ──────────────────────────────────────────────────────────────────────────────

// A RIR target is nothing, a number, or a range (SPEC "Targets [1.2]", 17). The range can only be
// made by `rirRange`: the brand below is a symbol nothing outside this file can name, so a literal
// `{ kind: 'range', ... }` doesn't compile and a range whose ends meet can't exist.
declare const rirRangeBrand: unique symbol

export type RirTarget =
  | { readonly kind: 'none' }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'range'; readonly min: number; readonly max: number; readonly [rirRangeBrand]: true }

/** SPEC: "a range whose ends meet becomes a number" (the same goes for ends that cross: the FROM value is kept). */
export function rirRange(min: number, max: number): Exclude<RirTarget, { kind: 'none' }> {
  if (max <= min) return { kind: 'number', value: min }
  return { kind: 'range', min, max } as Extract<RirTarget, { kind: 'range' }>
}

/** From `v2_week_plan_sets.target_rir` (a number, or a range's low end) and `target_rir_max` (a range's high end; null for a number). */
export function rirTargetFromColumns(targetRir: number | null, targetRirMax: number | null | undefined): RirTarget {
  if (targetRir === null) return { kind: 'none' }
  return targetRirMax == null ? { kind: 'number', value: targetRir } : rirRange(targetRir, targetRirMax)
}

export function rirTargetToColumns(target: RirTarget): { targetRir: number | null; targetRirMax: number | null } {
  switch (target.kind) {
    case 'none':
      return { targetRir: null, targetRirMax: null }
    case 'number':
      return { targetRir: target.value, targetRirMax: null }
    case 'range':
      return { targetRir: target.min, targetRirMax: target.max }
  }
}

// ─── Rep and RIR target pickers: the draft behind the boxes ─────────────────────────────────

export type TargetKind = 'reps' | 'rir'
export type TargetMode = 'none' | 'number' | 'range' | 'amrap'

export interface TargetBounds {
  readonly min: number
  readonly max: number
}

// Stepper bounds (TASKS-1.2 chunk 39): rep targets 1-100; RIR 0-20 (SPEC: "values go well beyond 5").
export const REP_BOUNDS: TargetBounds = { min: 1, max: 100 }
export const RIR_BOUNDS: TargetBounds = { min: 0, max: 20 }

// What a box shows in a segment the set doesn't have: the boards' own examples (8 and 8-10 reps, RIR 2 and
// 1-2; "SET 8 REPS", "SET RIR 2"). Adam, 2026-10-15: "The boards' example values (8, 8-10, RIR 2, 1-2) are
// only the starting point when you switch to a segment the set doesn't already have".
const TARGET_SETTINGS: Record<TargetKind, { bounds: TargetBounds; defaultNumber: number; defaultFrom: number; defaultTo: number }> = {
  reps: { bounds: REP_BOUNDS, defaultNumber: 8, defaultFrom: 8, defaultTo: 10 },
  rir: { bounds: RIR_BOUNDS, defaultNumber: 2, defaultFrom: 1, defaultTo: 2 },
}

/** The segments of each picker (NONE / NUMBER / RANGE / AMRAP for reps; RIR has no AMRAP). */
export const TARGET_MODES: Record<TargetKind, readonly { id: TargetMode; label: string }[]> = {
  reps: [
    { id: 'none', label: 'NONE' },
    { id: 'number', label: 'NUMBER' },
    { id: 'range', label: 'RANGE' },
    { id: 'amrap', label: 'AMRAP' },
  ],
  rir: [
    { id: 'none', label: 'NONE' },
    { id: 'number', label: 'NUMBER' },
    { id: 'range', label: 'RANGE' },
  ],
}

/**
 * What the sheet holds while it is open: the segment picked and the numbers behind it. `number` is the
 * NUMBER box, `from` and `to` the RANGE boxes. Each segment keeps its own numbers: the set's own segment
 * starts from the set's numbers and every other one from the boards' examples (`draftFromRepTarget`), and
 * a switch changes no number, so a segment tapped and tapped back finds its numbers where they were.
 */
export interface TargetDraft {
  mode: TargetMode
  number: number
  from: number
  to: number
}

function defaultDraft(kind: TargetKind, mode: TargetMode): TargetDraft {
  const settings = TARGET_SETTINGS[kind]
  return { mode, number: settings.defaultNumber, from: settings.defaultFrom, to: settings.defaultTo }
}

/**
 * A rep target as the sheet's first state: it opens on the set's segment with the set's numbers (a stored value
 * is shown as it is, even past the bounds: only the steppers are bounded). The segments the set doesn't have
 * start from the boards' examples (8 and 8-10), not from a number the set has: 12 reps gives RANGE 8-10, and
 * 6-9 gives NUMBER 8. A set with no target (or AMRAP) has no number of its own, so it opens on NONE (or AMRAP)
 * and both segments start from the examples.
 */
export function draftFromRepTarget(target: RepTarget): TargetDraft {
  switch (target.type) {
    case 'none':
      return defaultDraft('reps', 'none')
    case 'amrap':
      return defaultDraft('reps', 'amrap')
    case 'number':
      return { ...defaultDraft('reps', 'number'), number: target.value }
    case 'range':
      return { ...defaultDraft('reps', 'range'), from: target.min, to: target.max }
  }
}

/** A RIR target as the sheet's first state, on the same rule as `draftFromRepTarget` (examples: RIR 2 and 1-2). */
export function draftFromRirTarget(target: RirTarget): TargetDraft {
  switch (target.kind) {
    case 'none':
      return defaultDraft('rir', 'none')
    case 'number':
      return { ...defaultDraft('rir', 'number'), number: target.value }
    case 'range':
      return { ...defaultDraft('rir', 'range'), from: target.min, to: target.max }
  }
}

/** A range of reps whose ends meet is the number (`plannerVocabulary.ts` reads "range = min < max"). */
export function repRange(min: number, max: number): RepTarget {
  return max > min ? { type: 'range', min, max } : { type: 'number', value: min }
}

/** What the footer button would set, from the sheet's state. NONE clears. */
export function repTargetFromDraft(draft: TargetDraft): RepTarget {
  switch (draft.mode) {
    case 'none':
      return { type: 'none' }
    case 'amrap':
      return { type: 'amrap' }
    case 'number':
      return { type: 'number', value: draft.number }
    case 'range':
      return repRange(draft.from, draft.to)
  }
}

export function rirTargetFromDraft(draft: TargetDraft): RirTarget {
  switch (draft.mode) {
    case 'number':
      return { kind: 'number', value: draft.number }
    case 'range':
      return rirRange(draft.from, draft.to)
    // 'none' clears; 'amrap' has no segment in the RIR picker and `pickTargetMode` refuses it, so it is only ever 'none' here.
    default:
      return { kind: 'none' }
  }
}

/**
 * A segment tapped: the draft in that segment, with no number changed. A segment shows the numbers it has
 * (the set's own, or the boards' examples if the set had none there, or what was typed or stepped in it
 * while the sheet was open); nothing is carried over from the segment left, so 6-9 gone to NUMBER gives 8 and
 * RANGE tapped again gives 6-9 back.
 */
export function pickTargetMode(draft: TargetDraft, mode: TargetMode, kind: TargetKind): TargetDraft {
  if (mode === draft.mode) return draft
  if (mode === 'amrap' && kind === 'rir') return draft
  return { ...draft, mode }
}

/** The boxes of the rep and RIR pickers: NUMBER's, and RANGE's FROM and TO. */
export type TargetField = 'number' | 'from' | 'to'

/**
 * Where a box may go: the kind's bounds (reps 1-100, RIR 0-20), narrowed by the other end of a range
 * (FROM never passes TO and TO never goes below FROM; ends that meet are a number when the sheet is
 * confirmed). The one place those bounds are read, so a tap on - or + and a typed number can't disagree.
 */
export function targetFieldRange(draft: TargetDraft, field: TargetField, kind: TargetKind): { low: number; high: number } {
  const { bounds } = TARGET_SETTINGS[kind]
  return { low: field === 'to' ? draft.from : bounds.min, high: field === 'from' ? draft.to : bounds.max }
}

/**
 * One tap on a box's - or +. A box stays inside `targetFieldRange`. Returns the same object when
 * nothing moves, so a caller can disable the button that would do nothing.
 */
export function stepTargetField(draft: TargetDraft, field: TargetField, delta: 1 | -1, kind: TargetKind): TargetDraft {
  const next = draft[field] + delta
  const { low, high } = targetFieldRange(draft, field, kind)
  if (next < low || next > high) return draft
  return { ...draft, [field]: next }
}

// ─── Typing into a box ───────────────────────────────────────────────────────────────────────
//
// The number boxes are inputs (DECISIONS 128, Adam 2026-10-15: "the number boxes in the rep and RIR
// pickers are inputs you can type into, with ± steppers beside them (decisions 6 and 17a: choose,
// then type). Same bounds as built"). Typing is the only thing here that can put a half-written
// number in a box ("" on the way to "12", "1" in a range that starts at 8), so a box keeps the text
// being typed apart from the draft: the draft takes a typed number the moment it is a whole number
// inside the box's range, and a box left (or the sheet confirmed) with anything else in it is held
// to the nearest number it can hold. Nothing is clamped while typing: "0" on the way to "08" would
// become 1 and "1" on the way to "12" would become 8.

/** The text of the boxes being typed in, by field: a field is here from its first keystroke until its box is left. */
export type TypedTexts = Partial<Record<TargetField, string>>

/** The most digits a box takes: the biggest bound is 100. */
export const TYPED_DIGITS_MAX = 3

/** What a box can hold while someone types: digits only, no leading zeros (a lone 0 stays), three at most. A paste with letters keeps its digits. */
export function typedDigits(raw: string): string {
  return raw
    .replace(/\D/g, '')
    .replace(/^0+(?=\d)/, '')
    .slice(0, TYPED_DIGITS_MAX)
}

/** The whole number a typed text says; null for an empty text. */
function typedNumber(text: string): number | null {
  return /^\d+$/.test(text) ? Number(text) : null
}

/**
 * A keystroke in a box: the draft with that number in it when `text` is a whole number inside the
 * box's range, else the draft itself (the box shows what was typed; the draft keeps its last good number).
 */
export function typeTargetField(draft: TargetDraft, field: TargetField, text: string, kind: TargetKind): TargetDraft {
  const typed = typedNumber(text)
  if (typed === null || typed === draft[field]) return draft
  const { low, high } = targetFieldRange(draft, field, kind)
  if (typed < low || typed > high) return draft
  return { ...draft, [field]: typed }
}

/**
 * A box left, or the sheet confirmed, with `text` in it: the nearest number the box can hold, the way
 * a stepper stops at a bound (150 reps is 100; 0 reps is 1; a FROM past TO is TO). An empty text
 * changes nothing: the box goes back to the draft's number.
 */
export function settleTargetField(draft: TargetDraft, field: TargetField, text: string, kind: TargetKind): TargetDraft {
  const typed = typedNumber(text)
  if (typed === null) return draft
  const { low, high } = targetFieldRange(draft, field, kind)
  const next = Math.min(high, Math.max(low, typed))
  return next === draft[field] ? draft : { ...draft, [field]: next }
}

const FIELD_ORDER: readonly TargetField[] = ['number', 'from', 'to']

/** Every box still holding typed text, settled: what the footer button sets and what a segment or a stepper acts on. */
export function settleTyped(draft: TargetDraft, typed: TypedTexts, kind: TargetKind): TargetDraft {
  return FIELD_ORDER.reduce((current, field) => {
    const text = typed[field]
    return text === undefined ? current : settleTargetField(current, field, text, kind)
  }, draft)
}

// ─── The footer button ───────────────────────────────────────────────────────────────────────

/** `SET 8–10 REPS`, `SET 12 REPS` (`SET 1 REP`), `SET AMRAP`, `CLEAR TARGET`. */
export function repTargetSummary(target: RepTarget): string {
  switch (target.type) {
    case 'none':
      return REP_TARGET_TEXT.clear
    case 'amrap':
      return `SET ${REP_TARGET_TEXT.amrap}`
    case 'number':
      return target.value === 1 ? 'SET 1 REP' : `SET ${formatRepTarget(target)} REPS`
    case 'range':
      return `SET ${formatRepTarget(target)} REPS`
  }
}

/** `SET RIR 1–2`, `SET RIR 2`, `CLEAR TARGET`. */
export function rirTargetSummary(target: RirTarget): string {
  switch (target.kind) {
    case 'none':
      return RIR_TARGET_TEXT.clear
    case 'number':
      return `SET RIR ${target.value}`
    case 'range':
      return `SET RIR ${target.min}–${target.max}`
  }
}

// ─── "Use for all N sets of [exercise]" ──────────────────────────────────────────────────────

/** One head set of the exercise: a drop stage is never one (setGroupLogic.ts's `headsOnly` decides what the caller passes). */
export interface TargetableSet {
  readonly id: string
  readonly isWarmup: boolean
}

// A rep target goes to every head, a warmup included. A RIR target skips a warmup head: a warmup row
// in Plan has no RIR target (SPEC, G49).
function receivesTarget(set: TargetableSet, kind: TargetKind): boolean {
  return kind === 'reps' || !set.isWarmup
}

/** The N of "Use for all N sets": the sets a target would be written to. */
export function countApplyToAll(sets: readonly TargetableSet[], kind: TargetKind): number {
  return sets.filter((set) => receivesTarget(set, kind)).length
}

/** The heads "Use for all" writes `value` to. */
export function applyToAllTargets<V>(sets: readonly TargetableSet[], value: V, kind: TargetKind): { id: string; value: V }[] {
  return sets.filter((set) => receivesTarget(set, kind)).map((set) => ({ id: set.id, value }))
}

/** `Use for all 3 sets of Lat Pulldown`. */
export function useForAllLabel(count: number, exerciseName: string): string {
  return `Use for all ${count} sets of ${exerciseName}`
}

// ─── Cues: the Cues row's second line, and the cues sheet (board 8) ─────────────────────────

/**
 * A cue as a row reads it: the first letter a capital (board 8: "Push here", "Maintain strength"). What
 * is stored stays as it is: a preset is stored in lower case (`PRESET_TAGS`), a custom cue as it was typed.
 */
export function cueLabel(cue: string): string {
  const text = cue.trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** `Push here` (board 5): the set's cues as the cues sheet shows them (board 8), joined by commas. */
export function cuesSummary(cues: readonly string[]): string {
  return cues
    .map(cueLabel)
    .filter((label) => label.length > 0)
    .join(', ')
}

/** A set's cues as the sheet holds them: trimmed, none blank, none twice, in the order the set has them. */
export function normaliseCues(cues: readonly string[] | null | undefined): string[] {
  const out: string[] = []
  for (const raw of cues ?? []) {
    const cue = raw.trim()
    if (cue !== '' && !out.includes(cue)) out.push(cue)
  }
  return out
}

/**
 * The user's own cues (SPEC "Tags": "Preset list ... plus custom text"; TASKS-1.2 chunk 40: "every distinct
 * non-preset tag on the run's week sets", no new storage): the cues of a flat list that aren't a preset,
 * trimmed, each once, in the order they are first met. A preset is the text `PRESET_TAGS` stores.
 */
export function customCuesOf(cues: readonly string[]): string[] {
  return normaliseCues(cues).filter((cue) => !(PRESET_TAGS as readonly string[]).includes(cue))
}

/** What the cues sheet holds while it is open: the set's cues, in the order it has them, and the user's own cues the list offers. */
export interface CueDraft {
  ticked: string[]
  listed: string[]
}

/** The sheet's first state: the set's cues, and the user's own cues from the run plus any the set has that the run's list lacks. */
export function cueDraftFrom(setCues: readonly string[] | null | undefined, runCues: readonly string[] = []): CueDraft {
  const ticked = normaliseCues(setCues)
  return { ticked, listed: customCuesOf([...runCues, ...ticked]) }
}

export interface CueRow {
  /** What is stored: a preset's own text, or a custom cue as it was typed. */
  cue: string
  /** What the row reads (`cueLabel`). */
  label: string
  /** The user's own cue, which carries the YOURS marker; a preset doesn't. */
  yours: boolean
  /** The set has it: the box is ticked. */
  on: boolean
}

/** Board 8's list, in its order: the presets (`PRESET_TAGS` order), then the user's own cues. */
export function cueRows(draft: CueDraft): CueRow[] {
  const rows = [
    ...PRESET_TAGS.map((cue): { cue: string; yours: boolean } => ({ cue, yours: false })),
    ...draft.listed.map((cue): { cue: string; yours: boolean } => ({ cue, yours: true })),
  ]
  return rows.map(({ cue, yours }) => ({ cue, label: cueLabel(cue), yours, on: draft.ticked.includes(cue) }))
}

/**
 * A row tapped: the cue joins the end of the set's list, or leaves it. `addTag` and `removeTag` are the one
 * place "trimmed, no blank, none twice" is decided (plannerVocabulary.ts); none left is an empty list.
 */
export function toggleCue(draft: CueDraft, cue: string): CueDraft {
  const ticked = draft.ticked.includes(cue) ? (removeTag(draft.ticked, cue) ?? []) : (addTag(draft.ticked, cue) ?? draft.ticked)
  return { ...draft, ticked }
}

/**
 * "+ NEW CUE" confirmed with `text` typed: the sheet's next state, or null when there is nothing to add (blank).
 * A text that is already a row, a preset or one of the user's own, ignoring case, ticks that row as the row's
 * own text: a phone capitalises what is typed, and "Push here" typed is the preset "push here", not a second
 * cue that reads the same. Any other text is a new row of the user's own at the end of the list, ticked.
 * Typed twice, it is one row. Provisional under D31 (SPEC: "plus custom text").
 */
export function addNewCue(draft: CueDraft, text: string): CueDraft | null {
  const typed = text.trim()
  if (typed === '') return null
  const key = typed.toLowerCase()
  const row = [...PRESET_TAGS, ...draft.listed].find((cue) => cue.toLowerCase() === key)
  if (row !== undefined) return draft.ticked.includes(row) ? draft : toggleCue(draft, row)
  return toggleCue({ ...draft, listed: [...draft.listed, typed] }, typed)
}

/**
 * The N of "Use for all N sets of [exercise]" on the cues sheet: the sets `applyTagToAllHeads` writes to.
 * It skips a warmup, and a stage is never one of the sets passed in (setGroupLogic.ts's `headsOnly`).
 */
export function countCueTargets(sets: readonly TargetableSet[]): number {
  return sets.filter((set) => !set.isWarmup).length
}
