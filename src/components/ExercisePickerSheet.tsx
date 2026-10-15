import { useEffect, useId, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, KeyboardEvent, ReactNode, RefObject } from 'react'
import { ArrowRightLeft, ChevronRight, Plus } from 'lucide-react'
import BottomSheet from './BottomSheet'
import { hairline } from './pickers/pickerControls'
import {
  PICKER_TEXT,
  addConfirmTitle,
  creatableName,
  emptyKind,
  errorReason,
  exercisesInGroup,
  groupChips,
  groupEmptyLine,
  groupLabel,
  newExerciseButton,
  newExerciseCaption,
  offeredExercises,
  openingGroup,
  rowLabel,
  tapGroup,
  type PickerGroup,
} from './exercisePickerLogic'
import { useCreateExercise, useExercises } from '../features/library/useExercises'
import type { Exercise, MuscleGroup } from '../types'

// The one exercise picker (TASKS-1.2 chunk 41), for every swap and every add: CHANGE THE PROGRAM (PL4-PL6),
// the stepped planner (PP2d, PP2d2) and the workout (W11, W13-W15). It lists the user's own exercises, as the
// pickers it replaces did (SwapExerciseSheet, programs/ExercisePicker, plan/WeekExercisePickerSheet stay until
// 51a, 54a, 59 and 68 remove their callers), under muscle-group chips (ALL first, then the groups in the app's
// own order; a swap opens on the group of the exercise it replaces).
//
// It writes nothing but a new exercise. A pick goes to `onPick(exercise)` and the caller does the swap or the
// add; the sheet never asks to close after a pick (the caller mounts it to open and unmounts it to close,
// BottomSheet's contract; with `stayOpenAfterAdd` it simply stays and the caller keeps it mounted).
//
// What a tap does is the caller's choice, because the boards differ:
// - add, no `confirmLabel`: a tap adds at once (PL5, PP2d; `+` at the end of a row). `stayOpenAfterAdd` says the
//   caller keeps the sheet open for the next one (PP2d's line); the caller leaves the added exercise out of
//   `exclude` from then on, and a tap moves the focus to the next row first, so it is never on a row that is
//   about to go.
// - add, `confirmLabel`: a tap opens the confirm (W14: "Add Hammer Curl?", the caller's `confirmNote`, BACK and
//   the label); the label's button picks. W13's rows end in a chevron for it.
// - swap, no `confirmLabel`: a tap swaps at once (PL4's `⇄` rows).
// - swap, `confirmLabel`: radio rows and a footer button that stays disabled until a row is picked (W11); the
//   caller's `confirmNote` is the line above the button and can name the picked exercise.
//
// `onCreate` turns on "+ NEW [GROUP] EXERCISE" (W11, W15): the sheet creates the exercise (`useCreateExercise`:
// the typed name and the group of the chip that is on) and calls `onCreate` with it, then treats it as a tap on
// its row. PL4-PL6 and PP2d draw no such row, so the planner's callers leave `onCreate` out. A failure shows the
// message the server returned (SPEC, Errors (15)).
//
// An empty list says which of two things it is, as the boards word them apart: nothing left (every exercise under
// the chip is already in the workout: NONE IN THIS GROUP, ALL EXERCISES ADDED; PP2d2) or nothing there at all
// (where `onCreate` is passed: "No forearms exercises yet." and the create row, "No exercises yet. Pick a muscle
// group to create one."; W15; a caller that can't create says NONE IN THIS GROUP, PL6).
//
// Choices no board makes, provisional under D31: one look for every caller (the hairline rows of
// W11, W13 and PP2d, a 44 px muted-accent chip, always tall; PL4-PL6 draw bordered cards), the group under each
// name unless `showGroup` is off (PL4-PL6 draw it; W11, W13 and PP2d draw the name alone), a tap on the chip
// that is on goes back to ALL (the pickers this one replaces all did), the words of the loading and failing states.
//
// Mount it outside clickable parents: BottomSheet draws through a portal and React events still bubble.
export interface ExercisePickerCommonProps {
  /** The small mono line above the title (`PULL 1 · FROM WEEK 2`, `LAT PULLDOWN · TODAY ONLY`). */
  eyebrow?: string
  /** `Swap Lat Pulldown`, `Swap for what?`, `Add exercise`, `Add an exercise`. */
  title: string
  /** Ids of the exercises that are never listed: the ones already in the workout. */
  exclude?: readonly string[]
  /** The pick, once it is made (a tap, or the confirm's button). */
  onPick: (exercise: Exercise) => void
  /** Asked for by ×, a tap on the scrim and Escape. */
  onClose: () => void
  /** Passed: "+ NEW [GROUP] EXERCISE" is offered; called with the new exercise once it exists, before it is treated as picked. */
  onCreate?: (exercise: Exercise) => void
  /** The group under each exercise's name (PL4-PL6). Default on; W11, W13 and PP2d draw the name alone. */
  showGroup?: boolean
  /** Given: a pick is confirmed first (swap: a footer button, W11; add: W14's step), and the button reads this (`SWAP FOR TODAY`, `SWAP`, `ADD EXERCISE`). */
  confirmLabel?: string
  /** The line with the confirm: over the swap's button (it can name the exercise picked so far; null before one is), under W14's title (the exercise being added). */
  confirmNote?: ReactNode | ((exercise: Exercise | null) => ReactNode)
}

export type ExercisePickerSheetProps = ExercisePickerCommonProps &
  (
    | {
        mode: 'swap'
        /** The exercise being replaced: the sheet never lists it and opens on its muscle group. */
        replacing: { id: string; muscleGroup?: MuscleGroup | null }
        stayOpenAfterAdd?: never
      }
    | {
        mode: 'add'
        replacing?: never
        /** The caller keeps the sheet open after an add (PP2d): it says so ("Tap to add. The list stays open for the next one."). Not with `confirmLabel`. */
        stayOpenAfterAdd?: boolean
      }
  )

const NOTE_STYLE: CSSProperties = { margin: 0, fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }

const HINT_STYLE: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--text-muted)' }

// A row of chips that scrolls sideways by itself (its scrollbar is hidden by the app's own class).
const CHIP_ROW_STYLE: CSSProperties = { position: 'relative', display: 'flex', gap: 6, overflowX: 'auto' }

/** A chip: a 44 px target, a muted accent fill with accent text and outline while on (W11, W13, PP2d; PL4-PL6 draw it solid). */
function chipStyle(on: boolean): CSSProperties {
  return {
    flex: '0 0 auto',
    boxSizing: 'border-box',
    height: 44,
    padding: '0 12px',
    borderRadius: 6,
    ...hairline(on ? 'var(--accent)' : 'var(--border)'),
    background: on ? 'var(--accent-muted)' : 'var(--surface)',
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    fontSize: 10,
    letterSpacing: '0.12em',
    color: on ? 'var(--accent)' : 'var(--text-secondary)',
    cursor: 'pointer',
  }
}

// The list: hairline rows under a hairline (W11, W13, PP2d).
const LIST_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  borderWidth: '1px 0 0',
  borderStyle: 'solid',
  borderColor: 'var(--border-subtle)',
}

function rowStyle(on: boolean): CSSProperties {
  return {
    boxSizing: 'border-box',
    width: '100%',
    minHeight: 52,
    padding: '6px 10px',
    borderWidth: '0 0 1px',
    borderStyle: 'solid',
    borderColor: 'var(--border-subtle)',
    background: on ? 'var(--accent-muted)' : 'transparent',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    textAlign: 'left',
    cursor: 'pointer',
  }
}

const ROW_TEXT_STYLE: CSSProperties = { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }

const NAME_STYLE: CSSProperties = {
  fontWeight: 600,
  fontSize: 15,
  lineHeight: 1.3,
  color: 'var(--text-primary)',
  overflowWrap: 'break-word',
}

const GROUP_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 9,
  letterSpacing: '0.15em',
  color: 'var(--text-muted)',
}

const EMPTY_CAPTION_STYLE: CSSProperties = {
  padding: '32px 0',
  textAlign: 'center',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: '0.2em',
  color: 'var(--text-muted)',
}

const NEW_EXERCISE_BUTTON_STYLE: CSSProperties = {
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

const FORM_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 }

const FORM_CAPTION_STYLE: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  lineHeight: 1.2,
  letterSpacing: '0.2em',
  color: 'var(--text-muted)',
}

// 16 px: a smaller field makes iOS zoom the page when it takes focus (the cues sheet's input is the same).
const NAME_INPUT_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: 48,
  padding: '0 14px',
  borderRadius: 10,
  borderWidth: 2,
  borderStyle: 'solid',
  borderColor: 'var(--accent)',
  background: 'var(--surface)',
  fontSize: 16,
  color: 'var(--text-primary)',
}

const BUTTON_PAIR_STYLE: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }

const CANCEL_STYLE: CSSProperties = {
  height: 44,
  borderRadius: 10,
  ...hairline('var(--border-strong)'),
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}

// While the exercise is being saved the board greys CANCEL out.
const CANCEL_DISABLED_STYLE: CSSProperties = {
  height: 44,
  borderRadius: 10,
  borderWidth: 0,
  background: 'var(--surface-raised)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.15em',
  color: 'var(--text-dim)',
  cursor: 'default',
}

// Text on the accent is `--base`, as on every accent button (DECISIONS 128 (g)).
const CREATE_STYLE: CSSProperties = {
  height: 44,
  borderRadius: 10,
  borderWidth: 0,
  background: 'var(--accent)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  fontSize: 11,
  letterSpacing: '0.15em',
  color: 'var(--base)',
  cursor: 'pointer',
}

const ERROR_STYLE: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 }

const ERROR_HEADLINE_STYLE: CSSProperties = { margin: 0, fontSize: 13, fontWeight: 700, lineHeight: 1.4, color: 'var(--error)' }

const ERROR_REASON_STYLE: CSSProperties = { margin: 0, fontSize: 12, lineHeight: 1.45, color: 'var(--text-secondary)', overflowWrap: 'break-word' }

// The footer's and the confirm's primary button: the pickers' 52 px accent button.
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

// Until a row is picked the swap button can't be pressed (a disabled button, so Tab skips it).
const SUBMIT_DISABLED_STYLE: CSSProperties = {
  ...SUBMIT_STYLE,
  background: 'var(--surface-raised)',
  color: 'var(--text-dim)',
  cursor: 'default',
}

const BACK_STYLE: CSSProperties = {
  height: 52,
  boxSizing: 'border-box',
  borderRadius: 10,
  ...hairline('var(--border-strong)'),
  background: 'var(--surface)',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.2em',
  color: 'var(--text-primary)',
  cursor: 'pointer',
}

type RowKind = 'radio' | 'swap' | 'add' | 'confirm-add'

/** The chip row, opened with the chip that is on in view (a swap's group can be a long way along: PL6's FOREARMS). */
function ChipRow({ group, onTap, rowRef }: { group: PickerGroup; onTap: (tapped: PickerGroup) => void; rowRef: RefObject<HTMLDivElement | null> }) {
  // On open only: after that the user is the one moving the row.
  useEffect(() => {
    const row = rowRef.current
    const on = row?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (!row || !on) return
    row.scrollLeft = Math.max(0, on.offsetLeft - (row.clientWidth - on.offsetWidth) / 2)
  }, [])

  return (
    <div ref={rowRef} role="group" aria-label={PICKER_TEXT.groupsLabel} className="hide-scrollbar" style={CHIP_ROW_STYLE}>
      {groupChips().map((chip) => (
        <button key={chip.group} type="button" aria-pressed={chip.group === group} onClick={() => onTap(chip.group)} style={chipStyle(chip.group === group)}>
          {chip.label}
        </button>
      ))}
    </div>
  )
}

/** The end of a row: what a tap does (a radio, `⇄` to swap, `+` to add, `›` to the confirm). */
function RowEnd({ kind, on }: { kind: RowKind; on: boolean }) {
  if (kind === 'radio') {
    return (
      <span
        aria-hidden="true"
        style={{
          flex: '0 0 auto',
          boxSizing: 'border-box',
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 2,
          borderStyle: 'solid',
          borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {on ? <span style={{ width: 8, height: 8, borderRadius: 4, background: 'var(--accent)' }} /> : null}
      </span>
    )
  }
  const icon =
    kind === 'swap' ? (
      <ArrowRightLeft size={18} strokeWidth={2} aria-hidden="true" />
    ) : kind === 'add' ? (
      <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
    ) : (
      <ChevronRight size={16} strokeWidth={2.2} aria-hidden="true" />
    )
  return <span style={{ flex: '0 0 auto', display: 'flex', color: kind === 'confirm-add' ? 'var(--text-muted)' : 'var(--accent)' }}>{icon}</span>
}

function ExerciseRow({ exercise, kind, on, showGroup, onTap }: { exercise: Exercise; kind: RowKind; on: boolean; showGroup: boolean; onTap: () => void }) {
  const radio = kind === 'radio'
  return (
    <button
      type="button"
      role={radio ? 'radio' : undefined}
      aria-checked={radio ? on : undefined}
      aria-label={rowLabel(radio ? 'radio' : kind === 'swap' ? 'swap' : 'add', exercise.name)}
      onClick={onTap}
      style={rowStyle(on)}
    >
      <span style={ROW_TEXT_STYLE}>
        <span style={NAME_STYLE}>{exercise.name}</span>
        {showGroup ? <span style={GROUP_STYLE}>{groupLabel(exercise)}</span> : null}
      </span>
      <RowEnd kind={kind} on={on} />
    </button>
  )
}

function readNote(note: ExercisePickerCommonProps['confirmNote'], exercise: Exercise | null): ReactNode {
  return typeof note === 'function' ? note(exercise) : note
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export default function ExercisePickerSheet(props: ExercisePickerSheetProps) {
  const { mode, eyebrow, title, exclude = [], onPick, onClose, onCreate, showGroup = true, confirmLabel, confirmNote } = props
  const replacing = props.mode === 'swap' ? props.replacing : null
  const confirmed = confirmLabel !== undefined
  const stayOpen = props.mode === 'add' && props.stayOpenAfterAdd === true && !confirmed
  const canCreate = onCreate !== undefined

  const { data: library, isError, error: loadError } = useExercises(false)
  const createExercise = useCreateExercise()
  const saving = createExercise.isPending
  const nameId = useId()

  const [group, setGroup] = useState<PickerGroup>(() => openingGroup(replacing?.muscleGroup))
  // Swap with a confirm: the row picked so far. Add with a confirm: the exercise W14 asks about.
  const [picked, setPicked] = useState<Exercise | null>(null)
  const [confirming, setConfirming] = useState<Exercise | null>(null)
  // "+ NEW [GROUP] EXERCISE": the field is open, what is typed in it, and why the last try failed.
  const [creating, setCreating] = useState(false)
  const [typed, setTyped] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  // The sheet can be closed while an exercise is still being saved: nothing is picked for a sheet that is gone.
  // `inFlight` is the double press's guard: `saving` (the mutation's own flag) only turns true once React has drawn again.
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const listRef = useRef<HTMLDivElement>(null)
  const chipsRef = useRef<HTMLDivElement>(null)

  // Focus follows the field: into it when it opens (autoFocus), back to "+ NEW [GROUP] EXERCISE" when it closes.
  const newButtonRef = useRef<HTMLButtonElement>(null)
  const wasCreating = useRef(false)
  useEffect(() => {
    if (!creating && wasCreating.current) newButtonRef.current?.focus()
    wasCreating.current = creating
  }, [creating])

  const loading = library === undefined && !isError
  const everything = library ?? []
  const offered = offeredExercises(everything, replacing ? [replacing.id, ...exclude] : exclude)
  const listed = exercisesInGroup(offered, group)
  // Nothing to say about an empty list while the exercises are still coming (or failed to).
  const empty = library === undefined ? null : emptyKind({ mode, group, inLibrary: exercisesInGroup(everything, group).length, listed: listed.length, canCreate })

  const rowKind: RowKind = mode === 'swap' ? (confirmed ? 'radio' : 'swap') : confirmed ? 'confirm-add' : 'add'

  // Where focus goes when a tap in a list that stays open takes the tapped row away (the caller leaves it
  // out of `exclude` from then on): to the next row, so the next add is one Enter away, else the one before,
  // else the chip that is on. Done before the pick, so the focus is never on a row that is about to go.
  function moveFocusOffRow(exercise: Exercise) {
    const rows = listRef.current ? Array.from(listRef.current.querySelectorAll<HTMLElement>(':scope > button')) : []
    const at = listed.findIndex((e) => e.id === exercise.id)
    // an exercise that was just created isn't a row yet: nothing to move off
    if (at === -1) return
    const neighbour = rows[at + 1] ?? rows[at - 1]
    if (neighbour) neighbour.focus()
    else chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus()
  }

  function choose(exercise: Exercise) {
    if (mode === 'swap' && confirmed) setPicked(exercise)
    else if (mode === 'add' && confirmed) setConfirming(exercise)
    else {
      if (stayOpen) moveFocusOffRow(exercise)
      onPick(exercise)
    }
  }

  function tapChip(tapped: PickerGroup) {
    const next = tapGroup(group, tapped)
    setGroup(next)
    // A new chip is a new list: it starts at its top, not wherever the last one was scrolled to.
    if (listRef.current?.parentElement) listRef.current.parentElement.scrollTop = 0
    // A new exercise belongs to one group: with ALL there is none to make it in.
    if (next === 'all') {
      setCreating(false)
      setTyped('')
      setCreateError(null)
    }
  }

  function closeForm() {
    setCreating(false)
    setTyped('')
    setCreateError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const name = creatableName(typed)
    if (name === null || group === 'all' || inFlight.current) return
    inFlight.current = true
    setCreateError(null)
    try {
      const created = await createExercise.mutateAsync({ name, muscleGroup: group })
      if (!mounted.current) return
      onCreate?.(created)
      closeForm()
      choose(created)
    } catch (error) {
      setCreateError(errorReason(error, isOffline()))
    } finally {
      inFlight.current = false
    }
  }

  function onNameKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Escape') return
    // Cancels the field and nothing else: BottomSheet leaves an Escape that something inside already handled.
    event.preventDefault()
    if (!saving) closeForm()
  }

  const form =
    creating && group !== 'all' ? (
      <form onSubmit={submit} style={FORM_STYLE}>
        <label htmlFor={nameId} style={FORM_CAPTION_STYLE}>
          {newExerciseCaption(group)}
        </label>
        <input
          id={nameId}
          type="text"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={onNameKeyDown}
          readOnly={saving}
          autoFocus
          autoComplete="off"
          enterKeyHint="done"
          style={NAME_INPUT_STYLE}
        />
        {createError !== null ? (
          <div role="alert" style={ERROR_STYLE}>
            <p style={ERROR_HEADLINE_STYLE}>{PICKER_TEXT.createFailed}</p>
            <p style={ERROR_REASON_STYLE}>{createError}</p>
          </div>
        ) : null}
        <div style={BUTTON_PAIR_STYLE}>
          <button type="button" disabled={saving} onClick={closeForm} style={saving ? CANCEL_DISABLED_STYLE : CANCEL_STYLE}>
            {PICKER_TEXT.cancel}
          </button>
          <button type="submit" disabled={saving || creatableName(typed) === null} style={{ ...CREATE_STYLE, opacity: !saving && creatableName(typed) === null ? 0.5 : 1 }}>
            {saving ? PICKER_TEXT.creating : PICKER_TEXT.create}
          </button>
        </div>
      </form>
    ) : null

  // ── the add confirm (W14) ─────────────────────────────────────────────────────────────────────
  if (confirming !== null) {
    const note = readNote(confirmNote, confirming)
    return (
      <BottomSheet eyebrow={eyebrow} title={addConfirmTitle(confirming.name)} onClose={onClose}>
        {note ? <p style={HINT_STYLE}>{note}</p> : null}
        <div style={{ ...BUTTON_PAIR_STYLE, gap: 10 }}>
          <button type="button" onClick={() => setConfirming(null)} style={BACK_STYLE}>
            {PICKER_TEXT.back}
          </button>
          <button type="button" onClick={() => onPick(confirming)} style={SUBMIT_STYLE}>
            {confirmLabel}
          </button>
        </div>
      </BottomSheet>
    )
  }

  // ── the picker ────────────────────────────────────────────────────────────────────────────────
  let body: ReactNode
  if (loading) {
    body = <p style={EMPTY_CAPTION_STYLE}>{PICKER_TEXT.loading}</p>
  } else if (library === undefined) {
    body = (
      <div role="alert" style={{ ...ERROR_STYLE, textAlign: 'center', padding: '24px 0' }}>
        <p style={ERROR_HEADLINE_STYLE}>{PICKER_TEXT.loadFailed}</p>
        <p style={ERROR_REASON_STYLE}>{errorReason(loadError, isOffline())}</p>
      </div>
    )
  } else if (empty === 'group-empty' && group !== 'all') {
    body = <p style={HINT_STYLE}>{groupEmptyLine(group)}</p>
  } else if (empty === 'library-empty') {
    body = <p style={HINT_STYLE}>{canCreate ? PICKER_TEXT.libraryEmptyCreate : PICKER_TEXT.libraryEmpty}</p>
  } else if (empty !== null) {
    body = (
      <div style={LIST_STYLE}>
        <p style={EMPTY_CAPTION_STYLE}>{empty === 'all-added' ? PICKER_TEXT.allAdded : empty === 'no-others' ? PICKER_TEXT.noOthers : PICKER_TEXT.noneInGroup}</p>
      </div>
    )
  } else {
    body = (
      <div ref={listRef} role={confirmed && mode === 'swap' ? 'radiogroup' : 'group'} aria-label={PICKER_TEXT.listLabel} style={LIST_STYLE}>
        {listed.map((exercise) => (
          <ExerciseRow
            key={exercise.id}
            exercise={exercise}
            kind={rowKind}
            on={rowKind === 'radio' && picked?.id === exercise.id}
            showGroup={showGroup}
            onTap={() => choose(exercise)}
          />
        ))}
      </div>
    )
  }

  const loaded = library !== undefined
  // Under the list: the dashed row that opens the field, or, on ALL where nothing can be created, why not.
  const createRow =
    !loaded || !canCreate || empty === 'library-empty' ? null : group === 'all' ? (
      <p style={HINT_STYLE}>{PICKER_TEXT.pickGroupToCreate}</p>
    ) : creating ? null : (
      <button ref={newButtonRef} type="button" onClick={() => setCreating(true)} style={NEW_EXERCISE_BUTTON_STYLE}>
        {newExerciseButton(group)}
      </button>
    )

  const note = mode === 'swap' && confirmed ? readNote(confirmNote, picked) : null
  const footer =
    mode === 'swap' && confirmed && !saving ? (
      <>
        {note ? <p style={HINT_STYLE}>{note}</p> : null}
        <button type="button" disabled={picked === null} onClick={() => picked && onPick(picked)} style={picked === null ? SUBMIT_DISABLED_STYLE : SUBMIT_STYLE}>
          {confirmLabel}
        </button>
      </>
    ) : undefined

  const toolbar = saving ? undefined : (
    <>
      {stayOpen ? <p style={NOTE_STYLE}>{PICKER_TEXT.stayOpen}</p> : null}
      <ChipRow group={group} onTap={tapChip} rowRef={chipsRef} />
    </>
  )

  return (
    <BottomSheet eyebrow={eyebrow} title={title} onClose={onClose} height="tall" toolbar={toolbar} footer={footer}>
      {form}
      {saving ? null : body}
      {saving ? null : createRow}
    </BottomSheet>
  )
}
