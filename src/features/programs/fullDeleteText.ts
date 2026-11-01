import type { FinishedRunCounts } from '../../types'

// The words of the full-delete confirmation (chunk 75; 1.2.1 item 8b; SPEC Screens → Finished program: full delete; the prototype's
// `FullDeleteBody`, wording agreed 2026-10-29). Pure: `FullDeleteConfirm.tsx` draws them, `fullDeleteText.test.ts` pins every one.
//
//   Title:     "Delete [name]?"
//   Counting:  "Counting what goes…"
//   Counted:   "Deletes its [N weeks]: [N sessions] and [N logged sets][, plus N Coach analyses][ and N Coach notes]. Its results leave History,
//              Progress and every stat. This can't be undone."
//   Offline:   "You're offline. Deleting needs a connection."
//
// Singular and plural follow each count (one week, one session, one logged set, one Coach analysis, one Coach note; zero is plural: "0 weeks"). A
// Coach part is drawn only when its count is above 0. The two Coach parts are written exactly as SPEC's template joins them: the analyses after a
// comma and "plus", the notes after "and", straight onto whatever came before, so notes alone read "… and 31 logged sets and 2 Coach notes."

export const FULL_DELETE_COUNTING = 'Counting what goes…'
export const FULL_DELETE_OFFLINE = "You're offline. Deleting needs a connection."
// Ours (no board draws a failed count): the count could not be read, so there is nothing to name and DELETE stays off. The reason follows it.
export const FULL_DELETE_COUNT_FAILED = "Couldn't count what goes."

export function fullDeleteTitle(name: string): string {
  return `Delete ${name}?`
}

/** "1 week", "2 weeks", "0 weeks". */
function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

export function fullDeleteText(counts: FinishedRunCounts): string {
  const analyses = counts.coachAnalyses > 0 ? `, plus ${counted(counts.coachAnalyses, 'Coach analysis', 'Coach analyses')}` : ''
  const notes = counts.coachNotes > 0 ? ` and ${counted(counts.coachNotes, 'Coach note', 'Coach notes')}` : ''
  return (
    `Deletes its ${counted(counts.weeks, 'week', 'weeks')}: ${counted(counts.sessions, 'session', 'sessions')} and ${counted(counts.loggedSets, 'logged set', 'logged sets')}` +
    `${analyses}${notes}. Its results leave History, Progress and every stat. This can't be undone.`
  )
}

/** What the confirmation's body says, and whether DELETE may be pressed, for what the phone knows now. */
export type FullDeleteState =
  | { kind: 'offline' }
  | { kind: 'counting' }
  | { kind: 'failed' }
  | { kind: 'counted'; counts: FinishedRunCounts }

export function fullDeleteBody(state: FullDeleteState): { text: string; canDelete: boolean } {
  switch (state.kind) {
    case 'offline':
      return { text: FULL_DELETE_OFFLINE, canDelete: false }
    case 'counting':
      return { text: FULL_DELETE_COUNTING, canDelete: false }
    case 'failed':
      return { text: FULL_DELETE_COUNT_FAILED, canDelete: false }
    case 'counted':
      return { text: fullDeleteText(state.counts), canDelete: true }
  }
}
