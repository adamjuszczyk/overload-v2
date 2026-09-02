import { format, parseISO } from 'date-fns'
import type { QaTranscriptItem } from './useCoachQa'
import type { QaCategory } from '../../types'

// Renders the exchange list (QA-SIDEBAR-TASKS.md §8.2) — presentational,
// takes an array and renders it. Plain text throughout, no markdown
// renderer (§8.5 — the prompt itself already instructs against markdown
// headers, ported from coachPrompt.ts).

function fmt(iso: string): string {
  return format(parseISO(iso), 'h:mm a')
}

// The empty-state hint is the one piece of copy that reads wrong across all
// four categories unchanged — "what you're doing right now" only makes sense
// mid-workout (Phase 6). Phase 7 adds the other three call sites (§7.2), so
// this is keyed by category rather than left generic or hardcoded to one.
const EMPTY_HINT: Record<QaCategory, string> = {
  in_session: "Ask about what you're doing right now — technique, whether to add a set, anything about this session.",
  general: 'Ask about your training — technique, programming, anything not tied to today’s session.',
  planning: 'Ask about how to think about your plan — recovery, whether to skip a session, the week ahead.',
  app_mechanics: 'Ask how something in the app works — RIR, supersets, deload weeks, anything about the mechanics.',
}

export default function QaTranscript({
  exchanges,
  category,
}: {
  exchanges: QaTranscriptItem[]
  category: QaCategory
}) {
  if (exchanges.length === 0) {
    return (
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        {EMPTY_HINT[category]}
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
