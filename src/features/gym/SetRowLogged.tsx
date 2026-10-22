// Chunk 58a — a logged set's row (boards W1, W2, W3): a compact line with its numbers, a pen and a tick (SPEC [1.2] "Row states":
// "logged → compact read-only line with a tick and a pen"). A drop carries its kind (board W3: DROP, REST-PAUSE, MYO-REPS, CLUSTER).
// The pen opens today's inline edit until chunk 61's edit panel replaces it (the numbers, FORM, SAVE; DELETE with its confirm sits in
// the edit, where board W2b puts it); the writes are today's: `onUpdate` is `updateSetLog`'s patch, `onDelete` the cascade delete.
import { useState } from 'react'
import { Pencil } from 'lucide-react'
import type { FormRating, SetLog, WeightUnit } from '../../types'
import type { ResolvedRow } from './workoutRules'
import { resolveEditedWeightKg, toDisplayWeight } from '../../lib/weightUnit'
import { FORM_SCALE } from './ratingScales'
import RatingChips from './RatingChips'
import { FAILED_ROW_BACKGROUND, RowLabel, SyncMark, boxStyle, rowFrame, useRowSyncFailed } from './setRowParts'
import { loggedText, rowLabelText, stageKindWord } from './workoutRowView'

interface SetRowLoggedProps {
  row: ResolvedRow
  log: SetLog
  resolvedUnit: WeightUnit
  onUpdate: (changes: { weight: number | null; reps: number | null; rir: number | null; formRating: FormRating | null }) => void
  onDelete: () => void
}

const MONO = 'var(--font-mono)'

export default function SetRowLogged({ row, log, resolvedUnit, onUpdate, onDelete }: SetRowLoggedProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editWeight, setEditWeight] = useState('')
  const [editReps, setEditReps] = useState('')
  const [editRir, setEditRir] = useState('')
  const [editForm, setEditForm] = useState<FormRating | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [logError, setLogError] = useState('')
  // Board W6: a row whose write stopped retrying is tinted (and says ONLY ON THIS PHONE · RETRY).
  const syncFailed = useRowSyncFailed(log.id)

  // Display and edit in the unit this set was logged in (v3 §2.4); a log from before that column reads today's resolved default.
  const unit = log.enteredUnit ?? resolvedUnit
  const isStage = row.kind === 'stage'

  function startEdit() {
    setEditWeight(log.weight != null ? String(toDisplayWeight(log.weight, unit)) : '')
    setEditReps(log.reps != null ? String(log.reps) : '')
    setEditRir(log.rir != null ? String(log.rir) : '')
    setEditForm(log.formRating)
    setLogError('')
    setConfirmDelete(false)
    setIsEditing(true)
  }

  function saveEdit() {
    const editedDisplay = editWeight.trim() === '' ? null : parseFloat(editWeight.replace(',', '.'))
    // A non-numeric edit must not write NaN through to Supabase, which would serialize it as a silent NULL.
    if (editedDisplay !== null && Number.isNaN(editedDisplay)) {
      setLogError('Enter a valid weight')
      return
    }
    // Round-trip drift guard (v3 §2.4): an unchanged displayed value returns the original stored kg exactly.
    const weight = editedDisplay === null || log.weight === null ? editedDisplay : resolveEditedWeightKg(log.weight, unit, editedDisplay)
    const reps = editReps.trim() === '' ? null : parseInt(editReps, 10)
    const rir = editRir.trim() === '' ? null : parseInt(editRir, 10)
    setLogError('')
    onUpdate({ weight, reps, rir, formRating: editForm })
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div className="space-y-1" data-row-key={row.key}>
        <div className="flex items-center gap-2">
          <RowLabel text={rowLabelText(row)} accent />
          <div className="flex-1 relative" style={{ minWidth: 64 }}>
            <input
              type="text"
              inputMode="decimal"
              aria-label="Weight"
              autoFocus
              value={editWeight}
              onChange={(e) => setEditWeight(e.target.value)}
              className="w-full"
              style={boxStyle({ paddingLeft: 8, paddingRight: 28, fontSize: 16, borderColor: 'var(--accent)' })}
            />
            <span className="absolute text-xs pointer-events-none" style={{ right: 6, bottom: 8, color: 'var(--text-muted)', fontFamily: MONO, fontSize: 10 }}>
              {unit}
            </span>
          </div>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>×</span>
          <input
            type="text"
            inputMode="numeric"
            aria-label="Reps"
            value={editReps}
            onChange={(e) => setEditReps(e.target.value)}
            style={boxStyle({ width: 48, flexShrink: 0, fontSize: 16, borderColor: 'var(--accent)' })}
          />
          <input
            type="text"
            inputMode="numeric"
            aria-label="RIR"
            placeholder="RIR"
            value={editRir}
            onChange={(e) => setEditRir(e.target.value)}
            style={boxStyle({ width: 48, flexShrink: 0, fontSize: 16 })}
          />
        </div>
        {logError && (
          <p className="text-xs" style={{ paddingLeft: 36, color: 'var(--error)', fontFamily: MONO }}>
            {logError}
          </p>
        )}
        <div style={{ paddingLeft: 36 }}>
          <RatingChips scale={FORM_SCALE} value={editForm} onChange={setEditForm} label="FORM" />
        </div>
        <div className="flex items-center gap-2" style={{ paddingLeft: 36 }}>
          <button
            type="button"
            onClick={() => {
              setLogError('')
              setIsEditing(false)
            }}
            className="flex-1 flex items-center justify-center text-xs font-bold px-3 rounded"
            style={{ minHeight: 44, color: 'var(--text-muted)', border: '1px solid var(--border)', fontFamily: MONO }}
          >
            CANCEL
          </button>
          {confirmDelete ? (
            <button
              type="button"
              onClick={onDelete}
              className="flex-1 flex items-center justify-center text-xs font-bold px-3 rounded"
              style={{ minHeight: 44, backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)', color: 'var(--error)', fontFamily: MONO }}
            >
              CONFIRM DELETE
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="flex-1 flex items-center justify-center text-xs font-bold px-3 rounded"
              style={{ minHeight: 44, backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)', color: 'var(--error)', fontFamily: MONO }}
            >
              DELETE
            </button>
          )}
          <button
            type="button"
            onClick={saveEdit}
            className="flex-1 flex items-center justify-center text-xs font-black px-3 rounded"
            style={{ minHeight: 44, backgroundColor: 'var(--accent)', color: 'var(--on-accent)', fontFamily: MONO }}
          >
            SAVE
          </button>
        </div>
      </div>
    )
  }

  const text = loggedText(log, resolvedUnit)
  return (
    <div style={rowFrame({ backgroundColor: syncFailed ? FAILED_ROW_BACKGROUND : 'var(--surface)' })} data-row-key={row.key} data-row-state="logged">
      <RowLabel text={rowLabelText(row)} />
      <span className="flex-1 text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: MONO }}>
        {text.weight}
        <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}> {text.unit} </span>× {text.reps}
        {text.rir !== '' && <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 12 }}> {text.rir}</span>}
        {isStage && (
          <span className="ml-2 text-xs px-1 rounded" style={{ backgroundColor: 'var(--accent)', color: 'var(--on-accent)', fontFamily: MONO, fontSize: 9 }}>
            {stageKindWord(row.stageKind)}
          </span>
        )}
      </span>
      <button type="button" onClick={startEdit} className="flex-shrink-0 flex items-center justify-center" style={{ width: 28, height: 28, color: 'var(--text-muted)' }} aria-label="Edit set">
        <Pencil size={13} />
      </button>
      <SyncMark logId={log.id} />
    </div>
  )
}
