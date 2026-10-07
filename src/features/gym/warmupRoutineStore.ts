import { create } from 'zustand'

// Chunk 18 (SPEC.md "Warmup routine": "Items are ticked off; nothing else is
// logged."). Tick state is client-only, per session: CONTEXT.md's offline
// rule names exactly what queues through useSyncQueue/Dexie, and a tick is
// deliberately none of those — it is NEVER sent to Supabase and NEVER added
// to the offline queue or Dexie. It lives only here, in localStorage, keyed
// by session id, so a reload (same session, same tab or a fresh one) keeps
// today's ticks, but a DIFFERENT session id — a past session reopened,
// tomorrow's session, anything else — always starts fresh. This file is the
// ONLY place a tick is ever read or written; warmupRoutineService.ts (the
// routine's own text/order) never imports it and never touches this key.
//
// Every localStorage access is wrapped in try/catch: private browsing in
// some browsers, a full quota, or a disabled store can all make getItem/
// setItem/key throw. A failing store must never stop the checklist from
// rendering — it only means ticks won't survive a reload this time, same as
// if nothing had been ticked yet. See readTicked/writeTicked below.
const STORAGE_PREFIX = 'overload:warmup-routine-ticks:'

// Pruning (reviewer's brief: "old sessions' keys may be pruned; say how, or
// why not"): every successful write scans this tab's own localStorage for
// every key under STORAGE_PREFIX, and if there are more than MAX_SESSIONS of
// them, deletes the oldest (by each key's own saved-at timestamp) down to
// the cap. Bounded by how many distinct session ids a device has ever
// ticked anything in, not by total data size, so the scan stays cheap at
// this scale (a per-key JSON.parse of a handful of keys, not a backup of
// every session a user has ever logged).
const MAX_SESSIONS = 20

function keyFor(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`
}

function readTicked(sessionId: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(keyFor(sessionId))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as { ticked?: unknown } | null
    const ticked = parsed?.ticked
    return ticked && typeof ticked === 'object' ? (ticked as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

function pruneOldSessions(): void {
  try {
    const entries: { key: string; savedAt: number }[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(STORAGE_PREFIX)) continue
      let savedAt = 0
      try {
        const parsed = JSON.parse(localStorage.getItem(key) ?? 'null') as { savedAt?: unknown } | null
        if (typeof parsed?.savedAt === 'number') savedAt = parsed.savedAt
      } catch {
        // Unreadable entry — treat as the oldest, so it's first to go.
      }
      entries.push({ key, savedAt })
    }
    if (entries.length <= MAX_SESSIONS) return
    entries.sort((a, b) => a.savedAt - b.savedAt)
    for (const { key } of entries.slice(0, entries.length - MAX_SESSIONS)) {
      localStorage.removeItem(key)
    }
  } catch {
    // Scanning/removing failed — leave whatever is already stored in place,
    // same "still renders, just doesn't prune this time" posture as
    // readTicked/writeTicked.
  }
}

function writeTicked(sessionId: string, ticked: Record<string, boolean>): void {
  try {
    localStorage.setItem(keyFor(sessionId), JSON.stringify({ savedAt: Date.now(), ticked }))
    pruneOldSessions()
  } catch {
    // Ignored — storage may be full, disabled, or unavailable (private
    // browsing in some browsers). The in-memory store below still reflects
    // the toggle for the rest of this tab's life; it just won't survive a
    // reload.
  }
}

interface WarmupRoutineState {
  // sessionId -> itemId -> ticked. In-memory mirror of localStorage, read
  // lazily per session id (see `load` below) rather than eagerly loading
  // every session's own key up front.
  bySession: Record<string, Record<string, boolean>>
  // Hydrates bySession[sessionId] from localStorage the first time this
  // session id is seen in this store instance; a no-op on every later call
  // for the same id (including after a toggle, which already keeps
  // bySession in sync itself — see toggle below). Called from a
  // useEffect (WarmupRoutineChecklist.tsx), never during render.
  load: (sessionId: string) => void
  toggle: (sessionId: string, itemId: string) => void
}

export const useWarmupRoutineStore = create<WarmupRoutineState>((set, get) => ({
  bySession: {},
  load: (sessionId) => {
    if (sessionId in get().bySession) return
    const loaded = readTicked(sessionId)
    set((state) => ({ bySession: { ...state.bySession, [sessionId]: loaded } }))
  },
  toggle: (sessionId, itemId) => {
    const current = get().bySession[sessionId] ?? readTicked(sessionId)
    const next = { ...current, [itemId]: !current[itemId] }
    writeTicked(sessionId, next)
    set((state) => ({ bySession: { ...state.bySession, [sessionId]: next } }))
  },
}))
