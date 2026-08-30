# Overload — Coach: Weekly Analysis (v1)

## 1. Vision

Daily Session Analysis proved the core pattern: deterministic code produces real, matched, comparable facts; the model reasons about what they mean. Weekly Analysis is the same pattern at a wider zoom — not a new kind of computation, but the existing per-exercise machinery reused and regrouped.

Where daily analysis asks "how did this exercise do compared to last time," weekly analysis asks a different, coach-shaped question: "what happened to this muscle group or movement pattern across the whole week, and what does the shape of that — not just the direction — actually mean?" A single blended number can't answer that. A real coach looks at the raw picture — bench press down, chest fly up — and reads a pattern (accumulated fatigue on the compounds) that no average would surface. This feature is built to let the model do exactly that: see the real, disaggregated facts, and reason across them the way a coach would.

## 2. Who it's for

Same as Daily Session Analysis — strictly personal, gated to one account. No change to that model.

## 3. Where it fits

This restructures the existing Coach → Analysis tab rather than adding a new top-level area. Analysis becomes a container with sub-tabs:

- **Session** — exactly what's already shipped (Daily Session Analysis's two lists), relocated under this sub-tab with no behavioral change.
- **Week** — new, this document.

Month is intentionally not scaffolded here, even as an empty placeholder tab — it becomes a third sub-tab only when it's actually built, as its own future version informed by real Week usage.

Context remains a sibling tab to Analysis, unchanged.

## 4. Data storage decision

Two additions, both additive — nothing existing is modified or removed:

- **`exercises.muscle_subgroup`** — nullable, multi-value (an exercise can carry several, e.g. an incline press tagged both upper-chest and front-delt). Finer than the existing `muscle_group`, which stays untouched since History's filters already depend on its current values.
- **`exercises.movement_pattern`** — nullable, single-value (horizontal push, vertical push, horizontal pull, vertical pull, hip hinge, squat, isolation). One dominant pattern per exercise, unlike muscle_subgroup.

Both are populated via a one-time AI-assisted batch classification pass over the existing exercise library — Claude proposes tags from exercise names, Adam reviews and corrects before anything is committed. After that, both fields are static, stored data — read deterministically, never re-inferred live by a generation call. This is the same reasoning that put `matchSessionsByPosition` ahead of asking the model to align sets itself: classification that needs to stay *consistent* across calls belongs in stored data, not in a live judgment made fresh each time — even when the model would usually get it right.

One new table, matching `v2_coach_session_analyses`'s shape and discipline: `v2_coach_week_analyses`. One permanent row per resolved week, `unique(user_id, week_start)` making regeneration structurally impossible, `input_snapshot jsonb not null`, `model`/`prompt_version`/token counts stored — full parity with the provenance fields daily analysis already fought for.

## 5. Core concepts

**Week completeness** — a week is "over" not by calendar date but by plan resolution: every session the Weekly Plan expected for that week has either been completed or explicitly skip-marked (the existing `skipMissedSession` path). A week with one unresolved planned session simply never appears as analyzable — indefinitely, until resolved. Not an edge case to patch; the correct behavior.

**Reused, not reinvented, per-exercise facts** — for every session in a complete week (regardless of whether that individual session was ever manually analyzed as a Daily Session Analysis), the exact same per-exercise assembly `analysisInput.ts` already produces for daily analysis runs again: matched sets, reference kind, e1RM delta, RIR, deload flags. No new comparison math exists at the weekly level. What's new is what happens to those facts afterward.

**Mechanical regrouping, not blending** — those per-exercise facts get deterministically bucketed by `muscle_subgroup` and `movement_pattern` tag instead of by session. An exercise with two muscle_subgroup tags appears, unmodified and in full, in both buckets. This bucketing is pure code — mechanical, not a judgment call — the same category of work as `matchSessionsByPosition`. **No new blended metric is computed per muscle group.** A single averaged volume or intensity number was considered and explicitly rejected: it would have erased the exact kind of divergent signal (compounds down, accessories up) that makes the feature useful in the first place. The model receives the real, disaggregated per-exercise facts inside each bucket and reasons across them directly.

**Untagged fallback** — an exercise with no `muscle_subgroup` set falls back to the existing coarse `muscle_group` for bucketing purposes. The model still receives that exercise's raw name alongside the fallback, and may name an obvious specific in its own prose (a lateral raise is unambiguously side-delt work) without that observation ever changing which bucket the exercise's numbers were mechanically placed in. The line: anything that has to stay *consistent across calls* is computed; anything that's a *judgment call even for a human coach* — including crediting an exercise between the muscle groups it touches — is left entirely to the model, deliberately never attempted in code.

**Selective highlights, not exhaustive coverage** — the output is a small number of things actually worth saying, each backed by real evidence from its bucket ("side delt work improved this week — [reasoning from the real numbers]"), not a systematic walk through every trained muscle group. A muscle group with nothing notable to say about it simply doesn't get a highlight.

**Mildly prescriptive highlight phrasing — reviewed against real output, kept as-is.** The first real Weekly Analysis generated highlights that lean slightly prescriptive ("reintroduce it next week," "audit fatigue in the next week or two, or rotate that variation out") — phrasing that edges toward territory a future plan-creator feature (§10) is eventually meant to own outright (actually changing next week's programming, not just describing this week's). Reviewed directly against that real generated text and **decided, not deferred: leave the phrasing as-is, no prompt change.** This analysis feature's job is to describe and explain what a real week's numbers mean, in the voice of a coach talking to the lifter — a coach naturally phrases an observation as a forward-looking suggestion sometimes, and nothing here writes to a plan, changes a program, or removes the lifter's own judgment from what happens next. The line stays real: a future plan-creator *acting* on next week's programming is a materially different thing from this feature *describing* a pattern in language that happens to gesture forward. Not an open question awaiting more samples to calibrate against (contrast the Daily Session Analysis persona/tone item, CONTEXT.md's "Pending feedback to address," which genuinely is still open) — this one was checked against real output and closed.

## 6. The key UI concept

The Week sub-tab mirrors Session's existing shape exactly: a **To analyze** list (weeks that are complete and not yet analyzed) and an **Analyses** list (saved, permanent write-ups), each opening a read-only detail view. Same manual-trigger, same in-flight/error states, same no-regenerate/no-delete discipline — nothing new invented at the UI layer, all of it reused.

## 7. Navigation structure

```
Coach (gated to one account)
├── Analysis
│   ├── Session (existing, relocated — no behavior change)
│   └── Week (new)
│       ├── To analyze — complete, un-analyzed weeks, manual trigger
│       └── Analyses — saved, permanent weekly write-ups
└── Context (unchanged)
```

Month is not present in this structure — added as its own sub-tab only when it's actually built.

## 8. Design principles

- **Mechanical stays mechanical; judgment stays with the model.** Regrouping by tag, resolving week completeness, falling back to `muscle_group` — all code. Reading a divergent pattern across compounds and accessories, crediting a multi-tagged exercise's contribution, naming an obvious specific for an untagged exercise — all model, none of it attempted in code.
- **Reuse over reinvention.** The single biggest design decision here was recognizing that almost nothing new needed to be computed — `analysisInput.ts`'s existing per-exercise assembly does the real work; this feature mostly orchestrates and regroups it.
- **No fabricated precision.** A muscle-group-level number that doesn't actually exist as a real, coherent quantity (like a "chest score" blending an incline press's contribution with a fly's) is worse than no number — it was considered and rejected, not deferred.
- **Selective over exhaustive**, matching the "coach talking to you about what mattered" framing this whole feature line is built around.
- **Stable classification lives in stored data, not live inference** — even where the model clearly has the knowledge, because week-over-week comparability depends on the same exercise being classified the same way every time.
- **This feature describes, it does not act.** A highlight may read as mildly forward-looking coach's advice; it never writes to a plan or a program. See §5's "Mildly prescriptive highlight phrasing" — reviewed against real output and settled, not left open.

## 9. Explicitly out of scope for v1

| Item | Status |
|---|---|
| Month analysis | Deferred — own future version, informed by real Week usage |
| Muscle-group-level blended metric (single volume/intensity number per group) | **Rejected outright**, not deferred — would erase the divergent signal the feature is built to surface |
| In-app UI to edit `muscle_subgroup`/`movement_pattern` per exercise | Deferred — corrections happen via the batch process or direct DB edit for now |
| Tag-on-create flow for newly added exercises | Deferred — new exercises fall back to `muscle_group` until a future re-tagging pass |
| Mid-week / partial-week analysis | Deferred — v1 only analyzes fully resolved weeks, same storage-permanence reasoning as daily |
| Regeneration or deletion of a saved weekly analysis | Not planned — same reasoning as daily: nothing to overwrite, no strong reason to delete a permanent record |
| Automatic (non-manual) trigger | Deferred — manual only, same cost-conscious default as daily |

## 10. Future versions (ideas, not commitments)

- Month analysis, once Week's real output has been observed for a while
- In-app tagging correction UI, if manual DB edits prove annoying in practice
- Tag-on-create assist for new exercises
- Mid-week "how's this week shaping up" partial reads

## 11. Success criteria for v1

- A week becomes available in "To analyze" once every planned session in it is completed or skip-marked — not before
- Manually triggering it reuses `analysisInput.ts`'s existing per-exercise assembly across every session in the week, mechanically buckets the results by `muscle_subgroup`/`movement_pattern`, and generates a small number of real, evidence-backed highlights — not exhaustive per-group coverage, not a blended metric
- Untagged exercises fall back to `muscle_group` for bucketing; the model may still name an obvious specific in prose without affecting where the exercise's data was placed
- `muscle_subgroup` (multi-select, optional) and `movement_pattern` (single-select, optional) exist on `exercises`, populated via a one-time AI-assisted batch pass reviewed and corrected by Adam before commit
- Each weekly analysis is saved once, permanently, per resolved week — no regenerate, no delete
- Model: Haiku 4.5, same default-cheap-first posture as daily analysis, reassessed only if real output quality doesn't hold up against the larger, more complex weekly payload

## 12. v1.1 — Coach Personalization wiring (2026-08-28)

COACH-PERSONALIZATION-SPEC.md §8/§9 deferred wiring form/energy/pump ratings and Coach Memory into Weekly Analysis explicitly, until Daily was proven first ("one thing before the next"). Daily's own wiring has since shipped and been verified against real production data (CONTEXT.md, 2026-08-27/28 sessions, including the real PUSH-2 session and `coachPrompt.ts`'s real `PROMPT_VERSION 4 → 5` fix cycle) — this closes that deferral for Weekly.

**What's now wired in, on top of §5's original design:**

- **Per-session `energyRating`/`pumpRating`** now reach the payload on every session in the roster. This closes a real, documented gap — the fetch layer already read these two fields per session for its own internal purposes, but nothing carried them through to the model-facing payload until now.
- **Per-set `formRating`** was already reaching the payload "by construction" since v1 (every occurrence is built through the exact same `buildExercise` the daily path uses), but the prompt never told the model it was there. Now documented in the payload-shape description and given its own instruction.
- **The full active Coach Memory list** reaches the week payload — the identical full-list query daily's path already uses, unchanged shape.
- **Every Coach Note attached to a session within the week** reaches the payload, each carrying its own session date and workout-day name so the model can tie a note to the specific day it actually describes, rather than reading it as generic, undated context for the whole week. This is the multi-session case daily's single-session `sessionNotes` field never had to solve. **It is not a fix for CONTEXT.md's "Chest Press substitution described inconsistently" finding** — that was a single, already-correctly-scoped session's note characterized two different ways in two parts of the same generated output (a cross-section narrative-consistency failure), not a note misattributed to the wrong day. That failure mode is untouched by this change and remains open at both the daily and weekly level, same tracked-but-unaddressed status it already has in CONTEXT.md's "Pending feedback to address."
- **Weekly averages** — `avgFormRating`/`avgEnergyRating`/`avgPumpRating` — computed once per week, reusing the same shared pure averaging module (`ratingScales.ts`) `progressService.ts`'s Meso Overview charts already use, no second implementation of the mean/ordinal/null-handling math. These are a week-wide summary figure carried *alongside* the real per-session/per-set values, never in place of them — and they are never per-bucket, so §5's no-blended-metric rule (which is specifically about muscle-group buckets) is untouched.
- **`coachWeekPrompt.ts` bumped to `WEEK_PROMPT_VERSION = 2`**, carrying two fixes from day one that daily needed a real `PROMPT_VERSION 4 → 5` cycle against real output to discover (CONTEXT.md, 2026-08-27): never invent an equipment detail beyond what the payload literally says, and never present `memory` and a same-week `notes` entry as two independent sources corroborating the same fact — a memory entry can be curated directly from this very week's own notes before the analysis ever runs.

**Held, not deployed — same discipline as Daily Session Analysis's own Phase 5.** Typecheck (both projects), the full Vitest suite (253/253, including new constructed-fixture coverage for dated/attributed notes, matching rating averages, memory, and the absence case for each), and `vite build` all pass clean. A four-dimension adversarial review ran against the diff, catching and fixing one documentation overclaim (this section originally, and incorrectly, framed dated notes as "the fix" for CONTEXT.md's "Chest Press substitution described inconsistently" finding — corrected above; that finding was a cross-section narrative-consistency failure, not a note misattribution, and remains open) plus two low-severity issues (an imprecise prompt wording, a test-coverage gap) — see COACH-WEEK-ANALYSIS-TASKS.md §12.6/§12.8 for the full record. No real complete week has existed to dry-run this against yet — the one real weekly generation on record predates this wiring, frozen at `WEEK_PROMPT_VERSION 1` (its `input_snapshot` correctly lacks every field this section adds, which is why they're all optional on the type — see COACH-WEEK-ANALYSIS-TASKS.md). Held until a real complete week exists to verify against, exactly the way Daily's Phase 5 was held.

---

This document is the source of truth for this feature's v1. Claude Code should read this before any technical planning begins.
