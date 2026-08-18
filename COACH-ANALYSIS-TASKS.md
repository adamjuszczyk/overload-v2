# Overload — Coach: Daily Session Analysis — Technical Plan (v1)

*Planning document. **Reviewed and approved 2026-08-18 with two edits applied
— see §7.** No implementation code has been written yet. Read
COACH-ANALYSIS-SPEC.md first — that is the product source of truth; this
document is the technical answer to it.*

Written against the codebase as it actually stands on 2026-08-18 (last commit
`b240f54`, migrations `001`–`011` applied, Phases 3.0–3.8 plus the
position-matched progress work all shipped). Every claim about existing code
below was read directly, not recalled.

---

## 0. Two corrections to the spec's technical references

Neither changes what gets built — both change which functions it gets built
on. Flagging them here rather than silently building against the current
names.

**0.1 — `fetchLastCompletedSessionForExercise` no longer exists.** SPEC §5
("Comparison window") names it as the function to reuse. It was deleted in
Phase 3.3 (2026-08-08) and replaced by a session-first batched pair in
`src/features/gym/sessionService.ts`:

- `fetchReferenceCandidateSessions(userId, workoutDayId, currentSessionId)` —
  every completed session for the same workout day, excluding one by id
- `fetchReferenceSessions(userId, workoutDayId, exerciseIds, currentSessionId)`
  → `Map<exerciseId, ReferenceSession[]>`, set logs already grouped by
  `setGroupLogic.groupSetLogs`

The resolver is `resolveExerciseReference(today, sessions)` in
`referenceLogic.ts`, which returns a two-slot result: a `primary` slot
(`last_week` → `last_time` + `daysSince` → `first_time`) plus an additive
`thisWeek` array. **The spec's intent — "the same exercise's last occurrence at
the same workout-day slot, roughly a week prior" — is exactly what `primary`
resolves**, so the intent survives intact; only the function names change.
See §5.4 for how the `last_time` / `first_time` cases must be surfaced to the
model.

**0.2 — the spec doesn't mention set-by-set matching, but the app already has
it, and it is the single highest-value reuse in this feature.**
`src/features/progress/positionMatch.ts` (built 2026-08-12, live-verified
against real production data, 120+ Vitest tests) already solves the exact
problem "compare this session's sets to last week's sets for one exercise":
`matchSessionsByPosition(sessionA, sessionB)` splits each session into a plain
stream and a dropset stream, matches slot N to slot N within each stream,
matches stage 1 to stage 1 inside a matched dropset pair, handles a
mid-session skip renumbering later slots, and returns per-item
`weight/reps/rir` on both sides plus a computed `e1rmA` / `e1rmB` /
`deltaPercent`. Without it, the model would be handed two unaligned lists of
sets and asked to align them itself — which is exactly the kind of thing an
LLM does unreliably and a tested pure function does perfectly. **Plan: feed
the model `matchSessionsByPosition`'s output, not raw set lists** (§5.3).

---

## 1. Tech approach, with reasoning per choice

### 1.1 Where the Anthropic API call runs — a Vercel Serverless Function

**Decision: a new `api/` directory at the repo root, one Node function,
`api/coach/analyze.ts` → `POST /api/coach/analyze`.**

The app is a pure Vite SPA today with no server code at all. That has to
change: `ANTHROPIC_API_KEY` cannot ship in the client bundle, and any
`VITE_`-prefixed variable does. So a server-side hop is not optional.

| Option | Verdict |
|---|---|
| **Vercel Serverless Function** | **Chosen.** Vercel already hosts this project, the `vercel` CLI is already wired and used for every deploy verification in this repo, and `api/*.ts` is zero-config alongside a Vite framework preset. No new platform, no new account, no new deploy pipeline. |
| Supabase Edge Function | Rejected. CONTEXT.md is explicit that no Supabase CLI link, service-role key, or DB connection string exists in this environment — every migration to date has been applied by hand through the SQL Editor. Deploying and iterating on Deno functions would mean standing up that missing tooling first, for no gain over Vercel. |
| Call Anthropic from the client | Rejected outright — leaks the API key. |

**No service-role key is introduced.** The function receives the caller's
Supabase access token in an `Authorization: Bearer` header, verifies it with
`supabase.auth.getUser(token)`, and then does all its reads and its one write
through a Supabase client constructed with *that* token — so RLS enforces
ownership on the server side exactly as it does in the browser. This keeps the
"no service-role secret exists in this project" property CONTEXT.md records,
rather than quietly ending it.

**Env vars the function needs:** `ANTHROPIC_API_KEY` (new, server-only),
`COACH_USER_ID` (new, server-only — the gate, §1.4), and the two existing
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` values. Those last two are
already public by construction and are readable from `process.env` inside a
Vercel function, so they get reused rather than duplicated under
non-prefixed names — one fewer thing to configure wrong.

### 1.2 Four platform details that are easy to miss

These are all real properties of *this* repo, checked directly. Each is a
concrete task line in §4, not a footnote.

1. **`api/` would ship untypechecked by default.** `npm run typecheck` is
   `tsc -p tsconfig.app.json --noEmit` and that project is `include: ["src"]`;
   `tsconfig.node.json` is `include: ["vite.config.ts"]`. Neither covers
   `api/`, and Vercel's own function builder uses esbuild (no type checking).
   Fix: add `tsconfig.api.json`, reference it from `tsconfig.json` so
   `npm run build`'s `tsc -b` covers it, and widen the `typecheck` script.

2. **Function timeout is the biggest platform risk in this feature.** A Haiku
   4.5 write-up of ~1,000–1,500 output tokens is realistically a 10–25 second
   generation. Vercel's default Node function `maxDuration` is low enough that
   this is genuinely marginal. Fix: declare
   `{"functions": {"api/**": {"maxDuration": 60}}}` in `vercel.json` — and
   **measure a real generation before building UI on top of it** (§4, step E1).
   Streaming does not dodge `maxDuration`; it's a wall-clock cap either way.

3. **`vercel.json` already exists and must not be clobbered.** It currently
   holds only the `ignoreCommand` added on 2026-08-15 for docs-only pushes.
   The `functions` block gets *added* alongside it. The existing pathspec
   excludes only the six docs files, so `api/` correctly triggers builds with
   no change needed there.

4. **Confirm the service worker doesn't swallow `/api/`.** `vite.config.ts`'s
   workbox config precaches build assets only and declares no
   `runtimeCaching`, so `fetch()` POSTs are not intercepted today. But
   vite-plugin-pwa sets `navigateFallback` by default, which would matter for
   a direct browser navigation to an API path. Cheap insurance:
   `navigateFallbackDenylist: [/^\/api\//]`. Verify against the built
   `dist/sw.js`, the same way the `skipWaiting` gap was caught previously.

### 1.3 Pure modules imported by the function — verified safe

The function builds its prompt payload server-side (§1.5), which means it
imports this repo's existing pure logic from `src/`. That works on Vercel
(the Node builder follows relative imports outside `api/`), but only because
of a property I checked rather than assumed:

```
positionMatch.ts  → type SetLog, setGroupLogic, e1rm          (no I/O)
e1rm.ts           → nothing                                    (no I/O)
setGroupLogic.ts  → type SetLog, type WeekPlanSet              (no I/O)
referenceLogic.ts → date-fns, `import type` from sessionService (no I/O)
```

`referenceLogic.ts`'s only reference to `sessionService.ts` is
`import type { ReferenceSession }` — erased at compile time. **If that ever
became a value import, `src/lib/supabase.ts` would be pulled into the function
bundle, and it `throw`s at module load when `VITE_SUPABASE_*` are absent** —
a cold-start crash with a confusing message. Worth a comment at the import
site and a check in step E.

### 1.4 Single-account gating — two independent layers

**Server (authoritative):** the function compares the verified JWT's `user.id`
against `process.env.COACH_USER_ID` and returns `403` otherwise. This is the
only gate that actually matters, because it is the only one guarding spend.

**Client (cosmetic):** `import.meta.env.VITE_COACH_USER_ID` compared against
`useAuth().user.id` decides whether the COACH tab and route render at all;
everyone else gets SPEC §3's neutral locked placeholder.

Tradeoff, stated plainly: `VITE_COACH_USER_ID` puts a Supabase user UUID in
the public bundle. A user id is not a credential — it is already in that
user's own JWT and appears in every `user_id` column — but it does identify
the account to anyone who reads the bundle. Two alternatives considered and
rejected for v1: a `/api/coach/status` probe (an extra network round trip just
to decide whether to draw a nav tab, and it breaks when offline), and a
`coach_enabled` column on `v2_user_settings` (self-grantable through
PostgREST unless column-level `UPDATE` is revoked from `authenticated` —
workable, but more moving parts for a gate that isn't the real one anyway).

### 1.5 The prompt payload is assembled server-side

The client POSTs `{ sessionId }` and nothing else. The function fetches the
session, resolves the reference session, reads the phase and weight logs, and
builds the payload itself.

The alternative — client builds the payload, function just adds the key — is
less code, but it means the persisted analysis is not provably about the
session it claims to be about, and a stale client could send a payload built
from stale cache. Since the pure modules are already framework-free and
importable (§1.3), server-side assembly costs little and produces a cleaner
contract.

### 1.6 Model configuration

**`claude-haiku-4-5-20251001`** — the pinned snapshot, not the
`claude-haiku-4-5` alias. SPEC §11 says "Claude Haiku 4.5", which the alias
also satisfies, but the alias auto-resolves to whatever the newest Haiku 4.5
snapshot is *at call time*. That would quietly undercut §3.1's own reason for
storing `model` per row: after a new snapshot ships, every historical row
would still read `claude-haiku-4-5` and there would be no way to tell which
model actually wrote it. Provenance is the whole point of that column, so the
request pins the snapshot.

Belt and braces on the same point: **store `response.model` from the API
response, not the request constant.** The response reports what actually
served the request, which stays authoritative even if the request model were
ever changed back to an alias.

Other notes specific to this model, all of which differ from the
current-generation defaults:

- **Thinking:** Haiku 4.5 uses the older `thinking: {type: "enabled",
  budget_tokens: N}` form, and `output_config.effort` **errors** on it —
  adaptive thinking and effort levels are not available here. Recommendation:
  **no thinking in v1.** The reasoning inputs arrive pre-computed (e1RM
  deltas, matched slots, phase durations, weight trend); the model's job is
  interpretation and prose, not derivation. Revisit if output quality is thin.
- **Structured output:** supported on Haiku 4.5 via
  `output_config: {format: {type: "json_schema", schema: ...}}`. Used — see
  §3.1 for the shape and why.
- **`max_tokens`:** 4,000. Comfortably above a per-exercise write-up plus an
  overall read, comfortably inside the function timeout.
- **Prompt caching: deliberately not used in v1.** Haiku 4.5's minimum
  cacheable prefix is 4,096 tokens. The system prompt will be well under that,
  so a `cache_control` marker would silently do nothing —
  `cache_creation_input_tokens: 0`, no error. Only worth revisiting if the
  system prompt ever grows past 4,096 tokens.
- **Cost, roughly:** at $1 / $5 per MTok, a session with ~8 exercises produces
  something like 4–7k input and 1–1.5k output tokens → **on the order of one
  to two cents per analysis.** Token counts get persisted (§3.1) so this
  becomes measured rather than estimated, which is the point of SPEC §1's
  "kept small and observed closely".

### 1.7 What is *not* being introduced

No new client dependency (`@anthropic-ai/sdk` goes in `dependencies` because
the function needs it at runtime, but nothing under `src/` imports it, so the
client bundle is unaffected — verify with a bundle check). No offline support
for this feature (SPEC §4 explicitly waives it; the two Coach tabs get the
same "REQUIRES A CONNECTION" empty state the Phase 3.4 History views already
use, via the existing `useOnlineStatus` hook). No new state library — TanStack
Query owns server state, Zustand stays UI-only, per the standing rule.

---

## 2. New Supabase tables and how they relate to what exists

Three tables, one migration: **`supabase/migrations/012_v3_coach_analysis.sql`**
(011 is the last applied). Naming follows the two conventions already in this
repo: tables carry the `v2_` prefix, which is this app's namespace inside a
Supabase project shared with Northstar v2, while migration *filenames* carry
`v3_` for the era they belong to. A `coach_` infix groups the feature.

```
auth.users ──┬──< v2_coach_session_analyses >── v2_sessions ──< v2_set_logs
             │        (user_id)     (session_id)                    │
             │                                                      │
             ├──< v2_coach_phase_entries                            └── exercises
             │        (user_id)
             │
             └──< v2_coach_weight_entries
                      (user_id)
```

**Relationship to existing tables:**

- **`v2_sessions`** — `v2_coach_session_analyses.session_id` is the only FK
  into existing app data. One analysis per session, enforced by a unique
  constraint.
- **`exercises`** — no FK. Exercise identity travels *inside* the analysis
  JSON as `{exerciseId, exerciseName}`, denormalized on purpose: an analysis
  is a permanent written record of what was said at the time, and a later
  exercise rename or archive should not silently rewrite it. The stored id
  still allows deep-linking to `/exercise/:exerciseId`.
- **`auth.users`** — every table carries `user_id` with
  `on delete cascade`, matching all nine existing `v2_` tables.
- **`v2_set_logs`, `v2_week_plans`, `v2_program_exercises`** — read only,
  at analysis time. Nothing new writes to them.
- **`v2_history_session_summary`** (the Phase 3.4 view) — reused as-is for the
  "To analyze" list. It already returns one row per session with workout-day
  name, mesocycle name, stage-excluded set count, muscle groups, `status`, and
  `completed_at` — exactly the columns that list needs. No fourth database
  object is added for it.
- **Phase and weight entries relate to sessions only by date**, resolved at
  read time. No FK, by design: they are a continuous timeline the analysis
  samples, not per-session attributes.

### 2.1 RLS

Identical policy shape to `002_v2_rls_policies.sql` on all three tables:

```sql
alter table v2_coach_… enable row level security;
create policy "Users access own rows" on v2_coach_…
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
```

RLS is per-user, not per-*allowed*-user — it is data isolation, not the
feature gate. The single-account gate is §1.4 and lives outside the database.

### 2.2 Indexes

```sql
create unique index v2_coach_analyses_session_uk  on v2_coach_session_analyses(session_id);
create index        v2_coach_analyses_user_idx    on v2_coach_session_analyses(user_id, created_at desc);
create unique index v2_coach_phase_user_start_uk  on v2_coach_phase_entries(user_id, start_date);
create index        v2_coach_phase_user_idx       on v2_coach_phase_entries(user_id, start_date desc);
create unique index v2_coach_weight_user_date_uk  on v2_coach_weight_entries(user_id, entry_date, kind);
create index        v2_coach_weight_user_idx      on v2_coach_weight_entries(user_id, entry_date desc);
```

The three unique constraints are load-bearing, not hygiene — see §5.1, §5.2
and §5.5.

---

## 3. Data models

TypeScript interfaces live in `src/types/index.ts` alongside the existing
ones, in the project's established camelCase-domain / snake_case-DB split with
mappers in the service layer.

### 3.1 Session analysis

```sql
create table v2_coach_session_analyses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  session_id     uuid not null references v2_sessions(id) on delete cascade,
  content        jsonb   not null,   -- CoachAnalysisContent, see below
  input_snapshot jsonb   not null,   -- exactly what the model was shown (§5.11)
  model          text    not null,   -- response.model, e.g. 'claude-haiku-4-5-20251001'
  prompt_version integer not null default 1,
  input_tokens   integer,            -- null if the API omitted usage
  output_tokens  integer,
  created_at     timestamptz not null default now()
);
```

```ts
export interface CoachExerciseComment {
  exerciseId: string
  exerciseName: string      // denormalised — see §2
  comment: string           // prose. Reasons about *why*, per SPEC §5/§8
}

export interface CoachAnalysisContent {
  exercises: CoachExerciseComment[]
  overall: string           // SPEC §5's "short overall session read"
}

export interface CoachSessionAnalysis {
  id: string
  userId: string
  sessionId: string
  content: CoachAnalysisContent
  inputSnapshot: AnalysisInput   // the payload analysisInput.ts produced (§4 D)
  model: string
  promptVersion: number
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
}
```

**Why `jsonb` and a structured schema rather than one prose blob.** SPEC §8
calls the output "sectioned moments" and §5 describes a per-exercise structure
with an overall read at the end. Structured output makes that structure real
rather than a rendering guess: the UI maps each comment to its exercise (and
can link to `/exercise/:exerciseId`) instead of parsing headings out of
markdown. Haiku 4.5 supports `output_config.format`, so this costs nothing
beyond writing the schema. The tradeoff — the first request against a new
schema pays a one-time compile latency, then it is cached for 24 hours.

**Why `model`, `prompt_version`, token counts and `input_snapshot` are all
stored.** SPEC §1 frames this as the first real test of AI-integration
patterns, "kept small and observed closely", and SPEC §6 makes cost control an
explicit reason the trigger is manual. Together these four make "what did this
cost, which model and prompt produced it, and what did the model actually
see" answerable from the data rather than from guesswork.

They cover four different questions and none substitutes for another:
`model` (the resolved snapshot, §1.6) is *which model*, `prompt_version` is
*which system prompt* — resolvable to exact text through `coachPrompt.ts` in
git, which is why the prompt itself isn't duplicated per row — the token
counts are *what it cost*, and `input_snapshot` is *what it was shown*. That
last one is the only one that makes an analysis re-readable in full after the
assembly logic in `analysisInput.ts` changes; version numbers date a row, they
don't let you reconstruct its input. Since there is no regeneration (SPEC §9),
a row that can't be reconstructed can't be recovered by re-running it either.

`input_snapshot` holds the assembled user-content payload only — a few KB of
JSON for a typical session, trivial for `jsonb`. It is `not null` because it
is always available at insert time: the function builds it immediately before
the API call in the same request.

**FK is `on delete cascade` — a deliberate, flagged exception to "permanent".**
SPEC §8 says analyses are permanent, and §9 rules out a delete control. But
`historyService.deleteSession()` already exists and is reachable from History,
and an analysis of a session that no longer exists is not a useful permanent
record. Cascade is the honest behaviour. The alternative (nullable
`session_id` with `on delete set null`, keeping an orphaned write-up) is
available if you'd rather nothing about an analysis ever disappears — see
§5.7.

### 3.2 Phase log entry

```sql
create table v2_coach_phase_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  phase      text not null check (phase in ('cut','bulk','maintain')),
  start_date date not null,
  created_at timestamptz not null default now()
);
```

```ts
export type TrainingPhase = 'cut' | 'bulk' | 'maintain'

export interface PhaseEntry {
  id: string
  userId: string
  phase: TrainingPhase
  startDate: string         // ISO date
  createdAt: string
}

// Derived at read time — never stored. SPEC §5: no end-date field.
export interface ResolvedPhase extends PhaseEntry {
  endDate: string | null    // next entry's startDate − 1 day; null = current
  durationDays: number      // as of the date being resolved against
}
```

No end date column, no note field — SPEC §5 and §8 are explicit on both.
`unique (user_id, start_date)` is what makes the implicit-end model
well-defined: two phases starting the same day would make "the next entry's
start date" ambiguous and produce a zero-length phase.

### 3.3 Weight log entry

```sql
create table v2_coach_weight_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  entry_date date not null,
  weight_kg  numeric(5,2) not null check (weight_kg > 0),
  kind       text not null check (kind in ('daily','weekly_average')),
  created_at timestamptz not null default now()
);
```

```ts
export type WeightEntryKind = 'daily' | 'weekly_average'

export interface WeightEntry {
  id: string
  userId: string
  entryDate: string         // ISO date. For 'weekly_average', the Monday of
                            // the week it represents — see §5.2
  weightKg: number
  kind: WeightEntryKind
  createdAt: string
}

// Computed, never stored — SPEC §8 "never destroy raw data".
export interface WeeklyWeightAverage {
  weekStart: string             // Monday, ISO date
  averageKg: number
  source: 'manual' | 'daily'    // which rule produced it — see §5.3
  dailyCount: number            // 0 when source === 'manual'
}
```

`numeric(5,2)` — up to 999.99 kg at two decimals, matching the precision
convention `v2_set_logs.weight` (`numeric(6,2)`) already uses.

---

## 4. Implementation order

Seven steps. The ordering principle: **everything that can be verified against
real production data for free comes before anything that costs money per
run**, and the schema comes first because everything else writes to it.

### A. Migration 012 — schema

Three tables, RLS, six indexes. Applied by hand through the SQL Editor (the
established path for this project), then verified independently rather than
trusted: `information_schema.columns` for the columns and defaults, `pg_indexes`
for the indexes, `pg_policies` for RLS — the same standard every prior
migration in this repo was held to.

*First because:* nothing else can be written or read without it, and it is the
one step that touches production state irreversibly.

### B. Coach shell + gating

New route `/coach`, `CoachPage.tsx` with the two-tab shell (copying
`HistoryPage.tsx`'s pattern verbatim — page header, tab bar in the shell, each
tab owning its own state), the locked placeholder for every other account, and
the nav entry (§5.6). Ships with both tabs empty.

*Second because:* it is small, and steps C and F both need somewhere to
render. Landing it alone also makes the gate independently verifiable before
there is anything behind it worth protecting.

### C. Context tab — phase log and weight log

- `coachContextService.ts` — CRUD for both tables (the `settingsService.ts` /
  `historyService.ts` shape: DB row types, mappers, explicit
  `.eq('user_id', userId)` defence-in-depth alongside RLS)
- `useCoachContext.ts` — TanStack Query hooks with invalidation, following
  `useHistory.ts`
- `phaseLogic.ts` — **pure.** `resolvePhases(entries)` (implicit end dates),
  `phaseAt(entries, date)` → the phase in effect on a date, how long it had run
  by then, and the previous phase and its duration — literally SPEC §5's "bulk
  started 2 weeks ago, cut before that ran roughly 6 weeks"
- `weightLogic.ts` — **pure.** Monday-anchored `weekKey`,
  `buildWeeklyAverages(entries)`, `recentWeightTrend(entries, asOf, weeks)`
- Vitest for both pure modules
- `PhaseLog.tsx` / `WeightLog.tsx` — add / edit / delete, date picker
  defaulting to today and allowing backfill (SPEC §5)

*Third because:* SPEC §6 says it plainly — "without a current phase and a
recent weight trend, the analysis can't tell the difference between a plateau
and a successful cut." The Context tab is an input to the analysis, so it has
to exist and hold real data before the analysis is worth generating even once.
It is also entirely conventional CRUD with no AI dependency, which makes it
the cheapest place to get the Coach section's shape right.

*Pure-module note:* both modules follow the established precedent —
`setGroupLogic.ts`, `referenceLogic.ts`, `e1rm.ts`, `weightUnit.ts`,
`positionMatch.ts`, `compactPlanLogic.ts` are all pure, React-free and
Vitest-covered, and every one of them was extracted precisely because
date/aggregation logic embedded in a component is where this project's bugs
have historically hidden.

### D. Analysis input assembly — pure, and dry-runnable for free

`analysisInput.ts` — **pure**, plus a thin server-side fetch layer. Given a
session, its reference session, the phase entries and the weight entries, it
produces the exact JSON payload the model will receive:

- per exercise: `matchSessionsByPosition(reference, current)` output — matched
  plain and dropset streams, per-item weight/reps/rir on both sides, e1RM
  deltas already computed (§0.2)
- the reference kind (`last_week` / `last_time` + `daysSince` / `first_time`)
  so the model can tell a clean weekly comparison from a five-week gap
- `is_deload` for both weeks, read from the sessions' `v2_week_plans` — SPEC
  §8 names deload timing as a reasoning input
- `phaseAt(session.date)` and `recentWeightTrend(asOf: session.date)` —
  resolved **as of the session's date, not today** (§5.4)

Vitest coverage, then a dry run: call it against several real completed
sessions in the account and read the payload. **Zero API spend.** If the
payload is wrong, the write-up cannot be right, and this is the last point
where finding that out is free.

*Fourth because:* it is the highest-risk correctness work in the feature and
the only part of the pipeline that can be fully verified without paying per
attempt.

### E. Serverless function + the Anthropic call

- **E1 — the literal first action of this step. Nothing else in E starts until
  it has a number.** A throwaway script sends one real payload from step D to
  the pinned Haiku 4.5 snapshot and reports wall-clock latency and token
  usage. This is what tells you whether `maxDuration: 60` is sufficient
  (§1.2). Roughly one to two cents to find out. Not "early in step E", not
  "alongside the scaffolding" — no function file, no `vercel.json` edit, no
  dependency added before the measurement exists, because every one of those
  is work that a bad number would invalidate. If latency lands anywhere near
  the cap, that is a stop-and-report, not something to design around silently.
- `tsconfig.api.json` + `tsconfig.json` reference + widened `typecheck` script
  (§1.2)
- `vercel.json` — add the `functions.maxDuration` block *alongside* the
  existing `ignoreCommand`
- `@anthropic-ai/sdk` → `dependencies`; `@vercel/node` → `devDependencies`
- `api/coach/analyze.ts`: verify JWT → check `COACH_USER_ID` → return any
  existing analysis for that session (cheap idempotency check, real money
  saved) → assemble payload → call Haiku 4.5 with structured output → insert →
  return the row. Catch Postgres `23505` on the unique constraint and return
  the existing row rather than erroring, so a double-tap can never double-spend.
- `coachPrompt.ts` — system prompt as a versioned constant next to
  `prompt_version`. Must carry SPEC §8's two hard requirements explicitly:
  reason about *why* using training-science judgment, and **never** emit a
  bare progressed/same/regressed verdict.
- Env vars set in the Vercel dashboard for Production, and locally for
  `vercel dev`. **`COACH_USER_ID` and `VITE_COACH_USER_ID` are two separately
  configured values that must hold the same UUID** — they're deliberately
  separate (one is the server gate, one decides whether a nav tab draws) but
  nothing enforces that they agree. Drift is quiet and asymmetric: server
  value wrong → the tab renders and every Analyze click 403s; client value
  wrong → the feature works but is unreachable. Recorded in CONTEXT.md at ship
  (step G) so it doesn't have to be rediscovered.

*Fifth because:* it is the first step that costs money per run and the first
that introduces server code. Everything it depends on is already verified by
this point.

### F. Analysis tab UI

Two lists (SPEC §6): "To analyze" — completed sessions since the ship date
with no analysis row, read from `v2_history_session_summary` (§2) diffed
against the analysis-ids query, each with a manual **Analyze** button; and
"Analyses" — the saved write-ups. Plus the read-only detail view, with no
regenerate and no delete controls (SPEC §9). In-flight state on the Analyze
button, since a generation is a 10–25 second wait, and a plain error state on
failure. `useOnlineStatus`-driven "REQUIRES A CONNECTION" empty state.

### G. Verification and deploy

Typecheck, tests, build; live verification against real production data in the
browser — which is a **hard gate in this project**, not a nice-to-have (see
CONTEXT.md's "Key architectural rules": unavailable browser tooling during a
phase that needs live testing is a stop-and-report condition). Then push and
confirm the deploy via `vercel ls` / `vercel inspect`, the same double-check
every prior phase used.

An adversarial review pass (the Workflow-based pattern used for Phases
3.1–3.8) is worth running before deploy, and is most valuable pointed at the
function's auth and idempotency paths — the two places where a bug costs money
or leaks data rather than just rendering wrong.

---

## 5. Assumptions and decisions the spec doesn't cover

Each of these is a real fork the spec leaves open. Recommendation stated; none
is hard to change later except where noted. **§5.11 and §5.12 were settled at
review** and read as decisions rather than recommendations — §5.11 reverses
this document's own first-draft default.

### 5.1 One analysis per session, enforced in the database

SPEC §9 rules out regeneration, so a second analysis of the same session
should be impossible rather than merely un-offered.
**`unique (session_id)`.** It also makes the function's double-tap protection
race-safe for free.

### 5.2 A `weekly_average` entry's date is the Monday of its week

The spec says entries are "daily or weekly-average" but doesn't say what date
a weekly entry carries. Normalising it to the Monday of the week it represents
makes the read logic trivial (dailies group by `startOfWeek(d, {weekStartsOn:
1})`; a manual entry sits at exactly that key) and reuses the app's existing
hard rule that weeks are Monday-anchored calendar weeks. **This is the one
decision here that is genuinely awkward to change after data exists**, since
it defines what stored dates mean.

Corollary, and a rule the implementation must not break: meso-week arithmetic
in this app must always use `differenceInCalendarWeeks(..., {weekStartsOn: 1})`
or `startOfWeek(..., {weekStartsOn: 1})`, never `differenceInWeeks` — that
function has no `weekStartsOn` option and drifts off Monday. CONTEXT.md
records a real bug from exactly that.

### 5.3 A manual weekly average wins over dailies for the same week

SPEC §5 says the weekly figure comes "from whichever entries exist for that
week (one manual weekly entry, or the average of however many dailies)" — the
"or" is ambiguous when both exist. **Recommendation: the manual entry wins**
(it is an explicit statement by the user; a computed average is an inference).
The dailies remain stored, visible and editable — nothing is destroyed, per
SPEC §8. `WeeklyWeightAverage.source` makes which rule fired visible in the UI
rather than silent.

### 5.4 Phase and weight context resolve as of the *session's* date

The analysis is of a past session, possibly analyzed days later. Resolving
"current phase" and "recent weight trend" against today would tell the model
about a phase that started after the session it is describing. Everything
resolves as of `session.date`. Easy to get wrong, easy to not notice.

Related: the reference-session resolution uses the analyzed session's own date
as `resolveExerciseReference`'s `today` and passes its id as
`currentSessionId` so it excludes itself — `fetchReferenceSessions` already
takes exactly those arguments.

### 5.5 Only the `primary` reference slot is used

`resolveExerciseReference` also returns a `thisWeek` array (occurrences
earlier in the same week). SPEC §5 asks for one comparison — the same slot
roughly a week prior — so v1 uses `primary` only and ignores `thisWeek`. The
three primary variants must all reach the model *labelled*, because they mean
different things: `last_week` is the clean case, `last_time` + `daysSince` is
a gap the model should reason about rather than treat as weekly, and
`first_time` means there is nothing to compare and the model should say so
rather than invent a trend.

### 5.6 COACH becomes an eighth nav tab

`Nav.tsx` is a flex row of seven tabs at 8px labels. An eighth is tight on a
narrow phone. **Recommendation: add it anyway** — it is gated to one account,
so any crowding affects exactly one user, and a top-level section is what SPEC
§3 describes. It needs a real check at ~360px width during step G rather than
an assumption that it fits. If it doesn't, the fallback is an entry point from
Settings, which costs nothing structurally since the route already exists
independently of the nav.

### 5.7 What "permanent" means when a session is deleted

Covered in §3.1: cascade, so an analysis dies with the session it describes.
The alternative is a nullable `session_id` with `on delete set null`, keeping
an orphaned write-up in the list with no session behind it. **Recommendation:
cascade** — an analysis whose subject no longer exists is not a record worth
keeping. Flagging it because it is the one place this plan narrows SPEC §8's
"permanent", and reversing it later means a migration plus a nullable-id code
path.

### 5.8 Bodyweight stays in kg

SPEC §5 says "entries in kg", so v1 stores kg and **displays kg**, ignoring
the app's global `weightUnit` setting. This is a deliberate literal reading:
the existing `weightUnit.ts` / `useWeightDisplay.ts` chain is about *lifted*
weight, and SPEC §8.1's display rules were written for that. Routing
bodyweight through it is a one-line change later if the kg-only display turns
out to grate — the stored value is kg either way, which is what matters.

### 5.9 The ship-date cutoff is a single shared constant

SPEC §6: "To analyze" covers sessions finished after the feature ships, with
no historical backlog. **Recommendation: one exported constant
(`COACH_ANALYSIS_START_DATE`) applied at query time, filtering on
`v2_sessions.completed_at`** — not `date`. `completed_at` is the faithful
reading of "sessions finished after this ships", and it is now reliable: the
2026-08-11 session derived it from the newest set log's `logged_at` and
backfilled all 24 historical sessions. Filtering on `date` instead would let a
backdated session slip into the list.

Setting the constant to the actual deploy date is a step-G task, since it
isn't knowable earlier.

### 5.10 Warmup sets are excluded

`is_warmup` exists on `v2_set_logs` (migration 006) but has no logging UI yet,
so today every row is `false` and this is theoretical. Excluding warmups is
nonetheless the consistent choice — `e1rm.ts` and `positionMatch.ts` already
exclude them from every comparison, and `positionMatch.ts` carries the flag
through on each side so the exclusion happens without extra work here.

### 5.11 The analysis input payload *is* stored — decided, in migration 012

**Settled at review: `input_snapshot jsonb not null` ships in 012.** This
reverses the plan's own first-draft default, which had skipped it on SPEC §8's
minimal-footprint principle.

The reason for the reversal: §8's minimal footprint rules out fields with no
"concrete, already-identified use case", and this one has the most concrete
use case in the feature. SPEC §1's whole framing is understanding and
observing what the model does; `prompt_version` records *when* the inputs
changed shape but not *what any given analysis was shown*. With no
regeneration (SPEC §9), an analysis whose input can't be reconstructed can't
be recovered by re-running it either — the information is simply gone. A few
KB of `jsonb` per row is not the footprint §8 was written to guard against.

Cost of getting this wrong in the other direction is asymmetric, which is what
decides it: adding the column now is one line in a migration that hasn't run;
adding it later is migration 013 plus a nullable code path plus a permanent
population gap across every analysis written before it.

### 5.12 A paid-but-unsaved generation is an accepted risk

`unique (session_id)` plus catching Postgres `23505` makes a *duplicate
request* safe. It does not cover the narrower window where the Anthropic call
succeeds and the row never lands — a `maxDuration` kill moments after the
response arrives, or a cold-start blip during the insert. In that window you
have paid for a generation, have no saved analysis, and a retry pays again.

**Decision: accept it.** The volume is a handful of manual, deliberate clicks
per week, and the loss per occurrence is one to two cents. A pending-row state
machine (insert `status: 'generating'` before the call, update after) would
close it, at the cost of an extra round trip on every analysis, a row state to
render around, and stale-pending rows to clean up — real permanent complexity
against a rare, cheap, self-evident failure.

Two things do get done, because they cost nothing:

- **On insert failure after a successful generation, return the generated
  content in the error response** rather than discarding it, and log it
  server-side. The write-up isn't saved, but it isn't lost either.
- **Note that this does not cover a hard `maxDuration` kill** — the function
  is terminated, so there is no response to return anything in. That case is
  genuinely unrecoverable and is the risk being accepted. It is also the
  second reason E1 matters (§4): the further real latency sits from the cap,
  the narrower this window gets.

---

## 6. New files, at a glance

```
supabase/migrations/
  012_v3_coach_analysis.sql              A

api/
  coach/analyze.ts                       E
tsconfig.api.json                        E

src/features/coach/
  CoachPage.tsx                          B   two-tab shell + gate
  CoachLocked.tsx                        B   neutral placeholder (SPEC §3)
  coachGate.ts                           B   pure: is this account allowed
  CoachContextTab.tsx                    C
  PhaseLog.tsx / WeightLog.tsx           C
  coachContextService.ts                 C
  useCoachContext.ts                     C
  phaseLogic.ts  + .test.ts              C   pure
  weightLogic.ts + .test.ts              C   pure
  analysisInput.ts + .test.ts            D   pure
  coachPrompt.ts                         E   versioned system prompt
  coachService.ts                        F   analysis list/detail + POST
  useCoachAnalysis.ts                    F
  CoachAnalysisTab.tsx                   F   the two lists
  AnalysisDetail.tsx                     F   read-only write-up

modified:
  src/App.tsx            B   /coach route
  src/components/Nav.tsx B   COACH tab, gated
  src/types/index.ts     C   the three new interfaces
  vercel.json            E   functions.maxDuration (keep ignoreCommand)
  package.json           E   deps + widened typecheck script
  vite.config.ts         E   navigateFallbackDenylist for /api/ (§1.2)
```

---

## 7. Review outcome

**Approved 2026-08-18, with two edits, both applied above:**

1. **Pin the model snapshot** — `claude-haiku-4-5-20251001` rather than the
   `claude-haiku-4-5` alias, since the alias auto-resolves at call time and
   would leave historical rows unable to say which model wrote them. §1.6.
   Applied, plus the related improvement of persisting `response.model` rather
   than the request constant.
2. **`input_snapshot jsonb` moves into migration 012** rather than being
   skipped on footprint grounds. §3.1 and §5.11 rewritten. This reverses the
   plan's own first-draft default.

Also settled at review:

- **E1 is the literal first action of step E**, not merely early in it — §4 E
  rewritten to say so unambiguously and to make a near-the-cap latency reading
  a stop-and-report.
- **The paid-but-unsaved-generation window is an accepted risk**, not an
  oversight — reasoning recorded as §5.12, along with the two zero-cost
  mitigations that do get implemented and the one case (a hard `maxDuration`
  kill) that remains genuinely unrecoverable.
- **`COACH_USER_ID` / `VITE_COACH_USER_ID` must hold the same UUID** with
  nothing enforcing it — noted in §4 E, to be recorded in CONTEXT.md at ship.

Nothing above has been built yet. Cleared to start at §4 step A.
