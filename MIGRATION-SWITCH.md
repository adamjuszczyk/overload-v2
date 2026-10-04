# Switching to automatic Supabase migrations

Status: **plan, waiting for Adam's go-ahead.** Nothing below has been run against production. Nothing in this file has been committed to master.

Goal: once this is done, merging a PR that adds a migration applies it to production, and every PR gets a Supabase preview database built from the repo's migrations, with a passing check.

Scope: no application code. `scripts/check-migration.mjs`, `scripts/migration-rules.mjs` and `scripts/check-context-size.mjs` are not changed. `build/chunk-1` and its migration 027 are not touched; 027 is not applied by hand.

---

## 1. What the docs and the CLI source say

Sources, read on 2026-10-04 rather than from memory:
- Supabase docs source, `supabase/supabase` at `7353782` (2026-10-03): `guides/deployment/branching.mdx`, `branching/github-integration.mdx`, `branching/working-with-branches.mdx`, `branching/troubleshooting.mdx`, `branching/configuration.mdx`, `deployment.mdx`, `database-migrations.mdx`, `platform/manage-your-usage/branching.mdx`, and the CLI reference (`spec/cli_v1_commands.yaml`).
- Supabase CLI source, `supabase/cli` at `66ccc6f` (2026-10-02): the TypeScript CLI (`apps/cli`) and the Go library the platform's runner is built on (`apps/cli-go/pkg/migration`).
- Supabase CLI **2.119.0** from npm, run in this session against a local `supabase/postgres:17.6.1.011` container: `migration list`, `migration repair`, `db dump`. The outputs quoted in section 4 come from those runs.

### 1.1 How a version is read from a file name; do `001_…` names work?
- Both CLIs match `^([0-9]+)_(.*)\.sql$`. The **version is the leading digits exactly as written** (`001`, not `1`), stored as `text` in `supabase_migrations.schema_migrations.version`. Everything after the first `_` is the name.
- Local and remote versions are compared **as strings**, both sides sorted lexically (`FindPendingMigrations` in `pkg/migration/apply.go`; `findPendingMigrations` in `apps/cli/src/command-internal/migration-pending.ts`).
- **So `001_…`–`026_…` work as they are. No file has to be renamed.** `migration repair` accepts `001` (numeric check only) and finds the file by the prefix `001_`. Rehearsed: repair of `000 … 026` inserted rows `000`…`026`, and `migration list` showed Local = Remote for all 27.
- What the string comparison means for later files:
  - A new file has to sort **after** the last applied version. `028_…` does; so does a 14-digit timestamp (`20261005…` sorts after `0…` because `2` > `0`). Once one timestamp file exists, a later `028_…` would sort **before** it, and the deploy stops with "Found local migration files to be inserted before the last migration on remote database." So mixing is one-way: NNN, then timestamps, never back.
  - Keep a fixed width (three digits). `99_…` would sort after `100_…`.
  - **A reused number is skipped without an error.** Matching is on the version alone: if `028_a.sql` is applied and another PR later merges `028_b.sql`, the deploy sees remote `028` = local `028`, treats it as applied, and never runs it. Nothing fails. Two parallel PRs that both pick the next number cause exactly this.
- Each migration file runs inside one transaction on branches, so `create index concurrently` fails there. None of 001–026 uses it (checked by grep).

### 1.2 How production's history has to look for 001–026 to count as applied
- Deploying runs the local files that come after the remote history, in order. It **stops** if the remote history holds a version that has no local file ("Remote migration versions not found in local migrations directory").
- So production's `supabase_migrations.schema_migrations` must hold **exactly** one row per file in `supabase/migrations` on master — `000` (the baseline, section 1.3) and `001`–`026` — and nothing else. Then the first file deployed is the next one merged (027).
- The rows have to be written by `supabase migration repair --status applied <versions>`, run from a checkout whose `supabase/migrations` holds exactly those files. It inserts `version`, `name` and **`statements` (the file's SQL, split into statements)**. Don't insert the rows by hand: a hand-inserted row has no statements, and a preview's "Pull" step reads production's history (section 1.3).
- `migration repair` only writes the history table. It runs none of the SQL in the files (docs caution box, and the CLI source).

### 1.3 How a preview database gets the objects the repo has no migration for
- Docs: a branch "is created as a clone of your base project … Its database schema is not cloned. Instead, it is built from the migrations you commit to your repository." Branches start with no data; seeding comes only from seed files.
- A branch is a real Supabase instance, so Supabase's own objects already exist there: the `auth` schema with `auth.users` and `auth.uid()`, the `anon` / `authenticated` / `service_role` roles, and the platform extensions. Locally, the `supabase/postgres` image has all of these too.
- **What Overload v1 created** (`exercises`, the v1 tables, any v1 functions, triggers and policies) exists **nowhere** in this repo. The only way a preview gets it is a migration that creates it. That's the baseline: `supabase/migrations/000_v1_baseline.sql`, sorted before `001`, holding exactly the pre-001 state. It's marked applied on production and never runs there.
- **The docs can be read two ways here.** The deploy workflow has a "Pull" step ("Retrieves database migrations from your main project"), and `working-with-branches.mdx` says "The preview branch inherits the migration history of your base project, so it only applies migrations that haven't been run yet."
  - Reading A: the preview fetches production's history rows, with their SQL, as migration files, then runs everything on its empty database. This matches "built from the migrations you commit" and "a reset reruns all migrations".
  - Reading B: the preview copies production's history and skips those versions, which would leave it with an empty schema.

  Under either reading, a PR that adds no migration could get a green check, so the check alone can't tell them apart. That's why verification step V3 (section 6) compares the preview's real schema with live. Under reading A, the `statements` stored by `repair` are what the preview runs, which is another reason to never insert the rows by hand.
- **Default privileges.** New branches "are created without default privileges on the `public` schema, regardless of the setting on your base project." Tables created on a preview by 000–026 therefore get no grants to `anon`/`authenticated`, and the Data API answers `42501` on the preview. The migrations still run, so the check still passes. The docs' fix is three `alter default privileges` statements at the top of the first migration. That's choice C3.

### 1.4 Other facts that shape the plan
- **Plan tier.** "The GitHub integration and CLI-based deployments work on all plans. Branching (preview environments for pull requests) requires the Pro Plan." Each preview is billed by usage (Micro compute from $0.01344/hour) and is **not covered by the Spend Cap**. Previews are deleted when the PR is merged or closed.
- **What a production deploy changes:** new migrations, plus Edge Functions and Storage buckets declared in `config.toml`. API, Auth and seed settings are ignored for production unless a `[remotes]` block opts in. On preview branches, `config.toml`'s `[api]` and `[auth]` settings *are* applied.
- **The docs recommend a required check:** turn on "Require status checks to pass before merging" for the Supabase check. The docs' sample workflow names the check `Supabase Preview`.
- **`supabase db dump` needs Docker.** It runs `pg_dump` in a container; in this session it pulled `supabase/postgres:17.11.0.002` to do it. On Windows that means Docker Desktop running.
- **None of the commands needs a database password.** `db query --linked` goes through the Management API using your `supabase login` token. `db dump`, `migration list` and `migration repair` with `--linked` and no password ask the Management API for a temporary login role. `link` doesn't prompt for a password (CLI 2.119.0). Your DB password is never typed and never leaves your machine.
- **Never run `db dump --dry-run`.** The CLI source warns that it prints the resolved database password in clear text.
- `supabase link` writes `supabase\.temp\` on your machine. It must not be committed (handled by `supabase/.gitignore`, section 3).

---

## 2. Choices the docs leave open — yours, not decided here

| # | Choice | Options | What follows from each |
|---|---|---|---|
| C1 | **Plan tier** | Pro (or higher) already / upgrade / stay on Free | Previews exist only on Pro. On Free, "deploy from master" still works, but no PR gets a preview, so the "preview check passes" goal can't be met as written. The alternative would be a GitHub Action that replays the migrations on a Postgres container — a different design, not planned here. |
| C2 | **Northstar's objects in the baseline** | (a) leave them out; the comparison excludes them by a name list you confirm / (b) include them | The dump is of the whole `public` schema, so it holds Northstar's table *definitions* (no rows; a schema dump has no data). (a) keeps Overload's repo to Overload; previews lack Northstar's tables, which Overload never reads. (b) makes previews a full copy of the shared schema, but this repo then carries Northstar's schema, and any hand change Northstar makes later shows up as drift. Either way the dump is a read of Northstar's schema (not data) — say if that's not acceptable and I'll give you a narrower route. |
| C3 | **Default privileges on previews** | (a) add the docs' three `alter default privileges … grant … to anon, authenticated, service_role` lines at the top of `000` / (b) leave previews secure-by-default | (a) previews match production's grants, so the app could be pointed at a preview. Production is unaffected because `000` never runs there. The docs pair this with checking that **Data API settings → "Default privileges for new entities"** is on for the base project (read-only check). (b) previews answer `42501` through the Data API; migration checks still pass. |
| C4 | **"Supabase changes only"** in the integration | off / on | The goal says *every* PR gets a preview, and the test PR adds no migration, so the goal needs **off**: every PR — including the build reviewer's docs-only ones — creates a billed preview. With **on**, PRs that don't touch `supabase/` get no preview and no check; a ruleset requiring the check would then block them. |
| C5 | **Numbering after 027** | keep three-digit `NNN_` / switch to 14-digit timestamps | Both work (1.1). NNN keeps the repo's convention and CONTEXT.md's "Next migration number". Timestamps make collisions between parallel PRs unlikely. One-way: after one timestamp file, NNN can't come back. |
| C6 | **Guard against reused or out-of-order numbers** | add a new `scripts/check-migration-order.mjs` (+ test): exits 1 when a new file's version is ≤ the highest on master, or when two files share a version / don't add one | Without it, the silent skip in 1.1 is caught by nobody: the deploy reports success. It's a new script; the three shared scripts stay untouched. |
| C7 | **Seed on previews** | off (`[db.seed] enabled = false`) / add a `supabase/seed.sql` | With seed off, previews hold schema only, which is all the check needs. A seed file would put sample rows in previews and never reaches production. |
| C8 | **Ruleset on master requiring the preview check** | decide after V3, when the check's real name has appeared | Steps in section 7. |

---

## 3. Files

No file is renamed. `001`–`026` are not edited.

| File | Change | Why |
|---|---|---|
| `supabase/migrations/000_v1_baseline.sql` | **add** | The pre-001 state: everything Overload v1 created (C2 decides whether Northstar's objects are in), derived from the live dump minus what 001–026 add or change, so that `000` + `001…026` replays to the live schema. Header comment says it's marked applied on production and never runs there. C3 decides the privilege lines. |
| `supabase/config.toml` | **add** | Generated by `supabase init` (CLI 2.119.0), then `project_id = "overload-v2"`, `[db] major_version = 17`, `[db.seed] enabled = false` (C7). Declares no Edge Functions and no Storage buckets, so a production deploy changes migrations only. |
| `supabase/.gitignore` | **add** | `.temp`, `.branches`, `.env` — keeps `supabase link`'s local state out of git. |
| `scripts/schema-snapshot.sql` | **add** | One read-only catalog query → one JSON document. Covers schemas; tables (kind, owner, RLS on/forced, options); columns (relative order, type, not null, default, identity, generated, collation); constraints (`pg_get_constraintdef`); indexes (`pg_get_indexdef`); policies (command, permissive, roles, `using`, `with check`); functions (signature, return type, language, security definer, volatility, `proconfig`, md5 + length of `prosrc`); views (`pg_get_viewdef`, `security_invoker`); triggers; enums and sequences; table, view and function grants; `pg_default_acl`; extensions (name, schema, version). Scope: `public`, plus triggers and policies that user code put on `auth`/`storage` tables. Reads `pg_catalog` only — no table rows. |
| `scripts/compare-schema.mjs` + `scripts/compare-schema.test.mjs` | **add** | Diffs two snapshots per category with sorted keys (Checks that lied #2), prints every difference, exits 1 on any. Takes an exclusion list (C2) and reports extension-version differences separately. The test proves it by injecting a break per category (Checks that lied #11). Runs under `node --test "scripts/*.test.mjs"`. |
| `scripts/replay-migrations.sh` | **add** | For a Linux session with Docker (this one, or the reviewer's): starts `supabase/postgres` at production's exact version, applies `000…NNN` in order with `ON_ERROR_STOP`, writes the snapshot. |
| `scripts/live-counts.sql` | **add, after the dump** | Before/after row counts, **every query filtered to `user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'`**. It covers every Overload table that has a `user_id` column (`v2_*`, `exercises`, v1's tables). Tables with no `user_id` column (`v2_exercise_libraries`, `v2_exercise_library_items`, any v1 catalog) can't be filtered, so they're listed in a comment and **not counted** — they're not your data and can't be scoped. Northstar's tables aren't counted (standing rule 11). |
| `scripts/check-migration-order.mjs` + test | **add only if C6 = yes** | 1.1's silent skip. |
| `MIGRATION-SWITCH.md` | this file | Updated with results as steps run. |
| `CONTEXT.md`, `HISTORY.md` | **update, last** | Section 8. |

Not committed: your live dump, live snapshot and row counts. The dump holds Northstar's schema, and the counts are your data. They stay in this session's scratch space.

---

## 4. The steps

All commands are for **cmd on Windows** (not PowerShell). Run them from your clone of the repo. `YOUR_PROJECT_REF` is the subdomain of `VITE_SUPABASE_URL`, also shown at **Dashboard → Project Settings → General → Project ID**; it isn't a secret.

The CLI is pinned to the version rehearsed here: every command is `npx --yes supabase@2.119.0 …`.

### Step 0 — checks, all read-only (you)

| | Do | Expect | If not |
|---|---|---|---|
| 0.1 | Dashboard → your organization → **Billing**: which plan? | Pro or higher | C1 |
| 0.2 | Dashboard → project → **Project Settings → Integrations → GitHub Integration**: is a repository already connected? | Nothing connected | **Stop and tell me which repo.** A project connects to one repo; if it's Northstar's, switching it would change Northstar's flow. |
| 0.3 | Dashboard → **Integrations → Data API → Settings**: is "Default privileges for new entities" on? (look only) | On or off — tell me which | Feeds C3 |
| 0.4 | `node --version` | `v20` or later | Install Node 20+ |
| 0.5 | Start Docker Desktop, then `docker info` | a line `Server Version: …` | `db dump` won't run without it |
| 0.6 | `npx --yes supabase@2.119.0 --version` | `2.119.0` | Tell me what it printed |

Reverse: nothing to reverse.

### Step 1 — after your go-ahead, I prepare the branch (me)
I commit `supabase/config.toml`, `supabase/.gitignore`, `scripts/schema-snapshot.sql`, `scripts/compare-schema.mjs` + test and `scripts/replay-migrations.sh` to `claude/elegant-noether-npjz4b`. I prove the compare script by injected breaks, and run the snapshot locally through `supabase db query --db-url` so I can quote the exact output shape. No PR yet.

Reverse: revert the commits.

### Step 2 — log in, link, capture the live state (you, read-only)

```
cd /d C:\path\to\overload-v2
git fetch origin
git checkout claude/elegant-noether-npjz4b
git pull
npx --yes supabase@2.119.0 login
npx --yes supabase@2.119.0 link --project-ref YOUR_PROJECT_REF
```
- `login` opens a browser for you to sign in. Expect `You are now logged in. Happy coding!` (or `You are now logged in.`).
- `link` expects `Finished supabase link.` It asks for no password. It writes `supabase\.temp\`, which git ignores.

```
npx --yes supabase@2.119.0 migration list --linked
```
Expect `Connecting to remote database...`, then a table with a `Local` and a `Remote` column: `001`…`026` under Local, **nothing under Remote**. If **any** version appears under Remote, stop and send it to me — someone (v1, Northstar, a dashboard action) has written history, and section 1.2 changes.

```
npx --yes supabase@2.119.0 db dump --linked -f live-schema.sql
```
Expect `Dumping schemas from remote database...` and `Dumped schema to C:\…\live-schema.sql.` The first run may also show Docker pulling a `supabase/postgres` image. The file has definitions only, no rows.

```
npx --yes supabase@2.119.0 db query --linked -f scripts\schema-snapshot.sql -o json > live-snapshot.json
```
Expect `Connecting to remote database...` on screen. `live-snapshot.json` is a JSON array holding one row with one `snapshot` column; I'll confirm the exact shape in step 1. It reads catalogs only, no rows.

Send me `live-schema.sql` and `live-snapshot.json` (attach them to your message).

Reverse: all read-only. `npx --yes supabase@2.119.0 unlink` removes the link and `npx --yes supabase@2.119.0 logout` removes the login token. Delete the two files.

### Step 3 — baseline, replay, compare (me)
1. I sort every object in the dump into: created or changed by 001–026 (traced file by file); created by v1; Northstar's or otherwise unexplained. **You confirm the v1/Northstar split** before it goes into `000` (C2).
2. I write `000_v1_baseline.sql` = v1's objects as they were before 001. Columns 001/013/019 added to `exercises`, and anything else 001–026 added, are left out so the migrations add them. Plus the C3 lines if chosen.
3. `scripts/replay-migrations.sh` replays `000` then `001…026` on `supabase/postgres` at production's exact version (the snapshot records it; the 026 comment says 17.6.1.141). It snapshots the result, then `node scripts/compare-schema.mjs live-snapshot.json replay-snapshot.json`.
4. As a second, independent check, I dump the replay with the same CLI command you used and diff it against `live-schema.sql`, after normalising only blank lines and ordering.
5. **Any difference stops the switch.** Column order is compared too (relative order of live columns). If Northstar added a column to `exercises` after 001, that's a difference the baseline can't reproduce, and it comes to you, not to a workaround.

Then I write `scripts/live-counts.sql` from the table list, and open the **switch PR** to master: baseline, `config.toml`, `.gitignore`, scripts, this file. `check-migration.mjs` will flag the new `000` file; the merge is yours.

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
```
git checkout master
git pull
dir /b supabase\migrations
```
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
Expect 27 rows, each with the same version under Local and Remote, `000` through `026`, and nothing else. Send me the output; this is verification V2.

Reverse: `npx --yes supabase@2.119.0 migration repair --linked --status reverted 000 001 002 003 004 005 006 007 008 009 010 011 012 013 014 015 016 017 018 019 020 021 022 023 024 025 026`. It deletes those 27 history rows and touches no schema or data.

### Step 7 — turn on the GitHub integration (you, dashboard)
Labels as the docs give them on 2026-10-03. If your screen differs, stop and tell me what you see rather than guessing.
1. Dashboard → project → **Project Settings** → **Integrations**.
2. Under **GitHub Integration**, click **Authorize GitHub**. On GitHub, click **Authorize Supabase**. If GitHub asks where to install the Supabase app, choose your account and **Only select repositories → adamjuszczyk/overload-v2**.
3. Back on Integrations, choose the repository **adamjuszczyk/overload-v2**.
4. **Working directory:** `.`
5. **Production branch:** `master`
6. **Deploy to production:** on.
7. **Automatic branching:** on, if C1 = Pro.
8. **Supabase changes only:** per C4 (off for the goal as written).
9. Leave any other option at its default and tell me what it was.
10. Click **Enable integration**.

Reverse: same page → disable / remove the GitHub connection. On GitHub → **Settings → Applications → Installed GitHub Apps → Supabase → Configure** → remove the repo or uninstall. Delete any leftover previews under Dashboard → **Branches**. Production's history rows can stay (harmless) or be reverted as in step 6.

### Step 8 — the first production run (you look, I read GitHub)
Pushing to master, or possibly enabling itself, starts a production run against master. Dashboard → **Branches** → the production branch → **View logs**: expect every step to finish and the migrate step to apply **no** migration (history already lists `000`–`026`). I check master's latest commit on GitHub for a Supabase check run, so the reviewer later knows where to look for the production deploy.

If the run fails, nothing has been applied (the failure is the comparison of history to files). Stop and send me the log.

### Step 9 — the test PR (me, then you)
I open the closing docs PR (section 8). It adds **no migration**. Expect a comment from Supabase on the PR and a green check (`Supabase Preview` per the docs).

V3 — prove the preview really holds the schema (required, section 1.3). The PR comment or Dashboard → **Branches** shows the preview's project ref. Then:
```
npx --yes supabase@2.119.0 db query --linked --project-ref PREVIEW_REF -f scripts\schema-snapshot.sql -o json > preview-snapshot.json
```
It reads catalogs only, on a database with no rows. Send me the file. I compare it with `live-snapshot.json`: any difference other than the ones C2/C3 predict means the preview doesn't reproduce production.

Reverse: close the PR; its preview is deleted.

### Step 10 — after counts (you, read-only)
```
npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > counts-after.json
```
I diff it against `counts-before.json`. They must be identical: nothing in this switch writes your data. Verification V4.

---

## 5. Order, and why
History is written (step 6) only after master holds the baseline file (step 5). The integration is turned on (step 7) only after the history matches master's folder exactly. In any other order, a production run would see a history version without a file, or a file without a history row, and fail. Or worse: if the integration were on while the history was empty, it would try to run `000`–`026` against production.

**Never apply a migration by hand again after step 7.** The integration would then run the same file again on the next deploy. If an emergency hand apply ever happens, it has to be followed at once by `migration repair --linked --status applied <that version>` from a checkout that holds the file.

`build/chunk-1` was cut before the switch, so it has no `000` and no `config.toml`. Before the chunk 1 PR's preview can build, master has to be merged into `build/chunk-1` — the reviewer's step on that branch, not mine. When the chunk 1 PR then merges, 027 is the first migration deployed automatically.

---

## 6. Verification (what proves the switch, not "the integration is on")

| | Claim | Proof | Who |
|---|---|---|---|
| V1 | Replaying `000` then `001…026` from scratch gives exactly the live schema | `compare-schema.mjs`: 0 differences in tables, columns, types, defaults, constraints, indexes, policies, functions, views (plus triggers, grants, default privileges, enums, sequences); second check: dump-vs-dump diff. Any difference stops the switch. | me, from your step 2 files |
| V2 | Production's history = every file up to 026, applied, nothing beyond | `migration list --linked` after step 6: 27 rows `000`–`026`, Local = Remote | you run, I read |
| V3 | A PR with no migration gets a preview whose check passes, **and the preview holds the real schema** | green check on the step 9 PR + preview snapshot = live snapshot (C2/C3 differences only) | you run the query, I compare |
| V4 | Your data is untouched | `counts-before.json` = `counts-after.json`, every count filtered to your user_id | you run, I diff |

---

## 7. Ruleset requiring the preview check (C8 — your decision; steps only)
After V3, once the check has run at least once, so GitHub knows its name:
1. GitHub → **adamjuszczyk/overload-v2** → **Settings** → **Rules** → **Rulesets** → **New ruleset** → **New branch ruleset**.
2. **Ruleset name:** `master needs Supabase preview`. **Enforcement status:** Active.
3. **Target branches → Add target → Include default branch** (master).
4. Tick **Require status checks to pass**. **Add checks**, then type and select the Supabase check exactly as it appeared on the step 9 PR (the docs call it `Supabase Preview`).
5. Optional: add yourself under **Bypass list** (Repository admin), so a stuck preview can't lock you out.
6. **Create**.

What it changes: no PR merges into master until its preview check is green, the reviewer's included. With C4 = on, PRs that don't touch `supabase/` would have no check and would be blocked. Direct pushes to master must also have the check, which in practice means everything goes through PRs.

Reverse: the same page → the ruleset → **Delete ruleset**, or set Enforcement to Disabled.

---

## 8. What gets written into CONTEXT.md at the end (after V1–V4 pass)
- Repo facts: "Supabase deploys migrations from main: yes" (the integration's production branch is `master`). The hand-apply and transport rules move to HISTORY.md verbatim.
- The migration flow:
  - Additive migrations that `scripts/check-migration.mjs` passes are merged by the reviewer without you, and only once the PR's preview check is green.
  - Anything it flags, plus any new policy on an existing table, comes to you as a blocking DECISIONS.md entry, and the merge is yours.
  - After merging any migration, the reviewer checks the production deploy on master (where to look is recorded in step 8). A failed deploy is a blocking entry and stops the build.
  - A preview passing proves the migration runs, not that real data survives it.
  - Migrations are forward-only: never edit one that has been applied. Never hand-apply after the switch (section 5). Never reuse a number (1.1).
- The ruleset question, with section 7's steps, until you decide.
- Next migration number, numbering rule per C5, and the `build/chunk-1` merge-from-master note.
