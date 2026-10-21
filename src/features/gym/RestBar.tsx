// Chunk 58a — the rest timer as the pinned bar above the navigation (SPEC [1.2] "Rest timer (C5)": "no inline rest under the last
// logged set; the rest timer is the pinned bar"; boards W1, W4). It replaces the floating RestTimer and RestTimerInline. "REST 1:12 /
// 2:00" with a progress bar, "GO" once the target has passed, a chevron to hide it (hidden: "REST 0:48" and the chevron back), and the
// jump button, "↓ SET 03" or "↑ SET 03", which scrolls to the current set while it is out of view. With the rest timer off, or no rest
// running, only the jump button shows; with neither, nothing does. The target is the rest chain's (restTimerStore.targetSeconds,
// chunk 16) or Settings'.
import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp } from 'lucide-react'
import { useRestTimerStore } from './restTimerStore'
import { useSettingsStore } from '../settings/settingsStore'
import { formatRestTime } from '../../lib/formatRestTime'

interface RestBarProps {
  /** The current set is out of view: which way it is (null while it is on screen, or there is none), its name and the jump itself. */
  jump: { direction: 'up' | 'down' | null; label: string | null; onJump: () => void }
}

const MONO = 'var(--font-mono)'

export default function RestBar({ jump }: RestBarProps) {
  const startedAt = useRestTimerStore((s) => s.startedAt)
  const isVisible = useRestTimerStore((s) => s.isVisible)
  const hide = useRestTimerStore((s) => s.hide)
  const show = useRestTimerStore((s) => s.show)
  const chainTarget = useRestTimerStore((s) => s.targetSeconds)
  const restTimerEnabled = useSettingsStore((s) => s.restTimerEnabled)
  const settingsTarget = useSettingsStore((s) => s.targetRestSeconds)
  const buzzOnRestComplete = useSettingsStore((s) => s.buzzOnRestComplete)
  const target = chainTarget ?? settingsTarget

  const [elapsed, setElapsed] = useState(0)
  const [flash, setFlash] = useState(false)
  const buzzedRef = useRef(false)

  useEffect(() => {
    if (!startedAt) {
      setElapsed(0)
      buzzedRef.current = false
      return
    }
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000)
      setElapsed(s)
      if (!buzzedRef.current && buzzOnRestComplete && s >= target) {
        buzzedRef.current = true
        // iOS Safari has no Vibration API: fall back to a brief visual flash so the setting still has an effect.
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate(400)
        } else {
          setFlash(true)
          setTimeout(() => setFlash(false), 600)
        }
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, buzzOnRestComplete, target])

  const resting = restTimerEnabled && startedAt !== null
  const jumping = jump.direction !== null && jump.label !== null
  if (!resting && !jumping) return null

  const isOver = elapsed >= target
  const progress = Math.min(elapsed / target, 1)
  const Arrow = jump.direction === 'up' ? ArrowUp : ArrowDown

  return (
    <div
      data-rest-bar
      className="sticky bottom-0"
      style={{
        zIndex: 20,
        backgroundColor: flash ? 'var(--accent-muted)' : 'var(--base)',
        borderTop: '1px solid var(--border)',
        paddingBottom: 2,
      }}
    >
      <div className="flex items-center gap-3 px-4" style={{ minHeight: 52 }}>
        {resting && (
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>
              REST
            </span>
            <span className="text-lg font-black tabular-nums" style={{ color: isOver ? 'var(--accent)' : 'var(--text-primary)', fontFamily: MONO }}>
              {formatRestTime(elapsed)}
            </span>
            {isVisible && (
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)', fontFamily: MONO }}>
                / {formatRestTime(target)}
              </span>
            )}
            {isOver && (
              <span className="text-xs font-bold tracking-widest" style={{ color: 'var(--accent)', fontFamily: MONO }}>
                GO
              </span>
            )}
          </div>
        )}
        <div className="flex-1" />
        {jumping && (
          <button
            type="button"
            onClick={jump.onJump}
            className="flex items-center gap-1.5 rounded-lg text-xs font-bold tracking-widest"
            style={{ minHeight: 44, padding: '0 12px', backgroundColor: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)', fontFamily: MONO }}
            aria-label={`Jump to ${jump.label}`}
          >
            <Arrow size={13} />
            {jump.label}
          </button>
        )}
        {resting && (
          <button
            type="button"
            onClick={isVisible ? hide : show}
            className="flex items-center justify-center"
            style={{ minWidth: 44, minHeight: 44, color: 'var(--text-muted)' }}
            aria-label={isVisible ? 'Hide rest timer' : 'Show rest timer'}
            aria-expanded={isVisible}
          >
            {isVisible ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
          </button>
        )}
      </div>
      {resting && isVisible && (
        <div style={{ height: 3, margin: '0 16px 6px', borderRadius: 2, backgroundColor: 'var(--surface)' }}>
          <div className="transition-all duration-1000" style={{ height: 3, borderRadius: 2, width: `${progress * 100}%`, backgroundColor: isOver ? 'var(--accent)' : 'var(--accent)' }} />
        </div>
      )}
    </div>
  )
}
