#!/usr/bin/env node
// plan-week-parity.mjs (chunk 42; chunk 53 runs it against migration 045)
//
// The executed comparison TASKS-1.2 asks for ("Checks that lied" #28: a parity claim needs an executed comparison,
// not a reading). It runs the migrations' own `v2_plan_week` on a replayed database, as a signed-in throwaway user,
// on the fixtures of scripts/plan-week-parity/fixture.sql, and runs `autoCopy` (src/features/plan/weekPlanning.ts)
// on the very rows the SQL read. Then it prints, row by row and side by side, what the SQL planned and what
// autoCopy says, and judges it:
//
//   --expect equal     (default; 045, chunk 53)  no difference at all, in any column of any row, on every fixture:
//                      a to k (the hand-built ones, F1-a / F1-b extended with a week off, a CHANGE THE PROGRAM save
//                      after the source week, the odd rows of DECISIONS 143, a sequence run, links that loop) and
//                      `--fuzz N`, which runs N random worlds (scenario z, seeds 1..N) and says which cases they reached.
//   --expect numbers   (041's body, the control: run it on a replay that stops at 044) the structure is identical in
//                      every row (exercises, order, set kinds, stages, set numbers, program-set links) and the two differ
//                      EXACTLY in the number columns the 1.2 rule drops: target_weight, target_rir, rep_min, rep_max,
//                      is_amrap on the week-dependent fixtures; target_weight and target_rir on the stable one; with
//                      `week_start = 'empty'` (a setting 1.2 removes) 041 plans an empty week where autoCopy copies; week 1
//                      is identical. "Exactly" runs both ways: a column that should differ and doesn't fails too. It
//                      covers a to e only: f to j need 143's rule, which 041 doesn't have.
//
// Usage:  bash scripts/replay-migrations.sh --keep      (Docker; start dockerd first)
//         node scripts/plan-week-parity.mjs [--expect equal|numbers] [--scenario a,b,c] [--fuzz N [--from K]] [--safeupdate] [--container NAME]
//         --safeupdate  loads pg-safeupdate (production has it, the replay doesn't) before each fixture, with a canary
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
  f: 'F1-f   week-dependent · week 4 after a week off: weeks 1 and 2 planned and different, week 3 never planned (DECISIONS 131)',
  g: 'F1-g   week-dependent · week 3 after a save that came after week 2: Face Pull removed, EZ-Bar Curl swapped for Hammer Curl, Cable Row added, a 1.1 week-only Dip in week 2 (DECISIONS 143)',
  h: 'F1-h   week-dependent · week 3 · the odd rows: a swap of a swap, two rows that replaced one, a live row the source lists, week-only rows, rows of another workout (one linked in)',
  i: 'F1-i   sequence run · cycle 3 slot 3 of a workout in slots 1 and 3, cycle 2 planned for slot 1 only: each slot copies its own history',
  j: 'F1-j   week-dependent · week 3 · replaces-links that loop (A and B replace each other, C replaces itself, X replaces A)',
  k: 'F1-k   week-dependent · week 3 with nothing usable to copy (week 1 a deload session, week 2 empty): an empty week',
  z: 'F1-z   a random world (--fuzz N: seeds 1..N)',
}

// The scenarios a plain run uses: z is only run by --fuzz.
export const HAND_BUILT = Object.keys(SCENARIOS).filter((s) => s !== 'z')

// 045's rule (identical everywhere), and today's 041 against autoCopy (the 1.2 rule) as the control. 041 has no
// expectation for f to j: its week branch copies the source week's own rows whatever the run copy says (143).
export const EXPECTATIONS = {
  numbers: {
    a: { kind: 'numbers', columns: ['is_amrap', 'rep_max', 'rep_min', 'target_rir', 'target_weight'] },
    b: { kind: 'numbers', columns: ['target_rir', 'target_weight'] },
    c: { kind: 'sql-empty' },
    d: { kind: 'numbers', columns: ['is_amrap', 'rep_max', 'rep_min', 'target_rir', 'target_weight'] },
    e: { kind: 'equal' },
  },
  equal: Object.fromEntries(Object.keys(SCENARIOS).map((s) => [s, { kind: 'equal' }])),
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

export function psql(container, args, input, role = 'postgres') {
  const r = spawnSync(
    'docker',
    ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-h', '127.0.0.1', '-U', role, '-d', 'postgres', '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', ...args],
    { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  return r
}

// --safeupdate: production runs pg-safeupdate, which rejects a DELETE or UPDATE with no WHERE clause, inside a function
// too, and the replay image doesn't load it (RULES.md: "A function is proven as the signed-in role, in a session that has
// pg-safeupdate loaded"). So the fixture connects as supabase_admin (the postgres role can't load it), loads it, and
// proves it is loaded with a bare UPDATE that must be refused (a canary), before the fixture signs in as `authenticated`.
export const SAFEUPDATE_PREFIX = `load 'safeupdate';
do $canary$
begin
  begin
    update auth.users set email = email;
  exception when others then
    if sqlerrm not like '%requires a WHERE clause%' then raise; end if;
    return;
  end;
  raise exception 'canary: pg-safeupdate did not refuse a bare UPDATE';
end
$canary$;
`

// The kept replay container (`replay-migrations.sh --keep`). With more than one running the answer would depend on which
// migrations each holds (041's body or 045's), so the script refuses to guess: `--container NAME` says which.
export function findContainer(explicit) {
  if (explicit) return { name: explicit }
  const r = spawnSync('docker', ['ps', '--filter', 'name=migration-replay', '--format', '{{.Names}}'], { encoding: 'utf8' })
  if (r.status !== 0) return { name: null }
  const names = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  if (names.length > 1) return { name: null, several: names }
  return { name: names[0] ?? null }
}

// An error's first line: psql's ERROR line when there is one (a fixture's stderr starts with NOTICEs and the node proxy
// warning, which say nothing about why it failed), else the first line that isn't noise.
export const FIRST_LINE = (s) => {
  const lines = String(s ?? '').split('\n').filter((l) => l.trim() && !l.includes('UNDICI') && !l.includes('trace-warnings'))
  return lines.find((l) => /\b(ERROR|FATAL):/.test(l)) ?? lines.find((l) => !/\bNOTICE:/.test(l)) ?? lines[0] ?? ''
}

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

// `argv` is process.argv. `--fuzz N` runs scenario z for seeds from..from+N-1 (default from 1) after the hand-built ones;
// with `--fuzz` and no `--scenario`, only z runs.
export function parseArgs(argv) {
  const opts = { expect: 'equal', scenarios: null, fuzz: 0, from: 1, container: null, safeupdate: false }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--expect') opts.expect = argv[++i]
    else if (a === '--scenario') opts.scenarios = String(argv[++i]).split(',')
    else if (a === '--fuzz') opts.fuzz = Number(argv[++i])
    else if (a === '--from') opts.from = Number(argv[++i])
    else if (a === '--container') opts.container = argv[++i]
    else if (a === '--safeupdate') opts.safeupdate = true
    else throw new Error(`unknown argument ${a}`)
  }
  if (!EXPECTATIONS[opts.expect]) throw new Error(`--expect takes equal or numbers (got ${opts.expect})`)
  if (!Number.isInteger(opts.fuzz) || opts.fuzz < 0) throw new Error('--fuzz takes a whole number of seeds')
  if (!Number.isInteger(opts.from) || opts.from < 1) throw new Error('--from takes a whole seed number from 1')
  if (opts.expect === 'numbers' && opts.fuzz > 0) throw new Error('--fuzz needs --expect equal: 041 has no expectation for a random world')
  // Without --scenario: every hand-built scenario the expectation covers; with --fuzz alone, none (z only).
  const covered = Object.keys(EXPECTATIONS[opts.expect]).filter((s) => s !== 'z')
  if (opts.scenarios === null) opts.scenarios = opts.fuzz > 0 ? [] : covered
  for (const s of opts.scenarios) {
    if (!SCENARIOS[s] || s === 'z') throw new Error(`unknown scenario ${s} (${HAND_BUILT.join(', ')}; z runs with --fuzz N)`)
    if (!EXPECTATIONS[opts.expect][s]) throw new Error(`--expect ${opts.expect} has no expectation for scenario ${s} (it covers ${covered.join(', ')})`)
  }
  return opts
}

// ─── What a random world reached ─────────────────────────────────────────────────────────────────────────────────
// A random world proves only the cases it holds, so each fuzz run counts how many of its worlds held each case the rule
// has a branch for, and fails when a case was reached in fewer than a floor of them (RULES.md: a walk's floor counts the
// cases of the rule under test). The cases are read from the fixture's rows and autoCopy's answer, not from the SQL:
//   kept         a live run-copy row the source week lists brings its sets
//   swapped      a live row the source week doesn't list took a removed row's sets through `replaces`
//   chain        the same through two or more links
//   rival        two live rows named the same listed row: one had the sets
//   added        a live row arrived with no sets
//   dropped      the source week listed a removed row nobody took the place of: it and its sets are gone
//   weekOnly     a week-only row the source week lists, not removed, came after the run copy's rows
//   weekOnlyGone a week-only row the run copy lists as removed was left out
//   ghost        a row of another workout the source week lists was kept
//   tie          two live rows with one position (the (position, id) order decided)
//   loop         a replaces-chain went round (it ended, the row arrived with no sets)
//   gap          the source week isn't the week before the target (a week off, a deload or an empty week in between)
//   emptyWeek    nothing usable to copy: the week came out empty
export const FUZZ_CASES = ['kept', 'swapped', 'chain', 'rival', 'added', 'dropped', 'weekOnly', 'weekOnlyGone', 'ghost', 'tie', 'loop', 'gap', 'emptyWeek']

export function coverageOf(fx, result) {
  const rows = new Map(fx.run_copy.exercises.map((e) => [e.id, e]))
  const live = fx.run_copy.exercises.filter((e) => !e.week_only && !e.removed_at)
  const out = Object.fromEntries(FUZZ_CASES.map((c) => [c, false]))
  if (result.source.kind === 'empty') {
    out.emptyWeek = true
    return out
  }
  if (result.source.kind !== 'week') return out
  const src = fx.prior_weeks.find((w) => w.week_number === result.source.weekNumber)
  if (!src) return out
  out.gap = result.source.weekNumber < fx.week_number - 1
  const listed = new Set(src.exercises.map((x) => x.program_exercise_id))
  const resultIds = new Set(result.exercises.map((x) => x.programExerciseId))
  const setsOf = new Map()
  for (const s of result.sets) setsOf.set(s.programExerciseId, (setsOf.get(s.programExerciseId) ?? 0) + 1)
  const positions = new Map()
  for (const e of live) positions.set(e.position, (positions.get(e.position) ?? 0) + 1)
  out.tie = [...positions.values()].some((n) => n > 1)
  // The chain of one live, unlisted row: the listed row it reaches (or null), the links walked, whether it went round.
  const walk = (e) => {
    const walked = new Set([e.id])
    let id = e.replaces_program_exercise_id ?? null
    let links = 0
    while (id !== null && !walked.has(id)) {
      links++
      if (listed.has(id)) return { reaches: id, links, looped: false }
      walked.add(id)
      id = rows.get(id)?.replaces_program_exercise_id ?? null
    }
    return { reaches: null, links, looped: id !== null }
  }
  const reachedBy = new Map()
  for (const e of live.filter((x) => !listed.has(x.id))) {
    const w = walk(e)
    if (w.looped) out.loop = true
    if (w.reaches !== null) {
      reachedBy.set(w.reaches, (reachedBy.get(w.reaches) ?? 0) + 1)
      if (w.links >= 2 && (setsOf.get(e.id) ?? 0) > 0) out.chain = true
    }
  }
  out.rival = [...reachedBy.values()].some((n) => n > 1)
  for (const e of live) {
    if (listed.has(e.id) && (setsOf.get(e.id) ?? 0) > 0) out.kept = true
    if (!listed.has(e.id) && resultIds.has(e.id)) {
      if ((setsOf.get(e.id) ?? 0) === 0) out.added = true
      else out.swapped = true
    }
  }
  for (const id of listed) {
    const row = rows.get(id)
    // gone with its sets: a removed row nobody took the place of (a swapped-out row's sets went to the row that replaced it)
    if (row?.removed_at && !resultIds.has(id) && !reachedBy.has(id)) {
      if (row.week_only) out.weekOnlyGone = true
      else out.dropped = true
    }
    if (row && row.week_only && !row.removed_at && resultIds.has(id)) out.weekOnly = true
    if (!row && resultIds.has(id)) out.ghost = true
  }
  return out
}

// The floor each case must reach over a fuzz run of `seeds` worlds: 4 % of them, and never fewer than 3 (a run of fewer
// than 25 seeds proves little and is told so rather than judged).
export function fuzzFloor(seeds) {
  return Math.max(3, Math.ceil(seeds * 0.04))
}

function runFixture(container, fixtureSql, scenario, seed, safeupdate = false) {
  const r = safeupdate
    ? psql(container, ['-v', `scenario=${scenario}`, '-v', `seed=${seed}`, '-f', '-'], SAFEUPDATE_PREFIX + fixtureSql, 'supabase_admin')
    : psql(container, ['-v', `scenario=${scenario}`, '-v', `seed=${seed}`, '-f', '-'], fixtureSql)
  const line = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop()
  if (r.status !== 0 || !line || !line.startsWith('{')) return { error: FIRST_LINE(r.stderr) || 'no output' }
  return { fx: JSON.parse(line) }
}

// What the fixture checked after planning (besides the rows): the call planned one slot per slot of the workout (two on
// the sequence run), a second call planned none and left the week's rows as they were (their ids and md5), and a stranger
// and a call with nobody signed in were refused and planned nothing. Returns the problems, [] when there are none.
export function afterChecks(fx) {
  const problems = []
  const slots = fx.slot == null ? 1 : 2
  if (fx.planned !== slots) problems.push(`the call planned ${fx.planned} slot(s), expected ${slots}`)
  if (fx.second_call !== 0) problems.push(`a second call planned ${fx.second_call} slot(s), expected 0 (idempotent)`)
  if (!fx.md5_before || fx.md5_before !== fx.md5_after) problems.push(`the week's rows changed on the second call (md5 ${fx.md5_before} → ${fx.md5_after})`)
  if (!/not found for user/.test(fx.stranger ?? '')) problems.push(`a stranger was not told the run doesn't exist: ${fx.stranger}`)
  if (!/no authenticated user/.test(fx.anonymous ?? '')) problems.push(`a call with nobody signed in was not refused: ${fx.anonymous}`)
  if (fx.plans_before_refusals !== fx.plans_after_refusals) problems.push(`a refused call planned something (${fx.plans_before_refusals} → ${fx.plans_after_refusals} plan rows)`)
  return problems
}

function compareFixture(mod, fx) {
  const names = new Map(fx.run_copy.exercises.map((e) => [e.id, e.exercise_name]))
  const positions = new Map(fx.run_copy.exercises.map((e) => [e.id, e.position]))
  const result = mod.autoCopy(toAutoCopyInput(fx))
  const cmp = compareWeeks({
    sqlExercises: fx.output.exercises.map((x) => ({ programExerciseId: x.program_exercise_id, position: x.position })),
    tsExercises: result.exercises,
    sql: sqlRows(fx.output, names, positions),
    ts: tsRows(result, names, positions),
  })
  return { result, cmp }
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

  console.log(`plan-week-parity: container ${container} · expecting ${opts.expect === 'numbers' ? "041's rule (numbers differ)" : "045's rule (identical)"}${opts.safeupdate ? ' · as supabase_admin with pg-safeupdate loaded (canary: a bare UPDATE is refused)' : ''}`)
  const before = rowCounts(container)
  let failed = 0
  for (const sc of opts.scenarios) {
    const ran = runFixture(container, fixtureSql, sc, 0, opts.safeupdate)
    if (ran.error) {
      console.error(`plan-week-parity: fixture ${sc} failed: ${ran.error}`)
      return 2
    }
    const { fx } = ran
    const { result, cmp } = compareFixture(mod, fx)
    const verdict = judge(cmp, EXPECTATIONS[opts.expect][sc])
    // The idempotency and refusal checks hold for both rules; 041 passes them too.
    const problems = afterChecks(fx)
    if (problems.length > 0) {
      verdict.ok = false
      verdict.why = `${verdict.why} · ${problems.join(' · ')}`
    }
    console.log(`\n${SCENARIOS[sc]}`)
    console.log(`  v2_plan_week planned ${fx.planned} slot${fx.planned === 1 ? '' : 's'} · autoCopy chose ${JSON.stringify(result.source)} · rows: SQL ${cmp.sqlCount}, autoCopy ${cmp.tsCount} · exercises: SQL ${cmp.exercises.sql.length}, autoCopy ${cmp.exercises.ts.length}`)
    console.log(formatTable(cmp))
    console.log(`  ${verdict.ok ? 'OK  ' : 'FAIL'} ${verdict.why}`)
    if (!verdict.ok) failed++
  }

  if (opts.fuzz > 0) {
    const reached = Object.fromEntries(FUZZ_CASES.map((c) => [c, 0]))
    let rowsCompared = 0
    let fuzzFailed = 0
    const last = opts.from + opts.fuzz - 1
    console.log(`\n${SCENARIOS.z} · seeds ${opts.from}..${last}`)
    for (let seed = opts.from; seed <= last; seed++) {
      const ran = runFixture(container, fixtureSql, 'z', seed, opts.safeupdate)
      if (ran.error) {
        console.error(`plan-week-parity: fixture z (seed ${seed}) failed: ${ran.error}`)
        return 2
      }
      const { fx } = ran
      const { result, cmp } = compareFixture(mod, fx)
      const verdict = judge(cmp, EXPECTATIONS.equal.z)
      const problems = afterChecks(fx)
      if (problems.length > 0) {
        verdict.ok = false
        verdict.why = `${verdict.why} · ${problems.join(' · ')}`
      }
      rowsCompared += cmp.sqlCount + cmp.tsCount
      for (const [c, hit] of Object.entries(coverageOf(fx, result))) if (hit) reached[c]++
      if (!verdict.ok) {
        fuzzFailed++
        console.log(`  FAIL seed ${seed}: ${verdict.why}`)
        if (fuzzFailed <= 3) console.log(formatTable(cmp))
      }
    }
    const floor = fuzzFloor(opts.fuzz)
    console.log(`  ${opts.fuzz - fuzzFailed} of ${opts.fuzz} worlds identical in every column of every row (${rowsCompared} rows compared, SQL and autoCopy together)`)
    console.log(`  cases reached (worlds out of ${opts.fuzz}): ${FUZZ_CASES.map((c) => `${c} ${reached[c]}`).join(' · ')}`)
    if (fuzzFailed > 0) failed++
    if (opts.fuzz < 25) {
      console.log('  NOTE fewer than 25 worlds: the cases reached are counted but not judged')
    } else {
      const missed = FUZZ_CASES.filter((c) => reached[c] < floor)
      console.log(`  ${missed.length === 0 ? 'OK  ' : 'FAIL'} every case reached in at least ${floor} worlds${missed.length ? `; short: ${missed.join(', ')}` : ''}`)
      if (missed.length > 0) failed++
    }
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
