import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import {
  useCoachNotes,
  useCreateCoachNote,
  useUpdateCoachNote,
  useDeleteCoachNote,
} from './useCoachNotes'

// The Context tab's entry point into Coach Notes (COACH-PERSONALIZATION-
// TASKS.md §6 step 14) — a general (non-workout) note box plus the full
// list, same CRUD conventions PhaseLog.tsx/WeightLog.tsx already use (edit
// form swaps in per-entry, inline delete confirmation). No new gate check
// (TASKS §2.9) — already inside the gated /coach route.
//
// Online-only, same "REQUIRES A CONNECTION" empty state as
// CoachSessionAnalysisTab.tsx/ExerciseHistoryView.tsx: the note *list* isn't
// mirrored in Dexie (TASKS §2.6), and a general note here isn't the urgent,
// signal-is-worst case the sidebar exists for — that one (WorkoutNotesSheet)
// queues offline; this box doesn't need to.

function fmt(iso: string): string {
  return format(parseISO(iso), 'MMM d, yyyy · h:mm a')
}

export default function CoachNotes() {
  const isOnline = useOnlineStatus()
  const { data: notes = [], isLoading } = useCoachNotes()
  const createNote = useCreateCoachNote()
  const updateNote = useUpdateCoachNote()
  const deleteNote = useDeleteCoachNote()

  const [showForm, setShowForm] = useState(false)
  const [body, setBody] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingBody, setEditingBody] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  if (!isOnline) {
    return (
      <div className="mt-6">
        <p
          className="text-xs font-bold tracking-widest mb-3"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          COACH NOTES
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
            Coach Notes isn't cached offline — reconnect to view or add one.
          </p>
        </div>
      </div>
    )
  }

  function openAddForm() {
    setEditingId(null)
    setBody('')
    createNote.reset()
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
    createNote.mutate({ body: trimmed, sessionId: null }, { onSuccess: closeForm })
  }

  function openEditForm(id: string, currentBody: string) {
    setEditingId(id)
    setEditingBody(currentBody)
    updateNote.reset()
  }

  function closeEditForm() {
    setEditingId(null)
    setEditingBody('')
  }

  function handleEditSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = editingBody.trim()
    if (!trimmed || !editingId) return
    updateNote.mutate({ id: editingId, body: trimmed }, { onSuccess: closeEditForm })
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-3">
        <p
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          COACH NOTES
        </p>
        {!showForm && (
          <button
            onClick={openAddForm}
            className="text-xs font-bold px-3 py-1.5 rounded-lg"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)' }}
          >
            ADD NOTE
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
            placeholder="Anything worth remembering — not tied to a specific workout…"
            rows={3}
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-4 resize-none"
            style={{
              backgroundColor: 'var(--surface-raised)',
              border: '1px solid var(--border-strong)',
              color: 'var(--text-primary)',
            }}
          />

          {createNote.isError && (
            <p className="text-xs mb-3" style={{ color: 'var(--error)' }}>
              {(createNote.error as Error).message}
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
              disabled={createNote.isPending || !body.trim()}
              className="flex-1 py-2.5 rounded-xl text-xs font-bold"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--base)',
                fontFamily: 'var(--font-mono)',
                opacity: createNote.isPending || !body.trim() ? 0.5 : 1,
              }}
            >
              {createNote.isPending ? '...' : 'ADD NOTE'}
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No notes yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((note) => (
            <div
              key={note.id}
              className="rounded-xl p-3"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              {editingId === note.id ? (
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
                  {updateNote.isError && (
                    <p className="text-xs mb-2" style={{ color: 'var(--error)' }}>
                      {(updateNote.error as Error).message}
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
                      disabled={updateNote.isPending || !editingBody.trim()}
                      className="flex-1 py-2 rounded-lg text-xs font-bold"
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: 'var(--base)',
                        fontFamily: 'var(--font-mono)',
                        opacity: updateNote.isPending || !editingBody.trim() ? 0.5 : 1,
                      }}
                    >
                      {updateNote.isPending ? '...' : 'SAVE CHANGES'}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>
                      {note.body}
                    </p>
                    <div className="flex gap-3 shrink-0">
                      <button
                        onClick={() => openEditForm(note.id, note.body)}
                        className="text-xs font-bold"
                        style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                      >
                        EDIT
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(note.id)}
                        className="text-xs font-bold"
                        style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)' }}
                      >
                        DELETE
                      </button>
                    </div>
                  </div>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {fmt(note.createdAt)}
                    {note.sessionId && ' · FROM SESSION'}
                  </p>
                </>
              )}

              {confirmDeleteId === note.id && (
                <div
                  className="rounded-lg p-3 mt-3"
                  style={{ backgroundColor: 'rgba(248, 113, 113, 0.06)', border: '1px solid rgba(248, 113, 113, 0.3)' }}
                >
                  <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
                    Delete this note? This cannot be undone.
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
                      onClick={() => deleteNote.mutate(note.id, { onSuccess: () => setConfirmDeleteId(null) })}
                      disabled={deleteNote.isPending}
                      className="flex-1 py-2 rounded-lg text-xs font-bold"
                      style={{
                        backgroundColor: 'rgba(248, 113, 113, 0.15)',
                        color: 'var(--error)',
                        fontFamily: 'var(--font-mono)',
                        opacity: deleteNote.isPending ? 0.5 : 1,
                      }}
                    >
                      {deleteNote.isPending ? 'DELETING...' : 'CONFIRM DELETE'}
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
