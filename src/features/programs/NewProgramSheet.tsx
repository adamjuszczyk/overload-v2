import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import BottomSheet from '../../components/BottomSheet'
import { errorReason } from '../../components/exercisePickerLogic'
import type { PlanningType, ScheduleType } from '../../types'
import { useCreateProgram } from './usePrograms'
import RadioDot from './RadioDot'
import { createState, plannerPath } from './programsTabLogic'

// The New program sheet (chunk 65; TASKS-1.2 "The PROGRAMS tab"; SPEC Programs and runs [1.2], Creating a program (16a): "the New program
// sheet asks for the name, the schedule type and the planning type. Neither type is preselected; CREATE PROGRAM stays disabled until both
// are chosen, and the sheet says why. Each option carries a one-line description (PR13, PR13b). Both can be changed later in the stepped
// program planner, as today"; boards PR13, PR13b).
//
// PROGRAM NAME; SCHEDULE (Weekdays / Sequence) and PLANNING (Stable / Week-dependent), each with its option's description and, until one is
// picked, "CHOOSE ONE" at the group's right; CREATE PROGRAM and the one line under it (`createState`). Creating writes the program with both
// types in one insert (`useCreateProgram` → `createProgram`) and opens the stepped planner on it. A failed create leaves the sheet open with
// "Couldn't create the program." and the real reason under it (SPEC Errors (15)); the board draws no such state, so the words are ours (D31,
// provisional), as the name rule is: a program with no name isn't created, and the line under the button says so. A second tap in the same
// instant creates nothing more (one program).

export interface NewProgramSheetProps {
  onClose: () => void
}

const SCHEDULE_OPTIONS: ReadonlyArray<{ value: ScheduleType; name: string; description: string }> = [
  { value: 'weekday', name: 'Weekdays', description: 'Each workout has its days, like Push on Monday.' },
  { value: 'sequence', name: 'Sequence', description: 'Workouts in a set order. Do the next one whenever you train.' },
]

const PLANNING_OPTIONS: ReadonlyArray<{ value: PlanningType; name: string; description: string }> = [
  { value: 'stable', name: 'Stable', description: 'The same sets every week. A change in one week lasts that week only.' },
  { value: 'week_dependent', name: 'Week-dependent', description: 'Each week starts as a copy of the last, and you change it as you go.' },
]

const LABEL: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

function OptionGroup<T extends string>({ label, options, value, onPick }: { label: string; options: ReadonlyArray<{ value: T; name: string; description: string }>; value: T | null; onPick: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ ...LABEL, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        {label}
        {value === null && <span style={{ fontSize: 9, letterSpacing: '0.15em', color: 'var(--accent)' }}>CHOOSE ONE</span>}
      </span>
      {options.map((option) => {
        const on = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(option.value)}
            style={{
              minHeight: 60,
              boxSizing: 'border-box',
              padding: '9px 12px',
              borderRadius: 10,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: on ? 'var(--accent)' : 'var(--border)',
              background: on ? 'var(--accent-muted)' : 'var(--surface)',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <RadioDot on={on} />
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' }}>{option.name}</span>
              <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text-secondary)' }}>{option.description}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function NewProgramSheet({ onClose }: NewProgramSheetProps) {
  const navigate = useNavigate()
  const createProgram = useCreateProgram()
  const [name, setName] = useState('')
  const [scheduleType, setScheduleType] = useState<ScheduleType | null>(null)
  const [planningType, setPlanningType] = useState<PlanningType | null>(null)
  const [failure, setFailure] = useState<{ reason: unknown } | null>(null)
  // A second tap in the same instant arrives before React has drawn the pending state: a ref says a create is already out.
  const inFlight = useRef(false)

  const { canCreate, hint } = createState({ name, scheduleType, planningType })
  const pending = createProgram.isPending
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  async function create() {
    if (!canCreate || scheduleType === null || planningType === null || inFlight.current) return
    inFlight.current = true
    setFailure(null)
    try {
      const created = await createProgram.mutateAsync({ name: name.trim(), scheduleType, planningType })
      onClose()
      navigate(plannerPath(created.id))
    } catch (reason) {
      setFailure({ reason })
    } finally {
      inFlight.current = false
    }
  }

  const ready = canCreate || pending
  return (
    <BottomSheet
      title="New program"
      onClose={onClose}
      footer={
        <>
          {failure && (
            <div role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', color: 'var(--error)' }}>Couldn't create the program.</span>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{errorReason(failure.reason, offline)}</span>
            </div>
          )}
          <button
            type="button"
            onClick={create}
            disabled={!canCreate || pending}
            style={{
              height: 52,
              boxSizing: 'border-box',
              borderRadius: 10,
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: ready ? 'var(--accent)' : 'var(--border)',
              background: ready ? 'var(--accent)' : 'var(--surface-raised)',
              color: ready ? 'var(--on-accent)' : 'var(--text-dim)',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 15,
              letterSpacing: '0.03em',
              cursor: ready && !pending ? 'pointer' : 'default',
            }}
          >
            {pending ? 'CREATING…' : 'CREATE PROGRAM'}
          </button>
          <span style={{ textAlign: 'center', fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>{hint}</span>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="new-program-name" style={LABEL}>
          PROGRAM NAME
        </label>
        <input
          id="new-program-name"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void create()
            }
          }}
          placeholder="e.g. Hypertrophy Block"
          style={{
            height: 52,
            boxSizing: 'border-box',
            borderRadius: 10,
            borderWidth: 1,
            borderStyle: 'solid',
            borderColor: 'var(--border-strong)',
            background: 'var(--surface)',
            padding: '0 14px',
            fontFamily: 'var(--font-sans)',
            fontSize: 16,
            color: 'var(--text-primary)',
            outline: 'none',
          }}
        />
      </div>
      <OptionGroup label="SCHEDULE" options={SCHEDULE_OPTIONS} value={scheduleType} onPick={setScheduleType} />
      <OptionGroup label="PLANNING" options={PLANNING_OPTIONS} value={planningType} onPick={setPlanningType} />
    </BottomSheet>
  )
}
