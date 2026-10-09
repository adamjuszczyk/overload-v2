import { differenceInCalendarDays, parseISO } from 'date-fns'
import { useSequenceScheduler } from './useSequenceScheduler'
import { useCreateSession, useSkipMissedSession } from './useSession'
import { usePlanWeek, planWeekThenFindId } from '../plan/useWeekPlan'
import { fetchWeekPlans } from '../plan/weekPlanService'
import GymSession from './GymSession'
import CompletedTodayScreen from './CompletedTodayScreen'
import TodayHeader from './TodayHeader'
import type { Mesocycle, WorkoutDay } from '../../types'

// Chunk 25 (SPEC.md "Scheduling → Sequence"; reviewer's note 4 — "Today
// (sequence run): the next workout and when it's due; on a rest day, the
// next workout plus TRAIN ANYWAY; Skip."). TodayPage.tsx's own early branch
// (its program.scheduleType check) is the only caller — a weekday run
// never reaches this file at all.
//
// Scope decision (this chunk's report): no "PREVIEW SESSION" here (SPEC
// names it nowhere for a sequence run; SessionPreview.tsx stays untouched,
// weekday-only) — this never removes existing behaviour, since a sequence
// run never had a Today screen before this chunk.

export default function SequenceTodayPage({
  today,
  todayLabel,
  activeMeso,
  programId,
}: {
  today: string
  todayLabel: string
  activeMeso: Mesocycle
  programId: string
}) {
  const scheduler = useSequenceScheduler(today, activeMeso, programId)
  const createSession = useCreateSession()
  const planWeek = usePlanWeek()
  const skipNext = useSkipMissedSession()

  if (scheduler.isLoading || !scheduler.result) {
    return (
      <div className="h-full flex items-center justify-center">
        <div
          className="w-6 h-6 rounded-full animate-spin"
          style={{ border: '2px solid var(--border-strong)', borderTopColor: 'var(--text-primary)' }}
        />
      </div>
    )
  }

  const { result, workoutDays, allWeekPlans } = scheduler

  if (result.type === 'active_session') {
    const workoutDay = workoutDays.find((wd) => wd.id === result.session.workoutDayId) ?? null
    const weekPlan = allWeekPlans.find((wp) => wp.id === result.session.weekPlanId) ?? null
    if (!workoutDay) return null
    return (
      <GymSession
        sessionId={result.session.id}
        workoutDay={workoutDay}
        weekPlan={weekPlan}
        weekNumber={weekPlan?.weekNumber ?? 1}
        today={today}
        scheduleType="sequence"
      />
    )
  }

  if (result.type === 'completed_today') {
    const workoutDay = workoutDays.find((wd) => wd.id === result.session.workoutDayId) ?? null
    const weekPlan = allWeekPlans.find((wp) => wp.id === result.session.weekPlanId) ?? null
    return (
      <CompletedTodayScreen
        session={result.session}
        activeMeso={activeMeso}
        workoutDay={workoutDay}
        weekPlan={weekPlan}
        weekNumber={weekPlan?.weekNumber ?? 1}
        today={today}
        todayLabel={todayLabel}
        scheduleType="sequence"
      />
    )
  }

  if (result.type === 'no_workouts') {
    return (
      <div className="px-4 pt-8 pb-6">
        <TodayHeader label={todayLabel} />
        <div
          className="mt-6 rounded-xl p-6 text-center"
          style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
        >
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            This sequence has no workouts yet — add one in the planner.
          </p>
        </div>
      </div>
    )
  }

  // result.type === 'next' — the next workout and when it's due (reviewer's
  // note 4). On a rest day (isDue false), TRAIN ANYWAY starts it right now
  // instead of waiting; Skip is offered either way (SPEC: "Skip is for 'I
  // won't do this one, give me the next'" — no precondition on due status).
  // `next` (not `result` directly) below — an explicit narrowed binding:
  // the three other variants all return above, so this check is exhaustive
  // (a defensive `return null` is never actually reached), but it also
  // gives TypeScript's control-flow analysis a direct discriminant check
  // right at the read site, rather than relying on it surviving across the
  // closures below (handleStart/handleSkip) unaided.
  if (result.type !== 'next') return null
  const next = result.next
  const workoutDay: WorkoutDay | undefined = workoutDays.find((wd) => wd.id === next.workoutDayId)
  const weekPlan = allWeekPlans.find(
    (wp) => wp.workoutDayId === next.workoutDayId && wp.weekNumber === next.weekNumber && wp.sequencePosition === next.sequencePosition,
  ) ?? null
  if (!workoutDay) return null

  async function handleStart() {
    const weekPlanId = await planWeekThenFindId(
      activeMeso.id,
      next.weekNumber,
      next.workoutDayId,
      weekPlan?.id ?? null,
      planWeek,
      fetchWeekPlans,
      next.sequencePosition,
    )
    await createSession.mutateAsync({
      mesoId: activeMeso.id,
      weekPlanId,
      workoutDayId: next.workoutDayId,
      date: today,
    })
  }

  async function handleSkip() {
    const weekPlanId = await planWeekThenFindId(
      activeMeso.id,
      next.weekNumber,
      next.workoutDayId,
      weekPlan?.id ?? null,
      planWeek,
      fetchWeekPlans,
      next.sequencePosition,
    )
    await skipNext.mutateAsync({
      mesoId: activeMeso.id,
      weekPlanId,
      workoutDayId: next.workoutDayId,
      date: today,
      existingSessionId: null,
    })
  }

  const isPending = createSession.isPending || planWeek.isPending
  const isSkipping = skipNext.isPending

  return (
    <div className="px-4 pt-8 pb-6">
      <TodayHeader label={todayLabel} />

      <div
        className="mt-4 rounded-xl overflow-hidden"
        style={{ border: '1px solid var(--border)', borderTop: '3px solid var(--accent)' }}
      >
        <div className="px-4 py-4">
          <p
            className="text-xs font-bold tracking-widest mb-1"
            style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
          >
            CYCLE {next.weekNumber}
          </p>
          <h2
            className="text-2xl font-black tracking-tight"
            style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
          >
            {workoutDay.name}
          </h2>
          {weekPlan?.isDeload && (
            <p
              className="mt-1 text-xs font-bold tracking-widest"
              style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}
            >
              DELOAD
            </p>
          )}
          <p className="mt-2 text-xs font-bold tracking-widest" style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {formatDue(result.dueDate, result.isDue, today)}
          </p>
        </div>

        <div className="px-4 pb-4 space-y-3">
          <button
            onClick={handleStart}
            disabled={isPending}
            className="w-full py-4 rounded-xl font-black tracking-widest text-sm"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--base)',
              fontFamily: 'var(--font-mono)',
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? '…' : (result.isDue ? 'START SESSION' : 'TRAIN ANYWAY')}
          </button>
          <button
            onClick={handleSkip}
            disabled={isSkipping}
            className="w-full py-3 rounded-xl font-bold tracking-widest text-sm"
            style={{
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
              opacity: isSkipping ? 0.5 : 1,
            }}
          >
            {isSkipping ? '…' : 'SKIP'}
          </button>
        </div>
      </div>
    </div>
  )
}

// SPEC "Today / workout screen" — Empty state's own "when it's due" wording
// (TodayPage.tsx's own formatDueIn — duplicated here rather than exported
// across a file boundary for a three-line helper, same small, well-
// understood-duplication posture referenceByExercise.ts's own byMostRecent
// takes), extended with "DUE TODAY"/"OVERDUE" for a sequence run's own due
// states (never reachable for the weekday empty state this mirrors, which
// only ever looks FORWARD from today).
function formatDue(dueDate: string | null, isDue: boolean, today: string): string {
  if (dueDate === null) return 'READY NOW'
  if (!isDue) {
    const daysAway = differenceInCalendarDays(parseISO(dueDate), parseISO(today))
    if (daysAway === 1) return 'DUE TOMORROW'
    return `DUE IN ${daysAway} DAYS`
  }
  if (dueDate === today) return 'DUE TODAY'
  const daysOverdue = differenceInCalendarDays(parseISO(today), parseISO(dueDate))
  return `OVERDUE BY ${daysOverdue} DAY${daysOverdue === 1 ? '' : 'S'}`
}
