// Chunk 9 (TASKS.md "Edit a week's exercises" / SPEC.md "Weeks and
// copying") — the pure carry semantics a week's swap/reorder/add/remove
// actions are built from, kept Supabase-free the same way weekSources.ts
// is: every DECISION lives here, unit-tested directly; weekPlanService.ts
// gathers what each decision needs and performs the actual writes.
//
// What belongs to which action (SPEC "Weeks and copying" / "Supersets"):
//   - SWAP points the week's slot at a brand-new week-only program exercise
//     (its planned sets move with it — weekPlanService.ts's swapWeekExercise
//     updates both the v2_week_plan_exercises row and that week's own
//     v2_week_plan_sets rows to the new slot); the replacement takes the
//     replaced slot's superset block, never its target_reps/weight_unit
//     (resolveSwapSlot). "Only this week", ticked, keeps the PRE-swap slot
//     in carry_program_exercise_id so copying forward reverts
//     (resolveSwapCarry); off (the default), the swap carries forward like
//     any other permanent change.
//   - REORDER changes the week's own position only — no new
//     v2_program_exercises row, no carry_program_exercise_id. "Only this
//     week", ticked, keeps the PRE-reorder position in carry_position so
//     copying forward reverts to the old order (resolveReorderCarry); off,
//     the new order carries forward.
//   - ADD creates a week-only slot with no superset block (resolveAddSlot)
//     and no carry_* at all — week-dependent: it carries forward simply
//     because the new week's own copy-forward includes whatever the source
//     week's v2_week_plan_exercises row names (coalesce(carry_*, own
//     value) falls through to the add's own slot, unmapped); stable: it
//     never carries forward, because a stable week never reads the
//     previous week's v2_week_plan_exercises at all (migration 032's
//     'program' branch). Neither needs a decision function here — DECISIONS
//     48 (a): "only this week" applies to swap and reorder only; schema and
//     UI carry no tick for add.
//   - REMOVE drops the week's own v2_week_plan_exercises row and its
//     v2_week_plan_sets rows (weekPlanService.ts's removeWeekExercise) — no
//     carry_* either: a row that doesn't exist in the source week being
//     copied forward is simply absent from the copy, carrying "forward"
//     (or not) purely by not being there to carry. Same DECISIONS 48 (a)
//     reasoning as add.
//
// Every function here recomputes its result from the edit's own before-
// state and its own onlyThisWeek flag alone — never from whatever a PRIOR
// edit may have left in carry_program_exercise_id/carry_position — so a
// later permanent edit always correctly clears a stale "only this week"
// override from an earlier one, and there is no stale-carry state to track
// across edits.

// ─── Swap ───────────────────────────────────────────────────────────────────

export interface SwapSourceSlot {
  workoutDayId: string
  position: number
  supersetBlockId: string | null
}

export interface NewWeekOnlySlot {
  workoutDayId: string
  exerciseId: string
  position: number
  supersetBlockId: string | null
}

// The replacement's own row: the replaced slot's position and superset
// block (SPEC "Supersets": "a week-only slot created by a swap keeps the
// replaced slot's block"), the picked exercise's identity — nothing else
// carries over (not target_reps, not weight_unit: a different exercise
// identity's own suggested reps/unit preference don't apply to it).
export function resolveSwapSlot(source: SwapSourceSlot, replacementExerciseId: string): NewWeekOnlySlot {
  return {
    workoutDayId: source.workoutDayId,
    exerciseId: replacementExerciseId,
    position: source.position,
    supersetBlockId: source.supersetBlockId,
  }
}

export interface SwapCarryFields {
  carryProgramExerciseId: string | null
  carryPosition: null
}

// SPEC "Weeks and copying": "'Only this week'... a tick on swap and reorder
// actions... off by default, week-dependent only. When ticked, that change
// is not copied forward." preSwapProgramExerciseId is the slot's identity
// immediately BEFORE this swap (what the week_plan_exercises row's own
// program_exercise_id was) — stored in carry_program_exercise_id only when
// ticked, so copying forward reverts to it (migration 032 / weekPlanService
// copy logic: coalesce(carry_program_exercise_id, program_exercise_id)).
// carry_position is untouched by a swap (reorder's own field).
export function resolveSwapCarry(preSwapProgramExerciseId: string, onlyThisWeek: boolean): SwapCarryFields {
  return {
    carryProgramExerciseId: onlyThisWeek ? preSwapProgramExerciseId : null,
    carryPosition: null,
  }
}

// ─── Reorder ────────────────────────────────────────────────────────────────

export interface ReorderCarryFields {
  carryPosition: number | null
}

// prePosition is the row's own position immediately BEFORE this reorder.
// Ticked: carry_position keeps the old order, so copying forward reverts to
// it. Off: carry_position clears (null), so copying forward uses the new
// position — including clearing a STALE carry_position a previous
// only-this-week reorder of the SAME row may have left (this function never
// reads that prior value, only prePosition/onlyThisWeek, so there is
// nothing stale to carry by accident).
export function resolveReorderCarry(prePosition: number, onlyThisWeek: boolean): ReorderCarryFields {
  return { carryPosition: onlyThisWeek ? prePosition : null }
}

// ─── Add ────────────────────────────────────────────────────────────────────

// An added exercise is never in a superset (SPEC "Supersets").
export function resolveAddSlot(workoutDayId: string, exerciseId: string, position: number): NewWeekOnlySlot {
  return { workoutDayId, exerciseId, position, supersetBlockId: null }
}
