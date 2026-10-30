import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { hairline } from '../../components/pickers/pickerControls'
import { RELEASES } from '../../data/releaseNotes'
import ReleaseNotesBody, { LABEL, formatReleaseDate } from './ReleaseNotesBody'

// /settings/whats-new/:version — one release's notes (SPEC.md 1.2.1, Settings · WHAT'S NEW: "A row opens that release's notes"). Back goes
// to Settings and replaces this page in the history, so Back from Settings does not return here. A version the notes don't hold opens the
// newest release's notes (the prototype's choice; the card only links versions it lists). The notes ship with the app, so this page
// reads and asks for nothing.
export default function ReleaseNotesPage() {
  const navigate = useNavigate()
  const { version } = useParams<{ version: string }>()
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
          <span style={{ ...LABEL, fontWeight: 600 }}>WHAT'S NEW · {formatReleaseDate(release.date)}</span>
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
