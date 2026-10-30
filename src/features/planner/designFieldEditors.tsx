import { useState, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import { Trash2, ChevronUp, ChevronDown, Link2 } from 'lucide-react'
import type { WeightUnit, WarmupRoutineItem } from '../../types'
import { queryClient } from '../../lib/queryClient'
import ConfirmDialog from '../../components/ConfirmDialog'
import { hairline } from '../../components/pickers/pickerControls'
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
import { CAPTION, IconButton, MONO, ruleAbove } from './plannerChrome'

// The design-field editors of the planner's step 2 (StepExercises.tsx): a rest stepper, the weight-unit chips, a block's round rests, the warmup
// routine, and the superset link toggle CHANGE THE PROGRAM's cards also use. (The tempo field was here until 1.2.1 chunk 79: the TEMPO row opens the
// tempo picker, `components/pickers/TempoPicker.tsx`, and the planner's `TempoField` and CHANGE THE PROGRAM's sheet draw the row.)
//
// Chunk 30 (TASKS-1.1 "Rest, tempo, grouping, the routine and units in the Structure view (run-wide)") moved them here from StepExercises.tsx so
// Plan's STRUCTURE view could show the same editors; that view is gone (Plan's program tab went in chunk 33, its structure rows in chunk 54a), and
// the planner and CHANGE THE PROGRAM (the link toggle alone) are the users left. Chunk 68 draws the planner's editors as boards PP2, PP2e and PP2f do:
// 44 px controls on a two-column row (the label, then the control), the unit as one segmented box, a field that is set in the muted accent, the
// warmup items as rows with the three arrows at their right. Every field keeps its
// props and what it calls back with; the writes are the callers' and are unchanged.
//
// What the second user added stays optional, and a caller that passes none of it gets the planner's markup:
//   - RestStepper.ariaLabel: names the − and + buttons ("Less rest", "More rest" for ariaLabel "rest"), so a screen can tell several steppers apart;
//   - SupersetLinkToggle.suffix / BlockRestEditor.everyWeek: an "EVERY WEEK" label beside the control (SPEC Supersets [P1.1]);
//   - UnitChips.style: the root's own style;
//   - WarmupRoutineEditor variant 'menu' / readOnly: the routine's rows with a ⋯ (standing UI rule) and a read-only list.

const LABEL: CSSProperties = { ...MONO, fontSize: 10, letterSpacing: '0.12em', color: 'var(--text-muted)' }

// The two-column row the boards draw (PP2): the label in a 92 px column, the control in the rest.
const FIELD_ROW: CSSProperties = { display: 'grid', gridTemplateColumns: '92px minmax(0, 1fr)', alignItems: 'center' }

// ─── Rest stepper (chunk 16) — same +/- stepper shape as PlanPage.tsx's own RirStepper (this build's existing rest/RIR pattern), seconds
// instead of RIR: 15s per tap, tapping "−" at the floor clears back to null ("no override" — the caller's own defaultText says what that falls
// through to), tapping "+" from null starts at 15s. Capped at 600s (10 min) — generous enough for any real rest, so the stepper target that caps
// RirStepper's own range stays meaningful here rather than open-ended. A value that is set is drawn in the muted accent (PP2's REST).
const REST_STEP_SECONDS = 15
const REST_MAX_SECONDS = 600

const STEP_BUTTON: CSSProperties = { height: '100%', padding: 0, borderWidth: 0, background: 'transparent', fontSize: 16, lineHeight: 1 }

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
  // Chunk 30 — optional; names the two buttons for a screen that shows several steppers at once.
  ariaLabel?: string
}) {
  const set = value !== null
  const lessOff = disabled || value === null
  return (
    <div style={FIELD_ROW}>
      <span style={LABEL}>{label}</span>
      <div
        style={{ display: 'grid', gridTemplateColumns: '44px minmax(0, 1fr) 44px', height: 44, boxSizing: 'border-box', alignItems: 'center', borderRadius: 8, ...hairline(set ? 'var(--accent)' : 'var(--border)'), background: set ? 'var(--accent-muted)' : 'var(--surface)' }}
      >
        <button
          type="button"
          disabled={lessOff}
          aria-label={ariaLabel ? `Less ${ariaLabel}` : undefined}
          onClick={() => {
            if (value === null) return
            onChange(value - REST_STEP_SECONDS <= 0 ? null : value - REST_STEP_SECONDS)
          }}
          style={{ ...STEP_BUTTON, color: lessOff ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: lessOff ? 'default' : 'pointer' }}
        >
          −
        </button>
        <span style={{ ...MONO, textAlign: 'center', fontSize: set ? 13 : 11, fontWeight: set ? 700 : 600, letterSpacing: set ? 0 : '0.06em', color: set ? 'var(--accent)' : 'var(--text-muted)', overflowWrap: 'anywhere' }}>
          {value === null ? defaultText : formatRestTime(value)}
        </span>
        <button
          type="button"
          disabled={disabled}
          aria-label={ariaLabel ? `More ${ariaLabel}` : undefined}
          onClick={() => onChange(Math.min((value ?? 0) + REST_STEP_SECONDS, REST_MAX_SECONDS))}
          style={{ ...STEP_BUTTON, color: disabled ? 'var(--text-dim)' : 'var(--text-secondary)', cursor: disabled ? 'default' : 'pointer' }}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ─── Weight unit (existing field, v3 §2.4 / TASKS.md §4 item 28) ───────────
// INHERIT / KG / LBS, one segmented box (PP2); the caller brings the "UNIT" label and the row around it. `style` is the root's own.
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
  style?: CSSProperties
}) {
  const options = [
    { value: null, label: `INHERIT (${globalUnit.toUpperCase()})` },
    { value: 'kg' as const, label: 'KG' },
    { value: 'lbs' as const, label: 'LBS' },
  ]
  return (
    <div
      role="group"
      aria-label="Unit"
      style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr 1fr', height: 44, boxSizing: 'border-box', borderRadius: 8, ...hairline('var(--border)'), background: 'var(--surface)', overflow: 'hidden', ...style }}
    >
      {options.map((opt, i) => {
        const active = value === opt.value
        return (
          <button
            key={opt.label}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            style={{
              ...MONO,
              padding: 0,
              borderTopWidth: 0,
              borderRightWidth: 0,
              borderBottomWidth: 0,
              borderLeftWidth: i === 0 ? 0 : 1,
              borderStyle: 'solid',
              borderColor: 'transparent',
              borderLeftColor: 'var(--border-subtle)',
              background: active ? 'var(--accent-muted)' : 'var(--surface)',
              color: active ? 'var(--accent)' : 'var(--text-secondary)',
              fontSize: 10,
              letterSpacing: i === 0 ? '0.04em' : '0.1em',
              cursor: disabled ? 'default' : 'pointer',
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
// "SUPERSET REST" under a member's own fields (PP2): "within round" / "after round", both overridable, both null by SPEC default (no timer within a
// round; the chain of the exercise that ends a round). The one block's two fields are the same whichever of its members is open. The steppers are
// named as the board names them ("Less rest within round").
export function BlockRestEditor({
  blockId,
  rest,
  onChange,
  everyWeek = false,
}: {
  blockId: string
  rest: { restWithinRoundSeconds: number | null; restAfterRoundSeconds: number | null } | null
  onChange: (changes: { restWithinRoundSeconds?: number | null; restAfterRoundSeconds?: number | null }) => void
  // Chunk 30 — a screen that labels every run-wide control "EVERY WEEK" (SPEC Rest [P1.1]). The planner leaves this off.
  everyWeek?: boolean
}) {
  return (
    <div key={`block-rest-${blockId}`} style={{ marginTop: 8, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 8, ...ruleAbove() }}>
      <span style={{ ...MONO, display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, letterSpacing: '0.2em', color: 'var(--accent)' }}>
        SUPERSET REST
        {everyWeek && <EveryWeekLabel />}
      </span>
      <RestStepper
        label="WITHIN ROUND"
        value={rest?.restWithinRoundSeconds ?? null}
        disabled={false}
        onChange={(v) => onChange({ restWithinRoundSeconds: v })}
        defaultText="NO TIMER"
        ariaLabel="rest within round"
      />
      <RestStepper
        label="AFTER ROUND"
        value={rest?.restAfterRoundSeconds ?? null}
        disabled={false}
        onChange={(v) => onChange({ restAfterRoundSeconds: v })}
        defaultText="PER EXERCISE"
        ariaLabel="rest after round"
      />
    </div>
  )
}

// The "EVERY WEEK" label (SPEC Programs and runs / Rest / Tempo / Supersets / Warmup routine [P1.1]): rest, tempo, superset grouping and the warmup
// routine are run-wide, so a screen that shows them beside week-by-week fields says so.
export function EveryWeekLabel() {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, fontWeight: 700, letterSpacing: '1px', color: 'var(--accent)', flexShrink: 0 }}>
      EVERY WEEK
    </span>
  )
}

// ─── Warmup routine checklist (chunk 18 — SPEC.md "Warmup routine") ───────
// One per workout. The planner's step 2 shows it below the exercise list (variant 'rows', as it always has: PP2, PP2f, PP6); variant 'menu'
// (chunk 30) is the same editor under the standing UI rule: each item is its text (tap to edit) and a ⋯ holding MOVE UP / MOVE DOWN / REMOVE
// instead of the three arrows the planner's rows carry; an empty routine shows its ADD ITEM and no "NO WARMUP ITEMS YET"; and `readOnly` (a past
// week) is just the list. The caller of that variant brings the header and the card around it. Never gated by volumeReadOnly — no such prop at
// all, same posture RestStepper already takes above.
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

  // Same "write the optimistic order into this query's cache, then fire the mutation" shape WorkoutCard's own moveExercise takes for
  // reorderProgramExercises — moveWarmupItem mirrors moveUnit's own "same reference back = no-op" convention, so a boundary tap is a no-op.
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
          <div role="status" aria-label="Loading the warmup routine" className="animate-spin" style={{ width: 14, height: 14, borderRadius: '50%', boxSizing: 'border-box', borderWidth: 2, borderStyle: 'solid', borderTopColor: 'var(--accent)', borderRightColor: 'var(--border-strong)', borderBottomColor: 'var(--border-strong)', borderLeftColor: 'var(--border-strong)' }} />
        </div>
      )}

      {!menu && !isLoading && items.length === 0 && !showAdd && (
        <span style={{ ...CAPTION, letterSpacing: '0.12em', padding: '8px 0' }}>NO WARMUP ITEMS YET</span>
      )}

      {!isLoading && items.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: menu ? 6 : 0, marginBottom: readOnly ? 0 : 8 }}>
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
        <form onSubmit={handleAdd} style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onBlur={() => { if (!newText.trim()) setShowAdd(false) }}
            placeholder="e.g. 5 min easy bike"
            autoFocus
            aria-label="New warmup item"
            style={{ flex: 1, minWidth: 0, height: 44, boxSizing: 'border-box', borderRadius: 10, ...hairline('var(--border-strong)'), background: 'var(--surface)', padding: '0 14px', fontSize: 16, color: 'var(--text-primary)', outline: 'none' }}
          />
          <button
            type="submit"
            disabled={addItem.isPending}
            style={{ ...MONO, flex: '0 0 auto', height: 44, padding: '0 18px', borderRadius: 10, borderWidth: 0, background: 'var(--accent)', color: 'var(--on-accent)', fontWeight: 700, fontSize: 11, letterSpacing: '0.2em', cursor: addItem.isPending ? 'default' : 'pointer' }}
          >
            ADD
          </button>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => { setNewText(''); setShowAdd(true) }}
          style={{ ...MONO, width: '100%', height: 44, boxSizing: 'border-box', borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--border-strong)', background: 'transparent', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 10, letterSpacing: '0.2em', cursor: 'pointer' }}
        >
          <span aria-hidden="true">+</span>
          ADD ITEM
        </button>
      ))}

      {confirmRemove && (
        <ConfirmDialog
          title="Remove this item?"
          body={<span style={{ overflowWrap: 'anywhere' }}>{`“${confirmRemove.body}”. This can't be undone.`}</span>}
          confirmLabel="REMOVE"
          danger
          isPending={removeItem.isPending}
          onConfirm={() => { removeItem.mutate(confirmRemove.id); setConfirmRemove(null) }}
          onCancel={() => setConfirmRemove(null)}
        />
      )}
    </>
  )

  if (menu) return <div>{body}</div>

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={CAPTION}>WARMUP ROUTINE</span>
      {body}
    </div>
  )
}

// One item row — tap-to-edit text, plus the arrows and the trash PP2 draws at its right. A blank commit is
// refused — the editor just closes, re-showing item.body (the last saved value), same "trimmed falsy => no write, no forced revert needed since
// nothing local held the stale text" posture WorkoutCard's own saveName already takes for a workout's own name.
function WarmupItemRow({
  item,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onSave,
  onDelete,
}: {
  item: WarmupRoutineItem
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
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: -10 }}>
      {editing ? (
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur() }}
          aria-label="Warmup item text"
          style={{ flex: 1, minWidth: 0, height: 44, boxSizing: 'border-box', borderRadius: 10, borderWidth: 2, borderStyle: 'solid', borderColor: 'var(--accent)', background: 'var(--surface)', padding: '0 12px', fontSize: 16, color: 'var(--text-primary)', outline: 'none' }}
        />
      ) : (
        <button
          type="button"
          aria-label={`Edit ${item.body}`}
          onClick={startEditing}
          style={{ flex: 1, minWidth: 0, height: 44, padding: 0, borderWidth: 0, background: 'transparent', display: 'flex', alignItems: 'center', textAlign: 'left', fontSize: 15, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
        >
          {item.body}
        </button>
      )}
      <IconButton label={`Move ${item.body} up`} onClick={onMoveUp} disabled={!canMoveUp}>
        <ChevronUp size={16} strokeWidth={2.2} />
      </IconButton>
      <IconButton label={`Move ${item.body} down`} onClick={onMoveDown} disabled={!canMoveDown}>
        <ChevronDown size={16} strokeWidth={2.2} />
      </IconButton>
      <IconButton label={`Remove ${item.body}`} onClick={onDelete}>
        <Trash2 size={16} />
      </IconButton>
    </div>
  )
}

// The 'menu' variant's item row (chunk 30, standing UI rule): the same tap-to-edit text and the same blank-refused commit as WarmupItemRow above,
// with MOVE UP / MOVE DOWN / REMOVE behind a ⋯ on the row. A past week's routine is read-only: the text, no ⋯.
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

// ─── Superset grouping editor — one toggle per gap between adjacent rows
// (chunk 13, SPEC.md "Supersets") ───────────────────────────────────────────
// Deliberately between every pair of rows, not just at a unit's own edges: "any number of exercises" (SPEC) falls out of being able to link/unlink at
// any point, including splitting an existing 3+ member block part way through (supersetGroups.ts's planLinkToggle). CHANGE THE PROGRAM's cards draw
// this one (UNLINK between a superset's members); the planner's own is the board's icon in the rail (StepExercises.tsx's LinkGap).
export function SupersetLinkToggle({
  linked,
  disabled,
  onToggle,
  suffix,
}: {
  linked: boolean
  disabled: boolean
  onToggle: () => void
  // Chunk 30 — a screen's "EVERY WEEK" label goes here. Left out, the button is exactly the label it always was.
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
