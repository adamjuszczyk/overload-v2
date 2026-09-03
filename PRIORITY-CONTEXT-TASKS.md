# Overload — Priority Context — Technical Plan (v3, per-mesocycle, open items closed)

*Planning document. **Nothing here is built. No implementation code has been
written, no migration file exists, no SQL has been applied.** Read
PRIORITY-CONTEXT-SPEC.md first — that is the product source of truth; this
document is the technical answer to it. References of the form "daily §5.11"
point at COACH-ANALYSIS-TASKS.md; "weekly §4.3" at
COACH-WEEK-ANALYSIS-TASKS.md; "personalization §2.2" at
COACH-PERSONALIZATION-TASKS.md; "Q&A §8.3" at QA-SIDEBAR-TASKS.md.*

Written against the codebase as it actually stands on 2026-09-02 (last commit
`c3f8b96`, migrations `001`–`023` applied; 33 test files / 467 tests green).
Every claim below about existing code was read directly, not recalled.

---

## Revision note

**v1** designed priority as a single global live table edited in Coach →
CONTEXT, with per-meso history obtained indirectly by snapshotting the priority
set into each analysis's `input_snapshot`. **v2** replaced that entirely on
Adam's direction: priority is **scoped per mesocycle from creation**, set as
part of planning a meso, living in the planner. **v3 (this revision) closes
every open item v2 left**, so nothing outside the phase gates themselves is
still awaiting a decision.

| Section | v3 status |
|---|---|
| §0.1 findings 1–3 (vocabulary) | Unchanged since v1 |
| §0.2 planner investigation | **Extended** — findings 5 and 6 are new (offline, reachability) |
| §0.3 spec divergences | **Closed** — PRIORITY-CONTEXT-SPEC.md was edited directly; this section now records what changed rather than proposing it |
| §2 schema | Unchanged since v2 |
| §3 partition, scale, densifier | Unchanged since v1 — A1 approved, not rederived |
| §4 read interface | Unchanged signature; **§4.1 gains the copy hook** |
| §5 frontend | **§5.3 rewritten** (reachability); **§5.8 new** (the copy button) |
| §6 phases | **Updated** — Phase 0 no longer gates on Q1/A11; Phase 3 gains the copy and reachability checks |
| §7 | **Q1 and Q1a resolved and applied. A11 resolved from evidence. A9 downgraded to optional and recommended dropped.** Nothing in §7 is open |
| §8 no-history | Unchanged since v2 |

**Open items remaining: none.** Phase 0 is now a read-through rather than a
decision gate — see §6.

---

## 0. What already exists that this reuses — verified, not assumed

| Existing thing | Where | Reused how |
|---|---|---|
| `MUSCLE_SUBGROUPS` (22), `MUSCLE_SUBGROUP_GROUPS` (the 6-category partition), `MUSCLE_SUBGROUP_LABELS`, `muscleSubgroupLabel()` | `src/lib/exerciseTags.ts` | The subgroup half of the vocabulary, imported — never re-listed. §3.2's partition is *derived* from `MUSCLE_SUBGROUP_GROUPS` and Vitest-asserted set-equal to `MUSCLE_SUBGROUPS`, so the two can't drift. **No change to this file's existing exports.** |
| `MuscleGroup` (12 values) | `src/types/index.ts:7` | The muscle_group half. See §0.1 finding 1 — no canonical value list exists; this plan adds one. |
| `RatingScale<T>` shape | `src/features/gym/ratingScales.ts:9` | Shape copied for `PRIORITY_SCALE`, not the module imported — §0.1 finding 3. |
| Injected-`SupabaseClient` assembler convention | `analysisInput.ts:634`, `weekResolution.ts:182`, `qaContext.ts` | `fetchPriorityContext` (§4) follows it exactly, so a future `api/coach/analyze-meso.ts` can call it with no extraction pass. |
| Browser-singleton `*Service.ts` CRUD convention | `coachContextService.ts`, `coachMemoryService.ts` | `priorityService.ts`'s write path, verbatim shape. |
| TanStack hook convention (hoisted key constant, `enabled: !!user`, invalidate on success, **no optimistic updates**) | `useCoachContext.ts`, `useCoachMemory.ts`, `useWeekPlan.ts` | `usePriorityContext.ts`. See A5. |
| **`mesocycle_id uuid not null references v2_mesocycles(id) on delete cascade`** | `v2_week_plans`, `001_v2_schema.sql:67` | Copied exactly — §2.2 explains why cascade and not `set null`. |
| **Lazy per-meso row creation** | `v2_week_plans` / `fetchWeekPlans` (`weekPlanService.ts:67`) — rows are created on demand per (meso, day, week), never eagerly at meso creation | The direct precedent for §1.2's sparse storage. This app already treats meso-scoped planning data as "no row yet is a normal state," and PlanPage already renders that state correctly. |
| **Create-then-navigate** | `ProgramPage.tsx:70–75` — `const created = await createProgram.mutateAsync(...)` then `navigate('/program/' + created.id)` | §5.1's flow, verbatim shape — it is why no client-minted uuid is needed. |
| **Meso selector pattern** (`overrideMesoId ?? activeMeso?.id ?? mesos[0]?.id`) | `MesoProgress.tsx:188–193` | How the priorities screen reaches a *completed* meso — §5.3. |
| **COPY WEEK / copy-from-previous-unit** | `PlanPage.tsx:180–192`, `useCopyFromPreviousWeek`, `copyWorkoutFromPreviousWeek` | The precedent Q1's option C leans on — an explicit, one-tap copy from the previous unit, in this exact screen family. |
| `useOnlineStatus` + "REQUIRES A CONNECTION" | `src/hooks/useOnlineStatus.ts`, `CoachMemory.tsx:51–75` | See A11 — this is now a **planner** surface, not a Coach one, so the convention needs a decision rather than an inheritance. |
| Migration shape (`id`/`user_id`/RLS `for all`) | migrations 017, 018 | Migration 024 (§2.5), unchanged. |

### 0.1 Three findings from reading the vocabulary directly — unchanged from v1

**1. `exerciseTags.ts` does not own the muscle_group vocabulary — nothing
does.** SPEC §4 says tag_value comes from "the real vocabulary values from
exerciseTags.ts." True for the 22 subgroups; **not** for the 12 muscle_groups.
That module exports no `MUSCLE_GROUPS` and no `MUSCLE_GROUP_LABELS`. The list
exists only as `type MuscleGroup` (`src/types/index.ts:7`) plus **five verbatim
local copies** (`HistorySessions.tsx:16`, `library/ExerciseForm.tsx:13`,
`library/LibraryPage.tsx:11`, `programs/ExercisePicker.tsx:8`,
`progress/ExercisePicker.tsx:10`) and two more in tests. All agree and all
include `'other'`. This plan adds a canonical additive export and deliberately
leaves the five copies alone — their label maps have already diverged for real
layout reasons (`HistorySessions.tsx:24` renders `hamstrings: 'HAMS'`;
`ExerciseForm.tsx:27` renders `'HAMSTRINGS'`). Flagged as A7.

**2. There is no muscle_group → muscle_subgroup partition in this codebase.**
`MUSCLE_SUBGROUP_GROUPS` partitions all 22 cleanly but its outer level is 6
display categories, not the 12 groups. `MUSCLE_SUBGROUPS_BY_MUSCLE_GROUP` is
keyed by all 12 but is a **validity** map with deliberate overlaps — rendering
it gives **26 rows for 21 distinct subgroups**, and **`adductors` appears under
none of the 11 named groups**. SPEC §3's compositional semantic requires a
partition (a subgroup under two groups has two ceilings). §3.2 supplies one.
**A1, already approved — not rederived here.**

**3. `RatingChips.tsx` cannot be reused.** Its contract clears to `null` on
tapping the active chip (personalization SPEC §7's "absence is data too").
Priority has no absence. §5.4 builds a non-nullable sibling.

### 0.2 The planner investigation — what is actually there

This revision was gated on finding the real seam rather than guessing one.
Four things came out of it; the third is the one that changes the answer.

**1. Creating a mesocycle is a single-step form, not a wizard.**
`ProgramPage.tsx`'s START MESOCYCLE `BottomSheet` (`:203–280`) collects exactly
two things — an optional name and a program pick — and submits.
`useCreateMeso` (`useMesos.ts:24`) then does `completeAllActiveMesos(user.id)`
followed by one `createMeso(...)` insert. **There is no per-meso configuration
step of any kind today**, so there is no existing multi-step flow to slot a
priority page into as "step 2 of N." One is being added, not extended.

**2. `v2_mesocycles` is minimal.** `id`, `user_id`, `name`, `program_id`,
`status` (`'active' | 'completed'`), `start_date`, `end_date`, `created_at`
(`001_v2_schema.sql:49`). Standard `for all using (user_id = auth.uid())` RLS
(`002_v2_rls_policies.sql:28`). One active meso at a time, enforced in the
application layer, not the schema. Nothing about a meso is currently
configurable after creation except its `status`/`end_date`.

**3. Workout days belong to the *program*, not the mesocycle — so the literal
seam "near workout days" is the wrong lifetime.**
`v2_workout_days.program_id` (`001_v2_schema.sql:26`), configured on
`ProgramBuilderPage` (`/program/:programId`) under its `WORKOUT DAYS` heading
(`:117–120`), with the weekly schedule grid above it. **A program is reused
across mesocycles** — `v2_mesocycles.program_id` points at it, and the START
MESOCYCLE sheet's whole job is picking which existing program this new block
runs. Putting meso-scoped priority rows on a program-scoped screen would mean
the same screen showing different data depending on which meso is active, with
no meso named anywhere on it. **This is reported rather than worked around:
the literal reading of "in the program planner near workout days" points at
`ProgramBuilderPage`, and that page cannot hold this data correctly.** §5
proposes the seam that satisfies the intent — set as part of planning a meso —
without the lifetime mismatch.

**4. `PlanPage` (`/plan`) is meso-scoped but week-shaped, and active-only.**
It reads `activeMeso = mesos.find(m => m.status === 'active')` (`:41`) with **no
meso selector**, and its entire frame is a week (week nav, `WEEK n` badge,
`PAST WEEK — READ ONLY`). `WorkoutSwitcher` picks a workout day *within* the
viewed week. Two consequences: a completed meso's priorities could never be
reached here, which breaks the main consumer (Mesocycle Analysis runs on a
*completed* meso); and a meso-level property rendered inside a week-scoped UI
invites being read as per-week. Rejected as the primary home, but it is a good
place for a **link** — §5.3.

**5. Meso creation is already hard online-only — four independent
confirmations.** This was investigated to settle A11 rather than assumed from
the surrounding convention:

- `mesoService.createMeso` (`:49`) is a plain
  `supabase.from('v2_mesocycles').insert(...).select().single()`. No Dexie
  branch, no queue write, no offline path of any kind. Same for
  `completeAllActiveMesos`, which `useCreateMeso` calls first.
- `useCreateMeso` (`useMesos.ts:24`) has no `onMutate` and no offline branch —
  two sequential network writes, then `invalidateQueries`.
- **Nothing anywhere enqueues `v2_mesocycles`.** Grepped every `db.sync_queue`
  write site in the codebase: there are five, and the only tables that ever
  reach the queue are `v2_sessions` (`useSession.ts:360`, `:445`, `:570`),
  `v2_set_logs` (`:692`) and `v2_coach_notes` (`useCoachNotes.ts:48`). This
  matches CONTEXT.md's standing offline rule exactly — `useLogSet`,
  `useCreateSession`, `useCompleteSession`, `useSkipSession` — and
  `useCreateMeso` is not on that list.
- **Strongest of the four: the Dexie cache has no mesocycles table at all.**
  `db.ts`'s v2 schema stores `exercises`, `workout_days`, `week_plans`,
  `sessions`, `set_logs`, `sync_queue` — no `mesocycles`, no `programs`. A meso
  cannot even be *read* offline, let alone created.

`ProgramPage.tsx`, `useMesos.ts` and `mesoService.ts` contain **zero**
references to `useOnlineStatus`, `isOnline`, `isError`, `.error` or `catch`.

*Incidental, worth naming but not this feature's to fix:* because of that last
point, START MESOCYCLE offline today fails **silently and confusingly** rather
than with a message. `handleStartMeso` (`ProgramPage.tsx:45`) awaits
`createMeso.mutateAsync(...)` with no try/catch and no error UI, so the insert
rejects, `setShowStartMeso(false)` never runs, the sheet just sits there with
the button re-enabled, and the rejection surfaces only as an unhandled promise
rejection in the console. A pre-existing gap, unchanged by this feature, and
flagged here so it is on the record rather than discovered during Phase 3's
offline check.

**6. `/meso/:mesocycleId/priorities` is not redirect-only as designed — but the
one entry point that matters most was deferred.** v2's §5.3 already specified
two durable entry points on `ProgramPage` (a `PRIORITIES` button in
`ActiveMesoCard`'s footer, and making completed-meso list rows navigable), so
the route was never going to be reachable *only* by the post-creation redirect.
What v2 got wrong was deferring the **PlanPage** link out of v1: PlanPage is
where Adam actually is while planning a block week to week, its header already
names the active meso (`:133–135`), and it is the screen the whole per-meso
direction change pointed at. §5.3 is rewritten accordingly, and A9 is
downgraded as a consequence.

*One incidental finding, not acted on:* `fetchMesos()` (`mesoService.ts:41`)
has no `.eq('user_id', ...)` and relies on RLS alone, unlike every Coach
service's defence-in-depth convention. Not this feature's to fix, and not a
live bug (RLS is on); noted only because §4's new query sits next to it and
**will** carry the explicit filter.

### 0.3 The spec has been brought into line — closed, not outstanding

v2 flagged three places where this plan contradicted PRIORITY-CONTEXT-SPEC.md
and recommended editing the spec. **Adam approved that; the spec was edited
directly on 2026-09-02 and now matches this document.** What changed there:

- **§4** — the row key is now `(user, mesocycle_id, tag_type, tag_value)`, with
  an explicit note that a meso with no rows reads all-normal and needs no
  special handling (covering the in-progress meso and every meso predating the
  feature).
- **§4's history note** — the original flagged assumption ("v1 stores current
  priority only, no history") is **superseded rather than deleted**: replaced by
  an "On history" paragraph recording that per-meso scoping resolves the
  cross-meso case and that only within-meso churn stays unrecoverable, matching
  §8 here.
- **§5** — the surface is the planner, on a per-meso screen, not Coach →
  CONTEXT. §5 also now carries the blank-plus-explicit-copy decision (Q1) and
  the start-date definition of "previous meso" (Q1a).
- **§1 and §2's location wording** — "how much he *currently* cares" became
  "how much a given training block is meant to care"; §2's in-scope bullet now
  says the planner rather than Coach → CONTEXT. §1 keeps "Coach-wide context"
  with one clarifying clause: that phrase describes who *reads* the data, not
  where it lives.
- **§6** — Mesocycle Analysis's bullet now says it reads one specific meso's
  priorities, the completed block being analysed and never whichever meso is
  active. A new sentence notes that daily/weekly/planner will each have to
  decide which meso they mean — a question that did not exist before §4 became
  per-meso and is deliberately not answered there.

**§3 is untouched**, including the compositional semantic the spec says matters
most, and so is everything in §2's out-of-scope list. The spec carries a dated
revision note at the top saying exactly this. **A10 is closed.**

---

## 1. Tech approach, with reasoning per choice

### 1.1 One new table, no changes to any existing table

Same additive shape as 017/018/023, now with a second FK. Nothing writes to
`exercises`, `v2_set_logs`, or any shared table, so this stays clear of the
standing Northstar/Atlas shared-schema risk. Every `.from(...)` this feature
adds names exactly one table, `v2_coach_meso_tag_priorities`.

### 1.2 Sparse storage, dense reads — now per meso

The table stores **only rows Adam has actually set, for the meso he set them
on**. Every read returns the **complete 34-entry set for that one meso**, with
unset tags filled at `'normal'`.

**The current in-progress mesocycle needs no special handling.** A meso with no
rows densifies to all-normal, exactly like any other unset case — the existing
sparse-storage design already does the right thing here, and no fallback branch
is built for it. That is also true of every meso that existed before this
feature shipped: they simply read as all-normal forever, which is accurate
(nothing was ever stated for them).

This is not a novel pattern in this codebase. `v2_week_plans` rows are created
lazily per (meso, workout day, week) and never eagerly at meso creation
(`weekPlanService.ts:67`, `createWeekPlan` called on demand from PlanPage), so
"this meso has no rows yet for this thing" is already a normal, correctly
rendered state in the planner.

### 1.3 No endpoint, no AI, no money

This feature calls no model and adds no serverless function — which is why §6
is five phases rather than the nine the Q&A sidebar needed.

### 1.4 What is *not* being introduced

- **No history table**, and per-meso scoping now makes one much less
  interesting — §8.
- **No inference from volume.** SPEC §2 rules it out; nothing here reads a set
  log.
- **No prompt rendering.** This ships the *data* interface (§4). Turning it
  into prompt text — and stating §3's relative-within-group rule to the model —
  belongs to MESOCYCLE-ANALYSIS-TASKS.md.
- **No change to `useCreateMeso`'s mutation.** §5.1 chains a navigation after
  it; the insert itself is untouched.
- **No Zustand store.** §5.5.

---

## 2. Migration 024 — schema

### 2.1 `v2_coach_meso_tag_priorities` — one row per (user, meso, tag_type, tag_value)

Renamed from v1's `v2_coach_tag_priorities`: the meso scope is the defining
property of a row now, and a name that hides it would mislead every future
reader of the schema. Nothing is built on the old name — it exists only in v1
of this document.

### 2.2 `on delete cascade`, matching `v2_week_plans` and not `v2_sessions`

Both conventions exist against `v2_mesocycles` in this schema, and they encode a
real distinction:

- `v2_week_plans.mesocycle_id` → **`on delete cascade`** (`001:67`). Planning
  data has no meaning without its meso.
- `v2_sessions.mesocycle_id` → **`on delete set null`** (`001:97`). History
  outlives the meso it happened under — `useDeleteMeso`'s own comment
  (`useMesos.ts:45–52`) depends on exactly this.

Priority is planning data, not history: it is a statement of intent *for* a
block, meaningless once the block is gone. **Cascade.** Note that
`deleteMeso` only permits deleting a **completed** meso (`mesoService.ts:88`,
`.eq('status', 'completed')`), so this can never silently discard the active
block's priorities.

### 2.3 Which vocabularies get a DB `CHECK` — unchanged from v1

`tag_type` and `priority` are CHECK-constrained; `tag_value` is not. This
mirrors the asymmetry `exerciseTags.ts` documents and weekly §7.10 decided:
`movement_pattern` is DB-enforced by migration 013's CHECK, `muscle_subgroup`
deliberately is not. Putting 22 subgroup values in DDL would move ownership of
that vocabulary out of `exerciseTags.ts` and turn adding a 23rd into a
migration. `tag_type` (2 values) and `priority` (4) are closed, tiny, owned by
this feature alone, and load-bearing enough that a typo should fail loudly.

### 2.4 The default is enforced at three layers, not assumed by the UI

Unchanged from v1, now per meso:

1. **DDL** — `priority text not null default 'normal'`. No row can exist with
   an absent or unknown priority.
2. **`densifyPriorities()`** (§3.3) — a pure, Vitest-covered function turning
   any sparse row set into the complete 34-entry dense set. **This is where "no
   row yet = normal" actually lives**, and it is the same function whether the
   meso has 34 rows, 3, or none. Both the UI and every server-side consumer
   reach it through `fetchPriorityContext` (§4), so they cannot default
   differently.
3. **Types** — `muscleGroups` / `muscleSubgroups` are total `Record`s, so
   indexing them cannot yield `undefined`.

Each dense entry carries `isExplicit`, so "defaulted to normal" and
"deliberately set to normal *for this meso*" stay distinguishable downstream.
Under per-meso scoping this flag matters more than it did in v1, because it is
what Q1's prefill question turns on.

### 2.5 The migration, in full

**Proposed. Not written to disk and not applied — Phase 1 does both.**

```sql
-- Overload v3 — Priority Context: per-mesocycle, per-tag training priority.
-- One new table. No changes to any existing table.
-- PRIORITY-CONTEXT-SPEC.md §4, as revised per-mesocycle — see
-- PRIORITY-CONTEXT-TASKS.md §0.3 for the deliberate divergence from the
-- spec's global-row wording. Adam-set only: nothing in this feature or any
-- consumer writes here from a model (SPEC §2).

create table v2_coach_meso_tag_priorities (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,

  -- Priority is scoped to one training block. Cascade, matching
  -- v2_week_plans and deliberately not v2_sessions' set-null: this is
  -- planning intent, not history, and is meaningless without its meso
  -- (TASKS §2.2).
  mesocycle_id uuid not null references v2_mesocycles(id) on delete cascade,

  -- Which vocabulary tag_value belongs to (SPEC §4).
  tag_type     text not null check (tag_type in ('muscle_group', 'muscle_subgroup')),

  -- A value from src/lib/exerciseTags.ts (subgroups) or the MuscleGroup type
  -- (groups). Deliberately NOT CHECK-constrained — the same asymmetry
  -- migrations 013 vs 014 established and exerciseTags.ts documents, so the
  -- vocabulary stays owned by one module instead of half-copied into DDL.
  -- TASKS §2.3.
  tag_value    text not null check (length(btrim(tag_value)) > 0),

  -- SPEC §2's four levels. 'normal' is a real value, not an unset state —
  -- absence of a row is what means "not set for this meso" (TASKS §2.4), and
  -- the two stay distinguishable via isExplicit downstream.
  priority     text not null default 'normal'
                 check (priority in ('low', 'normal', 'high', 'top')),

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table v2_coach_meso_tag_priorities enable row level security;
create policy "Users access own rows" on v2_coach_meso_tag_priorities
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- One row per (user, meso, tag_type, tag_value). This is the upsert target,
-- not just an integrity guard (TASKS §2.6). user_id leads rather than
-- mesocycle_id so the index also serves any future "all of this user's
-- priority rows" read without a second index.
create unique index v2_coach_meso_tag_priorities_tag_uk
  on v2_coach_meso_tag_priorities(user_id, mesocycle_id, tag_type, tag_value);
```

No second index. The only read is "every row for this user and this meso,"
which the unique index's `(user_id, mesocycle_id, …)` prefix serves directly,
and the table's ceiling is 34 rows per meso. (`v2_week_plans` carries a separate
`mesocycle_id` index because its unique key leads with `mesocycle_id` and it is
also queried by meso alone; neither applies here.)

`updated_at` is set explicitly by the service on every write, matching
`coachMemoryService.ts` — no trigger, same as 018.

### 2.6 The unique constraint is the write path, not a hazard

`unique (user_id, mesocycle_id, tag_type, tag_value)` exists so the write is a
plain `upsert` with `onConflict`, making "set a priority" one idempotent
operation whether or not a row exists. A user action can never *unintentionally*
collide, so there is no `23505` message to translate the way
`coachContextService.ts:17` does for phases and weight entries.

### 2.7 Verification, before anything is built on it

Every check run for real, every mutating one scoped to Adam's own `user_id`,
per the standing SQL-Editor rule. All test rows deleted afterward and the table
confirmed empty at the end.

1. **Row-count baseline, taken *before* applying** (standing rule, added
   2026-09-01 after 023 skipped it): `count(*)` on every table 024's text
   references anywhere — now **`auth.users` and `v2_mesocycles`**, not just
   `auth.users`; the new FK is exactly the kind of reference that rule says to
   count rather than eyeball — plus
   `to_regclass('public.v2_coach_meso_tag_priorities')` confirming the table
   does not already exist. Both re-checked after applying, unchanged.
2. **Transport hash** (standing rule): `md5` and `length` of the applied DDL
   against the local file. 024 contains no long repetitive character runs (no
   `───` dividers, deliberately, given the migration-021 incident), so plain
   text transport is acceptable; the hash is still checked rather than assumed,
   and `getValue().length` is read immediately after `setValue` as the free
   pre-flight.
3. `information_schema.columns` — 8 columns, exact types, nullability, and both
   defaults (`gen_random_uuid()`, and `priority`'s `'normal'::text`).
4. `pg_class.relrowsecurity` + `pg_policies` — RLS live, exactly one `for all`
   policy with both `using` and `with check`.
5. `pg_indexes` — exactly two (pkey + `…_tag_uk`).
6. **Prove the unique constraint by violating it** — the same
   `(user_id, mesocycle_id, 'muscle_group', 'chest')` twice, expect `23505`.
7. **Prove the unique constraint is *meso-scoped*, not global** — the same
   `(user_id, 'muscle_group', 'chest')` against **two different**
   `mesocycle_id`s must both succeed. This is the one check that would catch a
   unique key accidentally written without `mesocycle_id`, which is the single
   most damaging possible typo in this migration.
8. **Prove each CHECK by violating it** — `tag_type = 'movement_pattern'`
   rejected; `priority = 'highest'` rejected; `tag_value = '   '` rejected.
9. **Prove the FK** — an insert with a `mesocycle_id` that doesn't exist is
   rejected (`23503`).
10. **Prove the cascade by actually deleting something** (standing discipline —
    prove behaviour, don't read it off the DDL): create a throwaway completed
    meso, add priority rows, delete the meso, confirm the rows are gone and
    that **no other meso's rows were touched**.
11. **Prove the default** — insert with no `priority` supplied, confirm
    `'normal'`.
12. **Prove the upsert** — `on conflict (user_id, mesocycle_id, tag_type,
    tag_value) do update` twice with different priorities; one row, second
    value.
13. **The orphan query** — any row whose `tag_value` is outside the 34-value
    vocabulary. Expected empty; recorded now so it exists as a known diagnostic.

**Gate: results reviewed. No code reads this table until then.**

---

## 3. Pure vocabulary module — `src/lib/priorityTags.ts`

**Unchanged from v1 and already approved (A1–A2). Not rederived here.** Nothing
in this module is meso-aware: it is vocabulary and structure, and the meso scope
lives entirely in the query (§4) and the row key (§2).

Same precedent as `exerciseTags.ts`, `setGroupLogic.ts`, `e1rm.ts`,
`ratingScales.ts`: pure, no React, no Supabase. Placed in `src/lib/` beside
`exerciseTags.ts` because it must be importable from a Vercel function; `.js`
import extensions throughout.

### 3.1 The scale

```ts
export type PriorityLevel = 'low' | 'normal' | 'high' | 'top'
export type PriorityTagType = 'muscle_group' | 'muscle_subgroup'

// RatingScale<T>'s shape (ratingScales.ts:9), not the module: ordered
// low → high, which is also the chip order. §0.1 finding 3 is why
// RatingChips.tsx itself is not reused.
export const PRIORITY_SCALE: {
  values: readonly PriorityLevel[]        // ['low','normal','high','top']
  labels: Record<PriorityLevel, string>   // 'LOW' | 'NORMAL' | 'HIGH' | 'TOP'
}

export const DEFAULT_PRIORITY: PriorityLevel   // 'normal'
```

### 3.2 The partition — `PRIORITY_TREE` (A1, approved)

Each of the 12 muscle_groups mapped to a **disjoint** set of subgroups, together
covering all 22 exactly once. Derived from `MUSCLE_SUBGROUP_GROUPS` by splitting
its `arms` category across biceps/triceps/forearms and its `legs` category
across quads/hamstrings/glutes/calves — not invented from anatomy.

| muscle_group | subgroups |
|---|---|
| `chest` | `upper_chest`, `mid_chest`, `lower_chest` |
| `back` | `lats`, `mid_back`, `lower_back`, `traps` |
| `shoulders` | `front_delt`, `side_delt`, `rear_delt` |
| `biceps` | `biceps`, `brachialis` |
| `triceps` | `triceps_long_head`, `triceps_lateral_head` |
| `forearms` | `forearms` |
| `quads` | `quads` |
| `hamstrings` | `hamstrings` |
| `glutes` | `glutes` |
| `calves` | `calves` |
| `core` | `abs`, `obliques` |
| `other` | `adductors` |

```ts
export const PRIORITY_TREE: Record<MuscleGroup, readonly MuscleSubgroupTag[]>

// Exact inverse of PRIORITY_TREE. Makes SPEC §3's relative-within-group
// semantic mechanically available to a consumer instead of something it has
// to re-derive — the "feed pre-computed data, don't make the model derive it"
// principle types/index.ts applies to dayOfWeek.
export const SUBGROUP_PARENT: Record<MuscleSubgroupTag, MuscleGroup>
```

### 3.3 The densifier

```ts
// Turns any sparse row set into the complete 34-entry set. THIS is where SPEC
// §4's "no row = normal priority" default actually lives (TASKS §2.4) — one
// named function, reached by every consumer through fetchPriorityContext, so
// the UI and a server-side reader cannot default differently.
//
// Meso-agnostic by design: the caller has already restricted rows to one
// mesocycle. Passing an empty array is the ordinary case for a meso nothing
// has been set on, not an error path.
//
// Rows whose tag_value is outside the 34-value vocabulary are ignored, never
// thrown on and never included: the dense set is always exactly 34 entries in
// PRIORITY_TREE order.
export function densifyPriorities(rows: StoredPriority[]): DensePriorities
```

### 3.4 Vitest — `src/lib/priorityTags.test.ts`

The drift guard is the point:

- `PRIORITY_TREE`'s keys set-equal the 12 `MuscleGroup` values.
- **`PRIORITY_TREE`'s flattened values set-equal `MUSCLE_SUBGROUPS` imported
  from `exerciseTags.ts`, each exactly once.** The test that fails the day
  someone adds a 23rd subgroup and forgets this file.
- `SUBGROUP_PARENT` is the exact inverse of `PRIORITY_TREE`.
- `PRIORITY_SCALE` has 4 values, ordered low→high, complete labels, no extras.
- `densifyPriorities([])` → 34 entries, all `'normal'`, all `isExplicit: false`,
  `anyExplicit: false`. **This is the "meso with no rows" case, tested as an
  ordinary input rather than an edge case** (§1.2).
- A partial row set overlays correctly and leaves the rest defaulted.
- **A row explicitly set to `'normal'` produces `isExplicit: true` and
  `anyExplicit: true`** — an explicit normal is not a default.
- An unknown `tag_value`, and an unknown `tag_type`, are each ignored: still
  exactly 34 entries, no throw.
- Output order is deterministic (`PRIORITY_TREE` order), so two mesos' contexts
  diff readably against each other.

---

## 4. The read interface — `fetchPriorityContext`

**This section is the contract MESOCYCLE-ANALYSIS-TASKS.md will cite as an
already-built thing, and the signature is settled here rather than later.**

**File:** `src/features/coach/priorityContext.ts`

```ts
fetchPriorityContext(
  client: SupabaseClient,
  userId: string,
  mesocycleId: string,
): Promise<PriorityContext>
```

`mesocycleId` is **required and non-nullable**. Making it optional — "omit for
the active meso" — was considered and rejected: it would smuggle the old
"current priority" semantics back into a per-meso interface, and Mesocycle
Analysis by definition runs against a *completed* meso, which is never the
active one. A caller that wants the active meso's priorities resolves the id
itself and passes it, the same way `useWeekPlans(activeMeso.id, week)` already
does throughout the planner.

Injected client, never the browser singleton (`src/lib/supabase.ts` throws at
module load outside a Vite app — the risk `analysisInput.ts`'s header
documents). So this is callable unmodified from `api/coach/analyze-meso.ts` the
day that file exists, from the planner through `usePriorityContext()`, and from
a zero-spend browser dry run before either. It is one query
(`.eq('user_id', userId).eq('mesocycle_id', mesocycleId)` — both filters
explicit, defence-in-depth alongside RLS, per the Coach service convention and
unlike `fetchMesos`, §0.2) and one pure call.

```ts
export interface PriorityEntry {
  tagType: PriorityTagType
  tagValue: string           // a MuscleGroup value, or a MuscleSubgroupTag value
  priority: PriorityLevel
  isExplicit: boolean        // false = no row for this meso; this is the default
  updatedAt: string | null   // null exactly when isExplicit is false
}

export interface PriorityContext {
  // Which block these priorities are for. Carried so a payload or stored
  // snapshot is self-identifying and two contexts can never be silently
  // confused for one another.
  mesocycleId: string

  // Total records — indexing either can never yield undefined. Always all
  // 12 / all 22, whether or not any row exists for this meso. O(1) lookup for
  // a consumer that walks buckets and asks "what is this one's priority?"
  muscleGroups: Record<MuscleGroup, PriorityEntry>
  muscleSubgroups: Record<MuscleSubgroupTag, PriorityEntry>

  // SPEC §3's compositional key, travelling with the data. A consumer applying
  // subgroup priority as relative-within-group needs the parent, and embedding
  // it means a stored payload stays interpretable regardless of what
  // priorityTags.ts says later.
  subgroupParent: Record<MuscleSubgroupTag, MuscleGroup>

  // All 34, flat, in PRIORITY_TREE order — for serialising into a payload,
  // where a stable order makes two mesos' contexts diffable.
  entries: PriorityEntry[]

  // False = nothing was ever set for THIS meso. Distinct from "everything is
  // normal": it lets MESOCYCLE-ANALYSIS-SPEC.md §1's "treat everything as
  // normal priority rather than blocking" be a real branch — omit the priority
  // reasoning entirely — instead of feeding the model 34 defaults it will read
  // as 34 stated preferences. Every meso that predates this feature reads
  // false here, forever, which is accurate.
  anyExplicit: boolean
}
```

**Four notes for MESOCYCLE-ANALYSIS-TASKS.md, so they aren't rediscovered
there:**

1. **Pass the analysed meso's id, not the active one.** The analysis runs on a
   completed block; `activeMeso` at that moment is a *different, later* meso, and
   under the old global design this distinction did not exist to get wrong.
2. **§3's semantic is data here, prose there.** `subgroupParent` makes
   relative-within-group *computable*; it does not make the model apply it. The
   prompt must state the rule — SPEC §3 names itself as the thing most likely to
   be misused by a consumer that skips it.
3. **`anyExplicit === false` is a branch, not a value.** Especially now: every
   pre-existing meso reads false.
4. **Snapshotting it is now provenance, not the history mechanism.** Under v1
   the `input_snapshot` copy was load-bearing (it was the only per-meso record
   that would ever exist). It is still worth including for the same reason every
   other Coach analysis snapshots its input — reproducibility — but §8 no longer
   depends on it.

### 4.1 The browser hooks — `src/features/coach/usePriorityContext.ts`

```ts
const PRIORITY_CONTEXT_KEY = (mesocycleId: string) =>
  ['v2_coachMesoTagPriorities', mesocycleId]

export function usePriorityContext(mesocycleId: string | null)
  // useQuery, enabled: !!user && !!mesocycleId,
  // calls fetchPriorityContext(supabase, user.id, mesocycleId)

export function useSetTagPriority(mesocycleId: string)
  // useMutation({ tagType, tagValue, priority }),
  // invalidates PRIORITY_CONTEXT_KEY(mesocycleId) on success
```

**The query key is parameterised by meso.** This is not cosmetic: a flat key
would serve one meso's cached priorities to another meso's screen the moment
Adam views two of them in one session — exactly the surface Q&A §8.3's whole
ownership-bug class lives on. `useWeekPlans(mesoId, weekNumber)` already keys by
meso for the same reason; this follows it. A per-meso key also makes
invalidation naturally scoped: writing to meso A cannot blank meso B's cache.

The write lives in `priorityService.ts`
(`setTagPriority(userId, mesocycleId, tagType, tagValue, priority)`, a
browser-singleton upsert setting `updated_at`), matching the existing split
between injected-client assemblers and singleton CRUD services.

**Q1 resolved to the explicit-copy option, so a second pair ships alongside:**

```ts
export function usePreviousMeso(mesocycleId: string | null)
  // Derived from the existing useMesos() cache — no new query. The user's meso
  // with the greatest start_date, excluding the target, tie-broken by
  // created_at desc (Q1a). Returns null when there is no prior meso.

export function useCopyPrioritiesFromMeso(mesocycleId: string)
  // useMutation({ fromMesocycleId }), invalidates PRIORITY_CONTEXT_KEY(mesocycleId)
```

backed by `copyPrioritiesFromMeso(userId, fromMesocycleId, toMesocycleId)` in
`priorityService.ts`. §5.8 specifies its semantics.

---

## 5. Frontend structure

§0.2 finding 3 is the constraint: the literal seam is program-scoped and cannot
hold meso-scoped rows. What follows satisfies the actual requirement — priority
is set as part of planning a meso, and lives in the planner — without that
mismatch.

### 5.1 The seam: create-then-configure, mirroring an existing pattern in the same file

`ProgramPage.tsx` already contains exactly this flow for programs
(`handleCreateProgram`, `:68–75`):

```
create the row → take the returned id → navigate to its configuration screen
```

Mesos get the same treatment. `handleStartMeso` (`:45–51`) currently ends with
`setShowStartMeso(false)`; it gains one navigation to the new priorities screen,
using the id `createMeso.mutateAsync` already returns. **The START MESOCYCLE
sheet itself is not touched** — no new fields, no wizard steps, and the meso row
is real before any priority row references it, so no client-minted uuid is
needed.

The sheet is the wrong place for the selectors themselves regardless: it is a
compact `maxHeight: '85dvh'` bottom sheet (`:437`) built for two inputs, and 12
groups plus up to 34 selectors inside it would be unusable on a phone.

### 5.2 New screen — `MesoPrioritiesPage.tsx`, route `/meso/:mesocycleId/priorities`

A new route beside the existing `/program/*` family in `App.tsx` (`:101–103`).
Meso-scoped, so it is addressable for **any** meso — active or completed — which
is what makes it usable both at creation time and later, when Adam wants to see
what Mesocycle Analysis will read.

Contents:

- Header naming the meso (`meso.name`, its program, its start date — the same
  three facts `ActiveMesoCard` shows), so the screen can never be mistaken for a
  program-level or global setting.
- The `PRIORITY_TREE` rendered in order: for each of the 12 muscle_groups, a row
  with the group's label and its own `PrioritySelector`; expanding a group
  reveals its subgroups nested beneath, each indented with its own selector.
  Collapsed by default — 34 selectors at once on a phone is unusable, 12 rows is
  scannable. The group's own selector stays visible whether expanded or not,
  since SPEC §3 makes the group the ceiling and therefore the thing read first.
- A DONE / back affordance. It returns to wherever the screen was entered from
  (creation → `/program`; §5.3's PlanPage link → `/plan`; the completed-meso
  row → `/program`), so the screen doesn't strand the user on a page they
  didn't come from now that it has more than one entrance.
- §5.8's COPY FROM «previous meso» button, above the list, on the conditions
  §5.8 specifies.

**Reached from the creation flow (§5.1), and independently from §5.3's entry
points.** Nothing about it is modal or one-shot: priorities stay editable for
the whole meso, which the spec never restricted and which matters because Adam
may only realise a block's emphasis a week in.

### 5.3 Entry points — the screen is a real destination, not a landing spot

Two durable entry points ship in v1. Between them, every meso the app can show
— the active one and every completed one — has a standing route to its
priorities that does not depend on having just created it.

**1. `PlanPage`'s header — the primary route to the active meso's priorities.
In v1, promoted from v2's deferral (§0.2 finding 6).** The header's first line
is already the meso's name (`:133–135`) — a 9px mono `<p>` above the `PLAN`
h1, currently inert. It becomes a tappable row: meso name on the left, a
`PRIORITIES ›` affordance on the right, the row given a real touch target
rather than relying on the 9px text itself. This is the right place because it
is where Adam is while planning a block, it needs no new layout region, and the
meso name is already the thing on screen that identifies which block the
priorities would belong to.

The header row navigates to `/meso/{activeMeso.id}/priorities` — the same
`activeMeso` PlanPage already resolves at `:41`, so no new query and no new
state.

**2. The completed-meso list** (`ProgramPage.tsx:124–155`) — rows currently
carry only a delete button. Making the row itself navigate to its priorities
screen is the only way to reach a **finished** block's settings, which is
exactly the case Mesocycle Analysis cares about. `MY PROGRAMS` rows on the same
page already navigate on tap, so the interaction is not new to the screen.

**`ActiveMesoCard`'s footer — no longer needed, and recommended dropped.**
v2 proposed a third `PRIORITIES` button there and flagged the cramped
three-way split as A9. With PlanPage carrying the active meso's link, that
button is redundant: the active meso is reachable from PlanPage, completed
mesos from the list above, and a brand-new meso lands on the screen directly.
Dropping it removes the one place this feature would have changed an existing
component's *layout* rather than adding to it. A9 is kept in §7 as an optional
extra rather than deleted, since it was Adam's to approve and adding it later
costs one button.

**Considered and not used:** `MesoProgress`'s `<select>` meso selector
(`:260–283`) covers every meso including completed ones and would technically
work as a third entry point — but Progress is an analytics surface, and a
settings link there would put a write affordance on a read-only screen.
Its `overrideMesoId ?? activeMeso?.id ?? mesos[0]?.id` pattern remains the
precedent for resolving "which meso" without a route param, which the route
param makes unnecessary here.

### 5.4 `PrioritySelector.tsx` — unchanged from v1

The 4-way chip row. Modelled on `RatingChips.tsx` (44px targets,
`hide-scrollbar` horizontal overflow, `--accent` on the active chip, every
colour via CSS custom properties, `var(--font-mono)`) but with a **non-nullable**
contract: `onChange(value: PriorityLevel)`, exactly one chip always active,
tapping the active chip is a no-op. §0.1 finding 3 is why it is a sibling rather
than a prop on the shared component.

A defaulted row (`isExplicit === false`) shows `NORMAL` active, identical to an
explicitly-set normal (A4, approved).

### 5.5 State split

Per the standing rule — TanStack Query owns all Supabase data, Zustand owns UI
state only, never mixed:

| State | Owner | Why |
|---|---|---|
| The 34-entry `PriorityContext` for this meso | **TanStack Query**, `usePriorityContext(mesocycleId)` | Supabase data. Keyed by meso — §4.1. |
| The meso itself (name, program, dates) | **TanStack Query**, the existing `useMesos()` | Supabase data, already cached; no new query. |
| Writing one priority | **TanStack Query**, `useSetTagPriority(mesocycleId)` | Supabase data. |
| Which groups are expanded | **Local `useState`** (a `Set<MuscleGroup>`) | UI state that does not outlive the component or cross into another one. |

**Local `useState`, not Zustand — this project's actual convention, not a
shortcut.** Zustand here is for UI state shared across components or surviving
unmount (`qaSidebarStore`, `restTimerStore`, `settingsStore`, `offlineStore`);
single-component view state uses `useState`, as `PlanPage.tsx:52–56` does for
`selectedDow`/`compact` and `CoachMemory.tsx` does for `showExpired`. Expanded-
group state is the second kind.

### 5.6 No optimistic update — and why that is a decision here

`useCoachContext.ts`'s header states the convention outright ("no optimistic
updates"), and it holds here for a reason beyond consistency: **this data is
read by an AI analysis, so a chip that moves before the write lands would let a
silently-failed upsert show a priority that was never stored.** The query is one
`select` over ≤34 rows. Flagged as A5 (approved) — if the lag is perceptible at
Phase 3's live check, an `onMutate`/`setQueryData` path with rollback is the fix,
decided there against the real thing.

### 5.7 Offline — online-only, settled by evidence (A11, resolved)

v2 left this open because v1's answer had been inherited from the Coach
convention and that inheritance no longer applied. §0.2 finding 5 settles it
from the code rather than from convention: **meso creation is already hard
online-only** — no Dexie branch, no queue write, `v2_mesocycles` never enqueued
anywhere, and no `mesocycles` table in the Dexie cache at all, so a meso cannot
even be read offline.

**So the priorities page being online-only is strictly consistent with the flow
that creates it, not a new limitation being introduced.** There is no version of
this feature that could work offline without first giving mesocycles offline
support, which is a much larger change to a different feature. **A11 approved:
no offline support, no Dexie bump, no sync-queue change.**

**And no "REQUIRES A CONNECTION" card either** — that card is the Coach
convention (`CoachMemory.tsx:51–75`); the planner screens this now sits beside
show nothing of the kind. A failed write surfaces as the mutation's own error
state. Note the caveat from §0.2 finding 5: `ProgramPage`'s existing meso
mutations surface *no* error state at all today, so "the same as
`useCreateMeso`'s" is a low bar — this feature's own selector and copy button
should show their mutation errors rather than copying that gap. Phase 3's
offline check verifies the screen degrades visibly rather than silently.

### 5.8 The COPY FROM «previous meso» button (Q1 resolved — option C)

**Q1 resolved: a new meso starts blank at all-normal, plus an explicit one-tap
copy. Q1a resolved: "previous meso" is ordered by `start_date`.** Both applied
here and in the spec's §5.

The named precedent is PlanPage's COPY WEEK, and reading it settled the one
design question the copy still had — what happens when the destination already
has data. **It never does:** `showCopyButton` (`PlanPage.tsx:89`) gates the
button on `weekPlans.length === 0`, so COPY WEEK is only ever offered into an
empty destination. There is no overwrite path, no confirm dialog, and no delete.

Priorities take the same shape:

- **Visibility.** The button appears only when `anyExplicit === false` for this
  meso **and** a previous meso with at least one priority row exists. It
  disappears the moment anything is set. So there is no overwrite semantics to
  design, exactly as with COPY WEEK.
  - One deliberate tightening over the precedent: COPY WEEK gates on the
    *destination* only, so tapping it when the previous week happens to be empty
    is a silent no-op (`copyFromPreviousWeek` returns early at `:212`). Gating
    on the source having rows too costs nothing here — `usePreviousMeso` is
    derived from the already-cached `useMesos()` list and the source's rows are
    one query — and avoids offering a button that does nothing.
- **What gets copied: the source's *explicit rows only*, verbatim — never the
  dense 34.** Copying the densified set would write ~30 explicit `normal` rows
  that were never stated, manufacturing precisely the stated-preference data
  Q1's option C was chosen to avoid. `copyFromPreviousWeek` follows the same
  principle: it copies `prevSets`, what actually exists, not a materialised
  full week.
- **Source resolution (Q1a).** The user's meso with the greatest `start_date`,
  excluding the target, tie-broken by `created_at desc`. `start_date` and not
  `created_at` because it is what the planner already treats as a meso's
  position in time — `ActiveMesoCard` displays it, `computeWeekNumber` derives
  from it, `MesoProgress` labels mesos by it. `fetchMesos()` happens to *order*
  by `created_at desc`, which is a list-ordering choice, not a statement about
  which block came first.
- **Label.** The button names the source (`COPY FROM «Summer Block»`), not just
  "previous meso" — with `usePreviousMeso` returning the row, the name is free,
  and it makes a copy from the wrong block visible before the tap rather than
  after.
- **Placement.** Above the group list on `MesoPrioritiesPage`, in the same
  full-width dashed-border style COPY WEEK uses (`PlanPage.tsx:179–192`).
- **Not idempotent-by-accident:** the write is the same upsert
  `setTagPriority` uses, keyed on
  `(user_id, mesocycle_id, tag_type, tag_value)`, so even a double-tap before
  the invalidate lands cannot produce duplicate rows.

---

## 6. Implementation order — approval-gated phases

Same phase-gate discipline as the last five initiatives. **Nothing in a later
phase starts until the prior phase's gate is explicitly approved.**

**Still five phases.** The move to per-meso scoping changes what the phases
contain, not how many there are: no model call, no endpoint, no prompt, no cost,
one new screen. The Q&A sidebar needed nine because it had a production
diagnostic, a zero-spend dry run, a real-call cost measurement, a prompt, an
endpoint, and two frontend surfaces.

### Phase 0 — Final read-through. No code, no decisions outstanding.

**Nothing in §7 is open any more.** Q1 and Q1a are resolved and applied (§5.8),
A11 is resolved from evidence (§5.7), A10 is closed by editing the spec (§0.3),
A9 is downgraded to an optional extra and recommended dropped (§5.3), and A1–A7
were approved at v2. This phase is Adam confirming the closed set reads the way
he intended — particularly §5.8's copy semantics and §5.3's two entry points,
both of which are new since he last read this document.

No read-only diagnostic phase: there is no existing table and no reuse claim
about production behaviour left untested — §0.2's six findings were all read
directly from the code. The one production read the standing rule requires (the
row-count baseline, now covering `v2_mesocycles` too) belongs to Phase 1.

**Gate: §5.3 and §5.8 confirmed. A9's optional extra taken or dropped.**

### Phase 1 — Migration 024.

Write `024_v3_coach_meso_priority_context.sql`, apply it, run **all thirteen**
§2.7 checks for real — including the pre-apply baseline on both referenced
tables, the transport hash, the meso-scoped-uniqueness check (#7), and the
cascade proven by actually deleting a throwaway meso (#10). Commit the migration
on its own.

**Gate: §2.7's results reviewed. No code reads this table until then.**

### Phase 2 — Pure module, service, hooks. Vitest.

`src/lib/priorityTags.ts` (§3) with `priorityTags.test.ts` (§3.4); the additive
`MUSCLE_GROUPS` / `MUSCLE_GROUP_LABELS` exports on `exerciseTags.ts` (§0.1
finding 1) with assertions in the existing `exerciseTags.test.ts`;
`priorityContext.ts` (§4); `priorityService.ts` **including
`copyPrioritiesFromMeso` (§5.8)**; `usePriorityContext.ts` (§4.1) **including
`usePreviousMeso` and `useCopyPrioritiesFromMeso`**. No UI yet.
`npm run typecheck` (both tsconfigs) + `npm test` green.

`usePreviousMeso`'s selection rule (Q1a) is pure and derived from an array, so
it gets **real Vitest coverage rather than only a live check**: greatest
`start_date` wins; the target meso is excluded even when it is the newest; a
`created_at desc` tie-break applies when two mesos share a `start_date`; `null`
when there is no prior meso. That last case is what hides the copy button, so
it is worth a test rather than a hope.

Then, before any UI exists, **run `fetchPriorityContext` against production
read-only** via the browser dry-run technique, scoped to Adam's `user_id`,
**against his real active meso's id**: confirm 34 entries, all defaulted,
`anyExplicit: false`, `mesocycleId` echoed correctly. The cheapest possible test
of the interface §4 promises Mesocycle Analysis — run before anything depends on
it, and it doubles as the live proof of §1.2's "a meso with no rows just
densifies to all-normal, no special handling."

**Gate: tests green, and the dense-read shape confirmed against a real meso in
production rather than only against fixtures.**

### Phase 3 — Frontend, and live verification.

`PrioritySelector.tsx`, `MesoPrioritiesPage.tsx` (including §5.8's copy
button), the route in `App.tsx`, the navigation added to `handleStartMeso`, and
§5.3's two entry points — PlanPage's header row and ProgramPage's completed-meso
rows. Live browser verification against the real account is a **hard gate**
(standing rule — confirm browser tooling is available *before* starting this
phase, not when the step is reached):

- All 12 groups render, collapsed, each defaulting to NORMAL.
- Expanding a group shows exactly its `PRIORITY_TREE` subgroups — and all 22 are
  reachable across the 12 groups, **`adductors` included** (§0.1 finding 2 is
  precisely the bug this catches).
- Setting a group priority persists — verified in the database, not just on
  screen — **with the correct `mesocycle_id`**.
- Setting a subgroup priority persists and does not disturb its parent.
- Re-setting the same tag updates the row rather than creating a second
  (the upsert proven through the real UI, not only in SQL).
- Setting a tag back to `normal` persists as an explicit row — it does not
  delete the row and revert to defaulted.
- **Per-meso isolation, the headline new check:** set a priority on the active
  meso, open a *completed* meso's priorities screen, confirm it still reads
  all-normal and that the two screens' caches do not bleed into each other
  (§4.1's parameterised query key is what this tests).
- **The creation flow end to end:** START MESOCYCLE → lands on the new meso's
  priorities screen → the screen names the right meso → rows written carry the
  new meso's id.
- **Reachability (§5.3), the check that this is a destination and not a landing
  spot:** reach the active meso's priorities from PlanPage's header **without
  going through creation**, and reach a completed meso's from ProgramPage's
  list. Then hard-reload directly on `/meso/:id/priorities` and confirm it
  renders standalone — a route only ever entered via client-side navigation can
  hide a missing data dependency.
- **The copy button (§5.8), all four states against real data:** hidden when
  the meso already has explicit rows; hidden when no previous meso exists;
  visible and correctly **naming the source meso** otherwise; and, when tapped,
  writing exactly the source's explicit rows — **verified in the database as a
  row count, not just on screen**, since the whole point of option C is that it
  must not write the dense 34.
- **Q1a's ordering against real mesos:** confirm the source offered is the meso
  with the greatest `start_date`, not the most recently created — Adam's real
  meso list is the only place this distinction can actually be observed.
- Reload: every set value survives; untouched tags still show NORMAL.
- **Offline (A11/§5.7):** with the network off, the screen fails *visibly* —
  the query's error state or an empty state, not a silent blank — and a
  selector tap surfaces its mutation error rather than appearing to succeed.
  This is the one behaviour §5.7 asks this feature to do better than the
  surrounding meso mutations, so it is checked rather than assumed.
- A5: is the write round-trip perceptible? Decide optimistic-vs-not here.

Writes here are Adam's own real settings on his real meso, so there is nothing
to clean up — but §2.7's orphan query is re-run at the end to confirm nothing
unexpected landed.

**Gate: live verification passed, with screenshots.**

### Phase 4 — Adversarial review, deploy, CONTEXT.md.

Independent adversarial review of the whole feature; fixes; `npm run typecheck`
/ `npm test` / `npm run build`; commit; deploy; confirm the deploy actually
shipped (`vercel ls` / `vercel inspect`, not just a successful push);
live-verify in production; update CONTEXT.md — recording §4's interface as the
real, citable thing MESOCYCLE-ANALYSIS-TASKS.md may now depend on, **including
the required `mesocycleId` argument**.

**Gate: reviewed and approved before push.**

---

## 7. Decisions and assumptions — nothing here is open

Every item v2 left outstanding is resolved below. §6's Phase 0 is a
confirmation read, not a decision gate.

### Q1 — Blank, plus an explicit copy. **Resolved; applied in §5.8.**

A new meso starts blank at all-normal and offers a one-tap
**COPY FROM «previous meso»**, in PlanPage's COPY WEEK shape. Automatic prefill
was rejected for the reason v2 gave: a prefilled row is `isExplicit: true` but
was never stated for that block, so a priority set once in February would read
to the model in June as a fresh declaration — the exact distinction SPEC §1
exists to preserve. Making the copy a deliberate tap keeps `isExplicit`
truthful with no third state.

Reading COPY WEEK settled the one question the copy still had: **the
destination is never non-empty.** `showCopyButton` (`PlanPage.tsx:89`) gates on
`weekPlans.length === 0`, so there is no overwrite path, no confirm dialog and
no delete. Priorities take the same gate — see §5.8 for the full semantics,
including the one place this deliberately tightens on the precedent.

### Q1a — `start_date`. **Resolved; applied in §4.1 and §5.8.**

"Previous meso" is the user's meso with the greatest `start_date`, excluding
the target, tie-broken by `created_at desc`. `start_date` and not `created_at`
because it is what the planner already treats as a meso's position in time
(`ActiveMesoCard` displays it, `computeWeekNumber` derives from it,
`MesoProgress` labels by it); `fetchMesos()`'s `created_at desc` is a
list-ordering choice, not a claim about which block came first. Vitest-covered
as a pure selection rule — see Phase 2.

### Assumptions

**A1–A7 are unchanged from v1 and already approved. They concern the tag
vocabulary, the partition, and selector/UI conventions — none of which the move
to per-meso scoping touched — and are not rederived here.** Restated in one line
each for reference only:

- **A1** — the `PRIORITY_TREE` partition (§3.2). *Approved.*
- **A2** — `adductors` filed under `other`. *Approved.*
- **A3** — `other` gets a priority row like any other group. *Approved.*
- **A4** — defaulted and explicitly-normal look identical in the UI. *Approved.*
- **A5** — no optimistic update on the selector. *Approved; revisited at Phase
  3's live check.*
- **A6** — section ordering. *Approved; moot in its original form (there is no
  Coach → CONTEXT section any more) and superseded by §5.2's screen layout.*
- **A7** — the five duplicated `MUSCLE_GROUPS` copies are left alone.
  *Approved.*

**A8 — retired at v2.** It asked whether priority should be global or
per-mesocycle and assumed global. Answered: per-mesocycle. The whole revision is
that answer.

**A9 — `ActiveMesoCard`'s third footer button: downgraded to optional, and
recommended dropped.** v2 proposed `COMPLETE MESO | PRIORITIES | NEW MESO` and
flagged the cramped three-way split of a footer sized for two. §5.3's PlanPage
entry point makes it redundant — the active meso is reachable from PlanPage,
completed mesos from ProgramPage's list, and a new meso lands on the screen
directly — so dropping it removes the one place this feature would have changed
an existing component's *layout* rather than adding to it. **Recommendation:
drop.** Kept here rather than deleted because it was Adam's to approve and
adding it later costs one button.

**A10 — closed.** The spec was edited directly; §0.3 records exactly what
changed there. No divergence remains between the two documents.

**A11 — resolved from evidence, not convention: online-only, no offline
support, no "REQUIRES A CONNECTION" card.** v2 could only recommend this from
the surrounding planner convention. §0.2 finding 5 settles it from the code:
**meso creation is already hard online-only** — no Dexie branch, no queue
write, `v2_mesocycles` never enqueued anywhere, and no `mesocycles` table in
the Dexie cache at all, so a meso cannot even be *read* offline. The priorities
page being online-only is therefore consistent with the flow that creates it,
not a new limitation. There is no version of this feature that could work
offline without first giving mesocycles offline support — a much larger change
to a different feature, and not in scope here. **No Dexie bump, no sync-queue
change.**

One caveat carried into §5.7 rather than waved through: the existing meso
mutations surface *no* error state at all when they fail offline
(§0.2 finding 5's incidental note), so "consistent with `useCreateMeso`" is a
low bar. This feature's own selector and copy button should show their mutation
errors, and Phase 3 checks that the screen degrades visibly rather than
silently.

---

## 8. SPEC §4's flagged "no history" limitation — largely answered by per-meso scoping

**v1's answer is superseded.** It argued that a single global mutable row per
tag was the right shape, that the resulting loss of history was a real
one-directional cost, and that snapshotting the priority set into each
analysis's `input_snapshot` was the mitigation. **Per-meso scoping replaces that
argument rather than refining it.**

**What the new shape gives directly.** SPEC §4's own worry was: *"If a future
consumer needs to reason about 'this was only deprioritized in the back half of
the meso,' that's a real limitation."* Under per-meso rows, "what were my
priorities during meso X" is answerable **forever, by one query, for every meso
that ever had rows** — not reconstructed from an analysis payload, and not
dependent on an analysis ever having been run. That is the bulk of what history
was wanted for, and it now falls out of the row key rather than being bolted on.

**What remains unrecoverable — and it is narrower.** Only changes *within* a
single meso: setting chest to `low` in week 2 and back to `high` in week 6
leaves only the final state plus its `updated_at`. Notably, the exact example
SPEC §4 raises ("only deprioritized in the back half of the meso") is the
within-meso case, so it is not fully closed — but its cross-meso sibling, which
is the far more common way priorities actually move, is.

**Does the schema need anything different because of this? No.** A single
mutable row per (user, meso, tag) is still the natural shape; every alternative
that captures within-meso movement is a different *table*, not a different
column. The companion table remains purely additive:

```sql
-- NOT proposed for v1. Sketched only to show it is purely additive.
create table v2_coach_meso_priority_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  mesocycle_id uuid not null references v2_mesocycles(id) on delete cascade,
  tag_type text not null, tag_value text not null,
  from_priority text, to_priority text not null,
  changed_at timestamptz not null default now()
);
```

**Recommendation: defer, more comfortably than in v1.** Adding it later touches
nothing that already exists — no change to
`v2_coach_meso_tag_priorities`, none to `fetchPriorityContext`, none to any
consumer; it is a new table plus one extra insert in `setTagPriority`. And the
interim loss is now genuinely small: what accrues unrecoverably is only
within-meso churn, not the whole history. `updated_at` still answers "when did
this last change" for the most recent change.

**What would change this recommendation:** if Adam finds himself routinely
adjusting priorities mid-block rather than setting them at creation, the
residual gap is exactly that behaviour and the companion table earns its ~15
lines. Worth revisiting after one real meso has been planned and completed with
this feature in place — which is also when Mesocycle Analysis's first real dry
run happens (MESOCYCLE-ANALYSIS-SPEC.md §6).

---

## 9. New files, at a glance

| File | Phase | What |
|---|---|---|
| `supabase/migrations/024_v3_coach_meso_priority_context.sql` | 1 | §2.5 |
| `src/lib/priorityTags.ts` | 2 | §3 — scale, `PRIORITY_TREE`, `SUBGROUP_PARENT`, `densifyPriorities` |
| `src/lib/priorityTags.test.ts` | 2 | §3.4 |
| `src/features/coach/priorityContext.ts` | 2 | §4 — `fetchPriorityContext`, the types |
| `src/features/coach/priorityService.ts` | 2 | the upsert write + `copyPrioritiesFromMeso` (§5.8) |
| `src/features/coach/usePriorityContext.ts` | 2 | §4.1 — the two read/write hooks plus `usePreviousMeso` and `useCopyPrioritiesFromMeso` |
| `src/features/coach/usePriorityContext.test.ts` | 2 | `usePreviousMeso`'s Q1a selection rule, as a pure function over a meso array (Phase 2) |
| `src/features/coach/PrioritySelector.tsx` | 3 | §5.4 |
| `src/features/coach/MesoPrioritiesPage.tsx` | 3 | §5.2 + §5.8's copy button |

*The modules stay under `features/coach/` even though the screen now lives in
the planner: this is Coach context data with a Coach consumer, and
`priorityContext.ts` sits directly beside the `analysisInput.ts` /
`weekAnalysisInput.ts` / `qaContext.ts` assemblers it is modelled on and will be
called alongside. Only the page component could reasonably move to
`features/programs/`; keeping the feature's files together is the stronger
argument, and `MesoPrioritiesPage.tsx` is routed from `App.tsx` like every other
page regardless of folder.*

**Modified — four files, all additively:**

| File | Change |
|---|---|
| `src/lib/exerciseTags.ts` | Two additive exports (§0.1 finding 1) |
| `src/lib/exerciseTags.test.ts` | Assertions for them |
| `src/App.tsx` | One route |
| `src/features/programs/ProgramPage.tsx` | Navigate after create (§5.1); completed-meso rows become navigable (§5.3) |
| `src/features/plan/PlanPage.tsx` | The header's existing meso-name line becomes a tappable link (§5.3) |

**Coach → CONTEXT and `CoachPage.tsx` are not touched at all.** With A9
dropped as recommended (§7), **no existing component's layout changes** —
`ProgramPage` gains navigation on rows that already exist, and `PlanPage` makes
a line it already renders tappable. Nothing else in the codebase is modified.
