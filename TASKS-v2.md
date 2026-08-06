# Overload v2 — Technical Planning

**Status:** Draft — awaiting approval before implementation begins
**Spec version:** 2.0 — read Overload-v2-SPEC.md before editing this file

---

## 1. Tech Stack

Same base as v1. No package changes anticipated for core functionality.

| Layer | Choice |
|---|---|
| **Framework** | React 19 + TypeScript 5.7 |
| **Build tool** | Vite 6 + `@vitejs/plugin-react` |
| **Routing** | React Router DOM v6 |
| **Server state** | TanStack Query v5 |
| **UI state** | Zustand v5 |
| **Styling** | Tailwind CSS v4 + **`tokens.css`** (CSS custom properties for all colours) |
| **Database / Auth** | Supabase JS v2 — same project and credentials as v1 |
| **Offline storage** | Dexie v4 (IndexedDB) |
| **PWA** | vite-plugin-pwa + Workbox |
| **Charts** | Recharts v3 |
| **Date handling** | date-fns v4 |
| **Icons** | Lucide React |

**v2 additions and constraints:**

- `src/styles/tokens.css` — single source of truth for all colour values as CSS custom properties. Imported once in `main.tsx`. No component imports it directly.
- `--accent` CSS custom property drives all accent colour usage. Default: `#FF8C42`. User-switchable in Settings. Never hardcode the accent value in any component.
- `--base`, `--surface`, `--surface-raised`, `--text-primary`, `--text-secondary`, `--border` etc. all live in `tokens.css`. No Tailwind colour utilities that reference raw hex values in components.
- `tokens.css` is structured so a future `[data-theme="light"]` block can override all variables with zero component changes.

---

## 2. Supabase Schema

All v2 tables are prefixed `v2_` to coexist cleanly with v1 tables on the same project. Exception: v2 reads from and writes to the existing `exercises` table — no separate exercise table is created for v2.

### 2.1 Tables

#### `exercises` (existing table — column addition only)

v2 reuses `exercises` directly. The only schema change required is adding `muscle_group` if it is not already present:

```sql
alter table exercises add column if not exists muscle_group text;
```

`exercises` RLS is already configured from v1. No further changes to this table.

#### `v2_programs`
Simpler than v1: no `is_active` flag (meso activation handles that), no `target_sets` / `target_rir` anywhere at the program level.
```sql
create table v2_programs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  schedule   jsonb not null default '{}',  -- { "monday": workout_day_id | null, ... }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### `v2_workout_days`
```sql
create table v2_workout_days (
  id         uuid primary key default gen_random_uuid(),
  program_id uuid not null references v2_programs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  position   integer not null  -- 0-based ordering within program
);
```

#### `v2_program_exercises`
No `target_sets` or `target_rir`. Those live in the weekly plan. `target_reps` is optional and is a suggestion only — never enforced.
```sql
create table v2_program_exercises (
  id             uuid primary key default gen_random_uuid(),
  workout_day_id uuid not null references v2_workout_days(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  exercise_id    uuid not null references exercises(id),
  position       integer not null,     -- 0-based ordering within the day
  target_reps    integer               -- nullable: suggestion only, never enforced
);
```

#### `v2_mesocycles`
One active meso at a time — enforced at the application layer (set others to `completed` before activating a new one).
```sql
create table v2_mesocycles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  program_id uuid not null references v2_programs(id),
  status     text not null default 'active',  -- 'active' | 'completed'
  start_date date not null,
  end_date   date,                            -- set when meso is marked complete
  created_at timestamptz not null default now()
);
```

#### `v2_week_plans`
One row per workout day per week of a meso. The `is_deload` flag lives here — it applies to the whole week-session, not individual sets.
```sql
create table v2_week_plans (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  mesocycle_id   uuid not null references v2_mesocycles(id) on delete cascade,
  workout_day_id uuid not null references v2_workout_days(id) on delete cascade,
  week_number    integer not null,   -- 1-based week within the meso
  is_deload      boolean not null default false,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (mesocycle_id, workout_day_id, week_number)
);
```

#### `v2_week_plan_sets`
One row per planned set for a given exercise within a week plan. References `program_exercise_id` to inherit exercise identity and ordering without denormalising.
```sql
create table v2_week_plan_sets (
  id                  uuid primary key default gen_random_uuid(),
  week_plan_id        uuid not null references v2_week_plans(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  program_exercise_id uuid not null references v2_program_exercises(id) on delete cascade,
  set_number          integer not null,   -- 1-based, per exercise within this plan
  target_rir          integer,            -- nullable: some sets may have no RIR target
  is_dropset          boolean not null default false
);
```

#### `v2_sessions`
Actual gym session. `week_plan_id` is nullable — an unplanned session (no WeekPlan for that week) is valid. `mesocycle_id` is nullable to support sessions outside any meso.
```sql
create table v2_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  mesocycle_id   uuid references v2_mesocycles(id) on delete set null,
  week_plan_id   uuid references v2_week_plans(id) on delete set null,
  workout_day_id uuid references v2_workout_days(id) on delete set null,
  date           date not null,          -- the date this session is *for* (not necessarily today)
  status         text not null,          -- 'planned' | 'in_progress' | 'completed' | 'skipped'
  note           text,
  started_at     timestamptz,
  completed_at   timestamptz,
  created_at     timestamptz not null default now()
);
```

#### `v2_set_logs`
Extends v1's shape with dropset support. `week_plan_set_id` links the actual set back to its plan target (nullable for sets beyond the plan or from unplanned sessions). `parent_set_id` links a dropset row back to the main set it follows.
```sql
create table v2_set_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  session_id        uuid not null references v2_sessions(id) on delete cascade,
  exercise_id       uuid not null references exercises(id),
  week_plan_set_id  uuid references v2_week_plan_sets(id) on delete set null,
  set_number        integer not null,      -- 1-based, per exercise within this session
  weight            numeric(6,2),          -- kg; null only when is_skipped = true
  reps              integer,               -- null only when is_skipped = true
  rir               integer,
  note              text,
  is_dropset        boolean not null default false,
  parent_set_id     uuid references v2_set_logs(id) on delete set null,
  is_skipped        boolean not null default false,
  logged_at         timestamptz not null,
  rest_seconds      integer,               -- computed on client, stored for history
  check (is_skipped = true or (weight is not null and reps is not null))
);
```

#### `v2_user_settings`
One row per user, upserted on save. Stored in Supabase (not localStorage) so accent/theme choices persist across devices.
```sql
create table v2_user_settings (
  user_id              uuid primary key references auth.users(id) on delete cascade,
  theme                text not null default 'dark',        -- 'dark' | 'light'
  accent_colour        text not null default '#FF8C42',     -- applied to --accent
  rest_timer_enabled   boolean not null default true,
  buzz_on_rest_complete boolean not null default false,
  target_rest_seconds  integer not null default 120,
  weight_unit          text not null default 'kg',          -- 'kg' | 'lbs'
  updated_at           timestamptz not null default now()
);
```

### 2.2 Indexes

```sql
-- exercises: indexes already exist from v1; no new indexes needed.

create index v2_programs_user_id_idx           on v2_programs(user_id);

create index v2_workout_days_program_id_idx    on v2_workout_days(program_id);

create index v2_program_exercises_wday_idx     on v2_program_exercises(workout_day_id);

create index v2_mesocycles_user_status_idx     on v2_mesocycles(user_id, status);

create index v2_week_plans_meso_id_idx         on v2_week_plans(mesocycle_id);
create index v2_week_plans_meso_week_idx       on v2_week_plans(mesocycle_id, week_number);

create index v2_week_plan_sets_plan_id_idx     on v2_week_plan_sets(week_plan_id);
create index v2_week_plan_sets_prog_ex_idx     on v2_week_plan_sets(program_exercise_id);

create index v2_sessions_user_date_idx         on v2_sessions(user_id, date);
create index v2_sessions_user_status_idx       on v2_sessions(user_id, status);
create index v2_sessions_meso_id_idx           on v2_sessions(mesocycle_id);
create index v2_sessions_week_plan_id_idx      on v2_sessions(week_plan_id);

create index v2_set_logs_session_id_idx        on v2_set_logs(session_id);
create index v2_set_logs_exercise_session_idx  on v2_set_logs(exercise_id, session_id);
create index v2_set_logs_user_ex_time_idx      on v2_set_logs(user_id, exercise_id, logged_at desc);
create index v2_set_logs_parent_set_idx        on v2_set_logs(parent_set_id);
```

### 2.3 Row Level Security

RLS enabled on every table. Same pattern as v1: users access only their own rows.

```sql
-- exercises: RLS already enabled from v1.
alter table v2_programs         enable row level security;
alter table v2_workout_days     enable row level security;
alter table v2_program_exercises enable row level security;
alter table v2_mesocycles       enable row level security;
alter table v2_week_plans       enable row level security;
alter table v2_week_plan_sets   enable row level security;
alter table v2_sessions         enable row level security;
alter table v2_set_logs         enable row level security;
alter table v2_user_settings    enable row level security;

-- Policy template (applied to every table above):
-- create policy "Users access own rows" on <table>
--   for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- v2_user_settings uses `user_id` as both PK and the ownership column — same pattern.
```

---

## 3. TypeScript Data Models

```typescript
// src/types/index.ts

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
  weekPlanId: string | null  // null when no WeekPlan was created for this week
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
  // isDropset = true: this row IS the dropset (reduced weight follow-up)
  // parentSetId: links this dropset back to the main set it follows
  // A planned dropset: isDropset=true, weekPlanSetId set to the planned dropset row
  // A spontaneous dropset: isDropset=true, weekPlanSetId=null, parentSetId set
  isDropset: boolean
  parentSetId: string | null

  isSkipped: boolean
  loggedAt: string           // ISO timestamp — source of truth for rest time
  restSeconds: number | null
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

// The scheduler now checks for an active meso and a WeekPlan before suggesting.
// Two 'suggest' variants: one where the plan exists, one where it doesn't yet.
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
  accentColour: string       // CSS colour — applied to --accent on save
  restTimerEnabled: boolean
  buzzOnRestComplete: boolean
  targetRestSeconds: number
  weightUnit: WeightUnit
}
```

---

## 4. File and Folder Structure

```
overload-v2/
├── public/
│   ├── manifest.json
│   └── icons/
│
├── supabase/
│   └── migrations/
│       ├── 001_v2_schema.sql
│       └── 002_v2_rls_policies.sql
│
├── src/
│   ├── main.tsx                   Entry point — providers, router
│   ├── App.tsx                    Auth gate + root layout
│   │
│   ├── styles/
│   │   ├── tokens.css             ALL CSS custom properties (colours, radii, spacing scale)
│   │   └── global.css             Resets and body base styles only — no colour values
│   │
│   ├── lib/
│   │   ├── supabase.ts            Supabase client singleton
│   │   ├── queryClient.ts         TanStack Query client
│   │   └── db.ts                  Dexie schema (offline cache)
│   │
│   ├── types/
│   │   └── index.ts               All interfaces and enums (Section 3)
│   │
│   ├── features/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx
│   │   │   └── useAuth.tsx
│   │   │
│   │   ├── library/               Exercise library
│   │   │   ├── LibraryPage.tsx
│   │   │   ├── ExerciseList.tsx
│   │   │   └── ExerciseForm.tsx
│   │   │
│   │   ├── programs/              Program builder
│   │   │   ├── ProgramPage.tsx
│   │   │   ├── ProgramBuilder.tsx
│   │   │   ├── WorkoutDayEditor.tsx
│   │   │   ├── WeeklyScheduleGrid.tsx
│   │   │   └── ExercisePicker.tsx    Filters by muscle group
│   │   │
│   │   ├── mesocycles/            Meso management
│   │   │   ├── MesoPage.tsx
│   │   │   ├── MesoCard.tsx
│   │   │   └── MesoEndFlow.tsx
│   │   │
│   │   ├── plan/                  Weekly plan builder — the new core feature
│   │   │   ├── PlanPage.tsx
│   │   │   ├── WeekPlanBuilder.tsx   One plan per workout day
│   │   │   ├── PlanExerciseRow.tsx   Exercise with expandable set list
│   │   │   └── PlanSetRow.tsx        RIR input + dropset toggle per set
│   │   │
│   │   ├── gym/                   Today tab — most important
│   │   │   ├── TodayPage.tsx          Runs scheduler, routes to correct state
│   │   │   ├── GymSession.tsx         Active session container
│   │   │   ├── ExerciseCard.tsx       Plan targets + last session reference side by side
│   │   │   ├── SetRow.tsx             Weight / reps / log / skip / dropset
│   │   │   ├── RestTimer.tsx          Counting-up timer + buzz
│   │   │   └── SessionComplete.tsx    Note + complete confirmation
│   │   │
│   │   ├── scheduling/
│   │   │   └── scheduler.ts          Pure logic, no UI (see scheduling notes)
│   │   │
│   │   ├── progress/
│   │   │   ├── ProgressPage.tsx
│   │   │   ├── ExerciseProgress.tsx
│   │   │   ├── MesoOverview.tsx       New: volume/RIR/reps trend across a meso
│   │   │   └── OverloadChart.tsx      Recharts line chart
│   │   │
│   │   ├── history/
│   │   │   ├── HistoryPage.tsx
│   │   │   ├── SessionList.tsx
│   │   │   ├── SessionFilters.tsx     Meso / session type / date range / muscle group
│   │   │   └── SessionDetail.tsx
│   │   │
│   │   └── settings/
│   │       └── SettingsPage.tsx       Theme / accent / rest timer / weight unit
│   │
│   ├── hooks/
│   │   ├── useScheduler.ts
│   │   ├── useRestTimer.ts
│   │   ├── useOnlineStatus.ts
│   │   ├── useAccentColour.ts    Writes accentColour setting → --accent on <html>
│   │   └── useWeightDisplay.ts  Converts kg ↔ lbs for display
│   │
│   └── components/
│       ├── ui/
│       │   ├── Button.tsx
│       │   ├── Input.tsx
│       │   ├── Sheet.tsx         Bottom sheet (mobile)
│       │   ├── Badge.tsx
│       │   ├── Toggle.tsx
│       │   └── Spinner.tsx
│       └── Nav.tsx               6-tab bottom nav
│
├── index.html
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 5. Implementation Order

Each phase is independently testable before the next begins.

### Phase 1 — Foundation

1. Vite + React + TypeScript scaffold
2. `tokens.css` with all colour custom properties — `--base`, `--surface`, `--surface-raised`, `--text-primary`, `--text-secondary`, `--border`, `--accent` (default `#FF8C42`), `--accent-muted`
3. Tailwind v4 configured to use CSS variables; no hardcoded colour utilities in components
4. `useAccentColour` hook wires settings → `--accent` on `<html>`
5. Supabase project: run migrations, enable RLS
6. Auth: login page, auth state in app root, protected routes
7. 6-tab nav shell (Today, Plan, Progress, History, Program, Library) with placeholder pages
8. TanStack Query and Zustand wired up

**Testable:** app loads, user can log in, nav tabs switch between placeholder pages, all colours come from CSS variables.

### Phase 2 — Exercise Library

9. List exercises (with muscle group filter)
10. Create / edit exercise with muscle group selection
11. Archive exercise (soft delete)

**Testable:** full exercise CRUD with muscle group filtering.

### Phase 3 — Program Builder

12. Program list + create
13. Workout day CRUD within a program
14. Weekly schedule grid — assign workout days to days of week
15. Add exercises to a day via muscle-group-filtered picker
16. Reorder exercises within a day
17. Optional target reps field (clearly labelled as suggestion)

**Testable:** build a complete program (e.g., PPL), assign days to schedule.

### Phase 4 — Meso Management

18. Create meso: pick program, set name, auto-set start date
19. Active meso card on Program tab (only one active at a time)
20. Mark meso complete → prompt to start new meso
21. End flow: pick or create a new program for the next meso

**Testable:** create a meso, navigate weeks, mark complete, start a new one.

### Phase 5 — Weekly Plan Builder

22. Plan tab: shows current week's plan for the active meso
23. Create a week plan: one panel per workout day this week
24. Per exercise: add sets with target RIR + dropset flag
25. Deload toggle on the plan (applies to all sets / the whole week session)
26. Edit / copy a plan from the previous week as a starting point

**Testable:** plan a full training week with per-set RIR targets and dropset flags.

### Phase 6 — Gym UI

27. Scheduling algorithm (`scheduler.ts`) — handles `no_program`, `no_active_meso`, `suggest_from_plan`, `suggest_no_plan`, `rest_day`, `completed_today`, `active_session`, `missed_sessions`
28. Today page: render correct state from scheduler
29. Start session → creates `v2_session` row linked to week plan (if exists)
30. `ExerciseCard`: plan targets panel (sets × target RIR, dropset flags) + last session reference panel side by side
31. Set rows: pre-filled weight from last session, RIR target shown as guide
32. Log a set: weight / reps confirm → records `v2_set_log`; collapsed RIR / note fields expand on tap
33. Skip a set: records `is_skipped = true`
34. Spontaneous dropset: flag any set as dropset on the fly, links via `parent_set_id`
35. Rest timer: counts up after each logged set; buzz option; option to hide entirely per settings
36. Session complete: optional note, marks session as completed

**Testable:** complete a full gym session driven by a WeekPlan; verify plan targets and last session reference both visible per exercise.

### Phase 7 — Progress

37. Per-exercise progress: weight over time line chart, volume overlay, avg RIR, avg rest time, last 5 sessions
38. Meso overview dashboard: weekly volume trend, avg RIR per week, avg reps per week, avg rest per week; deload weeks marked on all charts

**Testable:** view progression curve across a completed meso with deload weeks highlighted.

### Phase 8 — History

39. Session list with filters: by meso, session type/name, date range, muscle group
40. Session detail: exercises in correct order (position field), muscle group per exercise, weight display without underline
41. Delete session and delete meso (with confirmation)

**Testable:** filter history by meso and muscle group; delete a session.

### Phase 9 — PWA and Offline

42. vite-plugin-pwa: manifest, icons, service worker
43. Dexie cache: on session start, pre-fetch today's WeekPlan + last session data for each exercise → IndexedDB
44. Offline mutation queue: log sets to Dexie when offline, replay to Supabase on reconnect
45. `useOnlineStatus` hook + subtle offline indicator
46. Install prompt

**Testable:** start a session online, go offline mid-session, log sets, come back online — sets sync.

### Phase 10 — Settings and Polish

47. Settings page: theme toggle (dark/light), accent colour picker (set of options), rest timer on/off, target rest duration, weight unit
48. `useAccentColour` — applies chosen colour to `--accent`; theme toggle applies `[data-theme="light"]` to `<html>`
49. Touch target audit on gym UI — all interactive elements ≥ 44px
50. Keyboard / accessibility pass
51. Final design pass against `tokens.css` — confirm zero hardcoded colours anywhere

---

## 6. Resolved Assumptions

All three original assumptions have been resolved by the decisions below. No open questions remain before Phase 1.

### 1. Exercise table — resolved: use `exercises`

**Decision:** v2 reads from and writes to the existing `exercises` table. A single `ALTER TABLE` adds `muscle_group` if the column does not already exist. No data migration, no duplicate exercise library.

### 2. Gym UI when no WeekPlan exists — resolved: allow session start

**Decision:** `suggest_no_plan` is the correct scheduler state. The gym UI shows the exercise structure and last session reference without plan targets. Session start is not blocked. The plan targets panel is simply absent rather than empty — no "build your plan first" gate.

### 3. `v2_week_plan_sets.program_exercise_id` delete behaviour — resolved: `ON DELETE CASCADE`

**Decision:** deleting a `v2_program_exercises` row cascades to its `v2_week_plan_sets` rows. If a user removes an exercise from a program mid-meso, the corresponding planned sets are removed automatically rather than blocking the delete. The trade-off (silently losing planned sets) is acceptable given that a mid-meso program restructure is an intentional, informed action.
