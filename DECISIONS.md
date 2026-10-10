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
(Adam, 2026-10-04, after the switch) **027 goes live by merging the chunk 1 PR under the new flow.** `check-migration` flags 027's 8 statements, so the merge is Adam's once the PR's `migration-replay` check is green. After his merge, the reviewer checks the production database deploy on master (a failed deploy is blocking), runs the read-only probes, and writes Adam's live steps (open Today, Plan, Program and History; log one set in his next session) as a deferred entry. The pause at chunk 4 is lifted.
**State (2026-10-04, reviewer):** `build/chunk-1` now has master merged in (`a05b134`). Its diff against master is exactly `027_planner_p1_schema.sql`, md5 `3a0ead06…`, unchanged. PR [#17](https://github.com/adamjuszczyk/overload-v2/pull/17) is open.
- `migration-replay` is **green** on GitHub (run 37226926354).
- My local `scripts/replay-migrations.sh` on `supabase/postgres:17.6.1.155` agrees: 28 of 28 applied, `public` has 35 tables.
- `check-migration` still flags the 8 statements above, so the merge is yours. `check-migration-order` OK; `node --test "scripts/*.test.mjs"` 86/86.
**Your steps:**
1. **Before merging**, record the before counts: `npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > counts-before.json`.
2. Merge PR #17.
3. Tell me it's merged. I check `Supabase Preview` on master's merge commit; anything but success, or no check within a few minutes, is a failed deploy and blocking. Then I run the read-only API probes and write your live steps as a deferred entry.
4. After the deploy succeeds, run the same command again into `counts-after.json` and send me both files, or the two outputs. Every count must be equal.
**Closed (2026-10-04):** Adam merged PR #17 (`7f4405d`). He did not run counts; under his new standing rule (CONTEXT.md, Migration flow) an add-only migration like 027 needs none. 027 is live: see entry 37 for the deploy evidence and his live steps.

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

## 37 Chunk 1 live check after 027 deployed (Adam's steps), and two stuck deploy checks
Severity: deferred
Chunk: 1
What happened: Adam merged PR #17 (`7f4405d`, 2026-10-04 19:11 UTC). Under his standing counts rule, 027 is add-only, so no live counts are needed; its proof is the green `migration-replay` plus my scratch-copy check (row counts and per-row fingerprints unchanged on all nine altered tables). On master's merge commit GitHub shows **three** `Supabase Preview` runs:
- `111509721064`: success (19:12:16→19:12:22);
- `111509705063` and `111509600539`: still `in_progress` more than 8 minutes later.
That hasn't been seen before; the first automatic run had a single check. I tested the real outcome instead. `node scripts/probe-live-columns.mjs scripts/probe-specs/027.json` (anon key, every request filtered to Adam's user_id, `limit=0`, so no data can return) answered 36 of 36 probes as expected:
- every one of 027's 72 columns on the 15 tables answers `200 []`;
- each table's made-up control column answers `400 / 42703`;
- the six new tables show anon 0 rows.
The probe itself was proven: a spec with one non-existent column fails (`400 42703`, exit 1). So 027 is live; the deploy is not treated as failed.
**Your steps:**
1. Supabase Dashboard → Branches: open the production deploy log for `7f4405d` and check that it applied `027_planner_p1_schema` without error. Tell me if the two stuck runs show anything, e.g. a duplicate trigger.
2. Optionally, in the SQL Editor: `select version from supabase_migrations.schema_migrations order by version desc limit 3;` The top row should be `027`.
3. Open https://overload-v2-sage.vercel.app (take the update banner if shown). Today, Plan, Program and History each load your data as before, with no error toast. 027 changed no app code; this checks the old client against the new schema.
4. In your next real session, log one set. It saves normally: still there after a reload, and no pending-sync marker.
5. Tell me the results. A failed step is blocking.
A competent default would: treat the one successful run as the deploy result — doesn't apply because: CONTEXT.md says anything other than success counts as failed until you've read the Dashboard log, and two runs aren't success. The live probe is why I'm not treating it as failed; the log is yours to read.
Cost of deferral: if the log shows a problem, chunk 5+ work that reads 027's columns pauses. Nothing is merged on top of 027 until chunk 5's own checks pass.
Provisional path taken: 027 counts as live (probe evidence); continuing with chunk 5.
Answer:

## 38 Incident: 027 made the mesocycle query ambiguous; no mesocycles showed (fixed by PR #18)
Severity: deferred
Chunk: 1
What happened: After 027 deployed (2026-10-04 ~19:12 UTC), Adam reported no active and no completed mesocycles in the app. **Cause:** 027 added `v2_mesocycles.source_program_id → v2_programs`, a second FK next to `program_id`. PostgREST then refuses the un-hinted embed `v2_programs(id, name)` with `PGRST201` ("more than one relationship was found"). It's used by `fetchMesos` (the list, so it showed empty) and by `createMeso`'s `insert().select()`. START MESOCYCLE would have completed the active meso and inserted the new one before throwing. **Data was untouched:** 027 only adds, and Adam confirmed by query (MESO rows intact) and that he pressed nothing on the Program page. **Fix:** PR #18 (`c63808e`, merged by Adam 19:35, Vercel production deploy success 19:36:43) names the relationship, `v2_programs!v2_mesocycles_program_id_fkey(id, name)`, in both selects. The cause was confirmed live before fixing: the old select gave `PGRST201`, the hinted one gave `200`.
**Why every check missed it:** `migration-replay`, my scratch-copy checks and `probe-live-columns.mjs` all test SQL and columns. Embed resolution happens in PostgREST, which none of them ran.
**New check, proven:**
- `scripts/check-embeds.mjs` finds every embedding select in `src/` and `api/` (25 today) and resolves each through PostgREST with `limit=0`, either live (anon, Adam-filtered) or local.
- `scripts/check-embeds-local.sh` replays every migration (`replay-migrations.sh --keep`), starts `postgrest/postgrest:v12.2.3` against the result, and runs it.
- On the pre-fix code with 027 it fails exactly the two mesocycle selects (`PGRST201`, exit 1). On the fixed code it passes 25/25 locally and live.
- Its finder had its own swallowing bug: a select-less query swallowed the next one, `sessionService.ts:466`. It was fixed and a test was added, which is proven against both broken patterns.
A competent default would: rely on the replay check for migrations — doesn't apply because: it can't see API-level breakage, and this shipped to production.
Cost of deferral: none for the fix (it's live). The open question is only where the new check runs.
Provisional path taken: from now on I run `bash scripts/check-embeds-local.sh` on every migration PR before it merges (yours or mine), and `node scripts/check-embeds.mjs` live after its deploy. A migration that adds an FK between two tables that already have one must also hint every existing embed between them.
**Question for you:** should `check-embeds-local.sh` also run in the `migration-replay` GitHub workflow, so the ruleset enforces it? That changes `.github/workflows/migration-replay.yml`, which your switch session owns, so it's your call.
Answer:

## 39 B1: a finished session reads SKIPPED with its numbers, plus a second empty in-progress one (cause not yet confirmed)
Severity: blocking
Chunk: none (live bug report, 2026-10-10)
What happened: Adam finished Friday 2026-10-09's pull workout with every set logged. History shows that session as SKIPPED with all its numbers. Saturday morning the app opened on a second session of the same workout, already started, with no numbers and an absurd session time; he finished it, so it's now logged a second time, empty. **I could not read the data.** The dev environment has only the anon key and a test account that owns no data; a select filtered to Adam's user_id returns `[]` (probed 2026-10-10), which is exactly what RLS gives anyone who isn't Adam, so it says nothing about whether the rows exist. Signing in as Adam is Escalation 3, so the cause below is from the code only.
**What the code says (read 2026-10-10, not run against his data).** Every write that sets `v2_sessions.status = 'skipped'`:
- `skipSession(id)` (`sessionService.ts`), a bare `update({ status: 'skipped' })` that touches nothing else, so the set logs stay. Callers: **REDO SESSION → CONFIRM** (`CompletedTodayScreen.tsx` `handleRedo`, which then immediately calls `createSession` for the same workout, dated today, `in_progress`, `started_at` = now), and MARK SKIPPED on the missed-session prompt (`skipMissedSession` with `existingSessionId`).
- `completeSession` (all logged sets are `is_skipped`; not this case, the sets here have numbers).
- `useSkipSession` offline (queue form of the first).
The scheduler only hands MARK SKIPPED an `existingSessionId` for a `planned` row (anything completed/in-progress/skipped counts as handled), and a `planned` row never has set logs. So the one path that leaves a *logged* session `skipped` and creates a fresh `in_progress` one for the same workout is **REDO SESSION → CONFIRM on Friday after finishing**; the new row's `started_at` would be Friday evening, which is the absurd Saturday-morning session time. That fits both symptoms, but it needs a deliberate two-step tap (REDO SESSION, then CONFIRM), and Adam hasn't said he did that. I am not treating it as the cause until the rows say so.
**Findings that stand regardless of the cause:** REDO's confirm text says "current session is marked skipped and all inputs clear" and the button caption says "discarded", but the old session's set logs are kept, so a REDO leaves exactly the shape in this report in History: a SKIPPED session full of numbers. The two sessions also can't be told apart in History except by status.
**Update 2026-10-10 (Adam): Friday's gym connection was bad, and he doesn't remember tapping REDO.** So REDO is one candidate among several, and the offline paths are the likelier ones. From the code (read, not run, not reproduced):
- **Retried start.** The online `createSession` inserts with no client-side id (the offline branch uses a client uuid), and mutations have no retry. A start whose response is lost on a bad connection errors, the START button comes back, and the next tap inserts a second `in_progress` row for the same workout and date.
- **Offline finish judged from a partial copy.** `useCompleteSession` offline decides `skipped` from Dexie's copy of this session's logs, which only holds sets logged *while offline*. If that subset is all skip rows (say, skipped sets at the end after the signal dropped), the session is written `skipped` with `completed_at` taken from that subset, though the numbered sets are on the server. The code comment says this "never" gives a false skipped, true only when the copy is empty. A `skipped` row of its own doesn't block a new virtual START for the same workout today (`scheduler.ts` `needsVirtualSuggestion`), so Today would then offer START again.
- **Finish before the sets synced.** The online finish reads only server-side logs, so sets still in the offline queue are missed: `completed_at` comes out null or early.
- **Queue replay.** `flushSyncQueue` is not guarded against overlapping runs (the connection flipping online/offline can start several, each reading the same queue snapshot), replays in `createdAt` order, and keeps an item that failed fewer than 3 times while later items go ahead. An old start payload (`status: in_progress`) written after a finish leaves `completed_at` set, so the row reads in-progress but finished.
**Run this in the Supabase SQL Editor (one SELECT, read-only, filtered to your user_id, writes nothing) and send me the result table** (export as CSV or copy the grid): the contents of `scripts/b1-session-forensics.sql`. It returns one row per session since 2026-10-01 with status, dates, `created_at` (server clock) vs `started_at` (phone clock), set-log counts, and a plain-words `reading` column. How to read it (times UTC):
- **REDO:** the empty `in_progress` row has the same date and was started minutes after the other row finished (`s_since_prev_completed` small and positive), `server_lag_s` about 0, the other row `SKIPPED_BUT_HAS_NUMBERS`.
- **Retried start:** two `in_progress`-then-one-finished rows for the same workout, `s_since_prev_start` in seconds, `server_lag_s` about 0.
- **Offline finish from a partial copy:** the skipped row has both numbered and skip sets (`logs_skipped` > 0), `completed_minus_last_log_s` is not 0 or `INSERTED_LONG_AFTER_START` is set, and no REDO-style second row minutes after it. The extra START then came later from Today's fresh offer.
- **Queue replay:** `IN_PROGRESS_BUT_HAS_COMPLETED_AT`, `SETS_NEWER_THAN_COMPLETED_AT` or `FINISHED_WITHOUT_COMPLETED_AT`; `row_txid` / `logs_txid_*` give the order of the last writes.
- Any other `SKIPPED_BUT_HAS_NUMBERS` rows in the output: the corruption is broader than this one session (Escalation 4). Stop and tell me.
Checked 2026-10-10 on an in-memory Postgres (pglite) against hand-built fixtures for each shape above, plus another user's row that must not appear. That proves the query runs and flags those shapes, not that any of them happened.
**Cleanup, by shape, not run.** If it is the REDO shape (S1 = skipped with numbers, S2 = the empty in-progress one that was finished): `update v2_sessions set status = 'completed' where id = '<S1>' and user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and status = 'skipped';` (S1's `completed_at` and set logs are already there) and `delete from v2_sessions where id = '<S2>' and user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and status = 'completed' and not exists (select 1 from v2_set_logs where session_id = '<S2>');` (S2 has no set logs; check `v2_session_exercise_swaps` for it too, `on delete set null`, so none is lost). Ids come from the script's output. Any other shape gets its own cleanup after I see the rows. Counts before and after: `v2_sessions` for your user_id should be one fewer; `v2_set_logs` unchanged.
A competent default would: change the code that most likely did it and ship — doesn't apply because: the likeliest path (REDO) is a deliberate feature, so "fixing" it is a product decision (keep the logs and show the session as redone? delete the old session and its logs? stop marking it skipped?), and a fix to the wrong path would leave the real one live while the training data keeps getting corrupted.
Cost of deferral: nothing is merged for B1. Another REDO, or the real cause, can corrupt another session in the meantime; until this is answered, avoid REDO SESSION and double-check History after a session.
**Provisional path taken:** B2 (Move offers only today and later days) shipped separately. B1 waits on the query output, then I write a failing test for the confirmed path, fix it, and merge.
**Questions for you:** (1) the query's result table; (2) once the cause is known, what should REDO / the offline finish do: what should REDO do with the old session: delete it and its logs, keep it as completed, or keep it as skipped but visibly redone?
Answer:

