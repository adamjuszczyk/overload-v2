import { useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import ConfirmDialog from '../../components/ConfirmDialog'
import { errorReason } from '../../components/exercisePickerLogic'
import PlanTabs, { type PlanTab } from '../plan/PlanTabs'
import { useSequenceCurrentCycle } from '../plan/useSequenceCurrentCycle'
import { useToday } from '../../hooks/useToday'
import type { Mesocycle, Program } from '../../types'
import { useMesos, useCompleteMeso } from './useMesos'
import { usePrograms, useSavedPrograms } from './usePrograms'
import CurrentProgramCard from './CurrentProgramCard'
import StartProgramSheet from './StartProgramSheet'
import NewProgramSheet from './NewProgramSheet'
import { finishedMeta, finishedProgramPath, plannerPath, programTypesLine, weekOfRun } from './programsTabLogic'

// The PROGRAMS tab (chunk 65; TASKS-1.2 "The PROGRAMS tab"; SPEC Screens → PROGRAMS [rebuilt by 1.2], Programs and runs [1.2], Navigation and
// settings [1.2] → PLAN | PROGRAMS (8), Language → "Program everywhere" (C12); boards PR1-PR4, PR6-PR13b). It replaces `ProgramsPage`, which Plan's
// shell drew under the tabs until now (P1.2-12): CURRENT PROGRAM (the card of the running program, or "No program running"), YOUR PROGRAMS
// (each with OPEN, START and, on the one that runs, a RUNNING tag; "+ NEW PROGRAM"), then FINISHED. With nothing at all, PR3; while the
// reads are out, PR4; with no program running the PLAN tab is locked (PR2). START and the New program sheet are `StartProgramSheet` and
// `NewProgramSheet`; FINISH asks first (PR6) and finishes through `useCompleteMeso` (FINISHING…, PR7). END RUN, ACTIVE RUN, COMPLETED RUNS and
// START RUN are gone with the page, as is the 'Mesocycle' literal.
//
// Where it goes: OPEN → the stepped planner on that saved program (`/program/:id`); FOCUS and DON'T CARE → the run's priorities, view-only
// (`/plan/priorities`); EDIT PROGRAM → `/plan/change`; a FINISHED row → the finished program (chunk 66; until then `finishedProgramPath`).
//
// Display choices no board settles, provisional under D31: a read that failed with nothing to show says so with the real reason
// ("COULDN'T LOAD PROGRAMS", never the empty states: an empty answer and a failed one are different things); a finished run is drawn the way the board
// draws a finished program (two lines: its name, then "SEP 14 – OCT 4, 2026 · 3 WEEKS"); FINISH doesn't open the start sheet afterwards (the card
// becomes PR2's block, which says START one of your programs), where END RUN did; "No programs yet" (PR3) is for an account with no saved
// program, no running one and no finished one, and otherwise YOUR PROGRAMS just has nothing under its label.

export interface ProgramsTabProps {
  /** The shell's tab switch: the PLAN tab opens Plan (it is locked while no program runs). */
  onTab: (tab: PlanTab) => void
}

const MONO_CAPTION: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

const CARD: CSSProperties = {
  background: 'var(--surface)',
  borderRadius: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--border)',
}

// The spinner's ring, one side at a time: a captured render drops a `border` shorthand with `var()` (RULES, jsdom), so the PR4 picture would
// show no ring.
const SPINNER_RING: CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: 'var(--accent)',
  borderRightColor: 'var(--border-strong)',
  borderBottomColor: 'var(--border-strong)',
  borderLeftColor: 'var(--border-strong)',
}

const FOOT_BUTTON: CSSProperties = {
  height: 48,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'transparent',
  borderWidth: 0,
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.2em',
  textDecoration: 'none',
  cursor: 'pointer',
}

type Sheet = { kind: 'start'; presetProgramId?: string } | { kind: 'new' } | null

/** The run's own week or cycle: a weekday run's is the calendar week, a sequence run's is read (hooks can't be conditional, so a weekday run reads nothing: empty ids). */
function useRunUnit(meso: Mesocycle | null, program: Program | undefined, today: string): { word: 'WEEK' | 'CYCLE'; n: number | null } | null {
  const sequence = meso !== null && (program?.scheduleType ?? 'weekday') === 'sequence'
  const cycle = useSequenceCurrentCycle(sequence ? meso.id : '', sequence ? meso.programId : '')
  if (meso === null) return null
  return sequence ? { word: 'CYCLE', n: cycle.cycle } : { word: 'WEEK', n: weekOfRun(today, meso.startDate) }
}

function Section({ label, action, children }: { label: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {action ? (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={MONO_CAPTION}>{label}</span>
          {action}
        </div>
      ) : (
        <span style={MONO_CAPTION}>{label}</span>
      )}
      {children}
    </div>
  )
}

export default function ProgramsTab({ onTab }: ProgramsTabProps) {
  const today = useToday()
  const mesosRead = useMesos()
  const savedRead = useSavedPrograms()
  const programsRead = usePrograms()
  const completeMeso = useCompleteMeso()

  const mesos = mesosRead.data
  const savedPrograms = savedRead.data ?? []
  const activeMeso = mesos?.find((m) => m.status === 'active') ?? null
  const finished = (mesos ?? []).filter((m) => m.status === 'completed')
  const runProgram = programsRead.data?.find((p) => p.id === activeMeso?.programId)
  const unit = useRunUnit(activeMeso, runProgram, today)

  // What the tab needs to draw: the runs, the saved programs and, while one runs, its own program (its types). A read with nothing to show
  // and an error is a failure to say so; one still out is PR4.
  const needed = [mesosRead, savedRead, ...(activeMeso ? [programsRead] : [])]
  const failedRead = needed.find((read) => read.isError === true && read.data === undefined)
  const loading = failedRead === undefined && needed.some((read) => read.data === undefined)
  const noRun = mesos !== undefined && activeMeso === null
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  const [sheet, setSheet] = useState<Sheet>(null)
  const [confirmFinish, setConfirmFinish] = useState(false)
  const [finishError, setFinishError] = useState<{ reason: unknown } | null>(null)
  // A second tap on FINISH in the same instant arrives before React has drawn the pending state: a ref says a finish is already out.
  const finishing = useRef(false)

  async function finish() {
    if (!activeMeso || finishing.current) return
    finishing.current = true
    setFinishError(null)
    try {
      await completeMeso.mutateAsync(activeMeso.id)
      setConfirmFinish(false)
    } catch (reason) {
      setFinishError({ reason })
    } finally {
      finishing.current = false
    }
  }

  const subline = loading ? 'LOADING' : noRun ? 'NO PROGRAM RUNNING' : activeMeso ? [activeMeso.name.toUpperCase(), unit?.n != null ? `${unit.word} ${unit.n}` : null].filter(Boolean).join(' · ') : null
  const noProgramsAtAll = savedPrograms.length === 0 && activeMeso === null && finished.length === 0

  function body() {
    if (failedRead) {
      return (
        <div role="alert" style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
          <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: 'var(--error)' }}>COULDN'T LOAD PROGRAMS</p>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{errorReason(failedRead.error, offline)}</p>
        </div>
      )
    }
    if (loading) {
      // PR4
      return (
        <Section label="CURRENT PROGRAM">
          <div role="status" aria-label="Loading" style={{ ...CARD, height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span className="animate-spin" style={{ width: 22, height: 22, boxSizing: 'border-box', borderRadius: 11, ...SPINNER_RING }} />
          </div>
        </Section>
      )
    }
    if (noProgramsAtAll) {
      // PR3
      return (
        <div style={{ ...CARD, padding: '22px 18px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 20, lineHeight: 1.15, color: 'var(--text-primary)' }}>No programs yet</span>
          <span style={{ fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)' }}>A program is your training plan: workouts, exercises and sets. Make one, then START it to plan your weeks.</span>
          <button
            type="button"
            onClick={() => setSheet({ kind: 'new' })}
            style={{ width: '100%', height: 52, boxSizing: 'border-box', borderRadius: 10, borderWidth: 0, background: 'var(--accent)', color: 'var(--on-accent)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, letterSpacing: '0.03em', cursor: 'pointer' }}
          >
            NEW PROGRAM
          </button>
        </div>
      )
    }
    return (
      <>
        <Section label="CURRENT PROGRAM">
          {activeMeso ? (
            <CurrentProgramCard
              meso={activeMeso}
              program={runProgram}
              chip={unit && unit.n !== null ? `${unit.word} ${unit.n}` : null}
              onFinish={() => {
                setFinishError(null)
                setConfirmFinish(true)
              }}
            />
          ) : (
            // PR2's block
            <div style={{ borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--border-strong)', padding: '18px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>No program running</span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}>START one of your programs below. Its weeks then show in PLAN.</span>
            </div>
          )}
        </Section>

        <Section
          label="YOUR PROGRAMS"
          action={
            <button
              type="button"
              onClick={() => setSheet({ kind: 'new' })}
              style={{ height: 44, boxSizing: 'border-box', padding: '0 12px', borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: 'var(--border-strong)', background: 'transparent', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.15em', color: 'var(--text-secondary)', cursor: 'pointer' }}
            >
              + NEW PROGRAM
            </button>
          }
        >
          {savedPrograms.map((program) => {
            const running = activeMeso?.sourceProgramId === program.id
            return (
              <div key={program.id} data-program={program.id} style={{ ...CARD, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontWeight: 600, fontSize: 17, color: 'var(--text-primary)' }}>{program.name}</span>
                    {running && (
                      <span
                        style={{
                          padding: '3px 6px',
                          borderRadius: 6,
                          borderWidth: 1,
                          borderStyle: 'solid',
                          borderColor: 'var(--accent)',
                          background: 'var(--accent-muted)',
                          fontFamily: 'var(--font-mono)',
                          fontWeight: 700,
                          fontSize: 9,
                          letterSpacing: '0.15em',
                          color: 'var(--accent)',
                        }}
                      >
                        RUNNING
                      </span>
                    )}
                  </span>
                  <span style={{ ...MONO_CAPTION, overflowWrap: 'anywhere' }}>{programTypesLine(program, true)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)' }}>
                  <Link to={plannerPath(program.id)} style={{ ...FOOT_BUTTON, borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
                    OPEN
                  </Link>
                  <button type="button" onClick={() => setSheet({ kind: 'start', presetProgramId: program.id })} style={{ ...FOOT_BUTTON, color: 'var(--accent)' }}>
                    START
                  </button>
                </div>
              </div>
            )
          })}
        </Section>

        {finished.length > 0 && (
          <Section label="FINISHED">
            {finished.map((run) => (
              <Link key={run.id} to={finishedProgramPath(run.id)} style={{ ...CARD, padding: '14px 16px', textDecoration: 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ overflowWrap: 'anywhere', fontWeight: 600, fontSize: 17, color: 'var(--text-primary)' }}>{run.name}</span>
                  <span style={{ ...MONO_CAPTION, letterSpacing: '0.1em', lineHeight: 1.5 }}>{finishedMeta(run)}</span>
                </span>
                <ChevronRight size={16} strokeWidth={2} aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--text-muted)' }} />
              </Link>
            ))}
          </Section>
        )}
      </>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      {/* Header: the tabs (PLAN locked while no program runs, with its hint under them) and one line about the program */}
      <div style={{ position: 'relative', padding: '14px 16px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PlanTabs active="programs" onSelect={onTab} planLocked={noRun} />
        {subline && <span style={{ ...MONO_CAPTION, overflowWrap: 'anywhere' }}>{subline}</span>}
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, overflowY: 'auto', minHeight: 0, padding: '20px 16px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {body()}
      </div>

      {sheet?.kind === 'start' && (
        <StartProgramSheet
          programs={savedPrograms}
          presetProgramId={sheet.presetProgramId}
          runningName={activeMeso?.name ?? null}
          onClose={() => setSheet(null)}
          onCreateProgram={() => setSheet({ kind: 'new' })}
        />
      )}
      {sheet?.kind === 'new' && <NewProgramSheet onClose={() => setSheet(null)} />}

      {confirmFinish && activeMeso && (
        <ConfirmDialog
          title={`Finish ${activeMeso.name}?`}
          body={
            <>
              <span>The program stays saved, so you can start it again. Every week stays in History.</span>
              {finishError && (
                <span role="alert" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.1em', color: 'var(--error)' }}>{`Couldn't finish ${activeMeso.name}.`}</span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, overflowWrap: 'anywhere' }}>{errorReason(finishError.reason, offline)}</span>
                </span>
              )}
            </>
          }
          confirmLabel="FINISH"
          pendingLabel="FINISHING…"
          isPending={completeMeso.isPending}
          onConfirm={finish}
          onCancel={() => setConfirmFinish(false)}
        />
      )}
    </div>
  )
}
