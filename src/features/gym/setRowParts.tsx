// Chunk 58a — the pieces the workout's rows share (boards W1–W3b): the number cell, the sync marker, the LAST line, the cue line.
import type { CSSProperties } from 'react'
import { Check, Tag } from 'lucide-react'
import { useOfflineStore } from '../offline/offlineStore'

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

/** Where a logged row stands with the server: the tick, SYNC (queued on this phone) or SYNC FAILED (stopped retrying). */
export function SyncMark({ logId }: { logId: string }) {
  const isPending = useOfflineStore((s) => s.pendingIds.has(logId))
  const isFailed = useOfflineStore((s) => s.failedIds.has(logId))
  if (isFailed) {
    return (
      <span
        className="text-xs font-bold px-1.5 py-0.5 rounded"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)',
          color: 'var(--error)',
          fontFamily: MONO,
          fontSize: 9,
          letterSpacing: '0.06em',
        }}
        title="Couldn't sync — still queued on this device; tap the notice at the top to retry"
      >
        SYNC FAILED
      </span>
    )
  }
  if (isPending) {
    return (
      <span
        className="text-xs font-bold px-1.5 py-0.5 rounded"
        style={{ backgroundColor: 'var(--accent-muted)', color: 'var(--accent)', fontFamily: MONO, fontSize: 9, letterSpacing: '0.06em' }}
      >
        SYNC
      </span>
    )
  }
  return <Check size={14} style={{ color: 'var(--accent)' }} />
}

/** "LAST 52.5 × 10 @ 1" under an open row (board W1): last time's numbers, never a value in the boxes (DECISIONS 162). */
export function LastLine({ text, loading = false }: { text: string; loading?: boolean }) {
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
