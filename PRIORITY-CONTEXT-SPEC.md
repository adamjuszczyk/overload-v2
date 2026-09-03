# SPEC — Priority Context

*Revised 2026-09-02. **§4 (data model), §5 (UI) and §1/§2's location wording changed:
priority is scoped per mesocycle and lives in the planner, not global and not in Coach →
CONTEXT.** §3's compositional semantic — the part this document says matters most — is
untouched, as is everything in §2's out-of-scope list. §4's original flagged assumption
("v1 stores current priority only, no history") is superseded rather than deleted: see
§4's new "On history" paragraph, which records what per-meso scoping resolves and what it
doesn't. PRIORITY-CONTEXT-TASKS.md §8 carries the full reasoning.*

## 1. Vision

A way for Adam to declare, per muscle group and per muscle subgroup, how much a given
training block is meant to care about training it — so Coach features can tell the
difference between "this is lagging and that's a real problem" and "this is lagging and
that's expected, I deliberately deprioritized it."

This is Coach-wide context, not a feature belonging to any one analysis. Mesocycle
Analysis is its first real consumer, but it's written to also inform daily and weekly
analysis, and eventually the planner, later. "Coach-wide" describes who *reads* it —
the data is scoped to a mesocycle (§4) and is set in the planner (§5), not in Coach.

## 2. Scope (v1)

**In scope:**
- A priority setting for every muscle_group (12 values) and every muscle_subgroup (22
  values across their 6 categories), **set per mesocycle**.
- Four levels: top priority, high priority, normal priority, low priority.
- A surface in the planner, on the mesocycle being planned, to view and change them.

**Explicitly out of scope:**
- No AI writes to this — Adam sets it, nothing infers or adjusts it automatically.
- No inference from actual training volume. A muscle group getting more sets this meso
  doesn't imply it's a priority — stated preference and actual behavior are allowed to
  differ, and collapsing them would erase exactly the distinction this feature exists to
  preserve.
- No wiring into any analysis or the planner. That happens in the features that consume
  this (Mesocycle Analysis first), not here.

## 3. The compositional semantic (the part worth getting exactly right)

Muscle_group priority and muscle_subgroup priority are not the same kind of number, and
subgroup priority is not an independent global scale:

- **muscle_group priority is a ceiling on how much attention that whole area deserves.**
  "Low priority" on chest means: don't read much into anything happening in chest at all
  this meso, regardless of what its subgroups say.
- **muscle_subgroup priority is relative emphasis *within* whatever attention its group
  already gets** — not a competing entry on the same scale as other muscle groups'
  subgroups.

Worked example: chest = low priority, upper_chest = top priority, lower_chest = low
priority. This does **not** mean upper_chest competes with your other top-priority
muscle groups overall. It means: of the little attention chest gets at all, nearly all
of it should go to upper_chest specifically.

Any feature reading this data must apply subgroup priority as *relative-within-group*,
never as an absolute cross-group ranking. This is the one thing about this data most
likely to be misused if a future consumer doesn't read this section first.

## 4. Data model (conceptual — actual schema is TASKS.md's job)

**Priority is scoped per mesocycle.** One row per (user, mesocycle_id, tag_type,
tag_value) — tag_type is either muscle_group or muscle_subgroup, tag_value is one of the
real vocabulary values from exerciseTags.ts. Priorities are set as part of planning a
mesocycle and belong to that block; a new meso does not inherit the previous one's rows
automatically (see §5).

A meso with no rows reads as all-normal, and that needs no special handling — it's the
same sparse-storage default as any individual tag that was never set. That covers the
mesocycle currently in progress when this ships, and every mesocycle that predates the
feature: they read as all-normal forever, which is accurate, because nothing was ever
stated for them. A blank screen with 34 dropdowns to fill in before the feature is
usable would be a bad first experience, and defaults are what prevent that.

**On history.** Per-meso scoping means the store is inherently historical at meso
granularity: "what were my priorities during meso X" stays answerable forever, by one
query, for every meso that ever had rows — it isn't reconstructed from an analysis
payload and doesn't depend on an analysis having been run. What remains unrecoverable is
only churn *within* a single meso: setting chest to low in week 2 and back to high in
week 6 leaves only the final state. That residual gap is accepted for v1 and is worth
revisiting only if priorities turn out to move mid-block in practice rather than being
set at creation. See TASKS.md §8 for the full reasoning and the purely-additive shape a
future within-meso change log would take.

## 5. UI

Lives in the planner, on its own per-mesocycle screen — not in Coach → CONTEXT. Setting
priorities is part of planning a block, so the screen is reached from the mesocycle
being planned: straight after creating one, and durably afterwards from wherever that
meso is already surfaced.

A list grouped by muscle_group, each with its subgroups nested underneath, each row
getting a 4-way priority selector. No separate onboarding flow — defaults handle the
empty case.

**A new mesocycle starts blank at all-normal.** It does not silently inherit the
previous block's priorities: an inherited row would look like a stated preference for a
block nothing was ever stated for, which is exactly the distinction §1 exists to
preserve. Instead, a new meso with nothing set yet offers an explicit one-tap **COPY
FROM «previous meso»** — the same shape as the planner's existing COPY WEEK, and
deliberate rather than automatic, so everything it writes really was chosen for this
block. "Previous meso" means the most recent by start date.

## 6. Consumers (not built here, named for context)

- **Mesocycle Analysis** (separate spec) — reads this to distinguish an underperforming
  priority area from an expected, deprioritized one. It reads **one specific meso's**
  priorities — the one being analysed, which is a completed block, never whichever meso
  happens to be active at the time.
- **Daily / Weekly analysis, the planner** — future, not scoped or committed here. Each
  will have to decide which meso's priorities it means; that question didn't exist
  before §4 became per-meso and isn't answered here.

---

This document is the source of truth for this feature's v1. Claude Code should read this
before any technical planning (TASKS.md) begins.
