// A test stand-in for the Supabase side of the sync queue (queue-fix 230): an in-memory server that models the foreign keys the queued writes carry, with the delete action each
// migration gave it, and answers the request shapes the app's own services send (an upsert, a one-column patch, a delete with `.eq` filters, a head count, a select). It is where
// the app's real producers and the real `flushSyncQueue` meet a server that REFUSES a row naming a parent it no longer holds (`23503`, with the constraint's name in the message, as
// PostgREST answers) and that takes or keeps a child when a parent is deleted, as the real tables do. Tests and their stand-ins are not the app.
export type Row = Record<string, unknown>

interface Key {
  column: string
  parent: string
  onDelete: 'cascade' | 'set null' | 'no action'
  name: string
}

/** 001 (`session_id` cascade, `week_plan_set_id` set null, `exercise_id` no action), 010 (`parent_set_id` cascade), 017 (a note's session: set null) and 042 (the change rows: all cascade). */
export const KEYS: Record<string, Key[]> = {
  v2_set_logs: [
    { column: 'session_id', parent: 'v2_sessions', onDelete: 'cascade', name: 'v2_set_logs_session_id_fkey' },
    { column: 'week_plan_set_id', parent: 'v2_week_plan_sets', onDelete: 'set null', name: 'v2_set_logs_week_plan_set_id_fkey' },
    { column: 'parent_set_id', parent: 'v2_set_logs', onDelete: 'cascade', name: 'v2_set_logs_parent_set_id_fkey' },
    { column: 'exercise_id', parent: 'exercises', onDelete: 'no action', name: 'v2_set_logs_exercise_id_fkey' },
  ],
  v2_coach_notes: [{ column: 'session_id', parent: 'v2_sessions', onDelete: 'set null', name: 'v2_coach_notes_session_id_fkey' }],
  v2_session_set_changes: [
    { column: 'session_id', parent: 'v2_sessions', onDelete: 'cascade', name: 'v2_session_set_changes_session_id_fkey' },
    { column: 'week_plan_set_id', parent: 'v2_week_plan_sets', onDelete: 'cascade', name: 'v2_session_set_changes_week_plan_set_id_fkey' },
    { column: 'set_log_id', parent: 'v2_set_logs', onDelete: 'cascade', name: 'v2_session_set_changes_set_log_id_fkey' },
  ],
}

type Filters = Array<[string, unknown]>
interface Thenable<T> {
  eq: (column: string, value: unknown) => Thenable<T>
  /** `.single()`: the request's answer as it is (the session read answers one row, or `PGRST116`). */
  single: () => Promise<T>
  then: (resolve: (value: T) => unknown, reject?: (reason: unknown) => unknown) => Promise<unknown>
}

export class QueueServer {
  tables = new Map<string, Map<string, Row>>()
  /** Every request that reached the server, in order, with its outcome. */
  requests: string[] = []
  /** The upserts the server refused with a foreign key (`23503`). */
  refused: string[] = []
  /** A request fails with a network error this many more times: `upsert <table>:<id>`, `patch <table>:<id>` or `delete <table>:<id>`. */
  failing = new Map<string, number>()
  /**
   * Chunk 72 (SPEC.md 1.2.1, Maintenance [10]; migration 048). While it is on, the database refuses every WRITE a signed-in, non-exempt caller makes with
   * `OL001` (hint `maintenance`), as PostgREST answers it (an HTTP 400 that supabase-js hands back as `{ error: { code: 'OL001', … } }`). The check is
   * 048's statement-level BEFORE trigger, which fires when the statement ARRIVES: before any row is looked at, so before a foreign key is checked
   * (a log naming a session the server no longer holds is refused `OL001`, not `23503`), and also for a delete that names no row. Reads are never
   * refused. Every refusal is recorded in `requests` as `<tag> -> OL001` and in `maintenanceRefused`.
   */
  maintenance = false
  /** The writes the server refused for maintenance, as their request tags. */
  maintenanceRefused: string[] = []
  private held = new Map<string, { reached: () => void; released: Promise<void> }>()

  table(name: string): Map<string, Row> {
    let rows = this.tables.get(name)
    if (!rows) this.tables.set(name, (rows = new Map()))
    return rows
  }
  has = (table: string, id: string) => this.table(table).has(id)
  get = (table: string, id: string) => this.table(table).get(id)
  put(table: string, row: Row) {
    this.table(table).set(row.id as string, { ...row })
  }
  ids(table: string): string[] {
    return [...this.table(table).keys()].sort()
  }
  reset() {
    this.tables.clear()
    this.requests.length = 0
    this.refused.length = 0
    this.failing.clear()
    this.held.clear()
    this.maintenance = false
    this.maintenanceRefused.length = 0
    this.onSessionRead = null
  }

  /** The next request with this tag stops at the server until `release()`; `reached` resolves when it is there. For a pass caught in flight. */
  hold(tag: string): { reached: Promise<void>; release: () => void } {
    let release!: () => void
    let reached!: () => void
    const released = new Promise<void>((resolve) => (release = resolve))
    const arrived = new Promise<void>((resolve) => (reached = resolve))
    this.held.set(tag, { reached, released })
    return { reached: arrived, release }
  }

  private async gate(tag: string) {
    const held = this.held.get(tag)
    if (!held) return
    this.held.delete(tag)
    held.reached()
    await held.released
  }
  private fails(tag: string): boolean {
    const left = this.failing.get(tag) ?? 0
    if (left <= 0) return false
    this.failing.set(tag, left - 1)
    this.requests.push(`${tag} -> network error`)
    return true
  }
  private violation(table: string, key: Key, _value: unknown) {
    // As the real PostgREST answers a signed-in caller (read on staging, queue-fix 230): the constraint's name is in the message; under RLS the details do not name the key or its value.
    return {
      code: '23503',
      message: `insert or update on table "${table}" violates foreign key constraint "${key.name}"`,
      details: `Key is not present in table "${key.parent}".`,
    }
  }

  /** 048's refusal, in the shape the app reads (`code`, never the message), or null while maintenance is off. Called first by every write, before anything about its rows. */
  private refusal(tag: string) {
    if (!this.maintenance) return null
    this.requests.push(`${tag} -> OL001`)
    this.maintenanceRefused.push(tag)
    return { error: { code: 'OL001', message: 'Overload is being updated. Writes are refused until maintenance is off.', details: null, hint: 'maintenance' } }
  }

  private async upsert(table: string, row: Row) {
    const tag = `upsert ${table}:${row.id as string}`
    await this.gate(tag)
    const refused = this.refusal(tag)
    if (refused) return refused
    // A key the row names that the server no longer holds is refused whatever the connection does; the network fails a request that would otherwise have been answered.
    for (const key of KEYS[table] ?? []) {
      const value = row[key.column]
      if (value != null && !this.has(key.parent, value as string)) {
        this.requests.push(`${tag} -> 23503 ${key.column}`)
        this.refused.push(tag)
        return { error: this.violation(table, key, value) }
      }
    }
    if (this.fails(tag)) return { error: { message: 'Failed to fetch' } }
    this.requests.push(`${tag} -> ok`)
    this.table(table).set(row.id as string, { ...(this.get(table, row.id as string) ?? {}), ...row })
    return { error: null }
  }

  private async patch(table: string, patch: Row, id: string) {
    const tag = `patch ${table}:${id}`
    await this.gate(tag)
    const refused = this.refusal(tag)
    if (refused) return refused
    if (this.fails(tag)) return { error: { message: 'Failed to fetch' } }
    const row = this.get(table, id)
    this.requests.push(`${tag} ${JSON.stringify(patch)} -> ${row ? '1 row' : '0 rows'}`)
    if (row) this.table(table).set(id, { ...row, ...patch })
    return { error: null }
  }

  private async remove(table: string, filters: Filters) {
    const id = filters.length === 1 && filters[0][0] === 'id' ? (filters[0][1] as string) : null
    const tag = id ? `delete ${table}:${id}` : `delete ${table} where ${filters.map(([c, v]) => `${c}=${String(v)}`).join(',')}`
    await this.gate(tag)
    // Refused whether or not any row matches: a statement-level trigger fires for a delete that finds nothing too.
    const refused = this.refusal(tag)
    if (refused) return refused
    if (id && this.fails(tag)) return { error: { message: 'Failed to fetch' } }
    const matches = [...this.table(table).values()].filter((row) => filters.every(([column, value]) => row[column] === value))
    this.requests.push(`${tag} -> ${matches.length} row${matches.length === 1 ? '' : 's'}`)
    for (const row of matches) this.cascade(table, row.id as string)
    return { error: null }
  }
  private cascade(table: string, id: string) {
    this.table(table).delete(id)
    for (const [child, keys] of Object.entries(KEYS)) {
      for (const key of keys) {
        if (key.parent !== table) continue
        for (const row of [...this.table(child).values()]) {
          if (row[key.column] !== id) continue
          if (key.onDelete === 'cascade') this.cascade(child, row.id as string)
          else if (key.onDelete === 'set null') this.table(child).set(row.id as string, { ...row, [key.column]: null })
        }
      }
    }
  }

  /**
   * DECISIONS 239. The workout's read of its session, as `fetchSession` makes it: `v2_sessions` with its logs (and each log's exercise) and its change rows embedded, one row by `.single()`.
   * The answer is built when the request ARRIVES; `onSessionRead` (a test's hook) then runs before the answer is sent, so a pass that lands while the request is out can be played: the
   * reply is the server as it was when the request left. A read fails like any request with `failing.set('select v2_sessions:<id>', n)`.
   */
  onSessionRead: (() => Promise<void> | void) | null = null

  private async readSession(filters: Filters) {
    const id = filters.length === 1 && filters[0][0] === 'id' ? (filters[0][1] as string) : null
    const tag = `select v2_sessions:${id}`
    const session = id ? this.get('v2_sessions', id) : undefined
    const answer = session
      ? {
          ...session,
          v2_set_logs: [...this.table('v2_set_logs').values()]
            .filter((log) => log.session_id === id)
            .map((log) => {
              const exercise = this.get('exercises', log.exercise_id as string)
              return { ...log, exercises: exercise && exercise.name !== undefined ? { ...exercise } : null }
            }),
          v2_session_set_changes: [...this.table('v2_session_set_changes').values()].filter((row) => row.session_id === id).map((row) => ({ ...row })),
        }
      : null
    await this.gate(tag)
    if (this.onSessionRead) await this.onSessionRead()
    if (this.fails(tag)) return { data: null, error: { message: 'Failed to fetch' } }
    this.requests.push(`${tag} -> ${answer ? 'ok' : '0 rows'}`)
    return answer ? { data: answer, error: null } : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
  }

  /** What the Supabase client's `from` answers for a table. A test's mock maps `from` onto this one (`verify-rls-tables.test.mjs` allows no other dynamic `from` call with a variable in `src/`). */
  query(table: string) {
    const server = this
    const builder = <T,>(run: (filters: Filters) => Promise<T>): Thenable<T> => {
      const filters: Filters = []
      const chain: Thenable<T> = {
        eq: (column, value) => {
          filters.push([column, value])
          return chain
        },
        single: () => run(filters),
        then: (resolve, reject) => run(filters).then(resolve, reject),
      }
      return chain
    }
    return {
      upsert: (row: Row) => server.upsert(table, row),
      update: (patch: Row) => ({
        eq: (column: string, value: string) => {
          if (column !== 'id') throw new Error(`a queued patch filters on id only, not ${column}`)
          return server.patch(table, patch, value)
        },
      }),
      delete: () => builder((filters) => server.remove(table, filters)),
      select: (columns?: string, options?: { count?: string; head?: boolean }) =>
        builder(async (filters) => {
          if (table === 'v2_sessions' && columns?.includes('v2_set_logs')) return server.readSession(filters) as never
          const rows = [...server.table(table).values()].filter((row) => filters.every(([column, value]) => row[column] === value))
          return options?.head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null }
        }),
    }
  }
}
