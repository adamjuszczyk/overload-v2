import type { CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import BottomSheet from '../../components/BottomSheet'
import { CAPTION_STYLE, hairline } from '../../components/pickers/pickerControls'
import type { FormRating, WeightUnit } from '../../types'
import { FORM_SCALE } from './ratingScales'

// Chunk 61 (TASKS-1.2 61; boards W7 and W8; SPEC [1.2] "The set's ⋯ during a workout (C9)": "SET TYPE, CUES, FORM, a per-set unit override, SKIP
// THIS SET and DELETE (W7). FORM and SKIP THIS SET are today's, unchanged."): the ⋯ of an open row. "LAT PULLDOWN · SET 03" over "Set options", then
// SET TYPE ("Dropset · 1 drop") and CUES ("Push here"), FORM as four chips, "Log this set in lbs" with its switch, SKIP THIS SET and DELETE SET.
// A drop's sheet (W8) has FORM, the lbs row and DELETE SET only. A skipped set's ⋯ is DELETE SET alone (closing F4's "can't delete a skipped
// set"): its numbers are nobody's to choose any more.
//
// It writes nothing. FORM and the unit are the row's own state until LOG (the row sends them with the set, as it always did): the sheet shows
// them and says when they change. A row is drawn only when the caller offers it: no CUES row for a set with no planned set (DECISIONS 165 (a),
// and none for a drop); no SKIP on a drop (today's rule); none of FORM, the unit or SKIP on a skipped set. The SET TYPE row is chunk 62's to wire
// (`onSetType`): until it is passed the row is drawn as the board draws it and does nothing (a disabled row), so 62 passes its handler and
// nothing else here changes.
//
// Display choices no board settles, provisional under D31: the SET TYPE row without its handler is drawn dimmed and disabled; the eyebrow of a
// drop in a superset and of a warmup; a skipped set's sheet; the FORM chip is pressed again to clear it, as `RatingChips` does everywhere.

export interface SetOptionsSheetProps {
  /** `LAT PULLDOWN · SET 03` (`optionsEyebrow`). */
  eyebrow: string
  /** The SET TYPE row's value ("Dropset · 1 drop"); null where the row isn't offered (a drop, a skipped set). */
  typeText: string | null
  /** Left out, the SET TYPE row is drawn and does nothing (chunk 62 passes it). */
  onSetType?: () => void
  /** The CUES row's value (the set's cues joined, "" for none); null where the row isn't offered. */
  cuesText: string | null
  onCues: () => void
  /** FORM; null where it isn't offered (a skipped set). */
  form: { value: FormRating | null; onChange: (value: FormRating | null) => void } | null
  /** "Log this set in lbs": the exercise's own unit, and the unit this set will be logged in; null where it isn't offered. */
  unit: { resolved: WeightUnit; active: WeightUnit; onChange: (unit: WeightUnit | null) => void } | null
  /** SKIP THIS SET; null where it isn't offered (a drop, a skipped set). */
  onSkip: (() => void) | null
  /** DELETE SET; null for a row nobody can delete (the drop ADD STAGE draws until chunk 62 removes it). */
  onDelete: (() => void) | null
  onClose: () => void
}

const MONO = 'var(--font-mono)'

const ROW_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 52,
  padding: '0 12px',
  borderRadius: 10,
  ...hairline('var(--border)'),
  background: 'var(--surface)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  textAlign: 'left',
  cursor: 'pointer',
}

const ROW_VALUE_STYLE: CSSProperties = {
  minWidth: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: 'var(--font-display)',
  fontWeight: 700,
  fontSize: 15,
  color: 'var(--text-primary)',
  overflowWrap: 'anywhere',
}

const FORM_GRID_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }

const UNIT_ROW_STYLE: CSSProperties = {
  minHeight: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  borderWidth: '1px 0',
  borderStyle: 'solid',
  borderColor: 'var(--border-subtle)',
}

const SKIP_STYLE: CSSProperties = {
  height: 52,
  boxSizing: 'border-box',
  borderRadius: 10,
  ...hairline('var(--border-strong)'),
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  fontFamily: MONO,
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.2em',
  cursor: 'pointer',
}

const DELETE_STYLE: CSSProperties = {
  height: 52,
  boxSizing: 'border-box',
  borderRadius: 10,
  borderWidth: 0,
  background: 'color-mix(in srgb, var(--error) 15%, transparent)',
  color: 'var(--error)',
  fontFamily: MONO,
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: '0.2em',
  cursor: 'pointer',
}

function ValueRow({ label, value, onPress, disabled = false }: { label: string; value: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      style={{ ...ROW_STYLE, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'default' : 'pointer' }}
    >
      <span style={CAPTION_STYLE}>{label}</span>
      <span style={ROW_VALUE_STYLE}>
        {value}
        <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--text-muted)' }} />
      </span>
    </button>
  )
}

export default function SetOptionsSheet({ eyebrow, typeText, onSetType, cuesText, onCues, form, unit, onSkip, onDelete, onClose }: SetOptionsSheetProps) {
  const otherUnit: WeightUnit | null = unit === null ? null : unit.resolved === 'kg' ? 'lbs' : 'kg'
  const unitOn = unit !== null && unit.active !== unit.resolved
  const hasLinks = typeText !== null || cuesText !== null
  return (
    <BottomSheet eyebrow={eyebrow} title="Set options" onClose={onClose}>
      {hasLinks && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {typeText !== null && <ValueRow label="SET TYPE" value={typeText} onPress={onSetType} disabled={onSetType === undefined} />}
          {cuesText !== null && <ValueRow label="CUES" value={cuesText} onPress={onCues} />}
        </div>
      )}

      {form !== null && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={CAPTION_STYLE}>FORM</span>
          <div style={FORM_GRID_STYLE}>
            {FORM_SCALE.values.map((value) => {
              const on = form.value === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => form.onChange(on ? null : value)}
                  style={{
                    height: 44,
                    boxSizing: 'border-box',
                    borderRadius: 10,
                    ...hairline(on ? 'var(--accent)' : 'var(--border)'),
                    background: on ? 'var(--accent-muted)' : 'var(--surface)',
                    color: on ? 'var(--accent)' : 'var(--text-secondary)',
                    fontFamily: MONO,
                    fontWeight: 600,
                    fontSize: 10,
                    letterSpacing: '0.12em',
                    cursor: 'pointer',
                  }}
                >
                  {FORM_SCALE.labels[value]}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {unit !== null && otherUnit !== null && (
        <div style={UNIT_ROW_STYLE}>
          <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text-primary)' }}>{`Log this set in ${otherUnit}`}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{`This exercise is in ${unit.resolved}.`}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={unitOn}
            aria-label={`Log this set in ${otherUnit}`}
            onClick={() => unit.onChange(unitOn ? null : otherUnit)}
            style={{
              position: 'relative',
              flex: '0 0 auto',
              width: 48,
              height: 28,
              borderRadius: 14,
              padding: 0,
              ...hairline(unitOn ? 'var(--accent)' : 'var(--border-strong)'),
              background: unitOn ? 'var(--accent)' : 'var(--surface-raised)',
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                position: 'absolute',
                top: 3,
                left: unitOn ? 23 : 3,
                width: 20,
                height: 20,
                borderRadius: 10,
                background: unitOn ? 'var(--on-accent)' : 'var(--text-muted)',
              }}
            />
          </button>
        </div>
      )}

      {onSkip !== null && (
        <button type="button" onClick={onSkip} style={SKIP_STYLE}>
          SKIP THIS SET
        </button>
      )}
      {onDelete !== null && (
        <button type="button" onClick={onDelete} style={DELETE_STYLE}>
          DELETE SET
        </button>
      )}
    </BottomSheet>
  )
}
