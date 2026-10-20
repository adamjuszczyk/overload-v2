#!/usr/bin/env node
// rehearse-046.mjs (chunk 53) — the proof and the rehearsal of migration 046, 149's release data migration
// (DECISIONS 149 (c), 196: "makes each active week-dependent run's program match its last planned week (exercises and
// order), so nothing the user sees changes"). 046 changes existing rows, so it gets more than the add-only proof.
//
//   --replay    (Docker; `bash scripts/replay-migrations.sh --keep` first, with 046 in supabase/migrations)
//               Builds 1.1-shaped worlds on the replayed database (scripts/rehearse-046/world.sql: the week view's SWAP,
//               ADD, REMOVE and REORDER and the program tab's REMOVE, written the way 1.1 wrote them, each week planned by
//               041's own `v2_plan_week`), runs the REAL migration file on each, twice, and judges:
//                 1 the rows it changed are exactly the rows `plan046` (this file, written from the rule, not from the SQL)
//                   says it changes: only v2_program_exercises' week_only, removed_at and position, and nothing else;
//                 2 a second run changes nothing;
//                 3 the counts of the ten tables around it, and a hash of every column it must not write, are equal
//                   before, after and after a second run (completed runs, saved programs, another user's stable run included);
//                 4 NOTHING THE USER SEES CHANGES: the next week planned by 045 after 046 holds the same exercises, at the
//                   same positions, with the same sets (structure), as the next week planned by 041 before it.
//               Worlds: noop, canon, seq, and `--worlds N` random ones (rand), which must reach every case below.
//   --staging   (read only) as a signed-in staging account, over the REST API, the same counts and hashes, and what 046
//               WOULD change on that account's rows. `--out FILE` saves them; `--compare FILE` (after the merge) lists the
//               rows that changed since FILE, and passes only when they are exactly what `plan046` said from FILE.
//               This is the before/after of the staging rehearsal. It writes nothing and prints no secret.
//
// Usage:  node scripts/rehearse-046.mjs --replay [--worlds 120] [--container NAME] [--migration PATH]
//         node scripts/rehearse-046.mjs --staging [--account EMAIL] [--out FILE | --compare FILE]
// Exit:   0 every check passed · 1 one failed · 2 couldn't run.
//
// Nothing is kept: every replay world runs in one transaction that is rolled back.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { FIRST_LINE, findContainer, psql } from './plan-week-parity.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const WORLD_SQL = path.join(HERE, 'rehearse-046', 'world.sql')
const COLUMNS = ['week_only', 'removed', 'position']

// ─── The rule, written from DECISIONS 149 (c) and the migration's header, not from its SQL ───────────────────────────
// `snap` is what world.sql's rh_snapshot() prints (and what --staging reads over the API): mesocycles, programs,
// workout_days, program_exercises {id, workout_day_id, position, week_only, removed}, week_plans {..., is_deload, n_sets},
// week_plan_exercises {week_plan_id, program_exercise_id, position}.
// Returns the changes (one per column of a row) and the workouts it matched, each with the week it matched.
export function plan046(snap) {
  const programs = new Map(snap.programs.map((p) => [p.id, p]))
  const exercisesOfWeek = new Map()
  for (const x of snap.week_plan_exercises) {
    if (!exercisesOfWeek.has(x.week_plan_id)) exercisesOfWeek.set(x.week_plan_id, [])
    exercisesOfWeek.get(x.week_plan_id).push(x)
  }
  const rowsOf = new Map()
  for (const pe of snap.program_exercises) {
    if (!rowsOf.has(pe.workout_day_id)) rowsOf.set(pe.workout_day_id, [])
    rowsOf.get(pe.workout_day_id).push(pe)
  }
  const changes = []
  const workouts = []
  for (const m of snap.mesocycles) {
    const p = programs.get(m.program_id)
    if (m.status !== 'active' || !p || p.kind !== 'run' || p.planning_type !== 'week_dependent') continue
    for (const wd of snap.workout_days.filter((w) => w.program_id === p.id)) {
      // its last planned week: the latest that is not a deload session and has a set; across slots the latest cycle, then the later slot
      const weeks = snap.week_plans
        .filter((w) => w.mesocycle_id === m.id && w.workout_day_id === wd.id && !w.is_deload && w.n_sets > 0)
        .sort((a, b) => b.week_number - a.week_number || (b.sequence_position ?? -Infinity) - (a.sequence_position ?? -Infinity) || (a.id < b.id ? -1 : 1))
      const last = weeks[0]
      if (!last) continue
      workouts.push({ workout_day_id: wd.id, sequence_position: last.sequence_position, week_number: last.week_number, week_plan_id: last.id })
      const rows = rowsOf.get(wd.id) ?? []
      const own = new Set(rows.map((r) => r.id))
      const listed = new Map()
      for (const x of exercisesOfWeek.get(last.id) ?? []) if (own.has(x.program_exercise_id)) listed.set(x.program_exercise_id, x)
      for (const r of rows) {
        const l = listed.get(r.id)
        if (l) {
          if (r.week_only) changes.push({ id: r.id, column: 'week_only', from: true, to: false })
          if (r.removed) changes.push({ id: r.id, column: 'removed', from: true, to: false })
          if (r.position !== l.position) changes.push({ id: r.id, column: 'position', from: r.position, to: l.position })
        } else if (!r.week_only && !r.removed) {
          changes.push({ id: r.id, column: 'removed', from: false, to: true })
        }
      }
    }
  }
  const order = (c) => `${c.id}|${c.column}`
  changes.sort((a, b) => (order(a) < order(b) ? -1 : 1))
  return { changes, workouts }
}

// What changed between two snapshots' program-exercise rows: [{ id, column, from, to }], plus any row that appeared or vanished.
export function diffRows(before, after) {
  const a = new Map(before.program_exercises.map((r) => [r.id, r]))
  const b = new Map(after.program_exercises.map((r) => [r.id, r]))
  const changes = []
  const gone = []
  const added = []
  for (const [id, r] of a) {
    const s = b.get(id)
    if (!s) {
      gone.push(id)
      continue
    }
    for (const c of COLUMNS) if (r[c] !== s[c]) changes.push({ id, column: c, from: r[c], to: s[c] })
    // a row that was removed and still is, with another stamp: rewritten, which nothing in the rule says (the booleans agree)
    if (r.removed && s.removed && r.removed_at != null && r.removed_at !== s.removed_at) changes.push({ id, column: 'removed_at', from: r.removed_at, to: s.removed_at })
  }
  for (const id of b.keys()) if (!a.has(id)) added.push(id)
  changes.sort((x, y) => (`${x.id}|${x.column}` < `${y.id}|${y.column}` ? -1 : 1))
  return { changes, gone, added }
}

const keyOf = (c) => `${c.id}|${c.column}|${c.from}|${c.to}`
// The two lists name the same changes (order does not matter).
export function sameChanges(a, b) {
  const x = a.map(keyOf).sort()
  const y = b.map(keyOf).sort()
  return x.length === y.length && x.every((v, i) => v === y[i])
}
export function missingAndExtra(expected, actual) {
  const want = new Set(expected.map(keyOf))
  const got = new Set(actual.map(keyOf))
  return { missing: expected.filter((c) => !got.has(keyOf(c))), extra: actual.filter((c) => !want.has(keyOf(c))) }
}

// A slot's answer (exercises and sets' structure) as a string that two plannings of the same week share.
const sorted = (rows) => rows.map((r) => JSON.stringify(r)).sort()
export function slotKey(s) {
  return `${s.workout_day_id}|${s.sequence_position ?? 'null'}`
}
// Two plannings of one slot agree when they list the same program rows in the same order, each of the workout's own rows at the
// same position, and the same sets. A row of ANOTHER workout that a week lists (nothing 1.1 wrote; the migration leaves it
// alone) is kept by 045 after the run copy's rows, numbered from the last one, where 041 copied its number: the order is the
// same and the number is not, so it is compared by its place in the order only. `owner` maps a program row to its workout.
export function sameSlot(a, b, owner = new Map()) {
  const view = (s) => {
    const ex = [...s.exercises].sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1))
    return {
      order: ex.map((e) => e[0]),
      positions: ex.filter((e) => !owner.size || owner.get(e[0]) === s.workout_day_id).map((e) => `${e[0]}@${e[1]}`).sort(),
      sets: sorted(s.sets),
    }
  }
  return JSON.stringify(view(a)) === JSON.stringify(view(b))
}

// The fingerprint objects compared: counts and hashes equal key by key. Returns the keys that differ.
export function fingerprintDiff(a, b) {
  const out = []
  for (const part of ['counts', 'hashes']) {
    for (const k of new Set([...Object.keys(a[part] ?? {}), ...Object.keys(b[part] ?? {})])) {
      if (JSON.stringify(a[part]?.[k]) !== JSON.stringify(b[part]?.[k])) out.push(`${part}.${k}`)
    }
  }
  return out
}

// ─── Judging one replay world ────────────────────────────────────────────────────────────────────────────────────────
// What the migration's notice says it did: "046: R active week-dependent run(s), W workout(s) with a last planned week: P made
// part of the program, V brought back, M moved (U row(s) written), X taken out".
export function parseNotice(line) {
  const m = /046: (\d+) active week-dependent run\(s\), (\d+) workout\(s\) with a last planned week: (\d+) made part of the program, (\d+) brought back, (\d+) moved \((\d+) row\(s\) written\), (\d+) taken out/.exec(line ?? '')
  if (!m) return null
  const [runs, workouts, promoted, revived, moved, written, removed] = m.slice(1).map(Number)
  return { runs, workouts, promoted, revived, moved, written, removed }
}

export function judgeWorld(w, notices = null) {
  const problems = []
  const plan = plan046(w.snapshot)
  const first = diffRows(w.snapshot, w.snapshot_after)
  if (first.gone.length || first.added.length) problems.push(`rows appeared or vanished: +${first.added.length} −${first.gone.length}`)
  const { missing, extra } = missingAndExtra(plan.changes, first.changes)
  if (missing.length) problems.push(`046 did not make ${missing.length} change(s) the rule says: ${missing.slice(0, 3).map((c) => `${c.id.slice(0, 8)}.${c.column}→${c.to}`).join(', ')}`)
  if (extra.length) problems.push(`046 made ${extra.length} change(s) the rule does not say: ${extra.slice(0, 3).map((c) => `${c.id.slice(0, 8)}.${c.column} ${c.from}→${c.to}`).join(', ')}`)
  if (notices) {
    // The counts it reports agree with the rule, and the second run reports (and writes) nothing.
    const [n1, n2] = notices.map(parseNotice)
    if (!n1 || !n2) problems.push('the migration printed no readable notice twice')
    else {
      const rows = new Set(plan.changes.filter((c) => c.column !== 'removed' || c.to === false).map((c) => c.id)).size
      const taken = plan.changes.filter((c) => c.column === 'removed' && c.to === true).length
      if (n1.written !== rows) problems.push(`its first update wrote ${n1.written} row(s), the rule changes ${rows}`)
      if (n1.removed !== taken) problems.push(`it took out ${n1.removed} exercise(s), the rule says ${taken}`)
      if (n1.workouts !== plan.workouts.length) problems.push(`it matched ${n1.workouts} workout(s), the rule ${plan.workouts.length}`)
      for (const k of ['promoted', 'revived', 'moved', 'written', 'removed']) if (n2[k] !== 0) problems.push(`the second run reports ${k} ${n2[k]}, not 0`)
    }
  }
  const again = diffRows(w.snapshot_after, w.snapshot_after_twice)
  if (again.changes.length || again.gone.length || again.added.length) problems.push(`a second run changed ${again.changes.length} value(s)`)
  for (const [label, fp] of [['after', w.fingerprint_after], ['after twice', w.fingerprint_after_twice]]) {
    const d = fingerprintDiff(w.fingerprint_before, fp)
    if (d.length) problems.push(`${label}: ${d.join(', ')} differ from before (046 may write week_only, removed_at and position of v2_program_exercises and nothing else)`)
  }
  // Nothing the user sees changes: for each workout 046 matched, the slot it matched plans the same week under 045 as under 041.
  const owner = new Map(w.snapshot.program_exercises.map((r) => [r.id, r.workout_day_id]))
  const before = new Map(w.answer_041.map((s) => [slotKey(s), s]))
  const afterAnswer = new Map(w.answer_045_after_046.map((s) => [slotKey(s), s]))
  let compared = 0
  for (const m of plan.workouts) {
    const k = slotKey(m)
    const x = before.get(k)
    const y = afterAnswer.get(k)
    if (!x || !y) {
      problems.push(`no next week for ${k}`)
      continue
    }
    compared++
    if (!sameSlot(x, y, owner)) problems.push(`the next week of ${k.slice(0, 8)} differs: 041 gives ${x.exercises.length} exercise(s) and ${x.sets.length} set(s), 045 after 046 gives ${y.exercises.length} and ${y.sets.length}`)
  }
  return { ok: problems.length === 0, problems, compared, changes: plan.changes.length }
}

// ─── What a set of random worlds reached ────────────────────────────────────────────────────────────────────────────
// A random world proves only the cases it holds, so the run counts them and fails on a case reached in fewer than a floor of
// the worlds (RULES.md: a walk's floor counts the cases of the rule under test).
//   promote          a week-only row the last week lists became part of the program (a 1.1 swap's or add's row)
//   revive           a removed row the last week lists came back (the program tab's remove, still planned)
//   move             a listed row took the week's position (a 1.1 reorder, or a swap's row at the old row's place)
//   remove           a live row the last week does not list left the program (a 1.1 remove, or the replaced side of a swap)
//   untouched        a world where 046 changed nothing (noop; or a run that already matches)
//   earlierWeek      the week it matched is not the workout's latest planned week (a deload session or an empty one after it)
//   neverPlanned     a workout of the active run with no usable week: left alone
//   slotsDiffer      a sequence run's repeated workout was edited differently in its slots, and the later slot decided
//   completedRun     a completed run's copy held a mismatch that was left as it was
//   otherWorkout     the last week listed a row of another workout, which was not touched on its account
//   otherUser        another user's stable run, with a mismatch, was left alone
export const CASES = ['promote', 'revive', 'move', 'remove', 'untouched', 'earlierWeek', 'neverPlanned', 'slotsDiffer', 'completedRun', 'otherWorkout', 'otherUser']

export function casesOf(w) {
  const snap = w.snapshot
  const plan = plan046(snap)
  const out = Object.fromEntries(CASES.map((c) => [c, false]))
  for (const c of plan.changes) {
    if (c.column === 'week_only') out.promote = true
    if (c.column === 'removed' && c.to === false) out.revive = true
    if (c.column === 'removed' && c.to === true) out.remove = true
    if (c.column === 'position') out.move = true
  }
  out.untouched = plan.changes.length === 0
  const programs = new Map(snap.programs.map((p) => [p.id, p]))
  const active = snap.mesocycles.filter((m) => m.status === 'active' && programs.get(m.program_id)?.kind === 'run' && programs.get(m.program_id)?.planning_type === 'week_dependent')
  const matched = new Set(plan.workouts.map((x) => x.workout_day_id))
  for (const m of active) {
    const p = programs.get(m.program_id)
    for (const wd of snap.workout_days.filter((x) => x.program_id === p.id)) {
      if (!matched.has(wd.id)) out.neverPlanned = true
      const latest = Math.max(0, ...snap.week_plans.filter((x) => x.mesocycle_id === m.id && x.workout_day_id === wd.id).map((x) => x.week_number))
      const got = plan.workouts.find((x) => x.workout_day_id === wd.id)
      if (got && got.week_number < latest) out.earlierWeek = true
    }
  }
  // slots that differ: a workout in two slots of the matched cycle whose two weeks list different rows
  const bySlot = new Map()
  for (const x of snap.week_plan_exercises) {
    if (!bySlot.has(x.week_plan_id)) bySlot.set(x.week_plan_id, [])
    bySlot.get(x.week_plan_id).push(x.program_exercise_id)
  }
  for (const got of plan.workouts) {
    if (got.sequence_position == null) continue
    const sib = snap.week_plans.filter((x) => x.workout_day_id === got.workout_day_id && x.week_number === got.week_number && x.id !== got.week_plan_id && !x.is_deload && x.n_sets > 0)
    const mine = JSON.stringify([...(bySlot.get(got.week_plan_id) ?? [])].sort())
    if (sib.some((x) => JSON.stringify([...(bySlot.get(x.id) ?? [])].sort()) !== mine)) out.slotsDiffer = true
  }
  // a completed run's mismatch, another user's stable run, a listed row of another workout
  const completed = snap.mesocycles.filter((m) => m.status === 'completed')
  for (const m of completed) {
    const p = programs.get(m.program_id)
    const wds = new Set(snap.workout_days.filter((x) => x.program_id === p?.id).map((x) => x.id))
    if (snap.program_exercises.some((r) => wds.has(r.workout_day_id) && (r.week_only || r.removed))) out.completedRun = true
  }
  for (const m of snap.mesocycles) {
    const p = programs.get(m.program_id)
    if (m.status === 'active' && p?.planning_type === 'stable') {
      const wds = new Set(snap.workout_days.filter((x) => x.program_id === p.id).map((x) => x.id))
      if (snap.program_exercises.some((r) => wds.has(r.workout_day_id) && r.week_only)) out.otherUser = true
    }
  }
  const owner = new Map(snap.program_exercises.map((r) => [r.id, r.workout_day_id]))
  for (const wp of snap.week_plans) {
    for (const x of snap.week_plan_exercises.filter((e) => e.week_plan_id === wp.id)) {
      if (owner.has(x.program_exercise_id) && owner.get(x.program_exercise_id) !== wp.workout_day_id) out.otherWorkout = true
    }
  }
  return out
}

export function floorFor(worlds) {
  return Math.max(3, Math.ceil(worlds * 0.04))
}

// ─── The replay ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function plan041Function(text041) {
  const start = text041.indexOf('-- ═══ 2. v2_plan_week')
  const end = text041.indexOf('-- ═══ 3. v2_make_week_default')
  if (start < 0 || end < 0) throw new Error("041's v2_plan_week block was not found")
  const block = text041.slice(start, end)
  const renamed = block.replace('create or replace function v2_plan_week(', 'create or replace function v2_plan_week_041(')
  if (renamed === block) throw new Error("041's function header was not found")
  return renamed.replace(/grant execute on function v2_plan_week\(uuid, integer\) to authenticated;/, 'grant execute on function v2_plan_week_041(uuid, integer) to authenticated;')
}

export function worldScript(worldSql, text041, migrationText) {
  // a function as the replacement: a string would read the `$$` of the function's body as a replacement pattern
  const withPrefix = worldSql.replace('-- @V2_PLAN_WEEK_041@', () => plan041Function(text041))
  const parts = withPrefix.split('-- @MIGRATION@')
  if (parts.length !== 3) throw new Error(`world.sql must hold the migration marker twice (found ${parts.length - 1})`)
  return parts[0] + migrationText + parts[1] + migrationText + parts[2]
}

function findMigration() {
  const dir = path.join(REPO, 'supabase', 'migrations')
  const f = readdirSync(dir).find((n) => /^046_.*\.sql$/.test(n))
  if (!f) throw new Error('no supabase/migrations/046_*.sql')
  return path.join(dir, f)
}

function runWorld(container, script, world, seed) {
  const r = psql(container, ['-v', `world=${world}`, '-v', `seed=${seed}`, '-f', '-'], script)
  const line = (r.stdout ?? '').trim().split('\n').filter(Boolean).pop()
  if (r.status !== 0 || !line || !line.startsWith('{')) return { error: FIRST_LINE(r.stderr) || 'no output' }
  const notices = (r.stderr ?? '').split('\n').filter((l) => l.includes('NOTICE:  046:')).map((l) => l.replace(/^.*NOTICE:\s+/, ''))
  return { world: JSON.parse(line), notices }
}

function parseArgs(argv) {
  const o = { mode: null, worlds: 120, container: null, migration: null, account: 'staging-test@example.com', out: null, compare: null }
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--replay') o.mode = 'replay'
    else if (a === '--staging') o.mode = 'staging'
    else if (a === '--worlds') o.worlds = Number(argv[++i])
    else if (a === '--container') o.container = argv[++i]
    else if (a === '--migration') o.migration = argv[++i]
    else if (a === '--account') o.account = argv[++i]
    else if (a === '--out') o.out = argv[++i]
    else if (a === '--compare') o.compare = argv[++i]
    else throw new Error(`unknown argument ${a}`)
  }
  if (!o.mode) throw new Error('say --replay or --staging')
  if (!Number.isInteger(o.worlds) || o.worlds < 0) throw new Error('--worlds takes a whole number')
  if (o.mode === 'staging' && o.out && o.compare) throw new Error('--out and --compare are for before and after: one at a time')
  return o
}

async function replay(o) {
  const found = findContainer(o.container)
  if (found.several) throw new Error(`several replay containers are running (${found.several.join(', ')}); pass --container NAME`)
  if (!found.name) throw new Error('no running migration-replay container. Start dockerd, then: bash scripts/replay-migrations.sh --keep')
  const container = found.name
  const probe = psql(container, ['-c', "select to_regprocedure('v2_plan_week(uuid,integer)') is not null and to_regprocedure('v2_start_run(uuid,text,date)') is not null"])
  if (probe.status !== 0 || probe.stdout.trim() !== 't') throw new Error(`${container} has no v2_plan_week / v2_start_run (${FIRST_LINE(probe.stderr)})`)
  const migrationPath = o.migration ?? findMigration()
  const migrationText = readFileSync(migrationPath, 'utf8')
  const text041 = readFileSync(path.join(REPO, 'supabase', 'migrations', '041_safeupdate_where_true.sql'), 'utf8')
  const worldSql = readFileSync(WORLD_SQL, 'utf8')
  const script = worldScript(worldSql, text041, migrationText)
  console.log(`rehearse-046: container ${container} · migration ${path.basename(migrationPath)}`)
  const tables = 'select ' + ['auth.users', 'exercises', 'v2_programs', 'v2_workout_days', 'v2_program_exercises', 'v2_program_sets', 'v2_mesocycles', 'v2_week_plans', 'v2_week_plan_exercises', 'v2_week_plan_sets', 'v2_sessions', 'v2_set_logs']
    .map((t) => `(select count(*) from ${t})`).join(" || '/' || ")
  const rowsBefore = psql(container, ['-c', tables]).stdout.trim()
  let failed = 0
  const list = [['noop', 1], ['canon', 1], ['seq', 1]]
  const reached = Object.fromEntries(CASES.map((c) => [c, 0]))
  let worlds = 0
  let totalChanges = 0
  const notices = []
  const run = (world, seed, label) => {
    const ran = runWorld(container, script, world, seed)
    if (ran.error) {
      console.log(`  ERROR ${label}: ${ran.error}`)
      failed++
      return
    }
    const j = judgeWorld(ran.world, ran.notices)
    worlds++
    totalChanges += j.changes
    for (const [c, hit] of Object.entries(casesOf(ran.world))) if (hit) reached[c]++
    if (ran.notices[0]) notices.push(ran.notices[0])
    if (!j.ok) {
      failed++
      console.log(`  FAIL ${label}: ${j.problems.join(' · ')}`)
    } else if (world !== 'rand') {
      console.log(`  OK   ${label}: ${j.changes} change(s) as the rule says; ${j.compared} workout(s) plan the same next week as 041; a second run changes nothing; ${ran.notices[0] ?? ''}`)
    }
  }
  for (const [world] of list) run(world, 1, `${world} world`)
  for (let seed = 1; seed <= o.worlds; seed++) run('rand', seed, `random world ${seed}`)
  for (let seed = 1; seed <= Math.min(o.worlds, 60); seed++) run('seq', seed, `sequence world ${seed}`)
  if (o.worlds > 0) {
    console.log(`  ${worlds - failed} of ${worlds} worlds passed every check (${totalChanges} changes made and judged against the rule)`)
    console.log(`  cases reached (worlds out of ${worlds}): ${CASES.map((c) => `${c} ${reached[c]}`).join(' · ')}`)
    const floor = floorFor(worlds)
    const short = CASES.filter((c) => reached[c] < floor)
    console.log(`  ${short.length === 0 ? 'OK  ' : 'FAIL'} every case reached in at least ${floor} worlds${short.length ? `; short: ${short.join(', ')}` : ''}`)
    if (short.length) failed++
  }
  const rowsAfter = psql(container, ['-c', tables]).stdout.trim()
  const clean = rowsBefore === rowsAfter
  console.log(`rehearse-046: worlds left no rows behind (${rowsBefore} → ${rowsAfter}): ${clean ? 'ok' : 'NOT CLEAN'}`)
  if (!clean) failed++
  console.log(`rehearse-046: ${failed === 0 ? 'every check passed' : `${failed} did not`}`)
  return failed === 0 ? 0 : 1
}

// ─── Staging: read only ──────────────────────────────────────────────────────────────────────────────────────────────
const md5 = (v) => createHash('md5').update(JSON.stringify(v)).digest('hex')

// The tables 046 mentions, read as the signed-in account (RLS scopes them to it): the rows 046 decides from and may write.
export async function fetchSnapshot(get) {
  const mesocycles = await get('v2_mesocycles?select=id,user_id,status,program_id&order=id')
  const programs = await get('v2_programs?select=id,kind,planning_type,schedule_type&order=id')
  const workout_days = await get('v2_workout_days?select=id,program_id&order=id')
  const pes = await get('v2_program_exercises?select=id,workout_day_id,exercise_id,position,week_only,removed_at,replaces_program_exercise_id,superset_block_id,weight_unit,rest_seconds,rest_after_seconds,tempo,user_id&order=id')
  const wps = await get('v2_week_plans?select=id,mesocycle_id,workout_day_id,week_number,sequence_position,is_deload,deload_restore,notes,user_id&order=id')
  const wpe = await get('v2_week_plan_exercises?select=id,week_plan_id,program_exercise_id,position,carry_program_exercise_id,carry_position,user_id&order=id')
  const wps_sets = await get('v2_week_plan_sets?select=id,week_plan_id&order=id')
  const nSets = new Map()
  for (const s of wps_sets) nSets.set(s.week_plan_id, (nSets.get(s.week_plan_id) ?? 0) + 1)
  const snapshot = {
    mesocycles,
    programs,
    workout_days,
    program_exercises: pes.map((r) => ({ id: r.id, workout_day_id: r.workout_day_id, position: r.position, week_only: r.week_only === true, removed: r.removed_at != null, removed_at: r.removed_at ?? null })),
    week_plans: wps.map((w) => ({ id: w.id, mesocycle_id: w.mesocycle_id, workout_day_id: w.workout_day_id, week_number: w.week_number, sequence_position: w.sequence_position, is_deload: w.is_deload, n_sets: nSets.get(w.id) ?? 0 })),
    week_plan_exercises: wpe.map((x) => ({ week_plan_id: x.week_plan_id, program_exercise_id: x.program_exercise_id, position: x.position })),
  }
  const strip = (rows, cols) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !cols.includes(k))))
  const fingerprint = {
    counts: {
      v2_mesocycles: mesocycles.length, v2_programs: programs.length, v2_workout_days: workout_days.length, v2_program_exercises: pes.length,
      v2_week_plans: wps.length, v2_week_plan_exercises: wpe.length, v2_week_plan_sets: wps_sets.length,
    },
    hashes: {
      v2_mesocycles: md5(mesocycles), v2_programs: md5(programs), v2_workout_days: md5(workout_days),
      v2_program_exercises_other_columns: md5(strip(pes, ['week_only', 'removed_at', 'position'])),
      v2_week_plans: md5(wps), v2_week_plan_exercises: md5(wpe), v2_week_plan_sets: md5(wps_sets),
    },
  }
  return { snapshot, fingerprint }
}

async function signIn(account) {
  const { assertNotProduction } = await import('./staging-guard.mjs')
  const url = (process.env.STAGING_SUPABASE_URL ?? '').replace(/[^\x20-\x7E]/g, '').trim().replace(/\/+$/, '')
  const anon = (process.env.STAGING_SUPABASE_ANON_KEY ?? '').replace(/[^\x20-\x7E]/g, '').trim()
  const password = process.env.STAGING_TEST_PASSWORD ?? ''
  for (const [k, v] of [['STAGING_SUPABASE_URL', url], ['STAGING_SUPABASE_ANON_KEY', anon], ['STAGING_TEST_PASSWORD', password]]) if (!v) throw new Error(`${k} is not set`)
  assertNotProduction(url)
  const base = { apikey: anon, 'Content-Type': 'application/json' }
  const si = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: base, body: JSON.stringify({ email: account, password }) })
  const body = await si.json().catch(() => ({}))
  if (!body.access_token) throw new Error(`${account} could not sign in (HTTP ${si.status} ${body.error_code ?? ''})`)
  const auth = { ...base, Authorization: `Bearer ${body.access_token}` }
  const get = async (p) => {
    const out = []
    for (let from = 0; ; from += 1000) {
      const r = await fetch(`${url}/rest/v1/${p}`, { headers: { ...auth, Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } })
      const rows = await r.json().catch(() => null)
      if (!r.ok || !Array.isArray(rows)) throw new Error(`GET ${p.split('?')[0]} answered HTTP ${r.status}`)
      out.push(...rows)
      if (rows.length < 1000) break
    }
    return out
  }
  return { get, ref: url.replace(/^https?:\/\//, '').split('.')[0] }
}

function describePlan(plan, snap) {
  const names = new Map(snap.program_exercises.map((r) => [r.id, r]))
  console.log(`  046 would match ${plan.workouts.length} workout(s) and make ${plan.changes.length} change(s) on ${new Set(plan.changes.map((c) => c.id)).size} row(s)`)
  for (const c of plan.changes.slice(0, 40)) console.log(`    ${c.id.slice(0, 8)} (workout ${names.get(c.id)?.workout_day_id?.slice(0, 8)}): ${c.column} ${c.from} → ${c.to}`)
}

// The staging rehearsal's verdict: what changed in v2_program_exercises between the reading taken before the merge (`before`,
// as --out saved it) and now, against what the rule said from the first reading.
export function compareSnapshots(before, now) {
  const expected = plan046(before.snapshot)
  const diff = diffRows(before.snapshot, now.snapshot)
  const { missing, extra } = missingAndExtra(expected.changes, diff.changes)
  // 046 writes none of these tables; they must be equal. The week tables are told, not judged: a PLAN FORWARD or a save between
  // the two readings changes them and is not 046.
  const weekTables = ['v2_week_plans', 'v2_week_plan_exercises', 'v2_week_plan_sets']
  const differing = fingerprintDiff(before.fingerprint, now.fingerprint)
  const isWeek = (k) => weekTables.some((t) => k.endsWith(`.${t}`))
  const others = differing.filter((k) => !isWeek(k))
  const weeks = differing.filter(isWeek)
  const problems = []
  if (missing.length) problems.push(`${missing.length} change(s) the rule says were not made`)
  if (extra.length) problems.push(`${extra.length} change(s) the rule does not say were made`)
  if (diff.added.length || diff.gone.length) problems.push('rows appeared or vanished')
  if (others.length) problems.push(`${others.join(', ')} differ, and 046 writes none of them`)
  const after = plan046(now.snapshot)
  if (after.changes.length) problems.push(`046 would still change ${after.changes.length} value(s): it is not idempotent here`)
  return { expected, diff, weeks, problems }
}

async function staging(o) {
  const { get, ref } = await signIn(o.account)
  console.log(`rehearse-046: staging project ${ref} (not production) · ${o.account} · read only`)
  const now = await fetchSnapshot(get)
  console.log(`  counts: ${Object.entries(now.fingerprint.counts).map(([k, v]) => `${k.replace('v2_', '')} ${v}`).join(' · ')}`)
  console.log(`  fingerprint: ${Object.entries(now.fingerprint.hashes).map(([k, v]) => `${k.replace('v2_', '')} ${v.slice(0, 8)}`).join(' · ')}`)
  const plan = plan046(now.snapshot)
  if (o.compare) {
    const before = JSON.parse(readFileSync(o.compare, 'utf8'))
    const c = compareSnapshots(before, now)
    if (c.weeks.length) console.log(`  note: ${c.weeks.join(', ')} differ since ${path.basename(o.compare)} (046 writes none of them: another writer, such as a PLAN FORWARD, ran in between)`)
    console.log(`  since ${path.basename(o.compare)}: ${c.diff.changes.length} change(s) in v2_program_exercises (the rule said ${c.expected.changes.length}); rows added ${c.diff.added.length}, removed ${c.diff.gone.length}`)
    for (const x of c.diff.changes.slice(0, 40)) console.log(`    ${x.id.slice(0, 8)}: ${x.column} ${x.from} → ${x.to}`)
    console.log(`  ${c.problems.length === 0 ? 'OK  ' : 'FAIL'} ${c.problems.length === 0 ? 'exactly the changes the rule says, nothing else, and a second run would change nothing' : c.problems.join(' · ')}`)
    return c.problems.length === 0 ? 0 : 1
  }
  describePlan(plan, now.snapshot)
  if (o.out) {
    writeFileSync(o.out, JSON.stringify({ account: o.account, taken_at: new Date().toISOString(), snapshot: now.snapshot, fingerprint: now.fingerprint }, null, 1))
    console.log(`  saved to ${o.out} (no secret in it)`)
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let o
  try {
    o = parseArgs(process.argv)
  } catch (e) {
    console.error(`rehearse-046: ${e.message}`)
    process.exit(2)
  }
  const go = o.mode === 'replay' ? replay : staging
  go(o).then(
    (code) => process.exit(code),
    (e) => {
      console.error(`rehearse-046: ${FIRST_LINE(e?.message)}`)
      process.exit(2)
    },
  )
}
