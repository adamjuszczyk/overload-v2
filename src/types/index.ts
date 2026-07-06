// ─── Enums ────────────────────────────────────────────────────────────────────

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps'
  | 'forearms' | 'quads' | 'hamstrings' | 'glutes' | 'calves'
  | 'core' | 'other'

export type DayOfWeek =
  | 'monday' | 'tuesday' | 'wednesday' | 'thursday'
  | 'friday' | 'saturday' | 'sunday'

export type SessionStatus = 'planned' | 'in_progress' | 'completed' | 'skipped'
export type MesocycleStatus = 'active' | 'completed'
export type WeightUnit = 'kg' | 'lbs'

// ─── Exercise ─────────────────────────────────────────────────────────────────

export interface Exercise {
  id: string
  userId: string
  name: string
  muscleGroup: MuscleGroup
  isArchived: boolean
  createdAt: string
}

// ─── Program ──────────────────────────────────────────────────────────────────

export type WeeklySchedule = Record<DayOfWeek, string | null>

// Layer 1: program stores exercises + optional rep suggestion only.
// Sets and RIR targets live in WeekPlan (Layer 2).
export interface ProgramExercise {
  id: string
  workoutDayId: string
  userId: string
  exerciseId: string
  exercise?: Exercise        // joined when loading the full day
  position: number           // 0-based
  targetReps: number | null  // suggestion only — never enforced
}

export interface WorkoutDay {
  id: string
  programId: string
  userId: string
  name: string
  position: number
  exercises: ProgramExercise[]
}

export interface Program {
  id: string
  userId: string
  name: string
  schedule: WeeklySchedule   // { monday: workoutDayId | null, ... }
  workoutDays: WorkoutDay[]
  createdAt: string
  updatedAt: string
}

// ─── Mesocycle ────────────────────────────────────────────────────────────────

export interface Mesocycle {
  id: string
  userId: string
  name: string
  programId: string
  program?: Program
  status: MesocycleStatus
  startDate: string          // ISO date
  endDate: string | null     // set when status → 'completed'
  createdAt: string
}

// ─── Weekly Plan (Layer 2) ────────────────────────────────────────────────────

// One WeekPlan per workout day per week of a meso.
// The bridge between the program template and the actual session.
export interface WeekPlan {
  id: string
  userId: string
  mesocycleId: string
  workoutDayId: string
  workoutDay?: WorkoutDay    // joined for gym UI
  weekNumber: number         // 1-based within the meso
  isDeload: boolean
  notes: string | null
  sets: WeekPlanSet[]        // all planned sets for all exercises in this session
  createdAt: string
}

// One WeekPlanSet per planned set per exercise.
// References programExerciseId to inherit exercise identity and ordering.
export interface WeekPlanSet {
  id: string
  weekPlanId: string
  userId: string
  programExerciseId: string
  programExercise?: ProgramExercise  // joined for gym UI / plan builder display
  setNumber: number          // 1-based, per exercise within this plan
  targetRir: number | null
  isDropset: boolean
}

// ─── Session (Layer 3 — what actually happened) ───────────────────────────────

export interface Session {
  id: string
  userId: string
  mesocycleId: string | null
  weekPlanId: string | null  // null when no WeekPlan exists for this week
  weekPlan?: WeekPlan        // joined for gym UI
  workoutDayId: string | null
  workoutDay?: WorkoutDay    // joined for gym UI
  date: string               // ISO date — the date this session is *for*
  status: SessionStatus
  note: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  setLogs?: SetLog[]         // populated on full session load
}

// ─── SetLog ───────────────────────────────────────────────────────────────────

export interface SetLog {
  id: string
  userId: string
  sessionId: string
  exerciseId: string
  exercise?: Exercise

  // Links actual set back to its plan target.
  // Null for sets beyond the plan or sessions without a WeekPlan.
  weekPlanSetId: string | null

  setNumber: number          // 1-based, per exercise within this session
  weight: number | null      // null only when isSkipped = true
  reps: number | null        // null only when isSkipped = true
  rir: number | null
  note: string | null

  // Dropset grouping:
  // A planned dropset:      isDropset=true, weekPlanSetId → planned dropset row
  // A spontaneous dropset:  isDropset=true, weekPlanSetId=null, parentSetId set
  isDropset: boolean
  parentSetId: string | null

  isSkipped: boolean
  loggedAt: string           // ISO timestamp — source of truth for rest time
  restSeconds: number | null
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

// Two 'suggest' variants: plan exists vs no plan for this week yet.
export type SchedulerResult =
  | { type: 'no_program' }
  | { type: 'no_active_meso' }
  | { type: 'active_session';    session: Session }
  | { type: 'completed_today';   session: Session }
  | { type: 'suggest_from_plan'; weekPlan: WeekPlan; date: string }
  | { type: 'suggest_no_plan';   workoutDay: WorkoutDay; date: string }
  | { type: 'rest_day' }
  | { type: 'missed_sessions';   queue: MissedSession[] }

export interface MissedSession {
  date: string               // ISO date the session was originally for
  weekPlan: WeekPlan | null  // null if no WeekPlan exists for that week
  workoutDay: WorkoutDay
  existingSessionId: string | null
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export interface UserSettings {
  theme: 'dark' | 'light'
  accentColour: string       // CSS colour value — applied to --accent
  restTimerEnabled: boolean
  buzzOnRestComplete: boolean
  targetRestSeconds: number
  weightUnit: WeightUnit
}
