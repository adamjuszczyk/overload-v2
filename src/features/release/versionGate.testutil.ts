import { queryClient } from '../../lib/queryClient'
import { APP_STATUS_KEY } from '../../lib/maintenanceRefusal'
import type { AppStatus } from './appStatusService'
import { resetVersionGate } from './versionGate'

// Chunk 73 (SPEC.md 1.2.1, Rule 5). `flushSyncQueue` sends nothing until the version check has answered that this version may run (versionGate.ts), so a
// test that sends the queue first gives the check its answer: the status the app reads from `v2_app_status`, in the query cache the check reads. Tests
// stub the running version as 1.2.1 (`__APP_VERSION__`, the define vitest does not run).

/** What the status row says once 1.2.1 is the oldest version allowed: this version may run. */
export const STATUS_ALLOWS_1_2_1: AppStatus = { maintenance: false, minVersion: '1.2.1', exemptUserIds: [], updatedAt: '2026-10-30T18:00:00Z' }
/** A release has raised `min_version` past this version: it may not send the queue. */
export const STATUS_REQUIRES_1_2_2: AppStatus = { ...STATUS_ALLOWS_1_2_1, minVersion: '1.2.2' }

/** The version check has read `status` (this version may run, by default): the answer is in the cache, as a read leaves it. */
export function versionCheckAnswers(status: AppStatus = STATUS_ALLOWS_1_2_1): void {
  resetVersionGate()
  queryClient.setQueryData(APP_STATUS_KEY, status)
}

/** The version check has not answered: no status has been read in this run. */
export function versionCheckUnread(): void {
  resetVersionGate()
  queryClient.removeQueries({ queryKey: APP_STATUS_KEY })
}
