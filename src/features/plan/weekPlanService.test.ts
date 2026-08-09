import { describe, it, expect } from 'vitest'
import { copySetsWithGrouping, type DbWeekPlanSet } from './weekPlanService'

// copySetsWithGrouping is the shared reattachment engine both
// copyFromPreviousWeek (whole-week — calls this once per plan, in a loop)
// and copyWorkoutFromPreviousWeek (single-workout — calls this once) build
// on. This closes the test gap flagged and deferred during Phase 3.1: it had
// no unit tests and was never live-exercised, which was acceptable while
// only one caller depended on it — no longer true now that Phase 3.7 adds a
// second. The two callers' own "which previous plan(s) to fetch" queries are
// thin, unbranched Supabase calls with no logic of their own to break, so
// they're deliberately left untested here, consistent with this codebase's
// existing convention of unit-testing pure/injectable logic only
// (setGroupLogic.test.ts, referenceLogic.test.ts, e1rm.test.ts,
// weightUnit.test.ts) rather than mocking the Supabase client.
//
// insertPlanSet is real production code's injection seam (defaults to a
// real Supabase insert) — tests supply a fake that assigns sequential
// synthetic ids and records every payload it was called with, in call
// order, so the id-remapping itself can be asserted on directly.

function makeDbSet(overrides: Partial<DbWeekPlanSet>): DbWeekPlanSet {
  return {
    id: 'old-id',
    week_plan_id: 'wp-old',
    user_id: 'u1',
    program_exercise_id: 'pe1',
    set_number: 1,
    target_rir: 2,
    is_dropset: false,
    parent_week_plan_set_id: null,
    stage_index: 0,
    ...overrides,
  }
}

function makeFakeInsert() {
  let counter = 0
  const calls: Record<string, unknown>[] = []
  const insert = async (payload: Record<string, unknown>): Promise<DbWeekPlanSet> => {
    calls.push(payload)
    counter += 1
    return { ...payload, id: `new-${counter}` } as unknown as DbWeekPlanSet
  }
  return { insert, calls }
}

describe('copySetsWithGrouping — single-workout scope', () => {
  // These first two tests check basic payload shape (parent resolves,
  // set_number/stage_index preserved verbatim) with exactly one head
  // present. Phase 3.7's adversarial review correctly flagged that with
  // only one head, they can't actually distinguish "reattach via the
  // explicit parent_week_plan_set_id id map" (what the code does) from
  // "reattach via set_number-based inference" (the pre-3.1 bug this
  // function's own comment documents) — copySetsWithGrouping never branches
  // on set_number at all, so both tests exercise identical control flow.
  // The multi-head tests below are the ones that actually distinguish the
  // two: they place a same/higher-numbered head from a *different*
  // exercise where a broken ordering/proximity heuristic would grab it.

  it('reattaches an addStage()-created dropset, where the stage shares its head\'s set_number', async () => {
    const head = makeDbSet({ id: 'head', set_number: 1, parent_week_plan_set_id: null, stage_index: 0 })
    const stage = makeDbSet({
      id: 'stage',
      set_number: 1, // same as head — Phase 3.1's addStage() convention (TASKS.md §2.1)
      parent_week_plan_set_id: 'head',
      stage_index: 1,
      is_dropset: true,
    })
    const { insert, calls } = makeFakeInsert()

    await copySetsWithGrouping('u1', 'new-wp', [head, stage], insert)

    expect(calls).toHaveLength(2)
    const [newHeadCall, newStageCall] = calls
    expect(newHeadCall.parent_week_plan_set_id).toBeUndefined() // head insert never sets this key
    expect(newStageCall.parent_week_plan_set_id).toBe('new-1') // resolved to the head's real new id
    expect(newStageCall.set_number).toBe(1) // preserved, still equal to the head's
    expect(newStageCall.stage_index).toBe(1)
    expect(newStageCall.week_plan_id).toBe('new-wp')
  })

  it('reattaches a legacy/backfilled dropset, where the stage\'s set_number is higher than its head\'s', async () => {
    const head = makeDbSet({ id: 'head', set_number: 1, parent_week_plan_set_id: null })
    const stage = makeDbSet({
      id: 'stage',
      set_number: 2, // strictly greater — pre-3.1 authoring / 007's backfill convention
      parent_week_plan_set_id: 'head',
      stage_index: 1,
      is_dropset: true,
    })
    const { insert, calls } = makeFakeInsert()

    await copySetsWithGrouping('u1', 'new-wp', [head, stage], insert)

    const newStageCall = calls[1]
    expect(newStageCall.parent_week_plan_set_id).toBe('new-1')
    expect(newStageCall.set_number).toBe(2) // legacy numbering preserved as-is, not renumbered
  })

  it('reattaches an addStage()-shape dropset to its own head, not a same-numbered head from a different exercise', async () => {
    // A real workout's prevSets spans every exercise together (one
    // week_plan's full v2_week_plan_sets), and set_number restarts from 1
    // per exercise — so two different exercises' "set 1" heads coexisting
    // with the same set_number is the normal, realistic multi-head shape,
    // not a contrived one. The dropset belongs to exercise B's head; a
    // broken "attach to the nearest/first head with a matching set_number"
    // heuristic would grab exercise A's head instead. Only an explicit
    // parent_week_plan_set_id lookup gets this right.
    const headA = makeDbSet({ id: 'headA', program_exercise_id: 'peA', set_number: 1, parent_week_plan_set_id: null })
    const headB = makeDbSet({ id: 'headB', program_exercise_id: 'peB', set_number: 1, parent_week_plan_set_id: null })
    const stageB = makeDbSet({
      id: 'stageB',
      program_exercise_id: 'peB',
      set_number: 1, // matches its own head AND headA — the ambiguous case
      parent_week_plan_set_id: 'headB',
      stage_index: 1,
      is_dropset: true,
    })
    const { insert, calls } = makeFakeInsert()

    // Deliberately non-adjacent input order too, so array position can't help.
    await copySetsWithGrouping('u1', 'new-wp', [headA, stageB, headB], insert)

    expect(calls).toHaveLength(3)
    // Heads are always inserted before stages, in their relative order —
    // headA first (new-1), headB second (new-2), then stageB (new-3).
    expect(calls[0].program_exercise_id).toBe('peA')
    expect(calls[1].program_exercise_id).toBe('peB')
    expect(calls[1].parent_week_plan_set_id).toBeUndefined()
    expect(calls[2].parent_week_plan_set_id).toBe('new-2') // headB's new id — never 'new-1' (headA)
  })

  it('reattaches a legacy-shape dropset to its own head, not a same-numbered head from a different exercise', async () => {
    const headA = makeDbSet({ id: 'headA', program_exercise_id: 'peA', set_number: 2, parent_week_plan_set_id: null })
    const headB = makeDbSet({ id: 'headB', program_exercise_id: 'peB', set_number: 1, parent_week_plan_set_id: null })
    const stageB = makeDbSet({
      id: 'stageB',
      program_exercise_id: 'peB',
      set_number: 2, // strictly greater than its own head (1) — legacy shape — and coincides with headA's number
      parent_week_plan_set_id: 'headB',
      stage_index: 1,
      is_dropset: true,
    })
    const { insert, calls } = makeFakeInsert()

    await copySetsWithGrouping('u1', 'new-wp', [headA, headB, stageB], insert)

    expect(calls).toHaveLength(3)
    expect(calls[0].program_exercise_id).toBe('peA') // new-1
    expect(calls[1].program_exercise_id).toBe('peB') // new-2
    expect(calls[2].parent_week_plan_set_id).toBe('new-2') // headB's new id — never headA's ('new-1')
  })

  it('reattaches every stage of a multi-stage dropset to the same head', async () => {
    const head = makeDbSet({ id: 'head', set_number: 1, parent_week_plan_set_id: null })
    const s1 = makeDbSet({ id: 's1', set_number: 1, parent_week_plan_set_id: 'head', stage_index: 1, is_dropset: true })
    const s2 = makeDbSet({ id: 's2', set_number: 1, parent_week_plan_set_id: 'head', stage_index: 2, is_dropset: true })
    const s3 = makeDbSet({ id: 's3', set_number: 1, parent_week_plan_set_id: 'head', stage_index: 3, is_dropset: true })
    const { insert, calls } = makeFakeInsert()

    await copySetsWithGrouping('u1', 'new-wp', [head, s1, s2, s3], insert)

    expect(calls).toHaveLength(4)
    const stageCalls = calls.slice(1) // the head is always inserted first
    expect(stageCalls).toHaveLength(3)
    for (const c of stageCalls) {
      expect(c.parent_week_plan_set_id).toBe('new-1') // all three resolve to the same head, not to each other
    }
    expect(stageCalls.map((c) => c.stage_index)).toEqual([1, 2, 3])
  })

  it('preserves target_rir through the copy, for both heads and stages', async () => {
    const head = makeDbSet({ id: 'head', set_number: 1, target_rir: 3, parent_week_plan_set_id: null })
    const stage = makeDbSet({
      id: 'stage',
      set_number: 1,
      target_rir: 0, // falsy but real — distinct from both the head's 3 and from null
      parent_week_plan_set_id: 'head',
      stage_index: 1,
      is_dropset: true,
    })
    const { insert, calls } = makeFakeInsert()

    await copySetsWithGrouping('u1', 'new-wp', [head, stage], insert)

    expect(calls[0].target_rir).toBe(3)
    expect(calls[1].target_rir).toBe(0)
  })

  it('leaves a plain workout with no dropsets unaffected — no parent links, order preserved', async () => {
    const sets = [1, 2, 3].map((n) =>
      makeDbSet({ id: `set-${n}`, set_number: n, parent_week_plan_set_id: null }),
    )
    const { insert, calls } = makeFakeInsert()

    await copySetsWithGrouping('u1', 'new-wp', sets, insert)

    expect(calls).toHaveLength(3)
    for (const call of calls) {
      expect(call.parent_week_plan_set_id).toBeUndefined()
      expect(call.is_dropset).toBe(false)
    }
    expect(calls.map((c) => c.set_number)).toEqual([1, 2, 3])
  })

  it('inserts heads before stages regardless of input order, so a parent id is always resolvable', async () => {
    const head = makeDbSet({ id: 'head', set_number: 1, parent_week_plan_set_id: null })
    const stage = makeDbSet({
      id: 'stage',
      set_number: 1,
      parent_week_plan_set_id: 'head',
      stage_index: 1,
      is_dropset: true,
    })
    const { insert, calls } = makeFakeInsert()

    // stage listed first in prevSets — a real fetch order this app doesn't
    // guarantee either, since it comes back however Postgres returns rows.
    await copySetsWithGrouping('u1', 'new-wp', [stage, head], insert)

    expect(calls).toHaveLength(2)
    // The head must still be inserted first (its payload carries no parent
    // key), regardless of where it appeared in prevSets.
    expect(calls[0].parent_week_plan_set_id).toBeUndefined()
    expect(calls[0].stage_index).toBe(0)
    // The stage's payload must carry a real resolved parent id, never
    // undefined/null-by-failure.
    const stageCall = calls.find((c) => c.stage_index === 1)!
    expect(stageCall.parent_week_plan_set_id).toBe('new-1')
  })
})

describe('copySetsWithGrouping — whole-week scope (sequential per-plan calls)', () => {
  it('does not leak id-map state between two plans copied in the same whole-week operation', async () => {
    // Workout A's dropset
    const headA = makeDbSet({ id: 'headA', set_number: 1, parent_week_plan_set_id: null })
    const stageA = makeDbSet({
      id: 'stageA',
      set_number: 1,
      parent_week_plan_set_id: 'headA',
      stage_index: 1,
      is_dropset: true,
    })
    // Workout B's dropset — copyFromPreviousWeek's loop calls
    // copySetsWithGrouping once per v2_week_plans row, so this is a second,
    // independent invocation, not a second exercise within the same call.
    const headB = makeDbSet({ id: 'headB', set_number: 1, parent_week_plan_set_id: null })
    const stageB = makeDbSet({
      id: 'stageB',
      set_number: 1,
      parent_week_plan_set_id: 'headB',
      stage_index: 1,
      is_dropset: true,
    })

    const { insert, calls } = makeFakeInsert()

    await copySetsWithGrouping('u1', 'new-wp-A', [headA, stageA], insert)
    await copySetsWithGrouping('u1', 'new-wp-B', [headB, stageB], insert)

    expect(calls).toHaveLength(4)
    const [newHeadA, newStageA, newHeadB, newStageB] = calls
    expect(newHeadA.week_plan_id).toBe('new-wp-A')
    expect(newStageA.week_plan_id).toBe('new-wp-A')
    expect(newStageA.parent_week_plan_set_id).toBe('new-1') // headA's new id, not headB's
    expect(newHeadB.week_plan_id).toBe('new-wp-B')
    expect(newStageB.week_plan_id).toBe('new-wp-B')
    expect(newStageB.parent_week_plan_set_id).toBe('new-3') // headB's new id
  })

  it('a plain (no-dropset) plan copied alongside a dropset plan is unaffected by the other', async () => {
    const plainSets = [1, 2].map((n) =>
      makeDbSet({ id: `plain-${n}`, set_number: n, parent_week_plan_set_id: null }),
    )
    const head = makeDbSet({ id: 'head', set_number: 1, parent_week_plan_set_id: null })
    const stage = makeDbSet({
      id: 'stage',
      set_number: 1,
      parent_week_plan_set_id: 'head',
      stage_index: 1,
      is_dropset: true,
    })

    const { insert, calls } = makeFakeInsert()

    await copySetsWithGrouping('u1', 'new-wp-plain', plainSets, insert)
    await copySetsWithGrouping('u1', 'new-wp-drop', [head, stage], insert)

    const plainCalls = calls.filter((c) => c.week_plan_id === 'new-wp-plain')
    const dropCalls = calls.filter((c) => c.week_plan_id === 'new-wp-drop')
    expect(plainCalls).toHaveLength(2)
    for (const c of plainCalls) expect(c.parent_week_plan_set_id).toBeUndefined()
    expect(dropCalls).toHaveLength(2)
    // Plain plan's 2 inserts happen first (new-1, new-2), so the drop plan's
    // head is the 3rd insert overall — its stage must resolve to that id,
    // not to anything left over from the unrelated plain plan.
    expect(dropCalls[1].parent_week_plan_set_id).toBe('new-3')
  })
})
