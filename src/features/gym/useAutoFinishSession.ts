import { useEffect, useRef } from 'react'
import { useSettingsStore } from '../settings/settingsStore'
import { useToastStore } from '../notifications/toastStore'
import { useCompleteSession } from './useSession'
import type { Session, WeekPlan } from '../../types'

const CHECK_INTERVAL_MS = 30_000

// Auto-completes a session once the workout's rows say nothing is left (`nothingLeft`: the finish warning is empty and no open row is a drop of a
// planned set or a planned warmup, `useWorkoutRows`) and the most recently logged set is older than the user's configured inactivity threshold. Runs entirely client-side — completion goes
// through useCompleteSession so it queues offline the same way a manual FINISH SESSION does.
//
// Chunk 61 (DECISIONS 166 (a), Adam 2026-10-16): "waits for what the workout's rows say is left (the same view as the finish warning)" instead of a
// log on every planned set id, which a planned set deleted during the workout never gets (its row is gone, so the session could never finish). The
// option he took: "no row of `resolveRows` is open. That covers working sets, drops and planned warmups, with deleted sets out and retyped drops
// in. A set added in the session and never logged doesn't hold it, as today." The threshold and the grace window are as they were. A plan with no sets at all, and a session with no log, never finish by themselves, as before.
export function useAutoFinishSession(session: Session | undefined, weekPlan: WeekPlan | null, nothingLeft: boolean) {
  const autoFinishMinutes = useSettingsStore((s) => s.autoFinishMinutes)
  const completeSession = useCompleteSession()
  const showToast = useToastStore((s) => s.show)
  const triggeredRef = useRef(false)
  // Mount time (i.e. the moment this session was last armed as in_progress —
  // GymSession fully unmounts/remounts when a session flips completed <-> reopened).
  const armedAtRef = useRef(Date.now())

  useEffect(() => {
    triggeredRef.current = false
    armedAtRef.current = Date.now()
  }, [session?.id])

  useEffect(() => {
    if (autoFinishMinutes == null) return
    if (!session || session.status !== 'in_progress') return

    const plannedSetIds = weekPlan?.sets.map((s) => s.id) ?? []
    if (plannedSetIds.length === 0) return

    const check = () => {
      if (triggeredRef.current) return
      // Grace window since (re)arming — without this, reopening a session where
      // every set was already logged (the common "reopen to edit" case) passes
      // the staleness check below on the very first tick and gets immediately
      // re-finished, since that staleness is exactly why it was finishable.
      if (Date.now() - armedAtRef.current < autoFinishMinutes * 60_000) return

      const logs = session.setLogs ?? []
      if (!nothingLeft) return

      const lastLoggedAt = logs.reduce<string | null>(
        (max, l) => (max === null || l.loggedAt > max ? l.loggedAt : max),
        null,
      )
      if (!lastLoggedAt) return

      const elapsedMs = Date.now() - new Date(lastLoggedAt).getTime()
      if (elapsedMs < autoFinishMinutes * 60_000) return

      triggeredRef.current = true
      completeSession.mutate(
        { id: session.id, note: session.note },
        {
          onSuccess: () => showToast('Session completed automatically'),
          // Without this (found by adversarial review), a failed completion
          // attempt left triggeredRef stuck true forever for this mounted
          // session — every later 30s tick's early-return at the top of
          // check() would silently no-op, permanently disabling auto-finish
          // for it with no error surfaced. completeSession() now does two
          // round trips instead of one (a SELECT before the UPDATE, see
          // sessionService.ts), a real second failure point this closes off.
          onError: () => {
            triggeredRef.current = false
          },
        },
      )
    }

    check()
    const id = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [autoFinishMinutes, session, weekPlan, nothingLeft, completeSession, showToast])
}
