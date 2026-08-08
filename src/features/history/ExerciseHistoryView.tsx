import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ResponsiveContainer,
  ComposedChart,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useExercises } from '../library/useExercises'
import { useMesos } from '../programs/useMesos'
import { useExerciseSetHistory } from './useHistory'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { groupByParent } from '../gym/setGroupLogic'
import HistoryDataTable, { type HistoryDataTableColumn } from './HistoryDataTable'

// SPEC §7 "Exercise, all time": a trend chart plus an exact per-set table,
// filterable by meso, deload weeks marked. Sourced from v2_exercise_set_history
// (TASKS.md §2.6 / Phase 3.4 item 21) — one row per set, paginated.

const CHART_MARGIN = { top: 8, right: 8, left: -24, bottom: 0 }
const TICK = { fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' } as const
const TT_STYLE = {
  backgroundColor: 'var(--surface-overlay)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  padding: '8px 12px',
  fontFamily: 'var(--font-mono)',
} as const

// Recharts v3 removed payload/label from the content-prop type (context-only) —
// same minimal shape as ExerciseProgress.tsx / MesoProgress.tsx use.
interface ChartTip {
  active?: boolean
  payload?: Array<{ value?: number | null }>
  label?: string | number
}

function WeightTooltip({ active, payload, label }: ChartTip) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  if (val === undefined || val === null) return null
  return (
    <div style={TT_STYLE}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>{label}</p>
      <p style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 700 }}>{val} kg</p>
    </div>
  )
}

interface DisplayRow {
  key: string
  date: string
  isStage: boolean
  setLabel: string
  weight: number | null
  reps: number | null
  rir: number | null
  isSkipped: boolean
}

const COLUMNS: HistoryDataTableColumn<DisplayRow>[] = [
  { key: 'date', header: 'DATE', render: (r) => format(parseISO(r.date), 'MMM d, yy') },
  {
    key: 'set',
    header: 'SET',
    render: (r) => <span style={{ paddingLeft: r.isStage ? 10 : 0 }}>{r.setLabel}</span>,
  },
  {
    key: 'weight',
    header: 'WEIGHT',
    align: 'right',
    render: (r) => (r.isSkipped || r.weight === null ? '—' : `${r.weight}`),
  },
  {
    key: 'reps',
    header: 'REPS',
    align: 'right',
    render: (r) => (r.isSkipped || r.reps === null ? '—' : `${r.reps}`),
  },
  { key: 'rir', header: 'RIR', align: 'right', render: (r) => (r.rir !== null ? `${r.rir}` : '—') },
]

interface Props {
  exerciseId: string
}

export default function ExerciseHistoryView({ exerciseId }: Props) {
  const isOnline = useOnlineStatus()
  const { data: exercises = [] } = useExercises(true)
  const exercise = exercises.find((ex) => ex.id === exerciseId) ?? null
  const { data: mesos = [] } = useMesos()
  const [mesoFilter, setMesoFilter] = useState('')

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useExerciseSetHistory(exerciseId)

  const allRows = useMemo(() => data?.pages.flatMap((p) => p.rows) ?? [], [data])
  const filteredRows = useMemo(
    () => (mesoFilter ? allRows.filter((r) => r.mesocycleId === mesoFilter) : allRows),
    [allRows, mesoFilter],
  )

  // Grouped for the table — a drop stage nests under its head instead of
  // appearing as its own row, reusing setGroupLogic.ts's groupByParent
  // (TASKS.md §4 item 21 — "not a fourth hand-rolled grouping implementation").
  const groups = useMemo(
    () =>
      groupByParent(
        filteredRows,
        (r) => r.id,
        (r) => r.parentSetId,
        (r) => r.stageIndex,
      ),
    [filteredRows],
  )

  const displayRows = useMemo<DisplayRow[]>(() => {
    const out: DisplayRow[] = []
    for (const group of groups) {
      out.push({
        key: group.head.id,
        date: group.head.date,
        isStage: false,
        setLabel: `${group.head.setNumber}`,
        weight: group.head.weight,
        reps: group.head.reps,
        rir: group.head.rir,
        isSkipped: group.head.isSkipped,
      })
      for (const stage of group.stages) {
        out.push({
          key: stage.id,
          date: stage.date,
          isStage: true,
          setLabel: 'STAGE',
          weight: stage.weight,
          reps: stage.reps,
          rir: stage.rir,
          isSkipped: stage.isSkipped,
        })
      }
    }
    return out
  }, [groups])

  // Chart: top (head, non-warmup, non-skipped) weight per session, oldest to
  // newest within the currently loaded window — same trend role as
  // ExerciseProgress.tsx's chart, but across all history instead of one meso.
  const chartData = useMemo(() => {
    const bySession = new Map<string, { date: string; weight: number; isDeload: boolean }>()
    for (const group of groups) {
      const head = group.head
      if (head.isSkipped || head.isWarmup || head.weight === null) continue
      const existing = bySession.get(head.sessionId)
      if (!existing || head.weight > existing.weight) {
        bySession.set(head.sessionId, {
          date: head.date,
          weight: head.weight,
          isDeload: head.isDeload,
        })
      }
    }
    return [...bySession.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({ date: format(parseISO(p.date), 'MMM d'), weight: p.weight, isDeload: p.isDeload }))
  }, [groups])

  const deloadDates = useMemo(
    () => chartData.filter((p) => p.isDeload).map((p) => p.date),
    [chartData],
  )

  // The views this screen reads from are online-only (Dexie doesn't mirror
  // them, TASKS.md §2.6's risk section) — an explicit empty state instead of
  // a spinner that never resolves once the connection actually drops.
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
          Exercise history isn't cached offline — reconnect to view it.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mt-2">
        <h1
          className="text-2xl font-black tracking-tight"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          {exercise?.name ?? 'EXERCISE'}
        </h1>
        {exercise && (
          <span
            className="text-xs font-bold tracking-widest shrink-0"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {exercise.muscleGroup?.toUpperCase() ?? 'OTHER'}
          </span>
        )}
      </div>

      {mesos.length > 0 && (
        <select
          value={mesoFilter}
          onChange={(e) => setMesoFilter(e.target.value)}
          className="w-full mt-4 px-3 py-2.5 rounded-xl text-sm outline-none appearance-none"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          <option value="">ALL MESOS</option>
          {mesos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name.toUpperCase()}
            </option>
          ))}
        </select>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full animate-spin"
            style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
          />
        </div>
      ) : displayRows.length === 0 ? (
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
                TOP WEIGHT TREND
              </p>
              <ResponsiveContainer width="100%" height={180}>
                <ComposedChart data={chartData} margin={CHART_MARGIN}>
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
                      <WeightTooltip active={p.active} payload={p.payload} label={p.label} />
                    )}
                    cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    dot={{ fill: 'var(--accent)', r: 3, strokeWidth: 0 }}
                    activeDot={{ r: 5, strokeWidth: 0, fill: 'var(--accent)' }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mt-6 mb-2">
            <p
              className="text-xs font-bold tracking-widest mb-3"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              EVERY SET
            </p>
            <HistoryDataTable
              columns={COLUMNS}
              rows={displayRows}
              getRowKey={(r) => r.key}
              getRowStyle={(r) => (r.isStage ? { opacity: 0.65 } : undefined)}
              emptyLabel="NO SETS"
            />
          </div>
        </>
      )}

      {/* Sibling of the empty-state branch above, not nested inside it
          (found by adversarial review) — the meso filter can empty
          displayRows down to the loaded page(s) while hasNextPage is still
          true, and this button is the only way to reach further-back pages
          that might match. Same pattern HistoryPage.tsx already uses. */}
      {!isLoading && hasNextPage && (
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
    </div>
  )
}
