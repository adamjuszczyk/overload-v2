import { useState, useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { useMesos, useDeleteMeso } from '../programs/useMesos'
import { useHistorySessions } from './useHistory'
import SessionDetail from './SessionDetail'
import type { MuscleGroup } from '../../types'

const MUSCLE_GROUPS: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'forearms', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'other',
]

const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: 'CHEST', back: 'BACK', shoulders: 'SHOULDERS',
  biceps: 'BICEPS', triceps: 'TRICEPS', forearms: 'FOREARMS',
  quads: 'QUADS', hamstrings: 'HAMS', glutes: 'GLUTES',
  calves: 'CALVES', core: 'CORE', other: 'OTHER',
}

const STATUS_STYLE = {
  completed:   { bg: 'rgba(74, 222, 128, 0.12)',  color: 'var(--success)', label: 'DONE' },
  skipped:     { bg: 'rgba(248, 113, 113, 0.12)', color: 'var(--error)',   label: 'SKIPPED' },
  in_progress: { bg: 'var(--accent-muted)',        color: 'var(--accent)',  label: 'ACTIVE' },
  planned:     { bg: 'var(--surface-raised)',      color: 'var(--text-muted)', label: 'PLANNED' },
} as const

type StatusFilter = 'all' | 'completed' | 'skipped'

export default function HistoryPage() {
  const { data: sessions = [], isLoading } = useHistorySessions()
  const { data: mesos = [] } = useMesos()
  const { mutate: deleteMeso, isPending: isDeletingMeso } = useDeleteMeso()

  const [selectedId, setSelectedId]         = useState<string | null>(null)
  const [filterMesoId, setFilterMesoId]     = useState('')
  const [filterStatus, setFilterStatus]     = useState<StatusFilter>('all')
  const [filterStart, setFilterStart]       = useState('')
  const [filterEnd, setFilterEnd]           = useState('')
  const [filterMuscle, setFilterMuscle]     = useState<MuscleGroup | ''>('')
  const [searchQuery, setSearchQuery]       = useState('')
  const [showAdvanced, setShowAdvanced]     = useState(false)
  const [mesoDeleteConfirm, setMesoDeleteConfirm] = useState(false)

  const selectedMeso = mesos.find(m => m.id === filterMesoId) ?? null

  const filtered = useMemo(
    () =>
      sessions
        .filter(s => !filterMesoId || s.mesocycleId === filterMesoId)
        .filter(s => filterStatus === 'all' || s.status === filterStatus)
        .filter(s => !filterStart || s.date >= filterStart)
        .filter(s => !filterEnd || s.date <= filterEnd)
        .filter(s => !filterMuscle || s.muscleGroups.includes(filterMuscle as MuscleGroup))
        .filter(s => {
          if (!searchQuery) return true
          const q = searchQuery.toLowerCase()
          return (
            (s.workoutDayName ?? '').toLowerCase().includes(q) ||
            (s.mesocycleName ?? '').toLowerCase().includes(q)
          )
        }),
    [sessions, filterMesoId, filterStatus, filterStart, filterEnd, filterMuscle, searchQuery],
  )

  // Detail view
  if (selectedId) {
    return <SessionDetail sessionId={selectedId} onBack={() => setSelectedId(null)} />
  }

  const inputStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-mono)',
  } as React.CSSProperties

  return (
    <div className="px-4 pt-8 pb-12">
      {/* Page header */}
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
      >
        HISTORY
      </p>
      <h1
        className="text-3xl font-black tracking-tight"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        HISTORY
      </h1>

      {/* Filters */}
      <div className="mt-5 space-y-3">
        {/* Search */}
        <input
          type="text"
          placeholder="Search sessions or mesos…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
          style={{ ...inputStyle, fontFamily: 'var(--font-sans)' }}
        />

        {/* Meso selector */}
        <select
          value={filterMesoId}
          onChange={e => {
            setFilterMesoId(e.target.value)
            setMesoDeleteConfirm(false)
          }}
          className="w-full px-3 py-2.5 rounded-xl text-sm outline-none appearance-none"
          style={inputStyle}
        >
          <option value="">ALL MESOS</option>
          {mesos.map(m => (
            <option key={m.id} value={m.id}>
              {m.name.toUpperCase()}
              {m.status === 'active' ? ' (ACTIVE)' : ''}
            </option>
          ))}
        </select>

        {/* Status chips */}
        <div className="flex gap-2">
          {(['all', 'completed', 'skipped'] as const).map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className="flex-1 py-2 rounded-xl text-xs font-bold"
              style={{
                backgroundColor: filterStatus === s ? 'var(--accent)' : 'var(--surface)',
                color: filterStatus === s ? 'var(--base)' : 'var(--text-muted)',
                border: `1px solid ${filterStatus === s ? 'transparent' : 'var(--border)'}`,
                fontFamily: 'var(--font-mono)',
              }}
            >
              {s === 'all' ? 'ALL' : s === 'completed' ? 'DONE' : 'SKIPPED'}
            </button>
          ))}
        </div>

        {/* Advanced filter toggle */}
        <button
          onClick={() => setShowAdvanced(v => !v)}
          className="w-full py-2 rounded-xl text-xs font-bold"
          style={{
            backgroundColor: 'var(--surface)',
            border: `1px solid ${showAdvanced ? 'var(--accent)' : 'var(--border)'}`,
            color: showAdvanced ? 'var(--accent)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {showAdvanced ? '▲ HIDE FILTERS' : '▼ DATE & MUSCLE FILTERS'}
        </button>

        {showAdvanced && (
          <div className="space-y-3">
            {/* Date range */}
            <div className="flex gap-2">
              <div className="flex-1">
                <p
                  className="text-xs mb-1.5"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  FROM
                </p>
                <input
                  type="date"
                  value={filterStart}
                  onChange={e => setFilterStart(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ ...inputStyle, colorScheme: 'dark' } as React.CSSProperties}
                />
              </div>
              <div className="flex-1">
                <p
                  className="text-xs mb-1.5"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  TO
                </p>
                <input
                  type="date"
                  value={filterEnd}
                  onChange={e => setFilterEnd(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
                  style={{ ...inputStyle, colorScheme: 'dark' } as React.CSSProperties}
                />
              </div>
            </div>

            {/* Muscle group chips */}
            <div>
              <p
                className="text-xs mb-2"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                MUSCLE GROUP
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setFilterMuscle('')}
                  className="px-3 py-1.5 rounded-full text-xs font-bold shrink-0"
                  style={{
                    backgroundColor: !filterMuscle ? 'var(--accent)' : 'var(--surface)',
                    color: !filterMuscle ? 'var(--base)' : 'var(--text-muted)',
                    border: `1px solid ${!filterMuscle ? 'transparent' : 'var(--border)'}`,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  ALL
                </button>
                {MUSCLE_GROUPS.map(mg => (
                  <button
                    key={mg}
                    onClick={() => setFilterMuscle(mg === filterMuscle ? '' : mg)}
                    className="px-3 py-1.5 rounded-full text-xs font-bold shrink-0"
                    style={{
                      backgroundColor: filterMuscle === mg ? 'var(--accent)' : 'var(--surface)',
                      color: filterMuscle === mg ? 'var(--base)' : 'var(--text-muted)',
                      border: `1px solid ${filterMuscle === mg ? 'transparent' : 'var(--border)'}`,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {MUSCLE_LABEL[mg]}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Delete meso card — only when a completed meso is selected */}
      {selectedMeso && selectedMeso.status === 'completed' && (
        <div
          className="mt-4 rounded-xl p-4"
          style={{
            backgroundColor: 'rgba(248, 113, 113, 0.05)',
            border: '1px solid rgba(248, 113, 113, 0.2)',
          }}
        >
          {!mesoDeleteConfirm ? (
            <div className="flex items-center justify-between gap-3">
              <p
                className="text-xs truncate"
                style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
              >
                {selectedMeso.name.toUpperCase()}
              </p>
              <button
                onClick={() => setMesoDeleteConfirm(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold shrink-0"
                style={{
                  backgroundColor: 'rgba(248, 113, 113, 0.1)',
                  color: 'var(--error)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                DELETE MESO
              </button>
            </div>
          ) : (
            <>
              <p
                className="text-xs font-bold mb-1"
                style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)' }}
              >
                DELETE MESOCYCLE?
              </p>
              <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                This will permanently delete{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{selectedMeso.name}</strong> and
                all associated sessions. This cannot be undone.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setMesoDeleteConfirm(false)}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                  style={{
                    backgroundColor: 'var(--surface-raised)',
                    color: 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  CANCEL
                </button>
                <button
                  onClick={() =>
                    deleteMeso(selectedMeso.id, {
                      onSuccess: () => {
                        setFilterMesoId('')
                        setMesoDeleteConfirm(false)
                      },
                    })
                  }
                  disabled={isDeletingMeso}
                  className="flex-1 py-2.5 rounded-xl text-xs font-bold"
                  style={{
                    backgroundColor: 'rgba(248, 113, 113, 0.15)',
                    color: 'var(--error)',
                    fontFamily: 'var(--font-mono)',
                    opacity: isDeletingMeso ? 0.5 : 1,
                  }}
                >
                  {isDeletingMeso ? 'DELETING…' : 'CONFIRM DELETE'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Session list */}
      <div className="mt-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div
              className="w-5 h-5 rounded-full animate-spin"
              style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
            />
          </div>
        ) : filtered.length === 0 ? (
          <div
            className="rounded-xl p-8 text-center"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            <p
              className="text-sm font-bold"
              style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
            >
              {sessions.length === 0 ? 'NO SESSIONS YET' : 'NO RESULTS'}
            </p>
            <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              {sessions.length === 0
                ? 'Start a session in the Gym tab.'
                : 'Try adjusting your filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(session => {
              const ss =
                STATUS_STYLE[session.status as keyof typeof STATUS_STYLE] ?? STATUS_STYLE.planned
              return (
                <button
                  key={session.id}
                  onClick={() => setSelectedId(session.id)}
                  className="w-full text-left rounded-xl px-4 py-3"
                  style={{
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {/* Date + status */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p
                      className="text-xs font-bold"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      {format(parseISO(session.date), 'MMM d, yyyy').toUpperCase()}
                    </p>
                    <span
                      className="px-2 py-0.5 rounded text-xs font-bold shrink-0"
                      style={{
                        backgroundColor: ss.bg,
                        color: ss.color,
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                      }}
                    >
                      {ss.label}
                    </span>
                  </div>

                  {/* Session name */}
                  <p
                    className="text-sm font-bold"
                    style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
                  >
                    {session.workoutDayName ?? session.mesocycleName ?? 'SESSION'}
                  </p>

                  {/* Meso + set count */}
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  >
                    {session.mesocycleName ?? 'NO MESO'}
                    {session.setCount > 0 ? ` · ${session.setCount} SETS` : ''}
                  </p>

                  {/* Muscle group tags */}
                  {session.muscleGroups.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {session.muscleGroups.slice(0, 4).map(mg => (
                        <span
                          key={mg}
                          className="px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: 'var(--surface-raised)',
                            color: 'var(--text-dim)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                          }}
                        >
                          {MUSCLE_LABEL[mg]}
                        </span>
                      ))}
                      {session.muscleGroups.length > 4 && (
                        <span
                          className="px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: 'var(--surface-raised)',
                            color: 'var(--text-dim)',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 10,
                          }}
                        >
                          +{session.muscleGroups.length - 4}
                        </span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
