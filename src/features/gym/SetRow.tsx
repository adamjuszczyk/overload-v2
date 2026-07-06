import { useState } from 'react'
import { Check } from 'lucide-react'
import type { WeekPlanSet, SetLog } from '../../types'
import { useOfflineStore } from '../offline/offlineStore'
import { useSettingsStore } from '../settings/settingsStore'

interface SetRowProps {
  setNumber: number
  plannedSet: WeekPlanSet | null
  lastLog: SetLog | null       // from previous session — for prefill + reference
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
  restElapsed: number | null   // seconds since last set logged (for rest_seconds)
}

export default function SetRow({
  setNumber,
  plannedSet,
  lastLog,
  currentLog,
  onLog,
  restElapsed,
}: SetRowProps) {
  const [weight, setWeight] = useState(
    lastLog?.weight != null ? String(lastLog.weight) : '',
  )
  const [reps, setReps] = useState(
    lastLog?.reps != null ? String(lastLog.reps) : '',
  )
  const [rir, setRir] = useState('')
  const [showExtra, setShowExtra] = useState(false)
  const [isDropset, setIsDropset] = useState(plannedSet?.isDropset ?? false)

  const pendingIds  = useOfflineStore((s) => s.pendingIds)
  const weightUnit  = useSettingsStore((s) => s.weightUnit)

  // ── Already logged — read-only row ──────────────────────────────────────
  if (currentLog) {
    const isPending = pendingIds.has(currentLog.id)

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
        {isPending ? (
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
      </div>
    )
  }

  // ── Input row ────────────────────────────────────────────────────────────
  const targetRir = plannedSet?.targetRir

  function handleLog() {
    const w = weight.trim() === '' ? null : parseFloat(weight)
    const r = reps.trim() === '' ? null : parseInt(reps, 10)
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
            placeholder={lastLog?.weight != null ? String(lastLog.weight) : '0'}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-full px-3 rounded-lg text-sm font-bold text-center"
            style={{
              height: 44,
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
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

        {/* Reps input */}
        <div style={{ width: 60 }} className="flex-shrink-0">
          <input
            type="number"
            inputMode="numeric"
            placeholder={lastLog?.reps != null ? String(lastLog.reps) : '0'}
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            className="w-full px-2 rounded-lg text-sm font-bold text-center"
            style={{
              height: 44,
              backgroundColor: 'var(--surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              fontFamily: 'var(--font-mono)',
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
