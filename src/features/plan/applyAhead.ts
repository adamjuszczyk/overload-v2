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
// (swapWeekExercise, addWeekExercise, removeWeekExercise,
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
// ─── Matching (reviewer's note 3) ───────────────────────────────────────────
// A later week is changed only where the same slot (and, for a value edit,
// the same set position within it) exists; where it doesn't — that week
// already differs structurally — it is skipped for this change only,
// alongside any week itself marked deload (reviewer's note 5: deload
// sessions take their values from deload rules, chunks 21/22, so a normal
// week's change must never silently overwrite one). See this chunk's
// report for the full edit-type table and the judgement calls below on
// matching an INSERT (add exercise/add stage; the program-tab's add-set),
// which has no pre-existing row to compare — scope decisions 5, 6, 7 and 8
// in the report explain the rule this module applies to each.

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
// Value edits (weightTarget/repTarget/rir/tags/stageKind) carry the real
// old/new value. Structural edits carry whatever "old/new" naturally means
// for them (swap: the two exercise ids; reorder: each move's two
// positions); a pure insert (addExercise/addStage, and the program-tab's
// addSet) has no prior value to report, and a pure identity removal
// (removeExercise/removeStage, and the program-tab's removeSet) needs only
// enough to find the row — see the report's table for the full
// matched/written pair per type.
export type ChangeRecord =
  | { editType: 'weightTarget'; slotId: string; setPosition: SetPosition; oldValue: number | null; newValue: number | null }
  | {
      editType: 'repTarget'
      slotId: string
      setPosition: SetPosition
      oldValue: { repMin: number | null; repMax: number | null; isAmrap: boolean }
      newValue: { repMin: number | null; repMax: number | null; isAmrap: boolean }
    }
  | { editType: 'rir'; slotId: string; setPosition: SetPosition; oldValue: number | null; newValue: number | null }
  | { editType: 'tags'; slotId: string; setPosition: SetPosition; oldValue: string[] | null; newValue: string[] | null }
  | { editType: 'stageKind'; slotId: string; setPosition: SetPosition; oldValue: StageKind | null; newValue: StageKind | null }
  | { editType: 'swapExercise'; slotId: string; oldExerciseId: string; newExerciseId: string }
  | { editType: 'removeExercise'; slotId: string }
  | { editType: 'addExercise'; workoutDayId: string; exerciseId: string }
  | { editType: 'reorderExercise'; moves: ReorderMove[] }
  | { editType: 'addStage'; slotId: string; headOrdinal: number }
  | { editType: 'removeStage'; slotId: string; setPosition: SetPosition }
  // Stable program-tab volume edits only (reviewer's note 2's last group) —
  // PlanPage.tsx's own week-level ADD SET/REMOVE SET are out of this
  // chunk's scope (see the report's scope decisions); these two are built
  // only by ProgramTab.tsx's wiring.
  | { editType: 'addSet'; slotId: string }
  | { editType: 'removeSet'; slotId: string }

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
  | { kind: 'swapExercise'; weekPlanId: string; programExerciseId: string; replacementExerciseId: string }
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

// Week-level edit (chunk 9/14/19 types): only weeks strictly after the one
// just edited, for the SAME workout (reviewer's note 4 — "later planned
// weeks"). "Planned" needs no extra filter here: allWeeks is already read
// from v2_week_plans (useAllWeekPlans/fetchAllWeekPlansForMeso), so a
// row's mere presence IS "planned" — an empty week (zero exercises) still
// has a row and still counts (reviewer's note 4's own words).
export function laterPlannedWeeks(allWeeks: WeekPlan[], workoutDayId: string, afterWeekNumber: number): WeekPlan[] {
  return allWeeks
    .filter((w) => w.workoutDayId === workoutDayId && w.weekNumber > afterWeekNumber)
    .sort((a, b) => a.weekNumber - b.weekNumber)
}

// Stable program-tab edit: there is no "edited week" to be later than (the
// edit happened on the program, not in a week) — SPEC "Programs and runs":
// "weeks not yet planned pick it up; apply-ahead covers planned ones" —
// every already-planned week for this workout is a candidate, regardless of
// number.
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
    case 'repTarget': {
      const row = findExercise(week, change.slotId)
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
                : { repMin: change.newValue.repMin, repMax: change.newValue.repMax, isAmrap: change.newValue.isAmrap }
      return { ...base, status: 'applied', ops: [{ kind: 'updateSet', weekPlanId: week.id, setId: set.id, changes }] }
    }

    case 'swapExercise': {
      const row = findExercise(week, change.slotId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      return {
        ...base,
        status: 'applied',
        ops: [{ kind: 'swapExercise', weekPlanId: week.id, programExerciseId: row.id, replacementExerciseId: change.newExerciseId }],
      }
    }

    case 'removeExercise': {
      const row = findExercise(week, change.slotId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      return { ...base, status: 'applied', ops: [{ kind: 'removeExercise', weekPlanId: week.id, programExerciseId: row.id }] }
    }

    // Scope decision 5 (report): an insert has no prior row to compare
    // identity or position against — its only "container" is the week
    // itself, which, for an already-planned week, trivially exists — so
    // this never skips structurally, only for deload (handled above).
    // Appends at THIS week's own current end, not the edited week's
    // recorded position (that week's own count may differ).
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
    // (a partial reorder could otherwise leave an inconsistent order).
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
      const row = findExercise(week, change.slotId)
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
      const row = findExercise(week, change.slotId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      const set = resolveSetRow(week, row, change.setPosition)
      if (!set) return { ...base, status: 'skipped', reason: 'structural' }
      return { ...base, status: 'applied', ops: [{ kind: 'removeSet', weekPlanId: week.id, setId: set.id }] }
    }

    // Scope decision 6/7 (report): program-tab only. addSet never backfills
    // a rep target (same as the plain week-level addSet() it reuses);
    // removeSet always removes THIS week's own current trailing head
    // (mirrors setExerciseSetCount's own shrink behaviour), not a recorded
    // absolute ordinal — symmetric with addSet's own "append at my own end".
    case 'addSet': {
      const row = findExercise(week, change.slotId)
      if (!row) return { ...base, status: 'skipped', reason: 'structural' }
      const heads = sortedHeadsFor(week, row.id)
      return {
        ...base,
        status: 'applied',
        ops: [{ kind: 'addSet', weekPlanId: week.id, programExerciseId: row.id, setNumber: heads.length + 1 }],
      }
    }

    case 'removeSet': {
      const row = findExercise(week, change.slotId)
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
