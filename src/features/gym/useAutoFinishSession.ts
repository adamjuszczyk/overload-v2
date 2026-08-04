import { useEffect, useRef } from 'react'
import { useSettingsStore } from '../settings/settingsStore'
import { useToastStore } from '../notifications/toastStore'
import { useCompleteSession } from './useSession'
import type { Session, WeekPlan } from '../../types'

const CHECK_INTERVAL_MS = 30_000

// Auto-completes a session once every planned set (across all exercises) has
// a corresponding set_log row and the most recently logged set is older than
// the user's configured inactivity threshold. Runs entirely client-side —
// completion goes through useCompleteSession so it queues offline the same
// way a manual FINISH SESSION does.
export function useAutoFinishSession(session: Session | undefined, weekPlan: WeekPlan | null) {
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
      const allLogged = plannedSetIds.every((id) => logs.some((l) => l.weekPlanSetId === id))
      if (!allLogged) return

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
        { onSuccess: () => showToast('Session completed automatically') },
      )
    }

    check()
    const id = setInterval(check, CHECK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [autoFinishMinutes, session, weekPlan, completeSession, showToast])
}
