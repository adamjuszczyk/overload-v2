// A stand-in for PostgREST over in-memory tables, for the tests of the services that page, filter and embed (chunk 51a's
// `changeProgramService.test.ts`). Not a test file (Vitest's include is *.test.ts) and imported by nothing in the app.
//
// It answers the way PostgREST does in the ways that matter to a reader:
//   - a filter filters (eq, in, gte, is, not-is): rows of another run, an earlier week or another status are not returned;
//   - `.select('a, b')` returns only the columns it names (a column the select leaves out is absent, as it is from the
//     database); `*` returns them all; an embed (`child(cols)`) is resolved through a declared relationship and an embed
//     the table has no relationship for is refused, as PostgREST refuses it;
//   - `.range(a, b)` returns at most b - a + 1 rows and the server caps one answer at 1000 rows (Supabase's default), so a
//     reader that asks for more than it pages for does not get the rest;
//   - `.single()` wants exactly one row;
//   - every request is logged, so a test can read what was asked (page sizes, how many ids went into one `.in()`).
// The tables are plain rows (snake_case, as the tables hold them): the same rows chunk 45's test worlds are made of.

export type Row = Record<string, unknown>
export type Tables = Record<string, Row[]>

export interface Request {
  table: string
  select: string
  filters: Array<{ op: 'eq' | 'in' | 'gte' | 'is' | 'not-is'; column: string; value: unknown }>
  order: string | null
  range: [number, number] | null
  single: boolean
}

interface Relation {
  shape: 'one' | 'many'
  // The parent's column and the child's column that hold the same value.
  parentKey: string
  childKey: string
}

// "parent table > embedded table": how the embeds the app uses hang together.
const RELATIONS: Record<string, Relation> = {
  'v2_program_exercises>exercises': { shape: 'one', parentKey: 'exercise_id', childKey: 'id' },
  'v2_week_plans>v2_week_plan_sets': { shape: 'many', parentKey: 'id', childKey: 'week_plan_id' },
  'v2_week_plans>v2_week_plan_exercises': { shape: 'many', parentKey: 'id', childKey: 'week_plan_id' },
  // Chunk 55's VOLUME read: a session's logs and set changes, and a log's exercise (the embed `fetchSession` makes too).
  'v2_sessions>v2_set_logs': { shape: 'many', parentKey: 'id', childKey: 'session_id' },
  'v2_sessions>v2_session_set_changes': { shape: 'many', parentKey: 'id', childKey: 'session_id' },
  'v2_set_logs>exercises': { shape: 'one', parentKey: 'exercise_id', childKey: 'id' },
}

const SERVER_ROW_CAP = 1000

function splitTop(select: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of select) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
    } else current += ch
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function parseSelect(select: string): { star: boolean; columns: string[]; embeds: Array<{ table: string; select: string }> } {
  const out = { star: false, columns: [] as string[], embeds: [] as Array<{ table: string; select: string }> }
  for (const part of splitTop(select)) {
    const embed = /^(\w+)\((.*)\)$/s.exec(part)
    if (embed) out.embeds.push({ table: embed[1], select: embed[2] })
    else if (part === '*') out.star = true
    else out.columns.push(part)
  }
  return out
}

export interface FakePostgrest {
  /** The `supabase` object the code under test sees. */
  client: { from: (table: string) => PromiseLike<{ data: unknown; error: { message: string } | null }> & Builder }
  /** Every request made, in order. */
  requests: Request[]
  /** The requests made to one table. */
  to: (table: string) => Request[]
  /** Make every request to a table fail with this message. */
  failWith: (table: string, message: string) => void
}

interface Builder {
  select: (columns: string) => Builder
  eq: (column: string, value: unknown) => Builder
  in: (column: string, values: readonly unknown[]) => Builder
  gte: (column: string, value: unknown) => Builder
  is: (column: string, value: null) => Builder
  not: (column: string, operator: 'is', value: null) => Builder
  order: (column: string, options?: { ascending?: boolean }) => Builder
  range: (from: number, to: number) => Builder
  single: () => Builder
}

export function fakePostgrest(tables: Tables): FakePostgrest {
  const requests: Request[] = []
  const failures = new Map<string, string>()

  function resolve(tableName: string, select: string, rows: Row[]): Row[] {
    const parsed = parseSelect(select)
    return rows.map((row) => {
      const out: Row = {}
      if (parsed.star) Object.assign(out, row)
      for (const column of parsed.columns) out[column] = row[column] ?? null
      for (const embed of parsed.embeds) {
        const relation = RELATIONS[`${tableName}>${embed.table}`]
        if (!relation) throw new Error(`Could not find a relationship between '${tableName}' and '${embed.table}' in the schema cache`)
        const matches = (tables[embed.table] ?? []).filter((child) => child[relation.childKey] === row[relation.parentKey])
        const shaped = resolve(embed.table, embed.select, matches)
        out[embed.table] = relation.shape === 'many' ? shaped : (shaped[0] ?? null)
      }
      return out
    })
  }

  function run(req: Request): { data: unknown; error: { message: string } | null } {
    const failure = failures.get(req.table)
    if (failure !== undefined) return { data: null, error: { message: failure } }
    let rows = (tables[req.table] ?? []).filter((row) =>
      req.filters.every(({ op, column, value }) => {
        const v = row[column]
        if (op === 'eq') return v === value
        if (op === 'in') return (value as readonly unknown[]).includes(v)
        if (op === 'gte') return v !== null && v !== undefined && (v as number | string) >= (value as number | string)
        if (op === 'is') return v === null || v === undefined
        return v !== null && v !== undefined
      }),
    )
    if (req.order) {
      const column = req.order
      rows = [...rows].sort((a, b) => (String(a[column]) < String(b[column]) ? -1 : String(a[column]) > String(b[column]) ? 1 : 0))
    }
    if (req.range) rows = rows.slice(req.range[0], req.range[1] + 1)
    rows = rows.slice(0, SERVER_ROW_CAP)
    const shaped = resolve(req.table, req.select, rows)
    if (req.single) {
      return shaped.length === 1
        ? { data: shaped[0], error: null }
        : { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } }
    }
    return { data: shaped, error: null }
  }

  function from(table: string) {
    const req: Request = { table, select: '*', filters: [], order: null, range: null, single: false }
    requests.push(req)
    const builder: Builder & PromiseLike<{ data: unknown; error: { message: string } | null }> = {
      select(columns) {
        req.select = columns
        return builder
      },
      eq(column, value) {
        req.filters.push({ op: 'eq', column, value })
        return builder
      },
      in(column, values) {
        req.filters.push({ op: 'in', column, value: values })
        return builder
      },
      gte(column, value) {
        req.filters.push({ op: 'gte', column, value })
        return builder
      },
      is(column, value) {
        req.filters.push({ op: 'is', column, value })
        return builder
      },
      not(column, _operator, _value) {
        req.filters.push({ op: 'not-is', column, value: null })
        return builder
      },
      order(column) {
        req.order = column
        return builder
      },
      range(from, to) {
        req.range = [from, to]
        return builder
      },
      single() {
        req.single = true
        return builder
      },
      then(onFulfilled, onRejected) {
        try {
          return Promise.resolve(run(req)).then(onFulfilled, onRejected)
        } catch (error) {
          return Promise.reject(error).then(onFulfilled, onRejected)
        }
      },
    }
    return builder
  }

  return {
    client: { from },
    requests,
    to: (table) => requests.filter((r) => r.table === table),
    failWith: (table, message) => void failures.set(table, message),
  }
}
