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
// exist before its head goes). A patch that clears a head's stage kind (chunk
// 61's review 1, F1) is held the same way: behind the writes to its own log and
// to its drops'. A change row that names a log (a `pending_stages` row's
// `set_log_id`: 042's foreign key, ON DELETE CASCADE; DECISIONS 227) hangs under
// that log as a stage hangs under its head: the row is held behind the writes to
// its log, and the log's delete behind the writes to its rows, so a delete is
// never sent ahead of a row still to be created (the row would then be refused
// for ever, `23503`, naming a log that is gone). Writes to any other record still go.
//
// A record the user deletes online while a write that names it waits here (DECISIONS 230) is dealt with in three places, each by what the server's own foreign key does to
// a row that got there first: a log's own queued writes leave with an online delete of the log (they would bring it back), a session's leave with History's delete of the
// session (`ON DELETE CASCADE` took theirs; a coach note, `ON DELETE SET NULL`, goes on with no session), and a log refused because the planned set it names was removed on
// Plan is sent again with no planned set (`SET NULL`), its change row dropped (`CASCADE`). Only a write that names the deleted record is touched, and nothing is held back.
const SESSION_SET_CHANGES_TABLE = 'v2_session_set_changes'

function payloadOf(item: SyncQueueItem) {
  return (item.payload ?? {}) as { id?: string; session_id?: string | null; parent_set_id?: string | null; set_log_id?: string | null; exercise_id?: string | null }
}

function recordKey(item: SyncQueueItem): string | null {
  const id = payloadOf(item).id
  return id ? `${item.table}:${id}` : null
}

// The head a stage log hangs under, for an item that writes one. An upsert
// says so in its payload; a delete's payload is only { id } and a patch's only
// { id } and one column, so they say so beside it (`queueSetLogDelete`, `queueSetLogPatch`).
function headIdOf(item: SyncQueueItem): string | null {
  if (item.table !== 'v2_set_logs') return null
  return (item.operation === 'delete' || item.operation === 'patch' ? item.parentSetId : payloadOf(item).parent_set_id) ?? null
}

// The log a queued upsert of a change row names (a `pending_stages` row's `set_log_id`; DECISIONS 227), else null: any other write, and a row that names a
// planned set instead (`deleted`, `retyped`).
function namedLogIdOf(item: SyncQueueItem): string | null {
  if (item.table !== SESSION_SET_CHANGES_TABLE || item.operation !== 'upsert') return null
  return payloadOf(item).set_log_id ?? null
}

// What hangs under a log, by the log's record key, as the record keys of the queued writes: its stage logs, and the change rows that name it.
interface Hanging {
  stages: Map<string, string[]>
  rows: Map<string, string[]>
}

function hangingUnderLogs(items: SyncQueueItem[]): Hanging {
  const hanging: Hanging = { stages: new Map(), rows: new Map() }
  const add = (under: Map<string, string[]>, log: string | null, own: string | null) => {
    if (!log || !own) return
    const list = under.get(`v2_set_logs:${log}`)
    if (list) list.push(own)
    else under.set(`v2_set_logs:${log}`, [own])
  }
  for (const item of items) {
    const own = recordKey(item)
    add(hanging.stages, headIdOf(item), own)
    add(hanging.rows, namedLogIdOf(item), own)
  }
  return hanging
}

function dependencyKeys(item: SyncQueueItem, hanging: Hanging): string[] {
  const p = payloadOf(item)
  const keys: string[] = []
  const own = recordKey(item)
  if (own) keys.push(own)
  if (item.operation === 'delete') {
    // A log's delete waits for its stages' writes and for its change rows' (227): the rows are created while the log is still there.
    if (own) keys.push(...(hanging.stages.get(own) ?? []), ...(hanging.rows.get(own) ?? []))
    return keys
  }
  // A head losing its stage kind (its last drop was deleted, 147 (a)) waits for its drops' writes as its delete would: sent ahead of a
  // drop's delete that failed in the pass, it would leave the server a normal head with a drop log under it until the retry.
  if (item.operation === 'patch' && own && 'stage_kind' in p) keys.push(...(hanging.stages.get(own) ?? []))
  if (p.session_id) keys.push(`v2_sessions:${p.session_id}`)
  if (item.table === 'v2_set_logs' && p.parent_set_id) keys.push(`v2_set_logs:${p.parent_set_id}`)
  // A change row waits for the writes to the log it names (227): sent while the log is still to be created, it is refused `23503`.
  const named = namedLogIdOf(item)
  if (named) keys.push(`v2_set_logs:${named}`)
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
  const hanging = hangingUnderLogs(items)
  const failures: SyncFailure[] = []
  for (const item of items) {
    if (!item.gaveUp && !dependencyKeys(item, hanging).some((k) => held.has(k))) continue
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
// delete, which is sent after it. The change rows that name such a log leave with
// the pair (DECISIONS 227): the server cannot hold a row that names a log it never
// held, and the row would be refused `23503` for ever. Returns the items left to send.
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
  // The logs whose pair is cancelled: the server will never hold them.
  const gone = new Set<string>()
  for (const list of byRecord.values()) {
    const at = list.findIndex((item) => item.operation === 'delete')
    if (at < 1) continue
    const before = list.slice(0, at)
    if (!before.every(neverSent)) continue
    for (const item of [...before, list[at]]) cancelled.add(item.id!)
    const deleted = payloadOf(list[at]).id
    if (list[at].table === 'v2_set_logs' && deleted) gone.add(deleted)
  }
  if (cancelled.size === 0) return items
  // The rows that name one of those logs, whatever their own markers say (a row can't have reached a server that never held its log) and wherever they sit in
  // the queue (a log's id is used once, so a row after the delete names the same log): only those.
  const rows = items.filter((item) => {
    const named = namedLogIdOf(item)
    return named !== null && gone.has(named)
  })
  const { removePending } = useOfflineStore.getState()
  // The rows first, then the pair in queue order, so the delete goes last: if a removal fails midway, what is left is a delete of a row that was never
  // created, which is harmless, or the pair again (cancelled by the next pass, with any row left); never an upsert whose delete is gone, and never a
  // row whose log's upsert is gone (the next pass could not tell that it names a log that will never be sent).
  for (const item of [...rows, ...items.filter((item) => cancelled.has(item.id!))]) {
    await db.sync_queue.delete(item.id!)
    const id = payloadOf(item).id
    if (id) removePending(id)
  }
  const leaving = new Set([...cancelled, ...rows.map((item) => item.id!)])
  return items.filter((item) => !leaving.has(item.id!))
}

// A queued patch is one of two shapes and nothing else is ever sent for it: `{ id, set_number }` (chunk 58a, DECISIONS 197) or
// `{ id, stage_kind: null }` (chunk 61's review 1, F1: a head whose last drop was deleted is a normal set; only `null`, only that column).
// Anything else is refused here, at the point of sending: the queue never writes a whole row of a log through a patch.
function patchOf(payload: unknown): { id: string; changes: { set_number: number } | { stage_kind: null } } {
  const p = payload as { id?: unknown; set_number?: unknown; stage_kind?: unknown } | null
  const keys = p ? Object.keys(p).sort().join(',') : ''
  if (p && typeof p.id === 'string') {
    if (keys === 'id,set_number' && typeof p.set_number === 'number') return { id: p.id, changes: { set_number: p.set_number } }
    if (keys === 'id,stage_kind' && p.stage_kind === null) return { id: p.id, changes: { stage_kind: null } }
  }
  throw new Error('a queued patch is { id, set_number } or { id, stage_kind: null } and nothing else')
}

// DECISIONS 230. The queue items an online delete's cleanup removed (`dropQueuedWritesNamingLog`, `dropQueuedWritesNamingSession`) while a pass was running: the pass
// read its list before the delete, so it still holds them, and sending one after the delete would bring the deleted record back. The pass skips them; the set is emptied
// when a pass starts (a queue item's id is never used twice, so one removed before that pass began can't be in the list it reads).
const removedByCleanup = new Set<number>()

// DECISIONS 230 (iii). A write refused `23503` because the planned set it names was removed on Plan while it waited: `v2_set_logs.week_plan_set_id` (001, ON DELETE SET NULL)
// and `v2_session_set_changes.week_plan_set_id` (042, ON DELETE CASCADE), both to `v2_week_plan_sets`. The constraint's name says which key refused, in the message PostgREST
// answers (`… violates foreign key constraint "v2_set_logs_week_plan_set_id_fkey"`) and the key in its details (`Key (week_plan_set_id)=(…) is not present`); any other refusal,
// and any other key, is a failed attempt as before.
const PLANNED_SET_KEY: Record<string, string> = { v2_set_logs: 'v2_set_logs_week_plan_set_id_fkey', [SESSION_SET_CHANGES_TABLE]: 'v2_session_set_changes_week_plan_set_id_fkey' }

function refusedOnPlannedSet(item: SyncQueueItem, err: unknown): boolean {
  const e = err as { code?: unknown; message?: unknown; details?: unknown } | null
  const constraint = PLANNED_SET_KEY[item.table]
  if (!e || e.code !== '23503' || constraint === undefined) return false
  return (typeof e.message === 'string' && e.message.includes(`"${constraint}"`)) || (typeof e.details === 'string' && e.details.startsWith('Key (week_plan_set_id)='))
}

// What the server would have ended with had the row got there before the planned set went: a log stays with no planned set, so the queued log is sent that way (now, in this
// pass, and kept that way in the queue if the request fails again); a change row goes with its planned set, so the queued row leaves the queue. Returns whether the item is
// settled; a request that fails again is thrown, to be counted as a failed attempt like any other.
async function recoverFromRemovedPlannedSet(item: SyncQueueItem, err: unknown): Promise<boolean> {
  if (item.operation !== 'upsert' || !refusedOnPlannedSet(item, err)) return false
  const { removePending } = useOfflineStore.getState()
  const id = payloadOf(item).id
  if (item.table === 'v2_set_logs') {
    const row = { ...(item.payload as Record<string, unknown>), week_plan_set_id: null }
    await db.sync_queue.update(item.id!, { payload: row })
    const { error } = await supabase.from(item.table).upsert(row)
    if (error) throw error
  }
  await db.sync_queue.delete(item.id!)
  if (id) removePending(id)
  return true
}

async function flushOnce() {
  const { removePending } = useOfflineStore.getState()
  removedByCleanup.clear() // what an earlier cleanup removed is not in the queue this pass reads; only a cleanup during this pass matters
  const items = await dropNeverSentPairs(await db.sync_queue.orderBy('createdAt').toArray())
  const hanging = hangingUnderLogs(items)
  // Record keys with an earlier write still unsent in this pass.
  const held = new Set<string>()
  for (const item of items) {
    const payload = item.payload as { id?: string }
    const own = recordKey(item)
    if (removedByCleanup.has(item.id!)) continue
    if (item.gaveUp || dependencyKeys(item, hanging).some((k) => held.has(k))) {
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
      } else if (item.operation === 'patch') {
        // Chunk 58a (DECISIONS 197): the whole request is `update({ set_number }).eq('id', id)`, or (chunk 61's review 1) `update({ stage_kind:
        // null }).eq('id', id)`. An update of a log another phone has deleted matches no row, so it can never bring the log back, and it
        // names no column but the one, so it can't write this phone's copy of the weight or reps over another phone's edit.
        const patch = patchOf(item.payload)
        const { error } = await supabase.from(item.table).update(patch.changes).eq('id', patch.id)
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
      let failure = err
      try {
        if (await recoverFromRemovedPlannedSet(item, err)) continue
      } catch (again) {
        failure = again
      }
      if (own) held.add(own)
      const attempts = (item.attempts ?? 0) + 1
      // Never dropped: after MAX_SYNC_ATTEMPTS it stops retrying on its own
      // and stays queued (still holding back later writes to its record)
      // until the user taps retry on the screen it belongs to.
      const gaveUp = attempts >= MAX_SYNC_ATTEMPTS
      await db.sync_queue.update(item.id!, { attempts, gaveUp })
      console.error(gaveUp ? '[sync] stopped retrying item' : '[sync] attempt failed for item', attempts, item.id, failure)
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
      ((item.operation === 'delete' || item.operation === 'patch') && item.sessionId === sessionId)
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
// next pass (`dropNeverSentPairs`). Chunk 61's DELETE calls this offline (through `useDeleteSetLog`, the drops first and the head last);
// chunk 63's unlog will.
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

// Chunk 58a (DECISIONS 178, 185 (c), 197): the workout screen's number corrections, and chunk 61's delete renumber and 62's
// Warmup switch renumber, go out as one of these per log: `update({ set_number }).eq('id', id)`, sent after every earlier write
// to the same log (its own record key), so a patch queued behind an upsert that fails in a pass waits for it. A log that has
// since been deleted on another phone matches no row. A stage log names its head (`parentSetId`), as on a delete, so the head's
// delete waits for it. The device's own copy of the log changes at once (the queue first, so a failure in between leaves a
// stale copy, never a patch that was lost); the caller changes the number on the screen's cache.
//
// Queued once (58a's review 1, finding 1): a log whose last queued write is already this patch gets no second one. A pass that
// fails while the phone reads as online ends with the session read again, with the number the server still holds, and the
// workout screen lists the same correction again; each of those draws used to queue it again (681 items for one log in about 70 s
// on staging). Only the log's LAST queued write counts: a patch to another number queued after it, or a whole-row save after it,
// means this one is not what the server will end with. Returns whether an item was added.
export async function queueSetLogPatch(
  log: { id: string; sessionId: string; parentSetId?: string | null },
  setNumber: number,
): Promise<boolean> {
  if (await lastQueuedWriteIsPatch(log.id, setNumber)) return false
  await db.sync_queue.add({
    table: 'v2_set_logs',
    operation: 'patch',
    payload: { id: log.id, set_number: setNumber },
    createdAt: new Date().toISOString(),
    sessionId: log.sessionId,
    ...(log.parentSetId ? { parentSetId: log.parentSetId } : {}),
  })
  await db.set_logs.update(log.id, { setNumber })
  return true
}

// Chunk 61's review 1 (F1; G47: delete set "work[s] offline and sync[s] later through the sync queue"; DECISIONS 146 (a), 147 (a), 197): the last
// drop of a logged head is deleted and the head is a normal set from then on, so its log loses its stage kind. That is a change to one column
// of a log, so it is a `patch` item (`{ id, stage_kind: null }`, sent as `update({ stage_kind: null }).eq('id', id)`), never a whole-row save,
// which could bring back a log another phone deleted and write this phone's weight and reps over another's edit. It is queued after the drop's
// `delete` item and waits behind its drops' writes (`dependencyKeys`). The device's own copy of the log changes at once (the queue first, as
// above); the caller changes the screen's cache.
export async function queueSetLogStageKindClear(log: { id: string; sessionId: string }): Promise<void> {
  await db.sync_queue.add({
    table: 'v2_set_logs',
    operation: 'patch',
    payload: { id: log.id, stage_kind: null },
    createdAt: new Date().toISOString(),
    sessionId: log.sessionId,
  })
  await db.set_logs.update(log.id, { stageKind: null })
}

// DECISIONS 227 (iii). An online delete of a log (`useDeleteSetLog`'s direct request) has gone through. The server's foreign keys took everything that named the
// log with it (042: a change row's `set_log_id`, ON DELETE CASCADE; 010: a stage log's `parent_set_id`, ON DELETE CASCADE), and a queued upsert of one of those would
// be refused `23503` for ever: they leave the queue, and only they, the upserts of change rows whose `set_log_id` is this log's and the upserts of stage logs whose
// `parent_set_id` is this log's (1.1 has the defect in this second shape: a stage logged offline under a head that is then deleted online). Every other queued write
// stays, however it is related (another log's rows or stages, the session's other rows, a stage's queued delete or patch, which match no row and
// are never refused, a finish). Called after the request has been answered, never before: a delete that fails leaves the writes, and the log, in place. A write that had
// given up was on the "couldn't sync" notice, which is made again from what is left. Returns how many writes left.
//
// DECISIONS 230 (i): the log's OWN queued upserts and patches leave too. The request deleted the log on the server (a delete that names no row still answers ok), and a queued
// upsert of it, kept for a send that had failed, would create it again at the next pass: a set the user deleted (or unlogged, chunk 63) comes back. Its own queued delete stays
// (it matches no row and is never refused), and so does every write to any other log, stage or session, in the same queue. They go log first, then what hangs under it: a removal
// the device's database refuses half way must leave a row refused for ever, never a deleted log that comes back.
export async function dropQueuedWritesNamingLog(logId: string): Promise<number> {
  const isOwn = (item: SyncQueueItem) => item.table === 'v2_set_logs' && (item.operation === 'upsert' || item.operation === 'patch') && payloadOf(item).id === logId
  const named = (await db.sync_queue.toArray())
    .filter((item) => isOwn(item) || namedLogIdOf(item) === logId || (item.operation === 'upsert' && headIdOf(item) === logId))
    .sort((a, b) => Number(isOwn(b)) - Number(isOwn(a)))
  const { removePending } = useOfflineStore.getState()
  for (const item of named) {
    removedByCleanup.add(item.id!)
    await db.sync_queue.delete(item.id!)
    const id = payloadOf(item).id
    if (id) removePending(id)
  }
  if (named.length > 0) useOfflineStore.getState().setSyncFailures(failuresOf(await db.sync_queue.orderBy('createdAt').toArray()))
  return named.length
}

// DECISIONS 230 (ii). History's delete of a session (`useDeleteSession`'s direct request) has gone through. The server took the session's set logs (001: `session_id`, ON DELETE
// CASCADE) and its change rows (042: the same) with it, so a queued upsert of one is refused `23503` for ever; and a queued upsert of the session's own row (a finish, a skip) would
// create the session again. The writes that name the session leave the queue: set-log and change-row upserts by `session_id`, the session's own upserts by `id`, a queued delete or
// patch of one of its logs by the `sessionId` beside it. A coach note that names it (017: ON DELETE SET NULL) is the user's own words and is never dropped: it goes on with no session,
// as the server would have left it. Every other session's writes, other notes and everything else stay. Called after the request has been answered, never before. Returns how many
// writes left; the notice is made again from what is left.
function namesSession(item: SyncQueueItem, sessionId: string): boolean {
  const p = payloadOf(item)
  if (item.table === 'v2_sessions') return item.operation === 'upsert' && p.id === sessionId
  if (item.table === 'v2_set_logs') return p.session_id === sessionId || item.sessionId === sessionId
  if (item.table === SESSION_SET_CHANGES_TABLE) return p.session_id === sessionId
  return false
}

export async function dropQueuedWritesNamingSession(sessionId: string): Promise<number> {
  const items = await db.sync_queue.toArray()
  // The session's own upserts first (a session that comes back is the worst a half-finished cleanup could leave), then what hangs under it.
  const named = items.filter((item) => namesSession(item, sessionId)).sort((a, b) => Number(b.table === 'v2_sessions') - Number(a.table === 'v2_sessions'))
  const notes = items.filter((item) => item.table === 'v2_coach_notes' && item.operation === 'upsert' && (item.payload as { session_id?: string | null } | null)?.session_id === sessionId)
  const { removePending } = useOfflineStore.getState()
  for (const item of named) {
    removedByCleanup.add(item.id!)
    await db.sync_queue.delete(item.id!)
    const id = payloadOf(item).id
    if (id) removePending(id)
  }
  for (const note of notes) await db.sync_queue.update(note.id!, { payload: { ...(note.payload as Record<string, unknown>), session_id: null } })
  if (named.length > 0 || notes.length > 0) useOfflineStore.getState().setSyncFailures(failuresOf(await db.sync_queue.orderBy('createdAt').toArray()))
  return named.length
}

// DECISIONS 230 (the Library's delete of an exercise): how many logs this phone still has to send for the exercise. The Library counts the server's logs to choose between deleting an
// exercise for good (none) and keeping it as lost (any); a log still waiting here is a log of it, and a delete that went ahead would leave it refused `23503` for ever
// (`v2_set_logs.exercise_id` has no delete action). A log queued together with its own delete never reaches the server and is not counted.
export async function queuedSetsNamingExercise(exerciseId: string): Promise<number> {
  const items = await db.sync_queue.toArray()
  const deleted = new Set(items.filter((item) => item.table === 'v2_set_logs' && item.operation === 'delete').map((item) => payloadOf(item).id))
  const logs = new Set<string>()
  for (const item of items) {
    const p = payloadOf(item)
    if (item.table === 'v2_set_logs' && item.operation === 'upsert' && p.exercise_id === exerciseId && p.id && !deleted.has(p.id)) logs.add(p.id)
  }
  return logs.size
}

async function lastQueuedWriteIsPatch(logId: string, setNumber: number): Promise<boolean> {
  const own = (await db.sync_queue.toArray())
    .filter((item) => item.table === 'v2_set_logs' && payloadOf(item).id === logId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id! - b.id!)
  const last = own[own.length - 1]
  return last !== undefined && last.operation === 'patch' && (last.payload as { set_number?: unknown }).set_number === setNumber
}
