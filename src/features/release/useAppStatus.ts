import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { useAuth } from '../auth/useAuth'
import { fetchAppStatus, type AppStatus } from './appStatusService'
import { APP_STATUS_KEY } from '../../lib/maintenanceRefusal'

// Chunk 72 (SPEC.md 1.2.1, Screens → Maintenance [10]; TASKS.md "The gate's state"). The app's read of `v2_app_status`, and what it decides.
//
// "The app checks the flag at start, when it comes back to the foreground, every hour, and every minute while the screen is showing."
//   - at start: the query's first read (mount);
//   - back in the foreground: `visibilitychange` to visible. `refetchOnWindowFocus` is off app-wide (queryClient.ts: a gym user switches apps
//     all the time and a data refetch must not disturb a workout), so this hook listens to the document itself;
//   - every hour, and every minute while a gate screen shows: `refetchInterval`, chosen from the last answer;
//   - at once when the database refuses a write with `OL001`: queryClient.ts's mutation cache and the sync queue's pass invalidate `APP_STATUS_KEY`
//     (DECISIONS 271), so the screen does not wait for the hour.
//
// Offline the app can't read the flag and works as usual: the read is `networkMode: 'online'` (paused, never failed, offline), but a paused query KEEPS
// the data it already holds, so the answer the hook gives is `undefined` whenever the phone is offline, and never an answer read before it went offline
// (chunk 72's pre-read, 72-2): a maintenance screen shown online must not stay up over a phone that is offline. A read that fails online (the server
// down, a network error) leaves no answer too: no status is no gate. Nothing is stored: the answer lives in the query cache of this run only.

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

/** The status as the app may act on it: `undefined` while it is unread, while the read fails, and whenever the phone is offline. */
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
    // A screen shows only for a non-exempt account while maintenance is on: that is what is read every minute. An exempt account's strip is not a
    // screen, so it reads every hour like any other, and so does an app with nothing on.
    refetchInterval: (q) => (maintenanceGate(q.state.data, userId) === 'maintenance' ? GATE_POLL_MS : IDLE_POLL_MS),
  })

  const { refetch } = query
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === 'visible') void refetch()
    }
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [refetch])

  return { data: isOnline ? query.data : undefined }
}

/** The gate for the signed-in (or signed-out) account the app is showing now. */
export function useGate(): Gate {
  const { user } = useAuth()
  const { data } = useAppStatus()
  return maintenanceGate(data, user?.id)
}
