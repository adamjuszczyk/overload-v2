import { differenceInWeeks, parseISO, format, subDays, isAfter, isBefore, addDays } from 'date-fns'
import type {
  SchedulerResult,
  MissedSession,
  Mesocycle,
  Program,
  WorkoutDay,
  WeekPlan,
  Session,
  DayOfWeek,
} from '../../types'

const LOOKBACK_DAYS = 7

export function schedule(
  today: string,
  {
    activeMeso,
    programs,
    workoutDays,
    currentWeekPlans,
    allWeekPlans,
    sessions,
    dismissMissed = false,
  }: {
    activeMeso: Mesocycle | null
    programs: Program[]
    workoutDays: WorkoutDay[]
    currentWeekPlans: WeekPlan[]
    allWeekPlans: WeekPlan[]
    // All sessions in the lookback window (today included)
    sessions: Session[]
    // When true, skip straight to today's suggestion even if missed sessions
    // exist — the user closed the missed-sessions prompt without acting on it.
    dismissMissed?: boolean
  },
): SchedulerResult {
  if (programs.length === 0) return { type: 'no_program' }
  if (!activeMeso) return { type: 'no_active_meso' }

  const program = programs.find((p) => p.id === activeMeso.programId)
  if (!program) return { type: 'no_active_meso' }

  // Any in-progress session (may be for a missed date being done now)
  const activeSession = sessions.find((s) => s.status === 'in_progress')
  if (activeSession) return { type: 'active_session', session: activeSession }

  const todaySessions = sessions.filter((s) => s.date === today)
  const pastSessions = sessions.filter((s) => s.date < today)

  const completedSession = todaySessions.find((s) => s.status === 'completed')
  if (completedSession) return { type: 'completed_today', session: completedSession }

  // Missed sessions: walk from lookback start to yesterday
  const mesoStart = parseISO(activeMeso.startDate)
  const todayDate = parseISO(today)
  const lookbackFrom = isAfter(mesoStart, subDays(todayDate, LOOKBACK_DAYS))
    ? mesoStart
    : subDays(todayDate, LOOKBACK_DAYS)

  const missed: MissedSession[] = []
  let cursor = lookbackFrom

  while (isBefore(cursor, todayDate)) {
    const dateStr = format(cursor, 'yyyy-MM-dd')
    const dow = format(cursor, 'EEEE').toLowerCase() as DayOfWeek
    const wdId = program.schedule[dow]

    if (wdId) {
      // Stale guard: workout day may have been deleted from the program
      const workoutDay = workoutDays.find((wd) => wd.id === wdId)

      if (workoutDay) {
        const daySession = pastSessions.find((s) => s.date === dateStr)
        const isHandled =
          daySession &&
          (daySession.status === 'completed' ||
            daySession.status === 'in_progress' ||
            daySession.status === 'skipped')

        if (!isHandled) {
          const weekNum = differenceInWeeks(cursor, mesoStart) + 1
          const weekPlan =
            allWeekPlans.find(
              (wp) => wp.workoutDayId === wdId && wp.weekNumber === weekNum,
            ) ?? null

          missed.push({
            date: dateStr,
            weekPlan,
            workoutDay,
            existingSessionId: daySession?.id ?? null,
          })
        }
      }
    }

    cursor = addDays(cursor, 1)
  }

  if (missed.length > 0 && !dismissMissed) return { type: 'missed_sessions', queue: missed }

  // Today's scheduled workout
  const todayDow = format(todayDate, 'EEEE').toLowerCase() as DayOfWeek
  const todayWdId = program.schedule[todayDow]

  if (!todayWdId) return { type: 'rest_day' }

  // Stale guard
  const todayWorkoutDay = workoutDays.find((wd) => wd.id === todayWdId)
  if (!todayWorkoutDay) return { type: 'rest_day' }

  const weekPlan = currentWeekPlans.find((wp) => wp.workoutDayId === todayWdId) ?? null

  if (weekPlan) {
    return { type: 'suggest_from_plan', weekPlan, date: today }
  }
  return { type: 'suggest_no_plan', workoutDay: todayWorkoutDay, date: today }
}
