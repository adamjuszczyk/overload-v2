# Overload v2 — Product Specification
**Version:** 2.0
**Last updated:** July 2026
**Author:** Adam
**Status:** Phase 1 complete — ready for technical planning

---

## 1. Vision

Overload v2 is a serious strength training tracker built around how a real intermediate-to-advanced lifter actually trains. v1 tracked what you did. v2 adds the planning layer that comes before — the weekly plan — so the app reflects the full training loop: program → weekly plan → session log → progress review.

The core loop:
```
Program (what exercises)
  → Weekly plan (how many sets, what RIR, per session per exercise)
  → Session log (what actually happened)
  → Progress review (is it working?)
```

---

## 2. Who It's For

Single user. Personal training tool. No social features, no coaching.

---

## 3. Platform

**PWA — same as v1**

Same Supabase project, same credentials. No platform change needed.

---

## 4. The Three Planning Layers

This is the core architectural change from v1.

### Layer 1 — Program
Defines the structure of training. What exercises, in what order, on what days. Nothing more.

Per exercise:
- Exercise name (from library)
- Position in session
- Target reps — **optional**. A mental model reminder only, never enforced. Can be left blank.

The program no longer stores sets or RIR targets — those belong to the weekly plan.

### Layer 2 — Weekly Plan
The primary planning layer. Created once per week, before the week begins (on PC).

Structure:
```
Week (e.g. Week 3 of meso)
└── Push session
      └── Bench Press
            ├── Set 1 → target RIR: 3, dropset: no
            ├── Set 2 → target RIR: 2, dropset: no
            └── Set 3 → target RIR: 1, dropset: yes
      └── OHP
            ├── Set 1 → target RIR: 3
            └── Set 2 → target RIR: 2
└── Pull session
      └── ...
```

Per set in the weekly plan:
- Target RIR
- Dropset flag (yes/no)

The weekly plan is the bridge between the program template and the actual session. It gives the gym UI its targets.

### Layer 3 — Session Log
What actually happened. Created at the gym on phone.

Per set logged:
- Weight
- Reps performed
- RIR achieved (optional)
- Technique note or feeling (optional)
- Dropset flag — can be set spontaneously even if not planned
- Timestamp (for rest time calculation)
- Rest seconds (computed from timestamps, stored)

---

## 5. Meso Structure and Deload Handling

### Mesocycle
A meso is one training block — a program run from start to finish. It has:
- A name
- A linked program
- A start date
- An end date (set when the meso is completed)
- A status: active, completed
- A list of weeks (each week is a WeekPlan)

Only one meso can be active at a time.

### Deload
A deload is a flag on a specific week within a meso — not a separate program.

- Same exercises as the rest of the meso
- User manually triggers "this is a deload week" when planning the weekly plan
- The deload flag is visible in history and progress so trends can account for it
- After a deload the meso is typically ended → new meso begins with a new program (usually new exercises)

The app never auto-schedules deloads. The user decides when based on feel.

### Meso end flow
User marks meso as complete → prompted to start a new meso (pick or create a program) → new meso begins. History of the completed meso is preserved and filterable.

---

## 6. The Gym UI

The most important screen. Same core concept as v1 — last session reference always visible, sets pre-filled — but now driven by the weekly plan rather than just last session.

For each exercise the gym screen shows:
- Exercise name
- **This week's plan** — how many sets, target RIR per set, dropset flags
- **Last session reference** — what was actually logged last time (weight × reps, RIR achieved)
- Set rows pre-filled from last session weight. RIR target from weekly plan shown as a guide.
- Log button as the most prominent tap target
- RIR field (collapsed by default, tap to expand)
- Note field (collapsed by default, tap to expand)
- Skip set option
- Spontaneous dropset flag on any set

### Rest timer
- Counts up after each logged set
- Rest time between exercises tracked too (timer continues between last set of one exercise and first set of next)
- Option in settings to disable entirely (not visible at all)
- Option to buzz at target rest duration (on/off toggle)

---

## 7. Progress Views

### Per-exercise progress (v1, improved)
- Weight over time line chart
- Volume overlay
- Avg RIR over time
- Avg rest time per exercise
- Last 5 sessions detail

### Overall / Meso progress (new in v2)
A dashboard-level view showing:
- Current meso progress (weeks completed, sets completed vs planned)
- Weekly volume trend (total sets per week, across the meso)
- Avg RIR trend per week (is intensity increasing as planned?)
- Avg reps per week
- Avg rest time per week
- Deload weeks clearly marked on all charts

---

## 8. History Improvements

- Exercises show in correct session order (position field) — bug fixed in v1
- Filters: by meso, by session type/name, by date range, by muscle group
- Delete sessions and mesos
- Weight underline removed (cleaner display)
- Muscle group shown per exercise in session detail

---

## 9. Program Builder Improvements

- When adding exercises to a workout day, select targeted muscle groups first — exercise picker filters to show only those muscles
- Muscle group tagging on exercises enables history filtering by muscle group
- Rep suggestion field is optional, clearly labelled as suggestion only

---

## 10. Personalisation / Settings

- **Theme:** light / dark mode toggle
- **Accent colour:** choose from a set of options
- **Rest timer:** disable entirely (not visible at all) or enable with optional buzz
- **Target rest duration** (if enabled): set in seconds
- **Weight unit:** kg / lbs (display only, all DB values in kg)

---

## Design Direction

Industrial dark aesthetic. Base: `#060607`.

Single accent colour — orange (`#FF8C42`) as default. Accent colour is user-switchable in Settings (v2 feature) so all accent usage must reference a single CSS custom property: `--accent`. Never hardcode the accent colour value anywhere in components.

All colours defined as CSS custom properties in `tokens.css`. No hardcoded values anywhere in components.

Dark mode default. `tokens.css` structured to support a future `[data-theme="light"]` override with zero component changes.

The v1 Overload codebase is available at `C:\projects\overload`. Reference its visual style and component patterns where they carry over to v2, but do not copy code directly — v2 is a fresh build with a different architecture.

---

## 11. Dropset Handling

Two entry points:

**Planned (during weekly planning):**
Flag any set in the weekly plan as a dropset. Shows in the gym UI as a planned dropset for that set.

**Spontaneous (during a session):**
Flag any set as a dropset on the fly in the gym UI, regardless of whether it was planned. The set log records the dropset flag.

A dropset is logged as a separate set row with the reduced weight, linked to the parent set via a `parent_set_id` field (or a `is_dropset` flag). The display groups them visually — main set followed by its dropset(s) indented beneath.

Planned supersets: deferred to v3.

---

## 12. Navigation Structure

```
Overload v2
├── Today          ← Gym UI (session prompt / active session)
├── Plan           ← Weekly plan builder (new)
├── Progress       ← Per-exercise + meso overview
├── History        ← Past sessions with filters
├── Program        ← Program builder
└── Library        ← Exercise library
```

---

## 13. Out of Scope for v2

| Feature | Status |
|---|---|
| Planned supersets | v3 |
| Body weight / measurements | Separate extension |
| Cardio tracking | Separate extension |
| AI coaching | Atlas-level feature |
| Apple Watch / wearables | Out of scope |
| Social / sharing | Not personal |

---

## 14. Key Differences from v1

| v1 | v2 |
|---|---|
| Program stores sets + RIR targets | Program stores exercises only (+ optional reps) |
| No weekly planning layer | Weekly plan is the primary planning layer |
| No meso/deload concept | Mesos with deload week flags |
| No overall progress view | Meso-level progress dashboard |
| No muscle group filtering | Muscle groups in builder + history filters |
| No set skip option | Skip a set |
| No dropset support | Planned + spontaneous dropsets |
| No between-exercise rest tracking | Rest tracked between exercises too |
| Fixed theme | Light/dark + accent colour |

---

## 15. Success Criteria for v2

Overload v2 is successful when:
- You plan your full week in under 10 minutes on Sunday night
- At the gym you see both your weekly plan targets and last session reference simultaneously
- After a meso you can review the full progression curve and decide intelligently whether to deload or start fresh
- You never need OneNote or a notes app to track anything training-related

---

*This document is the source of truth for v2. Claude Code should read this before any technical planning begins.*
