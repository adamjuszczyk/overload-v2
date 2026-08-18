import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useToday } from '../../hooks/useToday'
import { usePhaseEntries, useCreatePhaseEntry, useUpdatePhaseEntry, useDeletePhaseEntry } from './useCoachContext'
import { resolvePhases } from './phaseLogic'
import type { TrainingPhase } from '../../types'

const PHASES: TrainingPhase[] = ['cut', 'bulk', 'maintain']

function fmt(iso: string): string {
  return format(parseISO(iso), 'MMM d, yyyy')
}

export default function PhaseLog() {
  const { data: entries = [], isLoading } = usePhaseEntries()
  const today = useToday()
  const createEntry = useCreatePhaseEntry()
  const updateEntry = useUpdatePhaseEntry()
  const deleteEntry = useDeletePhaseEntry()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [phase, setPhase] = useState<TrainingPhase>('bulk')
  const [startDate, setStartDate] = useState(today)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const activeMutation = editingId ? updateEntry : createEntry

  function openAddForm() {
    setEditingId(null)
    setPhase('bulk')
    setStartDate(today)
    createEntry.reset()
    setShowForm(true)
  }

  function openEditForm(id: string, currentPhase: TrainingPhase, currentStart: string) {
    setEditingId(id)
    setPhase(currentPhase)
    setStartDate(currentStart)
    updateEntry.reset()
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (editingId) {
      updateEntry.mutate(
        { id: editingId, phase, startDate },
        { onSuccess: closeForm },
      )
    } else {
      createEntry.mutate({ phase, startDate }, { onSuccess: closeForm })
    }
  }

  const resolved = [...resolvePhases(entries, today)].sort((a, b) => b.startDate.localeCompare(a.startDate))

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <p
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          PHASE LOG
        </p>
        {!showForm && (
          <button
            onClick={openAddForm}
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)' }}
          >
            ADD PHASE
          </button>
        )}
      </div>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="rounded-xl p-4 mb-4"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <label
            className="block text-xs font-bold tracking-widest mb-2"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            PHASE
          </label>
          <div className="flex gap-2 mb-4">
            {PHASES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPhase(p)}
                className="flex-1 py-2 rounded-lg text-xs font-bold uppercase"
                style={{
                  backgroundColor: phase === p ? 'var(--accent)' : 'var(--surface-raised)',
                  color: phase === p ? 'var(--base)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {p}
              </button>
            ))}
          </div>

          <label
            className="block text-xs font-bold tracking-widest mb-2"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            START DATE
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-4"
            style={{
              backgroundColor: 'var(--surface-raised)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              colorScheme: 'dark',
            } as React.CSSProperties}
          />

          {activeMutation.isError && (
            <p className="text-xs mb-3" style={{ color: 'var(--error)' }}>
              {(activeMutation.error as Error).message}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={closeForm}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold"
              style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              CANCEL
            </button>
            <button
              type="submit"
              disabled={activeMutation.isPending}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--base)',
                fontFamily: 'var(--font-mono)',
                opacity: activeMutation.isPending ? 0.5 : 1,
              }}
            >
              {activeMutation.isPending ? '...' : editingId ? 'SAVE CHANGES' : 'ADD PHASE'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : resolved.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No phases logged yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {resolved.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl p-3"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <p
                  className="text-sm font-bold uppercase"
                  style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
                >
                  {entry.phase}
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => openEditForm(entry.id, entry.phase, entry.startDate)}
                    className="text-xs font-bold"
                    style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                  >
                    EDIT
                  </button>
                  <button
                    onClick={() => setConfirmDeleteId(entry.id)}
                    className="text-xs font-bold"
                    style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)' }}
                  >
                    DELETE
                  </button>
                </div>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                {fmt(entry.startDate)} — {entry.endDate ? fmt(entry.endDate) : 'current'}
                {' · '}
                {entry.durationDays} {entry.durationDays === 1 ? 'day' : 'days'}
              </p>

              {confirmDeleteId === entry.id && (
                <div
                  className="rounded-lg p-3 mt-3"
                  style={{ backgroundColor: 'rgba(248, 113, 113, 0.06)', border: '1px solid rgba(248, 113, 113, 0.3)' }}
                >
                  <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Delete this phase entry? This cannot be undone.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="flex-1 py-2 rounded-lg text-xs font-bold"
                      style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      CANCEL
                    </button>
                    <button
                      onClick={() => deleteEntry.mutate(entry.id, { onSuccess: () => setConfirmDeleteId(null) })}
                      disabled={deleteEntry.isPending}
                      className="flex-1 py-2 rounded-lg text-xs font-bold"
                      style={{
                        backgroundColor: 'rgba(248, 113, 113, 0.15)',
                        color: 'var(--error)',
                        fontFamily: 'var(--font-mono)',
                        opacity: deleteEntry.isPending ? 0.5 : 1,
                      }}
                    >
                      {deleteEntry.isPending ? 'DELETING...' : 'CONFIRM DELETE'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
