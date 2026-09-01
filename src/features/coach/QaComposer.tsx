// Textarea plus send (QA-SIDEBAR-TASKS.md §8.2) — disabled while pending
// and at the turn ceiling, each with its own message. The offline case is
// handled one level up: QaPanel swaps its whole content for the
// "REQUIRES A CONNECTION" empty state (§8.4), the same pattern
// CoachSessionAnalysisTab.tsx already uses, so this component is never
// rendered while offline in the first place.

interface QaComposerProps {
  draft: string
  onDraftChange: (value: string) => void
  onSend: (question: string) => void
  isPending: boolean
  atTurnLimit: boolean
  onNewConversation: () => void
  error: string | null
}

export default function QaComposer({
  draft,
  onDraftChange,
  onSend,
  isPending,
  atTurnLimit,
  onNewConversation,
  error,
}: QaComposerProps) {
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = draft.trim()
    if (!trimmed || isPending) return
    onSend(trimmed)
  }

  // §5.5 item 4 — client offers "start a new conversation" once the ceiling
  // is reached, rather than just refusing the send.
  if (atTurnLimit) {
    return (
      <div
        className="rounded-xl p-3 text-center"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
          This conversation has reached its turn limit.
        </p>
        <button
          onClick={onNewConversation}
          className="text-xs font-bold tracking-widest"
          style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          START A NEW CONVERSATION
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <textarea
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        placeholder="Ask a question…"
        rows={2}
        className="w-full px-3 py-2.5 rounded-xl text-sm outline-none mb-3 resize-none"
        style={{
          backgroundColor: 'var(--surface-raised)',
          border: '1px solid var(--border-strong)',
          color: 'var(--text-primary)',
        }}
      />
      {error && (
        <p className="text-xs mb-3" style={{ color: 'var(--error)' }}>
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={isPending || !draft.trim()}
        className="w-full py-3 rounded-xl font-black text-sm tracking-wider"
        style={{
          backgroundColor: 'var(--accent)',
          color: 'var(--base)',
          fontFamily: 'var(--font-mono)',
          opacity: isPending || !draft.trim() ? 0.6 : 1,
        }}
      >
        {isPending ? 'ASKING...' : 'ASK'}
      </button>
    </form>
  )
}
