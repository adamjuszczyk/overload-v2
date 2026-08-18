// Client-side gate — cosmetic only (COACH-ANALYSIS-TASKS.md §1.4). Decides
// whether the COACH nav tab and the real two-tab shell render for the
// current user. Not the authoritative gate: the server-side COACH_USER_ID
// check (step E) is the one actually guarding API spend. This one must be
// kept in sync with that server value — see CONTEXT.md.
export function isCoachUser(userId: string | null | undefined): boolean {
  const gatedUserId = import.meta.env.VITE_COACH_USER_ID as string | undefined
  return Boolean(gatedUserId) && userId === gatedUserId
}
