# LEARNINGS.md

Lessons about the process, not the app (BUILD.md 2.1, step 6). Each lesson is written the session it happens and gets a verdict at the retro: **changed** (BUILD.md edited, citing the lesson), **rejected** (one-line reason), or **watch** (seen once; stays open until it happens again). L1–L13 are the 1.2.1 spec chat's lessons (2026-10-29/30), as the chat wrote them; L14 on are the setup's (2026-10-30).

## L1 Prototype step: layout checked only by Adam   status: open
Stage: spec
What happened: the same layout bug reached Adam twice. A card in a scrolling column was squeezed to the screen's
height and its content was cut off. The first time was the finished program's week strip (a real 1.2 bug, now [24]),
the second was the new preview's cards. My checks before publishing only looked at text, in jsdom, which has no
layout. Adam caught both.
Possible change: BUILD.md's prototype section says every state is checked in a real browser at phone size, in both
themes, before Adam sees it: an automatic check for content cut off, plus screenshots that the chat looks at. The kit's
`check/run.sh` does this, and it goes into the starter's prototype kit.
Verdict:

## L2 1.2's screen checks missed a collapsed week strip   status: open
Stage: release (1.2)
What happened: the finished program's WK strip collapses to nothing once a week is taller than the screen. It shipped
in 1.2 and is on production. The 1.2 screen rows passed, presumably with a short week.
Possible change: screen checks use the longest realistic data (a week taller than the screen), not the seed's
shortest.
Verdict:

## L3 What counts as "the app's design system" for an existing app   status: open
Stage: spec
What happened: BUILD.md says an app without a design system gets one before its first prototype. The brief said no full
design system. We used `tokens.css` and the existing shared components.
Possible change: BUILD.md says that for an existing app, its tokens and shared components count until the starter's
design system replaces them.
Verdict:

## L4 Prototype from the real code: how it worked   status: open
Stage: spec
What happened: BUILD.md left "how the prototype starts from the real screens" to be verified on 1.2.1. What worked:
- a clone of the repo;
- a Vite plugin that swaps data hooks for fakes (`src/fakes/`), and changed files for marked copies
  (`src/overrides/`);
- fake data seeded into the real query cache under the real keys;
- the repo's own test fixtures as fake data: board W1's harness for the workout, `programHistory.testutil` for the
  finished program. The vi.mock list of `GymSession.boards.test.tsx` became the module swaps one for one.

Two traps: the repo path must be resolved to its real path, or the swap silently misses; and a disabled TanStack query
doesn't re-render on setQueryData, so the fakes read the cache through a subscription.
Possible change: write this into BUILD.md's prototype section (the "How is verified on 1.2.1" note), and make it the
starter's prototype kit.
Verdict:

## L5 Where the prototype kit lives between builds   status: open
Stage: spec
What happened: BUILD.md copies each build's prototype into `prototype/`, but the kit (fakes, override tool, DEMO menu,
check) is reusable. Each build's overrides go stale once that build ships.
Possible change: the kit stays in the repo's `prototype/`. Each spec chat clears `src/overrides/` and starts from the
real code as it is then.
Verdict:

## L6 The host page's styles beat the app's base styles   status: open
Stage: spec
What happened: published as a page, the prototype's background stayed light in dark mode. The host's unlayered base
styles won over the app's `@layer base`. Adam caught it.
Possible change: the kit restates the app's base background and colour scheme unlayered (done in 1.2.1's
`src/index.css`).
Verdict:

## L7 A brief pulled from DECISIONS listed an answered entry as open   status: open
Stage: spec
What happened: the brief listed 244 under "Still open", but it had been answered on 2026-10-27 ("leave as is").
Possible change: when a brief is drafted from DECISIONS, each entry's Answer field is checked first.
Verdict:

## L8 Next-version notes live where cloud sessions can't reach them   status: open
Stage: spec
What happened: BUILD.md keeps the next-version notes in a folder beside the repos on Adam's PC. The close and the next
spec are run by cloud sessions that can't reach it.
Possible change: keep each app's next-version notes in its repo, as one file with "Planned, not built" at the top.
Verdict:

## L9 The plugin skills pull themselves into sessions   status: open
Stage: spec
What happened: the four installed plugin skills (react-expert, typescript-pro, data-visualization, progressive-web-app)
have "ALWAYS invoke" descriptions. Their uninstall was agreed, but BUILD.md doesn't say when.
Possible change: uninstall them before 1.2.1's TASKS session, so the build runs on what the starter will hold.
Verdict:

## L10 "If nothing got cut or merged, the discussion isn't working" doesn't fit a pre-decided list   status: open
Stage: spec
What happened: 1.2.1 ended with 0 merged and 3 cut, but most items arrived already decided in DECISIONS (12–18) or as
recommendations. The discussion still found things: a production bug [24], a changed opening week [25], [7] moved to
later, and [4]'s purpose narrowed to "match the workout's design".
Possible change: the rule applies to items that arrive undecided.
Verdict:

## L11 The TASKS prompt named the wrong base branch   status: open
Stage: tasks
What happened: my TASKS prompt said to branch off `master`. `staging` held the same code plus six newer docs commits
(DECISIONS 249 answered, the 1.2.1 list, HISTORY's row table). Caught before the session got far, and corrected by a
follow-up message.
Possible change: a prompt names a branch only after checking which one holds the newest docs (staging, between
releases on an app with staging).
Verdict:

## L12 TASKS runs before setup, so it planned under the old rules   status: open
Stage: tasks
What happened: BUILD.md v2 puts TASKS (step 2) before setup (step 3), and agents never read BUILD.md. So 1.2.1's TASKS
planned under 1.2's rules from CONTEXT/RULES: day mode's two builders at a time, 1.2's cost rule, 1.2's process. It
said so itself ("BUILD.md is not in the repo, so the process notes carry over 1.2's staging process"). It had no v2
build loop, no LIGHT batch reviewer and no decision cards.
Possible change: either the TASKS prompt carries the v2 facts that shape a plan (the build loop, chunk types and their
review, the estimate's inputs), or setup's RULES.md part runs before TASKS on an existing app.
Verdict:

## L9 addendum
The `frontend-design` plugin skill has the same "ALWAYS invoke" description as the four. Adam asked about it on
2026-10-30. Possible change: uninstall all five. Design guidance, if wanted, becomes his own skill with an exact
trigger.

## L13 The estimate came from a pace, not from hours per chunk   status: changed (BUILD.md 2.1, step 2 "The estimate")
Stage: tasks
What happened: TASKS estimated 1.2.1 at ~9 days by copying 1.2's pace ("two chunks a day") and adding 2 days of
limit pauses. 1.2's own merges on 2026-10-26 show 10 chunks in ~14 hours. Adam: "it should understand how long each
chunk takes, how many fit in a day, how many tokens each uses, whether they fit the 5-hour limits, the weekly %, and
include a limit only if it's probable; a good estimate says how many hours the build needs to run."
Possible change: done. BUILD.md 2.1's estimate is run time in hours from hours per chunk, weekly % per chunk, 5-hour
windows, and money, with pauses only when likely and never a pace. The cost table gains hours and weekly % per chunk
type, seeded DATA ≈ 1.5 h and LIGHT ≈ 40 min.
Verdict: changed (BUILD.md 2.1, 2026-10-30, Adam)

## L14 The setup's attachments did not reach the session   status: open
Stage: setup (1.2.1)
What happened: the setup prompt named BUILD.md and LEARNINGS-spec.md as attached, but the session's uploads folder held
only the TASKS session's two files. The session wrote RULES.md's five BUILD sections, TASKS.md's process section and
the agent definitions from the prompt's description of 2.1, marked them as such, and left LEARNINGS.md unwritten; a
second docs PR aligned them once the files arrived (the decision-card format, the stop rules, "affected tests only
until one full suite before release", the coordinator's effort, CONTEXT.md's shape all differed).
Possible change: a setup prompt's first step checks that every named attachment is on disk (`/root/.claude/uploads/`)
and stops if one is missing; longer term, the templates agents need live in the starter, so a setup never depends on
an upload.
Verdict:

## L15 A session can wake itself after a limit stop   status: open
Stage: setup (1.2.1)
What happened: BUILD.md's "Running without me" left the resume mechanism to be verified on the first build. The setup
tried it: a session can schedule its own wake-up with the claude-code-remote tools (`send_later` for a one-shot,
`create_trigger` for a cron bound to its own session); a prompt due during a running turn waits and is delivered as the
session's next turn once it is idle. The three-minute test fired and was delivered with nothing sent by Adam. The
session's own meter (`get_session`) reports the rate-limit window, its reset time and whether requests are allowed,
so a woken coordinator can end its turn at once while the limit holds. Not proven: a wake after a turn cut by a limit.
Possible change: write the mechanism into BUILD.md step 4 ("Running without me") and into the coordinator prompt's
`[mechanism]`: an hourly cron bound to the coordinator's session, created at the start and deleted at the end, whose
prompt reads the meter first.
Verdict:

## L16 The cost table's two units were never recorded side by side   status: open
Stage: tasks / setup (1.2.1)
What happened: the seed gives chunk costs in cost-weighted tokens and the weekly limit in context tokens; 1.2's chunk
reports recorded context figures and Adam noted the weekly % around some chunks, but never both for one chunk. The
estimate's weekly share rests on a proxy (1.2's per-chunk context budgets). BUILD.md's Bootstrap section already says
1.2.1's first chunk measures what 1% is in cost-weighted terms.
Possible change: every chunk report ends with its cost, its running time and the running totals (BUILD.md Usage), and
the coordinator writes the weekly % before and after each chunk next to them, so the close's cost loop has the pair.
Verdict:

## L17 Staging's re-seed lands on Adam mid-build   status: open
Stage: spec / build (1.2.1; added at the coordinator's start, 2026-10-30, from the spec chat)
What happened: chunk 70 changes `supabase/seed.sql` (the exempt test account, the Coach shapes for [8b]), and a
changed seed reaches staging only when Adam pastes it into the staging branch's SQL editor. So chunks 72's and 75's
staging checks wait on Adam in the middle of a build meant to run without him, while BUILD.md says staging is the
agents' job.
Possible change: the starter's staging scripts include an agent-run re-seed (a narrow, staging-only path the guards
already fence). Until then, the coordinator raises the re-seed as a to-do card the moment chunk 70's deploy is read.
Verdict:

## L18 The meter has no weekly figure   status: open
Stage: build (1.2.1, chunk 70's calibration)
What happened: TASKS.md and DECISIONS 267 have the coordinator write "the weekly % before and after every chunk" from
the meter (`get_session`). Read before chunk 70 (2026-10-30 17:27 UTC), `rate_limit_info` held only the window in force
(`rateLimitType: five_hour`, `status: allowed`, `resetsAt` 19:20 UTC) and `context_usage`; no weekly percentage and no
cost. The weekly % has to come from Adam's own usage page, or from a `seven_day` window only when it is the one in
force.
Possible change: BUILD.md's Bootstrap and the cost loop name where the weekly % is read (Adam's usage page, noted by
him at the chunk lines), or drop the per-chunk weekly % and keep the cost-weighted totals, which agents can report.
Verdict:

## L19 Chunk 70 cost half its estimate; its hours were on it   status: open
Stage: build (1.2.1, chunk 70; the 30% stop rule fired)
What happened: the estimate gave a DATA chunk ≈ 30M cost-weighted (≈ $84) and 1.5 h. Chunk 70 read: builder ≈ 12.1M
(Sonnet, ≈ $24, 50 min), reviewer ≈ 2.3M before the merge (Opus, ≈ $9, its own estimate: no agent has a meter of its
own), coordinator ≈ $3: ≈ $36, 57% under. Brief to merge 1 h 20 min, plus the post-merge staging check. Chunk 70 lifted
a migration already drafted and proven at the setup, so it may be cheaper than 72, 73 and 75.
Possible change: the cost table's DATA seed drops toward ≈ 15M cost-weighted once a second DATA chunk confirms it; a
chunk whose work was proven at the setup is estimated apart from one built from scratch.
Verdict:

## L20 The 5-hour window stopped the build after 1.5 hours   status: open
Stage: build (1.2.1)
What happened: the estimate said "~4% of a window per hour → no stop". The window (reset 19:20 UTC) was hit at about
18:50 with three agents running at once (chunk 70's post-merge review and batch 1's two builders), about 1.5 h after
the build started; every agent stopped with a 429. The window's size had never been measured; it was shared with the
setup sessions earlier that day. Adam sent "continue" after the reset; the hourly task was set and would have fired
at 19:27.
Possible change: the estimate measures the window (read `resetsAt` and when it stops), counts the window's use before
the build, and plans one stop per ~1.5–2 h of three-agent running; the coordinator runs fewer agents at once near a
window's end.
Verdict:

## L21 The coordinator started the next chunks before checking chunk 70's 30% rule   status: open
Stage: build (1.2.1, coordinator)
What happened: right after merging 70, the coordinator started batch 1's two builders (their dependency was met) and
only then compared 70 with the estimate, which was off by more than 30% (L19): the rule says re-estimate and tell
Adam before going on. Nothing was lost (both builders were stopped by the window before committing), but the order
was wrong.
Possible change: the coordinator's loop reads "merge → record the chunk's line against the estimate → only then the
next start"; the coordinator prompt names the 30% check as the step after chunk 70's merge.
Verdict:

## L22 Nothing told Adam when the build needed him while he was away   status: open
Stage: build (1.2.1; from the spec chat, added 2026-10-30)
What happened: decision cards, to-dos and limit stops reached Adam only as text in the session, which he sees only
when he opens it. The re-seed to-do (L17) and the 5-hour stop (L20) both waited for him to look.
Possible change: the coordinator sends a push notification for every decision card and to-do (its first line), every
limit stop ("limit until HH:MM") and the end of the build ("build finished"), none for ordinary merges; BUILD.md's
coordinator prompt says so. Done from 2026-10-30 in 1.2.1 (Adam's instruction; `PushNotification`, which skips a
notification while Adam is at the terminal).
Verdict:

## L23 The gap pre-read was done by the session that wrote TASKS.md   status: open
Stage: tasks (1.2.1; from the spec chat, added 2026-10-30)
What happened: 1.2.1's gap pre-read (the sweep of SPEC.md, the facts to verify) was done by the same session that
wrote TASKS.md, so it checked its own plan with its own reading. In 1.2 the best-value check was an independent agent's
pre-read of the next chunks (the `docs/preread-*` runs), which found what the plan's author had read past. Before chunk
72, Adam asked for one independent read-only pre-read of 72, 73, 75 and 80 (a fresh agent on the reviewer-data
definition, no writes), its findings recorded in DECISIONS.md and only a blocking question made a card.
Possible change: BUILD.md's TASKS step ends with an independent read-only pre-read by a fresh agent against SPEC, the
prototype and the code, before the build starts; for an app with risky DATA chunks, one more before them.
Verdict:

## L24 SPEC said "word for word" about text the wording guard forbids   status: open
Stage: spec / build (1.2.1, chunk 71)
What happened: SPEC: 1.2's release-notes entry is `docs/release-1.2-notes.md`'s "What's new" "word for word"; TASKS 71: "check-wording green on the notes' text". Two of the notes' lines say run, meso, mesocycle and tags, which the standing guard forbids in `src/`. The builder had to pick (reworded, a card for the release batch).
Possible change: the spec chat runs the standing guards (`check-wording`) over any text SPEC copies into the app before writing "word for word".
Verdict:

## L25 A staging check named data the seed doesn't hold   status: open
Stage: tasks (1.2.1, chunk 79; seen again in the pre-read's 72-1 and 75-6)
What happened: TASKS 79's staging line says "the planner's STG PPL shows the superset row"; STG PPL has no superset (the seed's is STG Upper/Lower's Upper A). The reviewer checked it there. The pre-read found two more checks staging can't run as written (72's interception, 75's "account empty again").
Possible change: TASKS's staging lines are checked against the seed (the smoke's own reads) when they are written; a check that needs a shape names the seed row that holds it.
Verdict:

## L26 The agents' self-reported costs ran low; the meter now reports the session's real cost   status: open
Stage: build (1.2.1)
What happened: no subagent can read a meter, so every chunk report estimated its own cost-weighted total from its
transcript. At 22:05 UTC `get_session` (no argument) returned `usage` for the first time this build: cost_usd $93.50,
cache reads 448.5M, writes 5.3M, output 1.51M (≈ 63M cost-weighted), for the coordinator and every agent it started.
The reports' estimates summed to ≈ 31M (≈ $68 with coordination): about half. Chunk 70's "50% under its estimate"
(L19), which fired the 30% rule, rested on those estimates. At 17:27 the same call returned no `usage` field.
Possible change: per-chunk cost is the meter's delta, read by the coordinator before a chunk's builder starts and
after its merge (with agents of other chunks running at once, the delta is per stretch, not per chunk); agents stop
estimating dollars. BUILD.md's Bootstrap names `get_session`'s `usage.cost_usd` as the meter.
Verdict:

## L27 The weekly window reached its warning about 7.5 h into the build   status: open
Stage: build (1.2.1)
What happened: at 01:07 UTC on 2026-10-31 `get_session`'s `rate_limit_info` switched from the 5-hour window to `rateLimitType: seven_day`, `status: allowed_warning` (resets Mon 2026-11-02 03:00 UTC), with chunks 70–75, 79 and the batch-1 work merged and four agents running; the meter read $219.34. The estimate said ~46% of the week (~57% with rework) for the whole build, from a proxy (L16); the meter gives no weekly percentage (L18), only this state change. The weekly use before the build (the setup sessions, other work that week) was never read.
Possible change: the coordinator reads the weekly state before chunk 70 and at every merge, and the estimate states the week's starting point; at `allowed_warning` the coordinator runs one agent at a time and tells Adam the reset time.
Verdict:
