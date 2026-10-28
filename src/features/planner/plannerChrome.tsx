import type { CSSProperties, ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { hairline } from '../../components/pickers/pickerControls'

// Chunk 68 (TASKS-1.2; boards PP1–PP6): the small pieces the stepped planner's screens share, drawn from the app's own tokens. The planner
// draws the boards' look and keeps every write it had: nothing here knows what a step is for. Borders are longhands (RULES: jsdom drops a
// `border` shorthand holding `var()` when a side follows it), so a captured render carries every declaration.

export const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }

/** The boards' display face for a name (workout, program): the app's `--font-display`. */
export const HEADING: CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 900 }

/** A card: 12 px corners, a hairline, the surface. */
export const CARD: CSSProperties = { background: 'var(--surface)', ...hairline('var(--border)'), borderRadius: 12, boxSizing: 'border-box' }

/** The mono caption over a list (OPTIONAL — SKIP IF YOU DON'T NEED IT, WARMUP ROUTINE, WORKOUT NAME). */
export const CAPTION: CSSProperties = { ...MONO, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

export function ruleBelow(color = 'var(--border-subtle)'): CSSProperties {
  return { borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: color }
}

export function ruleAbove(color = 'var(--border-subtle)'): CSSProperties {
  return { borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: color }
}

/** A spinner on its own line, named for a screen reader and for a test. */
export function Spinner({ label = 'Loading', size = 20, padding = '32px 0' }: { label?: string; size?: number; padding?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding }}>
      <div
        role="status"
        aria-label={label}
        className="animate-spin"
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          boxSizing: 'border-box',
          borderWidth: 2,
          borderStyle: 'solid',
          borderTopColor: 'var(--accent)',
          borderRightColor: 'var(--border-strong)',
          borderBottomColor: 'var(--border-strong)',
          borderLeftColor: 'var(--border-strong)',
        }}
      />
    </div>
  )
}

/** The board's chevron (a polyline, drawn here rather than through lucide so a test that counts the arrows that move things counts only those). */
export function Chevron({ up = false, size = 16 }: { up?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points={up ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
    </svg>
  )
}

/** A 44 px icon button with no outline (the arrows, the trash, the chevron the boards draw on a row). */
export function IconButton({
  label,
  onClick,
  disabled = false,
  expanded,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  expanded?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={expanded}
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: '0 0 auto',
        width: 44,
        height: 44,
        padding: 0,
        borderWidth: 0,
        background: 'transparent',
        color: disabled ? 'var(--text-dim)' : 'var(--text-muted)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

/** A dashed "+ ADD …" button (PP2: + ADD EXERCISE, + ADD ITEM, + ADD SLOT, + ADD WORKOUT). The plus is drawn, not read: the label is the words. */
export function DashedButton({
  label,
  onClick,
  height = 44,
  radius = 10,
  disabled = false,
}: {
  label: string
  onClick: () => void
  height?: number
  radius?: number
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...MONO,
        width: '100%',
        height,
        boxSizing: 'border-box',
        borderRadius: radius,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: 'var(--border-strong)',
        background: 'transparent',
        color: 'var(--text-secondary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        fontSize: 10,
        letterSpacing: '0.2em',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      <span aria-hidden="true">+</span>
      {label}
    </button>
  )
}

/**
 * An error line (PP5b, PP4b): the alert icon and the headline in the error colour, and under it the real reason, the message the server or the
 * client actually returned (SPEC, Errors (15)), in mono. A name or a reason with no break in it wraps inside the line.
 */
export function ErrorLine({ headline, reason }: { headline: string; reason?: string }) {
  return (
    <div role="alert" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
      <span style={{ flex: '0 0 auto', paddingTop: 2, color: 'var(--error)' }}>
        <CircleAlert size={16} strokeWidth={2.2} aria-hidden="true" />
      </span>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--error)', overflowWrap: 'anywhere' }}>{headline}</span>
        {reason !== undefined && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{reason}</span>}
      </span>
    </div>
  )
}
