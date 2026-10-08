import {
  DEFAULT_DELOAD_SETS_RULE,
  DEFAULT_DELOAD_WEIGHT_RULE,
} from '../../lib/plannerVocabulary.js'
import type {
  DeloadRules,
  DeloadSetsRule,
  DeloadWeightRule,
  DeloadRepsRule,
  DeloadRirRule,
  DeloadRounding,
} from '../../lib/deloadRules'

// Chunk 22 (TASKS.md "src/features/settings/DeloadRulesEditor.tsx" —
// "rules calculator and its editor"; SPEC.md "Deload rules" / "Settings" —
// "default deload rules"). The ONE shared editor for a DeloadRules object
// — the same component mounted twice: Settings' own global-default section
// (SettingsPage.tsx, binding straight to settings.deloadRules) and the
// program override (StepVolume.tsx, which wraps this in its own "USE MY
// DEFAULT / CUSTOM" chooser and only renders this when CUSTOM is picked —
// reviewer's note 7: "a per-program override... (same editor component)").
// This component itself has no notion of which context it's in, no
// "default vs override" distinction of its own — it just edits whatever
// DeloadRules object (or null) it's given, four independent on/off rules.
//
// UI rule (reviewer's note 10): existing components and tokens only. The
// visual language here is Settings' own chip-row/toggle/stepper pattern
// (SettingsPage.tsx's chipRow/toggle closures) — reimplemented locally,
// not imported, matching this codebase's own established convention of
// each file keeping its own copy of a shared visual pattern rather than
// sharing style-helper functions across files (see StepVolume.tsx's
// RestStepper, whose own header comment states this precedent explicitly).
// Every colour is a CSS custom property; nothing hardcoded.

const labelStyle = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  letterSpacing: '0.1em',
} as const

function Toggle({
  value,
  onChange,
  label,
  disabled,
}: {
  value: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm" style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-sans)' }}>
        {label}
      </span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        disabled={disabled}
        className="relative flex-shrink-0"
        style={{ width: 48, height: 28, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}
        aria-label={label}
      >
        <span
          className="absolute inset-0 rounded-full transition-colors duration-200"
          style={{ backgroundColor: value ? 'var(--accent)' : 'var(--surface-raised)', border: `1px solid ${value ? 'transparent' : 'var(--border)'}` }}
        />
        <span
          className="absolute top-1 transition-all duration-200 rounded-full"
          style={{ width: 20, height: 20, left: value ? 24 : 4, backgroundColor: value ? 'var(--base)' : 'var(--text-muted)' }}
        />
      </button>
    </div>
  )
}

function ChipRow<T extends string>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  disabled?: boolean
}) {
  return (
    <div className="flex gap-2">
      {options.map((opt) => {
        const active = value === opt.value
        return (
          <button
            type="button"
            key={opt.value}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            className="flex-1 py-2 rounded-xl text-xs font-bold"
            style={{
              minHeight: 36,
              backgroundColor: active ? 'var(--accent)' : 'var(--surface-raised)',
              color: active ? 'var(--base)' : 'var(--text-muted)',
              border: `1px solid ${active ? 'transparent' : 'var(--border)'}`,
              fontFamily: 'var(--font-mono)',
              letterSpacing: '0.08em',
              opacity: disabled ? 0.6 : 1,
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// A plain +/- numeric stepper — same shape as this app's other stepper
// controls (StepVolume.tsx's RestStepper/the SETS count stepper), its own
// local copy per this file's header comment. `format` lets a caller show
// a unit suffix (e.g. "%", "kg") without this control knowing about units
// itself.
function Stepper({
  value,
  onChange,
  step,
  min,
  max,
  format = (v: number) => String(v),
  disabled,
  label,
}: {
  value: number
  onChange: (v: number) => void
  step: number
  min?: number
  max?: number
  format?: (v: number) => string
  disabled?: boolean
  label?: string
}) {
  function clamp(v: number): number {
    let next = v
    if (min !== undefined) next = Math.max(min, next)
    if (max !== undefined) next = Math.min(max, next)
    return next
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      {label && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', flexShrink: 0 }}>
          {label}
        </span>
      )}
      <div style={{ display: 'inline-flex', alignItems: 'center', height: 30, background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 8 }}>
        <button
          type="button"
          onClick={() => onChange(clamp(value - step))}
          disabled={disabled}
          aria-label={label ? `Decrease ${label}` : 'Decrease'}
          style={{ width: 26, height: 30, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', fontSize: 14, lineHeight: 1 }}
        >
          −
        </button>
        <span style={{ minWidth: 48, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 13, color: 'var(--text-primary)' }}>
          {format(value)}
        </span>
        <button
          type="button"
          onClick={() => onChange(clamp(value + step))}
          disabled={disabled}
          aria-label={label ? `Increase ${label}` : 'Increase'}
          style={{ width: 26, height: 30, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', fontSize: 14, lineHeight: 1 }}
        >
          +
        </button>
      </div>
    </div>
  )
}

const ROUNDING_OPTIONS: { value: DeloadRounding; label: string }[] = [
  { value: 'down', label: 'DOWN' },
  { value: 'up', label: 'UP' },
]

export default function DeloadRulesEditor({
  value,
  onChange,
  disabled = false,
}: {
  value: DeloadRules | null
  onChange: (next: DeloadRules | null) => void
  disabled?: boolean
}) {
  // Each rule key is independently present/absent (TASKS.md: "an absent
  // key means that rule is off"). Writing a new DeloadRules back always
  // canonicalises an all-off result to null, the same "nothing on" value
  // deloadRules.ts's own validateDeloadRules already treats {} as.
  function setRule<K extends keyof DeloadRules>(key: K, rule: DeloadRules[K] | undefined) {
    const next: DeloadRules = { ...(value ?? {}) }
    if (rule === undefined) delete next[key]
    else next[key] = rule
    onChange(Object.keys(next).length === 0 ? null : next)
  }

  const sets = value?.sets
  const weight = value?.weight
  const reps = value?.reps
  const rir = value?.rir

  return (
    <div className="space-y-5">
      {/* Sets — SPEC "Deload rules": "sets: −percentage or −number;
          rounding up or down; minimum 1". Turning it on starts from
          plannerVocabulary.ts's own DEFAULT_DELOAD_SETS_RULE (SPEC: −50%,
          rounding down) — no duplicated literal. */}
      <div>
        <Toggle
          label="Sets"
          value={sets !== undefined}
          disabled={disabled}
          onChange={(on) => setRule('sets', on ? { ...DEFAULT_DELOAD_SETS_RULE } : undefined)}
        />
        {sets && (
          <div className="space-y-2 pt-2">
            <ChipRow
              options={[{ value: 'percent' as const, label: 'PERCENT' }, { value: 'count' as const, label: 'COUNT' }]}
              value={sets.mode}
              disabled={disabled}
              onChange={(mode) => setRule('sets', { ...(sets as DeloadSetsRule), mode })}
            />
            <div className="flex items-center justify-between">
              <Stepper
                label={sets.mode === 'percent' ? 'VALUE (%)' : 'VALUE (SETS)'}
                value={sets.value}
                step={sets.mode === 'percent' ? 5 : 1}
                min={1}
                max={sets.mode === 'percent' ? 99 : 20}
                disabled={disabled}
                onChange={(v) => setRule('sets', { ...(sets as DeloadSetsRule), value: v })}
              />
            </div>
            <p className="text-xs mb-1" style={labelStyle}>ROUNDING</p>
            <ChipRow options={ROUNDING_OPTIONS} value={sets.rounding} disabled={disabled} onChange={(rounding) => setRule('sets', { ...(sets as DeloadSetsRule), rounding })} />
          </div>
        )}
      </div>

      <div style={{ height: 1, backgroundColor: 'var(--border)' }} />

      {/* Weight — "percentage of base; rounding up or down; precision
          step". Turning it on starts from DEFAULT_DELOAD_WEIGHT_RULE,
          which already carries DECISIONS 33's 75% (rounding down, 2.5 kg
          step) — no duplicated literal. */}
      <div>
        <Toggle
          label="Weight"
          value={weight !== undefined}
          disabled={disabled}
          onChange={(on) => setRule('weight', on ? { ...DEFAULT_DELOAD_WEIGHT_RULE } : undefined)}
        />
        {weight && (
          <div className="space-y-2 pt-2">
            <Stepper
              label="PERCENT"
              value={weight.percent}
              step={5}
              min={1}
              max={100}
              format={(v) => `${v}%`}
              disabled={disabled}
              onChange={(v) => setRule('weight', { ...(weight as DeloadWeightRule), percent: v })}
            />
            <p className="text-xs mb-1" style={labelStyle}>ROUNDING</p>
            <ChipRow options={ROUNDING_OPTIONS} value={weight.rounding} disabled={disabled} onChange={(rounding) => setRule('weight', { ...(weight as DeloadWeightRule), rounding })} />
            <div className="flex items-center justify-between pt-1">
              <Stepper
                label="STEP"
                value={weight.step}
                step={0.5}
                min={0.5}
                format={(v) => `${v}`}
                disabled={disabled}
                onChange={(v) => setRule('weight', { ...(weight as DeloadWeightRule), step: v })}
              />
            </div>
            <p className="text-xs mb-1" style={labelStyle}>STEP UNIT</p>
            <ChipRow
              options={[{ value: 'kg' as const, label: 'KG' }, { value: 'lbs' as const, label: 'LBS' }]}
              value={weight.stepUnit}
              disabled={disabled}
              onChange={(stepUnit) => setRule('weight', { ...(weight as DeloadWeightRule), stepUnit })}
            />
          </div>
        )}
      </div>

      <div style={{ height: 1, backgroundColor: 'var(--border)' }} />

      {/* Reps — "±number". No starting value is stated anywhere (SPEC/
          TASKS give only the sets/weight starting values — see
          plannerVocabulary.ts's own header on this exact gap); this
          editor's own judgement call (documented in this chunk's report):
          starts at 0 — a harmless no-op until a real value is picked,
          never a guessed training number. */}
      <div>
        <Toggle
          label="Reps"
          value={reps !== undefined}
          disabled={disabled}
          onChange={(on) => setRule('reps', on ? { delta: 0 } : undefined)}
        />
        {reps && (
          <div className="pt-2">
            <Stepper
              label="DELTA"
              value={reps.delta}
              step={1}
              min={-20}
              max={20}
              format={(v) => (v > 0 ? `+${v}` : String(v))}
              disabled={disabled}
              onChange={(v) => setRule('reps', { ...(reps as DeloadRepsRule), delta: v })}
            />
          </div>
        )}
      </div>

      <div style={{ height: 1, backgroundColor: 'var(--border)' }} />

      {/* RIR — "+number". Same no-stated-default judgement call as reps
          above: starts at 0. */}
      <div>
        <Toggle
          label="RIR"
          value={rir !== undefined}
          disabled={disabled}
          onChange={(on) => setRule('rir', on ? { delta: 0 } : undefined)}
        />
        {rir && (
          <div className="pt-2">
            <Stepper
              label="DELTA"
              value={rir.delta}
              step={1}
              min={-10}
              max={10}
              format={(v) => (v > 0 ? `+${v}` : String(v))}
              disabled={disabled}
              onChange={(v) => setRule('rir', { ...(rir as DeloadRirRule), delta: v })}
            />
          </div>
        )}
      </div>
    </div>
  )
}
