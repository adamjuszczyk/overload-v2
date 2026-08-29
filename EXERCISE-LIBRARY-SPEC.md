# Overload — Exercise Library Rework (v1)

## 1. Vision

Right now, growing your exercise library means one button that copies in the entire default seed list — no choice, no structure, no way to add more later without repeating that same all-or-nothing action. This version replaces that with a real library system: multiple curated, categorized collections (barbell, dumbbell, cable, and so on) you can preview and choose from individually, plus the ability to remove exercises you no longer want — without ever losing the training history behind them.

It also closes a gap that's existed since `muscle_subgroup`/`movement_pattern` were first added during Coach Personalization: there's still no way to view or edit them anywhere in the app. Every exercise from here forward — including whatever new libraries eventually bring in — needs a real place to get tagged, corrected, or reviewed.

## 2. Who it's for

Everyone — this is not Coach-gated. Both the library system and tag editing have real, standalone value independent of any AI feature: better organizing and understanding your own exercise list. Same test Coach Personalization's ratings passed to become ungated.

## 3. Core concepts

**Libraries** — global, shared, curated catalogs (e.g. "Barbell Exercises," "Dumbbell Exercises"), not personal or per-user. "Downloading" a library copies its exercises into your own personal list, the same mechanism the original seed list already used. No library content exists yet in this version — that's added later, once this UI and logic exist to receive it.

**Preview** — a read-only look at a library's exercise list (names, tags) before downloading. Empty for any library until content is added.

**Deleting an exercise** (individually, or as a consequence of deleting a whole library) splits on one fact: does it have any logged history?
- **No logged sets** — deleted immediately and permanently, no further step.
- **Real logged history exists** — never destroyed. It moves into **Lost Exercises** instead: removed from your active, selectable list, but fully intact, history and all.

**Lost Exercises** — a dedicated section for exercises with real history that are no longer part of your active library. From here, a lost exercise's entire history can be **reassigned** onto a target exercise — an existing one, or a newly created one on the spot, same "pick existing or create new" picker pattern already built for in-session exercise swapping. Reassignment re-points every one of that exercise's logged sets onto the target. Once a lost exercise's history is fully reassigned (zero remaining logged sets), it becomes eligible for real deletion the same way any zero-history exercise is, and gets cleaned up automatically rather than needing a second explicit delete.

**Reassignment requires real, explicit confirmation, not a casual tap.** Merging one exercise's history onto another is exactly what makes migrating an old library survivable — but used carelessly, between two exercises that aren't actually the same movement, it fabricates continuity across your entire training history the same way logging a substitute under the wrong exercise fabricates a single session's regression, except permanent and irreversible. The confirmation step must say plainly what's about to happen — history merging, treated as one continuous exercise going forward — before it executes.

**Tag editing** — a real, first-class screen for viewing and setting `muscle_subgroup` (multi-select) and `movement_pattern` (single-select) on any exercise, switchable between a single scrollable list (all exercises, tags editable inline) and a per-exercise detail view — user's choice, not a fixed layout. Untagged exercises fall back to `muscle_group` exactly as they already do; tagging stays optional at creation and correctable anytime, same as the existing design.

## 4. Where it fits

Replaces the current single-button download UI in the existing Exercise Library screen. Tag editing is a new addition to that same area. Neither is gated — visible and usable by every account, including the swap-exercise-only-affects-this-session feature's picker, which already lives in this same conceptual space.

## 5. Data storage decision

New concepts needing persistence:
- **Libraries** — a real catalog table (name, description), independent of any user.
- **Exercise-to-library provenance** — which library (if any) an exercise in your personal list actually came from. This is what makes "delete this library" resolvable at all — without it, there's no way to know which of your exercises to act on.
- **Lost-exercise state** — a status distinguishing an exercise's three real states: active (selectable), lost (has history, removed from active use, awaiting reassignment), and gone (deleted for real, zero history).
- **Reassignment** is a bulk update — every table referencing the lost exercise by id (set logs, program exercises, week-plan sets, anything else that points at an exercise) gets re-pointed to the target exercise's id in one operation, the same underlying mechanism as swap-exercise, applied retroactively across a whole history instead of one session.

**One real open question for technical planning, not resolved here:** your current 70 exercises predate any concept of library provenance — there's no record of which of them came from the original seed list. For the old all-in-one default library to be deletable the way this feature describes, something needs to retroactively establish that link. Worth a real decision during Phase 2 (a synthetic "legacy" library record the existing 70 get attached to, or something else) rather than guessed at here.

## 6. Design principles

- **Never destroy real training history**, same principle that's shaped every other Coach feature — a delete either has zero history to lose, or doesn't actually delete anything until history is safely reassigned elsewhere.
- **Reuse the existing picker pattern** for reassignment rather than building a second "choose or create an exercise" flow — same interaction already proven in swap-exercise.
- **Destructive-adjacent actions get real confirmation, not a casual tap** — specifically reassignment, since it permanently merges history in a way nothing else in this app currently does.
- **Tags are open to everyone**, not Coach-gated — they have real standalone value independent of AI.

## 7. Explicitly out of scope for v1

| Item | Status |
|---|---|
| Actual library content (which exercises belong to which library) | Not built yet — this version is UI and logic only, content comes later |
| Retroactive library provenance for existing exercises | Open question for Phase 2, not resolved in this document |
| Any equipment-substitution AI integration with this system | Separate, already-deferred feature — unrelated |

## 8. Success criteria for v1

- The single download button is replaced with a real library list: preview, download, and delete, per library
- Deleting an exercise (directly or via its library) with no history removes it permanently; with real history, moves it to Lost Exercises instead
- Lost Exercises can be reassigned onto an existing or newly created exercise, with an explicit confirmation step describing exactly what the merge will do, and the source exercise is cleaned up automatically once its history is fully reassigned
- Tag editing exists as a real screen, switchable between list and per-exercise views, open to every account, editing `muscle_subgroup` (multi-select) and `movement_pattern` (single-select) with the same optional-at-creation, correct-anytime behavior already established

---

This document is the source of truth for this feature's v1. Claude Code should read this before any technical planning begins.
