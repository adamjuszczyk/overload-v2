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
  // v2_week_plan_exercises (chunk 7, TASKS.md "Each planned session owns
  // its exercise list") — this week's own exercise list (serialised
  // ProgramExercise[] with joined exercise data, same shape as
  // CachedWorkoutDay.exercises above), primed by offlineCache.ts alongside
  // sets. Plain field, not an index — same no-version-bump precedent as
  // stageIndex/isWarmup/setSeconds/enteredUnit on CachedSetLog below. A row
  // cached before this shipped won't have it; readers must treat it as
  // absent (undefined), not crash, and fall back to CachedWorkoutDay's own
  // program-exercises list.
  exercises?: unknown
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
  // v3 Coach Personalization phase 1 — plain fields, not indexes, same
  // no-version-bump precedent as stageIndex/isWarmup/setSeconds/enteredUnit
  // below. Rows cached before this shipped won't have them; readers must
  // treat undefined as null, same rule as those fields.
  energyRating: string | null
  pumpRating: string | null
  // Chunk 24 — plain field, not an index, same no-version-bump precedent.
  // Only ever set by useCreateSession's offline branch ("Do it now" —
  // SPEC); a row cached before this shipped won't have it, same "undefined
  // reads as null" rule as the other fields on this interface.
  movedToDate?: string | null
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
  stageIndex: number
  isWarmup: boolean
  setSeconds: number | null
  enteredUnit: string | null
  isSkipped: boolean
  loggedAt: string
  restSeconds: number | null
  // Status of the session this log belongs to, at time of caching — lets the
  // offline "last session" fallback exclude the current in-progress session.
  sessionStatus: string
  // v3 Coach Personalization phase 1 — plain field, not an index, same
  // no-version-bump precedent as stageIndex/isWarmup/setSeconds/enteredUnit
  // above. Rows cached before this shipped won't have it; readers must
  // treat undefined as null, same rule as those fields.
  formRating: string | null
  // Chunk 14 — heads only (TASKS.md "Logging": "as planned"). Same
  // no-version-bump precedent as formRating above: rows cached before this
  // shipped won't have it; readers must treat undefined as null.
  stageKind: string | null
}

interface SyncQueueItem {
  id?: number // auto-increment
  table: string
  operation: 'upsert' | 'delete'
  payload: unknown
  createdAt: string
  attempts?: number // failed replay attempts — dead-lettered after 3
  // A session finish queued offline (useCompleteSession). Its status and
  // completed_at are re-derived from the server's set logs when it is replayed,
  // after the sets queued before it have been sent (B3). Plain field, not an
  // index: no schema bump, and items queued before this shipped lack it.
  recomputeFinish?: boolean
  // Set once `attempts` reaches MAX_SYNC_ATTEMPTS (useSyncQueue.ts): the item
  // is no longer retried on its own but stays queued, holding back later
  // writes to its record, until the user taps retry. Plain field, no bump.
  gaveUp?: boolean
  // Chunk 57 (G47). Set just before an upsert is first sent, and again when a
  // retry resets a write that gave up: from then on the server may already
  // hold the row (a reply lost on a locked phone), so a later delete of that
  // row is sent after it instead of cancelling against it. An item without it
  // and without `attempts` was never sent. Plain field, no bump.
  sendStarted?: boolean
  // Chunk 57. A `delete` item's payload is only `{ id }` (the whole request is
  // `delete().eq('id', id)`), so what an upsert's payload says about where it
  // belongs is kept beside it: the session it belongs to (the finish waits for
  // it, the "couldn't sync" notice is shown on its screen) and, for a stage
  // log, the head it hangs under (the head's delete waits for it). Plain
  // fields, no bump; written by `queueSetLogDelete` only.
  sessionId?: string
  parentSetId?: string
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
    // v3 §2.1 — dropset grouping needs to look rows up by parentSetId (the
    // reference-panel offline fallback groups stages under their head).
    // stageIndex/isWarmup/setSeconds/enteredUnit are new plain fields, not
    // indexes — no schema bump needed for those, just the added columns.
    // Rows cached by the v2 client before this bump won't have them; readers
    // must treat stageIndex === undefined as 0, not crash.
    this.version(2).stores({
      set_logs: 'id, sessionId, exerciseId, loggedAt, parentSetId',
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
