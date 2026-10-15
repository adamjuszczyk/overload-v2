#!/usr/bin/env node
// plan-week-parity.mjs (chunk 42; chunk 53 reuses it against migration 044)
//
// The executed comparison TASKS-1.2 asks for ("Checks that lied" #28: a parity claim needs an executed comparison,
// not a reading). It runs the migrations' own `v2_plan_week` on a replayed database, as a signed-in throwaway user,
// on five fixtures (scripts/plan-week-parity/fixture.sql), and runs `autoCopy` (src/features/plan/weekPlanning.ts)
// on the very rows the SQL read. Then it prints, row by row and side by side, what the SQL planned and what
// autoCopy says, and judges it:
//
//   --expect numbers   (default; today's 041)  the structure is identical in every row (exercises, order, set kinds,
//                      stages, set numbers, program-set links) and the two differ EXACTLY in the number columns the
//                      1.2 rule drops: target_weight, target_rir, rep_min, rep_max, is_amrap on the week-dependent
//                      fixtures; target_weight and target_rir on the stable one; with `week_start = 'empty'` (a
//                      setting 1.2 removes) 041 plans an empty week where autoCopy copies; week 1 is identical.
//                      "Exactly" runs both ways: a column that should differ and doesn't fails too.
//   --expect equal     (044, chunk 53)           no difference at all, in any column of any row, on every fixture.
//
// Usage:  bash scripts/replay-migrations.sh --keep      (Docker; start dockerd first)
//         node scripts/plan-week-parity.mjs [--expect numbers|equal] [--scenario a,b,c,d,e] [--container NAME]
//         (--container is needed only when more than one kept replay container is running)
// Exit:   0 every fixture met the expectation · 1 one did not · 2 couldn't run (no Docker, no kept container, …).
//
// Nothing is written: every fixture runs in one transaction that is rolled back, and the script counts the rows of
// the tables it touched before and after. The app's TypeScript is loaded through Vite's SSR loader (no build).

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const FIXTURE_SQL = path.join(HERE, 'plan-week-parity', 'fixture.sql')

// What a new week's set row carries that is a NUMBER (a week-dependent copy drops all of them; so does a stable one,
// but its rep targets, which come from the default, stay).
export const NUMBER_COLUMNS = ['target_weight', 'target_rir', 'target_rir_max', 'rep_min', 'rep_max', 'is_amrap', 'tags']
// What a set row carries that is STRUCTURE: the same in the SQL's week and autoCopy's, whatever the migration.
export const STRUCTURE_COLUMNS = ['is_dropset', 'is_warmup', 'stage_kind', 'program_set_id', 'parent']

export const SCENARIOS = {
  a: 'F1-a   week-dependent · week 2 planned from week 1',
  b: 'F1-b   stable · week 2 planned from the run copy (a removed set, a week-only exercise and a removed exercise in it)',
  c: 'F1-c   week-dependent · week 2 · the user\'s week_start setting is "empty"',
  d: 'F1-d   week-dependent · week 4 · week 2 a deload session of another shape, week 3 an empty week',
  e: 'F1-e   week-dependent · week 1 (starts from the program)',
}

// Today's 041 against autoCopy (the 1.2 rule), then 044's.
export const EXPECTATIONS = {
  numbers: {
    a: { kind: 'numbers', columns: ['is_amrap', 'rep_max', 'rep_min', 'target_rir', 'target_weight'] },
    b: { kind: 'numbers', columns: ['target_rir', 'target_weight'] },
    c: { kind: 'sql-empty' },
    d: { kind: 'numbers', columns: ['is_amrap', 'rep_max', 'rep_min', 'target_rir', 'target_weight'] },
    e: { kind: 'equal' },
  },
  equal: { a: { kind: 'equal' }, b: { kind: 'equal' }, c: { kind: 'equal' }, d: { kind: 'equal' }, e: { kind: 'equal' } },
}

// ─── JSON rows → what autoCopy reads, and what it returns → comparable rows ─────────────────────────────────────

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
export const camelRow = (row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]))

// Every column of every row is passed in, numbers included: autoCopy reads the few it needs, so a copy that wrongly
// read a weight would copy it and the comparison would notice.
export function toAutoCopyInput(fx) {
  return {
    planningType: fx.planning_type,
    weekNumber: fx.week_number,
    runCopy: {
      exercises: fx.run_copy.exercises.map((e) => ({ ...camelRow(e), exercise: { name: e.exercise_name } })),
      sets: fx.run_copy.sets.map(camelRow),
    },
    priorWeeks: fx.prior_weeks.map((w) => ({
      weekNumber: w.week_number,
      isDeload: w.is_deload,
      exercises: w.exercises.map((x) => ({ ...camelRow(x), id: x.program_exercise_id })),
      sets: w.sets.map(camelRow),
    })),
  }
}

const labelOf = (names, exId, kind, setNumber, stageIndex, isWarmup) => {
  const name = names.get(exId) ?? exId.slice(0, 8)
  if (kind === 'stage') return `${name} · ${setNumber}.${stageIndex} (stage)`
  return `${name} · ${isWarmup ? `W${setNumber}` : String(setNumber).padStart(2, '0')}`
}

// A row's identity across the two sides: its exercise row, head or stage, set number and stage index. Two rows that
// share it (it should not happen) are told apart by their order.
function keyed(rows) {
  const seen = new Map()
  return rows.map((r) => {
    const base = `${r.programExerciseId}|${r.stage ? 'stage' : 'head'}|${r.setNumber}|${r.stageIndex}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { ...r, key: n === 1 ? base : `${base}#${n}` }
  })
}

// The SQL's week as comparable rows. `parent` is the parent row's key, not its (new) id.
export function sqlRows(output, names, positions = new Map()) {
  const base = output.sets.map((s) => ({
    id: s.id,
    programExerciseId: s.program_exercise_id,
    setNumber: s.set_number,
    stageIndex: s.stage_index,
    stage: s.parent_week_plan_set_id != null,
    parentId: s.parent_week_plan_set_id,
    is_dropset: s.is_dropset,
    is_warmup: s.is_warmup,
    stage_kind: s.stage_kind ?? null,
    program_set_id: s.program_set_id ?? null,
    target_weight: s.target_weight ?? null,
    target_rir: s.target_rir ?? null,
    target_rir_max: s.target_rir_max ?? null,
    rep_min: s.rep_min ?? null,
    rep_max: s.rep_max ?? null,
    is_amrap: s.is_amrap,
    tags: s.tags ?? null,
  }))
  const rows = keyed(base)
  const keyById = new Map(rows.map((r) => [r.id, r.key]))
  return rows.map((r) => ({
    ...r,
    parent: r.parentId == null ? null : (keyById.get(r.parentId) ?? `?${r.parentId}`),
    exercisePosition: positions.get(r.programExerciseId) ?? 0,
    label: labelOf(names, r.programExerciseId, r.stage ? 'stage' : 'head', r.setNumber, r.stageIndex, r.is_warmup),
  }))
}

// autoCopy's week as comparable rows, the same shape.
export function tsRows(result, names, positions = new Map()) {
  const base = result.sets.map((s) => ({
    id: s.sourceId,
    programExerciseId: s.programExerciseId,
    setNumber: s.setNumber,
    stageIndex: s.stageIndex,
    stage: s.parentSourceId != null,
    parentId: s.parentSourceId,
    is_dropset: s.isDropset,
    is_warmup: s.isWarmup,
    stage_kind: s.stageKind ?? null,
    program_set_id: s.programSetId ?? null,
    target_weight: s.targetWeight ?? null,
    target_rir: s.targetRir ?? null,
    target_rir_max: s.targetRirMax ?? null,
    rep_min: s.repMin ?? null,
    rep_max: s.repMax ?? null,
    is_amrap: s.isAmrap,
    tags: s.tags ?? null,
  }))
  const rows = keyed(base)
  const keyById = new Map(rows.map((r) => [r.id, r.key]))
  return rows.map((r) => ({
    ...r,
    parent: r.parentId == null ? null : (keyById.get(r.parentId) ?? `?${r.parentId}`),
    exercisePosition: positions.get(r.programExerciseId) ?? 0,
    label: labelOf(names, r.programExerciseId, r.stage ? 'stage' : 'head', r.setNumber, r.stageIndex, r.is_warmup),
  }))
}

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

// ─── The comparison ─────────────────────────────────────────────────────────────────────────────────────────────

// sql, ts: the rows above; sqlExercises / tsExercises: [{ programExerciseId, position }].
export function compareWeeks({ sqlExercises, tsExercises, sql, ts }) {
  const norm = (list) => list.map((e) => `${e.programExerciseId}@${e.position}`).sort()
  const exercises = { sql: norm(sqlExercises), ts: norm(tsExercises) }
  const exercisesEqual = same(exercises.sql, exercises.ts)

  const tsByKey = new Map(ts.map((r) => [r.key, r]))
  const sqlByKey = new Map(sql.map((r) => [r.key, r]))
  const rows = []
  const structureDiffs = []
  const numberDiffs = []
  for (const s of sql) {
    const t = tsByKey.get(s.key)
    if (!t) {
      rows.push({ key: s.key, label: s.label, sql: s, ts: null })
      continue
    }
    const row = { key: s.key, label: s.label, sql: s, ts: t, structure: [], numbers: [] }
    for (const col of STRUCTURE_COLUMNS) {
      if (!same(s[col], t[col])) {
        row.structure.push(col)
        structureDiffs.push({ key: s.key, label: s.label, column: col, sql: s[col], ts: t[col] })
      }
    }
    for (const col of NUMBER_COLUMNS) {
      if (!same(s[col], t[col])) {
        row.numbers.push(col)
        numberDiffs.push({ key: s.key, label: s.label, column: col, sql: s[col], ts: t[col] })
      }
    }
    rows.push(row)
  }
  for (const t of ts) if (!sqlByKey.has(t.key)) rows.push({ key: t.key, label: t.label, sql: null, ts: t })
  // Reading order: by exercise (its position), then set number, a stage right after its head.
  const at = (r) => r.sql ?? r.ts
  rows.sort(
    (a, b) =>
      (at(a).exercisePosition ?? 0) - (at(b).exercisePosition ?? 0) ||
      String(at(a).programExerciseId).localeCompare(String(at(b).programExerciseId)) ||
      at(a).setNumber - at(b).setNumber ||
      Number(at(a).stage) - Number(at(b).stage) ||
      at(a).stageIndex - at(b).stageIndex,
  )

  const missingInTs = rows.filter((r) => r.ts === null).map((r) => r.label)
  const extraInTs = rows.filter((r) => r.sql === null).map((r) => r.label)
  const structureOk = exercisesEqual && missingInTs.length === 0 && extraInTs.length === 0 && structureDiffs.length === 0
  const differingNumberColumns = [...new Set(numberDiffs.map((d) => d.column))].sort()
  return { rows, exercises, exercisesEqual, structureDiffs, numberDiffs, missingInTs, extraInTs, structureOk, differingNumberColumns, sqlCount: sql.length, tsCount: ts.length }
}

// The verdict against an expectation: { kind: 'equal' } | { kind: 'numbers', columns } | { kind: 'sql-empty' }.
export function judge(cmp, expectation) {
  if (expectation.kind === 'equal') {
    const ok = cmp.structureOk && cmp.numberDiffs.length === 0
    return { ok, why: ok ? 'identical in every column of every row' : describe(cmp) }
  }
  if (expectation.kind === 'sql-empty') {
    const ok = cmp.sqlCount === 0 && cmp.tsCount > 0 && cmp.exercises.sql.length === 0 && cmp.exercises.ts.length > 0
    return { ok, why: ok ? `041 planned an empty week (week_start 'empty'); autoCopy copies ${cmp.tsCount} sets: the setting is gone in 1.2` : describe(cmp) }
  }
  const wanted = [...expectation.columns].sort()
  const ok = cmp.structureOk && same(cmp.differingNumberColumns, wanted)
  if (ok) return { ok, why: `structure identical; differs exactly in ${wanted.join(', ')}` }
  const why = [describe(cmp), `expected the number columns to differ exactly in [${wanted.join(', ')}]`].join(' · ')
  return { ok, why }
}

function describe(cmp) {
  const parts = []
  if (!cmp.exercisesEqual) parts.push(`exercise lists differ (SQL ${cmp.exercises.sql.length}, TS ${cmp.exercises.ts.length})`)
  if (cmp.missingInTs.length) parts.push(`rows only the SQL has: ${cmp.missingInTs.join(', ')}`)
  if (cmp.extraInTs.length) parts.push(`rows only autoCopy has: ${cmp.extraInTs.join(', ')}`)
  if (cmp.structureDiffs.length) parts.push(`structure differs: ${[...new Set(cmp.structureDiffs.map((d) => d.column))].join(', ')}`)
  parts.push(`number columns that differ: [${cmp.differingNumberColumns.join(', ')}]`)
  return parts.join(' · ')
}

// ─── Printing: one line per row, the SQL's value and autoCopy's side by side ─────────────────────────────────────

const cell = (v) => (v === null || v === undefined ? '·' : Array.isArray(v) ? `{${v.join(',')}}` : v === true ? 'T' : v === false ? 'F' : String(v))
const pair = (s, t) => (same(s, t) ? cell(s) : `${cell(s)}→${cell(t)}`)
const SHORT = { target_weight: 'weight', target_rir: 'rir', target_rir_max: 'rir_max', rep_min: 'rep_min', rep_max: 'rep_max', is_amrap: 'amrap', tags: 'tags' }

export function formatTable(cmp) {
  const header = ['row', ...NUMBER_COLUMNS.map((c) => `${SHORT[c]} (SQL→TS)`), 'structure']
  const lines = [header]
  for (const r of cmp.rows) {
    if (!r.ts) {
      lines.push([r.label, ...NUMBER_COLUMNS.map(() => ''), 'ONLY IN SQL'])
    } else if (!r.sql) {
      lines.push([r.label, ...NUMBER_COLUMNS.map(() => ''), 'ONLY IN autoCopy'])
    } else {
      lines.push([r.label, ...NUMBER_COLUMNS.map((c) => pair(r.sql[c], r.ts[c])), r.structure.length ? `DIFFERS: ${r.structure.join(', ')}` : '='])
    }
  }
  const widths = header.map((_, i) => Math.max(...lines.map((l) => l[i].length)))
  return lines.map((l) => '  ' + l.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd()).join('\n')
}

// ─── Running it ─────────────────────────────────────────────────────────────────────────────────────────────────

function psql(container, args, input) {
  const r = spawnSync(
    'docker',
    ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', ...args],
    { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return r
}

// The kept replay container (`replay-migrations.sh --keep`). With more than one running the answer would depend on which
// migrations each holds (041's body or 044's), so the script refuses to guess: `--container NAME` says which.
function findContainer(explicit) {
  if (explicit) return { name: explicit }
  const r = spawnSync('docker', ['ps', '--filter', 'name=migration-replay', '--format', '{{.Names}}'], { encoding: 'utf8' })
  if (r.status !== 0) return { name: null }
  const names = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  if (names.length > 1) return { name: null, several: names }
  return { name: names[0] ?? null }
}

const FIRST_LINE = (s) => String(s ?? '').split('\n').find((l) => l.trim() && !l.includes('UNDICI')) ?? ''

// The tables a fixture writes to. Their row counts before and after the run must match: the fixtures roll back.
const COUNTED_TABLES = [
  'auth.users', 'exercises', 'v2_user_settings', 'v2_programs', 'v2_workout_days', 'v2_program_exercises', 'v2_program_sets',
  'v2_mesocycles', 'v2_week_plans', 'v2_week_plan_exercises', 'v2_week_plan_sets',
]

function rowCounts(container) {
  const sql = 'select ' + COUNTED_TABLES.map((t) => `(select count(*) from ${t})`).join(" || '/' || ")
  const r = psql(container, ['-c', sql])
  return r.status === 0 ? r.stdout.trim() : null
}

async function loadWeekPlanning() {
  const { createServer } = await import('vite')
  const server = await createServer({
    root: REPO,
    configFile: false,
    appType: 'custom',
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  try {
    return await server.ssrLoadModule('/src/features/plan/weekPlanning.ts')
  } finally {
    await server.close()
  }
}

function parseArgs(argv) {
  const opts = { expect: 'numbers', scenarios: Object.keys(SCENARIOS), container: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--expect') opts.expect = argv[++i]
    else if (a === '--scenario') opts.scenarios = String(argv[++i]).split(',')
    else if (a === '--container') opts.container = argv[++i]
    else throw new Error(`unknown argument ${a}`)
  }
  if (!EXPECTATIONS[opts.expect]) throw new Error(`--expect takes numbers or equal (got ${opts.expect})`)
  for (const s of opts.scenarios) if (!SCENARIOS[s]) throw new Error(`unknown scenario ${s} (a, b, c, d, e)`)
  return opts
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv)
  } catch (e) {
    console.error(`plan-week-parity: ${e.message}`)
    return 2
  }
  const found = findContainer(opts.container)
  if (found.several) {
    console.error(`plan-week-parity: several replay containers are running (${found.several.join(', ')}); pass --container NAME for the one to test`)
    return 2
  }
  const container = found.name
  if (!container) {
    console.error('plan-week-parity: no running migration-replay container. Start dockerd, then: bash scripts/replay-migrations.sh --keep')
    return 2
  }
  const probe = psql(container, ['-c', "select to_regprocedure('v2_plan_week(uuid,integer)') is not null"])
  if (probe.status !== 0 || probe.stdout.trim() !== 't') {
    console.error(`plan-week-parity: ${container} has no v2_plan_week (${FIRST_LINE(probe.stderr)})`)
    return 2
  }
  const fixtureSql = readFileSync(FIXTURE_SQL, 'utf8')
  let mod
  try {
    mod = await loadWeekPlanning()
  } catch (e) {
    console.error(`plan-week-parity: couldn't load weekPlanning.ts: ${FIRST_LINE(e?.message)}`)
    return 2
  }

  console.log(`plan-week-parity: container ${container} · expecting ${opts.expect === 'numbers' ? "041's rule (numbers differ)" : "044's rule (identical)"}`)
  const before = rowCounts(container)
  let failed = 0
  for (const sc of opts.scenarios) {
    const r = psql(container, ['-v', `scenario=${sc}`, '-f', '-'], fixtureSql)
    const line = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop()
    if (r.status !== 0 || !line || !line.startsWith('{')) {
      console.error(`plan-week-parity: fixture ${sc} failed: ${FIRST_LINE(r.stderr)}`)
      return 2
    }
    const fx = JSON.parse(line)
    const names = new Map(fx.run_copy.exercises.map((e) => [e.id, e.exercise_name]))
    const positions = new Map(fx.run_copy.exercises.map((e) => [e.id, e.position]))
    const result = mod.autoCopy(toAutoCopyInput(fx))
    const cmp = compareWeeks({
      sqlExercises: fx.output.exercises.map((x) => ({ programExerciseId: x.program_exercise_id, position: x.position })),
      tsExercises: result.exercises,
      sql: sqlRows(fx.output, names, positions),
      ts: tsRows(result, names, positions),
    })
    const verdict = judge(cmp, EXPECTATIONS[opts.expect][sc])
    console.log(`\n${SCENARIOS[sc]}`)
    console.log(`  v2_plan_week planned ${fx.planned} slot · autoCopy chose ${JSON.stringify(result.source)} · rows: SQL ${cmp.sqlCount}, autoCopy ${cmp.tsCount} · exercises: SQL ${cmp.exercises.sql.length}, autoCopy ${cmp.exercises.ts.length}`)
    console.log(formatTable(cmp))
    console.log(`  ${verdict.ok ? 'OK  ' : 'FAIL'} ${verdict.why}`)
    if (!verdict.ok) failed++
  }
  const after = rowCounts(container)
  const clean = before !== null && before === after
  console.log(`\nplan-week-parity: fixtures left no rows behind (${COUNTED_TABLES.length} tables counted before and after: ${before} → ${after}): ${clean ? 'ok' : 'NOT CLEAN'}`)
  if (!clean) failed++
  console.log(`plan-week-parity: ${failed === 0 ? 'every fixture met the expectation' : `${failed} did not`}`)
  return failed === 0 ? 0 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`plan-week-parity: ${FIRST_LINE(e?.message)}`)
      process.exit(2)
    },
  )
}
