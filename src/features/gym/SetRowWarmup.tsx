// Chunk 58a — a warmup's row (SPEC "Warmup sets": "weight and reps, both optional; plus a rest timer. Nothing else."; boards W1, W2b
// "WARMUPS AS ROWS" and "WARMUPS AS A TICK LIST"). A warmup never takes part in the current set or the lock (G54), so its row is always
// typable and its LOG logs at once. A logged warmup can be corrected (rows mode) or removed (both modes: in tick mode that is "untick").
import { useState } from 'react'
import { Check, Pencil } from 'lucide-react'
import type { SetLog, WeekPlanSet, WeightUnit } from '../../types'
import type { ResolvedRow } from './workoutRules'
import type { LogParams } from './useExerciseCardState'
import { resolveEditedWeightKg, toDisplayWeight, toStorageWeight } from '../../lib/weightUnit'
import { RowLabel, SyncMark, boxStyle, rowFrame } from './setRowParts'
import { rowDefaults } from './workoutRowView'

interface SetRowWarmupProps {
  row: ResolvedRow
  planned: WeekPlanSet | null
  log: SetLog | null
  unit: WeightUnit
  display: 'rows' | 'tick'
  restElapsed: () => number | null
  onLog: (params: LogParams) => void
  onUpdate: (changes: { weight: number | null; reps: number | null }) => void
  onDelete: () => void
}

const MONO = 'var(--font-mono)'

export default function SetRowWarmup({ row, planned, log, unit, display, restElapsed, onLog, onUpdate, onDelete }: SetRowWarmupProps) {
  const defaults = rowDefaults(planned, unit)
  const [weight, setWeight] = useState(defaults.weight)
  const [reps, setReps] = useState(defaults.reps)
  const [isEditing, setIsEditing] = useState(false)
  const [editWeight, setEditWeight] = useState('')
  const [editReps, setEditReps] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [logError, setLogError] = useState('')

  // Both optional (SPEC, verbatim): an empty box is simply null, never a validation error.
  function handleLog() {
    const w = weight.trim() === '' ? null : parseFloat(weight.replace(',', '.'))
    const r = reps.trim() === '' ? null : parseInt(reps, 10)
    onLog({
      weekPlanSetId: planned?.id ?? null,
      setNumber: row.number,
      weight: w !== null && !Number.isNaN(w) ? toStorageWeight(w, unit) : null,
      reps: r !== null && !Number.isNaN(r) ? r : null,
      rir: null,
      isDropset: false,
      isSkipped: false,
      restSeconds: restElapsed(),
      setSeconds: null,
      enteredUnit: null,
      formRating: null,
      stageKind: null,
      isWarmup: true,
    })
  }

  if (log) {
    const editUnit = log.enteredUnit ?? unit
    if (isEditing && display !== 'tick') {
      const save = () => {
        const edited = editWeight.trim() === '' ? null : parseFloat(editWeight.replace(',', '.'))
        if (edited !== null && Number.isNaN(edited)) {
          setLogError('Enter a valid weight')
          return
        }
        const w = edited === null || log.weight === null ? edited : resolveEditedWeightKg(log.weight, editUnit, edited)
        const r = editReps.trim() === '' ? null : parseInt(editReps, 10)
        setLogError('')
        // Weight and reps only: updateSetLog never touches the other columns for a warmup edit.
        onUpdate({ weight: w, reps: r })
        setIsEditing(false)
      }
      return (
        <div className="space-y-1" data-row-key={row.key}>
          <div className="flex items-center gap-2">
            <RowLabel text="W" accent />
            <div className="flex-1 relative" style={{ minWidth: 64 }}>
              <input type="text" inputMode="decimal" aria-label="Weight" autoFocus value={editWeight} onChange={(e) => setEditWeight(e.target.value)} className="w-full" style={boxStyle({ paddingRight: 28, fontSize: 16, borderColor: 'var(--accent)' })} />
              <span className="absolute text-xs pointer-events-none" style={{ right: 6, bottom: 8, color: 'var(--text-muted)', fontFamily: MONO, fontSize: 10 }}>{editUnit}</span>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>×</span>
            <input type="number" inputMode="numeric" aria-label="Reps" value={editReps} onChange={(e) => setEditReps(e.target.value)} style={boxStyle({ width: 48, flexShrink: 0, fontSize: 16, borderColor: 'var(--accent)' })} />
          </div>
          {logError && <p className="text-xs" style={{ paddingLeft: 36, color: 'var(--error)', fontFamily: MONO }}>{logError}</p>}
          <div className="flex items-center gap-2" style={{ paddingLeft: 36 }}>
            <button type="button" onClick={() => { setLogError(''); setIsEditing(false) }} className="flex-1 flex items-center justify-center text-xs font-bold px-3 rounded" style={{ minHeight: 44, color: 'var(--text-muted)', border: '1px solid var(--border)', fontFamily: MONO }}>CANCEL</button>
            <button type="button" onClick={save} className="flex-1 flex items-center justify-center text-xs font-black px-3 rounded" style={{ minHeight: 44, backgroundColor: 'var(--accent)', color: 'var(--on-accent)', fontFamily: MONO }}>SAVE</button>
          </div>
        </div>
      )
    }

    const removal = confirmDelete ? (
      <>
        <button type="button" onClick={() => setConfirmDelete(false)} className="flex-shrink-0 text-xs font-bold px-2 rounded" style={{ height: 28, color: 'var(--text-muted)', border: '1px solid var(--border)', fontFamily: MONO }}>CANCEL</button>
        <button type="button" onClick={onDelete} className="flex-shrink-0 text-xs font-bold px-2 rounded" style={{ height: 28, backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)', color: 'var(--error)', fontFamily: MONO }}>DELETE</button>
      </>
    ) : null

    if (display === 'tick') {
      return (
        <div style={rowFrame({ backgroundColor: 'var(--surface)' })} data-row-key={row.key} data-row-state="logged">
          <RowLabel text="W" />
          <span className="flex-1 text-xs font-bold" style={{ color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em' }}>WARMUP · DONE</span>
          {removal ?? (
            <button type="button" onClick={() => setConfirmDelete(true)} className="flex-shrink-0 flex items-center justify-center rounded" style={{ width: 28, height: 28, backgroundColor: 'var(--accent)', color: 'var(--on-accent)' }} aria-label="Untick warmup">
              <Check size={14} />
            </button>
          )}
        </div>
      )
    }
    return (
      <div style={rowFrame({ backgroundColor: 'var(--surface)' })} data-row-key={row.key} data-row-state="logged">
        <RowLabel text="W" />
        <span className="flex-1 text-sm font-bold" style={{ color: 'var(--text-primary)', fontFamily: MONO }}>
          {log.weight !== null && log.reps !== null ? (
            <>
              {toDisplayWeight(log.weight, editUnit)}
              <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: 11 }}> {editUnit} </span>× {log.reps}
            </>
          ) : (
            'DONE'
          )}
        </span>
        {removal ?? (
          <>
            <button type="button" onClick={() => { setEditWeight(log.weight != null ? String(toDisplayWeight(log.weight, editUnit)) : ''); setEditReps(log.reps != null ? String(log.reps) : ''); setLogError(''); setIsEditing(true) }} className="flex-shrink-0 flex items-center justify-center" style={{ width: 28, height: 28, color: 'var(--text-muted)' }} aria-label="Edit set">
              <Pencil size={13} />
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} className="flex-shrink-0 text-xs" style={{ height: 28, padding: '0 4px', color: 'var(--text-muted)', fontFamily: MONO, fontSize: 9 }} aria-label="Delete set">
              ✕
            </button>
          </>
        )}
        <SyncMark logId={log.id} />
      </div>
    )
  }

  if (display === 'tick') {
    return (
      <button
        type="button"
        onClick={handleLog}
        className="w-full flex items-center gap-2 text-left"
        style={rowFrame({ borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', background: 'transparent' })}
        data-row-key={row.key}
        data-row-state="unlogged"
      >
        <RowLabel text="W" />
        <span className="flex-1 text-xs font-bold" style={{ color: 'var(--text-muted)', fontFamily: MONO, letterSpacing: '0.06em' }}>WARMUP · TAP WHEN DONE</span>
        <span style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderStyle: 'solid', borderColor: 'var(--border-strong)' }} />
      </button>
    )
  }

  return (
    <div className="space-y-1" data-row-key={row.key} data-row-state="unlogged">
      <div className="flex items-center gap-2">
        <RowLabel text="W" accent />
        <div className="flex-1 relative" style={{ minWidth: 64 }}>
          <input type="text" inputMode="decimal" aria-label="Weight" value={weight} onChange={(e) => setWeight(e.target.value)} className="w-full" style={boxStyle({ paddingRight: 28, fontSize: 16 })} />
          <span className="absolute text-xs pointer-events-none" style={{ right: 6, bottom: 8, color: 'var(--text-muted)', fontFamily: MONO, fontSize: 10 }}>{unit}</span>
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>×</span>
        <input type="number" inputMode="numeric" aria-label="Reps" placeholder={defaults.repsHint} value={reps} onChange={(e) => setReps(e.target.value)} style={boxStyle({ width: 48, flexShrink: 0, fontSize: 16 })} />
        <button type="button" onClick={handleLog} className="flex-shrink-0 rounded-lg font-black text-sm tracking-wider" style={{ height: 44, padding: '0 12px', minWidth: 112, backgroundColor: 'var(--accent)', color: 'var(--on-accent)', fontFamily: MONO }}>
          LOG
        </button>
      </div>
    </div>
  )
}
