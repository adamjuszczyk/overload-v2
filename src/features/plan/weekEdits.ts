// Chunk 9 (TASKS.md "Edit a week's exercises" / SPEC.md "Weeks and
// copying") — the pure slot decisions a week's swap/add actions are built
// from, kept Supabase-free the same way weekSources.ts is: every DECISION
// lives here, unit-tested directly; weekPlanService.ts gathers what each
// decision needs and performs the actual writes.
//
// Chunk 27 (SPEC [P1.1] "'Only this week' is removed"): the carry helpers
// that used to live here (resolveSwapCarry / resolveReorderCarry) are gone.
// A swap or reorder in a week is a normal week edit — it carries forward,
// and a one-off change is made in the session itself (the mid-workout swap)
// or changed back the following week. weekPlanService.ts writes exactly what
// a permanent edit always wrote: a swap clears carry_program_exercise_id and
// leaves carry_position out of its payload; a reorder clears carry_position
// and leaves carry_program_exercise_id out of its payload. Values of the
// other kind already stored are left alone, and nothing reads either column
// any more — copying and matching use each row's own program_exercise_id and
// position (migration 038 for the server side).
//
// What belongs to which action (SPEC "Weeks and copying" / "Supersets"):
//   - SWAP points the week's slot at a brand-new week-only program exercise
//     (its planned sets move with it — weekPlanService.ts's swapWeekExercise
//     updates both the v2_week_plan_exercises row and that week's own
//     v2_week_plan_sets rows to the new slot); the replacement takes the
//     replaced slot's superset block, never its weight_unit
//     (resolveSwapSlot).
//   - REORDER changes the week's own position only — no new
//     v2_program_exercises row.
//   - ADD creates a week-only slot with no superset block (resolveAddSlot):
//     week-dependent, it carries forward because the next week's copy
//     includes whatever the source week's v2_week_plan_exercises row names;
//     stable, it never carries forward, because a stable week never reads
//     the previous week's v2_week_plan_exercises at all (migration 032's
//     'program' branch). Neither needs a decision function here.
//   - REMOVE drops the week's own v2_week_plan_exercises row and its
//     v2_week_plan_sets rows (weekPlanService.ts's removeWeekExercise): a
//     row that doesn't exist in the source week being copied forward is
//     simply absent from the copy.

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

// ─── Add ────────────────────────────────────────────────────────────────────

// An added exercise is never in a superset (SPEC "Supersets").
export function resolveAddSlot(workoutDayId: string, exerciseId: string, position: number): NewWeekOnlySlot {
  return { workoutDayId, exerciseId, position, supersetBlockId: null }
}
