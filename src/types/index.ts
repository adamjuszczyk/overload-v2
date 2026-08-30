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

// The two stored values (exercises.status, migration 019, not null default
// 'active') — every real row is one or the other, never both, never neither
// (EXERCISE-LIBRARY-TASKS.md §2.3/§7.1).
export type ExerciseStatus = 'active' | 'lost'

// All three real-world states, including 'gone' — a hard-deleted row has no
// row left to carry a status, so 'gone' is a value the *type* layer can name
// (a delete-preview result, e.g.) that the *column* never holds
// (EXERCISE-LIBRARY-TASKS.md §0.3/§7.1).
export type ExerciseLifecycle = ExerciseStatus | 'gone'

export interface Exercise {
  id: string
  userId: string
  name: string
  muscleGroup: MuscleGroup
  isArchived: boolean
  createdAt: string
  // exercises.muscle_subgroup / .movement_pattern (migration 013), surfaced
  // here so the editing UI (EXERCISE-LIBRARY-TASKS.md §8 step 5) can read an
  // exercise's current tags the same way it reads muscleGroup — same null =
  // untagged convention ExerciseTags below already uses.
  muscleSubgroups: MuscleSubgroup[] | null
  movementPattern: MovementPattern | null
  // exercises.status / .source_library_id / .lost_at (migration 019,
  // EXERCISE-LIBRARY-TASKS.md §7.2/§8 step 7) — the Lost Exercises lifecycle
  // and library provenance. sourceLibraryId is null for a hand-created
  // exercise; lostAt is null exactly when status is 'active'.
  status: ExerciseStatus
  sourceLibraryId: string | null
  lostAt: string | null
}

// ─── Exercise Library ─────────────────────────────────────────────────────────
// v2_exercise_libraries / v2_exercise_library_items (migration 019,
// EXERCISE-LIBRARY-TASKS.md §2.1/§2.2). Global, curated catalogs — no
// userId, read-only to the app. A library previews its items and can be
// downloaded; downloading copies each item into the user's own `exercises`
// (§8 step 6).

export interface ExerciseLibrary {
  id: string
  slug: string
  name: string
  description: string | null
  isListed: boolean
  position: number
}

export interface ExerciseLibraryItem {
  id: string
  libraryId: string
  name: string
  muscleGroup: MuscleGroup
  muscleSubgroup: MuscleSubgroup[] | null
  movementPattern: MovementPattern | null
  position: number
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

  // Optional, once per completed session (COACH-PERSONALIZATION-SPEC §4/§5)
  // — required keys, nullable types, same "absence is data too" reasoning as
  // SetLog.formRating above. 'none' (rated, no energy/pump) is distinct from
  // null (not rated) — TASKS §7.3.
  energyRating: EnergyRating | null
  pumpRating: PumpRating | null
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

  // Optional, per-set (COACH-PERSONALIZATION-SPEC §4/§5) — required key,
  // nullable type: null = not rated, never a default (§7 "absence is data
  // too"). Forces every SetLog mapper to say what it produces (v3
  // Personalization TASKS §4.1) rather than silently defaulting to null.
  formRating: FormRating | null
}

// ─── Coach Personalization ratings (v3, phase 1) ───────────────────────────
// Vocabularies fixed by COACH-PERSONALIZATION-SPEC §4, confirmed by Adam
// before build (2026-08-25) — see COACH-PERSONALIZATION-TASKS.md §2.1/§7.11.
// A rated 'none' (energy/pump) is a real signal, not the same as an unrated
// NULL — see that doc's §7.3.

export type FormRating = 'rushed' | 'normal' | 'controlled' | 'extra_controlled'
export type EnergyRating = 'none' | 'low' | 'normal' | 'high' | 'supreme'
export type PumpRating = 'none' | 'some' | 'good' | 'extreme'

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

// ─── Coach Notes (Personalization phase 3) ─────────────────────────────────
// Raw, freeform, timestamped input — deliberately not the same thing as
// Coach Memory (COACH-PERSONALIZATION-SPEC.md §4). sessionId is set for a
// sidebar-sourced note, null for a general (Context tab) one. curatedAt is
// the phase-4 curation watermark — null means "never seen by a curation
// run" (not yet built; always null for every note through phase 3).
export interface CoachNote {
  id: string
  userId: string
  body: string
  sessionId: string | null
  curatedAt: string | null
  createdAt: string
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

// ─── Coach Memory (Personalization phase 4) ────────────────────────────────
// A separate, curated, standing store the daily analysis prompt reads in
// full (COACH-PERSONALIZATION-SPEC.md §4) — never the same rows as
// v2_coach_notes (TASKS §9.2): curation reads notes and writes memory, a
// note's own body is never rewritten.

export type MemoryEntrySource = 'curation' | 'manual'
export type MemoryEntryStatus = 'active' | 'expired'

// Row shape for v2_coach_memory_entries (migration 018). `source` is
// provenance, not permission — curation may update or expire any entry
// regardless of source (TASKS §2.7). The user's own delete is a hard
// delete; only curation's expire is soft (TASKS §9.4) — there is
// deliberately no "deleted" status here, only 'active'/'expired'.
export interface CoachMemoryEntry {
  id: string
  userId: string
  body: string
  source: MemoryEntrySource
  status: MemoryEntryStatus
  createdAt: string
  updatedAt: string
}

// One uncurated note as the curation call sees it (§5.3 step 3). `session`
// is present only for a sidebar-sourced note, so the model can place it in
// time — read from v2_history_session_summary, the same denormalised
// date/workoutDayName coachService.ts's AnalyzableSession already uses.
export interface CurationNoteInput {
  id: string
  body: string
  createdAt: string
  session: { date: string; workoutDayName: string | null } | null
}

// One active memory entry as the curation call sees it (§5.3 step 5).
export interface CurationMemoryInput {
  id: string
  body: string
  source: MemoryEntrySource
}

// Exactly what the model is shown — persisted verbatim as
// v2_coach_curation_runs.input_snapshot, same "what did the model actually
// see" reasoning as AnalysisInput/WeekAnalysisInput (§3.3, daily §5.11).
export interface CurationInput {
  notes: CurationNoteInput[]
  memory: CurationMemoryInput[]
}

// What the model returns — one decision per note it chose to act on (never
// one-per-note structurally; zero, one, or several notes may collapse into
// a single decision, or produce none at all). Applied by code, never by the
// model (§2.8): only ids present in `memory` above may appear in an
// `update`/`expire`, enforced by curationApply.ts's planCurationApply
// regardless of what the model returns (§5.3 step 7).
export type CurationDecision =
  | { op: 'add'; body: string; reason: string }
  | { op: 'update'; id: string; body: string; reason: string }
  | { op: 'expire'; id: string; reason: string }

// The model's response shape before it becomes a real CurationDecision — the
// structured-output schema can't express "id/body required iff op is
// update/add" as a TypeScript discriminated union, so `id`/`body` are
// required-but-nullable regardless of `op`, and a row whose fields don't
// match its own `op` (e.g. `update` with a null id) is dropped rather than
// coerced. This is genuinely what got stored/returned (see
// v2_coach_curation_runs.decisions below), so it needs its own type rather
// than force-fitting CurationDecision.
export interface CurationRawDecision {
  op: string
  id: string | null
  body: string | null
  reason: string
}

// What code actually did with the model's decisions, after id validation —
// distinct from the raw CurationDecision[] the model returned (that list is
// stored unfiltered in v2_coach_curation_runs.decisions; this is
// v2_coach_curation_runs.applied) so a run row can always answer both "what
// did the model say" and "what actually happened", independently. This is a
// refinement of TASKS §4.4's single `decisions` field on CurationResult —
// deliberate, since §4.4 itself is marked "shape settled, detail deferred"
// and §5.3 step 11's literal return value is `{ applied, rejectedIds,
// notesCurated }`, not `{ decisions, ... }`.
export interface CurationApplied {
  added: { id: string; body: string }[]
  updated: { id: string; body: string }[]
  expired: { id: string }[]
}

// The api/coach/curate-memory.ts response body (§5.3 step 11), also what
// v2_coach_curation_runs.applied plus the two summary fields represent
// together.
export interface CurationResult {
  applied: CurationApplied
  // Ids the model referenced that were not in the `memory` it was sent.
  // Dropped, never applied — same defence WeekAnalysisDetail.tsx already
  // applies to hallucinated exerciseIds.
  rejectedIds: string[]
  notesCurated: number
}

// Row shape for v2_coach_curation_runs (migration 018). The one table in
// this plan the spec doesn't name (TASKS §7.6) — provenance for a process
// that mutates a standing store instead of appending a permanent record,
// same reasoning that put input_snapshot/model/prompt_version/token counts
// on the other two AI surfaces (daily §5.11).
export interface CoachCurationRun {
  id: string
  userId: string
  inputSnapshot: CurationInput
  // Genuinely the raw, unfiltered model output (CurationRawDecision[], not
  // CurationDecision[]) — including any row toDecisions() dropped for not
  // matching its own op (e.g. an `update` with a null id). Fixed to actually
  // be unfiltered during this project's phase-4 adversarial review: it
  // previously stored the post-toDecisions *filtered* list, silently
  // contradicting this exact comment — a dropped decision left no trace
  // anywhere (not here, not in rejectedIds, since it never reached
  // planCurationApply). `applied` below is the filtered, validated record of
  // what code actually did with it.
  decisions: CurationRawDecision[]
  applied: CurationApplied
  model: string
  promptVersion: number
  inputTokens: number | null
  outputTokens: number | null
  noteCount: number
  createdAt: string
}
