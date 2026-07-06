import { useState, useEffect, useRef } from 'react'
import { useRestTimerStore } from './restTimerStore'
import { useSettingsStore } from '../settings/settingsStore'

function fmt(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function RestTimer() {
  const { startedAt, isVisible, hide, show } = useRestTimerStore()
  const restTimerEnabled  = useSettingsStore((s) => s.restTimerEnabled)
  const targetRestSeconds = useSettingsStore((s) => s.targetRestSeconds)
  const buzzOnRestComplete = useSettingsStore((s) => s.buzzOnRestComplete)

  const [elapsed, setElapsed] = useState(0)
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

      if (!buzzedRef.current && buzzOnRestComplete && s >= targetRestSeconds) {
        buzzedRef.current = true
        navigator.vibrate?.(400)
      }
    }

    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, buzzOnRestComplete, targetRestSeconds])

  // Hidden entirely when disabled or timer hasn't started
  if (!restTimerEnabled || !startedAt) return null

  const isOver = elapsed >= targetRestSeconds
  const progress = Math.min(elapsed / targetRestSeconds, 1)

  // Collapsed pill
  if (!isVisible) {
    return (
      <div className="mx-4 mb-3 flex justify-end">
        <button
          onClick={show}
          className="flex items-center gap-2 px-3 rounded-lg text-xs font-bold tracking-widest"
          style={{
            minHeight: 44,
            backgroundColor: 'var(--surface)',
            border: `1px solid ${isOver ? 'var(--accent)' : 'var(--border)'}`,
            color: isOver ? 'var(--accent)' : 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          REST {fmt(elapsed)}
          {isOver && ' · GO'}
        </button>
      </div>
    )
  }

  return (
    <div
      className="mx-4 mb-3 rounded-xl overflow-hidden"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      {/* Progress bar */}
      <div
        className="h-0.5 transition-all duration-1000"
        style={{
          width: `${progress * 100}%`,
          backgroundColor: isOver ? 'var(--accent)' : 'var(--text-muted)',
        }}
      />

      <div className="flex items-center justify-between px-4" style={{ minHeight: 44 }}>
        <div className="flex items-center gap-3">
          <span
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            REST
          </span>
          <span
            className="text-lg font-black tabular-nums"
            style={{
              color: isOver ? 'var(--accent)' : 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {fmt(elapsed)}
          </span>
          {isOver && (
            <span
              className="text-xs font-bold tracking-widest"
              style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
            >
              GO
            </span>
          )}
        </div>
        <button
          onClick={hide}
          className="flex items-center justify-center text-xs rounded px-3"
          style={{
            minHeight: 44,
            minWidth: 44,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          HIDE
        </button>
      </div>
    </div>
  )
}
