import { useRef, useState } from 'react'
import BottomSheet from '../../components/BottomSheet'
import { RELEASES } from '../../data/releaseNotes'
import { APP_VERSION, compareVersions } from '../../lib/version'
import ReleaseNotesBody, { MONO, formatReleaseDate } from './ReleaseNotesBody'
import { markNotesSeen, readLastSeenNotesVersion } from './releaseNotesSeen'

// The running version's notes, once (SPEC.md 1.2.1, Settings · WHAT'S NEW, "Shown once"; Adam, 2026-10-30, TASKS question 7, DECISIONS 256).
//
// The first time a version runs on a phone, its notes open as a sheet over the screen the app opened on, with GOT IT. That is when the
// running version is newer than the phone's mark (`lastSeenNotesVersion`, releaseNotesSeen.ts) or the phone has no mark at all, so every
// phone sees 1.2.1's notes once. Closing the sheet any way (GOT IT, the close control, a tap on the scrim, Escape) writes the running
// version as the mark, once, so the next start does not show it again.
//
// App.tsx mounts this in the signed-in shell only, so it opens over the first signed-in screen and never over the login page. The
// mark is read once, when the sheet mounts. Nothing here is sent anywhere: the notes ship with the app and the mark lives on the phone.
export default function AfterUpdateSheet() {
  const [open, setOpen] = useState(() => compareVersions(APP_VERSION, readLastSeenNotesVersion() ?? '0') > 0)
  const closed = useRef(false)

  if (!open) return null

  // The running version's own notes; the newest entry if the data file doesn't hold the running version (a test keeps the two equal).
  const release = RELEASES.find((r) => compareVersions(r.version, APP_VERSION) === 0) ?? RELEASES[0]

  function close() {
    if (closed.current) return // two presses in one instant write once
    closed.current = true
    markNotesSeen(APP_VERSION)
    setOpen(false)
  }

  return (
    <BottomSheet
      eyebrow={`UPDATED · ${formatReleaseDate(release.date)}`}
      title={`OVERLOAD ${release.version}`}
      onClose={close}
      footer={
        <button
          type="button"
          onClick={close}
          className="w-full rounded-xl text-xs font-bold"
          style={{ minHeight: 48, background: 'var(--accent)', color: 'var(--on-accent)', ...MONO, letterSpacing: '0.1em' }}
        >
          GOT IT
        </button>
      }
    >
      <ReleaseNotesBody release={release} />
    </BottomSheet>
  )
}
