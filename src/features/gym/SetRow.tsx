import { useState, useEffect, useRef } from 'react'
import { Check, Pencil, Trash2 } from 'lucide-react'
import type { WeekPlanSet, SetLog } from '../../types'
import { useOfflineStore } from '../offline/offlineStore'
import { useSettingsStore } from '../settings/settingsStore'

interface SetRowProps {
  setNumber: number
  plannedSet: WeekPlanSet | null
  lastLog: SetLog | null       // from previous session — for prefill + reference
  lastLogsLoading: boolean     // true until the previous-session query resolves
  currentLog: SetLog | null    // already logged in current session
  onLog: (params: {
    weekPlanSetId: string | null
    setNumber: number
    weight: number | null
    reps: number | null
    rir: number | null
    isDropset: boolean
    isSkipped: boolean
    restSeconds: number | null
  }) => void
  onUpdate: (changes: { weight: number | null; reps: number | null; rir: number | null; note: string | null }) => void
  onDelete: () => void
  restElapsed: number | null   // seconds since last set logged (for rest_seconds)
}

export default function SetRow({
  setNumber,
  plannedSet,
  lastLog,
  lastLogsLoading,
  currentLog,
  onLog,
  onUpdate,
  onDelete,
  restElapsed,
}: SetRowProps) {
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [rir, setRir] = useState('')
  const [showExtra, setShowExtra] = useState(false)
  const [isDropset, setIsDropset] = useState(plannedSet?.isDropset ?? false)
  const [logError, setLogError] = useState('')

  // Guards against overwriting what the user has already typed once the
  // previous-session query resolves after they've started entering values.
  const userEditedRef = useRef(false)

  // Edit/delete state for an already-logged row
  const [isEditing, setIsEditing] = useState(false)
  const [editWeight, setEditWeight] = useState('')
  const [editReps, setEditReps] = useState('')
  const [editRir, setEditRir] = useState('')
  const [editNote, setEditNote] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const pendingIds  = useOfflineStore((s) => s.pendingIds)
  const failedIds   = useOfflineStore((s) => s.failedIds)
  const weightUnit  = useSettingsStore((s) => s.weightUnit)

  // Prefill from the previous session only once it has actually loaded —
  // never from an in-flight/undetermined lastLog (fixes fake-prefill bug).
  useEffect(() => {
    if (lastLogsLoading || !lastLog || userEditedRef.current) return
    if (lastLog.weight != null) setWeight(String(lastLog.weight))
    if (lastLog.reps != null) setReps(String(lastLog.reps))
  }, [lastLogsLoading, lastLog])

  // ── Already logged — read-only row ──────────────────────────────────────
  if (currentLog) {
    const isPending = pendingIds.has(currentLog.id)
    const isFailed = failedIds.has(currentLog.id)

    if (currentLog.isSkipped) {
      return (
        <div
          className="flex items-center gap-3 px-3 rounded-lg"
          style={{ backgroundColor: 'var(--surface)', minHeight: 44 }}
        >
          <span
            className="text-xs font-bold w-5 text-center"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {String(setNumber).padStart(2, '0')}
          </span>
          <span
            className="text-xs font-bold tracking-widest"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            SKIPPED
          </span>
        </div>
      )
    }

    if (isEditing) {
      function saveEdit() {
        const w = editWeight.trim() === '' ? null : parseFloat(editWeight)
        const r = editReps.trim() === '' ? null : parseInt(editReps, 10)
        const rv = editRir.trim() === '' ? null : parseInt(editRir, 10)
        onUpdate({
          weight: w,
          reps: r,
          rir: rv,
          note: editNote.trim() === '' ? null : editNote.trim(),
        })
        setIsEditing(false)
      }

      return (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-bold w-5 text-center flex-shrink-0"
              style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
            >
              {String(setNumber).padStart(2, '0')}
            </span>

            <div className="flex-1 relative">
              <input
                type="number"
                inputMode="decimal"
                autoFocus
                value={editWeight}
                onChange={(e) => setEditWeight(e.target.value)}
                className="w-full px-3 rounded-lg text-sm font-bold text-center"
                style={{
                  height: 44,
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--accent)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
              <span
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                {weightUnit}
              </span>
            </div>

            <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>×</span>

            <div style={{ width: 60 }} className="flex-shrink-0">
              <input
                type="number"
                inputMode="numeric"
                value={editReps}
                onChange={(e) => setEditReps(e.target.value)}
                className="w-full px-2 rounded-lg text-sm font-bold text-center"
                style={{
                  height: 44,
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--accent)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>

            <button
              onClick={saveEdit}
              className="flex-shrink-0 px-4 rounded-lg font-black text-sm tracking-wider"
              style={{
                height: 44,
                backgroundColor: 'var(--accent)',
                color: 'var(--base)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              SAVE
            </button>
          </div>

          <div className="flex items-center gap-2 pl-7 flex-wrap">
            <div className="flex items-center gap-1">
              <span
                className="text-xs"
                style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              >
                RIR
              </span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="—"
                value={editRir}
                onChange={(e) => setEditRir(e.target.value)}
                className="w-10 px-1 rounded text-xs text-center"
                style={{
                  height: 44,
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                  fontFamily: 'var(--font-mono)',
                }}
              />
            </div>

            <input
              type="text"
              placeholder="Note"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              className="px-3 rounded-lg text-xs flex-1"
              style={{
                height: 44,
                minWidth: 100,
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-sans)',
              }}
            />

            <button
              onClick={() => setIsEditing(false)}
              className="flex items-center justify-center text-xs px-3 rounded"
              style={{
                minHeight: 44,
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              CANCEL
            </button>
          </div>
        </div>
      )
    }

    return (
      <div
        className="flex items-center gap-3 px-3 rounded-lg"
        style={{
          backgroundColor: 'var(--surface)',
          borderLeft: '3px solid var(--accent)',
          minHeight: 44,
        }}
      >
        <span
          className="text-xs font-bold w-5 text-center"
          style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          {String(setNumber).padStart(2, '0')}
        </span>
        <span
          className="flex-1 text-sm font-bold"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
        >
          {currentLog.weight}
          <span style={{ color: 'var(--text-muted)' }}>{weightUnit} × </span>
          {currentLog.reps}
          {currentLog.rir != null && (
            <span style={{ color: 'var(--text-muted)' }}> @ RIR {currentLog.rir}</span>
          )}
          {currentLog.isDropset && (
            <span
              className="ml-2 text-xs px-1 rounded"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)' }}
            >
              DROP
            </span>
          )}
        </span>
        {isFailed ? (
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: 'rgba(248, 113, 113, 0.15)',
              color: 'var(--error)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.06em',
            }}
            title="Failed to sync after 3 attempts — this set only exists on this device"
          >
            SYNC FAILED
          </span>
        ) : isPending ? (
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: 'var(--accent-muted)',
              color: 'var(--accent)',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.06em',
            }}
          >
            SYNC
          </span>
        ) : (
          <Check size={14} style={{ color: 'var(--accent)' }} />
        )}

        {confirmDelete ? (
          <>
            <button
              onClick={() => setConfirmDelete(false)}
              className="flex-shrink-0 text-xs font-bold px-2 rounded"
              style={{
                height: 28,
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              CANCEL
            </button>
            <button
              onClick={onDelete}
              className="flex-shrink-0 text-xs font-bold px-2 rounded"
              style={{
                height: 28,
                backgroundColor: 'rgba(248, 113, 113, 0.15)',
                color: 'var(--error)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              DELETE
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                setEditWeight(currentLog.weight != null ? String(currentLog.weight) : '')
                setEditReps(currentLog.reps != null ? String(currentLog.reps) : '')
                setEditRir(currentLog.rir != null ? String(currentLog.rir) : '')
                setEditNote(currentLog.note ?? '')
                setIsEditing(true)
              }}
              className="flex-shrink-0 flex items-center justify-center"
              style={{ width: 28, height: 28, color: 'var(--text-muted)' }}
              aria-label="Edit set"
            >
              <Pencil size={13} />
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex-shrink-0 flex items-center justify-center"
              style={{ width: 28, height: 28, color: 'var(--text-muted)' }}
              aria-label="Delete set"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    )
  }

  // ── Input row ────────────────────────────────────────────────────────────
  const targetRir = plannedSet?.targetRir

  function handleLog() {
    const w = weight.trim() === '' ? null : parseFloat(weight)
    const r = reps.trim() === '' ? null : parseInt(reps, 10)
    if (w === null || r === null || Number.isNaN(w) || Number.isNaN(r)) {
      setLogError('Enter weight and reps, or tap SKIP')
      return
    }
    setLogError('')
    const rirVal = rir.trim() === '' ? null : parseInt(rir, 10)
    onLog({
      weekPlanSetId: plannedSet?.id ?? null,
      setNumber,
      weight: w,
      reps: r,
      rir: rirVal,
      isDropset,
      isSkipped: false,
      restSeconds: restElapsed,
    })
  }

  function handleSkip() {
    setLogError('')
    onLog({
      weekPlanSetId: plannedSet?.id ?? null,
      setNumber,
      weight: null,
      reps: null,
      rir: null,
      isDropset: false,
      isSkipped: true,
      restSeconds: restElapsed,
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {/* Set number */}
        <span
          className="text-xs font-bold w-5 text-center flex-shrink-0"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {String(setNumber).padStart(2, '0')}
        </span>

        {/* Weight input */}
        <div className="flex-1 relative">
          <input
            type="number"
            inputMode="decimal"
            placeholder={lastLogsLoading ? '···' : '0'}
            disabled={lastLogsLoading}
            value={weight}
            onChange={(e) => {
              userEditedRef.current = true
              setWeight(e.target.value)
              if (logError) setLogError('')
            }}
            className="w-full px-3 rounded-lg text-sm font-bold text-center"
            style={{
              height: 44,
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              opacity: lastLogsLoading ? 0.5 : 1,
            }}
          />
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs pointer-events-none"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {weightUnit}
          </span>
        </div>

        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>×</span>

        {/* Reps input */}
        <div style={{ width: 60 }} className="flex-shrink-0">
          <input
            type="number"
            inputMode="numeric"
            placeholder={lastLogsLoading ? '···' : '0'}
            disabled={lastLogsLoading}
            value={reps}
            onChange={(e) => {
              userEditedRef.current = true
              setReps(e.target.value)
              if (logError) setLogError('')
            }}
            className="w-full px-2 rounded-lg text-sm font-bold text-center"
            style={{
              height: 44,
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
              opacity: lastLogsLoading ? 0.5 : 1,
            }}
          />
        </div>

        {/* LOG button — 44px touch target */}
        <button
          onClick={handleLog}
          className="flex-shrink-0 px-4 rounded-lg font-black text-sm tracking-wider"
          style={{
            height: 44,
            backgroundColor: 'var(--accent)',
            color: 'var(--base)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          LOG
        </button>
      </div>

      {/* Loading last session */}
      {lastLogsLoading && (
        <div className="pl-7">
          <span
            className="text-xs"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            Loading last session…
          </span>
        </div>
      )}

      {/* Log validation error */}
      {logError && (
        <div className="pl-7">
          <span
            className="text-xs"
            style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)' }}
          >
            {logError}
          </span>
        </div>
      )}

      {/* Target RIR hint */}
      {targetRir != null && (
        <div className="flex items-center gap-2 pl-7">
          <span
            className="text-xs"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            TARGET RIR {targetRir}
          </span>
        </div>
      )}

      {/* Expandable: achieved RIR + dropset + skip */}
      <div className="pl-7">
        <button
          onClick={() => setShowExtra((v) => !v)}
          className="flex items-center text-xs"
          style={{
            minHeight: 44,
            color: 'var(--text-muted)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {showExtra ? '▲ LESS' : '▼ MORE'}
        </button>
      </div>

      {showExtra && (
        <div className="flex items-center gap-2 pl-7 flex-wrap">
          {/* Achieved RIR */}
          <div className="flex items-center gap-1">
            <span
              className="text-xs"
              style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
            >
              RIR
            </span>
            <input
              type="number"
              inputMode="numeric"
              placeholder="—"
              value={rir}
              onChange={(e) => setRir(e.target.value)}
              className="w-10 px-1 rounded text-xs text-center"
              style={{
                height: 44,
                backgroundColor: 'var(--surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)',
              }}
            />
          </div>

          {/* Dropset toggle — 44px touch target */}
          <button
            onClick={() => setIsDropset((v) => !v)}
            className="flex items-center justify-center text-xs px-3 rounded font-bold"
            style={{
              minHeight: 44,
              backgroundColor: isDropset ? 'var(--accent)' : 'var(--surface)',
              color: isDropset ? 'var(--base)' : 'var(--text-muted)',
              border: `1px solid ${isDropset ? 'var(--accent)' : 'var(--border)'}`,
              fontFamily: 'var(--font-mono)',
            }}
          >
            DROP
          </button>

          {/* Skip — 44px touch target */}
          <button
            onClick={handleSkip}
            className="flex items-center justify-center text-xs px-3 rounded"
            style={{
              minHeight: 44,
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            SKIP
          </button>
        </div>
      )}
    </div>
  )
}
