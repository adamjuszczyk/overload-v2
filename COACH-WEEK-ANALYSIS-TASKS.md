# Overload — Coach: Weekly Analysis — Technical Plan (v1)

*Planning document. **Nothing here is built. No implementation code has been
written.** Read COACH-WEEK-ANALYSIS-SPEC.md first — that is the product source
of truth; this document is the technical answer to it. COACH-ANALYSIS-SPEC.md
and COACH-ANALYSIS-TASKS.md are the daily-analysis pair this feature reuses;
references below of the form "daily §5.11" point at COACH-ANALYSIS-TASKS.md.*

Written against the codebase as it actually stands on 2026-08-19 (last commit
`65db73f`, migrations `001`–`012` applied, Daily Session Analysis v1 complete
and live). Every claim about existing code below was read directly this
session, not recalled.

---

## 0. What already exists that this reuses — verified, not assumed

The spec's central claim is that "almost nothing new needed to be computed."
That is true, and here is exactly what is already there:

| Existing thing | Where | Reused how |
|---|---|---|
| `assembleAnalysisInput(client, userId, sessionId)` | `src/features/coach/analysisInput.ts:228` | Called **once per session in the week**. See §5 — one small extraction, no rewrite. |
| `buildAnalysisInput` / `buildExercise` | same file, `:147`, `:125` | The per-exercise `reference` + `match` mapping, reused verbatim via the extraction in §5.2. |
| `matchSessionsByPosition` | `src/features/progress/positionMatch.ts:227` | Untouched. Already called by the above. |
| `resolveExerciseReference` | `src/features/gym/referenceLogic.ts:56` | Untouched. Its `last_week` window is `startOfWeek(sessionDate)` minus one week — so an occurrence in week W already compares against week W−1's same-workout-day session, which is exactly right for a weekly read. No change needed. |
| `phaseAt` / `recentWeightTrend` | `phaseLogic.ts:49`, `weightLogic.ts:60` | Called **once per week** instead of once per session (§1.4). |
| `weekKey(date)` | `weightLogic.ts:20` | The Monday-anchored week key. Already the app's standing convention. Reused directly for week identity — no second implementation. |
| Auth / gate / idempotency block | `api/coach/analyze.ts:78–159` | Extracted and shared (§1.2) — it carries four adversarial-review fixes that must not drift between two copies. |
| `v2_history_session_summary` | migration 009 | Not needed here — the week's session roster comes from `v2_sessions` directly, since completeness has to see `status` on *unresolved* rows, which that view's shape isn't built for. |
| `useOnlineStatus` + "REQUIRES A CONNECTION" | `CoachAnalysisTab.tsx:65` | Same empty state, same reasoning. |
| `PROMPT_VERSION` pattern | `coachPrompt.ts:21` | A **separate** constant in a separate file (§1.5) — the week prompt is a different prompt with its own version line. |

**One thing the spec references that isn't resolvable from the files in this
repo:** COACH-WEEK-ANALYSIS-SPEC.md §3 says "Month is intentionally not
scaffolded here — see the note above this document." There is no such note in
the file. The *intent* is unambiguous (Month is out of scope, added later as
its own sub-tab), so nothing is blocked; flagging it only so it isn't read as a
missing requirement.

---

## 1. Tech approach, with reasoning per choice

### 1.1 A second serverless function, not a mode flag on the existing one

**Decision: `api/coach/analyze-week.ts` → `POST /api/coach/analyze-week`.**

| Option | Verdict |
|---|---|
| **New function file** | **Chosen.** `vercel.json`'s `functions` block is already `{"api/**": {"maxDuration": 60}}`, so a new file under `api/` inherits the timeout with **no config change at all** — verified by reading the file. Each handler stays one flow, which keeps the adversarial-review surface (auth + idempotency, the two places a bug costs money) small and separately reviewable. |
| A `scope: 'session' \| 'week'` branch inside `analyze.ts` | Rejected. Two payload assemblers, two prompts, two schemas, two tables and two idempotency keys behind one handler. The genuinely shared part is the auth/gate block, and that is better shared as a function (§1.2) than as a branch. |
| A single generic `api/coach/generate.ts` | Rejected for the same reason, plus it invites a future third surface to pile in. |

### 1.2 The auth / gate / idempotency block gets extracted and shared

`api/coach/analyze.ts:78–159` is ~60 lines of method check → bearer parse → env
stripping → `createClient` in a `try` → `getUser` → `COACH_USER_ID` compare.
**Four of the hardening details in it came from step G's adversarial review**
(invisible-character stripping on `COACH_USER_ID`, the `.eq('user_id', userId)`
defence-in-depth, the `createClient` try/catch, and not echoing upstream errors
to the client). Copy-pasting that into a second function means copy-pasting
four review fixes correctly and then maintaining them twice — the next fix
would land in one copy only.

**Decision: extract to `src/features/coach/coachApiAuth.ts`**, exporting
something like `authorizeCoachRequest(req, res) → { supabase, userId } | null`
(it writes the error response and returns `null` on any failure, so each
handler stays a straight-line read).

Two constraints on that file, both non-negotiable:

- **It must not import `src/lib/supabase.ts`.** That module `throw`s at load
  when `VITE_SUPABASE_*` are absent, which is exactly the cold-start crash
  daily §1.3 flags and `analysisInput.ts:21–35` documents at length. The helper
  constructs its own client from `process.env` and returns it.
- **Location is `src/features/coach/`, not `api/_lib/`.** Vercel's Node builder
  turns files under `api/` into routes; whether an `_`-prefixed directory is
  exempt is a platform behaviour I have not verified in this project, and there
  is no reason to depend on it — `api/coach/analyze.ts` already imports
  `analysisInput.ts` and `coachPrompt.ts` out of `src/features/coach/`, so that
  path is proven to work here.

`analyze.ts` gets refactored onto the helper in the same step, so there is never
a period where two copies exist.

### 1.3 Week completeness is derived **server-side** and never trusted from the client

Daily §1.5 established that the client POSTs `{ sessionId }` and the function
assembles everything, so a persisted analysis is provably about what it claims
to be about. The week case needs that principle *plus* one more thing, because
the request key is no longer an existing row's id:

The client POSTs `{ weekStart }` — a date string it computed. If the function
took the client's word for "this week is complete," a stale TanStack cache or a
UI bug could pay for and **permanently store** an analysis of a half-finished
week, with no regeneration path to fix it (SPEC §9). So the function must, in
order:

1. Reject a `weekStart` that isn't a `YYYY-MM-DD` Monday → `400`.
2. Re-derive the week's expected sessions and their resolution from live data.
3. Return `409` with a plain reason if the week is not complete.
4. Only then assemble and generate.

The Monday check is also enforced in the database (§2.2) — `unique (user_id,
week_start)` cannot by itself stop `2026-08-17` and `2026-08-18` both existing
as "the same week," and two overlapping weekly analyses is a data-integrity
problem with no delete control to clean it up.

### 1.4 The payload is **normalised**, not duplicated per bucket

The spec says a multi-tagged exercise appears "unmodified and in full, in both
buckets." That is a *semantic* requirement about what the model gets to reason
over, and it is met. It is not a serialisation requirement, and taking it
literally on the wire is expensive:

A `PositionMatchResult` for one exercise is roughly 0.5–1 KB of JSON. A week of
5 sessions × ~7 exercises is ~35 occurrences. Emitting each occurrence's full
`match` object inside every bucket it belongs to (typically one
`movement_pattern` bucket plus one or two `muscle_subgroup` buckets) roughly
triples that — **and, more importantly, invites the model to double-count**: the
same bench-press result read twice looks like two data points.

**Decision: one flat `occurrences` array where every fact appears exactly once,
each occurrence carrying its own tags and the bucket keys it landed in, plus a
`buckets` index mapping each bucket label to its occurrence ids.** The model can
read it either way round. Shape in §3.2.

Per occurrence, `occurrenceId` is `` `${sessionId}:${exerciseId}` `` — stable,
derivable, no counter to keep.

### 1.5 Model configuration

**`claude-haiku-4-5-20251001`**, the same pinned snapshot, for the same
provenance reason as daily §1.6, and `response.model` persisted rather than the
request constant. SPEC §11 names Haiku 4.5 and adds "reassessed only if real
output quality doesn't hold up against the larger, more complex weekly
payload" — so the reassessment trigger is real output, read after step 6.

**`max_tokens: 4000`**, unchanged from daily. Not because a weekly write-up is
the same size — because the output is *selective* (a handful of highlights plus
an overall read, per SPEC §5), so 4,000 is already generous, and it doubles as a
latency guard: output tokens are what drive wall-clock, and capping them caps
the worst case against `maxDuration`.

**Latency is the one place the week genuinely differs from daily, and it must be
measured before anything is built on it.** Real numbers already recorded for the
daily function: `3151`/`729` tokens at **14.2s**, `4510`/`984` at **19.5s**,
`4787`/`1018` at **13.6s**, and `5046`/`1078`. A weekly payload is roughly 5× the
per-session content, so ~12–16k input tokens against a 60s cap, with output in
the same 1–1.5k band (selectivity, not session count, sets output length).
Expected: **~15–25s** — a real margin, but a thinner one than daily's. Step 6
(§6) measures it on a real week before any function file exists, exactly as
daily's E1 did, and **anything above ~35s is a stop-and-report**, not something
to design around.

**Cost, roughly:** ~12–16k input at $1/MTok plus ~1–1.5k output at $5/MTok →
**about 2–3 cents per weekly analysis**, versus ~1–2 for a daily. At one a week
that is under a dollar a year. Token counts get persisted, same as daily, so
this becomes measured rather than estimated.

**Prompt caching: still not used.** Haiku 4.5's minimum cacheable prefix is
4,096 tokens. The week system prompt will be longer than daily's (it has to
explain occurrences, buckets, the no-blended-metric rule and selectivity) but
still comfortably under 4,096, so a `cache_control` marker would silently do
nothing. Caching the *payload* is pointless — each week's payload is generated
once and never re-sent.

**Thinking: still off.** Same reasoning as daily §1.6 — every reasoning input
arrives pre-computed. Revisit only if step 6's real output is thin, and note
that Haiku 4.5 uses the older `thinking: {type:"enabled", budget_tokens:N}` form
and **errors** on `output_config.effort`.

**Structured output: yes**, `output_config: {format: {type: 'json_schema',
schema: ...}}`, same as daily. Shape in §3.2.

### 1.6 `weekBuckets.ts` computes **no** aggregate — a hard constraint, not a style note

SPEC §5 and §8 reject a muscle-group-level blended metric *outright*, not as a
deferral. A module whose entire job is "here is a bucket of exercises" is
precisely where someone later adds a mean and thinks they are being helpful.

Two concrete rules for that file, worth stating because they are testable:

- It exposes **no** function returning a number derived from more than one
  occurrence. Grouping only.
- **`averagePositionMatchedDelta` (`positionMatch.ts:258`) must not be called at
  bucket level.** It exists and does exactly the rejected thing one level up.
  Per-occurrence deltas already reach the model slot-by-slot; nothing needs
  averaging.

### 1.7 What is *not* being introduced

No new dependency (`@anthropic-ai/sdk` and `@vercel/node` are already in
`package.json`). No `vercel.json` change (`api/**` already covers the new file).
No `tsconfig` change (`tsconfig.api.json` already has `include: ["api"]`, and
`npm run typecheck` already runs both projects). No offline support. No new
state library. No change to the `Exercise` type, `exerciseService.ts`, or the
Library UI — see §7.11.

---

## 2. Migration 013 — schema

One migration: **`supabase/migrations/013_v3_coach_week_analysis.sql`** (012 is
the last applied). Filename carries the `v3_` era infix and a `coach_` group,
matching `012_v3_coach_analysis.sql`; the table carries the `v2_` namespace
prefix every app table uses.

**One migration, not two.** The two `exercises` columns and the analyses table
are independent concerns, and the columns are needed earlier (the tagging pass
in §4 blocks on them) while the table isn't needed until step 7. But both are
pure additions, and this project applies migrations **by hand through the SQL
Editor** — so each extra migration is an extra manual apply and an extra
verification pass to get right. One file, applied once, verified once.

The reviewed tag *data* is a separate migration (`014`) by design — it cannot be
written until Adam has reviewed the proposals (§4).

### 2.1 The two `exercises` columns

**`muscle_subgroup text[]`, nullable.** Multi-value per SPEC §4.

| Option | Verdict |
|---|---|
| **`text[]`** | **Chosen.** Native, ordered, returned to PostgREST as a plain JS array, no parsing. A Postgres array is a new pattern in this repo but a completely standard one. |
| `jsonb` | Rejected. No advantage over `text[]` for a flat list of short strings, and it invites nested shapes later. |
| Junction table `exercise_muscle_subgroups` | Rejected. A whole table plus a join for a static, tiny, effectively single-user tag set that is read once per generation. Would be right if tags were user-editable through the app with referential integrity — SPEC §9 explicitly defers that. |
| Comma-separated `text` | Rejected — reimplements arrays badly. |
| A Postgres `enum[]` | Rejected. Adding a value means `ALTER TYPE`, and this vocabulary is deliberately open (§7.10). The existing `muscle_group` precedent is plain `text` with app-layer coercion (`src/lib/muscleGroup.ts`). |

**`movement_pattern text`, nullable, single-value** per SPEC §4, with a `CHECK`
against the seven values SPEC §4 enumerates. The asymmetry — a DB-enforced
vocabulary for the pattern, an app-layer one for the subgroup — is deliberate
and explained in §7.10.

**The `muscle_subgroup` CHECK is load-bearing, not hygiene.** The bucketing rule
is "no `muscle_subgroup` → fall back to `muscle_group`" (SPEC §5). Without the
constraint there are *two* representations of untagged — `NULL` and `'{}'` — and
the fallback has to check both, which is exactly the kind of second case that
gets missed. Making `'{}'` unrepresentable means the code has one branch, not
two. The null-element half of the same constraint stops a `{side_delt, NULL}`
array from producing a bucket labelled `null`.

**Adding columns to `exercises` is a cross-app change** — that table is shared
with Northstar v2 (CONTEXT.md, "Database tables"). Blast radius is kept minimal
for exactly that reason: `add column if not exists`, nullable, **no default, no
`NOT NULL`, no trigger** — the identical form in which `muscle_group` itself was
added to this shared table in `001_v2_schema.sql`. See §7.13 for the assumption
this rests on and why it cannot be verified from inside this repo.

### 2.2 `v2_coach_week_analyses`

Full parity with `v2_coach_session_analyses`' provenance discipline, with four
deliberate differences:

- **`week_start date not null` replaces `session_id uuid`** as the identity
  column, with `unique (user_id, week_start)` per SPEC §4 making regeneration
  structurally impossible rather than merely un-offered (same reasoning as
  daily §5.1).
- **`check (extract(isodow from week_start) = 1)`** — the Monday invariant,
  enforced where it cannot be bypassed. Without it, `unique (user_id,
  week_start)` happily allows `2026-08-17` and `2026-08-18` as two different
  "weeks" covering the same days, and there is no delete control to clean that
  up. *Apply-time note:* `extract` from a `date` is immutable and therefore
  legal in a `CHECK`; if Postgres rejects the expression anyway, drop the
  constraint, keep the server-side validation from §1.3, and record the gap —
  do not work around it with a trigger.
- **No FK, and therefore no cascade.** A week is not a row; there is nothing to
  cascade from. The consequence is a real divergence from daily §5.7 and is
  called out as an accepted decision in §7.7.
- **Two indexes, not the daily table's three-per-table pattern.** The unique
  index on `(user_id, week_start)` already serves the list query's `order by
  week_start desc` via a backward index scan, so a separate `(user_id,
  week_start desc)` index would be dead weight. This differs from the daily
  table only because there the unique index is on `(session_id)` alone and the
  list orders by `created_at` — a genuinely different column. Also: **no GIN
  index on `muscle_subgroup`**, because bucketing happens in code and no query
  ever filters by tag in SQL.

### 2.3 The migration, in full

```sql
-- Overload v3 — Coach: Weekly Analysis, schema
-- (COACH-WEEK-ANALYSIS-SPEC.md §4, COACH-WEEK-ANALYSIS-TASKS.md §2, step 2 of
-- §6. 012 is the last applied migration.)
--
-- Two additive columns on the shared `exercises` table and one new table.
-- Nothing existing is modified or removed. The reviewed tag *values* are
-- migration 014, deliberately separate — they can't be written until the
-- batch classification pass has been reviewed and corrected (TASKS §4).

-- ─── exercises — two new tag columns ─────────────────────────────────────────
-- `exercises` is shared with Northstar v2. Same minimal-blast-radius form
-- `muscle_group` itself was added in 001_v2_schema.sql: nullable, no
-- default, no NOT NULL, no trigger. Nothing outside this feature writes them.

alter table exercises
  add column if not exists muscle_subgroup  text[],
  add column if not exists movement_pattern text;

-- Seven values, exactly as COACH-WEEK-ANALYSIS-SPEC.md §4 enumerates them.
-- Single-value by design, unlike muscle_subgroup.
alter table exercises
  add constraint exercises_movement_pattern_chk
  check (movement_pattern is null or movement_pattern in (
    'horizontal_push', 'vertical_push',
    'horizontal_pull', 'vertical_pull',
    'hip_hinge', 'squat', 'isolation'
  ));

-- Load-bearing, not hygiene: the bucketing rule is "no muscle_subgroup ->
-- fall back to muscle_group" (SPEC §5). This leaves exactly ONE representation
-- of untagged (NULL), so the fallback is one branch instead of two. The
-- null-element half stops a {side_delt,NULL} array producing a bucket labelled
-- `null`. No CHECK on the vocabulary itself — deliberately open, TASKS §7.10.
alter table exercises
  add constraint exercises_muscle_subgroup_chk
  check (
    muscle_subgroup is null or (
      cardinality(muscle_subgroup) > 0
      and array_position(muscle_subgroup, null) is null
    )
  );

-- ─── v2_coach_week_analyses ──────────────────────────────────────────────────
-- One permanent row per resolved week. Full parity with
-- v2_coach_session_analyses' provenance fields (content / input_snapshot /
-- model / prompt_version / token counts) — same four questions, same reasoning
-- as COACH-ANALYSIS-TASKS §3.1/§5.11.
--
-- `week_start` is the Monday of the week, Monday-anchored per this app's
-- standing rule (weightLogic.ts's weekKey; CONTEXT.md "Key architectural
-- rules"). `unique (user_id, week_start)` (below) makes regeneration
-- structurally impossible, per SPEC §4.
--
-- The isodow CHECK is what makes "one row per week" actually true: without it,
-- 2026-08-17 and 2026-08-18 are two distinct rows describing the same seven
-- days, and SPEC §9 provides no delete control to clean that up.
--
-- No FK and therefore no cascade — a week is not a row, so there is nothing to
-- cascade from. A weekly analysis outlives deletion of the sessions it
-- describes; deliberate, see TASKS §7.7.
create table v2_coach_week_analyses (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  week_start     date    not null check (extract(isodow from week_start) = 1),
  content        jsonb   not null,   -- CoachWeekAnalysisContent (TASKS §3.2)
  input_snapshot jsonb   not null,   -- exactly what the model was shown
  model          text    not null,   -- response.model, not the request constant
  prompt_version integer not null default 1,   -- WEEK_PROMPT_VERSION, independent of daily's
  input_tokens   integer,            -- null if the API omitted usage
  output_tokens  integer,
  created_at     timestamptz not null default now()
);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Identical policy shape to 002_v2_rls_policies.sql and 012. Per-user, not
-- per-*allowed*-user — data isolation, not the feature gate. The single-account
-- gate lives outside the database (COACH_USER_ID, checked in the API function).

alter table v2_coach_week_analyses enable row level security;
create policy "Users access own rows" on v2_coach_week_analyses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ─── Indexes ─────────────────────────────────────────────────────────────────
-- Two total, not three: the unique index already serves the list query's
-- `order by week_start desc` as a backward index scan, so a separate
-- (user_id, week_start desc) index would be dead weight — unlike the daily
-- table, where the unique index is on (session_id) alone and the list orders by
-- created_at. No GIN index on exercises.muscle_subgroup: bucketing happens in
-- code, so no query ever filters by tag in SQL.

create unique index v2_coach_week_analyses_week_uk
  on v2_coach_week_analyses(user_id, week_start);
```

### 2.4 Verification, before anything is built on it

Held to the same standard as every prior migration in this repo — verified
independently, not trusted from a clean apply:

1. `information_schema.columns` for `exercises` — confirm `muscle_subgroup` is
   `ARRAY` / `_text` and `movement_pattern` is `text`, both nullable, no
   default.
2. `information_schema.columns` for `v2_coach_week_analyses` — all ten columns,
   types and defaults.
3. `pg_indexes` — the unique index present.
4. `pg_policies` — the RLS policy present, and `pg_class.relrowsecurity` true.
5. **Constraints proven by attempting to violate them**, not read off the DDL:
   an insert with `week_start = '2026-08-18'` (a Tuesday) must fail; an `update
   exercises set muscle_subgroup = '{}'` must fail; an `update exercises set
   movement_pattern = 'bench'` must fail. Same standard step G held `unique
   (session_id)` to — a real duplicate insert returning `409`/`23505`, not trust
   in the migration text.
6. Confirm existing `exercises` rows are unaffected: every row's
   `muscle_subgroup` and `movement_pattern` are `NULL`, and the count by
   `muscle_group` is unchanged from before the apply.

---

## 3. Data models

TypeScript interfaces live in `src/types/index.ts` alongside the existing Coach
ones, same camelCase-domain / snake_case-DB split with mappers in the service
layer.

### 3.1 Tag types

```ts
// DB-enforced vocabulary (013's CHECK) — exactly SPEC §4's seven values.
export type MovementPattern =
  | 'horizontal_push' | 'vertical_push'
  | 'horizontal_pull' | 'vertical_pull'
  | 'hip_hinge' | 'squat' | 'isolation'

// Deliberately NOT a union type: the subgroup vocabulary is app-layer only
// (§7.10), so a value the app doesn't know about must degrade to "a bucket
// label I don't recognise", never to a type error or a dropped occurrence.
// MUSCLE_SUBGROUPS (§4.3) is the *proposed* vocabulary, used by the tagging
// pass and by validation — not an exhaustive constraint on stored data.
export type MuscleSubgroup = string

export interface ExerciseTags {
  exerciseId: string
  exerciseName: string
  muscleGroup: MuscleGroup | null              // the existing coarse column
  muscleSubgroups: MuscleSubgroup[] | null     // null = untagged (never [])
  movementPattern: MovementPattern | null
}
```

### 3.2 The week payload, the model's output, and the stored row

```ts
// One exercise, in one session, in the week. The unit of everything here — an
// exercise trained twice in a week (Push 1 and Push 2) is TWO occurrences, each
// with its own reference comparison, because resolveExerciseReference scopes
// candidates to the same workout day.
export interface WeekAnalysisOccurrence {
  occurrenceId: string              // `${sessionId}:${exerciseId}`
  sessionId: string
  sessionDate: string
  workoutDayName: string | null
  exerciseId: string
  exerciseName: string
  // Tags as stored, carried inline so the model never has to join to read them
  // (§1.4). muscleSubgroups is null when untagged — the fallback rule has
  // already been applied to `bucketKeys`; this is the raw truth.
  muscleGroup: MuscleGroup | null
  muscleSubgroups: MuscleSubgroup[] | null
  movementPattern: MovementPattern | null
  // Which buckets this occurrence was mechanically placed in. Code's decision,
  // not the model's (SPEC §8).
  bucketKeys: string[]
  // Reused verbatim from the daily payload — same three labelled variants, same
  // meaning (daily §5.5).
  reference: AnalysisInputReference
  isDeloadReference: boolean | null
  isDeloadCurrent: boolean | null
  match: PositionMatchResult | null
}

// Two values, not three — corrected during implementation (step 4, real
// code in weekBuckets.ts). The original draft here also had a third value,
// 'muscle_group', for a fallback bucket on the subgroup axis — but that
// said the exact same thing `isFallback` below already says, for every
// bucket on that axis, with no case where the two could disagree. `kind`
// now answers one question only (which axis is this bucket on), and
// `isFallback` alone carries whether a subgroup-axis bucket used a real tag
// or fell back to the coarse muscleGroup column.
export type WeekBucketKind = 'muscle_subgroup' | 'movement_pattern'

export interface WeekAnalysisBucket {
  key: string            // e.g. 'subgroup:side_delt', 'pattern:horizontal_push'
  kind: WeekBucketKind
  label: string          // 'side_delt'
  // True when this bucket was reached via the muscleGroup fallback rather
  // than a real muscle_subgroup tag (SPEC §5). Only meaningful for
  // kind === 'muscle_subgroup' — a movement_pattern bucket has no fallback
  // path at all (§7.9: no tags row means absent from that axis entirely,
  // not present-with-fallback). The model may name an obvious specific in
  // prose without that changing where the numbers were mechanically placed.
  isFallback: boolean
  occurrenceIds: string[]
}

export interface WeekAnalysisSessionRoster {
  id: string
  date: string
  workoutDayName: string | null
  // Skipped sessions ARE included — a week with one skipped session is a
  // materially different week and the model should be able to say so (§7.8).
  status: 'completed' | 'skipped'
  isDeload: boolean | null
  mesocycleName: string | null
  weekNumber: number | null         // 1-based week within its meso
}

export interface WeekAnalysisInput {
  week: { weekStart: string; weekEnd: string }
  sessions: WeekAnalysisSessionRoster[]
  occurrences: WeekAnalysisOccurrence[]      // every fact exactly once (§1.4)
  bySubgroup: WeekAnalysisBucket[]
  byPattern: WeekAnalysisBucket[]
  // Resolved once for the week, as of the *last session's* date — not today,
  // and not once per session (daily §5.4, applied one zoom level out).
  phase: PhaseAtResult
  weightTrend: WeeklyWeightAverage[]
}
```

```ts
export interface CoachWeekHighlight {
  // 'cross' is a deliberate escape hatch: SPEC §1's whole point is reading a
  // pattern ACROSS buckets ("bench down, fly up -> accumulated fatigue on the
  // compounds"), which by definition doesn't belong to one bucket.
  bucketKind: WeekBucketKind | 'cross'
  bucketLabel: string
  // Exercise ids this highlight is about. Rendered as deep links to
  // /exercise/:id, same as AnalysisDetail.tsx:92 already does per comment.
  // Filtered at render time against the payload's real ids — a hallucinated id
  // is dropped from the links, never allowed to fail the whole render.
  exerciseIds: string[]
  headline: string
  comment: string
}

export interface CoachWeekAnalysisContent {
  highlights: CoachWeekHighlight[]
  overall: string
}

export interface CoachWeekAnalysis {
  id: string
  userId: string
  weekStart: string
  content: CoachWeekAnalysisContent
  inputSnapshot: WeekAnalysisInput
  model: string
  promptVersion: number
  inputTokens: number | null
  outputTokens: number | null
  createdAt: string
}
```

**Why `exerciseIds` ships in v1 rather than being added later.** Same
asymmetric-cost argument that moved `input_snapshot` into migration 012 (daily
§5.11): adding it now is one field in a schema that has never run; adding it
later means every already-written row lacks it, with no regeneration to backfill
from. Deep-linking is also already a proven pattern here —
`AnalysisDetail.tsx:92` navigates to `/exercise/:exerciseId` from an echoed-back
id, and that has worked in production.

**`highlights` is deliberately not capped in the schema.** A `maxItems` would be
the only *enforceable* form of SPEC §5's "small number of things worth saying,"
but it turns a soft editorial instruction into a hard truncation mid-list, and
there is no way to know the right number in advance. Selectivity goes in the
prompt ("typically 3–6; never one per muscle group") and gets observed against
real output. If the model comes back exhaustive, that is a `WEEK_PROMPT_VERSION`
bump, which is cheap.

**`WEEK_PROMPT_VERSION` is independent of the daily `PROMPT_VERSION`** (which is
at `2`). Different prompt, different file (`coachWeekPrompt.ts`), different
table — the two counters never collide and must not be shared. It starts at `1`.

---

## 4. The one-time AI-assisted batch tagging pass

SPEC §4: "populated via a one-time AI-assisted batch classification pass over
the existing exercise library — Claude proposes tags from exercise names, Adam
reviews and corrects before anything is committed."

### 4.1 No script. This is a ~50-row, genuinely one-time job.

The library is per-user rows in the shared `exercises` table —
`DEFAULT_EXERCISES` seeds 47, plus whatever has been added by hand (e.g.
"One-arm Dumbell Lateral Raise", "Cable Reverse Biceps Curl" — note the real,
existing typo in the first, which matters in §4.2 step 1).

| Option | Verdict |
|---|---|
| **Claude Code proposes the tags in-session** | **Chosen.** Zero API spend, no new script to write or maintain, no JSON-schema plumbing, and the classification is done by a stronger model than the one that would be scripted. Genuinely one-time, per SPEC §4 and §9 (tag-on-create is deferred). |
| A throwaway Node script calling the Anthropic API | Rejected for v1. It buys reproducibility for a pass that runs once, and a script used once and left in the tree rots — it would be written against today's vocabulary and silently drift. Becomes the right answer only if SPEC §10's "tag-on-create assist" ever ships, at which point it is that feature's code, not a leftover. |
| Tag by hand with no AI proposal | Rejected — the spec asks for an AI-assisted pass, and ~50 exercises × 2 fields is exactly the volume where propose-then-correct beats blank-page data entry. |

**Where the AI actually adds value here is worth being honest about:** it
proposes, it does not decide. Every value is reviewed before it reaches the
database. This is the same line the rest of this feature draws — mechanical work
in code, judgment to the model, and *stable* classification frozen into stored
data rather than re-inferred per call (SPEC §8).

### 4.2 Four steps, with the review gate in the middle

**Step 1 — read the real library.** Adam runs one `SELECT` in the Supabase SQL
Editor and pastes the result back:

```sql
select id, name, muscle_group, is_archived
from exercises
where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
order by muscle_group, name;
```

This is the established path in this project — every migration to date has been
applied by hand through the SQL Editor, and CONTEXT.md records that no
service-role key, DB connection string, or Supabase CLI link exists in this
environment. Names must come **from the database, not from
`defaultExercises.ts`**, precisely because of typos like "Dumbell": a proposal
keyed to the spelling in code would not match the row it is meant to tag.
Archived rows are read and tagged too — archived means "not offered in the
picker," not "never trained," and historical sessions reference them.

**Step 2 — Claude proposes, into a committed file.** `COACH-EXERCISE-TAGS.md`,
one markdown table:

| id (short) | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `a1b2c3d4` | Incline Barbell Bench Press | chest | `upper_chest`, `front_delt` | `horizontal_push` | the multi-tag case SPEC §4 names |
| `e5f6a7b8` | Lat Pulldown | back | `lats` | `vertical_pull` | |
| `…` | | | | | |

A file rather than a chat table, for three reasons: it is the artifact Adam
edits directly (correcting a cell is a one-line diff, not a paragraph of "change
row 14"); it is the **record in git of what was decided and why** — the `note`
column exists for the non-obvious calls; and it is the baseline a future
re-tagging pass diffs against instead of starting over.

**Step 3 — Adam reviews and corrects the file.** This is a blocking human step
and the only gate the spec asks for. Nothing touches the database until it is
done. What it has to catch is in §4.4.

**Step 4 — generate migration 014 *from the reviewed file*.**
`014_v3_exercise_tags.sql`, one statement, keyed on `id`:

```sql
-- Generated from COACH-EXERCISE-TAGS.md as reviewed and corrected on <date>.
-- Keyed on id, not name — exact, and immune to the real typos in this library
-- ("One-arm Dumbell Lateral Raise"). Name in a trailing comment per row so the
-- file stays reviewable as well as exact.
update exercises e
set muscle_subgroup  = v.subgroups,
    movement_pattern = v.pattern
from (values
  ('a1b2c3d4-…'::uuid, '{upper_chest,front_delt}'::text[], 'horizontal_push'),  -- Incline Barbell Bench Press
  ('e5f6a7b8-…'::uuid, '{lats}'::text[],                   'vertical_pull'),    -- Lat Pulldown
  -- …
) as v(id, subgroups, pattern)
where e.id = v.id;
```

Keyed on `id` rather than `name`: exact, immune to typos, and scoped to Adam's
own rows without needing a `user_id` clause. The trailing comments keep it
readable, so the review that happened on the markdown table is still auditable
here.

**Verification, and it is not optional.** A keyed `update` that matches nothing
succeeds silently, which is the single most likely way this step goes wrong:

1. The `UPDATE`'s reported row count must equal the number of rows in the
   `VALUES` list. Not "no error" — the count.
2. `select count(*) from exercises where user_id = '…' and muscle_subgroup is
   null;` must equal exactly the number of exercises **deliberately** left
   untagged in `COACH-EXERCISE-TAGS.md` — not necessarily zero, but a number
   that was decided rather than discovered. List them, don't just count them.
3. `select distinct unnest(muscle_subgroup) from exercises where user_id = '…';`
   — every value must be in the reviewed vocabulary. This catches a typo in the
   migration that the `text[]` column has no `CHECK` to catch (§7.10).
4. `select movement_pattern, count(*) … group by 1` — sanity-check the
   distribution. A library that came back entirely `isolation` is a
   classification failure, not a schema one.

### 4.3 The proposed `muscle_subgroup` vocabulary

SPEC §4 gives examples (upper-chest, front-delt) but does not enumerate, so this
is a proposal, and **it is the single thing in this plan that most wants review
before the pass runs** — it decides what the buckets can ever be.

```
chest      upper_chest, mid_chest, lower_chest
back       lats, mid_back, lower_back, traps
shoulders  front_delt, side_delt, rear_delt
arms       biceps, brachialis, triceps_long_head, triceps_lateral_head, forearms
legs       quads, hamstrings, glutes, adductors, calves
core       abs, obliques
```

22 values. The granularity line: **finer than `muscle_group` everywhere a
programming decision actually turns on it** — chest thirds, the three delt
heads, back regions, and triceps long-vs-lateral head (which genuinely differ
between overhead and non-overhead work) — and **not finer than an exercise name
can reliably support.** Biceps long vs. short head is deliberately *not* split:
it is not inferable from a name with any confidence and is rarely programmed for
distinctly. Same call for gastrocnemius vs. soleus, where the seated/standing
distinction would be doing all the work rather than the name.

`movement_pattern` needs no proposal — SPEC §4 enumerates it exactly. One note
for review rather than a change: the seven values are **not orthogonal**.
"isolation" is a set-type, not a direction, so a lateral raise is arguably both
`isolation` and a vertical-ish push. Since the field is single-value,
`isolation` wins for accessories and the pattern axis effectively becomes
"compound direction, or accessory." That is a coherent reading of what the spec
asked for and it is what the proposals will assume — worth confirming during
§4.2 step 3 rather than discovering from the first analysis.

### 4.4 What the review step has to catch

Stated explicitly, because "review the table" is otherwise a step people
rubber-stamp:

- **Multi-tag completeness.** SPEC §4's own example is an incline press tagged
  both upper-chest *and* front-delt. Under-tagging (one tag where two are true)
  quietly removes an exercise from a bucket it belongs in, and nothing
  downstream will ever flag it.
- **Over-tagging.** Tagging a flat bench with four subgroups makes every bucket
  contain every push, which erases the divergent signal SPEC §5 exists to
  surface — the same failure the rejected blended metric would have caused,
  arrived at from the other direction.
- **Deliberate nulls.** Any exercise that genuinely has no useful subgroup
  should be left `NULL` on purpose and listed as such, so §4.2's verification
  step 2 has a real expected number to compare against.
- **The `isolation` reading** in §4.3, once, up front.

---

## 5. How much of `analysisInput.ts` can be called directly

Short answer: **`assembleAnalysisInput` can be called directly, once per session,
and its entire fetch layer and per-exercise mapping are reused as-is. One
extraction is needed, and it is a pure move of existing lines.**

### 5.1 Reused with no change at all

- **`matchSessionsByPosition`, `resolveExerciseReference`, `groupSetLogs`,
  `phaseAt`, `recentWeightTrend`, `weekKey`** — all already exported, all pure,
  all reached through the existing chain. Zero changes.
- **`assembleAnalysisInput`'s six queries per session** (session + set logs with
  the exercise-name join; workout-day name; candidate reference sessions;
  batched reference set logs; batched `is_deload`; phase + weight entries in
  parallel). Correct as written for a weekly caller, including the two
  properties that matter most:
  - Candidate sessions are scoped to the **same `workout_day_id`**
    (`analysisInput.ts:290`), so Push 1 compares to last week's Push 1 and Push
    2 to last week's Push 2 — exactly right, and it is why an exercise trained
    twice in a week yields two occurrences with two independent references.
  - It takes an **injected `SupabaseClient`** (`analysisInput.ts:229`), added in
    step D precisely so the same function works from a browser dry run and from
    a JWT-scoped server client. The weekly function passes the same client it
    already builds.
- **Query volume is fine.** Five sessions × six queries ≈ 30 indexed PostgREST
  calls, and the per-session assemblies run under `Promise.all`, so wall-clock
  is one session's latency rather than five — around a second against a 15–25s
  generation. Not worth optimising.

### 5.2 The one extraction: split the phase/weight tail off the per-session core

`assembleAnalysisInput` ends by fetching the phase and weight entries and
calling `buildAnalysisInput`, which resolves `phase` and `weightTrend` **as of
that session's date** (daily §5.4 — deliberately, and correctly, for a daily
analysis). A weekly payload wants **one** phase/weight block for the whole week,
not five.

Calling it unmodified would work: take `.session`, `.isDeloadCurrent` and
`.exercises` from each result and discard `.phase`/`.weightTrend`. That costs 2N
redundant queries and, worse, is **misleading** — it computes
phase-as-of-each-session and then throws it away, which a future reader would
reasonably assume was intentional.

**Extract instead:**

```ts
// New, exported. Everything assembleAnalysisInput does EXCEPT the phase/weight
// fetch and the final buildAnalysisInput call. The body is moved, not
// rewritten — analysisInput.ts:233..375 verbatim.
export interface SessionFacts {
  session: { id: string; date: string; workoutDayName: string | null }
  isDeloadCurrent: boolean | null
  exercises: AnalysisInputExerciseSource[]
}
export async function assembleSessionFacts(
  client: SupabaseClient, userId: string, sessionId: string,
): Promise<SessionFacts>

// Unchanged signature, unchanged behaviour: now assembleSessionFacts + the
// phase/weight fetch + buildAnalysisInput.
export async function assembleAnalysisInput(…): Promise<AnalysisInput>
```

`buildExercise` (`analysisInput.ts:125`) also gets exported, so the week's
builder maps an `AnalysisInputExerciseSource` into `reference` /
`isDeloadReference` / `match` through **the same function the daily path uses**
rather than a second copy that could drift. `buildAnalysisInput` itself is not
reused by the week path — its output shape is per-session by construction — but
every piece inside it is.

**Why this refactor is safe to do to a shipped file that writes permanent,
unregenerable records:** it is a pure move (no logic change, no reordering of
awaits), `analysisInput.test.ts` already covers `buildAnalysisInput`, and §5.4's
real-data check makes the claim provable rather than argued.

### 5.3 What genuinely has to be new

- **`weekResolution.ts`** (pure) — expected sessions for a week, and whether
  they are all resolved. Nothing existing does this; `scheduler.ts` derives the
  same *expectation* but over a 7-day lookback to drive a prompt, and its notion
  of "handled" includes `in_progress` (§7.2).
- **`weekBuckets.ts`** (pure) — tag bucketing with the `muscle_group` fallback.
  No aggregate of any kind (§1.6).
- **`weekAnalysisInput.ts`** — the week payload: fans out over
  `assembleSessionFacts`, maps through `buildExercise`, fetches the exercise tags
  (one query), buckets, resolves phase/weight once, and builds the session
  roster including skipped sessions (§7.8).
- **The exercise-tag read** — one query, and the only genuinely new fetch in the
  whole feature:
  ```
  .from('exercises')
  .select('id, name, muscle_group, muscle_subgroup, movement_pattern')
  .eq('user_id', userId).in('id', exerciseIds)
  ```
  It cannot go through `exerciseService.ts`: that imports the browser `supabase`
  singleton, which is the cold-start crash `analysisInput.ts:21–35` documents at
  length. Same injected-client pattern instead.

### 5.4 A free, real-data regression check for the extraction

Two real analyses exist in production with **frozen `input_snapshot` values**
(`48d841fb-…` at `promptVersion: 1`, `413f76e5-…` at `promptVersion: 2`). After
the extraction, re-run `assembleAnalysisInput` against those same two session
ids and **deep-compare `.session`, `.isDeloadCurrent` and `.exercises` against
the stored snapshot.** They must be identical.

Scope it to those three fields deliberately: `.phase` and `.weightTrend` read
`v2_coach_phase_entries` / `v2_coach_weight_entries`, which are user-editable and
may legitimately have changed since — a difference there proves nothing.
`.exercises` is the part the extraction actually moves, and it is derived
entirely from set logs and week plans, which do not change for a completed
session. Zero API spend, real production data, and a stronger claim than the
unit tests can make on their own.

---

## 6. Implementation order

Nine steps. Same ordering principle as the daily plan — **everything verifiable
against real production data for free comes before anything that costs money per
run** — plus one addition specific to this feature: the human-review gate (§4)
starts as early as possible, because it is the only step that blocks on Adam
rather than on Claude.

### 1. Read-only completeness diagnostic against production. No code.

Before writing a line of `weekResolution.ts`, run its logic by hand as queries
against real data for every week from Monday 2026-08-17 onward: the program
schedule, the meso date ranges, the expected dates per week, and each expected
date's session status.

*First because:* it answers three questions that invalidate everything
downstream if they come back wrong. **(a)** Does at least one week actually
resolve as complete? If none does, the definition in §7.1 is wrong and the
feature would ship with a permanently empty "To analyze" list. **(b)** Does the
derivation match reality — do the dates it expects line up with sessions that
genuinely exist? **(c)** How many weeks will appear at ship (§7.4 predicts
several, not zero — confirming it here means it isn't mistaken for a bug later).
Free, read-only, and the cheapest possible place to find out the core concept
doesn't hold.

**Run 2026-08-20 — real findings, not projected.** Four read-only queries
against production (`v2_programs`, `v2_mesocycles`, `v2_workout_days`,
`v2_sessions` from `2026-08-17` onward), no writes:

- One program ("MESO 1.0"), schedule Mon→PUSH 1, Tue→PULL 1, Wed→rest,
  Thu→PUSH 2, Fri→PULL 2, Sat→LEGS, Sun→rest (5 training days/week). One
  mesocycle ("MESO 1.0"), `status: active`, `start_date: 2026-07-05`,
  `end_date: NULL` — open-ended, covers `2026-08-17` onward with no gap. All 5
  `workout_day_id`s the schedule references exist — no stale-guard trip.
- Sessions from `2026-08-17` onward: **exactly two rows exist.** `2026-08-17`
  (Mon, PUSH 1) `completed`, `completed_at 2026-08-17 10:24:46+00`. `2026-08-18`
  (Tue, PULL 1) `completed`, `completed_at 2026-08-18 14:47:49+00`. No row at
  all for `2026-08-20` (Thu, PUSH 2 expected — **today**, not yet
  trained/logged), `2026-08-21` (Fri, PULL 2), or `2026-08-22` (Sat, LEGS) — all
  still ahead. `2026-08-19`/`2026-08-23` are the schedule's rest days and
  correctly expect nothing.

**(a) Does at least one week resolve as complete? No — currently zero, but
this is not evidence the §7.1 definition is wrong.** `2026-08-17`–`2026-08-23`
is the only candidate week (today, `2026-08-20`, falls inside it), and only 4
of its 7 days have elapsed: 2 of 5 expected sessions are done, 1 is today's
and simply hasn't been trained yet, 2 are genuinely in the future. The
derivation has nothing wrong to resolve *to* yet — there is no full week in
existence for it to have gotten wrong. This will re-resolve to a real answer
once the week finishes, likely within days.

**(b) Does the derivation match reality? Yes, as far as it is currently
checkable.** The 5 expected dates (tied to `workout_day_id`s that all exist)
line up exactly with the 2 real sessions that exist — zero mismatches. The one
thing this run cannot yet confirm is the flip to `complete`, since no candidate
week has finished. Re-check once `2026-08-17`–`23` closes out.

**(c) How many weeks are available at ship? Zero — §7.4's "several, not zero"
prediction was wrong, and has been corrected in place (§7.4) rather than left
standing.** That prediction implicitly assumed more time had elapsed since the
`2026-08-17` floor than actually has (today is only 4 days in). The honest
statement: "To analyze" will most likely ship empty and fill in within days,
not "several weeks already available." This is exactly the kind of thing this
step exists to catch before code gets written against a wrong assumption.

**Not yet re-run against a genuinely complete week** — that is the one part of
this diagnostic still open, and the natural moment to re-run it is once
`2026-08-17`–`23` closes out (likely by Sunday `2026-08-23`, given both logged
sessions so far were same-day).

### 2. Migration 013.

Two `exercises` columns and `v2_coach_week_analyses`. Applied by hand through the
SQL Editor, then verified per §2.4 — including the three
prove-it-by-violating-it checks, not just an `information_schema` read.

*Second because:* the tagging pass cannot write anything without the columns, and
nothing else can be stored without the table. It is also the one step that
touches production state irreversibly, and the one that touches a table shared
with another app.

### 3. The batch tagging pass → `COACH-EXERCISE-TAGS.md` → migration 014.

Per §4. **Steps 1–2 of §4 run immediately after migration 013 lands**, so the
review gate (§4 step 3) is open while steps 4–5 below are being built rather than
serialised after them. Migration 014 applies once the file is corrected.

*Third because:* it is the only blocking human step in the plan, and the pure
modules below can be built and unit-tested against synthetic tags without waiting
for it. What it *does* gate is step 5's dry run — a payload where every
occurrence falls back to `muscle_group` is a valid state but a useless read.

### 4. Pure modules: `weekResolution.ts` and `weekBuckets.ts`, with Vitest.

Free to verify, and the two places a subtle bug would be invisible from outside.

`weekResolution.ts` cases: a fully resolved week; one unresolved expected date;
an `in_progress` session (**not** resolved, §7.2); a week with zero expected
sessions; a week where every expected session was skipped (§7.1); a week
straddling a meso start or end; a stale `workout_day_id` that no longer exists
(matching `scheduler.ts:69`'s own guard).

`weekBuckets.ts` cases: a multi-tagged exercise landing in two subgroup buckets
unmodified; an untagged exercise falling back to `muscle_group` with
`isFallback: true`; an exercise with `movement_pattern: null` appearing on the
subgroup axis only (§7.9); the same exercise appearing twice in a week as two
distinct occurrences; and **an occurrence whose tag row is missing entirely,
which must still appear in a bucket rather than vanish** (§7.12).

*Fourth because:* both are pure, both are cheap to get exactly right with tests,
and both are inputs to step 5.

### 5. The `analysisInput.ts` extraction, `weekAnalysisInput.ts`, and a dry run.

§5.2's extraction plus §5.4's real-data regression check first, then the week
payload assembler, then a dry run: build the real payload for a real complete
week and read it. **Zero API spend.** Record its real size in tokens — that is
the input to step 6's latency expectation, and it is free to measure here.
Record the reference-log row counts too, per §7.15.

*Fifth because:* it is the highest-risk correctness work in the feature and the
last point at which a wrong payload can be found for nothing. If the payload is
wrong the write-up cannot be right — and there is no regeneration to fix it
afterwards.

### 6. Measure one real weekly generation. The literal first action of the server work.

A throwaway script sends step 5's real payload to the pinned Haiku 4.5 snapshot
and reports wall-clock latency and token usage. **No function file, no prompt
file, no handler refactor before this number exists** — same discipline as
daily's E1, and for the same reason: every one of those is work a bad number
would invalidate. Roughly two to three cents.

Expected ~15–25s against the 60s cap (§1.5). **Anything above ~35s is a
stop-and-report**, not something to design around silently — the margin is
thinner here than daily's, and a `maxDuration` kill after a successful
generation is the one failure mode in this whole feature that is genuinely
unrecoverable (§7.17).

This step also produces the first real weekly output to read, which is the only
honest input to SPEC §11's "reassessed only if real output quality doesn't hold
up."

### 7. `coachApiAuth.ts` extraction + `api/coach/analyze-week.ts` + `coachWeekPrompt.ts`.

Extract the shared auth block and refactor `analyze.ts` onto it in the same
commit, so two copies never coexist (§1.2). Then the handler: authorize →
validate `weekStart` is a Monday → return any existing row for that week →
**re-derive completeness server-side and `409` if incomplete** (§1.3) → assemble
→ generate → insert, catching `23505` and returning the winning row.

`coachWeekPrompt.ts` carries `WEEK_PROMPT_VERSION = 1` plus the constraints that
are hard requirements rather than tone: explain the occurrence/bucket shape;
**never emit a per-muscle-group blended number** (SPEC §8's rejected metric — the
model must not synthesise what the payload deliberately omits); be selective
rather than exhaustive; back every highlight with real numbers from its bucket.

**Also required from `WEEK_PROMPT_VERSION = 1`, not deferred to a later bump:
the same `secondaryReference` handling `coachPrompt.ts` v3 carries (CONTEXT.md,
2026-08-22 fix).** `weekAnalysisInput.ts` builds every occurrence through
`buildExercise` — the exact function `analysisInput.ts`'s daily path uses — so
`reference`/`match`/`secondaryReference` are already identical shapes on both
payloads by construction (§5.2), not something this file's own prompt has to
special-case for the weekly shape. This supersedes an earlier, narrower note
(this file and CONTEXT.md, first written before the real cause was pulled from
production data) that framed the fix as an "asymmetric-skip" wording tweak to
the daily prompt only — the real fix is the reach-back mechanism itself
(`resolveSecondaryReference`, `referenceLogic.ts`), which both prompts consume
identically. When `coachWeekPrompt.ts` is actually written (this step), copy
the `match`/`secondaryReference` payload-shape and "what to write" language
from `coachPrompt.ts` v3 nearly verbatim — the only real difference is that an
occurrence here has no single "current session," since a week can contain
several sessions for the same exercise (§1.4's own dedup note already covers
why `thisWeek` is excluded from the week payload for the same reason).

### 8. UI — the sub-tab restructure, then the Week lists.

Two distinct sub-steps, in this order, because the first must be provably
behaviour-neutral before the second adds anything.

**8a.** Move `CoachAnalysisTab.tsx`'s current body verbatim into
`CoachSessionAnalysisTab.tsx`, and make `CoachAnalysisTab.tsx` a Session/Week
sub-tab container (default `session`). The container owns the sub-tab bar and
always renders it; each sub-tab owns its own detail-view state, matching how
`CoachAnalysisTab.tsx:56` already early-returns a detail while `CoachPage.tsx`'s
outer tab bar stays visible. So the honest statement of this change is: *the
Session lists and detail view are identical; one additional tab bar row appears
above them.*

**8b.** `CoachWeekAnalysisTab.tsx` (the two lists, same shape as Session's —
manual trigger, in-flight and error states, the `useOnlineStatus` empty state)
plus `WeekAnalysisDetail.tsx`, `coachWeekService.ts`, `useCoachWeekAnalysis.ts`.
`WeekAnalysisDetail.tsx` mirrors `AnalysisDetail.tsx`'s padding and provenance
footer rather than diverging — including its pre-existing nested-padding quirk,
which is out of scope to change here.

### 9. Verification, adversarial review, deploy, CONTEXT.md.

Typecheck (both projects), Vitest, `vite build`. **Live verification against real
production data is a hard gate in this project** — CONTEXT.md's "Key
architectural rules" makes unavailable browser tooling a stop-and-report
condition, not a reason to ship on code-level checks. Check that tooling *before*
starting step 8, not when the gate is reached.

Live checks: the Week sub-tab lists exactly the weeks step 1's diagnostic
predicted; an incomplete week is genuinely absent; a real generation through
**the actual UI button** (not a raw `fetch` — step G found that was the one path
never exercised); the saved write-up renders with working exercise deep links;
the Session sub-tab is unchanged; and the eighth nav tab still fits at ~360px
(daily §5.6's check, re-run because nothing guarantees it stayed true).

An adversarial review before deploy, pointed at `analyze-week.ts`'s
**completeness re-derivation and idempotency** — the completeness check is new
attack surface the daily function never had, and it is what stands between a
client bug and a permanently stored analysis of a half-finished week.

Then push, confirm via `vercel ls` / `vercel inspect`, and update CONTEXT.md.

---

## 7. Assumptions and decisions the spec doesn't cover

Each is a real fork the spec leaves open. Recommendation stated; noted where a
choice is awkward to reverse.

### 7.1 Week completeness derives from `program.schedule`, not `v2_week_plans`

SPEC §5 says a week is over when "every session the Weekly Plan expected for
that week has either been completed or explicitly skip-marked (the existing
`skipMissedSession` path)."

Two candidate readings of "expected", and they differ:

- **`program.schedule`** — the `jsonb` map of day-of-week → `workout_day_id` on
  `v2_programs`. This is what `scheduler.ts:70` uses to decide a date is a
  training day, and therefore what drives the missed-session prompt, and
  therefore what drives `skipMissedSession` — the exact path the spec names.
- **`v2_week_plans`** — one row per (meso, workout day, week number). The
  literal "Weekly Plan" layer. But it carries no day-of-week, so turning it into
  dates requires the program schedule anyway, and sessions are valid without a
  week plan at all (`v2_sessions.week_plan_id` is nullable).

**Recommendation: `program.schedule`,** because it makes completeness and
resolvability consistent by construction. A date the scheduler never prompts
about cannot be skip-marked through any existing UI, so if `v2_week_plans` made
such a date "expected", that week would be permanently unanalyzable with no path
to fix it.

Precisely: for each of the seven dates from `weekStart`, expect a session when
the date falls inside a mesocycle's range, that meso's program schedules a
workout day for that day-of-week, and that workout day still exists (the same
stale guard `scheduler.ts:69` applies). The week is then complete when every
expected date has a session with status `completed` or `skipped`, **and at least
one is `completed`** — a week where everything was skipped is resolved but has
nothing to analyze, and a week with zero expected sessions is vacuously resolved
and equally empty. Neither should appear in "To analyze".

**Flagged limitation, not fixed:** `program.schedule` is a *current* value with
no history. Changing the schedule mid-meso retroactively changes what past weeks
"expected" — adding a Saturday workout would make every prior week in the meso
expect a Saturday session that never existed and, being more than seven days
back, can never be skip-marked. Those weeks would become permanently
unanalyzable. Already-analyzed weeks are unaffected (the "To analyze" diff
excludes them). Recording this rather than designing around it: the fix would be
a schedule-history table, which is a large change for a single-user app where
the workaround is to analyze affected weeks before changing the schedule.

### 7.2 `in_progress` does **not** count as resolved — a deliberate divergence from the scheduler

`scheduler.ts:76–80` treats `completed`, `in_progress` **and** `skipped` as
"handled" for missed-session purposes, which is right for a prompt ("you're
already on it, stop nagging"). It is wrong here: an `in_progress` session has
partial set logs, and analyzing a week containing one would produce a permanent,
unregenerable write-up about half a session. Only `completed` and `skipped`
resolve. Stated loudly because reusing the scheduler's predicate would look like
the obvious reuse.

### 7.3 Expectedness governs completeness; membership governs the payload

Two separate questions, deliberately answered from different sources. A week is
*complete* based on its expected sessions (§7.1). The payload includes **every**
session in the week's date range with status `completed` or `skipped`, whether or
not it was expected — a session on an unexpected date (a deleted meso leaving
`mesocycle_id` null, a schedule change) is real training that happened and
belongs in the read. Conflating the two would either drop real sessions from the
analysis or let unexpected ones block completeness forever.

### 7.4 The candidate-week floor is derived from the daily cutoff, not pinned separately

SPEC §9 says nothing about a historical backlog for weeks (unlike daily SPEC §6,
which excludes one explicitly).

**Recommendation: `COACH_WEEK_ANALYSIS_START_WEEK =
weekKey(COACH_ANALYSIS_START_DATE)` = `'2026-08-17'`** — derived in code from the
existing constant, not hand-pinned a second time. Three reasons: it is not
arbitrary (it is the same "data from here is Coach-era" line already drawn);
that week has real data and is exactly the week worth reading first once it
resolves; and a second hand-converted timezone literal is one more thing to get
wrong.

**Consequence — corrected against the step 1 diagnostic (2026-08-20), not
speculated.** This section originally predicted "at ship, 'To analyze' will
list *several* weeks, not zero." That was wrong, and step 1's real-data check
(§6 step 1 note, below) is exactly why it exists — it caught this before
anything was built on the assumption. As of 2026-08-20, `2026-08-17` is the
**only** candidate week (today falls inside it), and it is not yet complete: 2
of its 5 expected sessions (Mon PUSH 1, Tue PULL 1) are done, and the remaining
3 (Thu PUSH 2 — today, not yet trained; Fri PULL 2; Sat LEGS) genuinely haven't
happened yet. **The real, corrected consequence: "To analyze" will most likely
ship empty and fill in within days**, once this week's remaining sessions are
completed or skip-marked — not "several weeks already available," and (per
step 1's finding (b)) not permanently empty either. The persona/tone-signal
point still stands, just on a several-day delay rather than immediately.

### 7.5 `week_start` is the Monday, enforced in the database

Monday-anchored, via the existing `weekKey` (`weightLogic.ts:20`), consistent
with this app's standing rule that meso-week arithmetic always uses
`weekStartsOn: 1` — never `differenceInWeeks`, which has no such option and
caused a real bug (CONTEXT.md, 2026-07-11). Enforced by a `CHECK`, not just
validated in code (§2.2), because `unique (user_id, week_start)` alone does not
prevent two overlapping "weeks".

**Like daily §5.2, this is the one decision here that is genuinely awkward to
change once rows exist** — it defines what a stored date means.

### 7.6 A week spanning a meso boundary is one analysis

`unique (user_id, week_start)` is what SPEC §4 asks for, so a calendar week that
straddles the end of one meso and the start of another produces **one** analysis
covering whatever happened. The payload's session roster carries `mesocycleName`
and `weekNumber` per session (§3.2), so the model can see and say that the week
spans a transition. The alternative — keying on (meso, week number) — would split
such a week into two partial analyses and contradict the spec's stated
uniqueness.

### 7.7 No cascade: a weekly analysis outlives deletion of its sessions

Daily §5.7 chose `on delete cascade` on `session_id` so an analysis dies with its
subject. A week has no single subject, so there is nothing to cascade from, and
`historyService.deleteSession()` is reachable from History.

**Decision: accept it.** A weekly write-up describes a week, not a row; a deleted
session does not make what was written about the other four false. And
`input_snapshot` preserves exactly what it was based on, so the record stays
readable in full. The alternative — a join table plus a trigger to delete the
parent when its last session goes — is a lot of permanent machinery for an event
that has not happened once in this app's history. Flagged because it is a
genuine, if defensible, inconsistency with the daily table's rule.

Note the interaction: deleting a session from an already-analyzed week cannot
make that week reappear in "To analyze" — the list diffs against existing
`week_start` values, not against completeness.

### 7.8 Skipped sessions appear in the payload's session roster

A week where Pull 2 was skipped is a materially different week from one where it
was trained, and the model should be able to say so. Skipped sessions carry no
set logs, so they contribute zero occurrences and zero buckets — but they appear
in `WeekAnalysisInput.sessions` with `status: 'skipped'`. Omitting them would
make a 3-of-4 week look indistinguishable from a 3-session program.

### 7.9 `movement_pattern` has no fallback; `muscle_subgroup` does

SPEC §5 defines the fallback for `muscle_subgroup` only — the coarse
`muscle_group` is a genuine, populated equivalent. There is no coarse equivalent
for `movement_pattern`, so an exercise with `movement_pattern IS NULL` simply
**does not appear on the pattern axis at all** (it still appears on the subgroup
axis, and in `occurrences`). Inventing an `'unknown'` pattern bucket would
present a coherent-looking bucket that is really just "everything I failed to
tag."

### 7.10 The subgroup vocabulary is app-layer; the pattern vocabulary is DB-enforced

`movement_pattern` gets a `CHECK` because SPEC §4 enumerates its seven values
exactly — the vocabulary is closed, so make it closed. `muscle_subgroup` does
not, because SPEC §4 gives examples rather than a list, and §4.3's proposal is
explicitly a proposal.

The asymmetry buys something concrete: adding a subgroup later is an `UPDATE`,
not a migration. It costs something too — a typo in migration 014 (`side_delts`
vs `side_delt`) produces a silently-wrong bucket with nothing to catch it, which
is exactly why §4.2's verification includes `select distinct
unnest(muscle_subgroup)`. That check is not optional.

### 7.11 No in-app tagging UI, and no change to `Exercise` / `exerciseService.ts` / Library

SPEC §9 defers both the tag-editing UI and tag-on-create. Corrections happen
through the batch process or a direct DB edit.

Worth stating the pleasant consequence: because the *only* reader of these
columns is the server-side week assembler, and that assembler cannot import the
browser `supabase` singleton anyway (§5.3), **the `Exercise` interface,
`exerciseService.ts`, `toMuscleGroup`, `ExerciseForm.tsx` and `LibraryPage.tsx`
all need no change at all.** New exercises fall back to `muscle_group` until a
future re-tagging pass, exactly as SPEC §9 says.

### 7.12 An occurrence is never dropped for want of a tag row

The tag query (§5.3) is filtered `.eq('user_id', userId)` for defence-in-depth,
consistent with every other query in this feature. But
`v2_program_exercises.exercise_id` has no user scoping in its FK, so it is
*structurally* possible for a set log to reference an `exercises` row the filter
excludes — in which case that occurrence would have no `muscleGroup` either, and
would vanish from **both** axes silently.

**Rule: an occurrence always appears in at least one bucket.** With no tag row it
lands in a bucket labelled `'untagged'` with `isFallback: true`, keeping its real
`exerciseName` (which comes from the set-log join in `assembleSessionFacts`, not
from this query). Vitest covers it (§6 step 4). The invariant matters more than
the label: silently dropping real training from the analysis is the worst
available outcome, and the only one that leaves no trace.

### 7.13 `exercises` is shared with Northstar v2, and that cannot be verified from here

Adding two nullable columns to a table another application also writes is a
cross-app change. The assessment: the columns are nullable with no default,
nothing outside this feature writes them, Northstar's inserts omit them and get
`NULL`, and a `select *` / re-upsert round-trip would carry them through
harmlessly. A generated-types file in that repo would go stale — a build-time
concern there, not a runtime break.

**This is an assumption, not a verified fact** — Northstar v2's source is not in
this repo and was not read. The mitigation is the form of the change itself
(§2.1's minimal-blast-radius shape, identical to how `muscle_group` was added to
this same shared table in 001) plus §2.4's step 6, which confirms no existing
row's data changed.

### 7.14 Bodyweight, warmups, and `thisWeek` — inherited, unchanged

Three daily decisions carry over with no new reasoning: bodyweight stays kg-only
in the payload and the UI (daily §5.8); warmup sets are excluded, and
`positionMatch.ts` already carries the flag through so it costs nothing (daily
§5.10); and only `resolveExerciseReference`'s `primary` slot is used, with
`thisWeek` ignored (daily §5.5).

The last one is worth a second look at *this* zoom level — `thisWeek` is exactly
"the other times you trained this exercise this week", which sounds relevant —
but it is redundant here: those occurrences are already **separately present** in
the week payload as their own occurrences. Including `thisWeek` too would
reintroduce precisely the duplication §1.4 exists to avoid.

### 7.15 The reference-log fetch is unbounded — measured here, not fixed here

`assembleAnalysisInput`'s reference-log query (`analysisInput.ts:302–313`) has no
`.limit()` or `.range()`: it fetches every set log for the session's exercises
across **every** historical same-workout-day session. Fine today (~28 sessions in
the account). At two years of training it is thousands of rows per
session-assembly, and the week path multiplies exposure by ~5. A silent PostgREST
row cap there would truncate the candidate set and produce a **wrong reference
resolution** — potentially reporting `first_time` for an exercise that has real
history.

**Not fixed in this feature**, for two reasons: the daily path has the identical
property and fixing it belongs there, and a naive `.limit(N)` is not
behaviour-preserving (if the newest N same-day sessions all lack a given
exercise, it would wrongly resolve `first_time` where an older session had it).
**Do instead:** record the real row counts during step 5's dry run — actual
numbers, not speculation — and act only if they are anywhere near a cap. Flagged
here so a future session finds the reasoning rather than rediscovering the query.

### 7.16 The persona/tone gap is inherited, not addressed

CONTEXT.md's "Pending feedback" records that daily output reads clinical rather
than "chill but knowledgeable coach", deliberately deferred to a future
`PROMPT_VERSION` bump once 4–5 real analyses exist to calibrate against.
`coachWeekPrompt.ts` will have the same gap for the same reason — writing a
persona instruction against zero weekly samples would be guessing. Its two hard
requirements (no blended metric, be selective) constrain content, not voice.
Revisit both prompts together once there is real output from each.

### 7.17 A paid-but-unsaved generation stays an accepted risk, at ~3× the cost

Daily §5.12's reasoning carries over unchanged: `unique (user_id, week_start)`
plus catching `23505` makes a duplicate request safe; the narrow window where the
Anthropic call succeeds and the insert never lands is accepted, with the same two
zero-cost mitigations (return the generated content in the error response rather
than discarding it, and log it server-side) and the same one genuinely
unrecoverable case (a hard `maxDuration` kill, where there is no response to
return anything in).

Two things differ and neither changes the decision: the loss per occurrence is
~3 cents rather than ~1.5, and the volume is *lower* (roughly one deliberate
click per week versus one per session). What does change is how much step 6's
latency number matters — the further real latency sits from the cap, the
narrower the unrecoverable window gets, and the margin here is thinner than
daily's.

---

## 8. New files, at a glance

```
supabase/migrations/
  013_v3_coach_week_analysis.sql            2   columns + table + RLS + index
  014_v3_exercise_tags.sql                  3   generated from the reviewed file

COACH-EXERCISE-TAGS.md                      3   the reviewed tagging artifact

src/features/coach/
  weekResolution.ts    + .test.ts           4   pure: expected sessions, completeness
  weekBuckets.ts       + .test.ts           4   pure: tag bucketing + fallback, no aggregates
  weekAnalysisInput.ts + .test.ts           5   the week payload (builder + thin fetch layer)
  coachApiAuth.ts                           7   shared auth/gate, extracted from analyze.ts
  coachWeekPrompt.ts                        7   WEEK_PROMPT_VERSION + system prompt
  coachWeekService.ts                       8b  analyzable weeks, list/detail, POST
  useCoachWeekAnalysis.ts                   8b  TanStack hooks
  CoachSessionAnalysisTab.tsx               8a  today's CoachAnalysisTab body, moved verbatim
  CoachWeekAnalysisTab.tsx                  8b  the two lists
  WeekAnalysisDetail.tsx                    8b  read-only write-up

api/
  coach/analyze-week.ts                     7

modified:
  src/features/coach/analysisInput.ts       5   extract assembleSessionFacts; export buildExercise
  src/features/coach/analysisInput.test.ts  5   cover the extracted seam
  src/features/coach/CoachAnalysisTab.tsx   8a  becomes the Session/Week sub-tab container
  api/coach/analyze.ts                      7   refactored onto coachApiAuth.ts
  src/types/index.ts                        3   tag types + week payload/content/row interfaces

unchanged, deliberately:
  vercel.json             api/** already covers the new function at maxDuration 60
  tsconfig.api.json       already include: ["api"]
  package.json            both SDKs already present; typecheck already covers both projects
  src/features/library/*  no tag UI in v1 (§7.11)
  src/types Exercise      no tag fields needed client-side (§7.11)
```

---

## 9. Open questions for review

Four things worth settling before step 3, in rough order of how expensive they
are to change later:

1. **The `muscle_subgroup` vocabulary (§4.3).** 22 values, and the granularity
   calls (chest thirds yes, biceps heads no) are judgment. This decides what
   buckets can ever exist, and changing it after tagging means re-tagging.
2. **The candidate-week floor (§7.4).** Deriving it from the daily cutoff means
   several weeks are immediately available at ship. If you would rather start
   clean from the week-feature's own ship date, that is a one-line change now
   and a permanent coverage gap later.
3. **`isolation` as a `movement_pattern` value (§4.3).** SPEC §4 lists it, so it
   ships; confirming the reading (accessories get `isolation` rather than a
   direction) before ~50 rows are tagged against that assumption is cheap.
4. **No cascade on the weekly table (§7.7).** The one place this plan is
   knowingly inconsistent with the daily table's rule. Reversing it later means
   a join table and a trigger, not a column change.

Nothing above has been built. Nothing is cleared to start until this document is
reviewed.
