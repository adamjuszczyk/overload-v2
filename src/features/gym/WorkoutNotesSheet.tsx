import { useState } from 'react'
import { X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { useCoachNotes, useCreateCoachNote } from '../coach/useCoachNotes'

// The in-workout sidebar (COACH-PERSONALIZATION-TASKS.md §6 step 15) —
// "genuinely just a notepad" (SPEC §6): freeform text in, timestamped,
// nothing more. Bottom-sheet overlay following MissedSessionPrompt.tsx's
// exact pattern — fixed inset-0 backdrop, rounded-t-2xl sheet, grab-handle
// bar, maxHeight 70dvh, backdrop-click to dismiss.
//
// This is the *only* Coach Notes entry point left after the Notes/Memory
// restructure (SPEC v1.1) — the Context tab's old general note box
// (CoachNotes.tsx) was removed; a general standing fact now goes straight
// into Coach Memory instead (CoachMemory.tsx's ADD ENTRY), no AI involved,
// while a genuinely session-scoped note still comes through here and still
// reaches v2_coach_notes exactly as before, unaffected by the restructure.
//
// Filters useCoachNotes()'s full-list cache client-side to this session's
// notes. That cache is what makes this work offline: the create mutation's
// onMutate pushes the new note into it immediately, so "this session's
// notes" shows what was just written even with zero network, without this
// component needing its own offline-aware fetch.

interface WorkoutNotesSheetProps {
  sessionId: string
  onClose: () => void
}

function fmt(iso: string): string {
  return format(parseISO(iso), 'h:mm a')
}

export default function WorkoutNotesSheet({ sessionId, onClose }: WorkoutNotesSheetProps) {
  const { data: notes = [] } = useCoachNotes()
  const createNote = useCreateCoachNote()
  const [body, setBody] = useState('')

  const sessionNotes = notes.filter((n) => n.sessionId === sessionId)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = body.trim()
    if (!trimmed) return
    createNote.mutate({ body: trimmed, sessionId }, { onSuccess: () => setBody('') })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="w-full rounded-t-2xl px-4 pt-4 pb-10"
        style={{ backgroundColor: 'var(--base)', maxHeight: '70dvh', overflowY: 'auto' }}
      >
        <div
          className="mx-auto mb-4 rounded-full"
          style={{ width: 36, height: 4, backgroundColor: 'var(--border-strong)' }}
        />

        <div className="flex items-start justify-between gap-3 mb-4">
          <p
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
          >
            SESSION NOTES
          </p>
          <button
            onClick={onClose}
            className="flex items-center justify-center flex-shrink-0"
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              backgroundColor: 'var(--surface-overlay)',
              color: 'var(--text-secondary)',
            }}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {sessionNotes.length > 0 && (
          <div className="space-y-2 mb-4">
            {sessionNotes.map((note) => (
              <div
                key={note.id}
                className="rounded-xl p-3"
                style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                  {note.body}
                </p>
                <p
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  {fmt(note.createdAt)}
                </p>
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Jot something down — form off today, an old injury acting up, anything worth remembering…"
            rows={3}
            autoFocus
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-3 resize-none"
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
          <button
            type="submit"
            disabled={createNote.isPending || !body.trim()}
            className="w-full py-3 rounded-xl font-black text-sm tracking-wider"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--base)',
              fontFamily: 'var(--font-mono)',
              opacity: createNote.isPending || !body.trim() ? 0.6 : 1,
            }}
          >
            {createNote.isPending ? 'SAVING...' : 'ADD NOTE'}
          </button>
        </form>
      </div>
    </div>
  )
}
