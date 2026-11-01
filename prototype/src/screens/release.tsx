import type { CSSProperties } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { hairline } from '@app/components/pickers/pickerControls'
import BottomSheet from '@app/components/BottomSheet'
import { RELEASES, APP_VERSION, type Release } from '../data/releaseNotes'
import { useDemo } from '../demo/demoStore'

const mono: CSSProperties = { fontFamily: 'var(--font-mono)' }
const label: CSSProperties = { ...mono, fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--text-muted)' }
const fmtDate = (iso: string) => format(parseISO(iso), 'd MMM yyyy').toUpperCase()

// The notes of one release, as groups of short lines. Shared by the notes
// screen and the once-after-an-update sheet.
export function ReleaseNotesBody({ release }: { release: Release }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {release.groups.map((g) => (
        <div key={g.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ ...label, margin: 0 }}>{g.title.toUpperCase()}</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {g.items.map((item) => (
              <li key={item} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                <span aria-hidden style={{ flex: '0 0 auto', width: 4, height: 4, marginTop: 8, borderRadius: 2, background: 'var(--text-dim)' }} />
                <span style={{ minWidth: 0 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

// Settings → WHAT'S NEW: every release, newest first.
export function WhatsNewCard({ cardStyle }: { cardStyle: CSSProperties }) {
  const navigate = useNavigate()
  return (
    <div className="rounded-xl" style={{ ...cardStyle, overflow: 'hidden' }}>
      {RELEASES.map((r, i) => (
        <button
          key={r.version}
          type="button"
          onClick={() => navigate(`/settings/whats-new/${r.version}`)}
          className="w-full flex items-center gap-3 px-4 text-left"
          style={{ minHeight: 52, borderTop: i === 0 ? 'none' : '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
        >
          <span style={{ ...mono, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{r.version}</span>
          {r.version === APP_VERSION && (
            <span style={{ ...mono, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--accent)', background: 'var(--accent-muted)', borderRadius: 6, padding: '3px 6px' }}>
              THIS VERSION
            </span>
          )}
          <span style={{ ...mono, fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{fmtDate(r.date)}</span>
          <ChevronRight size={16} style={{ color: 'var(--text-dim)', flex: '0 0 auto' }} />
        </button>
      ))}
    </div>
  )
}

// /settings/whats-new/:version — one release's notes.
export function ReleaseNotesPage() {
  const navigate = useNavigate()
  const { version } = useParams()
  const release = RELEASES.find((r) => r.version === version) ?? RELEASES[0]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      <div style={{ padding: '16px 16px 14px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }}>
        <button
          type="button"
          onClick={() => navigate('/settings', { replace: true })}
          aria-label="Back to Settings"
          style={{ flex: '0 0 auto', width: 44, height: 44, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-raised)', ...hairline('var(--border-strong)'), borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ ...label, fontWeight: 600 }}>WHAT'S NEW · {fmtDate(release.date)}</span>
          <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, lineHeight: 1.05, color: 'var(--text-primary)' }}>
            OVERLOAD {release.version}
          </h1>
        </div>
      </div>
      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', padding: '18px 20px 32px', minHeight: 0 }}>
        <ReleaseNotesBody release={release} />
      </div>
    </div>
  )
}

// Shown once, over the screen the app opens on, the first time a new version runs.
export function AfterUpdateSheet() {
  const set = useDemo((s) => s.set)
  const close = () => set({ afterUpdateSheet: false })
  return (
    <BottomSheet
      eyebrow={`UPDATED · ${fmtDate(RELEASES[0].date)}`}
      title={`OVERLOAD ${RELEASES[0].version}`}
      onClose={close}
      footer={
        <button
          type="button"
          onClick={close}
          className="w-full rounded-xl text-xs font-bold"
          style={{ minHeight: 48, background: 'var(--accent)', color: 'var(--on-accent)', ...mono, letterSpacing: '0.1em' }}
        >
          GOT IT
        </button>
      }
    >
      <ReleaseNotesBody release={RELEASES[0]} />
    </BottomSheet>
  )
}

export default WhatsNewCard
