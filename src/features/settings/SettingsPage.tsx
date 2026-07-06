import { useState } from 'react'
import { useSettings, useUpdateSettings } from './useSettings'
import type { UserSettings } from '../../types'

const ACCENT_SWATCHES: { colour: string; label: string }[] = [
  { colour: '#FF8C42', label: 'ORANGE' },
  { colour: '#3B82F6', label: 'BLUE'   },
  { colour: '#22C55E', label: 'GREEN'  },
  { colour: '#EC4899', label: 'PINK'   },
  { colour: '#8B5CF6', label: 'PURPLE' },
  { colour: '#EF4444', label: 'RED'    },
]

function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function parseSeconds(raw: string): number | null {
  const trimmed = raw.trim()
  // Accept "2:30" or "150"
  if (trimmed.includes(':')) {
    const [mStr, sStr] = trimmed.split(':')
    const m = parseInt(mStr ?? '0', 10)
    const s = parseInt(sStr ?? '0', 10)
    if (isNaN(m) || isNaN(s) || s >= 60) return null
    return m * 60 + s
  }
  const n = parseInt(trimmed, 10)
  return isNaN(n) || n < 0 ? null : n
}

export default function SettingsPage() {
  const { data: settings } = useSettings()
  const { mutate: update } = useUpdateSettings()

  const [restInput, setRestInput] = useState('')
  const [restEditing, setRestEditing] = useState(false)

  function set(patch: Partial<UserSettings>) {
    update(patch)
  }

  const labelStyle = {
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
    fontSize: 11,
    letterSpacing: '0.1em',
  }

  const sectionTitle = (text: string) => (
    <p className="text-xs font-bold tracking-widest mb-3" style={labelStyle}>
      {text}
    </p>
  )

  function chipRow<T extends string>(
    options: { value: T; label: string }[],
    current: T,
    onChange: (v: T) => void,
  ) {
    return (
      <div className="flex gap-2">
        {options.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => onChange(value)}
            className="flex-1 py-3 rounded-xl text-xs font-bold"
            style={{
              backgroundColor: current === value ? 'var(--accent)' : 'var(--surface-raised)',
              color: current === value ? 'var(--base)' : 'var(--text-muted)',
              border: `1px solid ${current === value ? 'transparent' : 'var(--border)'}`,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.08em',
            }}
          >
            {label}
          </button>
        ))}
      </div>
    )
  }

  function toggle(value: boolean, onChange: (v: boolean) => void, label: string) {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-sm" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
          {label}
        </span>
        <button
          onClick={() => onChange(!value)}
          className="relative flex-shrink-0"
          style={{ width: 48, height: 28 }}
          aria-label={label}
        >
          <span
            className="absolute inset-0 rounded-full transition-colors duration-200"
            style={{ backgroundColor: value ? 'var(--accent)' : 'var(--surface-raised)', border: `1px solid ${value ? 'transparent' : 'var(--border)'}` }}
          />
          <span
            className="absolute top-1 transition-all duration-200 rounded-full"
            style={{
              width: 20,
              height: 20,
              left: value ? 24 : 4,
              backgroundColor: value ? 'var(--base)' : 'var(--text-muted)',
            }}
          />
        </button>
      </div>
    )
  }

  const cardStyle = {
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--border)',
  }

  return (
    <div className="px-4 pt-8 pb-24">
      {/* Page header */}
      <p
        className="text-xs font-bold tracking-widest mb-1"
        style={labelStyle}
      >
        SETTINGS
      </p>
      <h1
        className="text-3xl font-black tracking-tight mb-8"
        style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
      >
        SETTINGS
      </h1>

      <div className="space-y-6">
        {/* ── Appearance ───────────────────────────────────────────────── */}
        <section>
          {sectionTitle('APPEARANCE')}
          <div className="rounded-xl p-4 space-y-5" style={cardStyle}>
            {/* Theme */}
            <div>
              <p className="text-xs mb-2.5" style={labelStyle}>THEME</p>
              {chipRow(
                [{ value: 'dark', label: 'DARK' }, { value: 'light', label: 'LIGHT' }],
                settings.theme,
                (theme) => set({ theme }),
              )}
            </div>

            {/* Accent */}
            <div>
              <p className="text-xs mb-2.5" style={labelStyle}>ACCENT COLOUR</p>
              <div className="flex gap-2 flex-wrap">
                {ACCENT_SWATCHES.map(({ colour, label }) => (
                  <button
                    key={colour}
                    onClick={() => set({ accentColour: colour })}
                    aria-label={label}
                    className="flex-1 rounded-xl py-3 min-w-[48px]"
                    style={{
                      backgroundColor: colour,
                      outline: settings.accentColour === colour
                        ? `3px solid var(--text-primary)`
                        : '3px solid transparent',
                      outlineOffset: 2,
                      opacity: settings.accentColour === colour ? 1 : 0.65,
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── Rest Timer ───────────────────────────────────────────────── */}
        <section>
          {sectionTitle('REST TIMER')}
          <div className="rounded-xl p-4 space-y-4" style={cardStyle}>
            {toggle(settings.restTimerEnabled, (v) => set({ restTimerEnabled: v }), 'Show rest timer')}

            {settings.restTimerEnabled && (
              <>
                <div
                  style={{ height: 1, backgroundColor: 'var(--border)' }}
                />

                {/* Target duration */}
                <div>
                  <p className="text-xs mb-2" style={labelStyle}>TARGET DURATION</p>
                  <div className="flex items-center gap-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={restEditing ? restInput : fmtSeconds(settings.targetRestSeconds)}
                      onFocus={() => {
                        setRestEditing(true)
                        setRestInput(String(settings.targetRestSeconds))
                      }}
                      onChange={(e) => setRestInput(e.target.value)}
                      onBlur={() => {
                        setRestEditing(false)
                        const parsed = parseSeconds(restInput)
                        if (parsed !== null && parsed > 0) set({ targetRestSeconds: parsed })
                      }}
                      className="w-24 px-3 py-3 rounded-xl text-sm font-bold text-center"
                      style={{
                        backgroundColor: 'var(--surface-raised)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    />
                    <span className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                      {restEditing ? 'SECONDS (or m:ss)' : fmtSeconds(settings.targetRestSeconds)}
                    </span>
                  </div>
                </div>

                <div
                  style={{ height: 1, backgroundColor: 'var(--border)' }}
                />

                {toggle(
                  settings.buzzOnRestComplete,
                  (v) => set({ buzzOnRestComplete: v }),
                  'Vibrate when rest ends',
                )}
              </>
            )}
          </div>
        </section>

        {/* ── Units ────────────────────────────────────────────────────── */}
        <section>
          {sectionTitle('UNITS')}
          <div className="rounded-xl p-4" style={cardStyle}>
            <p className="text-xs mb-2.5" style={labelStyle}>WEIGHT UNIT</p>
            {chipRow(
              [{ value: 'kg', label: 'KG' }, { value: 'lbs', label: 'LBS' }],
              settings.weightUnit,
              (weightUnit) => set({ weightUnit }),
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
