import Dexie, { type Table } from 'dexie'

// ─── Cached entity shapes ─────────────────────────────────────────────────────
// Mirrors the Supabase rows needed offline. Populated in Phase 9.

interface CachedExercise {
  id: string
  userId: string
  name: string
  muscleGroup: string | null
  isArchived: boolean
}

interface CachedWorkoutDay {
  id: string
  programId: string
  name: string
  position: number
  exercises: unknown // serialised ProgramExercise[] with joined exercise data
}

interface CachedWeekPlan {
  id: string
  mesocycleId: string
  workoutDayId: string
  weekNumber: number
  isDeload: boolean
  sets: unknown // serialised WeekPlanSet[]
}

interface CachedSession {
  id: string
  userId: string
  date: string
  status: string
  mesocycleId: string | null
  weekPlanId: string | null
  workoutDayId: string | null
  note: string | null
  startedAt: string | null
  completedAt: string | null
}

interface CachedSetLog {
  id: string
  sessionId: string
  exerciseId: string
  weekPlanSetId: string | null
  setNumber: number
  weight: number | null
  reps: number | null
  rir: number | null
  note: string | null
  isDropset: boolean
  parentSetId: string | null
  isSkipped: boolean
  loggedAt: string
  restSeconds: number | null
  // Status of the session this log belongs to, at time of caching — lets the
  // offline "last session" fallback exclude the current in-progress session.
  sessionStatus: string
}

interface SyncQueueItem {
  id?: number // auto-increment
  table: string
  operation: 'upsert' | 'delete'
  payload: unknown
  createdAt: string
  attempts?: number // failed replay attempts — dead-lettered after 3
}

// ─── Database ─────────────────────────────────────────────────────────────────

class OverloadV2DB extends Dexie {
  exercises!: Table<CachedExercise, string>
  workout_days!: Table<CachedWorkoutDay, string>
  week_plans!: Table<CachedWeekPlan, string>
  sessions!: Table<CachedSession, string>
  set_logs!: Table<CachedSetLog, string>
  sync_queue!: Table<SyncQueueItem, number>

  constructor() {
    super('overload-v2')
    this.version(1).stores({
      exercises:    'id, userId, muscleGroup',
      workout_days: 'id, programId',
      week_plans:   'id, mesocycleId, workoutDayId, weekNumber',
      sessions:     'id, userId, date, status, mesocycleId, weekPlanId',
      set_logs:     'id, sessionId, exerciseId, loggedAt',
      sync_queue:   '++id, createdAt',
    })
  }
}

export const db = new OverloadV2DB()
export type {
  CachedExercise,
  CachedWorkoutDay,
  CachedWeekPlan,
  CachedSession,
  CachedSetLog,
  SyncQueueItem,
}
