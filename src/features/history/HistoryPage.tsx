import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { format, parseISO } from 'date-fns'
import { useMesos, useDeleteMeso } from '../programs/useMesos'
import { useHistorySessions } from './useHistory'
import { useExercises } from '../library/useExercises'
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
  const navigate = useNavigate()
  const {
    data,
    isLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useHistorySessions()
  const sessions = useMemo(() => data?.pages.flatMap((p) => p.rows) ?? [], [data])
  const { data: mesos = [] } = useMesos()
  const { mutate: deleteMeso, isPending: isDeletingMeso } = useDeleteMeso()
  // For the "find exercise history" search below — every exercise reachable
  // from a workout, not just ones with logged history, same list Library
  // itself shows (archived excluded, matching that screen's default).
  const { data: allExercises = [] } = useExercises(false)

  const [selectedId, setSelectedId]         = useState<string | null>(null)
  const [filterMesoId, setFilterMesoId]     = useState('')
  const [filterStatus, setFilterStatus]     = useState<StatusFilter>('all')
  const [filterStart, setFilterStart]       = useState('')
  const [filterEnd, setFilterEnd]           = useState('')
  const [filterMuscle, setFilterMuscle]     = useState<MuscleGroup | ''>('')
  const [searchQuery, setSearchQuery]       = useState('')
  const [showAdvanced, setShowAdvanced]     = useState(false)
  const [mesoDeleteConfirm, setMesoDeleteConfirm] = useState(false)
  // Exercise-history search (post-launch fix, 2026-08-10) — before this, the
  // only way to reach ExerciseHistoryView.tsx was the History icon on a live
  // gym-session ExerciseHeader, so an exercise with no session running today
  // was unreachable from History itself.
  const [showExerciseSearch, setShowExerciseSearch] = useState(false)
  const [exerciseQuery, setExerciseQuery]   = useState('')

  const matchingExercises = useMemo(() => {
    const q = exerciseQuery.trim().toLowerCase()
    if (!q) return allExercises
    return allExercises.filter((ex) => ex.name.toLowerCase().includes(q))
  }, [allExercises, exerciseQuery])

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

        {/* Exercise-history search toggle — the only way to reach a given
            exercise's all-time chart/table used to be the History icon on
            an active session's ExerciseHeader, so it was unreachable from
            here on a rest day or for an exercise not on today's plan
            (post-launch fix, 2026-08-10). */}
        <button
          onClick={() => setShowExerciseSearch(v => !v)}
          className="w-full py-2 rounded-xl text-xs font-bold"
          style={{
            backgroundColor: 'var(--surface)',
            border: `1px solid ${showExerciseSearch ? 'var(--accent)' : 'var(--border)'}`,
            color: showExerciseSearch ? 'var(--accent)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {showExerciseSearch ? '▲ HIDE EXERCISE HISTORY' : '▼ FIND EXERCISE HISTORY'}
        </button>

        {showExerciseSearch && (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Search exercises…"
              value={exerciseQuery}
              onChange={e => setExerciseQuery(e.target.value)}
              autoFocus
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ ...inputStyle, fontFamily: 'var(--font-sans)' }}
            />
            <div
              className="rounded-xl hide-scrollbar"
              // Scrolls instead of hard-truncating (found by adversarial
              // review: the original .slice(0, 25) silently hid everything
              // past the 25th match with zero indication more existed —
              // real on an empty query, since the seeded default library
              // alone has 46 exercises). maxHeight keeps a large library
              // from pushing the rest of the page off-screen.
              style={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--border)',
                maxHeight: 320,
                overflowY: 'auto',
              }}
            >
              {matchingExercises.length === 0 ? (
                <p
                  className="text-xs text-center py-4"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  NO MATCHES
                </p>
              ) : (
                matchingExercises.map((ex, i) => (
                  <button
                    key={ex.id}
                    onClick={() => navigate(`/exercise/${ex.id}`)}
                    className="w-full text-left px-4 py-3 flex items-center justify-between gap-2"
                    style={{
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                    }}
                  >
                    <span className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                      {ex.name}
                    </span>
                    <span
                      className="text-xs font-bold shrink-0"
                      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      {ex.muscleGroup?.toUpperCase() ?? 'OTHER'}
                    </span>
                  </button>
                ))
              )}
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

        {/* Load more — real .range() pagination (§2.6 / Phase 3.4 item 20)
            replaces the old .limit(500) session-list query. Filters above
            apply only to sessions already loaded, so a narrow filter may
            need another tap of this to reach older matches. */}
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
      </div>
    </div>
  )
}
