import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Ellipsis, Tag } from 'lucide-react'
import type { WeekPlanSet, WeightUnit } from '../../types'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { toDisplayWeight, toStorageWeight, resolveEditedWeightKg } from '../../lib/weightUnit'
import { columnsToRepTarget, formatRepTarget } from '../../lib/plannerVocabulary.js'
import { cueLabel, rirTargetFromColumns, type RirTarget } from '../../components/pickers/pickerLogic'
import { CHANGED_CELL } from './WeekDiffMarks'

// One set row of Plan's week view (TASKS-1.2 chunk 54a; SPEC Screens → Plan screen; boards 1, 1a and 9). A head or a stage row: its number (`01`,
// `W` for a warmup, `↳` for a stage), the weight typed in the exercise's unit, `×`, the reps (opens the rep target picker), the RIR (opens
// the RIR target picker; a warmup has none: G49) and a ⋯ that opens the set type picker; a stage row has no ⋯ (G55: the head's stepper
// changes how many). Over a staged head, its kind chip (`DROPSET · 1 DROP`); under the row, the set's cues as chips (a head's only).
//
// It writes nothing and holds no sheet: the card (PlanExerciseCard.tsx) opens the pickers and writes what they return. The one thing the
// row does itself is the weight: tap the box and type, blank clears it, "Enter a valid weight" for anything that isn't a number (nothing
// is written then), and an unchanged value writes nothing (1.1's WeightTargetEditor, kept: kg stored, the exercise's unit shown).
//
// `readOnly` (a past week, a session that is done) draws the same numbers in cells that can't be pressed, with no ⋯. `marks` (the old
// week-diff marks, chunk 31; 54b replaces them) turns a cell the accent through the same CHANGED_CELL style until then.
//
// Layout: the board's cells at 44 px, which at 375 px are a few pixels wider than the card, so each cell gives up width (flex-shrink, a
// least width of 0) before anything wraps or leaves the row. The weight box is an input at 16 px while it is typed in, so iOS doesn't
// zoom the page (as the sheets' inputs are); the board draws 15 px.

export interface PlanSetRowMarks {
  number?: boolean
  weight?: boolean
  reps?: boolean
  rir?: boolean
}

export interface PlanSetRowProps {
  /** The head or the stage row it draws. */
  set: WeekPlanSet
  /** `01`, `W`, or `↳` on a stage. */
  label: string
  isStage: boolean
  /** The unit override of the exercise (null: the Settings unit). */
  weightUnit: WeightUnit | null | undefined
  readOnly: boolean
  marks?: PlanSetRowMarks
  /** Over a staged head: `DROPSET · 1 DROP`. Opens the same picker the ⋯ does (board 1 draws it as a link to it). */
  kindChip?: string
  /** What the ⋯ is called: `set 02`, `warmup set 1`. */
  optionsLabel?: string
  onWeight: (kg: number | null) => void
  onReps: () => void
  onRir: () => void
  /** The ⋯ and the kind chip. A stage row has neither (G55), so it is given none. */
  onOptions?: () => void
}

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }

const CELL_HEIGHT = 44

const CELL: CSSProperties = {
  height: CELL_HEIGHT,
  boxSizing: 'border-box',
  minWidth: 0,
  padding: 0,
  borderRadius: 10,
  border: '1px solid var(--border)',
  background: 'var(--surface)',
  color: 'var(--text-primary)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...MONO,
}

const WEIGHT_SLOT: CSSProperties = { flex: '0 1 80px', minWidth: 0 }
const REPS_SLOT: CSSProperties = { flex: '0 1 72px', minWidth: 0 }
const RIR_SLOT: CSSProperties = { flex: '0 1 80px', minWidth: 0 }

const DASH: CSSProperties = { color: 'var(--text-dim)' }

// A warmup row's cells are the quieter ones (board 1).
function cellStyle(slot: CSSProperties, warmup: boolean, changed: boolean, readOnly: boolean): CSSProperties {
  return {
    ...CELL,
    ...slot,
    cursor: readOnly ? 'default' : 'pointer',
    ...(warmup ? { background: 'var(--surface-raised)', color: 'var(--text-secondary)' } : {}),
    ...(changed ? CHANGED_CELL : {}),
  }
}

const rirText = (target: RirTarget): string => {
  switch (target.kind) {
    case 'none':
      return '–'
    case 'number':
      return String(target.value)
    case 'range':
      return `${target.min}–${target.max}`
  }
}

function WeightCell({
  valueKg,
  unit,
  warmup,
  readOnly,
  changed,
  error,
  onError,
  onChange,
}: {
  valueKg: number | null
  unit: WeightUnit
  warmup: boolean
  readOnly: boolean
  changed: boolean
  error: boolean
  onError: (error: boolean) => void
  onChange: (kg: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    if (readOnly) return
    setText(valueKg != null ? String(toDisplayWeight(valueKg, unit)) : '')
    onError(false)
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    if (trimmed === '') {
      setEditing(false)
      onError(false)
      if (valueKg !== null) onChange(null)
      return
    }
    // A number is digits with at most one decimal separator (a comma is one, as a phone's keypad types it): "5o" is not a number (board 9's own
    // example), where parseFloat would have read it as 5, and neither is a minus, an exponent or a second point.
    if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed)) {
      // Refused inline, nothing written; the raw text stays (board 9: "WEIGHT · NOT A NUMBER").
      onError(true)
      return
    }
    const parsed = parseFloat(trimmed.replace(',', '.'))
    setEditing(false)
    onError(false)
    // The round-trip guard only applies once there is a stored value to compare the re-displayed figure with (weightUnit.ts).
    const kg = valueKg === null ? toStorageWeight(parsed, unit) : resolveEditedWeightKg(valueKg, unit, parsed)
    if (kg !== valueKg) onChange(kg)
  }

  if (editing) {
    return (
      <div
        style={{
          ...CELL,
          ...WEIGHT_SLOT,
          border: `2px solid ${error ? 'var(--error)' : 'var(--accent)'}`,
          gap: 3,
          padding: '0 6px',
          justifyContent: 'center',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            if (error) onError(false)
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') inputRef.current?.blur()
          }}
          placeholder="0"
          aria-label="Weight target"
          style={{ flex: '1 1 0%', minWidth: 0, width: '100%', height: '100%', padding: 0, border: 'none', background: 'transparent', outline: 'none', textAlign: 'center', fontSize: 16, color: 'var(--text-primary)', ...MONO }}
        />
        <span style={{ flex: '0 0 auto', fontSize: 10, fontWeight: 500, color: 'var(--text-muted)' }}>{unit}</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      disabled={readOnly}
      data-diff={changed ? 'changed' : undefined}
      style={{ ...cellStyle(WEIGHT_SLOT, warmup, changed, readOnly), gap: 3, fontSize: 15 }}
    >
      {valueKg != null ? (
        <>
          {toDisplayWeight(valueKg, unit)}
          <span style={{ fontSize: 10, fontWeight: 500, color: changed ? 'var(--accent)' : 'var(--text-muted)' }}>{unit}</span>
        </>
      ) : (
        <span style={DASH}>—</span>
      )}
    </button>
  )
}

export default function PlanSetRow({ set, label, isStage, weightUnit, readOnly, marks, kindChip, optionsLabel, onWeight, onReps, onRir, onOptions }: PlanSetRowProps) {
  const { unit } = useWeightDisplay(weightUnit)
  const [weightError, setWeightError] = useState(false)
  const warmup = set.isWarmup
  const reps = columnsToRepTarget({ repMin: set.repMin ?? null, repMax: set.repMax ?? null, isAmrap: set.isAmrap ?? false })
  const rir = rirTargetFromColumns(set.targetRir, set.targetRirMax)
  const cues = isStage ? [] : (set.tags ?? [])

  return (
    <div data-diff={marks?.number ? 'added' : undefined} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {kindChip && !isStage && onOptions && (
        <div style={{ paddingLeft: 31 }}>
          <button
            type="button"
            onClick={onOptions}
            disabled={readOnly}
            style={{
              ...MONO,
              fontSize: 9,
              letterSpacing: '0.15em',
              padding: '3px 6px',
              borderRadius: 6,
              border: '1px solid var(--border)',
              background: 'var(--surface-raised)',
              color: 'var(--text-secondary)',
              cursor: readOnly ? 'default' : 'pointer',
            }}
          >
            {kindChip}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 5, paddingLeft: isStage ? 14 : 0 }}>
        <span style={{ ...MONO, flex: '0 0 26px', width: 26, fontWeight: 700, fontSize: 13, color: marks?.number ? 'var(--accent)' : isStage || warmup ? 'var(--text-dim)' : 'var(--text-muted)' }}>{label}</span>

        <WeightCell valueKg={set.targetWeight ?? null} unit={unit} warmup={warmup} readOnly={readOnly} changed={!!marks?.weight} error={weightError} onError={setWeightError} onChange={onWeight} />

        <span aria-hidden="true" style={{ flex: '0 0 10px', width: 10, textAlign: 'center', fontSize: 11, color: 'var(--text-dim)' }}>
          ×
        </span>

        <button
          type="button"
          onClick={onReps}
          disabled={readOnly}
          aria-label={reps.type === 'none' ? 'Set rep target' : undefined}
          data-diff={marks?.reps ? 'changed' : undefined}
          style={{ ...cellStyle(REPS_SLOT, warmup, !!marks?.reps, readOnly), fontSize: 14 }}
        >
          {reps.type === 'none' ? <span style={DASH}>—</span> : formatRepTarget(reps)}
        </button>

        {warmup ? (
          <div aria-hidden="true" style={RIR_SLOT} />
        ) : (
          <button
            type="button"
            onClick={onRir}
            disabled={readOnly}
            data-diff={marks?.rir ? 'changed' : undefined}
            style={{
              ...cellStyle(RIR_SLOT, false, !!marks?.rir, readOnly),
              background: marks?.rir ? 'var(--accent-muted)' : 'var(--surface-raised)',
              gap: 4,
              fontSize: 13,
            }}
          >
            <span style={{ fontSize: 9, letterSpacing: '0.1em', color: marks?.rir ? 'var(--accent)' : 'var(--text-muted)' }}>RIR</span>{' '}
            <span style={rir.kind === 'none' ? DASH : undefined}>{rirText(rir)}</span>
          </button>
        )}

        {isStage || readOnly || !onOptions ? (
          <span aria-hidden="true" style={{ flex: '0 0 24px', width: 24 }} />
        ) : (
          <button
            type="button"
            onClick={onOptions}
            aria-label={`Options for ${optionsLabel ?? 'set'}`}
            style={{ flex: '0 0 24px', width: 24, height: CELL_HEIGHT, padding: 0, border: 'none', background: 'transparent', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
          >
            <Ellipsis size={16} aria-hidden="true" />
          </button>
        )}
      </div>

      {weightError && (
        <span role="alert" style={{ paddingLeft: 31, fontSize: 12, color: 'var(--error)' }}>
          Enter a valid weight
        </span>
      )}

      {cues.length > 0 && (
        <div style={{ paddingLeft: 31, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {cues.map((cue) => (
            <span
              key={cue}
              style={{ ...MONO, display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, fontSize: 10, fontWeight: 400, padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface-raised)', color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}
            >
              <Tag size={11} strokeWidth={2.2} aria-hidden="true" style={{ flex: '0 0 auto' }} />
              {cueLabel(cue)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
