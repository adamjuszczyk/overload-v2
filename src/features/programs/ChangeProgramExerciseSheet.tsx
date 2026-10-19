import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import BottomSheet from '../../components/BottomSheet'
import { StepperPill, hairline } from '../../components/pickers/pickerControls'
import { REST_MAX_SECONDS, formatRestClock, stepRest } from '../../components/pickers/pickerLogic'
import { normaliseTempo } from '../../lib/plannerVocabulary.js'
import type { WeightUnit } from '../../types'

// Chunk 51a (TASKS-1.2; boards PL2 "Exercise ⋯: rest, tempo, unit", PL3 "Superset member ⋯", PL9 "Warmup routine and rest states"):
// the sheet behind an exercise's ⋯ in CHANGE THE PROGRAM. REST, REST AFTER, TEMPO and UNIT (DEFAULT / KG / LBS) are the exercise's
// own and run-wide; a superset member's sheet adds WITHIN ROUND and AFTER ROUND, which belong to the whole superset (PL3's note
// says so, and names the other members). SPEC's known gap between PL3 and the rules: the member's own REST and REST AFTER stay in
// its sheet, above those two (Design boards [1.2]).
//
// It writes nothing. Each control asks its callback for the next value and the caller (the screen's draft) keeps it; the sheet
// is mounted to open it and unmounted to close it (BottomSheet's contract), and is mounted outside clickable parents.
//
// Not on the boards, so provisional under D31: MOVE UP / MOVE DOWN at the foot of the sheet, TASKS 51a's "⋯ fallback" for the drag
// that reorders the list; the tempo box is a text field (16 px, so iOS doesn't zoom) that writes every valid value at once and
// shows PL9's refusal ("Use 4 fields, e.g. 3-1-1-0 (X allowed)") for a half-typed one, keeping the last valid value in the draft.

export interface ExerciseSheetMember {
  /** `A`: the superset's letter (SUPERSET A). */
  blockLetter: string
  /** The other members' names, for "so they change it for Seated Cable Row too". */
  otherNames: string[]
  withinRoundSeconds: number | null
  afterRoundSeconds: number | null
  onWithinRoundChange: (seconds: number | null) => void
  onAfterRoundChange: (seconds: number | null) => void
}

export interface ChangeProgramExerciseSheetProps {
  workoutName: string
  exerciseName: string
  /** `week` or `cycle`, for "Changes start in week 2." */
  unitWord: 'week' | 'cycle'
  startWeek: number
  restSeconds: number | null
  restAfterSeconds: number | null
  tempo: string | null
  weightUnit: WeightUnit | null
  member?: ExerciseSheetMember
  onRestChange: (seconds: number | null) => void
  onRestAfterChange: (seconds: number | null) => void
  onTempoChange: (tempo: string | null) => void
  onUnitChange: (unit: WeightUnit | null) => void
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onClose: () => void
}

export const TEMPO_REFUSAL = 'Use 4 fields, e.g. 3-1-1-0 (X allowed)'

const ROW_STYLE: CSSProperties = {
  minHeight: 56,
  boxSizing: 'border-box',
  borderWidth: '0 0 1px',
  borderStyle: 'solid',
  borderColor: 'var(--border-subtle)',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '4px 2px',
}

const ROW_LABEL_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: 'var(--text-secondary)',
}

const NOTE_STYLE: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={ROW_STYLE}>
      <span style={ROW_LABEL_STYLE}>{label}</span>
      {children}
    </div>
  )
}

function RestPill({
  label,
  value,
  emptyText,
  onChange,
}: {
  label: string
  value: number | null
  emptyText: string
  onChange: (seconds: number | null) => void
}) {
  return (
    <StepperPill
      lessLabel={`${label}: less`}
      moreLabel={`${label}: more`}
      onLess={() => onChange(stepRest(value, -1))}
      onMore={() => onChange(stepRest(value, 1))}
      lessDisabled={value === null}
      moreDisabled={value !== null && value >= REST_MAX_SECONDS}
      valueText={value === null ? emptyText : formatRestClock(value)}
      valueStyle={{ width: 84, fontSize: 13, color: value === null ? 'var(--text-muted)' : 'var(--text-primary)' }}
    />
  )
}

function TempoRow({ value, onChange }: { value: string | null; onChange: (tempo: string | null) => void }) {
  // The text is the box's own until it is valid: the draft only ever holds a tempo `planProgramChange` would take.
  const [text, setText] = useState(value ?? '')
  const [invalid, setInvalid] = useState(false)
  function type(next: string) {
    setText(next)
    if (next.trim() === '') {
      setInvalid(false)
      onChange(null)
      return
    }
    const tempo = normaliseTempo(next)
    setInvalid(tempo === null)
    if (tempo !== null) onChange(tempo)
  }
  return (
    <div style={{ ...ROW_STYLE, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'center', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={ROW_LABEL_STYLE}>TEMPO</span>
        <input
          aria-label="Tempo"
          aria-invalid={invalid}
          value={text}
          placeholder="—"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          onChange={(e) => type(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          style={{
            flex: '0 0 auto',
            width: 166,
            height: 44,
            boxSizing: 'border-box',
            borderRadius: 10,
            ...hairline(invalid ? 'var(--error)' : 'var(--border)'),
            borderWidth: invalid ? 2 : 1,
            background: 'var(--surface)',
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            // 16 px: iOS zooms into a smaller field on focus (chunk 40's choice for every input in a sheet).
            fontSize: 16,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
      </div>
      {invalid && (
        <span role="alert" style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--error)', textAlign: 'right' }}>
          {TEMPO_REFUSAL}
        </span>
      )}
    </div>
  )
}

const UNIT_OPTIONS: ReadonlyArray<{ value: WeightUnit | null; label: string }> = [
  { value: null, label: 'DEFAULT' },
  { value: 'kg', label: 'KG' },
  { value: 'lbs', label: 'LBS' },
]

function UnitRow({ value, onChange }: { value: WeightUnit | null; onChange: (unit: WeightUnit | null) => void }) {
  return (
    <Row label="UNIT">
      <div role="group" aria-label="Unit" style={{ flex: '0 0 auto', display: 'flex', ...hairline('var(--border)'), borderRadius: 10, overflow: 'hidden' }}>
        {UNIT_OPTIONS.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.label}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(o.value)}
              style={{
                height: 42,
                padding: '0 10px',
                borderWidth: 0,
                background: on ? 'var(--accent)' : 'var(--surface)',
                color: on ? 'var(--on-accent)' : 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                fontWeight: 600,
                fontSize: 10,
                letterSpacing: '0.15em',
                cursor: 'pointer',
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </Row>
  )
}

function orderButton(disabled: boolean): CSSProperties {
  return {
    height: 44,
    boxSizing: 'border-box',
    borderRadius: 10,
    ...hairline('var(--border)'),
    background: 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    fontSize: 10,
    letterSpacing: '0.15em',
    color: disabled ? 'var(--text-dim)' : 'var(--text-primary)',
    cursor: disabled ? 'default' : 'pointer',
  }
}

function andList(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export default function ChangeProgramExerciseSheet(p: ChangeProgramExerciseSheetProps) {
  const start = `Changes start in ${p.unitWord} ${p.startWeek}.`
  const eyebrow = p.member ? `${p.workoutName.toUpperCase()} · SUPERSET ${p.member.blockLetter}` : p.workoutName.toUpperCase()
  return (
    <BottomSheet eyebrow={eyebrow} title={p.exerciseName} onClose={p.onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', borderWidth: '1px 0 0', borderStyle: 'solid', borderColor: 'var(--border-subtle)' }}>
          <Row label="REST">
            <RestPill label="Rest" value={p.restSeconds} emptyText="GLOBAL" onChange={p.onRestChange} />
          </Row>
          <Row label="REST AFTER">
            <RestPill label="Rest after" value={p.restAfterSeconds} emptyText="NONE" onChange={p.onRestAfterChange} />
          </Row>
          <TempoRow value={p.tempo} onChange={p.onTempoChange} />
          <UnitRow value={p.weightUnit} onChange={p.onUnitChange} />
          {p.member && (
            <>
              <Row label="WITHIN ROUND">
                <RestPill label="Within round" value={p.member.withinRoundSeconds} emptyText="NO TIMER" onChange={p.member.onWithinRoundChange} />
              </Row>
              <Row label="AFTER ROUND">
                <RestPill label="After round" value={p.member.afterRoundSeconds} emptyText="PER EXERCISE" onChange={p.member.onAfterRoundChange} />
              </Row>
            </>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
          <button type="button" disabled={!p.canMoveUp} onClick={p.onMoveUp} style={orderButton(!p.canMoveUp)}>
            MOVE UP
          </button>
          <button type="button" disabled={!p.canMoveDown} onClick={p.onMoveDown} style={orderButton(!p.canMoveDown)}>
            MOVE DOWN
          </button>
        </div>
        <p style={NOTE_STYLE}>
          {p.member
            ? `The two rests belong to superset ${p.member.blockLetter}, so they change it for ${andList(p.member.otherNames)} too. ${start}`
            : `${start} Swap, superset and remove are on the exercise card.`}
        </p>
      </div>
    </BottomSheet>
  )
}

