// Chunk 58b — what the workout screen says about "last time" (boards W6, W16, W17): the one line on an exercise's card ("LAST = LAST
// WEEK, TUE ›") and the panels in the sheet it opens. Both are read from the reference's own resolution (`referenceByExercise.ts`, unchanged
// in meaning: deloads never count; LAST WEEK only for the preceding calendar week; LAST TIME with its elapsed time otherwise; a sequence run
// always LAST TIME with no EARLIER THIS WEEK; the reach-back when the matched session was all skipped), and the line's row-by-row twin
// (`lastTimeSet.ts`, which the rows' LAST line reads) is handed the same sessions, so the card, the sheet and the rows can't name different
// sessions. The panels' wording is the boards': LAST WEEK / LAST TIME / EARLIER THIS WEEK / LAST TRAINED.
import { formatDistance, format, parseISO } from 'date-fns'
import type { SetLog, WeightUnit } from '../../types'
import type { ReferenceSession } from './sessionService'
import type { SetGroup } from './setGroupLogic'
import { hasRealLoggedSet } from './referenceLogic'
import { resolveExerciseReferenceAcrossRuns, resolveReachBackAcrossRuns, type ScheduleType } from './referenceByExercise'
import { toDisplayWeight } from '../../lib/weightUnit'

export interface LastTimeRow {
  /** `01`, or `↳` for a drop. */
  n: string
  /** `52.5 × 10`, or `—` for a skipped set. */
  text: string
  /** `@ 2`, or ''. */
  rir: string
  /** `DROP` on a drop, `SKIPPED` on a skipped set. */
  badge: string
  stage: boolean
}

export interface LastTimePanel {
  title: 'LAST WEEK' | 'LAST TIME' | 'EARLIER THIS WEEK' | 'LAST TRAINED'
  /** `TUE 6 OCT`, `ABOUT 1 MONTH AGO`, or `OFFLINE · CACHED` on the first panel of a cached read. */
  when: string
  rows: LastTimeRow[]
}

export type LastTimeBody =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'first_time' }
  | { kind: 'panels'; panels: LastTimePanel[]; note: string | null }

export interface LastTimeView {
  /** The card's line, without its chevron. */
  line: string
  body: LastTimeBody
}

/** `TODAY`, or the elapsed time as the old panel said it ("21 DAYS AGO", "ABOUT 1 MONTH AGO"), counted from `today`. */
function elapsed(today: string, date: string): string {
  if (date === today) return 'TODAY'
  return formatDistance(parseISO(date), parseISO(today), { addSuffix: true }).toUpperCase()
}

const dayShort = (date: string) => format(parseISO(date), 'EEE').toUpperCase()
const dayLong = (date: string) => format(parseISO(date), 'EEE d MMM').toUpperCase()

function rowOf(n: string, log: SetLog, unit: WeightUnit, stage: boolean): LastTimeRow {
  if (log.isSkipped) return { n, text: '—', rir: '', badge: 'SKIPPED', stage }
  return {
    n,
    text: `${log.weight !== null ? toDisplayWeight(log.weight, unit) : '—'} × ${log.reps}`,
    rir: log.rir != null ? `@ ${log.rir}` : '',
    badge: stage ? 'DROP' : '',
    stage,
  }
}

/** A session's working sets as the panel lists them: heads numbered from 01 in order (a warmup has no place), drops under their head. */
function rowsOf(groups: ReadonlyArray<SetGroup<SetLog>>, unit: WeightUnit): LastTimeRow[] {
  const rows: LastTimeRow[] = []
  let place = 0
  for (const group of groups) {
    if (group.head.isWarmup) continue
    place += 1
    rows.push(rowOf(String(place).padStart(2, '0'), group.head, unit, false))
    for (const stage of group.stages) rows.push(rowOf('↳', stage, unit, true))
  }
  return rows
}

export function lastTimeView(input: {
  today: string
  scheduleType: ScheduleType
  /** This exercise's reference sessions (the batched read, sliced by exercise). */
  sessions: ReferenceSession[]
  isLoading: boolean
  isError: boolean
  /** The sessions came from the phone's cache, not the server. */
  isFromCache: boolean
  unit: WeightUnit
}): LastTimeView {
  const { today, scheduleType, sessions, isLoading, isError, isFromCache, unit } = input
  if (isLoading) return { line: 'LAST = ···', body: { kind: 'loading' } }
  if (isError) return { line: "COULDN'T LOAD LAST TIME", body: { kind: 'failed' } }

  const { primary, thisWeek } = resolveExerciseReferenceAcrossRuns(today, scheduleType, sessions)
  if (primary.type === 'first_time') return { line: 'FIRST TIME', body: { kind: 'first_time' } }

  const panels: LastTimePanel[] = []
  const primarySession = primary.session
  const primaryIsReal = hasRealLoggedSet(primarySession)
  panels.push({
    title: primary.type === 'last_week' ? 'LAST WEEK' : 'LAST TIME',
    when: isFromCache ? 'OFFLINE · CACHED' : primary.type === 'last_week' ? dayLong(primarySession.date) : elapsed(today, primarySession.date),
    rows: rowsOf(primarySession.logs, unit),
  })

  let note: string | null = null
  let line: string
  if (primaryIsReal) {
    line = primary.type === 'last_week' ? `LAST = LAST WEEK, ${dayShort(primarySession.date)}` : `LAST = ${elapsed(today, primarySession.date)}`
  } else {
    // The matched session was all skipped: the panel reaches back to the last session that was really done (the rows' LAST line reads it).
    const reachedBack = resolveReachBackAcrossRuns(today, sessions)
    if (reachedBack.type === 'found') {
      panels.push({ title: 'LAST TRAINED', when: elapsed(today, reachedBack.session.date), rows: rowsOf(reachedBack.session.logs, unit) })
      line = `LAST = ${elapsed(today, reachedBack.session.date)}`
    } else if (reachedBack.type === 'none_found') {
      note = 'Nothing on record to compare against.'
      line = 'LAST = NOTHING ON RECORD'
    } else {
      note = 'Skipped every time on record.'
      line = 'LAST = SKIPPED EVERY TIME'
    }
  }

  // EARLIER THIS WEEK: the exercise done before today in the same calendar week (a weekday run only; the resolver returns none for a sequence run).
  for (const { session } of thisWeek) {
    panels.push({ title: 'EARLIER THIS WEEK', when: dayLong(session.date), rows: rowsOf(session.logs, unit) })
  }
  if (thisWeek.length > 0) line += ` · ALSO ${thisWeek.map(({ session }) => dayShort(session.date)).join(', ')}`

  return { line, body: { kind: 'panels', panels, note } }
}
