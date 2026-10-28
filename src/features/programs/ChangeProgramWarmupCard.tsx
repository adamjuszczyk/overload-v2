import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { hairline } from '../../components/pickers/pickerControls'
import type { DraftRoutine } from './changeProgramDraft'

// Chunk 51a (TASKS-1.2; boards PL1 "2 · WARMUP ROUTINE", PL8 "Remove warmup item", PL9 "WARMUP ROUTINE · EDITING / TAPPED / ADDING /
// NO ITEMS"): the warmup routine of the selected workout, run-wide ("EVERY WEEK"). An item is one line of text (the model stores a
// body, `Dead hang, 30 s`): tap its text to edit it where it stands, ⋯ for MOVE UP / MOVE DOWN / REMOVE (the standing UI rule:
// reorder and remove live behind a ⋯), "+ ADD ITEM" for a new one. REMOVE asks first (PL8). Everything goes into the draft.
//
// Provisional under D31, because no board draws it: the ⋯ on an item (PL1 draws a grip and the text; TASKS 51a says "⋯ MOVE UP/DOWN/
// REMOVE", and PL9's "TAPPED AN ITEM" shows what it opens), and the split of the body at its last comma into a name and a dose
// (PL1 draws "Dead hang" and "30 s" apart; PL8 quotes the body whole).

/** `Dead hang, 30 s` → the name and the dose PL1 draws apart. A body with no comma is a name alone. */
export function splitDose(body: string): { name: string; dose: string | null } {
  const at = body.lastIndexOf(', ')
  return at < 0 ? { name: body, dose: null } : { name: body.slice(0, at), dose: body.slice(at + 2) }
}

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }

function SmallGrip() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--text-dim)" aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}

const FIELD: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: 44,
  boxSizing: 'border-box',
  borderRadius: 10,
  ...hairline('var(--accent)'),
  borderWidth: 2,
  background: 'var(--surface)',
  padding: '0 12px',
  // 16 px: iOS zooms into a smaller field on focus.
  fontSize: 16,
  color: 'var(--text-primary)',
  outline: 'none',
}

function EditRow({ initial, onCommit, onCancel }: { initial: string; onCommit: (body: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(initial)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => ref.current?.focus(), [])
  function finish(commit: boolean) {
    if (done.current) return
    done.current = true
    if (commit) onCommit(text)
    else onCancel()
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
      <input
        ref={ref}
        aria-label="Warmup item"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') finish(true)
          if (e.key === 'Escape') finish(false)
        }}
        style={FIELD}
      />
    </div>
  )
}

function AddRow({ onAdd, onCancel }: { onAdd: (body: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.focus(), [])
  function add() {
    if (text.trim() === '') return
    onAdd(text)
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44 }}>
      <input
        ref={ref}
        aria-label="New warmup item"
        value={text}
        placeholder="e.g. 5 min easy bike"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') add()
          if (e.key === 'Escape') onCancel()
        }}
        style={FIELD}
      />
      <button
        type="button"
        disabled={text.trim() === ''}
        onClick={add}
        style={{
          ...MONO,
          flex: '0 0 auto',
          height: 44,
          padding: '0 14px',
          borderRadius: 10,
          borderWidth: 0,
          background: 'var(--accent)',
          color: 'var(--on-accent)',
          fontWeight: 700,
          fontSize: 11,
          letterSpacing: '0.15em',
          opacity: text.trim() === '' ? 0.5 : 1,
          cursor: text.trim() === '' ? 'default' : 'pointer',
        }}
      >
        ADD
      </button>
    </div>
  )
}

function MenuAction({ label, icon, disabled, danger, onClick }: { label: string; icon: ReactNode; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...MONO,
        width: '100%',
        minHeight: 48,
        boxSizing: 'border-box',
        borderWidth: '0 0 1px',
        borderStyle: 'solid',
        borderColor: 'var(--border-subtle)',
        background: 'transparent',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 10,
        padding: '0 2px',
        fontSize: 11,
        letterSpacing: '0.15em',
        color: disabled ? 'var(--text-dim)' : danger ? 'var(--error)' : 'var(--text-primary)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {label}
      {icon}
    </button>
  )
}

export interface ChangeProgramWarmupCardProps {
  /** The card's number on the screen: `1 · WARMUP ROUTINE` when there is no DAYS card above it, `2 ·` with one. */
  number: number
  items: readonly DraftRoutine[]
  /** `EVERY WEEK`, or `EVERY CYCLE` on a sequence run. */
  everyText: string
  /** PL8's "leaves the routine for every week". */
  everyWord: string
  onAdd: (body: string) => void
  onEdit: (key: string, body: string) => void
  onMove: (key: string, direction: 'up' | 'down') => void
  onRemove: (key: string) => void
}

export default function ChangeProgramWarmupCard(p: ChangeProgramWarmupCardProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [confirming, setConfirming] = useState<DraftRoutine | null>(null)
  const menuIndex = p.items.findIndex((i) => i.key === menu)

  return (
    <div style={{ background: 'var(--surface)', ...hairline('var(--border)'), borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ ...MONO, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }}>{p.number} · WARMUP ROUTINE</span>
        <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>{p.everyText}</span>
      </div>

      {p.items.map((item) => {
        if (editing === item.key) {
          return (
            <EditRow
              key={item.key}
              initial={item.body}
              onCommit={(body) => {
                setEditing(null)
                // A blank item is refused by the planner and by the table's CHECK: the old text stays.
                if (body.trim() !== '' && body.trim() !== item.body) p.onEdit(item.key, body.trim())
              }}
              onCancel={() => setEditing(null)}
            />
          )
        }
        const { name, dose } = splitDose(item.body)
        const open = menu === item.key
        return (
          <div key={item.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minHeight: 44,
                ...(open ? { background: 'var(--accent-muted)', borderRadius: 8, padding: '0 8px', margin: '0 -8px' } : {}),
              }}
            >
              <SmallGrip />
              <button
                type="button"
                aria-label={`Edit ${item.body}`}
                onClick={() => {
                  setMenu(null)
                  setEditing(item.key)
                }}
                style={{ flex: 1, minWidth: 0, minHeight: 44, padding: 0, borderWidth: 0, background: 'transparent', textAlign: 'left', fontSize: 15, color: 'var(--text-primary)', overflowWrap: 'anywhere', cursor: 'text' }}
              >
                {name}
              </button>
              {dose !== null && <span style={{ ...MONO, fontSize: 12, color: 'var(--text-secondary)' }}>{dose}</span>}
              <button
                type="button"
                aria-label={`${item.body}: options`}
                aria-expanded={open}
                onClick={() => setMenu(open ? null : item.key)}
                style={{ flex: '0 0 auto', width: 36, height: 36, padding: 0, borderWidth: 0, background: 'transparent', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
            </div>
            {open && (
              <div style={{ marginLeft: 24, borderRadius: 10, background: 'var(--surface-raised)', padding: '0 12px' }}>
                <MenuAction
                  label="MOVE UP"
                  disabled={menuIndex <= 0}
                  icon={<ChevronUp size={14} aria-hidden="true" />}
                  onClick={() => p.onMove(item.key, 'up')}
                />
                <MenuAction
                  label="MOVE DOWN"
                  disabled={menuIndex === p.items.length - 1}
                  icon={<ChevronDown size={14} aria-hidden="true" />}
                  onClick={() => p.onMove(item.key, 'down')}
                />
                <MenuAction
                  label="REMOVE"
                  danger
                  icon={<Trash2 size={14} aria-hidden="true" />}
                  onClick={() => {
                    setMenu(null)
                    setConfirming(item)
                  }}
                />
              </div>
            )}
          </div>
        )
      })}

      {adding ? (
        <AddRow
          onAdd={(body) => {
            setAdding(false)
            p.onAdd(body.trim())
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          style={{ ...MONO, height: 44, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--border-strong)', background: 'transparent', fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-secondary)', cursor: 'pointer' }}
        >
          + ADD ITEM
        </button>
      )}

      {confirming && (
        <ConfirmDialog
          title="Remove this item?"
          body={`"${confirming.body}" leaves the routine for every ${p.everyWord}. This can't be undone.`}
          confirmLabel="REMOVE"
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={() => {
            p.onRemove(confirming.key)
            setConfirming(null)
          }}
        />
      )}
    </div>
  )
}
