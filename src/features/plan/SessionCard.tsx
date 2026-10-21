import { Fragment, useState } from 'react'
import type { CSSProperties } from 'react'
import { Check, Ellipsis } from 'lucide-react'
import type { DayOfWeek, PlanningType, ProgramExercise, WeekPlan, WorkoutDay } from '../../types'
import { useAddSet, useRemoveSet, useSetDeload, useUpdateSet } from './useWeekPlan'
import type { DeloadRules } from '../../lib/deloadRules'
import PlanExerciseCard from './PlanExerciseCard'
import SessionMenuSheet from './SessionMenuSheet'
import MoveSessionControl from './MoveSessionControl'
import { RemovedExerciseCard } from './changeMarks'
import { newSetFor, removalOrder, supersetChips, type PlanRow, type SetPatch } from './planSetRows'
import type { WeekChanges } from './weekPlanning'
import { dayShort, menuEyebrow, sharedMarksLine, sharedWithLine, type SessionState } from './weekViewLogic'

// Chunk 54b (TASKS-1.2 "Plan's week view: sessions, states, the stable-week line, legend and marks, read-only weeks"; SPEC Screens → Plan
// screen: "Each session: its name, day and states (board 10): done (read-only, board 11), deload, moved, shared. Its ⋯ holds session deload
// and MOVE THIS SESSION"; boards 1, 1a, 1c, 1d, 10, 11). It replaces 54a's WorkoutDayPanel: one workout's session as the week view draws it.
//
//   header   the day (or the slot) over the workout's name, a DELOAD chip once the session is marked, "Shared with Thu — changes apply to
//            both" under the name when the plan covers more than one weekday (G14; P1.2-7), and on the right the session's state: "✓ DONE"
//            or "SKIPPED" once it has finished (board 11, board 10), "MOVED → THU" while it is moved, else its ⋯.
//   ⋯        the session menu (SessionMenuSheet): session deload and MOVE THIS SESSION. A session that is done, skipped, in a past week or whose
//            shared plan is locked has no ⋯: nothing in it can change.
//   cards    one per exercise (PlanExerciseCard), with the marks and THIS WEEK ONLY lines the week view works out (WeekView.tsx); what the source
//            has and the week doesn't is a dashed struck-through card where it was. A workout with no exercises says so.
//
// The set writes are the page's through this card: one `useUpdateSet` per patch, `useAddSet`, `useRemoveSet` per row (54a's, unchanged).

export interface SessionCardProps {
  /** The header's top line: `TUESDAY`, `THURSDAY · WEEK 1`, `SLOT 3`. */
  eyebrow: string
  /** The workout this card draws (its name, and the run copy the cards fall back on when the week has no plan row). */
  workoutDay: WorkoutDay
  /** The workout's run copy: its exercises while the week has no plan row for it; undefined while not read. */
  runCopyExercises: ProgramExercise[] | undefined
  weekPlan: WeekPlan | undefined
  /** Every control is read-only: a past week, a finished session, or a shared plan locked by a finished one. */
  readOnly: boolean
  /** The open week is a past one: no ⋯ and no THIS WEEK ONLY lines. */
  pastWeek: boolean
  state: SessionState
  /** The weekday this card is on, and every weekday its plan covers (more than one: shared); null on a sequence run. */
  dow: DayOfWeek | null
  sharedWeekdays: DayOfWeek[] | null
  mesoId: string
  weekNumber: number
  unit: 'week' | 'cycle'
  /** The session menu's eyebrow label: `TUESDAY`, `SLOT 3`. */
  menuLabel: string
  isCycle: boolean
  runCues: readonly string[]
  /** The Settings rules a mark is handed (null: none on). */
  deloadRules: DeloadRules | null
  planningType: PlanningType
  /** What differs from the source; null where nothing is compared. */
  changes: WeekChanges | null
  /** The exercises of a stable week that differ from the default. */
  thisWeekOnly: ReadonlySet<string>
  /** The MOVE THIS SESSION row's inputs (a weekday run); null on a sequence run. */
  move: { date: string; today: string; isCurrentWeek: boolean } | null
  onChangeEveryWeek: (exercise: ProgramExercise) => void
}

const MONO_CAPTION: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 10, letterSpacing: '0.2em', color: 'var(--text-muted)' }

export default function SessionCard({
  eyebrow,
  workoutDay,
  runCopyExercises,
  weekPlan,
  readOnly,
  pastWeek,
  state,
  dow,
  sharedWeekdays,
  mesoId,
  weekNumber,
  unit,
  menuLabel,
  isCycle,
  runCues,
  deloadRules,
  planningType,
  changes,
  thisWeekOnly,
  move,
  onChangeEveryWeek,
}: SessionCardProps) {
  // Chunk 7 (TASKS.md "Each planned session owns its exercise list") — the week's own v2_week_plan_exercises list when a week plan row
  // exists for this workout (weekPlan.exercises); the program's own exercises directly otherwise (no week plan has been planned for this
  // workout/week yet; the cards are then drawn with no sets and nothing can be written).
  const programExercises = weekPlan?.exercises ?? runCopyExercises ?? []

  const addSet = useAddSet(mesoId, weekNumber)
  const removeSet = useRemoveSet(mesoId, weekNumber)
  const updateSet = useUpdateSet(mesoId, weekNumber)
  const toggleDeload = useSetDeload(mesoId, weekNumber)

  const [menuOpen, setMenuOpen] = useState(false)
  // Chunk 22 (reviewer's note 5) — "say what you did": shown after a mark/unmark the started guard caught.
  const [deloadNotice, setDeloadNotice] = useState<string | null>(null)

  const sets = weekPlan?.sets ?? []
  const chips = supersetChips(programExercises)
  const showMenu = !!weekPlan && !readOnly && !pastWeek && state.finished === null

  // "+ ADD SET" (SPEC Defaults 8): a Normal set with the previous set's rep target and no weight or RIR, numbered one past the exercise's
  // last head (planSetRows.ts). The week plan row is always there for a week that is shown (chunk 52); without one nothing is written.
  function handleAddSet(pe: ProgramExercise, rows: PlanRow[]) {
    if (!weekPlan) return
    const { setNumber, defaults } = newSetFor(rows)
    addSet.mutate({ weekPlanId: weekPlan.id, programExerciseId: pe.id, setNumber, defaults })
  }

  // Every number, target and cue a picker or a cell returns is a list of `useUpdateSet` writes, one per set (planSetRows.ts decides which
  // sets and which columns), so a "Use for all" is one write per head and a row whose value is already the picked one is left alone.
  function handleUpdate(patches: SetPatch[]) {
    for (const patch of patches) updateSet.mutate(patch)
  }

  // REMOVE THIS SET: the requests go out stages first, highest index first, then the head (setGroupLogic.ts's cascade order). The rows' foreign
  // key would take the stages with the head, but each request also takes its row out of the screen's cache at once; a removal cut short
  // leaves the head with fewer stages, never stages without a head.
  function handleRemoveRow(row: PlanRow) {
    for (const id of removalOrder(row)) removeSet.mutate(id)
  }

  // Chunk 21 / 54b: the session's own mark, through the session ⋯. Marks THAT ONE SESSION (this workout's own plan row for this week; a
  // shared plan row covers every weekday that shares it), keyed by weekPlanId alone, with the Settings rules the page resolved.
  function toggle() {
    if (!weekPlan) return
    setDeloadNotice(null)
    toggleDeload.mutate(
      { weekPlanId: weekPlan.id, isDeload: !weekPlan.isDeload, rules: deloadRules },
      {
        onSuccess: (outcome) => {
          if (outcome === 'alreadyStarted') setDeloadNotice('Already started — sets left as they are')
        },
      },
    )
  }

  const sharedLine = weekPlan && sharedWeekdays ? sharedWithLine(sharedWeekdays, dow) : null
  const removedAfter = (id: string | null) => (changes?.removedExercises ?? []).filter((r) => r.after === id)
  const sinceCaption = changes?.sourceWeek != null ? `REMOVED SINCE ${unit.toUpperCase()} ${changes.sourceWeek}` : `REMOVED THIS ${unit.toUpperCase()}`
  const removedCard = (r: { exerciseId: string; name: string }, index: number) => (
    <RemovedExerciseCard key={`removed:${r.exerciseId}:${index}`} name={r.name} caption={sinceCaption} />
  )

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Header (boards 1, 10, 11) */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={MONO_CAPTION}>{eyebrow}</span>
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 10px' }}>
            <h2 style={{ margin: 0, minWidth: 0, fontFamily: 'var(--font-display)', fontWeight: 900, fontSize: 24, lineHeight: 1.1, textTransform: 'uppercase', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
              {workoutDay.name}
            </h2>
            {weekPlan?.isDeload && (
              <span
                style={{
                  ...MONO_CAPTION,
                  fontSize: 9,
                  letterSpacing: '0.15em',
                  padding: '3px 6px',
                  borderRadius: 6,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: 'var(--accent)',
                  background: 'var(--accent-muted)',
                  color: 'var(--accent)',
                }}
              >
                DELOAD
              </span>
            )}
          </div>
          {sharedLine && <span style={{ fontSize: 12, lineHeight: 1.4, color: 'var(--text-secondary)' }}>{sharedLine}</span>}
        </div>

        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {state.finished !== null ? (
            <span style={{ ...MONO_CAPTION, display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)' }}>
              {state.finished === 'done' && <Check size={13} strokeWidth={2.5} aria-hidden="true" />}
              {state.finished === 'done' ? 'DONE' : 'SKIPPED'}
            </span>
          ) : (
            <>
              {state.movedTo !== null && <span style={{ ...MONO_CAPTION, color: 'var(--text-secondary)' }}>{`MOVED → ${dayShort(state.movedTo)}`}</span>}
              {weekPlan && readOnly && !pastWeek && <span style={{ ...MONO_CAPTION, color: 'var(--text-secondary)' }}>READ ONLY</span>}
              {showMenu && (
                <button
                  type="button"
                  onClick={() => {
                    setDeloadNotice(null)
                    setMenuOpen(true)
                  }}
                  aria-label={`${workoutDay.name} options`}
                  style={{ width: 44, height: 44, padding: 0, borderRadius: 10, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-strong)', background: 'var(--surface-raised)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
                >
                  <Ellipsis size={18} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* The cards, one per exercise (board 1); what differs from the week's source is marked on them (WeekView works it out). */}
      {programExercises.length === 0 ? (
        <div style={{ background: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border)', borderRadius: 12, padding: '20px 16px', textAlign: 'center', fontSize: 14, color: 'var(--text-secondary)' }}>
          No exercises in this day
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {removedAfter(null).map(removedCard)}
          {programExercises.map((pe) => (
            <Fragment key={pe.id}>
              <PlanExerciseCard
                pe={pe}
                sets={sets.filter((s) => s.programExerciseId === pe.id)}
                superset={chips.get(pe.id) ?? null}
                readOnly={readOnly}
                canWrite={!!weekPlan}
                mesoId={mesoId}
                weekNumber={weekNumber}
                isCycle={isCycle}
                planningType={planningType}
                runCues={runCues}
                changes={changes?.exercises.get(pe.id)}
                thisWeekOnly={thisWeekOnly.has(pe.id)}
                onChangeEveryWeek={() => onChangeEveryWeek(pe)}
                // Disables "+" while an add (or a removal) is in flight for this workout (found by adversarial review): useAddSet has no
                // optimistic update, so the rows don't show a just-added set until the insert round-trips and the week is read again, and a
                // second tap would number the next set from rows that are one short. addSet and removeSet are shared by the day's cards, so
                // every card waits; the card whose add it is says so.
                addDisabled={addSet.isPending || removeSet.isPending}
                adding={addSet.isPending && addSet.variables?.programExerciseId === pe.id}
                onAddSet={(rows) => handleAddSet(pe, rows)}
                onUpdate={handleUpdate}
                onRemoveRow={handleRemoveRow}
              />
              {removedAfter(pe.id).map(removedCard)}
            </Fragment>
          ))}
        </div>
      )}

      {/* The session menu (board 10), mounted to open it, outside the buttons that opened it (a portal's events still bubble to what rendered it). */}
      {menuOpen && showMenu && weekPlan && (
        <SessionMenuSheet
          eyebrow={menuEyebrow({ label: menuLabel, unit, viewWeek: weekNumber })}
          title={workoutDay.name}
          marked={weekPlan.isDeload}
          pending={toggleDeload.isPending === true}
          pendingDeload={toggleDeload.variables?.isDeload === true}
          sharedLine={sharedWeekdays && sharedWeekdays.length > 1 ? sharedMarksLine(sharedWeekdays) : null}
          notice={deloadNotice}
          error={toggleDeload.isError === true ? toggleDeload.error : null}
          onToggle={toggle}
          onClose={() => setMenuOpen(false)}
          moveRow={
            move && (
              <MoveSessionControl
                workoutDay={workoutDay}
                weekPlan={weekPlan}
                mesoId={mesoId}
                date={move.date}
                today={move.today}
                isCurrentWeek={move.isCurrentWeek}
              />
            )
          }
        />
      )}
    </div>
  )
}
