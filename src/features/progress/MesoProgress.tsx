import { useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ResponsiveContainer,
  LineChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceArea,
} from 'recharts'
import { useMesos } from '../programs/useMesos'
import { useMesoWeeklyProgress } from './useProgress'
import { formatRestTime } from '../../lib/formatRestTime'

// ─── Shared chart constants ───────────────────────────────────────────────────

const CHART_MARGIN = { top: 8, right: 8, left: -24, bottom: 0 }
const TICK = { fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' } as const

const TT_STYLE = {
  backgroundColor: 'var(--surface-overlay)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  padding: '8px 12px',
  fontFamily: 'var(--font-mono)',
} as const

// ─── Generic tooltip used by all meso charts ──────────────────────────────────

// Recharts v3 removed payload/label from content-prop types; define shape manually.
interface MesoTip {
  active?: boolean
  payload?: Array<{ value?: number | null }>
  label?: string | number
  unit: string
  formatValue?: (v: number) => string
}

function MesoTooltip({ active, payload, label, unit, formatValue }: MesoTip) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  if (val === undefined || val === null) return null
  return (
    <div style={TT_STYLE}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>{label}</p>
      <p style={{ color: 'var(--text-primary)', fontSize: 12, fontWeight: 700 }}>
        {formatValue && typeof val === 'number'
          ? formatValue(val)
          : `${typeof val === 'number' ? Math.round(val * 10) / 10 : val}${unit ? ` ${unit}` : ''}`}
      </p>
    </div>
  )
}

// ─── Deload reference areas (shared across charts) ────────────────────────────

function DeloadAreas({ weeks }: { weeks: string[] }) {
  return (
    <>
      {weeks.map((wk) => (
        <ReferenceArea
          key={wk}
          x1={wk}
          x2={wk}
          fill="var(--accent)"
          fillOpacity={0.07}
          strokeOpacity={0}
          label={undefined}
        />
      ))}
    </>
  )
}

// ─── Mini chart: sets per week (bar) ─────────────────────────────────────────

function SetsBarChart({
  data,
  deloadWeeks,
}: {
  data: Record<string, unknown>[]
  deloadWeeks: string[]
}) {
  return (
    <div>
      <p
        className="text-xs font-bold tracking-widest mb-3"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        TOTAL SETS / WEEK
      </p>
      <ResponsiveContainer width="100%" height={140}>
        <BarChart data={data} margin={CHART_MARGIN}>
          <DeloadAreas weeks={deloadWeeks} />
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="week" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis tick={TICK} axisLine={false} tickLine={false} width={28} allowDecimals={false} />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content={(p: any) => <MesoTooltip active={p.active} payload={p.payload} label={p.label} unit="sets" />}
            cursor={{ fill: 'var(--border)', opacity: 0.4 }}
          />
          <Bar dataKey="sets" fill="var(--accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Mini chart: line metric ──────────────────────────────────────────────────

function MetricLineChart({
  title,
  data,
  dataKey,
  deloadWeeks,
  unit,
  color = 'var(--text-secondary)',
  tickFormatter,
  formatValue,
}: {
  title: string
  data: Record<string, unknown>[]
  dataKey: string
  deloadWeeks: string[]
  unit: string
  color?: string
  tickFormatter?: (v: number) => string
  formatValue?: (v: number) => string
}) {
  return (
    <div>
      <p
        className="text-xs font-bold tracking-widest mb-3"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        {title}
      </p>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={data} margin={CHART_MARGIN}>
          <DeloadAreas weeks={deloadWeeks} />
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="week" tick={TICK} axisLine={false} tickLine={false} />
          <YAxis
            tick={TICK}
            axisLine={false}
            tickLine={false}
            width={36}
            domain={[0, 'auto']}
            tickFormatter={tickFormatter}
          />
          <Tooltip
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content={(p: any) => <MesoTooltip active={p.active} payload={p.payload} label={p.label} unit={unit} formatValue={formatValue} />}
            cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
          />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={{ fill: color, r: 3.5, strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0, fill: color }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function MesoProgress() {
  const { data: mesos = [], isLoading: mesosLoading } = useMesos()
  const activeMeso = mesos.find((m) => m.status === 'active') ?? null
  const [overrideMesoId, setOverrideMesoId] = useState<string | null>(null)

  const selectedMesoId = overrideMesoId ?? activeMeso?.id ?? mesos[0]?.id ?? null
  const selectedMeso = mesos.find((m) => m.id === selectedMesoId) ?? null

  const { data: weeks = [], isLoading: weeksLoading } = useMesoWeeklyProgress(
    selectedMesoId,
    selectedMeso?.startDate ?? null,
  )

  const chartData = useMemo(
    () =>
      weeks.map((w) => ({
        week: `W${w.weekNumber}`,
        sets: w.totalSets,
        rir: w.avgRir !== null ? Math.round(w.avgRir * 10) / 10 : null,
        reps: w.avgReps !== null ? Math.round(w.avgReps * 10) / 10 : null,
        rest: w.avgRestSeconds !== null ? Math.round(w.avgRestSeconds) : null,
      })),
    [weeks],
  )

  const deloadWeeks = useMemo(
    () => weeks.filter((w) => w.isDeload).map((w) => `W${w.weekNumber}`),
    [weeks],
  )

  const hasRir = weeks.some((w) => w.avgRir !== null)
  const hasReps = weeks.some((w) => w.avgReps !== null)
  const hasRest = weeks.some((w) => w.avgRestSeconds !== null)

  if (mesosLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div
          className="w-5 h-5 rounded-full animate-spin"
          style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
        />
      </div>
    )
  }

  if (mesos.length === 0) {
    return (
      <div
        className="mt-6 rounded-xl p-8 text-center"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p
          className="text-sm font-bold"
          style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
        >
          NO MESOCYCLES YET
        </p>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Start a mesocycle in the Program tab to track progress.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Meso selector */}
      <div className="mt-4">
        <select
          value={selectedMesoId ?? ''}
          onChange={(e) => setOverrideMesoId(e.target.value || null)}
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none appearance-none"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {mesos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.status === 'active'
                ? ' (active)'
                : ` · ${format(parseISO(m.startDate), 'MMM yyyy')}`}
            </option>
          ))}
        </select>
      </div>

      {/* Deload legend */}
      {deloadWeeks.length > 0 && (
        <div className="flex items-center gap-2 mt-3">
          <div
            className="w-3 h-3 rounded-sm"
            style={{ backgroundColor: 'var(--accent)', opacity: 0.25 }}
          />
          <p
            className="text-xs"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            DELOAD WEEK
          </p>
        </div>
      )}

      {weeksLoading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full animate-spin"
            style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
          />
        </div>
      ) : weeks.length === 0 ? (
        <div
          className="mt-6 rounded-xl p-8 text-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p
            className="text-sm font-bold"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            NO COMPLETED WEEKS YET
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Complete sessions across a full week to see your meso overview.
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          <SetsBarChart data={chartData} deloadWeeks={deloadWeeks} />

          {hasRir && (
            <MetricLineChart
              title="AVG RIR / WEEK"
              data={chartData}
              dataKey="rir"
              deloadWeeks={deloadWeeks}
              unit=""
              color="var(--text-secondary)"
            />
          )}

          {hasReps && (
            <MetricLineChart
              title="AVG REPS / WEEK"
              data={chartData}
              dataKey="reps"
              deloadWeeks={deloadWeeks}
              unit="reps"
              color="var(--text-secondary)"
            />
          )}

          {hasRest && (
            <MetricLineChart
              title="AVG REST TIME / WEEK"
              data={chartData}
              dataKey="rest"
              deloadWeeks={deloadWeeks}
              unit="s"
              color="var(--text-muted)"
              tickFormatter={formatRestTime}
              formatValue={formatRestTime}
            />
          )}
        </div>
      )}
    </div>
  )
}
