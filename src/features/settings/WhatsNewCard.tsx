import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { RELEASES } from '../../data/releaseNotes'
import { APP_VERSION, compareVersions } from '../../lib/version'
import { MONO, formatReleaseDate } from './ReleaseNotesBody'

// Settings · WHAT'S NEW (SPEC.md 1.2.1, Screens): one row per release, newest first (version, date, THIS VERSION on the running one, a
// chevron); a row opens that release's notes at /settings/whats-new/:version. The notes ship inside the app (src/data/releaseNotes.ts),
// so the card reads and asks for nothing and works offline. SettingsPage passes its own card style, so the card sits like the sections
// around it.
export default function WhatsNewCard({ cardStyle }: { cardStyle: CSSProperties }) {
  const navigate = useNavigate()
  return (
    <div className="rounded-xl" style={{ ...cardStyle, overflow: 'hidden' }}>
      {RELEASES.map((release, i) => (
        <button
          key={release.version}
          type="button"
          onClick={() => navigate(`/settings/whats-new/${release.version}`)}
          className="w-full flex items-center gap-3 px-4 text-left"
          style={{ minHeight: 52, borderTop: i === 0 ? 'none' : '1px solid var(--border)', background: 'transparent', cursor: 'pointer' }}
        >
          <span style={{ ...MONO, fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{release.version}</span>
          {compareVersions(release.version, APP_VERSION) === 0 && (
            <span
              style={{ ...MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.15em', color: 'var(--accent)', background: 'var(--accent-muted)', borderRadius: 6, padding: '3px 6px' }}
            >
              THIS VERSION
            </span>
          )}
          <span style={{ ...MONO, fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{formatReleaseDate(release.date)}</span>
          <ChevronRight size={16} style={{ color: 'var(--text-dim)', flex: '0 0 auto' }} />
        </button>
      ))}
    </div>
  )
}
