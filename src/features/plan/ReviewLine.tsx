import type { CSSProperties } from 'react'
import { reviewLineText, type ReviewUnit } from './reviewLogic'
import { useReview, type ReviewReadArgs } from './useReview'

// Chunk 56 (TASKS-1.2 "REVIEW"; SPEC [1.2] Review (13): "When last week differed from its plan anywhere, one line appears in the week view
// under COPY / VOLUME / WEEK ... With nothing left to decide, the line isn't shown. Nothing is drawn on the set rows."; board 1's line).
// "LAST WEEK · 3 things went differently · REVIEW →", one button that opens board 4's sheet. It draws only once both reads have answered and
// something is left to decide: while they are out, after one failed, and with every item decided there is no line. Display choices no board
// settles, provisional under D31: a read that failed draws nothing (the next visit reads again; the sheet's own errors are per item), and a
// sequence run says LAST CYCLE.

export interface ReviewLineProps extends ReviewReadArgs {
  unit: ReviewUnit
  onOpen: () => void
}

const LINE: CSSProperties = {
  width: '100%',
  minHeight: 48,
  boxSizing: 'border-box',
  padding: '0 14px',
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border-strong)',
  background: 'var(--surface-raised)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  marginBottom: 14,
  textAlign: 'left',
  cursor: 'pointer',
}

const CAPTION: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }

export default function ReviewLine({ unit, onOpen, ...args }: ReviewLineProps) {
  const read = useReview(args)
  if (read.status !== 'ready' || read.count === 0) return null
  const text = reviewLineText(read.count, unit)
  return (
    <button type="button" data-review-line onClick={onOpen} style={LINE}>
      <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={CAPTION}>{text.caption}</span>
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>{text.text}</span>
      </span>
      <span style={{ ...CAPTION, fontSize: 10, color: 'var(--accent)' }}>{text.link}</span>
    </button>
  )
}
