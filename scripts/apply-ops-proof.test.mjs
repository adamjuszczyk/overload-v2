// Run: node --test "scripts/*.test.mjs"
//
// apply-ops-proof's own tests (chunk 47): what the SQL proof of migration 043 is made of, with no Docker. The proof itself needs
// the replayed database (scripts/apply-ops-proof.mjs). What a green run of it PROVES depends on these things being true:
// that each break is one edit that fires exactly once in the function as the migration file has it (a break that never fired
// would read as caught), that the controls change nothing that runs, that the scenarios name only breaks and ids that exist,
// and that the migration is what its header says it is: a new nullable column and a new function, touching no existing row.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { COPY_FN, REAL_FN, buildScript, parseResults, scenarioSql } from './apply-ops-proof.mjs'
import { BREAKS, CONTROLS } from './apply-ops-proof/breaks.mjs'
import { SCENARIOS } from './apply-ops-proof/scenarios.mjs'
import { mutants } from './apply-ops-proof/sweep.mjs'
import {
  FIXTURE_COUNTS,
  MIGRATION,
  TABLES,
  applyBreak,
  asCopy,
  fixtureSql,
  helperSql,
  readInstallText,
  resolveIds,
  uuidOf,
  withoutComments,
} from './apply-ops-proof/model.mjs'
import { splitStatements } from './migration-rules.mjs'

const install = readInstallText()

// ─── ids and text ────────────────────────────────────────────────────────────────────────────────────────────────────

test('a name is always the same uuid, uuid-shaped, and two names differ; {{tokens}} resolve in any text, a typo is left alone', () => {
  assert.equal(uuidOf('a_pe1'), uuidOf('a_pe1'))
  assert.notEqual(uuidOf('a_pe1'), uuidOf('b_pe1'))
  assert.match(uuidOf('a_pe1'), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.equal(resolveIds("'{{a_pe1}}' and {{b_pe1}}"), `'${uuidOf('a_pe1')}' and ${uuidOf('b_pe1')}`)
  assert.equal(resolveIds('{{not a token}} {a_pe1}'), '{{not a token}} {a_pe1}')
})

test('every scenario and the fixture and the helpers resolve completely: no {{token}} is left in the script', () => {
  const script = buildScript({ installText: null, scenarios: SCENARIOS })
  assert.equal(script.match(/\{\{[^}]*\}\}/g), null)
  const copy = buildScript({ installText: asCopy(install), scenarios: SCENARIOS })
  assert.equal(copy.match(/\{\{[^}]*\}\}/g), null)
})

// ─── the function, read from the migration ───────────────────────────────────────────────────────────────────────────

test('the install text is the function and its two grant statements, read from the migration file (one function, ending in the grant)', () => {
  assert.match(install, /^create or replace function v2_apply_ops\(p_ops jsonb\)/)
  assert.match(install, /\$fn\$;\n\nrevoke execute on function v2_apply_ops\(jsonb\) from public, anon;\ngrant execute on function v2_apply_ops\(jsonb\) to authenticated;$/)
  assert.equal(install.split('create or replace function').length, 2)
  assert.ok(readFileSync(MIGRATION, 'utf8').includes(install), 'the install text is a slice of the migration file as it is')
})

test('the session copy is renamed into pg_temp, once, and given the default privileges Supabase gives a function in public (unless asked not to)', () => {
  const copy = asCopy(install)
  assert.match(copy, /create or replace function pg_temp\.zz_fn\(p_ops jsonb\)/)
  assert.equal(copy.includes('function v2_apply_ops('), false)
  assert.match(copy, /\$fn\$;\ngrant execute on function pg_temp\.zz_fn\(jsonb\) to anon, authenticated, service_role;\n\nrevoke execute on function pg_temp\.zz_fn\(jsonb\) from public, anon;/)
  const bare = asCopy(install, 'zz_fn', { defaults: false })
  assert.equal(bare.includes('to anon, authenticated, service_role'), false)
  assert.equal(bare.includes('revoke execute on function pg_temp.zz_fn(jsonb) from public, anon;'), true)
})

test('applyBreak: an edit that is not in the function, or is in it twice, throws; one that fires once edits exactly that', () => {
  assert.throws(() => applyBreak(install, { id: 'X', edits: [['no such text anywhere', 'y']] }), /is not in the function/)
  assert.throws(() => applyBreak(install, { id: 'X', edits: [["raise exception 'patch sets a protected column';", 'null;']] }), /matches more than once/)
  const edited = applyBreak(install, { id: 'X', edits: [["raise exception 'not signed in';", 'null;']] })
  assert.equal(edited.length, install.length - "raise exception 'not signed in';".length + 'null;'.length)
  assert.equal(edited.includes("raise exception 'not signed in';"), false)
  assert.equal(applyBreak(install, { id: 'X', edits: [] }), install)
})

// ─── the breaks ──────────────────────────────────────────────────────────────────────────────────────────────────────

const scenarioIds = new Set(SCENARIOS.map((s) => s.id))
const all = [...CONTROLS, ...BREAKS]

test('every break and control has its own id, and says one thing about itself: it fails these scenarios, it survives for this reason, or it is a control', () => {
  assert.equal(new Set(all.map((b) => b.id)).size, all.length)
  for (const b of all) {
    const says = [b.control ? 'control' : null, b.survives ? 'survives' : null, b.fails ? 'fails' : null].filter(Boolean)
    assert.equal(says.length, 1, `${b.id} says ${says.join(' and ') || 'nothing'}`)
    assert.ok(b.title && b.title.length > 10, `${b.id} has a title`)
  }
})

test('every break fires: each edit occurs exactly once in the function as the migration has it (a break that never fired reads as caught)', () => {
  for (const b of all) assert.doesNotThrow(() => applyBreak(install, b), `${b.id}`)
  for (const b of all.filter((x) => x.edits.length > 0)) assert.notEqual(applyBreak(install, b), install, `${b.id} changes the text`)
  // the breaks that act on the table instead of the function say what they do in SQL that names the constraint
  for (const b of all.filter((x) => x.pre)) assert.match(b.pre, /v2_program_exercises_replaces_program_exercise_id_fkey|replaces_program_exercise_id/, `${b.id}`)
})

test('every scenario a break expects to fail exists', () => {
  for (const b of BREAKS.filter((x) => x.fails)) {
    assert.ok(b.fails.length > 0, `${b.id} names a scenario`)
    for (const id of b.fails) assert.ok(scenarioIds.has(id), `${b.id} expects ${id}, which is not a scenario`)
  }
})

test('the controls change nothing that runs: no edit (C0, C2) or only a comment (C1), so the function behaves as it is', () => {
  const [c0, c1, c2] = ['C0', 'C1', 'C2'].map((id) => CONTROLS.find((c) => c.id === id))
  assert.deepEqual(c0.edits, [])
  assert.deepEqual(c2.edits, [])
  assert.equal(c2.noDefaults, true)
  assert.equal(withoutComments(applyBreak(install, c1)), withoutComments(install))
  assert.notEqual(applyBreak(install, c1), install)
})

test('the breaks cover every guard of the function: each `raise exception` of the migration is removed by one of them', () => {
  const raises = [...install.matchAll(/raise exception[^;]*;/g)].map((m) => m[0])
  assert.ok(raises.length >= 14, `${raises.length} raises`)
  const removed = new Set()
  for (const b of BREAKS) {
    for (const [from, to] of b.edits) {
      for (const r of raises) {
        // a break takes a raise out when its `from` holds the whole statement and its `to` doesn't
        if (from.includes(r) && !to.includes(r)) removed.add(r)
      }
    }
  }
  // the two raises that share their text ('patch sets a protected column') are two statements: both are removed by a break each
  for (const r of raises) assert.ok(removed.has(r), `no break removes ${r}`)
})

// ─── the scenarios ───────────────────────────────────────────────────────────────────────────────────────────────────

test('scenario ids are unique, each has a title and a body, and the fixture counts name the same tables the function can touch', () => {
  assert.equal(scenarioIds.size, SCENARIOS.length)
  for (const s of SCENARIOS) {
    assert.ok(s.title.length > 10, s.id)
    assert.ok(s.body.trim().length > 0, s.id)
    assert.match(s.id, /^[A-Z][0-9A-Za-z-]*$/, s.id)
  }
  for (const t of TABLES) assert.ok(t in FIXTURE_COUNTS, `${t} has a fixture row`)
  assert.equal(SCENARIOS[0].id, 'F00', 'the fixture check runs first')
})

test('the proof asks for every rule TASKS-1.2 chunk 47 lists: a scenario each for R3, the atomicity list, 142 and 143', () => {
  const text = (id) => SCENARIOS.find((s) => s.id === id)?.body ?? ''
  // 12 ops across six tables, applied, with the count
  const a01 = SCENARIOS.find((s) => s.id === 'A01')
  assert.ok(a01)
  assert.equal(a01.body.match(/"op":/g).length, 12)
  assert.equal(new Set([...a01.body.matchAll(/"table":"(v2_[a-z_]+)"/g)].map((m) => m[1])).size, 6)
  // a fifth op naming another user's row
  assert.match(text('A02'), /row not found: v2_program_exercises\/\{\{b_pe1\}\}/)
  // R3: a table not on the list, an insert into v2_programs, user_id and id in a patch, a foreign user_id, a foreign v2_programs row
  assert.match(text('T01'), /v2_set_logs/)
  assert.match(text('I01'), /insert not allowed on v2_programs/)
  assert.match(text('U01'), /patch sets a protected column/)
  assert.match(text('I02'), /user_id/)
  assert.match(text('U02'), /row not found: v2_programs/)
  assert.match(text('D01'), /\{\{a_ws2s\}\}/)
  // 142
  for (const id of ['W01', 'W02', 'W03', 'W04']) assert.ok(text(id), id)
  assert.match(text('W02'), /is_deload/)
  // 143
  assert.match(text('I08'), /replaces_program_exercise_id/)
  assert.match(text('D03'), /replaces_program_exercise_id is null/)
})

test('a scenario is one transaction that is rolled back: nothing it does survives it', () => {
  for (const s of SCENARIOS) {
    const sql = scenarioSql(s)
    assert.match(sql, /^\s*begin;/)
    assert.match(sql, /rollback;\s*$/)
    assert.equal(sql.includes('commit'), false, s.id)
  }
})

test('the script: pg-safeupdate is loaded and canaried first, the helpers name the function under test, the copy is installed before them', () => {
  const real = buildScript({ installText: null, scenarios: SCENARIOS })
  assert.ok(real.indexOf("load 'safeupdate';") < real.indexOf('create function pg_temp.zz_run'))
  assert.match(real, new RegExp(`n := ${REAL_FN.replace('.', '\\.')}\\(p_ops\\)`))
  assert.equal(real.includes(COPY_FN), false)
  const copy = buildScript({ installText: asCopy(install), scenarios: SCENARIOS })
  assert.ok(copy.indexOf('create or replace function pg_temp.zz_fn') < copy.indexOf('create function pg_temp.zz_run'))
  assert.match(copy, /n := pg_temp\.zz_fn\(p_ops\)/)
  assert.equal(real.match(/do \$s\$/g).length, SCENARIOS.length)
  assert.equal(helperSql(REAL_FN).includes('__FN__'), false)
})

test('parseResults reads PASS and FAIL lines (with a note, with | in the message), the canary, and the errors psql printed', () => {
  const out = [
    'psql:<stdin>:12: NOTICE:  CANARY|PASS',
    'psql:<stdin>:99: NOTICE:  RESULT|G01|PASS|',
    'psql:<stdin>:140: NOTICE:  RESULT|P01|PASS|2000 ops in 0.41 s',
    'psql:<stdin>:180: NOTICE:  RESULT|A02|FAIL|WRONG ERROR: wanted "a|b", got "c"',
    'psql:<stdin>:200: ERROR:  syntax error at or near "x"',
  ].join('\n')
  const { results, canary, errors } = parseResults(out)
  assert.equal(canary, true)
  assert.deepEqual(results.get('G01'), { ok: true, why: '' })
  assert.deepEqual(results.get('P01'), { ok: true, why: '2000 ops in 0.41 s' })
  assert.deepEqual(results.get('A02'), { ok: false, why: 'WRONG ERROR: wanted "a|b", got "c"' })
  assert.deepEqual(errors, ['ERROR:  syntax error at or near "x"'])
  assert.equal(parseResults('CANARY|FAIL|x').canary, false)
  assert.equal(parseResults('nothing').canary, null)
})

test('the fixture inserts one user\'s rows into the twelve tables and what hangs off them, as that user (auth.uid(), under RLS), with ids named for the user', () => {
  const sql = fixtureSql('a')
  for (const t of TABLES) assert.match(sql, new RegExp(`insert into ${t} `), t)
  assert.match(sql, /insert into v2_sessions/)
  assert.match(sql, /insert into v2_set_logs/)
  assert.equal(sql.includes('{{b_'), false)
  assert.ok(fixtureSql('b').includes('{{b_prog}}'))
})

// ─── the sweep ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('the generated sweep: mutants of every operator, each different from the function, none from the grants, ids unique', () => {
  const ms = mutants(install)
  assert.ok(ms.length >= 90, `${ms.length} mutants`)
  assert.equal(new Set(ms.map((m) => m.id)).size, ms.length)
  for (const op of ['raise', 'delete', 'not', 'always', 'and-or', 'flip']) assert.ok(ms.some((m) => m.op === op), op)
  for (const m of ms) {
    assert.notEqual(m.text, install, m.id)
    // the grants and the signature are untouched: a sweep mutates the body
    assert.ok(m.text.endsWith(install.slice(install.lastIndexOf('$fn$;'))), m.id)
    assert.ok(m.text.startsWith(install.slice(0, install.indexOf('as $fn$'))), m.id)
  }
  // every raise is mutated
  assert.equal(ms.filter((m) => m.op === 'raise').length, [...install.matchAll(/raise exception[^;]*;/g)].length)
})

// ─── the migration is what its header says ───────────────────────────────────────────────────────────────────────────

test('the migration touches no existing row: its statements are one ALTER TABLE ADD COLUMN, one CREATE FUNCTION, a REVOKE, a GRANT and NOTIFY - nothing else', () => {
  const statements = splitStatements(readFileSync(MIGRATION, 'utf8'))
  const expected = [
    /^alter table v2_program_exercises add column if not exists replaces_program_exercise_id uuid references v2_program_exercises\(id\) on delete set null$/i,
    /^create or replace function v2_apply_ops\(p_ops jsonb\) returns integer language plpgsql security invoker set search_path = public as \$fn\$/i,
    /^revoke execute on function v2_apply_ops\(jsonb\) from public, anon$/i,
    /^grant execute on function v2_apply_ops\(jsonb\) to authenticated$/i,
    /^notify pgrst, 'reload schema'$/i,
  ]
  assert.equal(statements.length, expected.length, statements.map((s) => s.slice(0, 50)).join(' | '))
  expected.forEach((re, i) => assert.match(statements[i], re, `statement ${i + 1}`))
  // outside the function's body (which only runs when called) there is no statement that could change a row or a column's type
  const outsideBody = statements.filter((s) => !/^create or replace function/i.test(s)).join('\n')
  assert.equal(/\b(update|delete|insert|truncate|drop|rename|type)\b/i.test(outsideBody.replace(/on delete set null/i, '')), false)
  // the one ALTER adds one nullable column, no default, no NOT NULL, no CHECK
  assert.equal(/not null|default|check/i.test(statements[0]), false)
})

test('every UPDATE and DELETE the function builds has a WHERE (pg-safeupdate refuses one that has none, and the replay does not load it)', () => {
  const dynamic = [...install.matchAll(/'(update public\.%I[^']*(?:'\s*'[^']*)*|delete from public\.%I[^']*)'/g)].map((m) => m[0])
  assert.equal(dynamic.length, 2)
  for (const d of dynamic) assert.match(d, /\bwhere\b/i)
})

test('probe-specs/043.json lists the one column the migration adds, on its table, and no new table', () => {
  const spec = JSON.parse(readFileSync('scripts/probe-specs/043.json', 'utf8'))
  assert.equal(spec.migration, '043_p12_apply_ops.sql')
  assert.deepEqual(spec.new, [])
  assert.deepEqual(spec.columns, { v2_program_exercises: ['replaces_program_exercise_id'] })
  const sql = readFileSync(MIGRATION, 'utf8')
  assert.ok(sql.includes('add column if not exists replaces_program_exercise_id uuid'))
})
