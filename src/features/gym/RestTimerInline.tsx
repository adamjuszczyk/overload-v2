import { useState, useEffect } from 'react'
import { useRestTimerStore } from './restTimerStore'
import { useSettingsStore } from '../settings/settingsStore'
import { formatRestTime } from '../../lib/formatRestTime'

// Compact, read-only rest-time display anchored directly under the row that
// was just logged (SPEC §4.3 — "not only as a floating/global element").
// The caller (SetGroup.tsx) is responsible for only rendering this under the
// one row whose id matches restTimerStore's anchorId. The existing floating
// RestTimer.tsx is unchanged and keeps its own richer behaviour (GO alert,
// haptic buzz, hide/show) — this is a lightweight supplementary display, not
// a replacement.
// Chunk 16 (SPEC "Rest") — unchanged. This display has always been
// elapsed-time-only, with no target/GO comparison at all (unlike RestTimer),
// so restChain.ts's resolved target changes nothing about what it shows; the
// chain still governs it indirectly through restTimerStore.startedAt itself
// — "no timer" (useExerciseCardState.ts calling stop() instead of
// startRest()) means startedAt stays null, so this renders nothing, exactly
// like every other "timer not running" case already does.
export default function RestTimerInline() {
  const startedAt = useRestTimerStore((s) => s.startedAt)
  const restTimerEnabled = useSettingsStore((s) => s.restTimerEnabled)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startedAt) return
    const tick = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (!restTimerEnabled || !startedAt) return null

  return (
    <p
      className="pl-7 text-xs font-bold tracking-widest"
      style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
    >
      REST {formatRestTime(elapsed)}
    </p>
  )
}
