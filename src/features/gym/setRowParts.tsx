// Chunk 58a — the pieces the workout's rows share (boards W1–W3b): the number cell, the sync marker, the LAST line, the cue line.
import type { CSSProperties } from 'react'
import { Check, Tag } from 'lucide-react'
import { useOfflineStore } from '../offline/offlineStore'
import { retrySyncFailures } from '../offline/useSyncQueue'

const MONO = 'var(--font-mono)'

export const boxStyle = (extra: CSSProperties = {}): CSSProperties => ({
  height: 44,
  backgroundColor: 'var(--surface)',
  color: 'var(--text-primary)',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  borderRadius: 8,
  fontFamily: MONO,
  fontWeight: 700,
  fontSize: 14,
  textAlign: 'center',
  ...extra,
})

/** The number cell: "03", "A2", "W", "↳". `width` is 28 px; the current row, which has the most to fit at 375 px, takes 22. */
export function RowLabel({ text, accent = false, width = 28 }: { text: string; accent?: boolean; width?: number }) {
  return (
    <span
      className="text-xs font-bold text-center flex-shrink-0"
      style={{ width, color: accent ? 'var(--accent)' : 'var(--text-muted)', fontFamily: MONO }}
    >
      {text}
    </span>
  )
}

/** Whether a logged row's write stopped retrying (board W6: the row is tinted and says it is only on this phone). */
export function useRowSyncFailed(logId: string): boolean {
  return useOfflineStore((s) => s.failedIds.has(logId))
}

/** The tint of a row whose write couldn't sync (board W6). */
export const FAILED_ROW_BACKGROUND = 'color-mix(in srgb, var(--error) 15%, transparent)'

/**
 * Where a logged row stands with the server (boards W1, W6): the tick; SYNC while its write is queued on this phone; "ONLY ON THIS
 * PHONE · RETRY" when the write stopped retrying. The last is a button: it sends the failed writes again, as the notice's RETRY
 * does (`retrySyncFailures`), and the row's own text can't be read as a status alone.
 */
export function SyncMark({ logId }: { logId: string }) {
  const isPending = useOfflineStore((s) => s.pendingIds.has(logId))
  const isFailed = useRowSyncFailed(logId)
  if (isFailed) {
    return (
      <button
        type="button"
        onClick={() => {
          retrySyncFailures().catch((err) => console.error('[sync] retry failed', err))
        }}
        className="font-bold"
        style={{ color: 'var(--error)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.15em', textAlign: 'right', minHeight: 28, padding: '0 2px', marginLeft: 'auto', whiteSpace: 'nowrap' }}
      >
        ONLY ON THIS PHONE · RETRY
      </button>
    )
  }
  if (isPending) {
    return (
      <span className="font-bold" style={{ color: 'var(--accent)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.15em' }}>
        SYNC
      </span>
    )
  }
  return <Check size={14} style={{ color: 'var(--accent)' }} />
}

/**
 * "LAST 52.5 × 10 @ 1" under an open row (board W1): last time's numbers, never a value in the boxes (DECISIONS 162). The line follows
 * the exercise's reference: "LOADING LAST TIME…" while it loads (board W3b), and when it could not be read "COULDN'T LOAD LAST WEEK"
 * with a RETRY that asks the reference again (board W2).
 */
export function LastLine({ text, loading = false, failed = false, onRetry }: { text: string; loading?: boolean; failed?: boolean; onRetry?: () => void }) {
  if (failed) {
    return (
      <div className="flex items-center justify-between" style={{ minHeight: 40, padding: '0 4px', fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.15em' }}>
        <span style={{ color: 'var(--error)' }}>COULDN'T LOAD LAST WEEK</span>
        <button
          type="button"
          onClick={onRetry}
          style={{ height: 36, padding: '0 10px', borderRadius: 8, border: '1px solid var(--border-strong)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)', fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.15em' }}
        >
          RETRY
        </button>
      </div>
    )
  }
  if (loading) {
    return (
      <p className="text-xs" style={{ paddingLeft: 34, color: 'var(--text-muted)', fontFamily: MONO, fontSize: 10, letterSpacing: '0.06em' }}>
        LOADING LAST TIME…
      </p>
    )
  }
  if (text === '') return null
  return (
    <p className="text-xs" style={{ paddingLeft: 34, color: 'var(--text-muted)', fontFamily: MONO, fontSize: 10 }}>
      <span style={{ fontWeight: 700 }}>LAST</span> {text}
    </p>
  )
}

/** The set's cues under the current row (board W1: the tag icon and its text); upcoming rows only mark that there is one. */
export function CueLine({ tags, compact = false }: { tags: readonly string[] | null | undefined; compact?: boolean }) {
  if (!tags || tags.length === 0) return null
  return (
    <p
      className="flex items-center gap-1 flex-wrap font-bold"
      style={{ paddingLeft: 34, color: 'var(--accent)', fontFamily: MONO, fontSize: 11, letterSpacing: '0.04em' }}
    >
      <Tag size={12} />
      {compact ? 'CUE' : tags.map((tag) => tag.toUpperCase()).join(' · ')}
    </p>
  )
}

/** A row's frame: the rounded line a logged or upcoming row sits in. */
export const rowFrame = (extra: CSSProperties = {}): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 44,
  padding: '0 12px',
  borderRadius: 8,
  ...extra,
})
