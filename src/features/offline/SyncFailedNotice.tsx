import { useState } from 'react'
import { useOfflineStore } from './offlineStore'
import { retrySyncFailures } from './useSyncQueue'

// One line on the screen a stuck write belongs to: its session's workout
// screen, finished screen and History detail (`sessionId`), or the Coach page
// for a note with no session (`sessionId` null). Counts the writes that
// stopped retrying plus those held behind them (useSyncQueue.ts). Renders
// nothing when there are none, so a screen without failures is unchanged.
//
// `variant="strip"` (chunk 58b, board W4) is the workout screen's own look: a full-width strip under its header, "1 CHANGE COULDN'T
// SYNC" with a RETRY button, and "RETRYING…" alone while the retry runs. The other screens keep the button they have.
export default function SyncFailedNotice({
  sessionId,
  className,
  variant = 'button',
}: {
  sessionId: string | null
  className?: string
  variant?: 'button' | 'strip'
}) {
  const count = useOfflineStore((s) => s.syncFailures.filter((f) => f.sessionId === sessionId).length)
  const [retrying, setRetrying] = useState(false)
  if (count === 0) return null

  async function retry() {
    if (retrying) return
    setRetrying(true)
    try {
      await retrySyncFailures()
    } catch (err) {
      console.error('[sync] retry failed', err)
    } finally {
      setRetrying(false)
    }
  }

  if (variant === 'strip') {
    return (
      <div
        role="status"
        className={className}
        style={{
          minHeight: 44,
          boxSizing: 'border-box',
          padding: '4px 16px',
          borderBottomWidth: 1,
          borderBottomStyle: 'solid',
          borderBottomColor: 'var(--border-subtle)',
          backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontFamily: 'var(--font-mono)',
          fontWeight: 600,
          fontSize: 10,
          letterSpacing: '0.15em',
          color: 'var(--error)',
        }}
      >
        <span style={{ flex: 1 }}>{retrying ? 'RETRYING…' : `${count === 1 ? '1 CHANGE' : `${count} CHANGES`} COULDN'T SYNC`}</span>
        {!retrying && (
          <button
            type="button"
            onClick={retry}
            className="flex-shrink-0"
            style={{
              height: 36,
              padding: '0 10px',
              borderRadius: 8,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: 'var(--border-strong)',
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontWeight: 600,
              fontSize: 10,
              letterSpacing: '0.15em',
            }}
          >
            RETRY
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={className}>
      <button
        onClick={retry}
        disabled={retrying}
        className="w-full text-left px-3 py-2 rounded-lg"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)',
          color: 'var(--error)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.04em',
          cursor: retrying ? 'default' : 'pointer',
        }}
      >
        {retrying
          ? 'RETRYING…'
          : `${count === 1 ? '1 change' : `${count} changes`} couldn't sync. Tap to retry.`}
      </button>
    </div>
  )
}
