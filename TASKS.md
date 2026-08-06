# Overload v3 — Technical Planning

**Status:** Draft — awaiting approval before implementation begins
**Spec version:** 3.0 — read SPEC.md before editing this file
**Predecessor:** TASKS-v2.md — v3 extends that foundation; its data models,
file layout and resolved assumptions still hold except where stated below.

---

## 0. What this plan assumes about the starting point

This is not a fresh build. Everything below is written against the code that
is actually deployed, not against TASKS-v2.md's proposed layout (the two
diverged during Phase 1 — e.g. `scheduler.ts` lives in `features/gym/`, not
`features/scheduling/`; `useScheduler.ts` is in `features/gym/`, not
`src/hooks/`). File references in Section 3 are the real paths.

Three facts about the live system drive most of the migration design:

1. **Every `v2_set_logs` row in production has `parent_set_id IS NULL`.**
   `GymSession.tsx:165` hardcodes `parentSetId: null` on every log call — this
   is AUDIT M5, still open. So dropset grouping *cannot* be reconstructed from
   `parent_set_id`. It has to be inferred from set ordering. This is the single
   biggest constraint on Section 2.1.
2. **There is no test runner.** `package.json` has no vitest/jest. Pure logic
   written to be testable (`referenceLogic.ts`) currently has no tests.
3. **The Dexie sync queue survives deploys.** Queued `v2_set_logs` payloads
   written by the *old* client will replay against the *new* schema. Any
   constraint added in this release must accept an old-shaped payload, or the
   set is dead-lettered after 3 attempts and silently lost
   (`useSyncQueue.ts:55`).

---

## 1. Tech Stack

**No new runtime dependencies are required for v3.** Every feature in SPEC.md
is buildable on the existing stack:

| v3 need | Covered by |
|---|---|
| Cross-meso History charts | Recharts v3 (already used by Progress) |
| History data tables | Plain markup — no table library warranted at this scale |
| Meso-week windows for the reference panel | date-fns v4 `startOfWeek`/`differenceInCalendarWeeks` |
| Server-side aggregates for P2 | Postgres views via Supabase JS v2 — no client library change |
| Set timer | Same Zustand pattern as `restTimerStore.ts` |
| e1RM maths | Plain TypeScript |
| kg↔lbs conversion | Plain TypeScript (currently missing entirely — see AUDIT E5) |
| More accent colours | `tokens.css` — data only, no code change |

### One genuine addition to consider: a test runner

**Recommendation: add Vitest as a devDependency.** This is the only stack
change I'd argue for, and it is optional — v3 ships without it, just less
safely.

The reasoning is specific to what v3 adds, not general hygiene. v3 introduces
four pieces of pure logic where a wrong answer is silent rather than loud:

- the dropset backfill's grouping rule (Section 2.1) — wrong grouping
  mislabels historical working sets as drop stages, which then silently
  changes every e1RM number
- the two-slot reference resolver (Section 2.3) — week-boundary maths, the
  exact class of bug that FIX 14 was
- e1RM + the meso-window first/last comparison (Section 2.5)
- kg↔lbs conversion and round-tripping (Section 2.4)

The 2026-07-11 session already resorted to writing a throwaway Node script to
compare old vs. new week numbers. That instinct was right; Vitest just makes
it repeatable. Cost is one devDependency and a `test` script — no build,
runtime, or bundle impact.

If you'd rather not, say so and I'll keep the same verification approach as
the week-number fix: standalone scripts under `scripts/`, run once, not kept.

Everything else in TASKS-v2.md Section 1 stands unchanged.

---

## 2. Data Model Changes

### Conventions used below

Migrations continue the existing numbering (`004_`…) in `supabase/migrations/`
and are applied manually via the Supabase SQL Editor, same as 003.

All schema work follows **expand → migrate → contract**:

1. **Expand** — add nullable/defaulted columns only. Safe to apply while the
   old client is still live.
2. **Migrate** — ship app code that writes the new shape, then backfill
   historical rows.
3. **Contract** — only after verification, and only after the offline sync
   queue has had time to drain, tighten constraints.

This ordering is not ceremony. The 003 migration taught the same lesson from
the other direction: the spec text said `not null default 5` *and* "null =
disabled", which cannot both be true, and it was only caught because the
column was written by hand. Splitting expand from contract means a wrong
guess costs a follow-up migration, not a data loss.

---

### 2.1 Dropset restructure — one set, N ordered stages

#### Design decision: keep one row per stage, fix the relationship

SPEC.md §10 is explicit: *"The problem isn't the database — `parent_set_id`
can already chain any number of rows. The problem is that a dropset is
currently authored as several sibling sets that each happen to carry a flag,
instead of being one thing with an ordered list of stages."*

I read that as ruling out a child `*_stages` table, and I agree with it. The
alternative — moving `weight`/`reps` into `v2_set_log_stages` — would force a
rewrite of every read path that touches set logs (progress, history, the
reference panel, the offline cache, the gym UI), for no gain: a drop stage is
still a real set with a weight, reps, and a rest interval, and it should still
appear in volume totals.

So the change is **relational, not structural**: a set group is a head row
(`parent_set_id IS NULL`) plus its ordered children.

**Confirmed in review** — see Section 5.1. The cost of the choice is that a
stage row is physically indistinguishable from a working set without a filter,
which the stage-exclusion rule below and the audit in §2.7 exist to contain.

#### Schema — `004_v3_dropset_stages.sql` (expand)

```sql
-- ── Plan side ────────────────────────────────────────────────────────────────
-- A planned set becomes a group: one head row plus ordered stage rows.
-- CASCADE, not SET NULL: an orphaned stage would be indistinguishable from a
-- main working set and would silently enter e1RM and volume as a top set.
alter table v2_week_plan_sets
  add column if not exists parent_week_plan_set_id uuid
    references v2_week_plan_sets(id) on delete cascade,
  add column if not exists stage_index integer not null default 0;

-- ── Log side ─────────────────────────────────────────────────────────────────
-- parent_set_id already exists but is universally NULL (M5). Only the
-- ordering column is new here; the FK behaviour is changed in 009 (contract).
alter table v2_set_logs
  add column if not exists stage_index integer not null default 0;

create index if not exists v2_week_plan_sets_parent_idx
  on v2_week_plan_sets(parent_week_plan_set_id);
-- v2_set_logs_parent_set_idx already exists from 001.
```

Semantics after this migration:

| | Head (main stage) | Stage row (drop) |
|---|---|---|
| `parent_set_id` / `parent_week_plan_set_id` | `NULL` | head's id |
| `stage_index` | `0` | `1, 2, 3 …` |
| `is_dropset` | `false` | `true` |
| `set_number` | the set's number within the exercise | **same as its head** (see below) |

**`is_dropset` is kept, not dropped.** It becomes derivable
(`parent_set_id IS NOT NULL`), and the temptation is to replace it with a
`GENERATED ALWAYS AS` column. Don't: converting an existing column to
generated means dropping and re-adding it, and any INSERT that writes it then
fails — which includes `sessionService.logSet()` *and* every queued offline
payload in Dexie. Keep it a plain column, keep writing it, treat it as a
denormalised read convenience.

#### The stage-exclusion rule

The relational model's one weakness is that a stage row is physically
indistinguishable from a working set unless you remember to filter. So the
filter becomes a named, non-negotiable convention:

> **A row with `parent_set_id` (or `parent_week_plan_set_id`) set is a drop
> stage. It is never counted as an independent set. Every count, average, or
> set list goes through a named view (`v2_history_session_summary`,
> `v2_exercise_set_history`, `v2_session_type_history`) or a pure function
> (`e1rm.ts`, `setGroupLogic.ts`) that applies the filter. No ad-hoc
> aggregate query against `v2_set_logs` or `v2_week_plan_sets`.**

**The one deliberate exception is volume.** A drop stage is real work — it has
a weight, reps and a rest interval, which is the whole reason §2.1 keeps it as
a row rather than a child record. Volume sums work performed, it doesn't count
sets. So: **volume includes stages; every other aggregate excludes them.**

Section 2.7 audits every place in the app where this rule has to be applied,
including the existing v2 code paths that get it wrong today.

#### Relationship to existing tables

Nothing else changes shape. `v2_set_logs.week_plan_set_id` keeps pointing at
whichever plan row the stage corresponds to — a planned stage's log points at
the planned stage row, so the identity matching in `ExerciseCard.tsx` keeps
working per-row and doesn't need to learn about groups.

#### Migration of existing production data — `007_v3_backfill_dropset_stages.sql`

This is the risky part, and it cannot be assumed to apply cleanly.

**Why `parent_set_id` is useless here:** M5 means it is NULL on every row ever
written. Grouping must be inferred from ordering: *a run of `is_dropset = true`
rows belongs to the nearest preceding `is_dropset = false` row within the same
`(session_id, exercise_id)`.*

**Step 1 — audit before touching anything.** Run these and read the output; do
not proceed on a non-zero count without a decision:

```sql
-- (a) Orphan drops: a dropset-flagged row with no preceding main set in its
--     exercise. The inference rule has no answer for these.
with ordered as (
  select id, session_id, exercise_id, is_dropset,
         count(*) filter (where not is_dropset) over (
           partition by session_id, exercise_id
           order by set_number, logged_at
           rows between unbounded preceding and current row
         ) as group_no
  from v2_set_logs
)
select count(*) as orphan_drop_count from ordered where is_dropset and group_no = 0;

-- (b) Ambiguous ordering: duplicate set_numbers within an exercise. AUDIT A3
--     notes there is no uniqueness constraint, and M3 describes plan-side
--     numbering collisions after deletions — so this is not hypothetical.
select session_id, exercise_id, set_number, count(*)
from v2_set_logs group by 1,2,3 having count(*) > 1;

-- (c) Scope check: how much data is actually affected.
select count(*) filter (where is_dropset) as drop_rows,
       count(distinct session_id) filter (where is_dropset) as sessions_touched
from v2_set_logs;
```

**Step 2 — backfill.** Same shape for both tables:

```sql
-- Log side.
with ordered as (
  select id, session_id, exercise_id, set_number, logged_at,
         count(*) filter (where not is_dropset) over (
           partition by session_id, exercise_id
           order by set_number, logged_at
           rows between unbounded preceding and current row
         ) as group_no
  from v2_set_logs
),
grouped as (
  select o.id,
         first_value(o.id) over w as head_id,
         row_number()      over w - 1 as stage_index
  from ordered o
  where o.group_no > 0
  window w as (partition by o.session_id, o.exercise_id, o.group_no
               order by o.set_number, o.logged_at)
)
update v2_set_logs sl
   set parent_set_id = g.head_id,
       stage_index   = g.stage_index
  from grouped g
 where sl.id = g.id
   and g.stage_index > 0;   -- heads keep parent_set_id NULL, stage_index 0
```

The plan side is identical with `partition by week_plan_id,
program_exercise_id`, `order by set_number`, writing
`parent_week_plan_set_id`.

**Step 3 — verify.** Re-run (a); it should be unchanged (the backfill does not
touch orphans). Then confirm every stage row has a head and no head has a
parent:

```sql
select count(*) from v2_set_logs where is_dropset and parent_set_id is null;   -- = orphan count from (a)
select count(*) from v2_set_logs where not is_dropset and parent_set_id is not null;  -- must be 0
```

#### Migration risks — flagged, not assumed away

- **Orphan drops have no correct answer.** A dropset-flagged row that is the
  first set of its exercise cannot be attached to anything. Options: leave
  unparented (it then reads as a main working set and enters e1RM — wrong but
  matches today's behaviour), or clear its `is_dropset` flag (honest, but
  rewrites history). **I'd leave them unparented and report the count**, since
  it preserves current numbers; decide after seeing the audit output.
- **Duplicate `set_number` makes ordering ambiguous.** Where (b) returns rows,
  `order by set_number, logged_at` picks an order that may not match what
  happened. `logged_at` is the tiebreaker and is reliable for online logs;
  offline logs get their timestamp at queue time, so a batch of offline sets
  can share near-identical timestamps.
- **`parent_set_id`'s `ON DELETE SET NULL` is now wrong.** Under the new model
  deleting a head silently promotes its stages to main working sets. Must
  become `ON DELETE CASCADE`, deferred to 009 (contract) — which opens a
  window where the app can corrupt its own numbers. **This is a confirmed
  live issue, not a theoretical one** — see "The silent-promotion window"
  below.
- **Do not add `check (is_dropset = false or parent_set_id is not null)`.**
  An offline payload written by the old client carries
  `is_dropset: true, parent_set_id: null` and would violate it, fail three
  times, and be dead-lettered — losing a logged set with only a console
  error. If this constraint is ever wanted, it goes in a later release after
  a confirmed-empty `sync_queue`.
- **`set_number` for stages is a semantic choice, not a mechanical one.**
  Today each drop consumes its own `set_number`, so a 3-stage dropset shows as
  sets 1, 2, 3. Under "one unit", stages should share the head's `set_number`
  and be distinguished by `stage_index`. Renumbering historical rows is a
  second, separate data rewrite that changes what History displays for past
  sessions. **Recommendation: don't renumber history.** Write the new
  convention going forward, and have the display layer group by
  `parent_set_id` — which works for both old and new rows.

#### The silent-promotion window — investigated, and it is real

**Question:** is there a UI path that deletes a single `v2_set_log` row rather
than a whole session? Because `parent_set_id` keeps `ON DELETE SET NULL` from
3.1 (when grouping becomes real) until 009 (when it becomes CASCADE), any such
path would silently promote a deleted head's stages into main working sets —
feeding wrong numbers straight into the 3.5 e1RM headline.

**Answer: yes, and it is on the most-used screen in the app.** The full chain:

```
SetRow.tsx:344        trash icon → confirmDelete → onDelete()
ExerciseCard.tsx:97   handleDeleteSet(log) → onDeleteSet(log.id)
GymSession.tsx:167    deleteSetLog.mutate(id)
useSession.ts:541     useDeleteSetLog
sessionService.ts:258 supabase.from('v2_set_logs').delete().eq('id', id)
```

This is the per-set delete added by FIX 8 (AUDIT E1), live in every active
session. So the window is not hypothetical: between 3.1 and 3.8, deleting the
head of a dropset mid-session orphans its stages, and they immediately start
reading as independent working sets.

For completeness, the two paths that are *not* affected:

- **`SessionDetail.tsx` (History) is read-only for sets.** It renders
  `group.sets` with no per-set controls; its only destructive action is DELETE
  SESSION, which deletes the `v2_sessions` row and relies on the existing
  `on delete cascade` to take the set logs with it. Whole groups disappear
  together — no orphans possible.
- **The plan side needs no guard at all.** `parent_week_plan_set_id` is
  created `ON DELETE CASCADE` in 004, so `weekPlanService.removeSet()`
  deleting a plan head takes its stage rows with it server-side from day one.
  The asymmetry is only because `parent_set_id` already exists with the wrong
  behaviour and can't be altered without a drop-and-recreate.

#### The guard — cascade client-side, stages first

Rather than blocking the delete (which makes a head undeletable until the user
manually removes each stage, for a reason they can't see), **replicate 009's
CASCADE in the client** so behaviour is identical before and after the
constraint change and nothing needs revisiting at 3.8.

In `ExerciseCard.tsx`'s `handleDeleteSet`, when the target log is a head with
stages:

1. Delete its stage rows **first**, in descending `stage_index` order.
2. Delete the head **last**.
3. Then renumber, counting only heads (see §2.7 item 9).

**The order is the whole point and it is the opposite of the obvious one.**
Head-first means a failure partway through leaves orphaned stages — exactly
the corruption being prevented, now permanent. Stages-first means a failure
leaves a head with fewer stages: visible, harmless, and re-deletable. Since
`useDeleteSetLog` is a plain mutation with no offline queue and no
transaction, partial failure is a real outcome, so the order has to be the
one that fails safe.

Keep the guard after 009. It is then redundant with the FK, but it keeps the
optimistic cache update correct — the server cascade would otherwise remove
rows that TanStack Query still has in `setLogs` until the next refetch.

#### Dexie

`db.ts` needs a `version(2)` bump to add a `parentSetId` index on `set_logs`.
Cached rows written by the old client will have `stageIndex === undefined`;
readers must treat `undefined` as `0`, not crash.

---

### 2.2 Set timing — the optional Start Set flow

#### Schema — `005_v3_set_timing.sql` (expand)

```sql
-- Duration of the set itself, in seconds. NULL = not measured (the toggle was
-- off, or the row predates the feature). This NULL is also the discriminator
-- that lets set-duration charts skip sessions without the data, per SPEC §4.2.
alter table v2_set_logs
  add column if not exists set_seconds integer;

-- Global setting, per SPEC §4.2 — not per-session, not per-exercise.
alter table v2_user_settings
  add column if not exists measure_set_time boolean not null default false;
```

**Why `set_seconds` (a duration) and not `started_at` (a timestamp):** it
matches the existing `rest_seconds` precedent exactly — computed on the client,
stored for history — and it survives the offline path without clock-skew maths.
The trade-off is that the raw start instant isn't recoverable. Given the only
consumer is an average-duration stat, that's the right trade.

`not null default false` is safe here in a way it wasn't for
`auto_finish_minutes`: "off" is a real, representable state for a boolean.
There is no third "disabled" meaning to encode.

#### Relationship to existing data — the part that needs care

`rest_seconds` **changes meaning** when the toggle is on. Today it is
"seconds since the last log", which includes the time spent performing the
set. With Start Set on, the rest timer starts at LOG and stops at START SET,
so `rest_seconds` becomes true rest.

That means historical and future `rest_seconds` values are not comparable, and
the existing AVG REST TIME charts in `ExerciseProgress.tsx` and
`MesoProgress.tsx` will show a step change on the day the toggle is flipped.
No backfill is possible — the information was never captured.

**Recommendation:** treat `set_seconds IS NOT NULL` as the marker for
"measured" rest, and mark the transition point on the rest charts the same way
deload weeks are already marked, rather than silently averaging two different
quantities together. Cheap, honest, and reuses an existing chart affordance.

No migration of existing rows. This satisfies SPEC §4.2's "no backfill needed".

---

### 2.3 Reference panel — two-slot resolution

#### Schema: no column changes

This is a query and logic change, not a data-model change. One index earns its
place:

```sql
-- 008_v3_history_views.sql (shared with Section 2.6)
create index if not exists v2_sessions_user_day_date_idx
  on v2_sessions(user_id, workout_day_id, date desc);
```

#### The simplification FIX 14 unlocked

SPEC §4.1 anchors the primary slot to "the immediately preceding meso week
(Monday-anchored, same boundary as meso week numbering)". Since FIX 14 made
meso weeks *calendar* weeks anchored to Monday, **"previous meso week" is
exactly "previous Monday-anchored calendar week"** — two dates in the same
Monday week always yield the same meso week number regardless of where the
meso started. So the primary slot's window is a pure date range and needs no
meso join and no meso-start arithmetic:

```
previousWeekStart = subWeeks(startOfWeek(today, { weekStartsOn: 1 }), 1)
previousWeekEnd   = subDays(startOfWeek(today, { weekStartsOn: 1 }), 1)
thisWeekStart     = startOfWeek(today, { weekStartsOn: 1 })
```

Session *type* is `workout_day_id`, which also handles the meso boundary for
free: a new meso normally means a new program and new workout-day rows, so
last meso's "Push Day A" won't match this one's.

#### Resolution rules (rewrite of `referenceLogic.ts`)

```
Primary slot (always resolves):
  same workout_day_id, status = 'completed', date in [prevWeekStart, prevWeekEnd]
    → LAST WEEK                     (most recent if several)
  else most recent ever, same workout_day_id, status = 'completed', date < today
    → LAST TIME + elapsed
  else → FIRST TIME

Secondary slot (additive, may be empty):
  same workout_day_id, status = 'completed',
  date in [thisWeekStart, today), excluding the current session
    → THIS WEEK, one entry per occurrence, each with its own elapsed time
```

The v2 constants `RECENT_DAYS = 10` and `ABSENCE_DAYS = 28` are **deleted** —
they were approximating the week boundary that is now computed exactly. The
`occurrenceCount` input is also no longer needed: the old logic used it to
decide whether a same-slot/any-slot split was meaningful, and the new rules
are always same-slot.

#### Query shape — sessions first, then one batched set-log fetch

The current implementation is one `limit(50)` set-log query per exercise per
slot (`fetchLastCompletedSessionForExercise`), which is AUDIT P5's fragility
(a high-set-count exercise can push the prior session out of the window) and
contributes to P1's N+1.

Replace with a two-step fetch per *session*, not per exercise:

1. One query on `v2_sessions` for the candidate session ids — `user_id`,
   `workout_day_id`, `status = 'completed'`, date in the relevant windows.
   Cheap, hits the new index, returns a handful of rows.
2. One `v2_set_logs` query with `.in('session_id', ids)` and
   `.in('exercise_id', dayExerciseIds)`.

This fixes P5 (no arbitrary row limit), collapses the reference panel's part
of P1, and returns a shape the panel can slice per-exercise client-side.

**Offline:** the primary slot must keep degrading gracefully. Today
`ExerciseReference` leans on `useLastSessionLogs`, which has a Dexie fallback.
The new session-first query needs the same treatment — cache the candidate
sessions in `primeOfflineCache` at session start, and fall back to the Dexie
`sessions` + `set_logs` tables (both already exist and are indexed on the
right fields).

---

### 2.4 Per-program-exercise weight unit

#### Schema — `006_v3_units_and_warmup.sql` (expand)

```sql
-- NULL = inherit the global Settings unit. Nullable is load-bearing: a
-- `not null default 'kg'` would freeze every existing row at kg and stop it
-- following a later change to the global setting.
alter table v2_program_exercises
  add column if not exists weight_unit text
    check (weight_unit is null or weight_unit in ('kg','lbs'));

-- The rarely-used logging-time override (SPEC §8.1). Records what the user
-- actually typed; `weight` stays canonical kg. NULL = entered in the resolved
-- default for that program-exercise.
alter table v2_set_logs
  add column if not exists entered_unit text
    check (entered_unit is null or entered_unit in ('kg','lbs'));
```

This is the `auto_finish_minutes` lesson applied preemptively: the tri-state
(explicit kg / explicit lbs / inherit) needs three representable values, so the
column is nullable and the default lives in application code.

#### Resolution order

`v2_program_exercises.weight_unit` → `v2_user_settings.weight_unit` → `'kg'`.
Set at program-creation time from the global setting, per SPEC §8.1 — meaning
the builder writes the *resolved literal* rather than leaving NULL, so a later
global change doesn't retroactively reinterpret an existing program. New rows
created outside the builder stay NULL and inherit.

#### Why `entered_unit` is not optional

Without it, an lbs-entered set is stored as converted kg and re-displayed as
whatever the current default says — so opening the edit row shows a different
number than was typed, and saving re-converts it. Storing the entry unit makes
the round-trip lossless.

#### This is where AUDIT E5 gets fixed

E5 ("kg→lbs is a label not a conversion") is currently true: `SetRow.tsx`
renders `{weightUnit}` as a suffix and never converts. v3 makes the unit
semantically meaningful, so a real conversion helper is required — new file
`src/lib/weightUnit.ts` (canonical kg storage, display conversion, and
sensible rounding: lbs to 1 decimal, kg to 2, matching `numeric(6,2)`).

**Rounding is lossy and worth flagging:** 100 kg → 220.5 lbs → 100.02 kg. The
helper must round-trip through the *stored* kg value, never through the
displayed lbs value, or repeated edits will drift.

No migration of existing rows — all existing `weight` values are already kg,
which is exactly what the new model expects. All existing
`v2_program_exercises` rows get `NULL` (inherit), which preserves today's
behaviour precisely.

---

### 2.5 Progress headline — the e1RM average

#### Schema — the warmup flag, added now

```sql
-- 006_v3_units_and_warmup.sql (continued)
alter table v2_week_plan_sets add column if not exists is_warmup boolean not null default false;
alter table v2_set_logs       add column if not exists is_warmup boolean not null default false;
```

Warmup sets are **deferred** in SPEC §8.3 — no UI, no logging flow, nothing.
But §8.3 also locks in one thing regardless: *"whenever warmup sets are built,
they carry their own flag distinct from working sets in the data model, so they
never enter e1RM, volume, or the Today reference panel."*

Adding the column now (defaulted, no UI) means the e1RM filter is written
against its real predicate from day one, and shipping warmups later is a UI
change rather than a schema change plus a rewrite of every aggregate. Two
`alter table`s with a default is a cheap hedge. See Section 5.4 — this is a
judgement call, not something the spec asked for, and the one item in this
plan still awaiting a decision.

#### The calculation

**Per set — Epley, RIR-adjusted. Sets with no RIR recorded are skipped, not
defaulted.**

```
// eligible sets only — a set with rir === null contributes nothing
effectiveReps = reps + rir
e1RM          = weight × (1 + effectiveReps / 30)
```

Adjusting for RIR is what makes the metric mean "strength" rather than
"proximity to failure": a meso that deliberately moves from RIR 3 to RIR 0
would otherwise show a gain that is really just training harder. And skipping
null-RIR sets rather than treating them as `rir = 0` avoids the opposite
error — `?? 0` would silently claim every unrecorded set was taken to failure,
inflating it above an honestly-recorded RIR 2 set beside it.

**Per session** — average across that exercise's eligible main working sets:

```sql
-- the "eligible working set" predicate
where is_skipped   = false
  and is_warmup    = false
  and parent_set_id is null   -- head rows only; drop stages excluded (SPEC §6)
  and weight is not null
  and reps   is not null
  and rir    is not null      -- unrecorded RIR contributes nothing
```

Averaging every eligible working set (rather than taking the top set) is what
SPEC §6 asks for: *"so every real working set counts rather than just the top
set or a single best-set estimate."*

**Per meso** — first session vs. most recent session within the current meso:

```
delta% = (e1rmAvg(mostRecent) − e1rmAvg(first)) / e1rmAvg(first) × 100
```

Displayed as a percentage only, no absolute weight — per SPEC §6's reasoning
that pairing a formula estimate with a fabricated kg figure implies false
precision.

#### A session with no RIR recorded at all is excluded, not unadjusted

This is the case the skip rule leaves open, and it needs an explicit answer
rather than falling out of the code by accident.

**Decision: a session where no working set has an RIR is dropped from the
comparison entirely.** It is not an endpoint, and the window falls back to the
next eligible session in that direction.

The reasoning is that the alternative is worse in a specific, invisible way.
Unadjusted e1RM is *always lower* than the RIR-adjusted value for the same
performance, because `effectiveReps ≥ reps` whenever RIR is recorded at all.
So a fallback-to-unadjusted rule means an unadjusted first session paired with
an adjusted recent session manufactures a gain out of nothing but the formula
changing underneath the comparison — a fabricated percentage, which is exactly
what SPEC §6's "percentage only, no absolute weight" reasoning exists to
prevent. Excluding the session either finds a genuinely comparable pair or
finds nothing.

The visible consequence, stated plainly: **if RIR is recorded sparsely, some
exercises will show no headline.** That is the correct failure mode. A blank
is honest; a number derived from two incompatible formulas is not.

**Edge cases, resolved:**

| Case | Behaviour |
|---|---|
| Fewer than 2 eligible sessions in the meso | Show nothing. Not "+0%". |
| Some sets in a session have RIR, some don't | Average the ones that do (§2.5 skip rule). |
| **No** set in a session has RIR | Session excluded; fall back to the next eligible one. |
| First and/or last eligible session is a deload week | Excluded from both endpoints — a deload baseline is artificially low and flatters the headline. Falls back to the earliest/latest non-deload eligible session. `is_deload` comes from `v2_week_plans` via `session.week_plan_id`. |
| Exercise has eligible sessions but all in deload weeks | Show nothing. |

All five are decided in `e1rm.ts` as pure functions over an already-fetched
session list, so they're cheap to test — this is the module Section 1's Vitest
argument is really about.

#### Placement

New pure module `src/features/progress/e1rm.ts`, consumed by
`progressService.ts`. Keeping it pure and separate follows the
`referenceLogic.ts` / `formatRestTime.ts` precedent — and it is the single
piece of v3 logic most worth a test.

#### No new query

The headline is computed from data `fetchExerciseProgress` already fetches,
plus the two new predicate columns. Note that its `.limit(1000)` is AUDIT H4
and will now also silently truncate the e1RM baseline — fixed as part of
Section 2.6's pagination work, since it is the same defect.

---

### 2.6 History cross-meso views — and AUDIT P2

#### The problem, precisely

`fetchHistorySessions` (`historyService.ts:94`) selects up to 500 sessions,
each joined to `v2_set_logs(id, is_skipped, exercises(id, muscle_group))` —
i.e. it downloads **one row per set log ever recorded** in order to compute two
scalars per session: `setCount` and the distinct `muscleGroups` list. That is
P2.

v3 makes this materially worse. "Exercise, all time" and "Session type, all
time" (SPEC §7) are by definition unbounded-scope queries, and each wants a
chart *plus* a full data table. Built naively on the current pattern, each view
would re-download the same full set-log history on every visit.

#### Fix — aggregate in Postgres, not in the client

`008_v3_history_views.sql`:

```sql
-- ── Replaces the set-log join in fetchHistorySessions ───────────────────────
create or replace view v2_history_session_summary
with (security_invoker = true) as
select s.id, s.user_id, s.date, s.status, s.note,
       s.started_at, s.completed_at,
       s.workout_day_id, wd.name as workout_day_name,
       s.mesocycle_id,   m.name  as mesocycle_name,
       -- stage-exclusion rule (§2.1): drop stages are not independent sets.
       -- Without this a 3-stage dropset reports as 3 sets instead of 1.
       count(sl.id) filter (
         where not sl.is_skipped and sl.parent_set_id is null
       ) as set_count,
       coalesce(
         array_agg(distinct e.muscle_group)
           filter (where not sl.is_skipped and e.muscle_group is not null),
         '{}'
       ) as muscle_groups
  from v2_sessions s
  left join v2_workout_days wd on wd.id = s.workout_day_id
  left join v2_mesocycles   m  on m.id  = s.mesocycle_id
  left join v2_set_logs     sl on sl.session_id = s.id
  left join exercises       e  on e.id  = sl.exercise_id
 group by s.id, wd.name, m.name;

-- ── SPEC §7: "Exercise, all time" — chart + per-set table ────────────────────
create or replace view v2_exercise_set_history
with (security_invoker = true) as
select sl.id, sl.user_id, sl.exercise_id, sl.session_id,
       s.date, s.mesocycle_id, m.name as mesocycle_name,
       wp.week_number, coalesce(wp.is_deload, false) as is_deload,
       sl.set_number, sl.stage_index, sl.parent_set_id,
       sl.weight, sl.reps, sl.rir, sl.rest_seconds, sl.set_seconds,
       sl.is_warmup, sl.is_skipped
  from v2_set_logs sl
  join v2_sessions   s  on s.id  = sl.session_id and s.status = 'completed'
  left join v2_mesocycles m on m.id = s.mesocycle_id
  left join v2_week_plans wp on wp.id = s.week_plan_id;

-- ── SPEC §7: "Session type, all time" — chart + per-occurrence table ─────────
create or replace view v2_session_type_history
with (security_invoker = true) as
select s.id as session_id, s.user_id, s.workout_day_id, s.date,
       s.mesocycle_id, wp.week_number, coalesce(wp.is_deload, false) as is_deload,
       extract(epoch from (s.completed_at - s.started_at))::int as duration_seconds,
       -- Volume is the deliberate exception to the stage-exclusion rule (§2.1):
       -- a drop stage is real work performed, so it counts toward volume.
       sum(sl.weight * sl.reps)
         filter (where not sl.is_skipped and not sl.is_warmup) as total_volume,
       -- avg RIR and set_count exclude stages. A stage is taken near failure,
       -- so including them makes avg RIR a function of how many dropsets were
       -- programmed rather than how hard the working sets were.
       avg(sl.rir) filter (
         where not sl.is_skipped and sl.rir is not null and sl.parent_set_id is null
       ) as avg_rir,
       count(sl.id) filter (
         where not sl.is_skipped and sl.parent_set_id is null
       ) as set_count
  from v2_sessions s
  left join v2_week_plans wp on wp.id = s.week_plan_id
  left join v2_set_logs   sl on sl.session_id = s.id
 where s.status = 'completed'
 group by s.id, wp.week_number, wp.is_deload;

grant select on v2_history_session_summary,
                v2_exercise_set_history,
                v2_session_type_history
  to authenticated;

create index if not exists v2_sessions_user_day_date_idx
  on v2_sessions(user_id, workout_day_id, date desc);
```

`v2_set_logs_user_ex_time_idx` (from 001) already covers the exercise-all-time
access path.

#### How each new view avoids P2 at its wider scope

| View | Rows returned | Instead of |
|---|---|---|
| Session list | 1 per session | 1 per set log, ever |
| Exercise, all time | 1 per set **for one exercise**, paginated | all set logs for all exercises |
| Session type, all time | 1 per **session occurrence**, aggregated in SQL | all set logs for all sessions of that type |

The session-type view is the important one: its table shows total volume, avg
RIR and duration per occurrence — all of which are `sum`/`avg`/`count` over
set logs. Computing them in SQL is the difference between transferring one row
per workout and one row per set.

Pagination replaces `.limit(500)` / `.limit(1000)` with `.range()` keyset
paging ordered by `date desc`. This also closes AUDIT H4 (progress chart drops
the newest sessions past 1000 logged sets), which is the same defect wearing a
different hat.

#### Risks specific to introducing views here

- **`security_invoker = true` requires Postgres 15+.** Without it a view runs
  as its owner and **bypasses RLS entirely** — every user's history in one
  query. Verify the instance version before applying, and keep the explicit
  `.eq('user_id', userId)` filter in the service layer as defence-in-depth.
  That is the same advice AUDIT S1 gives for the `exercises` table, for the
  same reason.
- **PostgREST caches the schema.** New views may 404 from the client until the
  cache reloads. Finish the migration with `notify pgrst, 'reload schema';`.
  This is the same class of surprise as the pre-migration
  `auto_finish_minutes` 400.
- **Views are not offline-cacheable the way tables are.** Dexie mirrors table
  rows. The new History views are online-only — acceptable, since History is a
  review surface rather than a gym-floor one, but it should be an explicit
  empty state rather than a spinner that never resolves.
- **`duration_seconds` is NULL for sessions with no `started_at`/`completed_at`.**
  Sessions created via `skipMissedSession` have neither. The table must render
  a dash, not `0`.

---

### 2.7 Audit — every place the stage-exclusion rule must be applied

Per the rule in §2.1. Recap of the split: **volume includes stages; every
other count, average or set list excludes them.**

#### Covered by the named views — no further work

| Site | Status |
|---|---|
| `v2_history_session_summary.set_count` | Filtered (§2.6) |
| `v2_session_type_history.set_count`, `avg_rir` | Filtered (§2.6) |
| `v2_session_type_history.total_volume` | Deliberately includes stages |
| `v2_exercise_set_history` | Returns rows, not counts — exposes `parent_set_id` + `stage_index` so the client can nest. The table must render stages **under** their head, not as extra rows. |

#### Existing v2 code that is wrong today and is touched by v3

These already miscount — a 3-stage dropset currently reports as 3 sets
everywhere below. v3 doesn't introduce the bug, it makes it visible by giving
`parent_set_id` meaning.

| # | Site | What breaks | Fix |
|---|---|---|---|
| 1 | `ExerciseCard.tsx:51,90` — `totalLogged`, `setNumber: currentLogs.length + 1` | **Sharpest one.** Logging a drop stage consumes a set number, so the next real set is numbered wrong for the rest of the session | Count heads only |
| 2 | `ExerciseCard.tsx:180,211` — `lastLogs[displayNumber - 1]` | Positional index into a flat array that now contains stages → set 2 prefills from last week's *drop stage* weight | Index into heads only |
| 3 | `ExerciseCard.tsx:97-111` — delete renumbering | Shifts every row with a greater `setNumber`, stages included | Renumber heads only; stages follow their head (§2.1 guard) |
| 4 | `progressService.ts:90,91,85,73` — `setCount`, `avgReps`, `avgRir`, `topWeight`/`topSet` | All include stages; avg reps and avg RIR are dragged down by lower-weight near-failure stages | Exclude stages. `volume` (line 83) keeps them |
| 5 | `progressService.ts:157,159,161` — `totalSets`, `avgRir`, `avgReps` | Same, on the meso overview dashboard | Exclude stages |
| 6 | `historyService.ts:221` — `fetchHistoryDetail` `setCount`; flat `exerciseGroups[].sets` | Inflated count; `SessionDetail.tsx:202` renders each stage as its own row labelled `DS` | Exclude from count; nest under head |
| 7 | `PlanTargetsPanel.tsx`, `PreviewExerciseCard.tsx` | `plannedSets` length/list inflated by plan stage rows | Filter `parentWeekPlanSetId == null` |
| 8 | `PlanPage.tsx` add-set numbering | New set number derived from existing set count — stages inflate it (compounds AUDIT M3) | Count heads only |
| 9 | `ExerciseReference.tsx:55` | Renders reference logs flat with a `DROP` badge per row | Group in the two-slot rewrite (3.3) |
| 10 | `offlineCache.ts`, `useLastSessionLogs` Dexie fallback | Return flat `SetLog[]`; every consumer must group | Route through `setGroupLogic.ts` |

**One site that is correct as-is, noted so it isn't "fixed" later:**
`useAutoFinishSession.ts` matches every planned `WeekPlanSet` id to a logged
row. Planned stage rows each have their own id, so auto-finish won't fire
until all stages of a planned dropset are logged. That is the right
behaviour — a half-finished dropset isn't a finished session — and it matches
today's, where each drop was a sibling planned set.

#### Consequence to accept

Fixing items 4 and 5 **changes the numbers displayed on already-shipped charts
for historical mesos** — total sets, avg RIR and avg reps will all shift for
any meso containing dropsets. The current values are the wrong ones, so this
is a correction rather than a regression, but it is user-visible and worth
expecting rather than discovering. It is a display-layer change only; no
stored data is modified, so it is reversible by reverting the filter.

---

### 2.8 Summary of schema changes

| Migration | Table | Change | Type |
|---|---|---|---|
| 004 | `v2_week_plan_sets` | `+ parent_week_plan_set_id`, `+ stage_index` | expand |
| 004 | `v2_set_logs` | `+ stage_index` | expand |
| 005 | `v2_set_logs` | `+ set_seconds` | expand |
| 005 | `v2_user_settings` | `+ measure_set_time` | expand |
| 006 | `v2_program_exercises` | `+ weight_unit` (nullable) | expand |
| 006 | `v2_set_logs` | `+ entered_unit` (nullable) | expand |
| 006 | `v2_week_plan_sets`, `v2_set_logs` | `+ is_warmup` | expand |
| 007 | `v2_set_logs`, `v2_week_plan_sets` | dropset grouping backfill | **migrate** |
| 008 | — | 3 views, 1 index, grants | expand |
| 009 | `v2_set_logs` | `parent_set_id` FK → `ON DELETE CASCADE` | **contract** |

009 runs last, after verification and after `sync_queue` is confirmed empty.
Nothing in 004–008 breaks the currently deployed client.

---

## 3. File and Folder Structure

Paths are the real ones in this repo, not TASKS-v2.md's proposal.

### Extended (existing files)

**Core**
- `src/types/index.ts` — `SetLog`/`WeekPlanSet` gain `stageIndex`, `isWarmup`,
  `setSeconds`, `enteredUnit`; `ProgramExercise` gains `weightUnit`;
  `UserSettings` gains `measureSetTime`; new `SetGroup` view type
- `src/lib/db.ts` — Dexie `version(2)`, `parentSetId` index, new cached fields

**Gym / Today** (§4)
- `GymSession.tsx` — **fixes M5** (real `parentSetId` instead of hardcoded
  `null`); workout duration header; skip-whole-exercise wiring
- `ExerciseCard.tsx` — renders set *groups* rather than flat rows; per-row rest
  timer; skip-exercise action; jump-to-history link
- `SetRow.tsx` — Start Set / Log two-tap flow; unit override; the DROP toggle
  becomes ADD STAGE
- `sessionService.ts`, `useSession.ts` — stage-aware log/update/delete,
  `set_seconds`, `entered_unit`, batched reference queries
- `referenceLogic.ts` — **rewritten** for two-slot resolution
- `ExerciseReference.tsx` — primary + secondary slot rendering
- `RestTimer.tsx`, `restTimerStore.ts` — timer stops at START SET when measuring
- `TodayPage.tsx` — edit-note action on the completed state (no reopen)
- `PlanTargetsPanel.tsx`, `PreviewExerciseCard.tsx`, `SessionPreview.tsx` —
  show planned stage groups

**Plan** (§5)
- `PlanPage.tsx` — workout switcher, split copy actions, compact mode, stage
  authoring
- `weekPlanService.ts`, `useWeekPlan.ts` — stage CRUD, copy-single-workout

**Progress** (§6)
- `progressService.ts` — e1RM headline, warmup/stage exclusion, pagination
- `ExerciseProgress.tsx` — headline display
- `useProgress.ts` — new query

**History** (§7)
- `historyService.ts` — rewritten onto the three views; pagination
- `useHistory.ts`, `HistoryPage.tsx` — two new view modes
- `SessionDetail.tsx` — grouped dropset display

**Program / Settings / Library** (§8, §9, §11)
- `WorkoutDayEditorPage.tsx`, `programService.ts`, `usePrograms.ts` — per-exercise unit
- `SettingsPage.tsx`, `settingsService.ts`, `settingsStore.ts` — measure-set-time toggle
- `src/styles/tokens.css` — additional accent options
- `src/features/offline/offlineCache.ts` — cache new columns + reference sessions

### New files

```
supabase/migrations/
  004_v3_dropset_stages.sql
  005_v3_set_timing.sql
  006_v3_units_and_warmup.sql
  007_v3_backfill_dropset_stages.sql      -- data migration + audit queries
  008_v3_history_views.sql
  009_v3_tighten_constraints.sql          -- contract; run last

src/lib/
  weightUnit.ts                 -- real kg↔lbs conversion (fixes AUDIT E5)
  e1rm.ts → see progress/       -- (kept in the feature, not lib)

src/hooks/
  useWeightDisplay.ts           -- planned in TASKS-v2 §4, never built

src/features/gym/
  SetGroup.tsx                  -- one set + its ordered stages, with ADD STAGE
  setTimerStore.ts              -- Zustand, mirrors restTimerStore
  useSessionDuration.ts         -- workout duration since started_at
  setGroupLogic.ts              -- pure: flat SetLog[] → grouped structure

src/features/progress/
  e1rm.ts                       -- pure e1RM + meso-window comparison

src/features/history/
  ExerciseHistoryView.tsx       -- chart + per-set table
  SessionTypeHistoryView.tsx    -- chart + per-occurrence table
  HistoryDataTable.tsx          -- shared table primitive

src/features/plan/
  WorkoutSwitcher.tsx
  CompactPlanRows.tsx

src/features/library/
  defaultExercises.ts           -- seed library (SPEC §9)
```

`setGroupLogic.ts` and `e1rm.ts` are deliberately pure and separate, matching
the `referenceLogic.ts` / `formatRestTime.ts` precedent.

---

## 4. Implementation Order — Phase 3

Eight sub-phases. Each is independently shippable and leaves the app in a
working state.

### 3.0 — Migration foundation (blocks everything)

1. Apply 004, 005, 006 (expand only — nullable/defaulted, old client unaffected)
2. Extend `src/types/index.ts` and `db.ts` (Dexie v2)
3. **Fix AUDIT M5** — `GymSession.tsx` writes a real `parentSetId`
4. Run 007's audit queries; decide on orphans and duplicates
5. Run 007's backfill; verify

**Why first:** the schema has to exist before anything writes to it, and M5
must be fixed *before* the backfill or new unparented rows keep arriving into
data you have just finished grouping. The audit-before-backfill step is the
whole point — this is where a wrong assumption gets caught cheaply.

**Testable:** existing app works unchanged; new columns populated and verified.

### 3.1 — Dropset as one unit

6. `setGroupLogic.ts` — flat rows → grouped structure (tolerating old rows,
   where `stageIndex` is `undefined`)
7. `SetGroup.tsx`; `ExerciseCard.tsx` renders groups
8. **Client-side cascade guard on set delete** (§2.1) — stages first,
   descending `stage_index`, then the head
9. **Stage-exclusion fixes in the gym UI** — §2.7 items 1–3: set numbering,
   the `lastLogs[displayNumber - 1]` prefill index, and delete renumbering
10. Stage authoring in `PlanPage.tsx` + `weekPlanService.ts` (§2.7 items 7, 8)
11. Grouped display in `SessionDetail.tsx`, `PlanTargetsPanel.tsx`,
    `PreviewExerciseCard.tsx` (§2.7 item 6)

**Why second:** this is the deepest change, and every later surface reads it.
The Progress headline must exclude stages; the History tables must group them;
the reference panel must display them. Building those first means writing them
twice.

**Why the guard is in this phase and not 3.8:** step 8 has to ship in the same
release as step 7. The moment `parent_set_id` carries meaning, the existing
per-set delete on `SetRow.tsx` can orphan stages into working sets, and
`parent_set_id` keeps `ON DELETE SET NULL` until 009. Deferring the guard
leaves a live corruption path open across five sub-phases, feeding wrong
numbers into 3.5.

**Testable:** plan and log a 3-stage dropset as one unit; delete the head
mid-session and confirm the stages go with it; historical dropsets still
render; a 3-stage dropset counts as one set everywhere in the gym UI.

### 3.2 — Set timing and Today changes

12. `setTimerStore.ts` + Start Set flow in `SetRow.tsx`
13. `measure_set_time` toggle in Settings
14. Rest timer under the completed row; `useSessionDuration.ts` header
15. Skip whole exercise; edit-note-after-completion; jump to exercise history

**Why here:** self-contained, and it closes the second of the two real-usage
bugs in SPEC §15's success criteria. The jump-to-history link is built as a
stub route that 3.4 fills in.

**Testable:** toggle on, log a set with Start Set, confirm rest excludes set time.

### 3.3 — Reference panel

16. Rewrite `referenceLogic.ts` for two slots
17. Session-first batched queries (fixes P5, part of P1)
18. `ExerciseReference.tsx` two-slot rendering, grouped stages (§2.7 item 9),
    offline fallback via `setGroupLogic.ts` (§2.7 item 10)

**Why after 3.1:** the panel displays dropsets, so it needs the grouped shape
to exist. Independent of everything else.

**Testable:** LAST WEEK resolves against the Monday-anchored previous week;
THIS WEEK appears after a second session of the same type in one week.

### 3.4 — History: P2 first, then the new views

19. Apply 008; verify `security_invoker` and the PostgREST reload
20. Rewrite `historyService.ts` onto `v2_history_session_summary` + pagination
21. `ExerciseHistoryView.tsx`, `SessionTypeHistoryView.tsx`, `HistoryDataTable.tsx`
    — stages nested under their head, never as extra table rows
22. Wire 3.2's jump-to-history link to the real view

**Why this order within the phase:** P2 gets fixed *before* the new views are
built, not after. Building them on the current pattern and optimising later
means writing the query layer twice and shipping a known regression in between.

**Testable:** session list payload is one row per session; both new views load
and paginate.

### 3.5 — Progress headline

23. `e1rm.ts` (pure) — RIR-adjusted, null-RIR sets skipped, all-null and
    deload sessions excluded from the window (§2.5)
24. **Stage-exclusion fixes in Progress** — §2.7 items 4 and 5: `setCount`,
    `avgReps`, `avgRir`, `topWeight`/`topSet` across both
    `fetchExerciseProgress` and `fetchMesoWeeklyProgress`; `volume` keeps
    stages
25. `progressService.ts` + `ExerciseProgress.tsx` headline
26. Pagination fix for H4

**Why after 3.1 and 3.4:** needs `parent_set_id IS NULL` to mean "main stage"
(3.1) and reuses 3.4's pagination approach.

**Expect a visible shift:** step 24 changes total sets, avg RIR and avg reps on
the existing meso overview charts for any historical meso containing
dropsets (§2.7). The old numbers were wrong; check them against a known
session before and after so the change is confirmed rather than assumed.

**Testable:** headline shows a percentage for an exercise with ≥2 non-deload
sessions that have RIR recorded; shows nothing for one session, for an
exercise with no RIR recorded, and for an all-deload window.

### 3.6 — Weight units

27. `src/lib/weightUnit.ts` + `useWeightDisplay.ts`
28. Per-program-exercise unit in `WorkoutDayEditorPage.tsx`
29. Logging-time override in `SetRow.tsx`; display conversion in Progress/History

**Why late:** entirely self-contained, no other feature depends on it, and it
touches display code across surfaces that are still changing until 3.5 lands.

**Testable:** an lbs exercise displays lbs everywhere and round-trips through
an edit without drift.

### 3.7 — Plan view

30. `WorkoutSwitcher.tsx`
31. Split copy: whole week vs. this workout
32. `CompactPlanRows.tsx` — a collapsed "3× Bench Press" row counts heads, not
    stages; a dropset collapses as one entry with its stage count

**Why late:** pure UI over a data model that 3.1 already finalised. Zero
dependencies in either direction.

**Testable:** switch workouts without scrolling; copy one workout from last week.

### 3.8 — Settings, library, contract

33. Additional accent colours in `tokens.css`
34. `defaultExercises.ts` seeded library
35. Confirm `sync_queue` empty → apply 009 (FK CASCADE)
36. Verification pass

**Why 009 is last:** the contract migration is the only one that can reject an
old-shaped offline payload. It runs when there is nothing left in flight.

Note that 009 does **not** retire the client-side guard from step 8 — the two
are complementary. The FK stops the database from orphaning stages; the guard
keeps TanStack Query's optimistic cache correct, since a server-side cascade
removes rows the client still holds in `setLogs` until the next refetch.

---

## 5. Decisions and Remaining Assumptions

### Locked in review

#### 5.1 Dropset model — relational, confirmed

Stages stay as linked rows in `v2_set_logs` via `parent_set_id` /
`stage_index`, as originally designed. No child `v2_set_log_stages` table.

The known cost of this choice is that a stage row is physically
indistinguishable from a working set unless you remember to filter, and
forgetting is a silent wrong number rather than an error. That cost is paid
down by the **stage-exclusion rule** (§2.1) plus the audit of all 10 affected
sites in existing code (§2.7). Recorded here rather than in the code alone so
it isn't re-derived later.

#### 5.2 e1RM — RIR-adjusted, null-RIR sets skipped

`effectiveReps = reps + rir`, and a set with no RIR recorded contributes
nothing to the average — not `?? 0`, not plain Epley.

The open sub-question this created is now answered explicitly in §2.5: **a
session where no working set has an RIR is excluded from the meso comparison
entirely**, and the window falls back to the next eligible session. It does
not fall back to unadjusted, because unadjusted e1RM is systematically lower
than adjusted for the same performance, so mixing the two manufactures a gain
out of the formula changing mid-comparison. Accepted consequence: sparse RIR
recording means some exercises show no headline at all.

#### 5.3 The single-set delete path — investigated, it exists

**Resolved, not assumed.** `SetRow.tsx:344` → `ExerciseCard.tsx:97` →
`GymSession.tsx:167` → `sessionService.ts:258` deletes one `v2_set_logs` row
directly. It is the per-set delete from FIX 8 (AUDIT E1), live in every active
session.

So the silent-promotion window between 3.1 and 009 is real, and the guard in
§2.1 — client-side cascade, **stages first, head last** — is now step 8 of
phase 3.1 rather than an optional hardening task. `SessionDetail.tsx` is
read-only for sets and needs no guard; the plan side gets CASCADE from 004 and
needs none either.

### Still open — needs your call

#### 5.4 That `is_warmup` should be added now, while warmups are deferred

SPEC §8.3 defers warmup sets but locks in that they'll carry their own flag. I
took that as licence to add the column now with no UI, so e1RM and volume are
written against the real predicate from day one.

**Why I might be wrong:** it adds two columns to production tables for a
feature explicitly out of scope, and §8.3 says the *shape* of warmups is
genuinely unresolved — per-exercise vs. global, auto-ramp vs. manual. If that
lands as a percentage ramp derived from the working weight, a boolean on
`v2_set_logs` may turn out to be the wrong shape, and I'll have added a column
that gets replaced.

The cost of being wrong is small (a defaulted boolean nobody reads). The cost
of *not* doing it is a second migration plus re-verifying every aggregate. I
lean toward adding it, but flagging rather than assuming.

#### 5.5 Lower stakes, decidable during 3.0

- **Orphan dropsets in the backfill** (§2.1) — leave unparented (preserves
  today's numbers) vs. clear the flag (honest, rewrites history). Recommending
  the former. **Genuinely undecidable until the audit query runs** — if the
  count is zero, which is plausible, the question disappears.
- **Historical `set_number` for stages** (§2.1) — recommending *not*
  renumbering, so History keeps showing past sessions as they were recorded.

Both were listed as open before; **deload weeks as e1RM endpoints** has since
been decided (excluded — §2.5) and is no longer open.

---

## 6. Carried Forward from TASKS-v2.md

Still in force, unchanged: the three resolved assumptions in TASKS-v2 §6
(shared `exercises` table; `suggest_no_plan` allows session start;
`program_exercise_id` cascade), the state-separation rule (TanStack Query owns
server state, Zustand owns UI state), the no-hardcoded-colours rule, and the
Monday-anchored week rule from FIX 14.

AUDIT items this plan closes as a by-product: **M5** (3.0), **P2** (3.4),
**P5** (3.3), **H4** (3.5), **E5** (3.6), and part of **P1** (3.3).
Not addressed: A3, A6, A7, P3, P4, Q1–Q6, E4, E6–E9.
