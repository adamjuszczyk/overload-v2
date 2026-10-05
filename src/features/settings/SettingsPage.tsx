import { useState } from 'react'
import { format, parseISO } from 'date-fns'
import { useSettings, useUpdateSettings } from './useSettings'
import { useAuth } from '../auth/useAuth'
import type { UserSettings } from '../../types'

const ACCENT_SWATCHES: { colour: string; label: string }[] = [
  { colour: '#FF8C42', label: 'ORANGE' },
  { colour: '#3B82F6', label: 'BLUE'   },
  { colour: '#22C55E', label: 'GREEN'  },
  { colour: '#EC4899', label: 'PINK'   },
  { colour: '#8B5CF6', label: 'PURPLE' },
  { colour: '#EF4444', label: 'RED'    },
  // v3 §11 — additional accent options.
  { colour: '#FACC15', label: 'YELLOW' },
  { colour: '#84CC16', label: 'LIME'   },
  { colour: '#14B8A6', label: 'TEAL'   },
  { colour: '#06B6D4', label: 'CYAN'   },
  { colour: '#6366F1', label: 'INDIGO' },
  { colour: '#F43F5E', label: 'ROSE'   },
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
  const { signOut } = useAuth()

  const [restInput, setRestInput] = useState('')
  const [restEditing, setRestEditing] = useState(false)
  const [autoFinishInput, setAutoFinishInput] = useState('')
  const [autoFinishEditing, setAutoFinishEditing] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    await signOut()
  }

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
              // Found by adversarial review, same class of bug as the
              // accent swatches: padding + text-only height landed at 42px,
              // 2px under this app's 44px touch-target convention.
              minHeight: 44,
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
              {/* Grid, not flex-wrap: a fixed column count keeps every row's
                  buttons the same size, including a partial trailing row —
                  flex-wrap's flex-1 items stretch to fill a short last row,
                  which produced two oversized pill-shaped swatches on
                  common phone widths once this list grew past what fits
                  one row (found via adversarial review, live-rendered,
                  Phase 3.8). Separately (post-launch fix, 2026-08-10,
                  confirmed via real bounding-box measurements at 375px and
                  320px): every swatch was rendering only 24px tall — `py-3`
                  padding with no content to give it height, versus the
                  44px minimum touch target every other tappable control in
                  this app uses — with only an 8px gap between rows. All 12
                  render, are correctly positioned, and are individually
                  hit-testable at their own center, so this is a distinct
                  issue from Phase 3.8's wrapping bug, not a regression of
                  it: too small/close together to tap reliably with a real
                  finger, not literally broken. minHeight below brings every
                  swatch to this app's standard 44px. */}
              <div className="grid grid-cols-4 gap-2">
                {ACCENT_SWATCHES.map(({ colour, label }) => (
                  <button
                    key={colour}
                    onClick={() => set({ accentColour: colour })}
                    aria-label={label}
                    className="rounded-xl"
                    style={{
                      minHeight: 44,
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

        {/* ── Set Timing ───────────────────────────────────────────────── */}
        <section>
          {sectionTitle('SET TIMING')}
          <div className="rounded-xl p-4" style={cardStyle}>
            {toggle(settings.measureSetTime, (v) => set({ measureSetTime: v }), 'Measure set time')}
          </div>
        </section>

        {/* ── Auto-finish ──────────────────────────────────────────────── */}
        <section>
          {sectionTitle('AUTO-FINISH SESSION')}
          <div className="rounded-xl p-4 space-y-4" style={cardStyle}>
            {toggle(
              settings.autoFinishMinutes !== null,
              (v) => set({ autoFinishMinutes: v ? 5 : null }),
              'Auto-finish session',
            )}

            {settings.autoFinishMinutes !== null && (
              <>
                <div
                  style={{ height: 1, backgroundColor: 'var(--border)' }}
                />

                <div>
                  <p className="text-xs mb-2" style={labelStyle}>AFTER X MINUTES OF INACTIVITY</p>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={autoFinishEditing ? autoFinishInput : String(settings.autoFinishMinutes)}
                    onFocus={() => {
                      setAutoFinishEditing(true)
                      setAutoFinishInput(String(settings.autoFinishMinutes))
                    }}
                    onChange={(e) => setAutoFinishInput(e.target.value)}
                    onBlur={() => {
                      setAutoFinishEditing(false)
                      const n = parseInt(autoFinishInput, 10)
                      if (!Number.isNaN(n)) set({ autoFinishMinutes: Math.min(60, Math.max(1, n)) })
                    }}
                    className="w-24 px-3 py-3 rounded-xl text-sm font-bold text-center"
                    style={{
                      backgroundColor: 'var(--surface-raised)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                      fontFamily: 'var(--font-mono)',
                    }}
                  />
                </div>
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

        {/* ── Planning ─────────────────────────────────────────────────── */}
        {/* v2_user_settings.week_start (chunk 8, SPEC "Weeks and copying")
            — a week-dependent run's weeks beyond week 1 either copy the
            last planned week automatically (the default) or start empty,
            left for "Copy last week" to fill in by hand. No effect on a
            stable program, which always re-derives its volume from the
            run's own copy. */}
        <section>
          {sectionTitle('PLANNING')}
          <div className="rounded-xl p-4" style={cardStyle}>
            <p className="text-xs mb-2.5" style={labelStyle}>NEW WEEK STARTS</p>
            {chipRow(
              [{ value: 'copy', label: 'COPY' }, { value: 'empty', label: 'EMPTY' }],
              settings.weekStart,
              (weekStart) => set({ weekStart }),
            )}
          </div>
        </section>

        {/* ── Account ──────────────────────────────────────────────────── */}
        <section>
          {sectionTitle('ACCOUNT')}
          <div className="rounded-xl p-4" style={cardStyle}>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full py-3 rounded-xl text-xs font-bold"
              style={{
                // Found by adversarial review — ~40px without this (no
                // border here, unlike chipRow, so even further under the
                // 44px convention).
                minHeight: 44,
                backgroundColor: 'rgba(248, 113, 113, 0.1)',
                color: 'var(--error)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.08em',
                opacity: signingOut ? 0.6 : 1,
              }}
            >
              {signingOut ? 'SIGNING OUT…' : 'SIGN OUT'}
            </button>
          </div>
        </section>

        {/* ── About ────────────────────────────────────────────────────── */}
        {/* Which build is actually running, for support/debugging — and,
            not incidentally, the concrete artifact that let the PWA
            update-detection fix (see usePwaUpdate.ts) be live-verified
            against two real, distinguishable production deploys instead of
            two byte-identical ones (comments alone don't survive
            minification — confirmed empirically before adding this). */}
        <section>
          {sectionTitle('ABOUT')}
          <div className="rounded-xl p-4" style={cardStyle}>
            <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              BUILD {__BUILD_HASH__} · {format(parseISO(__BUILD_TIME__), 'MMM d, yyyy HH:mm')}
            </p>
          </div>
        </section>
      </div>
    </div>
  )
}
