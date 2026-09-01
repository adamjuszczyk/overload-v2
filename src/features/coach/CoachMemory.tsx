import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import {
  useCoachMemory,
  useCreateCoachMemoryEntry,
  useUpdateCoachMemoryEntry,
  useDeleteCoachMemoryEntry,
  useRestoreCoachMemoryEntry,
} from './useCoachMemory'

// The Context tab's entry point into Coach Memory (COACH-PERSONALIZATION-
// TASKS.md §6, phase 4; reworked by the Notes/Memory restructure, SPEC
// v1.1) — the full list plus edit/delete/restore, same inline-CRUD
// conventions PhaseLog.tsx/WeightLog.tsx use. Online-only, same "REQUIRES A
// CONNECTION" convention as every other Coach surface (SPEC §4's memory
// list has no offline need — TASKS §2.10, no Dexie change).
//
// No curation trigger here anymore — curation runs automatically as part of
// api/coach/analyze.ts (curationRunner.ts), not from a button on this page.
// ADD ENTRY is now this app's *only* way to write a general (non-workout)
// standing fact directly — it replaces the Context tab's old general note
// box (CoachNotes.tsx, deleted), which used to stage a note for later
// curation. There's no AI involved in ADD ENTRY, same as a phase or weight
// log entry: it's a direct, immediate write to v2_coach_memory_entries with
// source: 'manual'. The in-workout sidebar's NOTES tab (gym/NotesPanel.tsx,
// split out of the former WorkoutNotesSheet.tsx by the Q&A sidebar's Phase
// 6) is unchanged and still writes raw, session-scoped notes to
// v2_coach_notes — those still get folded into memory by curation, just
// automatically now.

function fmt(iso: string): string {
  return format(parseISO(iso), 'MMM d, yyyy · h:mm a')
}

export default function CoachMemory() {
  const isOnline = useOnlineStatus()
  const { data: entries = [], isLoading } = useCoachMemory()
  const createEntry = useCreateCoachMemoryEntry()
  const updateEntry = useUpdateCoachMemoryEntry()
  const deleteEntry = useDeleteCoachMemoryEntry()
  const restoreEntry = useRestoreCoachMemoryEntry()

  const [showForm, setShowForm] = useState(false)
  const [body, setBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showExpired, setShowExpired] = useState(false)

  if (!isOnline) {
    return (
      <div className="mt-6">
        <p
          className="text-xs font-bold tracking-widest mb-3"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          COACH MEMORY
        </p>
        <div
          className="rounded-xl p-8 text-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p
            className="text-sm font-bold"
            style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}
          >
            REQUIRES A CONNECTION
          </p>
          <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            Coach Memory isn't cached offline — reconnect to view or edit it.
          </p>
        </div>
      </div>
    )
  }

  const activeEntries = entries.filter((e) => e.status === 'active')
  const expiredEntries = entries.filter((e) => e.status === 'expired')

  function openAddForm() {
    setEditingId(null)
    setBody('')
    createEntry.reset()
    setShowForm(true)
  }

  function closeForm() {
    setShowForm(false)
    setBody('')
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    createEntry.mutate(trimmed, { onSuccess: closeForm })
  }

  function openEditForm(id: string, currentBody: string) {
    setEditingId(id)
    setEditingBody(currentBody)
    updateEntry.reset()
  }

  function closeEditForm() {
    setEditingId(null)
    setEditingBody('')
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = editingBody.trim()
    if (!trimmed || !editingId) return
    updateEntry.mutate({ id: editingId, body: trimmed }, { onSuccess: closeEditForm })
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <p
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          COACH MEMORY
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
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="A standing fact worth remembering — e.g. cautious with forearm work due to a wrist issue…"
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-4 resize-none"
            style={{
              backgroundColor: 'var(--surface-raised)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
            }}
          />

          {createEntry.isError && (
            <p className="text-xs mb-3" style={{ color: 'var(--error)' }}>
              {(createEntry.error as Error).message}
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
              disabled={createEntry.isPending || !body.trim()}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--base)',
                fontFamily: 'var(--font-mono)',
                opacity: createEntry.isPending || !body.trim() ? 0.5 : 1,
              }}
            >
              {createEntry.isPending ? '...' : 'ADD ENTRY'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : activeEntries.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No memory entries yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {activeEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-xl p-3"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              {editingId === entry.id ? (
                <form onSubmit={handleEditSubmit}>
                  <textarea
                    value={editingBody}
                    onChange={(e) => setEditingBody(e.target.value)}
                    rows={3}
                    autoFocus
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-3 resize-none"
                    style={{
                      backgroundColor: 'var(--surface-raised)',
                      border: '1px solid var(--border-strong)',
                      color: 'var(--text-primary)',
                    }}
                  />
                  {updateEntry.isError && (
                    <p className="text-xs mb-2" style={{ color: 'var(--error)' }}>
                      {(updateEntry.error as Error).message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={closeEditForm}
                      className="flex-1 py-2 rounded-lg text-xs font-bold"
                      style={{ backgroundColor: 'var(--surface-raised)', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                    >
                      CANCEL
                    </button>
                    <button
                      type="submit"
                      disabled={updateEntry.isPending || !editingBody.trim()}
                      className="flex-1 py-2 rounded-lg text-xs font-bold"
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: 'var(--base)',
                        fontFamily: 'var(--font-mono)',
                        opacity: updateEntry.isPending || !editingBody.trim() ? 0.5 : 1,
                      }}
                    >
                      {updateEntry.isPending ? '...' : 'SAVE CHANGES'}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>
                      {entry.body}
                    </p>
                    <div className="flex gap-3 shrink-0">
                      <button
                        onClick={() => openEditForm(entry.id, entry.body)}
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
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {fmt(entry.updatedAt)} · {entry.source === 'manual' ? 'MANUAL' : 'CURATED'}
                  </p>
                </>
              )}

              {confirmDeleteId === entry.id && (
                <div
                  className="rounded-lg p-3 mt-3"
                  style={{ backgroundColor: 'rgba(248, 113, 113, 0.06)', border: '1px solid rgba(248, 113, 113, 0.3)' }}
                >
                  <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Delete this memory entry? This cannot be undone.
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

      {expiredEntries.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowExpired((v) => !v)}
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {showExpired ? 'HIDE' : 'SHOW'} {expiredEntries.length} EXPIRED
          </button>

          {showExpired && (
            <div className="flex flex-col gap-2 mt-3">
              {expiredEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl p-3"
                  style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', opacity: 0.6 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm flex-1" style={{ color: 'var(--text-secondary)' }}>
                      {entry.body}
                    </p>
                    <div className="flex gap-3 shrink-0">
                      <button
                        onClick={() => restoreEntry.mutate(entry.id)}
                        disabled={restoreEntry.isPending}
                        className="text-xs font-bold"
                        style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
                      >
                        RESTORE
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
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {fmt(entry.updatedAt)} · EXPIRED · {entry.source === 'manual' ? 'MANUAL' : 'CURATED'}
                  </p>

                  {confirmDeleteId === entry.id && (
                    <div
                      className="rounded-lg p-3 mt-3"
                      style={{ backgroundColor: 'rgba(248, 113, 113, 0.06)', border: '1px solid rgba(248, 113, 113, 0.3)' }}
                    >
                      <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                        Delete this memory entry? This cannot be undone.
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
      )}
    </div>
  )
}
