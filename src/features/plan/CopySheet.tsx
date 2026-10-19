import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Check, Lock } from 'lucide-react'
import BottomSheet from '../../components/BottomSheet'
import { errorReason } from '../../components/exercisePickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import type { PlanningType, WeekPlan } from '../../types'
import { copyEyebrow, copyFieldsOffered, copyUpdates, numbersOps, pickedWorkouts, type CopyRow } from './copySheetLogic'
import { useCopyNumbers } from './useCopyNumbers'
import type { CopyField } from './weekPlanning'

// Chunk 52 (TASKS-1.2 "Plan's header" → CopySheet; SPEC Weeks and copying [1.2] → COPY (2c); G53; Defaults 7; board 2). "Copy last week's
// numbers": which fields (WEIGHT, REPS, RIR, all ticked; a stable week offers WEIGHT and RIR only, G53: the default owns its rep
// targets), which of this week's workouts (every one that isn't done ticked; a done one is locked and says so), "Overwrite what's
// already there" (off: only empty boxes get filled), and COPY INTO N WORKOUTS, which sends what `copyNumbers` returns as one
// `v2_apply_ops` request. The sheet decides nothing itself: `copySheetLogic.ts` says which week each workout copies from, what changes
// and what the ops are, and `useCopyNumbers` writes them.
//
// Display choices no board settles, provisional under D31 (chunk 52's report lists them): the button reads PICK A WORKOUT, PICK WHAT TO
// COPY or NOTHING TO COPY, and is disabled, when there is nothing to send (board 2 draws only the first); a workout with no earlier
// planned week with sets stays in the list, unticked, saying NO EARLIER WEEK; a failure is a line above the button, "Couldn't copy the
// numbers." and the real reason under it (SPEC Errors (15)), with the sheet's choices kept.

export interface CopySheetProps {
  unit: 'week' | 'cycle'
  weekNumber: number
  planningType: PlanningType
  /** This week's workouts, with the week each copies from (`copyRows`). */
  rows: readonly CopyRow[]
  /** This week's plan rows, as read now: what `copyNumbers` compares with. */
  thisWeek: readonly WeekPlan[]
  onClose: () => void
}

const CAPTION: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 10,
  letterSpacing: '0.2em',
  color: 'var(--text-muted)',
}

const FIELD_LABEL: Record<CopyField, string> = { weight: 'WEIGHT', reps: 'REPS', rir: 'RIR' }

/** A 20 px tick box; the tick on the accent is `--on-accent` (text on the accent, DECISIONS 128 (g)). */
function TickBox({ on, size, locked }: { on: boolean; size: number; locked?: boolean }) {
  return (
    <span
      aria-hidden="true"
      style={{
        flex: '0 0 auto',
        boxSizing: 'border-box',
        width: size,
        height: size,
        borderRadius: 5,
        borderWidth: 2,
        borderStyle: 'solid',
        borderColor: on ? 'var(--accent)' : locked ? 'var(--border)' : 'var(--border-strong)',
        background: on ? 'var(--accent)' : locked ? 'var(--surface-raised)' : 'var(--surface)',
        color: 'var(--on-accent)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {on && <Check size={size - 8} strokeWidth={3.5} />}
    </span>
  )
}

export default function CopySheet({ unit, weekNumber, planningType, rows, thisWeek, onClose }: CopySheetProps) {
  const offered = copyFieldsOffered(planningType)
  const [fields, setFields] = useState<ReadonlySet<CopyField>>(() => new Set(offered))
  // Every workout starts ticked (Defaults 7); which of them can be copied into is `pickedWorkouts`' to say, so a done workout is
  // never one whatever this set holds.
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(rows.map((row) => row.id)))
  const [overwrite, setOverwrite] = useState(false)
  const copy = useCopyNumbers()
  const inFlight = useRef(false)

  const word = unit.toUpperCase() as 'WEEK' | 'CYCLE'
  const workouts = pickedWorkouts(rows, picked)
  const updates = copyUpdates({ rows, picked, fields, overwrite, thisWeek })
  const canCopy = workouts.length > 0 && fields.size > 0 && updates.length > 0
  const label = copy.isPending
    ? 'COPYING…'
    : workouts.length === 0
      ? 'PICK A WORKOUT'
      : fields.size === 0
        ? 'PICK WHAT TO COPY'
        : updates.length === 0
          ? 'NOTHING TO COPY'
          : `COPY INTO ${workouts.length} ${workouts.length === 1 ? 'WORKOUT' : 'WORKOUTS'}`

  function toggleField(field: CopyField) {
    setFields((current) => {
      const next = new Set(current)
      if (next.has(field)) next.delete(field)
      else next.add(field)
      return next
    })
  }

  function toggleRow(row: CopyRow) {
    if (row.state !== 'open') return
    setPicked((current) => {
      const next = new Set(current)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

  async function send() {
    if (inFlight.current || !canCopy) return
    inFlight.current = true
    try {
      await copy.mutateAsync(numbersOps(updates))
      onClose()
    } catch {
      // the failure is the mutation's own state: the line above the button
    } finally {
      inFlight.current = false
    }
  }

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  return (
    <BottomSheet
      eyebrow={copyEyebrow({ unit: word, week: weekNumber, rows })}
      title={`Copy last ${unit}'s numbers`}
      onClose={onClose}
      footer={
        <>
          {copy.isError && (
            <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ ...CAPTION, letterSpacing: '0.1em', color: 'var(--error)' }}>Couldn't copy the numbers.</span>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{errorReason(copy.error, offline)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void send()}
            disabled={!canCopy || copy.isPending}
            style={{
              height: 52,
              borderWidth: 0,
              borderRadius: 10,
              background: canCopy ? 'var(--accent)' : 'var(--surface-raised)',
              color: canCopy ? 'var(--on-accent)' : 'var(--text-muted)',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: '0.03em',
              cursor: canCopy && !copy.isPending ? 'pointer' : 'default',
            }}
          >
            {label}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={CAPTION}>COPY</span>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${offered.length}, minmax(0, 1fr))`, gap: 8 }}>
          {offered.map((field) => {
            const on = fields.has(field)
            return (
              <button
                key={field}
                type="button"
                role="checkbox"
                aria-checked={on}
                onClick={() => toggleField(field)}
                style={{
                  height: 48,
                  padding: 0,
                  borderRadius: 10,
                  ...hairline(on ? 'var(--accent)' : 'var(--border)'),
                  background: on ? 'var(--accent-muted)' : 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  cursor: 'pointer',
                }}
              >
                <TickBox on={on} size={18} />
                <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, letterSpacing: '0.15em', color: 'var(--text-primary)' }}>
                  {FIELD_LABEL[field]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={CAPTION}>INTO</span>
        <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden', ...hairline('var(--border)') }}>
          {rows.map((row, index) => {
            const on = row.state === 'open' && picked.has(row.id)
            const locked = row.state !== 'open'
            return (
              <button
                key={row.id}
                type="button"
                role="checkbox"
                aria-checked={on}
                aria-disabled={locked}
                onClick={() => toggleRow(row)}
                style={{
                  minHeight: 48,
                  padding: '0 12px',
                  borderWidth: 0,
                  borderTopWidth: index === 0 ? 0 : 1,
                  borderTopStyle: 'solid',
                  borderTopColor: 'var(--border-subtle)',
                  background: locked ? 'var(--surface-raised)' : 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  textAlign: 'left',
                  cursor: locked ? 'default' : 'pointer',
                }}
              >
                <TickBox on={on} size={20} locked={locked} />
                <span style={{ flex: '0 0 auto', minWidth: 34, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                  {row.day}
                </span>
                <span style={{ flex: '1 1 auto', minWidth: 0, fontWeight: 700, fontSize: 15, color: locked ? 'var(--text-muted)' : 'var(--text-primary)', overflowWrap: 'anywhere' }}>
                  {row.name}
                </span>
                {row.state === 'done' && (
                  <span style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                    <Lock size={11} strokeWidth={2.5} aria-hidden="true" />
                    DONE
                  </span>
                )}
                {row.state === 'no_source' && (
                  <span style={{ flex: '0 0 auto', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                    {`NO EARLIER ${word}`}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={overwrite}
        onClick={() => setOverwrite((current) => !current)}
        style={{
          minHeight: 60,
          padding: '8px 12px',
          borderRadius: 10,
          ...hairline('var(--border)'),
          background: 'var(--surface)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>Overwrite what's already there</span>
          <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text-secondary)' }}>
            {overwrite ? 'On: numbers you already typed get replaced.' : 'Off: only empty boxes get filled.'}
          </span>
        </span>
        <span
          aria-hidden="true"
          style={{
            flex: '0 0 auto',
            position: 'relative',
            boxSizing: 'border-box',
            width: 44,
            height: 26,
            borderRadius: 13,
            background: overwrite ? 'var(--accent)' : 'var(--surface-raised)',
            ...hairline(overwrite ? 'var(--accent)' : 'var(--border-strong)'),
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: 2,
              left: overwrite ? 20 : 2,
              width: 20,
              height: 20,
              borderRadius: 10,
              background: overwrite ? 'var(--on-accent)' : 'var(--border-strong)',
            }}
          />
        </span>
      </button>
    </BottomSheet>
  )
}
