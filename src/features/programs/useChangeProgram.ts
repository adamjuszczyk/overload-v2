import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { differenceInCalendarWeeks, parseISO } from 'date-fns'
import { queryClient } from '../../lib/queryClient'
import { errorReason } from '../../components/exercisePickerLogic'
import { useAuth } from '../auth/useAuth'
import { RUN_SCHEDULES_KEY } from '../plan/useRunSchedule'
import type { Exercise, Mesocycle, Program } from '../../types'
import { fetchChangeProgramSource, type ChangeProgramSource } from './changeProgramService'
import { draftContent, draftDiffers, initialDraft, type DraftState } from './changeProgramDraft'
import { useApplyOps } from './applyOps'
import {
  changeStartWeek,
  daysOfWorkout,
  planProgramChange,
  ruleBoxText,
  type KeptSession,
  type Op,
  type RuleBoxText,
} from './programChange'
import { scheduleForWeek } from './runSchedule'

// Chunk 51a (TASKS-1.2, CHANGE THE PROGRAM) — everything the screen does that is not drawing: it reads the run copy and the
// planned sessions, holds the local draft (nothing is written until SAVE), says which week the changes start in, and on SAVE
// builds the op list with `planProgramChange` (chunk 45) and sends it in one request with `applyOps` (chunk 47).

/** The run's current week: the calendar week, Monday-anchored (RULES.md: "Meso week numbers are calendar weeks"). */
export function weekOfRun(startDate: string): number {
  // A run whose start date is still ahead has no current week yet: week 1.
  return Math.max(1, differenceInCalendarWeeks(new Date(), parseISO(startDate), { weekStartsOn: 1 }) + 1)
}

/**
 * The sessions the rule box names as keeping their plan: every session from the current week on that is done or in progress,
 * in the order Plan lists them. A weekday run names the day when the workout is on exactly one day that week ("Monday's Push
 * 1 is done, so it keeps its plan"), by the schedule in force for that week.
 */
export function keptSessionsOf(source: ChangeProgramSource, currentWeek: number, isWeekdayRun: boolean): KeptSession[] {
  const workouts = source.runCopy.workouts
  const nameOf = new Map(workouts.map((w) => [w.id, w.name]))
  const orderOf = new Map(workouts.map((w, i) => [w.id, i]))
  return source.sessions
    .filter((s) => s.weekNumber >= currentWeek && s.status !== 'not_started')
    .sort(
      (a, b) =>
        a.weekNumber - b.weekNumber ||
        (orderOf.get(a.workoutDayId) ?? 0) - (orderOf.get(b.workoutDayId) ?? 0) ||
        (a.sequencePosition ?? -1) - (b.sequencePosition ?? -1),
    )
    .map((s): KeptSession => {
      const days = isWeekdayRun
        ? daysOfWorkout(scheduleForWeek(source.scheduleRows, source.runCopy.schedule, s.weekNumber), s.workoutDayId)
        : []
      return {
        workoutName: nameOf.get(s.workoutDayId) ?? 'A workout',
        weekday: days.length === 1 ? days[0] : null,
        status: s.status as 'done' | 'in_progress',
      }
    })
}

/**
 * The query keys an op list makes stale. `v2_apply_ops` invalidates nothing itself (chunk 47): the caller does, for what its
 * list touched. A week's exercise list is a join over the run copy's program-exercise rows (usePrograms.ts, "Plan's weeks keep
 * their own copy of a program exercise's design fields"), so a change to those rows also stales every cached week plan.
 */
export function queryKeysTouchedBy(ops: readonly Op[]): string[][] {
  const tables = new Set<string>(ops.map((o) => o.table))
  const keys = new Set<string>()
  const add = (...names: string[]) => names.forEach((n) => keys.add(n))
  if (tables.has('v2_programs') || tables.has('v2_workout_days')) add('v2_programs', 'v2_workoutDays')
  if (tables.has('v2_program_exercises') || tables.has('v2_program_sets')) {
    add('v2_programExercises', 'v2_programSets', 'v2_weekPlans', 'v2_allWeekPlans', 'v2_weekPlan')
  }
  if (tables.has('v2_program_superset_blocks')) add('v2_programSupersetBlocks', 'v2_weekPlans', 'v2_allWeekPlans', 'v2_weekPlan')
  if (tables.has('v2_workout_warmup_items')) add('v2_workoutWarmupItems')
  if (tables.has('v2_run_schedules')) add(RUN_SCHEDULES_KEY)
  if (tables.has('v2_week_plans') || tables.has('v2_week_plan_exercises') || tables.has('v2_week_plan_sets')) {
    add('v2_weekPlans', 'v2_allWeekPlans', 'v2_weekPlan')
  }
  return [...keys].map((k) => [k])
}

// SAVE found the run copy changed since the screen opened it (another device, or an earlier attempt of this very save whose
// reply never came): writing the draft would write back what the screen started from, over what changed.
export class ProgramChangedError extends Error {
  constructor() {
    super('The program changed since you opened this screen. Go back and open it again to see it.')
    this.name = 'ProgramChangedError'
  }
}

export interface ChangeProgramArgs {
  meso: Mesocycle
  /** The run's own copy (`kind = 'run'`). */
  program: Program
  /** The saved program it started from: "Your saved program, [name], doesn't change." */
  savedName: string
  currentWeek: number
  /** Where CANCEL and a finished SAVE go. */
  onDone: () => void
}

export interface ChangeProgramScreen {
  load: 'loading' | 'error' | 'ready'
  loadError: string | null
  reload: () => void
  source: ChangeProgramSource | null
  draft: DraftState | null
  update: (fn: (s: DraftState) => DraftState) => void
  differs: boolean
  startWeek: number
  rule: RuleBoxText | null
  /** The exercise a row names: the run copy's, or one picked in this edit. */
  exerciseOf: (exerciseId: string) => Exercise | undefined
  remember: (exercise: Exercise) => void
  save: () => Promise<void>
  saving: boolean
  saveError: string | null
}

export function useChangeProgram(args: ChangeProgramArgs): ChangeProgramScreen {
  const { meso, program, savedName, currentWeek, onDone } = args
  const { user } = useAuth()
  const planningType = program.planningType ?? 'week_dependent'
  const scheduleType = program.scheduleType ?? 'weekday'

  const read = useQuery({
    queryKey: ['v2_changeProgram', meso.id, program.id, currentWeek],
    queryFn: () => fetchChangeProgramSource({ mesoId: meso.id, programId: program.id, planningType, currentWeek }),
    // Always read when the screen opens: the statuses of the sessions decide what a save may touch.
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: 'always',
  })

  // The draft starts from the first read and is never replaced by a later one: the user's edits are not thrown away by a
  // refetch. `baseline` is the run copy the draft started from, for CANCEL's "differs?" and for SAVE's check that the run
  // copy is still that.
  const [state, setState] = useState<{ draft: DraftState; baseline: DraftState; source: ChangeProgramSource } | null>(null)
  useEffect(() => {
    if (state === null && read.data) {
      const start = initialDraft(read.data.runCopy, planningType)
      setState({ draft: start, baseline: start, source: read.data })
    }
  }, [read.data, state, planningType])

  const update = useCallback((fn: (s: DraftState) => DraftState) => {
    setState((cur) => (cur ? { ...cur, draft: fn(cur.draft) } : cur))
  }, [])

  const [picked, setPicked] = useState<Exercise[]>([])
  const remember = useCallback((exercise: Exercise) => setPicked((cur) => [...cur.filter((e) => e.id !== exercise.id), exercise]), [])
  const exerciseOf = useMemo(() => {
    const byId = new Map<string, Exercise>()
    for (const e of state?.source.exercises ?? []) byId.set(e.id, e)
    for (const e of picked) byId.set(e.id, e)
    return (id: string) => byId.get(id)
  }, [state?.source, picked])

  const source = state?.source ?? null
  const startWeek = source ? changeStartWeek(source.sessions, currentWeek) : currentWeek
  const rule = useMemo(
    () =>
      source
        ? ruleBoxText({
            planningType,
            scheduleType,
            startWeek,
            programName: savedName,
            kept: keptSessionsOf(source, currentWeek, scheduleType === 'weekday'),
          })
        : null,
    [source, planningType, scheduleType, startWeek, savedName, currentWeek],
  )

  const differs = state ? draftDiffers(state.draft, state.baseline) : false

  // ─── SAVE ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  const apply = useApplyOps()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const inFlight = useRef(false)

  const save = useCallback(async () => {
    if (!state || !user || inFlight.current) return
    inFlight.current = true
    setSaving(true)
    setSaveError(null)
    try {
      // Read everything again: a session may have started since the screen opened, and the plan is made from the run as it
      // is now. The list is built once per attempt, with ids drawn then; an attempt that failed is rebuilt from a fresh read.
      const fresh = await fetchChangeProgramSource({ mesoId: meso.id, programId: program.id, planningType, currentWeek })
      if (draftContent(initialDraft(fresh.runCopy, planningType)) !== draftContent(state.baseline)) throw new ProgramChangedError()
      const plan = planProgramChange({
        userId: user.id,
        now: new Date().toISOString(),
        newId: () => crypto.randomUUID(),
        planningType,
        scheduleType,
        currentWeek,
        runCopy: fresh.runCopy,
        scheduleRows: fresh.scheduleRows,
        sessions: fresh.sessions,
        edit: state.draft.edit,
      })
      if (plan.ops.length > 0) {
        await apply.mutateAsync(plan.ops)
        await Promise.all(queryKeysTouchedBy(plan.ops).map((queryKey) => queryClient.invalidateQueries({ queryKey })))
      }
      onDone()
    } catch (error) {
      setSaveError(errorReason(error, typeof navigator !== 'undefined' && navigator.onLine === false))
    } finally {
      inFlight.current = false
      setSaving(false)
    }
  }, [state, user, meso.id, program.id, planningType, scheduleType, currentWeek, apply, onDone])

  return {
    load: read.isError && !state ? 'error' : state ? 'ready' : 'loading',
    loadError: read.isError ? errorReason(read.error, typeof navigator !== 'undefined' && navigator.onLine === false) : null,
    reload: () => void read.refetch(),
    source,
    draft: state?.draft ?? null,
    update,
    differs,
    startWeek,
    rule,
    exerciseOf,
    remember,
    save,
    saving,
    saveError,
  }
}
