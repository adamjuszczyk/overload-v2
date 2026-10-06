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
//     replaced slot's superset block, never its weight_unit
//     (resolveSwapSlot). "Only this week", ticked, keeps the ORIGINAL
//     pre-swap slot in carry_program_exercise_id so copying forward
//     reverts to it (resolveSwapCarry) — "original" meaning whatever this
//     row's carry_program_exercise_id ALREADY held, if a previous
//     only-this-week swap of the same row already recorded one; only when
//     there is no existing carry does this swap's own pre-swap identity
//     become it. A REPEATED only-this-week swap must never overwrite an
//     already-recorded original with the (already a week-only slot from
//     the last swap) intermediate identity — that was chunk 9's own review
//     bug: S swapped only-this-week to W1 (carry=S), then W1 swapped
//     only-this-week to W2 recomputed carry from W1 alone and got W1, not
//     S. Off (permanent), carry_program_exercise_id always resets to null,
//     regardless of what it held — a permanent change is never reverted.
//     Either way, a swap never touches carry_position (reorder's own
//     field) — it is echoed back unchanged.
//   - REORDER changes the week's own position only — no new
//     v2_program_exercises row, no carry_program_exercise_id. "Only this
//     week", ticked, keeps the ORIGINAL pre-reorder position in
//     carry_position (same "existing carry wins" rule as swap above, so a
//     second only-this-week reorder of the same row doesn't overwrite the
//     true original order with the already-moved intermediate one) so
//     copying forward reverts to it (resolveReorderCarry); off, carry_position
//     always resets to null.
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
// resolveSwapCarry/resolveReorderCarry both take the row's CURRENT carry_*
// (read by weekPlanService.ts before writing the new one) alongside this
// edit's own before-state and onlyThisWeek flag: an only-this-week edit
// preserves whatever original value is already there (so repeating the
// same kind of only-this-week edit never drifts away from the true
// original), while a permanent edit always resets to null regardless of
// what was there (so a later permanent edit still correctly clears a stale
// "only this week" override from an earlier one).

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
// carries over (not weight_unit: a different exercise identity's own unit
// preference doesn't apply to it).
export function resolveSwapSlot(source: SwapSourceSlot, replacementExerciseId: string): NewWeekOnlySlot {
  return {
    workoutDayId: source.workoutDayId,
    exerciseId: replacementExerciseId,
    position: source.position,
    supersetBlockId: source.supersetBlockId,
  }
}

export interface CurrentSwapCarry {
  carryProgramExerciseId: string | null
  carryPosition: number | null
}

export interface SwapCarryFields {
  carryProgramExerciseId: string | null
  carryPosition: number | null
}

// SPEC "Weeks and copying": "'Only this week'... a tick on swap and reorder
// actions... off by default, week-dependent only. When ticked, that change
// is not copied forward." preSwapProgramExerciseId is the slot's identity
// immediately BEFORE this swap (what the week_plan_exercises row's own
// program_exercise_id was right now — possibly already a week-only
// replacement from an earlier swap, not necessarily the true original).
//
// Only this week: `current.carryProgramExerciseId ?? preSwapProgramExerciseId`
// — if this row ALREADY carries an original (an earlier only-this-week
// swap of it), that original wins and is kept; only when there is no
// existing carry does this swap's own pre-swap identity become the
// recorded original. This is what makes a REPEATED only-this-week swap
// keep reverting to the true original instead of drifting to whatever the
// most recent swap's own pre-swap slot happened to be.
//
// Permanent (off): always null, regardless of `current` — a permanent
// change is never reverted, and it also clears any stale carry an earlier
// only-this-week swap of this same row left behind.
//
// carry_position is a swap's to leave alone either way — echoed back from
// `current` unchanged (reorder's own field; see resolveReorderCarry).
export function resolveSwapCarry(
  current: CurrentSwapCarry,
  preSwapProgramExerciseId: string,
  onlyThisWeek: boolean,
): SwapCarryFields {
  return {
    carryProgramExerciseId: onlyThisWeek ? (current.carryProgramExerciseId ?? preSwapProgramExerciseId) : null,
    carryPosition: current.carryPosition,
  }
}

// ─── Reorder ────────────────────────────────────────────────────────────────

export interface CurrentReorderCarry {
  carryPosition: number | null
}

export interface ReorderCarryFields {
  carryPosition: number | null
}

// prePosition is the row's own position immediately BEFORE this reorder
// (possibly already a moved position from an earlier reorder, not
// necessarily the true original order).
//
// Only this week: `current.carryPosition ?? prePosition` — the same
// "existing carry wins" rule resolveSwapCarry uses, so a REPEATED
// only-this-week reorder of the same row keeps reverting to the true
// original order instead of drifting to whatever the most recent reorder's
// own pre-reorder position happened to be.
//
// Permanent (off): always null, regardless of `current` — clears a stale
// carry an earlier only-this-week reorder of this row left behind, so
// copying forward uses the new position.
export function resolveReorderCarry(
  current: CurrentReorderCarry,
  prePosition: number,
  onlyThisWeek: boolean,
): ReorderCarryFields {
  return { carryPosition: onlyThisWeek ? (current.carryPosition ?? prePosition) : null }
}

// ─── Add ────────────────────────────────────────────────────────────────────

// An added exercise is never in a superset (SPEC "Supersets").
export function resolveAddSlot(workoutDayId: string, exerciseId: string, position: number): NewWeekOnlySlot {
  return { workoutDayId, exerciseId, position, supersetBlockId: null }
}
