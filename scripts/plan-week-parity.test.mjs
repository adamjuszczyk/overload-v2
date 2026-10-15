// plan-week-parity's own tests (chunk 42): the comparison and the verdict, on synthetic rows, no Docker. The harness
// itself needs the replayed database (scripts/plan-week-parity.mjs); what a green run PROVES depends on these two
// functions telling a real difference from a match, so each is tested on a pair that differs and a pair that doesn't.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EXPECTATIONS,
  camelRow,
  compareWeeks,
  formatTable,
  judge,
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

test('044\'s verdict: identical in every column, so a number the SQL still copies fails it (structure alone is not enough)', () => {
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
  // 044's expectation: no such difference.
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
