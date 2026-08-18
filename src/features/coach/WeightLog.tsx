import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useToday } from '../../hooks/useToday'
import {
  useWeightEntries,
  useCreateWeightEntry,
  useUpdateWeightEntry,
  useDeleteWeightEntry,
} from './useCoachContext'
import { weekKey, buildWeeklyAverages } from './weightLogic'
import type { WeightEntryKind } from '../../types'

const KINDS: { id: WeightEntryKind; label: string }[] = [
  { id: 'daily', label: 'DAILY' },
  { id: 'weekly_average', label: 'WEEKLY AVERAGE' },
]

function fmt(iso: string): string {
  return format(parseISO(iso), 'MMM d, yyyy')
}

export default function WeightLog() {
  const { data: entries = [], isLoading } = useWeightEntries()
  const today = useToday()
  const createEntry = useCreateWeightEntry()
  const updateEntry = useUpdateWeightEntry()
  const deleteEntry = useDeleteWeightEntry()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [weightInput, setWeightInput] = useState('')
  const [kind, setKind] = useState<WeightEntryKind>('daily')
  const [pickedDate, setPickedDate] = useState(today)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const activeMutation = editingId ? updateEntry : createEntry
  // A weekly-average entry is always stored under that week's Monday
  // (COACH-ANALYSIS-TASKS.md §5.2), regardless of which day within the week
  // is picked — shown live here rather than silently normalised on submit.
  const normalizedDate = kind === 'weekly_average' ? weekKey(pickedDate) : pickedDate

  function openAddForm() {
    setEditingId(null)
    setWeightInput('')
    setKind('daily')
    setPickedDate(today)
    createEntry.reset()
    setShowForm(true)
  }

  function openEditForm(id: string, currentWeightKg: number, currentKind: WeightEntryKind, currentDate: string) {
    setEditingId(id)
    setWeightInput(String(currentWeightKg))
    setKind(currentKind)
    setPickedDate(currentDate)
    updateEntry.reset()
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const weightKg = Number(weightInput)
    if (!Number.isFinite(weightKg) || weightKg <= 0) return
    if (editingId) {
      updateEntry.mutate(
        { id: editingId, weightKg, kind, entryDate: normalizedDate },
        { onSuccess: closeForm },
      )
    } else {
      createEntry.mutate({ weightKg, kind, entryDate: normalizedDate }, { onSuccess: closeForm })
    }
  }

  const sortedEntries = [...entries].sort((a, b) => b.entryDate.localeCompare(a.entryDate))
  const weeklyAverages = [...buildWeeklyAverages(entries)].sort((a, b) => b.weekStart.localeCompare(a.weekStart))

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <p
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          WEIGHT LOG
        </p>
        {!showForm && (
          <button
            onClick={openAddForm}
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)' }}
          >
            ADD ENTRY
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
            WEIGHT (KG)
          </label>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            value={weightInput}
            onChange={(e) => setWeightInput(e.target.value)}
            placeholder="e.g. 82.5"
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-4"
            style={{
              backgroundColor: 'var(--surface-raised)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
            }}
          />

          <label
            className="block text-xs font-bold tracking-widest mb-2"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            KIND
          </label>
          <div className="flex gap-2 mb-4">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                onClick={() => setKind(k.id)}
                className="flex-1 py-2 rounded-lg text-xs font-bold"
                style={{
                  backgroundColor: kind === k.id ? 'var(--accent)' : 'var(--surface-raised)',
                  color: kind === k.id ? 'var(--base)' : 'var(--text-secondary)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {k.label}
              </button>
            ))}
          </div>

          <label
            className="block text-xs font-bold tracking-widest mb-2"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {kind === 'weekly_average' ? 'ANY DAY IN THE WEEK' : 'DATE'}
          </label>
          <input
            type="date"
            value={pickedDate}
            onChange={(e) => setPickedDate(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none"
            style={{
              backgroundColor: 'var(--surface-raised)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              colorScheme: 'dark',
            } as React.CSSProperties}
          />
          {kind === 'weekly_average' && (
            <p className="text-xs mt-2 mb-4" style={{ color: 'var(--text-dim)' }}>
              Saved as the week of {fmt(normalizedDate)} (Monday).
            </p>
          )}
          {kind === 'daily' && <div className="mb-4" />}

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
              disabled={activeMutation.isPending || !weightInput}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--base)',
                fontFamily: 'var(--font-mono)',
                opacity: activeMutation.isPending || !weightInput ? 0.5 : 1,
              }}
            >
              {activeMutation.isPending ? '...' : editingId ? 'SAVE CHANGES' : 'ADD ENTRY'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : sortedEntries.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No weight entries logged yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sortedEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl p-3"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {entry.weightKg} kg
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => openEditForm(entry.id, entry.weightKg, entry.kind, entry.entryDate)}
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
                {fmt(entry.entryDate)} · {entry.kind === 'daily' ? 'daily' : 'weekly average'}
              </p>

              {confirmDeleteId === entry.id && (
                <div
                  className="rounded-lg p-3 mt-3"
                  style={{ backgroundColor: 'rgba(248, 113, 113, 0.06)', border: '1px solid rgba(248, 113, 113, 0.3)' }}
                >
                  <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Delete this weight entry? This cannot be undone.
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

      {weeklyAverages.length > 0 && (
        <div className="mt-6">
          <p
            className="text-xs font-bold tracking-widest mb-3"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            WEEKLY AVERAGES
          </p>
          <div className="flex flex-col gap-2">
            {weeklyAverages.map((w) => (
              <div
                key={w.weekStart}
                className="flex items-center justify-between rounded-xl px-3 py-2.5"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Week of {fmt(w.weekStart)}
                </p>
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {w.averageKg} kg
                  <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-dim)' }}>
                    {w.source === 'manual' ? 'manual' : `${w.dailyCount} ${w.dailyCount === 1 ? 'entry' : 'entries'}`}
                  </span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
