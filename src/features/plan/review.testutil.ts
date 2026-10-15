// Builders shared by review's tests (chunk 43): full app-typed rows (`WeekPlan`, `WeekPlanSet`, `Session`,
// `SetLog`, `ProgramExercise`), so typecheck proves the real types fit the module's inputs without a cast,
// with the defaults a plain working set has, so a test states only what its rule reads. Not a test file
// (Vitest's include is *.test.ts) and imported by nothing in the app.

import type { ProgramExercise, Session, SessionSetChange, SessionStatus, SetLog, WeekPlan, WeekPlanSet, WorkoutDay } from '../../types'
import { pe, plan, wset } from './weekPlanning.testutil'
import { reviewItems, type ReviewGroup, type ReviewInput, type ReviewLog, type ReviewSwap, type ReviewWrite } from './review'

export { stage, wset } from './weekPlanning.testutil'

// A program exercise row of a plan, with a readable name.
export function row(id: string, exerciseId: string, position: number, name: string, over: Partial<ProgramExercise> = {}): ProgramExercise {
  const base = pe(id, exerciseId, position, over)
  return { ...base, exercise: base.exercise ? { ...base.exercise, name } : undefined }
}

// A workout day, for a plan row or a session that carries its name.
export const workoutDay = (id: string, name: string): WorkoutDay => ({ id, programId: 'p', userId: 'u', name, position: 1, exercises: [] })

// A week plan row of one workout: `wp-<key>-<week>` on workout `wd-<key>`.
export function weekPlan(key: string, weekNumber: number, exercises: ProgramExercise[], sets: WeekPlanSet[], over: Partial<WeekPlan> = {}): WeekPlan {
  return plan(weekNumber, exercises, sets, { id: `wp-${key}-${weekNumber}`, workoutDayId: `wd-${key}`, ...over })
}

// This week's plan row of the same workout as `last`: the same exercise rows (the run copy's), its own set rows.
export function mirrorWeek(last: WeekPlan, over: Partial<WeekPlan> = {}): WeekPlan {
  const weekNumber = last.weekNumber + 1
  const next = (id: string) => `${id}@${weekNumber}`
  return {
    ...last,
    id: next(last.id),
    weekNumber,
    sets: last.sets.map((s) => ({
      ...s,
      id: next(s.id),
      weekPlanId: next(last.id),
      parentWeekPlanSetId: s.parentWeekPlanSetId === null ? null : next(s.parentWeekPlanSetId),
    })),
    ...over,
  }
}

type SessionWithRecords = Session & { swaps: ReviewSwap[]; sessionSetChanges: SessionSetChange[] }

export function session(
  id: string,
  weekPlanId: string | null,
  status: SessionStatus,
  setLogs: SetLog[],
  over: Partial<SessionWithRecords> = {},
): SessionWithRecords {
  return {
    id,
    userId: 'u',
    mesocycleId: 'm',
    weekPlanId,
    workoutDayId: 'wd-1',
    date: '2026-10-05',
    status,
    note: null,
    startedAt: null,
    completedAt: null,
    createdAt: '',
    energyRating: null,
    pumpRating: null,
    setLogs,
    swaps: [],
    sessionSetChanges: [],
    ...over,
  }
}

// A logged set: 100 kg × 8 at RIR 2 unless said otherwise, linked to its planned set when `planned` is given.
export function setLog(id: string, sessionId: string, exerciseId: string, over: Partial<SetLog> = {}): SetLog {
  return {
    id,
    userId: 'u',
    sessionId,
    exerciseId,
    weekPlanSetId: null,
    setNumber: 1,
    weight: 100,
    reps: 8,
    rir: 2,
    note: null,
    isDropset: false,
    parentSetId: null,
    stageIndex: 0,
    isWarmup: false,
    setSeconds: null,
    enteredUnit: null,
    isSkipped: false,
    loggedAt: '2026-10-05T18:00:00.000Z',
    restSeconds: null,
    formRating: null,
    ...over,
  }
}

// A drop logged under a head log.
export function dropLog(id: string, sessionId: string, exerciseId: string, parent: string, stageIndex: number, over: Partial<SetLog> = {}): SetLog {
  return setLog(id, sessionId, exerciseId, { parentSetId: parent, isDropset: true, stageIndex, rir: 0, ...over })
}

export const swapRecord = (over: Partial<ReviewSwap> = {}): ReviewSwap => ({
  programExerciseId: 'pe-1',
  originalExerciseId: 'ex-1',
  originalExerciseName: 'Original',
  replacementExerciseId: 'ex-r',
  replacementExerciseName: 'Replacement',
  ...over,
})

// Last week's plan(s) and sessions against this week's: week N − 1 is last week, this week mirrors it unless
// `thisWeek` is given. The usual one-workout case, in one call.
export function review(args: {
  last: WeekPlan[]
  sessions: SessionWithRecords[]
  thisWeek?: WeekPlan[]
  weekNumber?: number
  decisions?: ReviewInput['decisions']
  extra?: Partial<ReviewInput>
}): ReviewGroup[] {
  const weekNumber = args.weekNumber ?? args.last[0].weekNumber + 1
  return reviewItems({
    weekNumber,
    lastWeek: { sessions: args.sessions, plan: args.last },
    thisWeek: args.thisWeek ?? args.last.map((p) => mirrorWeek(p)),
    decisions: args.decisions ?? [],
    ...args.extra,
  })
}

// A plan with `writes` applied the way the database applies them: updates patch the row, inserts add a
// full row, a delete takes the row and, by the foreign key, its stages. `program_edit` writes are not
// sets and are left to CHANGE THE PROGRAM (chunk 45).
export function applyWrites(plan: WeekPlan, writes: ReviewWrite[]): WeekPlan {
  let sets: WeekPlanSet[] = [...plan.sets]
  for (const write of writes) {
    if (write.kind === 'update_set') {
      sets = sets.map((s) => (s.id === write.setId ? { ...s, ...write.changes } : s))
    } else if (write.kind === 'insert_set') {
      const r = write.set
      sets.push({
        id: r.id,
        weekPlanId: r.weekPlanId,
        userId: 'u',
        programExerciseId: r.programExerciseId,
        setNumber: r.setNumber,
        targetRir: r.targetRir,
        targetRirMax: r.targetRirMax,
        isDropset: r.isDropset,
        parentWeekPlanSetId: r.parentWeekPlanSetId,
        stageIndex: r.stageIndex,
        isWarmup: r.isWarmup,
        stageKind: r.stageKind,
        programSetId: r.programSetId,
        targetWeight: r.targetWeight,
        repMin: r.repMin,
        repMax: r.repMax,
        isAmrap: r.isAmrap,
        tags: r.tags,
      })
    } else if (write.kind === 'delete_set') {
      sets = sets.filter((s) => s.id !== write.setId && s.parentWeekPlanSetId !== write.setId)
    }
  }
  return { ...plan, sets }
}

// The items of every group, flat, as [kind, key] pairs: what most rules assert on.
export const kinds = (groups: ReviewGroup[]): string[] => groups.flatMap((g) => g.items.map((e) => e.item.kind))
export const keysOf = (groups: ReviewGroup[]): string[] => groups.flatMap((g) => g.items.map((e) => e.key))

// Freezes an input all the way down, so a function that mutates it throws (ES modules are strict).
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v)
  }
  return value
}

// One workout with one exercise and `n` working sets planned at `weight` × `reps`, RIR 2 — set ids `ps-<peId>-<i>`.
export function oneExerciseWeek(
  key: string,
  weekNumber: number,
  n: number,
  over: Partial<WeekPlanSet> = {},
  exercise: { peId?: string; exerciseId?: string; name?: string } = {},
): WeekPlan {
  const peId = exercise.peId ?? 'pe-1'
  const exerciseId = exercise.exerciseId ?? 'ex-1'
  const sets = Array.from({ length: n }, (_, i) => wset(`ps-${peId}-${i + 1}`, peId, i + 1, over))
  return weekPlan(key, weekNumber, [row(peId, exerciseId, 1, exercise.name ?? 'Bench Press')], sets)
}

export type { ReviewLog }
