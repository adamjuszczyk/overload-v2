# TASKS-1.2.md — Overload Planner Extension, SPEC change 1.2

**Spec:** SPEC.md as delivered on 2026-10-12 (the `overload-1.2-spec.zip` drop): every rule tagged **[1.2]**, the "Superseded by 1.2" list, the "Defaults this spec chose" list (confirmed), and "Design boards [1.2]" with `design/1.2/INDEX.md` (83 boards). This file plans those rules only; everything else stays as phase 1 and revision 1.1 built it (TASKS.md, TASKS-1.1.md).
**Status:** planning only (2026-10-12). No application code was written in the session that produced this file. Nothing below is built.
**Numbering** continues from TASKS-1.1.md: chunks 36–69, migrations 042–044 (045 reserved for spec gap G46 if its answer needs a column), spec gaps from G46.
**Baseline:** master `6e5f654` (#85 merged); migrations 000–041 live; next migration number 042. `npx vitest run` and `npm run build` on that commit: see "Baseline measurements" at the end of this file.
**How to read it:** the chunks are in build order and each is one builder's whole job, reviewed at its boundary. A chunk that builds a screen names its board IDs; the boards decide layout, order, wording and what sits behind ⋯ (SPEC "Design boards [1.2]"); SPEC decides behaviour and wins a disagreement. Two kinds of open question are kept apart on purpose:
- **Spec gaps (G46–G51):** SPEC is silent or ambiguous on something a chunk needs that changes data or behaviour, or a board and SPEC disagree in a way SPEC doesn't already list. Each stops the chunk it names at the point it names. Nothing is chosen here; a recommendation is given so Adam can answer in one word.
- **Provisional display decisions:** display-only edge cases (a label, an empty state, where a control sits) are taken under Adam's standing rule D31 (2026-10-10: "take the simplest option consistent with SPEC, record it as provisional, and continue"). They are listed so Adam can overrule any of them; none stops a chunk. If the 1.2 brief's "do not choose for me" is meant to cover these too, say so and each becomes a gap.

---

## Spec gaps

Each gap stops the chunk it names at the point it names. The rest of that chunk is written as far as it can be.

### G46 — How "unlogged, numbers kept" is stored (chunk 63)
- **SPEC:** Objects stored → Set log: "[1.2] unlogged again (18c): a logged set can return to unlogged, keeping its numbers." Logging mechanics: "the set goes back to unlogged with its numbers kept. No confirm; logging again undoes it. … Unlogging never restarts the rest timer and never changes the session's status." Facts: "How 'unlogged' and 'logged' are represented on a set log, and what depends on a set being logged … so unlog doesn't leave anything pointing at a log that no longer counts."
- **Today (F4 below):** "logged" is the existence of a `v2_set_logs` row for the planned set; there is no unlogged state. Eleven consumers decide things from that row's existence (session status and auto-finish, History views, "last time", Progress, the deload base, exercise "lost" status, Coach).
- **Two readings, and they change data:**
  - (a) **Delete the log; keep the numbers on the device.** Unlog deletes the `v2_set_logs` row (stages first, as today's cascade does) and keeps weight/reps/RIR/form in a per-session draft on the phone (Dexie, like the warmup ticks), shown in the row's inputs until it is logged again (a new row) or the session ends. Nothing server-side changes shape; no consumer changes, Coach included. The numbers survive a reload on that phone only.
  - (b) **A stored unlogged state.** A new nullable column `v2_set_logs.unlogged_at` (or a boolean). The row stays with its numbers; every consumer listed under F4 must exclude it: the three History views (a migration replacing them), `deriveCompletedAt` / `shouldClassifyAsSkipped` / auto-finish, `fetchReferenceSessionsByExercise`, Progress (`e1rm`, `positionMatch`, the meso dashboard), `fetchDeloadSetLogs` / `hasAnySetLogForWeekPlan`, `exerciseService`'s "lost" rule, the finish-screen counts — and the frozen Coach code (`src/features/coach/*`, `api/coach/*`, Escalation 16), which would count an unlogged set as done unless it is changed.
- **Recommendation:** (a). It is the only reading under which "Coach stays exactly as it is" and "never changes the session's status" hold without touching the frozen code, and it adds no column. Its cost is that the kept numbers live on the phone, not the server.
- **Stops:** chunk 63 after its row states; the write path and its tests are written once answered. Migration 045 is reserved in case (b).

### G47 — Delete set, unlog and set type changes while offline (chunks 57, 61, 62, 63)
- **SPEC:** silent. Logging is offline-capable today (the sync queue); editing and deleting a logged set are online-only (F4). Board W6 shows the workout screen used offline; the Errors rule says "You may be offline" is shown only when that is the reason.
- **Options:** (a) delete and unlog queue through the sync queue like logging (chunk 57 makes the queue execute its declared-but-unimplemented `delete` items); a set type change on a logged set and the edit panel's SAVE stay online-only, as editing is today. (b) Everything new is online-only; offline it fails with the real reason. (c) Everything queues, including updates (a new queue item kind for patches, with same-record ordering).
- **Recommendation:** (a): a gym has bad signal, and delete/unlog are the two actions that remove a row the device already holds; patches can wait as they do today.
- **Stops:** chunk 57 (whether it is built at all), and the offline paths of 61 and 63.

### G48 — The legend on a stable week (chunk 54)
- **SPEC:** Weeks and copying → Changes since the source: "anything in a week that differs from its source is highlighted, with the legend 'CHANGED SINCE WEEK N' (boards 1, 1d, 9). … Stable: set counts, kinds, stages and rep targets compared with the default; weight and RIR compared with last week's plan."
- **Board 1a (stable):** its legend reads "THIS WEEK ONLY", not "CHANGED SINCE WEEK N", and the same highlight colour marks both a weight that differs from last week (52.5 kg, RIR 1) and the structural change that earns the exercise its "THIS WEEK ONLY" line. SPEC's known-gaps list doesn't mention it.
- **Options:** (a) SPEC's legend on stable weeks too, "THIS WEEK ONLY" stays only the per-exercise line; (b) the board's legend, meaning the highlight on a stable week marks structure only and weights/RIR aren't compared.
- **Recommendation:** (a), as SPEC says; the board's legend reads as sample text.
- **Stops:** chunk 54's legend only; the per-exercise line and the link are unaffected.

### G49 — RIR on a warmup row in Plan (chunk 54)
- **SPEC:** Warmup sets: "Logged values: weight and reps, both optional; plus a rest timer. Nothing else." 1.1's Plan rows carry no RIR on warmups. Boards 1 and 1c draw a warmup row as "W · 20 kg × 12 · RIR 5".
- **Options:** (a) no RIR cell on a warmup row (as 1.1); (b) the board's RIR cell, which would be a target the workout never logs.
- **Recommendation:** (a); treat the board's cell as sample data.
- **Stops:** nothing else in chunk 54; the row renders without the cell until answered.

### G50 — The pre-1.1 finished program's PRIORITIES row (chunk 66)
- **SPEC:** Programs and runs: "A run finished before 1.1, whose marks exist only in the old priorities table, shows and edits that table, as today's completed-run page does. `TASKS` verifies which runs have which." Language: "'Program' everywhere … a text change on every screen".
- **Today:** that page is `src/features/coach/MesoPrioritiesPage.tsx` (route `/meso/:mesocycleId/priorities`), inside the frozen Coach directory (`check-frozen-code.mjs`, Escalation 16). It says "MESO" and can't be restyled or reworded without unfreezing it.
- **Options:** (a) PR14's PRIORITIES row opens that page as it is for pre-1.1 runs; its wording is the one exception to the sweep, noted in CONTEXT.md; (b) that one file leaves the frozen set (an exception in `check-frozen-code.mjs`) so chunk 69 can reword it.
- **Recommendation:** (a): "Coach stays exactly as it is", and the page is Coach's reader of the old table.
- **Which runs have which:** needs a signed-in read (F5's note): `select m.id, m.name, m.status, (select count(*) from v2_program_priorities p where p.program_id = m.program_id) as new_marks, (select count(*) from v2_coach_meso_tag_priorities t where t.mesocycle_id = m.id) as old_marks from v2_mesocycles m where m.user_id = auth.uid() order by m.start_date;` on both accounts. The app's rule doesn't depend on the answer (new marks present → the new editor; none → the old page), the answer says which runs will take which path.
- **Stops:** chunk 66's PRIORITIES row for pre-1.1 runs.

### G51 — Where "Drops and stages count as" applies (chunk 55)
- **SPEC:** Volume per muscle: "Drops and stages count per the Settings rule (14b)". Volume [P1/P2]: "Staged-set stages: count in volume only, [1.2] per the Settings rule (14b)." Settings: "Adds two rows: 'Drops and stages count as' …".
- **Ambiguity:** the VOLUME sheet counts sets per muscle, and the rule plainly applies there. The History views (`set_count`, `total_volume`), Progress's meso overview and the finish screen's WORKING SETS tile also count sets or volume today (stages: in `total_volume`, out of `set_count`). Whether the setting reaches them is unsaid; reaching the views means replacing three views in a migration and changing Progress.
- **Recommendation:** the VOLUME sheet only in 1.2; everything else keeps today's counting.
- **Stops:** nothing in chunk 55 (it builds the sheet either way); it stops any change to the views or Progress until answered.

---

## Provisional display decisions (D31)

Built as written unless Adam changes them; each becomes a DECISIONS.md "Waiting on Adam" entry when its chunk starts.

| # | Question | Provisional choice | Chunk |
|---|---|---|---|
| P1.2-1 | COPY, VOLUME and REVIEW on week 1 (nothing before it, never across programs) | COPY and VOLUME buttons don't render on week 1; REVIEW never does there (SPEC) | 52, 55, 56 |
| P1.2-2 | VOLUME when last week has no sessions at all (planned forward from an empty week) | last week's column shows "—" for every muscle | 55 |
| P1.2-3 | The REVIEW line when exactly one thing differs | "1 thing went differently" | 56 |
| P1.2-4 | A finished program's "N weeks" (PR1 list, PR14 header) | calendar weeks from start to end date, Monday-anchored, as `computeWeekNumber` counts; deloads counted from `v2_week_plans.is_deload` | 65, 66 |
| P1.2-5 | The error line under an error headline when the server message is empty | "Something went wrong." (never the old "Check your connection" unless offline) | every screen chunk |
| P1.2-6 | The week tile strip's scroll position | opens scrolled so the current week tile is visible | 52 |
| P1.2-7 | "Shared with Thu" when a workout is on three or more days | "Shared with Thu, Sat — changes apply to all" | 54 |
| P1.2-8 | The planner's PP3 stage row rep box | opens the rep target picker for the stage, same as a head's | 67 |
| P1.2-9 | The DAYS card's "whose day" text when two other workouts use the same day (G14 program) | "Thu is Push 2's day" names the first by position | 51 |
| P1.2-10 | PLAN FORWARD on a stable run with every default session empty | the button is disabled with "Nothing to plan from" | 52 |

---

## Process notes

- **Scratch copy.** `supabase/postgres:17.6.1.155` could not be pulled in this container (Docker Hub 429, ECR "Data limit exceeded", ghcr denied by the proxy — the same wall DECISIONS 115 hit). Every scratch check below ran on a local PostgreSQL 16.15 (apt) with a bootstrap that mirrors what the image provides: roles `anon` / `authenticated` / `service_role`, a non-superuser migrator, schema `auth` (`users`, `uid()` from `request.jwt.claim.sub` / `request.jwt.claims`), `supabase_migrations.schema_migrations`, and Supabase's default privileges. All 42 files 000–041 applied with `ON_ERROR_STOP` and `--single-transaction`; `public` has 39 tables, 5 functions (`v2_copy_program`, `v2_start_run`, `v2_plan_week`, `v2_make_week_default`, `reassign_exercise_history`), 3 views, no triggers. **Not proven here:** anything Postgres 17 or pg-safeupdate decides (Checks that lied #34) and PostgREST embed resolution (`check-embeds-local.sh` needs the PostgREST image too). Each chunk's `migration-replay` and `check-embeds-local.sh` runs in CI stay the proof for those.
- **D30 is superseded for the workout screen** (DECISIONS D30: the plain-session jsdom snapshot must not change). SPEC 1.2 rebuilds the workout screen to boards W1–W19 "in full, including parts no decision changed", so the snapshot cannot hold. Its replacement, in chunk 58: behaviour parity — a plain session (no supersets, warmups, tags, tempo, rest overrides; one legacy dropset) logs the same `v2_set_logs` row, times the same rests (`restChain` inputs unchanged) and finishes the same way — proven by tests that assert the written payload and the rest target, not the markup. The old fixture `gymsession-d30-render.html` and `GymSession.d30.test.tsx` are replaced in that chunk by the payload tests; the frozen-export rule for `referenceLogic.ts` / `setGroupLogic.ts` (`check-frozen-code.mjs`) still holds and is run at every boundary.
- **Removals happen inside the chunk that replaces each thing** (SPEC Removals); there is no cleanup chunk. What each chunk removes is in its Scope.
- **Migrations** follow CONTEXT.md's flow: additive ones that `check-migration.mjs` passes (or that D29 covers) are merged by the reviewer once `migration-replay`, `check-embeds-local.sh` and the scratch count/fingerprint check pass; a chunk with a migration and code merges the migration first and waits for the production deploy. The three migrations here (042, 043, 044) change no existing row. pg-safeupdate (CONTEXT: "Production runs pg-safeupdate") means every UPDATE/DELETE in 043 carries a WHERE.
- **Boards and screenshots.** Every screen chunk's verification includes a 390 px screenshot of the built screen in the light theme saved next to its board PNG (`design/1.2/built/<board-id>.png`, gitignored? — no: committed with the chunk, so the review record stays with the repo), compared by the reviewer for the same elements, order and wording — never pixel-matched (SPEC). Chunk 37 builds the tool. Fonts: Google Fonts is not reachable from this container, so the screenshot renders in the fallback sans/mono fonts; element order and wording are what is compared.
- **Live checks** are Adam's (this container can't reach the app; DECISIONS 31). Each chunk's "Done when" names what Adam sees.
- **Data the plan needs from the live database** (F5, G50): two read-only queries for Adam, both scoped by `auth.uid()`, to run on both accounts in the SQL editor; nothing here depends on their answer except what to expect when the fallback happens.

---

## Facts TASKS.md must verify — the [1.2] items, answered

Read on master `6e5f654`; line numbers are that commit's. Where a fact depends on a function's real behaviour it was run on the scratch copy (Process notes).

### F1 — When a week gets planned today, by whom, and what it copies
- **One RPC call site:** `src/features/plan/weekPlanService.ts:561-568` `planWeek` → `supabase.rpc('v2_plan_week', { p_mesocycle_id, p_week_number })`. Wrappers: `usePlanWeek` (`useWeekPlan.ts:72-81`, `networkMode: 'always'`, invalidates the week and all-weeks caches) and `planWeekThenFindId` (`useWeekPlan.ts:104-123`, `try … catch → fallback`, so a failed plan never blocks the write behind it).
- **Callers, and what they plan:**
  - **Plan, on open and on every week shown:** `PlanPage.tsx:343-349`, an effect with deps `[activeMeso?.id, viewWeek]` and no guard but `activeMeso`. `viewWeek` starts at 1 on a weekday run (`:239`) before the effect at `:263-265` moves it to the current week, so opening Plan plans week 1 on the way; the prev/next arrows (`:596-614`) plan every week browsed to. This is the caller 1.2 removes ("Opening it doesn't plan it").
  - **Week deload:** `useSetWeekDeload` (`useWeekPlan.ts:200-226`) awaits `planWeek` before `markWeekDeload` / `unmarkWeekDeload`, not best-effort (a failed plan fails the mark). The per-session toggle (`useSetDeload`, `:141-172`) doesn't plan.
  - **Today, weekday START:** `TodayPage.tsx:160-179` `handleStart` → `planWeekThenFindId(activeMeso.id, currentWeek, …)` then `createSession`; a moved-here `planned` row starts without planning (`:162-165`). `currentWeek` is the calendar week (`useScheduler.ts:38-40`).
  - **Today, sequence:** `SequenceTodayPage.tsx:116-124` (START / TRAIN ANYWAY) and `:134-142` (SKIP) plan `next.weekNumber`.
  - **Missed session, DO IT NOW:** `MissedSessionPrompt.tsx:35-41` plans the missed date's week (current week only, by the prompt's own rule).
  - Not callers: `v2_start_run` (028) creates no week plans; `useCreateSession` doesn't plan; apply-ahead only touches rows that exist.
- **Client paths that create `v2_week_plans` rows without the RPC:** `createWeekPlan` (`weekPlanService.ts:290-318`: the row plus the run copy's exercises, no sets), called lazily by `useAddSet` / `useAddWarmupSet` when the week has no row; and `copyOnePlanForward`'s insert (`:732-739`), which omits `sequence_position` (latent: on a sequence run a manual copy into a missing row makes a weekday-shaped row).
- **What `v2_plan_week` (041:231-542) copies**, verified by diff of 037→041 and by running it on the scratch copy (fixtures F1-a, F1-b below): it reads `week_start` (`:279-282`, default `copy`); loops the slots (weekday rows from the run copy's `schedule` jsonb, sequence rows from `v2_program_sequence_items`, `:310-321`); inserts the `v2_week_plans` row `on conflict (mesocycle_id, workout_day_id, week_number, sequence_position) do nothing` and `continue`s when it existed (`:325-332`) — idempotent per slot; finds the source as the latest earlier non-deload week of the same slot that has at least one set (`:348-355`); chooses `'program'` for week 1 or a stable run, `'empty'` when `week_start = 'empty'`, else `'week'` or `'empty'` (`:357-365`); `is_deload` is always false.
  - `'program'` source: exercises with `week_only = false and removed_at is null`; sets with `is_warmup, stage_kind, parent (remapped), stage_index, rep_min, rep_max, is_amrap, program_set_id` and null `target_weight` / `target_rir` (`:397-418`); then weights and RIR are mapped from the last usable week by (exercise row, `is_warmup`, ordinal) with stages following their head (`:434-477`, 039's pairing).
  - `'week'` source: exercises and every set column copied verbatim (`target_weight`, `target_rir`, rep targets, kinds, stages, `program_set_id`), parent links remapped, tags never (`:489-531`).
  - Rest is never copied: `v2_week_plan_sets` has no rest column.
- **Scratch run F1-a (week-dependent):** a throwaway user's program (Tuesday: Lat Pulldown with a warmup, a working set with rest 150 s, a dropset head with an AMRAP drop; Face Pull ×2) started through `v2_start_run`; `v2_plan_week(meso, 1)` → 1 row; week 1 given weights 55 / RIR 2 (drop 40 / 0), a tag, and set 2's reps changed to 9–11; `v2_plan_week(meso, 2)` → week 2 holds 55 kg / RIR 2 on every working set, 40 / 0 on the drop, 9–11 on set 2, the warmup as a warmup, no tags, every set linked to its program set. That is today's "weights and RIR always come from last week" plus reps, the behaviour 044 replaces.
- **Scratch run F1-b (stable, same fixture plus an extra set added in week 1):** week 2 holds the default's set count (the extra set is absent), the default's rep targets (8–10, not week 1's 9–11), and week 1's weights and RIR (55 / 2, 40 / 0). That is the stable rule 044 keeps for structure and rep targets and drops for weights and RIR.
- **The `week_start` setting:** column `v2_user_settings.week_start` (027:325-326, default `copy`); `UserSettings.weekStart` (`types/index.ts:675`); `SettingsPage.tsx:369-379` NEW WEEK STARTS; read by the SQL above and by `weekDiff.ts:211` (highlighting only); the TypeScript mirror `resolveWeekSources` (`weekSources.ts:89-122`) is used only by tests.
- **Client copy helpers** (COPY WEEK `PlanPage.tsx:631-642`, shown only on an empty week and never on stable `:452-455`; COPY THIS WORKOUT `:1412-1423`): `copyOnePlanForward` (`weekPlanService.ts:715-769`) → `copyExercisesForward` (`:798-811`) and `copySetsWithGrouping` (`:859-916`), which copies `target_weight`, `target_rir`, rep targets and `stage_kind` and **never sends `is_warmup`** (a copied warmup becomes a working set; untested). 1.2 replaces both actions (COPY writes numbers into sets that already exist), so the bug goes with them rather than being fixed in place.
- **So the new trigger:** chunk 52 removes the Plan effect and plans only the current week (cycle) on open, PLAN FORWARD plans exactly one week; Today's and the prompt's callers keep planning the week they need (always the current one). Chunk 53 (migration 044) changes what is copied; the TypeScript rule lives in chunk 42 and is compared with the SQL by an executed fixture (Checks that lied #28).

### F2 — How a set's kind and stages are stored on a week set and on a logged set
- **`v2_week_plan_sets`** (scratch schema): `id, week_plan_id, user_id, program_exercise_id, set_number, target_rir integer, is_dropset, parent_week_plan_set_id (cascade), stage_index, is_warmup, program_set_id (set null), stage_kind (heads only: check `parent is null or stage_kind is null`), target_weight numeric(6,2), rep_min, rep_max, is_amrap, tags text[]`. Encoding of the kind: `is_warmup`; a staged head carries `stage_kind` (null read as dropset by `resolveStageKind`, `plannerVocabulary.ts:95-97`); its stages are rows with `parent_week_plan_set_id` and `stage_index ≥ 1`, and `is_dropset := true` on a stage row, false on a head whatever the kind (041:386-388; `addStage` `weekPlanService.ts:475`). No rest column, no warmup-vs-staged check. Type `WeekPlanSet` (`types/index.ts:412-480`); mapper `toSet` (`weekPlanService.ts:170-206`).
- **`v2_set_logs`**: `id, user_id, session_id (cascade), exercise_id, week_plan_set_id (set null), set_number, weight, reps, rir, note, is_dropset, parent_set_id (cascade since 010), is_skipped, logged_at not null, rest_seconds (measured), stage_index, set_seconds, entered_unit, is_warmup, form_rating, stage_kind (heads only)`. Check (035:81-82): `is_skipped or is_warmup or (weight is not null and reps is not null)`. No index on `week_plan_set_id`. Type `SetLog` (`:524-572`); mapper `toSetLog` (`sessionService.ts:88-131`).
- **The workout writes the kind "as planned":** `SetRow.tsx:957-976` sends `stageKind: plannedSet?.stageKind ?? null`, `isDropset: isStage`; a head log gets `parent_set_id null, stage_index 0` (`useExerciseCardState.ts:366-410`); a stage log gets `parent_set_id = head log id`, `stage_index = max + 1`, `set_number = head's`, `stage_kind null`, and `week_plan_set_id = plannedStages[stages.length]?.id` — stages are matched to planned stages **by count**, heads by `weekPlanSetId` identity (`useExerciseCardState.ts:181, 339`; `SetGroup.tsx:244, 284, 302, 372`).
- **Consequence for 1.2:** a set type change on a **logged** set can be written on its log row (`is_warmup`, `stage_kind`; stages as stage logs) without touching the plan. A change on an **upcoming** set, and a delete of an unlogged planned set, have nowhere to live today: no log row exists before logging and the plan row is the plan. Chunk 36 adds `v2_session_set_changes` for exactly that (Data model).

### F3 — Where per-set rest and stage rest live today
- `v2_program_sets` (027:98-136; 040:200 `removed_at`): `position, is_warmup, stage_kind, stage_rest_seconds, parent_program_set_id, stage_index, rep_min, rep_max, is_amrap, rest_seconds, removed_at`, with checks that a stage row carries no kind, rest or warmup flag. Exercise rest: `v2_program_exercises.rest_seconds / rest_after_seconds`; superset rests on `v2_program_superset_blocks`.
- **Workout lookup:** `GymSession.tsx:283` loads every exercise's program sets once; each card gets only the sets of its **own** exercise row (`:578, :622, :648`; an extra card gets none); `useExerciseCardState.ts:259-263` reads the set's rest through `plannedSet.programSetId`, `:303-307` the stage rest, `:314-328` feeds `resolveRestTarget` (`restChain.ts:135`: set override → stage → superset → rest-after / exercise / global).
- **Writers:** `usePlanner.ts:109-116 / 120-127` → `plannerService.ts:139-142 / 147-150` (`update v2_program_sets set rest_seconds | stage_rest_seconds`), called from the planner (`StepVolume.tsx:426, 498, 537, 598-599`) and the week's Structure view (`StructureFields.tsx:116-117, 151-161`, gated by `ownProgramSet`, `structureFields.ts:29-34` — the G45 (c) rule).
- **So in 1.2** the set type picker's "Rest after this set" (week-dependent, board 5), its REST BETWEEN, and CHANGE THE PROGRAM's REST AFTER column (PL1b) all write the run copy's program set named by the week set's `program_set_id`, only where that program set belongs to the set's own exercise row, through the same two service functions. No new column.

### F4 — "Logged" and "unlogged" today, and what depends on a log row
- **Representation:** nothing on the plan row. A planned head is **logged** when a `v2_set_logs` row has `week_plan_set_id = <planned id>` and `parent_set_id is null` (`useExerciseCardState.ts:181, 339`; warmups `:680`); **pending** when no such row exists (`SetGroup.tsx:156` renders the input row); **skipped** when that row has `is_skipped` (`SetRow.tsx:599-619`: a read-only "SKIPPED" row with no edit or delete control; `updateSetLog`, `sessionService.ts:624-646`, patches only `weight/reps/rir/set_number/form_rating`, so a skip can't be undone today). There is no unlogged state anywhere in `src/`.
- **Delete today:** `deleteSetLog` (`sessionService.ts:648-651`), `useDeleteSetLog` (`useSession.ts:1151-1177`: `networkMode: 'always'`, optimistic removal, **online-only** — no Dexie or queue branch); cascade stages descending then the head client-side (`useExerciseCardState.ts:474-515`, `setGroupLogic.ts:119-127`) and by FK; later heads renumbered (`:504-514`), their stages not.
- **What depends on a log row existing** (every one is a consumer a stored unlogged state would have to teach — G46):
  - session status: `deriveCompletedAt` (max `logged_at`, every row counts) and `shouldClassifyAsSkipped` (`sessionCompletion.ts:47-82`); `completeSession` reads `logged_at, is_skipped` (`sessionService.ts:288-291`); the offline finish re-derives from the server's logs (`useSyncQueue.ts:59-71`); **auto-finish** waits until every planned set id — heads, stages and warmups — has a log (`useAutoFinishSession.ts:32, 44`);
  - History: the 035 views filter `not is_skipped` (heads, non-warmups) over completed sessions (`035:89-154`); `historyService.ts:313, 340`;
  - "last time": `fetchReferenceSessionsByExercise` (`sessionService.ts:919-986`) keeps every log of a completed non-deload session except warmups — skipped rows included, so the reach-back can see them (`referenceLogic.ts:127-129`);
  - the sync queue: items are `{ table, operation: 'upsert' | 'delete', payload }` (`db.ts:98-114`); only `upsert` is executed (`useSyncQueue.ts:132-142`) — `delete` is declared, never produced or run; a log is held behind its session row and its parent (`:89-97`);
  - `useLogSet`'s optimistic cache and Dexie row (`useSession.ts:965-1057`), the pending/failed badges (`offlineStore.ts`);
  - Progress: `e1rm.ts:66-75` (not skipped, not warmup, head, weight/reps/RIR present), `progressService.ts:106-108, 209-215`, `positionMatch.ts:129-132` (non-skipped groups);
  - deload: `fetchDeloadSetLogs` by `week_plan_set_id` (`weekPlanService.ts:1248-1269`), `hasAnySetLogForWeekPlan` (`:1277-1291`) blocks a recalculation;
  - Library: any log makes a deleted exercise "lost" instead (`exerciseService.ts:229-237`);
  - Coach (frozen): `api/coach/ask.ts:109-117`, `analysisInput.ts:440, 458-471` derive the exercise list from logs.
- **Also found, not 1.2's to fix unless a chunk touches it:** stage logs keep a stale `set_number` after a head renumber; a skipped set can't be un-skipped; auto-finish is blocked by an unlogged planned warmup (skip-whole-exercise never writes warmups).

### F5 — Which programs or runs carry a deload-rules override
- **Columns:** `v2_programs.deload_rules jsonb` (027:214-223, null = use the global default) and `v2_user_settings.deload_rules jsonb` (027:318-322). `v2_copy_program` copies the program's value onto the run copy (041:86-90), so a run can carry one.
- **Readers:** `resolveEffectiveDeloadRules` (`deloadRules.ts:149-162`: the raw program value wins when non-null, then `validateDeloadRules`), whose only caller is `PlanPage.tsx:298-307` (the "this run's" / "your default" line, the week mark at `:656`, the session toggle at `:1349`); `markSessionDeload` receives rules already resolved (`weekPlanService.ts:1561-1570`). The planner's control (`StepVolume.tsx:124-189`, USE MY DEFAULT / CUSTOM, hook `usePrograms.ts:124-131`, service `programService.ts:260-266`) writes `{}` for CUSTOM, and `programService.ts:113` folds `{}` back to null on read — so an all-off override already behaves as "use my default" (DECISIONS 108 noted it). Only a **non-empty** override changes behaviour when 1.2 stops reading the column.
- **Which rows have one:** not readable from this container — an anon read filtered to a user id returns `[]` whether rows exist or not (Checks that lied #33), and there is no service key here. For Adam, signed in, on both accounts: `select p.id, p.kind, p.name, m.name as run, m.status, p.deload_rules from v2_programs p left join v2_mesocycles m on m.program_id = p.id where p.user_id = auth.uid() and p.deload_rules is not null and p.deload_rules <> '{}'::jsonb;` Chunk 48 doesn't depend on the answer (the fallback is silent by SPEC); the answer says whose deload calculation changes the first time it runs after 48.

### F6 — What the start path does after starting
- Programs page: `ProgramsPage.tsx:116-146` `handleStartMeso` — name = typed name, else the program's, else the literal `'Mesocycle'` (`:118`); `startRun.mutateAsync` (`:131`, `useStartRun` in `useMesos.ts:29-40`, which invalidates `['v2_mesos']` and `['v2_programs']`); then `navigate('/plan/priorities')` (`:142`) — the view-only `PrioritiesEditor` (DECISIONS 90 left it there); the only toast is the error one (`:144`, "Could not start the mesocycle"). The planner's own START (`PlannerPage.tsx:142-149`) already navigates to `/plan`.
- `v2_start_run` (028:346-408, never re-created): advisory lock per user, refuses a program that isn't `kind = 'saved'`, completes every active run with `end_date = p_start_date`, copies through `v2_copy_program(…, 'run')`, inserts the `v2_mesocycles` row with `source_program_id`. `/plan` then plans the viewed week (F1).
- **So chunk 65:** both STARTs land on Plan with the current week forced to week 1; the name field defaults to the program's name; the `'Mesocycle'` literal goes.

### Routes and navigation today (for the chunks that move screens)
`App.tsx:103-133`: `/today`, `/plan`, `/plan/priorities`, `/progress`, `/history`, `/exercise/:exerciseId`, `/session-type/:workoutDayId`, `/program` (ProgramsPage), `/program/:programId` (PlannerPage), `/meso/:mesocycleId/priorities` (frozen MesoPrioritiesPage), `/library`, `/settings`, `/coach`. `Nav.tsx:14-23`: TODAY PLAN PROGRESS HISTORY LIBRARY SETTINGS, plus COACH for `isCoachUser`. Routes don't change in 1.2 (SPEC Language); `/program` keeps resolving (it renders Plan opened on PROGRAMS from chunk 65).
---

## Data model (1.2)

Domain objects from SPEC "Objects stored", mapped onto the schema 1.2 leaves. Three migrations, none touching an existing row: **042** (schema, chunk 36), **043** (`v2_apply_ops`, chunk 47), **044** (`v2_plan_week`, chunk 53). Conventions as in TASKS.md: every new table is `v2_`-prefixed, `user_id uuid not null references auth.users(id) on delete cascade`, RLS `for all using/with check (user_id = auth.uid())`, added to `TABLES` in `scripts/verify-rls.mjs` in the same migration chunk.

| SPEC [1.2] | Stored as | Migration |
|---|---|---|
| Program: schedule type and planning type required at creation, no default | Unchanged columns (`v2_programs.schedule_type`, `planning_type`, both with defaults). The New program sheet sends both; the defaults stay for old rows and for `v2_copy_program`. Nothing stored says "unchosen". | — |
| Program: the deload-rules override is no longer read or written | `v2_programs.deload_rules` stays, unread (SPEC: "no destructive migration"). `resolveEffectiveDeloadRules` reads Settings only. | — |
| Run: the "current program" / "finished program" | `v2_mesocycles` unchanged (`status active \| completed`, `end_date`). FINISH = today's `completeMeso`. | — |
| Week: RIR target as a number or a range | `v2_week_plan_sets.target_rir` stays the number / the range's low end; **new** `target_rir_max integer null` is the high end, with `check (target_rir_max is null or (target_rir is not null and target_rir_max >= target_rir))`. A number = `target_rir_max null`. Deload's RIR rule shifts both. COPY copies both. | 042 |
| Week: REVIEW decisions ("stored per week; TASKS decides the shape") | **New table `v2_week_review_decisions`**: `id, user_id, week_plan_id references v2_week_plans(id) on delete cascade` (the shown week's session row — REVIEW items are grouped by workout and this week is always planned when REVIEW shows), `item_key text not null` (deterministic: the item kind plus the ids it is about, built by `review.ts`, chunk 43), `decision text not null check (decision in ('used','ignored'))`, `created_at`; `unique (week_plan_id, item_key)`. A decided item never comes back because `review.ts` filters by key. | 042 |
| Week: nothing beyond the first unplanned week is reachable; PLAN FORWARD | Computed: the last planned week = `max(week_number)` of the run's `v2_week_plans`; the first unplanned = that + 1. Nothing stored. | — |
| Week: "a planned week is never updated by later edits in an earlier week's view" | Already true of the data (each week's rows are its own); the apply-ahead offer and `repointWeekExercise` are removed with chunk 53. | — |
| Week: what the auto-copy takes (structure, volume, set types; stable: rep targets; never weights, RIR, week-dependent reps, tags, deload) | `v2_plan_week` re-created with the 1.2 rules (chunk 53); the `week_start` branch goes (the column stays, unread). | 044 |
| COPY (fields, workouts, overwrite) | Client writes to existing `v2_week_plan_sets` rows (`target_weight`, `rep_min/rep_max/is_amrap`, `target_rir/target_rir_max`), one `v2_apply_ops` call so a sheet's copy lands or fails as a whole. | 043 (executor) |
| Session: a set type changed during the workout, "recorded on the session's set, never on the plan"; a set deleted during the workout, "this session only, never touches the plan" | **Logged set:** on its `v2_set_logs` row — `is_warmup`, `stage_kind` (heads), stage rows as stage logs; `updateSetLog` extended to patch them. **Upcoming set (no log row yet):** **new table `v2_session_set_changes`**: `id, user_id, session_id references v2_sessions(id) on delete cascade, week_plan_set_id uuid null references v2_week_plan_sets(id) on delete cascade, set_log_id uuid null references v2_set_logs(id) on delete cascade, deleted boolean not null default false, is_warmup boolean not null default false, stage_kind text null check (stage_kind in ('dropset','rest_pause','myo_reps','cluster')), stage_count integer not null default 0 check (stage_count >= 0), created_at, updated_at`; `check ((week_plan_set_id is null) <> (set_log_id is null))`; partial unique indexes on `(session_id, week_plan_set_id)` and `(session_id, set_log_id)`. One row per changed set: for a planned set before it is logged (`week_plan_set_id`), or for a logged head whose pending drops need a count (`set_log_id`). The workout screen merges it over the plan (chunk 46's pure rule); REVIEW reads `deleted` rows as "Skipped" (SPEC 13c, 18b). Rows die with the session. Nothing on the plan changes. | 042 |
| Session: unlogged again, keeping its numbers | **Spec gap G46.** Under its recommended answer (a): no column; the kept numbers live in a Dexie table `session_set_drafts` (`sessionId + weekPlanSetId → { weight, reps, rir, formRating, enteredUnit }`), never sent to Supabase. Under (b): migration 045 adds `v2_set_logs.unlogged_at timestamptz null` and replaces the three 035 views. | (045) |
| Settings: how drops and stages count in volume | **New** `v2_user_settings.stage_volume_rule text not null default 'half' check (stage_volume_rule in ('whole','each','half'))` (`whole set = 1`, `each drop = 1`, `each drop = ½`). | 042 |
| Settings: "Log sets in order" | **New** `v2_user_settings.log_in_order boolean not null default true`. | 042 |
| Settings: "new week starts" removed | `v2_user_settings.week_start` stays, unread and no longer written (the full-row upsert keeps sending the stored value; the client type keeps the field until 044 is live, then drops it from the upsert — Repo rule "a migration that drops a column ships after the code"; nothing is dropped in 1.2). | — |
| CHANGE THE PROGRAM: edits the run's copy; lands on every not-done session | The run copy's rows as today (`v2_program_exercises`, `v2_program_sets`, `v2_program_superset_blocks`, `v2_workout_warmup_items`, `v2_workout_days.name`, `v2_programs.schedule`) plus each not-done session's `v2_week_plan_exercises` / `v2_week_plan_sets`, written as one op list by **`v2_apply_ops(p_ops jsonb)`** (chunk 47): a whitelisted, `security invoker` executor that applies `insert` (full row, client-generated `id`), `update` (`id` + patch) and `delete` (`id`) ops in one transaction, raising on a row it can't find, with `user_id` forced to `auth.uid()` on inserts and `where user_id = auth.uid()` on every update and delete (pg-safeupdate satisfied). The landing rules are a pure TypeScript function (`programChange.ts`, chunk 45) that produces the ops; the SQL holds no planning logic. | 043 |
| CHANGE THE PROGRAM: weekdays change from next week; this week's sessions keep their days; a week planned forward takes the new days; Today finds sessions by the weekdays in force that week | **New table `v2_run_schedules`**: `id, user_id, mesocycle_id references v2_mesocycles(id) on delete cascade, from_week integer not null check (from_week >= 1), schedule jsonb not null` (the same `{monday: workoutDayId \| null, …}` shape as `v2_programs.schedule`, verified on the scratch copy: F1-a's run copy holds exactly that), `created_at`; `unique (mesocycle_id, from_week)`. Resolver (`runSchedule.ts`, chunk 45): the row with the greatest `from_week ≤ week`, else the run copy's `v2_programs.schedule`. A save that changes days inserts `(from_week = 1, the schedule before the change)` if the run has no rows yet, and upserts `(from_week = N + 1, the new schedule)` where N is the current week; it also writes the new schedule to the run copy's `v2_programs.schedule` (so `hasSchedule`, Coach and anything that doesn't resolve per week see the newest). Weekly rows (`v2_week_plans`) are per workout, not per day, so a week planned forward needs no rewrite. Sequence runs never get rows. | 042 |
| Finished program history (C1): exercises, order, set counts, kinds per week | Computed from the run's `v2_week_plans` / `v2_week_plan_exercises` / `v2_week_plan_sets` (`programHistory.ts`, chunk 66). Nothing stored. | — |
| Finished program's priorities | Unchanged: 1.1+ runs in `v2_program_priorities` on the run copy (the planner's `useSetPriorityMark` is the writer, reused); pre-1.1 runs in `v2_coach_meso_tag_priorities` through the frozen page (G50). | — |
| VOLUME | Computed from last week's sessions + logs, this week's plan, `exercises.muscle_group` (`'other'` when null, `muscleGroup.ts`) and `stage_volume_rule` (`volumePerMuscle.ts`, chunk 44). Nothing stored. | — |
| "Changes since the source" | Computed (`weekDiff.ts` rewritten by chunk 42). Nothing stored. | — |
| The log lock, the current set | Computed from the session's logs in session order (`workoutRules.ts`, chunk 46) and `log_in_order`. Nothing stored. | — |

**Why not a column on the plan for "deleted this session" / "retyped this session":** the plan row is shared by every device and by REVIEW's comparison; a session-only change belongs to the session (SPEC "never on the plan"). **Why a generic executor rather than a CHANGE THE PROGRAM function in SQL:** `v2_make_week_default` (040) put the landing logic in 330 lines of PL/pgSQL and failed review twice on matching edge cases (DECISIONS 105); with the logic in TypeScript it is unit-tested on fixtures, and the SQL only has to be atomic and scoped.

### Migration summary

| Migration | Chunk | Contents | Destructive? | Rollback |
|---|---|---|---|---|
| 042 | 36 | `v2_week_plan_sets.target_rir_max`; `v2_user_settings.stage_volume_rule`, `log_in_order`; tables `v2_week_review_decisions`, `v2_session_set_changes`, `v2_run_schedules` (+ RLS, indexes, grants) | No: adds columns with defaults or null and empty tables; no existing row changes | Forward-only: a later migration can drop the three tables and columns once no bundle writes them; until then they sit unused. `check-migration` flags nothing (add-only); D29 not needed |
| 043 | 47 | `create function v2_apply_ops(p_ops jsonb) returns integer`, grant to `authenticated`, `notify pgrst` | No: a new function | `drop function v2_apply_ops(jsonb)` in a later migration; nothing else references it. `check-migration` flags "function" → D29 lets the reviewer merge |
| 044 | 53 | `create or replace function v2_plan_week` with the 1.2 copy rules | No: replaces a function; no row changes; weeks already planned keep what they have | `create or replace` with 041's body verbatim (kept in git). `check-migration` flags "function" → D29 |
| (045) | 63 | only if G46 is answered (b): `v2_set_logs.unlogged_at` + the three views re-created to exclude it | No (a nullable column; views) | re-create the 035 views |

---

## File and folder structure

**New** (every `.ts` with a test beside it; every pure module under the feature that owns it, as TASKS.md laid them out):

| Path | Chunk | What |
|---|---|---|
| `supabase/migrations/042_p12_schema.sql`, `043_p12_apply_ops.sql`, `044_p12_plan_week_copy_rules.sql` | 36, 47, 53 | above |
| `scripts/probe-specs/042.json` | 36 | live probe of the new columns and tables (`probe-live-columns.mjs`) |
| `scripts/screenshot-fixture.mjs` (+ `screenshot-fixture.test.mjs`) | 37 | renders a captured render fixture at 390 px with `dist`'s CSS; writes the PNG and a text-order dump |
| `design/1.2/built/<board-id>.png` and `.txt` | every screen chunk | the built screen beside its board |
| `src/components/BottomSheet.tsx` | 38 | the sheet frame every 1.2 sheet uses (handle, eyebrow, title, ×); `ConfirmDialog.tsx` stays for confirms |
| `src/components/pickers/SetTypePicker.tsx`, `RepTargetPicker.tsx`, `RirTargetPicker.tsx` (+ `pickerLogic.ts`: stepper bounds, "Use for all N sets", stage-count rules) | 39 | the three shared pickers |
| `src/components/pickers/CuesSheet.tsx` | 40 | board 8 |
| `src/components/ExercisePickerSheet.tsx` | 41 | one picker for swap and add, with group chips, create-new and empty states |
| `src/features/plan/weekPlanning.ts` | 42 | reachable weeks and tile states; what a planned week takes from its source (the TypeScript twin of 044); COPY's matching and overwrite; "THIS WEEK ONLY" detection; the 1.2 "changes since the source" rules (replaces the rules in `weekDiff.ts`) |
| `src/features/plan/review.ts` | 43 | REVIEW items from last week's sessions against their plan; decided items filtered; each action's writes |
| `src/features/plan/volumePerMuscle.ts` | 44 | VOLUME rows |
| `src/features/programs/programChange.ts`, `runSchedule.ts` | 45 | how a CHANGE THE PROGRAM save lands (ops); the schedule in force per week |
| `src/features/gym/workoutRules.ts` | 46 | current set, the lock's decision and prompt, retype and delete effects, the finish warning |
| `src/features/programs/applyOps.ts` | 47 | the client of `v2_apply_ops` (op types shared with 45) |
| `src/features/plan/useRunSchedule.ts` | 50 | the resolver wired to Today, Plan and the move sheet |
| `src/features/programs/ChangeProgramPage.tsx` (+ `ChangeProgramExerciseCard.tsx`, `ChangeProgramDaysCard.tsx`, `ChangeProgramWarmupCard.tsx`, `useChangeProgram.ts`), route `/plan/change` | 51 | CHANGE THE PROGRAM |
| `src/features/plan/WeekTiles.tsx`, `PlanForwardCard.tsx`, `CopySheet.tsx`, `WeekMenuSheet.tsx`, `usePlanForward.ts` | 52 | the Plan header |
| `src/features/plan/WeekView.tsx` (+ `SessionCard.tsx`, `PlanExerciseCard.tsx`, `PlanSetRow.tsx`, `SessionMenuSheet.tsx`) | 54 | the week view |
| `src/features/plan/VolumeSheet.tsx` | 55 | board 3 |
| `src/features/plan/ReviewLine.tsx`, `ReviewSheet.tsx`, `useReview.ts`, `reviewService.ts` | 56 | board 4 |
| `src/features/gym/RestBar.tsx`, `SetRowLogged.tsx`, `SetRowCurrent.tsx`, `SetRowUpcoming.tsx`, `LastTimeSheet.tsx`, `SetEditPanel.tsx`, `SetOptionsSheet.tsx`, `ExerciseOptionsSheet.tsx`, `LogOrderPrompt.tsx`, `FinishScreen.tsx` | 58–64 | the workout screen |
| `src/features/gym/sessionSetChangesService.ts`, `useSessionSetChanges.ts` | 61 | reads and writes `v2_session_set_changes` |
| `src/features/programs/ProgramsTab.tsx` (+ `CurrentProgramCard.tsx`, `StartProgramSheet.tsx`, `NewProgramSheet.tsx`), `FinishedProgramPage.tsx` (+ `programHistory.ts`), route `/program/finished/:mesocycleId` | 65, 66 | PROGRAMS |

**Changed most:**
- `src/features/plan/PlanPage.tsx` becomes the PLAN \| PROGRAMS shell around `WeekView` (52, 54) and `ProgramsTab` (65); its 2,650 lines shrink to routing and data loading.
- `src/features/plan/{useWeekPlan.ts, weekPlanService.ts}` (52, 53, 54), `weekDiff.ts` (42, 54), `useSequenceCurrentCycle.ts` (52), `MoveSessionControl.tsx` (50, 54).
- `src/features/gym/{GymSession.tsx, ExerciseCard.tsx, SetGroup.tsx, SetRow.tsx, SupersetBlock.tsx, useExerciseCardState.ts, useSession.ts, sessionService.ts, SessionComplete.tsx, CompletedTodayScreen.tsx, ExerciseReference.tsx, SwapExerciseSheet.tsx}` (58–64), `scheduler.ts`, `useScheduler.ts`, `TodayPage.tsx`, `MissedSessionPrompt.tsx`, `moveSession.ts` (50).
- `src/features/planner/{StepVolume.tsx, StepExercises.tsx, StepPriorities.tsx, PlannerPage.tsx, designFieldEditors.tsx}` (48, 67, 68).
- `src/features/programs/{ProgramsPage.tsx → ProgramsTab.tsx, usePrograms.ts, programService.ts}` (65).
- `src/features/settings/{SettingsPage.tsx, settingsService.ts, settingsStore.ts, useSettings.ts}` (49), `src/lib/deloadRules.ts` (48), `src/types/index.ts` (36, 49, 51), `src/features/offline/useSyncQueue.ts` (57), `src/lib/db.ts` (57, 63), `src/components/Nav.tsx` (65), `src/App.tsx` (51, 65, 66).
- Wording only (69): `src/features/history/{HistorySessions.tsx, ExerciseHistoryView.tsx}`, `src/features/progress/{ProgressPage.tsx, MesoProgress.tsx, ExerciseProgress.tsx}`, `src/features/gym/TodayPage.tsx`, `src/features/plan/{PrioritiesEditor.tsx, deloadRulesLine.ts}`, `src/features/planner/PlannerPage.tsx`.

**Removed** (each inside the chunk that replaces it): `src/features/plan/{ApplyAheadOffer.tsx, applyAhead.ts, MakeWeekDefault.tsx, makeWeekDefault.ts, makeDefaultService.ts, useMakeWeekDefault.ts, StructureFields.tsx, structureFields.ts, WeekDiffMarks.tsx, WeekDiffGate.tsx, WorkoutSwitcher.tsx, SequenceSlotSwitcher.tsx, WeekExercisePickerSheet.tsx, planMenu.tsx}` and the related tests (54); `useApplyAhead`, `repointWeekExercise`, `createWeekPlan` (54); `copyFromPreviousWeek`, `copyWorkoutFromPreviousWeek`, `copyOnePlanForward` (52); `src/features/gym/RestTimerInline.tsx` (58); `StepVolume`'s deload section (48); the `'Mesocycle'` literal and END RUN (65). The SQL function `v2_make_week_default` stays in the database, uncalled (nothing stored is dropped).

**Never touched:** `src/features/coach/*` (`MesoPrioritiesPage` included — G50), `api/coach/*`, the existing exports of `referenceLogic.ts` and `setGroupLogic.ts` (new exports allowed), and the shared scripts `check-migration.mjs`, `migration-rules.mjs`, `check-context-size.mjs`.

---

## Additions to the core stack

| Addition | Why | Chunk |
|---|---|---|
| `playwright-core` as a devDependency (version matching the container's Chromium 141 / `chromium-1194`, i.e. 1.56.x), launched with `executablePath: /opt/pw-browsers/chromium-1194/chrome-linux/chrome` — never `playwright install` | Every screen chunk must produce a 390 px screenshot of the built screen beside its board; jsdom can't paint. Proven here on 2026-10-12: the existing `planpage-chunk6-render.html` and `gymsession-d30-render.html` fixtures rendered at 390 px with `dist/assets/index-*.css` through `playwright-core@1.56.1` and the preinstalled browser (see Baseline measurements). | 37 |

Nothing else. Sheets, pickers, drag-to-reorder (CHANGE THE PROGRAM "order by drag") and the rest are built with React 19, Tailwind v4 and the existing tokens; drag uses pointer events, no library (the planner already reorders with up/down buttons, which PL1 keeps as the ⋯ fallback).
---

## Chunks in build order

**Order and what can run side by side:**
- **36** (schema) first, alone. Then **37**, **38** and the pure-rule chunks **42–46** can run in parallel (they share no files); **39–41** follow 38.
- **47** (the executor) follows 45. **48**, **49**, **50** follow 36 (50 also 45) and can go at any time before the screens that need them.
- **51** (CHANGE THE PROGRAM) before **52–56** (Plan): the week view drops its exercise-level actions only once the screen that replaces them is live.
- **52 → 53 → 54**: the header (with COPY) ships before 044 removes the automatic numbers; the week view follows. **55** and **56** after 54.
- **57** then **58–64** in order (each workout chunk builds on the rows 58 lays down). **65**, **66** after 52 (the PLAN \| PROGRAMS shell). **67**, **68** after 39/41. **69** last.
- Stops: 63 at G46/G47; 57 at G47; 54's legend at G48 and its warmup row at G49; 66's pre-1.1 PRIORITIES row at G50; 55 only for anything beyond the sheet at G51.
- No stacked PRs: each chunk merges to master on its own (retro, section 3.7). A chunk with a migration merges the migration first (CONTEXT, Migration flow).

**Every chunk, in addition to its own verification:** `npm run typecheck`, `npm test`, `npm run build`, `node --test "scripts/*.test.mjs"`, `node scripts/check-frozen-code.mjs`, `node scripts/check-program-exercise-reads.mjs`, `node scripts/check-context-size.mjs`; a chunk with a migration also `bash scripts/replay-migrations.sh`, `bash scripts/check-embeds-local.sh` (CI) and `node scripts/check-migration-order.mjs`. **Every chunk that builds a screen:** the 390 px screenshot of each board it builds (`node scripts/screenshot-fixture.mjs`, chunk 37), saved as `design/1.2/built/<board-id>.png` with its `.txt`, reviewed beside `design/1.2/png/<board-id>.png` for the same elements, order and wording — never pixel-matched; plus the standing 375 px overflow check (`scrollWidth` ≤ viewport, which the script prints). A chunk that touches the workout screen also keeps the behaviour-parity tests from chunk 58 green.

### Chunk 36 — Migration 042: the schema 1.2 needs
**Goal:** Every column and table a later chunk writes exists in production, empty or defaulted, before any code refers to it.
**SPEC:** Objects stored (Week: RIR range "a second, additive column"; REVIEW decisions; Settings: the two rows); Programs and runs → Weekdays storage; Set log [1.2] (the session-only change); Data model above.
**Scope:** `supabase/migrations/042_p12_schema.sql`, one file:
1. `alter table v2_week_plan_sets add column if not exists target_rir_max integer` + the check `target_rir_max is null or (target_rir is not null and target_rir_max >= target_rir)`.
2. `alter table v2_user_settings add column if not exists stage_volume_rule text not null default 'half' check (stage_volume_rule in ('whole','each','half'))`, `add column if not exists log_in_order boolean not null default true`.
3. `create table v2_week_review_decisions`, `v2_session_set_changes`, `v2_run_schedules` exactly as the Data model states, each with RLS `for all using/with check (user_id = auth.uid())`, `grant all … to anon, authenticated, service_role` (as 027 does), and indexes: `(week_plan_id)`; `(session_id)`, partial uniques `(session_id, week_plan_set_id) where week_plan_set_id is not null` and `(session_id, set_log_id) where set_log_id is not null`; `unique (mesocycle_id, from_week)`.
4. `notify pgrst, 'reload schema'`.
- `scripts/verify-rls.mjs`: the three tables added to `TABLES` (`verify-rls-tables.test.mjs` fails otherwise once a `.from()` appears; add them now so the first chunk that reads them passes).
- `scripts/probe-specs/042.json` for `probe-live-columns.mjs` (every new column and table, plus the made-up-column control).
- `src/types/index.ts`: `WeekPlanSet.targetRirMax?: number | null`, `UserSettings.stageVolumeRule`, `UserSettings.logInOrder`, and the three row types; `weekPlanService.ts` `toSet` maps `target_rir_max` (read only — no writer yet); `settingsService.ts` maps the two columns with the "absent until applied" convention and **does not send them yet** (chunk 49 does, after the deploy).
**Depends on:** —
**Migration:** 042. **Not destructive:** adds nullable or defaulted columns and three empty tables; no existing row changes. **Rollback:** nothing to undo on data; a later migration can drop the objects once unused (forward-only rule). `check-migration.mjs`: expected to pass as add-only (verify: exit 0); if it flags the RLS policies as "new policy", that is on new tables, not existing ones, so it is the reviewer's merge under D29's reading — say which in the chunk report.
**Verification:**
- `bash scripts/replay-migrations.sh` green (CI) and the local stand-in (Process notes) green; `check-embeds-local.sh` green (no embed changes, but the new FKs from `v2_session_set_changes` to `v2_week_plan_sets` and `v2_set_logs` are single, so no existing embed becomes ambiguous — assert by listing `pg_constraint` for both pairs, exactly one FK each).
- Constraints proven by violation on the scratch copy (`23514` / `23505` / `23503`, CONTEXT rule): `target_rir_max` below `target_rir`; a change row with both or neither target set; two change rows for one planned set in one session; `from_week = 0`; a decision with `decision = 'maybe'`.
- RLS proven through the anon-key path on scratch (a second fixture user reads zero rows of the first's); `node scripts/verify-rls.mjs` live needs Adam's go-ahead (Escalation 18) and is run once after the deploy.
- Scratch count/fingerprint check: row counts and per-row md5 of every existing table unchanged before and after 042 (D29's proof for add-only).
- After the production deploy: `node scripts/probe-live-columns.mjs 042` answers `200 []` for every new column and `400` for the control.
**Would not catch:** anything a later chunk writes wrongly into these columns (their own chunks prove that); PostgREST's view of the new tables (first read is in chunk 56/61, whose `check-embeds` runs cover it).
**Done when:** 042 is live (every `Supabase Preview` run on the merge commit read, the probe green), `TABLES` lists the three tables, and the app behaves exactly as before (no bundle reads or writes the new objects yet).

### Chunk 37 — 390 px screenshots of render fixtures
**Goal:** A builder can turn a captured render of any screen into a 390 px light-theme PNG beside its board, plus a text-order dump, with one command — so every screen chunk's board check is mechanical to produce and the same for everyone.
**SPEC:** Design boards [1.2] ("never pixel-match"; the light-theme board is the reference); the 1.2 brief (a 390 px screenshot next to the board PNG, checked for elements, order and wording).
**Scope:**
- `scripts/screenshot-fixture.mjs <fixture.html> <out.png> [--dark] [--css dist/assets/index-*.css]`: wraps the fixture (a body fragment captured the way `GymSession.d30.test.tsx` captures `outerHTML`) in a document with `data-theme="light"`, inlines the built stylesheet with the Google Fonts `@import` stripped (no network), opens it in the preinstalled Chromium through `playwright-core` (`executablePath` under `/opt/pw-browsers`, never `playwright install`), viewport 390 × 844, full-page PNG, and writes `out.txt` = `document.body.innerText` (the visible text in DOM order) and prints `scrollWidth` (overflow check).
- `scripts/screenshot-fixture.test.mjs` (node:test): renders a tiny fixture and asserts the PNG exists, the text dump has the fixture's strings in order, and a deliberately 500 px-wide element is reported as overflow.
- A shared Vitest helper `src/testing/captureRender.ts`: `captureRender(name, element)` writes `src/**/__fixtures__/<name>.html` from a jsdom render (opt-in via an env var so the suite doesn't write files by default), the convention every screen chunk uses to produce its fixture.
- `package.json`: `playwright-core` devDependency pinned (Additions to the core stack); `npm run shot -- …` script.
- `.gitignore` unchanged: `design/1.2/built/` is committed by each screen chunk.
**Depends on:** —
**Migration:** none.
**Verification:**
- The node test above, with its overflow break proof (a 390 px element reports none).
- `node scripts/screenshot-fixture.mjs src/features/plan/__fixtures__/planpage-chunk6-render.html /tmp/x.png` reproduces what this session did on 2026-10-12 (Baseline measurements): a 390-wide PNG, 31 text lines starting `TEST MESO / PRIORITIES / PLAN / WEEK 1`.
- Dark theme: `--dark` renders with `data-theme="dark"` (the app's default tokens) and the background colour read from the PNG's corner pixel differs from the light run's (a pixel read in the test, not a pixel match of the screen).
**Would not catch:** fonts (the container can't fetch Archivo / JetBrains Mono, so the PNG uses fallbacks — wording and order are what the review compares); anything only a real browser with the app's JS shows (focus, sheets opening, scroll). Those are the screen chunks' jsdom behaviour tests and Adam's live check.
**Done when:** the script and its test are on master, `playwright-core` installs from `npm ci` without a browser download, and one committed example (`design/1.2/built/example-plan-fixture.png` + `.txt`) exists.

### Chunk 38 — The shared sheet frame
**Goal:** One bottom-sheet component carries the frame every 1.2 sheet shares — the handle, the small eyebrow line, the title, the × button, the scrim, closing on scrim tap and Escape — so every later sheet is the same thing with different content.
**SPEC:** Design boards (boards 2–8, W7, W10, W11, W13, W16, PL2–PL6, PP2c, PR8, PR13: all one frame); the standing UI rule.
**Scope:** `src/components/BottomSheet.tsx` (`eyebrow`, `title`, `onClose`, `children`, optional `footer` for the pinned primary button the pickers use; built from the existing tokens — `--surface`, `--border`, `--font-mono` eyebrows — and the look of `ProgramsPage.tsx`'s private `BottomSheet` at `:558`, which stays where it is until chunk 65 replaces that page). Focus moves into the sheet on open and back on close; the page behind doesn't scroll. No existing sheet is migrated to it in this chunk (no refactor-plus-feature).
**Depends on:** —
**Migration:** none.
**Verification:**
- jsdom tests: renders eyebrow, title and children in that order; × and scrim call `onClose`; Escape calls `onClose`; `footer` renders last; `aria-modal` and a labelled dialog role.
- Screenshot: a fixture with a title, two rows and a footer button at 390 px, compared with board 2's frame (handle, eyebrow, title, ×, footer button) for order and wording.
- Absence: no colour literal in the file (`grep -E '#[0-9a-f]{3,6}'` empty; Rules "all colours via tokens").
**Would not catch:** touch gestures (drag to close) — none planned; real-device scroll locking behind the sheet (Adam's live check on the first screen that ships a sheet, chunk 51).
**Done when:** on master, unused by any screen (nothing changes for users), with the tests above green.

### Chunk 39 — The set type, rep target and RIR target pickers
**Goal:** The three pickers exist once, as shared components with their own logic module, and every later screen uses them unchanged: Plan, CHANGE THE PROGRAM, the stepped planner and the workout.
**SPEC:** Set types and staged sets [1.2] ("One set type picker (5)… It is built once and reused; so are the rep target and RIR target pickers. Screens never re-implement them."); Targets [1.2] (rep target picker (6): NONE / NUMBER / RANGE / AMRAP, "Use for all N sets of [exercise]"; RIR target picker (17): NONE / NUMBER / RANGE, "Use for all" starts ticked in both, no tap-a-value shortcut, "values go well beyond 5"); Rest [1.2] (which picker variant shows "Rest after this set" and REST BETWEEN); Defaults 7.
**Boards:** 5, 6, 7 (Plan variants), PP3c, PP3d (planner), W7a (workout).
**Scope:**
- `src/components/pickers/pickerLogic.ts` (pure, tested): the set type options with their one-line descriptions (board 5's wording, read from `design/1.2/source/SetKindPicker.dc.html`); the stepper label per kind (DROPS / PAUSES / MINI-SETS / CLUSTERS, board 5); `applySetType(current, pick)` → the resulting head kind and stage count (Normal/Warmup remove stages; a staged kind keeps the count or starts at 1; "a warmup can never be staged"); rep target parse/format reusing `plannerVocabulary.ts` (`parseRepTarget`, `formatRepTarget` — its `none` text never shown); RIR range rules (`from ≤ to`, a range whose ends meet is a number, NONE clears); stepper bounds (reps 1–100, RIR 0–20: "values go well beyond 5").
- `SetTypePicker.tsx` — props decide the variant: `{ context: 'plan-week-dependent' | 'plan-stable' | 'planner' | 'change-program' | 'workout', value: { kind, stageKind, stageCount, stageRestSeconds, restAfterSeconds }, onChange, onRemove?, onCues? }`. Rows per SPEC: type list always; the DROPS stepper inside the picked staged kind; REST BETWEEN under it except `plan-stable` and `workout`; "Rest after this set · Every week from now on" only in `plan-week-dependent` and only when `canEditRest` (the set names a program set of its own exercise, G45 c); Cues row in `plan-*`; REMOVE THIS SET in `plan-*`, `planner`, `change-program`; the workout footer line "Changes this workout only. Next week's plan stays as it is; the change shows up in REVIEW when you plan it." in `workout`. Title "What is this set?"; eyebrow `[EXERCISE] · SET NN · WEEK N` / `· THIS WORKOUT`.
- `RepTargetPicker.tsx` — NONE / NUMBER / RANGE / AMRAP segments, FROM/TO boxes with ± steppers, "Use for all N sets of [exercise]" ticked by default, footer `SET 8–10 REPS` / `SET 12 REPS` / `SET AMRAP` / `CLEAR TARGET`.
- `RirTargetPicker.tsx` — NONE / NUMBER / RANGE, the same boxes, the helper "Either number is on plan. Pick on the day." under a range, "Use for all N sets", footer `SET RIR 1–2`.
- All three on `BottomSheet`; no writes — each returns a value to its caller; the caller decides what to write (the week set, the program set, the session).
**Depends on:** 38.
**Migration:** none (the RIR range column is in 042, but this chunk stores nothing).
**Verification:**
- `pickerLogic` tests with break proofs per rule: Warmup from a dropset with 2 drops → `{ kind: 'warmup', stageCount: 0 }`; Dropset from Normal → `stageCount: 1`; Cluster from Dropset with 3 → keeps 3; a range 2–2 → the number 2; NONE → null; `to < from` rejected; RIR 12 accepted.
- Component tests (jsdom): each variant renders exactly the rows SPEC gives it — `plan-stable` shows the DROPS stepper and no REST BETWEEN and no rest row (absence asserted); `workout` shows types only plus the footer line; `plan-week-dependent` with `canEditRest: false` shows no rest row; "Use for all" is ticked on open in both target pickers; the footer button text follows the choice; `onChange` payloads match the logic module (one test per segment).
- Screenshots at 390 px of boards 5, 6, 7 (Plan variants), PP3c, PP3d, W7a from fixtures, each compared with its board for the same rows, order and wording.
- Absence: no screen imports anything from `src/features/*` into the pickers (they are leaf components) — a grep in the test.
**Would not catch:** what a screen does with the returned value (each screen chunk proves its write); the sheet on a real phone (Adam, with chunk 51, the first screen that ships them).
**Done when:** the three pickers and the cues row hook are on master, exported from `src/components/pickers/index.ts`, unused by any screen yet; tests and screenshots committed.

### Chunk 40 — The cues sheet
**Goal:** One sheet picks a set's cues — the presets, the user's own custom cues, "+ NEW CUE", "Use for all N sets" — and returns the list; Plan's set type picker and the workout's set ⋯ open it.
**SPEC:** Tags [P1] — called cues [1.2] (preset list, custom text, "Apply to all sets", "Reached from the set type picker's Cues row in Plan (board 5 → 8), and from the set's ⋯ during a workout (W7)"); Language [1.2] "Tags are 'cues'".
**Boards:** 8.
**Scope:** `src/components/pickers/CuesSheet.tsx` on `BottomSheet`: eyebrow `[EXERCISE] · SET NN · WEEK N`, title "Cues for this set", the line "Shown on the set when it's next in the workout. Not copied to next week.", a checkbox row per preset (`PRESET_TAGS`, `plannerVocabulary.ts:106-111`, shown with a capital first letter as the board does), the user's custom cues with a `YOURS` marker, "+ NEW CUE" (an inline input; `addTag` dedupes exact text), "Use for all N sets of [exercise]" (unticked by default — board 8 draws it unticked; Defaults 7 names only the two target pickers), DONE. Returns `{ cues: string[], applyToAll: boolean }`; the caller writes (`applyTagToAllHeads` skips warmups and stages, as today). Custom cues come from the run's existing tag values (every distinct non-preset tag on the run's week sets) — no new storage.
**Depends on:** 38.
**Migration:** none.
**Verification:** jsdom: presets listed in `PRESET_TAGS` order; a custom cue added once even when typed twice; DONE returns the ticked list; "Use for all" returns `applyToAll`; screenshot vs board 8 for rows, order and wording.
**Would not catch:** the write (chunks 54 and 61 prove theirs).
**Done when:** on master, unused by any screen yet.

### Chunk 41 — The exercise picker sheet
**Goal:** One exercise picker for every swap and add: muscle-group chips (ALL first, the exercise's own group preselected on a swap), the list with the group under each name, a swap's radio-and-confirm or an add's tap-to-add, "+ NEW [GROUP] EXERCISE" inline creation, and the empty states — used by CHANGE THE PROGRAM, the stepped planner and the workout.
**SPEC:** Screens → CHANGE THE PROGRAM (PL4, PL5, PL6); Stepped program planner (PP2d, PP2d2); Workout screen (W11, W13–W15, "Swap and add exercise errors show the real reason"); Library [P2] is not this build — the picker searches the user's own exercises as today's `SwapExerciseSheet` and `ExercisePicker` do.
**Boards:** PL4, PL5, PL6, PP2d, PP2d2, W11, W13, W14, W15.
**Scope:** `src/components/ExercisePickerSheet.tsx` on `BottomSheet`, `mode: 'swap' | 'add'`, `exclude: exerciseId[]` (exercises already in the workout, as today's add excludes), `title`, `eyebrow`, `confirmLabel` (`SWAP FOR TODAY`, `SWAP`, `ADD EXERCISE`), `stayOpenAfterAdd` (PP2d: "Tap to add. The list stays open for the next one."), `onPick`, `onCreate` (reuses `useCreateExercise` from `SwapExerciseSheet.tsx:62-93`: name + the chosen group; the error line shows the real `message`). Empty states: `NONE IN THIS GROUP`, `ALL EXERCISES ADDED`, "No forearms exercises yet." + the create row, "No exercises yet. Pick a muscle group to create one." (board W15 wording). The footer line for a swap in the workout: "The set left moves to Machine Pulldown. Next week's plan stays the same." is passed in by the caller. `SwapExerciseSheet.tsx` and `programs/ExercisePicker.tsx` stay until the chunks that replace their callers (59, 51, 68) remove them.
**Depends on:** 38.
**Migration:** none.
**Verification:** jsdom: chips in `MuscleGroup` order with ALL first; swap mode preselects the exercise's group and needs a pick before the confirm enables; add mode calls `onPick` per tap and keeps the sheet open when asked; excluded exercises absent; create flow calls `createExercise` with the group and shows a failing call's `message` verbatim; screenshots vs PL4, PL5, PL6, W11, W13, W15 (each state).
**Would not catch:** the swap or add write (59, 51, 68).
**Done when:** on master, unused by any screen yet.

### Chunk 42 — Week planning and copy rules as pure functions
**Goal:** Everything Plan decides about weeks is one tested module: which weeks exist and what each tile says; what a planned week takes from its source (the exact rule 044 will implement, so the two can be compared by executed fixture); how COPY matches last week's numbers and what "overwrite" means; when an exercise is "THIS WEEK ONLY"; and the 1.2 "changes since the source" rules.
**SPEC:** Weeks and copying [1.2] (all of it), Defaults 7 and 8, Scheduling → Sequence ("the cycle replaces the week everywhere").
**Scope:** `src/features/plan/weekPlanning.ts` (+ tests), no I/O:
- `weekTiles({ plannedWeeks, currentWeek })` → `[{ week, state: 'done' | 'this' | 'planned' | 'not_planned' }]` from 1 to `max(planned) + 1`; the first unplanned is the only one beyond; nothing further (SPEC "you can't go to week 4…").
- `autoCopy({ planningType, source })` → the set rows a new week gets: structure (exercises, order, kinds, stages, counts, `program_set_id`), stable: the default's rep targets; week-dependent: **no** rep target (`rep_min/max null, is_amrap false`); never `target_weight`, `target_rir`, `target_rir_max`, `tags`, `is_deload`. Source selection: stable → the run copy (sets with `removed_at null`, exercises not `week_only`/removed); week-dependent → the last planned normal non-empty occurrence (`weekSources.ts`'s search, kept); week 1 → the program. The partly-deload rule stays.
- `copyNumbers({ fields, workouts, overwrite, lastWeek, thisWeek })` → updates per this-week set: matching by exercise identity, then position with warmups paired to warmups and working sets to working sets (039's rule), stages following their head; `overwrite: false` fills only null fields; a range RIR copies both columns; the done workouts are never in `workouts`.
- `thisWeekOnly(exerciseSets, defaultSets)` → true when count, kind, stages or rep target differ (weight, RIR, cues never count).
- `changesSinceSource(week, source, planningType)` — the rewrite of `weekDiff.ts`'s rules to SPEC 1.2: week-dependent vs last week's plan; stable: counts/kinds/stages/rep targets vs the default and weight/RIR vs last week; week 1 vs nothing; exercises by identity (swap = removed + added), sets by position; removed → "removed line"; moved → highlighted (provisional 82/83 kept); cues never; deload sessions nothing. `weekDiff.ts` is replaced by this in chunk 54; its `week_start` branch goes.
- `addSetDefaults(previousSet)` → a Normal set with the previous set's rep target and no weight or RIR (Defaults 8).
**Depends on:** 36 (types for `targetRirMax`).
**Migration:** none.
**Verification:**
- Tests per rule with a break proof each (Checks that lied #11): tiles stop at the first unplanned week (planned {1,2,4} → tiles 1,2,3 and 3 is `not_planned`; break: include 4 → fails); `autoCopy` week-dependent drops weights, RIR and reps but keeps a dropset's two stages, a warmup and the AMRAP flag (break: copy `rep_min` → fails); stable keeps rep targets; `copyNumbers` with `overwrite: false` leaves a typed 60 kg alone and fills an empty one (break: overwrite → fails); a warmup never takes a working set's weight; a range copies as a range; `thisWeekOnly` false for a weight change, true for a stage added; `changesSinceSource` on a stable week marks a rep target that differs from the default and not one equal to it but different from last week (break: compare reps with last week → fails).
- **Executed comparison with 041's `v2_plan_week`** (today's rule) on the scratch copy, fixtures F1-a/F1-b: `autoCopy` applied in TypeScript to the same fixture produces week 2's structure identical to the SQL's and differs exactly in the three number columns — printed side by side, not read (Checks that lied #28). The same harness is reused by chunk 53 against 044.
**Would not catch:** the screens (54) and the SQL (53) — those chunks prove the wiring.
**Done when:** the module and its tests are on master; nothing user-visible changes.

### Chunk 43 — REVIEW as a pure function
**Goal:** Given last week's sessions with their logs, this week's plan and the stored decisions, one module lists REVIEW's items exactly as SPEC defines them, and turns each action into the writes it means.
**SPEC:** Review: what went differently last week [1.2] (13), Defaults 4 and 10.
**Scope:** `src/features/plan/review.ts` (+ tests):
- `reviewItems({ lastWeek: { sessions (status, logs, swaps, sessionSetChanges) , plan }, thisWeek: plan, decisions })` → items grouped by workout, each with a stable `key` (e.g. `num:<last-week planned set id>`, `added-set:<log id>`, `type:<planned set id>`, `added-ex:<session id>:<exercise id>`, `swap:<swap id>`), filtered by `decisions`. Number items only where last week had a planned weight or reps; the rep-range and AMRAP rules; "Skipped" / "Not logged" (a planned set with a skipped log, or no log in a finished session, or a `deleted` session-set-change); RIR shown alongside, never an item alone. Structural items: added set (a log with no `week_plan_set_id`), a drop/stage added or a kind changed (the log's kind vs the planned kind; stage logs vs planned stages), an exercise added (`extra` logs whose exercise isn't in the plan) or swapped (`v2_session_exercise_swaps`). Only done sessions of last week count ("While last week isn't finished, its items come from its done sessions only"); week 1 → no items; "last week" = the week before the one shown (sequence: previous cycle).
- `applyReviewAction(item, action, thisWeekPlan)` → the writes: USE (weight and reps into the matching this-week set, a range → the number; no match → ADD THIS SET), ADD THIS SET (append with the done numbers and kind), the kind USE (kind and stage count), REMOVE THIS SET, ADD EXERCISE and SWAP FROM WEEK N as `programChange` inputs (chunk 45) placed after the exercise it followed, with this week's sets as done; IGNORE → a decision only. Every action also yields the decision row.
- Text helpers for the board's wording ("Did 57.5 kg × 11", "planned 55 kg × 8–10 · RIR 2 → did RIR 1", "Set 03 · 15 kg × 18", "for all 3 sets", "Swapping changes the plan from week 2 on.").
**Depends on:** 36 (decision and change shapes), 42 (matching helpers).
**Migration:** none.
**Verification:** tests with break proofs: a set inside its range → no item (break: treat as item → fails); AMRAP reps never, weight still; a skipped planned set → "Skipped"; a planned set with a `deleted` change → "Skipped"; a planned set in an in-progress session → nothing; week 1 → `[]`; a decided key gone and never back; USE on a range writes the number; USE with no matching set becomes ADD THIS SET; a swap item carries a `programChange` input from this week; matching uses planned positions so a deleted set doesn't shift its neighbours' items. Fixture dates derived from weekdays, queue printed (Checks that lied #21).
**Would not catch:** the sheet and its writes (56).
**Done when:** on master with tests; nothing user-visible changes.

### Chunk 44 — VOLUME as a pure function
**Goal:** One tested module turns last week's sessions, this week's plan, the exercises' muscle groups and the Settings rule into board 3's rows.
**SPEC:** Volume per muscle [1.2] (14), Settings (14b), Warmup sets ("Never counted in volume"), Volume [P1/P2].
**Scope:** `src/features/plan/volumePerMuscle.ts` (+ tests): `volumeRows({ lastWeek: { sessions, plan }, thisWeek: plan, exercises, rule })` → `[{ muscle, last, this, delta, note? }]` ordered as `MuscleGroup` is, `'other'` last; last week: a done session counts its done sets (added in, skipped out; a `deleted` change out), a session not done counts its plan; this week: its plan; warmups never; a staged set = 1 + drops × (rule: whole 0, each 1, half ½); the note "YOU PLANNED 4 LAST WEEK · DID 10" where last week's actual ≠ its plan; fractions formatted as the board does (`5½`). Muscle group = the exercise's `muscle_group`, `'other'` when null (`muscleGroup.ts`); subgroups aren't rows (SPEC's known gap).
**Depends on:** 36 (the rule's type).
**Migration:** none.
**Verification:** tests with break proofs: a dropset with 2 drops under `half` = 2, under `each` = 3, under `whole` = 1; a warmup = 0; a skipped planned set in a done session = 0 while a planned set in a not-done session = 1; an added set in a done session = 1; the note appears only when actual ≠ planned; `'other'` catches a null group.
**Would not catch:** the sheet (55).
**Done when:** on master with tests.

### Chunk 45 — How a CHANGE THE PROGRAM save lands, as a pure function
**Goal:** One tested module turns an edit of the run's copy (exercises, order, supersets, routine, rest/tempo/unit, names, weekdays, stable default sets) into the exact rows to write — on the run copy and on every not-done session from the current week on — plus the schedule history; a second small module says which weekday schedule is in force for any week.
**SPEC:** Programs and runs [1.2] → "Changing a running program" (everything under it: what it edits, week-dependent vs stable, weekdays, "How a save lands" (Defaults 1), "Weekdays storage"); Supersets [1.2] (Defaults 5); Defaults 2, 3.
**Scope:**
- `src/features/programs/runSchedule.ts`: `scheduleForWeek(rows, runCopySchedule, week)` → the row with the greatest `from_week ≤ week`, else the run copy's schedule; `scheduleChangeRows(existingRows, oldSchedule, newSchedule, currentWeek)` → the rows to insert/upsert (`from_week = 1` with the old schedule when none exist; `from_week = currentWeek + 1` with the new).
- `src/features/programs/programChange.ts`: `planProgramChange({ runCopy (exercises, sets, blocks, routine, workouts, schedule), sessions (every week plan of the run from the current week on, with its status: done / in_progress / not started, its exercises and sets), edit, currentWeek, planningType })` → `{ ops: Op[], summary }` where `Op` is the 043 shape. Rules, each a named branch: added exercise (run copy row + each not-done session's `v2_week_plan_exercises` row at the placed position; stable: the default's sets copied as that session's sets with `program_set_id`; week-dependent: no sets); removed (run copy `removed_at`; delete the week rows and their sets in not-done sessions); swapped (new run copy row at the old position, old row `removed_at`; in each not-done session the new exercise takes the old one's sets — count, kinds, stages, rep targets — with weights, RIR and cues cleared); reordered (positions on the run copy and on every not-done session, supersets moving as blocks); stable default sets (program set rows; each not-done session's set changed only where that session's set still equals the old default per set position and whole kind — DECISIONS 105's lesson: compare the resolved kind (`resolveStageKind`) as one part; a "THIS WEEK ONLY" set left alone; weights, RIR and cues on kept sets kept); rest, tempo, unit, superset rests, superset grouping, routine, workout names (run copy only, run-wide); weekdays (schedule rows + the run copy's schedule). Done sessions never appear in ops; a session in progress never does. Week N for the rule box = the week of the first not-done session.
- The pure module also exposes the rule-box text and the DAYS card text ("Was Tuesday. New days start in week 3. This week Pull 1 stays on Tuesday; MOVE THIS SESSION in Plan moves just this week.", "Thu is Push 2's day").
**Depends on:** 36 (row shapes), 47 is downstream (the op type is defined here and consumed there).
**Migration:** none.
**Verification:** fixture-based tests, each with a break proof: a stable run with weeks 2 (Monday done, Tuesday in progress, Thursday not started) and 3 (planned forward): removing an exercise yields deletes for Thursday and week 3 only (break: include Monday → fails); a swap clears `target_weight`, `target_rir`, `target_rir_max`, `tags` and keeps counts/kinds/stages/rep targets (break: keep weights → fails); changing the default's set 2 rep target lands on a session whose set 2 still matches the old default and not on one changed THIS WEEK ONLY (break: land on both → fails); a kind change on a head that a session turned into a warmup is skipped as a whole (105's cases 1–3 as tests); reorder moves a superset as one block; weekdays produce `from_week 1` + `from_week 3` rows on a run with none and only `from_week 3` on one that has rows; a day another workout uses is refused by `validateDays`; a sequence run yields no schedule rows; week-dependent added exercise lands with no sets; every op carries the user id and a client-generated id for inserts; `scheduleForWeek` picks the greatest `from_week ≤ week` (break: `<` → fails).
**Would not catch:** the executor (47) and the screen (51).
**Done when:** on master with tests.

### Chunk 46 — Workout logging rules as pure functions
**Goal:** The workout screen's new decisions are one tested module: the current set, what the lock does on LOG, what a set type change does to a set's stages (logged and pending), what delete does (cascade, renumber), what unlog is allowed to do, and what the finish warning lists.
**SPEC:** Logging mechanics [1.2] (current set; log lock (18a); set type during a workout (19, 19c); delete set (18b); unlog (18c, Defaults 6); finishing (11, C6)); Supersets [1.2] (ADD ROUND, Defaults 9); Set types and staged sets [1.2].
**Scope:** `src/features/gym/workoutRules.ts` (+ tests): `sessionOrder(exercises, supersets)` → the flat order (zigzag through rounds A1 B1 A2 B2…); `currentSet(order, logs, changes)` → the first unlogged set (deleted changes excluded; a pending drop under a logged head counts as a set after its head); `lockDecision({ logInOrder, current, tapped })` → `'log' | { ask: 'Log A2 before set 03?', next: 'Lat Pulldown 03' }`; `applySetTypeChange({ row, pick, loggedStages })` → `{ headPatch, stagesToAdd, stagesToDelete, needsConfirm }` (Normal with logged drops → `needsConfirm`; a warmup can't be staged; a new dropset under a logged head → one pending drop that becomes current unless an earlier set is unlogged); `deleteEffects(group, siblings)` → the delete order (stages descending, then the head) and the renumbering of later heads **and their stages** (fixing F4's stale stage numbers in the same rule); `canUnlog(group)` → false with a logged stage after the head (UNLOG disabled "until they are"); `finishWarning(plan, logs, changes)` → the unlogged planned sets by exercise and number ("2 planned sets aren't logged yet: EZ Bar Curl 01 and 02."), excluding deleted and skipped; `addRound(block)` → one set per member (Defaults 9).
**Depends on:** 36 (the change shape).
**Migration:** none.
**Verification:** tests with break proofs: the current set zigzags (A1 logged → B1 current, break: A2 → fails); with the lock off every tap is `'log'`; with it on, LOG on B2 while B1 is current asks with the right names; Normal with two logged drops asks first; Dropset on a logged head adds exactly one pending drop; `deleteEffects` on head 02 of 04 renumbers 03→02 and 04→03 including their stages (break: heads only → fails); `canUnlog` false with a logged drop; `finishWarning` lists unlogged planned sets only, not deleted ones; `addRound` on a 3/2 superset adds one to each.
**Would not catch:** the screens (58–64).
**Done when:** on master with tests.

### Chunk 47 — Migration 043: `v2_apply_ops`, the atomic op executor
**Goal:** A save that touches many rows lands or fails as a whole: one RPC applies a client-computed op list in one transaction, scoped to the caller, on a fixed list of tables.
**SPEC:** Programs and runs [1.2] ("SAVE CHANGES writes everything at once"); Review (actions write "at once"); Data model above (why an executor).
**Scope:**
- `supabase/migrations/043_p12_apply_ops.sql`: `create or replace function v2_apply_ops(p_ops jsonb) returns integer language plpgsql security invoker`: `auth.uid()` required; `p_ops` is an array of `{ "op": "insert" | "update" | "delete", "table": "<name>", "row": {...} | "id": "<uuid>", "patch": {...} }`; the table must be one of `v2_program_exercises, v2_program_sets, v2_program_superset_blocks, v2_workout_warmup_items, v2_workout_days, v2_programs, v2_run_schedules, v2_week_plan_exercises, v2_week_plan_sets, v2_week_review_decisions, v2_session_set_changes` (else `raise exception 'table not allowed'`); insert: `jsonb_populate_record` with `user_id` overwritten by `auth.uid()` (and, for `v2_programs`/`v2_workout_days`, only an update is allowed — no inserts of those); update/delete: `where id = … and user_id = auth.uid()` (pg-safeupdate satisfied), `if not found then raise exception 'row not found: <table>/<id>'`; returns the op count. Executes in order so an insert can be followed by rows that reference it (client-generated ids). Grant execute to `authenticated`; `notify pgrst`.
- `src/features/programs/applyOps.ts`: the `Op` type (shared with 45), `applyOps(ops)` → `supabase.rpc('v2_apply_ops', { p_ops })`, `networkMode: 'always'` in its hook, the real error `message` surfaced.
**Depends on:** 36 (the tables), 45 (the op type).
**Migration:** 043. **Not destructive:** creates a function. **Rollback:** `drop function v2_apply_ops(jsonb)` in a later migration. `check-migration` flags "function"; D29 lets the reviewer merge once `migration-replay`, `check-embeds-local.sh` and the scratch check pass.
**Verification:**
- Scratch (as a fixture user): a list of 12 ops across six tables applies (count returned, rows present); a list whose fifth op names another user's row raises and **nothing** from ops 1–4 persists (count the rows before and after — the atomicity proof, Checks that lied #22: confirm the error text first); a table outside the list raises; an insert with a foreign `user_id` lands with the caller's; an update of a `v2_programs` row the caller doesn't own matches zero rows and raises (RLS plus the explicit scope); a delete of a `v2_week_plan_sets` head cascades its stages by FK as today.
- The client: a Vitest test that the hook passes the array through unchanged and rethrows the server message.
- After the deploy: Adam's smoke, if he wants one, is chunk 51's save (nothing calls the function before 51).
**Would not catch:** op lists that are *wrong* (45's tests), and PostgREST's RPC envelope (the first real call, chunk 51, and `check-embeds` doesn't cover RPCs — note it in 51's live check).
**Done when:** 043 live (deploy runs read, `probe` of the function via a `limit=0`-style call isn't possible for RPCs — the reviewer calls it with `[]` from the dry-run technique or Adam does, expecting `0`), `applyOps.ts` on master, uncalled by any screen.
### Chunk 48 — Deload rules live in Settings only; the RIR rule on a range
**Goal:** Deload rules are read from Settings and nowhere else; the per-program override control is gone; a run that stored an override falls back to Settings silently; the RIR rule shifts both ends of a range with a floor of 0.
**SPEC:** Objects stored → Program [1.2] ("The stored deload-rules override is no longer read or written (16b). The column stays"); Deload [1.2] ("Settings only; programs have no override"; "RIR rule: a range shifts both ends, floor 0"; Plan shows them read-only in WEEK ⋯ "Deload rules (from Settings)"); Stepped program planner [1.2] ("No deload-rules control"); Removals.
**Scope:**
- `src/lib/deloadRules.ts`: `resolveEffectiveDeloadRules(programRules, userRules)` becomes `resolveEffectiveDeloadRules(userRules)` (the program argument removed, every caller updated — `PlanPage.tsx:299` today); the RIR rule applies to `targetRir` and `targetRirMax` (both shifted, floored at 0; a range whose ends meet becomes a number: `targetRirMax = null`); `calculateDeloadSets` and the restore snapshot carry `target_rir_max` (chunk 36's column).
- `src/features/planner/StepVolume.tsx`: `ProgramDeloadRulesSection` (`:124-189`) removed; `useUpdateProgramDeloadRules` / `updateProgramDeloadRules` removed (no writer remains; the column stays).
- `src/features/plan/deloadRulesLine.ts`: owner is always Settings — "Deload rules (from Settings): sets −50% (rounded down) · RIR +2" (board 1e's wording); nothing when no rule is on (standing UI rule).
- `programService.ts:113` keeps mapping `deload_rules` into `Program.deloadRules` as a read-only field? No: the field leaves the `Program` type and the mapper (no reader left); the column is simply not selected. `scripts/probe-specs` unchanged.
**Depends on:** 36.
**Migration:** none (SPEC: no destructive migration; the column stays).
**Verification:**
- Pure: a run whose program carries a non-empty override and a user with different Settings rules → the Settings rules apply (break: prefer the program's → fails); RIR 1–2 with `rir: +2` → 3–4; RIR 0–1 with a negative shift → 0 (floor), ends meeting → a number.
- Screen: the planner's step 3 renders no DELOAD RULES section, no USE MY DEFAULT / CUSTOM (absence asserted); Plan's deload line reads "from Settings" and never "this run's" (absence).
- Wired: `markSessionDeload`'s callers (`useSetDeload`, `useSetWeekDeload`) receive the Settings rules — a screen test marks a session on a run with a stored override and asserts the inserted calculated sets follow Settings.
- F5's live query (Adam) says which real runs change rules when next marked; not a gate.
**Would not catch:** a run marked deload *before* this chunk whose calculated sets were produced by its override — they stay as written (unmarking restores from `deload_restore`, unchanged).
**Done when:** live; the planner has no deload control; Plan's line says "from Settings"; a deload marked on any run uses Settings.

### Chunk 49 — Settings: "Drops and stages count as" and "Log sets in order"; "New week starts" removed
**Goal:** Settings shows the two new rows with their defaults, writes the two 042 columns, and no longer shows or writes the week-start choice.
**SPEC:** Settings [existing, extended] [1.2]; Screens → Settings [1.2] ("Keeps its current look. Adds two rows … Removes 'New week starts'; users who had it on 'empty' get auto-copy, with no message").
**Scope:** `settingsService.ts` (`stage_volume_rule`, `log_in_order` read with the absent-until-applied convention and written by the full-row upsert; `week_start` no longer written — the upsert omits the key so the stored value stays and nothing reads it after chunk 53); `settingsStore.ts` defaults (`'half'`, `true`); `useSettings.ts`; `SettingsPage.tsx`: in PLANNING, "DROPS AND STAGES COUNT AS" with chips WHOLE SET = 1 / EACH DROP = 1 / EACH DROP = ½; in WORKOUT (next to the rest timer rows), "LOG SETS IN ORDER" as a toggle with the one-line explanation "Off: LOG never asks."; NEW WEEK STARTS removed. Today's look kept (chip rows and toggles as the page already draws them — no board for Settings).
**Depends on:** 36 (live).
**Migration:** none.
**Verification:** screen tests: both rows render with the stored value; changing one calls `upsertSettings` with the new column and the full row; the upsert payload has no `week_start` key (absence; break: send it → fails); NEW WEEK STARTS absent; 375 px no overflow (the chip row with "EACH DROP = ½" is the widest). A `settingsService` test maps a row without the new keys to the defaults.
**Would not catch:** who reads the values — chunk 55 (volume) and 60 (lock) prove their reads.
**Done when:** live; the rows show and persist; the old row is gone.

### Chunk 50 — The weekday schedule in force per week
**Goal:** Everything that asks "which workout is on which weekday" asks it for a given week, so a weekday change that starts next week (chunk 51) is honoured by Today, the missed-session prompt, moving a session and Plan — and until a run has a schedule change, nothing behaves differently from today.
**SPEC:** Programs and runs [1.2] → Weekdays storage ("verify against Today's scheduler"); Screens → Today [1.2] ("it finds sessions by the weekdays in force that week").
**Scope:** `src/features/plan/useRunSchedule.ts` (reads `v2_run_schedules` for the active run — one small query, cached under `['v2_runSchedules', mesoId]`, invalidated by chunk 51's save); `scheduler.ts` takes `scheduleForWeek: (week) => WeeklySchedule` instead of reading `program.schedule[dow]` at `:76, :143, :215` (the three reads), with `week` from the date's calendar week; `useScheduler.ts`, `TodayPage.tsx`, `MissedSessionPrompt.tsx`, `moveSession.ts` / `MoveSessionSheet.tsx` (the original day of a session is the week's own schedule), `PlanPage.tsx`'s weekday labels for the viewed week and `detectSharedWeekdayWorkouts` for the viewed week; `hasSchedule.ts` unchanged (it reads the run copy's schedule, which chunk 51 keeps current). `runSchedule.ts` from chunk 45 is the resolver.
**Depends on:** 36 (live), 45.
**Migration:** none.
**Verification:**
- `scheduler.ts` tests: with no schedule rows every existing scheduler scenario passes unmodified (the resolver returns the run copy's schedule — proven by running the existing suite with the resolver injected and no rows); with rows `{1: Tue}`, `{3: Wed}`: in week 2 Tuesday is due and Wednesday is not; in week 3 Wednesday is due and Tuesday is not (break: resolve with `<` instead of `≤`, or ignore rows → fails); the missed-session prompt in week 2 lists a missed Tuesday, never a Wednesday; a session moved in week 3 offers week 3's days.
- Fixture dates derived from weekdays and the queue printed (Checks that lied #21); the G14 shared-workout fixture (CONTEXT: "any chunk that assumes one weekday per workout must handle this case") included.
- Plan: the week chips show week 3's days on week 3 and week 2's on week 2 (screen test).
- No row for any real run yet, so Adam's live check is "Today unchanged".
**Would not catch:** the writing of schedule rows (51).
**Done when:** live, Today and Plan unchanged for every existing run, the resolver wired at every former `program.schedule[dow]` read (a grep in the test: no `schedule[` outside the resolver).

### Chunk 51 — CHANGE THE PROGRAM
**Goal:** One screen edits the running program's copy — exercises, order, supersets, the warmup routine, rest/tempo/unit, workout names, weekdays and (stable) the default's sets — and SAVE CHANGES lands it on every not-done session from the current week on, atomically, with CANCEL leaving nothing behind.
**SPEC:** Programs and runs [1.2] → "Changing a running program: CHANGE THE PROGRAM" (all); Supersets [1.2]; Rest/Tempo/Warmup routine [1.2] (edited here); Set types [1.2] (the picker in CHANGE THE PROGRAM: type, REMOVE THIS SET); Rest [1.2] (REST AFTER column; REST BETWEEN in the picker here); Screens → CHANGE THE PROGRAM; Defaults 1, 2, 3, 5; Errors.
**Boards:** PL1 (week-dependent), PL1b (stable), PL2 (exercise ⋯), PL3 (superset member ⋯ — plus the member's own REST / REST AFTER rows, SPEC's known gap), PL7, PL8, PL9; the picker boards PL4, PL5, PL6 through chunk 41's sheet.
**Scope:**
- Route `/plan/change` (`App.tsx`), `src/features/programs/ChangeProgramPage.tsx` and its cards (Files). Opened from Plan's bottom button (today's `PlanPage` gets the button "CHANGE THE PROGRAM FROM WEEK N" / "FROM CYCLE N" at the bottom of the week panel in this chunk — the only Plan change here) and, from chunk 65, from EDIT PROGRAM.
- The screen loads the run copy and every week plan from the current week on (with each session's status through `useDoneWeekPlanIds` and the in-progress session), edits a **local draft** (nothing written until SAVE), and on SAVE calls `planProgramChange` (45) → `applyOps` (47) in one request; then invalidates programs, week plans, run schedules; pending state on the button ("SAVING…"), the real error message under the headline on failure (Errors), CANCEL → back with a confirm only when the draft differs.
- Rule box text from chunk 45 (week-dependent / stable variants, the done-session sentence, "Your saved program, [name], doesn't change."); WORKOUTS chips; the DAYS card (weekday runs only; toggles with the refused-day reason; RENAME); WARMUP ROUTINE card (add, edit in place, ⋯ MOVE UP/DOWN/REMOVE with PL8's confirm); EXERCISES with drag-to-reorder (pointer events) and the ⋯ fallback MOVE UP/DOWN; exercise card: name, muscle, REST/TEMPO chips where set, SWAP / SUPERSET / REMOVE (PL7's confirm), ⋯ → PL2 sheet (REST, REST AFTER, TEMPO with `normaliseTempo` and PL9's invalid state, UNIT DEFAULT/KG/LBS); superset card: header with "Rest 1:30 after each round" and UNLINK, members with letters, each with ⋯ (PL3: TEMPO, UNIT, WITHIN ROUND, AFTER ROUND, plus REST and REST AFTER), SWAP, REMOVE, and the link toggle between members (Defaults 5); removed exercises shown struck through with UNDO; "+ ADD EXERCISE" (41's sheet in add mode); stable: the default's set rows (ALL → rep picker for all; set number → set type picker `change-program` context; rep box → rep picker; REST AFTER stepper → `rest_seconds`; "+ SET"; A1/B1 labels in supersets); week-dependent: no set rows, an added exercise's card says "New. It lands in week N with no sets; add them in Plan."; CHANGED IN THIS EDIT legend; "Changes start in week N. Swap, superset and remove are on the exercise card." line in PL2.
- Removes from the running program's editing surface: nothing yet (the week's Structure view goes in chunk 54; MAKE DEFAULT goes there too).
**Depends on:** 38, 39, 41, 45, 47 (live), 50.
**Migration:** none.
**Verification:**
- Screen tests (jsdom, `applyOps` mocked): SAVE sends exactly the op list `planProgramChange` returns for the draft (one test per edit kind: add, swap, remove, reorder, rest, tempo, unit, superset link/unlink, routine item, rename, weekdays, stable set count / kind / rep target / REST AFTER); CANCEL sends nothing; a failed save shows the server `message` under "Couldn't save the changes." and keeps the draft; a weekday another workout uses is disabled with "Thu is Push 2's day"; the last remaining day can't be turned off; a sequence run shows no DAYS card; week N in the rule box follows the first not-done session (a fixture where this week is all done → next week); the set type picker here shows REMOVE THIS SET and REST BETWEEN and no rest row (variant proof); the REST AFTER stepper writes `rest_seconds` on the default's set.
- **Scratch, end to end:** the fixture run of F1-b (stable) with week 2 (Monday done, Tuesday in progress, Thursday planned) and week 3 planned forward: the op list for "swap Lat Pulldown → Machine Pulldown, remove Face Pull, add Cable Curl at the end, set 2 rep target 10–12, Tuesday → Wednesday" applied through `v2_apply_ops` on the scratch copy; then: Monday's rows unchanged (md5 of its sets before/after equal); Tuesday's unchanged; Thursday and week 3 hold the swap with cleared weights, no Face Pull, Cable Curl last with the default's sets, set 2 at 10–12 where it matched; `v2_run_schedules` has `from_week 1` (Tuesday) and `from_week 3` (Wednesday); the run copy's `schedule` says Wednesday; the saved program (`kind = 'saved'`) is byte-identical (fingerprint). Executed, printed, not read.
- Screenshots: PL1, PL1b, PL2, PL3, PL7, PL8, PL9 at 390 px vs their boards (elements, order, wording). PL1 is tall; the full-page PNG is compared section by section.
- Drag: a jsdom pointer-event test moves an exercise and a superset block; the ⋯ MOVE UP/DOWN path covered too (Adam's live check for real touch).
- Live app after it: Plan gains the bottom button; the old Structure view still edits the run copy row by row (both write the same rows, as the program tab and Structure coexisted in 1.1).
**Would not catch:** the look of drag on a phone (live); the RPC envelope (first real call: Adam's first save, with the dry-run `applyOps([])` → `0` check done first).
**Done when:** live; Adam saves a change on the real run and the next not-done session shows it in Plan while the done one doesn't; the saved program is untouched (Programs → OPEN shows the old content).

### Chunk 52 — Plan's header: tiles, PLAN FORWARD, COPY, WEEK ⋯, and when a week gets planned
**Goal:** Plan opens on the current week with a tile per week up to the first unplanned one; opening a week never plans it; PLAN FORWARD plans the next week; COPY copies last week's numbers into chosen workouts; WEEK ⋯ holds the week deload and the rules line; loading and errors follow board 12 and the Errors rule.
**SPEC:** Weeks and copying [1.2] (when a week gets planned; how far ahead; COPY (2c); Defaults 7); Deload [1.2] ("week deload in WEEK ⋯ (C2)"; the rules line); Scheduling → Sequence (PLAN FORWARD per cycle); Screens → Plan screen (Header, Week row, Under the header, Loading and errors, Empty states); Design boards → Errors (15).
**Boards:** 1 (the header and action row), 1b, 1d (CYCLE tiles, SLOT chips stay as today until 54), 1e, 2, 12 (Plan's three states).
**Scope:**
- `PlanPage.tsx`: the planning effect at `:343-349` is replaced by one that plans **only the current week** (calendar week on a weekday run; the current cycle on a sequence run, from `useSequenceCurrentCycle`) when it has no rows; browsing never plans. `useSetWeekDeload` stops calling `planWeek` (the week is planned by definition when its WEEK ⋯ exists). The prev/next arrows, the header's Programs icon (`:588-594`) and PRIORITIES button go; the header becomes "PLAN | PROGRAMS" tabs (PROGRAMS renders today's `ProgramsPage` content inside the shell until chunk 65 rebuilds it) and "[PROGRAM] · CURRENT PROGRAM"; `WeekTiles.tsx` from `weekTiles()` (42): DONE / THIS WEEK / PLANNED / NOT PLANNED with the lock, horizontally scrolling, opened scrolled to the current tile (P1.2-6).
- `PlanForwardCard.tsx` (board 1b): "Week 3 isn't planned yet", the explanation, PLAN FORWARD → `usePlanForward` → `planWeek(meso, N+1)` (the RPC, 041's body until 053), then refetch; the note "Takes week 2's sets and set types. Numbers come with COPY. Week 4 opens once week 3 is planned." (stable: "the default's sets, set types and rep targets"); "WEEK 3 WILL HAVE" lists the workouts by the schedule in force for that week (50); pending and error states.
- `CopySheet.tsx` (board 2): eyebrow "WEEK 2 · FROM WEEK 1'S PLAN", title "Copy last week's numbers", WEIGHT / REPS / RIR chips all ticked, INTO list with done workouts locked ("DONE"), "Overwrite what's already there" off with "Off: only empty boxes get filled.", "COPY INTO N WORKOUTS" → `copyNumbers()` (42) → `applyOps` (one request); hidden on week 1 (P1.2-1); replaces COPY WEEK / COPY LAST CYCLE and COPY THIS WORKOUT (`:631-642`, `:1412-1423`), whose hooks and services go (`useCopyFromPreviousWeek`, `useCopyWorkoutFromPreviousWeek`, `copyFromPreviousWeek`, `copyWorkoutFromPreviousWeek`, `copyOnePlanForward`, `copyExercisesForward`, `copySetsWithGrouping` and their tests; F1's `is_warmup` bug goes with them).
- `WeekMenuSheet.tsx` (board 1e): "[PROGRAM] / Week N", MARK WEEK AS DELOAD / UNMARK THIS WEEK with the DELOAD chip, "Deload rules (from Settings): …" (48; nothing when none on), "Already started — sets left as they are" when a session has started, MARKING… pending; CYCLE wording on sequence runs; the old MARK WEEK AS DELOAD button above the panel goes.
- Board 12: the spinner while the programs read is out (DECISIONS 94 kept), "COULDN'T LOAD PLAN" with the real `message` (Errors; never the fixed "Check your connection" unless offline), the week's own spinner under the tiles.
- Past weeks: no action row, no CHANGE THE PROGRAM button (board 1c), as SPEC says — the lock line "PAST WEEK · READ ONLY".
**Depends on:** 36, 38, 42, 47 (live), 48, 50, 51.
**Migration:** none.
**Verification:**
- Screen tests: opening Plan on a run with weeks 1–2 planned, current week 2: `planWeek` is **not** called (absence; break: restore the effect → fails); with the current week unplanned it is called once with the current week only; tapping WEEK 3 (NOT PLANNED) shows the card and never calls `planWeek` until PLAN FORWARD; after PLAN FORWARD the tiles show week 4 as NOT PLANNED; no tile beyond; a sequence run plans the current cycle only and PLAN FORWARD plans the next cycle; the COPY sheet sends the ops `copyNumbers` returns for the ticked fields and workouts (break: include a done workout → fails); overwrite off leaves typed numbers (asserted on the op list); COPY absent on week 1; WEEK ⋯ marks the week through `useSetWeekDeload` without planning (absence of `planWeek` in the call); the rules line text; the error state shows the server message verbatim.
- The existing tests `PlanPage.copyButtons`, `copyWeek.storedCarry` become absence tests (COPY WEEK gone); `PlanPage.sequenceCycle` updated for the tiles.
- Screenshots: 1 (header region), 1b, 1d (header), 1e (each state), 2, 12 (each state).
- Live app after it: existing runs show their planned weeks as tiles; nothing is planned by browsing any more; PLAN FORWARD still copies numbers (041's body) until chunk 53 — stated to Adam.
**Would not catch:** the number-copy content (53).
**Done when:** live; Adam opens Plan: tiles, no arrows; week N+1 reachable only through PLAN FORWARD; COPY fills empty boxes from last week; MARK WEEK AS DELOAD is in WEEK ⋯.

### Chunk 53 — Migration 044: `v2_plan_week` with the 1.2 copy rules
**Goal:** A week planned by week start or PLAN FORWARD takes structure, volume and set types (stable: the default's rep targets too) and never weights, RIR, week-dependent reps, tags or the deload flag; the week-start setting is ignored.
**SPEC:** Weeks and copying [1.2] → "What the auto-copy takes (2b)" and its sub-bullets; Objects stored → Settings ("The 'new week starts' setting is removed").
**Scope:** `supabase/migrations/044_p12_plan_week_copy_rules.sql`: `create or replace function v2_plan_week`, 041's body with: the `week_start` read and branch removed (`'empty'` only when no usable source exists); the `'program'` branch unchanged for structure and rep targets, **its weight/RIR mapping (041:434-477) removed**; the `'week'` branch copying `is_warmup, stage_kind, parent (remapped), stage_index, program_set_id, is_dropset, set_number` and **null** `target_weight`, `target_rir`, `target_rir_max`, `rep_min`, `rep_max`, `is_amrap = false`, `tags`; `is_deload` false as before; the same grant and `notify`; every temp-table clear keeps `where true` (041, pg-safeupdate). `weekSources.ts`'s `WeekStartSetting` goes.
**Depends on:** 42, 52 (live — COPY exists before numbers stop arriving).
**Migration:** 044. **Not destructive:** replaces a function; no row changes; weeks already planned keep everything they hold. **Rollback:** `create or replace` with 041's body verbatim (in git). `check-migration` flags "function" → D29, reviewer's merge after `migration-replay`, `check-embeds-local.sh` and the scratch count/fingerprint check.
**Verification:**
- Scratch, executed (Checks that lied #28): fixtures F1-a and F1-b re-run on 044: week 2 (week-dependent) has the structure of week 1 (warmup, working set, dropset head + AMRAP drop; Face Pull ×2 including week 1's added set), `target_weight`/`target_rir` null everywhere, `rep_min/rep_max` null and `is_amrap` false on every set (the drop's AMRAP comes with COPY's REPS), no tags; week 2 (stable) has the default's sets and rep targets, no weights/RIR; a user whose `week_start` is `'empty'` gets a copied week (break: 041's body → the three number columns are filled → the test's diff is non-empty).
- `autoCopy()` (42) applied to the same fixtures equals the SQL output row for row (printed side by side).
- Idempotency: a second call creates 0 rows; a slot already planned is untouched (md5 equal).
- After the deploy: Adam plans forward one week on the real run and sees empty number boxes with the structure intact; COPY fills them.
**Would not catch:** a client that still expects weights after planning — none after 52 (the COPY sheet is the only number path).
**Done when:** 044 live; a week planned by PLAN FORWARD on the real run has structure and no numbers.

### Chunk 54 — Plan's week view: sessions, exercises and set rows
**Goal:** The week shows plans the way board 1 draws them — session chips with their states, per session a ⋯ with deload and move, exercise cards with no ⋯, set rows whose reps and RIR open the pickers and whose ⋯ opens the set type picker, "+ ADD SET", stable weeks' THIS WEEK ONLY / CHANGE EVERY WEEK →, the changes-since legend and marks, done sessions and past weeks read-only — and nothing else: the Sets/Structure views, exercise-level actions, MAKE DEFAULT, the apply-ahead banner and ADD WARMUP SETS are gone.
**SPEC:** Screens → Plan screen (Each session, Each exercise, Stable weeks, Sequence runs, Bottom, Locked); Weeks and copying [1.2] (Stable weeks; Week-dependent weeks; Exercises only in CHANGE THE PROGRAM (7b); Done sessions locked; Workouts that share one plan; Changes since the source); Targets [1.2] (pickers everywhere; RIR range; AMRAP RIR 0 default kept); Tags/cues [1.2]; Rest [1.2] (the picker's rest row, week-dependent only); Warmup sets [1.2] (made with the picker); Deload [1.2] (session deload in the session's ⋯); Scheduling (MOVE THIS SESSION in the session's ⋯, current week); Defaults 8; Removals.
**Boards:** 1, 1a, 1c, 1d, 9, 10, 11.
**Scope:**
- `WeekView.tsx`, `SessionCard.tsx`, `PlanExerciseCard.tsx`, `PlanSetRow.tsx`, `SessionMenuSheet.tsx` (Files) replace `WorkoutDayPanel`, `ExerciseSection`, `PlanSetGroup`, `StructureSetGroup`, `StructureSetRow`, `SetMarkers`, `SetRow`, `RepTargetEditor`, `WeightTargetEditor`, `TagsEditor`, `RirStepper`, `SegmentBar` in `PlanPage.tsx`, and `WorkoutSwitcher`, `SequenceSlotSwitcher` (the chips are redrawn to boards 1/1d: `MON ✓ PUSH 1`, `SLOT 1 ✓ UPPER A`, `REST DAY`), `StructureFields`, `WeekDiffMarks`, `WeekDiffGate`, `WeekExercisePickerSheet`, `planMenu`, `MakeWeekDefault` (+ its hooks/services), `ApplyAheadOffer` (+ `useApplyAhead`, `applyAhead.ts`, `repointWeekExercise`), `createWeekPlan` (a week is always planned before it is shown now), the week-level `useSwapWeekExercise` / `useAddWeekExercise` / `useRemoveWeekExercise` / `useReorderWeekExercises` and their services, `useAddWarmupSet`, `useAddStage` (stages come from the picker through `useUpdateSet`) — with their tests.
- Set row: number (`01`, `W` for warmups, `↳` for stages), weight typed in the exercise's unit (`WeightTargetEditor`'s behaviour kept: kg stored, blank clears, "Enter a valid weight"), `×`, reps → `RepTargetPicker` ("Use for all" → every set of the exercise), RIR → `RirTargetPicker` (writes `target_rir` + `target_rir_max`; AMRAP's RIR 0 default kept), the kind chip above a staged head ("DROPSET · 1 DROP"), cues as a chip under the row, ⋯ → `SetTypePicker` (`plan-week-dependent` / `plan-stable` context, `canEditRest` by G45's own-program-set rule; its Cues row → `CuesSheet`; REMOVE THIS SET → `removeSet` with the stage cascade); stage rows have no ⋯; no RIR cell on a warmup row (stops at **G49** if Adam wants the board's cell).
- "+ ADD SET" → `addSetDefaults` (42) → `addSet`.
- Exercise card: name, muscle, SUPERSET A · 1 chip; no ⋯ (absence; break: render one → fails).
- Stable weeks: `thisWeekOnly()` per exercise → the line and "CHANGE EVERY WEEK →" (navigates to `/plan/change#<exerciseId>`, chunk 51 scrolls to it); legend per **G48** (SPEC's "CHANGED SINCE WEEK N" until Adam says otherwise); marks from `changesSinceSource()` (42) using the existing mark styles (`CHANGED_CELL`, removed lines) — `weekDiff.ts` replaced.
- Session chips and header: day · name · DONE/SKIPPED/DELOAD/moved states (board 10's wording: "✓ DONE", "SKIPPED", the DELOAD chip, "MOVED → THU"), "Shared with Thu — changes apply to both" (G14; P1.2-7), the session ⋯ (`SessionMenuSheet`: MARK THIS SESSION AS DELOAD / UNMARK THIS SESSION with "Already started — sets left as they are", MOVE THIS SESSION → the existing `MoveSessionSheet` for the current week on weekday runs, "Requires a connection" offline, no move on a later week or a sequence slot); "No exercises in this day"; "No workouts scheduled / PROGRAMS →".
- Done sessions (board 11) and past weeks (1c): every control read-only, "✓ DONE" on the session; `useDoneWeekPlanIds` kept (#77's lock, the shared-row rule 112 kept).
- Deload sessions: no change marks ("DELOAD SESSION · NO CHANGE MARKS" is the legend's state on board 9).
- Keeps: `PlanTargetsPanel` unaffected (workout screen); `useUpdateSet` (`applyAmrapRirDefault`), `useAddSet`, `useRemoveSet`, `useSetDeload`, `useSetWeekDeload`, `useMoveSession`.
**Depends on:** 39, 40, 48, 51 (live), 52 (live), 53 (live).
**Migration:** none.
**Verification:**
- Screen tests (`fakeWeekPlanDb.testutil.ts` kept as the fake): reps tap opens the rep picker and SET 8–10 REPS calls `useUpdateSet` with `repMin 8, repMax 10` for that set, and for every head of the exercise with "Use for all"; the RIR picker's RANGE writes `targetRir 1, targetRirMax 2`; the ⋯ → Dropset writes `stageKind 'dropset'` and adds one stage (through the same service calls `useAddStage` made — pinned by the existing `PlanPage.stageKind` expectations moved here); Warmup on a staged head removes the stages first; REMOVE THIS SET cascades stages then the head; + ADD SET adds a Normal set with the previous set's rep target and null weight/RIR (break: copy the weight → fails); the exercise card has no ⋯ and the page has no SWAP / MOVE / REMOVE / ADD EXERCISE / ADD WARMUP SETS / ADD STAGE / MAKE THIS WEEK / APPLY strings (absence, Checks that lied #32); a stable week with a stage added shows THIS WEEK ONLY on that exercise and the link; a weight change alone doesn't; a done session's row is read-only (`SESSION DONE`); a past week has no action row and no bottom button; a sequence run shows SLOT chips and CYCLE wording; the rest row appears in the picker only on a week-dependent run and only for a set with an own program set (G45; break: show it for an added set → fails).
- Every existing `PlanPage.*` screen test is either moved to the new components with only its "open the view" steps removed, or becomes an absence test; the reviewer reads the test diff for changed expectations (the TASKS-1.1 chunk 29 rule).
- Render parity fixture `planpage-chunk6-render.html` is retired with its test (the screen is rebuilt by SPEC); the behaviour tests above replace it.
- Screenshots: 1, 1a, 1c, 1d, 9 (each state), 10 (each state), 11 at 390 px vs boards; the 375 px overflow check.
- Live app after it: the same data, shown the new way; every set edit works; exercise-level changes only in CHANGE THE PROGRAM.
**Would not catch:** the pickers' internals (39); the week header (52).
**Done when:** live; Adam plans a week end to end on the phone (reps, RIR range, a dropset from the picker, a cue, ADD SET, deload from the session ⋯, MOVE) and nothing from the removed list is reachable.
**Stops at:** G48 (legend text) and G49 (warmup RIR cell) — both one-line changes once answered; the rest of the chunk doesn't wait.

### Chunk 55 — VOLUME
**Goal:** The VOLUME button opens board 3: every muscle as last week → this week with the deltas and the "YOU PLANNED … DID …" notes, counted by the Settings rule.
**SPEC:** Volume per muscle [1.2] (14); Screens → Plan screen (Under the header).
**Boards:** 3.
**Scope:** `VolumeSheet.tsx` on `BottomSheet`, fed by `volumeRows()` (44) over data the page already has (this week's and last week's plans from `useAllWeekPlans`) plus last week's sessions and logs (one paged read by `week_plan_id` through `v2_sessions(*, v2_set_logs(*))` — a single-FK embed each way, checked by `check-embeds` in CI) and the run's exercises' muscle groups; the VOLUME button in the action row (hidden on week 1, P1.2-1; P1.2-2 for an empty last week); footer "Week 1 counts the sets you actually did. Warmups don't count. A drop counts as ½ set — you can change that in Settings." with the rule's own fraction ("as 1 set" / "as ½ set" / "doesn't count"). Nothing on the week itself (SPEC).
**Depends on:** 44, 49, 52.
**Migration:** none.
**Verification:** screen tests with the fake data: rows in muscle order with deltas and notes from a fixture where last week's Tuesday was done with an added set and a skipped set and Thursday not done; the rule from Settings changes the drop's count (break: ignore the setting → fails); the sheet reads the embed through a mocked query whose shape matches the real one; screenshot vs board 3; the VOLUME button absent on week 1.
**Would not catch:** the views and Progress (G51 — unchanged until answered).
**Done when:** live; the sheet's numbers match a hand count on Adam's current week.

### Chunk 56 — REVIEW
**Goal:** When last week went differently from its plan, one line under the action row opens board 4; each item has USE / ADD THIS SET / REMOVE THIS SET / SWAP FROM WEEK N / ADD EXERCISE and IGNORE; a decided item disappears and never returns; nothing is drawn on the set rows.
**SPEC:** Review [1.2] (13, all bullets), Defaults 4 and 10.
**Boards:** 4.
**Scope:** `ReviewLine.tsx` ("LAST WEEK · N things went differently · REVIEW →"; P1.2-3), `ReviewSheet.tsx` (eyebrow "LAST WEEK · N THINGS", title "What went differently", the explanation line, items grouped under "TUE · PULL 1" headers with the board's item wording from 43's helpers, IGNORE and the action button, pending/error per item), `useReview.ts` (last week's done sessions with logs, swaps and `v2_session_set_changes`, this week's plan, `v2_week_review_decisions` for this week's rows — paged reads), `reviewService.ts` (each action = `applyReviewAction` (43) → `applyOps` (47): the week-set writes plus the decision row in one request; ADD EXERCISE / SWAP FROM WEEK N go through `planProgramChange` (45) so they land as CHANGE THE PROGRAM changes). The line appears on the current week and a week planned ahead; never on week 1; hidden while nothing is left to decide.
**Depends on:** 36 (live), 43, 45, 47 (live), 51, 52, 54.
**Migration:** none.
**Verification:** screen tests: with last week's Tuesday done differently in two sets and Thursday swapped, the line says "3 things"; USE sends the update op for this week's matching set plus the decision row (break: omit the decision → fails); IGNORE sends only the decision; after a decision the item is gone on re-render and the line counts 2; with every item decided the line is absent; SWAP FROM WEEK N sends the `planProgramChange` ops (asserted equal to 45's output for that input); week 1 shows nothing; a last week still in progress lists only its done sessions' items. Scratch: the decision table's unique key rejects a second decision for the same item (`23505`), and `applyOps` writes a decision row with the caller's `user_id`. Screenshot vs board 4.
**Would not catch:** the structural rules' edge cases beyond 43's fixtures.
**Done when:** live; after a session that deviates, Plan on the next week shows the line, and USE writes the number Adam sees in the workout.

### Chunk 57 — The sync queue executes delete items
**Goal:** A queued `delete` item deletes its row on replay, with the same same-record ordering as upserts, so delete and unlog can work offline like logging does.
**SPEC:** silent — **spec gap G47**; built only if its answer is (a) or (c).
**Scope:** `useSyncQueue.ts:132-142`: `operation === 'delete'` → `supabase.from(item.table).delete().eq('id', payload.id)`; `dependencyKeys` holds a delete behind earlier writes to the same record and its children (a head's stage logs delete before the head, as the client cascade orders them); `hasQueuedWritesFor` counts deletes; a delete of a row that was never sent (still a queued upsert) cancels both locally instead of sending either; `gaveUp` / `SyncFailedNotice` unchanged; Dexie `set_logs` row removed on enqueue. No producer yet (61 and 63 produce).
**Depends on:** G47 answered.
**Migration:** none.
**Verification:** `useSyncQueue.order.test.ts` extended: an upsert then a delete of the same id replays in order and ends with the row absent (fake supabase); a delete whose upsert never left the device sends nothing and leaves the queue empty (break: send the delete → fails); a failed delete holds back later writes to the record and is retried; `hasQueuedWritesFor` true with a pending delete.
**Would not catch:** the server's cascade of a head's stages when only the head's delete is queued — the producers queue stages first (61).
**Done when:** live, no behaviour change (no producer), tests green.
### Chunk 58 — The workout screen: rows, the rest bar, the header and "last time"
**Goal:** The workout screen is rebuilt to boards W1–W4, W6, W16 and W17: logged rows compact with a tick and a pen, the current row with every field and LOG, upcoming rows with targets only; the reps box shows the plan's target, planned RIR a dim placeholder (ranges as "1–2"); each exercise shows last week's numbers (and earlier this week's); the rest timer is the pinned bar with the jump-to-set button; no inline timer; the header counts sets — while a plain session logs the same row, times the same rest and finishes the same way as today.
**SPEC:** Logging mechanics [1.2] (Row states; What a row shows (C3, C4); Rest timer (C5); Current set; Stage rows (C8)); "Last time" reference [P1] (unchanged rules); Workout screen [1.2] boards; Planned staged sets render (fix) [P1] (kept); Supersets [1.2] (the block look, + ADD ROUND, Defaults 9); Process notes (D30 superseded).
**Boards:** W1, W2 (JUST LOGGED, MEASURE SET TIME, OTHER STATES — not the edit panel), W3, W3b, W4, W6, W16, W17.
**Scope:**
- `GymSession.tsx`, `ExerciseCard.tsx`, `SetGroup.tsx`, `SetRow.tsx` → `SetRowLogged.tsx` / `SetRowCurrent.tsx` / `SetRowUpcoming.tsx` (one row component per state, `useExerciseCardState.ts` deciding which from `currentSet()` (46)); `SupersetBlock.tsx` (ROUND headers, A1/B1 rows, "+ ADD ROUND" → `addRound()` → one local pending set per member, as today's add-set local state); `RestBar.tsx` replaces the floating `RestTimer` placement and `RestTimerInline` (removed): "REST 1:12 / 2:00" with the bar, "GO" past target, collapse chevron, the "↓ SET 03" / "↑ SET 03" jump button (`useScrollToCurrentSet`), "SESSION COMPLETED AUTOMATICALLY" pill (auto-finish's notice, as today); the header "WEEK 2 · TUESDAY / PULL 1 / IN PROGRESS · 48:12 / 6 OF 15 SETS" (counts: heads and stages planned vs logged, warmups out — `countCompletedSets`); DELOAD and CYCLE · SLOT variants; the offline strip "OFFLINE · SETS WILL SYNC WHEN YOU RECONNECT" (Nav's strip moves into the screen header on this screen only? No — the board draws it under the header; Nav's own strip stays), "SYNC" on a row pending sync, "ONLY ON THIS PHONE · RETRY" (today's failed state), "1 CHANGE COULDN'T SYNC · RETRY" (`SyncFailedNotice`, restyled); `LastTimeSheet.tsx` (W16: LAST WEEK / EARLIER THIS WEEK (weekday only) / FULL HISTORY → `/exercise/:id`, "Deload sessions are left out.") opened from the exercise's history icon and the "LAST = LAST WEEK, TUE ›" line (W17's states: LAST TIME + elapsed, FIRST TIME, the reach-back "LAST TRAINED", "Nothing on record to compare against.", "Skipped every time on record.", OFFLINE · CACHED, COULDN'T LOAD LAST TIME · RETRY — `ExerciseReference`'s existing resolution, `referenceByExercise.ts` unchanged in meaning); "LAST 52.5 × 10 @ 1" under the current row (the reference's set at that position); the MEASURE SET TIME row (START SET / TIMING) kept; warmups as rows or the tick list per the setting (W2b's bottom boards belong here: "WARMUPS AS ROWS", "WARMUPS AS A TICK LIST"); the warmup routine checklist "1 OF 2" with struck-through ticked items; "+ ADD SET", "+ ADD EXERCISE", FINISH SESSION as today.
- Writes unchanged: `useLogSet`, `handleLogHead` / `handleLogStage` / `handleLogWarmup` payloads, `applyRestChain` inputs, skip, the swap/add sheets (59 restyles them), the COACH button and sidebar (Adam only, untouched).
- Removes: `RestTimerInline.tsx`, `PlanTargetsPanel` (the targets are in the rows now), the "▼ MORE" row (its actions move to the ⋯ in 61), `ADD STAGE` / `mark as dropset` **stay until 62** (the picker replaces them there).
**Depends on:** 38, 46.
**Migration:** none.
**Verification:**
- **Behaviour parity (replaces D30):** `GymSession.parity.test.tsx` on the frozen plain-session fixture (one exercise, three sets, one legacy null-kind dropset, no supersets/warmups/tags/tempo/overrides): logging set 1 calls `logSet` with a payload deep-equal to the one master writes (captured in the test from master's code path, kept as a JSON fixture `__fixtures__/plain-session-log-payload.json`), including `stage_kind null`, `is_dropset`, `rest_seconds`; the rest target after set 1 equals master's (`resolveRestTarget` input snapshot); the legacy dropset keeps the global timer (D30's rule, pinned at the hook layer — Checks that lied #30); finishing writes the same session patch. Break proof: change one payload field → fails.
- Row states: with sets 1–2 logged, row 3 is the current row with inputs and LOG, row 4 upcoming with targets only and no inputs (absence); a logged row shows "55 kg × 9 @ RIR 2", a tick and a pen; the reps box shows "8–10" from the plan and the RIR placeholder "1–2" for a range; a planned dropset's drop rows are locked ("AFTER SET 03") until the head is logged, then the first drop is current (C8); the header reads "N OF M SETS" from the fixture; no `RestTimerInline` rendered anywhere (absence); the rest bar shows the target and the jump button; W6's offline strip and the SYNC marker render from the offline store.
- Supersets: ROUND 1/2/3 grouping and "+ ADD ROUND" adds one pending set per member (break: one member → fails).
- Last time: W16's three sections from a fixture; each W17 state from `ExerciseReference`'s existing state machine (the `exercisereference-lastweek-parity.html` fixture is replaced by state assertions; `referenceLogic.ts` exports untouched — `check-frozen-code.mjs`).
- Screenshots: W1, W2, W3, W3b, W4 (each state), W6, W16, W17 (each state) at 390 px vs boards.
**Would not catch:** real rest-timer timing and the pinned bar's behaviour over the nav on a phone (Adam's first session after it); scroll-to-set on a real page.
**Done when:** live; Adam logs a session on the new screen; History shows it like any other; the rest bar runs.

### Chunk 59 — Exercise ⋯, swap for today, add an exercise, picker states
**Goal:** The exercise ⋯ (W10) offers "Swap for today", "Skip the rest of this exercise" (with its inline confirm), "Add a set" (superset members: this member only) and "Exercise history"; swap and add use the shared picker with the real reason on failure; swapped and added cards look like W5.
**SPEC:** Logging mechanics [1.2] (Swap during a workout (C7)); Supersets [1.2] ("a member's ⋯ has 'Add a set' for that member only (W10)"); Workout screen [1.2] (W5, W10, W11, W13–W15; "Swap and add exercise errors show the real reason"); Errors.
**Boards:** W5, W10, W11, W13, W14, W15 (W11, W13, W15 through chunk 41's sheet).
**Scope:** `ExerciseOptionsSheet.tsx` (eyebrow "BACK · 2 OF 3 SETS DONE", the four rows with their sublines, the skip confirm "Set 03 and its drop will be marked skipped." / "SKIP 2 SETS", "Nothing left to skip" state omits the row); swap → `ExercisePickerSheet` (`mode: 'swap'`, "SWAP FOR TODAY", the footer line) → today's `exerciseSwapLogic` + `recordExerciseSwap` + skipping the original's remaining sets (unchanged); add → the sheet in add mode → W14's confirm ("Only today's session changes; the plan stays the same.") → today's local card; `SwapExerciseSheet.tsx` removed; W5's cards: "SWAPPED FROM LAT PULLDOWN", "ADDED TODAY", "LAST = 21 DAYS AGO ›" on the new exercise; errors show the server `message` under "Couldn't swap." / "Couldn't add the exercise."
**Depends on:** 41, 58.
**Migration:** none.
**Verification:** screen tests: the swap sends the same `recordExerciseSwap` payload and skip writes as master for the same fixture (captured, like 58's parity); "Add a set" on a superset member adds to that member only (break: all members → fails); the skip confirm names the right count; a failing swap shows the error text verbatim; `SwapExerciseSheet` no longer imported (absence); screenshots W5, W10 (both states), W14 vs boards.
**Would not catch:** the picker's own states (41).
**Done when:** live; swap and add work through the new sheet.

### Chunk 60 — The log lock and the current set
**Goal:** With "Log sets in order" on, LOG on any row but the current one asks "Log A2 before set 03?" with LOG A2 / CANCEL and the Settings hint; off, every LOG logs; the current set is the first unlogged in session order.
**SPEC:** Logging mechanics [1.2] (Log lock (18a), Current set); Settings [1.2].
**Boards:** W7b.
**Scope:** `LogOrderPrompt.tsx` on `BottomSheet` (eyebrow "SEATED CABLE ROW · A2", title, the line "The next set is **Lat Pulldown 03**. Logging A2 now leaves it for later — it stays open until you log or skip it.", CANCEL / LOG A2, the footer "DON'T WANT THIS QUESTION? TURN OFF 'LOG IN ORDER' IN SETTINGS."); `useExerciseCardState` / `GymSession`: every row's inputs are typable; LOG routes through `lockDecision()` (46) with `logInOrder` from the settings store; confirming logs the tapped row through the unchanged write path; the current row's styling follows `currentSet()`.
**Depends on:** 46, 49, 58.
**Migration:** none.
**Verification:** screen tests: lock on, current = Lat Pulldown 03, LOG on A2 opens the prompt with those names and logs A2 only after LOG A2 (break: log on tap → fails); lock off → no prompt (absence); the current row moves after each log in zigzag order through a superset; the prompt never appears for the current row; screenshot W7b.
**Would not catch:** the setting's persistence (49).
**Done when:** live; Adam sees the prompt on an out-of-order LOG and not with the setting off.

### Chunk 61 — The set ⋯ sheet and the edit panel; delete a set
**Goal:** An unlogged set's ⋯ (W7) holds SET TYPE (chunk 62 wires it), CUES, FORM, the per-set lbs override, SKIP THIS SET and DELETE SET; tapping a logged row's pen opens the edit panel (W2b: the numbers, FORM, SET TYPE row, UNLOG (chunk 63) / DELETE, CANCEL / SAVE); DELETE asks (W9) and removes the set from this session only — logged or not — renumbering the rest and taking a head's stages with it.
**SPEC:** Logging mechanics [1.2] (A logged row shows a pen (18d); Delete set (18b); The set's ⋯ (C9)); Tags/cues [1.2] ("from the set's ⋯ during a workout (W7)"); Removals (the note section stays removed).
**Boards:** W7, W8, W9, W2b (EDITING A LOGGED SET, IN LBS, INVALID WEIGHT, EDITING A WARMUP — minus UNLOG's behaviour).
**Scope:**
- `SetOptionsSheet.tsx` (eyebrow "LAT PULLDOWN · SET 03", rows per board W7; a drop's sheet (W8) has FORM, the lbs row and DELETE only; the lbs row writes `entered_unit` as today's per-set unit does; FORM and SKIP THIS SET are today's actions; CUES → `CuesSheet` writing the planned set's tags as Plan does (the one place the workout writes the plan: tags are plan data by SPEC — "Shown on the set's row during the workout"; the sheet's "Use for all" applies to the exercise's heads)).
- `SetEditPanel.tsx` (the inline edit replaced: weight in the set's unit with "Enter a valid weight." validation, reps, RIR, FORM chips, "SET TYPE Normal ›" row (62), UNLOG / DELETE, CANCEL / SAVE → `useUpdateSetLog` as today).
- Delete: `deleteEffects()` (46) → for a logged set: the stages then the head through `useDeleteSetLog`, then the renumber patches (heads **and stages**) through `useUpdateSetLog`; for an unlogged planned set: a `v2_session_set_changes` row `{ deleted: true }` (new `sessionSetChangesService.ts` + `useSessionSetChanges.ts`, read with the session, merged by `useExerciseCardState` so the row disappears and the numbering shifts); for an added-but-unlogged set: local state only; the W9 confirm "Delete set 03? 52.5 kg × 8–10. Only today's session changes; the plan stays the same." and the head variant "… and its drop"; a skipped row's ⋯ gets DELETE too (closing F4's "can't delete a skipped set").
- Offline (G47 (a)): deletes queue through 57; the change row insert queues as an upsert like a log.
**Depends on:** 36 (live), 38, 40, 46, 57 (if G47 (a)), 58.
**Migration:** none.
**Verification:** screen tests: DELETE on a logged head with a logged drop deletes the drop first then the head and patches set 04 → 03 **and its stage** (break: heads only → fails); DELETE on an unlogged planned set writes the change row with `deleted: true` and the row is gone on re-render with the next set renumbered (break: skip the write → the row returns on reload fixture → fails); the plan row is untouched (absence of any `v2_week_plan_sets` write); a drop's ⋯ has no SET TYPE / CUES / SKIP (absence); CUES writes the planned set's tags through the same service Plan uses; the edit panel's SAVE sends the same `updateSetLog` patch master's inline edit sends (parity capture); invalid weight blocks SAVE; offline: the delete lands in the queue as a `delete` item behind the row's own upsert. Scratch: a change row for a planned set is rejected twice (`23505`) and dies with its session (cascade, proven by deleting a throwaway session). Screenshots: W7, W8 (each), W9, W2b (the four non-unlog states).
**Would not catch:** REVIEW's reading of `deleted` (56 proves it).
**Done when:** live; Adam deletes a planned set mid-session and the plan is unchanged in Plan; REVIEW next week lists it as Skipped.

### Chunk 62 — Set type during a workout
**Goal:** The set type picker in its workout variant changes a set's type for this session only — from the ⋯ for upcoming and current sets, from the edit panel for logged ones — adding or removing drops as SPEC says, asking before deleting logged drops; ADD STAGE and "mark as dropset" are gone.
**SPEC:** Logging mechanics [1.2] (Set type during a workout (19), (19c); "ADD STAGE, 'Mark as dropset' and '+ DROP OR STAGE' are removed"); Set types [1.2] (the picker "in the workout (type only; W7a)"); Review (13d: "next week sees it only through REVIEW").
**Boards:** W7a; the SET TYPE rows of W7 and W2b.
**Scope:** SET TYPE row in `SetOptionsSheet` and `SetEditPanel` → `SetTypePicker` (`context: 'workout'`) → `applySetTypeChange()` (46): a **logged** head: patch its log (`is_warmup`, `stage_kind` — `updateSetLog` extended to those two fields and `stage_index`), add the pending drop rows (count in a `v2_session_set_changes` row keyed by `set_log_id`), delete logged stages when switching to Normal after the confirm "Delete the 2 logged drops?"; an **upcoming** planned set: a change row keyed by `week_plan_set_id` (`is_warmup`, `stage_kind`, `stage_count`) merged over the plan by `useExerciseCardState`; an added unlogged set: local state. The planned stages of a retyped planned set are replaced by the change's count. The new drop under a logged head becomes the current set unless an earlier set is unlogged (the lock then decides). `SetGroup.tsx`'s ADD STAGE and "mark as dropset" removed with `useAddStage`'s workout use.
**Depends on:** 39, 46, 61.
**Migration:** none.
**Verification:** screen tests: Dropset on a logged Normal set patches the log's `stage_kind` and shows one pending drop as the current row (break: no pending row → fails); Normal on a logged dropset with a logged drop asks first and deletes the drop after confirm; Warmup on an upcoming planned dropset writes a change row `{ is_warmup: true, stage_kind: null, stage_count: 0 }` and the planned stage rows vanish; the plan row is never written (absence); logging a retyped upcoming set writes the log with the retyped kind (`is_warmup` / `stage_kind` from the change, not the plan — break: take the plan's → fails); ADD STAGE and "mark as dropset" absent everywhere (grep in the test); screenshot W7a.
**Would not catch:** REVIEW's "You made set 02 a dropset" (56).
**Done when:** live; Adam retypes a set mid-session, logs it, and Plan's next week is unchanged until REVIEW.

### Chunk 63 — Unlog
**Goal:** A logged set goes back to unlogged with its numbers kept; logging again undoes it; UNLOG is disabled with logged drops after the set; the rest timer and the session's status are untouched; a reopened session behaves the same.
**SPEC:** Logging mechanics [1.2] (Unlog (18c)), Defaults 6.
**Boards:** W2b (UNLOG in the edit panel).
**Scope — as far as G46 allows:** the UNLOG button in `SetEditPanel` (disabled with "Log its drops first" when `canUnlog()` (46) is false); unlogging never calls `restTimerStore.start`/`startRest` and never touches the session row (asserted). **Stops at G46** for the write: under (a) — `useUnlogSet`: delete the log (through 57's queue offline), write the draft `{ weight, reps, rir, formRating, enteredUnit }` to Dexie `session_set_drafts`, and the current/upcoming row prefills from the draft (visibly different from a typed value, like pre-fill); re-logging inserts a new row and clears the draft; the set-type change row (62) survives unlog. Under (b) — migration 045 and the consumer list in G46 instead.
**Depends on:** 61, G46 and G47 answered.
**Migration:** none under (a); 045 under (b).
**Verification (under (a)):** screen tests: UNLOG on a logged set removes the log (the delete call), the row becomes current with its numbers shown as a draft, the rest timer store is untouched (spy: no `startRest`), the session row untouched (absence of any `v2_sessions` write); LOG again inserts a new log with the draft numbers and clears the draft; UNLOG disabled with a logged drop (break: enable it → fails); in a reopened session the same; offline, the delete is a queued `delete` item. Scratch: nothing (no schema). Screenshot: W2b's panel with UNLOG enabled and disabled.
**Would not catch:** the draft on a second device (by design under (a)).
**Done when:** G46 answered and built; Adam unlogs and re-logs a set in a real session.

### Chunk 64 — Finishing
**Goal:** FINISH SESSION opens board W18 — the session's tiles, the unlogged-sets warning with GO BACK, energy, pump, note, BACK TO SESSION / COMPLETE — and a reopened session finishes through W19; the writes are today's.
**SPEC:** Logging mechanics [1.2] (Finishing (11, C6)); Finished session [P2] unchanged; Superseded ("Unlogged sets at finish behave as they do today" → the warning comes back).
**Boards:** W18, W19.
**Scope:** `FinishScreen.tsx` replaces `SessionComplete.tsx`'s capture step: "WEEK 2 · TUESDAY · 52:40 / FINISH PULL 1", tiles WORKING SETS / SKIPPED / WARMUPS (`countCompletedSets` and the skipped count), the warning from `finishWarning()` (46) with GO BACK (closes and scrolls to the first listed set via `useScrollToCurrentSet`'s target), ENERGY and PUMP chips (today's `RatingChips` values), NOTE, BACK TO SESSION, COMPLETE → `useCompleteSession` unchanged (SAVING… pending; the real error line); W19 for a reopened session: no warning box (the session was already finished once — the warning is about planned sets never logged, and a reopened session's are what they were), the same chips and SAVING…; the auto-finish path untouched.
**Depends on:** 46, 58.
**Migration:** none.
**Verification:** screen tests: with two planned sets unlogged the warning names them ("EZ Bar Curl 01 and 02") and GO BACK scrolls to the first (the scroll target id asserted); with none, no box (absence); COMPLETE sends the same payload as master for the same fixture (parity capture; an all-skipped session still completes as `skipped`); a reopened session shows W19 (no box) and completes; screenshots W18, W19.
**Would not catch:** `deriveCompletedAt` edge cases (unchanged, its tests stay).
**Done when:** live; Adam finishes a session through the new screen and History shows it.

### Chunk 65 — The PROGRAMS tab
**Goal:** Plan's PROGRAMS tab is board PR1: the current program's card (week, start, types, FOCUS / DON'T CARE → PR5, EDIT PROGRAM, FINISH), YOUR PROGRAMS (OPEN, START, RUNNING, + NEW PROGRAM), FINISHED; no program running → PR2 with the locked PLAN tab; no programs → PR3; loading → PR4; START through PR8–PR12 lands on Plan week 1; the New program sheet (PR13/PR13b) requires both types; FINISH (PR6/PR7) replaces END RUN; the Plan tab in the nav opens the week, or PROGRAMS when nothing runs.
**SPEC:** Programs and runs [1.2] (Creating a program (16a); Starting; Finishing (8c); Priorities view-only (PR5)); Navigation and settings [1.2] (PLAN | PROGRAMS (8)); Screens → PROGRAMS; Removals (END RUN, the Plan header's Programs icon); Errors.
**Boards:** PR1, PR2, PR3, PR4, PR5 (entry; the editor is today's `PrioritiesEditor`, view-only), PR6, PR7, PR8, PR9, PR10, PR11, PR12, PR13, PR13b; 12's PRIORITIES states.
**Scope:** `ProgramsTab.tsx` (+ `CurrentProgramCard.tsx`, `StartProgramSheet.tsx`, `NewProgramSheet.tsx`) replaces `ProgramsPage.tsx` (the `/program` route renders Plan opened on PROGRAMS); `PlanPage.tsx`'s shell: PLAN | PROGRAMS, the lock on PLAN with "Start a program to plan your weeks." when no run; `Nav.tsx` unchanged in tabs (PLAN opens `/plan`, which chooses the tab). Current card: "WEEK 2" chip, name, "Started Oct 5, 2026", "Weekdays · stable · 5 days a week" (P1.2-4's counting for days), FOCUS / DON'T CARE rows summarised from the run's marks ("Chest, back"), EDIT PROGRAM → `/plan/change`, FINISH → PR6 confirm ("Finish [name]? The program stays saved, so you can start it again. Every week stays in History.") → `useCompleteMeso` (FINISHING…), the line under the card. YOUR PROGRAMS: types line, OPEN → `/program/:id`, START → PR8 (NAME optional, placeholder = the program's name; PROGRAM radio list; START PROGRAM; PR9's "Starting it finishes [name]. Its weeks stay in History." when one runs; PR11's disabled START + "Schedule at least one workout to start." from `hasSchedule`; PR12 when no programs; PR10's toast with the real reason "Couldn't start [name]." + `message`), RUNNING tag; "+ NEW PROGRAM" → PR13 (name; SCHEDULE radios Weekdays / Sequence with their descriptions; PLANNING Stable / Week-dependent with theirs; CREATE PROGRAM disabled + "Choose a schedule and a planning type to create it." until both; then "You can change both later in the program.") → `createProgram` then `updateScheduleType` + `updatePlanningType` (or one insert carrying both — `programService.createProgram` extended to take them) → `/program/:id`. FINISHED: "[name] · SEP 14 — OCT 4, 2026 · 3 WEEKS" → `/program/finished/:id` (66). After START: `navigate('/plan')` with the week forced to 1 (a one-shot `?week=1` the shell reads), on both STARTs (`PlannerPage.tsx:145` too); the `'Mesocycle'` literal gone; `useDeleteMeso` moves to 66.
**Depends on:** 38, 51, 52.
**Migration:** none.
**Verification:** screen tests: START calls `v2_start_run` through `useStartRun` with the program id and the typed-or-default name and then navigates to `/plan?week=1` (break: `/plan/priorities` → fails); PR9's line only when a run is active; START disabled without a schedule with the reason; a failed start shows the toast with the server `message`; CREATE PROGRAM disabled until both radios are chosen and the create call carries both types (break: default one → fails); FINISH calls `completeMeso` after the confirm and the card becomes PR2's; with no run, PLAN is locked and PROGRAMS is the opened tab; `/program` renders the tab; END RUN / ACTIVE RUN / COMPLETED RUNS / START RUN strings absent (absence); PR5 opens `/plan/priorities` (view-only) from the FOCUS row; `ProgramsPage.test.tsx`'s navigation expectation updated. Screenshots: PR1–PR4, PR6–PR13b at 390 px vs boards.
**Would not catch:** the finished program screen (66).
**Done when:** live; Adam starts a program from PROGRAMS and lands on Plan, week 1; FINISH ends it.

### Chunk 66 — A finished program
**Goal:** PR14: dates, weeks, deloads, a PRIORITIES row, the week-by-week structure history with changes highlighted and a per-week detail, and DELETE THIS FINISHED PROGRAM with PR15's confirm.
**SPEC:** Screens → PROGRAMS (Finished program: PR14, PR15); Programs and runs [1.2] (a finished program's priorities stay editable; which table); Defaults 11; the known gap (PR14's tempo/superset lines are not shown).
**Boards:** PR14, PR15.
**Scope:** route `/program/finished/:mesocycleId`, `FinishedProgramPage.tsx`; `programHistory.ts` (pure, tested): per week the structure (exercises in order with set count and kinds: "3 SETS · 1 DROPSET", "1 WARMUP · 2 SETS", A1/A2 for supersets as stored in `v2_week_plan_exercises` + the run copy's blocks) and the diff against the week before (+ added, ~ changed kind/count, − removed; "No changes"); tiles "WK 1 … DL 7" with a dot on changed weeks; "Changed from week 3" list; the week's structure cards per workout with "N CHANGES"; the PRIORITIES row: runs with `v2_program_priorities` rows → an editable priorities editor over the run copy (the planner's `StepPriorities` writer reused on the finished run's program id); pre-1.1 runs → **stops at G50** (the frozen page as is, or not); DELETE THIS FINISHED PROGRAM → PR15 ("Cut PPL, Jul 5 – Sep 12. Its weekly plan is deleted. Its sessions stay in History, and the saved program isn't touched. This can't be undone.") → `useDeleteMeso` (moved here from `ProgramsPage`).
**Depends on:** 65.
**Migration:** none.
**Verification:** `programHistory` tests: a week with a dropset added and an exercise removed yields `~` and `−` items and a dot (break: compare with week 1 instead of the week before → fails); set counts exclude stages and warmups are counted separately; tempo and supersets never appear in the change list (absence). Screen tests: the tiles, the detail for a tapped week, DELETE calls `deleteMeso` after the confirm; the PRIORITIES row routes by the marks table (new-table run → the editor, mutate spy called on a mark; old-table run → the frozen page's route). Screenshots PR14, PR15.
**Would not catch:** G50's answer (pre-1.1 runs).
**Done when:** live; Adam opens a finished program and sees its weeks' structure; delete works with the confirm.
**Stops at:** G50 for the pre-1.1 PRIORITIES row.

### Chunk 67 — The stepped planner's step 3 on the shared pickers
**Goal:** Step 3 plans sets with the set type and rep target pickers: a set's number opens the type picker, a rep target (or ALL) opens the rep picker; the DROPSET / REST-PAUSE / MYO-REPS / CLUSTER buttons, + ADD STAGE, the stage delete icon, the separate STAGE REST row and typed rep targets are gone; the "DROPSET · 1 DROP" chip opens the picker; no deload control.
**SPEC:** Stepped program planner [1.2] (step 3's two bullets); Set types [1.2] ("the same component … in the stepped program planner (type, REMOVE THIS SET)"); Rest [1.2] (REST BETWEEN in the planner's picker); Screens → Stepped program planner (PP3, PP3b, PP3c, PP3d, PP6's volume states).
**Boards:** PP3, PP3b, PP3c, PP3d, PP6 (VOLUME · NO WORKOUTS YET, LOADING A WORKOUT).
**Scope:** `StepVolume.tsx`: STABLE / WEEK-DEPENDENT segment with its line ("Only week 1 is planned here; later weeks copy forward." / "The sets planned here are the volume for every week."); per workout a card with the SETS stepper per exercise ("NO SETS YET" in red at 0), the expanded exercise's rows: ALL (→ rep picker for all heads: `useSetRepTargetForAllSets`), REST AFTER column (`useUpdateProgramSetRest`), rows `01 12 WARMUP` / `02 8–12` with the number → `SetTypePicker` (`context: 'planner'`: type, DROPS stepper, REST BETWEEN → `useUpdateProgramSetStageRest`, REMOVE THIS SET → `removeProgramSet`) and the rep box → `RepTargetPicker` (`useUpdateSetRepTarget`); the staged chip "DROPSET · 1 DROP ⌄" → the picker; the stage row's rep box → the rep picker for the stage (P1.2-8); the old buttons and rows removed with their tests (`StepVolume.stageKind`, `StepVolume.warmup` rewritten to the picker path). Writes stay the existing `plannerService` functions (`updateProgramSetIsWarmup`, `updateProgramSetStageKind`, `addProgramSetStage`, `removeProgramSetStage`/`removeProgramSet`, `setExerciseSetCount`).
**Depends on:** 39, 48.
**Migration:** none.
**Verification:** screen tests: the number → picker → Dropset calls `updateProgramSetStageKind` + `addProgramSetStage` as the old buttons did (captured call parity for each kind); Warmup → `updateProgramSetIsWarmup(true)` and stages removed first; REMOVE THIS SET → `removeProgramSet`; ALL → `setRepTargetForAllSets` with the picker's value; the old button labels absent (absence); no DELOAD RULES section (48); screenshots PP3, PP3b, PP3c, PP3d, PP6 (its two volume states).
**Would not catch:** steps 1–2 (68).
**Done when:** live; the planner's step 3 plans a dropset and a warmup through the pickers only.

### Chunk 68 — The stepped planner's steps 1–2, confirms and states
**Goal:** Steps 1 and 2 and the planner's chrome match PP1–PP2f, PP4–PP6: the step bar, the rename-in-place title, priorities with inherited marks, the WEEKDAY / SEQUENCE segment with per-workout day chips, in-place exercise editing (UNIT, REST, REST AFTER, TEMPO, SUPERSET REST), link toggles, the warmup routine in the card, ADD WORKOUT / ADD SLOT / CHANGE SLOT sheets, the shared exercise picker (stay-open add), the confirms, the loading / missing / run-copy / start states, and the empty states.
**SPEC:** Stepped program planner [P1] (unchanged rules), [1.2] (PP5's refusal wording "This is the current program's copy. It opens from Plan instead: plan its weeks there, or use EDIT PROGRAM in Programs."); Programs and runs [P1.1] (START needs a schedule, the line); Screens → Stepped program planner; Errors (PP5b's real reasons).
**Boards:** PP1, PP1b, PP2, PP2b, PP2c, PP2d, PP2d2, PP2e, PP2f, PP4, PP4b, PP5, PP5b, PP6 (its non-volume states).
**Scope:** `PlannerPage.tsx`, `StepPriorities.tsx`, `StepExercises.tsx`, `designFieldEditors.tsx` restyled to the boards with every existing write unchanged (`useAssignWorkoutWeekday`, `useSplitSharedWeekdayWorkouts` and the G14 prompt (PP1b/PP4b), `useToggleSupersetLink`, `useUpdateSupersetBlockRest`, rest/tempo/unit hooks, the warmup routine service, sequence item hooks); `ExercisePicker.tsx` replaced by chunk 41's sheet in add mode with `stayOpenAfterAdd`; the error lines show the server `message` ("Couldn't update priorities." + reason; "Couldn't start this program." + reason; "Couldn't split the schedule: …"); SAVE → `/program` (the PROGRAMS tab), START → Plan week 1 (65's rule).
**Depends on:** 38, 41, 65, 67.
**Migration:** none.
**Verification:** every existing `StepExercises.*`, `StepPriorities.*`, `PlannerPage.*` test passes with only "open" steps changed (call parity: each editor calls the same hook with the same arguments as on master — the reviewer reads the test diff for any changed expectation); the run-copy refusal text and link; START disabled without a schedule; the G14 prompt and its failure line; the add sheet stays open after a tap; screenshots for every board listed, each state.
**Would not catch:** step 3 (67).
**Done when:** live; Adam builds a program through the restyled steps.

### Chunk 69 — "Program" everywhere, "cues" everywhere
**Goal:** No screen says meso, mesocycle or run; tags are cues; the planner's button says "change the program"; every rule a person meets is stated in place — a text-only sweep over every screen 1.2 doesn't otherwise touch, with Coach's frozen files excepted.
**SPEC:** Language [1.2] (C12, "Tags are 'cues'", "change the program", "Screens explain themselves"); Design boards → Scope of the look (Today, History, Progress, Settings keep their code; only the wording changes).
**Scope (every user-visible string found on master, F6's agent sweep):** `HistorySessions.tsx:99` "Search sessions or programs…", `:116` ALL PROGRAMS, `:262` DELETE PROGRAM, `:271` "DELETE FINISHED PROGRAM?", `:277` "…no longer linked to this program.", `:392` NO PROGRAM; `ExerciseHistoryView.tsx:374` ALL PROGRAMS; `ProgressPage.tsx:9` PROGRAM OVERVIEW; `MesoProgress.tsx:251` "NO PROGRAMS YET", `:254` "Start a program in Plan → Programs to track progress.", `:321` "…to see your program overview."; `ExerciseProgress.tsx:190` "PROGRESS · THIS PROGRAM"; `TodayPage.tsx:439` "Start a program to begin training", `:446` "GO TO PROGRAMS →" (to `/plan` on PROGRAMS); `PlanPage.tsx` / `PrioritiesEditor.tsx` "NO CURRENT PROGRAM" (board 12's wording); `deloadRulesLine.ts` (done in 48); `PlannerPage.tsx:119` (done in 68); the Coach user's workout sidebar untouched (frozen); any "tag"/"TAGS" left in Plan, the workout and the planner after 54/61/67 (`grep -rn "tag" src --include=*.tsx` audited, identifiers excepted); `MarkerChip` labels; test names and fixtures updated where they assert the old strings. Code identifiers, routes, tables and query keys don't change (SPEC).
**Depends on:** 65 (the Programs strings are gone with the page), 54, 61, 67.
**Migration:** none.
**Verification:** a script-level check committed as a test: `scripts/check-wording.test.mjs` greps every `.tsx`/`.ts` under `src/` except `src/features/coach/**` and tests for user-visible `meso`, `mesocycle`, `run` (as a noun: `END RUN`, `START RUN`, `A RUN`, `run's`, `active run`, `completed run`) and `tag` in JSX text and string literals passed to UI (an allowlist for identifiers such as `mesocycleId`, `runService`, `tags` as a field, documented in the script); it fails on master today (the list above) and passes after the chunk — the break proof is the master run. Every screen's existing tests pass with the new strings. The History and Progress screens are screenshot at 390 px for the reviewer's eye only (no boards: SPEC says their look is unchanged).
**Would not catch:** wording inside the frozen Coach screens (by design; G50 for the one page 1.2 links to).
**Done when:** live; a grep of the deployed bundle for "MESO" and "END RUN" finds nothing outside the Coach chunks (Checks that lied #8's bundle grep).

---

## Baseline measurements (2026-10-12, master `6e5f654`, this container)

- `npm ci` (fresh container): 401 packages. `npx vitest run`: **2369 passed (2369)** in 176 files, 143.8 s. `npm run build`: exit 0, one stylesheet `dist/assets/index-CDV8nJ51.css` (25,108 bytes).
- Scratch replay (Process notes): 42 of 42 files applied; `public` has 39 tables.
- Screenshot prototype: `playwright-core@1.56.1` (installed in a scratch folder, not the repo) driving `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` (Chromium 141.0.7390.37) rendered `src/features/plan/__fixtures__/planpage-chunk6-render.html` and `src/features/gym/__fixtures__/gymsession-d30-render.html` wrapped in a light-theme document with the built CSS at 390 × 844: both full-page PNGs at `scrollWidth 390` (no overflow), text dumps of 31 and 43 lines in DOM order; the Google Fonts `@import` was stripped (no network), so fonts are the fallbacks. The gym fixture's PNG shows the tokens applied (surface cards, the accent on LOG, `LOCKED` dimmed), i.e. the approach works for the review's element/order/wording comparison.
- Scratch fixtures F1-a / F1-b (F1 above) and the F1-a run copy's `schedule` jsonb: `{"monday": null, "tuesday": "<workout id>", …}`, the shape `v2_run_schedules.schedule` reuses.

## Boards → chunks

| Boards | Chunk |
|---|---|
| 5, 6, 7, PP3c, PP3d, W7a | 39 |
| 8 | 40 |
| PL4, PL5, PL6, PP2d, PP2d2, W11, W13, W15 | 41 (wired in 51, 68, 59) |
| PL1, PL1b, PL2, PL3, PL7, PL8, PL9 | 51 |
| 1 (header), 1b, 1d (header), 1e, 2, 12 (Plan states) | 52 |
| 1, 1a, 1c, 1d, 9, 10, 11 | 54 |
| 3 | 55 |
| 4 | 56 |
| W1, W2, W3, W3b, W4, W6, W16, W17 | 58 |
| W5, W10, W14 | 59 |
| W7b | 60 |
| W7, W8, W9, W2b | 61 (UNLOG: 63; SET TYPE: 62) |
| W18, W19 | 64 |
| PR1–PR4, PR5 (entry), PR6–PR13b, 12 (PRIORITIES states) | 65 |
| PR14, PR15 | 66 |
| PP3, PP3b, PP6 (volume states) | 67 |
| PP1, PP1b, PP2, PP2b, PP2c, PP2e, PP2f, PP4, PP4b, PP5, PP5b, PP6 | 68 |

All 83 boards appear once as a primary assignment (the picker and sheet boards are built in 39–41 and wired by the screen chunks that list them).

## The assumptions this plan is least sure of

1. **That TASKS may decide the storage of session-only set changes** (`v2_session_set_changes`, Data model). SPEC says a set type changed during the workout "is recorded on the session's set, never on the plan", and a deleted set is "this session only"; an *upcoming* set has no session row yet, so the plan puts those changes in a new session-scoped table. If Adam reads "the session's set" as "only once logged", the table shrinks to the deleted flag and the pending-drop count, or goes.
2. **That a generic, whitelisted op executor (`v2_apply_ops`, 043) is the right way to make a CHANGE THE PROGRAM save atomic.** It keeps the landing rules in tested TypeScript, but it is a new kind of write path for this app (one RPC applying client-computed rows). The alternative is the 040 pattern (the logic in PL/pgSQL), which failed review twice.
3. **That the weekday change is stored as a per-run schedule history (`v2_run_schedules`) resolved per week, and that the current week's sessions therefore need no move rows.** SPEC left the choice to TASKS ("an effective-from week, or this week's sessions recorded as moves"); the history is the smaller change to Today's scheduler, but it makes every weekday read go through a resolver (chunk 50), which is the kind of cross-cutting change that has hidden callers.

## Appendix — the local scratch-copy stand-in used for the checks above

When `supabase/postgres` can't be pulled, this reproduces the replay on an apt PostgreSQL 16 (`postgresql-16`), as the planning session did on 2026-10-12. It is not `scripts/replay-migrations.sh` and doesn't replace it: Postgres 17 and pg-safeupdate are only proven by the real image (CI's `migration-replay`).

```sql
-- bootstrap.sql: what the supabase/postgres image provides and the migrations use
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create role app_migrator login createrole createdb bypassrls;   -- stands in for Supabase's non-superuser "postgres"
grant anon, authenticated, service_role to app_migrator;
create schema auth; create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
         (current_setting('request.jwt.claims', true)::jsonb ->> 'sub')), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select nullif(current_setting('request.jwt.claim.role', true), '')::text $$;
grant usage on schema auth to anon, authenticated, service_role, app_migrator;
grant select on auth.users to app_migrator, authenticated, service_role;
alter schema auth owner to app_migrator; alter table auth.users owner to app_migrator;
grant all on schema public to app_migrator; grant usage on schema public to anon, authenticated, service_role;
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
grant all on schema supabase_migrations to app_migrator; grant all on all tables in schema supabase_migrations to app_migrator;
-- after the replay (Supabase's default privileges, which the image grants automatically):
-- grant all on all tables in schema public to anon, authenticated, service_role;
-- grant all on all sequences in schema public to anon, authenticated, service_role;
-- grant execute on all functions in schema public to anon, authenticated, service_role;
```

```bash
# replay-local.sh: same per-file semantics as scripts/replay-migrations.sh
export PGHOST=/tmp PGPORT=54329 PGUSER=app_migrator PGDATABASE=postgres
for f in $(ls supabase/migrations/*.sql | LC_ALL=C sort); do
  psql -q -v ON_ERROR_STOP=1 --single-transaction -f "$f" || { echo "FAILED at $f"; exit 1; }
done
```

A fixture runs as a user with `select set_config('request.jwt.claim.sub', '<uuid>', true); set local role authenticated;` inside one transaction, sequential statements in a `DO` block, and `rollback` at the end (CONTEXT.md's fixture rules).
