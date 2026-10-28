import { useState, type CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import { CAPTION_STYLE, hairline } from '../../components/pickers/pickerControls'
import { useOnlineStatus } from '../../hooks/useOnlineStatus'
import { resolveEditedWeightKg, toDisplayWeight, toStorageWeight } from '../../lib/weightUnit'
import type { FormRating, SetLog, WeightUnit } from '../../types'
import { FORM_SCALE } from './ratingScales'
import { RowLabel, boxStyle } from './setRowParts'

// Chunk 61 (TASKS-1.2 61; board W2b; SPEC [1.2] "A logged row shows a pen next to its tick (18d). Tapping the row opens its edit panel: the numbers,
// a SET TYPE row, then UNLOG / DELETE and CANCEL / SAVE"): the panel the pen opens in place of the row, which replaces 1.1's inline edit. Weight in
// the unit the set was logged in with "Enter a valid weight." when it isn't a number, reps, RIR and FORM; a warmup has its weight and reps only
// (board "EDITING A WARMUP"). SAVE sends what the inline edit sent: one `updateSetLog` patch with `{ weight, reps, rir, formRating }` (a warmup:
// `{ weight, reps }`), never a note, and an unchanged weight typed again keeps the stored kg (`resolveEditedWeightKg`: 9 kg shows as 19.8 lbs).
//
// Editing a logged set needs a connection (G47: "the edit panel's SAVE ... stay online-only"): offline SAVE is off and the panel says "Requires a
// connection"; nothing is sent. DELETE asks the caller, which asks W9 before it deletes. UNLOG (chunk 63, SPEC 18c: no confirm, and it works offline) calls `onUnlog`;
// with `unlogNote` set the button is disabled and the note says why, under the buttons ("Log its drops first": TASKS 63's words), and left out of the props it is disabled
// and says nothing.
// Chunk 62 (SPEC 19, G47: "A set type change on a logged set ... need[s] a connection"): the SET TYPE row opens the type picker through `onSetType` and, like
// SAVE, is off with no connection (the panel says "Requires a connection" once, under the buttons). A warmup logged with no weight or reps that is made a
// working set asks for both here first (DECISIONS 152 (a)): the caller holds the picked type (`typeText` shows it) and passes `numbersRequired`, so SAVE
// says "Enter weight and reps." and sends nothing until both are typed, then hands them over (`onSave`) to be written with the type in one request.
//
// Display choices no board settles, provisional under D31: the disabled SET TYPE and UNLOG; the message for reps or RIR that isn't a whole number
// ("Enter valid reps." / "Enter a valid RIR."); a working set's empty weight or reps ("Enter weight and reps.": the table refuses a working set
// without them, 035's `v2_set_logs_check`, which is also 62's message for a numberless warmup made a working set); the offline line's place under
// the buttons; a weight is a number when it is digits with at most one "." or ",", as Plan's weight box reads it (board W2b's own example is "52..5").

export interface SetEditChanges {
  weight: number | null
  reps: number | null
  rir: number | null
  formRating: FormRating | null
}

export interface SetEditPanelProps {
  /** The row's number cell ("02", "A2", "↳", "W"). */
  label: string
  log: Pick<SetLog, 'weight' | 'reps' | 'rir' | 'formRating' | 'enteredUnit'>
  /** The exercise's own unit, for a log that records none. */
  resolvedUnit: WeightUnit
  /** A warmup: weight and reps only. */
  isWarmup: boolean
  /** SET TYPE's value ("Normal", "Warmup"); null where the row isn't offered (a drop has no type of its own). */
  typeText: string | null
  onSetType?: () => void
  /** A warmup waiting for the numbers its new type needs (152): SAVE asks for weight and reps as it does for a working set, the box layout stays a warmup's. */
  numbersRequired?: boolean
  onUnlog?: () => void
  /** Words under a disabled UNLOG (a later drop of the set is logged); null or left out when UNLOG is offered. */
  unlogNote?: string | null
  /** SAVE: the patch, in the shape `updateSetLog` takes (a warmup's has no `rir` and no `formRating`). */
  onSave: (changes: SetEditChanges | Pick<SetEditChanges, 'weight' | 'reps'>) => void
  onCancel: () => void
  /** DELETE: the caller asks first (W9). */
  onDelete: () => void
}

const MONO = 'var(--font-mono)'
const WEIGHT_TEXT = /^(\d+([.,]\d*)?|[.,]\d+)$/
const WHOLE_NUMBER = /^\d+$/

const FRAME_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  background: 'var(--surface)',
  ...hairline('var(--accent)'),
  borderRadius: 12,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const BUTTON_STYLE: CSSProperties = {
  height: 44,
  boxSizing: 'border-box',
  borderRadius: 10,
  fontFamily: MONO,
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.15em',
  cursor: 'pointer',
}

export default function SetEditPanel({ label, log, resolvedUnit, isWarmup, typeText, onSetType, numbersRequired = false, onUnlog, unlogNote = null, onSave, onCancel, onDelete }: SetEditPanelProps) {
  const online = useOnlineStatus()
  // The unit this set was logged in (v3 §2.4); a log from before that column reads the exercise's own.
  const unit = log.enteredUnit ?? resolvedUnit
  const [weight, setWeight] = useState(log.weight != null ? String(toDisplayWeight(log.weight, unit)) : '')
  const [reps, setReps] = useState(log.reps != null ? String(log.reps) : '')
  const [rir, setRir] = useState(log.rir != null ? String(log.rir) : '')
  const [form, setForm] = useState<FormRating | null>(log.formRating)
  const [error, setError] = useState<{ field: 'weight' | 'reps' | 'rir' | 'numbers'; text: string } | null>(null)

  function save() {
    if (!online) return
    const weightText = weight.trim()
    const repsText = reps.trim()
    const rirText = rir.trim()
    // A weight is digits with at most one separator: "52..5" is not a number, and parseFloat would have read it as 52.
    if (weightText !== '' && !WEIGHT_TEXT.test(weightText)) return setError({ field: 'weight', text: 'Enter a valid weight.' })
    if (repsText !== '' && !WHOLE_NUMBER.test(repsText)) return setError({ field: 'reps', text: 'Enter valid reps.' })
    if (!isWarmup && rirText !== '' && !WHOLE_NUMBER.test(rirText)) return setError({ field: 'rir', text: 'Enter a valid RIR.' })
    // The table refuses a working set that has no weight or no reps (035's check); a warmup may have neither, unless it is about to become one (152).
    if ((!isWarmup || numbersRequired) && (weightText === '' || repsText === '')) return setError({ field: 'numbers', text: 'Enter weight and reps.' })
    const typed = weightText === '' ? null : parseFloat(weightText.replace(',', '.'))
    // Round-trip drift guard (v3 §2.4): an unchanged displayed value returns the original stored kg exactly. A weight typed where the log had none is
    // in the set's unit and is stored in kg (it was stored as typed, in any unit, before chunk 62 wrote numbers for a numberless warmup).
    const kg = typed === null ? typed : log.weight === null ? toStorageWeight(typed, unit) : resolveEditedWeightKg(log.weight, unit, typed)
    const repsValue = repsText === '' ? null : parseInt(repsText, 10)
    setError(null)
    if (isWarmup) onSave({ weight: kg, reps: repsValue })
    else onSave({ weight: kg, reps: repsValue, rir: rirText === '' ? null : parseInt(rirText, 10), formRating: form })
  }

  const failed = (field: 'weight' | 'reps' | 'rir' | 'numbers') => error?.field === field
  const edited = (setter: (value: string) => void) => (event: { target: { value: string } }) => {
    setter(event.target.value)
    if (error !== null) setError(null)
  }

  return (
    <div style={FRAME_STYLE} data-row-state="editing">
      <div className="flex items-center" style={{ gap: 6 }}>
        <RowLabel text={label} accent width={27} />
        <div className="relative" style={{ flex: '1 1 84px', minWidth: 64 }}>
          <input
            type="text"
            inputMode="decimal"
            aria-label="Weight"
            aria-invalid={failed('weight') || undefined}
            autoFocus
            value={weight}
            onChange={edited(setWeight)}
            className="w-full"
            style={boxStyle({ paddingLeft: 8, paddingRight: 30, fontSize: 16, borderRadius: 10, borderWidth: 2, borderColor: failed('weight') || failed('numbers') ? 'var(--error)' : 'var(--accent)' })}
          />
          <span className="absolute pointer-events-none" style={{ right: 8, bottom: 8, color: failed('weight') ? 'var(--text-muted)' : 'var(--accent)', fontFamily: MONO, fontSize: 10, fontWeight: 700 }}>
            {unit}
          </span>
        </div>
        <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>×</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="Reps"
          aria-invalid={failed('reps') || undefined}
          value={reps}
          onChange={edited(setReps)}
          style={boxStyle({ width: 58, flexShrink: 0, fontSize: 16, borderRadius: 10, borderColor: failed('reps') || failed('numbers') ? 'var(--error)' : 'var(--border-strong)' })}
        />
        {!isWarmup && (
          <label className="flex flex-col items-center justify-center flex-shrink-0" style={boxStyle({ width: 58, paddingTop: 3, borderRadius: 10, borderColor: failed('rir') ? 'var(--error)' : 'var(--border-strong)' })}>
            <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--text-muted)', lineHeight: 1 }}>RIR</span>
            <input
              type="text"
              inputMode="numeric"
              aria-label="RIR"
              aria-invalid={failed('rir') || undefined}
              value={rir}
              onChange={edited(setRir)}
              className="w-full"
              style={{ background: 'transparent', border: 'none', textAlign: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', height: 22, padding: 0 }}
            />
          </label>
        )}
      </div>
      {error !== null && (
        <span role="alert" style={{ marginTop: -4, paddingLeft: 33, fontSize: 12, color: 'var(--error)' }}>
          {error.text}
        </span>
      )}

      {!isWarmup && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={CAPTION_STYLE}>FORM</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {FORM_SCALE.values.map((value) => {
              const on = form === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setForm(on ? null : value)}
                  style={{
                    height: 40,
                    padding: '0 10px',
                    borderRadius: 8,
                    ...hairline(on ? 'var(--accent)' : 'var(--border)'),
                    background: on ? 'var(--accent-muted)' : 'var(--surface)',
                    color: on ? 'var(--accent)' : 'var(--text-secondary)',
                    fontFamily: MONO,
                    fontWeight: 600,
                    fontSize: 10,
                    letterSpacing: '0.1em',
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

      {typeText !== null && (
        <button
          type="button"
          onClick={onSetType}
          disabled={onSetType === undefined || !online}
          aria-disabled={onSetType === undefined || !online || undefined}
          style={{
            boxSizing: 'border-box',
            width: '100%',
            minHeight: 44,
            padding: '0 12px',
            borderRadius: 10,
            ...hairline('var(--border)'),
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            opacity: onSetType === undefined || !online ? 0.5 : 1,
            cursor: onSetType === undefined || !online ? 'default' : 'pointer',
          }}
        >
          <span style={CAPTION_STYLE}>SET TYPE</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
            {typeText}
            <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--text-muted)' }} />
          </span>
        </button>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        <button
          type="button"
          onClick={onUnlog}
          disabled={onUnlog === undefined || unlogNote !== null}
          style={{ ...BUTTON_STYLE, ...hairline('var(--border-strong)'), background: 'var(--surface)', color: 'var(--text-primary)', opacity: onUnlog === undefined || unlogNote !== null ? 0.5 : 1, cursor: onUnlog === undefined || unlogNote !== null ? 'default' : 'pointer' }}
        >
          UNLOG
        </button>
        <button type="button" onClick={onDelete} style={{ ...BUTTON_STYLE, borderWidth: 0, background: 'color-mix(in srgb, var(--error) 15%, transparent)', color: 'var(--error)' }}>
          DELETE
        </button>
        <button type="button" onClick={onCancel} style={{ ...BUTTON_STYLE, ...hairline('var(--border-strong)'), background: 'var(--surface)', color: 'var(--text-primary)' }}>
          CANCEL
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!online}
          style={{ ...BUTTON_STYLE, borderWidth: 0, fontWeight: 700, background: 'var(--accent)', color: 'var(--on-accent)', opacity: online ? 1 : 0.5, cursor: online ? 'pointer' : 'default' }}
        >
          SAVE
        </button>
      </div>
      {unlogNote !== null && (
        <span role="status" data-unlog-note style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
          {unlogNote}
        </span>
      )}
      {!online && (
        <span role="status" style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
          Requires a connection
        </span>
      )}
    </div>
  )
}
