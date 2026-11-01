import { useState } from 'react'
import type { CSSProperties } from 'react'
import BottomSheet from '../BottomSheet'
import { CAPTION_STYLE, hairline } from './pickerControls'
import { normaliseTempo } from '../../lib/plannerVocabulary'

// The tempo picker (1.2.1 chunk 79; SPEC "Tempo picker [3]"; prototype "Planner · 2 EXERCISES" → "Tempo picker"): tempo is set the way reps and RIR
// are, in the target pickers' sheet (boards 6 and 7). The eyebrow is the exercise's name, the title "Tempo", then NONE | SET and, with SET, four boxes
// (DOWN · BOTTOM · UP · TOP), each with a − and a + under it, and one line: "Seconds per phase. X is as fast as you can." The footer says what it will
// set: "SET TEMPO 3-1-X-0" or "SET NO TEMPO". Nothing is typed with dashes: the four boxes are the four fields.
//
// It writes nothing. The footer hands the caller the tempo in `normaliseTempo`'s form (the text the column holds today: four fields, X allowed) or
// null for none, and the caller writes it: the planner's TEMPO row (`StepExercises.tsx`) and CHANGE THE PROGRAM's exercise sheet. Closing it any other
// way (×, the scrim, Escape) asks `onClose` and sends nothing. The caller mounts it to open it and unmounts it to close it (`BottomSheet`'s contract).
//
// A box takes 0 to 20 or X, typed or stepped. − below 0 gives X and + from X gives 0; − at X and + at 20 do nothing, and say so by being disabled, as
// the rep and RIR pickers' steppers do. Typed text is kept apart from the draft until its box is left (nothing is held to 20 while a number is on its
// way: "2" on the way to "20"), and everything that acts on the draft acts on it with that text settled: the footer's words and value, a stepper and
// a segment. None relies on a blur coming first, because Safari gives a tapped button no focus (RULES: a typed box keeps its half-written text apart
// from the draft). A box left with nothing, or with text that is no number, goes back to what it held.
//
// A tempo stored before 1.2.1 could hold any digits in a field (the old text box took 0-99 and more). The picker opens on it as it is and the footer
// sets it as it is, until a box that holds more than 20 is stepped or typed over: stepping puts it to 20, the nearest number a box can hold.

type Phase = number | 'X'

const PHASES = ['DOWN', 'BOTTOM', 'UP', 'TOP'] as const
const MAX_SECONDS = 20
/** What SET starts from when the exercise has no tempo yet: a 3-second lowering, no pause, 1 up, no pause. */
const START_TEMPO: readonly Phase[] = [3, 0, 1, 0]

export const TEMPO_TEXT = {
  title: 'Tempo',
  none: 'NONE',
  set: 'SET',
  note: 'Seconds per phase. X is as fast as you can.',
  noneNote: 'No tempo on this exercise.',
  setNone: 'SET NO TEMPO',
} as const

/** The four phases of a stored tempo; the start tempo for none (and for text `normaliseTempo` would refuse, which no writer stores). */
function phasesOf(tempo: string | null): Phase[] {
  const normal = tempo === null ? null : normaliseTempo(tempo)
  if (normal === null) return [...START_TEMPO]
  return normal.split('-').map((field) => (field === 'X' ? 'X' : Number(field)))
}

/** One tap on − or +. Out of range (a tempo stored before 1.2.1) a tap puts the box to 20; no tap goes past X or 20. */
function stepPhase(phase: Phase, delta: 1 | -1): Phase {
  if (delta === -1) return phase === 'X' ? 'X' : phase === 0 ? 'X' : Math.min(MAX_SECONDS, phase - 1)
  return phase === 'X' ? 0 : Math.min(MAX_SECONDS, phase + 1)
}

/** What a box can hold while someone types: an X (either case) or up to two digits. An X wins over digits beside it. */
function typedText(raw: string): string {
  if (/x/i.test(raw)) return 'X'
  return raw.replace(/\D/g, '').slice(0, 2)
}

/** A box left with `text` in it: X, or the number held to 20; an empty text changes nothing. */
function settleText(text: string, phase: Phase): Phase {
  if (text === 'X') return 'X'
  if (/^\d+$/.test(text)) return Math.min(MAX_SECONDS, Number(text))
  return phase
}

const SECTIONS_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18 }

const SEGMENT_BUTTON_STYLE: CSSProperties = {
  height: 46,
  padding: 0,
  borderWidth: 0,
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.15em',
  cursor: 'pointer',
}

const PHASES_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }

const PHASE_COLUMN_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, minWidth: 0 }

// The boards' 72 px number box, 30 px text (past the 16 px below which iOS zooms the page when a field takes focus), the same face as the rep
// and RIR pickers' boxes. A box with focus draws the accent outline, so the one being typed in shows.
const BOX_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minWidth: 0,
  height: 72,
  margin: 0,
  padding: 0,
  borderRadius: 12,
  background: 'var(--surface)',
  appearance: 'none',
  textAlign: 'center',
  fontFamily: 'var(--font-display)',
  fontWeight: 900,
  fontSize: 30,
  color: 'var(--text-primary)',
  outline: 'none',
}

const NOTE_STYLE: CSSProperties = { margin: 0, textAlign: 'center', fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }

const SUBMIT_STYLE: CSSProperties = {
  width: '100%',
  height: 52,
  borderRadius: 10,
  borderWidth: 0,
  background: 'var(--accent)',
  color: 'var(--on-accent)',
  fontFamily: 'var(--font-display)',
  fontWeight: 800,
  fontSize: 15,
  letterSpacing: '0.03em',
  cursor: 'pointer',
}

/** The − or + under a box: 44 px tall, half the box's width each. */
function Step({ label, glyph, disabled, onClick }: { label: string; glyph: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        flex: '1 1 0%',
        minWidth: 0,
        height: 44,
        padding: 0,
        borderRadius: 10,
        ...hairline('var(--border)'),
        background: 'var(--surface-raised)',
        fontFamily: 'var(--font-mono)',
        fontSize: 20,
        lineHeight: 1,
        color: disabled ? 'var(--text-dim)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {glyph}
    </button>
  )
}

/** A box for one phase. The text is selected when the box takes focus, so typing replaces the number; Enter leaves it (the keyboard's Done). */
function PhaseBox({ label, value, onType, onLeave }: { label: string; value: string; onType: (raw: string) => void; onLeave: () => void }) {
  const [focused, setFocused] = useState(false)
  return (
    <input
      type="text"
      inputMode="text"
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      enterKeyHint="done"
      aria-label={label}
      value={value}
      onChange={(event) => onType(event.target.value)}
      onFocus={(event) => {
        setFocused(true)
        event.currentTarget.select()
      }}
      onBlur={() => {
        setFocused(false)
        onLeave()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.preventDefault()
        event.currentTarget.blur()
      }}
      style={{
        ...BOX_STYLE,
        borderWidth: focused ? 2 : 1,
        borderStyle: 'solid',
        borderColor: focused ? 'var(--accent)' : 'var(--border-strong)',
      }}
    />
  )
}

export interface TempoPickerProps {
  /** The eyebrow: the exercise's name (the sheet draws it in capitals). */
  exerciseName: string
  /** The exercise's tempo now, `normaliseTempo`'s text or null for none. The sheet opens on it. */
  value: string | null
  /** The footer button: the tempo it said it would set, or null for none. */
  onSubmit: (tempo: string | null) => void
  /** Asked for by ×, a tap on the scrim and Escape. */
  onClose: () => void
}

export default function TempoPicker({ exerciseName, value, onSubmit, onClose }: TempoPickerProps) {
  const [on, setOn] = useState(value !== null)
  const [phases, setPhases] = useState<Phase[]>(() => phasesOf(value))
  const [typed, setTyped] = useState<Record<number, string>>({})

  // The phases as they stand once the text still in a box is settled (25 seconds is 20): what the footer says and sets, and what a stepper or a
  // segment starts from.
  const settled = phases.map((phase, i) => (typed[i] === undefined ? phase : settleText(typed[i], phase)))
  const tempo = on ? normaliseTempo(settled.join('-')) : null

  const step = (i: number, delta: 1 | -1) => {
    setPhases(settled.map((phase, j) => (j === i ? stepPhase(phase, delta) : phase)))
    setTyped({})
  }
  const pick = (next: boolean) => {
    setPhases(settled)
    setTyped({})
    setOn(next)
  }
  const type = (i: number, raw: string) => setTyped((current) => ({ ...current, [i]: typedText(raw) }))
  const leave = (i: number) => {
    const text = typed[i]
    if (text === undefined) return
    setPhases((current) => current.map((phase, j) => (j === i ? settleText(text, phase) : phase)))
    setTyped(({ [i]: _left, ...rest }) => rest)
  }

  return (
    <BottomSheet
      eyebrow={exerciseName}
      title={TEMPO_TEXT.title}
      onClose={onClose}
      footer={
        <button type="button" onClick={() => onSubmit(tempo)} style={SUBMIT_STYLE}>
          {tempo === null ? TEMPO_TEXT.setNone : `SET TEMPO ${tempo}`}
        </button>
      }
    >
      <div style={SECTIONS_STYLE}>
        <div
          role="group"
          aria-label="Kind of tempo"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', ...hairline('var(--border)'), borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}
        >
          {[
            { id: false, label: TEMPO_TEXT.none },
            { id: true, label: TEMPO_TEXT.set },
          ].map((segment) => (
            <button
              key={segment.label}
              type="button"
              aria-pressed={on === segment.id}
              onClick={() => pick(segment.id)}
              style={{ ...SEGMENT_BUTTON_STYLE, background: on === segment.id ? 'var(--accent)' : 'var(--surface)', color: on === segment.id ? 'var(--on-accent)' : 'var(--text-secondary)' }}
            >
              {segment.label}
            </button>
          ))}
        </div>

        {on ? (
          <>
            <div style={PHASES_STYLE}>
              {PHASES.map((phase, i) => {
                const name = phase.charAt(0) + phase.slice(1).toLowerCase()
                return (
                  <div key={phase} style={PHASE_COLUMN_STYLE}>
                    <span style={{ ...CAPTION_STYLE, textAlign: 'center', fontSize: 9, letterSpacing: '0.15em' }}>{phase}</span>
                    <PhaseBox label={`${name} seconds`} value={typed[i] ?? String(phases[i])} onType={(raw) => type(i, raw)} onLeave={() => leave(i)} />
                    <div style={{ display: 'flex', gap: 4 }}>
                      <Step label={`${name}: less`} glyph="−" disabled={stepPhase(settled[i], -1) === settled[i]} onClick={() => step(i, -1)} />
                      <Step label={`${name}: more`} glyph="+" disabled={stepPhase(settled[i], 1) === settled[i]} onClick={() => step(i, 1)} />
                    </div>
                  </div>
                )
              })}
            </div>
            <p style={{ ...NOTE_STYLE, marginTop: -4 }}>{TEMPO_TEXT.note}</p>
          </>
        ) : (
          <p style={NOTE_STYLE}>{TEMPO_TEXT.noneNote}</p>
        )}
      </div>
    </BottomSheet>
  )
}
