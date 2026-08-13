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
import { useExercises } from '../library/useExercises'
import { useMesos } from '../programs/useMesos'
import { useExerciseSetHistory } from './useHistory'
import { useExerciseProgress, usePositionMatchTable } from '../progress/useProgress'
import type { PositionMatchSetValue } from '../progress/positionMatch'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { groupByParent } from '../gym/setGroupLogic'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
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

function buildColumns(weightUnit: string): HistoryDataTableColumn<DisplayRow>[] {
  return [
    { key: 'date', header: 'DATE', render: (r) => format(parseISO(r.date), 'MMM d, yy') },
    {
      key: 'set',
      header: 'SET',
      render: (r) => <span style={{ paddingLeft: r.isStage ? 10 : 0 }}>{r.setLabel}</span>,
    },
    {
      key: 'weight',
      header: `WEIGHT (${weightUnit.toUpperCase()})`,
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
}

// ─── Side by side (position-matched table, CONTEXT.md "Position-matched
// multi-session table") — a third view of the same data: every session as a
// column, "the Nth plain set logged" / "the Nth dropset logged" as
// independently-numbered rows, reusing progressService.ts's
// fetchPositionMatchTable / positionMatch.ts's buildPositionMatchTable
// directly rather than re-deriving the plain/dropset slot model a third
// time in this file.

interface PositionMatchDisplayRow {
  key: string
  label: string
  isStage: boolean
  cells: (PositionMatchSetValue | null)[] // aligned with the table's own sessions[] order
}

// Compact "weight×reps@RIR" notation — the same convention
// ExerciseReference.tsx's SetLine already uses (no unit suffix, "@RIR" only
// when recorded), not a fourth notation invented for this table.
// --text-muted, not --text-dim (found by adversarial review: --text-dim is
// this codebase's disabled/placeholder token, ~1.7:1 contrast in dark mode —
// far below legible for an empty cell here, which is meaningful data ("this
// session didn't reach this position"), not decoration).
function formatCompactCell(value: PositionMatchSetValue | null, toDisplay: (kg: number) => number) {
  if (!value || value.weight === null) {
    return <span style={{ color: 'var(--text-muted)' }}>—</span>
  }
  return (
    <span style={{ color: 'var(--text-primary)' }}>
      {toDisplay(value.weight)}
      <span style={{ color: 'var(--text-muted)' }}>×</span>
      {value.reps ?? '—'}
      {value.rir != null && (
        <span style={{ color: 'var(--text-muted)' }}>@{value.rir}</span>
      )}
    </span>
  )
}

// Found by adversarial review: passing every session an exercise has ever
// been logged in (the "ALL MESOS" / no-active-meso case) to
// fetchPositionMatchTable means one fetchSession call per session — a real,
// long-trained exercise can have 100+. Capped here (the caller's own
// concern — "which sessions" is this component's job, not the fetch layer's)
// to the most recent N; progressService.ts's fetchSessionsBatched is
// separate defence-in-depth for whatever count does get passed through.
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

  // SIDE BY SIDE table data source — see the fuller comment below. Called
  // here (ahead of the meso-defaulting effect) because that effect needs
  // e1rmSessions to decide whether defaulting to the active meso is safe.
  const { data: progressData } = useExerciseProgress(exerciseId)

  // The SIDE BY SIDE table (below) is scoped to the active meso by default —
  // a position-matched comparison is only meaningful within one program's
  // sessions, not a pile of unrelated ones. This is the one shared filter
  // both the existing EVERY SET table/chart and the new table read, so
  // defaulting it also changes their initial view.
  //
  // Found by adversarial review: defaulting unconditionally the moment an
  // active meso exists — regardless of whether this exercise has ever been
  // logged in it — silently collapsed the pre-existing EVERY SET table and
  // TOP WEIGHT TREND chart to "NO HISTORY YET" for any exercise not yet
  // logged this meso (the single most common reason to check an exercise's
  // history: right before doing it again). Fixed by only defaulting when the
  // active meso actually has at least one eligible session for *this*
  // exercise (checked against e1rmSessions, not the paginated EVERY SET rows,
  // since that's the complete, non-paginated list) — guaranteeing the default
  // never empties a view that would otherwise have shown real data. Still a
  // one-time default (never re-applied, so it never clobbers a user's own
  // later choice, including explicitly picking ALL MESOS back); falls back to
  // the prior ALL MESOS default whenever there's no active meso, or the
  // active meso has nothing for this exercise yet — both unchanged from
  // before this feature.
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
  const columns = useMemo(() => buildColumns(weightUnit), [weightUnit])

  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useExerciseSetHistory(exerciseId)

  // SIDE BY SIDE table data — a separate query from the paginated EVERY SET
  // rows above: it needs every session's own *ordered* SetLog rows (setNumber/
  // stageIndex/parentSetId) to build slots, which the flat set-history rows
  // can't provide (same reasoning progressService.ts's
  // fetchPositionMatchedHeadline already documents for the pairwise case).
  // useExerciseProgress's e1rmSessions is reused for the session id/date/
  // mesocycleId list only (already fetched, already chronological, already
  // complete — not gated by this page's own EVERY SET pagination).
  //
  // Note this means SIDE BY SIDE and EVERY SET can legitimately disagree on
  // session count: e1rmSessions (progressService.ts's fetchExerciseProgress)
  // excludes a session where every set of this exercise was skipped, before
  // it ever becomes an entry — so that session never becomes a SIDE BY SIDE
  // column, even though it still appears as a dashed-out row in EVERY SET
  // (a different, unfiltered query). Deliberate: an all-empty column here
  // would be pure noise, and re-deriving a different inclusion rule would
  // drift from the exclusion fetchExerciseProgress already applies elsewhere.
  //
  // Capped to the most recent MAX_TABLE_SESSIONS (found by adversarial
  // review — see fetchPositionMatchTable's own comment for why an unbounded
  // count is a real cost, not just a hypothetical one).
  const tableSessions = useMemo(() => {
    if (!progressData) return []
    const scoped = mesoFilter
      ? progressData.e1rmSessions.filter((s) => s.mesocycleId === mesoFilter)
      : progressData.e1rmSessions
    return scoped.slice(-MAX_TABLE_SESSIONS).map((s) => ({ sessionId: s.sessionId, date: s.date }))
  }, [progressData, mesoFilter])
  const truncatedTableSessionCount = useMemo(() => {
    if (!progressData) return 0
    const scoped = mesoFilter
      ? progressData.e1rmSessions.filter((s) => s.mesocycleId === mesoFilter)
      : progressData.e1rmSessions
    return Math.max(0, scoped.length - MAX_TABLE_SESSIONS)
  }, [progressData, mesoFilter])
  const {
    data: positionMatchTable,
    isLoading: isPositionMatchLoading,
    isError: isPositionMatchError,
  } = usePositionMatchTable(exerciseId, tableSessions.length > 0 ? tableSessions : null)

  const positionMatchRows = useMemo<PositionMatchDisplayRow[]>(() => {
    if (!positionMatchTable) return []
    const out: PositionMatchDisplayRow[] = []
    for (const row of positionMatchTable.plain) {
      out.push({
        key: `plain-${row.slotIndex}`,
        label: `SET ${row.slotIndex}`,
        isStage: false,
        cells: row.cells.map((c) => c.value),
      })
    }
    for (const row of positionMatchTable.dropsets) {
      out.push({
        key: `drop-${row.slotIndex}-head`,
        label: `DROP ${row.slotIndex}`,
        isStage: false,
        cells: row.head.cells.map((c) => c.value),
      })
      row.stages.forEach((stageRow, i) => {
        out.push({
          key: `drop-${row.slotIndex}-stage-${i}`,
          label: row.stages.length > 1 ? `STAGE ${i + 1}` : 'STAGE',
          isStage: true,
          cells: stageRow.cells.map((c) => c.value),
        })
      })
    }
    return out
  }, [positionMatchTable])

  const positionMatchColumns = useMemo<HistoryDataTableColumn<PositionMatchDisplayRow>[]>(() => {
    if (!positionMatchTable) return []
    return [
      {
        key: 'label',
        header: 'SET',
        render: (r) => <span style={{ paddingLeft: r.isStage ? 10 : 0 }}>{r.label}</span>,
      },
      ...positionMatchTable.sessions.map((s, i) => ({
        key: s.sessionId,
        // Includes the year, matching buildColumns' own DATE column above
        // (found by adversarial review — 'MMM d' alone can't disambiguate
        // two sessions a year apart under ALL MESOS, e.g. two "Jan 15"s).
        header: format(parseISO(s.date), 'MMM d, yy'),
        align: 'right' as const,
        render: (r: PositionMatchDisplayRow) => formatCompactCell(r.cells[i], toDisplay),
      })),
    ]
  }, [positionMatchTable, toDisplay])

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
        weight: group.head.weight !== null ? toDisplay(group.head.weight) : null,
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
          weight: stage.weight !== null ? toDisplay(stage.weight) : null,
          reps: stage.reps,
          rir: stage.rir,
          isSkipped: stage.isSkipped,
        })
      }
    }
    return out
  }, [groups, toDisplay])

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
      .map((p) => ({ date: format(parseISO(p.date), 'MMM d'), weight: toDisplay(p.weight), isDeload: p.isDeload }))
  }, [groups, toDisplay])

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

          <div className="mt-6 mb-2">
            <p
              className="text-xs font-bold tracking-widest mb-3"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              EVERY SET
            </p>
            <HistoryDataTable
              columns={columns}
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

      {/* SIDE BY SIDE — third view of the same data (position-matched table,
          CONTEXT.md "Position-matched multi-session table"). Independent data
          source/gating from the EVERY SET table above (progressService.ts's
          fetchPositionMatchTable via useExerciseProgress, not the paginated
          set-history rows) — same "chart only renders once it has enough
          data" precedent as TOP WEIGHT TREND above, not nested inside the
          EVERY SET empty/loading branches. */}
      {isOnline && tableSessions.length > 0 && (
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
            // Found by adversarial review: a failed fetch used to resolve to
            // the exact same "NO SETS" empty state as genuinely-empty data,
            // indistinguishable to the user. Distinct message + no silent
            // "nothing here" claim when the real cause is a fetch failure.
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
                getRowStyle={(r) => (r.isStage ? { opacity: 0.65 } : undefined)}
                emptyLabel="NO SETS"
              />
              {truncatedTableSessionCount > 0 && (
                <p
                  className="mt-2 text-xs"
                  style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
                >
                  Showing the most recent {MAX_TABLE_SESSIONS} sessions ({truncatedTableSessionCount}{' '}
                  older not shown)
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
