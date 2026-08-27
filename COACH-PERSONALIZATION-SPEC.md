# Overload — Coach: Personalization (v1)

## 1. Vision

Daily and Weekly Analysis proved the pattern works: deterministic facts in, real coach-style reasoning out. But real usage exposed the ceiling on that pattern — a coach who only sees weight, reps, and RIR can judge *what happened*, but not *why it happened*, or *what it meant*. A slow week during a brutal energy day is a different story than a slow week for no reason. A skipped exercise because of an old injury is a different story than a skipped exercise out of laziness. None of that currently reaches the model, because none of it currently gets captured anywhere.

This version closes that gap on two fronts: **quality of execution** (form, energy, pump — dimensions of a workout that pure numbers can't see) and **standing context** (a real, curated, editable memory of the things that make training decisions make sense — old injuries, current caution, anything that isn't a fact with a clean start/end date). Both feed the same goal: the difference between an AI that analyzes numbers and one that actually knows you.

## 2. Who it's for

Same as everything else in Coach — strictly personal, gated to one account. This version makes that gating reach further than it ever has before: for the first time, Coach-related UI lives on pages every user opens (the workout screen, History, Progress), not just inside the already-gated `/coach` route. See §8 for how that's handled.

## 3. Sequencing — one initiative, five phases

Agreed explicitly: one coherent build, not ten scattered side-quests — but still sequenced, each phase verified before the next depends on it, same discipline as everything else in this feature line.

1. **Form / energy / pump logging** — the data capture itself. Foundational; nothing downstream exists without it.
2. **Display** — Progress and History surfacing the new data, plus session duration in History. Proves the capture is real before anything reasons about it.
3. **Raw note capture** — the in-workout sidebar and a general (non-workout) text box under Context. Coach Memory's only input; has to exist before Memory can.
4. **Coach Memory** — AI curation of raw notes into a standing, freeform, fully editable memory.
5. **Wiring into analysis** — form/energy/pump and Memory both reaching Daily Session Analysis's prompt, proven there first. Weekly Analysis's own integration is an explicit future version, not part of this scope.

## 4. Core concepts

**Form rating** — optional, per-set, logged live alongside RIR. Four values: rushed reps, normal reps, controlled reps, extra controlled reps. If absent, the analysis reasons on numbers alone, as it always has — but may make a soft, explicitly-hedged inference when the shape of the numbers suggests one ("last week's weight was higher but reps looked rushed based on the pace; this week may have been more controlled — no form rating given, so this is a guess, not a fact").

**Energy and pump ratings** — optional, logged once at workout completion (not per-set, and not mid-workout — deliberately deferred; see §9). Energy: five values, no/low/normal/high/supreme. Pump: four values, no/some/good/extreme.

**Session duration** — `completed_at` minus `started_at`, both already stored. A display-only gap, not a new logging requirement.

**Coach Notes** — raw, freeform text, timestamped, entered mid-workout via the sidebar. **Amended in v1.1 (§11): this is now the only entry point.** Originally this section also described a Context tab text box writing to the same store; that box was reworked to write directly to Coach Memory instead (see §11), since v1's real usage showed the two-step "note now, curate later" path added a manual step for a general fact that has no reason to wait. Coach Notes remains purely staging input — this session's own raw notes reach that session's own analysis directly (unfiltered, immediate), and every note also feeds curation into Memory automatically. It is not the same thing as Coach Memory. A note doesn't have to be well-formed or scoped to anything; "wrist's been bothering me, being cautious with forearm work especially during this cut" is a valid note, exactly as messy as real reasoning actually is.

**Coach Memory** — a separate, curated, standing store the model reads in full on every analysis call. Freeform text, not structured fields — the wrist example is precisely why: "cautious about forearm work because of a past injury, especially during a cut" doesn't fit into an exercise/muscle-group/date-range shape without losing the conditional reasoning that makes it useful. A dedicated curation process (not the analysis-generation call itself — a separate job, so neither task gets diluted) reads new notes and decides whether to add, update, or let something in memory expire. **Amended in v1.1 (§11): curation now runs automatically, immediately after each analysis, instead of behind a manual "Update Memory" button.** Fully visible and editable by the account it belongs to — add, correct, or delete any entry directly, independent of what the curation process decided, including adding a new entry directly with no AI involved at all (the Context tab's general-note replacement, §11). No retrieval logic: the full memory list gets included in every call. Selective retrieval is a real engineering problem for a memory list large enough to need it — that's not this list, not for a long time.

## 5. Data storage decision

- `form_rating` — nullable, on the set-log table. Same minimal-footprint shape as every other optional field added to this app: no default, no `NOT NULL`, harmless when absent.
- `energy_rating` / `pump_rating` — nullable, per-session (not per-set).
- **Coach Notes** — a new table: raw text, timestamp, optional link back to the session it was logged during (sidebar-sourced notes only; general notes have none).
- **Coach Memory** — a new, separate table: freeform text entries, timestamps, editable/deletable directly by the account. Structurally similar to the phase and weight logs (a dated, editable log) but without their fixed schema — this one is prose, not a value plus a date.

## 6. The key UI concepts

**Form entry** — a slider next to RIR entry, same interaction pattern already established there.

**Energy/pump entry** — sliders on the session-completion screen.

**Progress** — average form rating shown per exercise, alongside the other stats already in that view. Average form, energy, and pump shown per week.

**History** — form rating per set, energy and pump per workout, session duration per workout.

**The sidebar** — opens from within an active workout session. For this version, genuinely just a notepad: freeform text in, timestamped, nothing more. Explicitly a foundation for a richer, more interactive version later (see §10), not a finished feature. **Unaffected by v1.1 (§11)** — still the only way a raw Coach Note gets written, still writes to the same store, still gated by `coachGate.ts`.

**The Context tab text box** — ~~a second entry point into the exact same Coach Notes store~~ **amended in v1.1 (§11): writes directly into Coach Memory instead**, for a standing fact that isn't tied to a specific workout and doesn't need curation's judgment call applied to it.

**Coach Memory's own view** — a list, under Context, showing every current memory entry with add, edit, and delete available directly, same as phase and weight entries already work. No separate "run curation" control here anymore (§11) — curation is automatic.

## 7. Design principles

- **Capture the messy version, curate separately.** Notes don't need to be well-formed; Memory is where the well-formed version gets produced, deliberately as its own step rather than folded into analysis generation.
- **Freeform where the reasoning is conditional.** The wrist example is the test case for this principle throughout: anything that resists a clean field-and-date-range shape stays as prose.
- **Full inclusion over retrieval, until retrieval is actually needed.** Building selective-memory-retrieval logic ahead of having enough memory entries to need it is exactly the kind of premature complexity this project avoids everywhere else.
- **Visible and correctable, always.** An AI-curated memory that's wrong and can't be seen or fixed is worse than no memory at all — full user access to view, edit, and delete is not optional polish, it's what keeps this trustworthy.
- **Absence is data too.** No form rating isn't an error state — the model reasons on numbers alone, same as it always has, with soft inference clearly hedged as a guess when the numbers suggest one.
- **Gate by purpose, not by proximity to Coach.** The real test: does this have standalone value to an account that will never have Coach access, or does it only exist to feed the AI? Form, energy, and pump ratings pass that test the same way RIR already does — first-class training data, useful on its own, visible and loggable for every account. The sidebar fails it — "notes for the coach" has no meaning without a coach — so it's the one new surface on the workout screen that actually needs a `coachGate.ts` check. The Context tab's note box needs no separate check at all; it already lives inside the gated `/coach` route.

## 8. Explicitly out of scope for v1

| Item | Status |
|---|---|
| Energy/pump logged mid-workout (live, multiple points) instead of once at completion | Deferred — genuinely interesting (tracking perception through a session), deliberately simplified for now |
| Wiring form/energy/pump and Memory into Weekly Analysis's prompt | Deferred — Daily gets proven first, same "one thing before the next" discipline as everything else |
| A real Q&A capability inside the sidebar | Deferred — this version is deliberately "just a notepad"; interactive Q&A is its own future version |
| Structured memory fields (exercise/muscle-group/date-range tags on memory entries) | Rejected for this data shape specifically — conditional reasoning doesn't compress into fields without losing the reasoning itself |
| Selective memory retrieval | Deferred until the memory list is actually large enough to need it |
| Exercise library rework (choosing which exercises to download, categorized libraries) | Noted, tracked separately — unrelated to personalization, its own future track |
| Settings rework + a Coach settings tab | Noted, tracked separately — affects where Coach-related settings eventually live, but not part of this build |

## 9. Future versions (ideas, not commitments)

- Live, multi-point energy/pump tracking through a session
- A genuinely interactive sidebar — real Q&A, not just a notepad
- Form/energy/pump and Memory reaching Weekly (and eventually Month/Meso) analysis
- Exercise library rework, once its own track comes up
- Settings rework, with a dedicated Coach tab

## 10. Success criteria for v1

- Form rating can be logged per set (optional), energy and pump per completed workout (optional) — all absent by default, never blocking a workout
- Progress shows average form per exercise and per-week form/energy/pump; History shows per-set form, per-workout energy/pump, and session duration
- Notes can be entered mid-workout via the sidebar, landing in the Coach Notes store; a general standing fact is entered directly into Coach Memory instead (§11)
- A separate curation process turns raw notes into Memory entries — additions, updates, or expirations — without that logic living inside analysis generation itself; it runs automatically immediately after analysis (§11), not behind a manual trigger
- Memory is fully visible, editable, and deletable directly by the account it belongs to
- Daily Session Analysis's prompt reads form/energy/pump ratings (when present) and the full current Memory list, reasoning with them the way SPEC §8's principles describe — including honest, hedged inference when form data is absent but the numbers suggest something
- Form/energy/pump sliders, their Progress/History displays, and session duration are available to every account, gated or not — same as RIR
- The in-workout sidebar is the one addition to the (ungated) workout screen that requires a `coachGate.ts` check; everything else Coach-specific (Context tab, Memory's view) is already covered by the existing `/coach` route gate

## 11. v1.1 — Notes/Memory restructure and exercise swap (2026-08-27)

Two changes, agreed and built together, neither anticipated by v1's original scope. Both are corrections/additions to the *design*, not a new phase — v1's five phases (§3) all shipped; this is what real usage of the shipped v1 surfaced.

### 11.1 Notes/Memory restructure

**What changed.** v1 gave Coach Notes a browsable list under the Context tab, with edit and delete, and a manual "Update Memory" button that ran curation on demand. Real usage (one real curation run, five real notes, §7.6/§7.7's already-accepted risk model) showed three things didn't earn their complexity:

- **The notes list had no real audience.** Once curated (or superseded by a same-session `sessionNotes` read straight into analysis, §7.8), a raw note's job is done. Nobody was going back to read old notes — they exist purely as input, not a record worth browsing.
- **The Context tab's general note box was a needless detour.** A standing fact typed outside a workout ("cautious with X because of Y") doesn't need curation's judgment call — it *is* already the well-formed, standing-context shape Memory holds. Routing it through Notes just delayed it reaching Memory until the next manual curation run.
- **"Manual before automatic" (§8/TASKS §5.1's original reasoning) stopped being the safer choice once curation was trusted.** The one real run produced two correct entries (with a lossiness finding worth a future prompt revisit, not a trust problem — CONTEXT.md's 2026-08-27 review). Making curation the automatic second half of the one ANALYZE action removes a manual step without removing any of the judgment, validation, or audit trail (`v2_coach_curation_runs`, §7.6) that made it safe to automate.

**What v1.1 actually does**, replacing §4/§6's now-superseded description:

- The Context tab's general note box is gone. Coach Memory's own "ADD ENTRY" (already present in v1, unchanged) is now the *only* way to write a general standing fact directly — no AI, immediate, exactly like a phase or weight log entry.
- The Coach Notes browsable list is gone. `v2_coach_notes` stays exactly as it was (schema unchanged) — it's internal staging now: the sidebar writes to it, this session's own analysis reads this session's own notes from it, and curation reads and stamps it. Nothing browses it anymore, and nothing needs to.
- The sidebar is completely unaffected — still the only way a raw, mid-workout note gets written, still gated, still online-and-offline capable.
- Curation runs automatically, once, right after each fresh analysis generation — the "one ANALYZE click does both" design this section is named for. It still never reprocesses a note it's already seen (`curated_at`, unchanged mechanism), and a curation failure never turns a successful analysis into a failed response — the analysis the lifter asked for and already has is never held hostage by the automatic step riding along after it.
- The manual "Update Memory" button is gone from the UI, but the underlying curation endpoint stays reachable on its own — useful for direct verification, the same way every other AI surface in this app has been checked against real deployed behavior.

### 11.2 Swap exercise for this session only

**New capability, not in v1's original scope at all.** Real usage exposed the exact gap this closes on 2026-08-27 itself: a broken Chest Press machine forced a genuine equipment substitution mid-session, logged under the original exercise's id because there was no other option — which `sessionNotes` (§7.8) could explain to the model after the fact, but which the *lifter* had no first-class way to record as "I'm doing a different exercise right now" while it was happening.

- A swap action lives on the exercise itself (not a per-set control) — tapping it opens a picker filtered to exercises sharing the original's muscle group, or an inline "create new" for that same muscle group.
- Confirming a swap does two things: marks the original exercise's remaining sets for today as skipped (reusing the exact same mechanism as the existing "skip rest of exercise" action), and adds the chosen exercise as an extra, unplanned exercise for this session — the exact same concept as an on-demand extra *set*, one level up, applied to a whole exercise instead.
- **Session-only, by construction.** Nothing about a swap writes to the workout day template or the week's plan — the replacement exercise exists only as logged sets for this session. Next week's plan generation reads only the template/plan layer, never session logs, so it is structurally incapable of being affected.
- The replacement resolves its own reference history independently (first-time if it's never been logged in this slot before, a real comparison otherwise) — it is not treated as a continuation of the exercise it replaced.

This document's §6/§10 are not otherwise rewritten for this addition — it's a new, additive capability on the already-ungated workout screen, gated by nothing new (same posture as form/energy/pump: first-class training data, not a Coach-only concept).

---

This document is the source of truth for this initiative. v1's five phases (§3) and v1.1 (§11) have both shipped. Claude Code should read this before any technical planning begins.
