# Overload 1.2 — release run sheet (Adam)

*TASKS-1.2.md "Release", steps 3–7, in your order. Written 2026-10-27 by the release reviewer; also in the repo as `docs/release-1.2-run-sheet.md`.*

- *Every command is Windows **cmd**, not PowerShell (PowerShell's `>` writes UTF-16). Run them from your `overload-121` clone (linked to production; the project-ref check in 0 confirms it), in one window from start to end.*
- *Nothing here has been merged or run for you: each merge to master is yours.*

**What's ready**
- **PR #240**: "1.2 migrations (042–047) — merge only after Adam's backup and yes on 046" (step 5). Its merge is your yes on 046 (DECISIONS 202). Its `migration-replay` is green.
- **PR #241**: "Release 1.2", `staging` → `master` (step 6). It merges as a merge commit, never a squash, and only after step 5's deploy is verified. The update notes are its body and `docs/release-1.2-notes.md`.
- **The counts file**: `scripts/release-046-counts.sql` (on staging, #239). It is the read-only before/after reading of 046, your rows only.
- **The release-wide `check-migration`**: 15 flags in 042–047, the same statements as DECISIONS "For the release". Nothing new to decide.
- **RC44**: done (zero rows).

**Never paste a key, password or token into a message, a file in the repo, or anywhere but this cmd window. Never run `db dump --dry-run`: it prints the database password.**

---

## 0. Before you start

**A time when nobody trains (step 4).** Pick about an hour in which neither you nor your friend trains, and tell your friend. It runs from **step 1 (the backup)** until step 6's Vercel deploy is Ready (Adam, 2026-10-27), so the backup is complete and the before and after counts can't differ because someone trained. From #240's merge on, also:
- 1.1's app plans weeks through 045 (structure, no weights, RIR or week-dependent reps);
- a week-view edit made in 1.1 no longer carries forward, because 046 has run.

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
mkdir %USERPROFILE%\overload-1.2-release
set OUT=%USERPROFILE%\overload-1.2-release
```
Expect:
- `git log`: `a3ffbe8 Merge pull request #87 from adamjuszczyk/claude/vibrant-thompson-awnyxp-integration-check`.
- `type`: `imhsawrghteqsmpklofv`. **Anything else: stop.** The CLI is linked to another project, and every command below would read the wrong database.
- `docker info`: one line `Server Version: …`.
- `--version`: `2.119.0`.
- `migration list`: `000` … `041` under both Local and Remote, nothing on one side only (as in 121).
- `mkdir` and `set` print nothing. `%OUT%` lives in this window only; in a new window, run the `cd /d` and `set OUT=` lines again.

If a command says `Access token not provided`, run `npx --yes supabase@2.119.0 login` (it opens a browser), then run that command again.

---

## 1. Backup (step 3) — right before step 5

```cmd
npx --yes supabase@2.119.0 db dump --linked --role-only -f %OUT%\roles.sql
npx --yes supabase@2.119.0 db dump --linked -f %OUT%\schema.sql
npx --yes supabase@2.119.0 db dump --linked --data-only --use-copy -f %OUT%\data.sql
dir %OUT%
findstr /c:"COPY public.v2_program_exercises" %OUT%\data.sql
```
Expect:
- Each dump:
  - It prints `Dumping … from remote database...`, then a line naming its file in `%OUT%`.
  - The first may show Docker pulling a `supabase/postgres` image.
  - It asks for no password: `--linked` gets a temporary login role (MIGRATION-SWITCH.md 1.4).
- `dir`: `roles.sql`, `schema.sql` and `data.sql`, none 0 bytes; `data.sql` is the largest.
- `findstr`: one line `COPY public.v2_program_exercises (id, …) FROM stdin;`. The table 046 changes is in the backup.

**The second copy:** Supabase dashboard → the project → **Database → Backups → Scheduled backups**.
- Expect the latest daily backup, dated within the last 24 hours.
- If it offers **Download**, save that file in `%OUT%` too.

**If it goes wrong:**
- Docker isn't running: start it, then run the line again.
- `Access token not provided`: run `login`, then the line again.
- **Don't go on to step 5 without the three files.**

Nothing to undo: a dump only reads.

---

## 2. Before counts (step 3) — right after the backup

The counts file is on staging (#239), not on master yet, so take it from there:

```cmd
git show origin/staging:scripts/release-046-counts.sql > %OUT%\release-046-counts.sql
npx --yes supabase@2.119.0 db query --linked -f %OUT%\release-046-counts.sql -o json > %OUT%\release-046-before.json
npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > %OUT%\live-counts-before.json
type %OUT%\release-046-before.json
```
Expect:
- Each query: `Connecting to remote database...` on screen and nothing else; the file starts with `[`.
- `release-046-before.json` has one object per row, in this order:
  - `scope`, with your user id;
  - 7 `counts` rows, `v2_mesocycles` … `v2_week_plan_exercises`;
  - 2 `fingerprint` rows;
  - one `run` row per active week-dependent run you have (`<name> / weekday` or `sequence / <8 characters>`);
  - `taken`.
- `live-counts-before.json`: 27 rows, `table_name` and `rows` (the record TASKS step 2 asks for).

Then the zero check. If every count reads 0, it is not production (Checks that lied 33):
```cmd
node -e "const fs=require('fs'),j=JSON.parse(fs.readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,'')),rows=Array.isArray(j)?j:(j.rows||j.result||[]),c=rows.filter(r=>r.section==='counts');console.log(c.map(r=>r.item+' '+r.rows).join(', '));console.log(c.length===7&&c.some(r=>Number(r.rows)>0)?'OK: production (some counts above 0)':'STOP: every count is 0 or missing - wrong project')" %OUT%\release-046-before.json
```
Expect: the seven counts on one line, then `OK: production (some counts above 0)`. **`STOP`: stop here and tell me.** If it says `Unexpected token`, the file was written by PowerShell; run the query again in cmd.

**Optional, information only** (TASKS "Before the release", R5). Run these in the SQL editor, read-only; neither touches your friend's rows:
```sql
-- F5: the runs whose deload calculation changes the first time they are marked after the release
select p.id, p.kind, p.name, m.name as run, m.status, p.deload_rules from v2_programs p left join v2_mesocycles m on m.program_id = p.id where p.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and p.deload_rules is not null and p.deload_rules <> '{}'::jsonb;
```
```sql
-- G50: which of your finished programs will open the old priorities page
select m.id, m.name, m.status, (select count(*) from v2_program_priorities p where p.program_id = m.program_id) as new_marks, (select count(*) from v2_coach_meso_tag_priorities t where t.mesocycle_id = m.id) as old_marks from v2_mesocycles m where m.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' order by m.start_date;
```
Expect: any rows at all; they are for your information.

---

## 3. Your yes on 046

What it does:
- 046 changes rows of **every** user's active week-dependent runs on production, your friend's included.
- In each run, it sets the program's `week_only`, `removed_at` and `position` to match the run's last planned week, and only on rows that differ.
- Nothing anyone sees in their weeks changes, except DECISIONS 203's sequence-run case, which RC44 found on none of your runs.
- A second run changes nothing.
- Rollback: the backup from 1.

Before you merge, check all of:
- [ ] `%OUT%` holds `roles.sql`, `schema.sql`, `data.sql`, `release-046-before.json` (zero check OK) and `live-counts-before.json`, and the dashboard lists today's daily backup.
- [ ] Nobody has trained since the backup, and nobody will until step 6 is done.
- [ ] PR #240 shows **10 files changed** (six in `supabase/migrations/`, four in `scripts/probe-specs/`), and its `migration-replay` check is green.

Merging PR #240 is your yes (DECISIONS 202).

---

## 4. Step 5 — the migrations (PR #240)

**Merge:** https://github.com/adamjuszczyk/overload-v2/pull/240 → **Squash and merge** → **Confirm squash and merge**.
```cmd
git fetch origin
git log --oneline -1 origin/master
```
Expect: `<sha> 1.2 migrations (042–047) — merge only after Adam's backup and yes on 046 (#240)`. Vercel also builds a production deploy for this commit: 1.1's app, unchanged. It is the rollback target in 6.

**Read the deploy** (give it 2–5 minutes):
- **GitHub:** https://github.com/adamjuszczyk/overload-v2/commits/master → the top commit (#240's) → click its status icon (✓, ✗ or the dot) → every **Supabase Preview** row.
  - Expect at least one **Successful**. One or two may stay "In progress"; that has been the pattern since 027.
  - Any **Failed**, or no Successful run after 10 minutes, is a **failed deploy** (below).
- **Supabase dashboard:** the project → **Branches** → the production branch (`master`) → the run for this commit → its log. Expect the six files applied in order, `042_p12_schema` to `047_p12_swap_moved_sets`, with no error.

```cmd
git checkout --detach origin/master
npx --yes supabase@2.119.0 migration list --linked
```
Expect: `000` … `047` under both Local and Remote, nothing on one side only.

**Probe the new columns.** The probes are read-only and use the anon key, so no row can come back. The script needs production's URL and anon key, in this window only. Take the key from your own `.env.local` (`VITE_SUPABASE_ANON_KEY`), or from Dashboard → Project Settings → API Keys → `anon` `public`.

**On Windows, don't run a plain `node scripts\probe-live-columns.mjs …`.** It prints nothing and exits 0: the script's start check compares a `file:///C:/…` URL with a `C:\…` path, so its main part never runs, and silence is not a pass. Each line below loads the same script and lets that check match (tested here: the probes run; the same import without that step prints nothing):
```cmd
set VITE_SUPABASE_URL=https://imhsawrghteqsmpklofv.supabase.co
set /p VITE_SUPABASE_ANON_KEY=Paste the anon key, then Enter: 
node --input-type=module -e "import {pathToFileURL} from 'node:url';const u=pathToFileURL('scripts/probe-live-columns.mjs');process.argv=[process.argv[0],u.pathname,...process.argv.slice(1)];await import(u.href)" scripts\probe-specs\042.json
node --input-type=module -e "import {pathToFileURL} from 'node:url';const u=pathToFileURL('scripts/probe-live-columns.mjs');process.argv=[process.argv[0],u.pathname,...process.argv.slice(1)];await import(u.href)" scripts\probe-specs\043.json
node --input-type=module -e "import {pathToFileURL} from 'node:url';const u=pathToFileURL('scripts/probe-live-columns.mjs');process.argv=[process.argv[0],u.pathname,...process.argv.slice(1)];await import(u.href)" scripts\probe-specs\044.json
node --input-type=module -e "import {pathToFileURL} from 'node:url';const u=pathToFileURL('scripts/probe-live-columns.mjs');process.argv=[process.argv[0],u.pathname,...process.argv.slice(1)];await import(u.href)" scripts\probe-specs\047.json
set VITE_SUPABASE_ANON_KEY=
```
Expect: every line starts `PASS`, and each run ends `probe-live-columns: N probes, N as expected, 0 not.` **No output at all means the probe did not run:** don't read it as a pass, tell me.
- **042: 13 probes.**
  - `v2_run_schedules`, `v2_session_set_changes` and `v2_week_review_decisions` each give three: `columns 200 [0 rows]`, `control 400 42703` and `anon rows 200 [0 rows]`.
  - `v2_user_settings` and `v2_week_plan_sets` each give `columns 200 [0 rows]` and `control 400 42703`.
- **043: 2 probes**, on `v2_program_exercises`: `columns 200`, `control 400`.
- **044: 2 probes**, on `v2_set_logs`: the same.
- **047: 2 probes**, on `v2_session_exercise_swaps`: the same.

Any `FAIL` means a file didn't apply: a failed deploy (below).

**If the deploy failed (Escalation 15): stop.**
- Don't merge PR #241, don't re-merge or re-run anything, never apply a migration by hand, never run `migration repair`.
- What is left on production:
  - Each file runs in one transaction, so a failed file leaves nothing of itself.
  - The files before it stay. They are add-only, plus 045's planning, which 1.1 already calls (structure, no numbers), so the 1.1 app keeps working.
  - A failed 046 stops the deploy after 045 and before 047, with no row changed.
- Send me the Branches log text, the `migration list` output and the probe output. Keep the no-training window until I answer.

---

## 5. After counts (step 5) — right after the deploy reads right

```cmd
npx --yes supabase@2.119.0 db query --linked -f %OUT%\release-046-counts.sql -o json > %OUT%\release-046-after.json
npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > %OUT%\live-counts-after.json
node -e "const fs=require('fs'),rd=p=>{const j=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));return Array.isArray(j)?j:(j.rows||j.result||[])},key=r=>r.section?r.section+' | '+r.item:r.table_name,show=r=>r?[r.rows,r.week_only,r.removed,r.fingerprint].filter(v=>v!==undefined).join(' '):'(none)',a=rd(process.argv[1]),b=rd(process.argv[2]),bm=new Map(b.map(r=>[key(r),r]));let n=0;for(const r of a){if(r.section==='taken')continue;const s=bm.get(key(r));const same=JSON.stringify(r)===JSON.stringify(s);if(!same)n++;console.log(same?'same   ':'DIFFERS',key(r),'::',show(r),'->',show(s))}for(const s of b)if(s.section!=='taken'&&!a.some(r=>key(r)===key(s))){n++;console.log('ONLY AFTER',key(s),'::',show(s))}console.log(n+' row(s) differ (taken left out)')" %OUT%\release-046-before.json %OUT%\release-046-after.json
node -e "const fs=require('fs'),rd=p=>{const j=JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));return Array.isArray(j)?j:(j.rows||j.result||[])},key=r=>r.section?r.section+' | '+r.item:r.table_name,show=r=>r?[r.rows,r.week_only,r.removed,r.fingerprint].filter(v=>v!==undefined).join(' '):'(none)',a=rd(process.argv[1]),b=rd(process.argv[2]),bm=new Map(b.map(r=>[key(r),r]));let n=0;for(const r of a){if(r.section==='taken')continue;const s=bm.get(key(r));const same=JSON.stringify(r)===JSON.stringify(s);if(!same)n++;console.log(same?'same   ':'DIFFERS',key(r),'::',show(r),'->',show(s))}for(const s of b)if(s.section!=='taken'&&!a.some(r=>key(r)===key(s))){n++;console.log('ONLY AFTER',key(s),'::',show(s))}console.log(n+' row(s) differ (taken left out)')" %OUT%\live-counts-before.json %OUT%\live-counts-after.json
```
Each compare prints one line per row (`same` or `DIFFERS`, before `->` after: rows, week_only, removed, md5), then `N row(s) differ (taken left out)`.

Expect for 046's file:
- `scope` and the 7 `counts` rows: `same`. 046 inserts and deletes nothing.
- `fingerprint | … rows outside his active week-dependent runs`: `same`.
- Each `run` row:
  - `rows` the same;
  - `week_only` lower or equal;
  - `removed` may go up, go down or stay;
  - its md5 differs exactly when 046 changed one of that run's rows. A row brought back plus another taken out leave `removed` where it was, and a reorder moves only the md5.
- `fingerprint | … all his rows`: `DIFFERS` exactly when some `run` row differs.
- If your active runs already matched their last planned week, **nothing differs** (`0 row(s) differ`), and that is a correct reading. RC44 read zero rows, so 203's case can't show here.

Expect for live-counts: `0 row(s) differ`. It counts rows; 046 changes values only, and nobody trained.

The replay's reading of the staging-sequence account's 1.1-shaped run, before and after 046 (046 made 7 changes on 6 rows there), is what a run that 046 reconciles looks like:
```
same    counts | v2_program_exercises :: 9    -> 9
DIFFERS fingerprint | v2_program_exercises: all his rows (id, week_only, removed_at, position) :: 9 3 1 0e4dab90… -> 9 0 1 1bfbe8e4…
same    fingerprint | v2_program_exercises: rows outside his active week-dependent runs :: 3 0 0 381731c8… -> 3 0 0 381731c8…
DIFFERS run | STG Rotation run / sequence / 06f16e20 :: 6 3 1 b252de67… -> 6 0 1 53379787…
2 row(s) differ (taken left out)
```

**Stop, and don't do step 6,** if any of these shows, because 046 can't do any of them. Send me the four JSON files; the data stays as it is until I've read them, and a restore happens only on my word (the end of this sheet):
- a count moved;
- the outside fingerprint moved;
- a run's `rows` moved;
- a run row appeared or went (`ONLY AFTER`, or `(none)` after `->`);
- live-counts differs.

---

## 6. Step 6 — the release (PR #241)

Before: everything in 4 and 5 read as expected, and nobody is training.

**Optional control, before the merge.** The bundle check below, run against today's production (1.1), must print `MISSING PLAN FORWARD`, `MISSING DROPS AND STAGES` and `STILL THERE END RUN`. That shows the check can tell 1.1 from 1.2.

**Merge:** https://github.com/adamjuszczyk/overload-v2/pull/241 → the arrow on the merge button → **Create a merge commit** (never "Squash and merge") → **Confirm merge**. Its `migration-replay` check must be green.
```cmd
git fetch origin
git log --oneline -1 origin/master
```
Expect: `<sha> Merge pull request #241 from adamjuszczyk/staging`. Its first 7 characters are the build id below; written here as `XXXXXXX`.

**Supabase: a no-op.** Read the merge commit's **Supabase Preview** runs as in 4; expect a Successful one. Then:
```cmd
git checkout --detach origin/master
npx --yes supabase@2.119.0 migration list --linked
```
Expect: unchanged, `000` … `047` on both sides.

**Vercel's production deploy, at four levels** (Checks that lied 8):
1. Vercel dashboard → project `overload-v2` → **Deployments**. The top one reads **Production** and **Ready**, its commit is `XXXXXXX`, and it is a real build: a minute or more, not a 2-second "Canceled" row.
2. Open it. **Domains** includes `overload-v2-sage.vercel.app`.
3. Its **Functions** list holds the `api/` functions, as the deployment before it did.
4. The bundle:
```cmd
curl -s https://overload-v2-sage.vercel.app/ > %OUT%\prod-index.html
findstr /c:"/assets/index-" %OUT%\prod-index.html
```
Expect: a line holding `/assets/index-XXXXXXXX.js`; its name changes with every build. Put that name into the first line here, and the 7 characters into the last:
```cmd
curl -s https://overload-v2-sage.vercel.app/assets/index-XXXXXXXX.js > %OUT%\prod-entry.js
findstr /c:"PLAN FORWARD" %OUT%\prod-entry.js >nul && echo FOUND PLAN FORWARD || echo MISSING PLAN FORWARD
findstr /c:"DROPS AND STAGES COUNT AS" %OUT%\prod-entry.js >nul && echo FOUND DROPS AND STAGES || echo MISSING DROPS AND STAGES
findstr /c:"END RUN" %OUT%\prod-entry.js >nul && echo STILL THERE END RUN || echo GONE END RUN
findstr /c:"XXXXXXX" %OUT%\prod-entry.js >nul && echo FOUND THE BUILD ID || echo MISSING THE BUILD ID
```
Expect: `FOUND PLAN FORWARD`, `FOUND DROPS AND STAGES`, `GONE END RUN`, `FOUND THE BUILD ID`. Settings prints the same id as `BUILD XXXXXXX`.

**If it goes wrong:**
- The Vercel deploy failed, or the app misbehaves after it: Vercel → Deployments → the production deployment before it (#240's merge: 1.1's app on the new schema, which step 5 showed works) → **⋯** → **Promote to Production** (Instant Rollback). Then tell me. Don't revert anything on master.
- The Supabase run on the merge commit failed: Escalation 15, as in 4; the app deploy is separate. Tell me.

---

## 7. Smoke test on production (your account only)

On your phone, open the app. If a **RELOAD** banner shows, tap it: until then the app runs the old bundle (Checks that lied 6).
- [ ] Settings, at the bottom: `BUILD XXXXXXX`, the release merge commit's first 7 characters.
- [ ] Today opens: today's session or your rest day, as you expect.
- [ ] Plan opens on the current week, with PLAN | PROGRAMS at the top.
- [ ] PROGRAMS shows your current program's card.
- [ ] History lists your sessions; Library lists your exercises.
- [ ] Settings shows "Drops and stages count as" and "Log sets in order".
- [ ] COACH opens.

Nothing here writes. The first set you log in your next workout is the write check (RC27).

---

## 8. The P rows on your phone (step 7)

Check these as part of your training, over the next days, and do nothing beyond what you'd do anyway. A row that writes (planning, copying, a start, a finish) is checked when you do it for real. For any row that fails, note the row, what you saw and a screenshot, and send them to me.

- [ ] **RC1**: Plan opens on the current week. The tiles read DONE / THIS WEEK / PLANNED / NOT PLANNED, with nothing past the first unplanned week. Tapping a tile never plans a week.
- [ ] **RC2**: PLAN FORWARD plans exactly one week: structure, volume and set types, with no weights, reps or RIR. A stable run gets the default's rep targets.
- [ ] **RC3**: COPY shows its fields and locks done workouts. Overwrite off fills empty boxes only; on, it replaces. A RIR range copies as a range.
- [ ] **RC5**: on a week-dependent run, a change in a week carries into the next week PLAN FORWARD plans.
- [ ] **RC6**: no exercise-level action in the week view. CHANGE THE PROGRAM opens from the bottom button and from EDIT PROGRAM.
- [ ] **RC7**: done sessions and past weeks are read-only and show the plan.
- [ ] **RC10**: the REVIEW line and sheet offer USE / ADD THIS SET / REMOVE THIS SET / SWAP FROM WEEK N / ADD EXERCISE / IGNORE. A decided item is gone for good; nothing shows on week 1.
- [ ] **RC11**: VOLUME shows last week → this week per muscle and "YOU PLANNED … DID …", and follows Settings' "Drops and stages count as".
- [ ] **RC12**: the rep target and RIR target pickers everywhere in Plan, with "Use for all". A RIR range shows as "1–2" in the workout; warmup rows have no RIR.
- [ ] **RC13**: one set type picker in Plan, CHANGE THE PROGRAM, the planner and the workout. Stages are added with the stepper, and a warmup can't be staged.
- [ ] **RC16**: CHANGE THE PROGRAM has the rule box, add / swap / remove / reorder, supersets, the warmup routine, rename, and CANCEL / SAVE CHANGES. A save lands on sessions not done only.
- [ ] **RC19**: a new program needs a schedule and a planning type; nothing is preselected, and CREATE stays disabled until both are set (only if you make one).
- [ ] **RC20**: START lands on Plan, week 1, and the name defaults to the program's. Starting while one runs finishes it and says so (only when you start one).
- [ ] **RC22**: the PROGRAMS tab shows the current card (week, start, types, FOCUS / DON'T CARE view-only), YOUR PROGRAMS and FINISHED.
- [ ] **RC23**: a finished program shows its dates, weeks, deloads, PRIORITIES and its structure history with the changes. DELETE asks first; don't press it. A pre-1.1 program opens the old priorities page as it is.
- [ ] **RC24**: deload rules come from Settings only; WEEK ⋯ shows the rule line. Session deload is in the session's ⋯, week deload in WEEK ⋯. The RIR rule applies to both ends of a range.
- [ ] **RC27**: workout rows show logged / current / upcoming. The plan's rep target is in the reps box, the weight is empty where the plan has none, and the RIR box has its placeholder. "Last time" and "earlier this week" show.
- [ ] **RC28**: the rest bar is pinned above the nav, with no inline timer; its jump button scrolls back to the set.
- [ ] **RC29**: with "Log sets in order" on, an out-of-order LOG asks first; with it off, never. CANCEL logs nothing, and warmups never ask.
- [ ] **RC30**: the pen on a logged row opens the edit panel: the numbers, SET TYPE, UNLOG / DELETE, CANCEL / SAVE.
- [ ] **RC31**: UNLOG keeps the numbers on the phone, is disabled while drops are logged and doesn't restart the rest. It works offline.
- [ ] **RC32**: DELETE asks first and affects this session only. Stages go with their head, and the sets renumber. It works offline.
- [ ] **RC33**: set type during a workout, from the ⋯ or the edit panel, applies to this session only. It asks before deleting logged drops; a logged set's change needs a connection.
- [ ] **RC34**: stage rows open by themselves. + ADD ROUND adds a set to every member; a member's ⋯ adds to that member only.
- [ ] **RC36**: finishing shows the tiles and the unlogged-sets warning with GO BACK, then COMPLETE. A reopened session finishes again.
- [ ] **RC38**: Settings shows "Drops and stages count as" (½) and "Log sets in order" (on), and no "New week starts".
- [ ] **RC39**: the app says "program", "cues" and "change the program". The known exceptions are Coach's MESO and the pre-1.1 priorities page.
- [ ] **RC41**: nothing from the Removals list is left. That means no Sets / Structure views, MAKE THIS WEEK THE NEW DEFAULT, apply-ahead banner, Copy last week, END RUN, ADD STAGE, mark as dropset, + DROP OR STAGE or ADD WARMUP SETS; no "New week starts", per-program deload control or note in the edit panel.
- [ ] **RC42**: the COACH button and its sidebar work as in 1.1 (your account only).
- [ ] **RC43**: the nav has 6 tabs, with COACH as the 7th for you.

---

## Rollback, step by step

| Step | If it goes wrong | What to do |
|---|---|---|
| 0–2 | a command fails | Nothing to undo; everything here only reads. Fix the cause and run it again. Don't start 4 without the backup and the before files. |
| 3 | you're not sure about 046 | Don't merge. Nothing has changed on production. |
| 4 (step 5) | a Supabase run fails, no run succeeds, `migration list` is wrong, or a probe FAILs | Escalation 15: stop and send me the log. Never hand-apply and never `migration repair`. 1.1 keeps working. |
| 5 | a difference 046 can't make | Stop and send me the four files. A restore happens only on my word. |
| 6 (step 6) | the Vercel deploy fails or the app breaks | Promote the previous production deployment (1.1, from #240's merge), then tell me. |
| 6 (step 6) | the Supabase run on the merge fails | Escalation 15: tell me. |
| 7–8 | a smoke or P row fails | Note it and send it to me. Fixes go through staging. |

**The restore — ONLY ON MY WORD.** Never run it on your own:
- A restore writes over production, your friend's rows included.
- What to restore depends on what went wrong: one table's three columns from `data.sql`, the dashboard's daily backup, or the whole dump into a fresh project. I'll write the exact commands then.

For the record, here is the whole dump restored into an empty database with psql, run through Docker:
```cmd
docker run --rm -it -v "%OUT%:/backup" postgres:17 psql --single-transaction -v ON_ERROR_STOP=1 -f /backup/roles.sql -f /backup/schema.sql -c "SET session_replication_role = replica" -f /backup/data.sql -d "CONNECTION-STRING"
```
`CONNECTION-STRING` is the **Session pooler** URI from the dashboard's **Connect** dialog of the database being restored into, with its password typed in this window only.

---

## After

Tell me when 6 is done. Steps 8 and 9 are the reviewer's: tag `v1.2.0`, publish the GitHub Release with the update notes, and merge `master` back into `staging`.
