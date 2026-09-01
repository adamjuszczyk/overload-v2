// Static reference for the app_mechanics category (QA-SIDEBAR-SPEC.md §3,
// TASKS §4.4) — "what does RIR mean," "how do supersets work here" style
// questions. Deliberately trivial: one string constant, no database read,
// no session or training data anywhere near it. This is the one category
// where `assembleAppMechanicsContext` (qaContext.ts, Phase 3) performs no
// query at all and just returns `{ reference: APP_MECHANICS_REFERENCE,
// version: APP_MECHANICS_VERSION }`.
//
// This constant drifts as the app changes, silently, with no test that can
// catch it (TASKS §4.4's own flagged risk) — mitigation is procedural (a
// line in a future feature's phase checklist), not technical. Bump
// APP_MECHANICS_VERSION whenever this text changes in a way that could
// change what the model says, same versioning discipline as
// PROMPT_VERSION/WEEK_PROMPT_VERSION.

export const APP_MECHANICS_VERSION = 1

export const APP_MECHANICS_REFERENCE = `This app is organized in three layers: Program (which exercises make up each workout day, no sets or targets yet) → Weekly Plan (how many sets and what RIR target for each exercise, for one specific week of one mesocycle) → Session Log (what was actually done in the gym — the real weight, reps, and RIR for each set, which can differ from what was planned).

RIR means "reps in reserve" — how many more reps could have been done before failure. RIR 2 means the set was stopped with 2 reps left in the tank. A lower RIR means a harder set; RIR 0 means the set was taken to failure.

A mesocycle ("meso") is one training block, made up of numbered weeks. Week numbers are calendar weeks anchored to Monday — week 1 starts on the Monday on or before the meso's start date, and the week number increments every Monday, not on whatever weekday the meso happened to start. A "deload" week is a week deliberately programmed with lighter numbers to allow recovery — a smaller weight or fewer sets in a deload week is the plan working as intended, not a regression.

A dropset is one continuous set performed as a heavier "head" followed by one or more lighter "stages," each done immediately after the last with no rest — for example, a head at 100kg followed by a drop to 80kg, with no break between them. The head and its stages count as one set for planning and set-counting purposes, even though each stage has its own logged weight, reps, and RIR.

A warmup set is logged separately from working sets and is never counted toward a session's working-set total, its average RIR, or its e1RM calculation.

"Skip" marks a planned set as intentionally not done (no weight or reps recorded), which is different from an "extra set" — a set actually performed beyond what was planned for that exercise that week. A skipped set is absence of work; an extra set is more work than planned.

e1RM ("estimated one-rep max") is a single-number estimate of the heaviest weight that could theoretically be lifted for one rep, calculated from a set's actual weight, reps, and RIR together (a harder set — lower RIR — produces a higher e1RM estimate than an easier set at the same weight and reps). It's used to compare strength across sessions even when the exact weight or rep count differs week to week.

Three optional per-set or per-session ratings exist, each with its own fixed scale, low to high: form rating (per set) is one of rushed, normal, controlled, extra controlled. Energy rating (per session) is one of none, low, normal, high, supreme. Pump rating (per session) is one of none, some, good, extreme. Any of these can be left unrated — an unrated set or session is different from one explicitly rated "none," which is a real, reported answer.

Weights can be displayed and entered in kg or lbs. The unit shown for a given exercise is decided in this order: that specific exercise's own unit setting, if one is set; otherwise the account-wide unit setting in Settings; otherwise kg.`
