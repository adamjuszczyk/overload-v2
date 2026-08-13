import { useState, useEffect, useCallback } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { queryClient } from '../../lib/queryClient'

// Structural gap this closes: `registerType: 'autoUpdate'` makes the
// generated sw.js call self.skipWaiting() + clients.claim() on its own, so a
// new service worker installs and takes control of every open tab without
// being asked — but nothing in this app ever imported the client-side
// registration module that actually *drives* that lifecycle (checking for a
// new sw.js, reacting once one takes over). Without it, an already-open
// session never re-checks and the SW-level auto-update silently never
// surfaces, so the tab keeps running whatever JS it loaded with,
// indefinitely, however many deploys land while it stays open.
//
// registration.update() only re-fetches /sw.js and byte-compares it against
// the installed one — it never touches app data or Supabase, so running it
// on an interval and again on visibilitychange doesn't conflict with
// queryClient.ts's deliberate `refetchOnWindowFocus: false` (that's about
// not disrupting an active workout with a *data* refetch; this is an asset-
// bundle check, a different axis entirely).
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

// How long reload() will wait for an in-flight mutation to settle before
// giving up and reloading anyway — see the reload() comment below for why
// this exists at all. Generous relative to a normal Supabase round trip on
// gym wifi, but bounded so a genuinely stuck mutation can't make the
// RELOAD button hang forever.
const RELOAD_MUTATION_WAIT_MS = 8000
const RELOAD_MUTATION_POLL_MS = 150

export function usePwaUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [isReloading, setIsReloading] = useState(false)
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | undefined>()

  useRegisterSW({
    // autoUpdate mode fires `onNeedReload` (not `onNeedRefresh`, that's the
    // 'prompt'-mode-only callback) once the new worker has fully activated
    // and claimed every open client — i.e. the new worker is *already*
    // controlling this page by the time this fires. Left unhandled, the
    // library's own default is a silent `window.location.reload()`, which
    // is exactly the "could interrupt an active set" risk this app can't
    // accept — so this callback is required, not optional, and it only
    // flips UI state; it never reloads anything itself.
    onNeedReload() {
      setUpdateAvailable(true)
    },
    onRegisteredSW(_swUrl, reg) {
      setRegistration(reg)
    },
    // The rich registration path (workbox-window, imported dynamically by
    // the virtual module) can fail to even load — a strict CSP, an ad-
    // blocker treating a lazily-fetched chunk as suspicious, a transient
    // network blip on first paint — and register()'s own source returns
    // immediately on that failure with no retry of any kind. Left alone,
    // that's a silent, permanent "no service worker at all" for the tab,
    // not just "no update notice" (found by adversarial review). One bare
    // navigator.serviceWorker.register() fallback restores basic
    // offline/installable capability the same way the old auto-injected
    // registerSW.js used to, unconditionally; it just can't restore rich
    // update-detection too, since that needs workbox-window, the exact
    // piece that failed to load. A known, accepted, low-severity gap for a
    // rare edge case, not silently unhandled.
    onRegisterError(error) {
      console.error('[pwa] service worker registration failed, falling back to bare registration', error)
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((fallbackError) => {
          console.error('[pwa] fallback service worker registration also failed', fallbackError)
        })
      }
    },
  })

  // Because onNeedReload only fires after the new worker's activate event
  // (which runs clients.claim()) has fully resolved, the new worker is the
  // controller for this page by spec by the time it fires — so the reload
  // this triggers should be served by the new worker from the first byte,
  // avoiding the classic "first reload still shows the old bundle" race
  // most naive controllerchange-driven reloads hit.
  useEffect(() => {
    if (!registration) return
    const check = () => {
      registration.update().catch(() => {})
    }
    const interval = setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [registration])

  // User-gated only — never called automatically. The offline sync queue
  // (db.sync_queue, IndexedDB via Dexie) survives a reload, so anything
  // already queued is safe either way.
  //
  // But that's not the only write path: useLogSet's *online* branch (the
  // common case — this app only falls back to Dexie/sync_queue when
  // offline) posts straight to Supabase with no local durable copy at all,
  // after already optimistically marking the set logged in the UI (found by
  // adversarial review). A reload mid-request aborts that fetch — no
  // Supabase row, no Dexie row, no sync_queue entry, nothing to recover
  // from, and no error surfaced. So a reload isn't safe purely because the
  // *queue* is durable; it's only safe once nothing is actually in flight.
  // reload() here waits (briefly, capped) for React Query's in-flight
  // mutations to settle — covers LOG SET and every other online write this
  // app makes, not just this one call site — before actually navigating
  // away, rather than trusting a comment's claim that nothing was at risk.
  const reload = useCallback(async () => {
    setIsReloading(true)
    const start = Date.now()
    while (queryClient.isMutating() > 0 && Date.now() - start < RELOAD_MUTATION_WAIT_MS) {
      await new Promise((resolve) => setTimeout(resolve, RELOAD_MUTATION_POLL_MS))
    }
    window.location.reload()
  }, [])

  return {
    updateAvailable,
    isReloading,
    reload,
    dismiss: useCallback(() => setUpdateAvailable(false), []),
  }
}
