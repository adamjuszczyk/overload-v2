// plan-week-parity's own tests (chunk 42): the comparison and the verdict, on synthetic rows, no Docker. The harness
// itself needs the replayed database (scripts/plan-week-parity.mjs); what a green run PROVES depends on these two
// functions telling a real difference from a match, so each is tested on a pair that differs and a pair that doesn't.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPECTATIONS,
  FIRST_LINE,
  FUZZ_CASES,
  HAND_BUILT,
  SAFEUPDATE_PREFIX,
  SCENARIOS,
  afterChecks,
  camelRow,
  compareWeeks,
  coverageOf,
  formatTable,
  fuzzFloor,
  judge,
  parseArgs,
  sqlRows,
  toAutoCopyInput,
  tsRows,
} from './plan-week-parity.mjs'

const names = new Map([['pe-lat', 'Lat Pulldown']])
const positions = new Map([['pe-lat', 1]])

// A week-dependent week 2 as the SQL plans it under 041: a working set and a dropset head with a drop, numbers copied.
const SQL_OUTPUT = {
  exercises: [{ program_exercise_id: 'pe-lat', position: 1 }],
  sets: [
    { id: 'n1', program_exercise_id: 'pe-lat', set_number: 1, stage_index: 0, parent_week_plan_set_id: null, is_dropset: false, is_warmup: false, stage_kind: null, program_set_id: 'ps1', target_weight: 55, target_rir: 2, target_rir_max: null, rep_min: 9, rep_max: 11, is_amrap: false, tags: null },
    { id: 'n2', program_exercise_id: 'pe-lat', set_number: 2, stage_index: 0, parent_week_plan_set_id: null, is_dropset: false, is_warmup: false, stage_kind: 'dropset', program_set_id: 'ps2', target_weight: 55, target_rir: 2, target_rir_max: null, rep_min: 8, rep_max: 10, is_amrap: false, tags: null },
    { id: 'n3', program_exercise_id: 'pe-lat', set_number: 2, stage_index: 1, parent_week_plan_set_id: 'n2', is_dropset: true, is_warmup: false, stage_kind: null, program_set_id: 'ps3', target_weight: 40, target_rir: 0, target_rir_max: null, rep_min: null, rep_max: null, is_amrap: true, tags: null },
  ],
}
// What autoCopy says for the same week: the structure, no numbers.
const TS_RESULT = {
  source: { kind: 'week', weekNumber: 1 },
  exercises: [{ programExerciseId: 'pe-lat', position: 1 }],
  sets: [
    { sourceId: 'w1', parentSourceId: null, programExerciseId: 'pe-lat', setNumber: 1, isDropset: false, isWarmup: false, stageKind: null, stageIndex: 0, programSetId: 'ps1', repMin: null, repMax: null, isAmrap: false, targetWeight: null, targetRir: null, targetRirMax: null, tags: null },
    { sourceId: 'w2', parentSourceId: null, programExerciseId: 'pe-lat', setNumber: 2, isDropset: false, isWarmup: false, stageKind: 'dropset', stageIndex: 0, programSetId: 'ps2', repMin: null, repMax: null, isAmrap: false, targetWeight: null, targetRir: null, targetRirMax: null, tags: null },
    { sourceId: 'w3', parentSourceId: 'w2', programExerciseId: 'pe-lat', setNumber: 2, isDropset: true, isWarmup: false, stageKind: null, stageIndex: 1, programSetId: 'ps3', repMin: null, repMax: null, isAmrap: false, targetWeight: null, targetRir: null, targetRirMax: null, tags: null },
  ],
}

const compare = (sqlOut = SQL_OUTPUT, tsRes = TS_RESULT) =>
  compareWeeks({
    sqlExercises: sqlOut.exercises.map((x) => ({ programExerciseId: x.program_exercise_id, position: x.position })),
    tsExercises: tsRes.exercises,
    sql: sqlRows(sqlOut, names, positions),
    ts: tsRows(tsRes, names, positions),
  })

// ─── What differs ─────────────────────────────────────────────────────────────────────────────────────────────────

test('041 against autoCopy: identical structure, and the differing number columns are named exactly', () => {
  const cmp = compare()
  assert.equal(cmp.structureOk, true)
  assert.deepEqual(cmp.differingNumberColumns, ['is_amrap', 'rep_max', 'rep_min', 'target_rir', 'target_weight'])
  assert.deepEqual(judge(cmp, EXPECTATIONS.numbers.a), { ok: true, why: 'structure identical; differs exactly in is_amrap, rep_max, rep_min, target_rir, target_weight' })
})

test('the same week on both sides is equal in every column, and fails the 041 expectation (nothing differs where numbers should)', () => {
  const noNumbers = { ...SQL_OUTPUT, sets: SQL_OUTPUT.sets.map((s) => ({ ...s, target_weight: null, target_rir: null, rep_min: null, rep_max: null, is_amrap: false })) }
  const cmp = compare(noNumbers)
  assert.equal(cmp.structureOk, true)
  assert.deepEqual(cmp.differingNumberColumns, [])
  assert.equal(judge(cmp, { kind: 'equal' }).ok, true)
  assert.equal(judge(cmp, EXPECTATIONS.numbers.a).ok, false)
})

test('045\'s verdict: identical in every column, so a number the SQL still copies fails it (structure alone is not enough)', () => {
  const cmp = compare() // the SQL's numbers filled, autoCopy's none: the structure matches
  assert.equal(cmp.structureOk, true)
  const verdict = judge(cmp, EXPECTATIONS.equal.a)
  assert.equal(verdict.ok, false)
  assert.match(verdict.why, /number columns that differ: \[is_amrap, rep_max, rep_min, target_rir, target_weight\]/)
})

test('"exactly" runs both ways: a column that should differ and does not fails the 041 expectation, and an extra one does too', () => {
  // autoCopy wrongly copying the weight: target_weight no longer differs.
  const copiesWeight = { ...TS_RESULT, sets: TS_RESULT.sets.map((s, i) => ({ ...s, targetWeight: [55, 55, 40][i] })) }
  const missing = judge(compare(SQL_OUTPUT, copiesWeight), EXPECTATIONS.numbers.a)
  assert.equal(missing.ok, false)
  assert.match(missing.why, /expected the number columns to differ exactly in \[is_amrap, rep_max, rep_min, target_rir, target_weight\]/)
  // The stable expectation (weight and RIR only) fails on a week whose reps differ too.
  assert.equal(judge(compare(), EXPECTATIONS.numbers.b).ok, false)
})

test('a structure difference fails every expectation: a flag, a stage kind, a program-set link', () => {
  for (const [col, ts] of [
    ['is_warmup', { isWarmup: true }],
    ['stage_kind', { stageKind: 'myo_reps' }],
    ['program_set_id', { programSetId: 'other' }],
    ['is_dropset', { isDropset: true }],
  ]) {
    const broken = { ...TS_RESULT, sets: TS_RESULT.sets.map((s, i) => (i === 1 ? { ...s, ...ts } : s)) }
    const cmp = compare(SQL_OUTPUT, broken)
    assert.equal(cmp.structureOk, false, col)
    assert.ok(cmp.structureDiffs.some((d) => d.column === col), col)
    assert.equal(judge(cmp, EXPECTATIONS.numbers.a).ok, false, col)
    assert.equal(judge(cmp, { kind: 'equal' }).ok, false, col)
  }
})

test('a stage attached to a different head is a structure difference: parents are compared by what they are, not by id', () => {
  // SQL: the drop hangs under set 2 (ids n2/n3). autoCopy attaches it under set 1.
  const reparented = { ...TS_RESULT, sets: TS_RESULT.sets.map((s) => (s.sourceId === 'w3' ? { ...s, parentSourceId: 'w1' } : s)) }
  const cmp = compare(SQL_OUTPUT, reparented)
  assert.equal(cmp.structureOk, false)
  assert.deepEqual(cmp.structureDiffs.map((d) => d.column), ['parent'])
  // The ids differ between the two sides in every row; the same attachment is no difference.
  assert.equal(compare().structureDiffs.length, 0)
})

test('a row only one side has fails, and is named', () => {
  const fewer = { ...TS_RESULT, sets: TS_RESULT.sets.slice(0, 2) }
  const cmp = compare(SQL_OUTPUT, fewer)
  assert.equal(cmp.structureOk, false)
  assert.deepEqual(cmp.missingInTs, ['Lat Pulldown · 2.1 (stage)'])
  const more = { ...TS_RESULT, sets: [...TS_RESULT.sets, { ...TS_RESULT.sets[0], sourceId: 'w9', setNumber: 3, programSetId: 'ps9' }] }
  assert.deepEqual(compare(SQL_OUTPUT, more).extraInTs, ['Lat Pulldown · 03'])
  assert.equal(judge(compare(SQL_OUTPUT, more), EXPECTATIONS.numbers.a).ok, false)
})

test('the exercise lists are compared too: an exercise at another position fails', () => {
  const moved = { ...TS_RESULT, exercises: [{ programExerciseId: 'pe-lat', position: 2 }] }
  const cmp = compare(SQL_OUTPUT, moved)
  assert.equal(cmp.exercisesEqual, false)
  assert.equal(cmp.structureOk, false)
})

test('week_start "empty": an empty SQL week against a copied one is the expected difference, and only that', () => {
  const empty = { exercises: [], sets: [] }
  const cmp = compare(empty)
  assert.equal(judge(cmp, EXPECTATIONS.numbers.c).ok, true)
  // ... and not a pass when the SQL planned something, or when autoCopy planned nothing.
  assert.equal(judge(compare(), EXPECTATIONS.numbers.c).ok, false)
  // The SQL's week is empty only when it has neither rows nor exercises: each alone is something planned.
  const exercisesOnly = { exercises: SQL_OUTPUT.exercises, sets: [] }
  assert.equal(judge(compare(exercisesOnly), EXPECTATIONS.numbers.c).ok, false)
  const rowsOnly = { exercises: [], sets: SQL_OUTPUT.sets }
  assert.equal(judge(compare(rowsOnly), EXPECTATIONS.numbers.c).ok, false)
  assert.equal(judge(compare(empty, { source: { kind: 'empty' }, exercises: [], sets: [] }), EXPECTATIONS.numbers.c).ok, false)
  // 045's expectation: no such difference.
  assert.equal(judge(cmp, EXPECTATIONS.equal.c).ok, false)
})

test('tags: a cue the SQL carried and autoCopy does not is a number-column difference', () => {
  const tagged = { ...SQL_OUTPUT, sets: SQL_OUTPUT.sets.map((s, i) => (i === 0 ? { ...s, tags: ['push here'] } : s)) }
  assert.ok(compare(tagged).differingNumberColumns.includes('tags'))
})

// ─── Inputs and output ────────────────────────────────────────────────────────────────────────────────────────────

test('toAutoCopyInput camel-cases every column (numbers included) and keys a week\'s exercises by their program exercise', () => {
  const fx = {
    planning_type: 'stable',
    week_number: 3,
    run_copy: {
      exercises: [{ id: 'pe1', exercise_id: 'ex1', exercise_name: 'Bench', position: 1, week_only: false, removed_at: null }],
      sets: [{ id: 'ps1', program_exercise_id: 'pe1', position: 1, is_warmup: false, stage_kind: null, parent_program_set_id: null, stage_index: 0, rep_min: 8, rep_max: 10, is_amrap: false, removed_at: null }],
    },
    prior_weeks: [
      {
        week_number: 2,
        is_deload: true,
        exercises: [{ id: 'wpe-row', program_exercise_id: 'pe1', position: 1 }],
        sets: [{ id: 's1', program_exercise_id: 'pe1', set_number: 1, target_weight: 55, target_rir_max: 3, tags: ['x'] }],
      },
    ],
  }
  const input = toAutoCopyInput(fx)
  assert.equal(input.planningType, 'stable')
  assert.equal(input.weekNumber, 3)
  assert.deepEqual(input.runCopy.exercises[0], { id: 'pe1', exerciseId: 'ex1', exerciseName: 'Bench', position: 1, weekOnly: false, removedAt: null, exercise: { name: 'Bench' } })
  assert.equal(input.runCopy.sets[0].programExerciseId, 'pe1')
  assert.equal(input.runCopy.sets[0].isAmrap, false)
  const week = input.priorWeeks[0]
  assert.equal(week.isDeload, true)
  assert.equal(week.exercises[0].id, 'pe1') // the program exercise, not the week-plan-exercise row
  assert.equal(week.sets[0].targetWeight, 55) // the numbers ride in, so a copy that read them would show
  assert.deepEqual(week.sets[0].tags, ['x'])
  assert.deepEqual(camelRow({ a_b_c: 1 }), { aBC: 1 })
})

test('the table prints one line per row with the SQL value, an arrow and autoCopy\'s, and names a row only one side has', () => {
  const table = formatTable(compare())
  const lines = table.split('\n')
  assert.equal(lines.length, 1 + 3) // header + the three rows
  assert.match(lines[1], /Lat Pulldown · 01\s+55→·/)
  assert.match(lines[3], /Lat Pulldown · 2\.1 \(stage\)\s+40→·.*T→F/)
  const missing = formatTable(compare(SQL_OUTPUT, { ...TS_RESULT, sets: TS_RESULT.sets.slice(0, 2) }))
  assert.match(missing, /ONLY IN SQL/)
})

// ─── Chunk 53: the arguments, the checks after planning, what a random world reached ─────────────────────────────

const args = (...a) => ['node', 'plan-week-parity.mjs', ...a]

test('by default the rule is 045\'s (identical) and every hand-built scenario runs; z runs only with --fuzz', () => {
  const o = parseArgs(args())
  assert.equal(o.expect, 'equal')
  assert.deepEqual(o.scenarios, HAND_BUILT)
  assert.deepEqual(HAND_BUILT, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'])
  assert.equal(o.fuzz, 0)
  assert.equal(o.safeupdate, false)
  // every scenario, z included, has an expectation of "identical"
  assert.deepEqual(Object.keys(EXPECTATIONS.equal).sort(), Object.keys(SCENARIOS).sort())
  for (const s of Object.keys(SCENARIOS)) assert.deepEqual(EXPECTATIONS.equal[s], { kind: 'equal' }, s)
})

test('--expect numbers is the control for 041 and covers a to e only: f to k need 143\'s rule, which 041 does not have', () => {
  assert.deepEqual(parseArgs(args('--expect', 'numbers')).scenarios, ['a', 'b', 'c', 'd', 'e'])
  for (const s of ['f', 'g', 'h', 'i', 'j', 'k']) {
    assert.throws(() => parseArgs(args('--expect', 'numbers', '--scenario', s)), /no expectation for scenario/, s)
  }
  assert.throws(() => parseArgs(args('--expect', 'numbers', '--fuzz', '10')), /needs --expect equal/)
})

test('--fuzz N runs the random worlds alone; with --scenario it runs those as well; --from moves the first seed', () => {
  const alone = parseArgs(args('--fuzz', '40'))
  assert.deepEqual(alone.scenarios, [])
  assert.equal(alone.fuzz, 40)
  assert.equal(alone.from, 1)
  const both = parseArgs(args('--fuzz', '40', '--scenario', 'g,h', '--from', '41', '--container', 'c1', '--safeupdate'))
  assert.deepEqual(both.scenarios, ['g', 'h'])
  assert.equal(both.from, 41)
  assert.equal(both.container, 'c1')
  assert.equal(both.safeupdate, true)
})

test('arguments it does not understand are refused, with the reason', () => {
  assert.throws(() => parseArgs(args('--expect', 'both')), /equal or numbers/)
  assert.throws(() => parseArgs(args('--fuzz', 'x')), /whole number/)
  assert.throws(() => parseArgs(args('--fuzz', '-1')), /whole number/)
  assert.throws(() => parseArgs(args('--from', '0')), /from 1/)
  assert.throws(() => parseArgs(args('--scenario', 'q')), /unknown scenario q/)
  assert.throws(() => parseArgs(args('--scenario', 'z')), /z runs with --fuzz/)
  assert.throws(() => parseArgs(args('--nope')), /unknown argument/)
})

test('pg-safeupdate is loaded before the fixture and proved with a bare UPDATE that must be refused', () => {
  assert.match(SAFEUPDATE_PREFIX, /^load 'safeupdate';/)
  assert.match(SAFEUPDATE_PREFIX, /update auth\.users set email = email;/)
  assert.match(SAFEUPDATE_PREFIX, /requires a WHERE clause/)
  assert.match(SAFEUPDATE_PREFIX, /raise exception 'canary: pg-safeupdate did not refuse a bare UPDATE'/)
})

const GOOD = {
  slot: null,
  planned: 1,
  second_call: 0,
  md5_before: 'abc',
  md5_after: 'abc',
  stranger: 'v2_plan_week: mesocycle 1 not found for user 2',
  anonymous: 'v2_plan_week: no authenticated user',
  plans_before_refusals: 3,
  plans_after_refusals: 3,
}

test('after planning: one slot planned per slot, a second call plans none and changes nothing, a stranger and nobody are refused', () => {
  assert.deepEqual(afterChecks(GOOD), [])
  assert.deepEqual(afterChecks({ ...GOOD, slot: 3, planned: 2 }), [])
  const cases = [
    [{ planned: 2 }, /planned 2 slot\(s\), expected 1/],
    [{ slot: 3, planned: 1 }, /planned 1 slot\(s\), expected 2/],
    [{ second_call: 1 }, /second call planned 1/],
    [{ md5_after: 'xyz' }, /rows changed on the second call/],
    [{ md5_before: null, md5_after: null }, /rows changed on the second call/],
    [{ stranger: 'NOT REFUSED' }, /stranger was not told/],
    [{ stranger: null }, /stranger was not told/],
    [{ anonymous: 'NOT REFUSED' }, /nobody signed in was not refused/],
    [{ plans_after_refusals: 4 }, /refused call planned something/],
  ]
  for (const [over, re] of cases) {
    const problems = afterChecks({ ...GOOD, ...over })
    assert.ok(problems.some((p) => re.test(p)), `${JSON.stringify(over)} -> ${problems.join(' | ')}`)
  }
})

// A world for coverageOf: the run copy's rows, what the source week (week 2) lists, and autoCopy's answer. The target is
// week 3 unless a case says otherwise.
const ex = (id, position, over = {}) => ({ id, position, week_only: false, removed_at: null, replaces_program_exercise_id: null, ...over })
const REMOVED = '2026-10-20T12:00:00Z'
const world = (exercises, listed, over = {}) => ({
  week_number: 3,
  run_copy: { exercises },
  prior_weeks: [{ week_number: 2, is_deload: false, exercises: listed.map((id) => ({ program_exercise_id: id })), sets: [] }],
  ...over,
})
const answer = (ids, over = {}) => ({
  source: { kind: 'week', weekNumber: 2 },
  exercises: ids.map(([programExerciseId, position]) => ({ programExerciseId, position })),
  sets: [],
  ...over,
})
const withSets = (res, ...exerciseIds) => ({ ...res, sets: exerciseIds.map((programExerciseId, i) => ({ sourceId: `s${i}`, programExerciseId })) })
const reached = (fx, res) => Object.entries(coverageOf(fx, res)).filter(([, hit]) => hit).map(([c]) => c).sort()

test('a random world\'s cases are read from its rows and autoCopy\'s answer, each on a world built for it', () => {
  // kept: a live row the source lists brings sets
  assert.deepEqual(reached(world([ex('lat', 1)], ['lat']), withSets(answer([['lat', 1]]), 'lat')), ['kept'])
  // added: a live row the source doesn't list, no sets
  assert.deepEqual(reached(world([ex('lat', 1), ex('row', 2)], ['lat']), withSets(answer([['lat', 1], ['row', 2]]), 'lat')), ['added', 'kept'])
  // dropped: the source lists a removed row; it isn't in the answer
  assert.deepEqual(reached(world([ex('lat', 1), ex('face', 2, { removed_at: REMOVED })], ['lat', 'face']), withSets(answer([['lat', 1]]), 'lat')), ['dropped', 'kept'])
  // weekOnlyGone: the same for a week-only row
  assert.deepEqual(reached(world([ex('lat', 1), ex('dip', 9, { week_only: true, removed_at: REMOVED })], ['lat', 'dip']), withSets(answer([['lat', 1]]), 'lat')), ['kept', 'weekOnlyGone'])
  // weekOnly: a week-only row the source lists, kept after the run copy's rows
  assert.deepEqual(reached(world([ex('lat', 1), ex('dip', 9, { week_only: true })], ['lat', 'dip']), withSets(answer([['lat', 1], ['dip', 2]]), 'lat', 'dip')), ['kept', 'weekOnly'])
  // ghost: a row the run copy doesn't know, kept
  assert.deepEqual(reached(world([ex('lat', 1)], ['lat', 'ghost']), withSets(answer([['lat', 1], ['ghost', 2]]), 'lat', 'ghost')), ['ghost', 'kept'])
  // tie: two live rows at one position
  assert.ok(reached(world([ex('lat', 1), ex('row', 1)], ['lat']), withSets(answer([['lat', 1], ['row', 1]]), 'lat')).includes('tie'))
  // gap: the source isn't the week before the target
  assert.ok(reached(world([ex('lat', 1)], ['lat'], { week_number: 4 }), withSets(answer([['lat', 1]]), 'lat')).includes('gap'))
  // emptyWeek: nothing usable to copy
  assert.deepEqual(reached(world([ex('lat', 1)], ['lat']), { source: { kind: 'empty' }, exercises: [], sets: [] }), ['emptyWeek'])
  // a program source (week 1, a stable run) reaches no case
  assert.deepEqual(reached(world([ex('lat', 1)], ['lat']), { source: { kind: 'program' }, exercises: [], sets: [] }), [])
})

test('a swap, a swap through two links, two rows that replaced one, and a link that goes round', () => {
  const swapped = world([ex('curl', 3, { removed_at: REMOVED }), ex('ham', 3, { replaces_program_exercise_id: 'curl' })], ['curl'])
  assert.deepEqual(reached(swapped, withSets(answer([['ham', 3]]), 'ham')), ['swapped'])
  // two links: cable replaced ham, which replaced curl; the source lists curl
  const chain = world([ex('curl', 3, { removed_at: REMOVED }), ex('ham', 3, { removed_at: REMOVED, replaces_program_exercise_id: 'curl' }), ex('cable', 3, { replaces_program_exercise_id: 'ham' })], ['curl'])
  assert.deepEqual(reached(chain, withSets(answer([['cable', 3]]), 'cable')), ['chain', 'swapped'])
  // the chain only counts when the new row ended with sets (the walk reached something)
  assert.ok(!reached(chain, answer([['cable', 3]])).includes('chain'))
  // rival: two live rows named the same listed row
  const rival = world([ex('curl', 3, { removed_at: REMOVED }), ex('a', 3, { replaces_program_exercise_id: 'curl' }), ex('b', 4, { replaces_program_exercise_id: 'curl' })], ['curl'])
  assert.ok(reached(rival, withSets(answer([['a', 3], ['b', 4]]), 'a')).includes('rival'))
  // loop: A replaces B replaces A, neither listed
  const loop = world([ex('lat', 1), ex('a', 2, { replaces_program_exercise_id: 'b' }), ex('b', 3, { replaces_program_exercise_id: 'a' })], ['lat'])
  assert.ok(reached(loop, withSets(answer([['lat', 1], ['a', 2], ['b', 3]]), 'lat')).includes('loop'))
  // a row that replaces itself is a loop too
  const selfish = world([ex('lat', 1), ex('a', 2, { replaces_program_exercise_id: 'a' })], ['lat'])
  assert.ok(reached(selfish, withSets(answer([['lat', 1], ['a', 2]]), 'lat')).includes('loop'))
  // a row that is only live and unlisted with no link is no loop
  assert.ok(!reached(world([ex('lat', 1), ex('a', 2)], ['lat']), withSets(answer([['lat', 1], ['a', 2]]), 'lat')).includes('loop'))
})

test('the floor of a fuzz run is 4 % of the worlds and never fewer than 3; the cases are the thirteen the rule branches on', () => {
  assert.equal(fuzzFloor(25), 3)
  assert.equal(fuzzFloor(100), 4)
  assert.equal(fuzzFloor(200), 8)
  assert.equal(fuzzFloor(1000), 40)
  assert.equal(FUZZ_CASES.length, 13)
  assert.equal(new Set(FUZZ_CASES).size, 13)
})

test('an error line names the failure, not the NOTICEs and warnings before it', () => {
  const stderr = [
    '(node:1) [UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental',
    '(Use `node --trace-warnings ...` to show where the warning was created)',
    'psql:<stdin>:436: NOTICE:  relation "tmp_v2_plan_week_set_map" already exists, skipping',
    'psql:<stdin>:444: ERROR:  canceling statement due to statement timeout',
    'CONTEXT:  PL/pgSQL function v2_plan_week(uuid,integer) line 120 at SQL statement',
  ].join('\n')
  assert.equal(FIRST_LINE(stderr), 'psql:<stdin>:444: ERROR:  canceling statement due to statement timeout')
  assert.equal(FIRST_LINE('only a notice\nNOTICE:  x'), 'only a notice')
  assert.equal(FIRST_LINE(''), '')
  assert.equal(FIRST_LINE(undefined), '')
})
