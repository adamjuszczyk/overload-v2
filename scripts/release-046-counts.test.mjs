// release-046-counts.test.mjs — run with: node --test "scripts/*.test.mjs"
//
// scripts/release-046-counts.sql is the read-only before/after reading of migration 046 on PRODUCTION (TASKS-1.2.md
// "Release", step 3), pasted into the SQL editor by Adam. The roles of this test: the file can never write, and it can never
// read a row that is not Adam's. Text checks only (no database in CI); the executed proof is the file run on a local replay
// (the chunk report). The checks are one function, `problems(sql)`, so each rule is tested on the real file (no problem) and
// on a copy that breaks it (a problem): a check that cannot fail proves nothing.
//
// What `problems` holds the file to
//   - the header is comment lines only, and the statement after it has no comment of its own (a `--` inside the statement
//     would comment out the rest of it if a tool ever joined the lines; nothing may hide in a comment);
//   - exactly one statement, a WITH/SELECT: the SQL editor shows only the last statement's result, and the CLI's `-f` runs it;
//   - no statement or clause that writes or changes the session (insert, update, delete, merge, truncate, create, drop,
//     alter, grant, do, set, copy, select ... into, for update ...), and only these functions: count, string_agg, md5,
//     coalesce, to_char, chr, left, now (nextval, set_config, pg_advisory_lock and the like are not on the list);
//   - no `or` and no `not` (but `is not null`), so a filter cannot be widened or negated, no `table x` and no comma join
//     (both read a relation the per-block check would not see);
//   - every uuid in the file is Adam's;
//   - it reads exactly the seven tables 046 mentions, each as `public.<table> <alias>`, and in the same select block as
//     each one stands `<alias>.user_id = '<Adam>'` (a block = one parenthesised group of its own, nested groups apart);
//   - it selects the runs the way 046 does (status 'active', kind 'run', planning type 'week_dependent'; 046's own text is
//     read for the same three tests), counts the seven tables, and fingerprints id, week_only, removed_at and position;
//   - the header says how to run it (SQL editor, and the CLI line of scripts\live-counts.sql with this file's name).

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ADAM = '12e79b69-9891-4f53-a7cf-650edd83659f'
const OTHER = '7e57ac00-0000-4000-8000-000000000004'
const TABLES = ['v2_mesocycles', 'v2_programs', 'v2_workout_days', 'v2_program_exercises', 'v2_week_plans', 'v2_week_plan_sets', 'v2_week_plan_exercises']
const FUNCTIONS = new Set(['count', 'string_agg', 'md5', 'coalesce', 'to_char', 'chr', 'left', 'now'])
// words that may stand right before a "(" without being a function call
const NOT_FUNCTIONS = new Set(['as', 'filter', 'in', 'exists', 'on', 'and', 'where', 'from', 'join', 'select', 'union', 'all', 'over', 'by', 'with', 'values'])
const WRITES = /\b(insert|update|delete|merge|truncate|create|drop|alter|grant|revoke|copy|call|do|execute|perform|vacuum|analyze|refresh|reindex|cluster|lock|comment|listen|notify|unlisten|set|reset|begin|commit|rollback|savepoint|prepare|declare|load|into|returning)\b|\bfor\s+(share|key\s+share|no\s+key\s+update)\b/
const ALIAS_STOPS = new Set(['where', 'on', 'join', 'left', 'right', 'inner', 'full', 'cross', 'group', 'order', 'union', 'limit', 'using', 'natural', 'offset', 'having', 'window', 'except', 'intersect'])

const FILE = join(ROOT, 'scripts/release-046-counts.sql')
const real = readFileSync(FILE, 'utf8')
const m046 = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.startsWith('046_'))
const text046 = m046.length === 1 ? readFileSync(join(ROOT, 'supabase/migrations', m046[0]), 'utf8') : ''

// A string literal's content is blanked ('' stays), so words and parentheses inside a literal are not read as SQL.
const blankLiterals = (s) => s.replace(/'(?:[^']|'')*'/g, "''")

// The own text of every parenthesised group (index 0 = outside all groups), nested groups left out as "()". A string
// literal is copied whole, so a parenthesis inside one does not open a group.
function groupsOf(body) {
  const all = []
  const stack = []
  let cur = { text: '' }
  all.push(cur)
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === "'") {
      let j = i + 1
      while (j < body.length) {
        if (body[j] === "'") {
          if (body[j + 1] === "'") { j += 2; continue }
          break
        }
        j++
      }
      cur.text += body.slice(i, j + 1)
      i = j
    } else if (ch === '(') {
      stack.push(cur)
      cur = { text: '' }
      all.push(cur)
    } else if (ch === ')') {
      const parent = stack.pop()
      if (!parent) throw new Error('unbalanced )')
      parent.text += '()'
      cur = parent
    } else cur.text += ch
  }
  if (stack.length) throw new Error('unbalanced (')
  return all.map((g) => g.text)
}

// Every way the text breaks one of the rules above, as sentences. [] = none.
export function problems(sql, migration046 = text046) {
  const out = []
  const lines = sql.split('\n')
  let first = 0
  while (first < lines.length && (lines[first].trim() === '' || lines[first].startsWith('--'))) first++
  const header = lines.slice(0, first).join('\n')
  const body = lines.slice(first).join('\n')
  if (/--|\/\*/.test(body)) out.push('the statement holds a comment of its own')

  const lit = blankLiterals(body)
  const low = lit.toLowerCase()
  const semis = (lit.match(/;/g) ?? []).length
  if (semis !== 1 || !lit.trim().endsWith(';')) out.push(`not exactly one statement ending the file (${semis} semicolon(s))`)
  if (!/^\s*(with|select)\b/i.test(lit)) out.push('the statement does not start with WITH or SELECT')
  const write = WRITES.exec(low)
  if (write) out.push(`a write or session statement: "${write[0]}"`)
  for (const m of low.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/g)) {
    if (!NOT_FUNCTIONS.has(m[1]) && !FUNCTIONS.has(m[1])) out.push(`a function that is not on the list: ${m[1]}`)
  }
  // CTE names are `name as (`; a bare `name(` that is not a function is caught above
  const ctes = new Set([...low.matchAll(/\b([a-z_][a-z0-9_]*)\s+as\s*\(/g)].map((m) => m[1]))
  if (/\btable\b/.test(low)) out.push('"table" in the statement (TABLE x reads a relation without a filter)')
  if (/\bor\b/.test(low)) out.push('"or" in the statement (a filter could be widened)')
  if (/\bnot\b/.test(low.replace(/\bis\s+not\s+null\b/g, ''))) out.push('"not" in the statement (a filter could be negated)')

  const ids = [...sql.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((m) => m[0].toLowerCase())
  for (const id of new Set(ids)) if (id !== ADAM) out.push(`a uuid that is not Adam's: ${id}`)
  if (!ids.includes(ADAM)) out.push("Adam's id does not appear")

  const read = new Set()
  let groups = []
  try {
    groups = groupsOf(body)
  } catch (e) {
    out.push(`parentheses: ${e.message}`)
  }
  for (const own of groups) {
    const aliases = []
    for (const m of own.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?(\s*,)?/gi)) {
      const name = m[1].toLowerCase()
      if (m[3]) out.push(`${m[1]} is followed by a comma (a comma join reads a table these checks do not see)`)
      if (ctes.has(name)) continue
      const table = name.replace(/^public\./, '')
      if (name !== `public.${table}` || !TABLES.includes(table)) {
        out.push(`reads ${m[1]}, which is not one of the seven tables 046 mentions (as public.<table>)`)
        continue
      }
      read.add(table)
      const alias = m[2] && !ALIAS_STOPS.has(m[2].toLowerCase()) ? m[2] : null
      if (!alias) {
        out.push(`${table} is read without an alias`)
        continue
      }
      if (aliases.includes(alias)) out.push(`the alias ${alias} is used twice in one select block`)
      aliases.push(alias)
      if (!new RegExp(`\\b${alias}\\.user_id\\s*=\\s*'${ADAM}'`, 'i').test(own)) out.push(`${table} (${alias}) is read without ${alias}.user_id = '<Adam>' in its select block`)
    }
  }
  for (const t of TABLES) if (!read.has(t)) out.push(`${t} is not read`)

  // The selection of runs and what is counted and fingerprinted
  for (const w of ["m.status = 'active'", "p.kind = 'run'", "p.planning_type = 'week_dependent'"]) {
    if (!body.includes(w)) out.push(`the run selection lacks ${w}`)
    if (!migration046.includes(w)) out.push(`migration 046 no longer says ${w}: the run selection must follow it`)
  }
  for (const t of TABLES) if (!body.includes(`'counts', '${t}'`)) out.push(`no counts row for ${t}`)
  const line = /e\.id::text[^]*?as line/.exec(body)?.[0] ?? ''
  for (const c of ['e.id', 'e.week_only', 'e.removed_at', 'e.position']) if (!line.includes(c)) out.push(`the fingerprint line lacks ${c}`)
  const md5s = body.match(/md5\(coalesce\(string_agg\(x\.line, chr\(10\) order by x\.id\), ''\)\)/g) ?? []
  if (md5s.length !== 3) out.push(`the fingerprint is not an md5 over the lines in id order in all three places (${md5s.length} of 3)`)
  if (!body.includes("'fingerprint', 'v2_program_exercises") || !body.includes("select 30, 'run'")) out.push('the fingerprint rows or the run rows are missing')

  if (!/^-- READ ONLY\./m.test(header)) out.push('the header does not say READ ONLY')
  if (!/SQL editor/.test(header)) out.push('the header does not say how to run it in the SQL editor')
  if (!header.includes('npx --yes supabase@2.119.0 db query --linked -f scripts\\release-046-counts.sql -o json')) out.push('the header lacks the CLI line')
  if (!/before/.test(header) || !/after/.test(header)) out.push('the header does not say what before and after should show')
  return out
}

const nth = (s, needle, k) => {
  let at = -1
  for (let i = 0; i <= k; i++) at = s.indexOf(needle, at + 1)
  return at
}
const replaceNth = (s, needle, k, to) => {
  const at = nth(s, needle, k)
  return at < 0 ? s : s.slice(0, at) + to + s.slice(at + needle.length)
}

test('the committed file has no problem', () => {
  assert.equal(m046.length, 1, 'migration 046 is found')
  assert.deepEqual(problems(real), [])
})

test('it reads the seven tables and the filter stands in each block (11 references: 7 counts, 2 per CTE)', () => {
  const refs = [...real.matchAll(/\b(?:from|join)\s+public\.(v2_\w+)\s+(\w+)/g)]
  assert.equal(refs.length, 11)
  assert.deepEqual([...new Set(refs.map((m) => m[1]))].sort(), [...TABLES].sort())
  assert.equal([...real.matchAll(/\b\w+\.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'/g)].length, 11)
})

// ─── Each rule on a copy that breaks it ───────────────────────────────────────────────────────────────────────────────
test('a write after the statement is refused, whatever it is', () => {
  const stmts = [
    'delete from public.v2_programs where true;',
    "update public.v2_program_exercises set week_only = false where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f';",
    'insert into public.v2_programs select * from public.v2_programs;',
    'create temp table keep as select 1;',
    'truncate public.v2_mesocycles;',
    'drop table public.v2_programs;',
    'alter table public.v2_programs add column x int;',
    'grant all on public.v2_programs to anon;',
    "do $$ begin perform 1; end $$;",
    "set role postgres;",
    "copy public.v2_programs to '/tmp/x';",
    'call something();',
  ]
  for (const s of stmts) {
    const bad = problems(`${real.trimEnd()}\n${s}\n`)
    assert.ok(bad.length > 0, `${s} is refused`)
    assert.ok(bad.some((p) => /one statement|write or session/.test(p)), `${s}: ${bad.join(' / ')}`)
  }
})

test('a write inside the statement is refused: SELECT INTO, a locking clause, a side-effect function, a data-modifying CTE', () => {
  const cases = [
    [real.replace("select q.section,", "select q.section into scratch_copy from (select 1 as section) q, (select q.section,").replace(/ order by q\.ord, q\.item;/, ' order by q.ord, q.item) q;'), /write or session/],
    [real.replace(' order by q.ord, q.item;', ' order by q.ord, q.item\n for update;'), /write or session/],
    [real.replace("'taken', 'taken_at '", "'taken', set_config('role', 'x', false)"), /function that is not on the list: set_config/],
    [real.replace("'taken', 'taken_at '", "'taken', nextval('some_seq')"), /function that is not on the list: nextval/],
    [real.replace('his_rows as (', 'gone as (delete from public.v2_programs returning id), his_rows as ('), /write or session/],
  ]
  for (const [bad, expected] of cases) {
    const found = problems(bad)
    assert.ok(found.some((p) => expected.test(p)), `expected ${expected}, got: ${found.join(' / ') || 'nothing'}`)
  }
})

test('dropping any one of the 11 user_id filters is refused', () => {
  const filter = /\b\w+\.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'/g
  const hits = [...real.matchAll(filter)]
  assert.equal(hits.length, 11)
  for (let k = 0; k < hits.length; k++) {
    const bad = real.slice(0, hits[k].index) + '1 = 1' + real.slice(hits[k].index + hits[k][0].length)
    assert.ok(problems(bad).some((p) => /is read without .*user_id/.test(p)), `dropping filter ${k + 1} (${hits[k][0].slice(0, 22)}) is refused`)
  }
})

test("any other user's id, in a filter or anywhere, is refused", () => {
  const found = problems(replaceNth(real, `user_id = '${ADAM}'`, 3, `user_id = '${OTHER}'`))
  assert.ok(found.some((p) => p.includes(OTHER)), found.join(' / '))
  assert.ok(problems(real.replace('-- READ ONLY.', `-- READ ONLY. (a note about ${OTHER})`)).some((p) => p.includes(OTHER)))
})

test('a table 046 does not mention, a catalog or the auth schema is refused, with or without a filter', () => {
  const extra = (rel) => real.replace("    union all\n    select 90,", `    union all\n    select 91, 'counts', 'x', (select count(*) from ${rel} t where t.user_id = '${ADAM}'), null, null, null\n    union all\n    select 90,`)
  for (const rel of ['public.v2_set_logs', 'public.exercises', 'auth.users', 'pg_class', 'supabase_migrations.schema_migrations']) {
    assert.ok(problems(extra(rel)).some((p) => p.includes('not one of the seven tables')), `${rel} is refused`)
  }
})

test('a comma join and TABLE x, which read a relation without a visible FROM/JOIN, are refused', () => {
  const comma = real.replace('from public.v2_programs t where', "from public.v2_programs t, public.v2_set_logs u where u.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and")
  assert.notEqual(comma, real)
  assert.ok(problems(comma).some((p) => /followed by a comma/.test(p)), problems(comma).join(' / '))
  const bare = real.replace('      his_rows as (', '      gone as (table public.v2_set_logs),\n      his_rows as (')
  assert.notEqual(bare, real)
  assert.ok(problems(bare).some((p) => /"table"/.test(p)), problems(bare).join(' / '))
})

test('a table read without public. or without an alias is refused', () => {
  assert.ok(problems(real.replace('from public.v2_mesocycles t where', 'from v2_mesocycles t where')).some((p) => /not one of the seven tables/.test(p)))
  assert.ok(problems(real.replace('from public.v2_mesocycles t where t.user_id', 'from public.v2_mesocycles where user_id')).some((p) => /without an alias|read without/.test(p)))
})

test('a filter that can be widened or negated is refused', () => {
  assert.ok(problems(real.replace("t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f')", "t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' or true)")).some((p) => /"or"/.test(p)))
  assert.ok(problems(real.replace("where t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f')", "where not t.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f')")).some((p) => /"not"/.test(p)))
})

test('a comment inside the statement, or an executable line in the header, is refused', () => {
  assert.ok(problems(real.replace('with\n', 'with -- note\n')).some((p) => /comment of its own/.test(p)))
  assert.ok(problems(real.replace('  his_rows as (', '  /* note */ his_rows as (')).some((p) => /comment of its own/.test(p)))
  // a header line that is not a comment becomes part of the statement: two statements, and the first is not a WITH
  assert.ok(problems(real.replace('-- Not in it:', 'select 1;\n-- Not in it:')).length > 0)
})

test('the run selection follows 046, the counts cover the seven tables, the fingerprint covers the three columns', () => {
  assert.ok(problems(real.replace("m.status = 'active'", "m.status <> 'finished'")).some((p) => /run selection lacks m\.status/.test(p)))
  assert.ok(problems(real.replace("p.planning_type = 'week_dependent'", "p.planning_type = 'stable'")).some((p) => /planning_type/.test(p)))
  assert.ok(problems(real, text046.replaceAll("m.status = 'active'", "m.status = 'running'")).some((p) => /046 no longer says/.test(p)))
  assert.ok(problems(real.replace("'counts', 'v2_week_plan_exercises'", "'counts', 'v2_week_plan_exercise'")).some((p) => /no counts row for v2_week_plan_exercises/.test(p)))
  for (const [c, to] of [['e.week_only::text', "'f'"], ['e.removed_at at time zone', 'now() at time zone'], ['e.position::text', "'0'"]]) {
    const bad = real.replace(c, to)
    assert.notEqual(bad, real, `${c} was in the line`)
    assert.ok(problems(bad).some((p) => p.includes(`lacks ${c.split(/[:\s]/)[0]}`)), `without ${c} in the fingerprint: ${problems(bad).join(' / ')}`)
  }
  assert.ok(problems(real.replace('order by x.id), \'\'))', 'order by x.line), \'\'))')).some((p) => /not an md5 over the lines in id order/.test(p)))
})

test('the header says how to run it', () => {
  assert.ok(problems(real.replace('npx --yes supabase@2.119.0', 'npx supabase')).some((p) => /CLI line/.test(p)))
  assert.ok(problems(real.replace('SQL editor', 'dashboard')).some((p) => /SQL editor/.test(p)))
  assert.ok(problems(real.replace('-- READ ONLY.', '--')).some((p) => /READ ONLY/.test(p)))
})

test('harmless edits are not refused (the checks are not over-eager)', () => {
  assert.deepEqual(problems(real.replace(/\bt\.user_id\b/g, 'tt.user_id').replace(/public\.(v2_\w+) t where/g, 'public.$1 tt where')), [], 'another alias')
  assert.deepEqual(problems(real.replace('-- READ ONLY.', '-- READ ONLY. Reworded.')), [])
  assert.deepEqual(problems(real.replace("'unnamed'", "'a name with (parentheses) and ; a semicolon'")), [], 'punctuation inside a literal')
  assert.deepEqual(problems(real.trimEnd() + '\n\n\n'), [], 'trailing blank lines')
})
