// Chunk 16 (TASKS.md "The rest chain" / SPEC.md "Rest [P1]") — the pure
// resolver for "what should the rest timer show after this set". Same
// precedent as setGroupLogic.ts/referenceLogic.ts/stageCarryLogic.ts: pure,
// no React, no Supabase, independently testable; the caller
// (useExerciseCardState.ts) builds this module's input from whatever it
// already has in scope and nothing else reads the DB directly for this.
//
// SPEC "Rest", verbatim:
//   Timer value, most specific first:
//     1. the set's own rest override
//     2. on an exercise's last set: the exercise's "rest after"
//     3. the exercise's rest
//     4. the global rest setting
//   Supersets: no timer between exercises within a round by default; the
//   block's rest after each round. Both overridable per superset.
//     - With no superset override, the rest after a round is the normal
//       chain of the exercise that ends the round.
//     - An exercise's "rest after" never fires inside a round; it applies
//       only after the block's final round.
//     - A set's own explicit rest override wins over "no timer within a
//       round".
//   Staged sets: the staged set's own rest between stages (dropset: no
//   timer; rest-pause, myo-reps, cluster: 15s by default).
//   Warmup sets follow the same chain.
//
// Return value: a resolved rest in seconds, or `null` meaning "no timer at
// all" (reviewer brief: "restTimerStore / RestTimer / RestTimerInline carry
// a per-rest target or 'no timer'"). `null` is a real, terminal result here
// — it is never "fall through to the next level", only "level 4, the global
// setting" ever falls through further, and it is never null (settingsStore's
// targetRestSeconds always has a value).
//
// ─── SPEC-literal readings (ambiguous cases — see this chunk's report) ─────
//
// 1. Legacy/un-kinded staged sets (stage_kind null) are NOT promoted to
//    'dropset' here the way plannerVocabulary.ts's resolveStageKind promotes
//    it for DISPLAY purposes (stage labels, carry-weight). D30 (CONTEXT.md,
//    Adam 2026-10-05) requires an existing dropset to "time rests exactly as
//    before" — today (master, pre-chunk-16) EVERY set, staged or not, starts
//    the timer at the global setting (restTimerStore.start() takes no
//    arguments at all; RestTimer.d30.test.tsx proves this is the only
//    possible behaviour). If a null stage_kind read as 'dropset' here the
//    same way it does for display, EVERY existing dropset (the column has
//    never been written before this chunk) would retroactively lose its
//    rest timer — a regression D30 explicitly forbids. So: `stage.kind` must
//    be an EXPLICIT, literal value (written by the chunk-11/14 STAGE KIND
//    chip) for this module to apply a stage-kind rest rule at all; a null
//    kind falls through to the normal exercise/global chain, unchanged from
//    today. This only affects REST; resolveStageKind's own null→dropset
//    promotion is untouched everywhere else (labels, carry-over).
//
// 2. "Staged sets: the staged set's own rest between stages" is read as
//    applying only while there IS a next stage still to come — once the
//    group's last configured stage is logged, the transition is to the
//    exercise's NEXT SET (or the next exercise), which is a normal (or
//    superset) chain concern, not a between-stages one. A stage-bearing head
//    with zero stages configured yet behaves the same way (hasNextStage
//    false), so logging it alone (nothing to rest before) is unaffected.
//
// 3. Superset round boundaries ("a superset member's last set falls mid-
//    block while others continue", e.g. 4 sets of A / 3 of B → round 4 is
//    A-only): B's own last set (B3) ends round 3, which is NOT the block's
//    final round (round 4 still has A4 to come) — SPEC's own words, "An
//    exercise's rest after never fires inside a round; it applies only
//    after the block's final round", are read literally: B's rest-after is
//    simply never applied at the round-3 boundary (falls through to B's
//    plain exercise-rest/global instead), and B never re-enters a later
//    round boundary where it could apply (B has no cell in round 4 at all).
//    This is intentional, not a bug — B's "rest after" effectively never
//    fires in this run; only an exercise present in the block's OWN final
//    round can ever reach level 2 while inside a superset.
//
// 4. Warmup sets never count as "an exercise's last set" for level-2
//    purposes (SPEC's level 2 is about finishing the EXERCISE's working
//    sets before moving on — a warmup finishing is never that). A warmup's
//    own rest override (level 1) still applies; warmups are never staged
//    (the DB's own check) and never render inside a superset's round grid
//    (chunk 15 — rendered per-member, above the rounds), so neither the
//    stage nor the superset branch is ever reached for one.

import { DEFAULT_STAGE_REST_SECONDS, type StageKind } from '../../lib/plannerVocabulary.js'

// Present only while logging a row that is part of a staged group (a head
// that has (or will have) stages, or a stage itself) — null/absent (not
// this type at all) for a plain working set or a warmup.
export interface StageChainInput {
  // The HEAD's own stage_kind, exactly as stored — null for every legacy or
  // never-kinded row (see reading 1 above); never resolveStageKind's
  // display-only promotion.
  kind: StageKind | null
  // Is there a next stage still to come after the row just logged (the
  // head, resting before stage 1; or stage N, resting before stage N+1)?
  // False once the group's last configured stage has just been logged, or
  // for a stage-less head (see reading 2 above).
  hasNextStage: boolean
  // v2_program_sets.stage_rest_seconds on the HEAD (design field) — null
  // means "use the kind's own default" (DEFAULT_STAGE_REST_SECONDS).
  stageRestSecondsOverride: number | null
}

// Present only for a superset member; null/absent for a plain exercise.
export interface SupersetChainInput {
  // Is the row just logged the LAST cell (zigzag/member order) of its round?
  endsRound: boolean
  // Is this round the block's own last round?
  isFinalRound: boolean
  // v2_program_superset_blocks.rest_within_round_seconds — overrides "no
  // timer" for a non-round-ending cell; null keeps the default (no timer).
  restWithinRoundSeconds: number | null
  // v2_program_superset_blocks.rest_after_round_seconds — overrides the
  // round-boundary rest; null falls through to the ending exercise's own
  // chain (see reading 3 above).
  restAfterRoundSeconds: number | null
}

export interface RestChainInput {
  // Level 1, always checked first, everywhere — including ahead of a
  // superset's "no timer within a round" default (SPEC: "A set's own
  // explicit rest override wins over 'no timer within a round'").
  setOverrideSeconds: number | null
  // Is the row just logged the exercise's own last (planned) set, by
  // position? Always false for a warmup (reading 4 above); evaluated at the
  // HEAD level for a stage (stages are never independent sets).
  isLastSetOfExercise: boolean
  // v2_program_exercises.rest_after_seconds — level 2.
  exerciseRestAfterSeconds: number | null
  // v2_program_exercises.rest_seconds — level 3.
  exerciseRestSeconds: number | null
  // v2_user_settings.targetRestSeconds — level 4, always a real number.
  globalRestSeconds: number
  stage: StageChainInput | null
  superset: SupersetChainInput | null
}

export function resolveRestTarget(input: RestChainInput): number | null {
  // Level 1 — unconditional, everywhere (see this module's own header).
  if (input.setOverrideSeconds != null) return input.setOverrideSeconds

  // Staged sets — "the staged set's own rest between stages" (reading 1/2).
  if (input.stage && input.stage.kind != null && input.stage.hasNextStage) {
    return input.stage.stageRestSecondsOverride ?? DEFAULT_STAGE_REST_SECONDS[input.stage.kind]
  }

  if (input.superset) {
    if (!input.superset.endsRound) {
      // "No timer between exercises within a round by default" —
      // overridable per superset; null here simply keeps "no timer".
      return input.superset.restWithinRoundSeconds
    }
    if (input.superset.restAfterRoundSeconds != null) return input.superset.restAfterRoundSeconds
    // Falls through to the normal chain below — "the normal chain of the
    // exercise that ends the round" — demoted (level 2 unavailable) unless
    // this is the block's final round (reading 3 above).
  }

  // Normal per-exercise chain, levels 2–4. A superset's round-ending cell
  // only reaches level 2 when this round is the block's final one; a plain
  // (non-superset) set is always eligible.
  const eligibleForRestAfter = input.isLastSetOfExercise && (!input.superset || input.superset.isFinalRound)
  if (eligibleForRestAfter && input.exerciseRestAfterSeconds != null) return input.exerciseRestAfterSeconds
  if (input.exerciseRestSeconds != null) return input.exerciseRestSeconds
  return input.globalRestSeconds
}
