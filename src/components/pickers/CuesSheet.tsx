import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import { Check } from 'lucide-react'
import BottomSheet from '../BottomSheet'
import { hairline } from './pickerControls'
import {
  CUES_TEXT,
  CUE_INPUT_TEXT,
  addNewCue,
  countCueTargets,
  cueDraftFrom,
  cueRows,
  periodTail,
  pickerEyebrow,
  toggleCue,
  useForAllLabel,
  type CueDraft,
  type TargetableSet,
} from './pickerLogic'

// The one cues sheet (TASKS-1.2 chunk 40; board 8; SPEC "Tags [P1] — called cues [1.2]": "Preset list
// ('push here', ...) plus custom text. 'Apply to all sets' fills one cue across an exercise's sets ...
// Reached from the set type picker's Cues row in Plan (board 5 → 8), and from the set's ⋯ during a
// workout (W7)"): "Cues for this set" with a tick box per preset, the user's own cues (marked YOURS),
// "+ NEW CUE", "Use for all N sets of [exercise]" and DONE. Plan's set type picker and the workout's set
// ⋯ open it; neither draws its own.
//
// It writes nothing. DONE hands the caller the set's cues and whether "Use for all" was ticked, and the
// caller writes them to the set (the week set's `tags`; an empty list is none, which is stored as null,
// plannerVocabulary.ts) and, when `applyToAll`, adds each cue to every working head with
// `applyTagToAllHeads` (it skips warmups and stages, skips a head that has the cue, and never removes
// another cue). Closing any other way (×, the scrim, Escape) asks `onClose` and sends nothing. The caller
// mounts the sheet to open it and unmounts it to close it (BottomSheet's contract; mount it outside
// clickable parents: React events from inside its portal still bubble to whatever rendered it). Opened
// from board 5's sheet it stacks on it, and Escape and Tab belong to the sheet on top.
//
// The user's own cues have no storage of their own (TASKS: "no new storage"): they are the run's existing
// tags. The caller passes every tag of the run's week sets as `runCues` (repeats and presets are fine) and
// the sheet lists the ones that aren't presets, once each, as YOURS; a cue the set itself has is listed
// whether the run's list holds it or not.
export interface CuesSheetResult {
  /** The cues the set has now, as stored: a preset as `PRESET_TAGS` has it (lower case), a custom cue as typed. The set's own order, then the cues added here. None is `[]`. */
  cues: string[]
  /** "Use for all N sets of [exercise]" was ticked (it starts unticked, and isn't drawn when fewer than two sets would take it). */
  applyToAll: boolean
}

export interface CuesSheetProps {
  /** The eyebrow's `[EXERCISE] · SET NN`, and the name in "Use for all N sets of [exercise]". */
  exerciseName: string
  setNumber: number
  /** `WEEK N` (`CYCLE N` with `isCycle`); left out, the eyebrow names no week. */
  weekNumber?: number
  isCycle?: boolean
  /** The set's cues now (the week set's `tags`; null or none given is no cues). */
  value: readonly string[] | null | undefined
  /** Every tag of the run's week sets: where the user's own cues come from. */
  runCues?: readonly string[]
  /** The exercise's head sets, this one included (a stage is never one). "Use for all" counts the working ones; without them, or with fewer than two, it isn't drawn. */
  sets?: readonly TargetableSet[]
  onDone: (result: CuesSheetResult) => void
  /** Asked for by ×, a tap on the scrim and Escape. */
  onClose: () => void
}

const NOTE_STYLE: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }

const LIST_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6 }

const LABEL_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontWeight: 600,
  fontSize: 15,
  lineHeight: 1.3,
  color: 'var(--text-primary)',
  overflowWrap: 'break-word',
}

const YOURS_STYLE: CSSProperties = {
  flex: '0 0 auto',
  fontFamily: 'var(--font-mono)',
  fontSize: 9,
  letterSpacing: '0.15em',
  color: 'var(--text-muted)',
}

const NEW_CUE_BUTTON_STYLE: CSSProperties = {
  height: 44,
  borderRadius: 10,
  borderWidth: 1,
  borderStyle: 'dashed',
  borderColor: 'var(--border-strong)',
  background: 'transparent',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: '0.2em',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
}

// No board draws the input that "+ NEW CUE" opens (provisional under D31): it takes the dashed button's
// place and size, with the accent outline a focused field has in the pickers, and an ADD button.
const NEW_CUE_ROW_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 44,
  padding: '0 4px 0 12px',
  borderRadius: 10,
  ...hairline('var(--accent)'),
  background: 'var(--surface)',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

// 16 px: a smaller field makes iOS zoom the page when it takes focus.
const NEW_CUE_INPUT_STYLE: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  height: 40,
  padding: 0,
  borderWidth: 0,
  background: 'transparent',
  fontSize: 16,
  color: 'var(--text-primary)',
}

const ADD_BUTTON_STYLE: CSSProperties = {
  flex: '0 0 auto',
  height: 36,
  padding: '0 12px',
  borderRadius: 8,
  ...hairline('var(--border)'),
  background: 'var(--surface-raised)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: '0.2em',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
}

const USE_FOR_ALL_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 48,
  padding: '6px 12px',
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

/** A cue row: board 8's 48 px outline, accent and tinted while ticked. */
function rowStyle(on: boolean): CSSProperties {
  return {
    boxSizing: 'border-box',
    minHeight: 48,
    padding: '6px 12px',
    borderRadius: 10,
    ...hairline(on ? 'var(--accent)' : 'var(--border)'),
    background: on ? 'var(--accent-muted)' : 'var(--surface)',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    textAlign: 'left',
    cursor: 'pointer',
  }
}

/** The 20 px tick box of a row (text on the accent is `--on-accent`, the boards' near-black: DECISIONS 129 (d), Adam 2026-10-15). */
function TickBox({ on }: { on: boolean }) {
  return (
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
        borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
        background: on ? 'var(--accent)' : 'var(--surface)',
        color: 'var(--on-accent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on ? <Check size={12} strokeWidth={3.5} aria-hidden="true" /> : null}
    </span>
  )
}

export default function CuesSheet({ exerciseName, setNumber, weekNumber, isCycle, value, runCues, sets, onDone, onClose }: CuesSheetProps) {
  // What the sheet is holding is a draft: nothing reaches the caller before DONE, and a caller that passes
  // a new `value` later doesn't reset it (the target pickers keep theirs the same way).
  const [draft, setDraft] = useState<CueDraft>(() => cueDraftFrom(value, runCues))
  const [useForAll, setUseForAll] = useState(false)
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const newCueRef = useRef<HTMLButtonElement>(null)
  const wasAdding = useRef(false)

  // Focus follows the input: into it when it opens, back to "+ NEW CUE" when it closes (never on first render).
  useEffect(() => {
    if (adding) inputRef.current?.focus()
    else if (wasAdding.current) newCueRef.current?.focus()
    wasAdding.current = adding
  }, [adding])

  // "Use for all" counts the working heads `applyTagToAllHeads` would write to. Like the target pickers
  // (DECISIONS 128 (e)) it isn't drawn when fewer than two would take it: with one there is nothing to apply it to.
  const reachable = sets ? countCueTargets(sets) : 0
  const offerUseForAll = reachable >= 2

  function addTyped() {
    const next = addNewCue(draft, text)
    if (next === null) return
    setDraft(next)
    setText('')
    setAdding(false)
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      if (event.nativeEvent.isComposing) return
      event.preventDefault()
      addTyped()
    } else if (event.key === 'Escape') {
      // Cancels the input and nothing else: BottomSheet leaves an Escape that something inside already handled.
      event.preventDefault()
      setText('')
      setAdding(false)
    }
  }

  // A cue typed and not yet added is not lost when DONE is tapped: it is added first.
  function done() {
    const final = (adding ? addNewCue(draft, text) : null) ?? draft
    onDone({ cues: [...final.ticked], applyToAll: offerUseForAll && useForAll })
  }

  return (
    <BottomSheet
      eyebrow={pickerEyebrow({ exerciseName, setNumber, tail: periodTail(weekNumber, isCycle) })}
      title={CUES_TEXT.title}
      onClose={onClose}
      footer={
        <button type="button" onClick={done} style={SUBMIT_STYLE}>
          {CUES_TEXT.done}
        </button>
      }
    >
      <p style={NOTE_STYLE}>{CUES_TEXT.note}</p>

      <div role="group" aria-label="Cues" style={LIST_STYLE}>
        {cueRows(draft).map((row) => (
          <button
            key={row.cue}
            type="button"
            role="checkbox"
            aria-checked={row.on}
            onClick={() => setDraft((current) => toggleCue(current, row.cue))}
            style={rowStyle(row.on)}
          >
            <TickBox on={row.on} />
            <span style={LABEL_STYLE}>{row.label}</span>
            {row.yours ? <span style={YOURS_STYLE}>{CUES_TEXT.yours}</span> : null}
          </button>
        ))}
        {adding ? (
          <div style={NEW_CUE_ROW_STYLE}>
            <input
              ref={inputRef}
              type="text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onInputKeyDown}
              aria-label={CUE_INPUT_TEXT.label}
              placeholder={CUE_INPUT_TEXT.label}
              autoComplete="off"
              enterKeyHint="done"
              style={NEW_CUE_INPUT_STYLE}
            />
            <button type="button" onClick={addTyped} style={ADD_BUTTON_STYLE}>
              {CUE_INPUT_TEXT.add}
            </button>
          </div>
        ) : (
          <button ref={newCueRef} type="button" onClick={() => setAdding(true)} style={NEW_CUE_BUTTON_STYLE}>
            {CUES_TEXT.newCue}
          </button>
        )}
      </div>

      {offerUseForAll ? (
        <button type="button" role="checkbox" aria-checked={useForAll} onClick={() => setUseForAll((on) => !on)} style={USE_FOR_ALL_STYLE}>
          <TickBox on={useForAll} />
          <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: 14, lineHeight: 1.3, color: 'var(--text-primary)', overflowWrap: 'break-word' }}>
            {useForAllLabel(reachable, exerciseName)}
          </span>
        </button>
      ) : null}
    </BottomSheet>
  )
}
