import type { CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import type { DayOfWeek, PlanningType, ProgramExercise, WeekPlan, WorkoutDay } from '../../types'
import type { DeloadRules } from '../../lib/deloadRules'
import { useProgramExercises } from '../programs/usePrograms'
import { dateForDow } from '../gym/moveSession'
import { RunCopyGate } from './RunCopyGate'
import SessionCard from './SessionCard'
import { changesSinceSource, weeksOfSlot } from './weekPlanning'
import {
  DOW_LABEL,
  DOW_SHORT,
  legendText,
  sessionEyebrow,
  sessionStateOf,
  thisWeekOnlyExercises,
  type PlanSession,
  type SessionState,
} from './weekViewLogic'

// Chunk 54b (TASKS-1.2 "Plan's week view: sessions, states, the stable-week line, legend and marks, read-only weeks"; SPEC Screens → Plan
// screen, Weeks and copying [1.2]; boards 1, 1a, 1c, 1d, 9, 10, 11). It replaces 1.1's WorkoutSwitcher, SequenceSlotSwitcher and the
// week-diff gate: under the buttons of the header, the legend, the session chips and the open session.
//
//   legend   "CHANGED SINCE WEEK N" (CYCLE on a sequence run) once the open session is compared with something (weekPlanning's
//            `changesSinceSource`: not week 1, not a deload session), with the swatch of what a mark looks like, on stable weeks too (G48;
//            "THIS WEEK ONLY" is the per-exercise line). A past week is compared as it is now (1.1's G22, kept) and says so the same way.
//   chips    a weekday run's `MON ✓ PUSH 1` (the day, its state, the workout), a sequence run's `SLOT 1 ✓ UPPER A` and its rest slots
//            (`SLOT 2 REST DAY`, which open nothing). The open one is the accent; a done or skipped one is greyed. A chip's state is the
//            session's: ✓ when it is done, "· SKIPPED", "· MOVED" while it is moved (board 1c's "THU · SKIPPED").
//   session  SessionCard.tsx: the open workout's header and exercise cards.
//
// Where a session is compared with a source (week-dependent: last week; stable: the default's set count, kinds, stages and rep targets, and
// last week's weights and RIR) is weekPlanning's. A stable week reads the run copy's sets for it (RunCopyGate), and for "THIS WEEK ONLY"
// on week 1 too (week 1 is compared with nothing, but it can differ from the default). A past week keeps 1.1's marks (a flat row's changed
// value is the accent text), but no THIS WEEK ONLY line: its CHANGE EVERY WEEK → would lead to a screen that changes later weeks only.
//
// Display choices no board settles, provisional under D31: no state on the chip of a session that is only in progress; a session that is
// done or skipped carries no ⋯; a stable week's legend is left out while it has no usable last week to name; THIS WEEK ONLY is not drawn on
// a deload session (its sets are calculated, so they would all differ) or in a past week.

export interface WeekViewProps {
  isSequence: boolean
  mesoId: string
  startDate: string
  viewWeek: number
  currentWeek: number
  unit: 'week' | 'cycle'
  /** The viewed week's plan rows. */
  weekPlans: WeekPlan[]
  /** Every week of the run: what a week is compared with. */
  allWeekPlans: WeekPlan[]
  /** A weekday run's scheduled days of the viewed week (the schedule in force that week), in day order. */
  scheduledDays: Array<{ dow: DayOfWeek; workoutDay: WorkoutDay }>
  /** A sequence run's slots in order; a null workout is a rest slot. */
  sequenceSlots: Array<{ id: string; position: number; workoutDay: WorkoutDay | null }>
  selectedDow: DayOfWeek | null
  onSelectDow: (dow: DayOfWeek) => void
  selectedSlotId: string | null
  onSelectSlot: (id: string) => void
  /** The weekdays each shared workout is on (G14), by workout day id. */
  sharedWeekdaysByWorkoutDayId: ReadonlyMap<string, DayOfWeek[]>
  sessions: readonly PlanSession[] | undefined
  /** Every plan row of the run with a completed or skipped session: read-only (#77). */
  doneWeekPlanIds: ReadonlySet<string>
  /** The viewed week is a past one. */
  isPast: boolean
  today: string
  runCues: readonly string[]
  deloadRules: DeloadRules | null
  planningType: PlanningType
}

const NO_EXERCISES: ReadonlySet<string> = new Set()

interface Chip {
  key: string
  top: string
  name: string
  selected: boolean
  state: SessionState
  /** A rest slot: dimmed, opens nothing. */
  rest: boolean
  onSelect: () => void
}

const MONO: CSSProperties = { fontFamily: 'var(--font-mono)', fontWeight: 600 }

function SessionChips({ chips, label, role }: { chips: Chip[]; label: string; role: 'group' | 'region' }) {
  if (chips.length === 0) return null
  return (
    <div role={role} aria-label={label} className="hide-scrollbar" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 2, marginBottom: 18 }}>
      {chips.map((chip) => {
        const finished = chip.state.finished !== null
        const dim = chip.rest || (finished && !chip.selected)
        return (
          <button
            key={chip.key}
            type="button"
            onClick={chip.rest ? undefined : chip.onSelect}
            disabled={chip.rest}
            aria-pressed={chip.rest ? undefined : chip.selected}
            style={{
              flex: '0 0 auto',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 4,
              minWidth: 76,
              maxWidth: 150,
              padding: '9px 12px',
              boxSizing: 'border-box',
              background: chip.selected ? 'var(--accent)' : dim ? 'var(--surface-raised)' : 'var(--surface)',
              borderWidth: 1,
              borderStyle: 'solid',
              borderColor: chip.selected ? 'var(--accent)' : 'var(--border)',
              borderRadius: 10,
              cursor: chip.rest ? 'default' : 'pointer',
              opacity: chip.rest ? 0.55 : 1,
            }}
          >
            <span style={{ ...MONO, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9, letterSpacing: '0.15em', color: chip.selected ? 'var(--on-accent)' : 'var(--text-muted)' }}>
              <span>{chip.top}</span>
              {chip.state.finished === 'done' && <Check size={10} strokeWidth={3} aria-label="done" />}
              {chip.state.finished === 'skipped' && <span>· SKIPPED</span>}
              {chip.state.movedTo !== null && <span>· MOVED</span>}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 15,
                fontStyle: chip.rest ? 'italic' : 'normal',
                textTransform: 'uppercase',
                color: chip.selected ? 'var(--on-accent)' : dim ? 'var(--text-dim)' : 'var(--text-primary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                maxWidth: '100%',
              }}
            >
              {chip.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export default function WeekView(props: WeekViewProps) {
  const {
    isSequence,
    mesoId,
    startDate,
    viewWeek,
    currentWeek,
    unit,
    weekPlans,
    allWeekPlans,
    scheduledDays,
    sequenceSlots,
    selectedDow,
    onSelectDow,
    selectedSlotId,
    onSelectSlot,
    sharedWeekdaysByWorkoutDayId,
    sessions,
    doneWeekPlanIds,
    isPast,
    today,
    runCues,
    deloadRules,
    planningType,
  } = props
  const navigate = useNavigate()

  // Which session is open. No effect keeps it valid: a selection that isn't there (another week's schedule, another run) falls back to the
  // first scheduled day, or the first slot that holds a workout (a rest slot is never the open one).
  const selectedDay = scheduledDays.find((x) => x.dow === selectedDow) ?? scheduledDays[0]
  const selectedSlot = sequenceSlots.find((s) => s.id === selectedSlotId && s.workoutDay) ?? sequenceSlots.find((s) => s.workoutDay) ?? null

  const openWorkout: WorkoutDay | null = isSequence ? selectedSlot?.workoutDay ?? null : selectedDay?.workoutDay ?? null
  // A plan row is this workout's own, and on a sequence run this slot's own (matched by BOTH workout_day_id and sequence_position, never by
  // workout alone, so the two slots of a repeated workout open different rows: SPEC G8).
  const planOf = (workoutDay: WorkoutDay, position: number | null): WeekPlan | undefined =>
    weekPlans.find((wp) => wp.workoutDayId === workoutDay.id && (position === null || (wp.sequencePosition ?? null) === position))
  const openPlan = openWorkout ? planOf(openWorkout, isSequence ? selectedSlot!.position : null) : undefined

  // The run's copy of the open workout: the cards' list while the week has no plan row for it, and what a stable week is compared with.
  const { data: runCopyExercises } = useProgramExercises(openWorkout?.id ?? '')

  if (!openWorkout) return null

  const isSessionDone = !!openPlan && doneWeekPlanIds.has(openPlan.id)
  const slotWeeks = openPlan ? weeksOfSlot(allWeekPlans, openWorkout.id, openPlan.sequencePosition ?? null) : []
  // Only a stable week reads the run copy: what its shape is compared with, and what "THIS WEEK ONLY" is read against.
  const needsRunCopy = planningType === 'stable' && !!openPlan

  const chips: Chip[] = isSequence
    ? sequenceSlots.map((slot) => {
        const plan = slot.workoutDay ? planOf(slot.workoutDay, slot.position) : undefined
        return {
          key: slot.id,
          top: `SLOT ${slot.position + 1}`,
          name: slot.workoutDay?.name ?? 'REST DAY',
          selected: slot.id === selectedSlot?.id,
          state: sessionStateOf(sessions, plan, null),
          rest: !slot.workoutDay,
          onSelect: () => onSelectSlot(slot.id),
        }
      })
    : scheduledDays.map(({ dow, workoutDay }) => ({
        key: dow,
        top: DOW_SHORT[dow],
        name: workoutDay.name,
        selected: dow === selectedDay?.dow,
        state: sessionStateOf(sessions, planOf(workoutDay, null), dateForDow(startDate, viewWeek, dow)),
        rest: false,
        onSelect: () => onSelectDow(dow),
      }))

  const dow = isSequence ? null : selectedDay.dow
  const label = isSequence ? `SLOT ${selectedSlot!.position + 1}` : DOW_LABEL[selectedDay.dow]
  const openState = sessionStateOf(sessions, openPlan, isSequence ? null : dateForDow(startDate, viewWeek, selectedDay.dow))

  return (
    <RunCopyGate needed={needsRunCopy} runCopyExercises={runCopyExercises}>
      {(runCopy) => {
        const changes = openPlan
          ? changesSinceSource({
              planningType,
              weekNumber: viewWeek,
              week: { isDeload: openPlan.isDeload, exercises: openPlan.exercises, sets: openPlan.sets },
              slotWeeks,
              runCopy,
            })
          : null
        const thisWeekOnly =
          needsRunCopy && !isPast && openPlan && !openPlan.isDeload ? thisWeekOnlyExercises(openPlan.exercises, openPlan.sets, runCopy) : NO_EXERCISES
        return (
          <>
            {changes?.sourceWeek != null && (
              <div data-legend="" style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <span
                  aria-hidden="true"
                  style={{ flex: '0 0 auto', width: 14, height: 14, boxSizing: 'border-box', borderRadius: 4, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--accent)', background: 'var(--accent-muted)' }}
                />
                <span style={{ ...MONO, fontSize: 9, letterSpacing: '0.15em', color: 'var(--text-muted)' }}>{legendText(unit, changes.sourceWeek)}</span>
              </div>
            )}

            <SessionChips chips={chips} role={isSequence ? 'region' : 'group'} label={isSequence ? 'Sequence slot switcher' : 'Workouts this week'} />

            <SessionCard
              key={isSequence ? `${openWorkout.id}:${selectedSlot!.position}` : openWorkout.id}
              eyebrow={sessionEyebrow({ label, unit, viewWeek, currentWeek })}
              workoutDay={openWorkout}
              runCopyExercises={runCopyExercises}
              weekPlan={openPlan}
              readOnly={isPast || isSessionDone}
              pastWeek={isPast}
              state={openState}
              dow={dow}
              sharedWeekdays={isSequence ? null : sharedWeekdaysByWorkoutDayId.get(openWorkout.id) ?? null}
              mesoId={mesoId}
              weekNumber={viewWeek}
              unit={unit}
              menuLabel={label}
              isCycle={isSequence}
              runCues={runCues}
              deloadRules={deloadRules}
              planningType={planningType}
              changes={changes}
              thisWeekOnly={thisWeekOnly}
              move={isSequence ? null : { date: dateForDow(startDate, viewWeek, selectedDay.dow), today, isCurrentWeek: viewWeek === currentWeek }}
              onChangeEveryWeek={(pe: ProgramExercise) => navigate(`/plan/change#${pe.exerciseId}`)}
            />
          </>
        )
      }}
    </RunCopyGate>
  )
}
