import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReviewEntry, ReviewGroup, ReviewItem } from './review'
import { reviewItems } from './review'
import { NOW, USER, makeWorld, plan, planId, setId, type World } from './reviewWorld.testutil'

// Chunk 56 (TASKS-1.2 "REVIEW"): what REVIEW reads and what each action writes, through the service the screen calls, over the fake PostgREST
// and a stand-in for 043's `v2_apply_ops` that refuses what the database refuses (`reviewWorld.testutil.ts`). Writers (**W**) are each proven
// by the rows they leave and the exact request they send; the reads (**D**) by what they return from rows that tell the right source from
// the wrong one (another week's plan rows, another session).

const h = vi.hoisted(() => ({ client: null as unknown as World['client'] }))
vi.mock('../../lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => (h.client.from as (...a: unknown[]) => unknown)(...args), rpc: (...args: unknown[]) => (h.client.rpc as (...a: unknown[]) => unknown)(...args) },
}))

const { queryClient } = await import('../../lib/queryClient')
const { REVIEW_DECISIONS_KEY, decideReviewItem, fetchReviewDecisions, fetchReviewSessions } = await import('./reviewService')

let world: World
const LAST = [planId('ua', 2), planId('la', 2), planId('ub', 2)]
const PROGRAM = { mesoId: 'meso', programId: 'prog', planningType: 'week_dependent', scheduleType: 'weekday', currentWeek: 3 } as const
const counter = () => {
  let n = 0
  return () => `id-${++n}`
}

beforeEach(() => {
  world = makeWorld()
  h.client = world.client
})
afterEach(() => {
  vi.restoreAllMocks()
  queryClient.clear()
})

async function groupsOf(decisions: Array<{ weekPlanId: string; itemKey: string }> = []): Promise<ReviewGroup[]> {
  return reviewItems({
    weekNumber: 3,
    lastWeek: { sessions: await fetchReviewSessions(LAST), plan: [plan('ua', 2), plan('la', 2), plan('ub', 2)] },
    thisWeek: [plan('ua', 3), plan('la', 3), plan('ub', 3)],
    decisions,
  })
}
async function entry(match: (item: ReviewItem) => boolean): Promise<ReviewEntry> {
  const found = (await groupsOf()).flatMap((g) => g.items).filter((e) => match(e.item))
  expect(found).toHaveLength(1)
  return found[0]
}
const benchSet = (n: number) => (item: ReviewItem) => item.kind === 'number' && item.plannedSetId === setId(2, 'pe-bench', n)
const decide = (e: ReviewEntry, action: Parameters<typeof decideReviewItem>[0]['action'], over: Partial<Parameters<typeof decideReviewItem>[0]> = {}) =>
  decideReviewItem({ userId: USER, entry: e, action, weekPlan: plan('ua', 3), program: PROGRAM, newId: counter(), now: () => NOW, ...over })
const decisionRow = (e: ReviewEntry, decision: 'used' | 'ignored', id: string) => ({
  op: 'insert', table: 'v2_week_review_decisions', row: { id, user_id: USER, week_plan_id: planId('ua', 3), item_key: e.key, decision, created_at: NOW },
})

describe('D: what REVIEW reads', () => {
  it("reads every session of last week's plan rows and none of another week's, each with its logs, swaps and set changes", async () => {
    world.tables.v2_sessions.push({ id: 's-other', user_id: USER, mesocycle_id: 'meso', week_plan_id: planId('ua', 3), workout_day_id: 'wd-ua', date: '2026-10-12', status: 'completed', note: null, started_at: null, completed_at: null, created_at: '', moved_to_date: null })
    world.tables.v2_session_exercise_swaps.push({ id: 'sw-1', user_id: USER, session_id: 's-ua', program_exercise_id: 'pe-lat', original_exercise_id: 'e-lat', original_exercise_name: 'Lateral Raise', replacement_exercise_id: 'e-x', replacement_exercise_name: 'Cable Lateral Raise', created_at: '' })
    const read = await fetchReviewSessions(LAST)
    expect(read.map((s) => s.id).sort()).toEqual(['s-la', 's-ua', 's-ub'])
    const ua = read.find((s) => s.id === 's-ua')!
    expect(ua.status).toBe('completed')
    expect(ua.setLogs).toHaveLength(13)
    expect(ua.swaps).toEqual([{ programExerciseId: 'pe-lat', originalExerciseId: 'e-lat', originalExerciseName: 'Lateral Raise', replacementExerciseId: 'e-x', replacementExerciseName: 'Cable Lateral Raise' }])
    expect(read.find((s) => s.id === 's-la')!.swaps).toEqual([])
    expect(world.fake.to('v2_sessions')[0].filters).toEqual([{ op: 'in', column: 'week_plan_id', value: LAST }])
  })

  it('a log carries its stage kind and its place, and its exercise: the module reads them (chunk 43 review 2, DECISIONS 195)', async () => {
    world.tables.v2_set_logs.push({ ...world.tables.v2_set_logs.find((l) => l.id === 'lg-p3')!, id: 'lg-p4', added_place: 2, stage_kind: 'rest_pause' })
    const ua = (await fetchReviewSessions(LAST)).find((s) => s.id === 's-ua')!
    const log = ua.setLogs!.find((l) => l.id === 'lg-p4')!
    expect(log.stageKind).toBe('rest_pause')
    expect(log.addedPlace).toBe(2)
    expect(log.exercise?.name).toBe('push')
    expect(ua.setLogs!.find((l) => l.id === 'lg-l1')!.stageKind).toBe('dropset')
    expect(ua.setLogs!.find((l) => l.id === 'lg-p3')!.addedPlace).toBeNull()
  })

  it("a planned staged set logged as planned is not read as 'made a normal set' (the read keeps stage_kind: chunk 43's probe U)", async () => {
    const stagedId = setId(2, 'pe-push', 1)
    const staged = world.tables.v2_week_plan_sets.find((s) => s.id === stagedId)!
    staged.stage_kind = 'dropset'
    world.tables.v2_week_plan_sets.push({ ...staged, id: `${stagedId}-d1`, parent_week_plan_set_id: stagedId, stage_index: 1, is_dropset: true, stage_kind: null })
    const lastPlan = plan('ua', 2)
    lastPlan.sets = lastPlan.sets.map((s) => (s.id === stagedId ? { ...s, stageKind: 'dropset' as const } : s)).concat({ ...lastPlan.sets.find((s) => s.id === stagedId)!, id: `${stagedId}-d1`, parentWeekPlanSetId: stagedId, stageIndex: 1, isDropset: true, stageKind: null })
    world.tables.v2_set_logs.find((l) => l.id === 'lg-p1')!.stage_kind = 'dropset'
    const groups = reviewItems({ weekNumber: 3, lastWeek: { sessions: await fetchReviewSessions(LAST), plan: [lastPlan] }, thisWeek: [plan('ua', 3)], decisions: [] })
    expect(groups.flatMap((g) => g.items).filter((e) => e.item.kind === 'retyped' && e.item.plannedSetId === stagedId)).toEqual([])
  })

  it('maps all three kinds of change row: deleted, retyped (warmup, staged, normal) and pending_stages', async () => {
    const base = { user_id: USER, session_id: 's-ua', is_warmup: false, stage_kind: null, stage_count: 0, week_plan_set_id: null, set_log_id: null }
    world.tables.v2_session_set_changes.push(
      { ...base, id: 'c1', kind: 'deleted', week_plan_set_id: 'ps-a' },
      { ...base, id: 'c2', kind: 'retyped', week_plan_set_id: 'ps-b', is_warmup: true },
      { ...base, id: 'c3', kind: 'retyped', week_plan_set_id: 'ps-c', stage_kind: 'rest_pause', stage_count: 2 },
      { ...base, id: 'c4', kind: 'retyped', week_plan_set_id: 'ps-d' },
      { ...base, id: 'c5', kind: 'pending_stages', set_log_id: 'lg-l1', stage_kind: 'dropset', stage_count: 3 },
    )
    const changes = (await fetchReviewSessions(LAST)).find((s) => s.id === 's-ua')!.sessionSetChanges
    expect(changes).toEqual([
      { kind: 'deleted', weekPlanSetId: 'ps-a' },
      { kind: 'retyped', weekPlanSetId: 'ps-b', type: { kind: 'warmup' } },
      { kind: 'retyped', weekPlanSetId: 'ps-c', type: { kind: 'staged', stageKind: 'rest_pause', stageCount: 2 } },
      { kind: 'retyped', weekPlanSetId: 'ps-d', type: { kind: 'normal' } },
      { kind: 'pending_stages', setLogId: 'lg-l1', stageKind: 'dropset', stageCount: 3 },
    ])
  })

  it('pages its reads: more sessions than a page, and more decisions than the server returns at once', async () => {
    for (let i = 0; i < 230; i++) {
      world.tables.v2_sessions.push({ id: `s-x${String(i).padStart(3, '0')}`, user_id: USER, mesocycle_id: 'meso', week_plan_id: planId('la', 2), workout_day_id: 'wd-la', date: '2026-10-07', status: 'completed', note: null, started_at: null, completed_at: null, created_at: '', moved_to_date: null })
    }
    expect(await fetchReviewSessions([planId('la', 2)])).toHaveLength(231)
    expect(world.fake.to('v2_sessions').map((r) => r.range)).toEqual([[0, 99], [100, 199], [200, 299]])
    for (let i = 0; i < 1100; i++) world.tables.v2_week_review_decisions.push({ id: `d${String(i).padStart(4, '0')}`, user_id: USER, week_plan_id: planId('ua', 3), item_key: `k${i}`, decision: 'ignored', created_at: NOW })
    world.tables.v2_week_review_decisions.push({ id: 'd-other', user_id: USER, week_plan_id: planId('ua', 4), item_key: 'k', decision: 'ignored', created_at: NOW })
    expect(await fetchReviewDecisions([planId('ua', 3)])).toHaveLength(1100)
  })

  it('reads nothing for no plan rows (a missed week) and asks no one', async () => {
    expect(await fetchReviewSessions([])).toEqual([])
    expect(await fetchReviewDecisions([])).toEqual([])
    expect(world.fake.requests).toHaveLength(0)
  })

  it('the seed week gives exactly the five items; the skipped Friday and the deload Wednesday give none (G52)', async () => {
    const groups = await groupsOf()
    expect(groups.map((g) => g.heading)).toEqual(['MON · UPPER A'])
    expect(groups[0].items.map((e) => e.key)).toEqual([
      `num:s-ua:${setId(2, 'pe-bench', 2)}`,
      `num:s-ua:${setId(2, 'pe-bench', 3)}`,
      `skipped:s-ua:${setId(2, 'pe-row', 3)}`,
      `type:s-ua:${setId(2, 'pe-lat', 1)}`,
      'added-set:s-ua:e-push:3',
    ])
  })
})

describe('W: what each action sends, in one request with the decision row', () => {
  it('USE on a number item updates this week’s matching set with the done weight and reps, and leaves the decision row (used)', async () => {
    const e = await entry(benchSet(2))
    expect(await decide(e, 'use')).toBe('applied')
    expect(world.sent).toEqual([
      [
        { op: 'update', table: 'v2_week_plan_sets', id: setId(3, 'pe-bench', 2), patch: { target_weight: 82.5, rep_min: 7, rep_max: 7, is_amrap: false } },
        decisionRow(e, 'used', 'id-1'),
      ],
    ])
    const set = world.tables.v2_week_plan_sets.find((s) => s.id === setId(3, 'pe-bench', 2))!
    expect([set.target_weight, set.rep_min, set.rep_max]).toEqual([82.5, 7, 7])
    expect(world.tables.v2_week_plan_sets.find((s) => s.id === setId(2, 'pe-bench', 2))!.target_weight).toBe(80) // last week's row is untouched
    expect(e.key).toBe(`num:s-ua:${setId(2, 'pe-bench', 2)}`)
  })

  it('IGNORE sends the decision row alone (ignored) and no week set changes', async () => {
    const e = await entry(benchSet(3))
    const before = structuredClone(world.tables.v2_week_plan_sets)
    await decide(e, 'ignore')
    expect(world.sent).toEqual([[decisionRow(e, 'ignored', 'id-1')]])
    expect(world.tables.v2_week_plan_sets).toEqual(before)
  })

  it('ADD THIS SET appends a set to this week’s exercise with the done numbers (the user, the next number)', async () => {
    const e = await entry((i) => i.kind === 'added_set')
    await decide(e, 'add_set')
    const row = {
      id: 'id-1', user_id: USER, week_plan_id: planId('ua', 3), program_exercise_id: 'pe-push', set_number: 3, target_rir: null, target_rir_max: null, is_dropset: false,
      parent_week_plan_set_id: null, stage_index: 0, is_warmup: false, program_set_id: null, stage_kind: null, target_weight: 20, rep_min: 15, rep_max: 15, is_amrap: false, tags: null,
    }
    expect(world.sent).toEqual([[{ op: 'insert', table: 'v2_week_plan_sets', row }, decisionRow(e, 'used', 'id-2')]])
    expect(world.tables.v2_week_plan_sets.filter((s) => s.week_plan_id === planId('ua', 3) && s.program_exercise_id === 'pe-push')).toHaveLength(3)
  })

  it('a type item’s USE gives this week’s matching set its kind (a dropset) and one drop', async () => {
    const e = await entry((i) => i.kind === 'retyped')
    await decide(e, 'use')
    expect(world.sent[0]).toEqual([
      { op: 'update', table: 'v2_week_plan_sets', id: setId(3, 'pe-lat', 1), patch: { stage_kind: 'dropset' } },
      {
        op: 'insert', table: 'v2_week_plan_sets',
        row: {
          id: 'id-1', user_id: USER, week_plan_id: planId('ua', 3), program_exercise_id: 'pe-lat', set_number: 1, target_rir: null, target_rir_max: null, is_dropset: true,
          parent_week_plan_set_id: setId(3, 'pe-lat', 1), stage_index: 1, is_warmup: false, program_set_id: null, stage_kind: null, target_weight: null, rep_min: null, rep_max: null, is_amrap: false, tags: null,
        },
      },
      decisionRow(e, 'used', 'id-2'),
    ])
    const head = world.tables.v2_week_plan_sets.find((s) => s.id === setId(3, 'pe-lat', 1))!
    expect(head.stage_kind).toBe('dropset')
    expect(world.tables.v2_week_plan_sets.filter((s) => s.parent_week_plan_set_id === head.id)).toHaveLength(1)
  })

  it('REMOVE THIS SET on "Skipped" deletes this week’s set 3 of the row, and only that one', async () => {
    const e = await entry((i) => i.kind === 'skipped')
    await decide(e, 'remove_set')
    expect(world.sent).toEqual([[{ op: 'delete', table: 'v2_week_plan_sets', id: setId(3, 'pe-row', 3) }, decisionRow(e, 'used', 'id-1')]])
    expect(world.tables.v2_week_plan_sets.filter((s) => s.week_plan_id === planId('ua', 3) && s.program_exercise_id === 'pe-row').map((s) => s.set_number)).toEqual([1, 2])
    expect(world.tables.v2_week_plan_sets.filter((s) => s.week_plan_id === planId('ua', 2) && s.program_exercise_id === 'pe-row')).toHaveLength(3)
  })

  it('a decided item is gone from the list, and the item beside it is still there', async () => {
    const before = (await groupsOf()).flatMap((g) => g.items).length
    await decide(await entry(benchSet(2)), 'use')
    const rows = world.tables.v2_week_review_decisions.map((d) => ({ weekPlanId: d.week_plan_id as string, itemKey: d.item_key as string }))
    const after = (await groupsOf(rows)).flatMap((g) => g.items.map((e) => e.key))
    expect(before).toBe(5)
    expect(after).toHaveLength(4)
    expect(after).not.toContain(`num:s-ua:${setId(2, 'pe-bench', 2)}`)
  })

  it('refreshes what the write made stale: this week’s plans, every week’s, the decisions and the done list', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries')
    await decide(await entry(benchSet(2)), 'use')
    const keys = spy.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]).sort()
    expect(keys).toEqual(['v2_allWeekPlans', 'v2_doneWeekPlanIds', REVIEW_DECISIONS_KEY, 'v2_weekPlan', 'v2_weekPlans'].sort())
  })
})

describe('W: an item is decided once', () => {
  it('a decision made since the list was read (another phone) stands: nothing is sent, nothing is written twice', async () => {
    const e = await entry((i) => i.kind === 'added_set')
    world.tables.v2_week_review_decisions.push({ id: 'd-phone', user_id: USER, week_plan_id: planId('ua', 3), item_key: e.key, decision: 'used', created_at: NOW })
    const sets = world.tables.v2_week_plan_sets.length
    expect(await decide(e, 'add_set')).toBe('already_decided')
    expect(world.sent).toEqual([])
    expect(world.tables.v2_week_plan_sets).toHaveLength(sets)
  })

  it('a decision that lands between the check and the write is the unique key’s refusal: the item counts as decided, and the writes did not land', async () => {
    const e = await entry((i) => i.kind === 'added_set')
    world.refuseNext({ code: '23505', message: 'duplicate key value violates unique constraint "v2_week_review_decisions_item_uk"' })
    const sets = world.tables.v2_week_plan_sets.length
    expect(await decide(e, 'add_set')).toBe('already_decided')
    expect(world.sent).toHaveLength(1)
    expect(world.tables.v2_week_plan_sets).toHaveLength(sets)
  })

  it('any other refusal is thrown with the server’s own message, and nothing was written (the whole request rolls back)', async () => {
    const e = await entry(benchSet(2))
    const before = structuredClone(world.tables)
    await expect(decide(e, 'use', { weekPlan: { ...plan('ua', 3), id: planId('ua', 3) }, newId: counter() })).resolves.toBe('applied') // the control: it lands
    Object.assign(world.tables, before)
    world.tables.v2_week_plan_sets = world.tables.v2_week_plan_sets.filter((s) => s.id !== setId(3, 'pe-bench', 2)) // this week's set was deleted elsewhere
    await expect(decide(e, 'use')).rejects.toMatchObject({ message: `row not found: v2_week_plan_sets/${setId(3, 'pe-bench', 2)}` })
    expect(world.tables.v2_week_review_decisions).toEqual([])
  })

  it('a unique-key refusal of another table is not read as "decided"', async () => {
    const e = await entry(benchSet(2))
    world.refuseNext({ code: '23505', message: 'duplicate key value violates unique constraint "v2_week_plan_sets_pkey"' })
    await expect(decide(e, 'use')).rejects.toMatchObject({ code: '23505' })
  })
})
