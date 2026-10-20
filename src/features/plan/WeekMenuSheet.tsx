import type { CSSProperties } from 'react'
import BottomSheet from '../../components/BottomSheet'
import { errorReason } from '../../components/exercisePickerLogic'

// Chunk 52 (TASKS-1.2 "Plan's header" → WeekMenuSheet; SPEC Deload [1.2]: "week deload in WEEK ⋯ (C2)", "Plan shows [the rules], read-only, in
// WEEK ⋯ ('Deload rules (from Settings)', board 1e)"; board 1e). "[PROGRAM] / Week N": MARK WEEK AS DELOAD (UNMARK THIS WEEK with the
// DELOAD chip once marked; CYCLE on a sequence run), the Settings rules the mark applies, and "Already started — sets left as they are"
// when a session of the week had started. MARKING… while the write is out. The old MARK WEEK AS DELOAD button above the panel is gone.
//
// It writes nothing itself: the caller passes `onToggle`, which marks or unmarks through `useSetWeekDeload` (which no longer plans the
// week: a week with a WEEK ⋯ is planned already). The sheet stays open after a mark so it shows the state it made (board 1e's second
// frame), and closes with ×, a tap on the scrim or Escape.
//
// Display choices no board settles, provisional under D31: a failed mark or unmark is a line under the rules, "Couldn't mark the week."
// (or "unmark": the week is still in the state it was in, so the button says which it was) and the real reason under it (SPEC Errors (15)).

export interface WeekMenuSheetProps {
  /** The run's name (board 1e: `PUSH PULL LEGS`); shown as the eyebrow. */
  programName: string
  unit: 'week' | 'cycle'
  weekNumber: number
  /** Every session of the week is marked deload. */
  marked: boolean
  /** A mark or unmark is in flight. */
  pending: boolean
  /** `Deload rules (from Settings): …`, or null when no rule is on (an unset feature shows nothing). */
  rulesLine: string | null
  /** "Already started — sets left as they are", after a mark a started session held back. */
  notice: string | null
  /** The failure of the last mark or unmark; null when none. */
  error: unknown
  onToggle: () => void
  onClose: () => void
}

const ROW: CSSProperties = {
  width: '100%',
  minHeight: 48,
  boxSizing: 'border-box',
  padding: '0 2px',
  borderWidth: 0,
  borderBottomWidth: 1,
  borderBottomStyle: 'solid',
  borderBottomColor: 'var(--border-subtle)',
  background: 'transparent',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  textAlign: 'left',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.2em',
}

export default function WeekMenuSheet({ programName, unit, weekNumber, marked, pending, rulesLine, notice, error, onToggle, onClose }: WeekMenuSheetProps) {
  const word = unit.toUpperCase()
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const label = pending ? (marked ? 'UNMARKING…' : 'MARKING…') : marked ? `UNMARK THIS ${word}` : `MARK ${word} AS DELOAD`
  return (
    <BottomSheet eyebrow={programName} title={`${unit === 'week' ? 'Week' : 'Cycle'} ${weekNumber}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={onToggle}
            disabled={pending}
            aria-disabled={pending}
            style={{ ...ROW, color: pending ? 'var(--text-muted)' : marked ? 'var(--accent)' : 'var(--text-primary)', cursor: pending ? 'default' : 'pointer' }}
          >
            <span>{label}</span>
            {marked && !pending && (
              <span
                style={{
                  flex: '0 0 auto',
                  fontWeight: 600,
                  fontSize: 9,
                  letterSpacing: '0.15em',
                  padding: '3px 6px',
                  borderRadius: 6,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: 'var(--accent)',
                  background: 'var(--accent-muted)',
                  color: 'var(--accent)',
                }}
              >
                DELOAD
              </span>
            )}
          </button>
        </div>
        {rulesLine && <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>{rulesLine}</span>}
        {notice && <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)' }}>{notice}</span>}
        {error !== null && error !== undefined && (
          <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', color: 'var(--error)' }}>
              {marked ? `Couldn't unmark the ${unit}.` : `Couldn't mark the ${unit}.`}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{errorReason(error, offline)}</span>
          </div>
        )}
      </div>
    </BottomSheet>
  )
}
