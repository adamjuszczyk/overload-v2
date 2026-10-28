// Chunk 58b — the workout screen's header and its offline strip (boards W1, W4, W6). The header is the session's identity on the left
// (the week and weekday, or the cycle and slot; the workout's name; IN PROGRESS) and its clock and set count on the right. The
// strip sits under it while the phone is offline; Nav's own strip at the bottom of the screen stays (TASKS 58b).
import type { ReactNode } from 'react'
import { WifiOff } from 'lucide-react'

const MONO = 'var(--font-mono)'

export default function WorkoutHeader({
  eyebrow,
  name,
  clock,
  progress,
  action,
}: {
  eyebrow: string
  name: string
  /** `48:12`. */
  clock: string
  /** `6 OF 15 SETS`. */
  progress: string
  /** The COACH button (Adam only): above the clock, as it stood at the right of the old header. */
  action?: ReactNode
}) {
  return (
    <header
      style={{
        padding: '18px 16px 14px',
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: 'var(--border-subtle)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 12,
      }}
    >
      <div className="min-w-0" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{eyebrow}</span>
        <h1
          style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontWeight: 900,
            fontSize: 30,
            lineHeight: 1,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)',
            overflowWrap: 'anywhere',
          }}
        >
          {name}
        </h1>
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>IN PROGRESS</span>
      </div>
      <div className="flex-shrink-0" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        {action}
        <span data-workout-clock style={{ fontFamily: MONO, fontWeight: 700, fontSize: 20, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
          {clock}
        </span>
        <span data-workout-progress style={{ fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.15em', color: 'var(--accent)' }}>
          {progress}
        </span>
      </div>
    </header>
  )
}

/** Board W6: under the header while the phone has no network. The sets logged meanwhile queue and send on reconnect. */
export function OfflineStrip() {
  return (
    <div
      role="status"
      style={{
        minHeight: 44,
        boxSizing: 'border-box',
        padding: '4px 16px',
        borderBottomWidth: 1,
        borderBottomStyle: 'solid',
        borderBottomColor: 'var(--border-subtle)',
        backgroundColor: 'var(--surface-raised)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: MONO,
        fontWeight: 600,
        fontSize: 10,
        letterSpacing: '0.15em',
        color: 'var(--text-secondary)',
      }}
    >
      <WifiOff size={14} className="flex-shrink-0" aria-hidden="true" />
      <span style={{ flex: 1 }}>OFFLINE · SETS WILL SYNC WHEN YOU RECONNECT</span>
    </div>
  )
}
