import { format, parseISO } from 'date-fns'
import type { DayOfWeek, ProgramExercise, SessionStatus, WeekPlan, WeekPlanSet } from '../../types'
import { thisWeekOnly, type RunCopy } from './weekPlanning'

// Chunk 54b (TASKS-1.2 "Plan's week view: sessions, states, the stable-week line, legend and marks, read-only weeks"; SPEC Screens → Plan
// screen, Weeks and copying [1.2]; boards 1, 1a, 1c, 1d, 10, 11). The week view's rules as pure functions, so the screen only draws them:
// which state a session is in, what its header and menu say, which exercises of a stable week say THIS WEEK ONLY.

export const DAYS_ORDER: DayOfWeek[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/** `TUESDAY`: the session header's top line. */
export const DOW_LABEL: Record<DayOfWeek, string> = {
  monday: 'MONDAY',
  tuesday: 'TUESDAY',
  wednesday: 'WEDNESDAY',
  thursday: 'THURSDAY',
  friday: 'FRIDAY',
  saturday: 'SATURDAY',
  sunday: 'SUNDAY',
}

/** `TUE`: a chip's top line. */
export const DOW_SHORT: Record<DayOfWeek, string> = {
  monday: 'MON',
  tuesday: 'TUE',
  wednesday: 'WED',
  thursday: 'THU',
  friday: 'FRI',
  saturday: 'SAT',
  sunday: 'SUN',
}

/** `Tue`: inside a sentence ("Marks Mon, Thu — they share one plan."). */
export const DOW_SHORT_TITLE: Record<DayOfWeek, string> = {
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
}

// ─── A session's state ────────────────────────────────────────────────────────

/** The part of a session row the week view reads: which plan it is for, the day it is for, where it was moved to, how far it got. */
export interface PlanSession {
  id: string
  weekPlanId: string
  workoutDayId: string | null
  /** The date the session is FOR (a moved session keeps it). */
  date: string
  movedToDate: string | null
  status: SessionStatus
}

export interface SessionState {
  /** The session row this chip or header is about; undefined while nothing has been started, skipped or moved. */
  session: PlanSession | undefined
  /** Finished: shown "✓ DONE" or "SKIPPED", read-only. */
  finished: 'done' | 'skipped' | null
  /** Started or finished: the session can't be moved (B2). */
  started: boolean
  /** The date a planned session was moved to, while it is moved; null otherwise. */
  movedTo: string | null
}

const NOTHING: SessionState = { session: undefined, finished: null, started: false, movedTo: null }

// The furthest a session has got wins when a plan has two rows (a shared plan's days, or a session redone).
const RANK: Record<SessionStatus, number> = { planned: 0, in_progress: 1, skipped: 2, completed: 3 }

/**
 * The state of one session of a week. `date` is the date the chip is FOR on a weekday run (a shared plan covers two days, and each day
 * has its own session); null on a sequence run, where a slot's plan row is the session's own.
 */
export function sessionStateOf(sessions: readonly PlanSession[] | undefined, plan: Pick<WeekPlan, 'id'> | undefined, date: string | null): SessionState {
  if (!sessions || !plan) return NOTHING
  let best: PlanSession | undefined
  for (const s of sessions) {
    if (s.weekPlanId !== plan.id) continue
    if (date !== null && s.date !== date) continue
    if (!best || RANK[s.status] > RANK[best.status]) best = s
  }
  if (!best) return NOTHING
  const finished = best.status === 'completed' ? 'done' : best.status === 'skipped' ? 'skipped' : null
  return {
    session: best,
    finished,
    started: best.status === 'in_progress' || best.status === 'completed',
    movedTo: finished === null && best.movedToDate && best.movedToDate !== best.date ? best.movedToDate : null,
  }
}

/** `THU` for a date: where a moved session went. */
export function dayShort(isoDate: string): string {
  return format(parseISO(isoDate), 'EEE').toUpperCase()
}

// ─── Words ────────────────────────────────────────────────────────────────────

/**
 * The session header's top line: the day (`TUESDAY`) or the slot (`SLOT 3`), and the week or cycle when the open one isn't the current one
 * (board 10's "THURSDAY · WEEK 1").
 */
export function sessionEyebrow(input: { label: string; unit: 'week' | 'cycle'; viewWeek: number; currentWeek: number }): string {
  const { label, unit, viewWeek, currentWeek } = input
  return viewWeek === currentWeek ? label : `${label} · ${unit.toUpperCase()} ${viewWeek}`
}

/** The session menu's eyebrow: always names the week or cycle (board 10: "TUESDAY · WEEK 2", "SLOT 3 · CYCLE 3"). */
export function menuEyebrow(input: { label: string; unit: 'week' | 'cycle'; viewWeek: number }): string {
  return `${input.label} · ${input.unit.toUpperCase()} ${input.viewWeek}`
}

/**
 * Under the session's name, when its plan covers more than one weekday (G14; SPEC: "Shared with Thu — changes apply to both"; P1.2-7:
 * "Shared with Thu, Sat — changes apply to all" for three days). The days named are the OTHER ones.
 */
export function sharedWithLine(weekdays: readonly DayOfWeek[], dow: DayOfWeek | null): string | null {
  const others = weekdays.filter((d) => d !== dow)
  if (others.length === 0) return null
  return `Shared with ${others.map((d) => DOW_SHORT_TITLE[d]).join(', ')} — changes apply to ${others.length === 1 ? 'both' : 'all'}`
}

/** In the session menu, under MARK THIS SESSION AS DELOAD (board 10): every day the shared plan covers. */
export function sharedMarksLine(weekdays: readonly DayOfWeek[]): string {
  return `Marks ${weekdays.map((d) => DOW_SHORT_TITLE[d]).join(', ')} — they share one plan.`
}

/** The legend over the session chips: "CHANGED SINCE WEEK 2" (CYCLE on a sequence run). */
export function legendText(unit: 'week' | 'cycle', sourceWeek: number): string {
  return `CHANGED SINCE ${unit.toUpperCase()} ${sourceWeek}`
}

// ─── THIS WEEK ONLY ───────────────────────────────────────────────────────────

/**
 * The exercises of a stable week that differ from the default in set count, kind, stages or rep target (weekPlanning's `thisWeekOnly`, one
 * exercise at a time): each is drawn with "THIS WEEK ONLY" and "CHANGE EVERY WEEK →". The default is the run copy's own sets of that
 * exercise: an exercise the run copy no longer has (removed, or a week-only row) has none, so it differs. Null run copy (not read yet): none.
 */
export function thisWeekOnlyExercises(
  exercises: ReadonlyArray<Pick<ProgramExercise, 'id'>>,
  sets: readonly WeekPlanSet[],
  runCopy: RunCopy | null,
): Set<string> {
  const out = new Set<string>()
  if (!runCopy) return out
  const live = new Set(runCopy.exercises.filter((e) => !e.weekOnly && !e.removedAt).map((e) => e.id))
  for (const pe of exercises) {
    const mine = sets.filter((s) => s.programExerciseId === pe.id)
    const base = live.has(pe.id) ? runCopy.sets.filter((ps) => ps.programExerciseId === pe.id) : []
    if (thisWeekOnly(mine, base)) out.add(pe.id)
  }
  return out
}
