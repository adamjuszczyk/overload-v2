import { differenceInCalendarWeeks, parseISO, format, isAfter, isBefore, addDays, startOfWeek } from 'date-fns'
import type {
  SchedulerResult,
  MissedSession,
  Mesocycle,
  Program,
  WorkoutDay,
  WeekPlan,
  Session,
  DayOfWeek,
  DueTodayEntry,
  NextScheduledSession,
} from '../../types'
import { effectiveDate } from './effectiveDate'

// The empty state's own "next scheduled session" look-ahead (SPEC "Today /
// workout screen" — Empty state bullet) — one full week is always enough:
// the program's schedule is a fixed weekly template, so every weekday
// recurs within 7 days of any starting point.
const NEXT_SCHEDULED_HORIZON_DAYS = 7

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

  // One session in progress at a time, as today (reviewer's note 2) —
  // unchanged: any in-progress session anywhere short-circuits the whole
  // result, whether it's today's own, a caught-up missed one, or one moved
  // here from elsewhere.
  const activeSession = sessions.find((s) => s.status === 'in_progress')
  if (activeSession) return { type: 'active_session', session: activeSession }

  const todayDate = parseISO(today)
  const mesoStart = parseISO(activeMeso.startDate)

  // ─── Missed sessions: current week only (SPEC — the cross-week 7-day
  // look-back goes) ───────────────────────────────────────────────────────
  // Floor is this calendar week's own Monday, never earlier than the meso
  // start — was `subDays(todayDate, 7)` (cross-week) before this chunk.
  const weekStart = startOfWeek(todayDate, { weekStartsOn: 1 })
  const lookbackFrom = isAfter(mesoStart, weekStart) ? mesoStart : weekStart

  const pastSessions = sessions.filter((s) => s.date < today)

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
        // Chunk 24: a 'planned' row that was itself MOVED AWAY from this
        // day (moved_to_date set, to a day other than this one) also
        // counts as handled — the user has already addressed this day by
        // rescheduling it, so the prompt shouldn't nag about it too (and,
        // without this, "DO IT NOW" on the stale prompt entry would
        // silently clobber the user's own earlier move target). A plain
        // 'planned' row with no moved_to_date still doesn't count, same as
        // the production fact this chunk's brief verified (S9) — that
        // shape never actually arises from any write path in this app
        // (every 'planned' row this chunk's own moveSession/createSession
        // writes always sets moved_to_date to something other than its own
        // `date`), so this is a safe, additive narrowing, not a change to
        // S9's own observed behaviour.
        const movedAway = !!daySession?.movedToDate && daySession.movedToDate !== dateStr
        const isHandled =
          daySession &&
          (daySession.status === 'completed' ||
            daySession.status === 'in_progress' ||
            daySession.status === 'skipped' ||
            movedAway)

        if (!isHandled) {
          const weekNum = differenceInCalendarWeeks(cursor, mesoStart, { weekStartsOn: 1 }) + 1
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

  // ─── Due today: scheduled for today and not moved away, plus those moved
  // here (reviewer's note 2) ──────────────────────────────────────────────
  // One formula captures both halves of that rule: a session counts toward
  // today exactly when its EFFECTIVE date (moved_to_date when set, else
  // date — effectiveDate.ts) is today. Scheduled-for-today-but-moved-away
  // is excluded (its effective date is its target, not today);
  // moved-here-from-elsewhere is included (its effective date IS today even
  // though its own `date` is some earlier day). Skipped sessions are
  // excluded the same way the pre-chunk-24 scheduler always ignored them
  // (it only ever checked for `status === 'completed'`) — see this chunk's
  // report for the one case this preserves (skip-then-recreate, same day —
  // REDO SESSION did this until B1, 2026-10-10, removed it; the rule itself
  // is unchanged).
  const dueTodayRows = sessions.filter((s) => s.status !== 'skipped' && effectiveDate(s) === today)

  const todayDow = format(todayDate, 'EEEE').toLowerCase() as DayOfWeek
  const todayWdId = program.schedule[todayDow] ?? null
  // Stale guard, same as before this chunk.
  const todayWorkoutDay = todayWdId ? workoutDays.find((wd) => wd.id === todayWdId) ?? null : null
  const effectiveTodayWdId = todayWorkoutDay ? todayWdId : null

  // Today's own normally-scheduled slot needs a virtual (not-yet-created)
  // suggestion unless a row already speaks for it. Lookup is by RAW `date`
  // (not effective date) on purpose — a row dated today for this exact
  // workout day is either: completed (blocks re-suggestion, same as
  // before), skipped (does NOT block — matches the pre-chunk-24 scheduler,
  // which never examined skipped rows at all), or moved away (its own
  // moved_to_date is set to some other day — also does not re-trigger a
  // virtual suggestion: the slot was deliberately vacated, not fulfilled).
  const todaysOwnRow = effectiveTodayWdId
    ? sessions.find((s) => s.date === today && s.workoutDayId === effectiveTodayWdId)
    : undefined
  const needsVirtualSuggestion =
    !!effectiveTodayWdId && (!todaysOwnRow || todaysOwnRow.status === 'skipped')

  function toEntry(s: Session): DueTodayEntry {
    if (s.status === 'completed') return { type: 'completed_today', session: s }
    // Not completed, not skipped (filtered into dueTodayRows already), not
    // in_progress (the global short-circuit above already returned) — the
    // only status left on a due-today row is 'planned': a session moved
    // here (or moved away from here and back — same shape) that hasn't
    // started yet.
    const weekPlan =
      currentWeekPlans.find((wp) => wp.workoutDayId === s.workoutDayId) ??
      allWeekPlans.find((wp) => wp.id === s.weekPlanId) ??
      null
    const workoutDay = workoutDays.find((wd) => wd.id === s.workoutDayId) ?? null
    return { type: 'planned', session: s, weekPlan, workoutDay }
  }

  const entries: DueTodayEntry[] = dueTodayRows.map(toEntry)

  if (needsVirtualSuggestion && effectiveTodayWdId && todayWorkoutDay) {
    const weekPlan = currentWeekPlans.find((wp) => wp.workoutDayId === effectiveTodayWdId) ?? null
    entries.push(
      weekPlan
        ? { type: 'suggest_from_plan', weekPlan, date: today }
        : { type: 'suggest_no_plan', workoutDay: todayWorkoutDay, date: today },
    )
  }

  if (entries.length === 0) {
    return { type: 'rest_day', next: findNextScheduled(today, program, workoutDays) }
  }
  if (entries.length === 1) {
    // The overwhelmingly common case: exactly the same singular variant
    // this function always returned before this chunk, unchanged shape.
    return entries[0]
  }
  // 2+ sessions share today (G14 — "moving onto a day that already has one
  // leaves both... shown as a list").
  return { type: 'due_today', sessions: entries }
}

// The empty state's own "next scheduled session and when it's due" (SPEC —
// "no session today -> the next scheduled session and when it's due").
// Deliberately simple: scans only the program's own weekly template, not
// `sessions` — a future day's own session having itself been moved away
// would still surface here as "next" (a documented simplification for an
// informational hint, not a hard guarantee — see this chunk's report).
function findNextScheduled(
  today: string,
  program: Program,
  workoutDays: WorkoutDay[],
): NextScheduledSession | null {
  let cursor = addDays(parseISO(today), 1)
  for (let i = 0; i < NEXT_SCHEDULED_HORIZON_DAYS; i++) {
    const dow = format(cursor, 'EEEE').toLowerCase() as DayOfWeek
    const wdId = program.schedule[dow]
    const workoutDay = wdId ? workoutDays.find((wd) => wd.id === wdId) : undefined
    if (workoutDay) return { date: format(cursor, 'yyyy-MM-dd'), workoutDay }
    cursor = addDays(cursor, 1)
  }
  return null
}
