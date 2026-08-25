# Overload — Coach: Personalization — Technical Plan (v1, phases 1–3)

*Planning document. **Nothing here is built. No implementation code has been
written.** Read COACH-PERSONALIZATION-SPEC.md first — that is the product
source of truth; this document is the technical answer to it.
COACH-ANALYSIS-SPEC.md / COACH-ANALYSIS-TASKS.md (the daily pair) and
COACH-WEEK-ANALYSIS-SPEC.md / COACH-WEEK-ANALYSIS-TASKS.md (the weekly pair)
are the two shipped features this one reuses. References below of the form
"daily §5.11" point at COACH-ANALYSIS-TASKS.md; "weekly §7.7" points at
COACH-WEEK-ANALYSIS-TASKS.md.*

Written against the codebase as it actually stands on 2026-08-24 (last commit
`01d2de1`, migrations `001`–`015` applied, Daily Session Analysis v1 and
Weekly Analysis v1 both complete and live). Every claim about existing code
below was read directly this session, not recalled.

---

## 0. Scope of this document — and the recommendation behind it

SPEC §3 sequences this initiative as five phases. **This document covers
phases 1–3 at full task depth, and phases 4–5 at decision depth only.**

That is a deliberate split, not a shortcut, and it is closer to
"phase-by-phase" than to "all five up front". The reasoning:

**Phases 1–3 have no unknowns worth waiting on.** Form/energy/pump logging,
their Progress/History displays, and raw note capture are all conventional
work against patterns that already exist in this repo — a nullable column
with a `CHECK`, a mapper, an offline write path, a CRUD service plus TanStack
hooks, a bottom-sheet overlay. Nothing phase 4 or 5 discovers can change how
any of it should be built. Planning them now costs nothing, and they
interlock tightly enough (three migrations, one shared rating vocabulary, one
notes store with two entry points) that planning them separately would mean
re-deciding the same things three times.

**Phase 4 has exactly one unknown that no amount of planning resolves: what
real raw notes actually look like.** Curation is an AI job whose prompt has to
decide when a note becomes a new memory entry, when it updates an existing
one, and when something expires. Designing that against the single example in
SPEC §4 is guessing. This feature line has been burned by exactly that once,
and has guarded against it twice:

- Weekly §7.4 confidently predicted "several weeks available at ship". Step
  1's real-data diagnostic found **zero**, and the plan was corrected in
  place. That step exists precisely to catch assumptions before code is
  written against them.
- CONTEXT.md's "Pending feedback" defers the persona/tone prompt work with
  "One sample isn't enough signal to design a persona instruction against
  without guessing." A curation prompt written against one sample note has
  the same problem with a worse failure mode — a bad analysis is one bad
  record, a bad curation prompt quietly corrupts the standing memory that
  every future analysis reads.

**But some phase 4–5 decisions genuinely cannot wait**, because they are
schema decisions inside phase 3's migration. Whether a note carries a
"curated" marker, whether memory keeps provenance, whether expiry is soft or
hard — getting those wrong means a later migration plus a nullable code path
plus a permanent population gap, the same asymmetric-cost argument that moved
`input_snapshot` into migration 012 (daily §5.11) and `exerciseIds` into the
weekly content schema. **Those are all settled here, in §9**, and phase 3's
migration ships with them.

So: build phases 1–3 against this document. Write the phase 4–5 task detail
as a second pass once phase 3 has shipped and there are 10–20 real notes to
design a curation prompt against. That second pass is a short document — the
schema will already exist, the serverless-function shape is already decided
(§5), and only the prompt and its apply rules will be genuinely new.

**If you would rather have all five up front, say so and §6 gets extended
rather than rewritten** — nothing in phases 1–3 changes either way.

---

## 1. Two corrections to the spec's technical references

Neither changes what gets built. One changes what it looks like. Flagging
them rather than silently building something the spec does not describe.

### 1.1 — There is no slider anywhere in this app, and RIR is not one

SPEC §6 says "**Form entry** — a slider next to RIR entry, same interaction
pattern already established there" and "**Energy/pump entry** — sliders on the
session-completion screen."

Read directly: RIR entry in `src/features/gym/SetRow.tsx` is an
`<input type="number" inputMode="numeric">`, 40px wide, sitting inside the
collapsible `▼ MORE` drawer alongside SKIP. It is not a slider, and a search
for `type="range"` across `src/` returns nothing — this app has no slider
primitive at all. The pattern actually "already established there" is a small
numeric input in a MORE drawer.

**What gets built instead: a segmented chip row** — four (form, pump) or five
(energy) labelled buttons, one tap to select, tap again to clear. Reasons:

- The values are *named*, not numeric (`rushed` / `normal` / `controlled` /
  `extra controlled`). A slider forces the user to read a label off a track
  position; a chip row shows every label at once.
- Segmented rows are this app's existing idiom for a small closed vocabulary:
  `WorkoutSwitcher.tsx`'s chip row, `CoachPage.tsx` / `HistoryPage.tsx`'s tab
  bars, `WorkoutDayEditorPage.tsx`'s INHERIT/KG/LBS picker. A slider would be
  the only one of its kind in the app.
- Every interactive control in `SetRow.tsx` specifies `height: 44` or
  `minHeight: 44`. A slider thumb is a materially worse touch target on a
  phone mid-workout than a 44px chip.

The *intent* of SPEC §6 — a fast, one-gesture, optional rating sitting right
next to RIR — is fully met. Only the word "slider" is not. **Listed as an
open question in §10**, since it is a direct divergence from the spec's own
wording and is a one-file change if you would rather have a real slider.

### 1.2 — There is no `CoachContextTab.tsx`

Daily §6's file list named one, and CONTEXT.md still refers to "the Context
tab". What actually shipped is `CoachPage.tsx` rendering `<PhaseLog />` and
`<WeightLog />` directly inside its `context` branch — no wrapper component
exists. The Context-tab note box and the Memory view therefore get added the
same way: two more components rendered directly by `CoachPage.tsx`. Nothing
is blocked; only the file name in the plan changes.

---

## 2. Tech approach, with reasoning per choice

### 2.1 Rating values are stored as `text` with a `CHECK`, not as integers

**Decision: `form_rating`, `energy_rating` and `pump_rating` are all nullable
`text` columns with a `CHECK` against their exact vocabulary.**

| Option | Verdict |
|---|---|
| **`text` + `CHECK`** | **Chosen.** Every enumerated vocabulary already in this schema is exactly this shape: `phase text check (phase in ('cut','bulk','maintain'))`, `kind text check (kind in ('daily','weekly_average'))`, `movement_pattern text check (…)` (migrations 012, 013). It is also self-describing in the JSON payload the model reads — `"formRating": "rushed"` needs no legend, `"formRating": 1` needs one, and a legend living in a prompt is a second place for meaning to drift away from the data. |
| `smallint` 1–4 | Rejected. Its only real advantage is that `avg()` works in SQL — and averaging is a *display* concern that belongs in one pure module at read time (§2.2), not baked into storage, where changing or reordering the vocabulary later becomes a data migration rather than an `UPDATE`. |
| A Postgres `enum` type | Rejected. No `enum` type exists anywhere in this schema, and adding a value to one is DDL. `CHECK` gives the same guarantee with the tooling this project actually uses (hand-applied SQL through the dashboard editor). |

Vocabularies, snake_case to match `weekly_average` / `hip_hinge`:

```
form_rating    'rushed' | 'normal' | 'controlled' | 'extra_controlled'
energy_rating  'none' | 'low' | 'normal' | 'high' | 'supreme'
pump_rating    'none' | 'some' | 'good' | 'extreme'
```

`'none'` covers the spec's "no energy" / "no pump" — a *rated* absence, which
is a real signal and not the same thing as `NULL` (not rated at all). That
distinction is load-bearing for SPEC §7's "absence is data too": `NULL` means
the model reasons on numbers alone; `'none'` means the lifter said there was
nothing in the tank.

### 2.2 One pure module owns the vocabulary, the labels and the ordinal scale

**`src/features/gym/ratingScales.ts` — pure, Vitest-covered.** Same precedent
as `setGroupLogic.ts`, `referenceLogic.ts`, `e1rm.ts`, `weightUnit.ts`,
`positionMatch.ts`, `compactPlanLogic.ts` and `weekBuckets.ts` — every one of
which was extracted precisely because vocabulary/aggregation logic embedded
in a component is where this project's bugs have historically hidden.

It exports, per dimension: the ordered value list (which is also the chip
order), a display-label map, `toOrdinal(value)`, and `averageRating(values)`
→ `{ mean, scaleMax, count } | null` — null for zero rated values, never
`0`, which would render as a real rating.

**Why `averageRating` returns its scale rather than a bare number.** Form and
pump are 1–4, energy is 1–5. A bare `2.8` on screen is ambiguous and, worse,
looks comparable across dimensions when it is not. Everything renders as
`2.8 / 4`.

**Stated as an assumption, not a fact (see §7.1): averaging these treats the
scale as equal-interval**, which ordinal ratings do not guarantee — the gap
between `rushed` and `normal` is not provably the same as the gap between
`controlled` and `extra_controlled`. SPEC §6 asks for averages explicitly, so
averages get built; showing the denominator is the cheap honesty measure.

Placed in `features/gym/` rather than `features/coach/` deliberately: per
SPEC §7's gating principle these are first-class training data owned by the
logging surface, not Coach data. `features/coach/` importing from
`features/gym/` is already the established direction (`analysisInput.ts`
imports `referenceLogic.ts`, `setGroupLogic.ts` and `sessionService.ts`
types); the reverse is not.

### 2.3 Energy and pump are columns on `v2_sessions`, not a new table

They are 1:1 with a session, always, and optional. The only per-session
optional attribute that exists today (`note`) is a column on `v2_sessions`.
A separate `v2_coach_session_ratings` table would add a join to every History
and Progress read for two nullable values and buy nothing.

`v2_sessions` and `v2_set_logs` are both `v2_`-prefixed — this app's own
namespace inside the Supabase project shared with Northstar v2 — so unlike
migration 013's `exercises` columns there is **no cross-app blast radius
here** and no Northstar assumption to flag (weekly §7.13 does not apply).

Adding a nullable column with no default is metadata-only on Postgres 11+ (no
table rewrite); this project runs 17.6.1.141, confirmed live before migration
009.

### 2.4 The offline write paths are the real engineering risk in phase 1

Form rating is logged **inside an active workout** — the one surface in this
app with a hard offline requirement. Energy and pump are logged at
completion, which also has an offline branch. Neither is a display-layer
change.

Concretely, `form_rating` has to travel through all of:

1. `SetRow.tsx`'s `onLog` params → `GymSession.tsx`'s `onLog` →
   `useLogSet`'s `mutationFn` params.
2. **`useLogSet`'s offline branch, twice** — the `db.set_logs.put({…})`
   object *and* the `db.sync_queue.add({ payload: {…} })` object
   (`useSession.ts:647` and `:671`). Both are explicit field lists, not
   spreads. A field missed in the second one syncs a `NULL` to Postgres with
   no error and no warning.
3. `useLogSet`'s optimistic `onMutate` entry and its offline return value
   (that one is `satisfies SetLog`, so the compiler catches it).
4. `sessionService.ts`'s `logSet()` insert.
5. `sessionService.ts`'s `updateSetLog()` patch builder — RIR is editable on
   an already-logged row (`SetRow.tsx`'s `isEditing` block), so form must be
   too, or two controls that sit side by side behave inconsistently for no
   reason.
6. `db.ts`'s `CachedSetLog` interface — **no Dexie version bump needed.**
   `formRating` is a plain field, not an index, and `db.ts`'s own `version(2)`
   comment records exactly this precedent for
   `stageIndex`/`isWarmup`/`setSeconds`/`enteredUnit`. Rows cached by an older
   client will not have it, and readers must treat `undefined` as `null` —
   the same rule already written down there.

Energy/pump travel through `SessionComplete.tsx` → `useCompleteSession`'s
params → **its offline branch's `sync_queue` payload** →
`sessionService.completeSession()` → `db.ts`'s `CachedSession`.

**`useSyncQueue.ts` needs no change at all** for any of this — its replay is
fully generic (`supabase.from(item.table).upsert(item.payload)`), so a new
column inside an existing payload flows through untouched. That same
genericity is what makes §2.6's offline-note decision cheap.

**`completeSession(id, note)` gains two optional parameters**, not a
signature rewrite. Two call sites: `SessionComplete.tsx` (passes them) and
`useAutoFinishSession.ts` (does not — an automatically finished session has
no UI moment at which to collect a rating, so both stay `null`, which is the
correct "not rated" state rather than a gap).

**The `select('*')` accident that works in our favour, and the five places it
does not.** `sessionService.ts` reads set logs with `select('*')` at three
sites (`:129`, `:424`, `:523`), so those pick up the new column for free.
These use explicit column lists and must each be extended, or they will map a
real rating to `null` silently:

- `analysisInput.ts:343` (current-session logs) and `:418` (reference logs)
- `progressService.ts:98` (`fetchAllExerciseSetLogRows`) and `:390`
  (`fetchMesoWeeklyProgress`)
- `historyService.ts:171` (`fetchHistoryDetail`)

`offlineCache.ts:110` selects `*` but writes an explicit field list into
Dexie — that list needs the field too.

### 2.5 `v2_coach_notes` — `on delete set null`, deliberately unlike the daily table

```
id, user_id, body, session_id (nullable), curated_at (nullable), created_at
```

Two decisions worth the words:

**The FK to `v2_sessions` is `on delete set null`, not `on delete cascade`.**
Daily §5.7 chose cascade for `v2_coach_session_analyses` because an analysis
of a session that no longer exists is not a useful record. A note is the
opposite: "wrist's been bothering me, being cautious with forearm work" does
not stop being true because the session it was typed during was later deleted
from History. This is the same reasoning weekly §7.7 used to give
`v2_coach_week_analyses` no cascade at all — and, like that one, it is a
knowing inconsistency with the daily table's rule, recorded rather than
smoothed over. The note keeps its own `created_at`, so it never loses its
place in time; it loses only which workout it was written during.

**`curated_at timestamptz null` ships in this migration, not a later one.**
A phase-4 field landing in a phase-3 migration, on purpose — see §9.1 for the
full argument. Short version: it is the watermark that makes "which notes has
curation not seen yet" a single indexed predicate, and adding it now is one
line in a migration that has never run, versus a migration plus a nullable
code path plus a permanent population gap across every note written before
it. Exactly the calculus that put `input_snapshot` into 012.

`body` carries `check (length(btrim(body)) > 0)` — an all-whitespace note is
a UI slip, not data, and the constraint means the UI's trim-and-reject is
backed by something rather than being the only guard.

### 2.6 Notes queue offline; the note *list* stays online-only

The sidebar lives on the workout screen, which is the offline surface, and
"jot down the thing that just happened to my wrist" is precisely the moment
signal is worst. Making the sidebar online-only would silently drop the use
case it exists for.

**Decision: the note write goes through `db.sync_queue` when offline** —
client-generated `uuid`, `user_id`, `body`, `session_id`, `created_at`, the
same shape as `useLogSet`'s offline branch. `useSyncQueue.ts`'s replay is
table-generic, so this costs one queue write and zero changes to the sync
runner.

**The note *list* is not mirrored in Dexie.** Coach has no offline
requirement (daily §4) and no Coach table is cached today. So: what you type
offline is safely queued and appears in the Context list once it syncs; the
sidebar shows this session's notes optimistically from the TanStack cache
(the same `onMutate` pattern `useLogSet` already uses), so you can see what
you just wrote either way; and the Context tab keeps the
`useOnlineStatus`-driven "REQUIRES A CONNECTION" empty state every other
Coach surface already uses.

The rejected alternative — a full Dexie mirror for notes — buys offline
*reading* of historical notes, which nothing in SPEC asks for, at the cost of
a new cached table, a new priming path and a new staleness question.

### 2.7 `v2_coach_memory_entries` — freeform prose, soft expiry, recorded provenance

```
id, user_id, body, source ('curation'|'manual'), status ('active'|'expired'),
created_at, updated_at
```

- **No structured fields.** SPEC §4 and §8 reject exercise / muscle-group /
  date-range columns for this data shape *outright*, not as a deferral, and
  the wrist example is the stated test case. `body` is prose, full stop.
- **Soft expiry, not delete.** SPEC §4 says curation decides whether to "add,
  update, or let something in memory **expire**" — which is not the same word
  as delete, and this feature line inherits daily §8's "never destroy raw
  data". An expired entry stays visible (collapsed) and restorable; only
  `status = 'active'` rows reach the analysis prompt. A user's own explicit
  delete *is* a hard delete — they asked for it, and SPEC §7 puts full user
  control above curation's bookkeeping.
- **`source` is provenance, not permission.** Curation may update or expire
  any entry regardless of `source`; the column exists so that a surprising
  rewrite is traceable in the UI rather than mysterious. A user hand-editing
  an entry flips it to `'manual'`, which is itself a useful signal to hand the
  curation prompt ("the lifter corrected this one themselves").

### 2.8 Curation runs as a third serverless function, structured output, deterministic apply

Full detail in §5. The shape, decided now because §9 depends on it:

- **`api/coach/curate-memory.ts`** — a third file under `api/`, not a mode
  flag on either existing handler. Same reasoning as weekly §1.1:
  `vercel.json`'s `functions` block is already `{"api/**": {"maxDuration":
  60}}`, so a new file inherits the timeout with **no config change**;
  `tsconfig.api.json` is already `include: ["api"]` and `npm run typecheck`
  already runs both projects; and each handler staying one flow keeps the
  adversarial-review surface small and separately reviewable.
- **`authorizeCoachRequest(req, res)` from `coachApiAuth.ts` is reused
  unchanged** — it already carries four adversarial-review hardening fixes
  and is already shared by both existing handlers.
- **The model returns a decision list; code applies it.** Not tool-use, not
  the model writing rows. This matches both existing handlers and this
  project's standing preference: the LLM makes the judgment call, tested
  deterministic code performs every step that is not one.

### 2.9 Gating — one new `coachGate.ts` call site, and the server gate is unchanged

Per SPEC §7's "gate by purpose, not by proximity to Coach", and the
correction issued with this plan's brief:

| Surface | Gated? |
|---|---|
| Form rating control in `SetRow.tsx` | **No.** First-class training data, same as RIR. |
| Energy/pump controls in `SessionComplete.tsx` | **No.** Same. |
| Progress avg form / per-week form, energy, pump | **No.** Same. |
| History per-set form, per-workout energy/pump, session duration | **No.** Same. |
| **In-workout sidebar button + panel** | **Yes — `isCoachUser(user?.id)`. The one new call site this phase adds.** "Notes for the coach" has no meaning without a coach. |
| Context tab note box + list | No separate check — already inside the gated `/coach` route (`CoachPage.tsx` returns `<CoachLocked />` before rendering any tab). |
| Coach Memory view | Same — inside `/coach`. |

Worth stating so it is not misread as adding a gate that was ruled out: the
**server-side** `COACH_USER_ID` check still applies to
`api/coach/curate-memory.ts`, because that is the gate guarding API spend and
it is the only one that has ever mattered (daily §1.4). It arrives free with
`authorizeCoachRequest` and is *not* a new `coachGate.ts` call site —
`coachGate.ts` is the cosmetic client-side gate, a different thing entirely.

### 2.10 What is *not* being introduced

No new dependency (`@anthropic-ai/sdk` and `@vercel/node` are already in
`package.json`). No `vercel.json` change. No `tsconfig` change. No Dexie
version bump (§2.4). No new state library. No change to `useSyncQueue.ts`.
No offline support for Coach reads. No change to the
`v2_history_session_summary` view — see §7.4 for why energy/pump land on the
session *detail* rather than the session *list*.

---

## 3. Migrations

Three migrations, one per phase that needs schema. `015` is the last applied,
so these are **016, 017, 018**.

**Why three and not one.** This repo's convention is a migration per build
step, applied by hand through the SQL Editor and independently verified
before the code that depends on it lands (012 → daily tables, 013 → weekly
schema, 014 → tag data, 015 → a backfill). Bundling all three here would mean
applying phase 4's schema to production before phase 1 has shipped —
irreversible production state running ahead of the code that needs it, which
is the opposite of every prior step's discipline.

### 3.1 Migration 016 — `016_v3_coach_personalization_ratings.sql` (phase 1)

```sql
-- Overload v3 — Coach Personalization phase 1: form / energy / pump ratings.
-- Additive only. Three nullable text columns, no default, no NOT NULL, no
-- backfill — every existing row stays exactly as it is and reads as "not
-- rated" (COACH-PERSONALIZATION-SPEC.md §5, §7 "absence is data too").
--
-- v2_-prefixed tables only: unlike migration 013's exercises columns, these
-- are in this app's own namespace, so there is no cross-app (Northstar v2)
-- consideration. Nullable-column-with-no-default is metadata-only on
-- Postgres 11+ (this project runs 17.6.1.141), so no table rewrite.

alter table v2_set_logs
  add column form_rating text
  check (form_rating in ('rushed','normal','controlled','extra_controlled'));

alter table v2_sessions
  add column energy_rating text
  check (energy_rating in ('none','low','normal','high','supreme'));

alter table v2_sessions
  add column pump_rating text
  check (pump_rating in ('none','some','good','extreme'));
```

**Verification, before anything is built on it** — the same standard every
prior migration in this repo was held to, and specifically *not* "it applied
without an error":

1. `information_schema.columns` for all three: correct table, `data_type`
   `text`, `is_nullable` `YES`, `column_default` `NULL`.
2. **All three `CHECK`s proven by attempting to violate them**, the way
   migration 013's three constraints were — an `UPDATE … set form_rating =
   'sloppy'` on one real row must return a real `23514` and write zero rows,
   and likewise for an out-of-vocabulary energy and pump value. Reading the
   constraint back off the DDL is not the same claim.
3. `select count(*) from v2_set_logs where form_rating is not null` → **0**,
   and the same for both session columns. Confirms nothing was
   backfilled or defaulted by accident.
4. `select count(*) from v2_set_logs` and `from v2_sessions` — unchanged from
   a count taken immediately before applying. Confirms no row was touched.

### 3.2 Migration 017 — `017_v3_coach_notes.sql` (phase 3)

```sql
-- Overload v3 — Coach Personalization phase 3: raw note capture.
-- One new table. Coach Notes is the UNFILTERED input Coach Memory is later
-- built from (SPEC §4) — deliberately not the same thing as Memory, which
-- arrives in 018.

create table v2_coach_notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  -- Sidebar-sourced notes carry the session they were written during;
  -- general notes from the Context tab carry null (SPEC §5).
  -- SET NULL, not CASCADE: a note outlives the session it was typed in —
  -- see §2.5. Deliberate divergence from v2_coach_session_analyses' rule.
  session_id uuid references v2_sessions(id) on delete set null,
  -- Curation watermark (phase 4, landing here on purpose — §9.1).
  -- null = this note has never been through a curation run.
  curated_at timestamptz,
  created_at timestamptz not null default now()
);

alter table v2_coach_notes enable row level security;
create policy "Users access own rows" on v2_coach_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The Context tab's list, newest first.
create index v2_coach_notes_user_idx on v2_coach_notes(user_id, created_at desc);
-- The curation input query: "every note this user has not been curated yet".
-- Partial, because the uncurated set is the only thing ever queried this way
-- and it shrinks to near-zero after each run.
create index v2_coach_notes_uncurated_idx
  on v2_coach_notes(user_id, created_at)
  where curated_at is null;
-- The sidebar's "notes written during this session" list.
create index v2_coach_notes_session_idx on v2_coach_notes(session_id)
  where session_id is not null;
```

**Verification:** `information_schema.columns`; `pg_indexes` returns exactly
four (pkey + the three above); `pg_policies` and `pg_class.relrowsecurity`
both confirm RLS live; the `body` `CHECK` proven by attempting to insert
`'   '` and getting a real `23514`; and the `on delete set null` behaviour
proven for real rather than read off the DDL — insert a note against a
throwaway session, delete that session, confirm the note survives with
`session_id` null. (Use a session created and deleted purely for this check,
never a real one.)

### 3.3 Migration 018 — `018_v3_coach_memory.sql` (phase 4)

Listed here for completeness of the schema picture; **it lands with phase 4,
not now**, and its exact `check` vocabularies are the one part of this
migration that could still move if §10's open questions change anything.

```sql
create table v2_coach_memory_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(btrim(body)) > 0),
  source     text not null check (source in ('curation','manual')),
  status     text not null default 'active' check (status in ('active','expired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table v2_coach_curation_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  input_snapshot jsonb   not null,   -- exactly what the model was shown
  decisions      jsonb   not null,   -- exactly what it returned
  applied        jsonb   not null,   -- what code actually did with it
  model          text    not null,
  prompt_version integer not null default 1,
  input_tokens   integer,
  output_tokens  integer,
  note_count     integer not null,
  created_at     timestamptz not null default now()
);
```

Both get the identical RLS policy shape, plus
`(user_id, status, created_at)` on entries and `(user_id, created_at desc)`
on runs.

**`v2_coach_curation_runs` is the one table in this plan the spec does not
name** — see §7.6 for the full argument and §10 for it as an explicit
review question. Short version: curation *mutates* a store instead of writing
a permanent record, which makes provenance more important than it was for the
other two AI surfaces, not less, because the output is not self-documenting.
It is also the only thing that can answer "why did my memory change?".

---

## 4. Data models

TypeScript interfaces live in `src/types/index.ts` alongside the existing
Coach ones, same camelCase-domain / snake_case-DB split with mappers in the
service layer.

### 4.1 Ratings (phase 1)

```ts
export type FormRating = 'rushed' | 'normal' | 'controlled' | 'extra_controlled'
export type EnergyRating = 'none' | 'low' | 'normal' | 'high' | 'supreme'
export type PumpRating = 'none' | 'some' | 'good' | 'extreme'

// SetLog gains:
formRating: FormRating | null      // null = not rated (SPEC §7)

// Session gains:
energyRating: EnergyRating | null
pumpRating: PumpRating | null
```

`formRating` is a **required key with a nullable type**, not an optional key.
That forces every `SetLog` mapper to say what it produces, which is what
turns §2.4's "five explicit column lists" from a silent-null hazard into a
compile error at each site. The one place `undefined` is legitimately
possible is a Dexie row cached by an older client (`db.ts`'s documented
`stageIndex === undefined` precedent), and the Dexie→domain mapper coerces
it to `null` there.

### 4.2 Rating scales (phase 1, pure)

```ts
export interface RatingScale<T extends string> {
  values: readonly T[]        // ordered low → high; also the chip order
  labels: Record<T, string>   // 'extra_controlled' → 'EXTRA CONTROLLED'
}

export interface RatingAverage {
  mean: number       // 1-based, matching toOrdinal
  scaleMax: number   // 4 or 5 — always rendered, never dropped (§2.2)
  count: number      // how many rated values produced it
}

export const FORM_SCALE: RatingScale<FormRating>
export const ENERGY_SCALE: RatingScale<EnergyRating>
export const PUMP_SCALE: RatingScale<PumpRating>

export function toOrdinal<T extends string>(scale: RatingScale<T>, value: T): number
export function averageRating<T extends string>(
  scale: RatingScale<T>, values: (T | null)[],
): RatingAverage | null
```

### 4.3 Notes (phase 3)

```ts
export interface CoachNote {
  id: string
  userId: string
  body: string
  sessionId: string | null   // null for a general (Context tab) note
  curatedAt: string | null   // null = not yet seen by a curation run
  createdAt: string
}
```

### 4.4 Memory and curation (phase 4 — shape settled, detail deferred)

```ts
export type MemoryEntrySource = 'curation' | 'manual'
export type MemoryEntryStatus = 'active' | 'expired'

export interface CoachMemoryEntry {
  id: string
  userId: string
  body: string
  source: MemoryEntrySource
  status: MemoryEntryStatus
  createdAt: string
  updatedAt: string
}

// What the model returns. Applied by code, never by the model (§2.8).
export type CurationDecision =
  | { op: 'add';    body: string; reason: string }
  | { op: 'update'; id: string; body: string; reason: string }
  | { op: 'expire'; id: string; reason: string }

export interface CurationResult {
  decisions: CurationDecision[]
  // Ids the model referenced that were not in what it was sent. Dropped,
  // never applied — same defence WeekAnalysisDetail already applies to
  // hallucinated exerciseIds before rendering deep links.
  rejectedIds: string[]
  notesCurated: number
}
```

### 4.5 What phase 5 adds to the existing payload

Additive to types that already ship. Nothing is removed or reshaped.

```ts
// PositionMatchSetValue (positionMatch.ts) gains one field.
formRating: FormRating | null

// AnalysisInput.session gains two.
energyRating: EnergyRating | null
pumpRating: PumpRating | null

// AnalysisInput gains two.

// This session's own notes — session_id-filtered against the session being
// analyzed, fetched directly and unconditionally (not gated on curation
// status: curation runs roughly weekly and daily analysis is typically
// same-day, so a same-session note almost never reaches Memory in time —
// §7.8, reversed 2026-08-25). Bodies only, oldest → newest, same no-ids
// reasoning as memory below.
sessionNotes?: string[]

// Active entries only, oldest → newest.
// Bodies only — no ids: the model reads memory, it never edits it, and
// handing it ids invites citation of a key the output schema has no slot for.
memory?: string[]
```

**`memory` and `sessionNotes` are both optional in the interface on
purpose.** `input_snapshot` on every `v2_coach_session_analyses` row written
before `PROMPT_VERSION 4` was frozen without either, and those rows are
permanent and unregenerable (SPEC §9). Optional keys state that honestly.
Nothing reads `input_snapshot`'s contents today (`AnalysisDetail.tsx` renders
`content`), so no existing render path breaks either way — but the type
should not claim fields that a real stored row does not have.

---

## 5. The curation process — trigger, location, and how it calls the model

This is the part of the initiative with no precedent in the codebase: the
other two AI surfaces *append a permanent record*, this one *mutates a
standing store*. Decided now because the answer constrains phase 3's schema;
the prompt itself is deferred (§0).

### 5.1 Trigger: manual, from the Context tab

| Option | Verdict |
|---|---|
| **A manual `UPDATE MEMORY` action under Context** | **Chosen.** "Manual before automatic" is a stated principle (daily §8) that has now held through two AI surfaces, and every generation in this feature line is a conscious, costed click. The button shows the uncurated note count (`3 NEW NOTES`) and is disabled at zero, so the cost is visible before it is paid. |
| Automatic after each session completion | Rejected for v1. It fires on a schedule the user did not choose, it fires when there may be nothing new to curate, and it couples a training action to an API spend. Revisit once curation quality is trusted — the same "revisit once trusted" the automatic-analysis trigger got. |
| A Vercel Cron schedule | Rejected. New platform surface for the same reason as above, plus nothing about curation is time-sensitive. |
| Folded into the daily analyze call | **Rejected by the spec itself** — SPEC §4: "a separate job, so neither task gets diluted." |

### 5.2 Location: `api/coach/curate-memory.ts`

A third Vercel function, for the reasons in §2.8. It reuses
`authorizeCoachRequest` verbatim, so the auth, the invisible-character-stripped
`COACH_USER_ID` compare, the JWT-scoped client construction and the
"don't echo upstream errors" discipline all arrive already hardened.

**No service-role key**, same as both existing handlers: reads and writes go
through a client built from the caller's own access token, and RLS does the
rest.

### 5.3 The flow, in order

1. **Authorize** (`authorizeCoachRequest`) → `{ supabase, userId }`.
2. **Rate-limit guard.** If a `v2_coach_curation_runs` row exists for this
   user within the last 60 seconds → `409` with a plain reason. This is not a
   lock and does not pretend to be one — it exists to kill the actual failure
   mode, an impatient double-tap paying twice, without the pending-row state
   machine daily §5.12 explicitly rejected. §7.7 states the residual risk.
3. **Read the uncurated notes** — `curated_at is null`, ordered oldest first
   (the partial index in 017 serves this exactly). Each note carries its
   `body`, `created_at`, and, when `session_id` is set, that session's date
   and workout-day name so the model can place it in time.
4. **Zero uncurated notes → return `200` with an empty result and never call
   the model.** The cheapest money guard available, and the only one this
   function has that is genuinely free.
5. **Read the current memory** — `status = 'active'`, `id` + `body` +
   `source`, oldest first.
6. **One Anthropic call** — details in §5.4.
7. **Validate before applying.** Every `id` in an `update` or `expire`
   decision must be in the set the function actually sent. An unrecognised id
   is collected into `rejectedIds` and **dropped, never applied** — the same
   defence `WeekAnalysisDetail.tsx` already applies to hallucinated
   `exerciseIds`. An `add` with an empty or whitespace-only body is dropped
   the same way.
8. **Apply deterministically** — insert each `add` with `source: 'curation'`;
   patch each `update`'s `body` and `updated_at`; set each `expire`'s
   `status`. Every write carries `.eq('user_id', userId)` alongside RLS, the
   defence-in-depth pattern every query in this feature uses.
9. **Insert the run row** with `input_snapshot`, `decisions`, `applied`,
   `model` (from `response.model`, not the request constant),
   `prompt_version`, token counts and `note_count`.
10. **Stamp `curated_at = now()`** on exactly the note ids read in step 3 —
    by id list, not by a `curated_at is null` re-filter, so a note created
    while the model was thinking is not silently marked as seen.
11. **Return** `{ applied, rejectedIds, notesCurated }` so the UI can say what
    changed rather than just "done".

**Ordering note on steps 8–10 — corrected 2026-08-25, during this feature's
first adversarial review, after the original text below shipped exactly as
written.** There is no transaction across PostgREST calls, so a failure
between them leaves partial state; the order has to make every partial state
safe-ish in the same direction. Steps 9 and 10 above are swapped from this
plan's original order (memory changes, **then stamp notes, then insert the
run row**) — the run row now lands before the stamp.

**What the original reasoning got right:** memory changes must land first.
Reversing *that* would silently consume notes that produced nothing, which
is the one failure mode genuinely worse than anything the plan below
accepts.

**What the original reasoning missed:** it argued only about the window
*before* step 9 ("a crash before step 9 means a re-run re-reads the same
notes and may duplicate an entry — visible, editable, and deletable by
hand") and never examined the window *between* the original step 9 and step
10 — i.e. between the notes being stamped and the run row being inserted.
That window is not the same failure class. A crash there leaves the note's
`curated_at` already non-null, so `v2_coach_notes_uncurated_idx`'s `where
curated_at is null` predicate (§3.2) permanently excludes it from every
future run — unlike the crash-before-original-step-9 case, this one is
**not** retryable — while zero `v2_coach_curation_runs` row exists to say
why the memory entry changed, defeating §7.6's entire stated reason that
table exists. The original text's "safe-ish in the same direction" claim
covered two of the three step-boundaries and missed the third because it
was never separately reasoned through — an oversight, not a considered
trade-off, confirmed live via a mocked failure-injection test against the
real handler (not a re-read of this document) during the 2026-08-25
adversarial review; see CONTEXT.md's "phase 4 adversarial review" session
entries for the reproduction.

**Why the swap fixes it without introducing a new failure class:** putting
the run-row insert before the stamp means a crash in that same window now
leaves the note un-stamped instead of stamped — which folds it back into the
*already-accepted*, already-argued-safe class above (a re-run re-reads the
same notes, may duplicate an entry, visible and correctable by hand). No
crash window is left that produces a permanent, silent, unexplained state
change. Recorded in §7.7 rather than solved with machinery, same as before —
only the ordering that makes "recorded, not solved with machinery" actually
true has changed.

### 5.4 Model configuration

- **`claude-haiku-4-5-20251001`**, the pinned snapshot, same provenance
  reason as daily §1.6 — `model` is stored per run, so an alias that
  auto-resolves at call time would make historical rows unable to say what
  wrote them. `response.model` is persisted, not the request constant.
- **Structured output** — `output_config: { format: { type: 'json_schema',
  schema } }`, the `CurationResult`-shaped schema from §4.4. Same mechanism
  both existing handlers use.
- **`max_tokens: 4000`.** Generous — the output is a short decision list, not
  prose — and it doubles as a latency cap.
- **Thinking: off**, same as both existing prompts, revisited only if real
  output is thin. Haiku 4.5 uses the older
  `thinking: { type: 'enabled', budget_tokens: N }` form and **errors** on
  `output_config.effort`.
- **Prompt caching: not used.** Haiku 4.5's minimum cacheable prefix is 4,096
  tokens and this system prompt will be well under it, so a `cache_control`
  marker would silently do nothing.
- **`coachCurationPrompt.ts`** holds `CURATION_PROMPT_VERSION = 1` and the
  system prompt, in its own file with its own counter — independent of
  `PROMPT_VERSION` (daily, at 3) and `WEEK_PROMPT_VERSION` (weekly, at 1),
  exactly as those two are independent of each other.
- **Latency is measured before the function file exists.** A throwaway script
  sends one real payload and reports wall-clock and tokens — the literal first
  action of phase 4's server work, same discipline as daily's E1 and weekly's
  step 6, and for the same reason: every subsequent piece is work a bad number
  would invalidate. The payload here is far smaller than either existing one
  (a handful of notes plus a short memory list, likely well under 2k input
  tokens), so a fast result is expected — but expected is not measured.
- **Cost, roughly:** at $1 / $5 per MTok and a payload that small, well under
  a cent per run, at maybe one run a week.

### 5.5 What the prompt has to do (the part deliberately not written yet)

Recorded so phase 4's second pass knows what it is designing, not as
finished prompt text:

- Decide **add vs. update vs. expire** — the genuinely hard call, and the one
  that needs real notes to calibrate. When is "wrist still sore" an update to
  an existing wrist entry rather than a second entry?
- **Never invent an id.** Only ids present in the input may appear in an
  `update` or `expire` (enforced in code regardless — §5.3 step 7 — but the
  prompt should not be trying).
- **Expire conservatively.** A memory entry that stops being true is the case
  for expiry; silence about a topic is not.
- **Preserve the conditional reasoning.** SPEC §4's whole argument for prose
  over fields is that "cautious about forearm work because of a past injury,
  especially during a cut" loses its meaning when compressed. The prompt must
  not compress it either.
- **Treat note text as data, never as instructions.** Notes are free text
  that reaches the model. In a single-account personal app this is only ever
  self-injection, but the payload keeps notes and memory in the *user* turn
  (which it already does — the whole payload is JSON in the user message) and
  the system prompt should say plainly that note content is material to reason
  about, not directions to follow.

---

## 6. Implementation order

The same ordering principle as both prior plans — **everything verifiable
against real production data for free comes before anything that costs money
per run** — plus one addition specific to this feature: **phase 2's live
verification depends on a real workout happening**, which is a calendar
dependency, not an engineering one. It is called out where it lands (step 11)
rather than discovered there.

### Phase 1 — form / energy / pump logging

**1. Migration 016.** Applied by hand through the SQL Editor, then verified
per §3.1 — including the three prove-it-by-violating-it `CHECK` tests and the
two "nothing was touched" counts. *First because* everything downstream writes
to it, and it is the one step that changes production state irreversibly.

**2. `ratingScales.ts` + `ratingScales.test.ts`.** Pure, no React, no I/O.
Cases: `toOrdinal` for every value of all three scales; `averageRating` over
a mixed list containing nulls; `averageRating` over all-nulls → `null` (not
`0`); a single rated value; `scaleMax` correct per dimension (4/5/4);
`values` order matches the low→high semantics the chip row renders.

**3. Types and mappers.** `FormRating` / `EnergyRating` / `PumpRating`,
`SetLog.formRating`, `Session.energyRating` / `.pumpRating`, `CachedSetLog` /
`CachedSession` (no Dexie version bump — §2.4), and every mapper the compiler
now flags: `sessionService.ts`'s `toSetLog` / `toSession`, `offlineCache.ts`'s
Dexie write, and the four explicit column lists in §2.4.

**4. The form-rating write path.** `SetRow.tsx`'s chip row inside the `▼ MORE`
drawer next to RIR, plus the same control in the `isEditing` block; the new
`onLog` param through `GymSession.tsx` into `useLogSet` (**both branches, and
the `sync_queue` payload specifically**); `sessionService.logSet()`'s insert;
`sessionService.updateSetLog()`'s patch builder. Form is offered on stage
input rows too — a drop stage is a set that was performed with some quality
(§7.2 covers why the *averages* nonetheless exclude stages).

**5. The energy/pump write path.** Two chip rows in `SessionComplete.tsx`
above the note textarea, prefilled-once from the existing session via the same
`noteInitialisedRef` pattern already there (so re-completing a reopened
session does not silently clear a rating); `useCompleteSession`'s params
through **both branches**; `completeSession()`'s two new optional parameters.
`useAutoFinishSession.ts` is deliberately untouched.

**6. Verify phase 1.** `npm run typecheck` (both projects), `npm test`,
`vite build`. Then live: log a real set with a form rating and confirm the
stored row; **log one set with the device offline and confirm it syncs with
the rating intact** (the single highest-risk path in this phase — a missed
field in `useSession.ts:671` fails silently); complete a session with energy
and pump and confirm both stored; **complete a session with energy and pump
ratings while offline and confirm both sync intact on reconnect** (same risk
class as the form-rating offline check above and §2.4's explicit field lists
in `useCompleteSession`'s offline branch — energy/pump shouldn't be the one
path in this risk class without its own named check); confirm an unrated set
stores `NULL` rather than a default.

### Phase 2 — display

**7. `progressService.ts`.** `form_rating` into `fetchAllExerciseSetLogRows`'s
select; `avgFormRating: RatingAverage | null` on `ExerciseSessionPoint`,
computed heads-only, skipped-and-warmup-excluded, exactly matching how
`avgRir` is already computed (§7.2). `energy_rating` / `pump_rating` /
`form_rating` into `fetchMesoWeeklyProgress`'s select, and
`avgFormRating` / `avgEnergyRating` / `avgPumpRating` onto `WeekPoint` —
energy and pump average across the week's *sessions*, form across its *sets*.

**8. `ExerciseProgress.tsx` and `MesoProgress.tsx`.** Average form alongside
the stats already in the exercise view; per-week form, energy and pump on the
meso dashboard. Every figure renders with its scale (`2.8 / 4`). A dimension
with zero rated values renders nothing at all — not `0`, and not `—` where
that would be mistaken for a rating of none.

**9. `historyService.ts`.** `form_rating` into `fetchHistoryDetail`'s
`v2_set_logs(…)` select and onto `HistorySetRow`; `energy_rating` /
`pump_rating` into the same query's session columns and onto **`HistoryDetail`,
not `HistoryRow`** (§7.4 — this is what avoids a fifth migration to recreate
the `v2_history_session_summary` view).

**10. `SessionDetail.tsx`.** Per-set form beside the existing `RIR n`; a
per-workout energy/pump line; and session duration from the `startedAt` /
`completedAt` already on `HistoryRow`, formatted with the existing
`formatRestTime` and guarded with the identical `!== null && > 0` check
`SessionTypeHistoryView.tsx`'s DURATION column already applies (§7.5).

**11. Verify phase 2 — against real rated data.** This step cannot be
completed the same day phase 1 ships unless a real session is logged with
ratings in between. **Recommended sequencing: phase 1's step 6 live check *is*
a real workout logged with ratings**, which unblocks this step immediately
afterwards. Avoid the alternative of hand-inserting rows into production to
satisfy a verification step.

### Phase 3 — raw note capture

**12. Migration 017**, applied and verified per §3.2 — including the `body`
`CHECK` violation test and the `on delete set null` behaviour proven against a
throwaway session.

**13. `coachNotesService.ts` + `useCoachNotes.ts` + `CoachNote`.** CRUD in
`coachContextService.ts`'s exact shape (snake_case DB row types kept separate
from the camelCase interface, explicit `.eq('user_id', userId)` on every
query, plain `if (error) throw error`), and TanStack hooks in
`useCoachContext.ts`'s exact shape (hoisted key constants, `enabled: !!user`,
invalidate on success). The offline branch of the create mutation writes
through `db.sync_queue` per §2.6.

**14. `CoachNotes.tsx`** — the Context-tab entry box plus the list, with
edit and delete on each entry (the same CRUD conventions phase and weight
entries already have), rendered directly by `CoachPage.tsx`'s `context`
branch alongside `<PhaseLog />` and `<WeightLog />`. No new gate check
(§2.9).

**15. `WorkoutNotesSheet.tsx` + its trigger in `GymSession.tsx`.** Bottom-sheet
overlay following `MissedSessionPrompt.tsx`'s exact pattern —
`fixed inset-0 z-50 flex items-end`, `rounded-t-2xl`, the grab-handle bar,
`maxHeight: '70dvh'`, backdrop-click to dismiss. Textarea in, timestamped
note out, this session's notes listed above it. The trigger button in the
session header renders **only when `isCoachUser(user?.id)`** — the one new
`coachGate.ts` call site in this whole initiative.

**16. Verify phase 3.** Typecheck / tests / build. Then live: a note from the
sidebar lands with the right `session_id`; a note from the Context tab lands
with `session_id` null; both appear in the Context list; a note written
**offline** syncs on reconnect with its body and session intact; delete works;
and the sidebar button is genuinely absent for a non-Coach account (checked by
signing in as one, not by reading the conditional).

### Phase 3 close-out

Commit, push, confirm the deploy via `vercel ls` / `vercel inspect` (the
double-check every prior phase used), and update CONTEXT.md. An adversarial
review pass before deploy is worth running and is most valuable pointed at
**the offline write paths** — §2.4's `sync_queue` payload lists and §2.6's
note queueing are where a silent, unlogged data loss would live, and they are
the only new surface in phases 1–3 that a typecheck cannot cover.

### Phases 4–5 — gate, not a task list

**Do not start phase 4 until phase 3 has shipped and 10–20 real notes exist**
(§0). At that point, write the second-pass task document covering: migration
018, `coachCurationPrompt.ts`, the latency measurement, the function, the
Memory UI, then phase 5's `PROMPT_VERSION 4` bump and payload wiring. §9 is
what that document must not contradict.

---

## 7. Assumptions and decisions the spec does not cover

Each is a real fork the spec leaves open. Recommendation stated; noted where
a choice is awkward to reverse.

### 7.1 Averaging an ordinal rating assumes an equal-interval scale

`averageRating` maps `rushed`→1 … `extra_controlled`→4 and takes the mean.
That treats the four steps as evenly spaced, which nothing about the labels
guarantees. SPEC §6 asks for averages in as many words ("average form rating
shown per exercise… average form, energy, and pump shown per week"), so
averages get built rather than argued out of existence.

**Mitigation, which is why this is a note and not a blocker:** every average
renders with its denominator (`2.8 / 4`), so it reads as a position on a
named scale rather than a measured quantity. A distribution view (how many
sets at each value) would be strictly more honest and is a small future
addition; it is not built in v1 because the spec did not ask for it.

### 7.2 Form averages exclude drop stages; the model still sees every stage

The stage-exclusion rule (CONTEXT.md, "Key architectural rules") is that a
drop stage is never counted as an independent set, with volume as the one
deliberate exception. `avgRir` and `avgReps` already follow it in both
`fetchExerciseProgress` and `fetchMesoWeeklyProgress`.

**Form follows the same rule for the same reason:** a stage is taken at or
past failure, so including stages would make average form a function of how
many dropsets were programmed rather than of how the working sets were
executed.

**But form is still logged on stages and still reaches the model.** Phase 5's
payload carries it through `positionMatch.ts`'s per-item `a`/`b` values,
which deliberately include stages (`eligibleE1rm`'s comment records that the
stage exclusion is about the whole-session average, not the slot-by-slot
comparison). So: code averages heads only; the model reads everything. That
is the same division this whole feature line rests on.

### 7.3 A rated `'none'` is not the same as an unrated `NULL`

Stated in §2.1, repeated here because it is the kind of thing a later reader
collapses. `energy_rating = 'none'` means the lifter reported no energy;
`NULL` means they did not rate it. They must never be merged — not in the
averages (a `'none'` counts as 1, a `NULL` is excluded from both numerator and
count), not in the display, and not in the payload.

### 7.4 Energy and pump land on `HistoryDetail`, not `HistoryRow`

`HistoryRow` is produced by two different queries: `fetchHistoryDetail` reads
`v2_sessions` directly, but `fetchHistorySessions` reads the
`v2_history_session_summary` **view** (migration 009). Putting the new fields
on `HistoryRow` would make them permanently `null` on the list path unless the
view is recreated — a fourth migration touching an object three other
surfaces read.

SPEC §6 asks only for "energy and pump per workout" in History, which the
session *detail* view satisfies completely. **Decision: the fields go on
`HistoryDetail`.** If they are later wanted as list-level badges, that is a
`create or replace view` migration at that point, with nothing else to undo.

### 7.5 Session duration is display-only, and it will surface a known data anomaly

SPEC §4: `completed_at` minus `started_at`, both already stored, "a
display-only gap, not a new logging requirement." Correct — nothing new is
computed or stored.

Worth flagging so it is not mistaken for a new bug: `SessionTypeHistoryView.tsx`
is currently the only surface displaying per-session duration, and Phase 3.4's
live verification found two real sessions with implausible multi-hour
durations in the underlying data. The 2026-08-11 `completed_at` fix and its
backfill addressed the cause going forward, but `SessionDetail.tsx` becomes a
second surface where any residual case is visible. It applies the same
`> 0` guard and renders `—` for a session with no derivable duration (the
`skipMissedSession` case, where both timestamps are null) rather than
inventing a value.

### 7.6 A curation-run record is proposed, and the spec does not ask for one

`v2_coach_curation_runs` (§3.3) is the one table here the spec does not name.
The argument for it:

Both existing AI surfaces persist `model`, `prompt_version`, token counts and
`input_snapshot`, on the reasoning (daily §5.11) that "what did this cost,
which model and prompt produced it, and what did the model actually see"
should be answerable from the data rather than from guesswork. Curation is the
first surface where the *output is not itself a record* — it mutates a store.
That makes the provenance case stronger, not weaker: without a run row, a
memory entry that changed has nothing anywhere explaining why, and there is no
way to distinguish a curation edit from a hand edit beyond the `source`
column's coarse signal.

It is also cheap: one insert per run, at maybe one run per week.

**Flagged as a proposal rather than a decision** (§10) because it is the only
place this plan adds a table the spec did not describe, and it is trivially
cuttable — the `source` column on the entry table carries the minimum
traceability on its own.

### 7.7 Curation's failure modes are accepted, not engineered away

Three, in decreasing likelihood:

- **A double-tap racing itself.** Mitigated by the client's in-flight disable
  plus §5.3's 60-second run guard. Not a lock: two requests arriving inside
  the same second could both pass. Accepted at well under a cent per
  occurrence, one deliberate click per week, and a visible, editable,
  deletable result — the same accepted-risk class as daily §5.12.
- **A crash between applying decisions and stamping `curated_at`** — which,
  after §5.3's 2026-08-25 ordering correction, now also spans the run-row
  insert (memory changes → run row → stamp, not memory changes → stamp →
  run row as originally written here). A re-run re-reads the same notes and
  may add a duplicate entry. Visible and correctable by hand, which SPEC §7
  makes a first-class property rather than a consolation. Deliberately
  ordered this way — the reverse order would silently consume notes that
  produced nothing, which is the worse failure. (The original order shipped
  here had a second, worse gap inside this same window — a crash between the
  stamp and the run-row insert left notes permanently un-retryable with no
  audit row ever explaining why. See §5.3's ordering note for the full
  correction.)
- **A hard `maxDuration` kill.** Genuinely unrecoverable, exactly as in both
  prior features, and the reason the latency measurement (§5.4) is the first
  action of phase 4's server work rather than a later sanity check.

The rejected alternative for all three is a pending-row state machine, which
daily §5.12 already weighed and rejected as real permanent complexity against
a rare, cheap, self-evident failure.

### 7.8 The analyzed session's own notes reach the daily prompt too, not Memory alone

**Reversed by Adam before phase 1 build (2026-08-25).** SPEC §3 phase 5 and
SPEC §10 both name form/energy/pump and **Memory** as what reaches the
prompt, and this document originally followed that literally — Memory only,
raw notes excluded, on the reasoning that a note that has been through
curation is already represented and a note that has not is by definition
unvetted.

That reasoning holds for notes in general, but not for the specific note that
matters most: **the notes written during the session actually being
analyzed.** Curation runs roughly weekly, manually (§5.1); daily analysis is
typically triggered same-day. A note written mid-workout almost never reaches
Memory before that same session gets analyzed — which defeats the exact
scenario SPEC §4 opened with (the calf-skip example: a note explaining *why*
an exercise was skipped is worthless to the analysis reasoning about that
skip if it arrives after the analysis already ran).

**Decision: the daily payload includes both.** The analyzed session's own
notes, `session_id`-filtered, fetched directly and unconditionally — not
gated on curation status, since curation's cadence structurally cannot reach
same-day. Memory still matters for standing, cross-session context and is
unaffected — this doesn't replace it, it covers what curation's cadence
can't reach in time. No schema change: migration 017's `session_id` index
(`v2_coach_notes_session_idx`) already serves this query. See §4.5 for the
payload shape.

### 7.9 Memory text gets frozen into every analysis's `input_snapshot`

Once phase 5 lands, every `v2_coach_session_analyses` row's `input_snapshot`
contains the full memory list as it stood at generation time. That is correct
— the snapshot's whole purpose is "what the model was shown" — and it is the
same prospective-only asymmetry the exercise tags already have (CONTEXT.md,
2026-08-20): editing or deleting a memory entry does not retroactively change
any analysis already written, and no mechanism exists that would make it.

Two consequences worth recording before someone is surprised by one:

- An analysis can legitimately reason from a memory entry that no longer
  exists. Not a bug.
- A memory entry deleted *because* it was wrong or sensitive still exists
  inside stored snapshots. In a single-user personal app this is a note, not a
  risk; it would need a real answer before this pattern went anywhere
  multi-user.

### 7.10 Weekly Analysis is untouched

SPEC §8 defers wiring form/energy/pump and Memory into Weekly Analysis
explicitly. `coachWeekPrompt.ts`, `weekAnalysisInput.ts` and
`api/coach/analyze-week.ts` get **no changes in this initiative** — with one
caveat worth knowing rather than discovering: `weekAnalysisInput.ts` builds
every occurrence through `buildExercise`, the same function the daily path
uses, so once phase 5 adds `formRating` to `PositionMatchSetValue`, form data
will start appearing in weekly payloads *by construction*. That is harmless
(the weekly prompt says nothing about it, so the model has no instruction to
use it) and it is not the same thing as wiring it in. Flagged so the field's
appearance in a weekly `input_snapshot` is not later read as scope creep.

### 7.11 The rating vocabularies are awkward to change once data exists

Like daily §5.2 (a weekly entry's date) and weekly §7.5 (`week_start` is a
Monday), this is the decision here that is genuinely awkward to reverse: the
stored strings are what every historical row means. Adding a value later is a
`CHECK` change plus a scale change plus a re-derived ordinal mapping for every
existing row's position on the scale. Renaming one is a data migration.

The vocabularies come straight from SPEC §4 with no invention, so the risk is
low — but confirming the four/five/four split and the exact words before ~50
sets are logged against them is cheap, and it is why §10 lists it.

---

## 8. New files, at a glance

```
supabase/migrations/
  016_v3_coach_personalization_ratings.sql   P1  form/energy/pump columns
  017_v3_coach_notes.sql                     P3  v2_coach_notes + RLS + 3 indexes
  018_v3_coach_memory.sql                    P4  memory entries + curation runs

src/features/gym/
  ratingScales.ts   + .test.ts               P1  pure: vocabularies, labels, averages
  RatingChips.tsx                            P1  the segmented chip row (§1.1)
  WorkoutNotesSheet.tsx                      P3  the in-workout sidebar (gated)

src/features/coach/
  coachNotesService.ts                       P3  CRUD, coachContextService.ts's shape
  useCoachNotes.ts                           P3  TanStack hooks, useCoachContext's shape
  CoachNotes.tsx                             P3  Context-tab box + list
  coachCurationPrompt.ts                     P4  CURATION_PROMPT_VERSION + prompt
  coachMemoryService.ts                      P4
  useCoachMemory.ts                          P4
  CoachMemory.tsx                            P4  the memory list, edit/delete/restore

api/
  coach/curate-memory.ts                     P4

modified:
  src/types/index.ts                         P1/P3/P4  ratings, notes, memory types
  src/lib/db.ts                              P1  CachedSetLog/CachedSession fields, NO version bump
  src/features/gym/SetRow.tsx                P1  form chips in the MORE drawer + edit block
  src/features/gym/GymSession.tsx            P1/P3  onLog param; gated sidebar trigger
  src/features/gym/SessionComplete.tsx       P1  energy/pump chips
  src/features/gym/useSession.ts             P1  useLogSet + useCompleteSession, both branches
  src/features/gym/sessionService.ts         P1  logSet, updateSetLog, completeSession, mappers
  src/features/offline/offlineCache.ts       P1  Dexie write field list
  src/features/progress/progressService.ts   P2  two selects + two point shapes
  src/features/progress/ExerciseProgress.tsx P2  avg form
  src/features/progress/MesoProgress.tsx     P2  per-week form/energy/pump
  src/features/history/historyService.ts     P2  fetchHistoryDetail select + two row shapes
  src/features/history/SessionDetail.tsx     P2  per-set form, energy/pump, duration
  src/features/coach/CoachPage.tsx           P3/P4  CoachNotes + CoachMemory in the context branch
  src/features/coach/analysisInput.ts        P5  two selects, memory fetch, payload fields
  src/features/coach/coachPrompt.ts          P5  PROMPT_VERSION 4
  src/features/progress/positionMatch.ts     P5  PositionMatchSetValue.formRating (one line in toSetValue)

unchanged, deliberately:
  vercel.json              api/** already covers a third function at maxDuration 60
  tsconfig.api.json        already include: ["api"]
  package.json             both SDKs already present; typecheck already covers both projects
  src/features/offline/useSyncQueue.ts   replay is table-generic (§2.4, §2.6)
  src/features/gym/useAutoFinishSession.ts  auto-finish rates nothing, by design (§2.4)
  supabase view v2_history_session_summary  §7.4
  coachWeekPrompt.ts / weekAnalysisInput.ts / api/coach/analyze-week.ts  §7.10
```

---

## 9. Phase 4–5 decisions settled now, because phases 1–3 depend on them

These are the forks that cannot wait for the second-pass document, because
getting them wrong means a migration plus a nullable code path plus a
permanent population gap — the asymmetric-cost argument that has now decided
the same class of question twice in this feature line.

### 9.1 `curated_at` ships in migration 017, not 018

Three ways to answer "which notes has curation not seen":

| Option | Verdict |
|---|---|
| **`curated_at timestamptz null` on the note** | **Chosen.** One nullable column, one partial index, one predicate. Honest about a note having been processed even when curation decided to produce nothing from it. |
| Re-read every note on every run | Rejected. Fine at ten notes, quietly wrong at two hundred: every run re-pays input tokens for the whole history and re-asks the model to re-decide things it already decided, with no memory of having done so. |
| A watermark on the run table ("notes newer than the last run") | Rejected. Fragile against a note created *during* a run, and it makes a per-note fact into a global one. |

Landing it in 017 rather than 018 costs one line now. Landing it in 018 costs
a migration, a nullable code path, and every note written during phase 3
being permanently ambiguous about whether it was ever curated.

### 9.2 Memory is a separate table from notes, and notes are never rewritten

SPEC §4 is explicit that these are different things ("This is not the same
thing as Coach Memory — it's the unfiltered input Memory is built from"). The
tempting shortcut — one table with a `kind` column — would make "the raw
notes" and "the curated memory" the same rows, and curation would then be
editing the raw input it was supposed to preserve. Two tables; curation reads
one and writes the other; a note's `body` is never modified by curation, only
its `curated_at`.

### 9.3 No link table between memory entries and the notes that produced them

Tempting for provenance, but it is genuinely many-to-many (an entry can be
updated by several notes over time) and it would be the first join table in
this schema. `v2_coach_curation_runs.input_snapshot` and `.decisions` already
record which notes were read and what was decided from them for every run —
the same information, at run granularity, with no schema to maintain.

### 9.4 The user's own delete is a hard delete; curation's expire is soft

Two different actions with two different meanings. Recorded here because a
single `status` column tempts a later reader to route both through it: an
entry the user deleted is gone and should not reappear in a collapsed
"expired" list they have to keep dismissing.

### 9.5 The daily payload gets memory *bodies* only, not ids

Decided now because it shapes the `memory` field's type (§4.5). The daily
prompt's job is to reason with standing context; it never edits memory. Ids
would only invite the model to cite a key the output schema has no slot for.
Curation is the one call that gets ids, because it is the one that returns
decisions about specific entries.

---

## 10. Open questions for review

Five, in rough order of how expensive they are to change later.

1. ~~**The rating vocabularies (§2.1, §7.11).**~~ **Resolved — confirmed by
   Adam before phase 1 build (2026-08-25).** Four form values, five energy,
   four pump, with the exact words above, including `'some'` as the pump
   scale's second value. No change to migration 016.

2. **Chip row instead of a slider (§1.1).** A direct divergence from SPEC §6's
   own word. The reasoning is that this app has no slider anywhere and RIR —
   the "pattern already established there" — is a numeric input in a drawer.
   If you want a real slider, say so; it is a one-file change now and a
   two-surface change later.

3. **Is `v2_coach_curation_runs` wanted (§3.3, §7.6)?** The only table here
   the spec does not name. It is the only thing that can answer "why did my
   memory change", and it is one insert per run — but it is additive
   machinery, and `source` on the entry carries the minimum traceability
   without it.

4. **Manual curation trigger (§5.1).** "Manual before automatic" says a
   button; the alternative worth naming is firing curation automatically
   after a session that produced notes, so memory is fresh by the time that
   session is analyzed. Confirming the manual reading before the UI is built
   is free.

5. **The scope split itself (§0).** Phases 1–3 in full now, phases 4–5 as
   decisions now and tasks later. If you would rather have all five specified
   up front, §6 gets extended — but the curation prompt written today would be
   designed against one example note, and this feature line has a documented
   history of that going wrong.

**Resolved, not open — §7.8's raw-notes-to-daily-prompt question**, reversed
and decided by Adam before phase 1 build (2026-08-25): see §7.8 and §4.5. No
longer listed above as an open question.

Nothing above has been built. Nothing is cleared to start until this document
is reviewed.
