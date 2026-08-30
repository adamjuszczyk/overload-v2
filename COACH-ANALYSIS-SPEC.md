# Overload — Coach: Daily Session Analysis (v1)

## 1. Vision

Overload already captures everything about a training session — every set, weight, rep, RIR, deload flag. Before this feature, that data just sat there; any real interpretation happened manually, or previously, outside the app entirely (pasting numbers into ChatGPT by hand). This feature turns that stored data into a standing, permanent record of coach-style reasoning: after a session, Overload tells you what actually happened and why it matters, the way a real coach reading your training log would — not a calculator restating numbers you already logged.

This is the first of several planned AI surfaces in Overload (weekly, monthly, and mesocycle-level analysis; in-session Q&A; a plan/mesocycle creator) but it is being built alone, deliberately. It exists both to make Overload genuinely more useful and as the first real test of AI-integration patterns that will carry into client work and the trainer platform later — so it's being kept small and observed closely before anything else gets added.

## 2. Who it's for

Strictly personal. Overload has other users (friends currently using the app), but this feature is gated to a single account. No multi-user or trainee-facing design consideration is being made in v1 — that's an explicit non-goal for now, not an oversight.

## 3. Where it fits

No new platform or storage decisions are needed — this extends the existing Overload PWA and its shared Supabase project. What's new is a **Coach section**: a new top-level area in the app, intended as the long-term home for every future AI surface. For v1 it has two tabs:

- **Analysis** — the actual feature (list of generated analyses, list of sessions available to analyze)
- **Context** — supporting data the AI reasons from (training phase, bodyweight)

Both tabs, and the underlying API calls, are gated to one account. Any other user opening the Coach section sees a neutral locked placeholder — no explanation of who it's for or why, just something like "Coach is still cooking — check back soon."

## 4. Data storage decision

Backend, same as the rest of Overload — three new concepts need persistence in the shared Supabase project, all following the app's existing per-user RLS pattern:

- **Session analyses** — one permanent record per analyzed session
- **Phase log entries** — dated training-phase entries
- **Weight log entries** — dated bodyweight entries (daily or weekly-average granularity)

No offline requirement for this feature — analysis is triggered after a session, from history, not mid-workout, so it can require connection like Overload's other planning/history views already do.

## 5. Core concepts

**Daily Session Analysis** — a single, permanent, coach-style write-up generated on demand for one finished session. Per exercise, it reasons about *why* something changed, not just whether it went up: e.g. "same weight, but RIR dropped from 2 to 1 — closer to failure than last week, a small step backward in recovery terms even though the number on the bar didn't move." It ends with a short overall session read. This is deliberately not a `progressed / same / regressed` label generator.

**Comparison window** — the only historical data an analysis uses per exercise is this session vs. that same exercise's last occurrence at the same workout-day slot, roughly a week prior. This reuses Overload's existing same-workout-day "last completed session" logic (`fetchLastCompletedSessionForExercise` / `referenceLogic.ts`) rather than introducing a new trend window. No multi-week trend analysis in v1.

**Phase log** — a dated log of training phase (cut / bulk / maintain). Each entry is just a phase value and a start date; an entry's implicit end is the next entry's start date, or today if it's the current one. No separate end-date field. This lets the analysis reason with context like "bulk started 2 weeks ago, cut before that ran roughly 6 weeks" without redundant data entry.

**Weight log** — a dated bodyweight log, entries in kg. Each entry is either a **daily** weigh-in or a **weekly-average** entry. Daily entries are never destructively collapsed — once a week has passed, the app computes a weekly average as a *read*, from whichever entries exist for that week (one manual weekly entry, or the average of however many dailies were logged), while the underlying entries stay individually editable and removable indefinitely, same as everything else in the app. The date picker defaults to today but allows backfilling past dates.

## 6. The key UI concept

The **Analysis tab** is the heart of this feature: a simple two-list view.

- **To analyze** — finished sessions (from this feature's ship date forward only — no historical backlog) that haven't been analyzed yet. Each has a manual **Analyze** action; nothing generates automatically. This is a deliberate cost control while Haiku-generated output quality and real API spend are still being evaluated.
- **Analyses** — the growing permanent list of generated write-ups, open any time.

The **Context tab** is secondary but load-bearing: without a current phase and a recent weight trend, the analysis can't tell the difference between a plateau and a successful cut. It's a small, deliberately minimal data-entry surface — just the two dated logs described above.

## 7. Navigation structure

```
Coach (new top-level section, gated to one account)
├── Analysis (default tab)
│   ├── To analyze — list of un-analyzed finished sessions, manual trigger per item
│   └── Analyses — list of saved, permanent write-ups
└── Context
    ├── Phase log — dated cut/bulk/maintain entries, editable/removable
    └── Weight log — dated daily or weekly-average entries (kg), editable/removable
```

All other accounts see a single locked placeholder screen in place of the whole section.

## 8. Design principles

- **Coach, not calculator.** Every output reasons about *why*, using training-science judgment (RIR trend vs. load trend, e1rm signal, deload timing, phase and weight-trend context) — never a bare progressed/regressed label.
- **Sectioned moments, not a chat interface.** Analysis is a static, read-only write-up. No reply mechanism, no thread, no live back-and-forth in v1 — that's an explicit, deliberately deferred idea for later.
- **Manual before automatic.** Every generation is a conscious, costed action in v1. Automatic triggers are a future decision, made only once cost and quality are trusted.
- **Never destroy raw data.** Weekly averages are computed views, never a replacement for the daily entries that produced them.
- **Everything stays editable/removable.** Phase and weight log entries follow the same CRUD conventions as the rest of the app. (Saved analyses are the one exception — see below.)
- **Minimal footprint.** No new field or surface was added unless it's directly load-bearing for a concrete, already-identified use case (this ruled out session-level mood/pump input and analysis regeneration/deletion for v1).

## 9. Explicitly out of scope for v1

| Feature | Why deferred |
|---|---|
| Week / month / mesocycle analysis | Same reasoning pattern, wider data scope — own version, once daily analysis is proven |
| In-session coach Q&A | Different trigger context (mid-workout, needs to be fast) — own version |
| Workout plan creator / mesocycle planner | Writes to the live plan — needs a draft-and-approve flow not built yet |
| Volume/intensity planning | Part of the planner feature above |
| Equipment substitution | Needs tool-calling to mutate the live session plus a new exercise-equivalence data model |
| Reply-capable clarifying questions | Turns a static moment into a mini-thread — deferred until the static pattern is proven |
| Analysis regeneration or deletion | Not regenerative, so nothing to overwrite; no strong reason to delete a permanent record |
| Automatic (non-manual) trigger | Cost caution during initial testing — revisit once trusted |
| Session-level mood/pump/note input | Only structured set data + phase/weight context are used in v1 |
| Historical backlog analysis | "To analyze" list only includes sessions finished after this feature ships |
| Multi-user / trainee access | Strictly personal for v1 |
| Phase log end dates | Implicit via the next entry's start date |

## 10. Future versions (ideas, not commitments)

- Week / mesocycle recaps, extending the same coach-reasoning pattern to wider zoom levels (month analysis is explicitly, permanently out of scope — day/week/meso is considered sufficient)
- In-session coach button for quick, scoped mid-workout questions
- Reply-capable clarifying questions once the static pattern has real usage behind it
- Workout plan creator / mesocycle planner, always draft-then-approve
- Volume/intensity planning as part of the planner
- Equipment substitution via tool-calling (swap an exercise mid-session by description)
- Patterns proven here inform (but aren't directly reused by) future AI work in client projects and the trainer platform

## 11. Success criteria for v1

- A finished session can be manually analyzed from the Analysis tab
- The write-up reasons per-exercise using this-session-vs-last-week-same-slot comparison, current phase, and recent weight trend — not a bare progressed/same/regressed verdict
- The write-up includes a short overall session read
- Each analysis is saved permanently and visible in a list, viewable any time, with no regenerate/delete controls
- Phase entries (phase + start date) can be logged, edited, and removed
- Weight entries (daily or weekly-average, backfillable) can be logged, edited, and removed; weekly averages are computed from existing entries, never destructive
- Model: Claude Haiku 4.5
- Only one account can see the Coach section or trigger any AI API call; every other account sees a neutral locked placeholder

---

This document is the source of truth for this feature's v1. Claude Code should read this before any technical planning begins.
