import type { CSSProperties } from 'react'

// The pieces the three pickers share (TASKS-1.2 chunk 39): the small stepper the set type picker puts
// under a picked staged kind and beside its rest rows. Colours are the app's custom properties,
// none written here. Style values are written the way jsdom keeps them (longhand borders), so a
// captured render still carries every declaration.

/** A 1 px outline in one colour, as longhands (a `border` shorthand with `var()` can be dropped from a captured render). */
export function hairline(color: string): CSSProperties {
  return { borderWidth: 1, borderStyle: 'solid', borderColor: color }
}

/** The small mono caption (DROPS, REST BETWEEN, FROM, TO, REPS). */
export const CAPTION_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  lineHeight: 1.2,
  letterSpacing: '0.2em',
  color: 'var(--text-muted)',
}

const PILL_STYLE: CSSProperties = {
  flex: '0 0 auto',
  boxSizing: 'border-box',
  height: 44,
  display: 'flex',
  alignItems: 'center',
  ...hairline('var(--border)'),
  borderRadius: 10,
  background: 'var(--surface-raised)',
}

const PILL_BUTTON_STYLE: CSSProperties = {
  width: 40,
  height: 42,
  padding: 0,
  borderWidth: 0,
  background: 'transparent',
  fontFamily: 'var(--font-mono)',
  fontSize: 17,
  lineHeight: 1,
  cursor: 'pointer',
}

const PILL_VALUE_STYLE: CSSProperties = {
  textAlign: 'center',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  color: 'var(--text-primary)',
}

/**
 * The − / value / + pill of board 5 (DROPS, REST BETWEEN, "Rest after this set"). It holds nothing
 * itself: the caller says what the value reads and what each tap does, and which taps do nothing
 * (a disabled button, so Tab skips it).
 */
export function StepperPill({
  lessLabel,
  moreLabel,
  onLess,
  onMore,
  lessDisabled,
  moreDisabled,
  valueText,
  valueStyle,
}: {
  lessLabel: string
  moreLabel: string
  onLess: () => void
  onMore: () => void
  lessDisabled: boolean
  moreDisabled: boolean
  valueText: string
  valueStyle: CSSProperties
}) {
  return (
    <div style={PILL_STYLE}>
      <button
        type="button"
        aria-label={lessLabel}
        disabled={lessDisabled}
        onClick={onLess}
        style={{ ...PILL_BUTTON_STYLE, color: lessDisabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: lessDisabled ? 'default' : 'pointer' }}
      >
        −
      </button>
      <span style={{ ...PILL_VALUE_STYLE, ...valueStyle }}>{valueText}</span>
      <button
        type="button"
        aria-label={moreLabel}
        disabled={moreDisabled}
        onClick={onMore}
        style={{ ...PILL_BUTTON_STYLE, color: moreDisabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: moreDisabled ? 'default' : 'pointer' }}
      >
        +
      </button>
    </div>
  )
}
