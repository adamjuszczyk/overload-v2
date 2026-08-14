import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  ReferenceArea,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useWorkoutDayName, useSessionTypeHistory } from './useHistory'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { formatRestTime } from '../../lib/formatRestTime'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import HistoryDataTable, { type HistoryDataTableColumn } from './HistoryDataTable'
import type { SessionTypeHistoryRow } from './historyService'

// SPEC §7 "Session type, all time": every occurrence of e.g. "Push Day A",
// chart plus a table of date / total volume / avg RIR / duration.
// Sourced from v2_session_type_history (TASKS.md §2.6 / Phase 3.4 item 21) —
// already one row per occurrence, aggregated in SQL.

const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
const TICK = { fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' } as const
const TT_STYLE = {
  backgroundColor: 'var(--surface-overlay)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  padding: '8px 12px',
  fontFamily: 'var(--font-mono)',
} as const

interface ChartTip {
  active?: boolean
  payload?: Array<{ value?: number | null }>
  label?: string | number
}

// chartData's `volume` field is already converted to the caller's resolved
// display unit (see chartData's useMemo below) — no conversion needed here.
function VolumeTooltip({ active, payload, label }: ChartTip) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  if (val === undefined || val === null) return null
  return (
    <div style={TT_STYLE}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>{label}</p>
      <p style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 700 }}>{Math.round(val)}</p>
    </div>
  )
}

function buildColumns(
  weightUnit: string,
  toDisplayVolume: (kgVolume: number) => number,
): HistoryDataTableColumn<SessionTypeHistoryRow>[] {
  return [
    { key: 'date', header: 'DATE', render: (r) => format(parseISO(r.date), 'MMM d, yy') },
    {
      key: 'volume',
      header: `VOLUME (${weightUnit.toUpperCase()})`,
      align: 'right',
      render: (r) => (r.totalVolume !== null ? `${Math.round(toDisplayVolume(r.totalVolume))}` : '—'),
    },
    {
      key: 'avgRir',
      header: 'AVG RIR',
      align: 'right',
      render: (r) => (r.avgRir !== null ? `${Math.round(r.avgRir * 10) / 10}` : '—'),
    },
    {
      key: 'duration',
      header: 'DURATION',
      align: 'right',
      // Sessions created via skipMissedSession have no started_at/completed_at
      // (TASKS.md §2.6's risk section) — render a dash, not 0. Also guard
      // against <= 0 (found by adversarial review): a device clock change
      // between the client-set started_at/completed_at timestamps could make
      // extract(epoch from completed_at - started_at) come back zero or
      // negative, which formatRestTime has no floor for.
      render: (r) =>
        r.durationSeconds !== null && r.durationSeconds > 0 ? formatRestTime(r.durationSeconds) : '—',
    },
  ]
}

interface Props {
  workoutDayId: string
}

export default function SessionTypeHistoryView({ workoutDayId }: Props) {
  const isOnline = useOnlineStatus()
  const { data: workoutDayName } = useWorkoutDayName(workoutDayId)
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useSessionTypeHistory(workoutDayId)
  // History converts to the global Settings unit for display (SPEC §8.1).
  const { unit: weightUnit, toDisplayVolume } = useWeightDisplay()
  const columns = useMemo(() => buildColumns(weightUnit, toDisplayVolume), [weightUnit, toDisplayVolume])

  const rows = useMemo(() => data?.pages.flatMap((p) => p.rows) ?? [], [data])

  const chartData = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((r) => ({
          date: format(parseISO(r.date), 'MMM d'),
          volume: r.totalVolume !== null ? toDisplayVolume(r.totalVolume) : 0,
          isDeload: r.isDeload,
        })),
    [rows, toDisplayVolume],
  )

  const deloadDates = useMemo(
    () => chartData.filter((p) => p.isDeload).map((p) => p.date),
    [chartData],
  )

  // Online-only, same as ExerciseHistoryView — this view's source table
  // isn't mirrored in Dexie (TASKS.md §2.6's risk section).
  if (!isOnline) {
    return (
      <div
        className="mt-6 rounded-xl p-8 text-center"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p
          className="text-sm font-bold"
          style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
        >
          REQUIRES A CONNECTION
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Session-type history isn't cached offline — reconnect to view it.
        </p>
      </div>
    )
  }

  return (
    <div>
      <h1
        className="text-2xl font-black tracking-tight mt-2"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        {workoutDayName ?? 'SESSION TYPE'}
      </h1>
      <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
        EVERY OCCURRENCE
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full animate-spin"
            style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
          />
        </div>
      ) : rows.length === 0 ? (
        <div
          className="mt-6 rounded-xl p-8 text-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p
            className="text-sm font-bold"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            NO HISTORY YET
          </p>
        </div>
      ) : (
        <>
          {chartData.length >= 2 && (
            <div className="mt-6">
              <p
                className="text-xs font-bold tracking-widest mb-3"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                VOLUME TREND
              </p>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={chartData} margin={CHART_MARGIN}>
                  {deloadDates.map((d) => (
                    <ReferenceArea
                      key={d}
                      x1={d}
                      x2={d}
                      fill="var(--accent)"
                      fillOpacity={0.07}
                      strokeOpacity={0}
                    />
                  ))}
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={TICK}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={TICK} axisLine={false} tickLine={false} width={36} />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(p: any) => (
                      <VolumeTooltip active={p.active} payload={p.payload} label={p.label} />
                    )}
                    cursor={{ fill: 'var(--surface-raised)' }}
                  />
                  <Bar dataKey="volume" fill="var(--accent)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mt-6 mb-2">
            <p
              className="text-xs font-bold tracking-widest mb-3"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              EVERY OCCURRENCE
            </p>
            <HistoryDataTable
              columns={columns}
              rows={rows}
              getRowKey={(r) => r.sessionId}
              emptyLabel="NO OCCURRENCES"
            />
          </div>

          {hasNextPage && (
            <button
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
              className="w-full mt-3 py-2.5 rounded-xl text-xs font-bold"
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                fontFamily: 'var(--font-mono)',
                opacity: isFetchingNextPage ? 0.5 : 1,
              }}
            >
              {isFetchingNextPage ? 'LOADING…' : 'LOAD MORE'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
