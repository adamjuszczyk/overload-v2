import { useState, useRef, useEffect } from 'react'
import { Plus, Trash2, ChevronUp, ChevronDown, X, Link2 } from 'lucide-react'
import type { WeightUnit, WarmupRoutineItem } from '../../types'
import { queryClient } from '../../lib/queryClient'
import {
  useWarmupRoutineItems,
  useAddWarmupItem,
  useUpdateWarmupItemBody,
  useRemoveWarmupItem,
  useReorderWarmupItems,
} from '../programs/usePrograms'
import { moveWarmupItem } from '../programs/warmupRoutineService'
import { MenuButton, MenuAction, MENU_PANEL_STYLE } from '../plan/planMenu'
import { formatRestTime } from '../../lib/formatRestTime'
import { normaliseTempo } from '../../lib/plannerVocabulary.js'

// The design-field editors of the planner's step 2 (StepExercises.tsx) and of a
// stable run's program tab, which reuses it: a rest stepper, the tempo field,
// the weight-unit chips, the superset link toggle and a block's round rests,
// the warmup routine, and the two small helpers they share (IconBtn, Sheet).
//
// Chunk 30 (TASKS-1.1 "Rest, tempo, grouping, the routine and units in the
// Structure view (run-wide)") moved them here from StepExercises.tsx, nothing
// else: each is the same markup, state and callback it was in that file, so
// the planner (and the program tab) render and behave exactly as before. Plan's
// week panel (the STRUCTURE view) is the second user; it passes the same
// mutations the planner does (useUpdateProgramExerciseRest and the rest, all in
// usePrograms.ts / usePlanner.ts), because these fields are run-wide: every
// edit goes to the exercise's own program-exercise row, whichever view makes it.
//
// What the second user adds is optional, and a caller that passes none of it
// gets the planner's markup byte for byte:
//   - RestStepper.ariaLabel: names the − and + buttons ("Less rest", "More
//     rest" for ariaLabel "rest"), so a screen can tell several steppers apart;
//   - SupersetLinkToggle.suffix / BlockRestEditor.everyWeek: an "EVERY WEEK"
//     label beside the control (SPEC Supersets [P1.1]);
//   - UnitChips.style: the planner's row pads it; the ⋯ menu doesn't;
//   - WarmupRoutineEditor variant 'menu' / readOnly: the routine's rows with a
//     ⋯ (standing UI rule: reorder and remove live behind a ⋯, an unset routine
//     shows no placeholder) and a read-only list for a past week.

// ─── Rest stepper (chunk 16) — same +/- stepper shape as PlanPage.tsx's own
// RirStepper (this build's existing rest/RIR pattern), seconds instead of
// RIR: 15s per tap, tapping "−" at the floor clears back to null ("no
// override" — the caller's own defaultText says what that falls through
// to), tapping "+" from null starts at 15s. Capped at 600s (10 min) — generous
// enough for any real rest, so the stepper target that caps RirStepper's own
// range stays meaningful here rather than open-ended.
const REST_STEP_SECONDS = 15
const REST_MAX_SECONDS = 600

export function RestStepper({
  label,
  value,
  disabled,
  onChange,
  defaultText,
  ariaLabel,
}: {
  label: string
  value: number | null
  disabled: boolean
  onChange: (v: number | null) => void
  defaultText: string
  // Chunk 30 — optional; names the two buttons for a screen that shows several
  // steppers at once. Left out, the buttons carry no aria-label (the planner).
  ariaLabel?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flexShrink: 0 }}>
        {label}
      </span>
      <div style={{ display: 'inline-flex', alignItems: 'center', height: 26, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 6, flexShrink: 0 }}>
        <button
          disabled={disabled || value === null}
          aria-label={ariaLabel ? `Less ${ariaLabel}` : undefined}
          onClick={() => {
            if (value === null) return
            onChange(value - REST_STEP_SECONDS <= 0 ? null : value - REST_STEP_SECONDS)
          }}
          style={{ width: 22, height: 26, background: 'transparent', border: 'none', color: (disabled || value === null) ? 'var(--text-dim)' : 'var(--text-muted)', cursor: (disabled || value === null) ? 'default' : 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          −
        </button>
        <span style={{ minWidth: 48, textAlign: 'center', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11, color: value === null ? 'var(--text-dim)' : 'var(--text-primary)' }}>
          {value === null ? defaultText : formatRestTime(value)}
        </span>
        <button
          disabled={disabled}
          aria-label={ariaLabel ? `More ${ariaLabel}` : undefined}
          onClick={() => onChange(Math.min((value ?? 0) + REST_STEP_SECONDS, REST_MAX_SECONDS))}
          style={{ width: 22, height: 26, background: 'transparent', border: 'none', color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ─── Tempo (chunk 17 — SPEC.md "Tempo") ─────────────────────────────────────
// Same tap-to-edit text-input pattern StepVolume.tsx's SetTargetRow/
// ExerciseTargetRow already use for their own parsed free-text design field
// (rep target), inside the same labelled-box shape RestStepper uses just
// above (so the three sit as one row of controls) — reviewer's note: "the
// same row and the same existing input/stepper pattern." Validated by
// plannerVocabulary.ts's normaliseTempo (chunk 2) — the one parser for this
// format anywhere in the app; an invalid entry shows an inline error (same
// "input border turns --error, a message appears below" pattern
// ExerciseForm.tsx's own name field already uses — the one existing inline-
// validation precedent in this codebase) and writes nothing, never closing
// the editor so the message stays visible until fixed. Clearing the field
// (blank, trimmed) writes null, same "no override" meaning REST/REST AFTER
// give an empty stepper.
export function TempoEditor({
  value,
  disabled,
  onChange,
}: {
  value: string | null
  disabled: boolean
  onChange: (tempo: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    if (disabled) return
    setText(value ?? '')
    setError('')
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    if (trimmed === '') {
      setEditing(false)
      setError('')
      if (value !== null) onChange(null)
      return
    }
    const normalised = normaliseTempo(trimmed)
    if (normalised === null) {
      // Refused — stays in edit mode with the raw input still showing, the
      // message right below it; nothing is written (reviewer's note).
      setError('Use 4 fields, e.g. 3-1-1-0 (X allowed)')
      return
    }
    setEditing(false)
    setError('')
    if (normalised !== value) onChange(normalised)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', flexShrink: 0 }}>
        TEMPO
      </span>
      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => { setText(e.target.value); if (error) setError('') }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
            placeholder="3-1-1-0"
            aria-label="Tempo"
            style={{ width: 96, height: 26, background: 'var(--surface)', border: `1px solid ${error ? 'var(--error)' : 'var(--accent)'}`, borderRadius: 6, padding: '0 8px', fontSize: 11, fontFamily: 'var(--font-display)', fontWeight: 800, color: 'var(--text-primary)', boxSizing: 'border-box', outline: 'none' }}
          />
          {error && (
            <span style={{ display: 'block', fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--error)', letterSpacing: '0.5px' }}>
              {error}
            </span>
          )}
        </div>
      ) : (
        <button
          onClick={startEditing}
          disabled={disabled}
          style={{ height: 26, padding: '0 8px', background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 6, cursor: disabled ? 'default' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 11, color: value === null ? 'var(--text-dim)' : 'var(--text-primary)' }}
        >
          {/* '—' (not "NONE" — RestStepper's own REST AFTER already uses
              that exact text for a different, rest-specific meaning right
              in this same row; reusing it here would make the two
              ambiguous to anything querying by text, this file's own
              tests included) — same "nothing set" placeholder ExerciseRow's own
              exercise name fallback and StepVolume.tsx's SetTargetRow both
              already use. */}
          {value ?? '—'}
        </button>
      )}
    </div>
  )
}

// ─── Weight unit (existing field, v3 §2.4 / TASKS.md §4 item 28) ───────────
// INHERIT / KG / LBS. The chips only — the caller brings the "UNIT" label and
// the row around them (StepExercises' ExerciseRow, or Plan's exercise ⋯).
// `style` lets the planner's row pad the chips as it always has.
export function UnitChips({
  value,
  globalUnit,
  disabled,
  onChange,
  style,
}: {
  value: WeightUnit | null
  globalUnit: WeightUnit
  disabled: boolean
  onChange: (unit: WeightUnit | null) => void
  style?: React.CSSProperties
}) {
  return (
    <div style={{ display: 'flex', gap: 4, ...style }}>
      {(
        [
          { value: null, label: `INHERIT (${globalUnit.toUpperCase()})` },
          { value: 'kg' as const, label: 'KG' },
          { value: 'lbs' as const, label: 'LBS' },
        ]
      ).map((opt) => {
        const active = value === opt.value
        return (
          <button
            key={opt.label}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            style={{
              height: 24,
              padding: '0 8px',
              flexShrink: 0,
              background: active ? 'var(--accent-muted)' : 'var(--surface)',
              border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
              borderRadius: 6,
              cursor: disabled ? 'default' : 'pointer',
              fontFamily: 'var(--font-mono)',
              fontSize: 8,
              fontWeight: 700,
              letterSpacing: '1px',
              color: active ? 'var(--accent)' : 'var(--text-muted)',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Superset block rest (chunk 16 — SPEC.md "Rest"/"Supersets") ──────────
// Once per linked unit, right after its last member — "within round"/"after
// round", both overridable, both null by SPEC default (no timer within a
// round; the chain of the exercise that ends a round).
export function BlockRestEditor({
  blockId,
  rest,
  onChange,
  everyWeek = false,
}: {
  blockId: string
  rest: { restWithinRoundSeconds: number | null; restAfterRoundSeconds: number | null } | null
  onChange: (changes: { restWithinRoundSeconds?: number | null; restAfterRoundSeconds?: number | null }) => void
  // Chunk 30 — Plan's STRUCTURE view labels every run-wide control "EVERY WEEK"
  // (SPEC Rest [P1.1]). The planner leaves this off and renders as before.
  everyWeek?: boolean
}) {
  return (
    <div
      key={`block-rest-${blockId}`}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '2px 4px 6px' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)', flexShrink: 0 }}>
        SUPERSET
      </span>
      {everyWeek && <EveryWeekLabel />}
      <RestStepper
        label="WITHIN ROUND"
        value={rest?.restWithinRoundSeconds ?? null}
        disabled={false}
        onChange={(v) => onChange({ restWithinRoundSeconds: v })}
        defaultText="NO TIMER"
        ariaLabel={everyWeek ? 'rest within round' : undefined}
      />
      <RestStepper
        label="AFTER ROUND"
        value={rest?.restAfterRoundSeconds ?? null}
        disabled={false}
        onChange={(v) => onChange({ restAfterRoundSeconds: v })}
        defaultText="PER EXERCISE"
        ariaLabel={everyWeek ? 'rest after round' : undefined}
      />
    </div>
  )
}

// The "EVERY WEEK" label (SPEC Programs and runs / Rest / Tempo / Supersets /
// Warmup routine [P1.1]): rest, tempo, superset grouping and the warmup routine
// are run-wide, so each control for them says so. Plan's STRUCTURE view puts
// one on each; the weight unit is not run-wide in that sense and carries none.
// The "· SUPERSET" marker in Plan's exercise header is the existing
// accent-coloured mono label this one is drawn like.
export function EveryWeekLabel() {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '1px', color: 'var(--accent)', flexShrink: 0 }}>
      EVERY WEEK
    </span>
  )
}

// ─── Warmup routine checklist (chunk 18 — SPEC.md "Warmup routine") ───────
// One per workout. The planner's step 2 shows it below the exercise list
// (variant 'rows', as it always has); Plan's STRUCTURE view shows it at the top
// (variant 'menu', chunk 30). Never gated by volumeReadOnly — no such prop at
// all, same posture RestStepper/TempoEditor already take above.
//
// Variant 'menu' is the same editor under the standing UI rule: each item is
// its text (tap to edit) and a ⋯ holding MOVE UP / MOVE DOWN / REMOVE, instead
// of the three icons the planner's rows carry; an empty routine shows its ADD
// ITEM and no "NO WARMUP ITEMS YET"; and `readOnly` (a past week) is just the
// list. The caller of that variant brings the header and the card around it.
export function WarmupRoutineEditor({
  workoutDayId,
  variant = 'rows',
  readOnly = false,
}: {
  workoutDayId: string
  variant?: 'rows' | 'menu'
  readOnly?: boolean
}) {
  const { data: items = [], isLoading } = useWarmupRoutineItems(workoutDayId)
  const addItem = useAddWarmupItem(workoutDayId)
  const updateItem = useUpdateWarmupItemBody(workoutDayId)
  const removeItem = useRemoveWarmupItem(workoutDayId)
  const reorderItems = useReorderWarmupItems(workoutDayId)

  const [showAdd, setShowAdd] = useState(false)
  const [newText, setNewText] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; body: string } | null>(null)

  // Same "write the optimistic order into this query's cache, then fire the
  // mutation" shape WorkoutEditor's own moveExercise takes for
  // reorderProgramExercises above — moveWarmupItem mirrors moveUnit's own
  // "same reference back = no-op" convention, so a boundary tap is a no-op.
  function moveItem(index: number, direction: 'up' | 'down') {
    const next = moveWarmupItem(items, index, direction)
    if (next === items) return
    const reindexed = next.map((item, i) => ({ ...item, position: i }))
    queryClient.setQueryData(['v2_workoutWarmupItems', workoutDayId], reindexed)
    reorderItems.mutate(reindexed.map((item, i) => ({ id: item.id, position: i })))
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = newText.trim()
    if (!trimmed) return // refused — nothing is written (reviewer's note)
    await addItem.mutateAsync({ body: trimmed, position: items.length })
    setNewText('')
    setShowAdd(false)
  }

  const menu = variant === 'menu'

  const body = (
    <>
      {isLoading && (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
          <div className="animate-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)' }} />
        </div>
      )}

      {!menu && !isLoading && items.length === 0 && !showAdd && (
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-dim)', marginBottom: 8 }}>
          NO WARMUP ITEMS YET
        </p>
      )}

      {!isLoading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: readOnly ? 0 : 8 }}>
          {items.map((item, index) =>
            menu ? (
              <WarmupItemMenuRow
                key={item.id}
                item={item}
                index={index}
                readOnly={readOnly}
                canMoveUp={index > 0}
                canMoveDown={index < items.length - 1}
                onMoveUp={() => moveItem(index, 'up')}
                onMoveDown={() => moveItem(index, 'down')}
                onSave={(text) => updateItem.mutate({ id: item.id, body: text })}
                onDelete={() => setConfirmRemove({ id: item.id, body: item.body })}
              />
            ) : (
              <WarmupItemRow
                key={item.id}
                item={item}
                index={index}
                canMoveUp={index > 0}
                canMoveDown={index < items.length - 1}
                onMoveUp={() => moveItem(index, 'up')}
                onMoveDown={() => moveItem(index, 'down')}
                onSave={(text) => updateItem.mutate({ id: item.id, body: text })}
                onDelete={() => setConfirmRemove({ id: item.id, body: item.body })}
              />
            ),
          )}
        </div>
      )}

      {!readOnly && (showAdd ? (
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 6 }}>
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onBlur={() => { if (!newText.trim()) setShowAdd(false) }}
            placeholder="e.g. 5 min easy bike"
            autoFocus
            aria-label="New warmup item"
            style={{ flex: 1, height: 36, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 8, padding: '0 10px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box' }}
          />
          <button
            type="submit"
            disabled={addItem.isPending}
            style={{ height: 36, padding: '0 14px', flexShrink: 0, background: 'var(--accent)', border: 'none', borderRadius: 8, cursor: addItem.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 10, letterSpacing: '1px', color: 'var(--base)' }}
          >
            ADD
          </button>
        </form>
      ) : (
        <button
          onClick={() => { setNewText(''); setShowAdd(true) }}
          style={{ width: '100%', height: 36, background: 'transparent', border: '1px dashed var(--border-strong)', borderRadius: 8, color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontFamily: 'var(--font-sans)', fontWeight: 700, fontSize: 11 }}
        >
          <Plus size={12} style={{ color: 'var(--accent)' }} />
          ADD ITEM
        </button>
      ))}

      {confirmRemove && (
        <Sheet onClose={() => setConfirmRemove(null)}>
          <p style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', marginBottom: 8 }}>
            Remove this item?
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '1px', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 20 }}>
            "{confirmRemove.body}" — this cannot be undone.
          </p>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setConfirmRemove(null)}
              style={{ flex: 1, height: 50, background: 'var(--surface)', border: '1px solid var(--border-strong)', borderRadius: 10, cursor: 'pointer', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 12, letterSpacing: '1px', color: 'var(--text-secondary)' }}
            >
              CANCEL
            </button>
            <button
              onClick={() => { removeItem.mutate(confirmRemove.id); setConfirmRemove(null) }}
              disabled={removeItem.isPending}
              style={{ flex: 1, height: 50, background: 'rgba(248, 113, 113, 0.15)', border: 'none', borderRadius: 10, cursor: removeItem.isPending ? 'not-allowed' : 'pointer', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 13, letterSpacing: '1.5px', color: 'var(--error)' }}
            >
              {removeItem.isPending ? '…' : 'REMOVE'}
            </button>
          </div>
        </Sheet>
      )}
    </>
  )

  if (menu) return <div>{body}</div>

  return (
    <div style={{ padding: '0 16px 16px' }}>
      <div style={{ height: 1, background: 'var(--border-subtle)', marginBottom: 12 }} />
      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', color: 'var(--text-muted)', marginBottom: 8 }}>
        WARMUP ROUTINE
      </p>
      {body}
    </div>
  )
}

// One item row — tap-to-edit text (same pattern TempoEditor above uses),
// plus the same up/down/delete IconBtn cluster ExerciseRow's own structure
// row uses. A blank commit is refused — the editor just closes, re-showing
// item.body (the last saved value), same "trimmed falsy => no write, no
// forced revert needed since nothing local held the stale text" posture
// WorkoutEditor's own saveName already takes for a workout's own name.
function WarmupItemRow({
  item,
  index,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onSave,
  onDelete,
}: {
  item: WarmupRoutineItem
  index: number
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onSave: (body: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    setText(item.body)
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    setEditing(false)
    if (trimmed && trimmed !== item.body) onSave(trimmed)
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 11, color: 'var(--text-dim)', flexShrink: 0, minWidth: 16 }}>
        {String(index + 1).padStart(2, '0')}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
          aria-label="Warmup item text"
          style={{ flex: 1, height: 32, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 7, padding: '0 8px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box' }}
        />
      ) : (
        <button
          onClick={startEditing}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: '6px 0', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        >
          {item.body}
        </button>
      )}
      <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
        <IconBtn onClick={onMoveUp} disabled={!canMoveUp}><ChevronUp size={13} /></IconBtn>
        <IconBtn onClick={onMoveDown} disabled={!canMoveDown}><ChevronDown size={13} /></IconBtn>
        <IconBtn onClick={onDelete}><Trash2 size={12} /></IconBtn>
      </div>
    </div>
  )
}

// The 'menu' variant's item row (chunk 30, standing UI rule): the same
// tap-to-edit text and the same blank-refused commit as WarmupItemRow above,
// with MOVE UP / MOVE DOWN / REMOVE behind a ⋯ on the row. A past week's
// routine is read-only: the text, no ⋯.
function WarmupItemMenuRow({
  item,
  index,
  readOnly,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onSave,
  onDelete,
}: {
  item: WarmupRoutineItem
  index: number
  readOnly: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onSave: (body: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function startEditing() {
    setText(item.body)
    setEditing(true)
  }

  function commit() {
    const trimmed = text.trim()
    setEditing(false)
    if (trimmed && trimmed !== item.body) onSave(trimmed)
  }

  // Every menu action closes the menu: it was opened for one action.
  const act = (fn: () => void) => () => {
    setMenuOpen(false)
    fn()
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 11, color: 'var(--text-dim)', flexShrink: 0, minWidth: 16 }}>
          {String(index + 1).padStart(2, '0')}
        </span>
        {readOnly ? (
          <span style={{ flex: 1, minWidth: 0, padding: '6px 0', fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.body}
          </span>
        ) : editing ? (
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
            aria-label="Warmup item text"
            style={{ flex: 1, minWidth: 0, height: 32, background: 'var(--surface)', border: '1px solid var(--accent)', borderRadius: 7, padding: '0 8px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', boxSizing: 'border-box' }}
          />
        ) : (
          <button
            onClick={startEditing}
            style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: '6px 0', fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {item.body}
          </button>
        )}
        {!readOnly && (
          <MenuButton open={menuOpen} onClick={() => setMenuOpen((v) => !v)} ariaLabel={`Options for warmup item ${index + 1}`} />
        )}
      </div>
      {!readOnly && menuOpen && (
        <div style={{ ...MENU_PANEL_STYLE, margin: '2px 0 8px' }}>
          <MenuAction onClick={act(onMoveUp)} disabled={!canMoveUp} ariaLabel={`Move warmup item ${index + 1} up`}>
            <ChevronUp size={13} />
            MOVE UP
          </MenuAction>
          <MenuAction onClick={act(onMoveDown)} disabled={!canMoveDown} ariaLabel={`Move warmup item ${index + 1} down`}>
            <ChevronDown size={13} />
            MOVE DOWN
          </MenuAction>
          <MenuAction onClick={act(onDelete)} danger ariaLabel={`Remove warmup item ${index + 1}`}>
            <Trash2 size={13} />
            REMOVE
          </MenuAction>
        </div>
      )}
    </div>
  )
}

export function IconBtn({
  onClick,
  disabled = false,
  children,
}: {
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', border: 'none', color: disabled ? 'var(--text-dim)' : 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer', borderRadius: 6, flexShrink: 0 }}
    >
      {children}
    </button>
  )
}

// ─── Superset grouping editor — one toggle per gap between adjacent rows
// (chunk 13, SPEC.md "Supersets") ───────────────────────────────────────────
// Deliberately between every pair of rows, not just at a unit's own edges:
// "any number of exercises" (SPEC) falls out of being able to link/unlink
// at any point, including splitting an existing 3+ member block part way
// through (supersetGroups.ts's planLinkToggle).
export function SupersetLinkToggle({
  linked,
  disabled,
  onToggle,
  suffix,
}: {
  linked: boolean
  disabled: boolean
  onToggle: () => void
  // Chunk 30 — Plan's STRUCTURE view puts its "EVERY WEEK" label here. Left
  // out (the planner), the button is exactly the label it always was.
  suffix?: React.ReactNode
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      style={{
        width: '100%',
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        background: linked ? 'var(--accent-muted)' : 'transparent',
        border: linked ? '1px solid var(--accent)' : '1px dashed var(--border-strong)',
        borderRadius: 7,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '1.5px',
        color: linked ? 'var(--accent)' : 'var(--text-muted)',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <Link2 size={11} />
      {linked ? 'SUPERSET — TAP TO UNLINK' : 'LINK AS SUPERSET'}
      {suffix}
    </button>
  )
}

// ─── Small local bottom sheet — same shape every programs/plan page already
// repeats its own copy of (ProgramPage.tsx's own BottomSheet is the closest
// precedent); not shared, following this codebase's existing convention of
// each file carrying its own small presentational helpers.
export function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(6,6,7,0.88)', zIndex: 50, display: 'flex', alignItems: 'flex-end' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface-raised)', borderRadius: '20px 20px 0 0', width: '100%', padding: '24px 20px', paddingBottom: 'calc(24px + env(safe-area-inset-bottom))', border: '1px solid var(--border)', borderBottom: 'none', maxHeight: '85dvh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: -8 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{ width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-overlay)', border: '1px solid var(--border-strong)', borderRadius: 7, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <X size={13} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
