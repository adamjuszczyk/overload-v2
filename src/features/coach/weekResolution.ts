import type { SupabaseClient } from '@supabase/supabase-js'
import { addDays, format, parseISO } from 'date-fns'
import { weekKey } from './weightLogic.js'
import type { DayOfWeek, Mesocycle, Program, Session, WorkoutDay, WeeklySchedule } from '../../types/index.js'

const ISO_DATE = 'yyyy-MM-dd'

// Pure week-completeness resolution (COACH-WEEK-ANALYSIS-TASKS.md §4 step 4,
// §7.1/§7.2). A week is "over" by plan resolution, not by calendar date
// (SPEC §5): every session the program's schedule expected for that week
// must be completed or skip-marked, with at least one actually completed —
// not just vacuously resolved.
//
// "Expected" is derived from `program.schedule` (the same source
// scheduler.ts's missed-session logic already reads, TASKS §7.1), not
// `v2_week_plans` — a date the scheduler never prompts about can't be
// skip-marked through any existing UI, so using the weekly-plan layer
// instead would risk a permanently unanalyzable week.

export interface ExpectedSession {
  date: string
  dow: DayOfWeek
  workoutDayId: string
  mesocycleId: string
}

export interface WeekResolution {
  weekStart: string   // Monday, normalised via weekKey
  weekEnd: string     // Sunday
  expected: ExpectedSession[]
  // True only when every expected date resolved (completed or skipped) AND
  // at least one resolved as completed (TASKS §7.1). This single clause
  // also correctly handles the two "vacuously resolved" edge cases without
  // a separate guard: zero expected dates trivially satisfies "every date
  // resolved" but fails "at least one completed" (nothing to be true of),
  // and an all-skipped week satisfies the first but not the second either.
  isComplete: boolean
}

// Found by adversarial review (2026-08-23): a meso transition
// (useCreateMeso -> completeAllActiveMesos + createMeso, mesoService.ts)
// stamps the old meso's end_date and the new meso's start_date to the
// SAME "today" — both inclusive-bounds, so on every transition day two
// mesocycles match the same date and, without a tie-break, whichever one
// Postgres happens to return first silently wins. If the two programs'
// schedules disagree for that weekday, the loser's expected session gets
// dropped from `expected[]` entirely (not just misattributed) — a week
// that's actually missing a session could resolve isComplete: true and be
// permanently stored wrong (SPEC §9 has no regeneration path). No DB
// exclusion constraint prevents the overlap (001_v2_schema.sql: "enforced
// at the application layer" only) — this is pre-existing, accepted data
// shape, not something this function can fix at the source. What it CAN
// fix is the nondeterminism: prefer the most recently *started* meso on a
// genuine tie, so the result is at least reproducible rather than
// dependent on unspecified row order. Which program should actually
// govern a shared boundary day is a real product question this doesn't
// resolve — flagged in CONTEXT.md, not silently decided as "correct."
function mesoForDate(mesocycles: Mesocycle[], date: string): Mesocycle | null {
  const matches = mesocycles.filter((m) => date >= m.startDate && (m.endDate === null || date <= m.endDate))
  if (matches.length === 0) return null
  return matches.reduce((latest, m) => (m.startDate > latest.startDate ? m : latest))
}

// Sessions are matched to expected dates by date alone, matching
// scheduler.ts's own missed-session predicate (`pastSessions.find(s =>
// s.date === dateStr)`) rather than date+workoutDayId — same precedent,
// not a new convention introduced here.
export function resolveWeek(
  weekStartInput: string,
  mesocycles: Mesocycle[],
  programs: Program[],
  sessions: Session[],
): WeekResolution {
  const weekStart = weekKey(weekStartInput)
  const weekEnd = format(addDays(parseISO(weekStart), 6), ISO_DATE)

  const expected: ExpectedSession[] = []
  for (let i = 0; i < 7; i++) {
    const date = format(addDays(parseISO(weekStart), i), ISO_DATE)

    const meso = mesoForDate(mesocycles, date)
    if (!meso) continue // no meso covers this date — nothing expected

    const program = programs.find((p) => p.id === meso.programId)
    if (!program) continue // defensive: a meso whose program can't be found

    const dow = format(parseISO(date), 'EEEE').toLowerCase() as DayOfWeek
    const workoutDayId = program.schedule[dow]
    if (!workoutDayId) continue // rest day per the schedule

    // Stale guard, matching scheduler.ts:69 exactly: the schedule can
    // reference a workout day that's since been deleted from the program.
    // Scheduler.ts silently drops such a date from its missed-session queue
    // rather than treating it as still expected — same behaviour here.
    const workoutDayExists = program.workoutDays.some((wd) => wd.id === workoutDayId)
    if (!workoutDayExists) continue

    expected.push({ date, dow, workoutDayId, mesocycleId: meso.id })
  }

  const statusByDate = new Map(sessions.map((s) => [s.date, s.status]))
  const resolvedCount = expected.filter((e) => {
    const status = statusByDate.get(e.date)
    return status === 'completed' || status === 'skipped'
  }).length
  const hasCompleted = expected.some((e) => statusByDate.get(e.date) === 'completed')

  return {
    weekStart,
    weekEnd,
    expected,
    isComplete: resolvedCount === expected.length && hasCompleted,
  }
}

// ─── Thin server-side fetch layer ──────────────────────────────────────────────
// Same two-part shape as analysisInput.ts/weekAnalysisInput.ts (pure builder
// above, fetch layer below) — kept here rather than duplicated inside
// api/coach/analyze-week.ts so the completeness re-derivation TASKS.md §1.3
// requires server-side is itself a reusable, directly callable function, not
// logic embedded in the handler.
//
// Deliberately does NOT reuse mesoService.ts/programService.ts/
// sessionService.ts — every one of those imports the browser singleton
// src/lib/supabase.ts, which throws at module load when VITE_SUPABASE_* are
// absent (fine in the browser, fatal at a Vercel Node function's cold
// start — the exact risk analysisInput.ts's own header documents at
// length). This takes an injected SupabaseClient instead, same pattern as
// every other Coach fetch layer.
//
// No date bound on mesocycles/programs — a handful of rows even unbounded
// at this app's single-user scale, same reasoning sessionService.ts's own
// reference-candidate query gives for staying unbounded.

const EMPTY_SCHEDULE: WeeklySchedule = {
  monday: null, tuesday: null, wednesday: null, thursday: null,
  friday: null, saturday: null, sunday: null,
}

type RawMesoRow = {
  id: string
  user_id: string
  name: string
  program_id: string
  status: string
  start_date: string
  end_date: string | null
  created_at: string
}

type RawProgramRow = {
  id: string
  user_id: string
  name: string
  schedule: Record<string, string | null> | null
  created_at: string
  updated_at: string
}

type RawWorkoutDayRow = {
  id: string
  program_id: string
  user_id: string
  name: string
  position: number
}

type RawSessionRow = {
  id: string
  user_id: string
  mesocycle_id: string | null
  week_plan_id: string | null
  workout_day_id: string | null
  date: string
  status: string
  note: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export async function assembleWeekResolution(
  client: SupabaseClient,
  userId: string,
  weekStartInput: string,
): Promise<WeekResolution> {
  const weekStart = weekKey(weekStartInput)
  const weekEnd = format(addDays(parseISO(weekStart), 6), ISO_DATE)

  const [
    { data: mesoRows, error: mesoError },
    { data: progRows, error: progError },
    { data: sessRows, error: sessError },
  ] = await Promise.all([
    client.from('v2_mesocycles').select('id, user_id, name, program_id, status, start_date, end_date, created_at').eq('user_id', userId),
    client.from('v2_programs').select('id, user_id, name, schedule, created_at, updated_at').eq('user_id', userId),
    client
      .from('v2_sessions')
      .select('id, user_id, mesocycle_id, week_plan_id, workout_day_id, date, status, note, started_at, completed_at, created_at')
      .eq('user_id', userId)
      .gte('date', weekStart)
      .lte('date', weekEnd),
  ])
  if (mesoError) throw mesoError
  if (progError) throw progError
  if (sessError) throw sessError

  const programIds = (progRows as RawProgramRow[]).map((p) => p.id)
  const { data: wdRows, error: wdError } =
    programIds.length > 0
      ? await client.from('v2_workout_days').select('id, program_id, user_id, name, position').eq('user_id', userId).in('program_id', programIds)
      : { data: [] as RawWorkoutDayRow[], error: null }
  if (wdError) throw wdError

  const workoutDaysByProgram = new Map<string, WorkoutDay[]>()
  for (const wd of wdRows as RawWorkoutDayRow[]) {
    const list = workoutDaysByProgram.get(wd.program_id) ?? []
    list.push({ id: wd.id, programId: wd.program_id, userId: wd.user_id, name: wd.name, position: wd.position, exercises: [] })
    workoutDaysByProgram.set(wd.program_id, list)
  }

  const mesocycles: Mesocycle[] = (mesoRows as RawMesoRow[]).map((m) => ({
    id: m.id,
    userId: m.user_id,
    name: m.name,
    programId: m.program_id,
    status: m.status as Mesocycle['status'],
    startDate: m.start_date,
    endDate: m.end_date,
    createdAt: m.created_at,
  }))

  const programs: Program[] = (progRows as RawProgramRow[]).map((p) => ({
    id: p.id,
    userId: p.user_id,
    name: p.name,
    schedule: { ...EMPTY_SCHEDULE, ...(p.schedule ?? {}) },
    workoutDays: workoutDaysByProgram.get(p.id) ?? [],
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  }))

  const sessions: Session[] = (sessRows as RawSessionRow[]).map((s) => ({
    id: s.id,
    userId: s.user_id,
    mesocycleId: s.mesocycle_id,
    weekPlanId: s.week_plan_id,
    workoutDayId: s.workout_day_id,
    date: s.date,
    status: s.status as Session['status'],
    note: s.note,
    startedAt: s.started_at,
    completedAt: s.completed_at,
    createdAt: s.created_at,
  }))

  return resolveWeek(weekStart, mesocycles, programs, sessions)
}
