# Overload — Decisions

## Format for all new entries

```
## [n] [One-line summary]
Severity: blocking | deferred
Chunk: [n]
What happened: [the situation, with full reasoning]
A competent default would: [what anything competent would have
  just done here] — doesn't apply because: [why this is a real
  decision and not a default]
Cost of deferral: [what gets redone if the answer goes against
  the provisional path] — blocking entries: n/a
Answer: [mine]
```

Deferred is only allowed when the work can continue without committing to the answer. If continuing means guessing at something expensive to undo, it's blocking.

The entries D1–D28 further down predate this format and stay as they are; they use "Decided / Answer / Constrains".

Decisions Adam made in earlier builds that still constrain the code, each as an answered entry: what was decided, and the answer. Only ones that still apply are here; decisions that were superseded (the global priority table, the daily analysis ship-date placeholder, the phase-4 "wait for 10–20 notes" gate, migration renumbering) were left out. Source for each is the build log now in HISTORY.md (the session named in brackets), the spec Adam wrote, or a code/migration comment where no log exists.

Format of D1–D28: **Decided** — the question. **Answer** — what was chosen. **Constrains** — where it shows up.

## Training data model

**D1 · How is a dropset stored?** *(2026-08-05 review)*
**Answer:** Relationally — stages stay as linked rows in `v2_set_logs` (`parent_set_id` + `stage_index`) and `v2_week_plan_sets` (`parent_week_plan_set_id`); no child stage table. The cost is the stage-exclusion rule: a stage is never an independent set, except that volume counts it.
**Constrains:** every set count, numbering, average, e1RM and history view; `setGroupLogic.ts`; migrations 004/007/009/010/011.

**D2 · How is e1RM computed for the Progress headline?** *(2026-08-05 review)*
**Answer:** RIR-adjusted Epley; a set with no RIR is skipped (never treated as 0); a session with no RIR on any working set is excluded from the meso comparison rather than falling back to unadjusted (which would manufacture a gain). Some exercises therefore show no headline — accepted. The headline is a percentage only, never an absolute weight (SPEC §6).
**Constrains:** `e1rm.ts`, `progressService.ts`, `ExerciseProgress.tsx`, `positionMatch.ts` deltas.

**D3 · Does `is_warmup` ship now while warmup handling is deferred?** *(2026-08-05)*
**Answer:** Yes — the column shipped in migration 006 on both `v2_week_plan_sets` and `v2_set_logs`; Adam did not object and it is treated as settled. Warmup-set handling itself is still deferred.

**D4 · Weight unit model?** *(Phase 3.6)*
**Answer:** Weights are stored in kg. Each program exercise can override the unit (INHERIT/KG/LBS), written as a resolved literal at creation; a logging-time toggle exists; Progress and History convert to the global Settings unit only (SPEC §8.1), the gym screen to the exercise's own unit.
**Constrains:** `weightUnit.ts`, `useWeightDisplay`, `SetRow`, `WorkoutDayEditorPage`.

**D5 · Does set timing change the default rest timer?** *(Phase 3.2)*
**Answer:** No. Start Set / `set_seconds` is opt-in via the `measure_set_time` Settings toggle (global, default off); off leaves rest including set-performance time exactly as before. Historical `rest_seconds` cannot be backfilled.

**D6 · Plan view shape?** *(Phase 3.7)*
**Answer:** A workout-day switcher (chip row) replaces scroll-through-everything; copy is split into whole-week and single-workout; a compact view collapses consecutive plain sets but always shows a dropset as its own entry in true order; compact mode is page-local, not a Setting.

**D7 · Meso weeks?** *(2026-07-11)*
**Answer:** Calendar weeks, Monday-anchored, flipping on Monday rather than on the meso's start weekday.

**D8 · Swap exercise scope?** *(2026-08-27, 2026-09-03)*
**Answer:** A swap applies to one session only, never the template. It is recorded structurally (`v2_session_exercise_swaps`, one row per swap event) so Coach can read it as one substitution. It deliberately carries no reason/cause field; the model must not guess why. Swap-exercise *mid-set* is not planned.

## Coach — shared

**D9 · Who can see Coach, and what may it do?** *(2026-08-18 and later)*
**Answer:** Coach is gated to Adam's account: server `COACH_USER_ID` is authoritative, client `VITE_COACH_USER_ID` is cosmetic, both hold the same UUID. Every Coach surface is advisory only — no AI write access to any data. Northstar data is never read or written by any Overload code (standing, all of Overload).

**D10 · Model and snapshot policy?** *(2026-08-18 review; later specs)*
**Answer:** Haiku surfaces pin the dated snapshot `claude-haiku-4-5-20251001` (not the alias) and store `response.model`, not the request constant. Sonnet 5 (`claude-sonnet-5`, no date suffix) is used where chosen deliberately: Mesocycle Analysis and the Q&A planning category. Every analysis row stores `input_snapshot` (shipped in migration 012, not deferred), `model`, `prompt_version` and token counts.

**D11 · Analyses are permanent.** *(2026-08-18)*
**Answer:** One permanent, non-regenerable row per subject (unique index), no update path, so prompt or tag changes apply only to analyses generated afterwards. The daily table cascades from its session (a flagged exception to "permanent"); the weekly table has no FK and no cascade. A paid-but-unsaved generation is an accepted risk mitigated by returning the content in the error and logging it, not by a pending-row state machine.

**D12 · Voice.** *(2026-08-31)*
**Answer:** Coach output reads as a chill but knowledgeable coach — direct "you", dry humour where it fits — without relaxing the two hard requirements in the prompts. Tone calibration beyond that is bundled with the planned/forced-wording fix and the Settings rework, not scheduled.

## Coach — Daily and Weekly

**D13 · Daily analysis ship cutoff.** *(2026-08-18)*
**Answer:** Only sessions completed after `COACH_ANALYSIS_START_DATE = 2026-08-16T22:00:00Z` (midnight Monday 2026-08-17, Poland time) get analyses; the cutoff filters on `completed_at`.

**D14 · Context-log semantics.** *(2026-08-18 review)*
**Answer:** A phase entry's end is implicit (the next entry's start); one entry per start date. A weekly-average weight entry is stored under its week's Monday; a manual weekly average wins over dailies for that week; phase/weight context resolves as of the session's date, not today; weight display is kg only; warmups are excluded from analysis input.

**D15 · When is a week analyzable?** *(2026-08-19/20)*
**Answer:** By plan resolution derived from `program.schedule` (not `v2_week_plans`), and an `in_progress` session does not count as resolved. A blended per-muscle-group metric is rejected outright, not deferred: the week payload regroups per-exercise facts by tag and reports them unblended.
**Constrains:** `weekResolution.ts`, `weekBuckets.ts`, `analyze-week.ts`.

**D16 · Exercise tags.** *(2026-08-20)*
**Answer:** `COACH-EXERCISE-TAGS.md` was approved as proposed, including every ⚠ row; Face Pull and Upright Row are `isolation`. Tag columns live on the shared `exercises` row with no default and no `not null`.

## Coach — Personalization

**D17 · What is gated?** *(2026-08-24 spec §7)*
**Answer:** Form rating (per set), energy and pump (per session) are ungated training data like RIR. The in-workout notes/ask sidebar is the single new gated surface.

**D18 · Rating storage.** *(2026-08-24/25)*
**Answer:** `text` + `CHECK` vocabularies (form: rushed/normal/controlled/extra_controlled; energy: none/low/normal/high/supreme; pump: none/some/good/extreme), with `'none'` (rated) distinct from `NULL` (unrated). Energy/pump are columns on `v2_sessions`. A segmented chip row substitutes for the spec's slider.

**D19 · Notes and Memory.** *(2026-08-25)*
**Answer:** A note outlives its session (`on delete set null`). Notes queue offline; reading them is online-only. Coach Memory is AI-curated from notes by a manual UPDATE MEMORY action (third serverless function), with a provenance table for each curation run.

## Exercise Library

**D20 · Library model.** *(2026-08-28)*
**Answer:** Multiple curated global libraries (preview / download / delete each), read-only in the database with no write policy. Exercises have a three-state lifecycle (active / lost / gone); deleting one with real history moves it to Lost Exercises. The existing 70 exercises got retroactive provenance: 46 legacy-default, 24 hand-added (approved via EXERCISE-LIBRARY-PROVENANCE.md).

**D21 · Reassignment (the four §11 questions).** *(2026-08-28, all approved as proposed)*
**Answer:** (1) Confirmation is type-the-target-name. (2) Every reassignment writes a `v2_exercise_reassignments` audit row (migration 022, applied before 021). (3) `is_archived` and `status` stay orthogonal — no consolidation in v1. (4) Restore-from-Lost ships in v1. Reassignment must not be run on Adam's real history without his explicit go-ahead.

## Q&A Sidebar

**D22 · Scope and boundaries.** *(2026-09-01 spec)*
**Answer:** Conversational and advisory only. Ruled out rather than deferred: any write access, any Northstar data, a dedicated review UI, a tone/settings toggle. Four categories (in_session, general, planning, app_mechanics) chosen by the originating screen, never inferred by the model; Haiku for all but planning (Sonnet 5). Every exchange is logged permanently with its context snapshot, grouped by a client-minted conversation id.

**D23 · Q&A storage and cost (the §12 questions).** *(2026-09-01)*
**Answer:** RLS is `select` + `insert` only — no update/delete policy at all, Adam's explicit choice over the `for all` convention. `session_id` is `on delete set null`. Memory proposals are deferred to v1.1 (v1 answers only). `app_mechanics` ships in v1. One shared `QaPanel` for both entry points. `HISTORY_TURN_CAP = 4` as the starting point; conversations cap at 20 turns.

## Priority Context and Mesocycle Analysis

**D24 · Priority Context scope.** *(2026-09-02, Adam changed direction)*
**Answer:** Priority (top/high/normal/low) is set by hand per mesocycle, per muscle_group (12) and per muscle_subgroup (22), and lives in the planner (`/meso/:id/priorities`), not Coach → CONTEXT. muscle_group priority is a ceiling; subgroup priority is relative emphasis within it, never a cross-group ranking. A new meso starts blank (no row = normal) plus an explicit one-tap COPY FROM previous meso, offered only into an empty destination, "previous" ordered by `start_date`. Priorities page is online-only like meso creation. No AI writes, no inference from volume.
**Constrains:** `priorityTags.ts` (`PRIORITY_TREE` supplies the group→subgroup partition that did not exist), `priorityContext.ts`, migration 024. PRIORITY-CONTEXT-SPEC.md was edited from this side at Adam's instruction.

**D25 · Mesocycle Analysis.** *(2026-09-02 spec; 2026-09-04 review; 2026-09-05 measurements)*
**Answer:** Rare, deep, manually triggered, one permanent non-regenerable record per completed meso, advisory only, Sonnet 5 by deliberate choice. It reads Priority Context for the analysed meso (fallback if absent: treat everything as normal, don't block). The analysis survives its meso's deletion (`mesocycle_id` nullable, `on delete set null`, identity denormalised) — reversed at review from an initial cascade. `effort` high and `max_tokens` 32,000 were chosen from measured output on the real MESO 1.0 payload. Source: migration 026 and `analyze-meso.ts` comments — the spec and tasks files are not in the repo.

## Not planned

**D26 · Out of scope.** Month analysis; live mid-workout energy/pump; swap-exercise mid-set. Deprioritised, not dropped: selective memory retrieval (once the memory list is large), AI equipment substitution (with the plan creator), warmup-sets handling, Settings rework with a Coach tab.

## Process

**D27 · Migrations Adam merges himself.** *(scripts, 2026-09-29)*
**Answer:** A migration whose statements are not all on the safe list in `scripts/migration-rules.mjs` (changes that cannot alter or remove existing data) is not merged by the build; `node scripts/check-migration.mjs` exits 1 (or 2 if it could not check), and the merge is Adam's, with a blocking entry here.

**D28 · Docs-only pushes don't deploy.** *(2026-08-15)*
**Answer:** `vercel.json` `ignoreCommand` skips the production build when a push changes only `.md` files. Currently `git diff --quiet HEAD^ HEAD -- . ':(exclude)*.md'` (set 2026-09-29; the longer per-file, last-deployed-SHA version exceeded Vercel's 256-character limit).

## 29 The two exercise-library tables are readable by everyone, anon included
Severity: deferred
Chunk: verify-rls (2026-10-01)
What happened: `scripts/verify-rls.mjs` expects zero rows from every table for both the anon key and a signed-in account that owns no data. `v2_exercise_libraries` and `v2_exercise_library_items` break that expectation by design: migration 019 gives each a `for select using (true)` policy with no `user_id` column and no `to` clause, so any role, anon included, can read them, and once the catalogs hold content a strict zero-rows rule would fail on every run. The first real run on 2026-10-01 confirmed it: anon read 1 row from `v2_exercise_libraries`. PR #5 asked whether anon being able to read them is intended, and whether they should stay in `PUBLIC_BY_DESIGN` (rows pass, any other error still fails, both probes still run) or be made strict or dropped from the list.
A competent default would: keep the strict zero-rows rule for every table and treat world-readable rows as a leak — doesn't apply because: this is a deliberate exposure of shared curated content, and whether anon may read it is a product decision, not something the script can infer.
Cost of deferral: n/a (answered)
Answer: given in-session on 2026-10-01 by the person running the build: both tables stay in `PUBLIC_BY_DESIGN`. They are intentionally readable by everyone, including anon, because they hold shared content (curated exercise libraries, no per-user data). Writes stay closed: there is no write policy. Any other table returning rows to anon or to the signed-in test account is still a LEAK.

## 30 Migration 027 (planner phase-1 schema) needs applying by hand before chunk 1 can close
Severity: blocking
Chunk: 1
What happened: The chunk 1 builder wrote `supabase/migrations/027_planner_p1_schema.sql` and nothing else. Repo facts say migrations are applied by hand in the SQL Editor, and Escalations 8 and 12 apply, so the chunk is not merged.
**The version to apply is the amended one** (your answer below): branch `build/chunk-1` at commit `3dbeebb` (pushed): https://github.com/adamjuszczyk/overload-v2/blob/build/chunk-1/supabase/migrations/027_planner_p1_schema.sql
- **16494 characters** (what the SQL Editor counts) = 18450 bytes. They differ because the section banners use box-drawing characters, house style since 020.
- md5 `3a0ead06021e6131fa0177dab6bda220`; SHA-256 `bcee20f8ca476b079261175345d0528a3e8564a7cefd5c0151351bf28d5226c2` (the file ends in one newline; without it the SHA-256 is `85e7be6195bc337e42dcdd196cfd5dedbffa37ea5d1a22089c8392e06af192d0`).
- The first version (`273b07d`: md5 `6828eea0…`, 18232 bytes) is superseded and must not be applied.
`node scripts/check-migration.mjs origin/master` exits **1** on the final file, flagging the same 8 statements as before. The two new constraints sit in ALTERs that were already flagged:
- 3× "new column carries a constraint or generated value": the ALTERs on `v2_programs` (`kind`/`schedule_type`/`planning_type`), `v2_set_logs` (`stage_kind` vocabulary + `v2_set_logs_stage_row_check`) and `v2_user_settings` (`warmup_display`/`week_start`).
- 4× "foreign key action can change existing rows later": `on delete set null` on new columns `v2_workout_days.source_workout_day_id`, `v2_mesocycles.source_program_id`, `v2_program_exercises.superset_block_id` and `v2_week_plan_sets.program_set_id` (the last ALTER also carries `v2_week_plan_sets_stage_row_check`).
- 1× "not on the safe list": `notify pgrst, 'reload schema'`.
None can alter existing data. Every existing row takes a default or NULL that satisfies the new CHECKs (the new stage-row checks hold because `stage_kind` is NULL on every existing row), and the new FK columns are NULL on every existing row.
What I verified myself, on the final file, on a fresh copy of the scratch baseline (PostgreSQL 16.14, 001–026 plus fixtures with 2 planned stage rows and 1 logged stage row):
- Catalog diff before/after: +72 columns (exactly the data model), +61 constraints, +21 indexes, +6 policies, RLS on for the 6 new tables. Nothing removed or changed.
- Row count and md5 fingerprint over the pre-027 columns are identical on all nine altered tables, and defaults read `saved/weekday/week_dependent` and `rows/copy`.
- The old client's settings upsert after non-default `warmup_display`/`week_start`/`deload_rules` leaves all three untouched.
- RLS on two new tables: A sees 1; B sees 0 and updates 0; B inserting A's row is refused by policy; anon sees 0.
- Probes, each rejected with its named CHECK: 10–8 range, AMRAP with reps, staged warmup, `'top'` mark, bad `week_start`, a planned stage row given a `stage_kind` (`v2_week_plan_sets_stage_row_check`), and a logged stage row given one (`v2_set_logs_stage_row_check`). Accepted: an 8–12 range, a stage row with null kind, and a head with a kind, on both tables.
The builder's clean rebuild agrees: R1 with 81 probes and 0 unexpected, R2 old-client shapes incl. `addStage` and stage set-log rows, R3 on all six tables, and R4 the same 8 flags.
Also on `build/chunk-1`: `npm run typecheck`, `npm test` (548/548), `npm run build`, `node --test "scripts/*.test.mjs"` (31/31), `check-context-size` and `gen-icons` (byte-identical icons) pass. `verify-rls.mjs` (your go-ahead, 32): 25 tables, 50 probes, all pass.
**Your steps, in order** (per your answer to 31):
1. Before applying, in the SQL Editor, record the result of:
   `select 'programs', count(*) from v2_programs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' union all select 'workout_days', count(*) from v2_workout_days where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' union all select 'mesocycles', count(*) from v2_mesocycles where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' union all select 'program_exercises', count(*) from v2_program_exercises where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' union all select 'week_plans', count(*) from v2_week_plans where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' union all select 'week_plan_sets', count(*) from v2_week_plan_sets where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' union all select 'sessions', count(*) from v2_sessions where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' union all select 'set_logs', count(*) from v2_set_logs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' union all select 'user_settings', count(*) from v2_user_settings where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f';`
2. **Transport (placeholder-collapse — CONTEXT.md's migration-transport rule; the first version of this entry broke it by telling you to paste the raw file).** Don't paste the migration itself. Paste the transport file instead, in which every run of 4+ identical characters (the `═══`/`───` banners and long space runs) is replaced by a marker `@@R<hex codepoint>x<count>@@`; no run longer than 3 survives in it: https://github.com/adamjuszczyk/overload-v2/blob/claude/epic-lovelace-0pvxbr/transport/027_planner_p1_schema.transport.sql (raw view, select all, copy). Paste it into a fresh SQL Editor tab. Do **not** run it.
   Then, in the browser console on that tab, paste and run exactly this (from `scripts/transport-collapse.mjs`):
   ```
   (async () => {
     const m = window.monaco.editor.getModels()[0];
     const h = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(x => x.toString(16).padStart(2, '0')).join('');
     const t = m.getValue();
     console.log('transport', t.length, await h(t));
     m.setValue((t => t.replace(/@@R([0-9a-f]+)x([0-9]+)@@/g, (_, c, n) => String.fromCodePoint(parseInt(c, 16)).repeat(Number(n))))(t));
     const y = m.getValue();
     console.log('expanded', y.length, await h(y));
   })()
   ```
   It prints two lines. Both must match one of these pairs (the pair depends only on whether your copy kept the file's final newline):
   - `transport 15780 98b0c38f345d53c78e1e4f8a4a4e91035f8d9775078744f7eb3a353057538678` and `expanded 16494 bcee20f8ca476b079261175345d0528a3e8564a7cefd5c0151351bf28d5226c2`
   - `transport 15779 77d48c600f3bfa998b49e33909f187d4ed77a3cf02423e9ef35212f04f4685fc` and `expanded 16493 85e7be6195bc337e42dcdd196cfd5dedbffa37ea5d1a22089c8392e06af192d0`
   A wrong `transport` line means the paste was damaged. A right `transport` line with a wrong `expanded` line means the expansion failed. Either way, don't run it: close the tab and start again. The editor now holds the expanded migration, banners included, and it should contain no `@@R` text.
   How this was checked: `node scripts/transport-collapse.mjs` expands the transport back to 027 exactly (md5 `3a0ead06…`). The same snippet run in headless Chromium, on a secure-context page with a stand-in editor model, printed exactly the first pair, and its result equalled 027 byte for byte. `scripts/transport-collapse.test.mjs` round-trips all 26 existing migrations, and was proven by injecting a short-by-one expander (22 tests fail) and disabling the collapse (21 fail). Not checked: the real Monaco editor, which this container can't reach (HISTORY records its `setValue`/`getValue` round trip as exact).
3. Run it. If a "Potential issue detected" dialog opens, use the dialog's own "Run query" (the toolbar Run only opens it). No statement drops or updates anything.
4. Don't trust the Success banner; check the result by query. Re-run step 1: every count must equal the before value. Then run:
   `select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('v2_program_priorities','v2_program_sequence_items','v2_program_sets','v2_program_superset_blocks','v2_week_plan_exercises','v2_workout_warmup_items');` → **46**
   `select count(*) from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('v2_mesocycles','source_program_id'),('v2_program_exercises','removed_at'),('v2_program_exercises','rest_after_seconds'),('v2_program_exercises','rest_seconds'),('v2_program_exercises','superset_block_id'),('v2_program_exercises','tempo'),('v2_program_exercises','week_only'),('v2_programs','deload_rules'),('v2_programs','kind'),('v2_programs','planning_type'),('v2_programs','schedule_type'),('v2_sessions','moved_to_date'),('v2_set_logs','stage_kind'),('v2_user_settings','deload_rules'),('v2_user_settings','warmup_display'),('v2_user_settings','week_start'),('v2_week_plan_sets','is_amrap'),('v2_week_plan_sets','program_set_id'),('v2_week_plan_sets','rep_max'),('v2_week_plan_sets','rep_min'),('v2_week_plan_sets','stage_kind'),('v2_week_plan_sets','tags'),('v2_week_plan_sets','target_weight'),('v2_week_plans','deload_restore'),('v2_week_plans','sequence_position'),('v2_workout_days','source_workout_day_id'));` → **26**
   `select relname, relrowsecurity from pg_class where relname in ('v2_program_priorities','v2_program_sequence_items','v2_program_sets','v2_program_superset_blocks','v2_week_plan_exercises','v2_workout_warmup_items');` → 6 rows, all `true`
   `select conname from pg_constraint where conname in ('v2_week_plan_sets_stage_row_check','v2_set_logs_stage_row_check');` → 2 rows
5. Live app at https://overload-v2-sage.vercel.app (no code changed, so no new deploy). If a RELOAD/update banner shows, take it first. Open Today, Plan, Program and History. Each should load your data as before, with no error toast and nothing missing.
6. In your next real session, log one set. It should save the same as always: it stays after a page reload, and no pending-sync marker remains.
7. Tell me the step 1 and 4 results and steps 5–6. I then run the read-only API probes: each new column answers `200 []` (Adam-filtered, `limit=0`), a made-up column answers `400`, and each new table answers 0 rows to the anon key (Adam-filtered). Then I open the chunk 1 PR to master.
A competent default would: merge the chunk once its checks pass — doesn't apply because: the migration is applied by hand, check-migration exits 1, and the reviewer's rules say the migration goes live before any code and the merge is yours.
Cost of deferral: n/a
Answer: (Adam, 2026-10-03) Schema choice: yes — add the check that a stage row can't carry a stage kind, on both planned sets and set logs, matching `v2_program_sets`; amend 027, re-run every scratch check on the final file, give the new character count and md5; "I apply only that version." Push: yes, push `build/chunk-1`. Standing for this build: the reviewer may push any `build/chunk-N` branch and opens a PR to master for each finished chunk; if the reviewer can't merge it, Adam merges it. Done: amended in `3dbeebb`, re-verified as above, pushed. Still waiting on: the apply and steps 1–6.
(Adam, 2026-10-04) **Change of plan: 027 is not applied by hand.** Adam is switching this repo to automatic Supabase migrations in a separate session, and 027 will go live by merging the chunk 1 PR. The entry stays blocking until he says the switch is done. Until then: chunk 1 is not merged, and neither 027 nor the transport files change. The hand-apply procedure above (steps 1–4, transport included) is superseded and kept only as a record. The live-app steps (5–6) still apply after 027 is live; the before/after checks get rewritten against the new migration rules once CONTEXT.md is updated by that session. Meanwhile chunks 2, 3 and 4 continue (no migration, none needs 027), and the build stops at the chunk 4 boundary because chunk 5 needs 027's columns.

## 31 Live browser verification is unavailable in this environment
Severity: blocking
Chunk: 1
What happened: Escalation 1 says to probe the browser tooling before the build. Headless Chromium (Playwright) launches here, but navigation to `https://overload-v2-sage.vercel.app/` fails with `ERR_TUNNEL_CONNECTION_FAILED`, and `curl` gets a 403 on CONNECT: the cloud environment's network policy denies that host. The Supabase host is reachable. You also can't sign in to a browser inside this container (Escalation 3).
A competent default would: skip the browser step and rely on the scratch and API checks — doesn't apply because: Escalation 1 gives this the weight of a failing test, and only you can say plainly what won't be verified.
Cost of deferral: n/a
Answer: (Adam, 2026-10-03) Live checks in this build are done by Adam; the reviewer can't reach or sign in to the app from here. For each chunk whose verification needs the live app, the reviewer writes the exact steps and what Adam should see. A chunk with a migration: the steps go in its blocking entry, and Adam does them right after applying. A chunk without a migration: merge once every check the reviewer can run passes, write the live steps as a deferred entry, and continue with the next chunk that doesn't depend on it. A failed live check from Adam is blocking. For chunk 1: after applying 027, Adam opens Today, Plan, Program and History, logs a set in his next real session, and reports back (steps in 30).

## 32 Go-ahead to run scripts/verify-rls.mjs at the chunk 1 boundary
Severity: blocking
Chunk: 1
What happened: The boundary rule is to run every script in `scripts/`, but Escalation 18 makes any run of `verify-rls.mjs` an escalation, because its selects are unfiltered by design (anon plus the no-data test account).
A competent default would: run it, since it is read-only — doesn't apply because: the rule asks for a go-ahead before each run.
Cost of deferral: n/a
Answer: (Adam, 2026-10-03) Yes, run it now; ask again next time — the per-run rule stays. Run 2026-10-03: 25 tables, 50 probes — 50 pass, 0 leak, 0 fail.

## 33 The weight deload rule's starting percentage is not specified
Severity: deferred
Chunk: 2
What happened: Chunk 2 (`src/lib/plannerVocabulary.ts`) holds the deload-rules starting values. TASKS.md gives the sets rule's starting value (`{ "mode": "percent", "value": 50, "rounding": "down" }`, from SPEC's "sets −50%, everything else unchanged") and says a weight rule, "when switched on, starts at rounding down to 2.5 kg". SPEC says the weight rule is a "percentage of base" with rounding and a precision step, but gives no starting percentage. The only number in either document is the `"percent": 90` in TASKS.md's JSON *shape* example, which illustrates the fields and isn't stated as a default. The builder didn't guess: `DEFAULT_DELOAD_WEIGHT_RULE` is `{ rounding: 'down', step: 2.5, stepUnit: 'kg' }` with no `percent`, and a test pins that omission so it can't be filled in silently. I checked the exported values directly.
A competent default would: take the 90 from the shape example — doesn't apply because: it's an example of the shape, not a stated default, and the starting weight cut of a deload is a training decision that SPEC leaves silent (Escalation 14).
Cost of deferral: one constant and its test in `plannerVocabulary.ts`, changed before chunk 22 (deload rules editor and calculator) uses it. Nothing before chunk 22 reads it.
Provisional path taken: no starting percentage; chunk 22 can't pre-fill the weight rule's percent until you answer.
Answer:

## 34 Input casing for tempo "X" and rep target "AMRAP"
Severity: deferred
Chunk: 2
What happened: SPEC writes tempo as "3-1-1-0, `X` allowed" and the rep target as "`AMRAP`". It is silent on whether lowercase input (`3-1-x-0`, `amrap`) is accepted. The builder took the strict reading: `normaliseTempo('3-1-x-0')` and `parseRepTarget('amrap')` both return null (invalid). Outer whitespace is trimmed, and internal whitespace is rejected. Also strict and consistent with SPEC's "range = min < max": a range written `8-8` is rejected, so the same number twice must be entered as `8`. I checked all of this directly. On a phone keyboard, typing lowercase is the easy path.
A competent default would: accept lowercase and normalise to `X` / `AMRAP` — doesn't apply because: SPEC is silent, and accepting versus rejecting is visible behaviour in the planner (Escalation 14). Either way it's a two-line change.
Cost of deferral: two small parse changes and their tests in `plannerVocabulary.ts`, before the first planner UI that takes typed input (chunk 11 for rep targets, chunk 17 for tempo).
Provisional path taken: exact case only; lowercase is rejected as invalid input.
Answer:

## 35 Chunk 3 live check: planned dropset stages in a real session (Adam's steps)
Severity: deferred
Chunk: 3
What happened: Chunk 3 is merged into master (PR #11, `1e77e94`). Every check I can run passed: jsdom tests over SetRow, SetGroup and the real ExerciseCard write path, with each test proven by an injected break; typecheck, build, every script; and my own DOM dump of two planned dropsets. SPEC requires the fix to be seen in a real session ("checking stored data alone doesn't catch this regression"), and TASKS.md's done-when is the real-session check at 375 px, recorded with a screenshot. I can't reach or sign in to the app (entry 31), so per the standing rule these are your steps.
**Your steps** (phone, or a 375 px-wide window):
1. Open https://overload-v2-sage.vercel.app. If an update/RELOAD banner shows, take it, so you're on the new bundle. Check that the deploy landed: the chunk 3 merge is `1e77e94`. If the Vercel dashboard is handy, confirm that commit's production deploy is Ready. (Chunk 2's production deploy wasn't confirmed from here either; it changed nothing at runtime.)
2. In Plan, on a workout you'll train next, give one exercise a planned dropset: a set with two stages (ADD STAGE twice in the plan). This is your own planning edit, so do it only if you want a dropset in that session; otherwise wait for a session that already has one.
3. Start that session. Before logging anything, that exercise should show:
   - The head row, enabled: weight and reps fields and LOG.
   - Two stage rows under it, each marked `↳`, dimmed, with weight and reps fields you can't tap into and a button reading **LOCKED** in the LOG position.
   Screenshot it.
4. Log the head. Stage 1 becomes the normal row with LOG, in the same place and shape, now usable. Stage 2 stays LOCKED. Screenshot.
5. Log stage 1. Stage 2 unlocks. Log it. Nothing on that set is LOCKED any more.
6. Also, on any set with **no** planned stages: after logging it, the small "mark as dropset" link appears exactly as before, and no LOCKED rows appear anywhere else.
7. In the SQL Editor (your user only):
   `select set_number, stage_index, parent_set_id, is_dropset, id, week_plan_set_id from v2_set_logs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and session_id = (select id from v2_sessions where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' order by created_at desc limit 1) order by set_number, stage_index;`
   The two stage rows must carry `parent_set_id` = the head row's `id`, `stage_index` 1 and 2, and `is_dropset` true.
8. Tell me the result and attach the screenshots. A failure is blocking.
A competent default would: count the jsdom tests as the verification — doesn't apply because: SPEC names a real session as the only check that catches this regression.
Cost of deferral: if it fails, chunk 3 is fixed and re-merged. Chunk 4 doesn't depend on it (it touches the logged-set edit form, not stage rendering).
Provisional path taken: merged; continuing with chunk 4.
Answer:

## 36 Chunk 4 live check: editing a logged set has no note field and keeps stored notes (Adam's steps)
Severity: deferred
Chunk: 4
What happened: Chunk 4 is merged into master (PR #12, `89719b1`). Every check I can run passed: jsdom and service tests, proven by injected breaks; typecheck, build, every script. I also called `updateSetLog` directly with a stray `note`, and the Supabase payload was `{weight, reps, rir}`. TASKS.md's verification and done-when need the deployed app and an Adam-scoped query, which I can't reach (entry 31).
**Your steps:**
1. Before your next session, record your stored set notes in the SQL Editor:
   `select id, note from v2_set_logs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and note is not null order by id;`
   It may return nothing. Set-note editing was the only way to write one, so that's possible.
2. Open https://overload-v2-sage.vercel.app. If the update/RELOAD banner shows, take it. The chunk 4 merge is `89719b1`; if the Vercel dashboard is handy, confirm its production deploy is Ready.
3. In your next real session, log a set, then tap it to edit. The edit form should show weight, reps and the RIR chips with its save/cancel controls, and **no Note field**, laid out cleanly at phone width. Change the reps by one and save, then change it back and save.
4. Re-run the step 1 query. The result must be identical: same ids, same notes. Then check the edited set:
   `select id, reps, note from v2_set_logs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' order by logged_at desc limit 3;`
   That set should show its original reps, and `note` should be `null`.
5. Tell me the result. A failure is blocking.
A competent default would: count the payload tests as proof — doesn't apply because: TASKS.md's done-when is the deployed form and the stored note, checked live.
Cost of deferral: if it fails, chunk 4 is fixed and re-merged. Nothing later depends on it.
Provisional path taken: merged; the build stops at the chunk 4 boundary as instructed (chunk 5 needs 027).
Answer:
