# Overload 1.2.1 — release run sheet (Adam)

*TASKS.md "Release", steps 1–8, in your order. Written 2026-10-31 by the release reviewer from `docs/release-1.2-run-sheet.md`; also in the repo as `docs/release-1.2.1-run-sheet.md`.*

- *Every command is Windows **cmd**, not PowerShell (PowerShell's `>` writes UTF-16). Run them from your `overload-121` clone (linked to production; the project-ref check in 0 confirms it), in one window from start to end.*
- *Nothing here has been merged or run for you: each merge to master is yours. The migrations PR and the release PR don't exist yet; 4a and 5a make them.*
- *1.2.1 releases the 1.2 way (SPEC "Not this version"): a no-training window and 1.2's RELOAD banner. Maintenance mode and `min_version` are first used by 1.2.2 (the end of this sheet).*

**What's ready**
- **PR #278** (into `staging`): the 1.2.1 notes, 274's prototype fix and the re-taken pictures. Yours to edit and merge (step 1).
- **The release-wide `check-migration`**: 17 flags, all in 048, the same statements as DECISIONS "For the release". Nothing new to decide (step 2).
- **What ships to the database**: only `supabase/migrations/048_p121_release_state_and_deletes.sql` and its probe spec `scripts/probe-specs/048.json` (read 2026-10-31: `git diff --stat origin/master origin/staging -- supabase/migrations scripts/probe-specs` lists those two files, 218 lines).
- **The counts file**: `scripts/live-counts.sql`, already on master (27 tables, your rows only). For 048 it is the record, not a gate.
- **`v1.2.0`**: the tag and the GitHub Release "Overload 1.2" exist (published 2026-10-28). Nothing is left over from 1.2.

**Your order:** 0 → 1 → 2 → 4a and 5a (they only open PRs) → **3, the window opens** → 4b to 4f → 5c, **the window closes when Vercel reads Ready** → 6 → 7 → 8.

**Never paste a key, password or token into a message, a file in the repo, or anywhere but this cmd window. Never run `db dump --dry-run`: it prints the database password.**

---

## 0. Before you start

**A time when nobody trains (step 3).** Pick about an hour in which neither you nor your friend trains, and tell your friend. It runs from **3 (the backup)** until 5's Vercel deploy is **Ready**, so the backup is complete and the before and after counts can't differ because someone trained.

**Start Docker Desktop** and wait until it says it is running. `db dump` runs `pg_dump` in a container.

```cmd
cd /d C:\path\to\overload-121
git fetch origin
git checkout --detach origin/master
git log --oneline -1
type supabase\.temp\project-ref
docker info | findstr /c:"Server Version"
npx --yes supabase@2.119.0 --version
npx --yes supabase@2.119.0 migration list --linked
mkdir %USERPROFILE%\overload-1.2.1-release
set OUT=%USERPROFILE%\overload-1.2.1-release
```
Expect:
- `git log`: `5e1d6a0 Merge pull request #241 from adamjuszczyk/staging` (1.2). **Anything else: stop and tell me.** Master has moved since this sheet was written.
- `type`: `imhsawrghteqsmpklofv`. **Anything else: stop.** The CLI is linked to another project, and every command below would read the wrong database.
- `docker info`: one line `Server Version: …`.
- `--version`: `2.119.0`.
- `migration list`: `000` … `047` under both Local and Remote, nothing on one side only. **Anything else: stop and tell me.**
- `mkdir` and `set` print nothing. `%OUT%` lives in this window only; in a new window, run the `cd /d` and `set OUT=` lines again.

If a command says `Access token not provided`, run `npx --yes supabase@2.119.0 login` (it opens a browser), then run that command again.

---

## 1. The update notes (step 1) — PR #278

https://github.com/adamjuszczyk/overload-v2/pull/278, "Release notes 1.2.1: the notes, the prototype fix (274), the re-captured pictures", into `staging`.
- The notes live in two files that must say the same thing: `src/data/releaseNotes.ts` (what the app shows: WHAT'S NEW and the sheet after the update) and `docs/release-1.2.1-notes.md` (the long form). `releaseNotes.test.ts` compares them, so edit both.
- **The date:** the 1.2.1 entry carries `2026-11-02`, marked `DATE`. Set it to the day you will merge the release PR (5c). If the day changes after #278 is merged, a one-line PR into staging fixes it before 5a; or leave it, it is display only.
- When your edit is in and its checks are green, #278 is squash-merged into `staging` (by you, or by the coordinator at your word). It changes code, so staging deploys it.
- `docs/release-1.2.1-notes.md` is also the release PR's body (5a) and the GitHub Release's notes (7).

Merge #278 (and this sheet's own PR) **before 5a**, so the release PR carries them.

---

## 2. `check-migration` over the release (step 2)

Run on `staging` by the release reviewer, 2026-10-31: `node scripts/check-migration.mjs origin/master` exits 1 with **17 flags, every one "not on the safe list", all in `048_p121_release_state_and_deletes.sql`**:
- `drop policy if exists` on the new table's own policy, and `revoke all on v2_app_status`;
- the 7 `create or replace function` (`v2_request_role`, `v2_assert_not_in_maintenance`, `v2_refuse_during_maintenance`, `v2_delete_saved_program`, `v2_finished_run_sessions`, `v2_finished_run_counts`, `v2_delete_finished_run`);
- the `do` block that puts the `v2_maintenance_check` trigger on every public table with a `user_id`;
- 3 `revoke execute` and 3 `grant execute`, and `notify pgrst`.

These are exactly DECISIONS "For the release", 048's line. The new column `v2_programs.deleted_at` passes as add-only.

What 048 does, in plain words:
- It adds one table with one row (`v2_app_status`: maintenance off, minimum version 1.2.1, nobody exempt), one empty column, functions, and a trigger on each table with a `user_id`. Northstar's `ns_*` and Atlas's `atlas_*` tables get the trigger too (DECISIONS 268: keep).
- **It changes no existing row.** On a seeded replay all 42 tables read identical before and after. A trigger does nothing while maintenance is off, and 1.2.1 never turns it on.
- Rollback: none needed for the database (the end of this sheet); the backup in 3 is for data loss only.

**Merging the migrations PR (4b) is your consent to these 17 flags.** 048 changes no row, so `scripts/live-counts.sql` before and after (3 and 4f) is the record, not a gate. In 4a you run `check-migration` yourself on the exact branch that goes to master.

---

## 3. Backup and before counts (step 3) — the window opens

Do 4a and 5a first: they only open PRs, and their checks take a few minutes. **From the first dump on, nobody trains** until 5's Vercel deploy reads Ready.

```cmd
npx --yes supabase@2.119.0 db dump --linked --role-only -f %OUT%\roles.sql
npx --yes supabase@2.119.0 db dump --linked -f %OUT%\schema.sql
npx --yes supabase@2.119.0 db dump --linked --data-only --use-copy -f %OUT%\data.sql
dir %OUT%
findstr /c:"COPY public.v2_programs" %OUT%\data.sql
```
Expect:
- Each dump:
  - It prints `Dumping … from remote database...`, then a line naming its file in `%OUT%`.
  - The first may show Docker pulling a `supabase/postgres` image.
  - It asks for no password: `--linked` gets a temporary login role (MIGRATION-SWITCH.md 1.4).
- `dir`: `roles.sql`, `schema.sql` and `data.sql`, none 0 bytes; `data.sql` is the largest.
- `findstr`: one line `COPY public.v2_programs (id, …) FROM stdin;`. The table 048 adds a column to is in the backup.

**The second copy:** Supabase dashboard → the project → **Database → Backups → Scheduled backups**.
- Expect the latest daily backup, dated within the last 24 hours.
- If it offers **Download**, save that file in `%OUT%` too.

**The before counts:**
```cmd
npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > %OUT%\live-counts-before.json
node -e "const fs=require('fs'),j=JSON.parse(fs.readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,'')),rows=Array.isArray(j)?j:(j.rows||j.result||[]);console.log(rows.length+' tables: '+rows.map(r=>r.table_name+' '+r.rows).join(', '));console.log(rows.length===27&&rows.some(r=>Number(r.rows)>0)?'OK: production (some counts above 0)':'STOP: not 27 tables, or every count is 0 - wrong project')" %OUT%\live-counts-before.json
```
Expect:
- The query: `Connecting to remote database...` on screen and nothing else.
- The check: `27 tables: exercises …, program_exercises …, …` on one line, then `OK: production (some counts above 0)`.
- **`STOP`: stop here and tell me.** Every count 0 means it isn't production (Checks that lied 33).
- If it says `Unexpected token`, the file was written by PowerShell; run the query again in cmd.

**If it goes wrong:**
- Docker isn't running: start it, then run the line again.
- `Access token not provided`: run `login`, then the line again.
- **Don't merge in 4b without the three dump files and `live-counts-before.json` (check OK).**

Nothing to undo: a dump and a query only read.

---

## 4. Migrations first (step 4)

### 4a. Make the migrations PR — before 3

A PR to `master`, off `master`, holding only 048's two files, byte for byte as on staging. You make it (an agent may run the same commands at your go-ahead; the merge stays yours):
```cmd
git fetch origin
git checkout --no-track -b release/1.2.1-migrations origin/master
git checkout origin/staging -- supabase/migrations/048_p121_release_state_and_deletes.sql scripts/probe-specs/048.json
git status --short
git commit -m "1.2.1 migration 048 - merge only after Adam's backup"
git diff --stat origin/master
git diff --quiet origin/staging -- supabase/migrations scripts/probe-specs && echo SAME AS STAGING || echo DIFFERS FROM STAGING
node scripts\check-migration.mjs origin/master > %OUT%\check-migration.txt
findstr /c:"not on the safe list" %OUT%\check-migration.txt
git push -u origin release/1.2.1-migrations
git checkout --detach origin/master
```
Expect (rehearsed in a scratch copy, 2026-10-31):
- `git status`: exactly two lines, `A  scripts/probe-specs/048.json` and `A  supabase/migrations/048_p121_release_state_and_deletes.sql`. **Anything more: don't commit.** Run `git checkout --detach origin/master` and `git branch -D release/1.2.1-migrations`, and tell me.
- `git diff --stat`: ` 2 files changed, 218 insertions(+)`.
- `SAME AS STAGING`. **`DIFFERS FROM STAGING`: don't push, tell me.**
- `findstr`: 17 lines, each `- supabase/migrations/048_p121_release_state_and_deletes.sql: not on the safe list` (step 2).
- `git push`: `* [new branch]      release/1.2.1-migrations -> release/1.2.1-migrations`.

**Open the PR:** https://github.com/adamjuszczyk/overload-v2/compare/master...release/1.2.1-migrations?expand=1
- Base **master**, compare **release/1.2.1-migrations**.
- Title: `1.2.1 migration 048 — merge only after Adam's backup`.
- Body: `Migration 048 only (TASKS.md "Release", step 4). Its merge is Adam's consent to check-migration's 17 flags (DECISIONS "For the release"). Merge only after the run sheet's step 3.`
- **Create pull request.** Expect **2 files changed** and, after a few minutes, a green `migration-replay`. Don't merge yet.

### 4b. Merge it — after 3

Before: 3 is complete (three dump files, the daily backup listed, the before counts OK), nobody has trained since the backup, and the PR's `migration-replay` is green.

**The controls first**, so you know what "not there yet" looks like. The probe and the status read use the anon key, in this window only. Take it from your own `.env.local` (`VITE_SUPABASE_ANON_KEY`), or from Dashboard → Project Settings → API Keys → `anon` `public`.

**On Windows, don't run a plain `node scripts\probe-live-columns.mjs …`.** It prints nothing and exits 0: the script's start check compares a `file:///C:/…` URL with a `C:\…` path, so its main part never runs, and silence is not a pass. The line below loads the same script and lets that check match (re-run here on 2026-10-31 against staging: 2 probes, 2 as expected).

Your checkout is still 1.2's master, which has no `048.json` yet, so the control takes the spec from staging:
```cmd
set VITE_SUPABASE_URL=https://imhsawrghteqsmpklofv.supabase.co
set /p VITE_SUPABASE_ANON_KEY=Paste the anon key, then Enter: 
git show origin/staging:scripts/probe-specs/048.json > %OUT%\048.json
node --input-type=module -e "import {pathToFileURL} from 'node:url';const u=pathToFileURL('scripts/probe-live-columns.mjs');process.argv=[process.argv[0],u.pathname,...process.argv.slice(1)];await import(u.href)" %OUT%\048.json
node -e "const c=v=>(v||'').replace(/[^\x21-\x7e]/g,''),k=c(process.env.VITE_SUPABASE_ANON_KEY);fetch(c(process.env.VITE_SUPABASE_URL)+'/rest/v1/v2_app_status?select=maintenance,min_version,exempt_user_ids',{headers:{apikey:k,Authorization:'Bearer '+k}}).then(async r=>console.log(r.status,await r.text()))"
```
Expect, **before the merge** (048 isn't on production yet):
- The probe: `FAIL  v2_programs … columns   400 42703 (1 columns)`, then `PASS  v2_programs … control   400 42703`, then `probe-live-columns: 2 probes, 1 as expected, 1 not.` The column isn't there, and the probe sees it.
- The status read: `404`, with a body saying it can't find the table `v2_app_status` (on staging that answer carries `"code":"PGRST205"`).
- If both already read as after the merge (below), 048 is on production already: **stop and tell me.**

**Merge:** the migrations PR → **Squash and merge** → **Confirm squash and merge**.
```cmd
git fetch origin
git log --oneline -1 origin/master
```
Expect: `<sha> 1.2.1 migration 048 — merge only after Adam's backup (#NNN)` (cmd may draw the dash as another character). Vercel also builds a production deploy for this commit: 1.2's app, unchanged. It is the rollback target in 5.

### 4c. Read the deploy (give it 2–5 minutes)

- **GitHub:** https://github.com/adamjuszczyk/overload-v2/commits/master → the top commit (the migrations PR's) → click its status icon (✓, ✗ or the dot) → every **Supabase Preview** row.
  - Expect at least one **Successful**. One or two may stay "In progress"; that has been the pattern since 027 (Checks that lied 24).
  - Any **Failed**, or no Successful run after 10 minutes, is a **failed deploy** (below).
- **Supabase dashboard:** the project → **Branches** → the production branch (`master`) → the run for this commit → its log. Expect `048_p121_release_state_and_deletes` applied, with no error.

```cmd
git checkout --detach origin/master
npx --yes supabase@2.119.0 migration list --linked
```
Expect: `000` … `048` under both Local and Remote, nothing on one side only.

### 4d. Confirm it by its effect

```cmd
node --input-type=module -e "import {pathToFileURL} from 'node:url';const u=pathToFileURL('scripts/probe-live-columns.mjs');process.argv=[process.argv[0],u.pathname,...process.argv.slice(1)];await import(u.href)" scripts\probe-specs\048.json
node -e "const c=v=>(v||'').replace(/[^\x21-\x7e]/g,''),k=c(process.env.VITE_SUPABASE_ANON_KEY);fetch(c(process.env.VITE_SUPABASE_URL)+'/rest/v1/v2_app_status?select=maintenance,min_version,exempt_user_ids',{headers:{apikey:k,Authorization:'Bearer '+k}}).then(async r=>console.log(r.status,await r.text()))"
```
Expect:
- The probe, 2 probes, both `PASS`:
  ```
  PASS  v2_programs                  columns   200 [0 rows] (1 columns)
  PASS  v2_programs                  control   400 42703
  probe-live-columns: 2 probes, 2 as expected, 0 not.
  ```
  **No output at all means the probe did not run:** don't read it as a pass, tell me. `v2_app_status` isn't in the probe (it has no `user_id`); the status read is its check.
- The status read, signed out, exactly one row:
  ```
  200 [{"maintenance":false,"min_version":"1.2.1","exempt_user_ids":[]}]
  ```
  A `404` right after the deploy: wait a minute and run it once more. Still `404`, or anything but this row: a failed deploy (below).

**This read is the gate for 5** (DECISIONS 275, 73's card 2). 1.2.1's code must never reach a database without 048:
- its sync queue holds every queued write while it can't read `v2_app_status`;
- its program reads name `v2_programs.deleted_at` (`PROGRAM_COLUMNS`, chunk 74's review).

The 1.2 app keeps working meanwhile:
- It reads none of 048's objects.
- The triggers do nothing while maintenance is off. On staging, 1.2's app ran on 048 in chunk 70's review: sign-in, every tab with no error, a set logged and deleted.

### 4e. Your two lines on production (SQL editor)

Dashboard → the project → **SQL Editor** → a new query. One line at a time.

**The exempt list** (TASKS Fact 6), so your account keeps working during 1.2.2's maintenance window:
```sql
update v2_app_status set exempt_user_ids = array['12e79b69-9891-4f53-a7cf-650edd83659f'::uuid], updated_at = now() where id;
```
- Expect: `Success. No rows returned`. If the editor asks you to confirm a write, check that the line reads exactly as here, then confirm.
- Only the exempt list changes. **Leave `maintenance` false:** 1.2 phones don't know the screen, and the first release that uses it is 1.2.2's.

Then, in cmd, the status read again:
```cmd
node -e "const c=v=>(v||'').replace(/[^\x21-\x7e]/g,''),k=c(process.env.VITE_SUPABASE_ANON_KEY);fetch(c(process.env.VITE_SUPABASE_URL)+'/rest/v1/v2_app_status?select=maintenance,min_version,exempt_user_ids',{headers:{apikey:k,Authorization:'Bearer '+k}}).then(async r=>console.log(r.status,await r.text()))"
set VITE_SUPABASE_ANON_KEY=
```
Expect: `200 [{"maintenance":false,"min_version":"1.2.1","exempt_user_ids":["12e79b69-9891-4f53-a7cf-650edd83659f"]}]`. If the editor showed an error, or the list is still `[]`: send me the error's first line. Don't try variations. It doesn't hold the release: the list matters only once maintenance is used (1.2.2).

**The tables with the maintenance check** (DECISIONS 268's read-only list: table names only, no rows):
```sql
select count(*) filter (where c.relname !~ '^(ns|atlas)_') as overload_tables, count(*) filter (where c.relname ~ '^(ns|atlas)_') as ns_atlas_tables, count(*) filter (where not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'v2_maintenance_check')) as without_check, string_agg(c.relname, ', ' order by c.relname) filter (where c.relname ~ '^(ns|atlas)_') as ns_atlas_names from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'user_id' and not a.attisdropped);
```
Expect one row:
- `overload_tables` **40**: the repo's own tables, the same 40 as on the replay and staging.
- `without_check` **0**: 048 put its trigger on every one.
- `ns_atlas_tables` and `ns_atlas_names`: Northstar's and Atlas's tables. Send me these two values; they go into DECISIONS 268.
- **`overload_tables` not 40, or `without_check` not 0: don't merge the release PR; send me the row.** Production's schema isn't what the replay builds.

### 4f. After counts (the record, not a gate)

```cmd
npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > %OUT%\live-counts-after.json
node -e "const fs=require('fs'),rd=p=>{const j=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));return Array.isArray(j)?j:(j.rows||j.result||[])},a=rd(process.argv[1]),b=rd(process.argv[2]),bm=new Map(b.map(r=>[r.table_name,String(r.rows)]));let n=0;for(const r of a){const s=bm.get(r.table_name);const same=String(r.rows)===s;if(!same)n++;console.log(same?'same   ':'DIFFERS',r.table_name,String(r.rows),'->',s===undefined?'(none)':s)}for(const s of b)if(!a.some(r=>r.table_name===s.table_name)){n++;console.log('ONLY AFTER',s.table_name,String(s.rows))}console.log(a.length+' tables before, '+b.length+' after, '+n+' differ')" %OUT%\live-counts-before.json %OUT%\live-counts-after.json
```
Expect: 27 lines `same    <table> <rows> -> <rows>`, then `27 tables before, 27 after, 0 differ`.
- 048 inserts its one row into `v2_app_status`, which isn't counted, and changes no existing row. So a difference means someone wrote during the window.
- That doesn't stop the release. Tell me which table moved.

### If the deploy failed (Escalation 15): stop

- Don't merge the release PR, don't re-merge or re-run anything, never apply a migration by hand, never run `migration repair`.
- What is left on production:
  - 048 runs in one transaction, so a failed 048 leaves nothing of itself. Production stays on 047.
  - The 1.2 app keeps working.
- Send me the Branches log text, the `migration list` output, and the probe and status-read output. Keep the no-training window until I answer.

---

## 5. The release PR (step 5)

### 5a. Open it — before 3, after #278 and this sheet are merged into staging

https://github.com/adamjuszczyk/overload-v2/compare/master...staging?expand=1
- Base **master**, compare **staging**.
- Title: `Release 1.2.1`.
- Body: first the line `**Merge as a MERGE COMMIT, never squash; only after the run sheet's step 4 reads right.**`, then the whole of `docs/release-1.2.1-notes.md` (on GitHub, staging → that file → **Raw** → copy).
- **Create pull request.** Expect a green `migration-replay` after a few minutes. Don't merge yet.

An agent may open it at your go-ahead; the merge stays yours.

### 5b. Optional control, before the merge

The bundle check below, run against today's production (1.2), must print `MISSING WHAT'S NEW`, `MISSING UPDATE TO CONTINUE` and `STILL THERE UPDATE AVAILABLE`. That shows the check can tell 1.2 from 1.2.1.

### 5c. Merge it — after 4 reads right

Before:
- everything in 4 read as expected;
- nobody is training;
- this prints nothing, because 048 is on master now and the release brings no other migration:
```cmd
git fetch origin
git diff --stat origin/master origin/staging -- supabase/migrations scripts/probe-specs
```

**Merge:** the release PR → the arrow on the merge button → **Create a merge commit** (never "Squash and merge") → **Confirm merge**. Its `migration-replay` check must be green.
```cmd
git fetch origin
git log --oneline -1 origin/master
```
Expect: `<sha> Merge pull request #NNN from adamjuszczyk/staging`. Its first 7 characters are the build id below; written here as `XXXXXXX`.

**Supabase: a no-op.** Read the merge commit's **Supabase Preview** runs as in 4c; expect a Successful one. Then:
```cmd
git checkout --detach origin/master
npx --yes supabase@2.119.0 migration list --linked
```
Expect: unchanged, `000` … `048` on both sides.

**Vercel's production deploy, at four levels** (Checks that lied 8):
1. Vercel dashboard → project `overload-v2` → **Deployments**. The top one reads **Production** and **Ready**, its commit is `XXXXXXX`, and it is a real build: a minute or more, not a 2-second "Canceled" row. **The window closes here:** tell your friend.
2. Open it. **Domains** includes `overload-v2-sage.vercel.app`.
3. Its **Functions** list holds the `api/` functions, as the deployment before it did.
4. The bundle (production's domain can't be reached from my side, so this one is yours):
```cmd
curl -s https://overload-v2-sage.vercel.app/ > %OUT%\prod-index.html
findstr /c:"/assets/index-" %OUT%\prod-index.html
```
Expect: a line holding `/assets/index-XXXXXXXX.js`; its name changes with every build. Put that name into the first line here, and the 7 characters into the last:
```cmd
curl -s https://overload-v2-sage.vercel.app/assets/index-XXXXXXXX.js > %OUT%\prod-entry.js
findstr /c:"WHAT'S NEW" %OUT%\prod-entry.js >nul && echo FOUND WHAT'S NEW || echo MISSING WHAT'S NEW
findstr /c:"UPDATE TO CONTINUE" %OUT%\prod-entry.js >nul && echo FOUND UPDATE TO CONTINUE || echo MISSING UPDATE TO CONTINUE
findstr /c:"UPDATE AVAILABLE" %OUT%\prod-entry.js >nul && echo STILL THERE UPDATE AVAILABLE || echo GONE UPDATE AVAILABLE
findstr /c:"XXXXXXX" %OUT%\prod-entry.js >nul && echo FOUND THE BUILD ID || echo MISSING THE BUILD ID
```
Expect: `FOUND WHAT'S NEW`, `FOUND UPDATE TO CONTINUE`, `GONE UPDATE AVAILABLE`, `FOUND THE BUILD ID`. Settings prints the same id as `BUILD XXXXXXX`.
- Read on staging's deployed 1.2.1 bundle, 2026-10-31: WHAT'S NEW and UPDATE TO CONTINUE present, UPDATE AVAILABLE absent.
- On master (1.2), UPDATE AVAILABLE is the RELOAD banner's text, and the other two don't exist.

**If it goes wrong:**
- The Vercel deploy failed, or the app misbehaves after it: Vercel → Deployments → the production deployment before it (the migrations PR's: 1.2's app on 048, which 4 showed works) → **⋯** → **Promote to Production** (Instant Rollback). Then tell me. Don't revert anything on master.
- The bundle check misses a 1.2.1 string, or the build id, while the app works: tell me, and don't promote anything.
- The Supabase run on the merge commit failed: Escalation 15, as in 4; the app deploy is separate. Tell me.

---

## 6. Smoke on production: the P rows (step 6, your account only)

On your phone, open the app. 1.2 phones show **1.2's banner, UPDATE AVAILABLE with RELOAD**: that is 1.2's code, and until you tap it the app runs the old bundle (Checks that lied 6). Tap **RELOAD**.
- If no banner shows within a minute, close the app fully and open it again.
- 1.2.1 then opens with its notes, once. Your friend's phone gets the same banner when it next opens.

**Right away** (nothing here writes):
- [ ] **RC-2**: right after the reload, the 1.2.1 notes open over the screen; GOT IT closes them. Close the app and open it again: they don't come back.
- [ ] **RC-1**: Settings → WHAT'S NEW lists 1.2.1 (THIS VERSION) and 1.2, each with its date, and a row opens its notes. Under the card: `BUILD XXXXXXX`, the release merge commit's first 7 characters.
- [ ] **RC-6**: no RELOAD banner anywhere from now on. 1.2.1 has none; its hourly update check runs unseen.
- [ ] **RC-7**: PROGRAMS → YOUR PROGRAMS shows OPEN · START · DELETE on each saved program, and FINISH IT FIRST on the row of the program you're running.
  - DELETE on a saved one opens the confirm: press **CANCEL**. **Never confirm a delete here:** it is permanent on production.
  - In airplane mode the confirm says you're offline and its DELETE is off. Press CANCEL, then turn airplane mode off.
- [ ] **RC-11**: a finished program opens on week 1; the week strip stays, with tall cards; no A1/A2 labels on supersets. **Don't press its DELETE.**
- [ ] **RC-12**: its PRIORITIES are read-only.
  - A program from 1.1 or later shows its marks.
  - A pre-1.1 one shows its old marks, mapped.
  - One with none says "No priorities were set for this program."
- [ ] **RC-13**: PREVIEW SESSION on a session not started looks like the workout. A session with nothing planned says NO SETS PLANNED. Nowhere "TARGET RIR".

**In your next workout** (checked as you train; do nothing you wouldn't do anyway):
- [ ] **RC-14**: no history icon on the exercise. LAST and ⋯ → HISTORY open the history sheet. A set you did earlier this week shows its weekday ("MON …") beside LAST.
- [ ] **RC-15**: once every working set and stage is logged or skipped, WORKOUT COMPLETE shows with FINISH. If you add a set, the timer comes back. FINISH SESSION stays at the foot.
- [ ] **RC-16**: warmups.
  - An open warmup is drawn muted, with an outlined LOG and a ⋯ (SET TYPE, DELETE SET).
  - A logged warmup has no ✕, and unticking it unlogs it.
  - On a set with drops logged, UNLOG's note says "Unlog its drops first".

**When you next plan or change a program:**
- [ ] **RC-17**: in the planner, a superset has its own row ("SUPERSET A · N EXERCISES") whose ↑ ↓ move the whole superset. A member's arrows move it inside the superset only, greyed out at its edges.
- [ ] **RC-18**: TEMPO opens the tempo picker, in the planner and in CHANGE THE PROGRAM's exercise sheet. Stepping below 0 gives X, and a tempo you saved before shows as it was. Looking needs no save: CANCEL leaves the program as it was.

For any row that fails, note the row, what you saw and a screenshot, and send them to me. Fixes go through staging. If the app breaks: the Instant Rollback in 5.

---

## 7. Tag `v1.2.1` and the GitHub Release (step 7)

These are yours: this environment's git proxy refuses tag pushes (HTTP 403), and its tools can't create a release.
```cmd
git fetch origin
git log --oneline -1 origin/master
git tag -a v1.2.1 -m "Overload 1.2.1" origin/master
git push origin v1.2.1
git ls-remote --tags origin "v1.2.1*"
```
Expect:
- `git log`: the release merge commit from 5c (`XXXXXXX Merge pull request #NNN from adamjuszczyk/staging`). **Anything else: don't tag, tell me.**
- `git push`: `* [new tag]         v1.2.1 -> v1.2.1`.
- `ls-remote`: two lines, `refs/tags/v1.2.1` and `refs/tags/v1.2.1^{}`. The second carries the merge commit's full sha, which shows the tag is the annotated "Overload 1.2.1".

**The Release**, either way:
- With `gh`: `git checkout --detach origin/master`, then `gh release create v1.2.1 --verify-tag --title "Overload 1.2.1" --notes-file docs\release-1.2.1-notes.md` (not a draft, not a prerelease).
- On GitHub: Releases → **Draft a new release** → **Choose a tag** → `v1.2.1`, the one you pushed. Don't type a new tag: the form would make a lightweight one. Then the title "Overload 1.2.1" → paste `docs/release-1.2.1-notes.md` → "Set as a pre-release" unticked → **Publish release**.

**`v1.2.0` (from 1.2): done.** Read 2026-10-31: the Release "Overload 1.2" was published 2026-10-28 14:42 UTC on tag `v1.2.0` at `5e1d6a0`. The tag is a lightweight one (the web form made it), but it points at the right commit. Leave it.

---

## 8. Merge `master` back into `staging`, and the records (step 8)

So the next release's diff starts clean (a hotfix works the same way: master first, then this).
- https://github.com/adamjuszczyk/overload-v2/compare/staging...master?expand=1 → base **staging**, compare **master** → title `Merge master (v1.2.1) back into staging` → **Create pull request**.
- Expect commits (the migrations PR's squash and the release merge) and no file changes: staging already holds every file.
- When `migration-replay` is green: the arrow → **Create a merge commit** (never squash) → **Confirm merge**.
- Or tell me, and an agent opens and merges it, as #244 was in 1.2.

Then send me:
- the release merge commit's 7 characters;
- 4e's `ns_atlas_tables` and `ns_atlas_names`;
- anything 4f or the P rows showed.

The records are the coordinator's: CONTEXT.md "Where the build is" (1.2.1 on master; 048 live on production; next migration 049), HISTORY.md, and DECISIONS 268's list.

---

## Rollback, step by step

| Step | If it goes wrong | What to do |
|---|---|---|
| 0–3 | a command fails | Nothing to undo; everything there only reads. Fix the cause and run it again. Don't merge in 4b without the three dump files and the before counts. |
| 4a | the branch holds more than 048's two files, or differs from staging | Don't push. `git checkout --detach origin/master`, `git branch -D release/1.2.1-migrations`, and tell me. Nothing has reached GitHub. |
| 4b–4d | a Supabase run fails, no run succeeds, `migration list` is wrong, the probe FAILs or prints nothing, the status row isn't 048's | Escalation 15: stop and send me the log. Never hand-apply, never `migration repair`. 1.2 keeps working. Don't merge the release PR. |
| 4e | the exempt line errors | Send me the error's first line; it doesn't hold the release. |
| 4e | `overload_tables` not 40, or `without_check` not 0 | Don't merge the release PR; send me the row. |
| 4f | a count differs | Not a gate: tell me which table, and go on. |
| 5 | the Vercel deploy fails or the app breaks | Promote the previous production deployment (the migrations PR's: 1.2 on 048), then tell me. |
| 5 | the Supabase run on the merge fails | Escalation 15: tell me. |
| 6 | a P row fails | Note it and send it to me. Fixes go through staging. |
| 7 | the tag push is refused | Tell me; nothing else waits on it. |

**What a rollback of the app means.** Vercel's Instant Rollback serves the migrations PR's deployment again: 1.2's app, on the database with 048. That pair is known to work (step 4's window, and chunk 70's review on staging).
- A phone already on 1.2.1 fetches 1.2's code in the background at its next check (on opening, on return to the foreground, hourly), and runs it from its next fresh start.
- Its offline store is the same version in both (`src/lib/db.ts` is unchanged since 1.2), so nothing on the phone is lost.
- Nothing is reverted on master; a fix goes through staging and a new release.

**Why 048 stays.** It is additive and forward-only.
- 1.2 reads none of it; the triggers do nothing while maintenance is off; the status row is static.
- Taking it out would be a new migration through a PR (TASKS's migration summary: a later migration may drop the triggers, functions, table and column once no bundle uses them). It is never a rollback step, and never a hand edit.

**The restore — ONLY ON MY WORD, and only for data loss.** Never run it on your own:
- A restore writes over production, your friend's rows included.
- What to restore depends on what went wrong: a table from `data.sql`, the dashboard's daily backup, or the whole dump into a fresh project. I'll write the exact commands then.
- **The app goes back to 1.2 first (Instant Rollback).** 1.2.1 must never run on a database without 048: it would hold every queued write and its program reads would fail.

For the record, here is the whole dump restored into an empty database with psql, run through Docker:
```cmd
docker run --rm -it -v "%OUT%:/backup" postgres:17 psql --single-transaction -v ON_ERROR_STOP=1 -f /backup/roles.sql -f /backup/schema.sql -c "SET session_replication_role = replica" -f /backup/data.sql -d "CONNECTION-STRING"
```
`CONNECTION-STRING` is the **Session pooler** URI from the dashboard's **Connect** dialog of the database being restored into, with its password typed in this window only.

---

## From 1.2.2 (TASKS "From 1.2.2"; BUILD.md step 5 in full)

1.2.2's sheet replaces the no-training window with maintenance mode. After the backup, in the SQL editor:
```sql
update v2_app_status set maintenance = true, updated_at = now() where id;
```
- From that moment the database refuses every write made by a signed-in account that isn't exempt (`OL001`).
- A phone shows the maintenance screen the next time it reads the flag: on opening, on return to the foreground, at once after a refused write (DECISIONS 271), and otherwise within the hour. So an idle phone may take up to an hour; don't promise "within a minute" (DECISIONS 275, 72's C; 276).
- Your account (exempt since 4e) shows the strip and keeps working. Signed out, the screen offers SIGN IN (DECISIONS 270).

Then the migrations PR, the release PR, and the smoke as the exempt account. Then:
```sql
update v2_app_status set maintenance = false, min_version = '1.2.2', updated_at = now() where id;
```
Every release raises `min_version` (SPEC Rules 4), so phones below 1.2.2 show UPDATE TO CONTINUE. Every release also writes its notes entry before the checklist.
