import type { CSSProperties, ReactNode } from 'react'
import BottomSheet from '../../components/BottomSheet'
import { errorReason } from '../../components/exercisePickerLogic'

// Chunk 54b (TASKS-1.2 "Plan's week view" → SessionMenuSheet; SPEC Deload [1.2]: "session deload in the session's ⋯"; Scheduling: "In Plan it's in
// the session's ⋯ (C2), for any session of the current week"; board 10's menu frames). "[DAY] · WEEK n" over the workout's name: MARK THIS
// SESSION AS DELOAD (UNMARK THIS SESSION with the DELOAD chip once marked), the line that says a shared plan marks every day that shares it
// ("Marks Mon, Thu — they share one plan."), "Already started — sets left as they are" after a mark or unmark a started session held back,
// and MOVE THIS SESSION (the caller's row: only a weekday run's current week has one). It replaces the DELOAD toggle and the MOVE THIS SESSION
// button that sat above the week panel.
//
// It writes nothing itself: the caller passes `onToggle`, which marks or unmarks through `useSetDeload` with the Settings rules. The sheet
// stays open after a mark so it shows the state it made (as WEEK ⋯ does), and closes with ×, a tap on the scrim or Escape. While a mark is
// out the row reads MARKING… and while an unmark is, UNMARKING…, from the request itself (`pendingDeload`), not from whether the session reads as
// marked, because the mark is patched into the week before it lands (DECISIONS 187 (a)); the row is disabled until it has landed.
//
// Display choices no board settles, provisional under D31: a failed mark or unmark is a line under the row, "Couldn't mark the session."
// (or "unmark") and the real reason under it (SPEC Errors (15)).

export interface SessionMenuSheetProps {
  /** `TUESDAY · WEEK 2`, or `SLOT 3 · CYCLE 3`. */
  eyebrow: string
  /** The workout's name. */
  title: string
  /** The session is marked deload. */
  marked: boolean
  /** A mark or unmark is in flight: the row is disabled until it has landed. */
  pending: boolean
  /** What the request in flight asks for, from the request itself: true is a mark (MARKING…), false an unmark (UNMARKING…). Read only while `pending`. */
  pendingDeload: boolean
  /** "Marks Mon, Thu — they share one plan.", for a plan that covers more than one weekday; null otherwise. */
  sharedLine: string | null
  /** "Already started — sets left as they are", after a mark or unmark a started session held back. */
  notice: string | null
  /** The failure of the last mark or unmark; null when none. */
  error: unknown
  onToggle: () => void
  onClose: () => void
  /** The MOVE THIS SESSION row, where this session can be moved at all (a weekday run's current week); null: no row (a later week, a sequence slot). */
  moveRow: ReactNode
}

export const MENU_ROW: CSSProperties = {
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

/** A line of small print under a menu row (board 10). */
export const MENU_NOTE: CSSProperties = { margin: 0, padding: '12px 2px', fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: 'var(--border-subtle)' }

export default function SessionMenuSheet({ eyebrow, title, marked, pending, pendingDeload, sharedLine, notice, error, onToggle, onClose, moveRow }: SessionMenuSheetProps) {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  const label = pending ? (pendingDeload ? 'MARKING…' : 'UNMARKING…') : marked ? 'UNMARK THIS SESSION' : 'MARK THIS SESSION AS DELOAD'
  return (
    <BottomSheet eyebrow={eyebrow} title={title} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)' }}>
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          aria-disabled={pending}
          style={{ ...MENU_ROW, color: pending ? 'var(--text-muted)' : marked ? 'var(--accent)' : 'var(--text-primary)', cursor: pending ? 'default' : 'pointer' }}
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
        {sharedLine && <p style={MENU_NOTE}>{sharedLine}</p>}
        {notice && <p style={MENU_NOTE}>{notice}</p>}
        {error !== null && error !== undefined && (
          <div role="alert" style={{ ...MENU_NOTE, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', color: 'var(--error)' }}>
              {marked ? "Couldn't unmark the session." : "Couldn't mark the session."}
            </span>
            <span style={{ fontSize: 13, lineHeight: 1.45 }}>{errorReason(error, offline)}</span>
          </div>
        )}
        {moveRow}
      </div>
    </BottomSheet>
  )
}
