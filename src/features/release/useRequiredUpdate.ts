import { useCallback, useEffect, useRef, useState } from 'react'
import { queryClient } from '../../lib/queryClient'
import { serviceWorkerRecord } from '../pwa/useServiceWorker'
import { useAppStatus } from './useAppStatus'
import { updateRequired } from './versionGate'

// Chunk 73 (SPEC.md 1.2.1, Screens → Update to continue [11]; TASKS.md chunk 73; DECISIONS 257, 258). Whether this version may still run, and what UPDATE
// does. "When it shows: when the running version is older than `min_version`", read from the same status as maintenance (`useAppStatus`: nothing offline,
// nothing before the first read, and the answer is read again at the same moments, every minute while the screen shows).
//
// UPDATE "gets the new version and reloads". `registerType: 'autoUpdate'` installs the new worker in the background and it takes over by itself
// (skipWaiting, clientsClaim: vite.config.ts), so by the time UPDATE is pressed the new worker has usually already activated. The order is:
//   1. offline: failed at once (nothing to fetch, and "Couldn't update. Check your connection and try again." is true);
//   2. wait for the writes that are in flight, as the banner's RELOAD did (8 s at the most), so a reload cannot cut a request off;
//   3. a newer worker has already activated (`onNeedReload` recorded it): reload at once, the page is served by it from the first byte;
//   4. a worker is installing or waiting: attach to it and wait for it to activate; only otherwise ask the registration for an update first;
//   5. reload once a new worker has activated; failed if the update check is refused, or none has activated within 20 s (DECISIONS 257).
// Nothing in the queue is touched: IndexedDB survives the reload (TASKS Facts 3), and the new version sends it (versionGate.ts).
// What does not survive is the running rest timer and numbers typed but not logged (DECISIONS 258: accepted, as after the old RELOAD).

/** How long UPDATE waits for a new worker to activate before it gives up. */
export const UPDATE_WAIT_MS = 20_000
/** How long the reload waits for a request in flight to settle: generous next to a Supabase round trip, bounded so a stuck one can't hold UPDATE for ever. */
export const MUTATION_WAIT_MS = 8_000
const MUTATION_POLL_MS = 150

export type UpdateState = 'ready' | 'updating' | 'failed'

async function waitForWritesInFlight(): Promise<void> {
  const start = Date.now()
  while (queryClient.isMutating() > 0 && Date.now() - start < MUTATION_WAIT_MS) {
    await new Promise((resolve) => setTimeout(resolve, MUTATION_POLL_MS))
  }
}

function reload(): true {
  window.location.reload()
  return true
}

/** Resolves true once a new worker has activated, false when the update check is refused, a worker fails, or the cap is reached. */
function newWorkerActivated(registration: ServiceWorkerRegistration): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const container = navigator.serviceWorker
    const stops: Array<() => void> = []
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      for (const stop of stops) stop()
      resolve(ok)
    }

    const timer = setTimeout(() => finish(false), UPDATE_WAIT_MS)
    stops.push(() => clearTimeout(timer))

    const watch = (worker: ServiceWorker | null) => {
      if (!worker || settled) return
      if (worker.state === 'activated') return finish(true)
      if (worker.state === 'redundant') return finish(false)
      const onChange = () => {
        if (worker.state === 'activated') finish(true)
        else if (worker.state === 'redundant') finish(false)
      }
      worker.addEventListener('statechange', onChange)
      stops.push(() => worker.removeEventListener('statechange', onChange))
    }

    const onUpdateFound = () => watch(registration.installing)
    registration.addEventListener('updatefound', onUpdateFound)
    stops.push(() => registration.removeEventListener('updatefound', onUpdateFound))
    const onControllerChange = () => finish(true)
    container.addEventListener('controllerchange', onControllerChange)
    stops.push(() => container.removeEventListener('controllerchange', onControllerChange))

    if (registration.installing || registration.waiting) {
      watch(registration.installing)
      watch(registration.waiting)
    } else {
      registration.update().then(
        () => {
          watch(registration.installing)
          watch(registration.waiting)
        },
        () => finish(false),
      )
    }
  })
}

/** Gets the new version and reloads into it. True: the page is reloading. False: it could not be updated (the screen says so and offers TRY AGAIN). */
export async function applyUpdate(): Promise<boolean> {
  if (navigator.onLine === false) return false
  await waitForWritesInFlight()

  const { registration: registered, newWorkerActive } = serviceWorkerRecord()
  if (newWorkerActive) return reload()

  const registration = registered ?? (await navigator.serviceWorker?.getRegistration().catch(() => undefined))
  // A browser with no service worker at all caches nothing: a reload fetches the newest code from the network. One that has them but has no
  // registration to ask is a registration that failed: there is no new version it can install.
  if (registration === undefined) return 'serviceWorker' in navigator ? false : reload()
  return (await newWorkerActivated(registration)) ? reload() : false
}

export interface RequiredUpdate {
  /** This version is older than the status's `min_version` (read online): the update screen shows. */
  required: boolean
  /** The `min_version` read, or '' while there is no answer. */
  minVersion: string
  state: UpdateState
  update: () => Promise<void>
}

export function useRequiredUpdate(): RequiredUpdate {
  const { data } = useAppStatus()
  const required = updateRequired(data)
  const [state, setState] = useState<UpdateState>('ready')
  const running = useRef(false)

  const update = useCallback(async () => {
    if (running.current) return
    running.current = true
    setState('updating')
    let reloading = false
    try {
      reloading = await applyUpdate()
    } catch (error) {
      console.error('[update] could not update', error)
    }
    // A page that is reloading stays on UPDATING… until it is gone.
    if (!reloading) {
      running.current = false
      setState('failed')
    }
  }, [])

  // The screen goes away when the version passes (a new `min_version`, or the phone offline); it starts again from UPDATE when it comes back.
  useEffect(() => {
    if (!required && !running.current) setState('ready')
  }, [required])

  return { required, minVersion: data?.minVersion ?? '', state, update }
}
