# Switching to automatic Supabase migrations

Status: **approved 2026-10-04 with Adam's answers (section 2); in progress.** Step log in section 9. Switch PR merged (#13); production's history written (step 6).

Goal: once this is done, merging a PR that adds a migration applies it to production. Every PR into master gets a check that replays all of the repo's migrations, from scratch, on Supabase's own Postgres at production's version, and fails on any error.

Context (Adam, 2026-10-04): Northstar is abandoned. Its data stays in the database for now; deleting it is a later, separate decision. Current has its own project. This shared project is switched in place; nothing moves to a new project.

Scope: no application code. `scripts/check-migration.mjs`, `scripts/migration-rules.mjs` and `scripts/check-context-size.mjs` are not changed. `build/chunk-1` and its migration 027 are not touched; 027 is not applied by hand.

---

## 1. What the docs and the CLI source say

Sources, read on 2026-10-04 rather than from memory:
- Supabase docs source, `supabase/supabase` at `7353782` (2026-10-03): `guides/deployment.mdx`, `deployment/branching.mdx`, `branching/github-integration.mdx`, `branching/working-with-branches.mdx`, `branching/troubleshooting.mdx`, `branching/configuration.mdx`, `database-migrations.mdx`, `platform/manage-your-usage/branching.mdx`, and the CLI reference (`spec/cli_v1_commands.yaml`).
- Supabase CLI source, `supabase/cli` at `66ccc6f` (2026-10-02): the TypeScript CLI (`apps/cli`) and the Go library behind it (`apps/cli-go/pkg/migration`).
- Supabase CLI **2.119.0** from npm, run in this session against a local `supabase/postgres:17.6.1.011` container: `migration list`, `migration repair`, `db dump`. The outputs quoted in section 4 come from those runs.

### 1.1 How a version is read from a file name; do `001_…` names work?
- Both CLIs match `^([0-9]+)_(.*)\.sql$`. The **version is the leading digits exactly as written** (`001`, not `1`), stored as `text` in `supabase_migrations.schema_migrations.version`. Everything after the first `_` is the name.
- Local and remote versions are compared **as strings**, both sides sorted lexically (`FindPendingMigrations` in `pkg/migration/apply.go`; `findPendingMigrations` in `apps/cli/src/command-internal/migration-pending.ts`).
- **So `001_…`–`026_…` work as they are. No file is renamed.** `migration repair` accepts `001` (numeric check only) and finds the file by the prefix `001_`. Rehearsed: repair of `000 … 026` inserted rows `000`…`026`, and `migration list` showed Local = Remote for all 27.
- Rules that follow, enforced from now on by `scripts/check-migration-order.mjs` (C6):
  - Three digits, fixed width (C5). `99_…` would sort after `100_…`.
  - A new file must sort **after** the highest version on master, otherwise the deploy stops: "Found local migration files to be inserted before the last migration on remote database."
  - **A reused number is skipped without an error.** Matching is on the version alone: if `028_a.sql` is applied and another PR later merges `028_b.sql`, the deploy sees remote `028` = local `028`, treats it as applied and never runs it, and nothing fails. Two parallel PRs that both pick the next number cause exactly this.
- A migration that can't run inside a transaction (`create index concurrently`) applies with `db push` but fails when run per-file in a transaction. None of 001–026 uses it (checked by grep). The replay runs each file in one transaction, so it catches that too.

### 1.2 How production's history has to look for 001–026 to count as applied
- Deploying runs the local files that come after the remote history, in order. It **stops** if the remote history holds a version that has no local file ("Remote migration versions not found in local migrations directory").
- So production's `supabase_migrations.schema_migrations` must hold **exactly** one row per file in `supabase/migrations` on master — `000` (the baseline, 1.3) and `001`–`026` — and nothing else. Then the first file deployed is the next one merged (027).
- The rows are written by `supabase migration repair --status applied <versions>`, run from a checkout whose `supabase/migrations` holds exactly those files. It inserts `version`, `name` and `statements` (the file's SQL). It runs none of that SQL — only the history table changes (docs caution box and CLI source). Don't insert rows by hand: they'd have no statements, and the CLI's `migration fetch` / the platform's "Pull" step rebuild files from those statements.

### 1.3 Objects the repo has no migration for
- Whatever replays the migrations from scratch (the GitHub Action here; a Supabase preview on a paid plan) starts from an empty database. Supabase's own objects already exist there: the `auth` schema with `auth.users` and `auth.uid()`, the `anon` / `authenticated` / `service_role` roles, and the platform extensions. All of these come with the `supabase/postgres` image (checked: `auth.users`, `auth.uid()` and the roles exist in `17.6.1.011`; `postgres` is not a superuser there, as on the platform).
- **What Overload v1 created** (`exercises`, v1's tables, any v1 functions, triggers and policies) exists **nowhere** in this repo. The baseline `supabase/migrations/000_v1_baseline.sql` creates it. It sorts before `001`, holds exactly the pre-001 state, and is marked applied on production, so it never runs there.

### 1.4 Plan tier, and what the Free plan does and doesn't give
- "The GitHub integration and CLI-based deployments work on all plans. Branching (preview environments for pull requests) requires the Pro Plan." This project is on **Free** (C1), so automatic deploys from master work, and Supabase previews and automatic branching don't exist here.
- **What a production deploy changes:** new migrations, plus Edge Functions and Storage buckets declared in `config.toml` (this repo declares none). API, Auth and seed settings in `config.toml` are ignored for production unless a `[remotes]` block opts in (none here).
- **`supabase db dump` needs Docker.** It runs `pg_dump` in a container; in this session it pulled `supabase/postgres:17.11.0.002` to do it. On Windows that means Docker Desktop running.
- **None of the commands needs a database password.** `db query --linked` goes through the Management API with your `supabase login` token. `db dump`, `migration list` and `migration repair` with `--linked` and no password get a temporary login role from the Management API. `link` doesn't prompt for one (CLI 2.119.0). Your DB password is never typed and never leaves your machine.
- **Never run `db dump --dry-run`.** The CLI source warns that it prints the resolved database password in clear text.
- `supabase link` writes `supabase\.temp\` on your machine (`project-ref`, `postgres-version`, …). It's git-ignored by `supabase/.gitignore`. Its `postgres-version` file holds production's exact image version, which the replay pins to.

---

## 2. Adam's answers (2026-10-04)

| # | Choice | Answer | What it means here |
|---|---|---|---|
| C1 | Plan tier | **Free, no upgrade** | No Supabase previews, no automatic branching. A GitHub Action replays every migration on `supabase/postgres` at production's version and fails on any error (section 3). V3 becomes: a test PR touching `supabase/` gets a green replay check, and a test commit with a deliberately broken migration gets a red one, then is reverted. |
| C2 | Northstar's objects in the baseline | **(a) left out** | `000` holds v1's objects only. `compare-schema.mjs` excludes Northstar's objects by a name list Adam confirms in step 3. |
| C3 | Default privileges on previews | **moot, lines left out** | `000` has no `alter default privileges` lines. The replay runs on the `supabase/postgres` image, whose default privileges match a normal Supabase project. |
| C4 | Automatic branching / "Supabase changes only" | **automatic branching off** | |
| C5 | Numbering after 027 | **three-digit `NNN_`** | |
| C6 | Guard against reused / out-of-order numbers | **yes** | `scripts/check-migration-order.mjs` + test. It runs inside the replay check too, so it's enforced, not just available. |
| C7 | Seed | **off** | `[db.seed] enabled = false`. |
| C8 | Ruleset on master | **after V3: require the replay check** | Steps in section 7, filled in with the real check name once it exists. |

**One adjustment to C1, for C8 to work — say if you'd rather not:** the workflow runs on **every** PR into master, not only PRs touching `supabase/`. A required check that a path filter skips never reports, and GitHub then blocks the PR as "Expected — Waiting for status to be reported", so every docs-only or code-only PR would be stuck once C8 is on. Reporting "skipped" as green from a step that didn't replay would be a check whose pass and non-run look the same, so it always replays. The cost is one replay per PR: about two minutes of Actions time, mostly the image pull (measured in V3).

---

## 3. Files

No file is renamed. `001`–`026` are not edited.

| File | Change | Why |
|---|---|---|
| `supabase/migrations/000_v1_baseline.sql` | **add** (step 3) | The pre-001 state: everything Overload v1 created, no Northstar objects (C2). Derived from the live dump minus what 001–026 add or change, so that `000` + `001…026` replays to the live schema. Its header says it's marked applied on production and never runs there. |
| `supabase/config.toml` | **add** | Generated by `supabase init` (CLI 2.119.0), then `project_id = "overload-v2"`, `[db] major_version = 17`, `[db.seed] enabled = false` (C7). Declares no Edge Functions or Storage buckets, so a production deploy changes migrations only. |
| `supabase/.gitignore` | **add** | `.temp`, `.branches`, `.env` — keeps `supabase link`'s local state out of git. |
| `.github/workflows/migration-replay.yml` | **add** | The replay check. Job and check name **`migration-replay`**. Runs on every `pull_request` into `master` (see C1 adjustment) and on demand (`workflow_dispatch`). It runs `node scripts/check-migration-order.mjs origin/master`, then `bash scripts/replay-migrations.sh`; either failing fails the check. `permissions: contents: read`; no secrets, no network access to Supabase. |
| `scripts/replay-migrations.sh` | **add** | Starts `supabase/postgres` at the pinned production version (`SUPABASE_PG_IMAGE`, default in the script), waits for it, then applies every `supabase/migrations/*.sql` in byte order as `postgres` with `psql -v ON_ERROR_STOP=1 --single-transaction`. Stops at the first error, naming the file, and exits 1. Optional `--snapshot FILE` writes `scripts/schema-snapshot.sql`'s output for comparison. The container is removed on exit. |
| `scripts/schema-snapshot.sql` | **add** | One read-only catalog query → one JSON document. Covers schemas; tables (kind, owner, RLS on/forced, options); columns (relative order, type, not null, default, identity, generated, collation); constraints; indexes; policies (command, permissive, roles, `using`, `with check`); functions (signature, return type, language, security definer, volatility, config, md5 + length of the body); views (definition, `security_invoker`); triggers; enums; sequences; table, view and function grants; default privileges; extensions (name, schema, version). Scope: `public`, plus triggers and policies on `auth`/`storage` tables. Reads `pg_catalog` only — no table rows. |
| `scripts/compare-schema.mjs` + `scripts/compare-schema.test.mjs` | **add** | Diffs two snapshots per category with sorted keys (Checks that lied #2), prints every difference, exits 1 on any. Takes an exclusion list (C2); extension-version differences are reported separately. The test proves each category by injecting a difference (Checks that lied #11). Runs under `node --test "scripts/*.test.mjs"`. |
| `scripts/check-migration-order.mjs` + `scripts/check-migration-order.test.mjs` | **add** (C6) | Exits 1 if any file in `supabase/migrations` doesn't match `NNN_name.sql`, if two files share a version, or if a file added on the branch has a version ≤ the highest on the base branch. One named exception: `000_v1_baseline.sql` may arrive below 026 (exact name only; tested). Exits 2 if it can't check (same convention as `check-migration.mjs`). Edits to existing migrations are already flagged by `check-migration.mjs`. The test builds throwaway git repos, one per failure, and a passing case. |
| `scripts/schema-compare-exclude.txt` | **add** (step 3) | The Northstar names `compare-schema.mjs` ignores, one per line, as Adam confirms them. |
| `scripts/live-counts.sql` | **add** (step 3) | Before/after row counts, **every query filtered to `user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'`**, over every Overload table that has a `user_id` column (`v2_*`, `exercises`, v1's tables). Tables with no `user_id` column (`v2_exercise_libraries`, `v2_exercise_library_items`, any v1 catalog) can't be filtered, so they're listed in a comment and **not counted**. Northstar's tables aren't counted (standing rule 11). |
| `MIGRATION-SWITCH.md` | this file | Updated as steps run (section 9). |
| `CONTEXT.md`, `HISTORY.md` | **update, last** | Section 8. |

Not committed: your live dump, live snapshot and row counts. The dump holds Northstar's schema, and the counts are your data. They stay in this session's scratch space.

---

## 4. The steps

All commands are for **cmd on Windows** (not PowerShell). Run them from your clone of the repo. The project ref is `imhsawrghteqsmpklofv` (confirmed by Adam to match `VITE_SUPABASE_URL`; it isn't a secret). The CLI is pinned to the version rehearsed here: every command is `npx --yes supabase@2.119.0 …`.

### Step 0 — checks, all read-only (you)

| | Do | Expect | If not |
|---|---|---|---|
| 0.1 | Dashboard → your organization → **Billing**: which plan? | Free (C1) | — |
| 0.2 | Dashboard → project → **Project Settings → Integrations → GitHub Integration**: is a repository already connected? | Nothing connected | **Stop and tell me which repo.** A project connects to one repo. *(Result: `adamjuszczyk/overload-v2` already connected — see the step log; 0.2b added.)* |
| 0.2b | Same page, look only: write down every setting exactly as shown — working directory, production branch name, **Deploy to production** on/off, **Automatic branching** on/off, **Supabase changes only** on/off, anything else. Then Dashboard → **Branches** (if the page exists on Free): any runs or failures listed? | Settings as found | Feeds step 7. If Deploy to production is **on for `master`**, turn it **off** now (one toggle, reversible) until step 7, so no push to master runs a deploy against the empty history. |
| 0.3 | `node --version` | `v20` or later | Install Node 20+ |
| 0.4 | Start Docker Desktop, then `docker info` | a line `Server Version: …` | `db dump` won't run without it |
| 0.5 | `npx --yes supabase@2.119.0 --version` | `2.119.0` | Tell me what it printed |

(0.3 of the first draft — default privileges — dropped with C3.) Nothing to reverse.

### Step 1 — the branch (me)
I commit `supabase/config.toml`, `supabase/.gitignore`, the workflow, `scripts/replay-migrations.sh`, `scripts/schema-snapshot.sql`, `scripts/compare-schema.mjs` + test and `scripts/check-migration-order.mjs` + test to `claude/elegant-noether-npjz4b`. Each script is proven here by injected breaks, and the snapshot is run through `supabase db query --db-url` so I can quote its exact output shape. No PR yet: the replay can't pass until `000` exists (step 3).

Reverse: revert the commits.

### Step 2 — log in, link, capture the live state (you, read-only)

All of steps 2–10 run in a **separate worktree**: a second folder, from the same clone, so your own working copy and any uncommitted changes in it are never touched. (First attempt, 2026-10-04: `git checkout` refused because the clone has uncommitted changes to `CONTEXT.md`. Those changes are yours to keep or drop; nothing here needs them gone.)
```
cd /d C:\path\to\overload-v2
git fetch origin
git worktree add --detach ..\overload-v2-switch origin/claude/elegant-noether-npjz4b
cd /d ..\overload-v2-switch
git log --oneline -1
npx --yes supabase@2.119.0 login
npx --yes supabase@2.119.0 link --project-ref imhsawrghteqsmpklofv
type supabase\.temp\postgres-version
```
- `login` opens a browser for you to sign in. Expect `You are now logged in. Happy coding!` (or `You are now logged in.`).
- `link` expects `Finished supabase link.` It asks for no password. It writes `supabase\.temp\`, which git ignores.
- `type` prints production's Postgres image version (expected `17.6.1.141` or later). Send it to me; the replay pins to it.

```
npx --yes supabase@2.119.0 migration list --linked
```
Expect `Connecting to remote database...`, then a table with `Local` and `Remote` columns: `001`…`026` under Local, **nothing under Remote**. If **any** version appears under Remote, stop and send it to me — something (v1, Northstar, a dashboard action) wrote history, and 1.2 changes.

```
npx --yes supabase@2.119.0 db dump --linked -f live-schema.sql
```
Expect `Dumping schemas from remote database...` and `Dumped schema to C:\…\live-schema.sql.` The first run may also show Docker pulling a `supabase/postgres` image. The file has definitions only, no rows.

```
npx --yes supabase@2.119.0 db query --linked -f scripts\schema-snapshot.sql -o json > live-snapshot.json
```
Expect `Connecting to remote database...` on screen and nothing else. The file starts with `[` and holds one row: `[{"snapshot": {…}}]`. That's the shape `db query -o json` printed through `--db-url` in step 1; `--linked` goes through the Management API instead, and `compare-schema.mjs` accepts either shape. Reads catalogs only, no rows.

Send me the version line, the `migration list` output, `live-schema.sql` and `live-snapshot.json` (attach the files to your message).

Reverse: all read-only. In the worktree, `npx --yes supabase@2.119.0 unlink` and `npx --yes supabase@2.119.0 logout` undo link and login. At the very end (after step 10), `cd /d C:\path\to\overload-v2` then `git worktree remove --force ..\overload-v2-switch` deletes the worktree folder (`--force` because of the ignored `supabase\.temp` files and the captured JSON/SQL files in it). Your own clone is untouched throughout.

### Step 3 — baseline, replay, compare (me, with your confirmation)
1. I sort every object in the dump into three groups: created or changed by 001–026 (traced file by file); created by v1; Northstar's or otherwise unexplained. **You confirm the v1 / Northstar split**, and with it `scripts/schema-compare-exclude.txt`.
2. I write `000_v1_baseline.sql` = v1's objects as they were before 001. Columns 001/013/019 added to `exercises`, and anything else 001–026 added, are left out so the migrations add them.
3. `scripts/replay-migrations.sh --snapshot replay-snapshot.json` replays `000` then `001…026` on `supabase/postgres` at production's version. Then `node scripts/compare-schema.mjs --exclude scripts/schema-compare-exclude.txt live-snapshot.json replay-snapshot.json`.
4. Second, independent check: I dump the replay with the same CLI command you used and diff it against `live-schema.sql`, minus Northstar's objects.
5. **Any difference stops the switch.** Column order is compared too, as the relative order of live columns. If Northstar added a column to `exercises` after 001, that's a difference the baseline can't reproduce, and it comes to you, not to a workaround.

Then I write `scripts/live-counts.sql` from the table list and open the **switch PR** to master. Its own `migration-replay` run is the first real run of the check: green means `000`–`026` replayed on GitHub's runner too. `check-migration.mjs` will flag the new `000` file; the merge is yours.

Reverse: nothing has touched production. Close the PR.

### Step 4 — before counts (you, read-only, before anything is written to production)
```
npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > counts-before.json
```
Every count is filtered to your user_id. Send me the file.

### Step 5 — merge the switch PR (you)
The integration is still off, so nothing happens on Supabase. Vercel builds as usual: the PR changes non-`.md` files but no app code.

Reverse: revert the merge commit on master.

### Step 6 — write production's migration history (you; the first write to production — only the history table)
From master, **after** the switch PR is merged, so the folder holds exactly `000`–`026`:
In the worktree (`cd /d C:\path\to\overload-v2-switch`):
```
git fetch origin
git checkout --detach origin/master
git log --oneline -1
dir /b supabase\migrations
```
`git log` should show the switch PR's merge commit. The link from step 2 stays (it lives in the ignored `supabase\.temp`).
Expect 27 lines: `000_v1_baseline.sql`, then `001_v2_schema.sql` … `026_v3_coach_meso_analyses.sql`. No `027`.

```
npx --yes supabase@2.119.0 migration repair --linked --status applied 000 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022 023 024 025 026
```
Expect (rehearsed on the local copy):
```
Connecting to remote database...
Repaired migration history: [000 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022 023 024 025 026] => applied
Finished supabase migration repair.
Run supabase migration list to show the updated migration history.
```
Never run `migration repair` with **no** version list. That form wipes the history table and rebuilds it from whatever files are in the folder.

```
npx --yes supabase@2.119.0 migration list --linked
```
Expect 27 rows, each with the same version under Local and Remote, `000` through `026`, and nothing else. Send me the output; this is V2.

Reverse: `npx --yes supabase@2.119.0 migration repair --linked --status reverted 000 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022 023 024 025 026`. It deletes those 27 history rows and touches no schema or data.

### Step 7 — turn on the GitHub integration (you, dashboard)
Labels as the docs give them on 2026-10-03. If your screen differs, stop and tell me what you see rather than guessing.
1. Dashboard → project → **Project Settings** → **Integrations**.
2. Under **GitHub Integration**, click **Authorize GitHub**. On GitHub, click **Authorize Supabase**. If GitHub asks where to install the Supabase app, choose your account and **Only select repositories → adamjuszczyk/overload-v2**.
3. Back on Integrations, choose the repository **adamjuszczyk/overload-v2**.
4. **Working directory:** `.`
5. **Production branch:** `master`
6. **Deploy to production:** on (it's off today — step 0.2b).
7. **Automatic branching:** off (C4). On Free it may not be offered at all.
8. Leave any other option at its default and tell me what it was.
9. Click **Enable integration**.

Reverse: same page → disable / remove the GitHub connection. On GitHub → **Settings → Applications → Installed GitHub Apps → Supabase → Configure** → remove the repo or uninstall. Production's history rows can stay (harmless) or be reverted as in step 6.

### Step 8 — the first production run (you look, I read GitHub)
The next push to master, or possibly enabling itself, starts a production run against master. Two things to find out, since the docs don't say what Free shows:
- **where** you see a production deploy's result: Dashboard → **Branches** / the integration page / a check on master's commit;
- that this run applied **no** migration, because the history already lists `000`–`026`.

I look at master's latest commit on GitHub for a Supabase check run. Whatever we find is written into CONTEXT.md as the place the reviewer checks after each migration merge.

If the run fails, nothing has been applied (the failure is the history-vs-files comparison). Stop and send me the log.

### Step 9 — V3: the replay check proves itself (me, then you)
On a test PR from master titled **"DO NOT MERGE — replay check test"**:
1. Commit 1 touches `supabase/` harmlessly (a comment line in `supabase/config.toml`). Expect `migration-replay` **green**.
2. Commit 2 adds `supabase/migrations/028_replay_check_must_fail.sql` containing `alter table v2_does_not_exist add column x int;`. Expect **red**, with the log naming that file and `relation "v2_does_not_exist" does not exist`.
3. Commit 3 reverts commit 2. Expect **green** again.

Then you close the PR without merging. If it were ever merged at commit 2, the statement would fail on production too and nothing would be applied — but the title is there so it never is.

Reverse: close the PR.

### Step 10 — after counts (you, read-only)
```
npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > counts-after.json
```
I diff it against `counts-before.json`. They must be identical: nothing in this switch writes your data. V4.

Then the closing docs PR (CONTEXT.md, HISTORY.md, this file's log), and the ruleset steps (section 7) with the real check name.

---

## 5. Order, and why
History is written (step 6) only after master holds the baseline file (step 5). The integration is turned on (step 7) only after the history matches master's folder exactly. In any other order, a production run would see a history version without a file, or a file without a history row, and fail. Or worse: if the integration were on while the history was empty, it would try to run `000`–`026` against production.

**Never apply a migration by hand again after step 7.** The integration would run the same file again on the next deploy. If an emergency hand apply ever happens, it has to be followed at once by `migration repair --linked --status applied <that version>` from a checkout that holds the file.

`build/chunk-1` was cut before the switch, so it has no `000`, no `config.toml` and no workflow. Before the chunk 1 PR's `migration-replay` can pass, master has to be merged into `build/chunk-1` — the reviewer's step on that branch, not mine. Then, per the merge order in section 8, 027 merges on its own and is the first migration deployed automatically.

---

## 6. Verification (what proves the switch, not "the integration is on")

| | Claim | Proof | Who |
|---|---|---|---|
| V1 | Replaying `000` then `001…026` from scratch gives exactly the live schema (Northstar's objects excluded by the confirmed list) | `compare-schema.mjs`: 0 differences in tables, columns, types, defaults, constraints, indexes, policies, functions, views (plus triggers, grants, default privileges, enums, sequences). Second check: dump-vs-dump diff. Any difference stops the switch. | me, from your step 2 files |
| V2 | Production's history = every file up to 026, applied, nothing beyond | `migration list --linked` after step 6: 27 rows `000`–`026`, Local = Remote | you run, I read |
| V3 | The replay check is real: green on a PR touching `supabase/`, red on a deliberately broken migration, green after the revert | step 9's three runs on GitHub | me |
| V4 | Your data is untouched | `counts-before.json` = `counts-after.json`, every count filtered to your user_id | you run, I diff |

---

## 7. Ruleset requiring the replay check (C8, after V3)
Filled in with the real check name after step 9. Expected shape:
1. GitHub → **adamjuszczyk/overload-v2** → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset name:** `master needs migration-replay`. **Enforcement status:** Active.
3. **Target branches → Add target → Include default branch** (master).
4. Tick **Require status checks to pass**. **Add checks**, type `migration-replay`, and select it (source: GitHub Actions).
5. Optional: add yourself under **Bypass list** (Repository admin), so a broken runner can't lock you out.
6. **Create**.

Reverse: the same page → the ruleset → **Delete ruleset**, or set Enforcement to Disabled.

---

## 8. What gets written into CONTEXT.md at the end (after V1–V4 pass)
- Repo facts: "Supabase deploys migrations from main: yes" (the integration's production branch is `master`). The hand-apply and transport rules move to HISTORY.md verbatim. Northstar is abandoned, its data stays for now, and Current has its own project.
- The migration flow:
  - Additive migrations that `scripts/check-migration.mjs` passes are merged by the reviewer without you, and only once the PR's `migration-replay` check is green.
  - Anything it flags, plus any new policy on an existing table, comes to you as a blocking DECISIONS.md entry, and the merge is yours.
  - **A chunk with both a migration and code: merge the migration on its own first, wait for the production database deploy on master to succeed, then merge the code. A failed deploy is blocking, and the code is not merged.**
  - After merging any migration, the reviewer checks the production deploy on master (where to look is recorded in step 8). A failed deploy is a blocking entry and stops the build.
  - A green replay proves the migration runs on an empty database, not that real data survives it.
  - Migrations are forward-only: never edit one that has been applied. Never hand-apply after the switch (section 5). Numbers are three-digit and strictly increasing, never reused (`check-migration-order.mjs`).
- The ruleset (section 7) — as decided by then.
- Next migration number, and the `build/chunk-1` merge-from-master note.

---

## 9. Step log
- 2026-10-04 — plan written, answers received, file updated for C1–C8.
- 2026-10-04 — **step 0** (Adam): 0.1 Free. **0.2: the GitHub integration is already connected to `adamjuszczyk/overload-v2`** (expected: nothing). From GitHub: PR [#9](https://github.com/adamjuszczyk/overload-v2/pull/9)'s head carries a `Supabase Preview` check run from project `imhsawrghteqsmpklofv`, conclusion `skipped`, so the integration reacts to PRs. Migrations 020–026 reached master as direct pushes, not PRs; their Supabase results aren't visible through the tools here. Open until Adam reads the settings: whether "Deploy to production" is on, and for which production branch. If it's on for `master`, every push to master has started a production deploy against an empty history. The first statement that fails (001's `create table v2_programs`, since the tables exist) stops it, and each file runs in one transaction, so nothing should have applied — `migration list` in step 2 shows whether any history row was ever written. Step 7 becomes "change the existing integration's settings" rather than "connect".
- 2026-10-04 — **step 0 done** (Adam). 0.2b: working directory `.`, **Deploy to production off**, automatic branching off. Dashboard → Branches lists two failed production runs, 2026-09-29 22:16:40 and 22:27:51, both `git_ref=master` on project `imhsawrghteqsmpklofv`. Each ran "Applying migration... file=001_v2_schema.sql" and got the NOTICE `column "muscle_group" of relation "exercises" already exists, skipping`. That's 001's first statement, `add column if not exists`, a no-op either way. Then each stopped with `ERROR: relation "v2_programs" already exists (SQLSTATE 42P07)`. So the only statement that ran before the failure changed nothing, and no later file ran; `migration list` in step 2 confirms no history row was written. What the logs establish: (1) the real production runner reads `001_…` names as migrations, in order (section 1.1, now seen live); (2) it ran with no `supabase/config.toml` on master; (3) **the production deploy result is visible at Dashboard → Branches → the run's logs** on Free — where the reviewer's post-merge check points to, alongside any GitHub check found in step 8; (4) the production branch is `master`. 0.3 Node v24.14.1, 0.4 Docker 29.8.1, 0.5 CLI 2.119.0. Project ref `imhsawrghteqsmpklofv` confirmed.
- 2026-10-04 — **step 1 done** (commit on `claude/elegant-noether-npjz4b`). Proven in this session, on `supabase/postgres:17.6.1.141` in Docker, with a temporary stand-in for v1's `exercises` (the real `000` comes from your dump):
  - `replay-migrations.sh`: 27 of 27 files applied in ~12 s. A broken `028_…` file → exit 1, naming the file and the Postgres error. The container is removed either way.
  - `schema-snapshot.sql`: the same database read through psql and through `supabase db query --db-url -o json` → `compare-schema.mjs` IDENTICAL (24 tables, 268 columns, 104 constraints, 66 indexes, 25 policies, 869 grants, …).
  - `compare-schema.mjs` on real replays: without 026 → `v2_coach_meso_analyses` and its objects reported, exit 1. With one policy's `with check` altered in 017 → exactly that one difference reported, exit 1.
  - `compare-schema.test.mjs`: 9 tests, including a changed field, a missing object and an extra object in every one of the 15 categories. `check-migration-order.test.mjs`: 9 tests (reused number, number below base, two new files sharing a number, five bad names, unknown base → 2, no folder → 2, passing cases). `node --test "scripts/*.test.mjs"`: 49 of 49 pass (31 existing + 18 new).
  - `node scripts/check-migration-order.mjs origin/master` on this branch: OK (26 files, none new).
  - The workflow can't go green until `000` exists, so no PR yet.
- 2026-10-04 — **step 2 done** (Adam, from the worktree). `postgres-version`: **17.6.1.155**, so the replay is repinned to `supabase/postgres:17.6.1.155`. `migration list --linked`: Local `001`–`026`, **Remote empty** — no history row was ever written. `live-schema.sql` (3,307 lines, UTF-8) and `live-snapshot.json` received. The snapshot came as UTF-16LE with a BOM and CRLF, i.e. PowerShell's `>`, not cmd's. It contains no non-ASCII character at all, so PowerShell's re-encoding had nothing to mangle. `compare-schema.mjs` now reads UTF-16 (tested).
- 2026-10-04 — **step 3: baseline written, V1 passes** (pending Adam's confirmation of the split and the exclusion list).
  - Live `public` has 48 tables: **19 Northstar/Atlas** (15 `ns_*`, 4 `atlas_*`); **6 Overload v1** (`exercises`, `programs`, `workout_days`, `program_exercises`, `sessions`, `set_logs`); **23 `v2_*`** from 001–026. No foreign key between Northstar/Atlas and Overload in either direction; no triggers, types or sequences in `public`; one function (`reassign_exercise_history`, 021).
  - `000_v1_baseline.sql` = the 6 v1 tables with their keys, FKs, 12 indexes, RLS + 6 policies and grants, exactly as dumped, minus what 013 (2 columns, 2 CHECKs) and 019 (3 columns, 2 CHECKs, 1 FK) add to `exercises`. `exercises.muscle_group` is v1's (4th column, `NOT NULL`, indexed by v1's `exercises_user_muscle_idx`), so 001's `add column if not exists` was always a no-op. No other migration touches the other five v1 tables (grep).
  - **V1:** `replay-migrations.sh` on `17.6.1.155` (27 of 27 in ~13 s), then `compare-schema.mjs --exclude scripts/schema-compare-exclude.txt live-snapshot.json replay-snapshot.json` → **IDENTICAL**: 29 tables, 310 columns, 121 constraints, 83 indexes, 30 policies, 1 function, 3 views, 1,029 grants, 96 default privileges. What the exclusions removed was listed: exactly the 19 `ns_*`/`atlas_*` tables (+ their 183 columns, 101 constraints, 43 indexes, 40 policies, 608 grants) and the `supabase_migrations` schema, nothing else.
  - **Second check:** the replay dumped with the same CLI command (`db dump --db-url`) vs `live-schema.sql` with Northstar/Atlas statements removed → 452 statements each, **identical text and order** (this includes the full function body, not just its hash).
  - **Both checks proven by a break:** a scratch baseline without `exercises_user_muscle_idx` → the dump diff shows exactly that `CREATE INDEX`, and `compare-schema.mjs` reports exactly `indexes: only in live: exercises.exercises_user_muscle_idx`, exit 1.
  - `scripts/live-counts.sql` written from the replay's table list: 27 tables with `user_id` (6 v1 + 21 `v2_`), each filtered to Adam's user_id. `v2_exercise_libraries` / `v2_exercise_library_items` have no `user_id` and aren't counted; Northstar/Atlas aren't counted. Run on a replay through `db query --db-url`: 27 rows.
  - `node --test "scripts/*.test.mjs"`: 50 of 50.
- 2026-10-04 — **step 4 done** (Adam): `counts-before.json`, 27 rows (one per counted table), kept in the session's scratch space, not committed.
- 2026-10-04 — **switch PR** [#13](https://github.com/adamjuszczyk/overload-v2/pull/13) opened, after merging master (chunks 2–4, no `supabase/` change) into the branch. On the merged tree: `node --test "scripts/*.test.mjs"` 85 of 85 (the reviewer's transport round-trip now covers `000` too), `check-frozen-code` ok, `check-migration-order` OK, `check-migration origin/master` **SAFE**. **First `migration-replay` run on GitHub: green in 32 s.** The log shows `supabase/postgres:17.6.1.155` pulled (~24 s) and `ok` for each of `000`…`026`, then "27 of 27 migrations applied; public now has 29 tables". The integration's own `Supabase Preview` check reports `skipped` (Free plan). **Step 5:** Adam merged #13 → master `2905761`, `supabase/migrations` = `000`…`026` (27 files, no 027).
- 2026-10-04 — **step 6 done, V2 passes** (Adam, from the worktree on `origin/master`): `migration repair --linked --status applied 000 … 026`, then `migration list --linked` → 27 rows `000`–`026`, Local = Remote on every row, nothing else.
