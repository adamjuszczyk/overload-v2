import { useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import {
  ResponsiveContainer,
  ComposedChart,
  LineChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts'
import { useExercises } from '../library/useExercises'
import { useExerciseProgress } from './useProgress'
import type { Exercise, MuscleGroup } from '../../types'

// ─── Constants ────────────────────────────────────────────────────────────────

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves',
  'core', 'other',
]

const CHART_MARGIN = { top: 8, right: 8, left: -24, bottom: 0 }
const TICK = { fill: 'var(--text-muted)', fontSize: 10, fontFamily: 'var(--font-mono)' } as const

// ─── Tooltips ─────────────────────────────────────────────────────────────────

const TT_STYLE = {
  backgroundColor: 'var(--surface-overlay)',
  border: '1px solid var(--border-strong)',
  borderRadius: 8,
  padding: '8px 12px',
  fontFamily: 'var(--font-mono)',
} as const

// Recharts v3 removed payload/label from the content-prop type (they're read from context),
// so we define our own minimal shape instead of importing TooltipProps.
interface ChartTip {
  active?: boolean
  payload?: Array<{ value?: number | null; dataKey?: string }>
  label?: string | number
}

function WeightTooltip({ active, payload, label }: ChartTip) {
  if (!active || !payload?.length) return null
  const weight = payload.find((p) => p.dataKey === 'weight')?.value
  return (
    <div style={TT_STYLE}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>{label}</p>
      {weight !== undefined && weight !== null && (
        <p style={{ color: 'var(--accent)', fontSize: 13, fontWeight: 700 }}>
          {weight} kg
        </p>
      )}
    </div>
  )
}

function SimpleTooltip({ active, payload, label, unit }: ChartTip & { unit: string }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  return (
    <div style={TT_STYLE}>
      <p style={{ color: 'var(--text-muted)', fontSize: 10, marginBottom: 4 }}>{label}</p>
      {val !== undefined && val !== null && (
        <p style={{ color: 'var(--text-primary)', fontSize: 12 }}>
          {val} {unit}
        </p>
      )}
    </div>
  )
}

// ─── Exercise picker ──────────────────────────────────────────────────────────

function ExercisePicker({ onSelect }: { onSelect: (ex: Exercise) => void }) {
  const [search, setSearch] = useState('')
  const [filterGroup, setFilterGroup] = useState<MuscleGroup | null>(null)
  const { data: exercises = [] } = useExercises(false)

  const filtered = useMemo(
    () =>
      exercises
        .filter((ex) => !filterGroup || ex.muscleGroup === filterGroup)
        .filter((ex) => !search || ex.name.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [exercises, search, filterGroup],
  )

  return (
    <div className="mt-4">
      {/* Search */}
      <input
        type="search"
        placeholder="Search exercises…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
        style={{
          backgroundColor: 'var(--surface)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}
      />

      {/* Muscle group filter chips */}
      <div
        className="flex gap-1.5 mt-2 overflow-x-auto pb-1"
        style={{ scrollbarWidth: 'none' }}
      >
        <button
          onClick={() => setFilterGroup(null)}
          className="flex-none px-2.5 py-1 rounded-full text-xs font-bold tracking-wide"
          style={{
            backgroundColor: filterGroup === null ? 'var(--accent)' : 'var(--surface)',
            color: filterGroup === null ? 'var(--base)' : 'var(--text-muted)',
            border: `1px solid ${filterGroup === null ? 'var(--accent)' : 'var(--border)'}`,
            fontFamily: 'var(--font-mono)',
          }}
        >
          ALL
        </button>
        {MUSCLE_GROUPS.map((mg) => (
          <button
            key={mg}
            onClick={() => setFilterGroup(filterGroup === mg ? null : mg)}
            className="flex-none px-2.5 py-1 rounded-full text-xs font-bold tracking-wide"
            style={{
              backgroundColor: filterGroup === mg ? 'var(--accent)' : 'var(--surface)',
              color: filterGroup === mg ? 'var(--base)' : 'var(--text-muted)',
              border: `1px solid ${filterGroup === mg ? 'var(--accent)' : 'var(--border)'}`,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {mg.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Exercise list */}
      {filtered.length === 0 ? (
        <p className="mt-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No exercises found
        </p>
      ) : (
        <div
          className="mt-3 rounded-xl overflow-hidden"
          style={{ border: '1px solid var(--border)' }}
        >
          {filtered.map((ex, i) => (
            <button
              key={ex.id}
              onClick={() => onSelect(ex)}
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              style={{
                backgroundColor: 'var(--surface)',
                borderTop: i > 0 ? '1px solid var(--border)' : undefined,
              }}
            >
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {ex.name}
              </span>
              <span
                className="text-xs ml-3 flex-none"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {ex.muscleGroup.toUpperCase()}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Charts view ──────────────────────────────────────────────────────────────

function ExerciseCharts({ exercise, onBack }: { exercise: Exercise; onBack: () => void }) {
  const { data = [], isLoading } = useExerciseProgress(exercise.id)

  const chartData = useMemo(
    () =>
      data.map((p) => ({
        date: format(parseISO(p.date), 'MMM d'),
        weight: p.topWeight,
        volume: p.volume,
        rir: p.avgRir !== null ? Math.round(p.avgRir * 10) / 10 : null,
        rest: p.avgRestSeconds !== null ? Math.round(p.avgRestSeconds) : null,
      })),
    [data],
  )

  const last5 = useMemo(() => [...data].reverse().slice(0, 5), [data])
  const hasRir = data.some((p) => p.avgRir !== null)
  const hasRest = data.some((p) => p.avgRestSeconds !== null)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mt-4">
        <button
          onClick={onBack}
          className="flex-none w-9 h-9 rounded-lg flex items-center justify-center text-lg"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
        >
          ←
        </button>
        <div className="min-w-0">
          <p
            className="font-black text-lg leading-tight truncate"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {exercise.name}
          </p>
          <p
            className="text-xs"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {exercise.muscleGroup.toUpperCase()}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div
            className="w-5 h-5 rounded-full animate-spin"
            style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
          />
        </div>
      ) : data.length < 2 ? (
        <div
          className="mt-6 rounded-xl p-8 text-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p
            className="font-bold text-sm mb-2"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            NOT ENOUGH DATA YET
          </p>
          <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Log 2 or more completed sessions to see trends
          </p>
        </div>
      ) : (
        <>
          {/* Weight + volume chart */}
          <div className="mt-6">
            <p
              className="text-xs font-bold tracking-widest mb-3"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              TOP WEIGHT
            </p>
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={chartData} margin={CHART_MARGIN}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={TICK}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="weight"
                  tick={TICK}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                />
                <YAxis yAxisId="volume" hide />
                <Tooltip
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  content={(p: any) => <WeightTooltip active={p.active} payload={p.payload} label={p.label} />}
                  cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                />
                <Area
                  yAxisId="volume"
                  type="monotone"
                  dataKey="volume"
                  fill="var(--accent)"
                  fillOpacity={0.09}
                  stroke="none"
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="weight"
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

          {/* RIR trend */}
          {hasRir && (
            <div className="mt-7">
              <p
                className="text-xs font-bold tracking-widest mb-3"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                AVG RIR
              </p>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={chartData} margin={CHART_MARGIN}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={TICK}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={TICK}
                    axisLine={false}
                    tickLine={false}
                    width={28}
                    domain={[0, 'auto']}
                  />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(p: any) => <SimpleTooltip active={p.active} payload={p.payload} label={p.label} unit="RIR" />}
                    cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rir"
                    stroke="var(--text-secondary)"
                    strokeWidth={1.5}
                    dot={{ fill: 'var(--text-secondary)', r: 2.5, strokeWidth: 0 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Avg rest time */}
          {hasRest && (
            <div className="mt-7">
              <p
                className="text-xs font-bold tracking-widest mb-3"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                AVG REST TIME
              </p>
              <ResponsiveContainer width="100%" height={120}>
                <LineChart data={chartData} margin={CHART_MARGIN}>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={TICK}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={TICK}
                    axisLine={false}
                    tickLine={false}
                    width={36}
                    tickFormatter={(v: number) => `${v}s`}
                  />
                  <Tooltip
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    content={(p: any) => <SimpleTooltip active={p.active} payload={p.payload} label={p.label} unit="s" />}
                    cursor={{ stroke: 'var(--border-strong)', strokeWidth: 1 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="rest"
                    stroke="var(--text-muted)"
                    strokeWidth={1.5}
                    dot={{ fill: 'var(--text-muted)', r: 2.5, strokeWidth: 0 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Last 5 sessions */}
          <div className="mt-7 mb-2">
            <p
              className="text-xs font-bold tracking-widest mb-3"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              LAST {Math.min(5, last5.length)} SESSIONS
            </p>
            <div
              className="rounded-xl overflow-hidden"
              style={{ border: '1px solid var(--border)' }}
            >
              {last5.map((session, i) => (
                <div
                  key={session.sessionId}
                  className="flex items-center justify-between px-4 py-3"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderTop: i > 0 ? '1px solid var(--border)' : undefined,
                  }}
                >
                  <div>
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      {format(parseISO(session.date), 'EEE, MMM d')}
                    </p>
                    <p
                      className="text-sm font-bold mt-0.5"
                      style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                    >
                      {session.topSet.weight}kg × {session.topSet.reps}
                      {session.topSet.rir !== null ? ` @ RIR ${session.topSet.rir}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className="text-xs"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      {session.setCount} sets
                    </p>
                    {session.avgRir !== null && (
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}
                      >
                        avg RIR {Math.round(session.avgRir * 10) / 10}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export default function ExerciseProgress() {
  const [selectedExercise, setSelectedExercise] = useState<Exercise | null>(null)

  return (
    <div>
      {selectedExercise ? (
        <ExerciseCharts
          exercise={selectedExercise}
          onBack={() => setSelectedExercise(null)}
        />
      ) : (
        <>
          <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)' }}>
            Select an exercise to view progress over time.
          </p>
          <ExercisePicker onSelect={setSelectedExercise} />
        </>
      )}
    </div>
  )
}
