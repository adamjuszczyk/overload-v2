// rehearse-046's own tests (chunk 53): the rule `plan046`, the comparisons and the verdict, on synthetic rows, no Docker. The
// replay itself needs the kept database (scripts/rehearse-046.mjs --replay); what a green run PROVES depends on these
// functions telling a right migration from a wrong one, so each is tested on a pair that differs and a pair that doesn't.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CASES,
  casesOf,
  compareSnapshots,
  diffRows,
  fetchSnapshot,
  fingerprintDiff,
  floorFor,
  judgeWorld,
  missingAndExtra,
  parseNotice,
  plan041Function,
  plan046,
  sameChanges,
  sameSlot,
  slotKey,
  worldScript,
} from './rehearse-046.mjs'

// ─── A snapshot builder ───────────────────────────────────────────────────────────────────────────────────────────────
const pe = (id, workout, position, over = {}) => ({ id, workout_day_id: workout, position, week_only: false, removed: false, removed_at: null, ...over })
const wk = (id, meso, workout, week, over = {}) => ({ id, mesocycle_id: meso, workout_day_id: workout, week_number: week, sequence_position: null, is_deload: false, n_sets: 3, ...over })
const lists = (week, ...rows) => rows.map(([id, position]) => ({ week_plan_id: week, program_exercise_id: id, position }))
function snap(over = {}) {
  return {
    mesocycles: [{ id: 'm1', user_id: 'u1', status: 'active', program_id: 'p1' }],
    programs: [{ id: 'p1', kind: 'run', planning_type: 'week_dependent', schedule_type: 'weekday' }],
    workout_days: [{ id: 'w1', program_id: 'p1' }],
    program_exercises: [],
    week_plans: [],
    week_plan_exercises: [],
    ...over,
  }
}
const changesOf = (s) => plan046(s).changes.map((c) => `${c.id}.${c.column}:${c.from}>${c.to}`).sort()

// ─── The rule ─────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a listed week-only row is promoted, a listed removed row comes back, a listed row takes the week\'s place, an unlisted live row leaves', () => {
  const s = snap({
    program_exercises: [
      pe('swapped-in', 'w1', 3, { week_only: true }), // 1.1 swap's row, listed
      pe('brought-back', 'w1', 2, { removed: true, removed_at: 'old' }), // the program tab's remove, still planned
      pe('moved', 'w1', 1), // listed at another place
      pe('same', 'w1', 4), // listed, equal: no change
      pe('replaced', 'w1', 5), // live, the week doesn't list it
    ],
    week_plans: [wk('a', 'm1', 'w1', 2)],
    week_plan_exercises: lists('a', ['swapped-in', 3], ['brought-back', 2], ['moved', 6], ['same', 4]),
  })
  assert.deepEqual(changesOf(s), [
    'brought-back.removed:true>false',
    'moved.position:1>6',
    'replaced.removed:false>true',
    'swapped-in.week_only:true>false',
  ])
  assert.deepEqual(plan046(s).workouts.map((w) => w.week_plan_id), ['a'])
})

test('a row can change in more than one column: a listed week-only row that was removed and sits elsewhere', () => {
  const s = snap({
    program_exercises: [pe('x', 'w1', 1, { week_only: true, removed: true, removed_at: 'old' })],
    week_plans: [wk('a', 'm1', 'w1', 1)],
    week_plan_exercises: lists('a', ['x', 9]),
  })
  assert.deepEqual(changesOf(s), ['x.position:1>9', 'x.removed:true>false', 'x.week_only:true>false'])
})

test('rows that are not part of the program and not listed stay as they are: an unlisted week-only row and an unlisted removed row', () => {
  const s = snap({
    program_exercises: [pe('kept', 'w1', 1), pe('hidden', 'w1', 2, { week_only: true }), pe('gone', 'w1', 3, { removed: true, removed_at: 'old' })],
    week_plans: [wk('a', 'm1', 'w1', 1)],
    week_plan_exercises: lists('a', ['kept', 1]),
  })
  assert.deepEqual(changesOf(s), [])
})

test('the last planned week is the latest one that is no deload session and holds a set; the earlier ones do not count', () => {
  const rows = [pe('e1', 'w1', 1), pe('e2', 'w1', 2), pe('e3', 'w1', 3)]
  const s = snap({
    program_exercises: rows,
    week_plans: [wk('w1wk', 'm1', 'w1', 1), wk('w2wk', 'm1', 'w1', 2), wk('w3wk', 'm1', 'w1', 3, { is_deload: true }), wk('w4wk', 'm1', 'w1', 4, { n_sets: 0 })],
    week_plan_exercises: [...lists('w1wk', ['e1', 1], ['e2', 2], ['e3', 3]), ...lists('w2wk', ['e1', 1]), ...lists('w3wk', ['e1', 1], ['e2', 2]), ...lists('w4wk', ['e3', 1])],
  })
  // week 2 decides (week 3 is a deload session, week 4 is empty): it lists e1 only
  assert.deepEqual(changesOf(s), ['e2.removed:false>true', 'e3.removed:false>true'])
  assert.equal(plan046(s).workouts[0].week_number, 2)
  // a workout with no usable week is left alone
  const none = snap({ program_exercises: rows, week_plans: [wk('d', 'm1', 'w1', 1, { is_deload: true })], week_plan_exercises: lists('d', ['e1', 1]) })
  assert.deepEqual(changesOf(none), [])
  assert.deepEqual(plan046(none).workouts, [])
})

test('on a sequence run the latest cycle decides and, in a cycle, the later slot', () => {
  const rows = [pe('a', 'w1', 1), pe('b', 'w1', 2), pe('c', 'w1', 3)]
  const mk = (slots) =>
    snap({
      programs: [{ id: 'p1', kind: 'run', planning_type: 'week_dependent', schedule_type: 'sequence' }],
      program_exercises: rows,
      week_plans: slots.map(([id, week, slot]) => wk(id, 'm1', 'w1', week, { sequence_position: slot })),
      week_plan_exercises: slots.flatMap(([id, , , list]) => lists(id, ...list.map((e, i) => [e, i + 1]))),
    })
  const later = mk([['s1', 2, 1, ['a', 'b']], ['s4', 2, 4, ['a', 'c']], ['old', 1, 4, ['a', 'b', 'c']]])
  assert.deepEqual(plan046(later).workouts.map((w) => w.week_plan_id), ['s4'])
  assert.deepEqual(changesOf(later), ['b.removed:false>true', 'c.position:3>2'])
  // the same two slots listed the other way round: the later slot still decides
  const reversed = mk([['s4', 2, 4, ['a', 'c']], ['s1', 2, 1, ['a', 'b']]])
  assert.deepEqual(changesOf(reversed), changesOf(later))
  // a later cycle beats an earlier cycle's later slot
  const cycle = mk([['s4', 2, 4, ['a']], ['s1', 3, 1, ['a', 'b']]])
  assert.deepEqual(plan046(cycle).workouts.map((w) => w.week_plan_id), ['s1'])
})

test('only an active week-dependent run\'s run copy is touched: not a completed run, a stable run, or a program that is not a run copy', () => {
  const base = { program_exercises: [pe('x', 'w1', 1), pe('y', 'w1', 2)], week_plans: [wk('a', 'm1', 'w1', 1)], week_plan_exercises: lists('a', ['x', 1]) }
  assert.deepEqual(changesOf(snap(base)), ['y.removed:false>true'], 'the control: this world changes a row')
  assert.deepEqual(changesOf(snap({ ...base, mesocycles: [{ id: 'm1', user_id: 'u1', status: 'completed', program_id: 'p1' }] })), [])
  assert.deepEqual(changesOf(snap({ ...base, programs: [{ id: 'p1', kind: 'run', planning_type: 'stable', schedule_type: 'weekday' }] })), [])
  assert.deepEqual(changesOf(snap({ ...base, programs: [{ id: 'p1', kind: 'saved', planning_type: 'week_dependent', schedule_type: 'weekday' }] })), [])
})

test('a week that lists a row of another workout does not change that row, and the other workout is judged by its own week', () => {
  const s = snap({
    workout_days: [{ id: 'w1', program_id: 'p1' }, { id: 'w2', program_id: 'p1' }],
    program_exercises: [pe('mine', 'w1', 1), pe('theirs', 'w2', 1, { week_only: true })],
    week_plans: [wk('a', 'm1', 'w1', 1)],
    week_plan_exercises: lists('a', ['mine', 1], ['theirs', 5]),
  })
  assert.deepEqual(changesOf(s), [], 'w2 has no planned week and its row is not w1\'s to promote')
  // and with a week of its own that lists nothing of it, the row stays hidden: it is week-only and unlisted
  const own = { ...s, week_plans: [wk('a', 'm1', 'w1', 1), wk('b', 'm1', 'w2', 1)], week_plan_exercises: [...lists('a', ['mine', 1], ['theirs', 5]), ...lists('b')] }
  assert.deepEqual(changesOf(own), [])
})

test('the answer does not depend on the order the rows come in', () => {
  const s = snap({
    program_exercises: [pe('a', 'w1', 1), pe('b', 'w1', 2, { week_only: true }), pe('c', 'w1', 3), pe('d', 'w1', 4, { removed: true, removed_at: 'x' })],
    week_plans: [wk('p', 'm1', 'w1', 1), wk('q', 'm1', 'w1', 2)],
    week_plan_exercises: [...lists('p', ['a', 1], ['c', 3]), ...lists('q', ['b', 1], ['a', 2], ['d', 3])],
  })
  const forward = changesOf(s)
  const reversed = changesOf({ ...s, program_exercises: [...s.program_exercises].reverse(), week_plans: [...s.week_plans].reverse(), week_plan_exercises: [...s.week_plan_exercises].reverse() })
  assert.deepEqual(reversed, forward)
  assert.ok(forward.length > 0)
})

// ─── Comparing ────────────────────────────────────────────────────────────────────────────────────────────────────────

test('diffRows names each changed column of each row, rows that appeared or vanished, and a stamp rewritten on a row that stays removed', () => {
  const before = snap({ program_exercises: [pe('a', 'w1', 1), pe('b', 'w1', 2, { removed: true, removed_at: 't1' }), pe('c', 'w1', 3)] })
  const after = snap({ program_exercises: [pe('a', 'w1', 7, { week_only: true }), pe('b', 'w1', 2, { removed: true, removed_at: 't2' }), pe('d', 'w1', 1)] })
  const d = diffRows(before, after)
  assert.deepEqual(d.changes.map((c) => `${c.id}.${c.column}`), ['a.week_only', 'a.position', 'b.removed_at'].sort())
  assert.deepEqual(d.gone, ['c'])
  assert.deepEqual(d.added, ['d'])
  // the first removal of a row is a change of `removed`, not a rewrite
  const first = diffRows(snap({ program_exercises: [pe('a', 'w1', 1)] }), snap({ program_exercises: [pe('a', 'w1', 1, { removed: true, removed_at: 't' })] }))
  assert.deepEqual(first.changes.map((c) => c.column), ['removed'])
  assert.deepEqual(diffRows(before, before), { changes: [], gone: [], added: [] })
})

test('two lists of changes are the same when they hold the same changes, and missing and extra are told apart', () => {
  const c = (id, column, from, to) => ({ id, column, from, to })
  assert.equal(sameChanges([c('a', 'position', 1, 2), c('b', 'removed', false, true)], [c('b', 'removed', false, true), c('a', 'position', 1, 2)]), true)
  assert.equal(sameChanges([c('a', 'position', 1, 2)], [c('a', 'position', 1, 3)]), false)
  assert.equal(sameChanges([c('a', 'position', 1, 2)], []), false)
  const { missing, extra } = missingAndExtra([c('a', 'position', 1, 2), c('b', 'removed', false, true)], [c('b', 'removed', false, true), c('z', 'week_only', true, false)])
  assert.deepEqual(missing.map((x) => x.id), ['a'])
  assert.deepEqual(extra.map((x) => x.id), ['z'])
})

test('fingerprints differ key by key, counts and hashes both', () => {
  const a = { counts: { t1: 3, t2: 4 }, hashes: { t1: 'x', t2: 'y' } }
  assert.deepEqual(fingerprintDiff(a, structuredClone(a)), [])
  assert.deepEqual(fingerprintDiff(a, { counts: { t1: 3, t2: 5 }, hashes: { t1: 'x', t2: 'y' } }), ['counts.t2'])
  assert.deepEqual(fingerprintDiff(a, { counts: { t1: 3, t2: 4 }, hashes: { t1: 'x', t2: 'z' } }), ['hashes.t2'])
  assert.deepEqual(fingerprintDiff(a, { counts: { t1: 3 }, hashes: { t1: 'x', t2: 'y' } }), ['counts.t2'])
})

const slot = (exercises, sets = [], over = {}) => ({ workout_day_id: 'w1', sequence_position: null, exercises, sets, ...over })

test('two plannings of a slot agree on the rows, their order and (for the workout\'s own rows) their positions, and on the sets', () => {
  const owner = new Map([['a', 'w1'], ['b', 'w1'], ['ghost', 'w2']])
  const a = slot([['a', 1], ['b', 2]], [['a', 1, 0, false, false, null, null, null]])
  assert.equal(sameSlot(a, slot([['b', 2], ['a', 1]], [['a', 1, 0, false, false, null, null, null]]), owner), true, 'listed in another order, same thing')
  assert.equal(sameSlot(a, slot([['a', 1], ['b', 3]], a.sets), owner), false, 'a position')
  assert.equal(sameSlot(a, slot([['a', 1]], a.sets), owner), false, 'a row missing')
  assert.equal(sameSlot(a, slot([['b', 1], ['a', 2]], a.sets), owner), false, 'the order')
  assert.equal(sameSlot(a, slot(a.exercises, [['a', 2, 0, false, false, null, null, null]]), owner), false, 'a set')
  assert.equal(sameSlot(a, slot(a.exercises, []), owner), false, 'a set missing')
  // a row of another workout: its number is 045's own, its place in the order is what must agree
  const g1 = slot([['a', 1], ['ghost', 20]])
  assert.equal(sameSlot(g1, slot([['a', 1], ['ghost', 2]]), owner), true)
  assert.equal(sameSlot(g1, slot([['ghost', 0], ['a', 1]]), owner), false, 'its place in the order')
  assert.equal(slotKey({ workout_day_id: 'w1', sequence_position: 4 }), 'w1|4')
  assert.equal(slotKey({ workout_day_id: 'w1', sequence_position: null }), 'w1|null')
})

test('the migration\'s notice is read, and anything else is not', () => {
  const line = '046: 1 active week-dependent run(s), 3 workout(s) with a last planned week: 4 made part of the program, 3 brought back, 3 moved (8 row(s) written), 5 taken out'
  assert.deepEqual(parseNotice(line), { runs: 1, workouts: 3, promoted: 4, revived: 3, moved: 3, written: 8, removed: 5 })
  assert.equal(parseNotice('046: something else'), null)
  assert.equal(parseNotice(undefined), null)
})

// ─── Judging a world ──────────────────────────────────────────────────────────────────────────────────────────────────

const FP = { counts: { v2_program_exercises: 3 }, hashes: { v2_program_exercises_other_columns: 'h', v2_week_plans: 'w' } }
// A consistent world: the last week lists a and c; b is live and unlisted (taken out); c is week-only (made part of the program).
function goodWorld() {
  const before = snap({
    program_exercises: [pe('a', 'w1', 1), pe('b', 'w1', 2), pe('c', 'w1', 3, { week_only: true })],
    week_plans: [wk('wk', 'm1', 'w1', 2)],
    week_plan_exercises: lists('wk', ['a', 1], ['c', 3]),
  })
  const after = structuredClone(before)
  after.program_exercises[1].removed = true
  after.program_exercises[1].removed_at = 'now'
  after.program_exercises[2].week_only = false
  const answer = [slot([['a', 1], ['c', 3]], [['a', 1, 0, false, false, null, null, null]])]
  return {
    snapshot: before,
    snapshot_after: after,
    snapshot_after_twice: structuredClone(after),
    fingerprint_before: FP,
    fingerprint_after: structuredClone(FP),
    fingerprint_after_twice: structuredClone(FP),
    answer_041: answer,
    answer_045_after_046: structuredClone(answer),
  }
}
const NOTICES = [
  '046: 1 active week-dependent run(s), 1 workout(s) with a last planned week: 1 made part of the program, 0 brought back, 0 moved (1 row(s) written), 1 taken out',
  '046: 1 active week-dependent run(s), 1 workout(s) with a last planned week: 0 made part of the program, 0 brought back, 0 moved (0 row(s) written), 0 taken out',
]

test('a world where 046 did what the rule says, a second run did nothing, nothing else moved and the next week is the same, passes', () => {
  const j = judgeWorld(goodWorld(), NOTICES)
  assert.deepEqual(j.problems, [])
  assert.equal(j.ok, true)
  assert.equal(j.changes, 2)
  assert.equal(j.compared, 1)
})

test('each way a migration can be wrong fails the world, and says which', () => {
  const cases = [
    ['a change the rule does not say', (w) => { w.snapshot_after.program_exercises[0].position = 9; w.snapshot_after_twice.program_exercises[0].position = 9 }, /does not say/],
    ['a change the rule says, not made', (w) => { w.snapshot_after.program_exercises[2].week_only = true; w.snapshot_after_twice.program_exercises[2].week_only = true }, /did not make/],
    ['a second run that changes something', (w) => { w.snapshot_after_twice.program_exercises[0].position = 9 }, /second run changed/],
    ['a stamp rewritten on a removed row', (w) => { w.snapshot.program_exercises[0].removed = true; w.snapshot.program_exercises[0].removed_at = 'old'; w.snapshot_after.program_exercises[0].removed = true; w.snapshot_after.program_exercises[0].removed_at = 'new'; w.snapshot_after_twice.program_exercises[0].removed = true; w.snapshot_after_twice.program_exercises[0].removed_at = 'new' }, /does not say|did not make/],
    ['a row that vanished', (w) => { w.snapshot_after.program_exercises.pop() }, /appeared or vanished/],
    ['another column written', (w) => { w.fingerprint_after = { counts: FP.counts, hashes: { ...FP.hashes, v2_program_exercises_other_columns: 'changed' } } }, /after: hashes\.v2_program_exercises_other_columns differ/],
    ['a count that moved', (w) => { w.fingerprint_after_twice = { counts: { v2_program_exercises: 4 }, hashes: FP.hashes } }, /after twice: counts\.v2_program_exercises differ/],
    ['a next week that is not 041\'s', (w) => { w.answer_045_after_046 = [slot([['a', 1]], [['a', 1, 0, false, false, null, null, null]])] }, /next week of w1\|null differs/],
    ['a next week that is missing', (w) => { w.answer_045_after_046 = [] }, /no next week for w1\|null/],
  ]
  for (const [label, mutate, re] of cases) {
    const w = goodWorld()
    mutate(w)
    const j = judgeWorld(w, NOTICES)
    assert.equal(j.ok, false, label)
    assert.ok(j.problems.some((p) => re.test(p)), `${label}: ${j.problems.join(' | ')}`)
  }
})

test('the notices are held to the rule too: a first update that wrote a row it should not, a second run that reports work, no notice', () => {
  const run = (notices) => judgeWorld(goodWorld(), notices)
  const wrote = [NOTICES[0].replace('(1 row(s) written)', '(3 row(s) written)'), NOTICES[1]]
  assert.match(run(wrote).problems.join('|'), /first update wrote 3 row\(s\), the rule changes 1/)
  const tooMany = [NOTICES[0].replace('1 taken out', '2 taken out'), NOTICES[1]]
  assert.match(run(tooMany).problems.join('|'), /took out 2 exercise\(s\), the rule says 1/)
  const busy = [NOTICES[0], NOTICES[1].replace('(0 row(s) written)', '(1 row(s) written)')]
  assert.match(run(busy).problems.join('|'), /second run reports written 1, not 0/)
  const matched = [NOTICES[0].replace('1 workout(s)', '2 workout(s)'), NOTICES[1]]
  assert.match(run(matched).problems.join('|'), /matched 2 workout\(s\), the rule 1/)
  assert.match(run(['not a notice']).problems.join('|'), /no readable notice twice/)
  assert.deepEqual(judgeWorld(goodWorld()).problems, [], 'without notices the rest is still judged')
})

// ─── What a set of worlds reached ─────────────────────────────────────────────────────────────────────────────────────

const reachedCases = (w) => Object.entries(casesOf(w)).filter(([, hit]) => hit).map(([c]) => c).sort()

test('each case is read from the world\'s rows, on a world built for it', () => {
  const g = goodWorld()
  assert.deepEqual(reachedCases(g), ['promote', 'remove'])
  assert.deepEqual(reachedCases({ snapshot: snap({ program_exercises: [pe('a', 'w1', 1)], week_plans: [wk('a1', 'm1', 'w1', 1)], week_plan_exercises: lists('a1', ['a', 1]) }) }), ['untouched'])
  // revive and move
  const rm = snap({ program_exercises: [pe('a', 'w1', 1, { removed: true, removed_at: 'x' }), pe('b', 'w1', 2)], week_plans: [wk('w', 'm1', 'w1', 1)], week_plan_exercises: lists('w', ['a', 1], ['b', 5]) })
  assert.deepEqual(reachedCases({ snapshot: rm }), ['move', 'revive'])
  // an earlier week decides because a later one is a deload session; a workout with no planned week
  const earlier = snap({
    workout_days: [{ id: 'w1', program_id: 'p1' }, { id: 'w2', program_id: 'p1' }],
    program_exercises: [pe('a', 'w1', 1), pe('z', 'w2', 1)],
    week_plans: [wk('p', 'm1', 'w1', 1), wk('q', 'm1', 'w1', 2, { is_deload: true })],
    week_plan_exercises: [...lists('p', ['a', 1]), ...lists('q', ['a', 1])],
  })
  assert.deepEqual(reachedCases({ snapshot: earlier }), ['earlierWeek', 'neverPlanned', 'untouched'])
  // a repeated workout whose two slots list different rows
  const seq = snap({
    programs: [{ id: 'p1', kind: 'run', planning_type: 'week_dependent', schedule_type: 'sequence' }],
    program_exercises: [pe('a', 'w1', 1), pe('b', 'w1', 2)],
    week_plans: [wk('s1', 'm1', 'w1', 1, { sequence_position: 1 }), wk('s4', 'm1', 'w1', 1, { sequence_position: 4 })],
    week_plan_exercises: [...lists('s1', ['a', 1], ['b', 2]), ...lists('s4', ['a', 1])],
  })
  assert.ok(reachedCases({ snapshot: seq }).includes('slotsDiffer'))
  // a completed run holding a mismatch, another user's stable run holding one, a week listing another workout's row
  const others = snap({
    mesocycles: [{ id: 'm1', user_id: 'u1', status: 'active', program_id: 'p1' }, { id: 'm0', user_id: 'u1', status: 'completed', program_id: 'p0' }, { id: 'mb', user_id: 'u2', status: 'active', program_id: 'pb' }],
    programs: [{ id: 'p1', kind: 'run', planning_type: 'week_dependent', schedule_type: 'weekday' }, { id: 'p0', kind: 'run', planning_type: 'week_dependent', schedule_type: 'weekday' }, { id: 'pb', kind: 'run', planning_type: 'stable', schedule_type: 'weekday' }],
    workout_days: [{ id: 'w1', program_id: 'p1' }, { id: 'w0', program_id: 'p0' }, { id: 'wb', program_id: 'pb' }],
    program_exercises: [pe('a', 'w1', 1), pe('old', 'w0', 1, { week_only: true }), pe('b', 'wb', 1, { week_only: true })],
    week_plans: [wk('x', 'm1', 'w1', 1)],
    week_plan_exercises: lists('x', ['a', 1], ['b', 20]),
  })
  const got = reachedCases({ snapshot: others })
  for (const c of ['completedRun', 'otherUser', 'otherWorkout']) assert.ok(got.includes(c), c)
  assert.equal(CASES.length, 11)
  assert.equal(floorFor(100), 4)
  assert.equal(floorFor(183), 8)
  assert.equal(floorFor(10), 3)
})

// ─── The replay script ────────────────────────────────────────────────────────────────────────────────────────────────

test('041\'s function is cut out under another name, with its $$ bodies whole, and the migration goes in twice', () => {
  const t041 = [
    'x', '-- ═══ 1. v2_copy_program', 'create or replace function v2_copy_program() returns void as $$ select 1 $$;',
    '-- ═══ 2. v2_plan_week — 040\'s body', 'create or replace function v2_plan_week(', '  p_mesocycle_id uuid', ') returns integer as $$ begin return 1; end; $$;',
    'grant execute on function v2_plan_week(uuid, integer) to authenticated;', '-- ═══ 3. v2_make_week_default', 'create or replace function v2_make_week_default() returns void as $$ select 3 $$;',
  ].join('\n')
  const f = plan041Function(t041)
  assert.match(f, /create or replace function v2_plan_week_041\(/)
  assert.doesNotMatch(f, /v2_copy_program|v2_make_week_default/)
  assert.match(f, /grant execute on function v2_plan_week_041\(uuid, integer\) to authenticated;/)
  assert.throws(() => plan041Function('nothing here'), /not found/)
  const world = ['-- header', '-- @V2_PLAN_WEEK_041@', 'begin;', '-- @MIGRATION@', 'select 1;', '-- @MIGRATION@', 'rollback;'].join('\n')
  const script = worldScript(world, t041, 'do $$ begin end $$;')
  assert.equal(script.split('do $$ begin end $$;').length - 1, 2)
  assert.match(script, /return 1; end; \$\$;/, 'the dollar signs of the function body survive')
  assert.doesNotMatch(script, /@MIGRATION@|@V2_PLAN_WEEK_041@/)
  assert.throws(() => worldScript('-- @V2_PLAN_WEEK_041@\n-- @MIGRATION@\n', t041, 'x'), /migration marker twice/)
})

// ─── Staging: read only ───────────────────────────────────────────────────────────────────────────────────────────────

function fakeGet(tables) {
  return async (path) => {
    const table = path.split('?')[0]
    if (!(table in tables)) throw new Error(`GET ${table} answered HTTP 404`)
    return structuredClone(tables[table])
  }
}
const TABLES = {
  v2_mesocycles: [{ id: 'm1', user_id: 'u', status: 'active', program_id: 'p1' }],
  v2_programs: [{ id: 'p1', kind: 'run', planning_type: 'week_dependent', schedule_type: 'weekday' }],
  v2_workout_days: [{ id: 'w1', program_id: 'p1' }],
  v2_program_exercises: [
    { id: 'a', workout_day_id: 'w1', exercise_id: 'e1', position: 1, week_only: false, removed_at: null, replaces_program_exercise_id: null, tempo: null, user_id: 'u' },
    { id: 'b', workout_day_id: 'w1', exercise_id: 'e2', position: 2, week_only: true, removed_at: null, replaces_program_exercise_id: null, tempo: null, user_id: 'u' },
  ],
  v2_week_plans: [{ id: 'wk', mesocycle_id: 'm1', workout_day_id: 'w1', week_number: 1, sequence_position: null, is_deload: false, deload_restore: null, notes: null, user_id: 'u' }],
  v2_week_plan_exercises: [{ id: 'x1', week_plan_id: 'wk', program_exercise_id: 'b', position: 2, carry_program_exercise_id: null, carry_position: null, user_id: 'u' }],
  v2_week_plan_sets: [{ id: 's1', week_plan_id: 'wk' }],
}

test('the snapshot read over the API has the replay\'s shape and counts a week\'s sets; the rule runs on it', async () => {
  const { snapshot, fingerprint } = await fetchSnapshot(fakeGet(TABLES))
  assert.deepEqual(snapshot.program_exercises.map((r) => [r.id, r.week_only, r.removed]), [['a', false, false], ['b', true, false]])
  assert.deepEqual(snapshot.week_plans.map((w) => [w.id, w.n_sets]), [['wk', 1]])
  assert.deepEqual(plan046(snapshot).changes.map((c) => `${c.id}.${c.column}:${c.to}`).sort(), ['a.removed:true', 'b.week_only:false'])
  assert.equal(fingerprint.counts.v2_program_exercises, 2)
  assert.equal(fingerprint.counts.v2_week_plan_sets, 1)
  // the "other columns" hash ignores week_only, removed_at and position and sees everything else
  const moved = structuredClone(TABLES)
  moved.v2_program_exercises[1].position = 7
  moved.v2_program_exercises[1].week_only = false
  moved.v2_program_exercises[0].removed_at = '2026-10-21T00:00:00Z'
  const same = await fetchSnapshot(fakeGet(moved))
  assert.equal(same.fingerprint.hashes.v2_program_exercises_other_columns, fingerprint.hashes.v2_program_exercises_other_columns)
  const other = structuredClone(TABLES)
  other.v2_program_exercises[1].tempo = '3-1-1-0'
  assert.notEqual((await fetchSnapshot(fakeGet(other))).fingerprint.hashes.v2_program_exercises_other_columns, fingerprint.hashes.v2_program_exercises_other_columns)
})

test('the before and after of a staging rehearsal pass only when exactly the rule\'s changes were made and nothing else moved', async () => {
  const before = await fetchSnapshot(fakeGet(TABLES))
  const afterTables = structuredClone(TABLES)
  afterTables.v2_program_exercises[0].removed_at = '2026-10-21T00:00:00Z' // a leaves the program
  afterTables.v2_program_exercises[1].week_only = false // b becomes part of it
  const after = await fetchSnapshot(fakeGet(afterTables))
  const ok = compareSnapshots(before, after)
  assert.deepEqual(ok.problems, [])
  assert.equal(ok.diff.changes.length, 2)
  // nothing happened: the rule's changes are missing
  assert.match(compareSnapshots(before, before).problems.join('|'), /2 change\(s\) the rule says were not made/)
  // one change too many
  const extraTables = structuredClone(afterTables)
  extraTables.v2_program_exercises[0].position = 9
  assert.match(compareSnapshots(before, await fetchSnapshot(fakeGet(extraTables))).problems.join('|'), /does not say were made/)
  // another column of the table written
  const wrote = structuredClone(afterTables)
  wrote.v2_program_exercises[1].tempo = '1-1-1-1'
  assert.match(compareSnapshots(before, await fetchSnapshot(fakeGet(wrote))).problems.join('|'), /v2_program_exercises_other_columns differ/)
  // a PLAN FORWARD in between changes the week tables: told, not failed
  const planned = structuredClone(afterTables)
  planned.v2_week_plans.push({ id: 'wk2', mesocycle_id: 'm1', workout_day_id: 'w1', week_number: 2, sequence_position: null, is_deload: false, deload_restore: null, notes: null, user_id: 'u' })
  const withWeek = compareSnapshots(before, await fetchSnapshot(fakeGet(planned)))
  assert.deepEqual(withWeek.problems, [])
  assert.ok(withWeek.weeks.some((k) => k.endsWith('v2_week_plans')))
  // a row that vanished
  const gone = structuredClone(afterTables)
  gone.v2_program_exercises.pop()
  assert.match(compareSnapshots(before, await fetchSnapshot(fakeGet(gone))).problems.join('|'), /appeared or vanished/)
})
