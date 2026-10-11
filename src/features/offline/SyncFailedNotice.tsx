import { useState } from 'react'
import { useOfflineStore } from './offlineStore'
import { retrySyncFailures } from './useSyncQueue'

// One line on the screen a stuck write belongs to: its session's workout
// screen, finished screen and History detail (`sessionId`), or the Coach page
// for a note with no session (`sessionId` null). Counts the writes that
// stopped retrying plus those held behind them (useSyncQueue.ts). Renders
// nothing when there are none, so a screen without failures is unchanged.
export default function SyncFailedNotice({ sessionId, className }: { sessionId: string | null; className?: string }) {
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
