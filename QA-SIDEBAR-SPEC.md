# SPEC — AI Q&A Sidebar

## 1. Vision

A conversational surface, advisory only, that lets Adam ask the AI questions in three
contexts: during a workout, about general training, and about planning. It reuses the
sidebar space the in-session Notes section was already being built into — the "genuinely
interactive" naming just reflects that the sidebar now actually responds, rather than
being a static notes box.

Beyond direct usefulness, the planning category is a deliberate dry run: a way to read
how the AI reasons about volume, intensity, and schedule trade-offs before any future
feature lets it plan for real (see item 5, program/planner rework — out of scope here).

## 2. Scope (v1)

**In scope:**
- Three question categories: in-session, general, planning. A fourth, app-mechanics
  ("what does RIR mean," "how do I log a superset"), is worth trying alongside general.
- Advisory only — the AI answers, it never changes anything.
- Every exchange logged permanently for later review.
- Model choice split by category to manage cost.

**Explicitly out of scope (not deferred by accident — bundled with other decisions):**
- **Any write access.** Adding/removing a set, marking something skipped, drafting a plan
  change — none of this happens here. Every feature that lets the AI change or draft
  changes to real data belongs to item 5, gated together with that decision.
- **Northstar data, ever.** Standing rule for all of Overload, not just this feature:
  Overload is moving to its own dedicated Supabase database, and even before that
  migration completes, no feature should read Northstar data — anything Northstar-shaped
  currently reachable from Overload's database is getting removed anyway.
- **A dedicated review UI.** Log the data well; review it by query for now, same as Coach
  analyses have been reviewed so far. Build a screen only if that pattern actually gets
  used regularly.
- **A tone/settings toggle.** This surface inherits Coach's existing persona (direct,
  "you"-addressed, low-repetition, chill-but-knowledgeable) rather than getting its own.

## 3. Categories and data access

| Category | Example questions | Context given to the model |
|---|---|---|
| In-session | "Should I add a set?" "Skip this exercise?" "Technique cues for this?" | Same shape Coach already gets: current exercise, matched-set history, RIR/e1RM, today's ratings, relevant notes/memory. |
| General | Broader training questions, not tied to today's session | Training history / current mesocycle context. |
| Planning | "Should I skip this session?" "How should I think about next week?" | Overload-only signals — recent training load, recovery cues, bodyweight trend. No Northstar, per the standing rule above. |
| App mechanics (try it) | "What does RIR mean?" "How do supersets work here?" | Static/reference — doesn't need session or training data. |

The category is decided by where in the app the question originates (which screen, in-
session or not), not inferred by the model — same principle already applied to
`dayOfWeek` and rep/weight direction in Coach: don't make the model derive what the app
already knows.

## 4. Relationship to Notes and Memory

- **Notes stays exactly as it is.** It's a zero-friction capture box precisely because it
  doesn't require a conversation — that value doesn't get replaced by chat.
- **Q&A is a separate surface** in the same sidebar space (tab or toggle alongside Notes),
  not a merger of the two. It reads session context; it doesn't write back into Notes.
- **Memory can be updated from a Q&A conversation, but only on explicit confirmation** —
  the AI proposes ("worth remembering that your shoulder's been off on inclines?"), Adam
  confirms, then it's written. No silent extraction. This is deliberate: adding a third
  implicit channel that decides what's memory-worthy is exactly the shape of failure that
  produced the false-corroboration bug in Weekly Analysis (memory and notes independently
  "confirming" the same fact). Manual-before-automatic applies here too.

## 5. History / logging

- Every exchange is logged as its own permanent row: question, answer, the context
  snapshot actually given to the model, and its category tag.
- Exchanges within one continuous chat are grouped by a conversation id so a planning
  conversation (or any other) can be read back as a whole later, not as disconnected
  fragments. In-session conversations are also linked to the workout session id.
- Permanent, not deletable — same reasoning as Coach analyses: the point is being able to
  go back and actually check what the AI said, especially for planning questions, since
  judging that reasoning is the actual goal of shipping this category at all.

## 6. Model routing

- **In-session, general, app-mechanics:** Haiku (`claude-haiku-4-5-20251001`, already
  Coach's model). High-frequency, mechanical — keeps the bulk of usage cheap.
- **Planning:** Sonnet (`claude-sonnet-5`). Low-frequency by nature — this isn't a
  question asked multiple times a day — so the cost of a stronger model here doesn't
  scale into a real problem, and it's exactly the category where reasoning quality is the
  point rather than a nice-to-have.
- **Multi-turn cost control:** don't resend the full conversation on every turn. Cap how
  much prior history goes back to the model per exchange. Exact strategy (rolling window,
  turn cap, etc.) is a technical-planning decision, not fixed here.

## 7. What we're deliberately not deciding yet

Everything past this point needs real usage to answer, not more up-front planning:
turn-cap tuning, whether app-mechanics earns its own logic, whether a review UI ever
becomes worth building, and whether/how this eventually connects to the onboarding
problem (a friend is waiting on an app that isn't fully self-explanatory yet — a live,
contextual Q&A surface may end up being part of that answer, but that's a question for
after this ships, not a requirement to design in now).

---

This document is the source of truth for this feature's v1. Claude Code should read this
before any technical planning (TASKS.md) begins.
