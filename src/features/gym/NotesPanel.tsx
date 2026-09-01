import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useCoachNotes, useCreateCoachNote } from '../coach/useCoachNotes'

// Notes' content, extracted from WorkoutNotesSheet.tsx into
// WorkoutSidebarSheet.tsx's NOTES tab (QA-SIDEBAR-TASKS.md §8.2) — a pure
// presentational extraction, sheet chrome removed. Zero behavioural change:
// same useCoachNotes() cache filter, same optimistic useCreateCoachNote,
// same offline behaviour as before the split.
//
// Filters useCoachNotes()'s full-list cache client-side to this session's
// notes. That cache is what makes this work offline: the create mutation's
// onMutate pushes the new note into it immediately, so "this session's
// notes" shows what was just written even with zero network, without this
// component needing its own offline-aware fetch.

interface NotesPanelProps {
  sessionId: string
}

function fmt(iso: string): string {
  return format(parseISO(iso), 'h:mm a')
}

export default function NotesPanel({ sessionId }: NotesPanelProps) {
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
    <>
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
    </>
  )
}
