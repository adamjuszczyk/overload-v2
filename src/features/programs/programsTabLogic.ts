import { differenceInCalendarWeeks, format, parseISO } from 'date-fns'
import type { Mesocycle, PlanningType, Program, ScheduleType, WeeklySchedule } from '../../types'
import { MUSCLE_GROUP_LABELS, MUSCLE_SUBGROUP_LABELS } from '../../lib/exerciseTags'
import { buildGroupMarkEntries } from '../../lib/priorityMarks'
import type { PriorityMark, StoredMark } from '../../lib/priorityMarks'

// The rules of the PROGRAMS tab (TASKS-1.2 chunk 65; SPEC Screens → PROGRAMS, Programs and runs [1.2], Language "Program everywhere"
// (C12); boards PR1-PR13b), pure: the words a card or a row says about a program or a run, and where a row leads. The components draw what
// these decide; nothing here knows about React. Every string is on a board (design/1.2/source/*.dc.html) except where a comment says
// "ours": the words of a state no board draws (D31, provisional).

// ─── Where the tab's links go ─────────────────────────────────────────────────────────────────────────────────────────────

/** FOCUS and DON'T CARE open the current program's priorities, view-only (PR5). */
export const PRIORITIES_PATH = '/plan/priorities'
/** EDIT PROGRAM opens CHANGE THE PROGRAM (7b). */
export const CHANGE_PROGRAM_PATH = '/plan/change'
/** START lands on Plan, week 1 (SPEC Programs and runs [1.2], Starting; F6): `week=1` is a one-shot the Plan shell reads and removes. */
export const PLAN_WEEK_ONE_PATH = '/plan?week=1'

/** OPEN: the stepped program planner on a saved program. */
export function plannerPath(programId: string): string {
  return `/program/${programId}`
}

/**
 * A finished program's row (chunk 66; TASKS 65: "FINISHED: ... → `/program/finished/:id` (66)"). It opened the completed-run priorities
 * page of that run until the finished program screen (PR14) existed; that page is now reached from the screen's PRIORITIES row, for the one
 * kind of run G50 keeps it for (`legacyPrioritiesPath`).
 */
export function finishedProgramPath(mesoId: string): string {
  return `/program/finished/${mesoId}`
}

/** PR14's PRIORITIES row, for a run whose marks are in the new table: the editor over the run's own copy (chunk 66). */
export function finishedPrioritiesPath(mesoId: string): string {
  return `/program/finished/${mesoId}/priorities`
}

/**
 * PR14's PRIORITIES row, for a run whose marks exist only in the old table (`v2_coach_meso_tag_priorities`, a run finished before 1.1):
 * today's completed-run priorities page, as it is, wording included (G50; the Coach module's page, frozen).
 */
export function legacyPrioritiesPath(mesoId: string): string {
  return `/meso/${mesoId}/priorities`
}

// ─── The run's week ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The week a weekday run is in on `today`: calendar weeks counted from the Monday of the week it started in, as Plan counts them
 * (`computeWeekNumber`, RULES: Monday-anchored, `weekStartsOn: 1` passed explicitly). A run that starts later than today has no current
 * week yet: week 1, as Plan reads it.
 */
export function weekOfRun(today: string, startDate: string): number {
  return Math.max(1, differenceInCalendarWeeks(parseISO(today), parseISO(startDate), { weekStartsOn: 1 }) + 1)
}

// ─── What a program is, in a line ─────────────────────────────────────────────────────────────────────────────────────────

type TypesOf = Pick<Program, 'scheduleType' | 'planningType' | 'schedule'>

/**
 * "Weekdays · stable · 5 days a week" (PR1's card) or the same in capitals (a row of YOUR PROGRAMS: "WEEKDAYS · STABLE · 5 DAYS A WEEK").
 * The first part is the schedule type, the second the planning type; a weekday program adds how many weekdays have a workout. A
 * sequence program has no weekdays, so it says nothing about days (ours: no board draws one). A program with no workout on any weekday
 * yet says nothing about days either: an unset feature shows nothing (the standing UI rule).
 *
 * `days` is the weekday map whose workouts are counted (1.2.1 item 19, SPEC "PROGRAMS · CURRENT PROGRAM card", DECISIONS 190 (a)). Left out, it is
 * the program's own `schedule`, which is what a saved program in YOUR PROGRAMS counts. The card of the running program passes the schedule in
 * force this week (`scheduleForWeek`), because the run copy's `schedule` holds the newest days, which a change that starts next week has
 * already put there. `null` says the days are not known yet (the run's schedule rows are still being read): there is nothing to count, and the
 * line says nothing about days, rather than a number from the wrong week.
 */
export function programTypesLine(program: TypesOf, capitals = false, days: Partial<WeeklySchedule> | null = program.schedule): string {
  const scheduleType: ScheduleType = program.scheduleType ?? 'weekday'
  const parts = [scheduleType === 'sequence' ? 'Sequence' : 'Weekdays', (program.planningType ?? 'week_dependent') === 'stable' ? 'stable' : 'week-dependent']
  if (scheduleType === 'weekday') {
    const count = Object.values(days ?? {}).filter(Boolean).length
    if (count > 0) parts.push(`${count} ${count === 1 ? 'day' : 'days'} a week`)
  }
  const line = parts.join(' · ')
  return capitals ? line.toUpperCase() : line
}

// ─── A finished program ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A finished run's number of weeks (P1.2-4): calendar weeks from the start date to the end date, Monday-anchored, as `weekOfRun` counts them.
 * The FINISHED row (`finishedMeta`) and the finished program's header (chunk 66) say this number.
 */
export function finishedWeekCount(run: { startDate: string; endDate: string }): number {
  return Math.max(1, differenceInCalendarWeeks(parseISO(run.endDate), parseISO(run.startDate), { weekStartsOn: 1 }) + 1)
}

/**
 * What the second line of a FINISHED row says: "SEP 14 – OCT 4, 2026 · 3 WEEKS" (PR1; SPEC Language: "[name] · [dates] · [N] weeks"). The
 * weeks are calendar weeks from the start date to the end date, Monday-anchored, as `weekOfRun` counts them (P1.2-4). The year is said once
 * when both dates are in it. A run with no end date (not expected on a finished one) says only when it started.
 */
export function finishedMeta(run: Pick<Mesocycle, 'startDate' | 'endDate'>): string {
  const start = parseISO(run.startDate)
  if (!run.endDate) return format(start, 'MMM d, yyyy').toUpperCase()
  const end = parseISO(run.endDate)
  const weeks = finishedWeekCount({ startDate: run.startDate, endDate: run.endDate })
  const startText = start.getFullYear() === end.getFullYear() ? format(start, 'MMM d') : format(start, 'MMM d, yyyy')
  return `${startText} – ${format(end, 'MMM d, yyyy')} · ${weeks} ${weeks === 1 ? 'week' : 'weeks'}`.toUpperCase()
}

/** "Started Oct 5, 2026" (PR1's card). */
export function startedLine(startDate: string): string {
  return `Started ${format(parseISO(startDate), 'MMM d, yyyy')}`
}

// ─── The run's marks, in a line ───────────────────────────────────────────────────────────────────────────────────────────

const lower = (text: string) => text.toLowerCase()

/**
 * What a FOCUS or DON'T CARE row says (PR1: "Chest, back", "Calves, forearms"): the groups marked so, then the subgroups marked so under
 * a group that isn't, in the order the planner lists them. A group some subgroup is marked otherwise says so the way the planner's own
 * summary does ("chest without upper chest": SPEC, Stepped program planner, step 1). One sentence, capitalised once. Null when nothing
 * is marked so: an unset feature shows nothing, so the card draws no row for it (ours, D31).
 */
export function markSummary(rows: readonly StoredMark[], mark: PriorityMark): string | null {
  const parts: string[] = []
  for (const entry of buildGroupMarkEntries(rows)) {
    if (entry.ownMark === mark) {
      const except = entry.subgroups.filter((sub) => sub.ownMark !== null && sub.ownMark !== mark).map((sub) => lower(MUSCLE_SUBGROUP_LABELS[sub.tagValue]))
      const group = lower(MUSCLE_GROUP_LABELS[entry.tagValue])
      parts.push(except.length > 0 ? `${group} without ${except.join(', ')}` : group)
    } else {
      for (const sub of entry.subgroups) if (sub.ownMark === mark) parts.push(lower(MUSCLE_SUBGROUP_LABELS[sub.tagValue]))
    }
  }
  if (parts.length === 0) return null
  const text = parts.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * PR14's PRIORITIES row: "Focus: chest, back · Don't care: calves", each half only when something is marked so, the groups as `markSummary`
 * says them. Null when nothing is marked (an unset feature shows nothing: the row is then only its label).
 */
export function markLine(rows: readonly StoredMark[]): string | null {
  const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)
  const parts: string[] = []
  const focus = markSummary(rows, 'focus')
  if (focus) parts.push(`Focus: ${lowerFirst(focus)}`)
  const dontCare = markSummary(rows, 'dont_care')
  if (dontCare) parts.push(`Don't care: ${lowerFirst(dontCare)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

// ─── Starting and creating ────────────────────────────────────────────────────────────────────────────────────────────────

/** The sheet's title: PR9 when a program is running ("Start a new program"), PR8 when none is. */
export function startSheetTitle(running: boolean): string {
  return running ? 'Start a new program' : 'Start a program'
}

/** PR9's line: starting a program finishes the running one. */
export function startNote(runningName: string): string {
  return `Starting it finishes ${runningName}. Its weeks stay in History.`
}

/** PR11's reason under the disabled START PROGRAM. `hasSchedule.ts` has the line the planner's START says; the board ends it with a full stop. */
export const NO_SCHEDULE_REASON = 'Schedule at least one workout to start.'

/**
 * The name a run gets: what was typed, else the program's own (PR8: "NAME (OPTIONAL)", placeholder the program's name; SPEC Starting: "The
 * start sheet's optional name field defaults to the program's name").
 */
export function runNameFor(typed: string, program: Pick<Program, 'name'>): string {
  return typed.trim() || program.name
}

/** What a failed START says first: PR10's headline, then the real reason under it. */
export function startFailedLine(programName: string): string {
  return `Couldn't start ${programName}.`
}

/** PR13: the one line under CREATE PROGRAM while a type is still to be chosen (and so why it is disabled). */
export const CHOOSE_TYPES_HINT = 'Choose a schedule and a planning type to create it.'
/** PR13b: the one line under CREATE PROGRAM once both are chosen. */
export const CHANGE_LATER_HINT = 'You can change both later in the program.'
/** Ours (D31): a program with no name isn't created, and the sheet says so where the other reasons are said. */
export const NAME_IT_HINT = 'Name the program to create it.'

/**
 * Whether CREATE PROGRAM can be pressed and what the line under it says (SPEC Programs and runs [1.2], Creating a program (16a): "Neither
 * type is preselected; CREATE PROGRAM stays disabled until both are chosen, and the sheet says why"). The types come first, as the board
 * draws them; a blank name is the only other thing that stops it, and is said after them.
 */
export function createState(input: { name: string; scheduleType: ScheduleType | null; planningType: PlanningType | null }): { canCreate: boolean; hint: string } {
  if (input.scheduleType === null || input.planningType === null) return { canCreate: false, hint: CHOOSE_TYPES_HINT }
  if (input.name.trim() === '') return { canCreate: false, hint: NAME_IT_HINT }
  return { canCreate: true, hint: CHANGE_LATER_HINT }
}
