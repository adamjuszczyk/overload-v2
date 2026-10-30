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
