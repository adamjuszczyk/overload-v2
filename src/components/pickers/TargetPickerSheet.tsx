import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import BottomSheet from '../BottomSheet'
import { CAPTION_STYLE, hairline } from './pickerControls'
import {
  REP_TARGET_TEXT,
  RIR_TARGET_TEXT,
  TARGET_MODES,
  countApplyToAll,
  pickTargetMode,
  settleTargetField,
  settleTyped,
  stepTargetField,
  typeTargetField,
  typedDigits,
  useForAllLabel,
  type TargetDraft,
  type TargetField,
  type TargetKind,
  type TargetableSet,
  type TypedTexts,
} from './pickerLogic'

// The body the rep target picker (board 6, PP3d) and the RIR target picker (board 7) share: the two
// boards are one layout, a row of segments, the box or boxes of the segment picked, "Use for all N sets
// of [exercise]" and the footer button that says what it will set. `RepTargetPicker` and
// `RirTargetPicker` are the two ways to use it; nothing else renders it.
//
// The sheet keeps a draft (the segment and its numbers) and hands it to `onSubmit` when the footer
// button is tapped; closing it any other way (×, the scrim, Escape) asks `onClose` and sends nothing.
// "Use for all" starts ticked (SPEC Defaults 7) and is drawn only when there is more than one set it
// would reach: with one there is nothing to apply it to.
//
// The boxes are inputs you can type a number into, with a − and a + to step it, one a tap (DECISIONS
// 128, Adam 2026-10-15: "the number boxes in the rep and RIR pickers are inputs you can type into, with
// ± steppers beside them (decisions 6 and 17a: choose, then type). Same bounds as built"). SPEC's "no
// tap-a-value shortcut" still holds: there is no row of numbers to tap. Typing and stepping share
// `pickerLogic.ts`'s bounds: reps 1-100, RIR 0-20, FROM never past TO. The text being typed is kept
// apart from the draft (`TypedTexts`) until its box is left, and the footer button, a segment and a
// stepper all act on the draft with that text settled, so what the button says is what it sets.
//
// A picker opens on the set's current target (`initial`, from the caller's `value`): its segment and
// its numbers. A segment the set doesn't have starts from the set's own value (DECISIONS 155 (a), Adam
// 2026-10-16: NUMBER n gives RANGE n-(n+2), RANGE a-b gives NUMBER a), and the boards' example numbers
// (8, 8-10, RIR 2, 1-2) only where the set has no target at all, which shows no number until a segment
// is picked (`pickerLogic.ts`'s `draftFromRepTarget`, `pickTargetMode`). Each segment keeps its own
// numbers while the sheet is open and a switch changes none: 12 reps gives RANGE 12-14, 6-9 gives NUMBER 6,
// and 6-9, NUMBER, RANGE is 6-9 again. A segment tap settles the text still in a box into the draft and
// then clears all the typed text, so a box the segment hid never shows its old text when the segment
// comes back.

interface TargetPickerSheetProps {
  kind: TargetKind
  eyebrow: string
  initial: TargetDraft
  exerciseName: string
  /** The exercise's head sets (a stage is never one): what "Use for all" counts and, for RIR, which of them it skips. */
  sets: readonly TargetableSet[]
  /** The footer button's text for a draft. */
  summaryOf: (draft: TargetDraft) => string
  onSubmit: (draft: TargetDraft, applyToAll: boolean) => void
  onClose: () => void
}

const CHROME: Record<
  TargetKind,
  { title: string; numberLabel: string; from: string; to: string; noneText: string; lessLabel: string; moreLabel: string; rangeNote: string | null }
> = {
  reps: {
    title: REP_TARGET_TEXT.title,
    numberLabel: REP_TARGET_TEXT.numberLabel,
    from: REP_TARGET_TEXT.from,
    to: REP_TARGET_TEXT.to,
    noneText: REP_TARGET_TEXT.none,
    lessLabel: 'Fewer reps',
    moreLabel: 'More reps',
    rangeNote: null,
  },
  rir: {
    title: RIR_TARGET_TEXT.title,
    numberLabel: RIR_TARGET_TEXT.numberLabel,
    from: RIR_TARGET_TEXT.from,
    to: RIR_TARGET_TEXT.to,
    noneText: RIR_TARGET_TEXT.none,
    lessLabel: 'Less RIR',
    moreLabel: 'More RIR',
    rangeNote: RIR_TARGET_TEXT.rangeNote,
  },
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

const NUMBER_PANEL_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '6px 0' }

const RANGE_PANEL_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, padding: '6px 0' }

const RANGE_COLUMN_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, minWidth: 0 }

// The boards' 72 px number box. 34 px text is past the 16 px below which iOS zooms the page when a
// field takes focus.
const NUMBER_INPUT_STYLE: CSSProperties = {
  boxSizing: 'border-box',
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
  fontSize: 34,
  color: 'var(--text-primary)',
}

const INFO_PANEL_STYLE: CSSProperties = {
  borderRadius: 12,
  background: 'var(--surface-raised)',
  padding: '18px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const INFO_TITLE_STYLE: CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, lineHeight: 1.2, color: 'var(--text-primary)' }

const INFO_TEXT_STYLE: CSSProperties = { fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)' }

const RANGE_NOTE_STYLE: CSSProperties = { marginTop: -6, textAlign: 'center', fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }

const USE_FOR_ALL_STYLE: CSSProperties = {
  minHeight: 52,
  padding: '0 12px',
  borderRadius: 10,
  ...hairline('var(--border)'),
  background: 'var(--surface)',
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  textAlign: 'left',
  cursor: 'pointer',
}

const SUBMIT_STYLE: CSSProperties = {
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

/** The 52 px square − / + beside the NUMBER box. */
function RoundStep({ label, glyph, disabled, onClick }: { label: string; glyph: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 52,
        height: 52,
        padding: 0,
        borderRadius: 10,
        ...hairline('var(--border)'),
        background: 'var(--surface-raised)',
        fontFamily: 'var(--font-mono)',
        fontSize: 22,
        lineHeight: 1,
        color: disabled ? 'var(--text-dim)' : 'var(--text-secondary)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {glyph}
    </button>
  )
}

/** The 52 × 44 − / + under a FROM or TO box. */
function SmallStep({ label, glyph, disabled, onClick }: { label: string; glyph: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 52,
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

/**
 * A number box: an input for digits in the boards' 72 px box. NUMBER's and FROM's draw the accent
 * outline at rest, as the boards do (`marked`); a box with focus always has it, so TO shows where the
 * cursor is. The text is selected when the box takes focus, so typing replaces the number; Enter
 * leaves the box (the keyboard's Done), and leaving it is what settles what was typed.
 */
function NumberBox({
  label,
  value,
  width,
  marked,
  onType,
  onLeave,
}: {
  label: string
  value: string
  width: number | string
  marked: boolean
  onType: (raw: string) => void
  onLeave: () => void
}) {
  const [focused, setFocused] = useState(false)
  const outlined = focused || marked
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
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
        ...NUMBER_INPUT_STYLE,
        width,
        borderWidth: outlined ? 2 : 1,
        borderStyle: 'solid',
        borderColor: outlined ? 'var(--accent)' : 'var(--border-strong)',
      }}
    />
  )
}

export default function TargetPickerSheet({ kind, eyebrow, initial, exerciseName, sets, summaryOf, onSubmit, onClose }: TargetPickerSheetProps) {
  const [draft, setDraft] = useState(initial)
  const [typed, setTyped] = useState<TypedTexts>({})
  const [useForAll, setUseForAll] = useState(true)
  const chrome = CHROME[kind]
  const modes = TARGET_MODES[kind]
  const reachable = countApplyToAll(sets, kind)
  const offerUseForAll = reachable >= 2

  // The draft as it stands once the text still in a box is settled (150 reps is 100): what the footer
  // button says and sets, and what a segment or a stepper starts from.
  const settled = settleTyped(draft, typed, kind)

  const step = (field: TargetField, delta: 1 | -1) => {
    setDraft(stepTargetField(settled, field, delta, kind))
    setTyped({})
  }
  const cannotStep = (field: TargetField, delta: 1 | -1) => stepTargetField(settled, field, delta, kind) === settled
  const type = (field: TargetField, raw: string) => {
    const text = typedDigits(raw)
    // letters alone leave the box as it was; emptying it (nothing left in raw) is allowed
    if (raw !== '' && text === '') return
    setTyped((current) => ({ ...current, [field]: text }))
    setDraft((current) => typeTargetField(current, field, text, kind))
  }
  const leave = (field: TargetField) => {
    const text = typed[field]
    if (text === undefined) return
    setDraft((current) => settleTargetField(current, field, text, kind))
    setTyped(({ [field]: _left, ...rest }) => rest)
  }
  const shown = (field: TargetField) => typed[field] ?? String(draft[field])

  return (
    <BottomSheet
      eyebrow={eyebrow}
      title={chrome.title}
      onClose={onClose}
      footer={
        <button type="button" onClick={() => onSubmit(settled, offerUseForAll && useForAll)} style={SUBMIT_STYLE}>
          {summaryOf(settled)}
        </button>
      }
    >
      <div style={SECTIONS_STYLE}>
        <div
          role="group"
          aria-label="Kind of target"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${modes.length}, minmax(0, 1fr))`,
            ...hairline('var(--border)'),
            borderRadius: 10,
            overflow: 'hidden',
            background: 'var(--surface)',
          }}
        >
          {modes.map((mode) => {
            const on = mode.id === draft.mode
            return (
              <button
                key={mode.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setDraft(pickTargetMode(settled, mode.id, kind))
                  setTyped({})
                }}
                style={{ ...SEGMENT_BUTTON_STYLE, background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--on-accent)' : 'var(--text-secondary)' }}
              >
                {mode.label}
              </button>
            )
          })}
        </div>

        {draft.mode === 'number' ? (
          <div style={NUMBER_PANEL_STYLE}>
            <span style={CAPTION_STYLE}>{chrome.numberLabel}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <RoundStep label={chrome.lessLabel} glyph="−" disabled={cannotStep('number', -1)} onClick={() => step('number', -1)} />
              <NumberBox
                label={chrome.numberLabel}
                value={shown('number')}
                width={110}
                marked
                onType={(raw) => type('number', raw)}
                onLeave={() => leave('number')}
              />
              <RoundStep label={chrome.moreLabel} glyph="+" disabled={cannotStep('number', 1)} onClick={() => step('number', 1)} />
            </div>
          </div>
        ) : null}

        {draft.mode === 'range' ? (
          <div style={RANGE_PANEL_STYLE}>
            <div style={RANGE_COLUMN_STYLE}>
              <span style={CAPTION_STYLE}>{chrome.from}</span>
              <NumberBox label="From" value={shown('from')} width="100%" marked onType={(raw) => type('from', raw)} onLeave={() => leave('from')} />
              <div style={{ display: 'flex', gap: 8 }}>
                <SmallStep label="From: fewer" glyph="−" disabled={cannotStep('from', -1)} onClick={() => step('from', -1)} />
                <SmallStep label="From: more" glyph="+" disabled={cannotStep('from', 1)} onClick={() => step('from', 1)} />
              </div>
            </div>
            <div style={RANGE_COLUMN_STYLE}>
              <span style={CAPTION_STYLE}>{chrome.to}</span>
              <NumberBox label="To" value={shown('to')} width="100%" marked={false} onType={(raw) => type('to', raw)} onLeave={() => leave('to')} />
              <div style={{ display: 'flex', gap: 8 }}>
                <SmallStep label="To: fewer" glyph="−" disabled={cannotStep('to', -1)} onClick={() => step('to', -1)} />
                <SmallStep label="To: more" glyph="+" disabled={cannotStep('to', 1)} onClick={() => step('to', 1)} />
              </div>
            </div>
          </div>
        ) : null}

        {draft.mode === 'range' && chrome.rangeNote !== null ? <span style={RANGE_NOTE_STYLE}>{chrome.rangeNote}</span> : null}

        {draft.mode === 'none' ? (
          <div style={INFO_PANEL_STYLE}>
            <span style={INFO_TITLE_STYLE}>{chrome.noneText}</span>
          </div>
        ) : null}

        {draft.mode === 'amrap' ? (
          <div style={INFO_PANEL_STYLE}>
            <span style={INFO_TITLE_STYLE}>{REP_TARGET_TEXT.amrap}</span>
            <span style={INFO_TEXT_STYLE}>{REP_TARGET_TEXT.amrapNote}</span>
          </div>
        ) : null}

        {offerUseForAll ? (
          <button type="button" role="checkbox" aria-checked={useForAll} onClick={() => setUseForAll((on) => !on)} style={USE_FOR_ALL_STYLE}>
            <span
              aria-hidden="true"
              style={{
                flex: '0 0 auto',
                boxSizing: 'border-box',
                width: 20,
                height: 20,
                borderRadius: 5,
                borderWidth: 2,
                borderStyle: 'solid',
                borderColor: useForAll ? 'var(--accent)' : 'var(--border-strong)',
                background: useForAll ? 'var(--accent)' : 'var(--surface)',
                color: 'var(--on-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {useForAll ? <Check size={12} strokeWidth={3.5} aria-hidden="true" /> : null}
            </span>
            <span style={{ minWidth: 0, fontSize: 14, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{useForAllLabel(reachable, exerciseName)}</span>
          </button>
        ) : null}
      </div>
    </BottomSheet>
  )
}
