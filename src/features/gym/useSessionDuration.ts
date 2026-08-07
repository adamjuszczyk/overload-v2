import { useState, useEffect } from 'react'
import type { Session } from '../../types'

// Live elapsed seconds since the session started (SPEC §4.3 — "workout
// duration shown at the top, counting from session start"). Resets whenever
// the session identity or its startedAt changes — same guard useAutoFinishSession.ts
// uses, since GymSession fully unmounts/remounts across completed <-> reopened.
export function useSessionDuration(session: Session | undefined): number {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!session?.startedAt) {
      setElapsed(0)
      return
    }

    const startedAtMs = new Date(session.startedAt).getTime()
    const tick = () => setElapsed(Math.floor((Date.now() - startedAtMs) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [session?.id, session?.startedAt])

  return elapsed
}
