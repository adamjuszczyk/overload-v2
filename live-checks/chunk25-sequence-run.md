# Chunk 25 live verification — sequence runs (for Adam; not executed by the builder)

Per the brief ("Live (later, by Adam, already approved: DECISIONS 50): a
throwaway `TEST-…` sequence run, with cleanup proven by counts") and
TASKS.md's own chunk-25 verification line ("live on a sequence test run...
Today shows the right next workout on a rest day, Train anyway starts it,
the next due date counts from that session; Adam-scoped: weekday week plans
unchanged in count"). Nothing in this file has been run.

**This whole walkthrough runs on Adam's SECOND account, never his main
one** (his own answer, DECISIONS 73 option a) — every count query below is
scoped to that second account's own `user_id`, never the main account's.

## Find the second account's own user_id first

The API this file's own count queries run against doesn't expose
`auth.users` (so there is no `select id, email from auth.users` step here) —
copy the second account's id from the Supabase dashboard instead:
**Authentication → Users**, find that account's row by its email, copy its
`UID` column. Use that value everywhere this file says
`<SECOND_ACCOUNT_USER_ID>` below. (Never its password — nothing in this
file ever asks for one, and the dashboard copy needs none either.)

## Prerequisites

1. `build/chunk-25-migration` (037) must already be merged and deployed —
   sequence runs depend on it at runtime (the new `sequence_position` column
   of the unique key, and `v2_plan_week`'s sequence-source branch). Weekday
   runs do not need it, but this whole walkthrough does.
2. `build/chunk-25` (the code, including the review fix that wires Plan's
   own Weeks view up for a sequence run) must be deployed.
3. Signed in as the **second account** throughout (Planner/Plan/Today
   steps below) — not the main one.

## BEFORE — run this first, record the row

```sql
select
  (select count(*) from v2_programs              where user_id = '<SECOND_ACCOUNT_USER_ID>') as programs,
  (select count(*) from v2_mesocycles             where user_id = '<SECOND_ACCOUNT_USER_ID>') as mesocycles,
  (select count(*) from v2_workout_days           where user_id = '<SECOND_ACCOUNT_USER_ID>') as workout_days,
  (select count(*) from v2_program_exercises      where user_id = '<SECOND_ACCOUNT_USER_ID>') as program_exercises,
  (select count(*) from v2_program_sequence_items where user_id = '<SECOND_ACCOUNT_USER_ID>') as sequence_items,
  (select count(*) from v2_week_plans             where user_id = '<SECOND_ACCOUNT_USER_ID>') as week_plans_total,
  (select count(*) from v2_week_plans             where user_id = '<SECOND_ACCOUNT_USER_ID>' and sequence_position is null)     as week_plans_weekday,
  (select count(*) from v2_week_plans             where user_id = '<SECOND_ACCOUNT_USER_ID>' and sequence_position is not null) as week_plans_sequence,
  (select count(*) from v2_sessions               where user_id = '<SECOND_ACCOUNT_USER_ID>') as sessions;
```

Call this row **BEFORE**. On a genuinely fresh second account every column
here is likely `0` — that's fine, it's still the baseline every later run
of this query compares against. `week_plans_weekday` is the one number
that must come back identical in every later run — that is the actual
"weekday week plans unchanged in count" gate TASKS.md names (meaningful
even at `0`: it proves this walkthrough never writes a weekday-shaped row
at all). The others are informational deltas (exact expected values below
assume you follow the steps as written and touch no other cycle in the
meantime).

## Walkthrough (planner + Plan + Today; one calendar day is enough)

1. **Planner:** create a new saved program named `TEST-seq-<today's date>`
   with two workout days, e.g. `TEST-SEQ A` and `TEST-SEQ B` (give each at
   least one exercise, so there's something to log). Set its schedule type to
   **SEQUENCE** and build the sequence editor to exactly four slots, in this
   order: `A, B, A, rest` — SPEC's own example (G8) and the one this chunk's
   unit tests use, so this walkthrough matches what's already proven on
   paper.
2. **Start a run** from that program (name it `TEST-seq-run` or similar).
   Immediately note the ids you'll need for cleanup — the run copy
   `v2_start_run` makes gets the SAME name as the saved program (migration
   028: "the copy keeps the saved program's own name"), so both rows come
   back together:
   ```sql
   select id, kind, name, created_at from v2_programs
    where user_id = '<SECOND_ACCOUNT_USER_ID>' and name like 'TEST-seq-%'
    order by created_at;
   -- two rows: kind='saved' (the one you built) and kind='run' (today's
   -- v2_copy_program copy — this is the one the new mesocycle points at).
   select id, name, program_id from v2_mesocycles
    where user_id = '<SECOND_ACCOUNT_USER_ID>' and name = 'TEST-seq-run';
   ```
   (If the second account already has its own active run, starting this
   one completes it the same way `v2_start_run` always does — "one active
   run at a time" — worth knowing even on a throwaway account.)
3. **Plan tab (review fix — Plan now works for a sequence run):** open Plan,
   Weeks tab. The stepper reads `CYCLE 1`. The slot switcher shows 3 chips
   named `TEST-SEQ A`/`TEST-SEQ B`/`TEST-SEQ A` (slots 1, 2, 3 — the second
   `TEST-SEQ A` is the repeat) plus one dimmed, un-tappable `REST DAY` chip
   (slot 4). Tap the THIRD chip (the second `TEST-SEQ A`, slot 3) and set a
   weight or rep target on its one exercise. Leave Plan and open **Today**:
   confirm that same target shows up on THAT workout once you reach it
   (step 6 below) — proof the Plan edit landed on slot 3's own row, not
   slot 1's (the two `TEST-SEQ A` occurrences are independent rows,
   R16/`sequence_position`).
4. **Today** (first load): confirms `CYCLE 1` / `TEST-SEQ A` / `READY NOW`
   (nothing trained yet — reviewer's note 2's "no anchor yet" reading) —
   this is slot 1's own occurrence, so it does NOT carry the target you set
   on slot 3 in the previous step. Tap **START SESSION**, log at least one
   set, **FINISH SESSION**.
5. **Today:** now reads `CYCLE 1` / `TEST-SEQ B` / `DUE TOMORROW`, with a
   **TRAIN ANYWAY** button (not due yet — same-day completion always pushes
   the due date to at least the next calendar day). Tap **TRAIN ANYWAY**,
   log a set, finish.
6. **Today:** now reads `CYCLE 1` / `TEST-SEQ A` / `DUE TOMORROW`, TRAIN
   ANYWAY — this is the **repeated** A, the third slot (position 2), the
   SAME slot you set a target on on Plan in step 3. Confirm that target
   shows here. Seeing `TEST-SEQ A` again here (not B, not a dead end) is
   also the "A, B, A, rest resolves to the right slot after each A" proof,
   live. Tap **TRAIN ANYWAY**, log a set, finish.
7. **Today:** now reads `CYCLE 2` / `TEST-SEQ A` / `DUE IN 2 DAYS`, TRAIN
   ANYWAY. This is the cycle rollover (past the one `rest` slot, position 3,
   back to position 0) and "the next due date counts from that [Train
   Anyway] session" (2 days = the one rest slot + 1, counted from the
   session you just finished in step 6, not from any original schedule).
   This time, tap **SKIP** instead of Train Anyway.
8. **Today:** now reads `CYCLE 2` / `TEST-SEQ B` / `DUE TODAY`, with
   **START SESSION** (not Train Anyway — `isDue` is true now). This is
   Skip's own "the next one is due the same day" rule, live. You can stop
   here — the screen state itself is the proof; there's no need to actually
   start this last one.

Expected session count by this point: 3 completed (steps 4-6) + 1 skipped
(step 7) = 4. Expected sequence-shaped week-plan rows: 3 for cycle 1 (slots
0, 1, 2 — all three of its workout-bearing slots, planned together the
first time cycle 1 was opened, including by the Plan-tab visit in step 3)
+ 2 for cycle 2 (slots 0, 1 — planned together the first time cycle 2 was
opened, at step 7, regardless of Train-Anyway-vs-Skip) = 5.

## AFTER — run the same query as BEFORE, record the row

Expect, relative to BEFORE (assuming no other cycle was opened along the way):
`programs +2` (the saved program and its run copy), `mesocycles +1`,
`workout_days +4` (2 original + 2 in the run copy), `sequence_items +8` (4
original + 4 copied), `week_plans_total +5`, `week_plans_sequence +5`,
`sessions +4`. `program_exercises` moves by however many exercises you
actually added, doubled (original + run copy) — not asserted here.

**The one hard gate:** `week_plans_weekday` must be **identical to BEFORE**.
Nothing in this walkthrough should ever touch a weekday-shaped row.

## Cleanup (in this order — the FK graph requires it)

`v2_mesocycles.program_id` has no `on delete cascade` (plain
`references v2_programs(id)`, i.e. `restrict`), and `v2_sessions`' own
`mesocycle_id`/`week_plan_id`/`workout_day_id` are `on delete set null`
(never cascade) — so sessions must be deleted explicitly, before the
mesocycle, or they'd outlive it as orphaned rows with those columns nulled
out instead of being removed:

```sql
-- 1. Sessions first (while mesocycle_id still names them) — cascades to v2_set_logs.
delete from v2_sessions where mesocycle_id = '<the TEST-seq-run mesocycle id, from step 2>';

-- 2. The mesocycle — cascades to v2_week_plans -> v2_week_plan_sets.
delete from v2_mesocycles where id = '<the TEST-seq-run mesocycle id>';

-- 3. Both program rows (the run copy, then the saved original) — each
--    cascades to its OWN v2_workout_days -> v2_program_exercises, and to
--    its OWN v2_program_sequence_items.
delete from v2_programs where id = '<the kind=''run'' program id, from step 2>';
delete from v2_programs where id = '<the kind=''saved'' program id, from step 2>';
```

## AFTER CLEANUP — run the same query a third time

Every column should now read exactly what **BEFORE** read — full round
trip, nothing left behind on the second account.
