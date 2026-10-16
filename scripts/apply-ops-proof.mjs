#!/usr/bin/env node
// apply-ops-proof.mjs (chunk 47)
//
// The executed proof of migration 043's `v2_apply_ops` (TASKS-1.2 chunk 47, Verification): R3's rejections, the
// atomicity of a list, DECISIONS 142's one column of v2_week_plans and DECISIONS 143's link column, each asserted by its
// error text and by the rows being unchanged, on a replayed database, as a signed-in user under RLS, with pg-safeupdate
// loaded the way PostgREST's role has it. And the break proofs: the function is copied out of the migration file into the
// session (pg_temp, so nothing is left behind), one exact edit is made, and the same scenarios must then fail.
//
// Usage:  bash scripts/replay-migrations.sh --keep          (Docker; start dockerd first)
//         node scripts/apply-ops-proof.mjs                   the scenarios against the function the replay installed
//         node scripts/apply-ops-proof.mjs --breaks          every break (and the two controls): each must be caught
//         node scripts/apply-ops-proof.mjs --break B01,B07   some of them
//         node scripts/apply-ops-proof.mjs --sweep           a generated sweep: every mutant of the function (raise removed, condition
//                                                            negated, statement deleted, …) must fail a scenario; survivors are listed
//         node scripts/apply-ops-proof.mjs --only A01,W02    some scenarios
//         node scripts/apply-ops-proof.mjs --list            the scenarios and the breaks, no database
//         --container NAME   needed only when more than one kept replay container is running
// Exit:   0 everything passed / every break was caught · 1 a scenario failed or a break survived · 2 couldn't run.
//
// Nothing is written: every scenario is its own transaction, rolled back; its fixture (two users, one row of everything
// each) lives in that transaction. The migration file is read, never changed.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BREAKS, CONTROLS } from './apply-ops-proof/breaks.mjs'
import { SCENARIOS } from './apply-ops-proof/scenarios.mjs'
import { applyBreak, asCopy, fixtureSql, helperSql, readInstallText, resolveIds } from './apply-ops-proof/model.mjs'
import { mutants } from './apply-ops-proof/sweep.mjs'

export const REAL_FN = 'public.v2_apply_ops'
export const COPY_FN = 'pg_temp.zz_fn'

// ─── the script one psql session runs ────────────────────────────────────────────────────────────────────────────────

const CANARY = `
-- pg-safeupdate, loaded for this session: a bare UPDATE must be refused, or nothing below is under it.
load 'safeupdate';
do $c$ begin
  begin
    update public.exercises set name = name;
    raise exception 'CANARY-NOT-ACTIVE';
  exception when others then
    if sqlerrm like '%requires a WHERE clause%' then
      raise notice 'CANARY|PASS';
    else
      raise notice 'CANARY|FAIL|%', sqlerrm;
    end if;
  end;
end $c$;
`

export function scenarioSql(s) {
  return `
begin;
${s.pre ?? ''}
insert into auth.users (id, email) values ('{{uA}}', 'proof-a@example.invalid'), ('{{uB}}', 'proof-b@example.invalid');
select set_config('request.jwt.claim.sub', '{{uA}}', true);
set local role authenticated;
set local statement_timeout = '8s';
${fixtureSql('a')}
select set_config('request.jwt.claim.sub', '{{uB}}', true);
${fixtureSql('b')}
select set_config('request.jwt.claim.sub', '{{uA}}', true);
do $s$
declare s0 text; s1 text; r record; k bigint; t text; note text := '';
begin
${s.body}
  raise notice 'RESULT|${s.id}|PASS|%', note;
exception when others then
  raise notice 'RESULT|${s.id}|FAIL|%', sqlerrm;
end $s$;
rollback;
`
}

// installText: the function and its grants as a pg_temp copy, or null to run the function the replay installed.
export function buildScript({ installText, scenarios }) {
  const fn = installText ? COPY_FN : REAL_FN
  const parts = ['\\set VERBOSITY terse', CANARY]
  if (installText) parts.push(installText)
  parts.push(helperSql(fn))
  for (const s of scenarios) parts.push(scenarioSql(s))
  return resolveIds(parts.join('\n'))
}

// ─── Docker ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function docker(args, input) {
  return spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
}

export function findContainer(wanted) {
  const r = docker(['ps', '--format', '{{.Names}}'])
  if (r.status !== 0) throw new Error(`docker ps failed: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`)
  const names = r.stdout.split('\n').filter((n) => n.startsWith('migration-replay-'))
  if (wanted) {
    if (!names.includes(wanted)) throw new Error(`container ${wanted} is not running (kept replay containers: ${names.join(', ') || 'none'})`)
    return wanted
  }
  if (names.length === 0) throw new Error('no kept replay container is running (bash scripts/replay-migrations.sh --keep)')
  if (names.length > 1) throw new Error(`more than one kept replay container (${names.join(', ')}): pass --container NAME`)
  return names[0]
}

function psql(container, sql) {
  const r = docker(
    ['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-h', '127.0.0.1', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-f', '-'],
    sql,
  )
  return { status: r.status, text: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}

// Reads the NOTICE lines a run printed.
export function parseResults(text) {
  const results = new Map()
  let canary = null
  const errors = []
  for (const line of text.split('\n')) {
    const m = /RESULT\|([^|]+)\|(PASS|FAIL)(?:\|(.*))?$/.exec(line)
    if (m) results.set(m[1], { ok: m[2] === 'PASS', why: m[3] ?? '' })
    const c = /CANARY\|(PASS|FAIL)/.exec(line)
    if (c) canary = c[1] === 'PASS'
    if (/\bERROR:/.test(line) && !/RESULT\|/.test(line)) errors.push(line.replace(/^psql:<stdin>:\d+: /, '').trim())
  }
  return { results, canary, errors }
}

export function run(container, { installText = null, scenarios = SCENARIOS, pre = '' } = {}) {
  // `pre` (a schema break) runs first in every scenario's transaction, before the role switch; the transaction is rolled back.
  const r = psql(container, buildScript({ installText, scenarios: pre ? scenarios.map((s) => ({ ...s, pre })) : scenarios }))
  const parsed = parseResults(r.text)
  // A scenario with no line printed failed to run at all (its fixture or its wrapper): that is a failure, not a pass.
  const rows = scenarios.map((s) => ({ id: s.id, title: s.title, ...(parsed.results.get(s.id) ?? { ok: false, why: `no result printed${parsed.errors[0] ? ` (${parsed.errors[0]})` : ''}` }) }))
  return { rows, canary: parsed.canary, errors: parsed.errors }
}

function functionExists(container) {
  const r = docker(['exec', '-i', '-e', 'PGPASSWORD=postgres', container, 'psql', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'postgres', '-X', '-At', '-c', `select to_regprocedure('${REAL_FN}(jsonb)') is not null`])
  return r.stdout.trim() === 't'
}

// ─── the report ──────────────────────────────────────────────────────────────────────────────────────────────────────

const short = (s, n = 150) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function printRows(rows) {
  for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id.padEnd(15)} ${r.ok ? `${short(r.title, 120)}${r.why ? `  [${r.why}]` : ''}` : `${short(r.title, 80)}  <- ${short(r.why, 220)}`}`)
}

function parseArgs(argv) {
  const o = { breaks: false, break: null, only: null, list: false, container: null, sweep: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--breaks') o.breaks = true
    else if (a === '--break') o.break = argv[++i].split(',')
    else if (a === '--only') o.only = argv[++i].split(',')
    else if (a === '--list') o.list = true
    else if (a === '--sweep') o.sweep = true
    else if (a === '--container') o.container = argv[++i]
    else throw new Error(`unknown argument ${a}`)
  }
  return o
}

async function main() {
  const o = parseArgs(process.argv.slice(2))
  if (o.list) {
    for (const s of SCENARIOS) console.log(`scenario ${s.id.padEnd(15)} ${s.title}`)
    for (const b of [...CONTROLS, ...BREAKS]) console.log(`break    ${b.id.padEnd(15)} ${b.title}  -> ${b.control ? 'must pass everything' : b.survives ? `survives: ${b.survives}` : `fails ${b.fails.join(', ')}`}`)
    return 0
  }
  const only = o.only ? SCENARIOS.filter((s) => o.only.includes(s.id)) : SCENARIOS
  if (o.only && only.length !== o.only.length) throw new Error(`unknown scenario in ${o.only.join(',')}`)
  const container = findContainer(o.container)
  console.log(`apply-ops-proof: container ${container}`)

  if (o.sweep) {
    const install = readInstallText()
    const all = mutants(install)
    let killed = 0, invalid = 0
    const survivors = []
    for (const m of all) {
      const { rows, canary } = run(container, { installText: asCopy(m.text), scenarios: only })
      if (canary !== true) { console.log('the canary was not active; stopping.'); return 2 }
      const failed = rows.filter((r) => !r.ok)
      if (failed.length === rows.length && failed.every((r) => r.why.startsWith('no result printed'))) { invalid++; console.log(`${m.id.padEnd(10)} does not compile   ${m.what}`); continue }
      if (failed.length > 0) { killed++; console.log(`${m.id.padEnd(10)} killed by ${String(failed.length).padStart(2)}    ${m.what}`) } else { survivors.push(m); console.log(`${m.id.padEnd(10)} SURVIVES          ${m.what}`) }
    }
    console.log(`apply-ops-proof: sweep of ${all.length} mutants: ${killed} killed, ${invalid} do not compile, ${survivors.length} survive.`)
    for (const m of survivors) console.log(`  survivor ${m.id}: ${m.what}`)
    return survivors.length ? 1 : 0
  }

  if (!o.breaks && !o.break) {
    if (!functionExists(container)) {
      console.error(`apply-ops-proof: ${REAL_FN}(jsonb) is not in ${container} (replay the migrations with 043 first).`)
      return 2
    }
    const { rows, canary, errors } = run(container, { scenarios: only })
    console.log(`apply-ops-proof: the function the replay installed (${REAL_FN}); pg-safeupdate canary: ${canary === true ? 'active (a bare UPDATE is refused)' : canary === false ? 'NOT ACTIVE' : 'no answer'}`)
    printRows(rows)
    const bad = rows.filter((r) => !r.ok)
    if (canary !== true || rows.find((r) => r.id === 'F00')?.ok !== true) {
      console.log('apply-ops-proof: the harness itself is not sound (canary or fixture); nothing below can be read.')
      return 2
    }
    console.log(`apply-ops-proof: ${rows.length} scenarios, ${rows.length - bad.length} passed, ${bad.length} failed.`)
    if (errors.length > 0 && bad.length > 0) console.log(`first psql error: ${short(errors[0], 200)}`)
    return bad.length ? 1 : 0
  }

  // Break proofs: every scenario against a copy of the function with one exact edit.
  const install = readInstallText()
  const wanted = o.break ? [...CONTROLS, ...BREAKS].filter((b) => o.break.includes(b.id)) : [...CONTROLS, ...BREAKS]
  let wrong = 0
  for (const b of wanted) {
    const text = asCopy(applyBreak(install, b), 'zz_fn', { defaults: !b.noDefaults })
    const { rows, canary } = run(container, { installText: text, scenarios: only, pre: b.pre ?? '' })
    if (canary !== true) { console.log(`${b.id}: the canary was not active; stopping.`); return 2 }
    const failed = rows.filter((r) => !r.ok).map((r) => r.id)
    let verdict
    if (b.control) {
      verdict = failed.length === 0 ? 'OK     the control passes everything' : `WRONG  the control failed ${failed.join(', ')}`
      if (failed.length > 0) wrong++
    } else if (b.survives) {
      verdict = failed.length === 0 ? `SURVIVES (by design: ${b.survives})` : `WRONG  expected to survive (${b.survives}) but failed ${failed.join(', ')}`
      if (failed.length > 0) wrong++
    } else {
      const missing = b.fails.filter((id) => !failed.includes(id))
      verdict = failed.length === 0 ? 'NOT CAUGHT' : missing.length ? `CAUGHT, but ${missing.join(', ')} did not fail` : 'CAUGHT'
      if (failed.length === 0 || missing.length > 0) wrong++
    }
    console.log(`${b.id.padEnd(5)} ${verdict.padEnd(12)} ${short(b.title, 110)}${failed.length ? `\n        failed: ${failed.join(', ')}` : ''}`)
  }
  console.log(`apply-ops-proof: ${wanted.length} breaks and controls, ${wrong} not as expected.`)
  return wrong ? 1 : 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (e) => {
      console.error(`apply-ops-proof: ${e.message}`)
      process.exit(2)
    },
  )
}
