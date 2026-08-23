import type { AnalysisInput } from '../features/coach/analysisInput'
import type { WeekAnalysisInput } from '../features/coach/weekAnalysisInput'

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
  weightUnit: WeightUnit | null  // null = inherit v2_user_settings.weightUnit (v3 §2.4)
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

  // Dropset grouping (v3 §2.1) — same relational shape as SetLog below.
  parentWeekPlanSetId: string | null
  stageIndex: number         // 0 = head (main stage), 1.. = stage order

  isWarmup: boolean          // never enters e1RM/volume/reference; no authoring UI yet (v3 §2.5)
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
  stageIndex: number         // 0 = head (main stage), 1.. = stage order (v3 §2.1)

  isWarmup: boolean          // never enters e1RM/volume/reference; no logging UI yet (v3 §2.5)
  setSeconds: number | null  // duration of the set itself; null = not measured (v3 §2.2)
  enteredUnit: WeightUnit | null  // what the user actually typed at log time (v3 §2.4)

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
  autoFinishMinutes: number | null  // null = auto-finish disabled
  measureSetTime: boolean    // global Start Set toggle (v3 §2.2 / SPEC §4.2)
}

// ─── Coach (Daily Session Analysis) ────────────────────────────────────────────

export type TrainingPhase = 'cut' | 'bulk' | 'maintain'

export interface PhaseEntry {
  id: string
  userId: string
  phase: TrainingPhase
  startDate: string          // ISO date
  createdAt: string
}

// Derived at read time — never stored (COACH-ANALYSIS-SPEC §5: no end-date field).
export interface ResolvedPhase extends PhaseEntry {
  endDate: string | null     // next entry's startDate − 1 day; null = current
  durationDays: number       // as of the date being resolved against
}

export type WeightEntryKind = 'daily' | 'weekly_average'

export interface WeightEntry {
  id: string
  userId: string
  entryDate: string          // ISO date. For 'weekly_average', the Monday of
                              // the week it represents (COACH-ANALYSIS-TASKS §5.2)
  weightKg: number
  kind: WeightEntryKind
  createdAt: string
}

// Computed, never stored (COACH-ANALYSIS-SPEC §8: "never destroy raw data").
export interface WeeklyWeightAverage {
  weekStart: string              // Monday, ISO date
  averageKg: number
  source: 'manual' | 'daily'     // which rule produced it (COACH-ANALYSIS-TASKS §5.3)
  dailyCount: number             // 0 when source === 'manual'
}

export interface CoachExerciseComment {
  exerciseId: string
  exerciseName: string       // denormalised at generation time — an exercise
                              // rename/archive later must not rewrite this record
  comment: string             // prose — reasons about *why*, per SPEC §5/§8
}

export interface CoachAnalysisContent {
  exercises: CoachExerciseComment[]
  overall: string              // SPEC §5's short overall session read
}

// Row shape for v2_coach_session_analyses (migration 012).
export interface CoachSessionAnalysis {
  id: string
  userId: string
  sessionId: string
  content: CoachAnalysisContent
  inputSnapshot: AnalysisInput   // exactly what the model was shown (§5.11)
  model: string                  // response.model, e.g. 'claude-haiku-4-5-20251001'
  promptVersion: number
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
}

// ─── Coach (Weekly Analysis) ────────────────────────────────────────────────
// exercises.muscle_subgroup / .movement_pattern (migration 013). Both nullable
// — an exercise with neither is untagged and falls back to muscleGroup for
// bucketing (COACH-WEEK-ANALYSIS-SPEC.md §5).

// DB-enforced vocabulary (013's CHECK) — exactly SPEC §4's seven values.
export type MovementPattern =
  | 'horizontal_push' | 'vertical_push'
  | 'horizontal_pull' | 'vertical_pull'
  | 'hip_hinge' | 'squat' | 'isolation'

// Deliberately NOT a union type: the subgroup vocabulary is app-layer only
// (COACH-WEEK-ANALYSIS-TASKS.md §7.10), so a value the app doesn't recognise
// must degrade to "an unfamiliar bucket label", never a type error or a
// dropped occurrence.
export type MuscleSubgroup = string

export interface ExerciseTags {
  exerciseId: string
  exerciseName: string
  muscleGroup: MuscleGroup | null
  muscleSubgroups: MuscleSubgroup[] | null   // null = untagged (never [])
  movementPattern: MovementPattern | null
}

// Two values, not three: which axis a bucket lives on. Whether a
// muscle_subgroup-axis bucket used a real tag or fell back to the coarse
// muscleGroup column is carried by WeekAnalysisBucket.isFallback below, not
// by a third kind value — a bucket's kind and its fallback status would
// otherwise say the same thing twice for every subgroup-axis bucket.
export type WeekBucketKind = 'muscle_subgroup' | 'movement_pattern'

export interface WeekAnalysisBucket {
  key: string                       // e.g. 'subgroup:side_delt', 'pattern:horizontal_push'
  kind: WeekBucketKind
  label: string                     // e.g. 'side_delt'
  // true when at least one occurrence here landed via the muscleGroup
  // fallback rather than a real muscle_subgroup tag (SPEC §5). Only
  // meaningful for kind === 'muscle_subgroup' — a movement_pattern bucket
  // has no fallback path at all (no tags row means absent from this axis
  // entirely, not present-with-fallback — see §7.9).
  isFallback: boolean
  occurrenceIds: string[]
}

// Output shape (COACH-WEEK-ANALYSIS-TASKS.md §3.2) — a small, selective set
// of highlights (SPEC §5), never one per bucket. `bucketKind` includes
// 'cross' (not in WeekBucketKind) deliberately — SPEC §1's whole point is
// reading a pattern *across* buckets ("bench down, fly up"), which by
// definition doesn't live in one.
export interface CoachWeekHighlight {
  bucketKind: WeekBucketKind | 'cross'
  bucketLabel: string
  // Filtered at render time against the payload's real ids — a
  // hallucinated id is dropped from the deep links, never fails the
  // render (mirrors AnalysisDetail.tsx's existing precedent).
  exerciseIds: string[]
  headline: string
  comment: string
}

export interface CoachWeekAnalysisContent {
  highlights: CoachWeekHighlight[]
  overall: string
}

// Row shape for v2_coach_week_analyses (migration 013).
export interface CoachWeekAnalysis {
  id: string
  userId: string
  weekStart: string
  content: CoachWeekAnalysisContent
  inputSnapshot: WeekAnalysisInput   // exactly what the model was shown
  model: string                      // response.model, not the request constant
  promptVersion: number              // WEEK_PROMPT_VERSION, independent of daily's
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
}
