import { useEffect, useMemo, useState } from 'react'
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
import { ArrowUp, ArrowDown } from 'lucide-react'
import { useExercises } from '../library/useExercises'
import { useMesos } from '../programs/useMesos'
import { useExerciseProgress, usePositionMatchTable } from '../progress/useProgress'
import type { PositionMatchTableRow } from '../progress/positionMatch'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import HistoryDataTable, { type HistoryDataTableColumn } from './HistoryDataTable'

// SPEC §7 "Exercise, all time": a trend chart plus a position-matched
// session-by-session table, filterable by meso (incl. an all-time/ALL MESOS
// option), deload weeks marked. Both sourced from progressService.ts's
// fetchExerciseProgress/fetchPositionMatchTable (v2_set_logs directly) — the
// former EVERY SET table (v2_exercise_set_history-backed, one row per set)
// was deleted once SIDE BY SIDE was confirmed to genuinely cover the same
// ground; see CONTEXT.md "History: Sessions/Exercises tab split".

const CHART_MARGIN = { top: 8, right: 8, left: 0, bottom: 0 }
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

function WeightTooltip({ active, payload, label, unit }: ChartTip & { unit: string }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  if (val === undefined || val === null) return null
  return (
    <div style={TT_STYLE}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>{label}</p>
      <p style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 700 }}>{val} {unit}</p>
    </div>
  )
}

// ─── Side by side (position-matched table, CONTEXT.md "Position-matched
// multi-session table") — every session as a column, "the Nth plain set
// logged" / "the Nth dropset logged" as independently-numbered row groups,
// reusing progressService.ts's fetchPositionMatchTable / positionMatch.ts's
// buildPositionMatchTable directly rather than re-deriving the plain/dropset
// slot model a third time in this file.
//
// Each position is a row *group* (CONTEXT.md "SIDE BY SIDE row redesign"):
// a header row carrying the label (SET N / DROP N / STAGE), then three
// metric sub-rows (WEIGHT, REPS, RIR) each independently showing its own
// up/down arrow against the immediately preceding column actually shown in
// the table — no combined judgment, each metric's arrow reflects only its
// own value. Weight/reps are colored (green up, red down); RIR's arrow is
// never colored — a lower RIR is often the program working as intended, not
// regression, so no verdict is implied there.

interface PositionMatchDisplayRow {
  key: string
  kind: 'header' | 'metric'
  label: string
  indent: number
  metric?: 'weight' | 'reps' | 'rir'
  cells: (number | null)[] // aligned with the table's own sessions[] order; only meaningful for kind === 'metric'
}

function arrowDirection(curr: number | null, prev: number | null): 'up' | 'down' | null {
  if (curr == null || prev == null) return null
  if (curr > prev) return 'up'
  if (curr < prev) return 'down'
  return null
}

// colored=false for RIR — arrow shown for direction, never colored (see the
// file-level comment above for why). The first column, and any column whose
// immediately preceding one lacks a value for this exact metric, has
// prevValue null and therefore renders no arrow at all.
function MetricCell({
  value,
  prevValue,
  colored,
}: {
  value: number | null
  prevValue: number | null
  colored: boolean
}) {
  if (value == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>
  const dir = arrowDirection(value, prevValue)
  const arrowColor = colored ? (dir === 'up' ? 'var(--success)' : 'var(--error)') : 'var(--text-secondary)'
  return (
    <span style={{ color: 'var(--text-primary)' }}>
      {value}
      {dir && (
        <span
          style={{ color: arrowColor, marginLeft: 3, display: 'inline-flex', verticalAlign: 'middle' }}
        >
          {dir === 'up' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
        </span>
      )}
    </span>
  )
}

// Found by adversarial review: passing every session an exercise has ever
// been logged in (the "ALL MESOS" / no-active-meso case) to
// fetchPositionMatchTable means one fetchSession call per session — a real,
// long-trained exercise can have 100+. Also the initial page size / LOAD
// MORE increment for the table's own session window (below) — reusing one
// constant for both keeps "how many at a time" consistent in both
// directions. fetchSessionsBatched (progressService.ts) chunks the actual
// requests in batches of 8 regardless of how high sessionLimit climbs, so
// repeated LOAD MORE taps stay safe by construction, not just by convention.
const MAX_TABLE_SESSIONS = 30

interface Props {
  exerciseId: string
}

export default function ExerciseHistoryView({ exerciseId }: Props) {
  const isOnline = useOnlineStatus()
  const { data: exercises = [] } = useExercises(true)
  const exercise = exercises.find((ex) => ex.id === exerciseId) ?? null
  const { data: mesos = [] } = useMesos()
  const [mesoFilter, setMesoFilter] = useState('')

  // Primary data source for this whole view — the chart and the SIDE BY
  // SIDE table's session list both come from here.
  const { data: progressData, isLoading: isProgressLoading, isError: isProgressError } =
    useExerciseProgress(exerciseId)

  // Scoped to the active meso by default — a position-matched comparison is
  // most useful within one program's sessions by default, but switchable to
  // ALL MESOS (all-time, cross-meso) via the same select below — the page's
  // one shared meso filter, same "ALL MESOS" pattern History's own session
  // list (HistorySessions.tsx) already uses, not a second selector built for
  // this view.
  //
  // Found by adversarial review: defaulting unconditionally the moment an
  // active meso exists — regardless of whether this exercise has ever been
  // logged in it — silently collapsed the view to "NO HISTORY YET" for any
  // exercise not yet logged this meso (the single most common reason to
  // check an exercise's history: right before doing it again). Fixed by only
  // defaulting when the active meso actually has at least one eligible
  // session for *this* exercise (checked against e1rmSessions) —
  // guaranteeing the default never empties a view that would otherwise have
  // shown real data. Still a one-time default (never re-applied, so it never
  // clobbers a user's own later choice, including explicitly picking ALL
  // MESOS back); falls back to ALL MESOS whenever there's no active meso, or
  // the active meso has nothing for this exercise yet.
  const [mesoFilterDefaulted, setMesoFilterDefaulted] = useState(false)
  useEffect(() => {
    if (mesoFilterDefaulted || mesos.length === 0) return
    const active = mesos.find((m) => m.status === 'active')
    if (!active) {
      setMesoFilterDefaulted(true)
      return
    }
    if (!progressData) return // wait for the data needed to judge whether defaulting is safe
    const activeMesoHasData = progressData.e1rmSessions.some((s) => s.mesocycleId === active.id)
    if (activeMesoHasData) setMesoFilter(active.id)
    setMesoFilterDefaulted(true)
  }, [mesos, progressData, mesoFilterDefaulted])

  // History converts to the global Settings unit for display (SPEC §8.1) —
  // same as Progress, independent of whatever unit any individual
  // program-exercise was logged in.
  const { unit: weightUnit, toDisplay } = useWeightDisplay()

  // How many of the current scope's sessions (oldest end first, most recent
  // MAX_TABLE_SESSIONS by default) feed the SIDE BY SIDE table — expandable
  // via LOAD MORE rather than a fixed ceiling, so ALL MESOS can genuinely
  // reach every session an exercise has ever been logged in, the same way
  // EVERY SET's own pagination used to. Reset back to the default window
  // whenever the scope itself changes, so switching mesos doesn't carry over
  // an inflated limit from a previous, larger scope.
  const [sessionLimit, setSessionLimit] = useState(MAX_TABLE_SESSIONS)
  useEffect(() => {
    setSessionLimit(MAX_TABLE_SESSIONS)
  }, [mesoFilter])

  const scopedSessions = useMemo(() => {
    if (!progressData) return []
    return mesoFilter
      ? progressData.e1rmSessions.filter((s) => s.mesocycleId === mesoFilter)
      : progressData.e1rmSessions
  }, [progressData, mesoFilter])

  // Chart: top (head, non-warmup, non-skipped) weight per session, oldest to
  // newest within the current scope — same trend role the chart has always
  // had, now sourced from progressData directly instead of EVERY SET's
  // separate row fetch. e1rmSessions is already sorted ascending by date
  // (progressService.ts), and each session's own `sets` already excludes
  // stage-of-skipped-head rows and anything without weight/reps, so only the
  // head/warmup/skip filter needs re-applying here — the same rule the old
  // EVERY SET-sourced version used.
  const chartData = useMemo(() => {
    const points: { date: string; weight: number; isDeload: boolean }[] = []
    for (const session of scopedSessions) {
      const headSets = session.sets.filter(
        (s) => s.parentSetId == null && !s.isSkipped && !s.isWarmup && s.weight !== null,
      )
      if (headSets.length === 0) continue
      const topWeight = Math.max(...headSets.map((s) => s.weight!))
      points.push({ date: session.date, weight: toDisplay(topWeight), isDeload: session.isDeload })
    }
    return points.map((p) => ({ ...p, date: format(parseISO(p.date), 'MMM d') }))
  }, [scopedSessions, toDisplay])

  const deloadDates = useMemo(
    () => chartData.filter((p) => p.isDeload).map((p) => p.date),
    [chartData],
  )

  // SIDE BY SIDE table session window — capped/expandable slice of the
  // current scope, most recent first (see sessionLimit above).
  const tableSessions = useMemo(
    () => scopedSessions.slice(-sessionLimit).map((s) => ({ sessionId: s.sessionId, date: s.date })),
    [scopedSessions, sessionLimit],
  )
  const truncatedTableSessionCount = Math.max(0, scopedSessions.length - sessionLimit)

  const {
    data: positionMatchTable,
    isLoading: isPositionMatchLoading,
    isFetching: isPositionMatchFetching,
    isError: isPositionMatchError,
  } = usePositionMatchTable(exerciseId, tableSessions.length > 0 ? tableSessions : null)

  const positionMatchRows = useMemo<PositionMatchDisplayRow[]>(() => {
    if (!positionMatchTable) return []
    const out: PositionMatchDisplayRow[] = []

    function pushGroup(keyPrefix: string, headerLabel: string, indent: number, row: PositionMatchTableRow) {
      out.push({ key: `${keyPrefix}-header`, kind: 'header', label: headerLabel, indent, cells: [] })
      out.push({
        key: `${keyPrefix}-weight`,
        kind: 'metric',
        metric: 'weight',
        label: `WEIGHT (${weightUnit.toUpperCase()})`,
        indent: indent + 1,
        cells: row.cells.map((c) => (c.value?.weight != null ? toDisplay(c.value.weight) : null)),
      })
      out.push({
        key: `${keyPrefix}-reps`,
        kind: 'metric',
        metric: 'reps',
        label: 'REPS',
        indent: indent + 1,
        cells: row.cells.map((c) => c.value?.reps ?? null),
      })
      out.push({
        key: `${keyPrefix}-rir`,
        kind: 'metric',
        metric: 'rir',
        label: 'RIR',
        indent: indent + 1,
        cells: row.cells.map((c) => c.value?.rir ?? null),
      })
    }

    for (const row of positionMatchTable.plain) {
      pushGroup(`plain-${row.slotIndex}`, `SET ${row.slotIndex}`, 0, row)
    }
    for (const row of positionMatchTable.dropsets) {
      pushGroup(`drop-${row.slotIndex}`, `DROP ${row.slotIndex}`, 0, row.head)
      row.stages.forEach((stageRow, i) => {
        const stageLabel = row.stages.length > 1 ? `STAGE ${i + 1}` : 'STAGE'
        pushGroup(`drop-${row.slotIndex}-stage-${i}`, stageLabel, 1, stageRow)
      })
    }
    return out
  }, [positionMatchTable, toDisplay, weightUnit])

  const positionMatchColumns = useMemo<HistoryDataTableColumn<PositionMatchDisplayRow>[]>(() => {
    if (!positionMatchTable) return []
    return [
      {
        key: 'label',
        header: 'SET',
        render: (r) => (
          <span style={{ paddingLeft: r.indent * 10, fontWeight: r.kind === 'header' ? 700 : 400 }}>
            {r.label}
          </span>
        ),
      },
      ...positionMatchTable.sessions.map((s, i) => ({
        key: s.sessionId,
        // Includes the year, matching the app's other "all time" date
        // columns — 'MMM d' alone can't disambiguate two sessions a year
        // apart under ALL MESOS, e.g. two "Jan 15"s.
        header: format(parseISO(s.date), 'MMM d, yy'),
        align: 'right' as const,
        render: (r: PositionMatchDisplayRow) => {
          if (r.kind === 'header') return null
          const value = r.cells[i]
          const prevValue = i > 0 ? r.cells[i - 1] : null
          return <MetricCell value={value} prevValue={prevValue} colored={r.metric !== 'rir'} />
        },
      })),
    ]
  }, [positionMatchTable])

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

      {isProgressLoading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full animate-spin"
            style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
          />
        </div>
      ) : isProgressError ? (
        <div
          className="mt-6 rounded-xl p-8 text-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p
            className="text-xs font-bold"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            COULDN'T LOAD
          </p>
        </div>
      ) : scopedSessions.length === 0 ? (
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
                      <WeightTooltip active={p.active} payload={p.payload} label={p.label} unit={weightUnit} />
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

          {/* SIDE BY SIDE — position-matched table (CONTEXT.md "Position-
              matched multi-session table"). Independent loading/error state
              from the outer progressData gate above — its own query
              (usePositionMatchTable) fetches each session's full ordered
              SetLog rows and can fail/lag separately. */}
          <div className="mt-7 mb-2">
            <p
              className="text-xs font-bold tracking-widest mb-3"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              SIDE BY SIDE
            </p>
            {isPositionMatchLoading ? (
              <div className="flex items-center justify-center py-10">
                <div
                  className="w-5 h-5 rounded-full animate-spin"
                  style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
                />
              </div>
            ) : isPositionMatchError ? (
              // Found by adversarial review: a failed fetch used to resolve
              // to the exact same "NO SETS" empty state as genuinely-empty
              // data, indistinguishable to the user. Distinct message + no
              // silent "nothing here" claim when the real cause is a fetch
              // failure.
              <div
                className="rounded-xl p-6 text-center"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <p
                  className="text-xs font-bold"
                  style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
                >
                  COULDN'T LOAD
                </p>
              </div>
            ) : (
              <>
                <HistoryDataTable
                  columns={positionMatchColumns}
                  rows={positionMatchRows}
                  getRowKey={(r) => r.key}
                  getRowStyle={(r) => (r.indent === 0 ? undefined : { opacity: r.indent === 1 ? 0.85 : 0.65 })}
                  emptyLabel="NO SETS"
                />
                {truncatedTableSessionCount > 0 && (
                  <button
                    onClick={() => setSessionLimit((l) => l + MAX_TABLE_SESSIONS)}
                    disabled={isPositionMatchFetching}
                    className="w-full mt-3 py-2.5 rounded-xl text-xs font-bold"
                    style={{
                      backgroundColor: 'var(--surface)',
                      border: '1px solid var(--border)',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)',
                      opacity: isPositionMatchFetching ? 0.5 : 1,
                    }}
                  >
                    {isPositionMatchFetching ? 'LOADING…' : `LOAD MORE (${truncatedTableSessionCount} OLDER)`}
                  </button>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
