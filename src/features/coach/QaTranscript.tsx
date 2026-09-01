import { format, parseISO } from 'date-fns'
import type { QaTranscriptItem } from './useCoachQa'

// Renders the exchange list (QA-SIDEBAR-TASKS.md §8.2) — presentational,
// takes an array and renders it. Plain text throughout, no markdown
// renderer (§8.5 — the prompt itself already instructs against markdown
// headers, ported from coachPrompt.ts).

function fmt(iso: string): string {
  return format(parseISO(iso), 'h:mm a')
}

export default function QaTranscript({ exchanges }: { exchanges: QaTranscriptItem[] }) {
  if (exchanges.length === 0) {
    return (
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Ask about what you're doing right now — technique, whether to add a set, anything about this session.
      </p>
    )
  }

  return (
    <div className="space-y-3 mb-4">
      {exchanges.map((exchange) => (
        <div key={exchange.id} className="space-y-1.5">
          <div className="rounded-xl px-3 py-2 ml-8" style={{ backgroundColor: 'var(--surface-overlay)' }}>
            <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
              {exchange.question}
            </p>
          </div>
          <div
            className="rounded-xl p-3"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {exchange.pending ? (
              <p className="text-sm italic" style={{ color: 'var(--text-muted)' }}>
                Thinking…
              </p>
            ) : (
              <>
                <p className="text-sm whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>
                  {exchange.answer}
                </p>
                <p
                  className="text-xs mt-1"
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
                >
                  {fmt(exchange.createdAt)}
                </p>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
