// Chunk 58a — the current set's row (boards W1, W2, W3): every field plus LOG (SPEC [1.2] "Row states": "current → every field, plus
// LOG"). A stage row is the same row with a "↳". The boxes hold the plan's targets (DECISIONS 162 (a)): a number target and a planned
// weight are values, a range or AMRAP is a dim placeholder (so LOG needs reps typed), and with no planned weight the weight box is
// empty and LOG needs it. Last time's numbers show on the LAST line only. LOG hands the card the values; the card says which set
// it is (`useExerciseCardState`: the number is the row's).
import { useEffect, useRef, useState } from 'react'
import { MoreVertical } from 'lucide-react'
import type { FormRating, WeekPlanSet, WeightUnit } from '../../types'
import type { ResolvedRow } from './workoutRules'
import type { LogParams } from './useExerciseCardState'
import { useRestTimerStore } from './restTimerStore'
import { useSetTimerStore } from './setTimerStore'
import { useSettingsStore } from '../settings/settingsStore'
import { formatRestTime } from '../../lib/formatRestTime'
import { toDisplayWeight, toStorageWeight } from '../../lib/weightUnit'
import { FORM_SCALE } from './ratingScales'
import RatingChips from './RatingChips'
import { CueLine, LastLine, RowLabel, boxStyle } from './setRowParts'
import { rowDefaults, rowLabelText } from './workoutRowView'

interface SetRowCurrentProps {
  row: ResolvedRow
  planned: WeekPlanSet | null
  /** The exercise's own unit (Settings' default unless the exercise overrides it); what the boxes are typed in unless this set flips it. */
  resolvedUnit: WeightUnit
  /** "52.5 × 10 @ 1": last time's set at this place ('' when there is none or this is a drop). */
  lastLine: string
  /** The weight (kg) a carrying kind's next stage starts from (stageCarryLogic.ts); null for a dropset and a head. */
  carryWeightKg?: number | null
  /** Seconds since the rest timer last started, read when LOG is pressed. */
  restElapsed: () => number | null
  onLog: (params: LogParams) => void
}

const MONO = 'var(--font-mono)'

export default function SetRowCurrent({ row, planned, resolvedUnit, lastLine, carryWeightKg = null, restElapsed, onLog }: SetRowCurrentProps) {
  const isStage = row.kind === 'stage'
  const measureSetTime = useSettingsStore((s) => s.measureSetTime)
  const setTimerStartedAt = useSetTimerStore((s) => s.startedAt)

  // The rarely-used logging-time unit override (SPEC §8.1): flips this one set between the exercise's unit and the other, without
  // changing the exercise's configured default. null = no override.
  const [unitOverride, setUnitOverride] = useState<WeightUnit | null>(null)
  const activeUnit = unitOverride ?? resolvedUnit
  const otherUnit: WeightUnit = resolvedUnit === 'kg' ? 'lbs' : 'kg'

  const defaults = rowDefaults(planned, activeUnit)
  const carried = carryWeightKg != null ? String(toDisplayWeight(carryWeightKg, activeUnit)) : null
  const [weight, setWeight] = useState(carried ?? defaults.weight)
  const [reps, setReps] = useState(defaults.reps)
  const [rir, setRir] = useState('')
  const [formRating, setFormRating] = useState<FormRating | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [logError, setLogError] = useState('')
  // Typed text is never overwritten by the plan arriving or the unit flipping.
  const userEditedRef = useRef(false)
  useEffect(() => {
    if (userEditedRef.current) return
    setWeight(carried ?? defaults.weight)
    setReps(defaults.reps)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carried, defaults.weight, defaults.reps])

  // Start Set flow (v3 §2.2): measureSetTime on. The rest timer stops at START SET (true rest ends there, not at LOG), so the rest
  // value is frozen then.
  const [isTiming, setIsTiming] = useState(false)
  const [frozenRestSeconds, setFrozenRestSeconds] = useState<number | null>(null)
  const [setElapsed, setSetElapsed] = useState(0)
  // While timing the boxes are hidden (board W2) unless LOG found them empty.
  const [editWhileTiming, setEditWhileTiming] = useState(false)
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

  // Resolves the final restSeconds/setSeconds pair and tears down the set timer — shared by LOG and SKIP so both honour the Start Set
  // flow identically. With measureSetTime off, or Start Set never tapped, restSeconds is the live rest elapsed.
  function resolveTiming(): { restSeconds: number | null; setSeconds: number | null } {
    if (!measureSetTime || !isTiming) return { restSeconds: restElapsed(), setSeconds: null }
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
      setLogError('Enter weight and reps, or skip the set from ⋮.')
      setEditWhileTiming(true)
      return
    }
    setLogError('')
    const rirVal = rir.trim() === '' ? null : parseInt(rir, 10)
    const { restSeconds, setSeconds } = resolveTiming()
    // Canonical storage is always kg (v3 §2.4); what was typed is in activeUnit and converted here, once, at the write boundary.
    // enteredUnit records the override only when one was used.
    onLog({
      weekPlanSetId: planned?.id ?? null,
      setNumber: row.number,
      weight: toStorageWeight(wEntered, activeUnit),
      reps: r,
      rir: rirVal !== null && Number.isNaN(rirVal) ? null : rirVal,
      isDropset: isStage,
      isSkipped: false,
      restSeconds,
      setSeconds,
      enteredUnit: activeUnit === resolvedUnit ? null : activeUnit,
      formRating,
      stageKind: planned?.stageKind ?? null,
    })
  }

  function handleSkip() {
    setLogError('')
    const { restSeconds } = resolveTiming()
    onLog({
      weekPlanSetId: planned?.id ?? null,
      setNumber: row.number,
      weight: null,
      reps: null,
      rir: null,
      isDropset: false,
      isSkipped: true,
      restSeconds,
      setSeconds: null,
      enteredUnit: null,
      formRating: null,
      stageKind: planned?.stageKind ?? null,
    })
  }

  const hidden = isTiming && !editWhileTiming
  const invalid = logError !== ''
  const edited = (setter: (value: string) => void) => (e: { target: { value: string } }) => {
    userEditedRef.current = true
    setter(e.target.value)
    if (logError) setLogError('')
  }
  const tags = planned?.tags ?? null

  return (
    <div className="space-y-1" data-current-set="true" data-row-key={row.key}>
      <div
        className="flex items-center gap-2"
        style={{
          padding: '6px 6px 6px 8px',
          borderRadius: 10,
          backgroundColor: 'var(--accent-muted)',
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: 'var(--accent)',
        }}
      >
        <RowLabel text={rowLabelText(row)} accent />

        {hidden ? (
          <div
            className="flex-1 flex items-center justify-center"
            style={{ height: 44, borderRadius: 8, backgroundColor: 'var(--accent-muted)', color: 'var(--accent)', fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em' }}
          >
            TIMING {formatRestTime(setElapsed)}
          </div>
        ) : (
          <>
            <div className="flex-1 relative" style={{ minWidth: 64 }}>
              <input
                type="text"
                inputMode="decimal"
                aria-label="Weight"
                value={weight}
                onChange={edited(setWeight)}
                className="w-full"
                style={boxStyle({ paddingLeft: 8, paddingRight: 28, fontSize: 16, borderColor: invalid && weight.trim() === '' ? 'var(--error)' : 'var(--border)' })}
              />
              {/* The unit label is the logging-time override (SPEC §8.1): tapping it flips this one set between the two units. */}
              <button
                type="button"
                onClick={() => setUnitOverride(unitOverride === null ? otherUnit : null)}
                className="absolute text-xs"
                style={{
                  right: 6,
                  bottom: 8,
                  color: unitOverride !== null ? 'var(--accent)' : 'var(--text-muted)',
                  fontFamily: MONO,
                  fontWeight: unitOverride !== null ? 700 : 400,
                  fontSize: 10,
                }}
                aria-label={`Log this set in ${otherUnit}`}
              >
                {activeUnit}
              </button>
            </div>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>×</span>
            <input
              type="number"
              inputMode="numeric"
              aria-label="Reps"
              placeholder={defaults.repsHint}
              value={reps}
              onChange={edited(setReps)}
              style={boxStyle({ width: 48, flexShrink: 0, fontSize: 16, borderColor: invalid && reps.trim() === '' ? 'var(--error)' : 'var(--border)' })}
            />
            <label className="flex flex-col items-center justify-center flex-shrink-0" style={boxStyle({ width: 48, paddingTop: 3 })}>
              <span style={{ fontSize: 8, letterSpacing: '0.1em', color: 'var(--text-muted)', lineHeight: 1 }}>RIR</span>
              <input
                type="number"
                inputMode="numeric"
                aria-label="RIR"
                placeholder={defaults.rirHint || '—'}
                value={rir}
                onChange={edited(setRir)}
                className="w-full"
                style={{ background: 'transparent', border: 'none', textAlign: 'center', fontFamily: MONO, fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', height: 22, padding: 0 }}
              />
            </label>
          </>
        )}

        <button
          type="button"
          onClick={measureSetTime && !isTiming ? handleStartSet : handleLog}
          className="flex-shrink-0 rounded-lg font-black text-sm tracking-wider"
          style={{ height: 44, padding: '0 12px', minWidth: 56, backgroundColor: 'var(--accent)', color: 'var(--on-accent)', fontFamily: MONO }}
        >
          {measureSetTime && !isTiming ? 'START SET' : 'LOG'}
        </button>

        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          className="flex-shrink-0 flex items-center justify-center"
          style={{ width: 24, height: 44, color: 'var(--text-muted)' }}
          aria-label="Set options"
          aria-expanded={showMore}
        >
          <MoreVertical size={16} />
        </button>
      </div>

      {logError && (
        <p className="text-xs" style={{ paddingLeft: 36, color: 'var(--error)', fontFamily: MONO }}>
          {logError}
        </p>
      )}

      {/* Chunk 61 replaces this with the set ⋯ sheet (W7): FORM and SKIP THIS SET are today's actions, kept reachable until then. */}
      {showMore && (
        <div className="space-y-2" style={{ paddingLeft: 36 }}>
          <RatingChips scale={FORM_SCALE} value={formRating} onChange={setFormRating} label="FORM" />
          {!isStage && (
            <button
              type="button"
              onClick={handleSkip}
              className="flex items-center justify-center text-xs px-3 rounded"
              style={{ minHeight: 44, color: 'var(--text-muted)', border: '1px solid var(--border)', fontFamily: MONO }}
            >
              SKIP THIS SET
            </button>
          )}
        </div>
      )}

      <CueLine tags={tags} />
      <LastLine text={lastLine} />
    </div>
  )
}
