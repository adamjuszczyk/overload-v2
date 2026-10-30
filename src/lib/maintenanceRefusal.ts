// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]; TASKS.md "Error codes"; DECISIONS 271). What the app needs to know about the database's
// maintenance refusal, in a module that imports nothing: `queryClient.ts` (this folder) and the sync queue both name the status query's key and read
// the refusal, and neither may load the Supabase client (or anything that does) through this file, nor may `lib` import from a feature.
//
// Migration 048's one check (`v2_assert_not_in_maintenance`) raises `OL001` (hint `maintenance`) for a signed-in caller who is not exempt while
// `v2_app_status.maintenance` is on. The app reads it from `error.code`, as queue-fix 230 reads `23503`, never from the message.

/** The error code the database refuses a write with during maintenance (migration 048). */
export const MAINTENANCE_CODE = 'OL001'

/** The query key of the app's one read of `v2_app_status`. Reading it again at once is how a refusal brings the screen up (below). */
export const APP_STATUS_KEY = ['v2_appStatus'] as const

/** Whether an error (a Supabase `PostgrestError`, or what a service threw from one) is the maintenance refusal. */
export function isMaintenanceRefusal(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === MAINTENANCE_CODE
}
