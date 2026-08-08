// Shared table primitive for the two new "all time" History views
// (TASKS.md §3 / §4 item 21). Deliberately dumb: columns + rows in, a
// scrollable table out. Domain-specific concerns — grouping dropset stages
// under their head, formatting a null duration as a dash — live in the
// caller, not here, so this stays reusable across both views.

export interface HistoryDataTableColumn<T> {
  key: string
  header: string
  align?: 'left' | 'right'
  render: (row: T) => React.ReactNode
}

interface HistoryDataTableProps<T> {
  columns: HistoryDataTableColumn<T>[]
  rows: T[]
  getRowKey: (row: T) => string
  // Optional per-row style override — used by ExerciseHistoryView to indent
  // and dim dropset stage rows relative to their head.
  getRowStyle?: (row: T) => React.CSSProperties | undefined
  emptyLabel?: string
}

export default function HistoryDataTable<T>({
  columns,
  rows,
  getRowKey,
  getRowStyle,
  emptyLabel = 'NO DATA',
}: HistoryDataTableProps<T>) {
  if (rows.length === 0) {
    return (
      <div
        className="rounded-xl p-6 text-center"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p
          className="text-xs font-bold"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {emptyLabel}
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl overflow-x-auto"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <table className="w-full" style={{ borderCollapse: 'collapse', fontFamily: 'var(--font-mono)' }}>
        <thead>
          <tr style={{ backgroundColor: 'var(--surface-raised)' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                className="px-3 py-2 whitespace-nowrap"
                style={{
                  textAlign: col.align ?? 'left',
                  color: 'var(--text-muted)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                }}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={getRowKey(row)}
              style={{
                borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                ...getRowStyle?.(row),
              }}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className="px-3 py-2 whitespace-nowrap"
                  style={{ textAlign: col.align ?? 'left', color: 'var(--text-primary)', fontSize: 12 }}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
