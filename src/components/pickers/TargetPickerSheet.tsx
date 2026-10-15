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
  stepTargetField,
  useForAllLabel,
  type TargetDraft,
  type TargetKind,
  type TargetableSet,
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
// The boxes show their number; the − and + beside them change it, one a tap, inside the kind's bounds.
// The boards draw them as plain boxes and SPEC has "no tap-a-value shortcut", so they are not inputs.

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

const BIG_NUMBER_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  height: 72,
  borderRadius: 12,
  background: 'var(--surface)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
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
  color: 'var(--base)',
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

export default function TargetPickerSheet({ kind, eyebrow, initial, exerciseName, sets, summaryOf, onSubmit, onClose }: TargetPickerSheetProps) {
  const [draft, setDraft] = useState(initial)
  const [useForAll, setUseForAll] = useState(true)
  const chrome = CHROME[kind]
  const modes = TARGET_MODES[kind]
  const reachable = countApplyToAll(sets, kind)
  const offerUseForAll = reachable >= 2

  const step = (field: 'number' | 'from' | 'to', delta: 1 | -1) => setDraft((current) => stepTargetField(current, field, delta, kind))
  const cannotStep = (field: 'number' | 'from' | 'to', delta: 1 | -1) => stepTargetField(draft, field, delta, kind) === draft

  return (
    <BottomSheet
      eyebrow={eyebrow}
      title={chrome.title}
      onClose={onClose}
      footer={
        <button type="button" onClick={() => onSubmit(draft, offerUseForAll && useForAll)} style={SUBMIT_STYLE}>
          {summaryOf(draft)}
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
                onClick={() => setDraft((current) => pickTargetMode(current, mode.id, kind))}
                style={{ ...SEGMENT_BUTTON_STYLE, background: on ? 'var(--accent)' : 'var(--surface)', color: on ? 'var(--base)' : 'var(--text-secondary)' }}
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
              <output
                aria-label={chrome.numberLabel}
                style={{ ...BIG_NUMBER_STYLE, width: 110, borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--accent)' }}
              >
                {draft.number}
              </output>
              <RoundStep label={chrome.moreLabel} glyph="+" disabled={cannotStep('number', 1)} onClick={() => step('number', 1)} />
            </div>
          </div>
        ) : null}

        {draft.mode === 'range' ? (
          <div style={RANGE_PANEL_STYLE}>
            <div style={RANGE_COLUMN_STYLE}>
              <span style={CAPTION_STYLE}>{chrome.from}</span>
              <output
                aria-label="From"
                style={{ ...BIG_NUMBER_STYLE, width: '100%', borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--accent)' }}
              >
                {draft.from}
              </output>
              <div style={{ display: 'flex', gap: 8 }}>
                <SmallStep label="From: fewer" glyph="−" disabled={cannotStep('from', -1)} onClick={() => step('from', -1)} />
                <SmallStep label="From: more" glyph="+" disabled={cannotStep('from', 1)} onClick={() => step('from', 1)} />
              </div>
            </div>
            <div style={RANGE_COLUMN_STYLE}>
              <span style={CAPTION_STYLE}>{chrome.to}</span>
              <output
                aria-label="To"
                style={{ ...BIG_NUMBER_STYLE, width: '100%', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-strong)' }}
              >
                {draft.to}
              </output>
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
                color: 'var(--base)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {useForAll ? <Check size={12} strokeWidth={3.5} aria-hidden="true" /> : null}
            </span>
            <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{useForAllLabel(reachable, exerciseName)}</span>
          </button>
        ) : null}
      </div>
    </BottomSheet>
  )
}
