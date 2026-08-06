# Overload v3 — Product Specification
**Version:** 3.0
**Last updated:** August 2026
**Author:** Adam
**Status:** Phase 1 complete — ready for technical planning

---

## 1. Vision

Overload v2 built the planning loop: program → weekly plan → session log → progress review. v3 doesn't change that loop — it fixes the places where real usage exposed gaps between how the app works and how Adam actually trains, and gives Progress and History a clear, distinct job each. This matters now specifically because AI features are coming next: the app needs to be genuinely good on its own terms first, with clean data and clear surfaces, before an AI layer gets built on top of it.

---

## 2. Who It's For

Unchanged from v2. Single user, personal training tool. A coach/sharing feature was raised as an observation from someone Adam gave the app to, but it's explicitly not a need — noted in Out of Scope, not designed.

---

## 3. Platform & Foundation

No change. Same PWA, same shared Supabase project, same three-layer architecture (Program → Weekly Plan → Session Log). Everything below is a refinement within that foundation, not a rebuild of it.

---

## 4. Today View

### 4.1 Exercise reference panel (redesigned)

The panel resolves two independent slots, not one:

**Primary slot — always resolves to something:**
- If this exact session type was completed in the immediately preceding meso week (Monday-anchored, same boundary as meso week numbering) → show **LAST WEEK** with that session's numbers, regardless of the exact day-gap within that window.
- Otherwise, fall back to the most recent time this session type was ever completed → show **LAST TIME** with the numbers and elapsed time (e.g. "3 weeks ago", "5 months ago").
- If it's never been completed → **FIRST TIME** (unchanged from v2).

**Secondary slot — additive, optional:**
- If this session type was already completed one or more times earlier in the *current* week → show **THIS WEEK**, one entry per occurrence, each with its own elapsed time. In practice this will almost always be zero or one entry, but the panel supports more.

```
Today: Push Day A
└── Bench Press
      ├── LAST WEEK  (same session, meso week 6)
      │     3×5 @ 80kg, RIR 2
      ├── THIS WEEK  (same session, 2 days ago)      ← only if it happened already
      │     3×5 @ 82.5kg, RIR 2
      └── (LAST WEEK falls back to LAST TIME + elapsed if no match exists)
```

### 4.2 Set timing — "Measure set time" (new setting)

New Settings toggle. Two modes:
- **Off (current behavior):** one-tap logging, rest timer counts continuously between logs (includes set-performance time, not just rest).
- **On:** an explicit Start Set button. Tap to begin a set, tap Log when done. This isolates true rest time from set-performance time, and unlocks a new **average set duration** stat. Global setting, not per-session. Charts using set-duration data simply skip sessions that don't have it — no backfill needed for historical sessions logged before the toggle was turned on.

### 4.3 Other Today changes
- Rest timer displayed directly under the set row just completed, not only as a floating/global element.
- Workout duration shown at the top, counting from session start.
- **Skip whole exercise** — marks every remaining unlogged set in that exercise as skipped in one action (same mechanism as the existing skip-set: nullable weight/reps, `is_skipped = true`).
- Easy jump from a session's exercise card into that exercise's History view (see Section 6).
- **Edit note after completion** — the completed-state Today screen gets its own "edit note" action that patches the session's note field directly, without reopening the session or changing its status. This does not depend on the reopen-session flow at all.

---

## 5. Plan View

- Workouts sit on top with a switcher between them, instead of scrolling through all workouts on one page.
- "Copy last week" splits into two distinct actions: **copy whole week** and **copy just this workout** from last week.
- New **compact display mode** — collapses repeated rows into a single line (e.g. "3× Bench Press") instead of three stacked set rows.

---

## 6. Progress View

**Redefined role:** Progress is the surface where comparisons have already been done for you. This is the deliberate counterpart to History (Section 7), which is where you do the comparing yourself.

**Per-exercise headline (new):**
- Metric: average e1RM (estimated 1-rep max) across that exercise's main working sets in a session — excludes warmup sets and dropset stages, so every real working set counts rather than just the top set or a single best-set estimate.
- Comparison window: first vs. most recent working numbers within the **current meso** — mesocycles already exist as a concept, so no new time-window logic is needed.
- Displayed as **percentage only** — no absolute weight figure attached. The underlying number is a formula estimate, not a literal weight lifted, so pairing it with a fabricated "+2.5kg"-style figure would imply false precision.

```
Incline bench press: +7% this meso
```

Existing v2 meso-level dashboard (weekly volume trend, avg RIR trend, avg reps, avg rest time, deload weeks marked) continues unchanged — this per-exercise headline is additive, not a replacement.

Deload decisions are explicitly **not** what this view is for — those come from feel and from noticing strength has stalled or dropped, not from a computed number.

---

## 7. History View

**Redefined role:** raw, exact numbers you compare yourself — the OneNote-style "I can see exactly what I did and compare it at a glance" experience that the per-session detail view alone doesn't give you.

Two new cross-meso views, each combining a chart (for shape) with a data table underneath (for exact numbers):

- **Exercise, all time** — a chart of the trend plus a table of exact date / weight / reps / RIR per set, filterable by meso, deload weeks marked.
- **Session type, all time** — e.g. every "Push Day A" ever, chart plus a table of date / total volume / avg RIR / duration per occurrence.

The table is the part that actually solves the original complaint — a chart alone still requires hovering over points to read exact values; the table gives the same at-a-glance comparison the OneNote sheet gave.

---

## 8. Program View

### 8.1 Weight units (kg/lbs)
- Preferred unit chosen per program-exercise at program-creation time, defaulting from the global Settings unit.
- A small, rarely-used override button during logging lets you log a specific set in the other unit.
- Canonical storage remains kg everywhere (unchanged from v2). All Progress/History numbers convert to the Settings unit for display.

### 8.2 Deferred — static / repeat-plan mode
Raised as a possible feature for people who don't vary their plan week to week. Deferred to backlog: the existing "copy whole week" action (Section 5) already covers most of this in one tap, and a dedicated mode would add data-model complexity that isn't validated as needed for Adam's own training style. Revisit only if this becomes a real need later.

### 8.3 Deferred — warmup sets
Real warmup sets performed before each exercise's working sets — not a checklist, not a separate warmup "exercise." Deferred: the shape of this (auto-calculated percentage ramp vs. manual entry, exact default percentages, whether it's a global or per-exercise setting) needs more thought after v3 ships and gets used for a while.

One thing locked in regardless of how the rest resolves: **whenever warmup sets are built, they carry their own flag distinct from working sets in the data model**, so they never enter e1RM, volume, or the Today reference panel — those only ever compare working sets.

---

## 9. Library

Default seeded exercise library, so a fresh setup isn't empty. Muscle-group tagging carries over from v2. The exact list of default exercises is TBD at build time.

---

## 10. Dropset Restructure

The problem isn't the database — `parent_set_id` can already chain any number of rows. The problem is that a dropset is currently authored as several sibling sets that each happen to carry a flag, instead of being one thing with an ordered list of stages.

**Old model:**
```
Set 1 → 100kg × 8, RIR 1
Set 2 (flagged dropset) → 80kg × 6
Set 3 (flagged dropset) → 65kg × 5
```

**New model:**
```
Set 1
  main stage   → 100kg × 8, RIR 1
  drop stage 1 → 80kg × 6
  drop stage 2 → 65kg × 5
  (any number of drop stages — added on the fly, both when
   planning and spontaneously mid-session)
```

Applies to both the weekly plan and the session log — a dropset is authored and logged as one unit, with an "add a stage" affordance, no upper limit on stage count.

---

## 11. Settings

New in v3:
- **Measure set time** (on/off) — see Section 4.2
- More accent colour options (extends the existing accent picker)

Unchanged from v2: theme, existing accent colour system, rest timer disable/buzz, weight unit (kg/lbs display default).

---

## 12. Navigation Structure

Unchanged from v2:
```
Overload v3
├── Today
├── Plan
├── Progress
├── History
├── Program
└── Library
```

---

## 13. Out of Scope for v3

| Feature | Status |
|---|---|
| Static / "repeat-plan" weekly mode | Deferred — copy-last-week covers most of the need |
| Warmup set calculator / dedicated logging | Deferred — needs more design thought after real usage |
| Coach / sharing feature | Not planned — not a personal-tool need |
| Planned supersets | Still deferred (carried from v2) |
| Body weight / measurements, cardio tracking | Separate extensions (carried from v2) |
| AI coaching | Atlas-level feature (carried from v2) |
| Apple Watch / wearables, social / sharing | Out of scope (carried from v2) |

---

## 14. Key Differences from v2

| v2 | v3 |
|---|---|
| Reference panel: single LAST WEEK/LAST TIME slot, ~10-day rolling threshold | Two slots: meso-week-anchored primary slot + additive "this week" list |
| Rest timer counts set-performance time as rest | Optional Start Set flow isolates true rest + adds avg set duration stat |
| Note only editable by reopening a session | Dedicated edit-note action on the completed-state Today screen |
| Progress = per-exercise charts + meso stats dashboard | Progress adds a per-exercise "already compared" % headline (e1RM-based) |
| History = individual session detail only | History adds cross-meso chart + table views (exercise-level, session-type-level) |
| kg/lbs is a single global display setting | Preferred unit set per program-exercise, with a logging-time override |
| Dropset = N sibling sets each individually flagged | Dropset = one set with an ordered list of N stages |
| No default exercise library | Seeded default library on fresh setup |

---

## 15. Success Criteria for v3

Overload v3 is successful when:
- You can glance at the Today screen and know exactly how this session compares to last week and to any earlier session this week, without doing date math in your head
- A dropset with any number of stages takes one action to plan and one action to log — never several sibling sets to keep straight
- History lets you compare exact numbers yourself the way your old OneNote sheet did — no external notes app needed for that anymore
- Progress tells you, per exercise, whether it's actually working — a number you read, not a chart you have to interpret
- The reopened-session bug and the rest-timer-includes-set-time issue, both surfaced through real usage, are gone

---

*This document is the source of truth for v3. Claude Code should read this before any technical planning begins.*
