import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight } from 'lucide-react'
import { errorReason } from '../../components/exercisePickerLogic'
import { hairline } from '../../components/pickers/pickerControls'
import { usePriorityContext } from '../coach/usePriorityContext'
import { useProgramPriorities } from '../plan/useProgramPriorities'
import { useRunSchedule } from '../plan/useRunSchedule'
import { useAllWeekPlans } from '../plan/useWeekPlan'
import { scheduleForWeek } from './runSchedule'
import FullDeleteConfirm from './FullDeleteConfirm'
import { useMesos } from './useMesos'
import { usePrograms, useWorkoutDays } from './usePrograms'
import { buildProgramHistory, finishedHeaderLine, openingWeek } from './programHistory'
import type { HistoryChange, HistoryRow, HistoryWeek, HistoryWorkout } from './programHistory'
import { finishedPrioritiesPath, finishedProgramMarks, markLine } from './programsTabLogic'

// A finished program (chunk 66; TASKS-1.2 "A finished program"; SPEC Screens → PROGRAMS → Finished program, Defaults 11, Language "Program
// everywhere" (C12); boards PR14 and PR15; since chunk 76 SPEC 1.2.1's Finished program [24] [25] [20] and Finished program · PRIORITIES, read-only
// [1]), at `/program/finished/:id`, opened from a FINISHED row of the PROGRAMS tab: the program's name, its dates, weeks and deloads, a PRIORITIES
// row, a tile for each week it planned (a dot on a week whose structure changed), what changed in the open week, that week's structure workout by
// workout, and DELETE THIS FINISHED PROGRAM (asks first: PR15; since chunk 75 it is a full delete, and the confirmation is `FullDeleteConfirm`'s:
// it counts what goes, and the program's weeks, sessions, logs and Coach rows go with it).
//
// The weeks are read as Plan reads a running program's (`useAllWeekPlans`: each planned session with its exercises, in the week's own order, and
// its sets), and `programHistory.ts` decides what they say. What it reads of the run: the run itself (`useMesos`), its own copy (`usePrograms`,
// `useWorkoutDays`: the workouts' names, and the weekdays in force in each week through `useRunSchedule`, as Today and Plan read them), and its
// marks (below). Nothing here writes but the delete: the marks are only read.
//
// The PRIORITIES row always opens `/program/finished/:id/priorities`, the read-only screen (`FinishedProgramPriorities`; SPEC 1.2.1 [1]: "Every
// finished program's PRIORITIES row opens the same read-only screen"), whichever table the run's marks are in. Its second line, "Focus: chest, back
// · Don't care: calves", reads the run copy's `v2_program_priorities` rows (the marks copied at the run's start, never the saved program's) and,
// when the copy holds none, the old table's (`v2_coach_meso_tag_priorities`, a run finished before 1.1: Coach's `usePriorityContext`, read as it
// is) through migration 033's mapping (top → Focus, low → Don't care, high and normal nothing): `finishedProgramMarks`, the one function the screen
// asks too. Coach's old page (`/meso/:id/priorities`) stays in the code and nothing links to it.
//
// The week strip never shrinks ([24]: a scrolling strip in a flex column collapses to nothing once the week's cards are taller than the screen),
// the screen opens on week 1 ([25]), and the rows carry no superset labels ([20], DECISIONS 193 (a): `programHistory.ts`).
//
// Display choices no board settles, provisional under D31: a deload part and the legend are left out when there is no deload and no dot (an unset
// feature shows nothing); the PRIORITIES row's second line is only for a run with marks, and the row is only its label when nothing is marked; the
// row is a link from the first paint (where it leads no longer depends on a read), and a read of the marks that failed says "Couldn't load
// priorities." under the label while the row still opens the screen, which says why; a run that isn't found, isn't finished or planned no week says
// so; a read that failed says so with the real reason (SPEC Errors (15)); a failed delete says "Couldn't delete [name]." with the reason, in the
// confirm, and the program stays (`FullDeleteConfirm`).

const MONO_CAPTION: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }
const CARD: CSSProperties = { background: 'var(--surface)', borderRadius: 12, ...hairline('var(--border)') }

// The spinner's ring, one side at a time: a captured render drops a `border` shorthand with `var()` (RULES, jsdom).
const SPINNER_RING: CSSProperties = {
  borderWidth: 2,
  borderStyle: 'solid',
  borderTopColor: 'var(--accent)',
  borderRightColor: 'var(--border-strong)',
  borderBottomColor: 'var(--border-strong)',
  borderLeftColor: 'var(--border-strong)',
}

const SIGN_STYLE: Record<HistoryChange['sign'], CSSProperties> = {
  '+': { background: 'var(--accent-muted)', color: 'var(--accent)' },
  '~': { background: 'var(--accent-muted)', color: 'var(--accent)' },
  '−': { background: 'var(--surface-raised)', color: 'var(--text-secondary)' },
}

function Tile({ week, open, onPick }: { week: HistoryWeek; open: boolean; onPick: (week: number) => void }) {
  const style: CSSProperties = open
    ? { ...hairline('var(--accent)'), background: 'var(--accent)', color: 'var(--on-accent)' }
    : week.deload
      ? { ...hairline('var(--border)'), background: 'var(--surface-raised)', color: 'var(--text-secondary)' }
      : { ...hairline('var(--border)'), background: 'var(--surface)', color: 'var(--text-primary)' }
  return (
    <button
      type="button"
      data-week={week.week}
      aria-pressed={open}
      aria-label={`${week.label}${week.changed ? ' · structure changed' : ''}`}
      onClick={() => onPick(week.week)}
      style={{ ...style, flex: '0 0 auto', width: 44, height: 56, boxSizing: 'border-box', borderRadius: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 5, padding: 0, cursor: 'pointer' }}
    >
      <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.1em' }}>{week.top}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, lineHeight: 1 }}>{week.week}</span>
      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: open ? 'var(--on-accent)' : week.changed ? 'var(--accent)' : 'transparent' }} />
    </button>
  )
}

function ExerciseRow({ row }: { row: HistoryRow }) {
  const style: CSSProperties =
    row.state === 'changed'
      ? { background: 'var(--accent-muted)', borderStyle: 'solid', borderColor: 'var(--accent)' }
      : row.state === 'removed'
        ? { background: 'transparent', borderStyle: 'dashed', borderColor: 'var(--border-strong)' }
        : { background: 'var(--surface)', borderStyle: 'solid', borderColor: 'transparent' }
  return (
    <div data-state={row.state} style={{ ...style, borderWidth: 1, margin: '0 8px 6px', padding: '9px 8px', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
      <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: '0 0 auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>{row.number}</span>
        <span style={{ minWidth: 0, overflowWrap: 'anywhere', fontSize: 14, color: row.state === 'removed' ? 'var(--text-muted)' : 'var(--text-primary)', textDecoration: row.state === 'removed' ? 'line-through' : 'none' }}>
          {row.name}
        </span>
      </span>
      <span style={{ flex: '0 1 auto', minWidth: 0, textAlign: 'right', overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.05em', color: row.state === 'changed' ? 'var(--accent)' : 'var(--text-muted)' }}>
        {row.meta}
      </span>
    </div>
  )
}

function WorkoutCard({ workout }: { workout: HistoryWorkout }) {
  return (
    <div data-workout={workout.key} style={{ ...CARD, display: 'flex', flexDirection: 'column', paddingBottom: 2 }}>
      <div style={{ padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {workout.dayLabel && <span style={{ ...MONO_CAPTION, fontSize: 9 }}>{workout.dayLabel}</span>}
          <span style={{ overflowWrap: 'anywhere', fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{workout.name}</span>
        </span>
        <span style={{ flex: '0 0 auto', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: workout.changeCount > 0 ? 'var(--accent)' : 'var(--text-muted)' }}>{workout.tag}</span>
      </div>
      {workout.rows.map((row) => (
        <ExerciseRow key={row.key} row={row} />
      ))}
    </div>
  )
}

function PrioritiesRow({ target, summary, failed }: { target: string; summary: string | null; failed: boolean }) {
  return (
    <Link to={target} data-priorities-row="" style={{ ...CARD, borderRadius: 10, minHeight: 44, boxSizing: 'border-box', padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, textDecoration: 'none' }}>
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ ...MONO_CAPTION, fontSize: 9 }}>PRIORITIES</span>
        {summary && <span style={{ overflowWrap: 'anywhere', fontSize: 13, color: 'var(--text-primary)' }}>{summary}</span>}
        {failed && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Couldn't load priorities.</span>}
      </span>
      <ChevronRight size={14} strokeWidth={2.5} aria-hidden="true" style={{ flex: '0 0 auto', color: 'var(--text-muted)' }} />
    </Link>
  )
}

function Message({ title, children, tone = 'muted' }: { title: string; children: ReactNode; tone?: 'muted' | 'error' }) {
  return (
    <div role={tone === 'error' ? 'alert' : undefined} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 24 }}>
      <p style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.2em', color: tone === 'error' ? 'var(--error)' : 'var(--text-muted)' }}>{title}</p>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{children}</p>
    </div>
  )
}

export default function FinishedProgramPage() {
  const { mesocycleId = '' } = useParams<{ mesocycleId: string }>()
  const navigate = useNavigate()

  const mesosRead = useMesos()
  const programsRead = usePrograms()
  // A finished program only: the id of a running program, or of nothing, is not one (the FINISHED row never links to it).
  const run = mesosRead.data?.find((m) => m.id === mesocycleId && m.status === 'completed') ?? null
  // The run's own copy: its types, and the weekdays it ended on. Never the saved program it started from, which the planner may have changed since.
  const runProgram = programsRead.data?.find((p) => p.id === run?.programId)
  const unit = (runProgram?.scheduleType ?? 'weekday') === 'sequence' ? 'cycle' : 'week'

  const daysRead = useWorkoutDays(run?.programId ?? '')
  const plansRead = useAllWeekPlans(run?.id ?? '')
  const scheduleRead = useRunSchedule(run && programsRead.data && unit === 'week' ? run.id : undefined)
  const marksRead = useProgramPriorities(run?.programId ?? null)
  const ownMarks = marksRead.data
  // The old table is asked only when the run copy holds no marks of its own.
  const legacyRead = usePriorityContext(run && ownMarks !== undefined && ownMarks.length === 0 ? run.id : null)
  // The marks the header line reads: the run copy's own, else the old table's mapped (migration 033); undefined until what decides it has been read.
  const marks = finishedProgramMarks(ownMarks, legacyRead.data?.entries)

  const needed = [mesosRead, programsRead, ...(run ? [daysRead, plansRead, ...(unit === 'week' ? [scheduleRead] : [])] : [])]
  const failedRead = needed.find((read) => read.isError === true && read.data === undefined)
  const loading = failedRead === undefined && needed.some((read) => read.data === undefined)
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  const history = useMemo(() => {
    if (!plansRead.data || !daysRead.data) return null
    if (unit === 'week' && scheduleRead.data === undefined) return null
    const rows = scheduleRead.data ?? []
    return buildProgramHistory({
      plans: plansRead.data,
      workoutDays: daysRead.data,
      unit,
      scheduleFor: unit === 'week' && runProgram ? (week) => scheduleForWeek(rows, runProgram.schedule, week) : undefined,
    })
  }, [plansRead.data, daysRead.data, scheduleRead.data, unit, runProgram])

  const [picked, setPicked] = useState<number | null>(null)
  const opening = history ? openingWeek(history) : null
  const openNumber = history && picked !== null && history.weeks.some((w) => w.week === picked) ? picked : opening
  const open = history?.weeks.find((w) => w.week === openNumber) ?? null

  // The strip opens with the first week it shows in view; a user who scrolled it keeps where they are.
  const strip = useRef<HTMLDivElement>(null)
  const hasTiles = (history?.weeks.length ?? 0) > 0
  useEffect(() => {
    const row = strip.current
    const tile = opening === null ? null : row?.querySelector<HTMLElement>(`[data-week="${opening}"]`)
    if (!row || !tile) return
    row.scrollLeft = Math.max(0, tile.offsetLeft - (row.clientWidth - tile.offsetWidth) / 2)
  }, [opening, hasTiles])

  // A read that failed before the marks were known (TanStack keeps the data a later failing read leaves: a known answer is not a failure).
  const prioritiesFailed = marks === undefined && (marksRead.isError === true || legacyRead.isError === true)

  // ─── DELETE ───
  // The program whose full-delete confirmation is open (chunk 75), held whole: the program list is read again before the delete resolves and no
  // longer holds it, which must not take the confirmation away from under its own DELETING….
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null)

  function content() {
    if (failedRead) return <Message title="COULDN'T LOAD THIS PROGRAM" tone="error">{errorReason(failedRead.error, offline)}</Message>
    if (loading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
          <div role="status" aria-label="Loading" className="animate-spin" style={{ width: 22, height: 22, boxSizing: 'border-box', borderRadius: 11, ...SPINNER_RING }} />
        </div>
      )
    }
    if (!run || !history) return <Message title="COULDN'T FIND THIS PROGRAM">It may have been deleted.</Message>
    return (
      <>
        {history.weeks.length === 0 ? (
          // ours: a finished program that never planned a week
          <Message title="NO WEEKS WERE PLANNED">There is nothing to show for this program.</Message>
        ) : (
          <>
            <div ref={strip} className="hide-scrollbar" aria-label={unit === 'cycle' ? 'Cycles of this program' : 'Weeks of this program'} style={{ display: 'flex', gap: 6, overflowX: 'auto', overflowY: 'hidden', flexShrink: 0 /* [24]: it scrolls, so in a flex column it shrinks to nothing once the week is taller than the screen */ }}>
              {history.weeks.map((w) => (
                <Tile key={w.week} week={w} open={w.week === openNumber} onPick={setPicked} />
              ))}
            </div>
            {history.weeks.some((w) => w.changed) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--accent)' }} />
                STRUCTURE CHANGED THAT WEEK
              </div>
            )}
            {open && (
              <>
                <div style={{ ...CARD, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={MONO_CAPTION}>{open.label}</span>
                    <span style={{ overflowWrap: 'anywhere', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 18, color: 'var(--text-primary)' }}>{open.title}</span>
                  </div>
                  {open.changes.map((change) => (
                    <div key={`${change.sign}${change.text}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', paddingTop: 8, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)' }}>
                      <span aria-hidden="true" style={{ ...SIGN_STYLE[change.sign], flex: '0 0 auto', width: 22, height: 22, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 13 }}>
                        {change.sign}
                      </span>
                      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <span style={{ overflowWrap: 'anywhere', fontSize: 14, lineHeight: 1.4, color: 'var(--text-primary)' }}>{change.text}</span>
                        <span style={{ overflowWrap: 'anywhere', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>{change.where}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <span style={MONO_CAPTION}>{open.structureLabel}</span>
                {open.workouts.map((workout) => (
                  <WorkoutCard key={workout.key} workout={workout} />
                ))}
              </>
            )}
          </>
        )}
        <button
          type="button"
          onClick={() => setDeleting({ id: run.id, name: run.name })}
          style={{ ...CARD, borderRadius: 10, height: 48, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 11, letterSpacing: '0.2em', color: 'var(--error)', cursor: 'pointer' }}
        >
          DELETE THIS FINISHED PROGRAM
        </button>
      </>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--base)' }}>
      <div style={{ padding: '16px 16px 14px', flexShrink: 0, borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            type="button"
            onClick={() => navigate('/program', { replace: true })}
            aria-label="Back to Programs"
            style={{ flex: '0 0 auto', width: 44, height: 44, boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface-raised)', ...hairline('var(--border-strong)'), borderRadius: 10, color: 'var(--text-secondary)', cursor: 'pointer' }}
          >
            <ArrowLeft size={18} />
          </button>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={MONO_CAPTION}>FINISHED PROGRAM</span>
            {run && <h1 style={{ margin: 0, overflowWrap: 'anywhere', fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 22, lineHeight: 1.05, color: 'var(--text-primary)' }}>{run.name.toUpperCase()}</h1>}
          </div>
        </div>
        {run && history && (
          <>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.05em', lineHeight: 1.6, color: 'var(--text-secondary)' }}>{finishedHeaderLine(run, history.deloads)}</span>
            <PrioritiesRow target={finishedPrioritiesPath(run.id)} summary={marks ? markLine(marks) : null} failed={prioritiesFailed} />
          </>
        )}
      </div>

      <div className="hide-scrollbar" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px 16px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {content()}
      </div>

      {/* Chunk 75: one confirmation that counts what goes (the same one History's program-filter delete opens). Gone, the program leaves PROGRAMS' list
          and this page with it: PROGRAMS, in its place in the history. */}
      {deleting && <FullDeleteConfirm run={deleting} onCancel={() => setDeleting(null)} onDeleted={() => navigate('/program', { replace: true })} />}
    </div>
  )
}
