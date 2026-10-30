import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Pencil } from 'lucide-react'
import type { Mesocycle, Program } from '../../types'
import { useToday } from '../../hooks/useToday'
import { useProgramPriorities } from '../plan/useProgramPriorities'
import { useRunSchedule } from '../plan/useRunSchedule'
import { scheduleForWeek } from './runSchedule'
import { CHANGE_PROGRAM_PATH, PRIORITIES_PATH, markSummary, programTypesLine, startedLine, weekOfRun } from './programsTabLogic'

// PR1's CURRENT PROGRAM card (chunk 65; TASKS-1.2 "The PROGRAMS tab"; SPEC Screens → PROGRAMS: "CURRENT PROGRAM card (name, week, start date,
// types, FOCUS / DON'T CARE → PR5, EDIT PROGRAM → CHANGE THE PROGRAM, FINISH → PR6/PR7)"): the week (the cycle on a sequence run) in a chip and
// the run's name; "Started Oct 5, 2026" and "Weekdays · stable · 5 days a week" under them; the FOCUS and DON'T CARE rows, each opening the
// run's priorities view-only (PR5: `/plan/priorities`); EDIT PROGRAM (`/plan/change`) and FINISH (the caller asks first: PR6), and the line
// under the card.
//
// The marks are the run's own, read from its program copy (`useProgramPriorities(meso.programId)`: the ones copied when it started, SPEC
// Programs and runs: "They can't be changed during a run: PROGRAMS shows them view-only"), never the saved program's, which the planner may
// since have changed. Display choices no board settles, provisional under D31: a row is drawn only for a mark that is set (an unset feature
// shows nothing: the standing UI rule), so a run with no marks has neither; the chip waits for a sequence run's cycle (it is read, not
// guessed) and is left out until it is known; the types line waits for the run's program.
//
// "N days a week" counts the days of the week the run is in (1.2.1 item 19; SPEC "PROGRAMS · CURRENT PROGRAM card": `scheduleForWeek`, as Today and Plan
// do), not the run copy's newest `schedule`: a change of days made in CHANGE THE PROGRAM starts next week, and the run copy holds it from the save. The
// rows are the run's `v2_run_schedules` (`useRunSchedule`, the entry Today and Plan share); a run with none is in the run copy's days in every week.
// Display choice no board or SPEC line settles, provisional under D31: until the rows have been read the line says nothing about days, rather than a
// number from the run copy that may be the wrong week's.

export interface CurrentProgramCardProps {
  meso: Pick<Mesocycle, 'id' | 'name' | 'programId' | 'startDate'>
  /** The run's own program (its copy), which says what the types are; undefined until read. */
  program: Pick<Program, 'scheduleType' | 'planningType' | 'schedule'> | undefined
  /** "WEEK 2" (a weekday run) or "CYCLE 2" (a sequence run), or null while a sequence run's cycle isn't known. */
  chip: string | null
  onFinish: () => void
}

const MONO_ROW_LABEL: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

const ROW: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  minHeight: 44,
  borderTopWidth: 1,
  borderTopStyle: 'solid',
  borderTopColor: 'var(--border-subtle)',
  textDecoration: 'none',
}

const ACTION: CSSProperties = {
  height: 52,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: '0.15em',
  textDecoration: 'none',
  background: 'transparent',
  borderWidth: 0,
  cursor: 'pointer',
}

function MarkRow({ label, summary }: { label: string; summary: string }) {
  return (
    <Link to={PRIORITIES_PATH} style={ROW}>
      <span style={MONO_ROW_LABEL}>{label}</span>
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--text-primary)' }}>
        <span style={{ minWidth: 0, overflowWrap: 'anywhere', textAlign: 'right' }}>{summary}</span>
        <ChevronRight size={12} strokeWidth={2.5} aria-hidden="true" style={{ flex: '0 0 auto' }} />
      </span>
    </Link>
  )
}

export default function CurrentProgramCard({ meso, program, chip, onFinish }: CurrentProgramCardProps) {
  const marks = useProgramPriorities(meso.programId)
  const focus = marks.data ? markSummary(marks.data, 'focus') : null
  const dontCare = marks.data ? markSummary(marks.data, 'dont_care') : null

  // The weekdays in force in the run's current week. Only a weekday run has any, so only one reads the rows (a sequence run's line names no days).
  const today = useToday()
  const weekdayRun = program !== undefined && (program.scheduleType ?? 'weekday') === 'weekday'
  const scheduleRows = useRunSchedule(weekdayRun ? meso.id : undefined).data
  // [] is an answer (no rows: the run copy's days in every week); undefined is "not read yet".
  const daysInForce = program && scheduleRows !== undefined ? scheduleForWeek(scheduleRows, program.schedule, weekOfRun(today, meso.startDate)) : null

  return (
    <>
      <div
        style={{
          background: 'var(--surface)',
          borderRadius: 12,
          // each side's colour as a longhand: a captured render drops a `border-color` shorthand holding `var()` when a side colour follows
          // it (RULES, jsdom), and the picture would show the card with no edge but its top
          borderWidth: 1,
          borderTopWidth: 3,
          borderStyle: 'solid',
          borderTopColor: 'var(--accent)',
          borderRightColor: 'var(--border)',
          borderBottomColor: 'var(--border)',
          borderLeftColor: 'var(--border)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '16px 16px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {chip && (
              <span
                style={{
                  flex: '0 0 auto',
                  padding: '6px 10px',
                  borderRadius: 8,
                  background: 'var(--accent)',
                  color: 'var(--on-accent)',
                  fontFamily: 'var(--font-display)',
                  fontWeight: 800,
                  fontSize: 13,
                }}
              >
                {chip}
              </span>
            )}
            <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontWeight: 700, fontSize: 22, color: 'var(--text-primary)' }}>{meso.name}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em', lineHeight: 1.6, color: 'var(--text-secondary)' }}>
            <span>{startedLine(meso.startDate)}</span>
            {program && <span>{programTypesLine(program, false, daysInForce)}</span>}
          </div>
        </div>

        {(focus || dontCare) && (
          <div style={{ padding: '0 16px', display: 'flex', flexDirection: 'column' }}>
            {focus && <MarkRow label="FOCUS" summary={focus} />}
            {dontCare && <MarkRow label="DON'T CARE" summary={dontCare} />}
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)' }}>
          <Link
            to={CHANGE_PROGRAM_PATH}
            style={{ ...ACTION, borderRightWidth: 1, borderRightStyle: 'solid', borderRightColor: 'var(--border-subtle)', color: 'var(--accent)' }}
          >
            <Pencil size={14} strokeWidth={2} aria-hidden="true" />
            EDIT PROGRAM
          </Link>
          <button type="button" onClick={onFinish} style={{ ...ACTION, color: 'var(--text-primary)' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 22V4M4 4h12l-2 4 2 4H4" />
            </svg>
            FINISH
          </button>
        </div>
      </div>
      <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--text-muted)' }}>Finishing keeps every week in History. The program stays saved below, so you can start it again.</span>
    </>
  )
}
