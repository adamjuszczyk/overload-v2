// Builders for volumePerMuscle's tests: the app's own types (WeekPlan, WeekPlanSet,
// Session, SetLog, Exercise), so the tests also prove `volumeRows` accepts what the
// VOLUME sheet will hand it. Nothing here counts anything: every expected number in
// a test is written out by hand.

import type {
  Exercise,
  MuscleGroup,
  ProgramExercise,
  Session,
  SessionSetChange,
  SessionStatus,
  SetLog,
  WeekPlan,
  WeekPlanSet,
} from '../../types'
import type { VolumePlan, VolumeSession } from './volumePerMuscle'

export function exercise(id: string, muscleGroup: MuscleGroup | null): Exercise {
  return {
    id,
    userId: 'u1',
    name: id,
    // The type says MuscleGroup; v1 rows can really hold null (muscleGroup.ts).
    muscleGroup: muscleGroup as MuscleGroup,
    isArchived: false,
    createdAt: '2026-09-01T00:00:00Z',
    muscleSubgroups: null,
    movementPattern: null,
    status: 'active',
    sourceLibraryId: null,
    lostAt: null,
  }
}

// ─── Plans ─────────────────────────────────────────────────────────────────────

/** One exercise of a planned workout: its row id, the exercise, and its sets as tokens. */
export interface PlannedExercise {
  row: string
  exerciseId: string
  /**
   * Space-separated set tokens, in set order: `n` a normal working set, `a` an AMRAP set, `w` a warmup,
   * and a staged head with its drops written as kind letter + count: `d2` a dropset with two drops,
   * `m3` myo-reps with three, `r1` rest-pause with one, `c2` a cluster with two.
   */
  sets: string
  /** What the plan's own joined exercise says the group is: the wrong source, to tell it from `exercises`. */
  joinedGroup?: MuscleGroup
}

const STAGE_KINDS = { d: 'dropset', m: 'myo_reps', r: 'rest_pause', c: 'cluster' } as const

/** The id of a planned set: head `index` (1-based) of an exercise row in a plan, or one of its drops. */
export function setId(planId: string, row: string, index: number, drop?: number): string {
  return drop === undefined ? `${planId}:${row}:${index}` : `${planId}:${row}:${index}.${drop}`
}

function planSets(planId: string, e: PlannedExercise): WeekPlanSet[] {
  const base = (id: string, setNumber: number): WeekPlanSet => ({
    id,
    weekPlanId: planId,
    userId: 'u1',
    programExerciseId: e.row,
    setNumber,
    targetRir: null,
    isDropset: false,
    parentWeekPlanSetId: null,
    stageIndex: 0,
    isWarmup: false,
  })
  const sets: WeekPlanSet[] = []
  e.sets.split(/\s+/).filter(Boolean).forEach((token, i) => {
    const index = i + 1
    const id = setId(planId, e.row, index)
    if (token === 'w') {
      sets.push({ ...base(id, index), isWarmup: true })
    } else if (token === 'n') {
      sets.push(base(id, index))
    } else if (token === 'a') {
      sets.push({ ...base(id, index), isAmrap: true })
    } else {
      const kind = STAGE_KINDS[token[0] as keyof typeof STAGE_KINDS]
      const drops = Number(token.slice(1))
      if (!kind || !Number.isInteger(drops)) throw new Error(`unknown set token "${token}"`)
      sets.push({ ...base(id, index), stageKind: kind })
      for (let d = 1; d <= drops; d++) {
        sets.push({ ...base(setId(planId, e.row, index, d), index), parentWeekPlanSetId: id, stageIndex: d, isDropset: true })
      }
    }
  })
  return sets
}

/** A week's plan for one workout (a real `WeekPlan`), with the optional `occurrences` volumeRows reads (G14). */
export function weekPlan(
  id: string,
  planned: PlannedExercise[],
  opts: { isDeload?: boolean; occurrences?: number; weekNumber?: number } = {},
): WeekPlan & Pick<VolumePlan, 'occurrences'> {
  const exercises: ProgramExercise[] = planned.map((e, position) => ({
    id: e.row,
    workoutDayId: `wd-${id}`,
    userId: 'u1',
    exerciseId: e.exerciseId,
    position,
    weightUnit: null,
    ...(e.joinedGroup ? { exercise: exercise(e.exerciseId, e.joinedGroup) } : {}),
  }))
  return {
    id,
    userId: 'u1',
    mesocycleId: 'm1',
    workoutDayId: `wd-${id}`,
    weekNumber: opts.weekNumber ?? 2,
    isDeload: opts.isDeload ?? false,
    notes: null,
    sets: planned.flatMap((e) => planSets(id, e)),
    exercises,
    createdAt: '2026-09-01T00:00:00Z',
    ...(opts.occurrences === undefined ? {} : { occurrences: opts.occurrences }),
  }
}

// ─── Sessions and logs ─────────────────────────────────────────────────────────

interface LogOptions {
  /** The planned set it was logged against; null (the default) is a set nobody planned. */
  planned?: string | null
  skipped?: boolean
  warmup?: boolean
  /** The exercise the log's own joined record says it is: the wrong source. */
  joinedGroup?: MuscleGroup
}

function baseLog(id: string, sessionId: string, exerciseId: string, o: LogOptions): SetLog {
  const skipped = o.skipped ?? false
  return {
    id,
    userId: 'u1',
    sessionId,
    exerciseId,
    ...(o.joinedGroup ? { exercise: exercise(exerciseId, o.joinedGroup) } : {}),
    weekPlanSetId: o.planned ?? null,
    setNumber: 1,
    weight: skipped ? null : 50,
    reps: skipped ? null : 10,
    rir: null,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: o.warmup ?? false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: skipped,
    loggedAt: '2026-10-05T18:00:00Z',
    restSeconds: null,
    formRating: null,
  }
}

/** A logged head (a set that was done, skipped or a warmup) and, after it, `drops` logged stage rows. */
export function logHead(
  id: string,
  sessionId: string,
  exerciseId: string,
  o: LogOptions & { drops?: number; stageSkipped?: boolean[] } = {},
): SetLog[] {
  const head = baseLog(id, sessionId, exerciseId, o)
  const stages: SetLog[] = []
  for (let d = 1; d <= (o.drops ?? 0); d++) {
    stages.push({
      ...baseLog(`${id}.${d}`, sessionId, exerciseId, { skipped: o.stageSkipped?.[d - 1] ?? false }),
      isDropset: true,
      parentSetId: id,
      stageIndex: d,
    })
  }
  return [head, ...stages]
}

/** A stage row on its own, under a parent: what a drop logged under a skipped head looks like. */
export function logStage(id: string, sessionId: string, exerciseId: string, parentId: string, stageIndex = 1): SetLog {
  return { ...baseLog(id, sessionId, exerciseId, {}), isDropset: true, parentSetId: parentId, stageIndex }
}

/** A dropset row with no parent: an orphan, which stands as a head of its own. */
export function orphanDropset(id: string, sessionId: string, exerciseId: string): SetLog {
  return { ...baseLog(id, sessionId, exerciseId, {}), isDropset: true }
}

/** A session (a real `Session` with its logs) plus the changes volumeRows reads off it. */
export function session(
  id: string,
  planId: string | null,
  status: SessionStatus,
  logs: SetLog[] = [],
  opts: { changes?: SessionSetChange[]; date?: string } = {},
): Session & Pick<VolumeSession, 'sessionSetChanges'> {
  return {
    id,
    userId: 'u1',
    mesocycleId: 'm1',
    weekPlanId: planId,
    workoutDayId: planId === null ? null : `wd-${planId}`,
    date: opts.date ?? '2026-10-05',
    status,
    note: null,
    startedAt: status === 'planned' ? null : '2026-10-05T18:00:00Z',
    completedAt: status === 'completed' ? '2026-10-05T19:00:00Z' : null,
    createdAt: '2026-10-05T00:00:00Z',
    energyRating: null,
    pumpRating: null,
    setLogs: logs,
    ...(opts.changes ? { sessionSetChanges: opts.changes } : {}),
  }
}

/** Freezes a value and everything inside it: a function handed this can read it and nothing else. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const inner of Object.values(value)) deepFreeze(inner)
  }
  return value
}
