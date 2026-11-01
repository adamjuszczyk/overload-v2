import { useSyncExternalStore } from 'react'
import { hashKey, onlineManager, type Query } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { APP_STATUS_KEY } from '../../lib/maintenanceRefusal'
import { APP_VERSION, compareVersions } from '../../lib/version'
import type { AppStatus } from './appStatusService'

// Chunk 73 (SPEC.md 1.2.1, Screens → Update to continue [11] and Rule 5; RULES.md, Standing rules: "Queued writes across a version change").
// "The offline queue ... is sent by the new version, never by the old one": the old version never sends once the version check has refused it, and
// never before that check has answered. This file is the one place that decides it, from the query cache the status lives in, so a caller that asks
// at the moment it is about to send (`flushSyncQueue`) sees what the cache holds then, not a copy that a render last wrote (the pre-read's 73-1).
//
//   'unknown'  the status has not been read, or the answer in the cache is older than the phone's last return online (below);
//   'blocked'  the answer says this version is older than `min_version`;
//   'ok'       the answer says it is not.
//
// The answer a phone holds after an offline stretch is stale: a release may have raised `min_version` while it was away, and TanStack keeps the old
// data until a new read lands (the pre-read's 73-2). So the gate is 'unknown' from the moment the phone is back online until a read made after that
// moment answers. "After" is counted in reads, not time: the status query's `dataUpdateCount` when the phone came back is remembered, and only a
// count above it is an answer (a timestamp would call an answer set in the same millisecond fresh).

/** What the version check lets the app do with the queue. */
export type VersionGate = 'unknown' | 'ok' | 'blocked'

/** Whether the running version is older than the status's `min_version`. No status is no answer: false. */
export function updateRequired(status: AppStatus | undefined, appVersion: string = APP_VERSION): boolean {
  return status !== undefined && compareVersions(appVersion, status.minVersion) < 0
}

type StatusQuery = Query<AppStatus>

function statusQuery(): StatusQuery | undefined {
  return queryClient.getQueryCache().find<AppStatus>({ queryKey: APP_STATUS_KEY, exact: true })
}

// The status query as it stood when the phone last came back online. The query is kept with the count: a cache that is cleared (sign-out) or a query
// that is built again has a count of its own, and a mark made against the old one means nothing to it.
let reconnect: { query: StatusQuery | undefined; reads: number } | null = null

/** The gate right now, from the cache. Cheap, and the same value for the same cache, so React can subscribe to it. */
export function readVersionGate(): VersionGate {
  const query = statusQuery()
  const status = query?.state.data
  if (!query || status === undefined) return 'unknown'
  if (reconnect !== null && reconnect.query === query && query.state.dataUpdateCount <= reconnect.reads) return 'unknown'
  return updateRequired(status) ? 'blocked' : 'ok'
}

const listeners = new Set<() => void>()
function notify() {
  for (const listener of listeners) listener()
}

onlineManager.subscribe((online) => {
  if (!online) return
  const query = statusQuery()
  reconnect = { query, reads: query?.state.dataUpdateCount ?? 0 }
  notify()
})

const STATUS_HASH = hashKey(APP_STATUS_KEY)
let stopWatchingCache: (() => void) | undefined

/** Calls `listener` whenever the gate might have changed: an event on the status query, or the phone coming back online. */
export function subscribeVersionGate(listener: () => void): () => void {
  listeners.add(listener)
  if (listeners.size === 1) {
    stopWatchingCache = queryClient.getQueryCache().subscribe((event) => {
      if (hashKey(event.query.queryKey) === STATUS_HASH) notify()
    })
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopWatchingCache?.()
      stopWatchingCache = undefined
    }
  }
}

/** The gate as a React value: the sync queue's runner flushes when it turns from 'unknown' or 'blocked' to 'ok'. */
export function useVersionGate(): VersionGate {
  return useSyncExternalStore(subscribeVersionGate, readVersionGate, () => 'unknown' as const)
}

/** For tests: forget the phone's last return online, as a new run of the app does. */
export function resetVersionGate(): void {
  reconnect = null
}
