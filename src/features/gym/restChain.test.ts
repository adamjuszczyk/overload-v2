import { describe, it, expect } from 'vitest'
import { resolveRestTarget, type RestChainInput } from './restChain'

// One test per SPEC "Rest" chain level, plus one per superset/stage case
// (reviewer brief, chunk 16). base() is the "nothing set anywhere" input —
// every level null/absent except the always-present global setting —
// mirroring the D30 fixture exactly (no overrides anywhere), so the very
// first test IS the D30 proof at the resolver level: with no overrides
// anywhere, the chain resolves to the global setting, same as master.
function base(globalRestSeconds = 90): RestChainInput {
  return {
    setOverrideSeconds: null,
    isLastSetOfExercise: false,
    exerciseRestAfterSeconds: null,
    exerciseRestSeconds: null,
    globalRestSeconds,
    stage: null,
    superset: null,
  }
}

describe('resolveRestTarget — base chain (no stage, no superset)', () => {
  it('D30: nothing set anywhere → the global setting, exactly as master', () => {
    expect(resolveRestTarget(base(90))).toBe(90)
    expect(resolveRestTarget(base(45))).toBe(45)
  })

  it('level 1: the set\'s own rest override wins over everything else', () => {
    expect(
      resolveRestTarget({
        ...base(),
        setOverrideSeconds: 10,
        isLastSetOfExercise: true,
        exerciseRestAfterSeconds: 200,
        exerciseRestSeconds: 150,
      }),
    ).toBe(10)
  })

  it('level 1: a zero-second override is a real value, not "unset"', () => {
    expect(resolveRestTarget({ ...base(), setOverrideSeconds: 0 })).toBe(0)
  })

  it('level 2: on the exercise\'s last set, "rest after" wins over exercise rest and global', () => {
    expect(
      resolveRestTarget({
        ...base(),
        isLastSetOfExercise: true,
        exerciseRestAfterSeconds: 180,
        exerciseRestSeconds: 60,
      }),
    ).toBe(180)
  })

  it('level 2 never fires on a set that is not the exercise\'s last', () => {
    expect(
      resolveRestTarget({
        ...base(),
        isLastSetOfExercise: false,
        exerciseRestAfterSeconds: 180,
        exerciseRestSeconds: 60,
      }),
    ).toBe(60)
  })

  it('level 3: the exercise\'s own rest, when not the last set and no override', () => {
    expect(resolveRestTarget({ ...base(), exerciseRestSeconds: 60 })).toBe(60)
  })

  it('level 3 also applies on the last set when "rest after" itself is unset', () => {
    expect(
      resolveRestTarget({ ...base(), isLastSetOfExercise: true, exerciseRestSeconds: 75 }),
    ).toBe(75)
  })

  it('level 4: the global rest setting when nothing else is set', () => {
    expect(resolveRestTarget(base(120))).toBe(120)
  })
})

describe('resolveRestTarget — staged sets', () => {
  it('dropset, more stages to come, no override: no timer (null)', () => {
    expect(
      resolveRestTarget({
        ...base(),
        stage: { kind: 'dropset', hasNextStage: true, stageRestSecondsOverride: null },
      }),
    ).toBeNull()
  })

  it('dropset\'s own stage_rest_seconds override wins even though the kind\'s default is "no timer"', () => {
    expect(
      resolveRestTarget({
        ...base(),
        stage: { kind: 'dropset', hasNextStage: true, stageRestSecondsOverride: 20 },
      }),
    ).toBe(20)
  })

  it.each(['rest_pause', 'myo_reps', 'cluster'] as const)(
    '%s, more stages to come, no override: 15s by default',
    (kind) => {
      expect(
        resolveRestTarget({ ...base(), stage: { kind, hasNextStage: true, stageRestSecondsOverride: null } }),
      ).toBe(15)
    },
  )

  it('a stage kind\'s own override replaces its 15s default', () => {
    expect(
      resolveRestTarget({
        ...base(),
        stage: { kind: 'rest_pause', hasNextStage: true, stageRestSecondsOverride: 30 },
      }),
    ).toBe(30)
  })

  it('once the last configured stage is logged (no next stage), falls through to the normal chain', () => {
    expect(
      resolveRestTarget({
        ...base(),
        isLastSetOfExercise: true,
        exerciseRestAfterSeconds: 150,
        stage: { kind: 'rest_pause', hasNextStage: false, stageRestSecondsOverride: null },
      }),
    ).toBe(150)
  })

  it('SPEC-literal reading (D30 safety): a legacy/un-kinded stage (stage_kind null) is NOT promoted to dropset — falls through to the normal chain unchanged', () => {
    expect(
      resolveRestTarget({
        ...base(120),
        stage: { kind: null, hasNextStage: true, stageRestSecondsOverride: null },
      }),
    ).toBe(120) // the global setting, exactly as an un-staged set — not null
  })

  it('a set\'s own override still wins ahead of any stage rule', () => {
    expect(
      resolveRestTarget({
        ...base(),
        setOverrideSeconds: 5,
        stage: { kind: 'dropset', hasNextStage: true, stageRestSecondsOverride: null },
      }),
    ).toBe(5)
  })
})

describe('resolveRestTarget — supersets', () => {
  it('within a round, not the ending cell, no block override: no timer (null)', () => {
    expect(
      resolveRestTarget({
        ...base(),
        superset: { endsRound: false, isFinalRound: false, restWithinRoundSeconds: null, restAfterRoundSeconds: null },
      }),
    ).toBeNull()
  })

  it('a set\'s own explicit rest override wins over "no timer within a round" (SPEC, verbatim)', () => {
    expect(
      resolveRestTarget({
        ...base(),
        setOverrideSeconds: 12,
        superset: { endsRound: false, isFinalRound: false, restWithinRoundSeconds: null, restAfterRoundSeconds: null },
      }),
    ).toBe(12)
  })

  it('the block\'s own rest_within_round_seconds overrides the "no timer" default', () => {
    expect(
      resolveRestTarget({
        ...base(),
        superset: { endsRound: false, isFinalRound: false, restWithinRoundSeconds: 20, restAfterRoundSeconds: null },
      }),
    ).toBe(20)
  })

  it('ends a round, with no block override: the normal chain of the exercise that ends the round', () => {
    expect(
      resolveRestTarget({
        ...base(),
        exerciseRestSeconds: 60,
        superset: { endsRound: true, isFinalRound: true, restWithinRoundSeconds: null, restAfterRoundSeconds: null },
      }),
    ).toBe(60)
  })

  it('the block\'s own rest_after_round_seconds wins at a round boundary, final round or not', () => {
    expect(
      resolveRestTarget({
        ...base(),
        superset: { endsRound: true, isFinalRound: false, restWithinRoundSeconds: null, restAfterRoundSeconds:45 },
      }),
    ).toBe(45)
  })

  it('SPEC-literal reading: "rest after" never fires inside a round — a member whose own last set ends a NON-final round does not get it, even though it is that exercise\'s last set', () => {
    expect(
      resolveRestTarget({
        ...base(),
        isLastSetOfExercise: true,
        exerciseRestAfterSeconds: 200,
        exerciseRestSeconds: 55,
        superset: { endsRound: true, isFinalRound: false, restWithinRoundSeconds: null, restAfterRoundSeconds: null },
      }),
    ).toBe(55) // demoted to level 3, not the 200s "rest after"
  })

  it('"rest after" DOES apply once the ending exercise\'s last set lands in the block\'s own FINAL round', () => {
    expect(
      resolveRestTarget({
        ...base(),
        isLastSetOfExercise: true,
        exerciseRestAfterSeconds: 200,
        exerciseRestSeconds: 55,
        superset: { endsRound: true, isFinalRound: true, restWithinRoundSeconds: null, restAfterRoundSeconds: null },
      }),
    ).toBe(200)
  })

  it('ends the final round, not the exercise\'s own last set: falls to exercise rest / global, not "rest after"', () => {
    expect(
      resolveRestTarget({
        ...base(),
        isLastSetOfExercise: false,
        exerciseRestAfterSeconds: 200,
        exerciseRestSeconds: 55,
        superset: { endsRound: true, isFinalRound: true, restWithinRoundSeconds: null, restAfterRoundSeconds: null },
      }),
    ).toBe(55)
  })

  it('ends a round with nothing at any level: the global setting (null propagates nowhere by itself)', () => {
    expect(
      resolveRestTarget({
        ...base(100),
        superset: { endsRound: true, isFinalRound: true, restWithinRoundSeconds: null, restAfterRoundSeconds: null },
      }),
    ).toBe(100)
  })
})
