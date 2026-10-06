import { useState, useEffect, useRef } from 'react'
import { Check, Pencil, Trash2, Square } from 'lucide-react'
import type { WeekPlanSet, SetLog, ProgramExercise, WeightUnit, FormRating } from '../../types'
import { useOfflineStore } from '../offline/offlineStore'
import { useSettingsStore } from '../settings/settingsStore'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { formatRestTime } from '../../lib/formatRestTime'
import { columnsToRepTarget, formatRepTarget, STAGE_KIND_LABELS, type StageKind } from '../../lib/plannerVocabulary.js'
import { useWeightDisplay } from '../../hooks/useWeightDisplay'
import { toDisplayWeight, toStorageWeight, resolveEditedWeightKg } from '../../lib/weightUnit'
import { FORM_SCALE } from './ratingScales'
import RatingChips from './RatingChips'

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
  // True for a planned stage whose own prior row (the head, or the stage
  // before it) hasn't been logged yet (chunk 3, "Planned staged sets render
  // (fix)" [P1] — SPEC: "each locked until the stage before it is logged").
  // Renders the exact same input row a loggable stage gets — same weight
  // field, reps field, unit toggle, ↳ marker, TARGET RIR hint, prefill —
  // just disabled: every input and button below carries the native
  // `disabled` attribute, and handleLog/handleStartSet short-circuit too,
  // so nothing in the row can fire. SetGroup.tsx alone decides which single
  // stage is next and simply stops passing this once it is — the row
  // becomes interactive, no change of shape.
  isLocked?: boolean
  // Chunk 14 — "Staged sets: all four stage kinds". This group's resolved
  // kind (SetGroup.tsx's own resolveStageKind call), for a stage row only
  // — undefined/null/'dropset' all render exactly as a dropset stage
  // always has (D30's fixture never passes this at all). Display only:
  // the actual *write* value ("as planned") is resolved below from
  // plannedSet.stageKind directly, not from this prop — see handleLog's
  // own comment.
  stageKind?: StageKind | null
  // Chunk 14 carry-over (SPEC "Staged sets"): the weight (kg) this stage's
  // input should default to, already resolved by SetGroup.tsx
  // (stageCarryLogic.ts) — null for a dropset stage (today's unchanged
  // "starts blank" behaviour) or when there's nothing to carry from yet.
  carryWeightKg?: number | null
  // Chunk 15 (SPEC "Warmup sets") — renders this row entirely differently
  // (see the dedicated branch near the top of the component body): weight
  // and reps both optional, no RIR/MORE/skip/edit/stage machinery at all —
  // "nothing else". Never true for a stage (a warmup is never staged) and
  // never set by any pre-chunk-15 caller, so every existing render path is
  // unaffected by this prop's mere existence.
  isWarmup?: boolean
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
    formRating: FormRating | null
    stageKind: StageKind | null
    isWarmup?: boolean
  }) => void
  // Chunk 15 — rir/formRating optional (not required): a warmup's own edit
  // (this component's isWarmup branch) sends weight/reps only, matching
  // the reviewer's "weight and reps only" instruction and updateSetLog's
  // own `'x' in changes` convention (sessionService.ts) — an omitted key
  // touches nothing. The existing working-set edit (saveEdit, below) is
  // unchanged: it still sends all four explicitly every time.
  onUpdate: (changes: { weight: number | null; reps: number | null; rir?: number | null; formRating?: FormRating | null }) => void
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
  isLocked = false,
  stageKind = null,
  carryWeightKg = null,
  isWarmup = false,
  onLog,
  onUpdate,
  onDelete,
  restElapsed,
}: SetRowProps) {
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [rir, setRir] = useState('')
  const [formRating, setFormRating] = useState<FormRating | null>(null)
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
  const [editFormRating, setEditFormRating] = useState<FormRating | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const pendingIds  = useOfflineStore((s) => s.pendingIds)
  const failedIds   = useOfflineStore((s) => s.failedIds)
  const measureSetTime = useSettingsStore((s) => s.measureSetTime)
  // Chunk 15 (SPEC "Warmup sets" — "Display setting: rows ... or tick").
  // Read unconditionally (Rules of Hooks) even though only the isWarmup
  // branch below ever uses it — harmless for every other row.
  const warmupDisplay = useSettingsStore((s) => s.warmupDisplay)

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
    // Belt-and-suspenders alongside the button's own native `disabled`
    // (chunk 3): guarantees a locked row's LOG/START SET control "fires
    // nothing" regardless of how it was triggered, not just how it looks.
    if (isLocked) return
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

  // Chunk 14 carry-over (SPEC "Staged sets") — same guard shape as the
  // lastLog prefill above (never clobber something the user already
  // typed), reading stageCarryLogic.ts's already-resolved value instead of
  // a previous session's log. null (dropset, or nothing to carry from yet)
  // is a no-op, same as lastLog being absent above.
  useEffect(() => {
    if (carryWeightKg == null || userEditedRef.current) return
    setWeight(String(toDisplayWeight(carryWeightKg, activeUnit)))
  }, [carryWeightKg, activeUnit])

  // Chunk 14 — "the workout screen labels stages by kind": null whenever
  // there's nothing new to say (not a stage row, or a dropset — today's
  // exact look, the D30 fixture's own case) so every existing render path
  // is untouched; the label text itself for the three carrying kinds.
  const stageLabel = isStage && stageKind && stageKind !== 'dropset' ? STAGE_KIND_LABELS[stageKind] : null

  // ── Warmup (chunk 15 — SPEC "Warmup sets": "Logged values: weight and
  // reps, both optional; plus a rest timer. Nothing else.") A hard branch,
  // entirely separate from every path below it — isWarmup is false (the
  // default) on every pre-chunk-15 call site and the D30 fixture, so this
  // is never reached there, and nothing below this block is affected by
  // its existence. Never a stage (a warmup is never staged), so isStage/
  // stageKind/carryWeightKg/isLocked never apply here.
  if (isWarmup) {
    if (currentLog) {
      const isPending = pendingIds.has(currentLog.id)
      const isFailed = failedIds.has(currentLog.id)
      // Same unit convention as the working-set logged row below: whatever
      // this set was actually logged in (enteredUnit), falling back to
      // today's resolved default for a legacy row that predates the column.
      const editUnit = currentLog.enteredUnit ?? resolvedUnit

      // Review fix (reviewer, chunk 15) — "SPEC's 'nothing else' limits
      // what a warmup *records* (weight, reps, rest timer), not whether it
      // can be corrected": edit (rows mode only — tick mode never had a
      // value, only a done/not-done state, so editing doesn't apply there,
      // same reasoning the tick button below already uses) and delete (both
      // modes — "a ticked warmup can be unticked" is exactly this delete).
      // Reuses the same onUpdate/onDelete props and isEditing/editWeight/
      // editReps/confirmDelete state the working-set logged row below
      // already declares (top of this component) — nothing new added to
      // this component's own state.
      if (isEditing && warmupDisplay !== 'tick') {
        const saveWarmupEdit = () => {
          const editedDisplay = editWeight.trim() === '' ? null : parseFloat(editWeight.replace(',', '.'))
          if (editedDisplay !== null && Number.isNaN(editedDisplay)) {
            setLogError('Enter a valid weight')
            return
          }
          const originalKg = currentLog.weight
          const w =
            editedDisplay === null || originalKg === null
              ? editedDisplay
              : resolveEditedWeightKg(originalKg, editUnit, editedDisplay)
          const r = editReps.trim() === '' ? null : parseInt(editReps, 10)
          setLogError('')
          // Weight and reps only (reviewer's instruction) — no rir, no
          // formRating keys at all, so updateSetLog (sessionService.ts)
          // never touches those columns for a warmup edit.
          onUpdate({ weight: w, reps: r })
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
                onClick={saveWarmupEdit}
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
            <div className="flex items-center gap-2 pl-7">
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
                <span className="text-xs" style={{ color: 'var(--error)', fontFamily: 'var(--font-mono)' }}>
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
          style={{ backgroundColor: 'var(--surface)', minHeight: 44 }}
        >
          <span
            className="text-xs font-bold w-5 text-center"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {String(setNumber).padStart(2, '0')}
          </span>
          <span
            className="flex-1 text-sm font-bold"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}
          >
            {currentLog.weight !== null && currentLog.reps !== null ? (
              <>
                {toDisplayWeight(currentLog.weight, editUnit)}
                <span style={{ color: 'var(--text-muted)' }}>{editUnit} × </span>
                {currentLog.reps}
              </>
            ) : (
              'DONE'
            )}
          </span>
          <span
            className="text-xs px-1 rounded"
            style={{ backgroundColor: 'var(--accent)', color: 'var(--base)', fontFamily: 'var(--font-mono)', fontSize: 9 }}
          >
            WARMUP
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
              {/* Edit — rows mode only (see this block's own comment above). */}
              {warmupDisplay !== 'tick' && (
                <button
                  onClick={() => {
                    setEditWeight(currentLog.weight != null ? String(toDisplayWeight(currentLog.weight, editUnit)) : '')
                    setEditReps(currentLog.reps != null ? String(currentLog.reps) : '')
                    setLogError('')
                    setIsEditing(true)
                  }}
                  className="flex-shrink-0 flex items-center justify-center"
                  style={{ width: 28, height: 28, color: 'var(--text-muted)' }}
                  aria-label="Edit set"
                >
                  <Pencil size={13} />
                </button>
              )}
              {/* Delete — both modes. In tick mode this IS "untick": a ticked
                  warmup has no value to edit, only to undo. */}
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

    // Shares resolveTiming (declared below, hoisted — a function
    // declaration) so a warmup's restSeconds is captured exactly like a
    // working set's: time since the rest timer last started, nothing else
    // (no Start Set flow is ever offered on a warmup row).
    const handleWarmupLog = () => {
      const wEntered = weight.trim() === '' ? null : parseFloat(weight.replace(',', '.'))
      const r = reps.trim() === '' ? null : parseInt(reps, 10)
      const { restSeconds, setSeconds } = resolveTiming()
      onLog({
        weekPlanSetId: plannedSet?.id ?? null,
        setNumber,
        // Both optional (SPEC, verbatim) — unlike handleLog's working-set
        // guard below, an empty/unparsed field is simply null, never a
        // validation error.
        weight: wEntered !== null && !Number.isNaN(wEntered) ? toStorageWeight(wEntered, resolvedUnit) : null,
        reps: r !== null && !Number.isNaN(r) ? r : null,
        rir: null,
        isDropset: false,
        isSkipped: false,
        restSeconds,
        setSeconds,
        enteredUnit: null,
        formRating: null,
        stageKind: null,
        isWarmup: true,
      })
    }

    if (warmupDisplay === 'tick') {
      return (
        <button
          onClick={handleWarmupLog}
          className="w-full flex items-center gap-3 px-3 rounded-lg"
          style={{ minHeight: 44, border: '1px solid var(--border)', background: 'transparent' }}
        >
          <span
            className="text-xs font-bold w-5 text-center"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {String(setNumber).padStart(2, '0')}
          </span>
          <span
            className="flex-1 text-sm text-left"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            WARMUP
          </span>
          <Square size={16} style={{ color: 'var(--text-muted)' }} />
        </button>
      )
    }

    // 'rows' (default) — the same two-input + LOG shape a working set's
    // input row uses, minus RIR/MORE/skip/stage — "nothing else".
    return (
      <div className="flex items-center gap-2">
        <span
          className="text-xs font-bold w-5 text-center flex-shrink-0"
          style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
        >
          {String(setNumber).padStart(2, '0')}
        </span>

        <div className="flex-1 relative">
          <input
            type="text"
            inputMode="decimal"
            placeholder="0"
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
            {resolvedUnit}
          </span>
        </div>

        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>×</span>

        <div style={{ width: 60 }} className="flex-shrink-0">
          <input
            type="number"
            inputMode="numeric"
            placeholder="0"
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

        <button
          onClick={handleWarmupLog}
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
    )
  }

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
          formRating: editFormRating,
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

          <div className="pl-7">
            <RatingChips scale={FORM_SCALE} value={editFormRating} onChange={setEditFormRating} label="FORM" />
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
              {/* Chunk 14 — labelled by kind for rest-pause/myo-reps/
                  cluster; a dropset (stageLabel null, same as before this
                  chunk) keeps this exact "STAGE" text, unchanged. */}
              {stageLabel ?? 'STAGE'}
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
                setEditFormRating(currentLog.formRating)
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
  // Chunk 11 (SPEC.md "Removals" — suggested reps per program exercise are
  // replaced by per-set rep targets). Same columnsToRepTarget/formatRepTarget
  // PlanPage's own per-set row uses, so the two screens can never disagree on
  // what "no target" vs. a number/range/AMRAP looks like. 'none' renders
  // nothing, same as the TARGET RIR hint below when targetRir is null.
  const repTarget = columnsToRepTarget({
    repMin: plannedSet?.repMin ?? null,
    repMax: plannedSet?.repMax ?? null,
    isAmrap: plannedSet?.isAmrap ?? false,
  })

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
    // Same belt-and-suspenders as handleStartSet above.
    if (isLocked) return
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
      formRating,
      // Chunk 14 — "as planned" (TASKS.md "Logging"): this row's OWN
      // planned slot, not the display-only `stageKind` prop above. For a
      // head that's a stage row, `plannedSet` (if any) is that stage's own
      // plan row, which by the DB's own check always carries a null
      // stage_kind — so this is correctly null for every stage write with
      // no special-casing, and correctly "as planned" for a head write.
      stageKind: plannedSet?.stageKind ?? null,
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
      formRating: null,
      // Same reasoning as handleLog's own stageKind above.
      stageKind: plannedSet?.stageKind ?? null,
    })
  }

  return (
    // Marks the first unlogged, non-stage row for useScrollToCurrentSet.ts
    // (post-launch fix, 2026-08-10) — a stage-input row is deliberately
    // unmarked since it only ever renders right where the user just tapped
    // ADD STAGE / "mark as dropset", never scrolled out of view the way a
    // planned/extra set further down the session can be. Locked (chunk 3):
    // same row, same opacity-0.5 dim this file already uses on these same
    // two inputs for lastLogsLoading — applied once here, at the row root,
    // rather than repeated on every element below.
    <div
      className="space-y-1"
      data-unlogged-set={isStage ? undefined : 'true'}
      style={{ opacity: isLocked ? 0.5 : 1 }}
    >
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
            disabled={lastLogsLoading || isLocked}
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
            disabled={isLocked}
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
            disabled={lastLogsLoading || isLocked}
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

        {/* LOG / START SET button — 44px touch target. Locked: the same
            slot, same size, shows LOCKED and is disabled — the row becomes
            interactive (LOG, or START SET) once it isn't, no change of
            shape. */}
        {isLocked ? (
          <button
            disabled
            className="flex-shrink-0 px-4 rounded-lg font-black text-sm tracking-wider"
            style={{
              height: 44,
              backgroundColor: 'var(--accent)',
              color: 'var(--base)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            LOCKED
          </button>
        ) : measureSetTime && !isTiming ? (
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

      {/* Target reps hint (chunk 11) — same row shape as the TARGET RIR hint
          right below, kept as its own independent block (rather than merged
          into one line) so a set with no rep target renders exactly as
          before: nothing here, same as today. */}
      {repTarget.type !== 'none' && (
        <div className="flex items-center gap-2 pl-7">
          <span
            className="text-xs"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            TARGET REPS {formatRepTarget(repTarget)}
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

      {/* Stage-kind hint (chunk 14, "the workout screen labels stages by
          kind") — same row shape as the two hints above, so a dropset stage
          (stageLabel null) renders exactly as before this chunk: nothing
          here, whether the row is locked (not its turn yet) or the one
          actively loggable now. */}
      {stageLabel && (
        <div className="flex items-center gap-2 pl-7">
          <span
            className="text-xs"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            {stageLabel}
          </span>
        </div>
      )}

      {/* Expandable: achieved RIR + dropset + skip. Disabled when locked —
          not hidden (removing it would change the row's shape) — so it can
          never be opened into a half-interactive state while everything
          else here is inert. */}
      <div className="pl-7">
        <button
          disabled={isLocked}
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
        <div className="space-y-2 pl-7">
        <div className="flex items-center gap-2 flex-wrap">
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

        {/* Form rating — offered on stage rows too: a drop stage is a set
            performed with some quality, even though its rating is excluded
            from average-form (Progress computes heads-only, TASKS.md §7.2 —
            the model still sees every stage's rating, per §7.2's "code
            averages heads only; the model reads everything" split). */}
        <RatingChips scale={FORM_SCALE} value={formRating} onChange={setFormRating} label="FORM" />
        </div>
      )}
    </div>
  )
}
