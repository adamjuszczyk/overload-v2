// `lastSeenNotesVersion`: the newest version whose notes this phone has shown (SPEC.md 1.2.1, "On the phone"; TASKS.md, Data model).
//
// Kept where the app keeps its other per-phone settings, in `localStorage` (the warmup routine's ticks, warmupRoutineStore.ts): never in
// a table, never queued, never sent, and not cleared at sign-out, because the mark belongs to the phone and not to an account. The sheet
// after an update opens when the running version is newer than this mark, or when there is no mark at all (AfterUpdateSheet.tsx), and
// closing it any way writes the running version here.
//
// Every access is in try/catch: private browsing in some browsers, a full quota or a disabled store make `getItem` / `setItem` throw.
// A store that can't be read reads as no mark (the sheet shows), and a write that fails is lost (the sheet shows again at the next
// start): the guiding rule, the simplest behaviour that never wrongly writes data, even if a rare case displays imperfectly.
export const NOTES_SEEN_KEY = 'overload:lastSeenNotesVersion'

/** The mark, or null when this phone has none (never opened a version's notes, or its store can't be read). */
export function readLastSeenNotesVersion(): string | null {
  try {
    const raw = localStorage.getItem(NOTES_SEEN_KEY)
    return raw !== null && raw.trim() !== '' ? raw.trim() : null
  } catch {
    return null
  }
}

/** Writes the version whose notes have been shown. A store that refuses it is not an error: the notes show again next time. */
export function markNotesSeen(version: string): void {
  try {
    localStorage.setItem(NOTES_SEEN_KEY, version)
  } catch {
    // Ignored: see the header.
  }
}
