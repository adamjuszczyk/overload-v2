import type { CSSProperties } from 'react'
import BottomSheet from '../../components/BottomSheet'
import { hairline } from '../../components/pickers/pickerControls'
import type { LockDecision } from './workoutRules'

// Chunk 60 (TASKS-1.2 60; board W7b; SPEC [1.2] "Log lock (18a)"): the question the log lock asks. With "Log sets in order" on, LOG on a row that
// is not the current set opens this sheet instead of logging: "Log A2 before set 03?" over what comes next, CANCEL and LOG A2, and the line that
// says where the question is turned off. The words are 46r's `lockDecision` (`ask`, `next`, `label`); the sheet adds none of its own but the
// sentence around them, which is the board's.
//
// It writes nothing. `onConfirm` is the tapped row's own LOG, which the caller held while the sheet was open (the numbers typed in the row, the
// row's number and the unchanged write path with them), and `onCancel`, also asked for by the close button, a tap on the scrim and Escape,
// leaves everything as it was: the row keeps what was typed, and nothing is logged.
//
// The last line names the setting as SPEC does, "LOG SETS IN ORDER" (DECISIONS 158 (e), Adam 2026-10-16: "all accepted, including (e)"), where board
// W7b still draws the older "LOG IN ORDER". Display choices no board settles, provisional under D31: a row that isn't in a superset is named "set 04" in
// the eyebrow and on the button ("LAT PULLDOWN · SET 04", "LOG SET 04"), as 46r's `rowLabel` names it in the title, and the board's 4 px pull of the
// line under the title is the sheet frame's 16 px rhythm here.

/** What `lockDecision` says when LOG must ask first: the title, the next set's name and the tapped row's. */
export type LogOrderQuestion = Exclude<LockDecision, 'log'>

export interface LogOrderPromptProps {
  /** The tapped row's exercise: the eyebrow's first part ("SEATED CABLE ROW · A2"). */
  exerciseName: string
  question: LogOrderQuestion
  /** LOG A2: log the tapped row. */
  onConfirm: () => void
  /** CANCEL, the close button, the scrim and Escape: log nothing. */
  onCancel: () => void
}

const MONO = 'var(--font-mono)'

const LINE_STYLE: CSSProperties = { margin: 0, fontSize: 15, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }
const BUTTON_PAIR_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }
const CANCEL_STYLE: CSSProperties = {
  height: 52,
  boxSizing: 'border-box',
  borderRadius: 10,
  ...hairline('var(--border-strong)'),
  background: 'var(--surface)',
  fontFamily: MONO,
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.15em',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}
const CONFIRM_STYLE: CSSProperties = {
  height: 52,
  borderRadius: 10,
  borderWidth: 0,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontFamily: 'var(--font-display)',
  fontWeight: 800,
  fontSize: 15,
  letterSpacing: '0.03em',
  cursor: 'pointer',
  overflowWrap: 'anywhere',
}
const HINT_STYLE: CSSProperties = { margin: 0, fontFamily: MONO, fontWeight: 600, fontSize: 9, letterSpacing: '0.12em', lineHeight: 1.6, color: 'var(--text-muted)' }

export default function LogOrderPrompt({ exerciseName, question, onConfirm, onCancel }: LogOrderPromptProps) {
  return (
    <BottomSheet eyebrow={`${exerciseName} · ${question.label}`.toUpperCase()} title={question.ask} onClose={onCancel}>
      <p style={LINE_STYLE}>
        The next set is <strong style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{question.next}</strong>. Logging {question.label} now leaves it for later — it
        stays open until you log or skip it.
      </p>
      <div style={BUTTON_PAIR_STYLE}>
        <button type="button" onClick={onCancel} style={CANCEL_STYLE}>
          CANCEL
        </button>
        <button type="button" onClick={onConfirm} style={CONFIRM_STYLE}>
          {`LOG ${question.label.toUpperCase()}`}
        </button>
      </div>
      <p style={HINT_STYLE}>{`DON'T WANT THIS QUESTION? TURN OFF "LOG SETS IN ORDER" IN SETTINGS.`}</p>
    </BottomSheet>
  )
}
