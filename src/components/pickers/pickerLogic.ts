// What the three 1.2 pickers decide (TASKS-1.2 chunk 39; SPEC "Set types and staged sets [1.2]",
// "Targets [1.2]", "Rest [1.2]", "Warmup sets" (G49), Defaults 7): the set type picker (board 5),
// the rep target picker (6) and the RIR target picker (7), each one component that Plan, CHANGE THE
// PROGRAM, the stepped planner and the workout all use. Pure, no React, no I/O; the pickers
// return a value and the caller decides what to write (the week set, the program set or the
// session). Imports only `plannerVocabulary.ts`, so a picker never reaches into a feature folder.
//
// Wording is the boards' (`design/1.2/source/SetKindPicker.dc.html`, `RepTargetPicker.dc.html`,
// `RirTargetPicker.dc.html`): `pickerLogic.test.ts` reads those files and checks every string here
// against them, so a changed board shows up as a failing test rather than as a drift nobody sees.

import {
  DEFAULT_STAGE_REST_SECONDS,
  STAGE_KINDS,
  formatRepTarget,
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

// Provisional (DECISIONS, D31): SPEC gives the stepper no top end. A set has at least one stage;
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

// What a box shows when a mode is picked with nothing to start from, and how wide the range a number
// grows into is. The boards' own examples (8-10 reps, RIR 1-2, "SET 8 REPS", "SET RIR 2"); provisional
// under D31.
const TARGET_SETTINGS: Record<TargetKind, { bounds: TargetBounds; defaultNumber: number; defaultFrom: number; defaultTo: number; rangeWidth: number }> = {
  reps: { bounds: REP_BOUNDS, defaultNumber: 8, defaultFrom: 8, defaultTo: 10, rangeWidth: 2 },
  rir: { bounds: RIR_BOUNDS, defaultNumber: 2, defaultFrom: 1, defaultTo: 2, rangeWidth: 1 },
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
 * NUMBER box, `from` and `to` the RANGE boxes; they are kept apart so a segment tapped and tapped back
 * finds its numbers where they were.
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

/** The range a number grows into when RANGE is picked: from the number up by the kind's width, held to the top bound. */
function rangeAround(kind: TargetKind, number: number): { from: number; to: number } {
  const { bounds, rangeWidth } = TARGET_SETTINGS[kind]
  const to = Math.min(bounds.max, number + rangeWidth)
  return { from: Math.min(number, to), to }
}

/** A rep target as the sheet's first state. A stored value is shown as it is, even past the bounds: only the steppers are bounded. */
export function draftFromRepTarget(target: RepTarget): TargetDraft {
  switch (target.type) {
    case 'none':
      return defaultDraft('reps', 'none')
    case 'amrap':
      return defaultDraft('reps', 'amrap')
    case 'number':
      return { mode: 'number', number: target.value, ...rangeAround('reps', target.value) }
    case 'range':
      return { mode: 'range', number: target.min, from: target.min, to: target.max }
  }
}

export function draftFromRirTarget(target: RirTarget): TargetDraft {
  switch (target.kind) {
    case 'none':
      return defaultDraft('rir', 'none')
    case 'number':
      return { mode: 'number', number: target.value, ...rangeAround('rir', target.value) }
    case 'range':
      return { mode: 'range', number: target.min, from: target.min, to: target.max }
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
 * A segment tapped. NUMBER takes the number, or the FROM box when it comes from a range; RANGE grows a
 * number into a range and otherwise finds its last numbers; NONE and AMRAP keep the numbers for later.
 */
export function pickTargetMode(draft: TargetDraft, mode: TargetMode, kind: TargetKind): TargetDraft {
  if (mode === draft.mode) return draft
  if (mode === 'amrap' && kind === 'rir') return draft
  if (mode === 'number') return { ...draft, mode, number: draft.mode === 'range' ? draft.from : draft.number }
  if (mode === 'range' && draft.mode === 'number') return { ...draft, mode, ...rangeAround(kind, draft.number) }
  return { ...draft, mode }
}

/**
 * One tap on a box's - or +. A box stays inside the kind's bounds, and FROM never passes TO (nor TO
 * FROM); ends that meet are a number when the sheet is confirmed. Returns the same object when
 * nothing moves, so a caller can disable the button that would do nothing.
 */
export function stepTargetField(draft: TargetDraft, field: 'number' | 'from' | 'to', delta: 1 | -1, kind: TargetKind): TargetDraft {
  const { bounds } = TARGET_SETTINGS[kind]
  const next = draft[field] + delta
  const low = field === 'to' ? draft.from : bounds.min
  const high = field === 'from' ? draft.to : bounds.max
  if (next < low || next > high) return draft
  return { ...draft, [field]: next }
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

// ─── The Cues row's second line ──────────────────────────────────────────────────────────────

/** `Push here` (board 5): the set's cues with a capital first letter, as the cues sheet shows them (board 8), joined by commas. */
export function cuesSummary(cues: readonly string[]): string {
  return cues
    .map((cue) => cue.trim())
    .filter((cue) => cue.length > 0)
    .map((cue) => cue.charAt(0).toUpperCase() + cue.slice(1))
    .join(', ')
}
