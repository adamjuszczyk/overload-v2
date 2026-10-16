import { useEffect, useRef } from 'react'
import { db } from '../../lib/db'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useOfflineStore, type SyncFailure } from './offlineStore'
import type { SyncQueueItem } from '../../lib/db'
import { deriveCompletedAt, shouldClassifyAsSkipped } from '../gym/sessionCompletion'

export function useSyncQueueInit() {
  const addPending = useOfflineStore((s) => s.addPending)

  useEffect(() => {
    db.sync_queue.orderBy('createdAt').toArray().then((items) => {
      for (const item of items) {
        const payload = item.payload as { id?: string }
        if (payload?.id) addPending(payload.id)
      }
      // Writes that stopped retrying in an earlier visit are shown again.
      useOfflineStore.getState().setSyncFailures(failuresOf(items))
    })
  }, []) // run once on mount
}

// Failed passes before a write stops retrying on its own. One attempt is one
// flush pass (reconnect, app start, a finish, a retry tap), so five means five
// separate chances on a gym connection, not five tries in a row.
export const MAX_SYNC_ATTEMPTS = 5

export function useSyncQueueRunner() {
  const isOnline = useOnlineStatus()
  // null, not isOnline — "not yet observed", distinct from a real online/
  // offline reading. Found by adversarial review: seeding this from
  // isOnline itself meant a cold start that begins already online (the PWA
  // was closed while offline at the gym, then reopened later at home
  // already on WiFi) never registers as a false->true transition, since
  // both isOnline and prevOnline.current are true on that very first
  // render — flushSyncQueue never ran, silently stranding anything queued
  // offline (e.g. this session's own completed_at fix for an
  // offline-completed session) in db.sync_queue indefinitely. Seeding to
  // null makes the first render flush whenever the app happens to already
  // be online at mount, in addition to the genuine offline->online
  // transition case this already handled.
  const prevOnline = useRef<boolean | null>(null)

  useEffect(() => {
    if (isOnline && !prevOnline.current) {
      flushSyncQueue().catch((err) => console.error('[sync] flush failed', err))
    }
    prevOnline.current = isOnline
  }, [isOnline])
}

// B3: a finish queued offline guessed its status and completed_at from the
// logs this device could see. Every set queued before it has been sent by the
// time it is replayed (FIFO), so the server's logs are the full list: derive
// both again from them, the same way the online finish does. A failed read
// throws, which counts as a failed attempt like any other, never a guess.
async function withFinishDerivedFromServer(payload: Record<string, unknown>) {
  const { data, error } = await supabase
    .from('v2_set_logs')
    .select('logged_at, is_skipped')
    .eq('session_id', payload.id as string)
  if (error) throw error
  const logs = (data ?? []) as Array<{ logged_at: string; is_skipped: boolean }>
  return {
    ...payload,
    status: shouldClassifyAsSkipped(logs.map((l) => ({ isSkipped: l.is_skipped }))) ? 'skipped' : 'completed',
    completed_at: deriveCompletedAt(logs.map((l) => ({ loggedAt: l.logged_at }))),
  }
}

// ─── Ordering ────────────────────────────────────────────────────────────────
// Writes to the same record keep their order: a write that fails holds back
// every later write to that record until it succeeds, so an older write can
// never land on top of a newer one. A write is also held while a record it
// depends on is held (a set log behind its session row, a stage behind its
// head set), since sending it would only fail on the foreign key. A delete is
// held behind the earlier writes to its own record and to the records that
// hang under it (a head's delete behind its stages': the client's cascade
// deletes the stages first, and a stage still waiting to be created must
// exist before its head goes). Writes to any other record still go.
function payloadOf(item: SyncQueueItem) {
  return (item.payload ?? {}) as { id?: string; session_id?: string | null; parent_set_id?: string | null }
}

function recordKey(item: SyncQueueItem): string | null {
  const id = payloadOf(item).id
  return id ? `${item.table}:${id}` : null
}

// The head a stage log hangs under, for an item that writes one. An upsert
// says so in its payload; a delete's payload is only { id }, so it says so
// beside it (`queueSetLogDelete`).
function headIdOf(item: SyncQueueItem): string | null {
  if (item.table !== 'v2_set_logs') return null
  return (item.operation === 'delete' ? item.parentSetId : payloadOf(item).parent_set_id) ?? null
}

// A head's record key -> the record keys of its stage logs with a write in the queue.
function stageKeysByHead(items: SyncQueueItem[]): Map<string, string[]> {
  const stages = new Map<string, string[]>()
  for (const item of items) {
    const head = headIdOf(item)
    const own = recordKey(item)
    if (!head || !own) continue
    const list = stages.get(`v2_set_logs:${head}`)
    if (list) list.push(own)
    else stages.set(`v2_set_logs:${head}`, [own])
  }
  return stages
}

function dependencyKeys(item: SyncQueueItem, stages: Map<string, string[]>): string[] {
  const p = payloadOf(item)
  const keys: string[] = []
  const own = recordKey(item)
  if (own) keys.push(own)
  if (item.operation === 'delete') {
    if (own) keys.push(...(stages.get(own) ?? []))
    return keys
  }
  if (p.session_id) keys.push(`v2_sessions:${p.session_id}`)
  if (item.table === 'v2_set_logs' && p.parent_set_id) keys.push(`v2_set_logs:${p.parent_set_id}`)
  return keys
}

function sessionIdOf(item: SyncQueueItem): string | null {
  const p = payloadOf(item)
  if (item.table === 'v2_sessions') return p.id ?? null
  return p.session_id ?? item.sessionId ?? null
}

// The writes that can't sync right now without the user: each one that gave
// up, and every write held behind one. `items` in queue (createdAt) order.
function failuresOf(items: SyncQueueItem[]): SyncFailure[] {
  const held = new Set<string>()
  const stages = stageKeysByHead(items)
  const failures: SyncFailure[] = []
  for (const item of items) {
    if (!item.gaveUp && !dependencyKeys(item, stages).some((k) => held.has(k))) continue
    const own = recordKey(item)
    if (own) held.add(own)
    failures.push({ queueId: item.id!, table: item.table, recordId: payloadOf(item).id ?? null, sessionId: sessionIdOf(item) })
  }
  return failures
}

// A write no send of which has started (`sendStarted`) or failed (`attempts`):
// the server has never seen it. Only an upsert can be one.
function neverSent(item: SyncQueueItem): boolean {
  return item.operation === 'upsert' && !item.sendStarted && !item.attempts
}

// G47: a set logged and then deleted before the phone ever reached the server.
// The server has never seen the row, so neither the upsert nor the delete is
// sent: both leave the queue here, before the pass sends anything (passes run
// one at a time, so no upsert of the pair is in flight). Only the writes
// before a record's first delete count, and only when every one of them is a
// never-sent upsert; a write that may already be on the server keeps its
// delete, which is sent after it. Returns the items left to send.
async function dropNeverSentPairs(items: SyncQueueItem[]): Promise<SyncQueueItem[]> {
  const byRecord = new Map<string, SyncQueueItem[]>()
  for (const item of items) {
    const key = recordKey(item)
    if (!key) continue
    const list = byRecord.get(key)
    if (list) list.push(item)
    else byRecord.set(key, [item])
  }
  const cancelled = new Set<number>()
  for (const list of byRecord.values()) {
    const at = list.findIndex((item) => item.operation === 'delete')
    if (at < 1) continue
    const before = list.slice(0, at)
    if (!before.every(neverSent)) continue
    for (const item of [...before, list[at]]) cancelled.add(item.id!)
  }
  if (cancelled.size === 0) return items
  const { removePending } = useOfflineStore.getState()
  // In queue order, so the delete goes last: if a removal fails midway, what
  // is left is a delete of a row that was never created, which is harmless,
  // and never an upsert whose delete is gone.
  for (const item of items) {
    if (!cancelled.has(item.id!)) continue
    await db.sync_queue.delete(item.id!)
    const id = payloadOf(item).id
    if (id) removePending(id)
  }
  return items.filter((item) => !cancelled.has(item.id!))
}

async function flushOnce() {
  const { removePending } = useOfflineStore.getState()
  const items = await dropNeverSentPairs(await db.sync_queue.orderBy('createdAt').toArray())
  const stages = stageKeysByHead(items)
  // Record keys with an earlier write still unsent in this pass.
  const held = new Set<string>()
  for (const item of items) {
    const payload = item.payload as { id?: string }
    const own = recordKey(item)
    if (item.gaveUp || dependencyKeys(item, stages).some((k) => held.has(k))) {
      if (own) held.add(own)
      continue
    }
    try {
      if (item.operation === 'upsert') {
        const row = item.recomputeFinish
          ? await withFinishDerivedFromServer(item.payload as Record<string, unknown>)
          : (item.payload as Record<string, unknown>)
        // From here the server may hold the row, whatever happens to the reply.
        if (!item.sendStarted) await db.sync_queue.update(item.id!, { sendStarted: true })
        const { error } = await supabase.from(item.table).upsert(row)
        if (error) throw error
      } else {
        // The whole request is `delete().eq('id', id)`: a delete naming no row
        // is never sent, so nothing here can delete more than one.
        if (!payload?.id) throw new Error('queued delete names no row')
        const { error } = await supabase.from(item.table).delete().eq('id', payload.id)
        if (error) throw error
      }
      await db.sync_queue.delete(item.id!)
      if (payload?.id) removePending(payload.id)
    } catch (err) {
      if (own) held.add(own)
      const attempts = (item.attempts ?? 0) + 1
      // Never dropped: after MAX_SYNC_ATTEMPTS it stops retrying on its own
      // and stays queued (still holding back later writes to its record)
      // until the user taps retry on the screen it belongs to.
      const gaveUp = attempts >= MAX_SYNC_ATTEMPTS
      await db.sync_queue.update(item.id!, { attempts, gaveUp })
      console.error(gaveUp ? '[sync] stopped retrying item' : '[sync] attempt failed for item', attempts, item.id, err)
    }
  }

  useOfflineStore.getState().setSyncFailures(failuresOf(await db.sync_queue.orderBy('createdAt').toArray()))

  // Refresh session data so UI reflects the synced logs
  queryClient.invalidateQueries({ queryKey: ['v2_session'] })
}

// The notice's "Tap to retry": every write that stopped retrying gets a fresh
// set of attempts, and the queue is sent again, in order. It was sent
// MAX_SYNC_ATTEMPTS times, so it stays "sent" (`sendStarted`) when `attempts`
// starts again from zero: a delete queued behind it must not cancel against it.
export async function retrySyncFailures(): Promise<void> {
  const items = await db.sync_queue.toArray()
  for (const item of items) {
    if (item.gaveUp) await db.sync_queue.update(item.id!, { attempts: 0, gaveUp: false, sendStarted: true })
  }
  await flushSyncQueue()
}

// B3: only one flush runs at a time. A flush reads the queue, then deletes
// each item after its upsert; a second flush started in that window read the
// same items and replayed them, so an old write (a session's in_progress
// upsert) could land after the newer one (its completion). A call made while
// one runs does not start a second: it asks for one more pass after the
// current one (items queued meanwhile) and shares the running promise, so
// awaiting it still means "the queue as it was when I called is sent".
let inFlight: Promise<void> | null = null
let passRequested = false

export function flushSyncQueue(): Promise<void> {
  if (inFlight) {
    passRequested = true
    return inFlight
  }
  inFlight = (async () => {
    try {
      do {
        passRequested = false
        await flushOnce()
      } while (passRequested)
    } finally {
      inFlight = null
    }
  })()
  return inFlight
}

// B3: true while the queue still holds a write for this session (one of its
// set logs, or the session row itself). A finish uses it after flushing: any
// left means the server doesn't have the session's full logs yet. A queued
// delete counts too (G47): the server still has the log it will remove, so a
// finish derived from the server's logs now would count a set that is gone. A
// delete's payload is only { id }, so it names its session beside it.
export async function hasQueuedWritesFor(sessionId: string): Promise<boolean> {
  const items = await db.sync_queue.toArray()
  return items.some((item) => {
    const payload = item.payload as { id?: string; session_id?: string } | null
    return (
      payload?.session_id === sessionId ||
      (item.table === 'v2_sessions' && payload?.id === sessionId) ||
      (item.operation === 'delete' && item.sessionId === sessionId)
    )
  })
}

// G47: delete set (chunk 61) and unlog (chunk 63) work offline by queueing one
// of these per log: the stage logs first, the head last, each stage naming its
// head (`parentSetId`), because the queue replays in the order of the calls and
// a head's delete waits for its stages'. The request later sent is only
// `delete().eq('id', id)`. The device's own copy of the log goes at once, so
// nothing offline (a finish queued meanwhile, the "last time" cache) still
// sees it; the queue comes first, so a failure in between leaves a stale copy,
// never a delete that was lost. The caller removes the log from the screen's
// cache; a log that was never sent leaves the queue with its upsert on the
// next pass (`dropNeverSentPairs`). Nothing calls this before chunks 61 and 63.
export async function queueSetLogDelete(log: { id: string; sessionId: string; parentSetId?: string | null }): Promise<void> {
  await db.sync_queue.add({
    table: 'v2_set_logs',
    operation: 'delete',
    payload: { id: log.id },
    createdAt: new Date().toISOString(),
    sessionId: log.sessionId,
    ...(log.parentSetId ? { parentSetId: log.parentSetId } : {}),
  })
  await db.set_logs.delete(log.id)
}
