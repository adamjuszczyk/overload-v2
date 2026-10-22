// Chunk 58b — the "last time" sheet (boards W16, W17): opened from an exercise card's history icon and its "LAST = …" line. LAST WEEK (or
// LAST TIME with its elapsed time), EARLIER THIS WEEK when the exercise was done earlier this week, the reach-back when the matched
// session was all skipped, then "Deload sessions are left out." and FULL HISTORY. What it says comes from `lastTimeView.ts`.
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import BottomSheet from '../../components/BottomSheet'
import type { LastTimePanel, LastTimeRow, LastTimeView } from './lastTimeView'

const MONO = 'var(--font-mono)'

function Row({ row }: { row: LastTimeRow }) {
  return (
    <div data-last-row style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 36, paddingLeft: row.stage ? 18 : 0 }}>
      <span style={{ width: 22, flex: '0 0 auto', fontFamily: MONO, fontWeight: 700, fontSize: 12, color: 'var(--text-muted)' }}>{row.n}</span>
      <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 14, color: row.badge === 'SKIPPED' ? 'var(--text-dim)' : 'var(--text-primary)' }}>{row.text}</span>
      {row.rir !== '' && <span style={{ fontFamily: MONO, fontSize: 12, color: 'var(--text-secondary)' }}>{row.rir}</span>}
      <span style={{ marginLeft: 'auto', fontFamily: MONO, fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>{row.badge}</span>
    </div>
  )
}

function Panel({ title, when, rows }: { title: string; when: string; rows: LastTimeRow[] }) {
  return (
    <section data-last-panel={title} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontFamily: MONO, fontWeight: 700, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-primary)' }}>{title}</span>
        <span style={{ fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)', textAlign: 'right' }}>{when}</span>
      </div>
      {rows.length > 0 && (
        <div style={{ backgroundColor: 'var(--surface-raised)', borderRadius: 10, padding: '4px 12px' }}>
          {rows.map((row, i) => (
            <Row key={i} row={row} />
          ))}
        </div>
      )}
    </section>
  )
}

export default function LastTimeSheet({
  exerciseId,
  exerciseName,
  view,
  onRetry,
  onClose,
}: {
  exerciseId: string
  exerciseName: string
  view: LastTimeView
  /** Asks the reference again (the batched read's retry). */
  onRetry: () => void
  onClose: () => void
}) {
  const { body } = view
  return (
    <BottomSheet eyebrow={exerciseName.toUpperCase()} title="Last time" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {body.kind === 'loading' && <Panel title="LAST WEEK" when="···" rows={[{ n: '', text: '···', rir: '', badge: '', stage: false }]} />}
        {body.kind === 'failed' && (
          <div
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 40, padding: '0 4px', fontFamily: MONO, fontWeight: 600, fontSize: 10, letterSpacing: '0.15em' }}
          >
            <span style={{ color: 'var(--error)' }}>COULDN'T LOAD LAST TIME</span>
            <button
              type="button"
              onClick={onRetry}
              style={{
                height: 36,
                padding: '0 10px',
                borderRadius: 8,
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'var(--border-strong)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                fontFamily: MONO,
                fontWeight: 600,
                fontSize: 10,
                letterSpacing: '0.15em',
              }}
            >
              RETRY
            </button>
          </div>
        )}
        {body.kind === 'first_time' && <Panel title="FIRST TIME" when="" rows={[]} />}
        {body.kind === 'panels' && body.panels.map((panel: LastTimePanel, i) => <Panel key={`${panel.title}-${i}`} title={panel.title} when={panel.when} rows={panel.rows} />)}
        {body.kind === 'panels' && body.note !== null && (
          <span data-last-note style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-muted)' }}>
            {body.note}
          </span>
        )}
        <span style={{ fontSize: 12, lineHeight: 1.45, color: 'var(--text-muted)' }}>Deload sessions are left out.</span>
        <Link
          to={`/exercise/${exerciseId}`}
          style={{
            height: 48,
            boxSizing: 'border-box',
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: 'var(--border-strong)',
            backgroundColor: 'var(--surface)',
            textDecoration: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontFamily: MONO,
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: '0.2em',
            color: 'var(--text-primary)',
          }}
        >
          FULL HISTORY
          <ChevronRight size={12} aria-hidden="true" />
        </Link>
      </div>
    </BottomSheet>
  )
}
