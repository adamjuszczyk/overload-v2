import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useAuth } from '../auth/useAuth'
import { fetchAppStatus, type AppStatus } from './appStatusService'
import { APP_STATUS_KEY } from '../../lib/maintenanceRefusal'
import { queryClient } from '../../lib/queryClient'
import { updateRequired } from './versionGate'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]; TASKS.md "The gate's state"). The app's read of `v2_app_status`, and what it decides.
//
// "The app checks the flag at start, when it comes back to the foreground, every hour, and every minute while the screen is showing."
// Update to continue [11] is "checked at the same moments as maintenance" (chunk 73), so the minute applies to either screen.
//   - at start: the query's first read (mount);
//   - back in the foreground: `visibilitychange` to visible. `refetchOnWindowFocus` is off app-wide (queryClient.ts: a gym user switches apps
//     all the time and a data refetch must not disturb a workout), so the document is listened to here, ONCE for the whole app however many
//     components use the status (chunk 73, the 72 review's P2: each user of the hook had its own listener and each return read twice);
//   - every hour, and every minute while a gate screen shows: `refetchInterval`, chosen from the last answer;
//   - at once when the database refuses a write with `OL001`: queryClient.ts's mutation cache and the sync queue's pass invalidate `APP_STATUS_KEY`
//     (DECISIONS 271), so the screen does not wait for the hour.
//
// Offline the app can't read the flag and works as usual: the read is `networkMode: 'online'` (paused, never failed, offline), but a paused query KEEPS
// the data it already holds, so the answer the hook gives is `undefined` whenever the phone is offline, and never an answer read before it went offline
// (chunk 72's pre-read, 72-2): a maintenance screen shown online must not stay up over a phone that is offline. A status that has never been read
// stays unread while its reads fail online (the server down, a network error): no status is no gate. A read that fails AFTER one has answered keeps
// that answer, though: TanStack holds the data of the last good read through a failed one (chunk 72's review, D), so a screen shown stays up and the
// app that was open stays open until a read answers differently. Nothing is stored: the answer lives in the query cache of this run only.

/** How often the flag is read while nothing is gated: the stated "every hour". */
export const IDLE_POLL_MS = 60 * 60 * 1000
/** How often it is read while a gate screen shows: the stated "every minute". */
export const GATE_POLL_MS = 60 * 1000

/** What the status asks of this account: the full-screen gate, the strip an exempt account works under, or nothing. */
export type Gate = 'maintenance' | 'strip' | null

/**
 * Maintenance on and this account not exempt → the screen; on and exempt → the strip; off, or no answer → nothing. There is no account before
 * sign-in (`userId` undefined), so signed out the screen shows (Adam, 2026-10-30, TASKS question 6).
 */
export function maintenanceGate(status: AppStatus | undefined, userId: string | undefined): Gate {
  if (!status || !status.maintenance) return null
  return userId !== undefined && status.exemptUserIds.includes(userId) ? 'strip' : 'maintenance'
}

// The foreground read: one listener on the document for the whole app, added by the first component that uses the status and removed with the
// last. The read it makes is the query's, whoever asked.
let foregroundUsers = 0
function readInTheForeground() {
  if (document.visibilityState === 'visible') void queryClient.refetchQueries({ queryKey: APP_STATUS_KEY })
}
function useReadInTheForeground() {
  useEffect(() => {
    if (foregroundUsers === 0) document.addEventListener('visibilitychange', readInTheForeground)
    foregroundUsers += 1
    return () => {
      foregroundUsers -= 1
      if (foregroundUsers === 0) document.removeEventListener('visibilitychange', readInTheForeground)
    }
  }, [])
}

/** The status as the app may act on it: `undefined` while it is unread, while the phone is offline, and while its reads keep failing from the start. */
export function useAppStatus(): { data: AppStatus | undefined } {
  const isOnline = useOnlineStatus()
  const { user } = useAuth()
  const userId = user?.id

  const query = useQuery({
    queryKey: APP_STATUS_KEY,
    queryFn: fetchAppStatus,
    networkMode: 'online',
    // Every trigger reads: a mount, a reconnect, an invalidation. Nothing here is "fresh enough to skip".
    staleTime: 0,
    refetchOnWindowFocus: false,
    // A screen shows for a non-exempt account while maintenance is on, and for any account while this version is older than `min_version`: that is
    // what is read every minute. An exempt account's strip is not a screen, so it reads every hour like any other, and so does an app with nothing on.
    refetchInterval: (q) =>
      maintenanceGate(q.state.data, userId) === 'maintenance' || updateRequired(q.state.data) ? GATE_POLL_MS : IDLE_POLL_MS,
  })

  useReadInTheForeground()

  return { data: isOnline ? query.data : undefined }
}

/** The gate for the signed-in (or signed-out) account the app is showing now. */
export function useGate(): Gate {
  const { user } = useAuth()
  const { data } = useAppStatus()
  return maintenanceGate(data, user?.id)
}
