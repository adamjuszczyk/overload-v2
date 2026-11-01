import type { CSSProperties } from 'react'
import { format, parseISO } from 'date-fns'
import type { Release } from '../../data/releaseNotes'

// One release's notes as groups of short lines (SPEC.md 1.2.1, Settings · WHAT'S NEW; the prototype's "Release notes" and "After an update").
// Drawn by the notes screen (ReleaseNotesPage.tsx) and by the sheet after an update (AfterUpdateSheet.tsx), so the two read the same.
// Tokens only: no colour is written here.

export const MONO: CSSProperties = { fontFamily: 'var(--font-mono)' }
export const LABEL: CSSProperties = { ...MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--text-muted)' }

/** A release's date as the screens print it: `5 NOV 2026`. */
export function formatReleaseDate(isoDate: string): string {
  return format(parseISO(isoDate), 'd MMM yyyy').toUpperCase()
}

export default function ReleaseNotesBody({ release }: { release: Release }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {release.groups.map((group) => (
        <div key={group.title} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ ...LABEL, margin: 0 }}>{group.title.toUpperCase()}</p>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
            {group.items.map((item, i) => (
              <li key={i} style={{ display: 'flex', gap: 10, fontSize: 14, lineHeight: 1.45, color: 'var(--text-secondary)' }}>
                <span aria-hidden style={{ flex: '0 0 auto', width: 4, height: 4, marginTop: 8, borderRadius: 2, background: 'var(--text-dim)' }} />
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
