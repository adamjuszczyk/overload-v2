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

  private async upsert(table: string, row: Row) {
    const tag = `upsert ${table}:${row.id as string}`
    await this.gate(tag)
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
      select: (_columns?: string, options?: { count?: string; head?: boolean }) =>
        builder(async (filters) => {
          const rows = [...server.table(table).values()].filter((row) => filters.every(([column, value]) => row[column] === value))
          return options?.head ? { data: null, count: rows.length, error: null } : { data: rows, count: rows.length, error: null }
        }),
    }
  }
}
