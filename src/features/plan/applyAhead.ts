// Chunk 20 (TASKS.md "Apply this change to planned weeks ahead" / SPEC.md
// "Weeks and copying" — "offered when a week is edited and later weeks are
// already planned. Applies only the change just made; leaves everything
// else in those weeks alone. Both planning types.").
//
// Reviewer's note 1: this module is PURE. Given one change record plus the
// later planned weeks' own already-fetched data (a plain WeekPlan[] —
// PlanPage/ProgramTab already hold these via useWeekPlans/useAllWeekPlans,
// so this chunk adds no new Supabase read), it decides, for each candidate
// week, whether to skip it (and why) or exactly which existing
// weekPlanService.ts calls would apply the change there — returned as plain
// descriptions ("ops"), never executed here. useWeekPlan.ts's useApplyAhead
// is the thin executor that actually runs each op through the SAME
// functions weekPlanService.ts already exports and already tests
// (repointWeekExercise, addWeekExercise, removeWeekExercise,
// reorderWeekExercises, addStage, addSet, removeSet, updateSet) — this
// chunk writes no new Supabase call of its own; it only decides WHICH of
// the existing ones to make, and with what arguments.
//
// ─── Slot identity across weeks (reviewer's note 2) ────────────────────────
// "The slot, identified across weeks the same way copying identifies it" —
// copyExercisesForward/copySetsWithGrouping (weekPlanService.ts) map a row's
// identity forward as `carry_program_exercise_id ?? program_exercise_id`
// (CONTEXT.md "Week edits and carry fields"; weekEdits.ts's own header).
// The exact same formula, applied here to COMPARE two different weeks' own
// rows instead of to copy one forward: two weeks' own v2_week_plan_exercises
// rows denote "the same slot" iff this value agrees between them — exactly
// what a chain of copies (undisturbed by any further "only this week" edit)
// would have propagated unchanged. A plain program-tab edit has no week row
// and no carry concept at all — its own v2_program_exercises.id already IS
// the slot's canonical identity, so passing a bare id with no
// carryProgramExerciseId collapses to the same formula (undefined ?? id ===
// id).
//
// ─── Review fix: slot identity alone is not enough (first review) ─────────
// The carry mapping finds the right SLOT, but a slot can be occupied by a
// DIFFERENT exercise in a later week that has already diverged there (an
// "only this week" swap deliberately keeps the ORIGINAL exercise in
// carry_program_exercise_id so COPYING reverts to it later — it does not
// mean that week's CURRENT occupant still is that original exercise; it
// is, on purpose, something else right now). So every edit type except
// addExercise and reorderExercise ALSO requires the matched row's CURRENT
// exerciseId to equal the edited row's own (pre-edit) exerciseId —
// findMatchingExercise, below — otherwise this week already differs
// structurally for this slot, exactly like a missing row. addExercise has
// no existing row to compare at all; reorderExercise's own match (slot
// identity AND the exact pre-move position) is already strict enough on
// its own terms (reviewer's call) and doesn't care which exercise occupies
// the slot, only where it sits.
//
// ─── Review fix: a swap must repoint, never create a fresh row per week ───
// swapWeekExercise (weekPlanService.ts) always creates a brand-new
// week-only v2_program_exercises row — correct for the EDITED week (there
// is no existing row for the new exercise yet), but wrong for every LATER
// week this change applies to: creating ANOTHER fresh row per week would
// give each of them its own distinct id, so a FOLLOW-UP edit on the edited
// week's own (shared) id could never again find them (findMatchingExercise
// would see a different row's id). Copying forward never does this either
// — it reuses the SAME source row's id, v2_week_plan_exercises.program_
// exercise_id being nothing more than a foreign key, freely shared by many
// weeks' own rows. The swap change record below carries the edited week's
// own resulting row id (resultingProgramExerciseId); applying it ahead
// repoints each matched later week at that SAME row (repointWeekExercise,
// weekPlanService.ts) — never a second insert.
//
// ─── Matching (reviewer's note 3) ───────────────────────────────────────────
// A later week is changed only where the same slot (occupied by the same
// exercise — see above) and, for a value edit, the same set position
// within it, exists; where it doesn't — that week already differs
// structurally — it is skipped for this change only, alongside any week
// itself marked deload (reviewer's note 5: deload sessions take their
// values from deload rules, chunks 21/22, so a normal week's change must
// never silently overwrite one). See this chunk's report for the full
// edit-type table and the judgement calls below on matching an INSERT (add
// exercise/add stage; the program-tab's add-set), which has no pre-existing
// row to compare — scope decisions 5, 6, 7 and 8 in the report explain the
// rule this module applies to each.

import type { WeekPlan, ProgramExercise, WeekPlanSet } from '../../types'
import type { StageKind } from '../../lib/plannerVocabulary.js'
import { groupWeekPlanSets, nextStageIndex, type SetGroup } from '../gym/setGroupLogic'

// ─── Shared shapes ──────────────────────────────────────────────────────────

// Exactly the fields weekPlanService.ts's updateSet() takes — duplicated
// here (not imported) because updateSet's own `changes` param is an inline
// object type, not an exported one; this is this module's one copy of the
// same contract PlanPage.tsx's own SetChanges already is for the UI layer.
export interface WeekPlanSetChanges {
  targetRir?: number | null
  stageKind?: StageKind | null
  isWarmup?: boolean
  targetWeight?: number | null
  repMin?: number | null
  repMax?: number | null
  isAmrap?: boolean
  tags?: string[] | null
}

// A set's position within its slot, stable across weeks the same way a
// slot's identity is: heads are ranked by set_number ascending (the exact
// order PlanPage.tsx's own groups.sort((a,b) => a.head.setNumber -
// b.head.setNumber) already renders them in — "head ordinal" below IS that
// 1-based rank, not the raw, possibly-gapped set_number column itself,
// since two weeks' own set_number sequences can diverge independently of
// which "set" is structurally the same one); a stage is its head's ordinal
// plus its own stage_index (carried through copying verbatim, so it is
// already a stable per-head ordinal on its own — ADD STAGE always assigns
// max(existing)+1, never reused).
export interface SetPosition {
  headOrdinal: number // 1-based
  stageIndex: number | null // null = the head itself
}

export interface ReorderMove {
  slotId: string
  oldPosition: number
  newPosition: number
}

// ─── Change record (reviewer's note 2) ──────────────────────────────────────
// One per user edit (a compound edit that writes more than one field in a
// single onUpdate call — e.g. an AMRAP rep target that also defaults RIR,
// plannerVocabulary.ts's applyAmrapRirDefault — becomes more than one of
// these, applied together as one offer: PlanPage.tsx builds the list).
//
// `exerciseId` (every variant but addExercise/reorderExercise — review fix
// above): the REAL exercise that must currently occupy the matched row for
// the match to count. For swapExercise specifically this is the PRE-swap
// exercise (what later weeks still show); every other type's own edit
// never changes which exercise occupies the slot, so it's simply that
// row's current one. `resultingProgramExerciseId` (swapExercise only): the
// edited week's own v2_program_exercises row id AFTER the swap — the SAME
// row every matched later week is repointed at (never a fresh one).
//
// Value edits (weightTarget/repTarget/rir/tags/stageKind/warmup) carry the
// real old/new value. Structural edits carry whatever "old/new" naturally
// means for them (swap: the two exercise ids; reorder: each move's two
// positions); a pure insert (addExercise/addStage, and addSet) has no
// prior value to report, and a pure identity removal (removeExercise/
// removeStage/removeHeadSet, and the program-tab's removeSet) needs only
// enough to find the row — see the report's table for the full
// matched/written pair per type.
export type ChangeRecord =
  | { editType: 'weightTarget'; slotId: string; exerciseId: string; setPosition: SetPosition; oldValue: number | null; newValue: number | null }
  | {
      editType: 'repTarget'
      slotId: string
      exerciseId: string
      setPosition: SetPosition
      oldValue: { repMin: number | null; repMax: number | null; isAmrap: boolean }
      newValue: { repMin: number | null; repMax: number | null; isAmrap: boolean }
    }
  | { editType: 'rir'; slotId: string; exerciseId: string; setPosition: SetPosition; oldValue: number | null; newValue: number | null }
  | { editType: 'tags'; slotId: string; exerciseId: string; setPosition: SetPosition; oldValue: string[] | null; newValue: string[] | null }
  | { editType: 'stageKind'; slotId: string; exerciseId: string; setPosition: SetPosition; oldValue: StageKind | null; newValue: StageKind | null }
  // Chunk 15's WARMUP toggle (review fix item 3 — SPEC "offered when a week
  // is edited and later weeks are already planned" names no exception for
  // it). Head-only, same posture as tags/stageKind.
  | { editType: 'warmup'; slotId: string; exerciseId: string; setPosition: SetPosition; oldValue: boolean; newValue: boolean }
  | { editType: 'swapExercise'; slotId: string; exerciseId: string; newExerciseId: string; resultingProgramExerciseId: string }
  | { editType: 'removeExercise'; slotId: string; exerciseId: string }
  | { editType: 'addExercise'; workoutDayId: string; exerciseId: string }
  | { editType: 'reorderExercise'; moves: ReorderMove[] }
  | { editType: 'addStage'; slotId: string; exerciseId: string; headOrdinal: number }
  | { editType: 'removeStage'; slotId: string; exerciseId: string; setPosition: SetPosition }
  // Week-level REMOVE SET (review fix item 3 — per-row trash or compact
  // MINUS): removes the head at a SPECIFIC ordinal, never "whichever is
  // trailing" — distinct from the program-tab's own removeSet below, which
  // stays trailing-only (setExerciseSetCount's own shrink behaviour).
  | { editType: 'removeHeadSet'; slotId: string; exerciseId: string; headOrdinal: number }
  // addSet: both the week-level ADD SET button and the stable program-tab's
  // own stepper (+) — both always append at the matched week's own current
  // end, so one editType serves both (scope decisions 6/7, the report).
  | { editType: 'addSet'; slotId: string; exerciseId: string }
  // removeSet: the stable program-tab's stepper (−) ONLY — always the
  // matched week's own current trailing head (scope decision 7).
  | { editType: 'removeSet'; slotId: string; exerciseId: string }

export type ChangeEditType = ChangeRecord['editType']

// ─── Row operations — exactly what the executor hands to weekPlanService.ts
// (reviewer's note 1: "it returns the exact row operations"). Every op maps
// 1:1 onto one existing exported function there; userId and the
// onlyThisWeek flag (always false for an applied-ahead swap/reorder — see
// the report) are the executor's job to supply, not this module's.
export type ApplyAheadOp =
  | { kind: 'updateSet'; weekPlanId: string; setId: string; changes: WeekPlanSetChanges }
  | { kind: 'addSet'; weekPlanId: string; programExerciseId: string; setNumber: number }
  | { kind: 'removeSet'; weekPlanId: string; setId: string }
  | { kind: 'addStage'; weekPlanId: string; programExerciseId: string; parentId: string; setNumber: number; stageIndex: number }
  // Review fix: repoints the matched row at the SAME resulting exercise row
  // the edited week's own swap already created — never a second
  // createWeekOnlyProgramExercise insert (weekPlanService.ts's
  // repointWeekExercise does the two updates swapWeekExercise's own second
  // half already does, minus the insert).
  | { kind: 'repointExercise'; weekPlanId: string; fromProgramExerciseId: string; toProgramExerciseId: string }
  | { kind: 'addExercise'; weekPlanId: string; workoutDayId: string; exerciseId: string; position: number }
  | { kind: 'removeExercise'; weekPlanId: string; programExerciseId: string }
  | { kind: 'reorderExercises'; weekPlanId: string; moves: { programExerciseId: string; oldPosition: number; newPosition: number }[] }

export type SkipReason = 'deload' | 'structural'

export type WeekApplyResult =
  | { weekPlanId: string; weekNumber: number; status: 'applied'; ops: ApplyAheadOp[] }
  | { weekPlanId: string; weekNumber: number; status: 'skipped'; reason: SkipReason }

// ─── Slot identity + lookups ─────────────────────────────────────────────────

export function slotIdOf(pe: { id: string; carryProgramExerciseId?: string | null }): string {
  return pe.carryProgramExerciseId ?? pe.id
}

function findExercise(week: WeekPlan, slotId: string): ProgramExercise | undefined {
  return week.exercises.find((e) => slotIdOf(e) === slotId)
}

// Review fix: slot identity alone can still match a row that has since
// diverged to a DIFFERENT real exercise in this week (see this file's own
// header). Every call site but addExercise/reorderExercise goes through
// this, never findExercise directly.
function findMatchingExercise(week: WeekPlan, slotId: string, exerciseId: string): ProgramExercise | undefined {
  const row = findExercise(week, slotId)
  if (!row || row.exerciseId !== exerciseId) return undefined
  return row
}

// Heads only, this slot's own current rows, ranked the same way PlanPage.tsx
// already displays them (ascending set_number) — see SetPosition's own
// header comment on why this rank, not the raw column, is "head ordinal".
//
// Deliberately NOT warmup-aware (check-warmup-consumers.mjs's own coarse
// scan credits this file only because WeekPlanSetChanges's own isWarmup
// field happens to mention the word, not because of anything here): SPEC
// "Warmup sets" says a warmup is "never counted in... set counts", but
// PlanPage.tsx's OWN existing group numbering (ExerciseSection's
// groups.sort((a,b) => a.head.setNumber - b.head.setNumber), displayNumber
// = idx + 1) already includes a warmup head in that same ranking, with no
// exclusion of its own — this function matches THAT existing, on-screen
// convention exactly (reviewer's note: "the slot... identified across
// weeks the same way copying identifies it"; the same posture applies to
// a set's own position), rather than introduce a second, stricter
// definition of "head ordinal" that would disagree with what's on screen.
// Pre-existing, not a gap this chunk opens.
function sortedHeadsFor(week: WeekPlan, currentProgramExerciseId: string): WeekPlanSet[] {
  return week.sets
    .filter((s) => s.programExerciseId === currentProgramExerciseId && s.parentWeekPlanSetId == null)
    .sort((a, b) => a.setNumber - b.setNumber)
}

function stagesFor(week: WeekPlan, headId: string): WeekPlanSet[] {
  return week.sets.filter((s) => s.parentWeekPlanSetId === headId).sort((a, b) => a.stageIndex - b.stageIndex)
}

function resolveSetRow(week: WeekPlan, matched: ProgramExercise, pos: SetPosition): WeekPlanSet | undefined {
  const head = sortedHeadsFor(week, matched.id)[pos.headOrdinal - 1]
  if (!head) return undefined
  if (pos.stageIndex == null) return head
  return stagesFor(week, head.id).find((s) => s.stageIndex === pos.stageIndex)
}

// The UI's own already-sorted groups (PlanPage.tsx computes exactly this
// per exercise already: groupWeekPlanSets(...).sort((a,b) =>
// a.head.setNumber - b.head.setNumber)) resolved back to a SetPosition, so
// every call site builds a ChangeRecord from the same one definition of
// "head ordinal" this module itself matches against — never a second,
// possibly-diverging derivation.
export function setPositionOf(sortedGroups: SetGroup<WeekPlanSet>[], setId: string): SetPosition | null {
  for (let i = 0; i < sortedGroups.length; i++) {
    const g = sortedGroups[i]
    if (g.head.id === setId) return { headOrdinal: i + 1, stageIndex: null }
    const stage = g.stages.find((s) => s.id === setId)
    if (stage) return { headOrdinal: i + 1, stageIndex: stage.stageIndex }
  }
  return null
}

// ─── Candidate-week selection ────────────────────────────────────────────────

// Chunk 25 (reviewer's note 3 — "Apply-ahead... match by slot for sequence
// runs. Say how sequence_position enters their slot identity"): a later
// week's own row is the SAME slot as the edited one only when BOTH
// workoutDayId and sequencePosition agree — workoutDayId alone is
// ambiguous once a cycle can plan the same workout at two different slots
// (R16, SPEC G8: "A, B, A, rest"). `undefined` (every hand-built WeekPlan
// fixture across the existing, pre-chunk-25 test suite, and every weekday
// row ever written) is normalised to `null` on both sides first, so a
// weekday row (sequencePosition always null/undefined) still matches
// exactly the way it always has — this is a strict WIDENING of the match
// (narrower, never broader: a sequence row can no longer match a DIFFERENT
// slot's history that merely happens to share its workoutDayId), so no
// existing weekday behaviour changes.
function sameSlot(w: WeekPlan, workoutDayId: string, sequencePosition: number | null): boolean {
  return w.workoutDayId === workoutDayId && (w.sequencePosition ?? null) === sequencePosition
}

// Week-level edit (chunk 9/14/19 types): only weeks strictly after the one
// just edited, for the SAME slot (reviewer's note 4 — "later planned
// weeks"; chunk 25 — same slot, not just the same workout). "Planned"
// needs no extra filter here: allWeeks is already read from v2_week_plans
// (useAllWeekPlans/fetchAllWeekPlansForMeso), so a row's mere presence IS
// "planned" — an empty week (zero exercises) still has a row and still
// counts (reviewer's note 4's own words).
export function laterPlannedWeeks(
  allWeeks: WeekPlan[],
  workoutDayId: string,
  afterWeekNumber: number,
  sequencePosition: number | null = null,
): WeekPlan[] {
  return allWeeks
    .filter((w) => sameSlot(w, workoutDayId, sequencePosition) && w.weekNumber > afterWeekNumber)
    .sort((a, b) => a.weekNumber - b.weekNumber)
}

// Stable program-tab edit: there is no "edited week" to be later than (the
// edit happened on the program, not in a week) — SPEC "Programs and runs":
// "weeks not yet planned pick it up; apply-ahead covers planned ones" —
// every already-planned week for this WORKOUT is a candidate, regardless
// of number, deliberately NOT scoped by slot (chunk 25): a stable
// program's volume is rebuilt fresh from the program's own current state
// at plan time regardless of which slot an occurrence sits at
// (v2_plan_week's 'program' source-kind branch reads v2_program_exercises
// directly, with no notion of sequence_position at all — a stable
// program's exercises/sets are the SAME at every slot a given workoutDayId
// occupies, by construction), so a Program-tab volume edit must reach
// EVERY slot's own row, not just one of them. (Contrast laterPlannedWeeks
// above: a WEEK-LEVEL edit — swap/reorder/a single set's own value — is
// slot-specific, because the week-copy source search IS slot-aware.)
export function allPlannedWeeks(allWeeks: WeekPlan[], workoutDayId: string): WeekPlan[] {
  return allWeeks.filter((w) => w.workoutDayId === workoutDayId).sort((a, b) => a.weekNumber - b.weekNumber)
}

// ─── The pure core ───────────────────────────────────────────────────────────

export function planApplyAhead(change: ChangeRecord, weeks: WeekPlan[]): WeekApplyResult[] {
  return weeks.map((week) => resolveOneWeek(change, week))
}

function resolveOneWeek(change: ChangeRecord, week: WeekPlan): WeekApplyResult {
  const base = { weekPlanId: week.id, weekNumber: week.weekNumber }
  // Reviewer's note 5 — a blanket skip, checked before any slot/position
  // match: a deload session's values come from deload rules, never from a
  // normal week's direct edit.
  if (week.isDeload) return { ...base, status: 'skipped', reason: 'deload' }

  switch (change.editType) {
    case 'weightTarget':
    case 'rir':
    case 'tags':
    case 'stageKind':
    case 'warmup':
    case 'repTarget': {
      const row = findMatchingExercise(week, change.slotId, change.exerciseId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      const set = resolveSetRow(week, row, change.setPosition)
      if (!set) return { ...base, status: 'skipped', reason: 'structural' }
      const changes: WeekPlanSetChanges =
        change.editType === 'weightTarget'
          ? { targetWeight: change.newValue }
          : change.editType === 'rir'
            ? { targetRir: change.newValue }
            : change.editType === 'tags'
              ? { tags: change.newValue }
              : change.editType === 'stageKind'
                ? { stageKind: change.newValue }
                : change.editType === 'warmup'
                  ? { isWarmup: change.newValue }
                  : { repMin: change.newValue.repMin, repMax: change.newValue.repMax, isAmrap: change.newValue.isAmrap }
      return { ...base, status: 'applied', ops: [{ kind: 'updateSet', weekPlanId: week.id, setId: set.id, changes }] }
    }

    // Review fix: repoint the matched row at the SAME resulting row the
    // edited week's own swap produced — never a fresh insert per week (see
    // this file's own header comment on why a fresh row per week broke a
    // follow-up edit's own later match).
    case 'swapExercise': {
      const row = findMatchingExercise(week, change.slotId, change.exerciseId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      return {
        ...base,
        status: 'applied',
        ops: [{ kind: 'repointExercise', weekPlanId: week.id, fromProgramExerciseId: row.id, toProgramExerciseId: change.resultingProgramExerciseId }],
      }
    }

    case 'removeExercise': {
      const row = findMatchingExercise(week, change.slotId, change.exerciseId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      return { ...base, status: 'applied', ops: [{ kind: 'removeExercise', weekPlanId: week.id, programExerciseId: row.id }] }
    }

    // Scope decision 5 (report): an insert has no prior row to compare
    // identity or position against — its only "container" is the week
    // itself, which, for an already-planned week, trivially exists — so
    // this never skips structurally, only for deload (handled above).
    // Appends at THIS week's own current end, not the edited week's
    // recorded position (that week's own count may differ). No exerciseId
    // check (review fix) — there is no existing row to compare it against.
    case 'addExercise': {
      const position = week.exercises.length
      return {
        ...base,
        status: 'applied',
        ops: [{ kind: 'addExercise', weekPlanId: week.id, workoutDayId: change.workoutDayId, exerciseId: change.exerciseId, position }],
      }
    }

    // Scope decision 8 (report): position IS the value being written here,
    // so matching additionally requires each moved slot's CURRENT position
    // in this week to equal the edited week's own pre-move position — not
    // just that the slot exists. All-or-nothing per week: if any one move
    // fails either check, the whole reorder is skipped for this week
    // (a partial reorder could otherwise leave an inconsistent order). No
    // exerciseId check (review fix, reviewer's own call) — reorder cares
    // only about identity and position, never which exercise occupies the
    // slot.
    case 'reorderExercise': {
      const resolvedMoves: { programExerciseId: string; oldPosition: number; newPosition: number }[] = []
      for (const m of change.moves) {
        const row = findExercise(week, m.slotId)
        if (!row || row.position !== m.oldPosition) return { ...base, status: 'skipped', reason: 'structural' }
        resolvedMoves.push({ programExerciseId: row.id, oldPosition: m.oldPosition, newPosition: m.newPosition })
      }
      return { ...base, status: 'applied', ops: [{ kind: 'reorderExercises', weekPlanId: week.id, moves: resolvedMoves }] }
    }

    // Scope decision 5 (report): the container is the matched HEAD (must
    // exist); once found, a stage is always appended fresh (nextStageIndex
    // computed from THIS week's own current stage count under that head,
    // setGroupLogic.ts — never the edited week's own new index), mirroring
    // exactly what a direct ADD STAGE tap in that week would compute.
    case 'addStage': {
      const row = findMatchingExercise(week, change.slotId, change.exerciseId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      const head = sortedHeadsFor(week, row.id)[change.headOrdinal - 1]
      if (!head) return { ...base, status: 'skipped', reason: 'structural' }
      const group: SetGroup<WeekPlanSet> = { head, stages: stagesFor(week, head.id) }
      const stageIndex = nextStageIndex(group, (s) => s.stageIndex)
      return {
        ...base,
        status: 'applied',
        ops: [{ kind: 'addStage', weekPlanId: week.id, programExerciseId: row.id, parentId: head.id, setNumber: head.setNumber, stageIndex }],
      }
    }

    case 'removeStage': {
      const row = findMatchingExercise(week, change.slotId, change.exerciseId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      const set = resolveSetRow(week, row, change.setPosition)
      if (!set) return { ...base, status: 'skipped', reason: 'structural' }
      return { ...base, status: 'applied', ops: [{ kind: 'removeSet', weekPlanId: week.id, setId: set.id }] }
    }

    // Review fix item 3 — week-level REMOVE SET (per-row trash or compact
    // MINUS): removes the head at the SAME ordinal, never "whichever is
    // trailing" there (distinct from the program-tab's own removeSet,
    // below, which is deliberately trailing-only).
    case 'removeHeadSet': {
      const row = findMatchingExercise(week, change.slotId, change.exerciseId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      const head = sortedHeadsFor(week, row.id)[change.headOrdinal - 1]
      if (!head) return { ...base, status: 'skipped', reason: 'structural' }
      return { ...base, status: 'applied', ops: [{ kind: 'removeSet', weekPlanId: week.id, setId: head.id }] }
    }

    // Scope decisions 6/7 (report): addSet never backfills a rep target
    // (same as the plain week-level addSet() it reuses, for both the week
    // button and the program-tab stepper); removeSet (program-tab only)
    // always removes THIS week's own current trailing head (mirrors
    // setExerciseSetCount's own shrink behaviour), not a recorded absolute
    // ordinal — symmetric with addSet's own "append at my own end".
    case 'addSet': {
      const row = findMatchingExercise(week, change.slotId, change.exerciseId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      const heads = sortedHeadsFor(week, row.id)
      return {
        ...base,
        status: 'applied',
        ops: [{ kind: 'addSet', weekPlanId: week.id, programExerciseId: row.id, setNumber: heads.length + 1 }],
      }
    }

    case 'removeSet': {
      const row = findMatchingExercise(week, change.slotId, change.exerciseId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      const heads = sortedHeadsFor(week, row.id)
      const trailing = heads[heads.length - 1]
      if (!trailing) return { ...base, status: 'skipped', reason: 'structural' }
      return { ...base, status: 'applied', ops: [{ kind: 'removeSet', weekPlanId: week.id, setId: trailing.id }] }
    }
  }
}

// A compound user action (e.g. an AMRAP rep target that also defaults RIR
// to 0 when none was set yet — plannerVocabulary.ts's applyAmrapRirDefault,
// written through PlanPage.tsx's one onUpdate call) produces more than one
// ChangeRecord from a single edit. They are applied to each candidate week
// as ONE atomic bundle, never partially: every record in the bundle always
// targets the very same row (same slotId/setPosition — they come from the
// same onUpdate call), so in practice they always match or fail together;
// this still makes that explicit rather than relying on it. A deload skip
// wins over a structural one if (hypothetically) they disagreed, since
// deload is the more specific, intentional reason.
export function planApplyAheadBundle(changes: ChangeRecord[], weeks: WeekPlan[]): WeekApplyResult[] {
  if (changes.length === 0) {
    return weeks.map((w) => ({ weekPlanId: w.id, weekNumber: w.weekNumber, status: 'skipped', reason: 'structural' }))
  }
  const perChange = changes.map((c) => planApplyAhead(c, weeks))
  return weeks.map((week, i) => {
    const forWeek = perChange.map((results) => results[i])
    const deloadSkip = forWeek.find((r): r is Extract<WeekApplyResult, { status: 'skipped' }> => r.status === 'skipped' && r.reason === 'deload')
    if (deloadSkip) return deloadSkip
    const structuralSkip = forWeek.find((r): r is Extract<WeekApplyResult, { status: 'skipped' }> => r.status === 'skipped')
    if (structuralSkip) return structuralSkip
    const ops = forWeek.flatMap((r) => (r.status === 'applied' ? r.ops : []))
    return { weekPlanId: week.id, weekNumber: week.weekNumber, status: 'applied', ops }
  })
}

// ─── Summary — "Applied to N of M planned weeks" (reviewer's note 3) ───────

export interface ApplyAheadSummary {
  total: number
  applied: number
  skippedDeload: number
  skippedStructural: number
}

export function summarizeApplyAhead(results: WeekApplyResult[]): ApplyAheadSummary {
  let applied = 0
  let skippedDeload = 0
  let skippedStructural = 0
  for (const r of results) {
    if (r.status === 'applied') applied++
    else if (r.reason === 'deload') skippedDeload++
    else skippedStructural++
  }
  return { total: results.length, applied, skippedDeload, skippedStructural }
}

// Re-exported for callers that already have a SetGroup (PlanPage.tsx) and
// want the same grouping/sort this module uses internally, so "head
// ordinal" is computed identically on both sides — never ad hoc (CONTEXT.md
// stage-exclusion rule).
export function sortedGroupsFor(sets: WeekPlanSet[], currentProgramExerciseId: string): SetGroup<WeekPlanSet>[] {
  return groupWeekPlanSets(sets.filter((s) => s.programExerciseId === currentProgramExerciseId)).sort(
    (a, b) => a.head.setNumber - b.head.setNumber,
  )
}
