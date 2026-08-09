import { useState, useEffect, useRef } from 'react'
import { Check, Pencil, Trash2 } from 'lucide-react'
import type { WeekPlanSet, SetLog, ProgramExercise, WeightUnit } from '../../types'
import { useOfflineStore } from '../offline/offlineStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { formatRestTime } from '../../lib/formatRestTime'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { toDisplayWeight, toStorageWeight, resolveEditedWeightKg } from '../../lib/weightUnit'

interface SetRowProps {
  setNumber: number
  programExercise: ProgramExercise  // resolves this exercise's preferred weight unit (v3 §2.4)
  plannedSet: WeekPlanSet | null
  lastLog: SetLog | null       // from previous session — for prefill + reference
  lastLogsLoading: boolean     // true until the previous-session query resolves
  currentLog: SetLog | null    // already logged in current session
  // True for a stage-input row rendered by SetGroup.tsx under ADD STAGE — the
  // caller already knows which head this stage belongs to (v3 §2.1), so
  // isDropset is fixed by the caller rather than user-toggled here.
  isStage?: boolean
  onLog: (params: {
    weekPlanSetId: string | null
    setNumber: number
    weight: number | null
    reps: number | null
    rir: number | null
    isDropset: boolean
    isSkipped: boolean
    restSeconds: number | null
    setSeconds: number | null
    enteredUnit: WeightUnit | null
  }) => void
  onUpdate: (changes: { weight: number | null; reps: number | null; rir: number | null; note: string | null }) => void
  onDelete: () => void
  restElapsed: number | null   // seconds since last set logged (for rest_seconds)
}

export default function SetRow({
  setNumber,
  programExercise,
  plannedSet,
  lastLog,
  lastLogsLoading,
  currentLog,
  isStage = false,
  onLog,
  onUpdate,
  onDelete,
  restElapsed,
}: SetRowProps) {
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [rir, setRir] = useState('')
  const [showExtra, setShowExtra] = useState(false)
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
  const measureSetTime = useSettingsStore((s) => s.measureSetTime)

  // Resolved unit for this program-exercise (v3 §2.4): its own override, else
  // the global Settings default. `resolvedUnit` is fixed — it changes only
  // if the exercise's configured unit changes, never by the logging-time
  // toggle below.
  const { unit: resolvedUnit } = useWeightDisplay(programExercise.weightUnit)

  // The rarely-used logging-time override (SPEC §8.1) — a small toggle that
  // lets THIS one set be logged in the other unit without changing the
  // exercise's configured default. null = no override, use resolvedUnit.
  const [unitOverride, setUnitOverride] = useState<WeightUnit | null>(null)
  const activeUnit = unitOverride ?? resolvedUnit
  const otherUnit: WeightUnit = resolvedUnit === 'kg' ? 'lbs' : 'kg'

  // Start Set flow (v3 §2.2) — only meaningful while measureSetTime is on and
  // this row hasn't been logged yet. isTiming is local (not read from the
  // global setTimerStore) since only THIS specific row's UI should switch to
  // the post-Start-Set state; the store just holds the shared elapsed-time
  // anchor, same as restTimerStore does for rest.
  const [isTiming, setIsTiming] = useState(false)
  // Captured the instant Start Set is tapped — true rest ends there, not at
  // Log (TASKS.md §2.2: "the rest timer starts at LOG and stops at START
  // SET"). restTimerStore.startedAt is cleared by then, so this is the only
  // record of what the honest rest value was.
  const [frozenRestSeconds, setFrozenRestSeconds] = useState<number | null>(null)
  const setTimerStartedAt = useSetTimerStore((s) => s.startedAt)
  const [setElapsed, setSetElapsed] = useState(0)

  useEffect(() => {
    if (!isTiming || !setTimerStartedAt) {
      setSetElapsed(0)
      return
    }
    const tick = () => setSetElapsed(Math.floor((Date.now() - setTimerStartedAt) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isTiming, setTimerStartedAt])

  function handleStartSet() {
    const rest = useRestTimerStore.getState()
    setFrozenRestSeconds(rest.startedAt ? Math.floor((Date.now() - rest.startedAt) / 1000) : null)
    rest.stop()
    useSetTimerStore.getState().start()
    setIsTiming(true)
  }

  // Prefill from the previous session only once it has actually loaded —
  // never from an in-flight/undetermined lastLog (fixes fake-prefill bug).
  // lastLog.weight is always canonical kg (v3 §2.4) — converted to whatever
  // unit is currently active for this input. Depending on activeUnit means
  // toggling the override before typing anything re-converts the prefilled
  // figure automatically; userEditedRef still guards against clobbering
  // anything the user has already typed by then.
  useEffect(() => {
    if (lastLogsLoading || !lastLog || userEditedRef.current) return
    if (lastLog.weight != null) setWeight(String(toDisplayWeight(lastLog.weight, activeUnit)))
    if (lastLog.reps != null) setReps(String(lastLog.reps))
  }, [lastLogsLoading, lastLog, activeUnit])

  // ── Already logged — read-only row ──────────────────────────────────────
  if (currentLog) {
    const isPending = pendingIds.has(currentLog.id)
    const isFailed = failedIds.has(currentLog.id)
    // Display/edit in whatever unit this set was actually logged in
    // (v3 §2.4) — falls back to today's resolved default only for logs
    // that predate this feature (enteredUnit null). Kept fixed for the
    // life of this render so the edit round-trip guard below always
    // compares against the same unit it initialized from.
    const editUnit = currentLog.enteredUnit ?? resolvedUnit

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
      const originalKg = currentLog.weight
      function saveEdit() {
        const editedDisplay = editWeight.trim() === '' ? null : parseFloat(editWeight.replace(',', '.'))
        // Same guard as handleLog's input-row validation — a non-numeric
        // edit (e.g. stray letters) must not silently write NaN through
        // resolveEditedWeightKg/onUpdate, which Supabase would serialize as
        // a silent NULL.
        if (editedDisplay !== null && Number.isNaN(editedDisplay)) {
          setLogError('Enter a valid weight')
          return
        }
        // Round-trip drift guard (v3 §2.4 / weightUnit.ts): if the displayed
        // value is unchanged from what originalKg would already show, this
        // returns the original stored kg exactly rather than reconstructing
        // it from a rounded display figure.
        const w =
          editedDisplay === null || originalKg === null
            ? editedDisplay
            : resolveEditedWeightKg(originalKg, editUnit, editedDisplay)
        const r = editReps.trim() === '' ? null : parseInt(editReps, 10)
        const rv = editRir.trim() === '' ? null : parseInt(editRir, 10)
        setLogError('')
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
                type="text"
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
                {editUnit}
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
              onClick={() => {
                setLogError('')
                setIsEditing(false)
              }}
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
        </div>
      )
    }

    return (
      <div
        className="flex items-center gap-3 px-3 rounded-lg"
        style={{
          backgroundColor: 'var(--surface)',
          borderLeft: isStage ? '3px dashed var(--accent)' : '3px solid var(--accent)',
          minHeight: 44,
        }}
      >
        <span
          className="text-xs font-bold w-5 text-center"
          style={{ color: isStage ? 'var(--text-muted)' : 'var(--accent)', fontFamily: 'var(--font-mono)' }}
        >
          {String(setNumber).padStart(2, '0')}
        </span>
        <span
          className="flex-1 text-sm font-bold"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
        >
          {currentLog.weight !== null ? toDisplayWeight(currentLog.weight, editUnit) : '—'}
          <span style={{ color: 'var(--text-muted)' }}>{editUnit} × </span>
          {currentLog.reps}
          {currentLog.rir != null && (
            <span style={{ color: 'var(--text-muted)' }}> @ RIR {currentLog.rir}</span>
          )}
          {/* Structural (isStage), not currentLog.isDropset — an orphaned
              dropset-flagged row with no parent renders as a normal head
              (TASKS.md §2.1's documented orphan handling), so the badge
              must track "is this being rendered as a stage", not the raw
              flag, or the two would disagree (found via live verification
              against real data: an unparented row logged today showed both
              its own head number and a STAGE badge at once). */}
          {isStage && (
            <span
              className="ml-2 text-xs px-1 rounded"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)' }}
            >
              STAGE
            </span>
          )}
        </span>
        {isFailed ? (
          <span
            className="text-xs font-bold px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)',
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
                backgroundColor: 'color-mix(in srgb, var(--error) 15%, transparent)',
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
                setEditWeight(currentLog.weight != null ? String(toDisplayWeight(currentLog.weight, editUnit)) : '')
                setEditReps(currentLog.reps != null ? String(currentLog.reps) : '')
                setEditRir(currentLog.rir != null ? String(currentLog.rir) : '')
                setEditNote(currentLog.note ?? '')
                setLogError('')
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

  // Resolves the final restSeconds/setSeconds pair and tears down the set
  // timer — shared by handleLog and handleSkip so both honour the Start Set
  // flow identically when it was used. When measureSetTime is off, or the
  // user never tapped Start Set, this is a no-op and restSeconds falls back
  // to today's exact behaviour (the live restElapsed prop).
  function resolveTiming(): { restSeconds: number | null; setSeconds: number | null } {
    if (!measureSetTime || !isTiming) return { restSeconds: restElapsed, setSeconds: null }
    const setStore = useSetTimerStore.getState()
    const setSeconds = setStore.startedAt ? Math.floor((Date.now() - setStore.startedAt) / 1000) : null
    setStore.stop()
    setIsTiming(false)
    return { restSeconds: frozenRestSeconds, setSeconds }
  }

  function handleLog() {
    const wEntered = weight.trim() === '' ? null : parseFloat(weight.replace(',', '.'))
    const r = reps.trim() === '' ? null : parseInt(reps, 10)
    if (wEntered === null || r === null || Number.isNaN(wEntered) || Number.isNaN(r)) {
      setLogError('Enter weight and reps, or tap SKIP')
      return
    }
    setLogError('')
    const rirVal = rir.trim() === '' ? null : parseInt(rir, 10)
    const { restSeconds, setSeconds } = resolveTiming()
    // Canonical storage is always kg (v3 §2.4) — what was typed is in
    // activeUnit and gets converted here, once, at the write boundary.
    // enteredUnit records the override only when one was actually used;
    // null means "the resolved default for this program-exercise", per
    // the column's own documented semantics.
    onLog({
      weekPlanSetId: plannedSet?.id ?? null,
      setNumber,
      weight: toStorageWeight(wEntered, activeUnit),
      reps: r,
      rir: rirVal,
      isDropset: isStage,
      isSkipped: false,
      restSeconds,
      setSeconds,
      enteredUnit: activeUnit === resolvedUnit ? null : activeUnit,
    })
  }

  function handleSkip() {
    setLogError('')
    const { restSeconds } = resolveTiming()
    onLog({
      weekPlanSetId: plannedSet?.id ?? null,
      setNumber,
      weight: null,
      reps: null,
      rir: null,
      isDropset: false,
      isSkipped: true,
      restSeconds,
      setSeconds: null,
      enteredUnit: null,
    })
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {/* Set number — stage-input rows share the head's number (v3 §2.1) */}
        <span
          className="text-xs font-bold w-5 text-center flex-shrink-0"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {isStage ? '↳' : String(setNumber).padStart(2, '0')}
        </span>

        {/* Weight input */}
        <div className="flex-1 relative">
          <input
            type="text"
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
          {/* Logging-time unit override (SPEC §8.1) — small, rarely used:
              tapping flips this one set between the exercise's resolved
              unit and the other, without changing the exercise's configured
              default. Shows an indicator only while actually overridden, so
              the common case looks identical to a plain unit label. */}
          <button
            type="button"
            onClick={() => setUnitOverride(unitOverride === null ? otherUnit : null)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-xs"
            style={{
              color: unitOverride !== null ? 'var(--accent)' : 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              fontWeight: unitOverride !== null ? 700 : 400,
            }}
            aria-label={`Log this set in ${otherUnit}`}
          >
            {activeUnit}
          </button>
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

        {/* LOG / START SET button — 44px touch target */}
        {measureSetTime && !isTiming ? (
          <button
            onClick={handleStartSet}
            className="flex-shrink-0 px-4 rounded-lg font-black text-sm tracking-wider"
            style={{
              height: 44,
              backgroundColor: 'var(--accent)',
              color: 'var(--base)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            START SET
          </button>
        ) : (
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
        )}
      </div>

      {/* Set timer running (measureSetTime on, Start Set already tapped) */}
      {isTiming && (
        <div className="pl-7">
          <span
            className="text-xs font-bold"
            style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
          >
            TIMING SET · {formatRestTime(setElapsed)}
          </span>
        </div>
      )}

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

          {/* Skip — 44px touch target. Not offered for a stage-input row: a
              stage only exists because ADD STAGE was tapped, so there's
              nothing planned to skip — SetGroup's own cancel affordance
              covers "changed my mind". */}
          {!isStage && (
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
          )}
        </div>
      )}
    </div>
  )
}
