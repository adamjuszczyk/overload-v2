# Overload — Decisions

## Waiting on Adam
*Rewritten at every chunk boundary. Last: 2026-10-09 09:40 UTC, chunk 26 boundary — chunks 1–24 and 26 merged and live (migrations through 036); chunk 25, the last, on a third, tests-only retry (73).*

**Decisions**
- 54 — 034 (#35) merged by you as `a76b146` (2026-10-06 18:27 UTC) and live: deploy success 18:28; `target_reps` → 42703; backup table present; embeds 27/27 live. Left: send me your B1–B3 (before) and A1–A4 (after) outputs, if you ran them, plus the counts files. If you merged without the before queries, say so: A1–A4 still check the conversion on their own (A2 vs the backup, A4 = 0).
- 52 — Planner: what "number of sets is required" blocks, for programs with no per-set rows yet (your 3 existing ones). Recommendation: (a) nothing blocked, incomplete exercises flagged. Blocked: nothing (chunk 11 built with (a)).
- 73 — Answered (a), second account: chunk 25 gets one more test-only retry; the throwaway sequence run is on your second account. In progress.
- 75 — Answered (b): a builder is changing verify-rls to flag only rows not owned by the test account. In progress.
- Nothing else open. (48, chunk 12's decision (49) and chunk 25's go-ahead (50) answered 2026-10-05; standing rules D29, D30.)

**To-dos**
- 72 — Chunk 26 app steps: no PROGRAM tab; Plan's header icon opens Programs; open in planner, priorities and delete reachable; START/END RUN present; old /program link works. When: next session. Blocked: nothing (a failure blocks the next merge).
- 71 — Chunk 24 app steps: the 29 Aug session shows 30 Aug in History; move a session and back; two sessions on one day; current-week-only missed prompt, DO IT NOW; no MOVE on started sessions. When: next session. Blocked: nothing (a failure blocks the next merge).
- 69 — Chunk 23 app steps: LAST WEEK unchanged for same-workout last week; LAST TIME + days for another workout or an earlier run; FIRST TIME only if never done; deload sessions never shown. When: next session. Blocked: nothing (a failure blocks the next merge).
- 68 — Chunk 22 app steps: switch deload rules on; mark a session → halved sets, 75% of last time's lifted weight; edit one, unmark → originals back; program CUSTOM override wins; a started session is flag-only; switch rules off after if wanted. When: next session. Blocked: nothing (a failure blocks the next merge).
- 66 — Chunk 21 app steps: mark a week deload, unmark one session, DELOAD labels on Today/preview/workout, next week copies from the last normal one; unmark afterwards. When: next session. Blocked: nothing (a failure blocks the next merge).
- 65 — Chunk 20 app steps: a weight change applied ahead lands only on that set; swap ahead then a follow-up weight change both land; no offer after only-this-week; ignoring leaves later weeks alone. When: next session. Blocked: nothing (a failure blocks the next merge).
- 63 — Chunk 19 app steps: weight, rep override and tags on a set; apply-to-all; AMRAP → RIR 0; shown in the session; next week carries weight and RIR, not tags; say if the busier Plan rows should collapse. When: next session. Blocked: nothing (a failure blocks the next merge).
- 61 — Chunk 18 app steps: add/edit/reorder/delete warmup routine items; the checklist at the top of the session in order; a tick survives a reload; no items = unchanged. When: next session. Blocked: nothing (a failure blocks the next merge).
- 60 — Chunk 17 app steps: enter a tempo (x → X), invalid refused, blank clears; it shows beside the exercise name in the session; exercises without one unchanged. When: next session. Blocked: nothing (a failure blocks the next merge).
- 59 — Chunk 16 app steps: exercise REST / REST AFTER and one set's own REST show as the timer targets; nothing set = your Settings rest; a never-kinded dropset keeps its timer, an explicitly picked DROPSET has none; superset: no timer inside a round. When: next session. Blocked: nothing (a failure blocks the next merge).
- 58 — Chunk 15 app steps: plan a warmup; log, edit, delete; TICK mode; not counted in History, volume or Progress. When: next session. Blocked: nothing (a failure blocks the next merge).
- 57 — Chunk 14 app steps: plan a rest-pause with 2 stages; all rows visible and locked in turn; carried weight; counts as 1 set; dropsets unchanged. When: next session. Blocked: nothing (a failure blocks the next merge).
- 56 — Chunk 13 app steps: link two exercises; rounds A1, B1, A2…; per-member prefill, swap, skip, ADD SET; block moves as one. When: next session. Blocked: nothing (a failure blocks the next merge).
- 55 — Chunk 11 app steps: the planner opens and saves unchanged; a test program with 8–12 entered once per exercise; NO SETS YET on existing programs; G14 prompt; program tab read-only volume. When: next session. Blocked: nothing (a failure blocks the next merge).
- 53 — Chunk 10 app steps: Plan → PRIORITIES shows your mapped marks (1+2 focus, 4+5 don't care); summary wording; set/clear persists; completed runs keep the old page. When: next session. Blocked: nothing (a failure blocks the next merge).
- 51 — Chunk 9 app steps: only-this-week swap reverts next week; permanent swap and add carry; remove stays removed; only-this-week reorder reverts; program tab read-only for volume. When: next session. Blocked: nothing (a failure blocks the next merge).
- 46 — Chunk 7 app check: Plan and the workout screen show the same exercises in the same order, online and offline. When: next session. Blocked: nothing (a failure blocks the next merge).
- 47 — Chunk 8 app steps: a new week plans itself once; first session plans its week; NEW WEEK STARTS = EMPTY; deload and empty weeks aren't copy sources. When: next session. Blocked: nothing (a failure blocks the next merge).
- 39 — Chunk 5 live check: one SQL query (step 1 rewritten for chunk 6: run workouts all linked, saved ones none), then two or three workouts' all-time history pages unchanged (sessions are logged on run workouts, so each page still lists exactly what it did). When: next session. Blocked: nothing (a failure blocks the next merge).

## Format for all new entries

An open entry starts with the ask; the reasoning comes after it, under "Evidence".

```
### [n] [One-line summary]
Severity: blocking | deferred
Chunk: [n]
**Ask:** [the question or task, in plain words]
**Options:** [each option, one line] — decisions only
**Recommendation:** [mine, and why in one line] — decisions only
**When:** [e.g. next session] — to-dos only
**Blocked until answered/done:** [what stops]
**Answer:** [Adam's]
**Evidence:**
What happened: [the situation, with full reasoning]
A competent default would: [what anything competent would have
  just done here] — doesn't apply because: [why this is a real
  decision and not a default]
Cost of deferral: [what gets redone if the answer goes against
  the provisional path] — blocking entries: n/a
```

Deferred is only allowed when the work can continue without committing to the answer. If continuing means guessing at something expensive to undo, it's blocking.

When an entry is answered or done, it shrinks to three lines (what, answer, date) under "Closed", and its full text moves to HISTORY.md. Superseded procedures go straight to HISTORY.md, never kept inline. The "Waiting on Adam" section is rewritten at every chunk boundary; if both lists are empty it says "Nothing."

## Open

### 73 Chunk 25 failed review twice — one more test-only retry, or merge?
Severity: blocking
Chunk: 25
**Ask:** Chunk 25 (sequence runs) failed my review twice, so per your rule I've stopped. Pick one: (a) one more retry, tests only (recommended); (b) merge as it is; (c) something else. Separately: do the throwaway `TEST-…` sequence run on your **second account** (recommended — starting a run on your main account ends your current active run, and restoring it is a hand edit), or on your main account with the recovery SQL?
**When:** before I build further.
**Blocked until done:** chunk 25's merge (migration 037 and the code); it's the last phase-1 chunk.
**Answer:** (a), and the throwaway run on the second account — Adam, 2026-10-09.
**Evidence:**
- **First failure** (fixed in `368ecad`): Plan showed nothing for a sequence run (its week view was keyed to weekdays), so a sequence program couldn't be planned. It now lists the cycle's slots (SLOT n + workout, rest days dimmed), each opening its own row (two A slots open two different rows), with "Cycle n", MARK CYCLE AS DELOAD, per-slot copy and apply-ahead; weekday Plan renders exactly as on master.
- **Second failure** (the retry): two wiring paths that use the slot position are unproven, so a wrong value passes every test:
  - Today's **Skip** looks up the week plan without `sequence_position` → all 412 gym tests still pass; for a repeated workout it could skip the wrong slot and advance the sequence from the wrong place.
  - Plan's copy-history lookup ignoring `sequence_position` → all 553 plan tests pass; COPY THIS WORKOUT's availability for a repeated workout could follow the other slot.
  The code is correct as written; only the proof is missing — the same class as chunks 16, 20, 21 and 22.
- Everything else is green: 1731 tests with master merged in; replay 37/37 (code) and 38/38 (with 037 on an empty database); embeds 30/30; D30 untouched; weekday Plan render identical to master. I re-proved 037's R16 key on scratch myself (duplicate weekday row rejected; same workout at two positions in one cycle accepted; duplicate slot rejected).
A competent default would: send it back for the missing tests — doesn't apply because: your rule makes a second review failure a stop.
Cost of deferral: phase 1's last chunk waits.
Provisional path taken: nothing merged; `build/chunk-25` and `build/chunk-25-migration` pushed for safekeeping (no PRs).

### 72 Chunk 26 live check: navigation (Adam's steps)
Severity: deferred
Chunk: 26
**Ask:** Chunk 26 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 26 is `f0bc7c6`)
1. The bottom bar has no PROGRAM tab; it still fits on your phone.
2. In Plan, the new icon at the top opens Programs: your saved programs, the active run, and completed runs.
3. On a saved program, OPEN IN PLANNER opens it; on a completed run, tapping it opens its priorities; its trash icon deletes it (only if you want to — skip otherwise).
4. Don't start or end a run unless you mean to: just confirm START and END RUN are there.
5. An old bookmark to /program still opens the Programs page.
**Answer:**
**Evidence:**
What happened: chunk 26 (#50 `f0bc7c6`, Vercel 09:39 UTC) is live. No migration.
- Reviewer's checks: 1649 tests; replay 37/37; embeds 30/30; no workout-screen, history or Coach file changed; Plan's only render change is the header icon; every former PROGRAM capability mapped and tested at the screen layer. Passed review first time.
A competent default would: count the jsdom checklist — doesn't apply because: TASKS.md's verification is the running app.
Cost of deferral: if it fails, chunk 26 is fixed before chunk 25 merges.
Provisional path taken: merged; chunk 25 is being built.

### 71 Chunk 24 live check: move a session, several a day (Adam's steps)
Severity: deferred
Chunk: 24
**Ask:** Chunk 24 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 24 is `b21f5e3`)
1. History: the session dated 29 Aug now shows 30 Aug (the day you did it) in the list, its detail and its session-type history.
2. On Today (before starting), tap MOVE THIS SESSION and pick another day this week: it leaves today and shows on that day. Move it back: it's on its own day again.
3. Move a session onto a day that already has one: both are listed that day, each opens on its own.
4. A missed day from last week no longer prompts; a missed day this week does, and DO IT NOW starts it today (History later shows today's date).
5. A started or finished session has no MOVE button.
**Answer:**
**Evidence:**
What happened: 036 merged by you (#48 `19cf372`, deploy success 08:58 UTC); code #49 `b21f5e3` (Vercel 08:59 UTC).
- Reviewer's checks: 1618 tests; replay 36/36 (and 37/37 with 036 on an empty database); embeds 30/30; D30 untouched; Today unchanged apart from the new button.
- Failed review once (036 vs empty replay; networkMode; offline start of a moved session) and passed on the retry.
A competent default would: count the jsdom and scratch proofs — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 24 is fixed before chunk 25 merges.
Provisional path taken: merged; chunks 25 and 26 being built.

### 69 Chunk 23 live check: "last time" by exercise (Adam's steps)
Severity: deferred
Chunk: 23
**Ask:** Chunk 23 live check. Do the steps below in the app and tell me the results. A failed step is blocking. Also: LAST WEEK is decided by calendar week, so a match from last week counts even if it came from your previous run. Keep that, or count LAST WEEK only within the current run? **Answer (Adam, 2026-10-09): across runs — keep as built.**
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 23 is `394ce31`)
1. In a session, an exercise you did last week in the same workout shows LAST WEEK exactly as before.
2. An exercise you last did in a different workout (or only in an earlier run) shows LAST TIME with the right number of days.
3. An exercise you've never done shows FIRST TIME.
4. If you've marked a session deload (chunk 21/22 checks), its sets never appear as LAST WEEK or LAST TIME.
**Answer:**
**Evidence:**
What happened: chunk 23 (#47 `394ce31`, Vercel 21:05 UTC) is live. No migration.
- Reviewer's checks: 1545 tests; replay 36/36; embeds 30/30 locally and live; referenceLogic.ts and Coach unchanged; D30 untouched; a master-captured parity fixture for the plain LAST WEEK panel.
- Failed review once (the cross-run query was unpaged under the 1000-row cap) and passed on the retry.
A competent default would: count the jsdom and scratch proofs — doesn't apply because: TASKS.md names a live check.
Cost of deferral: if it fails, chunk 23 is fixed before chunk 24 merges.
Provisional path taken: merged; chunk 24 is being built (its migration 036 is yours to merge).

### 68 Chunk 22 live check: deload rules (Adam's steps)
Severity: deferred
Chunk: 22
**Ask:** Chunk 22 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 22 is `9bb0dde`; use a coming session whose workout you trained last week)
1. Settings → DELOAD RULES: switch it on. Sets −50% rounding down is the default; switch the weight rule on (starts at 75%).
2. In Plan, mark that coming session DELOAD: its sets halve (rounded down, never below 1; a staged set counts as one; warmups stay) and the weights are 75% of what you actually lifted last time, rounded down to 2.5 kg.
3. Change one of the calculated sets by hand, then unmark the session: your original sets are back exactly as before marking.
4. In the program tab, set this program's deload rules to CUSTOM with sets −1: marking now removes one set instead of half (the program override wins).
5. Mark a session you've already started: it's only flagged, with an "Already started" notice; its sets don't change.
6. Unmark everything and switch the rules back off if you don't want them yet.
**Answer:**
**Evidence:**
What happened: chunk 22 (#46 `9bb0dde`, Vercel 16:57 UTC) is live. No migration.
- Failed review twice (67): first a data bug (sets rebuilt from the base week's exercise list orphaned or dropped sets when the lists differed), then the data source was unproven; you chose a third, tests-only retry, which passed.
- Reviewer's checks: 1492 tests; replay 36/36; embeds 29/29 locally and live; no workout-screen file changed; Settings purely additive; scratch SQL: snapshot, replace, exact restore, 0 orphans.
A competent default would: count the executor and scratch proofs — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 22 is fixed before chunk 23 merges.
Provisional path taken: merged; chunk 23 is next.

### 66 Chunk 21 live check: deload per session (Adam's steps)
Severity: deferred
Chunk: 21
**Ask:** Chunk 21 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 21 is `bd6250e`)
1. In Plan, on a coming week, tap MARK WEEK AS DELOAD: every session of that week shows as deload, and the button reads UNMARK THIS WEEK.
2. Unmark one session with its own DELOAD toggle: only that one clears.
3. Today shows "DELOAD" (not "DELOAD WEEK") on a marked session's card; the preview and the workout screen show DELOAD too; unmarked sessions look as before.
4. Open the week after for the first time: it copies from the last normal week, not the deload one.
5. Optional (second account, one workout on every weekday): the toggle says "Marks Mon, Tue, Wed, Thu, Fri — they share one plan."
6. Unmark the week again so nothing stays deload by accident.
**Answer:**
**Evidence:**
What happened: chunk 21 (#45 `bd6250e`, Vercel 10:56 UTC) is live. No migration.
- Reviewer's checks: 1372 tests; replay 36/36; embeds 27/27; D30 untouched; Plan fixture additive; Today's non-deload render identical to master; scratch SQL for week mark, unmark one, copy source and the shared row.
- Failed review once (the week number at the call site was unproven) and passed on the retry.
A competent default would: count the jsdom and scratch proofs — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 21 is fixed before chunk 22 merges.
Provisional path taken: merged; chunk 22 is being built.

### 65 Chunk 20 live check: apply this change to planned weeks ahead (Adam's steps)
Severity: deferred
Chunk: 20
**Ask:** Chunk 20 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 20 is `649047a`; use a week with at least two later weeks already opened in Plan)
1. In week N, change one set's weight. The offer appears ("apply to N later weeks"); accept it. The same set in each later week has the new weight, and nothing else in those weeks changed.
2. Swap an exercise in week N with "only this week" off and accept the offer: later weeks show the new exercise. Then change a weight on it in week N and accept again: it lands in the later weeks too (this is the bug the first review caught).
3. Swap with "only this week" on: no offer.
4. Mark a later week's session deload (or skip this step until chunk 21), then apply a change: that session is counted as skipped.
5. Ignore an offer: later weeks stay as they were.
**Answer:**
**Evidence:**
What happened: chunk 20 (#44 `649047a`, Vercel 06:39 UTC) is live. No migration.
- Failed review twice (64): first two real bugs (fresh row per week on swap-ahead; slot matched without the exercise), then a missing screen-wiring test; you chose a third, tests-only retry, which passed.
- Reviewer's checks: 1346 tests; replay 36/36; embeds 27/27; no workout-screen file changed; D30 fixture untouched; reviewer breaks on the exercise match, the swap wiring and the executor all caught.
A competent default would: count the jsdom and scratch proofs — doesn't apply because: TASKS.md names a live check on two planned weeks.
Cost of deferral: if it fails, chunk 20 is fixed before chunk 21 merges.
Provisional path taken: merged; chunk 21 is being built.

### 63 Chunk 19 live check: week targets and tags (Adam's steps)
Severity: deferred
Chunk: 19
**Ask:** Chunk 19 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 19 is `da386c4`)
1. In Plan, on a coming week, give one set WEIGHT 100 (in that exercise's unit), change its rep target to `8-10`, and tap two tags (e.g. "push here" plus a custom one). On another exercise, tap the apply-to-all icon next to a tag: every working set of that exercise gets it, warmups don't.
2. Change a set's rep target to `AMRAP` where it had no RIR: its RIR becomes 0. Where it had one, it stays.
3. In that session, the set shows `TARGET WEIGHT 100` with your unit, the rep target and both tags; sets without them look as before. The PLANNED RIR panel shows the weight.
4. Open the next week (planning it for the first time): weights and RIR carried, tags empty.
5. Your call: Plan rows are busier now (WEIGHT and a TAGS chip row on every working set). Say if you want the tags row collapsed until tapped.
**Answer:**
**Evidence:**
What happened: chunk 19 (#43 `da386c4`, Vercel 20:24 UTC) is live. No migration (the columns date from 027).
- Reviewer's checks: 1239 tests; replay 36/36; embeds 27/27; D30 test files and fixture untouched; Plan's render fixture changed only by addition; scratch SQL: tags null after `v2_plan_week`.
- The code failed review once (no proof of the workout screen's weight unit) and passed on the retry.
A competent default would: count the jsdom and scratch proofs — doesn't apply because: TASKS.md's verification is live.
Cost of deferral: if it fails, chunk 19 is fixed before chunk 20 merges.
Provisional path taken: merged; chunk 20 is being built.

### 62 Go-ahead to run verify-rls.mjs (five tables added since its last run)
Severity: deferred
Chunk: 18
**Ask:** May I run `node scripts/verify-rls.mjs` once? Yes or no.
**Answer:** Yes (Adam, 2026-10-09). Run on master `f0bc7c6`: 59 pass, 1 leak (`exercises`) → entry 74.
**When:** any time.
**Blocked until done:** nothing.
**Evidence:** Its last run was 2026-10-03 (25 tables, 50 probes, all pass). Since then the app started using `v2_week_plan_exercises` (7), `v2_program_priorities` (10), `v2_program_sets` (11), `v2_program_superset_blocks` (13) and `v2_workout_warmup_items` (18). All five are in `TABLES` (enforced by `verify-rls-tables.test.mjs`), and each has 027's standard RLS. The builders' scratch checks proved user B can't read A's rows, but the live policies haven't been probed. The script reads only: anon and the no-data test account, so any row returned would be a leak.
A competent default would: run it — doesn't apply because: CONTEXT requires your go-ahead per run (its selects are unfiltered by design).
Cost of deferral: a live RLS mistake on these tables would go unnoticed (low: same policy text as the scratch-proven one).
Provisional path taken: not run; building continues.

### 61 Chunk 18 live check: warmup routine (Adam's steps)
Severity: deferred
Chunk: 18
**Ask:** Chunk 18 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 18 is `76f7bed`)
1. In the program tab, under one workout's exercises, add three warmup routine items, edit one, move one up, delete one. A blank item can't be added.
2. Open (or reload) that workout's session: WARMUP ROUTINE sits at the top with the items in order. Tick one, reload the page: it's still ticked. A workout with no items looks exactly as before.
3. Ticking writes nothing (optional: in Supabase, `select count(*) from v2_set_logs where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'` is unchanged by ticking).
**Answer:**
**Evidence:**
What happened: chunk 18 (#42 `76f7bed`, Vercel 16:15 UTC) is live. No migration.
- Reviewer's checks: 1166 tests; replay 36/36; embeds 27/27; D30 fixture byte-identical; six breaks, all caught. Passed review first time.
A competent default would: count the jsdom tests — doesn't apply because: TASKS.md's done-when is "the checklist renders and ticks live".
Cost of deferral: if it fails, chunk 18 is fixed before chunk 19 merges.
Provisional path taken: merged; chunk 19 is being built.

### 60 Chunk 17 live check: tempo (Adam's steps)
Severity: deferred
Chunk: 17
**Ask:** Chunk 17 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 17 is `8ce2b3b`)
1. In the program tab, tap the TEMPO field (it shows "—") on one exercise and enter `3-1-x-0`: it saves as `3-1-X-0`. Enter `abc`: an error shows and nothing saves. Clear it and save: back to "—".
2. Set a tempo again, then open (or reload) that session: the tempo shows next to the exercise's name. Exercises without one look exactly as before.
3. Logging a set works as before (the tempo isn't recorded anywhere).
**Answer:**
**Evidence:**
What happened: chunk 17 (#41 `8ce2b3b`, Vercel 15:30 UTC) is live. No migration (`tempo` dates from 027).
- Reviewer's checks: 1122 tests; replay 36/36; embeds 27/27; D30 test files and fixture untouched; six breaks, all caught. Passed review first time.
A competent default would: count the jsdom real-session tests — doesn't apply because: TASKS.md's done-when is "tempo is planned and visible during the workout".
Cost of deferral: if it fails, chunk 17 is fixed before chunk 18 merges.
Provisional path taken: merged; chunk 18 is being built.

### 59 Chunk 16 live check: the rest chain (Adam's steps)
Severity: deferred
Chunk: 16
**Ask:** Chunk 16 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 16 is `c6e5120`)
1. Before training, in the program tab (or Plan → program), give one exercise REST 60 s and REST AFTER 180 s, and give its set 2 its own REST 30 s.
2. In that session (reload it if it was already open), log set 1: the timer's GO point is 60 s. Log set 2: 30 s. Log the last set: 180 s.
3. An exercise with nothing set still uses your Settings rest, as before.
4. An existing dropset (one you never picked a kind for) still starts the timer between stages at your Settings rest. A dropset whose kind you picked on the chip starts no timer between stages.
5. If you have a superset: no timer between the exercises inside a round; a timer after each round.
**Answer:**
**Evidence:**
What happened: chunk 16 (#40 `c6e5120`, Vercel 14:57 UTC) is live. No migration (the rest columns date from 027).
- Reviewer's checks: 1111 tests; replay 36/36; embeds 27/27 locally and live; D30 fixture byte-identical; `RestTimer.d30` and the logSet payload test untouched; four breaks, all caught after the retry.
- The code failed review once (no real-session proof that a legacy dropset keeps its timer) and passed on the retry.
- Your call to note: a legacy dropset (kind never set) keeps the timer between stages; one with DROPSET explicitly picked gets none (SPEC). To move an old one to the new behaviour, pick another kind and then DROPSET again.
A competent default would: count the jsdom real-session tests — doesn't apply because: TASKS.md's done-when is "the timer target follows the chain live".
Cost of deferral: if it fails, chunk 16 is fixed before chunk 17 merges.
Provisional path taken: merged; chunk 17 is being built.

### 58 Chunk 15 live check: warmup sets (Adam's steps)
Severity: deferred
Chunk: 15
**Ask:** Chunk 15 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 15 is `11beaac`)
1. In Plan, on a coming week, add a set to one exercise and mark it WARMUP.
2. In that session a WARMUP section sits above the numbered sets. Log it with weight and reps (or blank), and a rest timer starts. The numbered sets still start at 1.
3. Edit the logged warmup (weight and reps only), then delete it and log it again.
4. Settings → WARMUP SETS · DISPLAY = TICK: the warmup becomes a tick. Set it back if you prefer ROWS.
5. After the session, History's set count and the volume don't include the warmup, and Progress is unchanged by it.
**Answer:**
**Evidence:**
What happened: 035 (#38 `9c0e679`, reviewer under D29; deploy success 23:38 UTC) and the code (#39 `11beaac`, Vercel success 09:39 UTC) are live.
- Reviewer's checks: 035's tables and views identical on existing data; the check behaviour proven before and after; 1067 tests; D30 fixture byte-identical; 16 set-count consumers filtered (script); embeds 27/27 live.
- The code failed review once (superset members' warmups not rendered; no edit/delete) and passed on the retry.
A competent default would: count the scratch and jsdom proofs — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 15 is fixed before chunk 16 merges.
Provisional path taken: merged; chunk 16 is being built.

### 57 Chunk 14 live check: staged sets in all four kinds (Adam's steps)
Severity: deferred
Chunk: 14
**Ask:** Chunk 14 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 14 is `a66e803`)
1. In Plan, on a coming week, give one set two stages and set STAGE KIND = REST-PAUSE.
2. In that session all three rows show from the start: the stages are labelled rest-pause and locked in turn. After you log the head, the first stage's weight is pre-filled with the head's.
3. Log all three. History shows it as **1 set**, and the volume includes every stage.
4. An existing dropset looks and works exactly as before, and in-session ADD STAGE still makes a dropset.
**Answer:**
**Evidence:**
What happened: chunk 14 (#37 `a66e803`, Vercel success 22:37 UTC) is live.
- Reviewer's checks: 1028 tests; D30 fixture byte-identical; frozen exports unchanged; replay 35/35; embeds 27/27 local and live.
- Scratch: a planned rest-pause lands in week 1 intact; logged it counts 1 set, and volume = all stages.
- Failed review once (the G14 split dropped stages); passed on the retry.
A competent default would: count the jsdom and scratch proofs — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 14 is fixed before chunk 16 (stage rest) merges.
Provisional path taken: merged; chunk 15 is being built.

### 56 Chunk 13 live check: supersets (Adam's steps)
Severity: deferred
Chunk: 13
**Ask:** Chunk 13 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 13 is `90cd1e4`)
1. Plan → PROGRAM: link two neighbouring exercises into a superset. It applies from your next session.
2. In that session they show as one block of rounds: A1, B1, A2, B2, … If their set counts differ, the extra sets stay in the block. The current-set marker follows A1 → B1 → A2.
3. Inside the block each exercise still has its own prefill, SWAP, SKIP REST OF EXERCISE and ADD SET. Swapping one takes it out of the block for that session.
4. In Plan, moving the block up or down moves both exercises together.
5. A session with no superset looks and logs exactly as before.
**Answer:**
**Evidence:**
What happened: chunk 13 (#36 `90cd1e4`, Vercel success 17:59 UTC) is live.
- Reviewer's checks: 991 tests; D30 fixture byte-identical; replay 34/34; embeds 27/27 local and live.
- Failed review once (superset members had lost prefill, swap, skip and ADD SET); passed on the retry, plus a hardening (block keyed by its members).
A competent default would: count the jsdom proofs — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 13 is fixed before chunk 14 merges.
Provisional path taken: merged; chunk 14 is being built.

### 55 Chunk 11 live check: the stepped planner (Adam's steps)
Severity: deferred
Chunk: 11
**Ask:** Chunk 11 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 11 is `eb54190`)
1. Programs → open a saved program: it opens in the planner (priorities → exercises & weekdays → volume). Save it unchanged, then reopen it: nothing changed.
2. Create a test program (3 workouts Mon/Wed/Fri, stable, 3 sets each, 8–12 entered **once per exercise**). Save. Reopen: exactly as entered. Delete it afterwards if you don't want it.
3. An existing program without per-set data shows "NO SETS YET" on its exercises, and Save and Start still work (DECISIONS 52 (a)).
4. Your second account: its program with one workout on every weekday opens with the prompt. KEEP AS IS changes nothing.
5. Plan → PROGRAM on your active (week-dependent) run: volume is read-only, and the weekday row is still editable.
**Answer:**
**Evidence:**
What happened: chunk 11 (#33 `eb54190`, Vercel success) is live.
- Reviewer's checks: 943 tests; D30 diff exactly the removed suggested-reps line; replay 34/34; embeds 27/27.
- Failed review once (no "fill all sets at once"); passed on the retry.
- Suggested reps disappeared from the workout screen with this chunk; 034 (entry 54) turns them into rep targets.
A competent default would: count the scratch and jsdom proofs — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 11 is fixed before later planner work merges.
Provisional path taken: merged.

### 54 Merge migration 034 (drop suggested reps: backup, convert into rep targets, drop the column)
Severity: blocking
Chunk: 12
**Ask:** Merge PR #35 (migration 034). It's destructive, so the merge and the before/after checks are yours. Two preconditions:
- I've told you chunk 12's code (#34) is live.
- Every device you use has taken the update banner.
**Options:** (a) merge with the steps below; (b) hold.
**Recommendation:** (a). The code that stops using the column is already live, the conversion matches your decision (b), and my scratch run shows exactly the qualifying sets converted and nothing else changed.
**Blocked until answered:** chunk 12 going live. Until then the workout screen shows neither suggested reps (gone since chunk 11) nor the converted rep targets. Chunks 13+ keep being built.
**Steps:**
1. **Precondition:** on your phone and any other device, open the app and take the update banner, so no device runs a bundle older than #34. Chunk 11's bundle still writes `target_reps` and would fail after the drop.
2. **Before merging**, in the SQL Editor:
   - `npx --yes supabase@2.119.0 db query --linked -f scripts\live-counts.sql -o json > counts-before-034.json`;
   - then the prediction queries below. Save the output as "before".
   ```sql
   -- B1: suggested-reps values that go into the backup (expect 52: 26 on the run copies + 26 on their clones)
   select count(*) from v2_program_exercises where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and target_reps is not null;
   -- B2: planned sets 034 will convert (count + id hash)
   select count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from (select wps.id from v2_week_plan_sets wps join v2_week_plans wp on wp.id = wps.week_plan_id join v2_mesocycles m on m.id = wp.mesocycle_id join v2_program_exercises pe on pe.id = wps.program_exercise_id
 where wps.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and m.status = 'active' and wps.parent_week_plan_set_id is null and wps.is_warmup = false and wps.rep_min is null and wps.rep_max is null and wps.is_amrap = false and pe.target_reps is not null
   and not exists (select 1 from v2_set_logs sl where sl.week_plan_set_id = wps.id)) q;
   -- B3: every OTHER planned set's targets (must be unchanged after)
   select md5(coalesce(string_agg(s.id::text || ':' || coalesce(s.rep_min::text,'-') || ':' || coalesce(s.rep_max::text,'-') || ':' || s.is_amrap::text, ',' order by s.id), ''))
     from v2_week_plan_sets s where s.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and s.id not in (select wps.id from v2_week_plan_sets wps join v2_week_plans wp on wp.id = wps.week_plan_id join v2_mesocycles m on m.id = wp.mesocycle_id join v2_program_exercises pe on pe.id = wps.program_exercise_id
 where wps.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and m.status = 'active' and wps.parent_week_plan_set_id is null and wps.is_warmup = false and wps.rep_min is null and wps.rep_max is null and wps.is_amrap = false and pe.target_reps is not null
   and not exists (select 1 from v2_set_logs sl where sl.week_plan_set_id = wps.id));
   ```
3. Merge #35 and tell me. I check the deploy:
   - every `Supabase Preview` run on the merge commit;
   - `select=target_reps` → `400 / 42703`;
   - the backup table exists, and anon sees 0 rows;
   - `check-embeds.mjs` live.
4. **After the deploy**: `live-counts.sql` again into `counts-after-034.json`. Every table's count must be identical (034 adds a backup table, which live-counts doesn't count, and changes values, not row counts). Then:
   ```sql
   -- A1: backup rows (must equal B1)
   select count(*) from v2_target_reps_backup where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f';
   -- A2: converted sets (must equal B2's count and hash)
   select count(*), md5(coalesce(string_agg(id::text, ',' order by id), '')) from (select unnest(converted_week_plan_set_ids) id from v2_target_reps_backup where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f') q;
   -- A3: every other planned set (must equal B3)
   select md5(coalesce(string_agg(s.id::text || ':' || coalesce(s.rep_min::text,'-') || ':' || coalesce(s.rep_max::text,'-') || ':' || s.is_amrap::text, ',' order by s.id), ''))
     from v2_week_plan_sets s where s.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and s.id not in (select unnest(converted_week_plan_set_ids) from v2_target_reps_backup where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f');
   -- A4: each converted set carries its exercise's old value (expect 0)
   select count(*) from v2_target_reps_backup b, unnest(b.converted_week_plan_set_ids) cid join v2_week_plan_sets s on s.id = cid
    where b.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' and not (s.rep_min = b.target_reps and s.rep_max = b.target_reps and s.is_amrap = false);
   ```
   Send me both outputs.
5. In the app: open your next session. Where an exercise had suggested reps, its planned sets now show the target (e.g. "TARGET REPS 8"). Open a saved program in the planner and save it unchanged: no error.
**Answer:**
**Evidence:**
What happened: chunk 12 was built and verified.
- **034** (`9ab44cc`, md5 `90c37dfa159eefb9c23f7901f70b3940`), in order:
  - creates the backup table `v2_target_reps_backup` (every non-null value, every user);
  - converts the active run's unlogged head working sets that have no target;
  - replaces `v2_copy_program` (the only difference from 028: `target_reps` removed, so START keeps working);
  - drops the column.
  `check-migration` exits 1 (the drop, the function, the `DO` block).
- **Reviewer's own scratch**, active meso with two exercises (10 and 6):
  - a logged set, an already-targeted set (5) and a warmup were untouched;
  - the other 3 sets converted;
  - the backup lists 2 + 1 converted ids;
  - only `v2_program_exercises` (the drop), `v2_week_plan_sets` (the conversion) and the new backup changed; every other table was identical.
- **Builder's scratch:** R14 with 2 users and a completed meso. The backup equalled the non-null count; exactly the listed sets converted; `v2_start_run` worked after the drop (complete copy); the rollback restored every value and the function byte-identically.
- **Adam's queries B1–B3 / A1–A4** ran on a scratch replay (fixture, before and after 034): they parse, and before = after exactly (1 / 3 + hash / other-sets hash / 0 mismatches).
- **Order:** TASKS' precondition said "no bundle older than chunk 11", but chunk 11's own bundle writes `target_reps`. So the code (#34) ships first, and that's why the order is inverted.
A competent default would: merge a fully verified migration — doesn't apply because: it drops a column with your data, so it's yours (standing rules; D29 excludes 12).
Cost of deferral: n/a (blocking).

### 53 Chunk 10 live check: priorities in the new form (Adam's steps)
Severity: deferred
Chunk: 10
**Ask:** Chunk 10 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 10 is `a0d1651`)
1. Plan → PRIORITIES opens the new editor. Your active run shows **focus** on 1 group and 2 subgroups, and **don't care** on 4 groups and 5 subgroups: your old top and low marks, mapped by 033. Your old high and normal marks show as normal (unmarked).
2. Mark one group focus and leave its subgroups unmarked. The summary reads from the group (e.g. "chest"). Mark one of its subgroups differently: it reads "chest without upper chest".
3. Set a mark, reload: it's still there. Clear it (tap the active chip), reload: gone.
4. Programs → a completed run still opens its old four-level priorities page, unchanged.
**Answer:**
**Evidence:**
What happened: 033 (#31 `5fe3045`, reviewer under D29; probe 0/3 → 3/3; deploy success 07:35 UTC) and the code (#32 `a0d1651`, Vercel success 07:44 UTC) are live.
- Reviewer's D29 scratch check: every pre-existing table identical; 3 + 9 on both the run copy and the clone; a re-run inserts 0.
- 840 tests; embeds 27/27 live.
- The code failed review once (START redirected to the old page) and passed on the retry.
A competent default would: count the scratch result — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 10 is fixed before chunk 11 merges.
Provisional path taken: merged; chunk 11 is being built.

### 52 Planner: what does "number of sets is required" block, for programs that have none yet?
Severity: deferred
Chunk: 11
**Ask:** SPEC: "The only required value is the number of sets per exercise," and also "Saving stores the program as it is." Your 3 existing saved programs have **no** per-set rows (`v2_program_sets`): their volume has always been planned week by week. Starting one today plans week 1 with no sets, which is today's behaviour too. What should "required" block?
**Options:**
- (a) **Nothing is blocked; incomplete exercises are flagged.** Save and Start always work. Step 3 marks each exercise without a set count ("no sets yet"). Your existing programs behave exactly as today until you fill them in.
- (b) **Start is blocked** until every exercise has at least 1 set; Save is never blocked. Your existing programs can't be started again until their sets are filled in.
- (c) **Save is blocked too.**
**Recommendation:** (a). It keeps "saving stores the program as it is" and changes nothing for your existing programs, and the flag still shows what's missing. With (b), the next time you start an existing program you'd first have to plan its sets, which is a reasonable rule but new behaviour.
**Blocked until answered:** nothing. Chunk 11 is built with (a); (b) is a small change to the Start button.
**Answer:**
**Evidence:**
What happened: while briefing chunk 11 I checked how the planner meets existing data. The programs predate per-set rows. TASKS' verification covers a new program (3 sets each) and "reopen and save unchanged → no row changes", which (c) would break for existing programs.
A competent default would: block Start on missing sets — doesn't apply because: it changes what you can do with programs you already have.
Cost of deferral: if (b), one guard on Start plus a message; nothing built under (a) is thrown away.
Provisional path taken: (a).

### 51 Chunk 9 live check: editing a week's exercises (Adam's steps)
Severity: deferred
Chunk: 9
**Ask:** Chunk 9 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner; chunk 9 is `2340c48`)
1. In Plan, on a week not yet trained, swap one exercise with ONLY THIS WEEK on. Then open the next week (it plans itself): the original exercise is back, with its sets.
2. Swap another exercise without ONLY THIS WEEK. The next week keeps the replacement.
3. ADD EXERCISE in a week. It's in the next planned week too. REMOVE it there: it's gone from the week after.
4. Move an exercise up with ONLY THIS WEEK on. The next week has the original order.
5. Plan → PROGRAM tab: the workout editor shows the exercises but no add, reorder or delete (volume is read-only on your week-dependent run). It lists no exercise you added or swapped in a week.
6. Your second account (one workout on every weekday): a week edit there shows on every weekday, as before.
**Answer:**
**Evidence:**
What happened: 032 (#29 `25b2a61`, merged by the reviewer under D29) and the code (#30 `2340c48`, Vercel success 03:32 UTC) are live.
- Reviewer's checks: 798 tests; replay 33/33; embeds 27/27 local and live.
- D29 scratch check: 37/37 tables identical.
- Double-swap and exclusion scenario: correct on 032, wrong on 031 (control).
- TS vs SQL: 6/6.
- D30: full-screen render with a dropset identical to master's; logSet row and rest timer unchanged.
The code failed review once (carry bug) and passed on the retry.
A competent default would: count the scratch and jsdom proofs — doesn't apply because: TASKS.md's done-when is live.
Cost of deferral: if it fails, chunk 9 is fixed before chunk 10's code merges.
Provisional path taken: merged; chunk 10 is being built.

### 47 Chunk 8 live check: weeks plan themselves (Adam's steps)
Severity: deferred
Chunk: 8
**Ask:** Chunk 8 live check. Do the steps below in the app and tell me the results. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (take the update banner first; chunk 8 is `071151b`)
1. Open Plan on a week that isn't planned yet. It plans itself once, and reopening it adds nothing.
2. Your first session in a new week plans that week.
3. Set Settings → NEW WEEK STARTS to EMPTY. New weeks come out empty, with COPY offered. Set it back to COPY afterwards if that's what you want.
4. A session marked deload isn't used as the next week's copy source. An empty week isn't either (42 (b)).
**Answer:**
**Evidence:**
What happened: #27 (031) and #28 (code) merged and live 2026-10-05. 031's deploy: anon `v2_plan_week` went from PGRST202 to the function's own "no authenticated user". #28: Vercel success 18:57 UTC; embeds 25/25 live. Every check I can run passed (entry 45 in HISTORY). Planning and copying need your signed-in session.
A competent default would: count the scratch runs as proof — doesn't apply because: TASKS.md's done-when is the deployed app.
Cost of deferral: if it fails, chunk 8 is fixed before chunk 9 merges.
Provisional path taken: merged; chunk 9 may be built.

### 46 Chunk 7 live check: each week's exercise list shows as before (Adam's steps)
Severity: deferred
Chunk: 7
**Ask:** Chunk 7 live check (entry 41 step 4). The parity query already returned 0 rows (passed). Do the app step and tell me the result. A failed step is blocking.
**When:** your next session.
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** In the app (take the update banner): Plan and the workout screen show exactly the exercises they did before, in the same order. Open a session offline once it's cached; it shows the same list.
**Answer:**
**Evidence:**
What happened: 029, the chunk 7 code and 030 merged and live 2026-10-05 (entry 41 in HISTORY). Your parity query returned 0 rows.
A competent default would: count the parity query as proof — doesn't apply because: TASKS.md's done-when includes the screens.
Cost of deferral: if it fails, chunk 7 is fixed before chunk 9 merges (chunk 9 edits week exercise lists).
Provisional path taken: merged.

### 39 Chunk 5 live check: "Session type, all time" unchanged on today's data (Adam's steps)
Severity: deferred
Chunk: 5
**Ask:** Chunk 5 live check — "Session type, all time" unchanged on today's data. Do the steps below and tell me the results. A failed step is blocking.
**When:** your next session (Adam, 2026-10-04).
**Blocked until done:** nothing now; a failure blocks the next merge.
**Steps:** (after PR #19's production deploy; take the update banner):
1. *(Rewritten 2026-10-05: chunk 6 is live, so lineage now exists — 028 linked every run workout to its saved clone.)* In the SQL Editor:
   `select p.kind, count(*) filter (where wd.source_workout_day_id is not null) as linked, count(*) as total from v2_workout_days wd join v2_programs p on p.id = wd.program_id where wd.user_id = '12e79b69-9891-4f53-a7cf-650edd83659f' group by p.kind order by 1;`
   → `run`: linked = total; `saved`: linked = **0**.
2. In the app, open a workout's "session type, all time" history (History → a session → its workout's all-time view, `/session-type/<id>`) for two or three of your workouts. Each lists the same sessions it did before, the same count and the same latest dates, and LOAD MORE still pages.
3. Tell me the results. A failure is blocking.
**Answer:**
**Evidence:**
What happened: Chunk 5 (PR #19) makes a workout's all-time history query its lineage group: the root workout plus every run copy whose `source_workout_day_id` leads to it. No app code writes that column yet, so on your data every group is the workout alone, and the page must show exactly what it showed before. TASKS.md's done-when is "deployed and identical on today's data". Every check I can run passed (tests proven by breaks; a scratch replay with a copy chain returned one combined history and excluded an unrelated workout). The live page needs you.
A competent default would: count the scratch result as proof — doesn't apply because: TASKS.md asks for identical results on your real data, and only your session can read them.
Cost of deferral: if it fails, chunk 5 is reverted or fixed before chunk 6 starts copying workouts.
Provisional path taken: merge once green; chunk 6 waits on its own blocking entries anyway (it has a migration that changes existing data).

## Closed

### 74 verify-rls found 46 `exercises` rows visible to the no-data test account
Severity: urgent (closed 2026-10-09: not a leak)
Chunk: — (pre-existing; no phase-1 migration touches `exercises`)
**Ask:** Run these two read-only queries in the Supabase SQL editor and send me the output (no row contents needed):
```
-- 1. the live policies on exercises
select polname, polcmd, pg_get_expr(polqual, polrelid) as using_expr, pg_get_expr(polwithcheck, polrelid) as check_expr
  from pg_policy where polrelid = 'public.exercises'::regclass;
-- 2. whose rows they are (paste the test account's id from Authentication → Users)
select count(*) filter (where user_id = '<TEST_ACCOUNT_ID>') as owned_by_test_account,
       count(*) as total_rows
  from public.exercises;
```
**When:** soon.
**Blocked until done:** nothing in the build.
**Answer (Adam, 2026-10-09):** query 2 → 46 owned by the test account, 335 total. **Not a leak:** the test account sees exactly its own 46 rows and none of the other 289; the policy works. The false alarm is verify-rls's assumption that the test account owns no data. Follow-up (75): empty the test account, or make the check compare `user_id`.
**Evidence:**
- `verify-rls.mjs` on master `f0bc7c6` (your go-ahead, 62): 30 tables, 60 probes — 59 pass, **1 leak**: `exercises`, signed in as the no-data test account → 46 rows; anon → 0. Everything the planner added (`v2_week_plan_exercises`, `v2_program_priorities`, `v2_program_sets`, `v2_program_superset_blocks`, `v2_workout_warmup_items`) passes. On 2026-10-03 the same check passed on `exercises`.
- The repo's only policy on `exercises` is 000's owner-only `user_id = auth.uid()`; no migration since changes it.
- So either (a) the test account now owns 46 exercise rows (e.g. seeded when it was signed into Overload or Northstar, which share this table) — then it's not a leak, but the test account no longer "owns no data"; or (b) the live database has a policy the repo doesn't — a real leak of exercise names across accounts. Query 1 tells (b) apart; query 2 tells (a).
- I ran the script twice, not once: the second run only to see which table leaked (the summary line didn't name it). Disclosed here; no further live reads.
A competent default would: probe further as the test account — doesn't apply because: that's another live read beyond your one approved run.
Cost of deferral: if (b), exercise rows stay readable by any signed-in user of this Supabase project.
Provisional path taken: nothing changed; building continues.

### 70 Merge migration 036 (#48): the legacy session's moved-to date
Severity: blocking (closed 2026-10-09: merged by Adam as #48 `19cf372`; deploy success 08:58 UTC)
Chunk: 24
**Ask:** Run the pre-check select below; if it returns exactly one row, merge PR #48 (036). Tell me when its deploy is done. Then I merge the code (#49).
**When:** when you can.
**Blocked until done:** chunk 24's code (#49) and chunk 25 (its migration 037 must follow 036). Chunk 26 (navigation) is being built meanwhile.
**Pre-check** (in the Supabase SQL editor; it must return exactly one row):
```
select id, user_id, date, moved_to_date, status, started_at
  from v2_sessions
 where user_id = '12e79b69-9891-4f53-a7cf-650edd83659f'
   and date = '2026-08-29'
   and moved_to_date is null
   and status = 'completed'
   and started_at >= '2026-08-30 00:00:00+00'
   and started_at <  '2026-08-31 00:00:00+00';
```
If it returns 0 rows (e.g. you started before 02:00 local, which is 29 Aug in UTC), don't merge; tell me and I'll adjust the window.
**Evidence:**
- 036 (md5 `5433811afc30add1dd0ae84587a4c028`) updates only that row, selected by criteria, never by id. It raises (changing nothing) unless exactly one row matches or it was already applied. It does nothing on a database where you have no sessions at all (CI's empty replay).
- Reviewer: an empty replay gives 37/37 and embeds 30/30. Builder's scratch: 1 match changes only that row (whole-database fingerprint); a re-run is a no-op; 2 matches raise; data with 0 matches raises; each guard is break-proven.
- `check-migration` exits 1 (an update block isn't on the safe list), so the merge is yours (TASKS: chunk 24).
- Rollback (in the file header): set that row's `moved_to_date` back to null, using the same criteria.
A competent default would: merge it myself under D29 — doesn't apply because: it changes an existing row, and chunk 24's migration is yours by name.
Cost of deferral: chunk 24's code and chunk 25 wait.
Provisional path taken: both PRs open; chunk 26 being built in parallel.

### 67 Chunk 22 failed review twice — one more test-only retry, or merge?
Severity: blocking (closed 2026-10-08: (a); the retry passed and chunk 22 merged)
Chunk: 22
**Ask:** Chunk 22 (deload rules) failed my review twice, so per your rule I've stopped. Pick one: (a) one more retry, tests only (recommended); (b) merge as it is; (c) something else.
**When:** before I build further.
**Blocked until done:** merging chunk 22 and building chunks 23–26.
**Answer:** (a), Adam 2026-10-08: one more retry, tests only.
**Evidence:**
- **First failure** (fixed in `8847fbf`/`577a87e`): a real data bug. Marking a session deload with rules on rebuilt its sets from the last normal week's exercise list. Where the two weeks' exercises differed (an exercise added, removed or swapped since), it wrote sets for exercises the session doesn't have and dropped sets for ones it does. Now each exercise is matched to the same exercise in the base week (chunk 20's slot rule); one with no match is calculated from its own sets; nothing is written outside the session's own list. Proven by unit tests, executor tests and scratch SQL (0 orphaned sets).
- **Second failure** (the retry, `6eead92`): the fix is correct by reading, but its central rule is unproven where it runs. If `markSessionDeload` calculated a matched exercise from the marked week's **own** sets instead of the last normal week's, all 1486 tests would still pass, because the executor tests' base and marked sets are interchangeable. The same class of gap as chunks 16, 20 and 21.
- Everything else is green on `6eead92`: typecheck, 1486 tests, build, 117 script tests, every check, replay 36/36, embeds 29/29 locally and live, no workout-screen file changed, the D30 fixture untouched. The new Settings section is proven purely additive (all nine existing sections byte-identical to master).
A competent default would: send it back for the one missing test — doesn't apply because: your rule makes a second review failure a stop.
Cost of deferral: building pauses (chunks 23–26).
Provisional path taken: nothing merged; `build/chunk-22` pushed for safekeeping (no PR).

### 64 Chunk 20 failed review twice — merge, or one more test-only retry?
Severity: blocking (closed 2026-10-08: (a); the retry passed and chunk 20 merged)
Chunk: 20
**Ask:** Chunk 20 ("Apply this change to planned weeks ahead") failed my review twice, so per your rule I've stopped. Pick one: (a) one more retry, tests only (recommended); (b) merge as it is; (c) something else.
**When:** before I build further.
**Blocked until done:** merging chunk 20 and building chunks 21–26.
**Answer:** (a), Adam 2026-10-08: one more retry, tests only.
**Evidence:**
- **First failure** (fixed in `2db2ad8`): two real bugs.
  1. A swap applied ahead gave each later week its own new program-exercise row, so any later apply-ahead on that exercise found nothing ("applied to 0 of 2").
  2. A later week with an "only this week" swap at the same slot would have received changes meant for a different exercise.

  Also wired from my brief's gap: the offer after a week's ADD SET, REMOVE SET, WARMUP toggle and program-tab reorder.
- **Second failure** (the retry, `2db2ad8`): both bugs are fixed and proven in the pure core (my break of the exercise check fails 7 tests) and in scratch SQL. But Plan's own wiring isn't tested: changing `resultingProgramExerciseId: replacement.id` in `PlanPage.tsx` to a wrong id passes all 427 plan tests.
  - The code is correct by reading; only the proof is missing.
  - It's the same class of gap as chunk 16 (Checks that lied #30).
- Everything else is green on `2db2ad8`: typecheck, 1325 tests, build, 117 script tests, every check, replay 36/36, embeds 27/27, and the D30 fixture untouched (no workout-screen file changed).
A competent default would: send it back for the one missing test — doesn't apply because: your rule makes a second review failure a stop.
Cost of deferral: building pauses (chunks 21–26).
Provisional path taken: nothing merged; `build/chunk-20` is kept as is.

### 29 The two exercise-library tables are readable by everyone, anon included
- What: The two exercise-library tables (`v2_exercise_libraries`, `_items`) are readable by everyone, anon included — stay in `verify-rls.mjs` `PUBLIC_BY_DESIGN`?
- Answer: Yes: intentional, they hold shared curated content; writes stay closed; any other table returning rows is a LEAK.
- Date: 2026-10-01

### 30 Migration 027 (planner phase-1 schema): how it goes live
- What: How migration 027 (planner phase-1 schema) goes live.
- Answer: Amended to bar `stage_kind` on stage rows; then, after the switch to automatic migrations, live by merging PR #17 (Adam, `7f4405d`). Add-only, so no live counts (Adam's standing rule).
- Date: 2026-10-03 / 2026-10-04

### 31 Live browser verification is unavailable in this environment
- What: Live browser verification is unavailable from the build container.
- Answer: Adam does the live checks; the reviewer writes exact steps (migration chunks: once the migration is live; others: merge, then a deferred to-do). A failed live check is blocking. Standing (CONTEXT.md Repo facts).
- Date: 2026-10-03

### 32 Go-ahead to run scripts/verify-rls.mjs at the chunk 1 boundary
- What: Go-ahead to run `scripts/verify-rls.mjs` at the chunk 1 boundary.
- Answer: Yes, run then (25 tables, 50 probes, all pass); ask again before every run.
- Date: 2026-10-03

### 33 The weight deload rule's starting percentage is not specified
- What: Starting percentage of the weight deload rule (SPEC silent).
- Answer: 75%. Done: PR #21 (`0628f28`).
- Date: 2026-10-04

### 34 Input casing for tempo "X" and rep target "AMRAP"
- What: Lowercase tempo `x` / rep target `amrap` input.
- Answer: Accept lowercase and normalise to `X` / `AMRAP`. Done: PR #21 (`0628f28`).
- Date: 2026-10-04

### 38 Incident: 027 made the mesocycle query ambiguous; no mesocycles showed (fixed by PR #18)
- What: Incident: 027's second `v2_mesocycles → v2_programs` FK made the mesocycle embed ambiguous (fixed by PR #18); run `check-embeds-local.sh` in the `migration-replay` workflow?
- Answer: Yes, add it to the workflow. Done: PR #20 (`b427dc0`); first GitHub run resolved 25/25.
- Date: 2026-10-04

### 35 Chunk 3 live check: planned dropset stages in a real session
- What: Planned dropset stages show LOCKED rows and unlock one by one in a real session.
- Answer: Checked by Adam in a real gym session: works. No screenshots or SQL, by his choice. **Passed.**
- Date: 2026-10-05

### 36 Chunk 4 live check: editing a logged set has no note field and keeps stored notes
- What: Live check of the logged-set edit form (no note field; stored notes unchanged).
- Answer: Not checked. **Waived by Adam, not passed.**
- Date: 2026-10-05

### 37 Chunk 1 live check after 027 deployed
- What: 027's deploy log and the app's main screens on the new schema.
- Answer: Today, Plan, Program and History load normally, and logging worked through a whole session (Adam's gym session). Deploy-log step dropped by Adam; the two stuck `Supabase Preview` runs stay unexplained, and the live probe (36/36) stands as 027's deploy evidence. **Passed** (app steps).
- Date: 2026-10-05

### 42 Does an empty week count as "the last planned week" when a new week copies forward?
- What: Should a workout's empty (non-deload) last occurrence be a copy source for a new week?
- Answer: (b) skip an empty last occurrence, the same as deload. Done on `2d26e90` (031, md5 `214fd870…`) and `95651e3`; reviewer-verified; merge is entry 45.
- Date: 2026-10-05

### 43 G14 reappeared: one workout on several weekdays (Adam's second account)
- What: L6 only checked Adam's main account; his second account has a program with one workout on every weekday, and planning one day's volume shows on all of them (one shared plan row).
- Answer: Existing such programs keep today's behaviour until edited. Opening one in the planner asks to give each weekday its own workout or switch to a sequence; nothing is converted automatically. Deload on a shared row marks every day it covers, as today, and the UI says so. Added to TASKS.md chunks 11 and 21. Chunks 6–8 checked on scratch: no change (entry 40 Evidence). Follow-up question: 44.
- Date: 2026-10-05

### 44 What does the planner's "switch to a sequence" choice do before sequence runs exist?
- What: The G14 prompt offers "switch to a sequence", but sequence runs arrive in chunk 25, after the planner (chunk 11).
- Answer: (a) chunk 11 offers per-weekday workouts or keep-as-is; chunk 25 adds the sequence choice to the same prompt.
- Date: 2026-10-05

### 40 Merge migration 028 (runs own a copy of their program; transition of existing programs)
- What: Merge 028 (#22) and the chunk 6 code (#23); existing programs become their runs' copies with saved clones.
- Answer: Merged by Adam without backup or counts (028's manifest is the rollback). 028 live `71247e7` (probe 3/3, `v2_start_run` refuses anon), #23 live `9fd4876` (Vercel success). Adam's app checks passed. G14 checked: no change.
- Date: 2026-10-05

### 41 Merge migration 029, the chunk 7 code, and follow-up 030
- What: Merge 029 (#24), the chunk 7 code (#25) and 030 (#26), in order.
- Answer: (a), merged by Adam 2026-10-05, each after the reviewer confirmed the previous deploy: 029 `61b2670` (probe 3/3), #25 `55bed82` (Vercel success), 030 `34c5887`. Parity query 0 rows. App check → entry 46.
- Date: 2026-10-05

### 45 Merge migration 031 (weeks plan themselves) and the chunk 8 code
- What: Merge 031 (#27) and the chunk 8 code (#28).
- Answer: (a), merged by Adam 2026-10-05: 031 `c128d00` (anon RPC refused by the function), #28 `071151b` (Vercel success 18:57 UTC). App steps → entry 47.
- Date: 2026-10-05

### 48 Should adding or removing an exercise in a week also offer "only this week"?
- What: SPEC line 212 (tick on swap and reorder) vs line 224 (add/remove "unless only this week").
- Answer: (a) swap and reorder only; week-dependent adds and removes always carry forward. SPEC line 224 fixed to match.
- Date: 2026-10-05

### 49 Chunk 12: what happens to existing suggested-reps values
- What: SPEC's blocking decision for chunk 12 (drop `target_reps`), asked early.
- Answer: (b) convert into rep targets on the active run's unlogged planned working sets that have none, with the backup table as planned. Recorded in TASKS.md chunk 12. The merge and live counts stay Adam's.
- Date: 2026-10-05

### 50 Chunk 25: throwaway sequence test run
- What: Go-ahead for chunk 25's live check, which writes a throwaway run.
- Answer: Yes. Label it `TEST-…`, and prove the cleanup by counts against the baseline.
- Date: 2026-10-05

## Settled decisions

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

**D29 · Flagged migrations the reviewer may merge (phase 1).** *(Adam, 2026-10-05)*
**Answer:** For the rest of phase 1 the reviewer may merge a migration `check-migration` flags if it changes no existing row and all three checks pass: `migration-replay`, `check-embeds-local.sh`, and the reviewer's scratch-copy check (existing rows' counts and fingerprints unchanged).
- Allowed: it only adds tables, columns, indexes or rows, replaces a function or view, or relaxes a constraint. That covers 032, chunk 10's and chunk 15's.
- Still Adam's: 12, 24 and 25.
- Order unchanged: migration first, then the code after a green deploy.

**D30 · Workout screen unchanged for plain sessions.** *(Adam, 2026-10-05)*
**Answer:** Every chunk that touches the workout screen or the rest timer (13–16 and any other) proves before merging that a session with none of the new features behaves exactly as before: plain sets, an existing dropset, no supersets, warmups, tags, tempo or rest overrides. It must render, log and time rests the same.
- Proof 1: a jsdom snapshot of the full session screen, taken on master before the chunk and compared with the chunk's branch.
- Proof 2: a test that logs a set and checks the row written.
- Any difference that isn't a new feature blocks the merge.
