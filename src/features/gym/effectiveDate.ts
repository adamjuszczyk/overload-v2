// Chunk 24 (SPEC "Weekday" — "Move this session"; History shows "the day a
// session was actually done") — the one-line substitution every consumer of
// a moved session applies: a session's EFFECTIVE date is moved_to_date when
// set, else its own `date`. Used by scheduler.ts (due-today / missed-day
// membership) and historyService.ts (the three display reads).
//
// This is a second, independent implementation of the exact same rule
// referenceByExercise.ts's own (private, unexported) withEffectiveDate
// already applies for "last time" matching (chunk 23) — that file is not
// touched here (out of this chunk's scope; its own exports are frozen-
// adjacent and this chunk doesn't need anything else from it), so this is a
// small, well-understood duplication rather than a shared import, same
// precedent that file's own header documents for its byMostRecent helper.
export function effectiveDate(session: { date: string; movedToDate?: string | null }): string {
  return session.movedToDate ?? session.date
}
