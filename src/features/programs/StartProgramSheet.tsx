import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CircleAlert } from 'lucide-react'
import BottomSheet from '../../components/BottomSheet'
import { errorReason } from '../../components/exercisePickerLogic'
import type { Program } from '../../types'
import { useStartRun } from './useMesos'
import { useProgramHasSchedule } from './useProgramHasSchedule'
import RadioDot from './RadioDot'
import { NO_SCHEDULE_REASON, PLAN_WEEK_ONE_PATH, runNameFor, startFailedLine, startNote, startSheetTitle } from './programsTabLogic'

// START (chunk 65; TASKS-1.2 "The PROGRAMS tab"; SPEC Programs and runs [1.2], Starting: "lands on Plan, week 1. The start sheet's optional
// name field defaults to the program's name. Starting while a program runs finishes the running one first and says so (PR9)"; Programs and
// runs [P1.1]: "Starting a run needs a schedule"; Errors (15); boards PR8, PR9, PR10, PR11, PR12).
//
// One sheet for the program a row's START was tapped on (preselected) or any other of the saved ones: NAME (OPTIONAL), whose placeholder is
// the picked program's name and which is what a blank one starts as; the PROGRAM list; PR9's line when a program is running; START PROGRAM,
// disabled with PR11's reason when the picked program has no scheduled workout (`useProgramHasSchedule`, the one check every START shares:
// `hasSchedule.ts`), and with nothing to start (PR12) the way to make a program. It starts the run through `useStartRun` (`v2_start_run`,
// which ends a running program atomically: this sheet never ends one itself) and goes to Plan, week 1. A failed start leaves the sheet open
// with PR10's banner over it: "Couldn't start [name]." and the real reason under it, whatever came back (Supabase's errors aren't `Error`
// objects: `errorReason` reads their `message`).
//
// Display choices no board settles, provisional under D31: PR10 draws the banner at the top of the screen, over the scrim, so the sheet draws
// it itself, in a layer of its own, and it stays until the next START or until the sheet closes (the app's bottom toast, 3 seconds, is not
// where the board has it and would go before a long reason could be read); while the picked program's workouts are still being read, START
// is off and says nothing (the reason shows only once it is known: DECISIONS 85); a second tap on START in the same instant starts nothing
// (the run is written once).

export interface StartProgramSheetProps {
  /** The saved programs, in the order YOUR PROGRAMS lists them. */
  programs: Program[]
  /** The program whose row's START opened the sheet; it starts picked. */
  presetProgramId?: string
  /** The running program's name (PR9's line names it), or null when none is running. */
  runningName: string | null
  onClose: () => void
  /** PR12's CREATE PROGRAM: the caller opens the New program sheet. */
  onCreateProgram: () => void
}

const LABEL: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

const PRIMARY_BUTTON: CSSProperties = {
  height: 52,
  boxSizing: 'border-box',
  borderRadius: 10,
  borderWidth: 0,
  fontFamily: 'var(--font-display)',
  fontWeight: 800,
  fontSize: 15,
  letterSpacing: '0.03em',
}

// PR10's banner: over the scrim at the top of the screen, a 12 px card with the alert icon, the headline and the reason in mono. Above the
// sheet (45), below the confirm dialog (70).
const BANNER: CSSProperties = {
  position: 'fixed',
  top: 16,
  left: 16,
  right: 16,
  zIndex: 60,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
  background: 'var(--surface-overlay)',
}

interface StartFailure {
  programName: string
  reason: unknown
}

export default function StartProgramSheet({ programs, presetProgramId, runningName, onClose, onCreateProgram }: StartProgramSheetProps) {
  const navigate = useNavigate()
  const startRun = useStartRun()
  const [selectedId, setSelectedId] = useState(() => presetProgramId ?? programs[0]?.id ?? '')
  const [typedName, setTypedName] = useState('')
  const [failure, setFailure] = useState<StartFailure | null>(null)
  // A second tap in the same instant arrives before React has drawn the pending state: a ref says a start is already out.
  const inFlight = useRef(false)

  const selected = programs.find((p) => p.id === selectedId)
  const hasSchedule = useProgramHasSchedule(selected)
  const pending = startRun.isPending
  // Off while the program's schedule isn't known yet, and for a program that has none (the reason shows only for the latter).
  const blocked = !selected || hasSchedule !== true
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  async function start() {
    if (!selected || hasSchedule !== true || inFlight.current) return
    inFlight.current = true
    setFailure(null)
    try {
      await startRun.mutateAsync({ name: runNameFor(typedName, selected), programId: selected.id })
      onClose()
      navigate(PLAN_WEEK_ONE_PATH)
    } catch (reason) {
      setFailure({ programName: selected.name, reason })
    } finally {
      inFlight.current = false
    }
  }

  // PR12: nothing to start.
  if (programs.length === 0) {
    return (
      <BottomSheet title={startSheetTitle(runningName !== null)} onClose={onClose}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '24px 0 8px' }}>
          <span style={{ fontSize: 15, color: 'var(--text-secondary)' }}>Create a program first.</span>
          <button
            type="button"
            onClick={onCreateProgram}
            style={{ ...PRIMARY_BUTTON, width: '100%', background: 'var(--accent)', color: 'var(--on-accent)', cursor: 'pointer' }}
          >
            CREATE PROGRAM
          </button>
        </div>
      </BottomSheet>
    )
  }

  return (
    <>
      <BottomSheet
        title={startSheetTitle(runningName !== null)}
        onClose={onClose}
        footer={
          <>
            <button
              type="button"
              onClick={start}
              disabled={blocked || pending}
              style={{
                ...PRIMARY_BUTTON,
                background: blocked && !pending ? 'var(--surface-raised)' : 'var(--accent)',
                color: blocked && !pending ? 'var(--text-dim)' : 'var(--on-accent)',
                cursor: blocked || pending ? 'default' : 'pointer',
              }}
            >
              {pending ? 'STARTING…' : 'START PROGRAM'}
            </button>
            {hasSchedule === false && <span style={{ textAlign: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>{NO_SCHEDULE_REASON}</span>}
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="start-program-name" style={LABEL}>
            NAME <span style={{ color: 'var(--text-dim)' }}>(OPTIONAL)</span>
          </label>
          <input
            id="start-program-name"
            type="text"
            value={typedName}
            onChange={(event) => setTypedName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void start()
              }
            }}
            placeholder={selected?.name ?? ''}
            style={{
              height: 48,
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

        <div role="radiogroup" aria-label="Program" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={LABEL}>PROGRAM</span>
          {programs.map((program) => {
            const on = program.id === selectedId
            return (
              <button
                key={program.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setSelectedId(program.id)}
                style={{
                  minHeight: 48,
                  boxSizing: 'border-box',
                  borderRadius: 10,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: on ? 'var(--accent)' : 'var(--border)',
                  background: on ? 'var(--accent-muted)' : 'var(--surface)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 14px',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontWeight: 600, fontSize: 15, color: on ? 'var(--accent)' : 'var(--text-primary)' }}>{program.name}</span>
                <RadioDot on={on} />
              </button>
            )
          })}
        </div>

        {runningName !== null && <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--text-secondary)' }}>{startNote(runningName)}</span>}
      </BottomSheet>

      {failure &&
        createPortal(
          <div role="alert" style={BANNER}>
            <span style={{ flex: '0 0 auto', paddingTop: 1, color: 'var(--error)' }}>
              <CircleAlert size={16} strokeWidth={2.2} aria-hidden="true" />
            </span>
            <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 14, lineHeight: 1.45, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{startFailedLine(failure.programName)}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{errorReason(failure.reason, offline)}</span>
            </span>
          </div>,
          document.body,
        )}
    </>
  )
}
