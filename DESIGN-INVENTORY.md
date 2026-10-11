# Overload — Design Inventory

Read-only inventory of the UI as coded on master `07a5680` (2026-10-11), written for the redesign. Every entry was read from the component source, not from CONTEXT.md's summary. No application code was changed.

**How to read it.** Each screen section lists controls with: label as rendered, what it does, when it is visible (conditions from code), and where it lives (on screen / behind ⋯ / in a sheet). Parts:

1. Screens
   - 1.1 Plan: page, SETS view, banners, sheets
   - 1.2 Plan: STRUCTURE view and ⋯ menus
   - 1.3 Planner (`/program/:id`) and Programs page (`/program`)
   - 1.4 Today (every state)
   - 1.5 Workout screen: exercise card, set rows, MORE, stage rows
   - 1.6 Workout screen: shell, reference panel, sheets, finish flow
   - 1.7 What opens when a completed run is tapped
2. Design tokens
3. Reusable components
4. Supplement and corrections

**Findings that differ from what the brief (or CONTEXT.md) might suggest**
- The weekday scheduler result has 10 variants, not 8; sequence runs add a separate 4-variant result (see 1.4).
- The planner has no review/finish step, no next/back buttons and no ⋯ menus: steps are a free-switch tab bar; SAVE just navigates away (every edit writes immediately).
- The Programs page has no ⋯ menus, no header icons and no per-program delete or rename.
- The set row has no per-set ⋯ menu on the workout screen; everything extra is behind MORE.
- Tapping a completed run opens a priorities screen (not an analysis or summary), fully editable, with no Coach gating.
- Nearly nothing is shared as a component: beyond `ConfirmDialog`, the `planMenu.tsx` ⋯ pieces, `RatingChips` and the Plan switchers, controls are re-implemented locally (four filter-chip copies, two RestStepper copies, two toggle copies). Styling is inline `style={{}}` with CSS variables.

---

# Part 1 — Screens

## 1.1 Plan: page, SETS view, banners, sheets
## Plan screen inventory (plan-a)

Route `/plan` -> `PlanPage` (App.tsx:104). `/plan/priorities` -> `PrioritiesEditor` (App.tsx:105). All paths below are under /home/user/overload-v2/src/features/plan/ unless noted. Line numbers are PlanPage.tsx unless a file is named.

Vocabulary used by the code: planningType = `'stable'` | `'week_dependent'` (types/index.ts:45; undefined on program reads as `week_dependent`, PlanPage.tsx:766). scheduleType = `'weekday'` | `'sequence'` (default `weekday`). A sequence run says CYCLE instead of WEEK and SLOT n instead of weekday. No Coach-only gating exists anywhere on the Plan screen (the Coach gate is only the bottom-nav COACH tab, components/Nav.tsx:32).

---------------------------------------------------------------------
### 1. Top-level routing / pre-screen states

#### PlanPage (wrapper)  (PlanPage.tsx:171)
Decides which screen mounts, based on `useMesos()` + `usePrograms()`:
| Condition | Result |
|---|---|
| active meso exists AND programs query has no data yet AND not error | `PlanSpinner` (centered 22px spinner, full height) |
| active meso exists AND programs query errored with no data | `PlanLoadError` |
| active meso exists AND program.scheduleType === 'sequence' | `SequencePlanPage` (wrapper, below) |
| otherwise (weekday program, or NO active meso) | `PlanScreen` with sequenceCycle=null |
Active meso = first meso with status 'active'.

#### SequencePlanPage  (PlanPage.tsx:195)
Calls `useSequenceCurrentCycle(mesoId, programId)` (useSequenceCurrentCycle.ts): needs 3 reads (sequence items, all week plans of the meso, last done-or-skipped session). cycle===null -> `failed` ? `PlanLoadError` : `PlanSpinner`. Else `PlanScreen sequenceCycle={cycle}`. `failed` = any of the 3 reads isError with data undefined. Cycle = the cycle containing the next due workout (resolveCurrentCycle).

#### PlanSpinner  (PlanPage.tsx:201)
Centered spinning ring, no text. Also shown by PlanScreen while `mesosLoading` (PlanPage.tsx:514).

#### PlanLoadError  (PlanPage.tsx:212)
- Heading (red): `COULDN'T LOAD PLAN`
- Sub: `Check your connection and try again.`
- No retry button, no navigation. Only reachable from the wrapper paths above (programs read failed / sequence cycle read failed). Failures of other reads (week plans, workout days, all-week-plans) have NO error UI on the page (hooks are used with default `= []`, isError never read).

#### No active mesocycle  (PlanPage.tsx:516-543)
Visible when `!activeMeso` (after mesos loaded). Renders instead of the whole header/content:
- Small label `OVERLOAD v2`
- H1 `PLAN`
- Centered text `NO ACTIVE MESOCYCLE`
- Button `START A PROGRAM →` -> `navigate('/program')` (Programs page).
No header controls, no week nav, no PRIORITIES link in this state.

---------------------------------------------------------------------
### 2. Page header (active meso)  (PlanPage.tsx:551-613)
Fixed (non-scrolling) area, bottom border. Two rows.

| Control (exact label) | What it does | Visible when | Lives where |
|---|---|---|---|
| Meso-name line: `{ACTIVE MESO NAME UPPERCASED}` (left, small mono, ellipsis) + `PRIORITIES` + chevron-right icon (right, accent) — the whole row is ONE button, min 32px tall | `navigate('/plan/priorities')` | always (active meso) | header row 1 |
| H1 `PLAN` | static | always | header row 2 left |
| Icon button, CalendarDays icon, aria-label `Programs` (32x32) | `navigate('/program')` (Programs page; the only persistent route there — PROGRAM left the bottom bar) | always | header row 2 right group, first |
| Icon button, ChevronLeft, aria-label `Previous week` | `setViewWeek(w => max(1, w-1))` | always rendered; DISABLED when viewWeek <= 1 (icon dims). Label is `Previous week` even on sequence runs | header, week nav |
| Week/cycle pill: `WEEK {n}` (weekday) or `CYCLE {n}` (sequence). Not a button | shows viewed week. Filled accent when viewWeek === currentWeek; otherwise surface-overlay with text `--text-dim` if past (viewWeek < currentWeek) or `--text-muted` if future | always | header, week nav |
| Icon button, ChevronRight, aria-label `Next week` | `setViewWeek(w => w+1)` | always; NEVER disabled (unbounded forward navigation) | header, week nav |

Week semantics:
- currentWeek: weekday run = `differenceInCalendarWeeks(now, meso.startDate, weekStartsOn Monday) + 1` (PlanPage.tsx:131); sequence run = the cycle from the wrapper (cycle of next due workout). If no meso, 1.
- viewWeek initial = sequenceCycle ?? 1, then an effect sets it to currentWeek whenever `activeMeso.id` changes (PlanPage.tsx:262), i.e. opens on current week/cycle.
- viewWeek is page-local (resets on reload). `planView` and the selected workout/slot persist across week changes within the page; only viewWeek, selection reset on remount.
- isPast = viewWeek < currentWeek (PlanPage.tsx:266). On a sequence run "past" follows the current cycle, not the calendar.
- Page-local: no persisted settings.

Side effect on every view of a week: effect calls `planWeek.mutate({mesoId, weekNumber: viewWeek})` (v2_plan_week, atomic and idempotent) whenever active meso id or viewWeek changes (PlanPage.tsx:339). So browsing to ANY week number (incl. far future) plans that week (creates week-plan rows). Not gated on past/future.

---------------------------------------------------------------------
### 3. Content area, top to bottom (active meso)  (PlanPage.tsx:616-805)
Scrolling area. In order:

| # | Element | Visible when |
|---|---|---|
| 1 | Past-week banner | isPast |
| 2 | COPY WEEK / COPY LAST CYCLE button | showCopyButton |
| 3 | MARK WEEK AS DELOAD toggle (+ rules line + notice) | showWeekDeloadButton |
| 4 | MAKE THIS WEEK THE NEW DEFAULT | showMakeDefault |
| 5 | Loading spinner | plansLoading OR daysLoading |
| 6 | NO WORKOUTS SCHEDULED empty state | !plansLoading && !daysLoading && !hasSchedule |
| 7 | Weekday: WorkoutSwitcher + MoveSessionControl + WorkoutDayPanel | see 3.7 |
| 8 | Sequence: SequenceSlotSwitcher + WorkoutDayPanel | see 3.8 |

#### 3.1 Past-week banner  (PlanPage.tsx:618)
Text `PAST WEEK — READ ONLY` (even on sequence runs, still says WEEK). Visible when `isPast`. Static box, no controls.

#### 3.2 COPY WEEK / COPY LAST CYCLE  (PlanPage.tsx:466-475, 627-638)
- Label: `COPY WEEK` (weekday) / `COPY LAST CYCLE` (sequence); while pending `COPYING…`. Copy icon. Dashed full-width 48px button.
- Does: `copyPrev.mutate()` = useCopyFromPreviousWeek(mesoId, viewWeek) (copies prior planned week into the empty workouts of this week; source per workout via resolveManualCopySource).
- Disabled while `copyPrev.isPending`.
- Visible when ALL: `!isPast`, `viewWeek > 1`, `!plansLoading`, `!daysLoading`, `weekPlans.length > 0`, EVERY week plan of the viewed week has zero exercises, AND (weekday: some scheduled day has a manual copy source; sequence: some workout-bearing slot has a manual copy source). Manual copy source for a workout/slot = `program.planningType !== 'stable'` AND `resolveManualCopySource(history of that workout (slot-scoped on sequence), viewWeek).kind === 'week'` (PlanPage.tsx:448-451). => NEVER shown on a `stable` run.
- Disappears as soon as any workout of the week has an exercise.

#### 3.3 Week-level deload toggle  (PlanPage.tsx:496-498, 646-699)
- showWeekDeloadButton = `!isPast && !plansLoading && !daysLoading && (sequence ? some slot has a workout : scheduledDays.length > 0)`. Independent of whether the week has content; shown on stable and week_dependent.
- weekIsFullyDeload = `weekPlans.length > 0 && every week plan isDeload`.
- Label (one dashed 48px button; fill/outline accent when weekIsFullyDeload):
  - Not fully deload: `MARK WEEK AS DELOAD` (weekday) / `MARK CYCLE AS DELOAD` (sequence)
  - Fully deload: `UNMARK THIS WEEK` / `UNMARK THIS CYCLE`
  - Pending: `MARKING…` (when not-fully-deload) / `UNMARKING…` (when fully-deload)
- Does: `setWeekDeload.mutate({ isDeload: !weekIsFullyDeload, rules: effectiveDeloadRules })` (marks/unmarks EVERY week-plan row of (meso, week) regardless of workout; applies the effective deload rules when marking). onSuccess: if `result.anyAlreadyStarted` set notice `Already started — sets left as they are`. Notice is cleared on every new click.
- Disabled while `setWeekDeload.isPending`.
- Below the button:
  - **Deload rules line** (read-only `<p>`): visible when `deloadRulesText` non-null. Text = `Deload rules (this run's): ...` if program.deloadRules != null, else `Deload rules (your default): ...`. Body from describeDeloadRules (deloadRulesLine.ts), parts joined by ` · ` in order: `sets −{value}% (rounded {rounding})` (percent mode) or `sets −{value}` (non-percent); `weight {percent}% (rounded {rounding} to {step} {stepUnit})`; `reps {+n|−n|0}`; `RIR {+n|−n|0}`. Only rules that are on are mentioned. null (nothing rendered) if no rules / empty. Effective rules = program override else the global Settings default (read live from settings store) (PlanPage.tsx:294-303).
  - **Week deload notice** `Already started — sets left as they are`: visible when weekDeloadNotice set (after a mark/unmark where anyAlreadyStarted).
- Not shown on past weeks.

#### 3.4 MAKE THIS WEEK THE NEW DEFAULT  (MakeWeekDefault.tsx; gate PlanPage.tsx:509-510)
- Gate showMakeDefault: `program.planningType === 'stable'` AND `!isPast` AND `!plansLoading` AND `!daysLoading` AND `canMakeWeekDefault(weekPlans)` (some week plan that is not deload and has at least one planned set under one of its listed exercises; makeWeekDefault.ts:28-40). Hidden on week_dependent runs; on a stable week with only deload/empty sessions; with nothing planned. Applies to current and FUTURE weeks (not past).
- Button label: `MAKE THIS WEEK THE NEW DEFAULT` (weekday) / `MAKE THIS CYCLE THE NEW DEFAULT` (sequence); pending: `MAKING THE DEFAULT…`. Dashed 48px button; disabled while pending.
- Tap -> opens confirm dialog (`ConfirmDialog`, centered modal, overlay click = cancel):
  - Title: `Make week {n} the new default?` / `Make cycle {n} the new default?`
  - Body: `Its sets, reps and structure become the default every week planned from now on starts from. Weights, RIR and tags are not part of it, and deload sessions keep the current default. This cannot be undone.` (`cycle` replaces `week` on sequence)
  - Buttons: `CANCEL`, `MAKE DEFAULT` (accent, not danger-red); confirm shows `…` and is disabled while pending.
- On confirm: calls v2_make_week_default. Success: dialog closes + toast `Week {n} is now the default.` (`Cycle {n}` on sequence); if some workouts were skipped appends ` Deload or empty sessions kept the current default.` Error: dialog closes, toast = error message or `Could not make this week the default` (`cycle` on sequence). No apply-ahead offer follows; already-planned weeks unchanged.

#### 3.5 Loading  (PlanPage.tsx:707)
20px spinner centered when `plansLoading || daysLoading`. While loading, 5 (switcher/panel) are hidden but the page-level buttons 2-4 are also hidden (they require !plansLoading && !daysLoading).

#### 3.6 NO WORKOUTS SCHEDULED  (PlanPage.tsx:719-731)
- Visible: `!plansLoading && !daysLoading && !hasSchedule`. hasSchedule = hasScheduledWorkout (programs/hasSchedule.ts): weekday run = some weekday maps to an existing workout day; sequence run = some sequence item has a workoutDayId that exists. (For a sequence program a stale weekday map doesn't count.)
- Text `NO WORKOUTS SCHEDULED` + link-button `Programs →` -> `navigate('/program')`.
- Same for weekday and sequence runs. Other page-level buttons may also render alongside in unusual cases (they have their own gates: deload requires scheduled days/slots so it will not; copy requires week plans).

#### 3.7 Weekday run body  (PlanPage.tsx:734-769)
Visible when `!isSequence && !plansLoading && !daysLoading && scheduledDays.length > 0 && selected`. scheduledDays = weekdays (Mon..Sun order) whose schedule entry resolves to an existing workout day. `selected` = chosen dow else first scheduled day (no effect needed; falls back silently).

**WorkoutSwitcher**  (WorkoutSwitcher.tsx) — horizontal scrolling chip row, one chip per scheduled weekday:
- Chip = two lines: small `MON`/`TUE`/`WED`/`THU`/`FRI`/`SAT`/`SUN` over the workout name (ellipsis, max 130px chip).
- Active chip accent-filled. Tap -> `setSelectedDow(dow)`. Returns null if no days. A workout on 2+ weekdays appears as multiple chips (same workout, different weekday labels, same plan row).
- No disabled state. Selection survives week changes; `WorkoutDayPanel` is keyed by workoutDay.id so it remounts when a different workout is selected.

**MoveSessionControl**  (MoveSessionControl.tsx) — weekday runs only (sequence has none):
- Renders nothing if `!isCurrentWeek` (viewWeek !== currentWeek: not for past or future weeks).
- Looks up the session for (this workoutDay, this weekday's date `dateForDow(startDate, viewWeek, dow)`) via useSessionsInRange(date,date).
- If that session exists with status `in_progress` or `completed`: plain text `ALREADY STARTED — CAN'T BE MOVED` (no button).
- Else button `MOVE THIS SESSION` (small 26px pill). Disabled when offline (`!useOnlineStatus()`) or a move/clear mutation is pending (dimmed). When offline a line below reads `REQUIRES A CONNECTION`.
- Tap opens **MoveSessionSheet** (gym/MoveSessionSheet.tsx; bottom sheet, backdrop tap closes):
  - Grab handle; label `MOVE THIS SESSION`; X icon button aria-label `Dismiss`; workout name as title; helper `PICK TODAY OR A LATER DAY THIS WEEK`.
  - If no movable days: `NO DAYS LEFT THIS WEEK`.
  - Day chips for each of the 7 days of that week that are today-or-later (past days not rendered): `MON..SUN` + day-of-month number. Current (effective) date chip: disabled, extra line `HERE NOW`. If the chip is the original date and not current: extra line `MOVE BACK` (accent). All chips disabled while pending (current chip dims differently).
  - Pick -> resolveMove(date, target, today): invalid_cross_week / invalid_past do nothing; `clear` (moving back to original) -> clearMovedSession; else moveSession (writes moved_to_date; weekPlanId passed). Sheet closes after pick (not gated on success).
  - Effective date = existing.movedToDate ?? date.

**WorkoutDayPanel** (section 4) with props: headerLabel=`MONDAY`..`SUNDAY` (DOW_LABEL), isShared = workout is on 2+ weekdays, sharedWeekdays = those weekdays, planningType.

#### 3.8 Sequence run body  (PlanPage.tsx:779-804)
Visible when `isSequence && !plansLoading && !daysLoading && selectedSlot`. selectedSlot = chosen slot with a workout, else first workout-bearing slot, else null (null -> body area shows nothing; if also no workouts, the NO WORKOUTS SCHEDULED state in 3.6 shows).

**SequenceSlotSwitcher** (SequenceSlotSwitcher.tsx) — region aria-label `Sequence slot switcher`, horizontal chips ordered by position, one per slot INCLUDING rest slots:
- Chip: small `SLOT {position+1}` over workout name, or `REST DAY` (italic, dim) for a rest slot. Rest chips: disabled, opacity 0.5, not clickable. Active chip accent. Tap -> `setSelectedSlotId(id)`. A repeated workout = two chips.
- Returns null when no slots.

**WorkoutDayPanel** with headerLabel=`SLOT {position+1}`, weekPlan matched by (workoutDayId AND sequencePosition), isShared=false, sharedWeekdays=null. NO MoveSessionControl on sequence runs. Panel key `${workoutDayId}:${position}`.

---------------------------------------------------------------------
### 4. WorkoutDayPanel  (PlanPage.tsx:851-1508)
Props include weekPlan (may be undefined briefly until v2_plan_week creates the row), isPast, view (`sets`|`structure`), planningType, deloadRules.

#### 4.1 Panel header (PlanPage.tsx:1306-1345)
| Control | What it does | Visible when | Where |
|---|---|---|---|
| Small label `{headerLabel}` (`MONDAY`.. or `SLOT n`) over workout name | static | always | panel header left |
| Pill button `DELOAD` (aria-label `Mark this session as deload` / `Unmark this session as deload`) | `toggleDeload.mutate({weekPlanId, isDeload: !weekPlan.isDeload, rules: deloadRules})` — marks THIS session (this workout's row for this week) only. onSuccess outcome 'alreadyStarted' -> notice `Already started — sets left as they are`. Accent-filled when weekPlan.isDeload | rendered only if `weekPlan` exists; DISABLED (and click ignored) when `isPast` | panel header right |

Below header (inline notes):
- **Shared-row note**: `Marks Mon, Tue, Wed, Thu, Fri — they share one plan.` (weekday list = the weekdays that share this workout; sentence-case Mon..Sun joined by `, `). Visible when `weekPlan && sharedWeekdays && sharedWeekdays.length > 0` (weekday run, workout scheduled on 2+ weekdays; never on sequence). Shown regardless of isPast.
- **Session deload notice**: `Already started — sets left as they are` — visible when deloadNotice set (after the session toggle caught the started guard).
- **ApplyAheadBanner** (see 5) — rendered only when `!isPast`.
- **COPY THIS WORKOUT** button (see 4.2).
- **SETS / STRUCTURE switch** (see 4.3).

#### 4.2 COPY THIS WORKOUT  (PlanPage.tsx:964-965, 1383-1394)
- Label `COPY THIS WORKOUT` (pending `COPYING…`), Copy icon, dashed 36px button, same label on sequence runs.
- Does: `copyWorkout.mutate({workoutDayId, weekPlanId, sequencePosition})` (useCopyWorkoutFromPreviousWeek).
- Visible when `!isPast && weekNumber > 1 && (weekPlan?.exercises.length ?? 0) === 0 && canCopyFromHistory` (canCopyFromHistory = hasManualSourceFor: not stable AND a non-deload non-empty prior occurrence exists for this workout/slot). So: never on stable runs, never week 1, only when THIS workout has no exercises this week (even if other workouts do). Disabled while pending.

#### 4.3 SETS / STRUCTURE view switch  (PlanPage.tsx:1400, 1516-1540)
- Segmented bar, two segments: `SETS`, `STRUCTURE`. Active segment accent-filled. `onViewChange` -> `setPlanView` (page-level state, default `sets`; survives week/workout switches; resets on reload). Always visible in the panel (also on past weeks; also when the day has no exercises). Not disabled ever.
- Switching views remounts each exercise section (key includes view) so open ⋯ menus/half-typed cells are dropped.
- STRUCTURE contents are detailed by another agent. Entry-point-level list of what PlanPage.tsx itself places under STRUCTURE (names only): the warmup routine block `StructureRoutine` above the exercise card (STRUCTURE only, passes isPast); per-exercise ⋯ menu (SWAP EXERCISE, MOVE UP, MOVE DOWN, ADD WARMUP SETS, [ExerciseDesignMenu from StructureFields.tsx], REMOVE FROM THIS WEEK); per-set `StructureSetRow` ⋯ menus (ADD STAGE, STAGE KIND chips, DELETE SET / DELETE STAGE, SetRestMenu); ExerciseMarkers; BlockRestEditor + SupersetLinkToggle (EVERY WEEK labelled); the `ADD EXERCISE` dashed button below the card; removed-exercise/-set struck-through lines; WeekExercisePickerSheet (SWAP / ADD EXERCISE); the Remove confirm sheet. See section 10 for sheets that belong to PlanPage.tsx.

#### 4.4 Exercise card and empty state  (PlanPage.tsx:1411-1435)
- Bordered card containing the exercise sections.
- Empty (programExercises.length === 0): text `NO EXERCISES IN THIS DAY`.
- programExercises = `weekPlan.exercises` when a weekPlan exists, else the run copy's exercises of the workout day (`useProgramExercises(workoutDay.id)`) — so before the week row exists the page shows the run's list (editing controls act on weekPlan and are no-ops/hidden when weekPlan missing: handlers `if (!weekPlan) return`, ADD EXERCISE hidden).
- Content wrapped in `WeekDiffGate` (diff highlighting; see 8). STRUCTURE view additionally wrapped in `StructureFieldsProvider`.

---------------------------------------------------------------------
### 5. ApplyAheadBanner / offer  (ApplyAheadOffer.tsx; wiring PlanPage.tsx:913-923, 1372-1380)
Banner rendered in the panel (above COPY THIS WORKOUT) only when `!isPast`, and itself returns null if neither an offer nor an outcome exists. Dashed-border box.
State machine (`useApplyAheadOffer`): `setOffer(changes, weeks, isShared)` is called right after a qualifying edit; with zero later planned weeks or zero changes it sets offer = null (and clears outcome). Reset (offer+outcome cleared) when resetKey changes: `${workoutDayId}:${weekNumber}` plus `:${sequencePosition}` on sequence rows — i.e. on week change or workout/slot change.
Later weeks = `laterPlannedWeeks(allWeekPlans, workoutDay.id, weekNumber, sequencePosition)` (same workout/slot, weeks after the viewed one that already have a row).

Offer state text:
- `APPLY THIS CHANGE TO {n} PLANNED WEEK AHEAD?` / `... {n} PLANNED WEEKS AHEAD?` (n=1 -> `WEEK`, else `WEEKS`; same wording on sequence runs).
- If offer.isShared: `This workout is scheduled on more than one weekday — this affects every one of those days.`
- If offline: `OFFLINE — CONNECT TO APPLY`.
- Buttons: `APPLY` (accent; pending `APPLYING…`; disabled when pending OR offline) and an X icon button aria-label `Dismiss` (always enabled).
Outcome state (after apply):
- `APPLIED TO {applied} OF {total} PLANNED WEEK|WEEKS` + optional ` — {n} SKIPPED (DELOAD)` + optional ` — {n} SKIPPED (ALREADY DIFFERENT)` + optional ` — STOPPED: {ERROR MESSAGE UPPERCASED}` (error default message `Could not apply the change.`). Only the X (`Dismiss`) button is shown.

Which edits raise an offer (each calls setOffer with ChangeRecord(s)):
| Action | editType |
|---|---|
| ADD SET (+) | addSet |
| ADD WARMUP SETS | addWarmupSet |
| ADD STAGE | addStage |
| DELETE SET (working head) / DELETE STAGE / warmup DELETE SET | removeHeadSet / removeStage |
| Weight target edit | weightTarget |
| Rep target edit (AMRAP may also set RIR -> 2 records applied as one bundle) | repTarget (+ rir) |
| RIR stepper | rir |
| Tag toggle / add custom tag (single set) | tags (heads only) |
| STAGE KIND chip | stageKind |
| (warmup toggle record exists in handleUpdateSet; no UI control in this file passes isWarmup) | warmup |
| SWAP EXERCISE pick | swapExercise |
| ADD EXERCISE pick | addExercise |
| REMOVE (exercise) confirm | removeExercise |
| MOVE UP / MOVE DOWN | reorderExercise |
NOT offered for: tag "apply to all sets" (multi-row), deload toggles, copy actions, MAKE DEFAULT, run-wide STRUCTURE fields.

---------------------------------------------------------------------
### 6. SETS view  (default view; ExerciseSection view==='sets', PlanSetGroup, SetRow)

#### 6.1 Exercise section header  (PlanPage.tsx:1596-1670)
Per exercise (in week order; superset members contiguous):
- Exercise name (`—` if missing), ellipsis.
- Muscle group uppercase under it; if `inSuperset` (unit of 2+ members) append `· SUPERSET` (accent) on EVERY member.
- Right side (only when `!isPast`): **Add-set button**: `+` icon in accent-muted square, aria-label `Add set to {name}`. Does `handleAddSet`: `addSet.mutate({workoutDayId, weekPlanId, programExerciseId, setNumber: heads+1})` then raises apply-ahead offer. Disabled (dimmed 0.5) while any of addSet / removeSet / addWarmup is pending (applies to ALL exercises of the day).
- No ⋯ at exercise level in SETS (that is STRUCTURE's). No ExerciseMarkers (STRUCTURE-only).
- On past weeks: no `+`.
- (Diff mark on exercise header is STRUCTURE-only.)
- Sets body: groups sorted by head.setNumber; empty exercise (no sets) shows only header — no empty-state text for an exercise with zero sets.

#### 6.2 Set row (head)  (SetRow, PlanPage.tsx:2122-2244; PlanSetGroup 1793-1896)
One row, left to right:
1. **Set number**: `01`, `02`, ... (2-digit zero padded; display ordinal = index in sorted groups + 1). Accent colour when diff-marked "added".
2. **Weight cell** (WeightTargetEditor): button showing `{value}{unit}` (e.g. `80kg`) in the exercise's resolved unit (exercise weightUnit override else global Settings unit) or `—` when no target. Tap (not past) -> inline text input (inputMode decimal, placeholder `0`, aria-label `Weight target`, unit suffix text inside). Commit on blur or Enter. Blank -> clears target (writes null if previously set). Invalid (NaN or <0) -> stays editing, red border, message `Enter a valid weight`, nothing written. Unchanged value writes nothing. Existing value uses drift guard (resolveEditedWeightKg). Stores kg. Disabled when isPast. Accent when diff-marked changed.
3. `×` separator.
4. **Reps cell** (RepTargetEditor): button showing formatted target (number `8`, range `8-12`, `AMRAP`) or `—` when none (aria-label `Set rep target` when none). Tap -> inline input (placeholder `8, 8-12, AMRAP`, aria-label `Rep target`), commit on blur/Enter. Blank -> clears (repMin/repMax null, isAmrap false) if previously set. Invalid -> stays editing, red border, message `Enter a number, a range like 8-12, or AMRAP`. Unchanged -> nothing written. AMRAP entry on a set whose RIR is null also writes targetRir 0 (applyAmrapRirDefault). Disabled when isPast. Accent when diff-marked.
5. **RIR stepper** (RirStepper): `−` button, centre text `NO RIR` (when null) or `RIR {n}`, `+` button. `−`: disabled when value null; value 0 -> sets null (NO RIR), else value-1. `+`: null -> 3; else min(value+1, 9). Both disabled when isPast. Accent when diff-marked. NOT rendered on a WARMUP head (a flex spacer takes its place) — warmups have weight and reps only.
6. **⋯ menu button** (aria-label `Options for set {n}`): rendered when `!isPast` and the row has a menu. On past weeks a blank 28px spacer holds the place. (Stage rows get no ⋯ in SETS.)
7. **Marker line** under the row (SetMarkers), only if there is something: kind label (accent text) — `WARMUP` on a warmup head, or the stage-kind label (`DROPSET`, `REST-PAUSE`, `MYO-REPS`, `CLUSTER`) on a head that has stages (legacy/null kind reads as DROPSET); a plain working set shows no kind. Tags as chips (one per tag). Nothing at all when none. (`extra` run-wide chips are STRUCTURE-only.)

#### 6.3 Set row ⋯ menu contents (SETS, head rows)  (PlanPage.tsx:1853-1871)
Opens inline panel under the row; toggled by the ⋯ button.
| Item | What it does | Visible/enabled |
|---|---|---|
| **TAGS** label + chips: the 4 presets in order `push here`, `maintain strength`, `focus on execution`, `push back`, then any custom tags already on the set (storage order) | Tap a chip toggles that tag on THIS set (add via addTag: trims, rejects blank/duplicate; remove via removeTag; empty result stored as null). Active chip accent. | `disabled={isPast}` (always false here since menu isn't rendered on past) |
| Small Copy icon next to each ACTIVE tag chip, aria-label `Apply "{tag}" to all sets`, title `Apply to all sets` | handleApplyTagToAll: writes that tag onto every working head set of the exercise that doesn't already have it (applyTagToAllHeads: heads only, skips warmups, no duplicates, keeps other tags). One mutate per changed row. No apply-ahead offer. | only next to active chips |
| `+ CUSTOM` dashed button | Switches to a text input (placeholder `custom tag`, aria-label `Custom tag`, width 100); commit on blur or Enter via addTag (blank/duplicate -> nothing) | always in menu |
| `DELETE SET` (trash icon, red, aria-label `Delete set`) | closes menu, `handleRemoveSet(head.id)` -> `removeSet.mutate(id)` (optimistic) + apply-ahead offer (removeHeadSet) | NOT shown on a warmup head (warmup deletion is a STRUCTURE-view action). Shown on any other head, including a staged head (stages get removed with... unclear: see Gaps) |
Menu has NO set-kind/stage controls in SETS.

#### 6.4 Stage rows (SETS)  (PlanPage.tsx:1874-1893)
Nested under the head, indented with a dashed left border. Visible when the head has stages.
- Number cell shows `↳` instead of a number.
- Weight cell, `×`, reps cell, RIR stepper — same editors as a head (stage row IS passed isWarmup=false, so RIR shown).
- No ⋯, no kind marker, no tag marker (tags prop not passed -> `undefined`). Blank 28px spacer where the ⋯ would be.
- Deleting a stage is a STRUCTURE-view action (`DELETE STAGE`).

#### 6.5 Warmup rows (SETS)
A head with isWarmup: kind marker line `WARMUP`; no RIR stepper; ⋯ menu has TAGS only (no DELETE SET). Tags marker/menu still available on a warmup head (menu always shows TagsEditor). Note: applyTagToAllHeads skips warmups for the broadcast.

#### 6.6 Removed rows (diff, SETS)  (PlanPage.tsx:1742-1744, WeekDiffMarks.tsx:53)
Working sets the source has but the week doesn't: dim struck-through row after the real rows: number (2-digit) then e.g. `80kg × 8-12  RIR 2` (only parts it had; RIR omitted for warmups). No controls.

#### 6.7 Past (read-only) behaviour in SETS
Weight/reps cells and RIR buttons are disabled; `+` ADD SET hidden; ⋯ replaced by spacer; ApplyAheadBanner hidden; DELOAD pills disabled; page-level actions hidden. Tags editing unreachable (menu hidden).

#### 6.8 Targets / AMRAP summary
- Weight target: per set (head and stage), kg stored, displayed in exercise's resolved unit.
- Rep target: number | range | AMRAP | none (`—`), per set (head and stage).
- AMRAP: entered as the text `AMRAP` in the reps cell; displayed as `AMRAP`; sets RIR to 0 if RIR was empty.
- RIR target: stepper 0..9 or `NO RIR`.

---------------------------------------------------------------------
### 7. Sheets, dialogs, toasts owned by Plan

| Sheet/dialog | Opened by | Content (exact copy) | Visible/conditions |
|---|---|---|---|
| **WeekExercisePickerSheet** `SWAP {EXERCISE NAME}` (title is `SWAP ${name}` with name as stored, or `SWAP EXERCISE` if missing) (WeekExercisePickerSheet.tsx) | per-exercise ⋯ -> `SWAP EXERCISE` (STRUCTURE) | Bottom sheet 82dvh, backdrop tap closes, X button (no aria-label) top right; muscle filter chips `ALL`, `CHEST`,`BACK`,`SHOULDERS`,`BICEPS`,`TRICEPS`,`FOREARMS`,`QUADS`,`HAMSTRINGS`,`GLUTES`,`CALVES`,`CORE`,`OTHER` (tap active chip again -> ALL); list of exercises (name + muscle group uppercase or `OTHER`, plus icon) excluding every exercise already in this day; empty: `NO OTHER EXERCISES` (nothing left at all) or `NONE IN THIS GROUP` (filter yields none). Tap an exercise = pick, no confirm step. | `swapTarget` set; picking runs swapWeekExercise (async), closes sheet first, then records apply-ahead change |
| **WeekExercisePickerSheet** `ADD EXERCISE` | `ADD EXERCISE` button (STRUCTURE) | same sheet | `showAddExerciseSheet`; pick -> addExercise at position = current count, offer raised, sheet closes |
| **Remove-exercise confirm sheet** (bottom sheet, inline in WorkoutDayPanel PlanPage.tsx:1476-1505) | per-exercise ⋯ -> `REMOVE FROM THIS WEEK` (STRUCTURE) | Title `Remove "{name}" from week {n}?` (says `week` even on sequence); body `This deletes its planned sets for this week only. This cannot be undone.`; buttons `CANCEL`, `REMOVE` (red; pending `…`, disabled while removeExercise.isPending); backdrop tap = cancel. Name falls back to `this exercise`. | `confirmRemoveExercise` set. REMOVE runs `removeExercise.mutate`, raises apply-ahead (removeExercise), closes |
| **MakeWeekDefault ConfirmDialog** | section 3.4 | see 3.4 | |
| **MoveSessionSheet** | section 3.7 | see 3.7 | |
| **Toast** (global) | MakeWeekDefault only | `Week {n} is now the default.` etc. | see 3.4 |
Other (STRUCTURE-owned, StructureFields.tsx): not detailed here.

Mutation failure behaviour: add/remove/update mutations restore the cache on error (`onError: setQueryData(prev)`), no toast or message on the Plan screen. useAddSet has no optimistic update (hence the shared disabled state). No offline UI on Plan other than MoveSessionControl and the apply-ahead banner.

---------------------------------------------------------------------
### 8. Diff highlighting (WeekDiffGate / WeekDiffMarks / weekDiff.ts)
"Anything different from the week's source is highlighted." Computed live each render, nothing stored.
- Sources: week 1 (either type): shape = run copy; weights/RIR not compared. Stable, week > 1: shape(sets, structure, reps) = run copy (the default); weights/RIR = last usable week. Week-dependent, week > 1: everything = last usable week of the same workout/slot; none if Settings `NEW WEEK STARTS` (weekStart) is `empty` or no prior usable week. A deload session (weekPlan.isDeload): no comparison at all.
- WeekDiffGate: if the comparison needs the run copy, it waits for the run copy's exercises (and sets) — until then NO highlighting (not wrong highlighting). Empty run copy compared as empty.
- SETS marks (SetRow `marks`): accent text + muted fill on the weight cell, reps cell, RIR stepper that differ; accent set number for a new working head (reps of its stages also marked); removed working sets as struck-through rows (6.6). `data-diff` attributes: changed/added/removed/kind/moved.
- STRUCTURE marks: exercise header band accent for added/moved exercise; added warmup/stage rows accent; a dot (`DiffDot`) on a set's ⋯ when its kind differs (on a past week, dot on the spacer); removed exercises as struck-through name lines after the exercise they followed; removed warmup/stage struck-through rows `WARMUP`/`STAGE` (with `↳` for stage).

---------------------------------------------------------------------
### 9. Priorities screen  /plan/priorities  (PrioritiesEditor.tsx)
View-only list of the active run's program priorities (named "Editor" but nothing writes). Entry: Plan header's `PRIORITIES` row.

Header: back button (ArrowLeft icon, no aria-label): `handleDone` = `navigate(-1)` if history idx > 0 else `navigate('/plan')`. Title = active meso name (or `PRIORITIES` when none); subtitle = program name (when program found).
States:
- Loading (mesos or priority rows loading): spinner.
- Error (mesos or rows errored, and not loading): `COULDN'T LOAD PRIORITIES` / `Check your connection and try again.`
- No active meso (not loading, no error): `NO ACTIVE MESOCYCLE`.
- Loaded: one card per muscle group (MUSCLE_GROUPS order; cards for groups with no entry are skipped). Card = whole-row button toggling expand (chevron up/down). Left: group label (MUSCLE_GROUP_LABELS) and, only when the group has an exception, an uppercase summary line (e.g. "... without ...") when `entry.summary` exists and differs from the lowercase group label. Right: mark label if the group has its own mark (`FOCUS` or `DON'T CARE`, accent text, not a control) + chevron. Expanded: one row per subgroup (dashed left border) with subgroup label and a mark label only if that subgroup has its own stored mark (inherited marks show nothing).
- Expand state is local (all collapsed initially). No edit controls (MarkSelector exists in this folder but is NOT used on Plan or this screen — only in planner StepPriorities).

---------------------------------------------------------------------
### 10. Weekday vs sequence differences
| Aspect | Weekday run | Sequence run |
|---|---|---|
| Wrapper | PlanScreen directly | SequencePlanPage: spinner/error until current cycle known |
| Header pill | `WEEK n` | `CYCLE n` |
| Current week | calendar week from meso.startDate (Mon start) | cycle of next due workout |
| Past | week < calendar week | cycle < current cycle |
| Past banner | `PAST WEEK — READ ONLY` | same text (still says WEEK) |
| Switcher | WorkoutSwitcher (weekday chips `MON`..) | SequenceSlotSwitcher (`SLOT n` chips, `REST DAY` disabled chips) |
| Panel header label | `MONDAY`..`SUNDAY` | `SLOT n` |
| MOVE THIS SESSION | yes (current week only) | no |
| Shared-row note / isShared banner text | yes if workout on 2+ weekdays | never (isShared=false, sharedWeekdays=null) |
| Copy button label | `COPY WEEK` | `COPY LAST CYCLE` |
| Week deload label | `MARK WEEK AS DELOAD` / `UNMARK THIS WEEK` | `MARK CYCLE AS DELOAD` / `UNMARK THIS CYCLE` |
| Make default label | `MAKE THIS WEEK THE NEW DEFAULT`, dialog/toast say week/Week | `... CYCLE ...`, cycle/Cycle |
| COPY THIS WORKOUT | `COPY THIS WORKOUT` | same label; history scoped per slot |
| Remove-exercise confirm | `...from week n?` | still `week n` |
| Apply-ahead reset key / matching | workout + week | workout + week + sequence position |
| Repeated workout | n/a (same workout on 2 weekdays = shared plan) | two slots = two independent plan rows/histories |
| "No schedule" check | any weekday with a workout | any slot with a workout |
| Panel before week row exists | falls back to run copy exercises | same; selectedSlotWeekPlan undefined |

### 11. Past / current / future weeks
- Past (viewWeek < currentWeek): banner `PAST WEEK — READ ONLY`; no COPY WEEK, no week MARK/UNMARK deload, no MAKE DEFAULT; panel: DELOAD pill present but disabled (when weekPlan exists); no ApplyAheadBanner; no COPY THIS WORKOUT; SETS cells/steppers disabled, `+` and ⋯ hidden; STRUCTURE: no ADD EXERCISE, no exercise ⋯, set ⋯ replaced by spacer (dot kept), StructureRoutine receives isPast; MoveSessionControl absent (not current week); SETS/STRUCTURE switch still works; shared-row note still shows.
- Current: pill accent-filled; all actions available; MoveSessionControl (weekday only) available.
- Future (viewWeek > currentWeek): everything editable (isPast false); no MoveSessionControl; pill muted; no upper bound; opening it plans the week (planWeek effect).
- Week 1 (any): no `COPY WEEK`, no `COPY THIS WORKOUT` (need weekNumber > 1); `Previous week` disabled.

### 12. Deload differences
- Session DELOAD on: pill accent-filled with label `DELOAD`; session excluded from MAKE DEFAULT eligibility; diff highlighting turned off for that session.
- Whole week deload (all rows isDeload): week toggle reads UNMARK; MAKE DEFAULT hidden if no non-deload non-empty session remains.
- Deload rules line visible (when rules exist) only with the week-level button (i.e. not past, has schedule).
- Marking when sessions already started: sets left as they are + notice `Already started — sets left as they are` (week-level and session-level, each own notice).
- Apply-ahead skips deload weeks (`SKIPPED (DELOAD)` count).
- Deload edits of set values: no special UI; edits allowed like normal.

### 13. Planning-type differences (`stable` vs `week_dependent`)
| Feature | stable | week_dependent (and undefined) |
|---|---|---|
| COPY WEEK / COPY THIS WORKOUT | never offered | offered under the conditions above |
| MAKE THIS WEEK THE NEW DEFAULT | offered (conditions 3.4) | never |
| Diff shape source (week > 1) | run copy (the default) | last usable week |
| Diff numbers source (week > 1) | last usable week | last usable week |
| Diff with Settings NEW WEEK STARTS = empty | still compared with run copy | no comparison |
| Everything else | same | same |

### 14. Conditions matrix

Legend: Y = shown/enabled, - = not shown, D = shown but disabled, c = conditional (see note).

| Element | Past | Current | Future | Week 1 | Stable | Week-dep | Seq | Weekday | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Header: PRIORITIES row, Programs icon, prev/next | Y | Y | Y | Y (prev D) | Y | Y | Y | Y | requires active meso |
| Past banner | Y | - | - | c | | | Y | Y | isPast only |
| COPY WEEK / LAST CYCLE | - | c | c | - | - | c | c | c | all week plans empty AND a copy source exists |
| MARK/UNMARK week deload | - | Y | Y | Y | Y | Y | Y (CYCLE) | Y | needs scheduled workout |
| Deload rules line | - | c | c | c | c | c | c | c | only if rules on; under week deload button |
| MAKE THIS WEEK DEFAULT | - | c | c | c | c | - | Y (CYCLE) | Y | needs a non-deload non-empty session |
| WorkoutSwitcher | Y | Y | Y | Y | Y | Y | - | Y | |
| SequenceSlotSwitcher | Y | Y | Y | Y | Y | Y | Y | - | rest chips D |
| MOVE THIS SESSION | - | c | - | c | Y | Y | - | Y | not started; online to enable; else text ALREADY STARTED... |
| Shared-row note | Y | Y | Y | Y | Y | Y | - | c | workout on 2+ weekdays |
| Session DELOAD pill | D | Y | Y | Y | Y | Y | Y | Y | needs weekPlan |
| ApplyAheadBanner | - | c | c | c | Y | Y | Y | Y | only after an edit with later planned weeks; APPLY D if offline |
| COPY THIS WORKOUT | - | c | c | - | - | c | c | c | week>1, workout has no exercises, copy source exists |
| SETS/STRUCTURE switch | Y | Y | Y | Y | Y | Y | Y | Y | |
| SETS: `+` ADD SET | - | Y(D while add/remove pending) | same | same | Y | Y | Y | Y | |
| SETS: weight/reps/RIR editors | D | Y | Y | Y | Y | Y | Y | Y | RIR absent on warmups |
| SETS: set ⋯ | - | Y | Y | Y | Y | Y | Y | Y | head rows only; stage rows none |
| ⋯ TAGS / + CUSTOM / apply-to-all | - | Y | Y | Y | Y | Y | Y | Y | |
| ⋯ DELETE SET | - | Y (non-warmup heads) | same | same | Y | Y | Y | Y | |
| Diff highlighting | Y | Y | Y | c (no weights/RIR) | vs default | vs last week | c | c | not on deload sessions; needs source |
| STRUCTURE: exercise ⋯, ADD EXERCISE, set ⋯ | - | Y | Y | Y | Y | Y | Y | Y | |
| NO WORKOUTS SCHEDULED | c | c | c | c | c | c | c | c | no schedule, after load |
| NO EXERCISES IN THIS DAY | c | c | c | c | c | c | c | c | day has zero exercises |
| Spinner | c | c | c | c | c | c | c | c | plansLoading or daysLoading |

### 15. Gaps / uncertainties
- MarkSelector.tsx is in the plan folder but is not used by PlanPage or PrioritiesEditor (only by planner/StepPriorities); nothing to render on Plan.
- StructureFields.tsx contents (ExerciseDesignMenu, SetRestMenu, StructureRoutine, ExerciseMarkers, BlockRestEditor, SupersetLinkToggle) not read; only their mount points listed.
- DELETE SET on a staged head in SETS: code shows it for any non-warmup head; whether the service also removes the head's stages is in weekPlanService.removeSet (not read). Unclear.
- No UI control passes `isWarmup` to onUpdate from this file; the warmup apply-ahead record path exists in handleUpdateSet but is unreachable from visible controls here (warmups are added via ADD WARMUP SETS in STRUCTURE).
- useWeekPlan mutations' exact optimistic/rollback details only skimmed (errors silently roll back; no message).
- Programs read errors after initial load, and week-plan/workout-day read errors, have no visible error UI.
- When weekPlan is missing (before v2_plan_week returns), exercise list comes from the run copy and edit handlers early-return; exact visual of that first instant not verified.
- weekDiff internal field-level matching details (ordinals, moved detection) not fully read; only sources/marks summarized.
- useOnlineStatus gating applies only to MOVE THIS SESSION and APPLY; other writes are not blocked offline in this file.

## 1.2 Plan: STRUCTURE view and ⋯ menus
## Plan screen: STRUCTURE view and everything behind its ⋯ menus

Sources read in full: `src/features/plan/PlanPage.tsx` (lines 1-2338 in detail; 2338-2624 is SETS-view editors: RepTargetEditor/WeightTargetEditor/RirStepper/TagsEditor, grep-checked to contain no STRUCTURE logic), `planMenu.tsx`, `StructureFields.tsx`, `structureFields.ts`, `WeekExercisePickerSheet.tsx`, `warmupInsert.ts`, `planner/designFieldEditors.tsx`. Also read for context: `WeekDiffMarks.tsx`, `WeekDiffGate.tsx`, `weekDiff.ts` header, `ApplyAheadOffer.tsx` banner, `gym/RatingChips.tsx`, `formatRestTime`.

Global facts that apply everywhere below
- No Coach-only gating exists in any of these files (grep for coach/isCoach: none).
- `volumeReadOnly` is NOT used by Plan. Comments state rest/tempo/unit/superset/routine are "never gated by volumeReadOnly". The only read-only gate on this screen is `isPast`.
- `isPast = viewWeek < currentWeek` (PlanPage.tsx:266). `currentWeek` = calendar week from `activeMeso.startDate` (weekStartsOn Monday) for a weekday run; for a sequence run = the current cycle (the cycle containing the next due workout, `useSequenceCurrentCycle`). Future weeks (viewWeek > currentWeek) are editable; "Next week" has no upper bound.
- Dark/accent tokens only; no design opinions recorded here.
- Time format everywhere for rest values: `formatRestTime` => `45s` under 60s, else `1min 32s` (no zero padding; e.g. `1min 0s`). `stageRestDefaultText` uppercases it (`15S`).

---

#### Page shell relevant to STRUCTURE  (PlanPage.tsx:171-808; PlanScreen:229)

Top-level state gates (before the STRUCTURE view can show)
| Element | What it does | Visible when | Lives where |
|---|---|---|---|
| Spinner (22px circle) | Nothing | Active meso exists and programs read not yet answered (`programsRead.data === undefined`, no error) (PlanPage:176-178); sequence run with cycle unknown and not failed (SequencePlanPage:197); `mesosLoading` (514) | full screen |
| `COULDN'T LOAD PLAN` / `Check your connection and try again.` | Error state | programs read errored with no data (177); or sequence cycle read `failed` (197) | full screen, centered |
| `OVERLOAD v2` / `PLAN` / `NO ACTIVE MESOCYCLE` / button `START A PROGRAM →` (navigate `/program`) | Empty state | no meso with `status === 'active'` (516) | full screen |
| Loading spinner (20px) | Nothing | `plansLoading \|\| daysLoading` (707) | in content |
| `NO WORKOUTS SCHEDULED` + link button `Programs →` (navigate `/program`) | Empty state | `!plansLoading && !daysLoading && !hasSchedule` (719); hasSchedule = `hasScheduledWorkout({scheduleType, schedule, workoutDays, sequenceItems})` | in content |
| Header: meso name uppercased + `PRIORITIES` + chevron (navigate `/plan/priorities`) | | always (active meso) | header |
| `PLAN` h1; icon button aria `Programs` (CalendarDays; navigate `/program`); `Previous week` (disabled when viewWeek<=1); label `WEEK n` or `CYCLE n` (sequence); `Next week` | | always | header |
| Week label chip fill | accent fill when `viewWeek === currentWeek`; else overlay, text dim if isPast else muted | | header |
| `PAST WEEK — READ ONLY` banner | | `isPast` | top of content |
| Page-level actions above both views (COPY WEEK / COPY LAST CYCLE, MARK WEEK AS DELOAD etc, MakeWeekDefault) | out of scope (see other inventory) but they sit above the SETS/STRUCTURE bar | | content |

Per-panel (WorkoutDayPanel, PlanPage:851) elements above the view bar (context)
| Element | Notes |
|---|---|
| Header label: weekday `MONDAY`..`SUNDAY` (weekday run) or `SLOT n` (sequence, n = position+1) and workout name | |
| `DELOAD` pill (aria `Mark this session as deload` / `Unmark this session as deload`) | rendered when `weekPlan` exists; `disabled` when `isPast` |
| `Marks Mon, Tue — they share one plan.` | `weekPlan && sharedWeekdays?.length>0` (weekday only; sequence passes null) |
| `Already started — sets left as they are` (deloadNotice) | after a session deload toggle returns `alreadyStarted` |
| ApplyAheadBanner | `!isPast`; see "Apply-ahead banner" below |
| `COPY THIS WORKOUT` / `COPYING…` | `!isPast && weekNumber>1 && weekPlan.exercises.length===0 && canCopyFromHistory` (964); canCopyFromHistory false for `planningType==='stable'` |
| SegmentBar `SETS` \| `STRUCTURE` | always in the panel; `view` state is page-level (`planView`, default `'sets'`, not persisted, survives week/workout switch) |

---

#### SETS / STRUCTURE switch  (SegmentBar, PlanPage:1516)
- Two buttons labelled `SETS`, `STRUCTURE`; active one accent-filled. Calls `onViewChange`. Switching remounts every ExerciseSection (key `${pe.id}:${view}`), so open ⋯ menus and half-typed cells reset.
- Always shown regardless of isPast / planning type.

---

#### STRUCTURE view body  (WorkoutDayPanel render, PlanPage:1405-1472)

Order top to bottom:
1. Warmup routine card (`StructureRoutine`) — only `view==='structure'`.
2. Exercise card (rounded bordered box) containing either the empty message or the exercise list.
3. `ADD EXERCISE` dashed button.
4. Sheets (swap picker, add picker, remove confirm).

| Control / text | What it does | Visible when | Lives where |
|---|---|---|---|
| `NO EXERCISES IN THIS DAY` | empty state | `programExercises.length === 0` (programExercises = `weekPlan.exercises` if a week plan exists, else the run copy's exercises via `useProgramExercises`) (1412) | inside card |
| `ADD EXERCISE` (Plus icon, dashed full-width) | `setShowAddExerciseSheet(true)` | `view==='structure' && !isPast && weekPlan` (1445). Not on SETS view. Not on past week. Absent while no week plan row exists (first instant of loading). Both planning types | below card |
| Exercise list | one ExerciseSection per `programExercises` entry, plus dim "removed" lines (see diff) | any | in card |

Provider note: `StructureFieldsProvider` (StructureFields.tsx:97) is mounted only in STRUCTURE and only when the card has exercises; it calls the run-wide hooks (rest/tempo/unit/link toggle/block rests/program sets/set rest/stage rest).

---

#### Warmup routine card  (StructureRoutine, StructureFields.tsx:290; WarmupRoutineEditor variant 'menu' designFieldEditors.tsx:331)
Card `role=group aria-label="Warmup routine"`, at top of STRUCTURE view.

| Control | What it does | Visible when | Lives where |
|---|---|---|---|
| `WARMUP ROUTINE` heading + `EVERY WEEK` label (accent) | static | card shown | card header |
| Card as a whole | | hidden entirely (returns null) when `isPast && items.length === 0`. Shown on a past week only if the routine has items (list only). Shown on current/future weeks always (even empty) | |
| Spinner (14px) | | while `useWarmupRoutineItems` isLoading | in card |
| Item rows: index `01`,`02`… + item text | static text on past week; otherwise tap text (button) -> inline input (aria `Warmup item text`) ; commit on blur/Enter; blank or unchanged = no write (editor just closes); changed -> `updateItem({id, body})` | rows exist (`!isLoading && items.length>0`) | card |
| ⋯ per item (aria `Options for warmup item n`) | toggles item menu | `!readOnly` (not past) | right of each item |
| Item menu `MOVE UP` (ChevronUp; aria `Move warmup item n up`) | `moveWarmupItem`, writes optimistic order into query cache `['v2_workoutWarmupItems', workoutDayId]`, reorder mutation; closes menu | menu open; disabled when index 0 | inline panel under item |
| `MOVE DOWN` (aria `Move warmup item n down`) | same | disabled when last | panel |
| `REMOVE` (danger, Trash2; aria `Remove warmup item n`) | closes menu, opens confirm sheet | always in menu | panel |
| Empty routine text | NONE: in 'menu' variant "NO WARMUP ITEMS YET" is NOT shown (only `variant==='rows'` shows it) | | |
| `ADD ITEM` (Plus, dashed, full-width) | opens add form | `!readOnly && !showAdd` | card bottom |
| Add form: input placeholder `e.g. 5 min easy bike` (aria `New warmup item`, autofocus), button `ADD` (disabled while `addItem.isPending`) | submit: trims; blank = refused (no write); else `addItem.mutateAsync({body, position: items.length})`, clears and closes. Input blur with empty text closes the form | `!readOnly && showAdd` | card bottom |
| Confirm sheet (bottom Sheet, zIndex 50, X close aria `Close`, backdrop-tap closes) | title `Remove this item?`; body `"<item text>" — this cannot be undone.`; buttons `CANCEL`, `REMOVE` (shows `…` and disabled while `removeItem.isPending`); REMOVE calls `removeItem.mutate(id)` and closes | after item REMOVE | overlay |
- Not gated by volumeReadOnly or planning type. Routine is workout-level and run-wide.

---

#### Exercise section  (ExerciseSection, PlanPage:1596)
One per exercise; separated by a subtle bottom border except the last entry.

Header row
| Element | What it does | Visible when | Lives where |
|---|---|---|---|
| Exercise name (`pe.exercise?.name ?? '—'`) | static | always | header |
| Muscle group uppercased | static | if present | header sub-line |
| `· SUPERSET` (accent) | marker | exercise is in a unit (contiguous same-block run) of size >1 (`inSuperset`), in both views | header sub-line |
| Header highlight band + accent name | diff mark | STRUCTURE only: `diff.added` -> 'added' else `diff.moved` -> 'moved' (1624); band `data-diff` = added/moved | header |
| Exercise markers (chips) | static chips from `exerciseMarkers(pe, globalUnit)` | STRUCTURE only; none rendered if none set. Chips, in order: `REST <time>` (restSeconds != null), `REST AFTER <time>` (restAfterSeconds != null), `TEMPO <tempo>` (tempo truthy), `UNIT KG`/`UNIT LBS` (pe.weightUnit != null AND differs from global Settings unit) | under name |
| ⋯ button (aria `<name> options`, `Ellipsis`) | toggles exercise menu; no diff dot here | `view==='structure' && !isPast` (header actions block is `!isPast`; in SETS that slot holds the `+` ADD SET button instead) | right of header |
| (Past week) | no ⋯, no controls at all; markers and name only | `isPast` | |

Exercise ⋯ menu panel (`MENU_PANEL_STYLE`, inline under header; `view==='structure' && !isPast && menuOpen`). Items in order. Every action (`act`) closes the menu EXCEPT the run-wide steppers/tempo/unit, which do not close it.
| Item (exact label / aria) | What it does | Visible / disabled when |
|---|---|---|
| `SWAP EXERCISE` (ArrowLeftRight; aria `Swap <name>`) | closes menu; `setSwapTarget(pe)` -> opens swap picker sheet | always in menu |
| `MOVE UP` (aria `Move up`) | closes menu; `handleMoveExercise(idx,'up')`; moves the whole superset unit as one block (moveUnit); records apply-ahead `reorderExercise` | shown only if `showMoveControls` = this exercise is the FIRST member of its unit (plain exercise = own unit). Disabled when `unitIndex === 0` |
| `MOVE DOWN` (aria `Move down`) | same, 'down' | same visibility; disabled when `unitIndex === exerciseUnits.length-1` |
| `ADD WARMUP SETS` (Plus; aria `Add warmup sets`) | closes menu; `addWarmup.mutate({workoutDayId, weekPlanId, programExerciseId})` adds ONE warmup head above the first working set (warmupInsert.ts: insertAt = set_number of first non-warmup head; else last head+1; else 1; rows with setNumber >= insertAt shift +1, highest first; stages share head set number so move with it); records apply-ahead `addWarmupSet` | disabled while `addSet.isPending \|\| removeSet.isPending \|\| addWarmup.isPending` (one flag for the whole workout day) |
| Run-wide block (`ExerciseDesignMenu`, only if `structure` present = always in STRUCTURE) | see next two tables | |
| `REMOVE FROM THIS WEEK` (danger, Trash2; aria `Remove <name> from this week`) | closes menu; opens remove confirm sheet | always |

Run-wide group 1: `role=group aria-label="Every week"` (top rule line above it)
| Control | What it does | Notes |
|---|---|---|
| `EVERY WEEK` label (accent, 8px) | static | |
| `REST` stepper (aria `Less rest for <name>` / `More rest for <name>`) | `updateRest({id, changes:{restSeconds}})` on the exercise's program-exercise row | value `pe.restSeconds ?? null`; null shows `GLOBAL`; else formatted time. Step 15s. `−` disabled when null; at value-15 <= 0 writes null (clears). `+` from null starts 15s, capped at 600s (10min). Never disabled otherwise (`disabled={false}`) |
| `REST AFTER` stepper (aria `Less rest after for <name>` / `More rest after for <name>`) | `restAfterSeconds` | null shows `NONE`. Same stepping |
| `TEMPO` field | button showing tempo or `—`; tap -> input (placeholder `3-1-1-0`, aria `Tempo`, width 96); commit on blur/Enter. Blank -> writes null (only if previously set). Invalid (normaliseTempo null) -> stays in edit mode, border red, error `Use 4 fields, e.g. 3-1-1-0 (X allowed)`, writes nothing. Valid and different -> `updateTempo` with normalised value | |

Run-wide group 2: `role=group aria-label="Weight unit"` (top rule line)
| Control | What it does | Notes |
|---|---|---|
| `UNIT` label | static (NO "EVERY WEEK" label here) | |
| Chips `INHERIT (KG)` or `INHERIT (LBS)` (global unit uppercased), `KG`, `LBS` | `updateUnit({id, weightUnit})`; INHERIT writes null; active chip = equals `pe.weightUnit` (null = INHERIT) | Editable on both planning types (including week-dependent, where the old program tab disabled it) |

- All run-wide writes go to the exercise's OWN program-exercise row (run copy row, or the `week_only` row for an exercise added/swapped in during a week). They never touch the week plan row. No apply-ahead offer follows any of them (code comment: a run-wide change already reaches every week). Not diff-compared (rest, tempo, grouping, routine, unit never compared).
- Nothing shows an error or toast on failure for these mutations (no onError UI found in StructureFields; unclear: error handling of the usePrograms mutations beyond this was not read).

Set rows block (below header): rendered if `groups.length > 0 || removedHeads.length > 0`. In STRUCTURE: one `StructureSetGroup` per head (sorted by head.setNumber, display number `idx+1`, zero padded to 2 digits), then removed-warmup lines.

Block-level controls under the sets
| Control | What it does | Visible when |
|---|---|---|
| Block rest editor (`BlockRestEditor everyWeek`): label `SUPERSET`, `EVERY WEEK`, stepper `WITHIN ROUND` (aria `Less rest within round` / `More rest within round`; null text `NO TIMER`), stepper `AFTER ROUND` (aria `Less rest after round`/`More rest after round`; null text `PER EXERCISE`) | `updateBlockRest({id: blockId, changes:{restWithinRoundSeconds \| restAfterRoundSeconds}})`; same 15s step, null at floor, cap 600s | `!isPast && exercise is the LAST member of its unit && unit.length >= 2 && pe.supersetBlockId != null && blockRests !== undefined` (block rests query loaded; waits so defaults are not written over unseen values) (StructureFields:143-150). Missing block row reads as null/null |
| Link toggle (`SupersetLinkToggle` full-width, Link2 icon, suffix `EVERY WEEK`): label `LINK AS SUPERSET` (unlinked, dashed border) or `SUPERSET — TAP TO UNLINK` (linked, accent border/fill) | `toggleLink.mutate(planLinkToggle(programExercises, index))`; operates on the gap between this exercise and the NEXT one in THIS week's order (so any two neighbours; can split a 3+ block mid-way) | `!isPast && index < programExercises.length - 1` (not after the last exercise). `linked = isLinkedGap(programExercises, index)`. Disabled (opacity .6, not-allowed) while `toggleLink.isPending` |

Block rest and link toggle both sit at the bottom of the exercise section (rest editor first, then toggle), outside the ⋯.

---

#### Set rows in STRUCTURE  (StructureSetGroup PlanPage:1914; StructureSetRow:2039; SetMarkers:2094)

Row layout: number (`01`..; `↳` on a stage), spacer, ⋯ (or past spacer). No numbers (weight/reps/RIR/tags are SETS-only). Under the row a marker line (indented) shows: kind label (accent text) and chips.

| Element | What it does | Visible when |
|---|---|---|
| Set number `NN` (or `↳` for stage) | static; accent + muted band when `added` (new warmup head or new stage vs source) | always |
| Kind marker text | `WARMUP` if head.isWarmup; else if head has stages: `STAGE_KIND_LABELS[resolveStageKind(head.stageKind)]` = `DROPSET` / `REST-PAUSE` / `MYO-REPS` / `CLUSTER` (null/legacy kind reads as DROPSET); a plain working set shows no kind text. Never on a stage row | |
| Set rest chips | `setRestMarkers`: `REST <time>` if the set's own program set has restSeconds; and, only for a staged working head, `STAGE REST <time>` if stageRestSeconds set. Stage rows: only `REST <time>`. Warmup head: `REST` only (isStagedHead false) | only if the set has an own program set (see rule below) |
| ⋯ (aria `Options for set n` / `Options for stage`) | toggles row menu | `!isPast`. On `isPast` a 28px spacer holds the place (no ⋯) |
| Diff dot on ⋯ (or on the spacer on past week) | small accent dot | `kindChanged` = headDiff.kind (head kind differs from source counterpart: warmup/working/staged/stage kind) |
| Menu panel | inline under row | `!isPast && menuOpen` |

Own-program-set rule (`ownProgramSet`, structureFields.ts:106): a set shows REST / STAGE REST (marker and stepper) only if `set.programSetId` resolves to a program set whose `programExerciseId === set.programExerciseId`. Sets with no such program set follow exercise rest then global rest and show NO set REST / STAGE REST. These are: sets added in a week via ADD SET (SETS view), every set of an exercise added in a week, sets of a swapped-in exercise (their ids still point at the replaced row's program sets, refused by the mismatch check), and warmup sets added via ADD WARMUP SETS / stages added via ADD STAGE (they carry no program_set_id, per the comment on addSet; addWarmup/addStage not explicitly stated: unclear for those two, same expected result).

Menu contents by row type (menu is closed by `close()` only where noted)

Working head (not warmup):
| Item | What it does | Visible / disabled |
|---|---|---|
| Set rest group (`SetRestMenu`, `role=group aria-label="Every week"`): `EVERY WEEK` label; stepper `REST` (aria `Less rest of set n for <exercise>` / `More rest of set n for <exercise>`, null text `CHAIN`); on a staged head also stepper `STAGE REST` (aria `Less stage rest of set n for <exercise>` / `More ...`), null text = kind default: `NO TIMER` for dropset, `15S` for rest-pause, myo-reps, cluster | writes program set `restSeconds` / `stageRestSeconds` via `updateSetRest` / `updateStageRest` (only if programSet exists) | whole group rendered only when the set has an own program set (else nothing). STAGE REST only when `isStaged` (head has >=1 stage). Steppers don't close the menu |
| `STAGE KIND` chips (RatingChips, label `STAGE KIND`): `DROPSET`, `REST-PAUSE`, `MYO-REPS`, `CLUSTER` | tap a chip -> `onUpdate(head.id, {stageKind: kind})`; tapping the already-active chip sends `null` (clears; reads back as DROPSET since null resolves to dropset, so the highlighted chip stays DROPSET). Records apply-ahead `stageKind` | only when `isStaged`. Active chip = `resolveStageKind(head.stageKind)`. Chips are 44px high, horizontal scroll. Does not close menu |
| `ADD STAGE` (Plus; aria `Add stage`) | `onAddStage()` -> `handleAddStage`: requires `weekPlan`; `addStage.mutate({weekPlanId, programExerciseId, parentId: head.id, setNumber: head.setNumber, stageIndex: nextStageIndex(group)})` (max stageIndex + 1); head's stage_kind is left unchanged (null reads as dropset); records apply-ahead `addStage` with headOrdinal. NOTE: does NOT call `close()` so the menu stays open after adding | always on a working head; NOT disabled by addOrRemovePending (not passed). No `disabled` prop |
There is no DELETE SET on a working head in STRUCTURE (it is in the SETS view's ⋯).

Warmup head (isWarmup):
| Item | What it does | Visible |
|---|---|---|
| Set rest group (`SetRestMenu`, no STAGE REST) | as above, REST only | only if own program set |
| `DELETE SET` (danger, Trash2; aria `Delete set`) | `close()` then `onRemoveHead()` -> `handleRemoveSet(headId)`: `removeSet.mutate(id)` (optimistic removal), records apply-ahead `removeHeadSet` with headOrdinal. No confirm dialog | warmup heads only; not disabled. (No ADD STAGE / STAGE KIND on a warmup: a warmup is never staged) |

Stage row (nested under head, dashed left border nest):
| Item | What it does | Visible |
|---|---|---|
| Set rest group (`REST` only; aria `Less rest of stage k of set n for <exercise>`; k = stage position 1-based) | as above | only if the stage's own program set exists |
| `DELETE STAGE` (danger, Trash2; aria `Delete stage`) | `close()` then `onRemoveStage(stage.id)` -> `handleRemoveSet`; records apply-ahead `removeStage` with setPosition. No confirm | always on a stage |
- If a staged head loses all its stages, its kind label and STAGE KIND/STAGE REST disappear (isStaged false). Stage kind is stored on the head.
- A warmup that is the only set, or no sets at all: ExerciseSection set block is omitted when `groups.length===0 && removedHeads.length===0`; there is then no per-exercise "add set" in STRUCTURE (adding working sets is the SETS view's `+`, aria `Add set to <name>`). Warmups are added only via exercise ⋯ ADD WARMUP SETS.

Removed-vs-source lines (week diff, STRUCTURE only)
| Element | Visible when |
|---|---|
| `RemovedExerciseLine`: struck-through dim exercise name, drawn right after the exercise it followed in the source (swap: old above new), or at top | `diff.removedExercises` entries (anchor `after`) |
| `RemovedStructureRow` in set block: `NN` + struck `WARMUP` (head) or `↳` + struck `STAGE` | warmup heads / stages the source has and the week doesn't; stages sorted among current stages by stageIndex. In STRUCTURE only warmup removed heads shown; SETS shows working removed heads |
| Header band: exercise added or moved | see above |
Diff source rules (weekDiff.ts:16-45, chooseDiffSources): no diff at all (nothing highlighted) when the session is deload; or week-dependent after week 1 with Settings NEW WEEK STARTS = "empty" or no usable last week. Week 1 (either type) compares with the run's copy. Stable after week 1: shape vs run copy (default). Week-dependent after week 1: shape vs last usable week (last planned normal non-empty occurrence of the same workout/slot). Compared in STRUCTURE: exercises (added, removed, moved), warmup sets and stages added/removed, set kind. Never compared: tags, rest, tempo, superset grouping, routine, unit. While the run copy (or its program sets) is still loading, diff = null (nothing highlighted).

---

#### Swap picker sheet / Add picker sheet  (WeekExercisePickerSheet.tsx)
One component, two titles. Bottom sheet, full-screen dim backdrop (tap backdrop closes), 82dvh tall, zIndex 60. Exclusive: swapTarget and showAddExerciseSheet are separate states, opened from different actions.
| Element | What it does | Visible when |
|---|---|---|
| Title: `SWAP <EXERCISE NAME>` (`SWAP ${swapTarget.exercise?.name ?? 'EXERCISE'}`; name not uppercased in code, rendered as typed, title style is display font) or `ADD EXERCISE` | static | swap: `swapTarget != null`; add: `showAddExerciseSheet` |
| X close button (no aria-label) | `onClose` | always |
| Filter chips: `ALL`, then `CHEST BACK SHOULDERS BICEPS TRICEPS FOREARMS QUADS HAMSTRINGS GLUTES CALVES CORE OTHER` | single-select muscle filter; tapping the active group chip returns to ALL; horizontal scroll | always |
| List rows: exercise name + muscle group uppercased (`OTHER` if none) + Plus icon | tap = immediate pick (`onPick`), no confirm step | `useExercises(false)` list (false = presumably excludes archived/hidden; unclear: not read) minus `excludeExerciseIds` |
| Empty text `NO OTHER EXERCISES` | | filtered empty and no available exercises at all |
| Empty text `NONE IN THIS GROUP` | | filtered empty but some exist (filter active) |
- Excluded ids in both cases: the exerciseIds of every exercise currently in this week's list (so the exercise being swapped is also excluded, and no duplicates can be added).
- No loading state shown for the exercise list (default `[]` while loading shows `NO OTHER EXERCISES`). Mutation is not performed by the sheet.

Swap flow (`handlePickReplacement`, PlanPage:1058): needs `weekPlan && swapTarget`; closes sheet immediately (`setSwapTarget(null)`); `await swapExercise.mutateAsync({weekPlanId, programExerciseId: target.id, replacementExerciseId})` creates a new `week_only` program-exercise row; then offers apply-ahead `swapExercise` change (with `newExerciseId`, `resultingProgramExerciseId`). No confirm dialog. A swapped-in exercise has no own program sets -> no set REST/STAGE REST on its sets (see rule), but exercise-level REST/REST AFTER/TEMPO/UNIT still work (on its own row).

Add flow (`handlePickAdd`, 1079): needs `weekPlan`; `addExercise.mutate({weekPlanId, workoutDayId, exerciseId, position: programExercises.length})` (appended at end); records apply-ahead `addExercise`; closes sheet. No confirm.

---

#### Remove-from-week confirm sheet  (PlanPage:1476)
- Opens from exercise ⋯ `REMOVE FROM THIS WEEK`. Bottom sheet (zIndex 50), backdrop tap cancels. No X button.
- Title: `Remove "<name>" from week <n>?` (literal word `week` and the week number even on sequence runs; name falls back to `this exercise`).
- Body: `This deletes its planned sets for this week only. This cannot be undone.`
- Buttons: `CANCEL`; `REMOVE` (shows `…` and disabled while `removeExercise.isPending`).
- REMOVE: `removeExercise.mutate({weekPlanId, programExerciseId})`, records apply-ahead `removeExercise`, closes sheet. Requires `weekPlan` and the exercise still found.

---

#### Apply-ahead banner  (ApplyAheadBanner, shown above the view bar; `!isPast` only)
Triggered by STRUCTURE-view edits: ADD WARMUP SETS (`addWarmupSet`), ADD STAGE (`addStage`), warmup DELETE SET (`removeHeadSet`), DELETE STAGE (`removeStage`), STAGE KIND (`stageKind`), SWAP, MOVE UP/DOWN (`reorderExercise`), ADD EXERCISE, REMOVE FROM THIS WEEK. Offer only appears when later planned weeks of the same workout/slot exist (`laterPlannedWeeks`). NOT triggered by REST/REST AFTER/TEMPO/UNIT/link toggles/block rests/set rests/routine edits (run-wide).
- Offer text: `APPLY THIS CHANGE TO n PLANNED WEEK(S) AHEAD?` (`WEEK`/`WEEKS`); if shared workout: `This workout is scheduled on more than one weekday — this affects every one of those days.`; offline: `OFFLINE — CONNECT TO APPLY`.
- Buttons `APPLY` (`APPLYING…`; disabled when pending or offline), dismiss X (aria `Dismiss`).
- Outcome text: `APPLIED TO a OF t PLANNED WEEK(S)` + optional ` — n SKIPPED (DELOAD)` + ` — n SKIPPED (ALREADY DIFFERENT)` + ` — STOPPED: <ERROR UPPERCASED>`; error default `Could not apply the change.`
- State resets per workout/week (and slot on sequence runs).
- Detail beyond these strings belongs to the other inventory; not read in full.

---

#### Conditions matrix (STRUCTURE view)

| Element | Past week (isPast) | Current / future week | Deload session | Stable | Week-dependent | Sequence run |
|---|---|---|---|---|---|---|
| SETS/STRUCTURE bar | shown | shown | shown | shown | shown | shown |
| Warmup routine card | only if items exist; list read-only, no ⋯, no ADD ITEM | always (empty shows just ADD ITEM) | same | same | same | same |
| Exercise markers | shown | shown | shown | | | |
| Exercise ⋯ | hidden | shown | shown (no deload gate) | shown | shown | shown |
| Exercise ⋯ items (swap, move, warmups, run-wide, remove) | n/a | all | all | all (no planning-type gate; unit editable on both) | all | all |
| Link toggle / block rests | hidden | shown by rules above | | | | |
| Set ⋯ | hidden (spacer; diff dot only) | shown | | | | |
| ADD EXERCISE | hidden | shown if weekPlan | | | | |
| Week diff highlights | computed too (isPast not a gate; deload is) | | none (deload = no source) | week1: run copy; later: shape vs run copy | week1: run copy; later: last week; none if NEW WEEK STARTS=empty or no last week | per-slot history |
| Apply-ahead banner | hidden | shown if offer | | | | |
| Labels | | | | | | `CYCLE n` instead of `WEEK n`; `SLOT n` header; remove-confirm still says "week n" |
| COPY THIS WORKOUT | hidden | | | never (canCopyFromHistory false) | when empty & source exists | per slot |
Deload: nothing in STRUCTURE is disabled for deload weeks; the only deload effect is that no week diff is shown. Offline: no STRUCTURE control checks online status except APPLY in the banner (unclear whether mutations queue offline: not in these files).

"EVERY WEEK" label placements (run-wide marker): warmup routine card header; exercise ⋯ group (REST, REST AFTER, TEMPO) — one label for the group; set ⋯ group (REST/STAGE REST); block rest editor; link toggle suffix. NOT on: UNIT group, SWAP/MOVE/ADD WARMUP/REMOVE/ADD STAGE/STAGE KIND/DELETE (those are this-week edits).

---

#### Gaps/uncertainties
- PlanPage.tsx 2338-2624 (SETS-view cell editors) only grep-checked for STRUCTURE logic; none found.
- `useExercises(false)` argument meaning not verified; picker has no loading/error copy.
- Error/toast handling for run-wide mutations (rest/tempo/unit/link/block rest/set rest/routine) not shown in these files; `useWeekPlan.ts` mutations use `onError` that only restore cache (lines 164, 217, 357, 405), no user-visible message found; line 643 `onError` not inspected.
- Whether sets created by ADD WARMUP SETS / ADD STAGE carry a program_set_id (hence whether they show set REST) was not verified in weekPlanService; only addSet is documented as writing none.
- `MOVE UP/DOWN` hidden for non-first members of a superset (move controls only on first member); there is no per-member move.
- RatingChips tap-active-to-clear: STAGE KIND clear sends `stageKind: null`, which displays as DROPSET.
- Offline behaviour of mutations in STRUCTURE unclear.

## 1.3 Planner and Programs page
## Planner (/program/:id) and Programs page (/program) inventory

Sources read in full: planner/PlannerPage.tsx, StepPriorities.tsx, StepExercises.tsx, StepVolume.tsx, designFieldEditors.tsx; programs/ProgramsPage.tsx, ExercisePicker.tsx, hasSchedule.ts, useProgramHasSchedule.ts; plan/MarkSelector.tsx, plan/planMenu.tsx (only used in the `menu` variant of the warmup editor, which the planner does NOT use); gym/RatingChips.tsx; settings/DeloadRulesEditor.tsx; label tables in lib/plannerVocabulary.ts, exerciseTags.ts, priorityMarks.ts.

Routes (App.tsx:116,120): `/program` = ProgramsPage; `/program/:programId` = PlannerPage; `/meso/:mesocycleId/priorities` = MesoPrioritiesPage (not inventoried). No Coach-only gating exists in any file below. No online/offline conditions appear in these components (mutations use `networkMode: 'always'` in usePlanner hooks; unclear what offline does beyond that).

Global note: there are NO "next"/"continue"/"back to step" buttons. No ⋯ menus exist in the planner except the `menu` warmup variant, which is not rendered here. Every edit writes immediately through its own mutation (no draft). There is no review/finish step.

---

## PART 1: PLANNER

#### PlannerPage (planner/PlannerPage.tsx:50)

Top-level states (checked in this order):

| State | Copy / render | Condition |
|---|---|---|
| Loading | Centered spinner (24px) | `usePrograms()` isLoading (:88) |
| Not found | `PROGRAM NOT FOUND` + button `← Back to programs` (navigate `/program`) | no program with id `programId` in `usePrograms()` data (:96) |
| Run's copy refused | `THIS PROGRAM IS A RUN'S COPY`, then `It can't be opened in the planner. Edit its weeks in Plan.`, then button `← Back to programs` (navigate `/program`). No steps, no header, no editor. | `program.kind ?? 'saved'` is not `'saved'` (:60,115) |
| Normal | header + step switcher + step content + SAVE/START bar (+ G14 sheet) | otherwise |

Layout (normal): header, step switcher, scrollable content, fixed bottom bar. G14 prompt overlays.

**Header**

| Control | What it does | Visible when | Where |
|---|---|---|---|
| Back arrow icon button (ArrowLeft, aria-label `Back to programs`) | navigate `/program` | always (normal state) | header, left |
| Program name (tappable text, ellipsized) | sets edit mode: `nameValue = program.name`, shows input | when not editing | header |
| Name input (autofocus via ref) | Enter blurs; blur saves: trimmed, if non-empty and different from current -> `useUpdateProgramName({id,name})`; empty or unchanged -> just closes (no write, no error) | editingName true | header |

**Step switcher** (segmented control, 3 buttons, always visible, any step reachable at any time, no gating/validation; initial step is `priorities`; step not persisted/not in URL):
- `1 · PRIORITIES`
- `2 · EXERCISES`
- `3 · VOLUME`
Active = accent fill. Only one step rendered at a time (state resets of child components when switching: e.g., expanded priority groups, open sheets unmount).

**Content area**: scrolls; renders `StepPriorities` / `StepExercises` (props `volumeReadOnly={false}`) / `StepVolume` (`volumeReadOnly={false}`, `canChangePlanningType`). Since volumeReadOnly is always false and canChangePlanningType always true in the planner, every volumeReadOnly-gated branch below is the "editable" branch; the read-only branches are dead code here (still documented where relevant).

**Bottom bar** (visible from any step)

| Control | What it does | Visible when | Disabled when |
|---|---|---|---|
| `SAVE` | navigate `/program` (writes nothing; edits were already saved) | always | never |
| `START` (shows `…` while pending) | `useStartRun({name: program.name, programId})`; success -> navigate `/plan`; failure -> toast with error message or `Could not start this program` | always | `startRun.isPending` OR `hasSchedule !== true` (hasSchedule is null while workouts, and for a sequence program its sequence items, are still loading) |
| Reason line `Schedule at least one workout to start` (small mono, centered, under buttons) | static text (NO_SCHEDULE_START_REASON) | only `hasSchedule === false` (known no schedule). Not shown while unknown (null). | n/a |

`hasSchedule` rule (programs/hasSchedule.ts): scheduleType (default `weekday`) `sequence` -> true iff some sequence item has a non-null workoutDayId that exists in the program's workouts; `weekday` -> true iff some weekday in `schedule` maps to an existing workout. Stale data for the other mode is ignored (a sequence program with leftover weekday map is not startable).

**G14 shared-workout prompt** (PlannerPage.tsx:237, `G14Prompt` :269) - bottom sheet, z 60.
- Appears when: `detectSharedWeekdayWorkouts(program.schedule)` finds at least one workout assigned to 2 or more weekdays AND not dismissed this visit (`g14Dismissed` false). Detected from `program.schedule` regardless of schedule type (a sequence program with leftover weekday map would also trigger it - unclear whether schedule is '{}' in practice for sequence programs; code does not check scheduleType). Not persisted: reopening the program shows it again after "keep as is".
- First view:
  - AlertTriangle icon; title `One workout, several weekdays`; body `This program plans the same session for more than one weekday — a change there affects every one of those days.`
  - X icon button (aria-label `Dismiss`) top right -> same as KEEP AS IS (dismiss for this visit, no writes). Backdrop tap also dismisses (onKeepAsIs).
  - One card per shared group: workout name (looked up in workoutDays, fallback `This workout`) and weekdays joined with ` · ` using full names (Monday ... Sunday).
  - Buttons: `KEEP AS IS` (dismiss) | `GIVE EACH DAY ITS OWN WORKOUT` (switches to confirm view).
- Confirm view (`confirming` true):
  - Title `Give each weekday its own workout?`; the per-group cards and the first-view body are hidden.
  - Body: `This creates {N} new workout{s} — a copy of each shared one for every extra weekday — and points those weekdays at the copy instead. The original keeps its first weekday. This cannot be undone.` (N = sum over groups of weekdays.length - 1; plural 's' unless N === 1)
  - Buttons: `CANCEL` (back to first view) | `CONFIRM` (shows `…` and disabled while split mutation pending). CONFIRM -> `useSplitSharedWeekdayWorkouts` mutateAsync; success -> dismiss; failure -> toast error message or `Could not split the schedule` (sheet stays open).
- Backdrop tap and X in the confirm view call onKeepAsIs (dismiss entirely, not just back).

---

#### Step 1 - PRIORITIES (planner/StepPriorities.tsx:22)

Purpose: set per-muscle-group and per-subgroup priority marks on this saved program (`useProgramPriorities(programId)` / `useSetPriorityMark`). Skippable; nothing required.

| Element | Detail | Visible when |
|---|---|---|
| Loading | centered spinner | `isLoading` |
| Error | `COULDN'T LOAD PRIORITIES` (error colour) + `Check your connection and try again.` (no retry button) | `isError` |
| Static line | `OPTIONAL — SKIP IF YOU DON'T NEED IT` | loaded |
| One card per muscle group in MUSCLE_GROUPS order (only if a matching entry exists in `buildGroupMarkEntries(rows)`; otherwise the group is silently skipped): `CHEST, BACK, SHOULDERS, BICEPS, TRICEPS, FOREARMS, QUADS, HAMSTRINGS, GLUTES, CALVES, CORE, OTHER` | header button (whole title row) toggles expand/collapse; ChevronDown when collapsed / ChevronUp when expanded | loaded |
| Exception summary (small uppercase line under group name) | `entry.summary.toUpperCase()`, only when summary is non-empty and differs from the lowercased group label. Exact summary strings come from priorityMarks.ts (not read). | `hasException` |
| Group mark selector (MarkSelector) | two chips: `FOCUS`, `DON'T CARE`; tapping the active chip clears it to null (unset = "left normal", no third chip); tapping other sets it. Calls `setMark.mutate({tagType:'muscle_group', tagValue, mark})`. Chips 44px high. Always visible (collapsed or expanded). Disabled (opacity .5) while any setMark mutation is pending. | each group card |
| Expanded section (separated by top border) | list of subgroups of the group, each with: subgroup label (uppercase from MUSCLE_SUBGROUP_LABELS, e.g. `UPPER CHEST`, `LATS`, `FRONT DELT`...), its own MarkSelector (`muscle_subgroup`), and a line `INHERITED: FOCUS` / `INHERITED: DON'T CARE` when subgroup's own mark is null but an effective (inherited from group) mark exists | group expanded |
| Error toast | `Could not update priorities` on mutation error | mutation fails |

Expansion state is local, resets when leaving the step.

---

#### Step 2 - EXERCISES (planner/StepExercises.tsx:128)

Loading: centered spinner while `useWorkoutDays` loads. Top-to-bottom: schedule type toggle, [SequenceEditor], empty text or list of WorkoutEditor cards, ADD WORKOUT button, add-workout sheet.

**Schedule-type toggle** (segmented, 2 buttons, labels `WEEKDAY` and `SEQUENCE` = `st.toUpperCase()`)
- Tapping the non-active one -> `useUpdateScheduleType({id, scheduleType})` (converts nothing; only flips the column). Tapping the active one does nothing. Both disabled while the mutation is pending. Never gated by volumeReadOnly. Default `weekday` when `program.scheduleType` unset.

**Empty**: `NO WORKOUTS YET` (centered) when no workouts.

**ADD WORKOUT** (dashed full-width button, Plus icon, text `ADD WORKOUT`): visible when `!volumeReadOnly` (always in planner). Opens sheet:
- Sheet (generic `Sheet`: backdrop tap closes; X button aria-label `Close` top right): title `ADD WORKOUT`; label `WORKOUT NAME`; text input placeholder `e.g. Push Day` (autofocus); submit button `ADD WORKOUT` (`…` and disabled while pending). Submit: trimmed empty -> nothing happens (no error shown); else `createDay({name, position: workoutDays.length})` then clears and closes.

##### SequenceEditor (StepExercises.tsx:690) - only when scheduleType === 'sequence'
Card (role region, aria-label `Sequence editor`), label `SEQUENCE`. Rendered ABOVE the workout cards. Program-level ordered list of slots (workout or rest day); a workout may appear more than once.
- Loading: small spinner. Empty: `NO SLOTS YET`.
- Each slot row (SequenceItemRow): index `01`, `02`... ; label button (tap opens CHANGE SLOT picker) showing workout name (fallback `—` if workout missing) or `REST DAY` (italic, dim, lighter weight) when `workoutDayId === null`; three icon buttons: ChevronUp (disabled for first), ChevronDown (disabled for last), Trash2.
  - Move: `moveSequenceItem` -> optimistic cache write to `['v2_programSequenceItems', programId]` then `useReorderSequenceItems`.
  - Trash -> confirm sheet.
- `ADD SLOT` button (dashed, Plus icon) always visible in this editor -> opens picker.
- Picker sheet (`Sheet`): title `CHANGE SLOT` when editing an existing slot, `ADD SLOT` when adding. Options: `REST DAY` (dashed button, picks null) then one button per workout of the program (name). Picking: change -> `useUpdateSequenceItemWorkout({id, workoutDayId})` and closes; add -> `addItem({position: items.length, workoutDayId})` then closes.
- Confirm remove sheet: title `Remove this slot?`; body `"{label}" — this cannot be undone.` (label is workout name or `REST DAY`); buttons `CANCEL` | `REMOVE` (`…` and disabled while pending).
- In the sequence mode the per-workout weekday chips are hidden (below). Unclear: a workout deleted while referenced by slots shows as `—` (no explicit handling in this file).

##### WorkoutEditor (StepExercises.tsx:243) - one card per workout, in workoutDays order

| Control | What it does | Visible when | Where |
|---|---|---|---|
| Workout name (tappable, ellipsized) | enters edit mode (no-op and button disabled if volumeReadOnly) | not editing | card header |
| Name input | Enter blurs; blur saves trimmed name if non-empty and changed via `useUpdateWorkoutDayName`; else closes | editing | card header |
| Trash2 icon (aria-label `Delete {name}`) | opens delete-workout sheet | `!volumeReadOnly` | card header, right |
| Weekday chips `MON TUE WED THU FRI SAT SUN` (horizontally scrollable) | single-select: tapping the active day clears it (`dow: null`, workout becomes unscheduled); tapping another day moves the assignment there (via `assignWorkoutWeekday`: workout is on one weekday only; whichever workout previously held that day is presumably displaced - exact displacement semantics are in plannerService.assignWorkoutWeekday, not read in detail). All chips disabled while `assignWeekday.isPending`. Active chip = accent. Active day = the weekday whose `schedule[day] === workoutDay.id`. | `scheduleType === 'weekday'` (hidden for 'sequence'). Never gated by volumeReadOnly | card, under name |
| Exercises area: spinner | | `useProgramExercises` loading | card |
| Empty, editable: dashed button `Add an exercise` (Plus icon) -> opens ExercisePicker | | no exercises and !volumeReadOnly | card |
| Empty, read-only: `NO EXERCISES YET` | | no exercises and volumeReadOnly (dead in planner) | |
| Exercise rows (see ExerciseRow) interleaved with superset toggles / block rest editors | | exercises exist | |
| `ADD EXERCISE` (dashed, Plus icon) | opens ExercisePicker | `!isLoading && !volumeReadOnly && exercises.length > 0` | below list |
| WARMUP ROUTINE section | see below | always (not gated) | below exercise list, after a divider |

**Superset link toggle** (SupersetLinkToggle, Link2 icon): a full-width button between every adjacent pair of exercises (rendered when `index < exercises.length - 1`). Label `LINK AS SUPERSET` (dashed, muted) when the gap is not linked; `SUPERSET — TAP TO UNLINK` (accent) when linked. Tap -> `useToggleSupersetLink(planLinkToggle(exercises, gapIndex))` (link merges neighbouring runs into one block; unlink splits one block at that gap; 3+ member blocks can be split mid-way). Disabled (opacity .6) while toggling is pending. Never gated by volumeReadOnly.

**Block rest editor** (BlockRestEditor): rendered after the last member of a unit with 2+ members (and `ex.supersetBlockId` set). Label `SUPERSET`; two rest steppers: `WITHIN ROUND` (null shows `NO TIMER`) and `AFTER ROUND` (null shows `PER EXERCISE`). Writes `useUpdateSupersetBlockRest`. (The `everyWeek` prop - `EVERY WEEK` label - is unused in the planner.)

**Reordering**: moves whole superset unit (`moveUnit`) with optimistic cache write + `useReorderProgramExercises`. Move buttons are only shown on the first row of a unit; up disabled for first unit, down disabled for last unit.

**ExerciseRow** (StepExercises.tsx:563)

| Control | What it does | Visible when |
|---|---|---|
| Index `01`, `02`... | static (position in workout) | always |
| Exercise name (`—` if missing) + muscle group uppercase beneath (blank if none) | static | always |
| ChevronUp / ChevronDown icon buttons | move unit up/down | `!readOnly` AND first row of its unit; up disabled if first unit, down disabled if last unit |
| Trash2 icon | opens remove-exercise sheet | `!readOnly` (every row, including non-first members of a superset) |
| `UNIT` label + chips `INHERIT (KG)` / `INHERIT (LBS)` (global unit from settings), `KG`, `LBS` | single-select; INHERIT writes null; others write kg/lbs via `useUpdateProgramExerciseWeightUnit`. Active = value equals option (null = INHERIT). Disabled when readOnly (never in planner). Tapping active chip re-sends same value (no toggle-off). | always |
| `REST` stepper | `RestStepper` label `REST`, null shows `GLOBAL`; `−` and `+` buttons; step 15s; `−` at <= 15s goes to null (clears); `−` disabled when null; `+` from null starts at 15s; max 600s. Value formatted `45s`, `1min 30s`. Writes `restSeconds`. | always |
| `REST AFTER` stepper | same, null shows `NONE`; writes `restAfterSeconds` | always |
| `TEMPO` field | button showing the tempo or `—`; tap -> text input (placeholder `3-1-1-0`, aria-label `Tempo`, width 96); Enter blurs; blur commits: blank -> clears (writes null if had value); `normaliseTempo` valid (exactly 4 hyphen-separated fields, each digits or a single X/x; uppercased e.g. `3-1-1-X`) -> writes if changed; invalid -> stays in edit mode, red border and inline error `Use 4 fields, e.g. 3-1-1-0 (X allowed)`, nothing written; error clears on typing | always |

**Delete workout sheet**: title `Delete "{name}"?`; body `This removes the workout and every exercise in it. This cannot be undone.`; buttons `CANCEL` | `DELETE` (`…` disabled while pending). DELETE -> `deleteDay({id, schedule})` (also passes schedule, presumably to clear weekday references) and closes immediately.

**Remove exercise sheet**: title `Remove "{exercise name or 'this exercise'}"?`; body `This also removes its planned sets here. This cannot be undone.`; buttons `CANCEL` | `REMOVE`.

**WARMUP ROUTINE** (WarmupRoutineEditor, variant `rows`, per workout): heading `WARMUP ROUTINE`.
- Loading spinner. Empty (not showing add form): `NO WARMUP ITEMS YET`.
- Each item (WarmupItemRow): index `01`..; item text as button (tap -> inline input aria-label `Warmup item text`, Enter blurs, blur saves trimmed text if non-empty and changed; blank closes without write); ChevronUp (disabled first), ChevronDown (disabled last), Trash2 icons.
- `ADD ITEM` (dashed, Plus) -> inline form: text input (placeholder `e.g. 5 min easy bike`, aria-label `New warmup item`, autofocus; blur with empty text closes the form) + `ADD` submit (disabled while pending). Blank submit: nothing written, no message.
- Remove confirm sheet: title `Remove this item?`; body `"{body}" — this cannot be undone.`; `CANCEL` | `REMOVE`.
- Note: this is the routine itself; ticking happens only in the workout screen.

**ExercisePicker** (programs/ExercisePicker.tsx:20) - bottom sheet (82dvh, z 60), shown when `showPicker && !volumeReadOnly`:
- Header `ADD EXERCISE`; X icon close button (no aria-label); backdrop tap closes.
- Muscle filter chips (horizontally scrollable): `ALL`, `CHEST`, `BACK`, `SHOULDERS`, `BICEPS`, `TRICEPS`, `FOREARMS`, `QUADS`, `HAMSTRINGS`, `GLUTES`, `CALVES`, `CORE`, `OTHER` (note this picker's MUSCLE_GROUPS order is chest, back, shoulders, biceps, triceps, forearms, quads, hamstrings, glutes, calves, core, other). Tapping the active (non-ALL) chip resets to ALL.
- List: all exercises (`useExercises(false)`; argument meaning unclear - likely excludes archived/includes only non-hidden) minus those already in this workout (prop snapshot + live query, so an added one disappears immediately). Each row: exercise name, muscle group uppercase (`OTHER` if none), Plus icon. Tap adds immediately (`useAddProgramExercise({exerciseId, position: currentExercises.length, weightUnit: global setting})`); sheet STAYS OPEN for adding more. Row disabled (opacity .5) while add pending or settings loading.
- Empty: `ALL EXERCISES ADDED` when no exercises remain at all; `NONE IN THIS GROUP` when a filter leaves none.
- No search box, no create-new-exercise action, no loading state for the exercise list (just empty text), no error state.

---

#### Step 3 - VOLUME (planner/StepVolume.tsx:47)

Note on requested items: this step has NO weight, RIR, or per-set tag controls, and no superset-block controls (superset grouping/block rest are step 2). AMRAP is entered via the rep-target text field. Per-set rest, warmup flag, dropset/stage kinds are present.

**PLANNING** (label `PLANNING`): segmented 2 buttons `STABLE` and `WEEK-DEPENDENT`; writes `useUpdatePlanningType({id, planningType})` when tapped and different from current (default `week_dependent` when unset). Disabled when `!canChangePlanningType` (never in planner) or pending. Helper line: stable -> `The sets planned here are the volume for every week.`; week-dependent -> `Only week 1 is planned here; later weeks copy forward.` (The option `note` fields `Same sets every week` / `Plans week 1 here; weeks copy forward` are defined in code but NOT rendered.)

**DELOAD RULES** (ProgramDeloadRulesSection, always rendered): segmented `USE MY DEFAULT` | `CUSTOM` (disabled while pending). `USE MY DEFAULT` active when `program.deloadRules` is null; tapping it when custom writes null. `CUSTOM` writes `{}` (every rule off) when currently default. When CUSTOM, card containing DeloadRulesEditor (writes `next ?? {}`):
- Row toggles (switch, label as aria-label): `Sets`, `Weight`, `Reps`, `RIR` - each independently on/off, separated by dividers.
- Sets (on): chips `PERCENT` | `COUNT`; stepper `VALUE (%)` (step 5, 1-99) or `VALUE (SETS)` (step 1, 1-20); `ROUNDING` chips `DOWN` | `UP`. Turn-on default: percent, 50, down.
- Weight (on): stepper `PERCENT` (step 5, 1-100, shown as `75%`); `ROUNDING` `DOWN`|`UP`; stepper `STEP` (step 0.5, min 0.5); `STEP UNIT` chips `KG`|`LBS`. Turn-on default: 75%, down, 2.5, kg.
- Reps (on): stepper `DELTA` (step 1, -20..20, shown `+N`/`N`); turn-on default 0.
- RIR (on): stepper `DELTA` (step 1, -10..10); default 0.
- Stepper buttons aria-labels `Decrease {label}` / `Increase {label}`.

**States**: spinner while workouts load; `NO WORKOUTS YET` when none.

**WorkoutVolumeEditor** (per workout): shows spinner while exercises (or sets, if exercises exist) load; renders nothing at all if the workout has zero exercises (no placeholder). Card with heading = workout name uppercased, then one ExerciseSetsEditor per exercise.

**ExerciseSetsEditor** (per exercise)

| Control | Detail | Visible when |
|---|---|---|
| Exercise name (`—` fallback) | static | always |
| `NO SETS YET` (error colour) | under name | zero head sets |
| `SETS` label + stepper `−` (aria-label `Fewer sets for {name}`) / count / `+` (aria-label `More sets for {name}`) | count = number of head sets (stages not counted). `−` min 0; `+` unbounded in UI. Writes `useSetExerciseSetCount({programExerciseId, currentHeads, count})`. `−` disabled when readOnly, no heads, or pending; `+` disabled when readOnly or pending. This count is described in code as "the one required value" but never blocks Save/Start. | always |
| `ALL SETS` row | label `ALL SETS` + button showing common rep target of all heads, or `MIXED` if they differ, or `—` if none (aria-label `Set every set's rep target for {name}`). Tap -> input placeholder `8, 8-12, or AMRAP`. Commit on blur/Enter: blank -> sets target to none for all; parse via `parseRepTarget` (accepts `8`, `8-12` or `8–12` with strictly greater max, `AMRAP` any case, `none` any case); unparseable -> silently discarded (no error); unchanged -> no write. Writes `useSetRepTargetForAllSets` for all head ids. | at least one head set |
| Per-set groups (ProgramSetGroupEditor), one per head, sorted by position, numbered `01`.. | see below | at least one head set |

**SetTargetRow** (head, and each stage with `↳` instead of number plus a stage-kind label such as `DROPSET`):
- Number `01`.. (head) or `↳` (stage). Stage rows also show the kind label (`DROPSET`, `REST-PAUSE`, `MYO-REPS`, `CLUSTER`) in small text.
- Rep target button: `—` when none, else number / range `8–12` (en dash in display) / `AMRAP`; tap -> input placeholder `8, 8-12, or AMRAP`; same parse rules as above, blank clears, unparseable silently ignored, unchanged no write. Writes `useUpdateSetRepTarget`. Disabled when readOnly.
- Per-set rest stepper (RestStepper, NO label, null shows `CHAIN`; −/+; 15s steps; max 600s; label-less). Writes `useUpdateProgramSetRest`. Never gated by readOnly.
- Stage rows only: Trash2 icon (aria-label `Remove stage`) when `!readOnly` -> `useRemoveProgramSetStage` (no confirm).

**ProgramSetGroupEditor** extras, below the head row:
- Stage rows (nested, dashed left border) when stages exist.
- When stages exist and `!readOnly`: `STAGE KIND` chip row (RatingChips; chips `DROPSET`, `REST-PAUSE`, `MYO-REPS`, `CLUSTER`; tapping the active chip clears to null which resolves to a default kind via `resolveStageKind` - default kind not read; writes `useUpdateProgramSetStageKind` on the head).
- When stages exist: `STAGE REST` stepper (label `STAGE REST`; null shows the kind default: `NO TIMER` for dropset, `15S` uppercase of `15s` for rest-pause/myo-reps/cluster; writes `useUpdateProgramSetStageRest` on head). Not gated by readOnly.
- `SET KIND` chip row with single chip `WARMUP` (tap to mark head as warm-up, tap again to clear -> `useUpdateProgramSetIsWarmup`): visible when `!readOnly && stages.length === 0`. A head with stages cannot be a warm-up.
- `ADD STAGE` (Plus icon, tiny text button): visible when `!readOnly && !head.isWarmup`; disabled while pending. Adds a stage under the head (stageIndex = max existing + 1). A warm-up head hides ADD STAGE.
- Chip row labels: RatingChips renders its `label` prop as small text above the chips (`STAGE KIND`, `SET KIND`).

Not present in this step (confirmed absent in StepVolume.tsx): weight targets, RIR, tags, superset block controls, ADD/REMOVE of whole sets other than via the SETS stepper, per-week editing, error states for failed mutations (no toasts here).

---

## PART 2: PROGRAMS PAGE (programs/ProgramsPage.tsx, 569 lines, `/program`)

Reached from Plan's header icon and Plan's no-active-run empty state (per code comments; not verified in PlanPage). No back button, no header icons, no ⋯ menus, and no overflow menus exist on this page. Header is static.

**Header**: small mono `OVERLOAD v2`; title `PROGRAMS`.

Data: `useMesos()` (runs), `useSavedPrograms()`; `activeMeso` = first mesocycle with status `active`; `completedMesos` = status `completed` (list order from hook). `isLoading = mesosLoading || programsLoading`.

##### ACTIVE RUN section (always shown, label `ACTIVE RUN`)

| State | Render | Condition |
|---|---|---|
| Loading | spinner | `isLoading` |
| None | `NO ACTIVE RUN` (centered dim) | `!isLoading && !activeMeso` (no start button on the page here; comment says the old dashed `+ START MESOCYCLE` was removed) |
| Active | ActiveMesoCard | `!isLoading && activeMeso` |

**ActiveMesoCard**: accent top border; badge `WEEK {n}` where n = `differenceInCalendarWeeks(now, startDate, weekStartsOn Monday) + 1`; run name (ellipsized); program name (`meso.program.name`, only if present); `SINCE {MMM D, YYYY}` uppercased (e.g. `SINCE OCT 5, 2026`); footer full-width button `END RUN` -> sets `confirmCompleteId` (opens End run sheet). Card itself is not tappable. Only one action.

##### COMPLETED RUNS section (label `COMPLETED RUNS`)
Visible only when `completedMesos.length > 0` (no empty state copy). One row per run (div role="button", tabIndex 0): 
- Row tap / Enter / Space -> navigate `/meso/{id}/priorities`.
- Content: run name (ellipsized); sub line `{program name} · {MMM d, yyyy}` and `→ {MMM d, yyyy}` appended when `endDate` exists (program name prefix only if `m.program?.name`).
- ChevronRight icon (decor).
- Trash2 icon button (aria-label `Delete run`; stopPropagation) -> sets `confirmDeleteId` (opens Delete run sheet).

##### SAVED PROGRAMS section
- Heading `SAVED PROGRAMS`; accent square `+` button (aria-label `Create a program`) -> clears name, opens NEW PROGRAM sheet. Always visible.
- Empty: `NO PROGRAMS YET` when `!programsLoading && programs.length === 0`. (While programs loading and none yet: nothing; the spinner at top is only in the active-run section.)
- One card per saved program (`useSavedPrograms`): name (ellipsized, 16px); `{n} DAY{S} / WEEK` line where n = count of truthy values in `program.schedule` (shown only if n > 0; hidden entirely when 0; for sequence programs schedule is '{}' so nothing shows - `hasSchedule` is NOT used for this line). Card body itself is not tappable.
- Footer two buttons: `OPEN IN PLANNER` -> navigate `/program/{id}`; `START` (accent) -> `openStartMeso(program.id)`. Both always enabled (START is not disabled/gated at row level; the schedule check is applied inside the sheet).
- No rename, delete, duplicate, or ⋯ menu for saved programs on this page. (Rename is in planner header; no program delete found anywhere in these files - unclear if deletable elsewhere.)

##### Start run sheet (BottomSheet z 50; `showStartMeso`)
Opened by a row's `START` (preselects that program) or automatically after END RUN completes (`openStartMeso()` with no preset -> first saved program, `programs[0]`, or '' if none). Name field reset to blank on each open.
- Title: `START A NEW RUN` when `activeMeso` exists, else `START RUN`. X icon button (no aria-label) closes; backdrop tap closes.
- If `programs.length === 0`: `CREATE A PROGRAM FIRST` + button `CREATE PROGRAM` (closes this sheet, clears name, opens NEW PROGRAM sheet).
- Else form:
  - Label `RUN NAME` + `(optional)`; text input; placeholder = selected program's name, or `e.g. Summer Block` if none.
  - Label `PROGRAM`; scrollable list (max 180px) of all saved programs as toggle buttons (selected = accent border/fill); tap sets selectedProgramId.
  - If `activeMeso`: note box `Starting a new run will automatically end the current one.`
  - Submit `START RUN` (`…` while pending). Disabled when `!selectedProgramId || startRun.isPending || hasSchedule !== true` (hasSchedule evaluated for the selected program via `useProgramHasSchedule`; null while loading).
  - Reason line `Schedule at least one workout to start` shown only when `hasSchedule === false`.
  - Submit behavior: name = trimmed run name || selected program's name || `Mesocycle`; returns silently if no program selected or `hasSchedule !== true`; `startRun.mutateAsync({name, programId})`; success -> close sheet, navigate `/plan/priorities`; failure -> toast with error message or `Could not start the mesocycle` (sheet stays open). Starting while a run is active ends the old one atomically (server side).

##### End run sheet (`confirmCompleteId`)
CheckCircle icon; title `End run?`; body `This run will be marked complete and you can start a new one.`; buttons `CANCEL` | `END RUN` (`…` and disabled while `completeMeso.isPending`). END RUN -> `completeMeso.mutateAsync(id)`, closes the sheet, then immediately opens the Start run sheet (title `START RUN` since no active run now; first saved program preselected). No error handling around the await in code (a failed completion would reject unhandled; no toast) - unclear what the user sees.

##### Delete run sheet (`confirmDeleteId`)
Title `Delete run?`; body `This cannot be undone. Any linked session history will remain.`; buttons `CANCEL` | `DELETE` (red `#cc3333`; `…` and disabled while pending). DELETE -> `deleteMeso.mutateAsync(id)` then closes; no error handling shown.

##### NEW PROGRAM sheet (`showCreateProgram`)
Title `NEW PROGRAM`; label `PROGRAM NAME`; text input placeholder `e.g. Hypertrophy Block` (autofocus); submit `CREATE PROGRAM` (`…`, disabled while pending). Submit: trimmed empty -> nothing (no message); else `createProgram.mutateAsync(name)`, clears, closes, navigates to `/program/{created.id}` (the planner, opening at step 1 PRIORITIES). No error handling shown.

BottomSheet wrapper: backdrop (tap outside closes), rounded-top sheet, max height 85dvh, scrollable. Sheets other than Start run have no X button (backdrop tap or CANCEL only).

---

### Gaps/uncertainties
- priorityMarks.ts `buildGroupMarkEntries` summary strings not read (exception summary text under a group name is derived there).
- `assignWorkoutWeekday` exact displacement behavior (what happens to a workout already on the target day) not read; code comment says one weekday per workout.
- `resolveStageKind(null)` default kind not read (affects what STAGE KIND shows when none chosen, and the stage-rest default text).
- `useExercises(false)` argument meaning in ExercisePicker unclear.
- G14 detection uses `program.schedule` regardless of scheduleType.
- Error handling for END RUN, DELETE run, and CREATE PROGRAM awaits is absent in ProgramsPage (no try/catch); resulting UX on failure unclear (global mutation error handling not checked).
- PlanPage entry points to /program (header icon, empty state) and MesoPrioritiesPage not inventoried (outside scope).
- Offline/online behavior not expressed in these components.
- Several step 3 mutations (rep target, sets count, stage) have no error UI/toast in these files.

## 1.4 Today
## Today (/today) — every state

Route: `/today` -> `TodayPage` (src/App.tsx:103). `/` and unknown paths redirect to `/today` (App.tsx:102,130). Requires login; otherwise LoginPage (App.tsx:89-95).
All paths below are under /home/user/overload-v2/src. Visual terms (classNames) omitted; only behaviour/copy.

NOTE: `SchedulerResult` (types/index.ts:618-628) has **10** variants, not 8: `no_program`, `no_active_meso`, `active_session`, `completed_today`, `suggest_from_plan`, `suggest_no_plan`, `planned`, `rest_day`, `missed_sessions`, `due_today`. Sequence runs use a separate 4-variant `SequenceScheduleResult`: `no_workouts`, `active_session`, `completed_today`, `next`.

---

### 0. Global chrome present on Today (App/Nav)

#### Bottom Nav (components/Nav.tsx:25-105)
Rendered on every logged-in route, including every Today state, below `<main>` and `<Toast/>` (App.tsx:133-134).
| Control | Action | Visible when |
|---|---|---|
| Tabs: `TODAY`, `PLAN`, `PROGRESS`, `HISTORY`, `LIBRARY`, `SETTINGS` (icons Dumbbell, LayoutList, TrendingUp, Clock, BookOpen, Settings) + `COACH` (Sparkles) | NavLink to /today, /plan, /progress, /history, /library, /settings, /coach | COACH only when `isCoachUser(user?.id)` (Nav.tsx:32) — Coach user only |
| `ADD TO HOME SCREEN` + button `INSTALL` | `install()` from useInstallPrompt | `canInstall` true (Nav.tsx:37) |
| Offline strip: dot + `OFFLINE · SETS WILL SYNC ON RECONNECT` | static | `!isOnline` (navigator.onLine via hooks/useOnlineStatus.ts) (Nav.tsx:63) |

#### Update banner — PwaUpdateNotice (features/pwa/PwaUpdateNotice.tsx:13; mounted in App.tsx:45 above routes, even on login)
Fixed to viewport top, overlay (does not alter layout). Visible when `updateAvailable` (set by SW `onNeedReload`, usePwaUpdate.ts:~47). Checks for new sw.js hourly and on `visibilitychange` to visible.
| Control | Action |
|---|---|
| text `UPDATE AVAILABLE` | static |
| `RELOAD` (shows `…` while `isReloading`; disabled while reloading) | `reload()`: sets isReloading, waits up to 8000 ms (polls 150 ms) for in-flight React Query mutations to settle, then `window.location.reload()` |
| X icon button, aria-label `Dismiss update notice` (disabled while reloading) | `dismiss()` -> hides banner for this page-lifetime (state only; no persistence) |

#### Toast (features/notifications/Toast.tsx)
Fixed bottom-center above Nav, auto-clears after 3000 ms. The only toast sourced from Today-adjacent code: `Session completed automatically` (useAutoFinishSession.ts:60, fired from within GymSession on auto-complete). No toasts for any Today-screen mutation success/failure.

#### Date refresh (hooks/useToday.ts)
`today` = local `yyyy-MM-dd`; refreshes at next local midnight (+5 s) and whenever tab becomes visible. Header label `todayLabel = format(today,'EEEE, MMM d').toUpperCase()` e.g. `SUNDAY, OCT 11` (TodayPage.tsx:30).

#### Shared: TodayHeader (gym/TodayHeader.tsx:1-24)
Small muted label line (= todayLabel) + `<h1>` `TODAY`. Used in: missed_sessions, not-started card, due_today list, completed screen, no_program/no_active_meso, sequence next/no_workouts. NOT used in: active_session (GymSession has its own header), rest_day (RestDayScreen has own), SessionPreview.

---

### 1. TodayPage decision tree (gym/TodayPage.tsx:28-451)

Local UI state in TodayPage: `dismissMissed` (bool), `showPreview` (bool), `selectedEntryIndex` (number|null), `showMoveSheet` (bool). All reset when TodayPage unmounts (e.g. navigating to another tab and back). Note: they are NOT reset when result changes (see Gaps).

Order of evaluation:
1. `scheduler.isLoading` -> Loading spinner (§2).
2. `scheduler.activeMeso && (scheduler.program?.scheduleType ?? 'weekday') === 'sequence'` -> `<SequenceTodayPage>` (§12). (Checked before result; so a sequence program with active meso never reaches weekday `schedule()` result rendering, even though `useScheduler` still computes it.)
3. `!result` -> renders `null` (blank).
4. Switch on `result.type` (below).
5. Fallthrough (no_program / no_active_meso) -> §11.

#### useScheduler (gym/useScheduler.ts:250-318) — inputs & loading
- `activeMeso` = first meso with `status === 'active'`; `program` = program with `id === activeMeso.programId` (or null).
- `currentWeek = differenceInCalendarWeeks(today, meso.startDate, {weekStartsOn:1}) + 1` (1 if no meso).
- Sessions fetched: `useSessionsInRange(lookbackStart, today)` where lookbackStart = later of meso.startDate and today-7d.
- `isLoading = !mesos || !programs || (!!programId && !workoutDays) || !sessions || (!!activeMeso && (!currentWeekPlans || !allWeekPlans))` (useScheduler.ts:278-283). Query errors are not handled anywhere: an errored query leaves data undefined -> remains in loading state (spinner indefinitely). React Query default `retry: 1` (lib/queryClient.ts). `refetchOnWindowFocus: false`.
- Passes `dismissMissed` into `schedule()`.

#### schedule() conditions (gym/scheduler.ts:22-199), in exact order
1. `programs.length === 0` -> **`no_program`**.
2. `!activeMeso` -> **`no_active_meso`**.
3. Active meso's program not found in `programs` -> **`no_active_meso`** (scheduler.ts:48-49).
4. Any session in lookback list with `status === 'in_progress'` (today's, a caught-up missed one, or moved-here; any date) -> **`active_session`** `{session}` (first found). Short-circuits everything.
5. Missed detection (current calendar week only, Monday floor, never before meso start): for each date `d` from `max(weekStart(Mon), meso.startDate)` up to but excluding today: weekday name -> `program.schedule[dow]` = workoutDayId; if set and workoutDay exists in `workoutDays`; look at session with `date === d` among sessions with `date < today`. It is "handled" (not missed) if that session `status` is `completed`, `in_progress`, `skipped`, OR it has `movedToDate` set and `!== d` (moved away). Else pushed to queue with `weekPlan` = allWeekPlans match on (workoutDayId, weekNum) (weekNum from differenceInCalendarWeeks(d, mesoStart)+1) or null, `existingSessionId` = that day's session id or null. A session with status `planned` and no movedToDate, or any other status, does NOT count as handled.
   - If queue non-empty and `!dismissMissed` -> **`missed_sessions`** `{queue}`.
6. Due-today rows = sessions where `status !== 'skipped'` and `effectiveDate(s) === today` (effectiveDate = movedToDate ?? date, gym/effectiveDate.ts).
   - Today's own slot: `todayWdId = program.schedule[todayDow]`; must resolve to a workoutDay in `workoutDays` (stale guard). `todaysOwnRow` = session with `date === today && workoutDayId === todayWdId`. `needsVirtualSuggestion = todayWdId resolved && (no todaysOwnRow || todaysOwnRow.status === 'skipped')`. (A today row that was moved away has status planned w/ movedToDate != date, so it exists and suppresses the virtual suggestion.)
   - Each due row -> entry: `status === 'completed'` -> `{type:'completed_today', session}`; otherwise (only `planned` can remain) -> `{type:'planned', session, weekPlan (currentWeekPlans by workoutDayId, else allWeekPlans by session.weekPlanId, else null), workoutDay (or null)}`.
   - If `needsVirtualSuggestion`: append virtual entry: `currentWeekPlans.find(workoutDayId === todayWdId)` exists -> `{type:'suggest_from_plan', weekPlan, date: today}`; else `{type:'suggest_no_plan', workoutDay, date: today}`.
7. `entries.length === 0` -> **`rest_day`** `{next: findNextScheduled(...)}` — scans program weekly template from tomorrow for 7 days, returns first day with a resolvable workout day `{date, workoutDay}` or null (ignores sessions/moves).
8. `entries.length === 1` -> that entry as the result: **`completed_today`**, **`planned`**, **`suggest_from_plan`**, or **`suggest_no_plan`**.
9. `entries.length >= 2` -> **`due_today`** `{sessions: entries}` (order: dueTodayRows in fetched-session order, virtual suggestion last).
- Skipped-all caveat: `completeSession` classifies a finished session whose every set log is skipped as `status 'skipped'` (gym/sessionService.ts:299-303 via sessionCompletion.ts shouldClassifyAsSkipped: logs.length>0 && all skipped). A skipped row is excluded from due rows and does not block a virtual suggestion, so Today then shows the start card again for today's scheduled day.

#### Variant -> component map
| Variant | Rendered by | Section |
|---|---|---|
| (loading) | inline spinner in TodayPage.tsx:49-58 | §2 |
| no_program | TodayPage fallthrough empty card | §11 |
| no_active_meso | TodayPage fallthrough empty card | §11 |
| active_session | `GymSession` (gym/GymSession.tsx) | §3 |
| missed_sessions | TodayHeader + `RestDayCard` + `MissedSessionPrompt` (sheet) | §4 |
| suggest_from_plan | `renderNotStartedCard` (TodayPage.tsx:134-332) | §5 |
| suggest_no_plan | `renderNotStartedCard` | §5 |
| planned | `renderNotStartedCard` | §5 |
| completed_today | `CompletedTodayScreen` | §8 |
| due_today | list of `DueTodaySummaryRow`; drills into `renderNotStartedCard` / `CompletedTodayScreen` with onBack | §9 |
| rest_day | `RestDayScreen` + NEXT UP card | §10 |
| (sequence run) | `SequenceTodayPage` | §12 |

---

### 2. Loading state (TodayPage.tsx:49-58; SequenceTodayPage.tsx:38-47)
Centered 24px spinner (circle, `animate-spin`), no text, filling container (`h-full`). Same markup in sequence page (`scheduler.isLoading || !scheduler.result`). Sequence loading condition (useSequenceScheduler.ts:463-464): `!activeMeso || !workoutDays || !sequenceItemsRaw || !allWeekPlans || lastDoneOrSkipped === undefined || !sessions`. No error state / retry anywhere.
After a start/complete/reopen mutation, loading spinner does not reappear if cached data exists; the screen swaps when query invalidation refetches (e.g. reopen: "Scheduler will transition to active_session automatically via invalidation").

---

### 3. Active session / session-in-progress resume (TodayPage.tsx:85-102)
Shown when `result.type === 'active_session'`. This is also the "resume" mechanism: no separate resume prompt — any `in_progress` session within the lookback window (last 7 days, not before meso start; includes today) takes over Today entirely, regardless of which day's workout it belongs to or whether other things are due (also overrides missed prompt, rest day, etc.).
- `workoutDay` = `workoutDays.find(id === session.workoutDayId)`; if not found -> renders `null` (blank screen) (TodayPage.tsx:92).
- `weekPlan` = currentWeekPlans by workoutDayId, else allWeekPlans by session.weekPlanId, else null.
- Renders `<GymSession sessionId workoutDay weekPlan weekNumber={currentWeek} today />` (weekday; `scheduleType` defaults 'weekday').
- Sequence: `<GymSession ... weekNumber={weekPlan?.weekNumber ?? 1} scheduleType="sequence" />` (SequenceTodayPage.tsx:51-65), workoutDay not found -> null.
- GymSession internals are out of scope for this file (see its own inventory), but entry points owned by Today flow:
  - Header line: `{weekPlan?.isDeload ? 'DELOAD · ' : ''}{scheduleType==='sequence' ? 'CYCLE' : 'WEEK'} {weekNumber}` (GymSession.tsx:493), title `workoutDay.name`, `IN PROGRESS`, elapsed time (formatRestTime(duration)).
  - Bottom button `FINISH SESSION` (GymSession.tsx:725-733) -> `setShowComplete(true)` -> renders SessionComplete (§7). Auto-finish: `useAutoFinishSession` completes the session itself after all planned sets are logged and inactivity >= settings.autoFinishMinutes (checked every 30 s; grace window since mount; skipped if autoFinishMinutes null or no planned sets) -> toast `Session completed automatically`; ratings stay null.
  - Offline: GymSession falls back to Dexie cache for exercises when offline and Supabase returns nothing (GymSession.tsx:244-263); sets queue to sync (see Nav strip).

---

### 4. missed_sessions (TodayPage.tsx:106-123) + MissedSessionPrompt (gym/MissedSessionPrompt.tsx:17)
Appears when: scheduler step 5 above yields non-empty queue AND `dismissMissed` false (user hasn't dismissed in this TodayPage mount) AND no in_progress session. Weekday runs only. Current calendar week only, days strictly before today.

Page behind the sheet:
- TodayHeader (`<todayLabel>` / `TODAY`).
- RestDayCard (TodayPage.tsx:455-472): dashed card, label `REST`, body `Catch up on missed sessions before today's workout`. (Reuses the "rest" card styling; it is not a rest-day.)
- Then full-screen overlay sheet (below).

#### MissedSessionPrompt sheet
Fixed full-screen dimmed backdrop (z-50), bottom sheet max 70dvh, scrollable. Tapping backdrop (outside sheet) = `onDismiss`.
| Control | Action | Visible/disabled |
|---|---|---|
| grabber bar | decorative | always |
| label `MISSED SESSIONS` | static | always |
| X icon button aria-label `Dismiss` | `onDismiss` -> `setDismissMissed(true)` -> scheduler re-runs with `dismissMissed` true, i.e. falls through to today's suggestion/rest/etc. | always |
| Heading `{n} session{s} to catch up` (plural s when n > 1; "1 session to catch up") | static | always |
| Per-item date label `format(date,'EEEE, MMM d').toUpperCase()` | static | per queue item; list sorted newest first |
| Per-item workout day name | static | |
| `DO IT NOW` | `handleDoItNow(missed)`: weekNumber of the missed date; `planWeekThenFindId(meso, missedWeek, workoutDay.id, missed.weekPlan?.id)` (best-effort plan creation; falls back to existing id/null on any failure incl. offline); then `createSession({mesoId, weekPlanId, workoutDayId, date: missed.date, movedToDate: today})` -> new session `in_progress` with `date` = missed day and `moved_to_date` = today. Scheduler then returns `active_session` (GymSession). Offline-capable (useCreateSession queues). | disabled while `planWeek.isPending || createSession.isPending || skipMissed.isPending`; opacity 0.6 while planWeek/createSession pending. Label never changes (no "working" text). |
| `MARK SKIPPED` | `skipMissedSession({mesoId, weekPlanId: missed.weekPlan?.id ?? null, workoutDayId, date, existingSessionId})`: if existingSessionId -> `skipSession(id)`; else insert a `v2_sessions` row status `skipped`. On success invalidates sessions; item drops out of queue; when queue empty, flow falls to today's state. Online-only write (no offline branch in useSkipMissedSession; no isOnline gating in UI -> failure unhandled, no message). | disabled while any of the three pending; opacity 0.6 while skipMissed pending |
Empty/loading/error: no empty copy (sheet only exists when queue non-empty); no error copy for failed mutations (unclear: errors are swallowed/unhandled promise rejection from onClick).
Sheet reappears? After dismiss it stays dismissed until TodayPage remount.

---

### 5. Not-started session card: suggest_from_plan / suggest_no_plan / planned (TodayPage.tsx:134-332, `renderNotStartedCard(entry, onBack?)`)
Same card for the three variants. Also used for a `due_today` drill-in with BACK.

When each appears (single-entry case; otherwise via due_today list):
- **suggest_from_plan**: no in_progress session, no (undismissed) missed queue; today's weekday maps to a workout day in `program.schedule` that exists in `workoutDays`; no non-skipped session row dated today for that workout day (no row, or row is `skipped`); AND `currentWeekPlans` has a plan row for that workout day. Entry = `{weekPlan, date: today}`.
- **suggest_no_plan**: same, but `currentWeekPlans` has no row for that workout day. Entry = `{workoutDay, date: today}`.
- **planned**: a `planned` session row whose effective date (movedToDate ?? date) === today exists (moved here from another day, or moved away and back) and it is the only entry; entry = `{session, weekPlan|null, workoutDay|null}`. Note: if a today-scheduled slot is vacant it adds a second virtual entry -> becomes due_today instead.

Derived values:
- `workoutDay`: suggest_from_plan -> workoutDays by weekPlan.workoutDayId, else placeholder `{name:'—', exercises:[]}`; suggest_no_plan/planned -> entry.workoutDay or the `—` placeholder.
- `weekPlan`: null for suggest_no_plan; else entry.weekPlan (planned may be null).
- `originalDate`: planned -> `session.date`; others -> `entry.date` (=today). `effectiveDate`: planned -> `session.movedToDate ?? session.date`; else originalDate.
- `isStartingSession`: planned -> `startMovedSession.isPending`; else `planWeek.isPending || createSession.isPending`.

Card contents:
| Element | Copy / action | Visible when |
|---|---|---|
| TodayHeader | `<todayLabel>` / `TODAY` | always |
| `← BACK` text button | `onBack()` -> `setSelectedEntryIndex(null)` (back to due_today list) | only when rendered via due_today drill-in (`onBack` passed) |
| Eyebrow line | `[NO PLAN THIS WEEK · ][MOVED FROM <EEE upper> · ]WEEK {currentWeek}` e.g. `MOVED FROM TUE · WEEK 3`, `NO PLAN THIS WEEK · WEEK 3`, `WEEK 3` | prefix `NO PLAN THIS WEEK · ` when entry.type==='suggest_no_plan'; `MOVED FROM <weekday of originalDate> · ` when entry.type==='planned' |
| Title `<workoutDay.name>` (h2) | static | always (`—` if workout day missing) |
| `DELOAD` (accent mono) | static label | `weekPlan?.isDeload` truthy (never for suggest_no_plan, since weekPlan null). Deload is per-session plan row property; copy is just `DELOAD` (no week number, comment says formerly "DELOAD WEEK") |
| `PREVIEW SESSION` | `setShowPreview(true)` -> SessionPreview (§6) | always on card |
| `START SESSION` / `STARTING…` | `handleStart`: planned -> `startMovedSession.mutateAsync(session.id)` (UPDATE existing planned row to in_progress, sets started_at; works offline via sync queue); else `planWeekThenFindId(meso.id, currentWeek, workoutDay.id, weekPlan?.id ?? null, planWeek)` then `createSession({mesoId, weekPlanId, workoutDayId, date: today})`. Scheduler then returns active_session. If `!activeMeso` no-op. | disabled while `isStartingSession`; label `STARTING…`, opacity 0.6 |
| `MOVE THIS SESSION` | `setShowMoveSheet(true)` -> MoveSessionSheet (§13) | always shown; disabled when `!isOnline || isMovePending` (isMovePending = moveSession.isPending \|\| clearMovedSession.isPending); opacity 0.5 then |
| `REQUIRES A CONNECTION` (small centered, dim) | static hint | `!isOnline` only |
No Coach-only gating. No "SKIP" on weekday not-started card (skip only exists in missed prompt and sequence).

After a move pick (`handleMovePick(targetDate)`, TodayPage.tsx:181-200): `resolveMove(originalDate, targetDate, today)`; `invalid_cross_week`/`invalid_past` -> silent no-op (sheet NOT closed in that branch since return occurs before `setShowMoveSheet(false)`); `clear` (target === original date) -> `clearMovedSession({workoutDayId, date: originalDate})`; `set` -> `moveSession({mesoId, weekPlanId: weekPlan?.id ?? null, workoutDayId, date: originalDate, targetDate})`. Then `setShowMoveSheet(false)` immediately (does not wait for mutation). After moving away from today, the scheduler recomputes: today's slot is vacated (no virtual suggestion) -> typically `rest_day` (+NEXT UP computed from template only) or other entries.
Error handling for move/start mutation failures: none shown (unclear/unhandled).

---

### 6. SessionPreview (gym/SessionPreview.tsx:19) — shown when `showPreview` true on a not-started card
Takes over whole Today page (replaces card). Read-only, "no writes until confirmed". Props from card: workoutDay, weekPlan, weekNumber=currentWeek, today, isStarting, onBack (`setShowPreview(false)`), onStart (=handleStart).
| Element | Copy / action | Condition |
|---|---|---|
| Back icon button (ArrowLeft) aria-label `Back to Today` | `onBack` | always |
| Eyebrow `[DELOAD · ]WEEK {weekNumber}` | static | `DELOAD · ` prefix when `weekPlan?.isDeload` |
| Title `<workoutDay.name>` (h1) | | |
| Chip `PREVIEW · NOTHING LOGGED YET` (dashed accent) | static | always |
| Exercise cards (PreviewExerciseCard) sorted by `position` | see below | exercises = `weekPlan?.exercises` if weekPlan exists, else program exercises (`useProgramExercises(workoutDay.id)`, default []) |
| `START SESSION` / `STARTING…` | `onStart` (same as card) | disabled when `isStarting`, opacity 0.6 |
Empty: zero exercises -> header + only the START button (no empty copy). Loading: no spinner for exercises; reference panel has own loading.
Reference data: `useExerciseReferenceSessions(workoutDay.id, exerciseIds, null)` -> per-exercise reference sessions; `referenceMesocycleId` = `weekPlan?.mesocycleId ?? null`. Preview passes no scheduleType (weekday semantics). The preview is not offered for sequence runs (SequenceTodayPage has none).
Note: showPreview stays true in TodayPage state after START until unmount (see Gaps).

#### PreviewExerciseCard (gym/PreviewExerciseCard.tsx:161) — read-only mirror of ExerciseCard
Per exercise:
- ExerciseHeader (gym/ExerciseHeader.tsx): exercise name (`—` if missing), tempo text if `programExercise.tempo`, muscle group uppercase, History icon button aria-label `View exercise history` -> navigate `/exercise/{exerciseId}` (leaves Today). Swap button is NOT shown in preview (no onSwapClick). `SWAPPED FROM` never shown.
- Two-column grid:
  - Left: `PlanTargetsPanel`: label `PLANNED RIR`; per planned head set (warmups filtered out, sorted by setNumber): `{setNumber}`, `RIR {n}` or `—`, optional weight target `{toDisplay(targetWeight)}{unit}` only if targetWeight != null, optional accent badge `+{stageCount}`. Empty: `NO PLAN` (when no non-warmup groups).
  - Right: `ExerciseReference` (weightUnit resolved via useWeightDisplay(programExercise.weightUnit)): 
    - loading: label `REFERENCE` + `···`
    - error: `COULDN'T LOAD REFERENCE` + button `RETRY` (calls onRetry)
    - `OFFLINE · CACHED` line when `isFromCache`
    - primary: `FIRST TIME` | Panel `LAST WEEK` | Panel `LAST TIME · <relative e.g. 3 DAYS AGO / TODAY>`; set lines `{setNumber} {weight}×{reps} [@{rir}]`, `—` for null weight, dropset stages `↳ ... DROP` badge; empty group list shows `—`
    - secondary (reach-back, only when primary session exists but has no real logged set): Panel `LAST ACTUALLY TRAINED {n}D AGO`/`TODAY`, or `NOTHING ON RECORD TO COMPARE AGAINST`, or `SKIPPED EVERY TIME ON RECORD`
    - Panels `EARLIER THIS WEEK · <relative>` for each same-week session
- Below grid (only if non-warmup groups): per planned head: 2-digit set number, `TARGET RIR {n}` or `NO TARGET`, badge `{n} STAGE`/`{n} STAGES` when stages; nested stage rows `↳` + `TARGET RIR {n}` / `NO TARGET`.
- No inputs, LOG/ADD SET, timers.

---

### 7. SessionComplete (finish flow) (gym/SessionComplete.tsx:13) — reached from Today's active session only
Trigger: GymSession `FINISH SESSION` button -> local `showComplete` -> `<SessionComplete sessionId onBack>` replaces GymSession (GymSession.tsx:425-427). (Auto-finish bypasses this screen.)
| Element | Copy / action | Condition |
|---|---|---|
| Heading with CheckCircle icon | `NICE WORK` | always |
| Stat `SETS LOGGED` + number | count of `session.setLogs` with `!isSkipped` (includes warmups — does not use countCompletedSets) | always (0 until session loads) |
| Stat `SKIPPED` + number | count with `isSkipped` | only when skipped > 0 |
| RatingChips label `ENERGY (OPTIONAL)` | chips `NONE`, `LOW`, `NORMAL`, `HIGH`, `SUPREME`; tap selects, tap selected clears to null | always |
| RatingChips label `PUMP (OPTIONAL)` | chips `NONE`, `SOME`, `GOOD`, `EXTREME`; same toggle | always |
| Label `SESSION NOTE (OPTIONAL)` + textarea (3 rows) placeholder `How did it feel?` | local `note` | always |
| `COMPLETE SESSION` / `SAVING…` | `completeSession.mutateAsync({id, note: note.trim()||null, energyRating, pumpRating})`. Online: fetches set logs, computes completed_at from logs (deriveCompletedAt), status = `skipped` if there are logs and ALL are skipped else `completed`, updates row (status, completed_at, note, energy_rating, pump_rating). Offline: writes to Dexie sync_queue (status computed from cached logs; falls back to 'completed'), `addPending(id)`. On success invalidates session/sessions/history/progress queries; Today then re-renders with `completed_today` (§8) (or start card again if classified skipped). No navigation, no toast. | disabled while pending; opacity 0.6 |
| `BACK TO SESSION` | `onBack` -> `setShowComplete(false)` | always |
Prefill: note/energy/pump prefill once from the loaded session (for reopened previously-completed sessions) via refs (SessionComplete.tsx:23-45), never overwriting typing.
RatingChips (gym/RatingChips.tsx:177): horizontally scrollable chip row, each 44 px high, label above in muted mono; `scale.labels[v]` uppercase text; active chip accent fill. Used also in StepVolume, PlanPage, SetRow (not Today).
Error/loading: no error copy for failed complete (unhandled); no loading state while session loads (counts show 0).

---

### 8. completed_today (TodayPage.tsx:340-350; CompletedTodayScreen gym/CompletedTodayScreen.tsx:26)
Appears when: single due-today entry is a `completed` session whose effectiveDate === today, no in_progress session anywhere, no (undismissed) missed queue, and no vacant virtual suggestion. Props: `session`, `workoutDay` (looked up in workoutDays, may be null -> `—`), `weekNumber=currentWeek`, `todayLabel`. Also reached via due_today drill-in (with `onBack`) and in sequence runs (`scheduleType="sequence"`, weekNumber from session's weekPlan?.weekNumber ?? 1).
Data: `useActiveSession(basicSession.id)` loads full session with setLogs; counts via `countCompletedSets` (excludes warmups; total = non-skipped, skipped = skipped).
| Element | Copy / action | Condition |
|---|---|---|
| TodayHeader | `<todayLabel>` / `TODAY` | always |
| `← BACK` | `onBack` -> back to due_today list | only if `onBack` provided (due_today drill-in) |
| Eyebrow `SESSION COMPLETE · WEEK {n}` (weekday) / `SESSION COMPLETE · CYCLE {n}` (sequence) | static | always |
| Workout name | `workoutDay?.name ?? '—'` | |
| Counts line | `{totalSets} sets logged` + ` · {skippedSets} skipped` when skippedSets > 0 | shows `0 sets logged` until full session loads |
| Note text | `session.note` (the basic session's note) | when note exists and not editing |
| `ADD NOTE` / `EDIT NOTE` | enters edit mode, seeds textarea with current note | not editing; label `EDIT NOTE` if note exists |
| Note editor textarea (3 rows) placeholder `How did it feel?` | local `noteInput` | editing |
| `SAVE` / `SAVING…` | `updateNote.mutateAsync({id, note: noteInput.trim() \|\| null})` then exits edit mode; optimistic cache patch with rollback on error; online-only (no offline branch) | editing; disabled + opacity 0.6 while pending |
| `CANCEL` (note editor) | resets noteInput to saved note, exits edit | editing; disabled while saving |
| `CONTINUE SESSION` (primary) | `setConfirmContinue(true)` | shown when `!confirmContinue` |
| helper `Pick up right where you left off` | static | with CONTINUE SESSION (`!confirmContinue`) |
| Confirm panel text `Resume where you left off — all logged sets stay intact.` | static | `confirmContinue` |
| `CONFIRM` / `WORKING…` | `reopenSession.mutateAsync(id)`: reopens (status -> in_progress, completed_at null, new started_at); caches patched; scheduler returns `active_session` -> GymSession. Online (reopenSession has no offline branch). | confirm panel; disabled + 0.6 opacity while pending |
| `CANCEL` (confirm) | `setConfirmContinue(false)` | confirm panel; disabled while pending |
Not present by design: no REDO / skip / new-session controls (B1 2026-10-10, removed). No Coach-gated items. No explicit offline messaging on this screen (note save and reopen are online-only; failures unhandled/silent).

---

### 9. due_today — several sessions in one day (TodayPage.tsx:355-389)
Appears when `entries.length >= 2` (e.g. a session moved onto a day that already has its own, or a moved-here planned row + today's virtual suggestion, or completed + planned etc.). Can include any mix of `completed_today`, `planned`, `suggest_from_plan`, `suggest_no_plan`.
List view (`selectedEntryIndex === null`): TodayHeader, then one tappable `DueTodaySummaryRow` per entry (TodayPage.tsx:485-532):
- Left: workout day name (completed -> from workoutDays by session.workoutDayId; suggest_from_plan -> workoutDays by weekPlan.workoutDayId; suggest_no_plan -> entry.workoutDay.name; planned -> `entry.workoutDay?.name`; fallback `—`).
- Right chip: `DONE` (completed_today; green) or `NOT STARTED` (all others, including planned).
- Tap -> `setSelectedEntryIndex(i)`.
Drill-in view: `completed_today` entry -> CompletedTodayScreen with `onBack`; others -> `renderNotStartedCard(entry, onBack)` (card with `← BACK`; §5). `← BACK` returns to list. Starting from a drilled-in card (START SESSION) -> active_session takes over (list gone). 
No eyebrow/heading for the list beyond TODAY header; no empty copy. If an in_progress session exists, the list is not shown (active_session wins).

---

### 10. rest_day (TodayPage.tsx:395-425; RestDayScreen gym/RestDayScreen.tsx:188)
Appears when: no in_progress, no (undismissed) missed queue, no due-today rows (effective date today, non-skipped) and no vacant virtual suggestion: i.e. today's weekday has no scheduled/resolvable workout day, OR today's scheduled slot's row was moved away. After dismissing the missed prompt this also applies.
RestDayScreen (full-height centered):
| Element | Copy | Condition |
|---|---|---|
| Moon glyph SVG | decorative | always |
| `REST DAY` (h1) | static | always |
| `WEEK {currentWeek} · {MESO NAME UPPERCASE}` | | always |
| Progress dots: one 8 px dot per planned session this week (count of non-null entries in `program.schedule`), filled accent for first `completedThisWeek` | | `plannedThisWeek > 0` |
| `{completed} OF {planned} SESSIONS DONE THIS WEEK` | | `plannedThisWeek > 0`; completedThisWeek = sessions in range [Monday of week, today] with status 'completed' (counts moved-in/out sessions by raw date; `useSessionsInRange`) |
Below RestDayScreen (only when `result.next` non-null): card `NEXT UP` / `<next workout name>` / due-in line: `TODAY` (days<=0), `TOMORROW` (1), `IN {n} DAYS` (n>1) (formatDueIn, TodayPage.tsx:476-480; next day always >= tomorrow so `TODAY` effectively unreachable). `next` null -> no card (no copy). No controls on this screen (no start-anyway or move). `rest_day.next` ignores moved/skipped sessions (template only).
Layout note: RestDayScreen uses `h-full` centering, then the NEXT UP card follows with negative top margin.
Loading for the dots count: `useSessionsInRange` default [] (dots render with 0 filled until loaded). Programs default [] -> no dots until loaded.

---

### 11. no_program / no_active_meso (TodayPage.tsx:429-450)
- `no_program`: no programs exist at all. `no_active_meso`: programs exist but no meso with status 'active', or active meso's program not found.
- TodayHeader; card text: `Create a program to get started` (no_program) / `Start a mesocycle to begin training` (no_active_meso); button `GO TO PROGRAM →` -> `navigate('/program')` (both variants, same destination).
- Note: this is the fallthrough branch (any result type not handled above would also render this with the "Start a mesocycle" text; in practice only those two reach it).

---

### 12. Sequence runs — SequenceTodayPage (gym/SequenceTodayPage.tsx:22) + sequenceSchedule/useSequenceScheduler
Entry: TodayPage when `activeMeso` exists and `scheduler.program.scheduleType === 'sequence'`. Props: today, todayLabel, activeMeso, programId (`scheduler.program!.id`).
Data (useSequenceScheduler.ts): workoutDays, sequence items (`useSequenceItems(programId)`, ordered slots: position + workoutDayId|null for rest), allWeekPlans, `useLastDoneOrSkippedSession(mesoId)` (single most recent done-or-skipped session, resolved to a slot via its week plan: `resolveLastEvent`), and sessions in last 7 days. Loading spinner (§2). No "missed sessions", no rest-day screen, no Move, no Preview, no due_today list, no no_program/no_active_meso (those handled earlier in TodayPage since activeMeso null falls to weekday path).

#### scheduleSequence() conditions (sequenceSchedule.ts:392-410), in order
1. Any session `in_progress` in last-7-day sessions -> **`active_session`** -> `GymSession` with `scheduleType="sequence"` (header shows `CYCLE n`; weekNumber = `weekPlan?.weekNumber ?? 1`; null render if workoutDay missing).
2. Any session `completed` with effectiveDate === today -> **`completed_today`** -> `CompletedTodayScreen scheduleType="sequence"` (eyebrow `SESSION COMPLETE · CYCLE {n}`). Only the first found; no list for multiple. (Same CONTINUE SESSION/note UI as §8.)
3. `resolveNextSlot(items, lastEvent)` null (no items, or every slot is rest) -> **`no_workouts`**: TodayHeader + card text `This sequence has no workouts yet — add one in the planner.` (no button).
4. Else **`next`** `{next: {workoutDayId, weekNumber (=cycle index), sequencePosition}, dueDate, isDue}`:
   - Next slot: walk items by position after last done/skipped slot, skipping rest slots (counting `restsBetween`), wrap increments cycle number. `lastEvent === null` (nothing ever done/skipped): first workout slot, cycle 1, dueDate null.
   - If last event's slot position no longer exists: first workout slot, cycle kept.
   - `dueDate`: lastEvent null -> null; last event skipped -> the skip's date (due same day); completed -> lastEvent.date + restsBetween + 1 days.
   - `isDue = dueDate === null || dueDate <= today`.
   - Not-done days never "miss" anything; same next slot keeps showing.

#### `next` card (SequenceTodayPage.tsx:155-219)
Renders null if workoutDay not found (blank). weekPlan = allWeekPlans match on (workoutDayId, weekNumber, sequencePosition) or null.
| Element | Copy / action | Condition |
|---|---|---|
| TodayHeader | `<todayLabel>` / `TODAY` | |
| Eyebrow | `CYCLE {next.weekNumber}` | always |
| Title | workoutDay.name | |
| `DELOAD` | static | `weekPlan?.isDeload` |
| Due line (formatDue, SequenceTodayPage.tsx:229-239) | `READY NOW` (dueDate null); not due: `DUE TOMORROW` (1 day) / `DUE IN {n} DAYS`; due: `DUE TODAY` (dueDate===today) / `OVERDUE BY {n} DAY` / `OVERDUE BY {n} DAYS` | always |
| Primary `START SESSION` (isDue) or `TRAIN ANYWAY` (not due); `…` while pending | `handleStart`: `planWeekThenFindId(meso.id, next.weekNumber, workoutDayId, weekPlan?.id ?? null, planWeek, fetchWeekPlans, next.sequencePosition)` then `createSession({mesoId, weekPlanId, workoutDayId, date: today})` -> active_session | disabled while `createSession.isPending \|\| planWeek.isPending` (text becomes `…`, opacity 0.6) |
| `SKIP` / `…` while skipping | `handleSkip`: plan the week row same as above, then `skipMissedSession({mesoId, weekPlanId, workoutDayId, date: today, existingSessionId: null})` -> inserts a 'skipped' session dated today; invalidates sessions + lastDoneOrSkipped; sequence advances to the next slot, due same day (dueDate = today) | disabled while `skipNext.isPending`; always offered regardless of due status |
No offline gating text on this page; start works offline (useCreateSession queues); skip is online-only (no offline branch) with no message on failure.

#### Weekday vs sequence differences (Today)
| Aspect | Weekday | Sequence |
|---|---|---|
| Entry | TodayPage `schedule()` | SequenceTodayPage `scheduleSequence()` |
| Unit label | `WEEK n` (cards, preview, GymSession, completed) | `CYCLE n` |
| Not-started card | START SESSION, PREVIEW SESSION, MOVE THIS SESSION | START SESSION (due) / TRAIN ANYWAY (not due), SKIP; no preview, no move |
| Due info | none on start card; rest day shows NEXT UP + `TOMORROW`/`IN n DAYS` | due line READY NOW / DUE TODAY / DUE TOMORROW / DUE IN n DAYS / OVERDUE BY n DAY(S) |
| Missed sessions | prompt for current-week past scheduled days | none ("Not training on a due day misses nothing") |
| Rest day | RestDayScreen + progress dots + NEXT UP | no rest screen: shows next workout with due line |
| Several per day | due_today list | not supported (first completed_today only) |
| Empty | no_program / no_active_meso card | no_workouts card; (no program/meso handled by weekday fallthrough) |
| Reference ("last time") panels | scheduleType 'weekday' | GymSession passes scheduleType 'sequence' (affects reference resolution) |

---

### 13. MoveSessionSheet as opened from Today (gym/MoveSessionSheet.tsx:297)
Opened only from the not-started card's `MOVE THIS SESSION` (§5) (also used by Plan's MoveSessionControl, out of scope). Props from Today: `workoutDayName`, `originalDate`, `currentDate=effectiveDate`, `today`, `isPending`, `onPick=handleMovePick`, `onClose`.
Bottom sheet over dimmed backdrop; tapping backdrop = `onClose`.
| Element | Copy / action | Condition |
|---|---|---|
| grabber | decorative | |
| `MOVE THIS SESSION` label | static | |
| X icon aria-label `Dismiss` | `onClose` | |
| Heading | `<workoutDayName>` | |
| Helper | `PICK TODAY OR A LATER DAY THIS WEEK` | always |
| `NO DAYS LEFT THIS WEEK` | static | `movable.size === 0` (session's original week is entirely past) |
| Day chips (Mon->Sun order): small `MON`..`SUN`, day-of-month number | `onPick(date)`; chip renders only for dates >= today within the Monday-anchored week of `originalDate` | rendered only if date in `movableDatesForWeekOf(originalDate, today)`; disabled if `isPending || isCurrent` |
| Chip sub-label `HERE NOW` | marks current effective date (disabled chip, dimmed) | `date === currentDate` |
| Chip sub-label `MOVE BACK` (accent) | marks original day (selecting it clears the move) | `date === originalDate && !isCurrent` |
Opacity 0.6 on non-current chips while pending. Week is always the week of the session's original `date`, never next week. Sheet closes immediately after pick (Today calls `setShowMoveSheet(false)`), except invalid picks (unreachable).

---

### 14. Offline indicators relevant to Today (summary)
- Nav strip `OFFLINE · SETS WILL SYNC ON RECONNECT` (all states, when navigator.onLine false).
- Not-started card: `MOVE THIS SESSION` disabled (0.5 opacity) and `REQUIRES A CONNECTION` shown (weekday card only).
- Preview reference panel: `OFFLINE · CACHED` when reference data came from cache (`isFromCache`).
- Start paths (`createSession`, `startMovedSession`, complete) queue to Dexie sync_queue when offline; `planWeekThenFindId` silently falls back to unplanned. Per-set pending/failed markers live in SetRow (GymSession), not Today screens.
- Online-only with no UI messaging: MARK SKIPPED, SKIP (sequence), note SAVE, CONTINUE SESSION confirm, move/clear.
- No dedicated error toasts/banners for any Today mutation failure.

---

### Gaps / uncertainties
- Variant count: task says 8; code has 10 weekday variants (listed in header). Sequence has 4.
- `showPreview`, `selectedEntryIndex`, `showMoveSheet`, `dismissMissed` are TodayPage-level state not reset on result change; e.g. after tapping START from the preview and later finishing, a later not-started card could re-open straight in the preview within the same mount (unclear: not verified in tests); `selectedEntryIndex` set while entries shrink (e.g. after starting/moving) could index a missing entry -> `entry.type` read on undefined (unclear; list changes usually go through active_session first).
- Query errors in useScheduler/useSequenceScheduler are not handled: shows spinner forever (derived from isLoading logic; no explicit error code path).
- No error UI for failed mutations on any Today control (start, skip, move, reopen, note, complete); await rejections unhandled in click handlers.
- Missed-queue key uses `missed.date` only (one per day).
- `completed_today` shows `basicSession.note` (list-query row); after note save, cache patch updates it; unclear whether list rows carry note when the list query omits it (fetchSessionsInRange omits setLogs but note appears to be included).
- If skipped-classified completion (all sets skipped) occurs, Today reverts to a start card (derived from scheduler rules); not explicitly tested here.
- Active-session view is GymSession; only its header/finish entry points are inventoried here. GymSession's full control set belongs to another inventory.
- `useInstallPrompt` (Nav INSTALL) internals not read.
- `RestDayScreen` completed count uses raw session `date` range (Mon..today), so moved sessions may be counted on original date; behaviour as coded, no further verification.

## 1.5 Workout screen: exercise card, set rows, MORE, stage rows
## Workout screen A: exercise card + set rows (inventory)

Source dir: `src/features/gym/`. All line refs are in that dir unless noted. Hook `useExerciseCardState.ts` is shared by `ExerciseCard.tsx` (plain card) and `SupersetBlock.tsx` (each member), so behaviour is identical per exercise; only arrangement differs.

Settings read by these components (settingsStore): `measureSetTime` (default false), `warmupDisplay` ('rows' default | 'tick'), `restTimerEnabled` (default true), `targetRestSeconds`. Per-exercise unit: `programExercise.weightUnit` else global default (`useWeightDisplay`).

---

#### ExerciseCard (plain card)  (ExerciseCard.tsx:20)
Order top to bottom, inside one bordered rounded card:

| Element | What it does | Visible when | Lives where |
|---|---|---|---|
| ExerciseHeader | see below | always | card top |
| PlanTargetsPanel (left column of 2-col grid) | see below | `showPlanTargets` = plan has >=1 group after warmup/stage filtering (`plannedGroups.length>0`, hook:194). When false the panel is absent and the Reference panel takes the full row | reference strip |
| ExerciseReference (LAST WEEK / EARLIER THIS WEEK / LAST TIME / FIRST TIME; owned by another inventory) | shows prior-session data; gets `today`, sessions, loading/error/cache/retry, scheduleType, mesocycleId, unit | always | reference strip (right col, or full width) |
| `WARMUP` heading (static, muted mono caps) + warmup SetRows | see Warmup row | `warmupRows.length>0` i.e. plan has >=1 `isWarmup` planned set (on a swapped card, only warmup rows that already have a log) | between reference strip and working sets |
| Planned SetGroups (one per plan head, plan order) | see SetGroup | one per planned head slot (hook:330-352). On a swapped card only rows with a logged head are kept | set list |
| Extra SetGroups (ADD SET rows) | same SetGroup with `plannedSet=null` | `extraSlotCount` slots; starts at max(logged extra heads, swappedFrom? plannedGroups.length:0); +1 per ADD SET tap; never shrinks | set list, below planned |
| `ADD SET` (Plus icon, dashed button) | `handleAddSet`: `extraSlotCount+1`, adds one blank extra input row (no DB write) | always (also on swapped card, not gated by session state) | bottom of set list |
| `SKIP REST OF EXERCISE` | sets `showSkipConfirm` true | `hasUnfinishedPlannedWork` = `!swappedFrom && some planned row has no logged head OR logged stages < planned stages` (hook:595). Hidden once all planned heads+stages are logged/skipped. Extra (ADD SET) rows never count | bottom |
| while skipping | button text becomes `SKIPPING…`, opacity .6, disabled | `isSkippingExercise` | same slot |
| Inline confirm (no modal): `CANCEL` / `CONFIRM SKIP` | CANCEL hides confirm; CONFIRM SKIP -> `handleConfirmSkip`: hides confirm, runs `handleSkipExercise`, errors only console.error'd. Both disabled while `isSkippingExercise` | `showSkipConfirm` | replaces the skip button in place. No explanatory copy in the confirm |
| SwapExerciseSheet (other inventory) | props: current exercise id/name (fallback text `this exercise`), muscleGroup (fallback `other`), `remainingSetCount`=`remainingPlannedCount` (unlogged planned heads + unlogged planned stages), onConfirm -> `handleConfirmSwap` (closes sheet, sets isSkipping, runs skip-rest-of-exercise, then `onSwap`), onClose | `showSwapSheet` | sheet |

**handleSkipExercise** (hook:535): for every planned row with no logged head, logs a skipped head (`isSkipped:true`, weight/reps/rir null, explicit setNumber continuing from logged-head count, stageKind as planned); then for each remaining planned stage logs a skipped stage (`isDropset:true, isSkipped:true`). Awaited sequentially. Each of these also runs `applyRestChain` (so the rest timer may start/stop) because it goes through handleLogHead/handleLogStage.

---

#### ExerciseHeader  (ExerciseHeader.tsx:5)
| Control / text | What it does | Visible when | Where |
|---|---|---|---|
| Exercise name (`ex?.name ?? '—'`) | static | always | header |
| Tempo text (`programExercise.tempo`, shown raw, mono, muted, tracking-widest) | display only, "not tracked" | tempo truthy; a swapped-in/extra exercise shows its own slot's tempo | beside name |
| Muscle group (`muscleGroup.toUpperCase()`) | static | always (renders empty if missing) | under name |
| `SWAPPED FROM <ORIGINAL NAME UPPERCASED>` with Repeat2 icon (10px) | static trace of swap | `swappedFromName` given (only swapped merged card) | under muscle group |
| Repeat2 icon button, aria-label `Swap exercise for this session` | opens SwapExerciseSheet (`setShowSwapSheet(true)`) | `onSwapClick` provided: ExerciseCard passes it only when `!swappedFrom`; SupersetBlock always passes it. Not passed by PreviewExerciseCard | header right |
| History icon button, aria-label `View exercise history` | `navigate('/exercise/<exerciseId>')` | always | header right |

---

#### PlanTargetsPanel  (PlanTargetsPanel.tsx:10)
- Heading `PLANNED RIR`.
- Rows: heads only (stages not listed), warmups filtered out, sorted by head.setNumber. Per row: set number; `RIR <n>` or `—` when targetRir null; weight target `<toDisplay(targetWeight)><unit>` only when `targetWeight != null` (muted); accent badge `+<n>` when the head has n planned stages.
- Empty: `NO PLAN` (can't normally show because ExerciseCard hides the whole panel when no groups; only reachable if groups empty, which is the same condition).
- Unit = exercise unit override else global.
- Not interactive.

---

#### SetGroup  (SetGroup.tsx:105)
One set = head SetRow + nested stage rows (indented, dashed left border `1px dashed`). Props decide state:

Stage kind for the group: `resolveStageKind(group ? logged head.stageKind : plannedSet.stageKind)` (null/legacy -> 'dropset'). Kind labels (`STAGE_KIND_LABELS`): `DROPSET`, `REST-PAUSE`, `MYO-REPS`, `CLUSTER`. `carryWeightKg` = `resolveStageCarryWeightKg(kind, group)` (null for dropset => blank; for the 3 carrying kinds, previous weight carried into next stage input; only given to the one next-to-log stage row).

**A. Head not yet logged (`group == null`)** (SetGroup:156-215)
1. Head SetRow in input mode (planned or extra), `currentLog=null`.
2. If `plannedStages.length>0 && !readOnly`: dashed nested block with ALL planned stage rows as **locked** SetRows (`isStage`, `isLocked`, `stageKind`), since head is not logged.
   - `readOnly` = `!!swappedFrom` (only on the planned section of a swapped card); suppresses these locked stage rows and stage entry.
3. No ADD STAGE / mark-as-dropset affordance until head is logged.

**B. Head logged (`group != null`)** (SetGroup:217-393)
1. Head SetRow in logged/skipped/editing mode (`currentLog=headLog`); edit -> `onUpdate(headLog.id,…)`, delete -> `onDeleteHead(group)`.
2. `RestTimerInline` under head if `restTimerStore.anchorId === headLog.id` and a rest period is running.
3. Nested block: each logged stage = SetRow (`isStage`, `currentLog=stage`, edit/delete per stage via `onDeleteStage(stage.id)`), `RestTimerInline` under a stage if anchored to it.
4. Stage-entry area, rendered only if `!isDeleting && !readOnly && canAddStageTo(headLog)` (`canAddStageTo` = head not skipped; a skipped head never gets stage entry). Then exactly one of:
   - (a) **Stage input row** (unlocked, loggable) when `addingStage || plannedStages.length > stages.length` (planned next stage auto-shows, no tap needed; key = next planned stage id or `unplanned-<n>`). Row gets `plannedSet = plannedStages[stages.length] ?? null`, `stageKind`, `carryWeightKg`, `restElapsed`. On LOG -> `onLogStage(headLog, params)` then `addingStage=false`.
   - (b) text button **`mark as dropset`** (lowercase, 10px, muted, min-h 36) when `stages.length===0 && !expectStage` (and not in (a)). Click -> `addingStage=true` (reveals same stage input row).
   - (c) button **`ADD STAGE`** (Plus icon, bold caps, min-h 36) otherwise: i.e. stages already exist, or `expectStage` is true. Click -> `addingStage=true`.
     - `expectStage` (card level): planned set: `plannedStages.length > loggedStages.length`; extra set: only on a swapped card, `(plannedGroups[i]?.stages.length ?? 0) > group.stages.length`; in SupersetBlock: `plannedStages.length > loggedStages.length`.
     - NOTE: when (a) is showing because of a planned next stage, (b)/(c) are not rendered at the same time. After the last planned stage is logged (plannedStages.length == stages.length) the (b)/(c) button returns.
   - Then **locked planned stage rows** for `plannedStages.slice(stages.length+1)` (every planned stage beyond the one unlocked in (a)); disabled, dimmed.
   - Cancel of manual stage entry: there is no dedicated cancel button on the stage input row (SetRow's own comment mentions "SetGroup's own cancel affordance" but none exists in the code). The stage input row can be abandoned only by leaving it empty; unclear: no way to close it after tapping ADD STAGE / mark as dropset except logging it. (Verified: `addingStage` is only set false in onLog and on isDeleting.)
5. `isDeleting` (head mid-cascade-delete): stage-entry area is hidden and `addingStage` reset.
6. Deleting a head cascades: stages deleted last-index-first, then head, then later heads renumbered (hook:474-515). Failure only console.error'd.

---

#### SetRow  (SetRow.tsx:83) - all states

Common: set number shown as two-digit `01`,`02` (mono). Weight unit `activeUnit` = `unitOverride ?? resolvedUnit`.

##### 1. Planned / current / extra input row (not logged, working set) (SetRow:999-1338)
Row root has `data-unlogged-set="true"` unless `isStage` (used for CURRENT SET jump), opacity .5 if `isLocked`.

Always on the row (default view):
| Element | What it does | Disabled / conditions |
|---|---|---|
| Set number `NN`, or `↳` when `isStage` | label; stage rows share head's number | - |
| Weight input (text, decimal) placeholder `0` (`···` while `lastLogsLoading`) | typed in `activeUnit`; accepts comma decimal; prefilled from last session head log at same position (`lastLog.weight` converted to active unit) once loaded and only if user hasn't typed; for a stage with `carryWeightKg` prefilled from carry weight | disabled when `lastLogsLoading` or `isLocked`; dimmed to .5 while loading |
| Unit label button (shows `kg` or `lbs`; aria-label `Log this set in <otherUnit>`) | toggles one-set logging unit override between exercise unit and other; accent+bold while overridden; re-converts prefilled value if untouched | disabled when `isLocked` |
| `×` | static | - |
| Reps input (number) placeholder `0` / `···` | prefilled from lastLog.reps | disabled when `lastLogsLoading` or `isLocked` |
| Primary button | one of: **`LOCKED`** (disabled, same style) when `isLocked`; **`START SET`** when `measureSetTime && !isTiming` (and not locked); **`LOG`** otherwise (`measureSetTime` off, or after START SET tapped) | see below |

Conditional lines under the row (all `pl-7`, muted mono xs):
| Text | Visible when |
|---|---|
| `TIMING SET · <m:ss>` (accent bold; `formatRestTime(setElapsed)`, ticks 1s) | `isTiming` (Start Set tapped, set not yet logged) |
| `Loading last session…` | `lastLogsLoading` |
| validation error (error color) `Enter weight and reps, or tap SKIP` | LOG tapped with empty/NaN weight or reps (working set requires both). Cleared on typing in weight/reps or on next successful LOG/SKIP. Also see edit error below |
| `TARGET WEIGHT <n><unit>` (n = `toDisplayWeight(targetWeight, resolvedUnit)`, always exercise's resolved unit, never the temp override) | `plannedSet?.targetWeight != null` |
| `TARGET REPS <x>` where x = number, range with en dash `8–12`, or `AMRAP` | `repTarget.type !== 'none'`, from `columnsToRepTarget(repMin, repMax, isAmrap)`: isAmrap -> AMRAP; repMin or repMax null -> none (hidden); repMin==repMax -> number; else range. There is no separate "AMRAP" badge anywhere else in these files |
| `TARGET RIR <n>` | `plannedSet?.targetRir != null` |
| stage-kind label text line: `REST-PAUSE` / `MYO-REPS` / `CLUSTER` (muted) | `isStage` and kind is not dropset (`stageLabel`); dropset stage shows nothing here (and its logged badge says `STAGE`) |
| Tag chips (muted bordered 9px, one per tag string, wrap) | `plannedSet.tags` non-empty; display only, never logged/copied. Shown on head rows and on stage rows that have a planned set with tags |
| `▼ MORE` / `▲ LESS` button (min-h 44, muted) | always rendered on input rows (including stage rows); `disabled` when `isLocked` (kept for shape) |

Order of lines under the row: TIMING SET, Loading…, error, TARGET WEIGHT, TARGET REPS, TARGET RIR, stage-kind label, tags, MORE.

###### MORE / LESS panel (`showExtra`, local per-row state, not persisted) (SetRow:1282-1337)
Everything it reveals, in order:
1. **`RIR`** label + small numeric input (placeholder `—`, 40px wide, 44px tall): achieved RIR for this set. Optional. Always shown when panel open (head and stage rows). Sent as `rir` (parseInt) or null.
2. **`SKIP`** button (bordered): `handleSkip` logs the set as skipped immediately (weight/reps/rir null, `isSkipped:true`, `isDropset:false`, setSeconds null, restSeconds via `resolveTiming`, stageKind as planned). **Hidden when `isStage`** (a stage has nothing planned to skip). No confirm. Also available on extra (ADD SET) rows and when a Start Set timer is running (SKIP calls resolveTiming, which stops the set timer and uses the frozen rest). Does not require weight/reps.
3. **Form rating chips**: label `FORM` + chips `RUSHED`, `NORMAL`, `CONTROLLED`, `EXTRA CONTROLLED` (`FORM_SCALE`, ordered low->high, horizontally scrollable, 44px tall). Tap selects; tapping the selected chip clears to none (null). Shown on head AND stage rows (comment: stage ratings recorded but excluded from average-form). Sent as `formRating`.
- Nothing else is behind MORE (no per-set tag editing, no note, no dropset toggle - the "dropset" comment in the code is stale; stages come from SetGroup).
- MORE is not hidden when offline, deload, etc.; only `isLocked` disables it. `RIR`/FORM values are not reset when the panel is closed (state persists while row is mounted, still sent on LOG).
- MORE panel is NOT present on logged rows, warmup rows.

###### Start Set flow (`measureSetTime` on) (SetRow:145-175, 931-938)
1. Row shows `START SET` instead of LOG (stage rows too; locked rows show LOCKED).
2. Tap START SET: freezes rest elapsed (`frozenRestSeconds` = seconds since rest timer start, or null), stops the rest timer (`restTimerStore.stop()`), starts `setTimerStore`, sets `isTiming`. Row now shows `LOG` button plus `TIMING SET · m:ss` line.
3. Tap LOG: `setSeconds` = elapsed since START, `restSeconds` = frozen value; set timer stopped.
4. If never tapped START SET (or setting off): `restSeconds` = live `restElapsed`, `setSeconds` null.
5. SKIP while timing: stops timer, uses frozen rest.
6. Timing state is local to that row; no cancel-timing control. Collapsing the row/unmounting loses `isTiming` (store timer may keep running; unclear whether anything stops it then).
7. Warmup rows never offer Start Set.

###### LOG payload (handleLog)
weekPlanSetId = plannedSet id or null; weight converted to kg (`toStorageWeight`); reps; rir; `isDropset = isStage`; `enteredUnit = activeUnit===resolvedUnit ? null : activeUnit`; `formRating`; `stageKind = plannedSet?.stageKind ?? null`. Then card-level handler adds exerciseId, setNumber (= logged heads+1 or override), parentSetId/stageIndex, and applies rest chain (starts/stops the rest timer), and GymSession anchors the inline rest timer to the new log id.

##### 2. Locked planned stage row (`isStage && isLocked`)
Same shape as the input row but: opacity .5; `↳`; weight and reps inputs disabled; unit toggle disabled; the primary button reads `LOCKED` (disabled, accent fill); `▼ MORE` disabled; handlers short-circuit. Still shows TARGET WEIGHT / TARGET REPS / TARGET RIR / kind label / tags from its planned stage row. No data-unlogged-set marker (stage). Which stages are locked: all planned stages while head unlogged (SetGroup A); after head logged, all planned stages after the next one (SetGroup B). "Unlocks" when the previous stage is logged: SetGroup then passes it as the unlocked stage input row (a) instead.
- Locked stage rows have no prefill (lastLog null, carryWeightKg not passed).

##### 3. Unlocked stage input row
Same as input row with: `↳` number, `isDropset:true` on log, no SKIP in MORE, no `data-unlogged-set`, carry weight prefill for rest-pause/myo-reps/cluster, kind label line, TARGET lines from its own planned stage row (if planned), `restElapsed` passed for rest.

##### 4. Logged row (read-only) (SetRow:780-910), working set head or stage
- Left 3px accent border; solid for head, dashed for stage.
- Number `NN` (accent for head, muted for stage; stage uses head's number).
- Text: `<weight><unit> × <reps>` (weight `—` if null; unit = `currentLog.enteredUnit ?? resolvedUnit`), optional muted ` @ RIR <n>` when `rir != null`.
- Accent badge `STAGE` (or `REST-PAUSE`/`MYO-REPS`/`CLUSTER`) after the text when `isStage`.
- Sync status icon (exclusive): `SYNC FAILED` (error tint; title tooltip `Failed to sync after 3 attempts — this set only exists on this device`) if id in `offlineStore.failedIds`; else `SYNC` (accent-muted) if in `pendingIds` (queued offline / in flight); else check icon.
- Form rating, setSeconds, tags, targets, tempo NOT shown on logged row.
- Controls: pencil (aria `Edit set`), trash (aria `Delete set`), 28px. Always available (no gating by session state/week/offline).
- Delete confirmation (inline, replaces pencil+trash): `CANCEL` / `DELETE` (error tint). No message copy. DELETE calls `onDelete` (head: cascade-deletes its stages and renumbers later heads; stage: plain delete; warmup: plain delete).

##### 5. Skipped row (SetRow:599-618)
Number `NN` + `SKIPPED` (muted, tracking-widest). No edit, no delete, no sync badge, no way to un-skip. Skipped head => no stage entry. Skipped stages (from skip-rest-of-exercise) render the same `SKIPPED` row (stage uses same row; no `↳` or STAGE badge in skipped form).

##### 6. Editing a logged row (SetRow:621-777)
Tap pencil. Replaces row with:
- Number (accent), weight input (autoFocus, accent border, unit label non-tappable `editUnit`), `×`, reps input, `SAVE`.
- Second line: `RIR` + numeric input (placeholder `—`), `CANCEL`.
- Third: `FORM` chips (same four, tap-again clears).
- Error text `Enter a valid weight` if weight NaN (empty weight allowed -> null).
- SAVE: `onUpdate({weight, reps, rir, formRating})`; weight goes through `resolveEditedWeightKg` (no drift if display value unchanged); reps/rir empty -> null; no min validation on reps. No unit override while editing (stays in logged unit). CANCEL discards.
- Applies to head and stage logged rows alike. Not offered for skipped rows.

##### 7. Warmup row (`isWarmup`) (SetRow:213-586). Rendered by ExerciseCard/SupersetBlock directly, never via SetGroup.
Number = index within warmups (`01`..). No stage machinery, RIR, MORE, SKIP, targets, tags, Start Set, unit toggle, locked, lastLog prefill.
- Not logged, `warmupDisplay==='rows'` (default): number, weight input (placeholder `0`, static unit label = resolved unit), `×`, reps input (`0`), `LOG`. Both fields optional: empty -> null, no validation error. Unit is resolved unit (no override). Payload `isWarmup:true`, rir null, enteredUnit null.
- Not logged, `warmupDisplay==='tick'`: whole row is a button (bordered): number, `WARMUP`, empty square icon; tap logs it immediately with null weight/reps.
- Logged: number, `<weight><unit> × <reps>` (if both non-null) else `DONE`; small accent tag `WARMUP`; sync status (same SYNC FAILED / SYNC / check); pencil only in rows mode (`warmupDisplay !== 'tick'`); trash always (in tick mode it acts as untick). Delete confirm same inline `CANCEL`/`DELETE`.
- Editing (rows mode only): weight, reps, `SAVE`, `CANCEL`; error `Enter a valid weight`; sends weight/reps only.
- RestTimerInline appears under a warmup row whose log is the rest anchor.
- Warmups are not counted in set numbering, plan panel, or last-session prefill (filtered in hook).
- No ADD WARMUP control exists.

##### 8. Extra / added row (ADD SET)
SetGroup with `plannedSet=null`: identical input row (prefilled from last session head at same display position) but no TARGET lines/tags (no plan), `weekPlanSetId` null. Appears below all planned groups. MORE: RIR, SKIP, FORM all available. Can have stages (via `mark as dropset`/`ADD STAGE`); `expectStage` only on swapped cards. Logged extras are in the Extra section ordered by setNumber. Numbers: display number continues after planned (`displayNumber` = logged heads + unlogged seen + 1).

##### 9. "Current" set
No separate visual state on the row itself. "Current" = the first `[data-unlogged-set]` in DOM order (first non-stage unlogged input row; warmup rows and stage rows are unmarked).

---

#### RatingChips  (RatingChips.tsx:14)
Props scale/value/onChange/label. Label text above (`FORM`), row of 44px chips, horizontal scroll (`hide-scrollbar`), active chip accent fill; tapping active chip deselects (null). Only usage in these files: FORM (`RUSHED`, `NORMAL`, `CONTROLLED`, `EXTRA CONTROLLED`). `ratingScales.ts` also defines ENERGY (NONE, LOW, NORMAL, HIGH, SUPREME) and PUMP (NONE, SOME, GOOD, EXTREME), not used here.

#### RestTimerInline  (RestTimerInline.tsx:20)
Text `REST <m:ss>` (muted, bold, tracking-widest, indented) under the row whose log id equals rest-timer `anchorId`, only while `restTimerEnabled` setting is on and `startedAt` set. Read-only, 1s tick. Rendered under: logged head, logged stage, logged warmup. Not rendered under unlogged rows. (The floating `RestTimer` is a separate component, other inventory.) When the rest chain resolves to "no timer" the store is stopped so nothing shows.

---

#### Scroll-to-current-set (useScrollToCurrentSet.ts; button at GymSession.tsx:743)
- Floating pill button, fixed bottom-center above bottom nav: arrow-up/arrow-down icon + `CURRENT SET`.
- Visible only when the first `[data-unlogged-set]` row exists and is outside the `<main>` scroll viewport; arrow up if above, down if below. Hidden when in view or when no unlogged set remains.
- Tap: smooth scroll so row sits at top quarter of viewport.
- Re-evaluated by MutationObserver, scroll and resize. Container is the exercises container; when SessionComplete is shown (FINISH SESSION) container is gone and the button disappears.
- In a superset the DOM order is round-major so it visits A1, B1, A2, B2...

---

#### SupersetBlock  (SupersetBlock.tsx:134)
Rendered by GymSession for 2+ consecutive exercises sharing `supersetBlockId`, except a member with a confirmed session swap, which renders as its own merged single card instead.
| Element | Notes |
|---|---|
| Header strip: Link2 icon + `SUPERSET · <n> EXERCISES` | always |
| Per member (in order): letter badge `A`,`B`,... (`#27`+ after Z), then ExerciseHeader (swap button always shown), PlanTargetsPanel (if showPlanTargets) + ExerciseReference, then that member's `WARMUP` section (same as plain card, only if it has planned warmups) | warmups sit above the rounds, not inside |
| Rounds: `ROUND <n>` heading per round; inside each round one cell per member: label `<LETTER> · <EXERCISE NAME UPPERCASED>` (`—` if no name) then that member's SetGroup | round grid from `buildSupersetRounds` (unequal member lengths handled: extra ADD SET rows extend that member and may add trailing rounds). Planned warmups excluded from rounds |
| Per-member action section at bottom: label `<LETTER> · <NAME>`, `ADD SET`, `SKIP REST OF EXERCISE` (+ `CANCEL`/`CONFIRM SKIP`, `SKIPPING…`) | same conditions per member (`hasUnfinishedPlannedWork` per member state) |
| SwapExerciseSheet per member | on `showSwapSheet` |
Differences from plain card: no `readOnly`/`swappedFrom` in a block; stage `expectStage` = planned stages > logged; each SetGroup log call passes `supersetContext` (endsRound = last cell of round; isFinalRound; block's `restWithinRoundSeconds`/`restAfterRoundSeconds`) into the rest chain, so the rest timer may be suppressed within a round. Last-session logs fetched per member via `useLastSessionLogs`.

---

#### Read-only swapped card ("merged" card) (ExerciseCard with `swappedFrom`)
GymSession renders one card in the original slot's position for the replacement exercise; `plannedSets` is the ORIGINAL exercise's plan, logs include both exercise identities.
- Header: replacement name, plus `SWAPPED FROM <ORIGINAL>`; swap icon NOT shown (cannot swap again); history icon goes to replacement's history.
- Planned section: only rows with a logged head (unlogged planned rows dropped, including warmups); these SetGroups are `readOnly`: no ADD STAGE / mark as dropset, no locked planned stage rows; existing logged stages still show. Logged rows can still be edited/deleted (pencil/trash) - deleting a head cascades and renumbers within same exerciseId only; a deleted planned row disappears rather than reopening input.
- `SKIP REST OF EXERCISE` never shown (`hasUnfinishedPlannedWork` false).
- Extra section is pre-seeded with `plannedGroups.length` blank extra input rows (the replacement's own sets; shape mirrors original, weights/reps blank except last-session prefill); `expectStage` true for extras whose same-index original had more stages than logged, so `ADD STAGE` (not `mark as dropset`) shows after logging the head. `ADD SET` still available.
- Header reference panel: replacement's reference sessions.

---

#### Conditions matrix

| Condition | Effect in these components |
|---|---|
| Planning type (program/week-plan vs none) | No component here branches on a "planning type" field. Effect only via data: no planned sets => `PlanTargetsPanel` hidden, only extra rows + ADD SET; plan fields drive TARGET WEIGHT/REPS/RIR, tags, stage kind, warmups, planned stages, rest overrides |
| Schedule type (weekday vs sequence) | Not used in set rows/cards. Only passed to ExerciseReference (`referenceScheduleType`, default 'weekday' in SupersetBlock) and the GymSession header label (`CYCLE n` vs `WEEK n`, not in my files) |
| Superset | Cards replaced by SupersetBlock (see above); rest chain gets round context; per-member ADD SET/SKIP moved to bottom section; swap allowed per member |
| Deload | No gating in SetRow/SetGroup/ExerciseCard/hook/Superset. Only GymSession header text `DELOAD · ` prefix when `weekPlan.isDeload` (other inventory). Targets that a deload plan carries show like any plan |
| Offline | No controls hidden/disabled. Logged rows show `SYNC` (pending) / `SYNC FAILED` (3 failed attempts; tooltip text above) instead of check icon. Logging remains instant (mutateAsync result awaited for id). Last-session prefill may be missing/loading; `Loading last session…` while `lastLogsLoading`. (Offline program-exercise fallback lives in GymSession.) |
| Session state | No `session ended/read-only` gating in these components: all edit/delete/log controls are always live. FINISH SESSION swaps the whole container to `SessionComplete` (other inventory). Past/future week gating is not in these files |
| `measureSetTime` | LOG becomes START SET -> LOG + TIMING SET line; working and stage rows only |
| `warmupDisplay` | 'rows' = inputs+LOG, edit allowed; 'tick' = single tap row, no edit |
| `restTimerEnabled` | off => RestTimerInline never renders (timer logic still runs) |
| `lastLogsLoading` | weight/reps inputs disabled, placeholders `···`, `Loading last session…` |
| `isLocked` | see locked row |
| `isDeleting` | stage entry hidden on that group |
| Coach user only | nothing in these files |
| Exercise unit vs override | per-set unit toggle; logged rows show unit the set was entered in |

---

#### Not present / explicitly absent (checked)
- No per-set `⋯` menu anywhere (only `▼ MORE`/`▲ LESS`, pencil, trash).
- No per-set note field, no "mark as dropset" toggle on the row (it is the SetGroup text button), no AMRAP-specific input (AMRAP only appears as `TARGET REPS AMRAP`), no un-skip, no warmup add, no tag editing, no toasts in these components (errors are console-only except the inline validation strings), no confirm dialogs besides inline `CANCEL`/`DELETE` (set delete) and `CANCEL`/`CONFIRM SKIP` (skip rest of exercise).

#### Gaps/uncertainties
- No way to cancel a manually opened stage input row (ADD STAGE / mark as dropset) code-wise; SetRow comment references "SetGroup's own cancel affordance" which does not exist in SetGroup.tsx.
- Whether the set timer (`setTimerStore`) keeps running if a timing row unmounts is not handled in these files.
- Swap sheet, ExerciseReference, RestTimer (floating), WarmupRoutineChecklist, GymSession chrome are outside this file's scope.
- Past/future week or ended-session read-only behaviour: not found in these components (may exist in GymSession/TodayPage).
- `rest chain` details (what rest target is chosen) are in `restChain.ts`, not enumerated here.

## 1.6 Workout screen: shell, reference panel, sheets
## Workout screen shell and panels (inventory B)

Scope: everything on the live workout screen outside SetRow/SetGroup/ExerciseCard internals. All paths are under `/home/user/overload-v2/src/` unless noted. "SetRow/SetGroup internals" are another agent's.

Facts that apply across the whole inventory:
- **There is no session-level or exercise-level "⋯" menu anywhere** in these files. No overflow menu exists on the session header, ExerciseHeader, or the cards. Exercise-level actions are plain visible buttons (see ExerciseHeader and the card footers).
- **There are no `window.confirm` / `alert` dialogs.** The only confirmations are: (a) inline SKIP REST OF EXERCISE confirm row, (b) the CONFIRM SWAP / CONFIRM ADD step inside SwapExerciseSheet, (c) the SessionComplete screen (FINISH SESSION is a two-step flow, not a dialog).
- **There is no collapse/expand in ExerciseReference.** It is always fully rendered. The only "expand" is the SetRow ▼ MORE drawer, which is not in scope.
- **GymSession has no loading, error, or empty state of its own.** If `programExercises` and `cachedExercises` are both empty it simply renders no cards (header, ADD EXERCISE and FINISH SESSION still render). Loading and error states belong to callers (see "Callers").
- **GymSession has no offline banner of its own.** The only offline banner visible during a workout is the global Nav strip (see "Offline").
- **There is no confirm dialog on FINISH SESSION.** It swaps the whole screen to SessionComplete (which has a BACK TO SESSION button).

---

### 1. Callers (what mounts the workout screen) — context only

#### TodayPage -> GymSession  (features/gym/TodayPage.tsx:49-102)
| Element | Behaviour | Visible when |
|---|---|---|
| Spinner (24px ring, `animate-spin`, no text) | Full-height centered loading state | `scheduler.isLoading` (TodayPage.tsx:49-58) |
| `<GymSession …/>` | Props: sessionId, workoutDay, weekPlan, weekNumber=`currentWeek`, today. `scheduleType` not passed, so defaults to `'weekday'` | `result.type === 'active_session'` AND a workoutDay matching `session.workoutDayId` is found. weekPlan = `currentWeekPlans` match by workoutDayId, else `allWeekPlans` match by `session.weekPlanId`, else null (TodayPage.tsx:85-101) |
| Renders nothing (`null`) | blank screen | active_session but workoutDay not found (TodayPage.tsx:92) |

#### SequenceTodayPage -> GymSession  (features/gym/SequenceTodayPage.tsx:38-65)
- Spinner identical to the above while `scheduler.isLoading || !scheduler.result`.
- `<GymSession scheduleType="sequence" weekNumber={weekPlan?.weekNumber ?? 1} weekPlan=allWeekPlans.find(id === session.weekPlanId) ?? null …/>` when `result.type === 'active_session'` and workoutDay found; `null` if workoutDay not found.
- Selected by TodayPage when `scheduler.activeMeso && (scheduler.program?.scheduleType ?? 'weekday') === 'sequence'` (TodayPage.tsx:68).

---

### 2. GymSession — the shell  (features/gym/GymSession.tsx:168)

Top-to-bottom render order (GymSession.tsx:484-774), wrapper `div.pb-24`:
1. Session header
2. `<RestTimer />` (floating-in-flow rest timer)
3. `<WarmupRoutineChecklist />`
4. Exercise cards container (`px-4 space-y-4`): render units (SupersetBlock or ExerciseSection), then extra-exercise cards
5. ADD EXERCISE button
6. FINISH SESSION button
7. CURRENT SET floating button (fixed)
8. WorkoutSidebarSheet (conditional)
9. SwapExerciseSheet mode="add" (conditional)

Alternate full-screen state: `showComplete === true` replaces everything with `<SessionComplete>` (GymSession.tsx:425-427).

#### 2.1 Session header  (GymSession.tsx:487-535)
| Control / text (exact) | What it does | Visible when | Lives where |
|---|---|---|---|
| `WEEK {weekNumber}` or `CYCLE {weekNumber}` (small mono caps, muted) | Static label. `CYCLE` if `scheduleType === 'sequence'`, else `WEEK` | Always | Header, line 1 |
| `DELOAD · ` prefix (precedes WEEK/CYCLE) -> e.g. `DELOAD · WEEK 4` | Static prefix | `weekPlan?.isDeload` truthy (GymSession.tsx:493). Not shown when weekPlan is null | Header, same line as above |
| `{workoutDay.name}` (h1, 3xl black) | Static | Always | Header |
| `IN PROGRESS` (accent mono caps) | Static | Always (GymSession only mounts for an in_progress session; no condition in code) | Header |
| `{formatRestTime(duration)}` e.g. `45s`, `12min 3s` (muted mono caps) | Live elapsed seconds since `session.startedAt`, ticks every 1s (`useSessionDuration`, useSessionDuration.ts). Format from lib/formatRestTime: `<60s -> "45s"`, else `"{m}min {s}s"` (so 1h+ shows e.g. `75min 0s`, no hours) | Always rendered; shows `0s` until `session.startedAt` is available | Header, below IN PROGRESS |
| `COACH` button (bordered, mono, small) | Sets `showSidebarSheet=true`, opens WorkoutSidebarSheet | **Coach user only**: `isCoachUser(user?.id)` = `VITE_COACH_USER_ID` env set AND equals the user id (features/coach/coachGate.ts) | Header, right side |

No finish button in the header; the finish button is at the bottom of the scroll (2.5). No duration-based action. No online/offline indicator in the header.

#### 2.2 Floating rest timer slot
`<RestTimer />` rendered unconditionally between header and warmup checklist; see section 6.

#### 2.3 Exercise list composition  (GymSession.tsx:547-700)
Source list: `sortedExercises` = `activeExercises` sorted by `position`.
- `activeExercises = programExercises.length > 0 ? programExercises : cachedExercises` (GymSession.tsx:266).
- `programExercises = weekPlan?.exercises ?? fallbackProgramExercises` (week plan's own list when a week plan exists, else the program's exercises).
- `cachedExercises` is the Dexie fallback, filled only when `!isOnline && programExercises.length === 0` (cached week plan exercises first, else cached workout day exercises) (GymSession.tsx:248-263).

Render units (GymSession.tsx:322-352):
- **SupersetBlock** when 2+ consecutive sorted exercises share the same non-null `supersetBlockId` AND none of them has a recorded swap (`swapByProgramExerciseId.has(pe.id)`).
- **Single** (ExerciseSection -> ExerciseCard) otherwise. A block run of 1 is rendered as single. An exercise with a confirmed swap is always a single (it leaves its block).
- Single, swapped (`swapByProgramExerciseId.get(pe.id)` exists): one merged card in the original's position. `programExercise = {...pe, exerciseId: replacement.id, exercise: replacement}`, `plannedSets` stay the ORIGINAL's, `linkedExerciseIds=[swap.originalExerciseId]`, `swappedFrom={exerciseName: swap.originalExerciseName}`. Reference sessions are looked up by the replacement id.
- Single, normal: `plannedSets` = weekPlan.sets filtered by `programExerciseId === pe.id`, sorted by setNumber (empty array when no weekPlan).
- **Extra (unplanned) exercise cards** appended after all units (GymSession.tsx:667-699): synthetic ProgramExercise `id: extra-{exerciseId}`, `weightUnit:null`, `plannedSets=[]`, `programSets=[]`. Two sources, deduped by exercise id:
  1. Legacy pre-migration-025 swaps: any current-session log whose `log.exercise` exists, whose exerciseId is not a template exercise id and not a recorded swap replacement id. Appears only after >=1 set is logged.
  2. This session's `addedExercises` (ADD EXERCISE). Appear immediately on pick. Held in local React state only (lost on refresh until a set is logged, then log-driven detection brings the card back).
- A per-block `blockRest` (`supersetBlockRests` lookup by block id) and `allProgramSets` are fetched once per screen (`useProgramSets`, `useSupersetBlockRests`) and handed down; no UI of their own.

Per-card props from the shell (all cards): `today`, `referenceSessions` (per exercise id from the batched query, `[]` if none), `referenceLoading`, `referenceMesocycleId=session?.mesocycleId ?? null`, `referenceScheduleType=scheduleType`, `referenceIsError`, `referenceIsFromCache`, `onRetryReference`, and handlers `onLog/onUpdateSet/onDeleteSet/onSwap`.
- `onLog` (handleLog) also sets the rest-timer anchor to the logged row's id (`useRestTimerStore.setAnchor(log.id)`), which drives RestTimerInline placement.
- `onSwap` (handleSwap) calls `recordSwap.mutate({programExerciseId, originalExercise, replacementExercise})`; no-op if `programExercise.exercise` is missing.

Empty state of the exercise list: **none** (no copy). With no exercises, the cards container is an empty div.

#### 2.4 ADD EXERCISE button  (GymSession.tsx:706-720)
| Control | What it does | Visible when | Lives where |
|---|---|---|---|
| `+ ADD EXERCISE` (Plus icon 13px + text `ADD EXERCISE`, dashed border, min-height 48, full width) | Sets `showAddExerciseSheet=true` -> opens SwapExerciseSheet in `mode="add"` with `excludeExerciseIds=activeExerciseIds` | Always (no online/offline, planned/unplanned or count condition). Never disabled | Inline, below the last card, above FINISH SESSION |

`activeExerciseIds` = every `activeExercises` exerciseId + every recorded swap's replacement id + every extra exercise id (so no duplicate card per exercise identity).
`handleAddExercise(exercise)`: appends to `addedExercises` (deduped by id) and closes the sheet. Nothing is written to the DB by adding; the card exists locally until its first set is logged.

#### 2.5 FINISH SESSION button  (GymSession.tsx:723-735)
| Control | What it does | Visible when | Lives where |
|---|---|---|---|
| `FINISH SESSION` (full-width, 2px border-strong, mono, black weight) | `setShowComplete(true)` -> renders SessionComplete in place of the whole screen. Writes nothing yet | Always. Never disabled. Not conditional on any sets being logged | Inline, bottom of scroll, below ADD EXERCISE |

#### 2.6 CURRENT SET floating button  (GymSession.tsx:743-760, hook useScrollToCurrentSet.ts)
| Control | What it does | Visible when | Lives where |
|---|---|---|---|
| `CURRENT SET` pill with ArrowUp or ArrowDown icon (13px), accent background, fixed, centered horizontally, `bottom: calc(96px + env(safe-area-inset-bottom))`, z-index 30 | Smooth-scrolls `<main>` so the first unlogged set row sits ~25% from the top of the scroll viewport | Only while the "current set" is scrolled out of view of `<main>`: `direction` non-null. Target = first DOM element with `data-unlogged-set` inside the exercises container (first not-yet-logged, non-stage SetRow in DOM order). `direction='up'` (ArrowUp) when the row is above the viewport, `'down'` (ArrowDown) when below. Hidden when the row is visible or no unlogged row exists. Hidden while SessionComplete is showing (container unmounted) | Floating, bottom-center |

#### 2.7 Sheets mounted by the shell
- `WorkoutSidebarSheet` when `showSidebarSheet` (Coach user only can set it) — section 8.
- `SwapExerciseSheet mode="add"` when `showAddExerciseSheet` — section 7.

#### 2.8 Finish flow  -> SessionComplete  (features/gym/SessionComplete.tsx)
Entered only via FINISH SESSION (`showComplete`). Full-screen replacement (`px-4 pt-8 pb-24`); header/rest timer/cards are unmounted but GymSession stays mounted (hooks incl. auto-finish persist).
| Element (exact text) | Behaviour | Visible when |
|---|---|---|
| CheckCircle icon (28px, accent) + h1 `NICE WORK` | Static | Always |
| Stat tile `SETS LOGGED` + number | `session.setLogs.filter(!isSkipped).length` (0 if no data). NOTE: counts warmup logs and stages too, since it filters only on isSkipped | Always |
| Stat tile `SKIPPED` + number | `setLogs.filter(isSkipped).length` | Only when `skipped > 0` |
| RatingChips `ENERGY (OPTIONAL)` (ENERGY_SCALE, features/gym/ratingScales.ts) | Sets local energyRating (EnergyRating or null); prefilled once from `session.energyRating` if non-null | Always |
| RatingChips `PUMP (OPTIONAL)` (PUMP_SCALE) | Sets local pumpRating; prefilled once from `session.pumpRating` | Always |
| Label `SESSION NOTE (OPTIONAL)` + textarea, 3 rows, placeholder `How did it feel?` | Local note; prefilled once from `session.note` if non-null | Always |
| `COMPLETE SESSION` button (accent filled) | `completeSession.mutateAsync({id, note: note.trim() || null, energyRating, pumpRating})`. Online: `completeSession()` service call. Offline: queued to Dexie `sync_queue` (upsert v2_sessions, status computed 'completed'/'skipped' from cached logs, completed_at derived) + `addPending(id)`; resolves normally. onSuccess updates the cached session status and invalidates v2_session, v2_sessions, v2_history, progress and reference caches. The scheduler then stops reporting an active_session (what the caller shows next is outside this file: CompletedTodayScreen etc.) | Always. Disabled while `completeSession.isPending` (opacity .6) |
| Label becomes `SAVING…` | Pending text | While pending |
| `BACK TO SESSION` button (outlined, muted) | `onBack` -> `setShowComplete(false)`, returns to the workout screen | Always. Never disabled (even while saving) |
- No error text rendered on completion failure: **unclear / absent** — `handleComplete` awaits `mutateAsync` with no try/catch and no error UI (an unhandled rejection would occur on failure).
- No success toast on manual completion.

#### 2.9 Auto-finish  (features/gym/useAutoFinishSession.ts, called at GymSession.tsx:220)
No UI element except one toast. Behaviour:
- Setting: `useSettingsStore.autoFinishMinutes`; disabled when null.
- Runs only if `session.status === 'in_progress'` and `weekPlan?.sets.length > 0` (so never for a session with no week plan / no planned sets).
- Checks immediately then every 30s. Does nothing until `autoFinishMinutes` minutes after the hook armed (mount, or session id change) — the "grace window".
- Fires when EVERY planned set id (`weekPlan.sets[].id`, includes warmups and stage rows) has at least one log with that `weekPlanSetId` AND the latest `loggedAt` across all logs is older than `autoFinishMinutes`.
- Action: `completeSession.mutate({id, note: session.note})` (no ratings). onSuccess toast: **`Session completed automatically`** (toastStore). onError resets the trigger so it can retry.
- It runs even while the SessionComplete screen is open (hook lives in GymSession).

#### 2.10 Loading / error / offline states of the shell
- No spinner or skeleton in GymSession. Loading of per-exercise history is indicated only by ExerciseReference's `···` (section 4) and `lastLogsLoading` passed into SetRow (not in scope).
- No error banner for session/exercise fetch failures. Only reference-query errors are surfaced (ExerciseReference `COULDN'T LOAD REFERENCE`).
- Offline (see section 10).

#### 2.11 Priming/offline data effects (no UI)
- Online + user + >=1 program exercise: `primeOfflineCache` best-effort (errors swallowed).
- Offline + empty programExercises: loads `cachedExercises` from Dexie (`db.week_plans` then `db.workout_days`).

---

### 3. ExerciseHeader  (features/gym/ExerciseHeader.tsx:5)
Used by ExerciseCard (plain/merged cards) and SupersetBlock (per member). Also by PreviewExerciseCard (read-only, `onSwapClick` omitted).
| Element (exact) | What it does | Visible when | Lives where |
|---|---|---|---|
| Exercise name (`ex?.name ?? '—'`), bold | Static | Always | Header left |
| Tempo text (`programExercise.tempo`, raw string, mono caps muted) beside the name | Static, not tracked | Only when `programExercise.tempo` is truthy (null/undefined/empty renders nothing). A swapped-in or extra exercise shows its slot's tempo; extras have none (synthetic object) | Header, right of the name |
| Muscle group (`ex?.muscleGroup?.toUpperCase()`) | Static | Always rendered (empty if no muscleGroup) | Header, under the name |
| Repeat2 icon (10px) + `SWAPPED FROM {ORIGINAL NAME UPPERCASED}` | Static trace of a swap | Only when `swappedFromName` provided = card is a merged swapped card (`swappedFrom` set) | Header, under muscle group |
| Repeat2 icon button, 28x28, `aria-label="Swap exercise for this session"` (icon only, no text) | Opens the swap sheet: `setShowSwapSheet(true)` | Plain ExerciseCard: only when NOT `swappedFrom` (`onSwapClick={swappedFrom ? undefined : …}` ExerciseCard.tsx:78). SupersetBlock members: always. Not in read-only preview. No online/offline gating, never disabled | Header, right icon cluster (first) |
| History icon button, 28x28, `aria-label="View exercise history"` | `navigate('/exercise/{programExercise.exerciseId}')` (leaves the workout screen). On a merged swapped card the id is the replacement's | Always | Header, right icon cluster (second) |

No ⋯ menu, no remove-exercise, no reorder, no per-exercise notes control. The only exercise-level actions in the whole card are: swap icon (header), ADD SET, SKIP REST OF EXERCISE (card footer, section 3.1).

#### 3.1 Card-level composition of ExerciseCard (ordering, conditions; set rows excluded)  (features/gym/ExerciseCard.tsx:72-296)
Order inside the card (border-wrapped `rounded-xl`):
1. ExerciseHeader
2. Reference row (bottom border): two-column grid `1fr 1fr` of [PlanTargetsPanel | ExerciseReference] when `showPlanTargets`; otherwise just ExerciseReference full width. `showPlanTargets = plannedGroups.length > 0`, i.e. there is at least one non-warmup planned head set (useExerciseCardState.ts:194). When false, the PlanTargetsPanel (and its `NO PLAN` text) is not rendered at all. The grid applies only when the plan panel is present. See section 5.
3. `WARMUP` section: label `WARMUP` + warmup SetRows (+ RestTimerInline under the anchored one). Only when `warmupRows.length > 0` (planned sets with `isWarmup`, in plan order; on a merged swapped card only rows already logged). No add-warmup control.
4. Set rows (planned SetGroups, then extra SetGroups) — internals out of scope. Merged swapped card: planned rows only for logged ones, `readOnly` on planned SetGroups.
5. `+ ADD SET` button (Plus 12px, dashed, min-height 44): `setExtraSlotCount(n+1)`. Always visible (including merged swapped cards).
6. Skip-rest-of-exercise control (only when `hasUnfinishedPlannedWork`):
   - `hasUnfinishedPlannedWork = !swappedFrom && plannedRows.some(row => !row.group || row.group.stages.length < row.plannedStages.length)`, so hidden on merged swapped cards and hidden once every planned head and stage is logged/skipped (useExerciseCardState.ts:595).
   - Default: `SKIP REST OF EXERCISE` button (muted, min-height 44, no border). Shows `SKIPPING…` and is disabled (opacity .6) while `isSkippingExercise`.
   - Inline confirm (after tap): two buttons `CANCEL` (neutral; disabled while skipping) and `CONFIRM SKIP` (red-tinted; disabled while skipping). No explanatory sentence in the confirm row. `CONFIRM SKIP` -> `handleConfirmSkip` logs `isSkipped:true` rows for every unlogged planned head and every unlogged planned stage (weight/reps/rir null), sequentially, writes sets via onLog (starts/stops rest timer via rest chain as a side effect). Extra (ADD SET) slots are untouched.
7. `SwapExerciseSheet` (swap mode) when `showSwapSheet` — section 7.

SupersetBlock composition (features/gym/SupersetBlock.tsx:221-493), same elements regrouped:
- Block header: Link2 icon + `SUPERSET · {members.length} EXERCISES`.
- Per member (in block order): small letter badge (A, B, C…; `#n` beyond 26), ExerciseHeader (swap button always present), the same [PlanTargetsPanel | ExerciseReference] row (plan panel only when that member `showPlanTargets`), that member's `WARMUP` section (when it has warmup rows).
- Then rounds: label `ROUND {n}` and, per cell, label `{letter} · {EXERCISE NAME UPPERCASED}` + SetGroup.
- Then per-member action section: label `{letter} · {NAME UPPERCASED}`, `ADD SET`, and the same SKIP REST OF EXERCISE / CANCEL / CONFIRM SKIP control with the same `hasUnfinishedPlannedWork` condition.
- Then a SwapExerciseSheet per member whose `showSwapSheet` is true.
- Note: SupersetBlock does not pass `referenceScheduleType` into `useExerciseCardState`, but it does pass it to ExerciseReference directly (SupersetBlock.tsx:274-283).

---

### 4. ExerciseReference  (features/gym/ExerciseReference.tsx:167)
Rendered in the right column (or full width) of each card/member reference row, inside `div.px-3.py-2`. Read-only; the only interactive element is RETRY.

Props relevant to behaviour: `today`, `sessions` (this exercise's completed sessions, any run, any workout, excluding the current session; fetched in one batched query for the whole workout day), `isLoading`, `isError`, `isFromCache`, `weightUnit` (exercise's resolved unit; stored weights are kg and converted for display), `scheduleType` (default `'weekday'`). `mesocycleId` is accepted but unused.

State precedence (evaluated in this order):
| # | State / element (exact text) | Visible when |
|---|---|---|
| 1 | Label `REFERENCE` + line `···` | `isLoading` (the shell's `referenceLoading`) |
| 2 | Red label `COULDN'T LOAD REFERENCE` + button `RETRY` (underlined accent) | `!isLoading && isError`. RETRY calls `onRetry` = `retryReference` = refetch of the batched query. Replaces ALL other content (no FIRST TIME) |
| 3 | `OFFLINE · CACHED` (tiny, dimmed) at the top of the stack | Not loading, not error, and `isFromCache` (data came from the Dexie fallback). Shown in addition to the panels below |
| 4 | `FIRST TIME` (bold mono caps) | `primary.type === 'first_time'`: no eligible past session (see rules) |
| 5 | Panel `LAST WEEK` | `primary.type === 'last_week'` (weekday only) |
| 6 | Panel `LAST TIME` with sub-label ` · {relative}` | `primary.type === 'last_time'`. Sub-label: `TODAY` if daysSince is 0, else `formatDistanceToNow(date, addSuffix).toUpperCase()` e.g. `3 DAYS AGO`, `ABOUT 1 MONTH AGO`, `OVER 1 YEAR AGO` |
| 7 | Reach-back panel `LAST ACTUALLY TRAINED {N}D AGO` (or `LAST ACTUALLY TRAINED TODAY` if daysSince is 0) | `secondary.type === 'found'` |
| 8 | `NOTHING ON RECORD TO COMPARE AGAINST` | `secondary.type === 'none_found'` |
| 9 | `SKIPPED EVERY TIME ON RECORD` | `secondary.type === 'all_skipped'` |
| 10 | One panel per session labelled `EARLIER THIS WEEK` with sub-label ` · {relative}` (same relative format as 6), most recent first | `thisWeek` non-empty (weekday only; always `[]` for sequence) |

Rules (resolver code, referenceByExercise.ts and referenceLogic.ts):
- Candidate pool: `excludeDeload` (drops `isDeload` sessions) then each session's `date` is replaced by `movedToDate ?? date`. Only dates strictly before `today` count (same-day sessions are excluded).
- **Weekday** (`scheduleType !== 'sequence'`), weeks are Monday-anchored calendar weeks:
  - `LAST WEEK`: the most recent candidate whose date falls in the previous calendar week (Mon-Sun before the current week's Monday). If one exists it wins.
  - Else `LAST TIME`: the most recent past candidate of any date (including earlier this week or older), with daysSince.
  - Else `FIRST TIME`.
  - `EARLIER THIS WEEK`: all past candidates dated >= this week's Monday (and < today), shown in addition to the primary. NOTE the same session can therefore appear as both `LAST TIME` and `EARLIER THIS WEEK` when LAST WEEK is absent and the most recent is from this week. Code does not de-duplicate (unclear whether intended; not asserted by comments).
- **Sequence**: never `LAST WEEK`, `thisWeek` always empty. Primary is `LAST TIME` (most recent past candidate, with elapsed days) or `FIRST TIME`.
- **Reach-back** (secondary) computed only when `primary.type !== 'first_time'` AND `!hasRealLoggedSet(primary.session)` (every row in the primary session is skipped / session has no logs). Then it searches all past, non-deload candidates for the most recent with a real (non-skipped) logged set. Found -> panel 7; no past candidates -> 8; candidates exist but none with a real set -> 9. Shown alongside (below) the primary panel, which still renders.
- Warmup logs never appear (filtered at the query layer).

Panel contents (SetRows): each panel lists set groups; if a panel has no groups, a single `—`.
- Head line: `{setNumber}` + `{weight in display unit or —}×{reps}` + optional `@{rir}` (when rir != null).
- Stage line (indented, `↳` instead of the number) + weight×reps + optional `@rir` + a `DROP` badge.
- Weight shown via `toDisplayWeight(log.weight, weightUnit)`; `—` when weight is null. Reps are printed as-is (a null reps would print `null`; unclear if reachable).
- Skipped rows are not specially marked in the list (no skipped marker rendered).

Where it sits relative to PlanTargetsPanel: see section 5. Weekday vs sequence differences: `LAST WEEK` and `EARLIER THIS WEEK` exist only for weekday; the header label (`WEEK n` vs `CYCLE n`) is the other schedule-dependent text.

---

### 5. PlanTargetsPanel  (features/gym/PlanTargetsPanel.tsx:10)
Placement: left column (50%) of the two-column reference row in ExerciseCard and in each SupersetBlock member, directly under ExerciseHeader, left of ExerciseReference, with a right border.
| Element (exact) | Behaviour | Visible when |
|---|---|---|
| Heading `PLANNED RIR` | Static | Panel rendered |
| Per planned head set row: `{setNumber}` + `RIR {n}` or `—` | `targetRir != null ? "RIR n" : "—"` | One row per non-warmup planned head, sorted by setNumber. Stage rows never get their own row |
| Weight target `{toDisplay(targetWeight)}{unit}` (muted) | Display-unit conversion via `useWeightDisplay(weightUnit)` | Only if `head.targetWeight != null`; no placeholder when absent |
| Badge `+{stages.length}` (accent bg) | Count of planned stage rows under that head | Only if the head has >=1 planned stage |
| `NO PLAN` | Empty text | Component would only render this if groups were empty, but ExerciseCard/SupersetBlock don't render the panel at all in that case (`showPlanTargets = plannedGroups.length > 0`). Reachable only if the group list is non-empty before the warmup filter but all heads are warmups: `plannedGroups` in useExerciseCardState is built from already-non-warmup sets so effectively unreachable there |
Also: a merged swapped card passes the ORIGINAL exercise's `plannedSets` (so the panel shows the original's plan) and `programExercise.weightUnit` of the pe copy.
Extra (unplanned) exercise cards have `plannedSets=[]` -> no plan panel, reference column full width.

---

### 6. RestTimer (floating, in-flow) and RestTimerInline

#### RestTimer  (features/gym/RestTimer.tsx:6) — mounted at GymSession.tsx:538
Not literally floating: it renders in normal flow between header and warmup checklist (`mx-4 mb-3`).
Global conditions: renders `null` if `!restTimerEnabled` (Settings) OR `!startedAt` (no rest period running).
Target: `targetRestSeconds = restTimerStore.targetSeconds ?? settings.targetRestSeconds` (the rest chain's per-set resolved value, else the global setting).
| State | Elements (exact text) | Condition |
|---|---|---|
| Collapsed pill | Right-aligned button `REST {formatRestTime(elapsed)}` plus ` · GO` appended when over target. Border/text turn accent when over target. Tap -> `show()` (expands) | `!isVisible` (after HIDE was tapped) |
| Expanded card | Thin progress bar (width = min(elapsed/target,1), accent when over, muted otherwise); label `REST`; big time `{formatRestTime(elapsed)}`; `GO` label when over target; button `HIDE` (min 44x44) -> `hide()` | `isVisible` (default true; every new rest start resets it to visible) |
| Completion alert | At the first tick where `elapsed >= target` and Settings `buzzOnRestComplete` is on: `navigator.vibrate(400)` if available; otherwise (iOS) the card flashes (accent-muted bg + accent border) for 600ms. Once per rest period | `buzzOnRestComplete` setting |
- Starts/stops: set by logging via `restTimerStore.startRest(target)`; "no timer" outcomes of the rest chain call `stop()`. Nothing in this component stops or resets it manually (no skip/reset button). A new log restarts it.
- "GO" means the rest target elapsed; time keeps counting up after.

#### RestTimerInline  (features/gym/RestTimerInline.tsx:20)
- Renders `REST {formatRestTime(elapsed)}` (muted mono caps, left-indented) — elapsed time only, no target/GO/progress.
- Null when `!restTimerEnabled || !startedAt`.
- Placement rule (callers): under exactly the one row whose log id equals `restTimerStore.anchorId` while a rest period runs (`timerAnchorId = startedAt ? anchorId : null`): under a head row (SetGroup.tsx:236), a stage row (SetGroup.tsx:255), a warmup row in ExerciseCard (ExerciseCard.tsx:157) and in SupersetBlock member warmups (SupersetBlock.tsx:319). anchorId is set after the log's real id returns (GymSession.handleLog), so it appears a beat after logging; `start()/startRest()/stop()` reset anchorId to null.

---

### 7. SwapExerciseSheet  (features/gym/SwapExerciseSheet.tsx:50)
Bottom sheet (`fixed inset-0 z-50`, dark scrim rgba(0,0,0,.6), `rounded-t-2xl`, max-height 80dvh, grab handle). Tapping the scrim closes (`onClose`). Candidates come from `useExercises(false)` (non-archived exercises). Two modes, same component.

Common chrome:
| Element | Behaviour | Visible when |
|---|---|---|
| Title (accent mono caps): `SWAP EXERCISE` / `CONFIRM SWAP` / `ADD EXERCISE` / `CONFIRM ADD` | Static | swap mode: `SWAP EXERCISE` -> `CONFIRM SWAP` once an exercise is picked (`pending`). add mode: `ADD EXERCISE` -> `CONFIRM ADD` |
| X button (`aria-label="Close"`) | `onClose` | Always |

#### Mode `swap` (opened from ExerciseHeader swap icon via ExerciseCard/SupersetBlock; props: currentExerciseId, currentExerciseName (`programExercise.exercise?.name ?? 'this exercise'`), muscleGroup (`exercise?.muscleGroup ?? 'other'`), remainingSetCount)
Step 1: pick list
- Candidates: non-archived exercises with `muscleGroup === current muscleGroup`, excluding the current exercise id, sorted by name (`localeCompare`).
- Row buttons: exercise name (bold). Tap -> `setPending(ex)` (goes to confirm step).
- Dashed button `+ CREATE NEW {MUSCLEGROUP UPPERCASED} EXERCISE` (Plus icon) — shown when not in create form and a muscle group exists (always true in swap mode). Tap -> shows create form.
- Create form (replaces the button): label `NEW {MUSCLEGROUP} EXERCISE`, text input placeholder `Exercise name` (autofocus), error text = server error message when `createExercise.isError`, buttons `CANCEL` (hides the form) and `CREATE` (submit; shows `...` while pending; disabled while pending or name empty/whitespace). On success: creates the exercise (`useCreateExercise` with name + this muscle group), closes the form, clears the name, and jumps straight to the confirm step with the new exercise as `pending`.
- Empty state: `No other {muscleGroup} exercises yet — create one above.` (when candidates is empty; the string uses the raw muscleGroup value, lowercase as stored)
Step 2: confirm (`pending` set)
- Text: `Swap {current name} for {pending name} — for today's session only. Next week's plan is unaffected.` (both names bold)
- Extra line only when `remainingSetCount > 0`: `{n} remaining set(s) of {current name} will be marked SKIPPED for today.` (`set` singular when n = 1, else `sets`). `remainingSetCount` = unlogged planned heads + unlogged planned stages (`remainingPlannedCount`).
- Buttons: `BACK` (returns to pick list: `setPending(null)`), `CONFIRM SWAP` (accent) -> `onConfirm(pending)`.
- On confirm (useExerciseCardState.handleConfirmSwap): sheet closes, the card shows `SKIPPING…` state while all remaining planned sets (heads + stages) are logged as skipped, then `onSwap` -> GymSession.handleSwap -> `recordExerciseSwap` mutation (writes the swap row; optimistic cache). If the skip step throws, the swap is NOT recorded (only console.error). The card then re-renders as a merged card (ExerciseHeader shows `SWAPPED FROM …`, swap icon hidden for plain cards, SKIP REST hidden).
- Swap is session-only; not written to the plan/template.

#### Mode `add` (opened from the ADD EXERCISE button; props: excludeExerciseIds)
Step 1: pick list
- Muscle filter chips row (horizontally scrollable, hidden scrollbar): `ALL` then one chip per `MUSCLE_GROUPS` with label from `MUSCLE_GROUP_LABELS` (lib/exerciseTags.js; labels not inspected). Tapping a non-active chip selects it; tapping the active chip returns to `ALL`; `ALL` selects all. Default `ALL`.
- Candidates: non-archived exercises not in `excludeExerciseIds`, filtered by the selected group (all groups when ALL), sorted by name.
- If a group is selected: dashed `+ CREATE NEW {GROUP} EXERCISE` button (same create form and behaviour as swap mode, using the chosen group; after CREATE goes to confirm step). If ALL is selected: text `Pick a muscle group above to create a new exercise.` (no create button).
- Empty state: `No other {group} exercises yet — create one above.` when a group is selected; `No exercises yet — create one above.` when ALL.
Step 2: confirm
- Text: `Add {pending name} to today's session.` (name bold). No skip warning.
- Buttons: `BACK`, `ADD EXERCISE` (accent) -> `onConfirm(pending)` -> GymSession.handleAddExercise.

Gating: no online/offline check in the sheet. Creating an exercise needs the network (`useCreateExercise`); unclear how it behaves offline (not handled here).

---

### 8. WorkoutSidebarSheet and NotesPanel  (Coach user only)

Entry: the header `COACH` button (section 2.1), visible only for `isCoachUser(user?.id)`. Nothing else in these files opens it.

#### WorkoutSidebarSheet  (features/gym/WorkoutSidebarSheet.tsx:24)
Bottom sheet (`fixed inset-0 z-50`, scrim closes on tap, max-height 70dvh, scrolls, grab handle).
| Element | Behaviour | Visible when |
|---|---|---|
| Segmented tabs `NOTES` / `ASK` | `setActiveTab` in `useQaSidebarStore` (store value persists between sheet openings within the app session; default `notes`) | Always while open |
| X button (`aria-label="Close"`) | `onClose` | Always |
| NotesPanel | tab `notes` | activeTab 'notes' |
| QaPanel `category="in_session" sessionId currentExerciseId={null}` | tab `ask` | activeTab 'ask' |

#### NotesPanel  (features/gym/NotesPanel.tsx:25)
| Element (exact) | Behaviour | Visible when |
|---|---|---|
| List of existing notes: card with `{note.body}` and time `h:mm a` (e.g. `3:05 PM`) from `createdAt` | Read-only; notes from `useCoachNotes()` filtered client-side to `n.sessionId === sessionId` | Only when this session has >=1 note. No empty-state copy |
| Textarea, 3 rows, autofocus, placeholder `Jot something down — form off today, an old injury acting up, anything worth remembering…` | Local `body` | Always |
| Error text = `createNote.error.message` | Shown under the textarea | `createNote.isError` |
| Button `ADD NOTE` / `SAVING...` | Submit: trims; ignores empty; `createNote.mutate({body, sessionId})`, clears the textarea on success. Optimistic cache insert (works offline per file comment) | Always; disabled when `createNote.isPending` or the trimmed body is empty (opacity .6) |

#### QaPanel (ASK tab; features/coach/QaPanel.tsx — summarised only, not in my file list)
- Offline (`!useOnlineStatus()`): replaces the entire tab with a card: `REQUIRES A CONNECTION` / `Ask isn't available offline — reconnect to use it.` The NOTES tab remains usable offline.
- Online: QaTranscript + QaComposer (content not inventoried here; see Coach inventory). Resets stale state when category/session changes.

---

### 9. WarmupRoutineChecklist  (features/gym/WarmupRoutineChecklist.tsx:34) — mounted at GymSession.tsx:543
Session-level (per workout day), distinct from per-exercise `WARMUP` set rows.
| Element (exact) | Behaviour | Visible when |
|---|---|---|
| Card with heading `WARMUP ROUTINE` | Static | Only when `useWarmupRoutineItems(workoutDayId)` returns >=1 item. Otherwise the component returns `null` (no heading, no wrapper, no empty/loading/error state) |
| One full-width row per item: Square (unticked, muted) or CheckSquare (ticked, accent) icon + `{item.body}`; ticked text is muted + line-through | Tap toggles the tick via `warmupRoutineStore.toggle(sessionId, itemId)`. Nothing else is logged | Per item. Min height 44. Never disabled |
- Persistence: ticks are per session, hydrated from localStorage on mount (`load(sessionId)`); no network write. Items are read online-only; when offline with no cached query data the list is empty so the card does not render (no error).
- Placement: above the first exercise card/superset block, below the rest timer; not collapsible.

---

### 10. Offline and banners relevant to the workout screen
- **GymSession itself shows no offline banner/indicator.** (`isOnline` is only used to gate cache priming and the Dexie exercise fallback.)
- Global strip rendered by `components/Nav.tsx:62-79` (bottom nav, above the tab bar): dot + `OFFLINE · SETS WILL SYNC ON RECONNECT`. Visible whenever `!isOnline` on any screen including the workout.
- Nav also shows an install bar `ADD TO HOME SCREEN` + `INSTALL` when `canInstall` (not workout-specific).
- ExerciseReference shows `OFFLINE · CACHED` per card when its data came from the Dexie fallback (section 4).
- QaPanel offline state (section 8).
- SessionComplete COMPLETE SESSION works offline via the sync queue (section 2.8); nothing tells the user it was queued (no toast or text in SessionComplete).
- Per-set pending/failed sync indicators exist in SetRow (`useOfflineStore.pendingIds/failedIds`) — other agent's scope.
- Deload: only visible on this screen as the `DELOAD · ` prefix in the header label (section 2.1). No banner. Deload sessions are also excluded from the reference panels' candidate pool (section 4), with no on-screen notice.

---

### 11. Toasts / confirm dialogs / alerts summary
- Toast: `Session completed automatically` (auto-finish success only; features/gym/useAutoFinishSession.ts:60).
- No other toasts from these files.
- Confirmations: inline SKIP REST OF EXERCISE -> `CANCEL` / `CONFIRM SKIP` (no message text); swap confirm step (`CONFIRM SWAP`, with the SKIPPED warning copy); add confirm step (`CONFIRM ADD` / `ADD EXERCISE`).
- Error texts: `COULDN'T LOAD REFERENCE` + `RETRY`; create-exercise error (server message); create-note error (server message).

---

### Gaps / uncertainties
- No session-level or exercise-level overflow menu (⋯), no remove-exercise, no reorder, no per-exercise notes: confirmed absent in the files read.
- GymSession has no loading/error/empty copy; loading of `useActiveSession` is not surfaced (the header shows `0s` until `startedAt` loads).
- `handleComplete` in SessionComplete has no error handling/UI on failure (unhandled promise); no success feedback besides the screen change.
- The reference panel can show the same session as both `LAST TIME` and `EARLIER THIS WEEK` in weekday mode (resolver does not de-duplicate); intent unknown.
- `SETS LOGGED` on SessionComplete counts every non-skipped log (warmups/stages included); unclear whether intended.
- `MUSCLE_GROUP_LABELS` strings (add-mode filter chips) and `ENERGY_SCALE`/`PUMP_SCALE` option labels (RatingChips) were not opened; see `lib/exerciseTags.js` and `features/gym/ratingScales.ts`.
- QaTranscript/QaComposer contents (ASK tab) not inventoried here.
- Behaviour of exercise creation (swap/add sheet) when offline is not handled in this sheet; effect of `useCreateExercise` offline is unclear.
- `NO PLAN` in PlanTargetsPanel is effectively unreachable from current callers (they hide the panel when there is no plan).
- Reps printing as `null` in reference lines if a log has null reps: unclear whether reachable.

## 1.7 Completed run tap target
## Completed run tap -> destination (inventory)

All paths under /home/user/overload-v2/src. Nothing edited.

### Entry: Completed Runs row (source)

#### Completed run row  (features/programs/ProgramsPage.tsx:211-262)
| Control | What it does | Visible when | Lives where |
|---|---|---|---|
| Section label `COMPLETED RUNS` (:213) | static heading | `completedMesos.length > 0` (:211) | Programs page, below active-run area |
| Row (div role="button" tabIndex 0) (:222-247) | click -> `navigate('/meso/${m.id}/priorities')` (:226); Enter or Space (preventDefault) does same (:231-234) | one per completed meso | Programs page list |
| Row title `{m.name}` (:239), ellipsis | static | always | row |
| Row subline `{program.name} · {start} → {end}` (:242) via fmtDate; program name only if `m.program?.name`; `→ end` only if `m.endDate` | static | always | row |
| ChevronRight icon (:244) | decorative | always | row |
| Delete button (aria-label "Delete run") (:245-) | `e.stopPropagation()`, opens confirm sheet via `setConfirmDeleteId` (does NOT navigate) | always per row | row, right edge. Confirm BottomSheet (:440-): "Delete run?" / "This cannot be undone. Any linked session history will remain." |

Comment at ProgramsPage.tsx:47-49 documents this as the only way to a completed run's priorities. Note: starting a NEW run navigates to `/plan/priorities` (:142, a different screen, PrioritiesEditor), not to this one.

### Routing / gating

- Route: `/meso/:mesocycleId/priorities` -> `<MesoPrioritiesPage />` (App.tsx:121). Unconditional route inside the authenticated shell; Nav and Toast render around it (App.tsx:97-134). Catch-all `*` -> `/today`.
- **No Coach gating anywhere on this path.** MesoPrioritiesPage.tsx has no import of coachGate/isCoachUser and no `useAuth` check; the only auth use is inside hooks (`enabled: !!user`, usePriorityContext.ts:41; useMesos.ts:14). Any logged-in user (Coach or not) sees the identical screen.
- `isCoachUser` (coach/coachGate.ts:6; `VITE_COACH_USER_ID` match, cosmetic) is used only in Nav.tsx:32 (COACH tab), CoachPage.tsx:28 (locked placeholder), GymSession.tsx:522. None affect this screen.
- A non-Coach user: same screen, same controls. (The data feeds the Coach analysis, but the screen is not hidden.) Not Coach-gated = nothing to document for a "locked" variant.
- Route is lazy-free import (App.tsx:18). Bottom Nav remains visible (tab highlighting for this path: unclear, no tab matches `/meso/...`, so presumably none active; NavLink behavior not verified).

### MesoPrioritiesPage  (features/coach/MesoPrioritiesPage.tsx:22)

Layout: full-height column: fixed header (:80-97) + scrolling body (:99, `hide-scrollbar`, padding 16/20/32).

#### Header
| Element | Behavior | Visible when | Notes |
|---|---|---|---|
| Back button, ArrowLeft icon only, no label/aria-label (:81-86) | `handleDone` (:58-69): if `window.history.state.idx > 0` -> `navigate(-1)`, else `navigate('/program')` (hard-reload fallback) | always | 36x36. Comment: returns to wherever entered from (Programs, or Plan header link in other flows) |
| Title (:88-90) | `meso?.name ?? 'PRIORITIES'` | always | fallback text `PRIORITIES` while meso not resolved/not found |
| Subline (:91-95) | `{program.name} · ` (only if `meso.program?.name`) + `SINCE {MMM d, yyyy uppercased}` e.g. `SINCE MAR 3, 2026` | only when `meso` found | NO end date, NO status/"completed" indicator, no week count shown, even for completed runs |

No other header controls (no menu, no title edit).

#### Body states (exact copy)
| State | Condition | Copy / UI |
|---|---|---|
| Loading | `mesosLoading \|\| contextLoading` (:71) | centered 20px spinner (accent top border), no text |
| Error | `!loading && (mesosError \|\| contextError)` (:72, :109) | `COULDN'T LOAD PRIORITIES` (red mono) + `Check your connection and try again.` No retry button |
| Not found | `!loading && !failed && !meso` (:120) | `MESOCYCLE NOT FOUND` (dim). Header title shows `PRIORITIES`, no subline |
| Content | `!loading && !failed && meso && context` (:128) | below |
| (implicit) | meso found but `context` undefined with no error/loading, e.g. user not ready: renders nothing | unclear: only if query disabled |

No dedicated "empty" state: with zero stored rows, content still renders all 12 groups at default priority NORMAL (no row = normal, densified in priorityContext/priorityTags).

#### Content controls (editable for completed AND active runs alike; no read-only mode)
Comment :12-16 states explicitly: works for any meso including completed; "priorities stay editable for the whole meso's life". Nothing branches on `meso.status`. All of the below is fully editable on a completed run.

| Control (label as rendered) | What it does | Visible when | Where |
|---|---|---|---|
| `COPY FROM «{previousMeso.name}»` button, Copy icon, full-width dashed, 48px (:133-144) | `copyFrom.mutate({fromMesocycleId: previousMeso.id})` -> copyPrioritiesFromMeso: copies source meso's explicit rows verbatim (upsert) into this meso, then invalidates query | `showCopyButton` = context exists AND `!context.anyExplicit` (this meso has no explicit rows) AND `previousMeso` exists AND `previousContext?.anyExplicit` (source has explicit rows) (:73). previousMeso = the user's other meso with greatest startDate (ties: createdAt desc), excluding this one — any status (usePriorityContext.ts:118-136) | top of content |
| Same button, pending state | label `COPYING…`, disabled, opacity 0.6, cursor not-allowed | `copyFrom.isPending` | |
| Copy error line (:145-149) | shows `(copyFrom.error as Error).message` (red mono 9px) | `copyFrom.isError` | under copy button. Copy button disappears after success since `anyExplicit` becomes true |
| Set-priority error line (:155-159) | shows `(setPriority.error as Error).message` (red) | `setPriority.isError` | above group list; optimistic chip value rolls back on error (usePriorityContext.ts:98-100) |
| Group cards, 12, in order (MUSCLE_GROUPS): CHEST, BACK, SHOULDERS, BICEPS, TRICEPS, FOREARMS, QUADS, HAMSTRINGS, GLUTES, CALVES, CORE, OTHER (exerciseTags.ts:32-51) | each card: header toggle button + group PrioritySelector | always (in content state) | list, gap 10 |
| Group header toggle button: group label (display font) + ChevronDown (collapsed) / ChevronUp (expanded) (:172-184) | `toggleExpanded(group)`; expanded state is page-local `useState<Set>`, all start collapsed, lost on leaving | always | whole row clickable |
| Group PrioritySelector (:189-195) | `setPriority.mutate({tagType:'muscle_group', tagValue:group, priority})` | always (selector visible whether expanded or not) | under header |
| Subgroup rows (:197-217), left dashed border, label in mono muted | one per `PRIORITY_TREE[group]` entry, each with its own PrioritySelector -> `setPriority.mutate({tagType:'muscle_subgroup', ...})` | only when group expanded | inside card, after divider |

#### PrioritySelector  (features/coach/PrioritySelector.tsx:14)
- 4 chips in a row, order and labels: `LOW`, `NORMAL`, `HIGH`, `TOP` (priorityTags.ts:24-30). Horizontally scrollable if overflow (`hide-scrollbar`), 44px high, mono.
- Exactly one chip active (accent fill, base-colour text); inactive: surface bg, muted text, border. Value default = `normal` when no stored row.
- Tapping the active chip is a no-op (never clears). Tapping another calls onChange (optimistic update, then upsert, then refetch).
- `disabled` (opacity 0.5, default cursor) on ALL selectors (groups and subgroups) only while `copyFrom.isPending` (:191, :208). Not disabled during a single set-priority mutation.
- No per-chip explicit/default indicator is rendered (`isExplicit` is not shown in UI).

#### Subgroup tree (PRIORITY_TREE, priorityTags.ts:48-61; labels MUSCLE_SUBGROUP_LABELS exerciseTags.ts:119-)
- CHEST: UPPER CHEST, MID CHEST, LOWER CHEST
- BACK: LATS, MID BACK, LOWER BACK, TRAPS
- SHOULDERS: FRONT DELT, SIDE DELT, REAR DELT
- BICEPS: BICEPS, BRACHIALIS
- TRICEPS: TRICEPS LONG HEAD, TRICEPS LATERAL HEAD
- FOREARMS: FOREARMS
- QUADS: QUADS; HAMSTRINGS: HAMSTRINGS; GLUTES: GLUTES; CALVES: CALVES
- CORE: ABS, OBLIQUES
- OTHER: ADDUCTORS
(34 total tags = 12 groups + 22 subgroups.) Group and same-named subgroup are separate rows (tagType differentiates).

#### Not rendered here
No static helper/intro text, no explanation of what priorities do, no toasts, no confirm dialogs, no analysis sections: MesoAnalysisDetail, WeekAnalysisDetail, AnalysisDetail, CoachAnalysis tabs, completed-run stats/volume/adherence — none are imported or rendered by MesoPrioritiesPage. The screen contains ONLY priorities (no sessions, dates range, status, or results of the run). Data table: `v2_coach_meso_tag_priorities` (per user per meso).

### Other places that open a completed run (navigate to this screen or a run detail)

- Only ProgramsPage.tsx:226 and :233 (same row; click + keyboard). Grep of `/meso/` and `/priorities` across src (non-test) finds no other navigate/Link to `/meso/:id/priorities`.
- History: features/history/HistorySessions.tsx:236-262 — selecting a completed meso in its meso selector only filters sessions and shows a "DELETE MESO" card (`selectedMeso.status === 'completed'`, label `DELETE MESO`, mesoName uppercased); it does not open a run screen. Other navigates in history: SessionDetail.tsx:137 -> `/session-type/:workoutDayId`; ExerciseHistoryPage.tsx:16 / SessionTypeHistoryPage.tsx:16 back = `navigate(-1)`.
- Progress: features/progress/MesoProgress.tsx:188-193, :265-275 — a `<select>` of all mesos (`overrideMesoId`) switches the displayed meso in place; no navigation, no link to run screen.
- Plan: features/plan/PlanPage.tsx:535, :585, :725 navigate to `/program`; :561 navigates to `/plan/priorities` (active run's PrioritiesEditor, features/plan/PrioritiesEditor.tsx, a different, view-only screen). Not a completed-run opener.
- Programs: ProgramsPage.tsx:142 (after starting a run) -> `/plan/priorities`; :169 -> `/program/:id` (planner); :305 -> `/program/:programId` (program card, not a run).
- Coach tabs (MesoAnalysisDetail etc.) are Coach-only and not linked from the completed row; not investigated for entry into this screen (grep found no references to the route).

### Gaps/uncertainties
- Nav tab active state on `/meso/...`: not verified (NavLink end-matching of the rest of Nav.tsx not read past line 60).
- Whether the unconditional route is reachable unauthenticated: App-level auth gate not read in full (App.tsx before line 95); hooks are `enabled: !!user`, so unauthenticated would show perpetual loading/empty.
- Redirect note: Pre-existing distinction between legacy per-meso priorities (this screen, `v2_coach_meso_tag_priorities`) and the new run-program priorities (`v2_program_priorities`, PrioritiesEditor). The completed-run row reaches the OLD store; comment at ProgramsPage.tsx:132-141 says new runs use the new editor. Whether completed runs created under the new model have rows in the old table: unclear (they would show all NORMAL).

---

# Part 2–3 — Design tokens and reusable components

## Design tokens and reusable components (as actually coded)

Repo: /home/user/overload-v2 (React 18 / TS PWA, Tailwind v4 via `@import "tailwindcss"`, lucide-react icons, react-router v6, zustand, react-query). Paths relative to `src/`. Counts are from grep over non-test `.tsx` (95 files) and are approximate: multi-line style props split across lines may be under-counted for some properties; Tailwind class counts and inline-style counts are listed separately and both exist side by side. Tailwind v4 defaults apply (4px spacing unit; text-xs 12px, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36; rounded 4px, rounded-md 6, rounded-lg 8, rounded-xl 12, rounded-2xl 16).

There is no shared `ui/` dir. Only `components/ConfirmDialog.tsx` and `components/Nav.tsx` are in `src/components/`. Almost every other control is re-implemented per file (the code comments say so explicitly: "each file carrying its own small presentational helpers").

---

## PART A: DESIGN TOKENS

### A1. Colour variables (`styles/tokens.css`, imported first in `main.tsx`, then `global.css`)

Dark is the default (`:root`). Light is `[data-theme="light"]` on `<html>`, set by JS only (`App.tsx` AppRoutes effect: `document.documentElement.setAttribute('data-theme', settings.theme)`). `index.html` has no `data-theme`, so first paint is dark until settings load (theme comes from Supabase, see A3). `index.html` meta `theme-color` = `#060607`; `vite.config.ts` manifest `theme_color` and `background_color` = `#060607` (hardcoded dark, not theme-aware).

| Variable | Role (comment in file) | Dark (`:root`) | Light (`[data-theme="light"]`) |
|---|---|---|---|
| `--base` | page background | `#060607` | `#f9f9f8` |
| `--surface` | card / panel | `#08080a` | `#ffffff` |
| `--surface-raised` | elevated element | `#0d0d10` | `#f2f2f0` |
| `--surface-overlay` | modal / sheet | `#141418` | `#e8e8e6` |
| `--border-subtle` | | `#141418` | `#e8e8e6` |
| `--border` | | `#1a1a1e` | `#d8d8d5` |
| `--border-strong` | | `#26262c` | `#b8b8b4` |
| `--text-primary` | | `#f4f3ef` | `#0d0d0c` |
| `--text-secondary` | | `#8a8a90` | `#4a4a47` |
| `--text-muted` | | `#5a5a61` | `#6a6a66` |
| `--text-dim` | | `#3a3a40` | `#9a9a96` |
| `--accent` | user-switchable | `#FF8C42` (default) | not overridden (same; overwritten at runtime by JS inline style on `<html>`) |
| `--accent-muted` | accent at 15% alpha | `rgba(255,140,66,0.15)` | `rgba(255,140,66,0.18)` in CSS, but see runtime override below |
| `--error` | semantic | `#f87171` | not overridden (same `#f87171`) |
| `--success` | semantic | `#4ade80` | not overridden (same `#4ade80`) |

Light block also sets `color-scheme: light`. No `color-scheme: dark` is declared on `:root`. There is no `prefers-color-scheme` / `matchMedia` anywhere: theme is only the stored setting.

Facts to note:
- The file header says "no component imports this file directly"; components use `var(--...)` in inline styles or Tailwind color utilities (A1b).
- Text on accent fill is `var(--base)` everywhere (dark: near-black; light mode: `#f9f9f8`, i.e. light text on accent).
- `--accent-muted` is rewritten at runtime by `hooks/useAccentColour.ts`: `hexToRgba(accent, 0.15)`, so the 0.18 in the light block is only the pre-JS value; after hydration both themes get 0.15.
- Danger red fills use hardcoded `rgba(248,113,113,a)` (= `#f87171` = `--error`) in many places, and `color-mix(in srgb, var(--error) 15%, transparent)` in gym files (see A9).

#### A1b. Tailwind colour utilities (`styles/global.css`, `@theme inline`, map to the variables above)
`bg-bg`=--base, `bg-surface`, `bg-raised`=--surface-raised, `bg-overlay`=--surface-overlay; `border-wire-faint`=--border-subtle, `border-wire`=--border, `border-wire-strong`=--border-strong; `text-ink`=--text-primary, `ink-2`=secondary, `ink-3`=muted, `ink-4`=dim; `accent`, `accent-ghost`(=--accent-muted); `danger`=--error, `ok`=--success. Actual usage in components is almost entirely `style={{ color: 'var(--...)' }}`; these utilities are defined but the code examined rarely if ever uses them (not exhaustively verified: unclear whether any `bg-surface`/`text-ink` class appears).

### A2. Accent options and how accent is applied/persisted

- Swatches: `features/settings/SettingsPage.tsx:8-22` `ACCENT_SWATCHES` (12): ORANGE `#FF8C42` (default), BLUE `#3B82F6`, GREEN `#22C55E`, PINK `#EC4899`, PURPLE `#8B5CF6`, RED `#EF4444`, then (comment "v3 §11 additional") YELLOW `#FACC15`, LIME `#84CC16`, TEAL `#14B8A6`, CYAN `#06B6D4`, INDIGO `#6366F1`, ROSE `#F43F5E`. Rendered as a `grid grid-cols-4 gap-2` of 44px-min-height `rounded-xl` buttons filled with the swatch colour, `aria-label` = name, selected = `outline: 3px solid var(--text-primary)` offset 2 and opacity 1, unselected opacity 0.65, outline transparent (SettingsPage.tsx:196-214). No custom colour picker.
- Click handler `set({ accentColour: colour })` -> `useUpdateSettings` (`features/settings/useSettings.ts`): merges the full settings object, optimistic `hydrate()` of the zustand `useSettingsStore` and react-query cache (`['v2_settings']`, staleTime Infinity), then `upsertSettings` -> Supabase table `v2_user_settings` column `accent_colour` (and `theme`). Persisted server-side per user, not localStorage.
- Apply: `App.tsx` `AppRoutes` calls `useAccentColour(settings.accentColour)` (`hooks/useAccentColour.ts`): effect sets inline `document.documentElement.style.setProperty('--accent', value)` and `'--accent-muted'` = rgba(value, 0.15). Also mirrors into a small zustand `useAccentStore` (default `#FF8C42`). Runs in AppRoutes before the loading/login branches, so login screen also uses it (settings default until user loads).
- Default if no row: `DEFAULT_SETTINGS.accentColour = '#FF8C42'` (`settingsStore.ts`).
- Theme: SettingsPage "THEME" chip row DARK / LIGHT -> `set({ theme })` -> same persistence; applied via `data-theme` attribute.
- No per-accent contrast handling: text on accent is always `var(--base)`; YELLOW/LIME/CYAN etc. get same dark-on-colour treatment in dark mode.

### A3. Fonts (`styles/global.css`)
Google Fonts `@import` (first line): Archivo 400-900, Archivo Expanded 600-900, JetBrains Mono 400-800. `@theme`: `--font-sans: 'Archivo', sans-serif`, `--font-display: 'Archivo Expanded', sans-serif`, `--font-mono: 'JetBrains Mono', monospace`. Base layer: `html, body` get `font-family: var(--font-sans)`, `background-color: var(--base)`, `color: var(--text-primary)`, `-webkit-tap-highlight-color: transparent`, `overscroll-behavior: none`, `height:100%`; `#root {height:100%}`; form controls `font-family: inherit`; `input::placeholder {color: var(--text-dim)}`; `input:focus {outline:none}` (no visible focus ring replacement). Utility `.hide-scrollbar` (hides scrollbars; used on horizontal chip rows).

Usage counts (inline `fontFamily` or `font-*` class, both forms counted separately but they mirror each other): mono ~575, display ~112, sans ~11 explicit.
- `--font-mono` (JetBrains Mono): the dominant UI face. All button labels, tab/segment labels, chips, section/field labels, helper lines, nav labels, toasts, banners, numeric set inputs (weight/reps), timers, steppers' labels, uppercase microcopy.
- `--font-display` (Archivo Expanded, weight 800-900): page titles `h1` (HISTORY, PROGRESS, SETTINGS, PLAN, etc.), sheet titles, workout/exercise names in lists, stepper values (`fontWeight 800`, 11-13px), big action buttons in planner/programs (CREATE PROGRAM, END RUN, DELETE...), card titles. Heaviest in `planner/StepExercises.tsx` (14 uses), `programs/ProgramsPage.tsx` (13), `plan/PlanPage.tsx` (13), `planner/designFieldEditors.tsx` (7), `planner/PlannerPage.tsx` (6).
- `--font-sans` (Archivo): body text only in a few spots: toggle labels (SettingsPage.tsx:112, DeloadRulesEditor.tsx:55), search input (HistorySessions.tsx:103), dashed "add" buttons in planner (StepExercises.tsx:203,423,480,768; designFieldEditors.tsx:443), PlanPage.tsx:726 text link button, SessionComplete.tsx:128, CompletedTodayScreen.tsx:118 (note textareas). Un-classed text (e.g. `<p>` with only `className="text-sm"`) falls back to sans from `body`.
- Weights: inline `fontWeight` 700 x214, 800 x43, 900 x31, 500 x7, 600 x4, 400 x3; Tailwind `font-bold` x273, `font-black` x46, `font-semibold` x2, `font-medium` x2, `font-normal` x1.
- Letter spacing (inline): `'1px'` x70, `'1.5px'` x68, `'2px'` x48, `'0.5px'` x17, `'0.08em'` x9, `'0.06em'` x8, `'2.5px'` x3, `'0.1em'` x3, `'0.3px'`, `'-0.5px'`, `0`. Tailwind: `tracking-widest` x131 (0.1em), `tracking-tight` x20, `tracking-wider` x16, `tracking-wide` x6.
- Almost all labels/buttons are written in UPPERCASE literally in strings (not `text-transform`).

### A4. Type sizes actually used

Inline `fontSize` (px), count, typical use:

| px | n | Typical use |
|---|---|---|
| 8 | 9 | Nav tab labels (Nav.tsx), workout/slot switcher day label (WorkoutSwitcher.tsx, SequenceSlotSwitcher.tsx), UnitChips, planner tiny labels |
| 9 | 83 | Micro labels: field captions ("REST", "TEMPO"), small chips (FilterChip in picker sheets), row/section sublabels, MoveSessionSheet day chips, SUPERSET toggle, planner step switcher |
| 10 | 80 | Section labels, segment bar labels (SegmentBar, planner switches), MENU actions (planMenu MenuAction), helper lines, empty-state sub lines |
| 11 | 59 | Page/section empty-state captions (`letterSpacing 2px`, `--text-dim`), settings label style (`fontSize 11`, `0.1em`), error titles ("COULDN'T LOAD PLAN"), stepper values |
| 12 | 43 | Buttons (CANCEL, ConfirmDialog buttons), Rir stepper value, switcher names |
| 13 | 40 | Primary display-font buttons (CREATE PROGRAM, END RUN, DELETE), stepper values, list item text |
| 14 | 22 | Body inputs in sheets, ConfirmDialog body, big list titles |
| 15 | 15 | Inputs in sheets/planner (name field), stepper glyph, program name titles |
| 16 | 13 | Sheet titles (display 800), ConfirmDialog title, stepper icon text |
| 17 | 4 | G14Prompt title |
| 18 | 18 | Section/sheet headings (display 800), "+" button glyph |
| 22 | 1 | one-off |
| 26 | 1 | h1 in PlanPage (line ~573) |
| 28 | 2 | h1 in ProgramsPage and PlanPage (~522/181) |

Tailwind text sizes: `text-xs` (12px) x357 (the workhorse: labels, buttons, chips), `text-sm` (14px) x124 (inputs, body copy, toasts), `text-2xl` (24) x10 and `text-3xl` (30) x8 (page `h1`: HISTORY, PROGRESS, SETTINGS, COACH, etc. `font-black tracking-tight` display font), `text-base` x5, `text-lg` x4, `text-xl` x3 (MoveSessionSheet h2), `text-4xl` x2 (LoginPage "OVERLOAD" h1 + one more). Page h1 pattern: `text-3xl font-black tracking-tight` x7, `text-2xl font-black tracking-tight` x5.
No type scale tokens exist; sizes are literals.

### A5. Radii
Inline `borderRadius` px: 10 x47, 8 x31, 6 x21, `'50%'` x19, 12 x16, 9 x15, 11 x14, 7 x13, `'20px 20px 0 0'` x10 (sheet tops), 5, 16, 14 (one each). Tailwind: `rounded-xl` x147 (cards, tab bars, text inputs), `rounded-lg` x65 (buttons, chips, set inputs), `rounded` x33, `rounded-full` x32 (spinner, pills, CURRENT SET button, handle bar), `rounded-t` x5, `rounded-md` x2, `rounded-sm` x1; gym sheets use `rounded-t-2xl` (16px top). Common pairings: bottom sheets 20px top (programs/planner/library/plan) or 16px (gym sheets); cards 12 (`rounded-xl`); buttons 10; large dashed add-buttons 10-12; chips 6; icon buttons 7-9; segment bars 10/11.

### A6. Spacing, sizing
- No spacing tokens. Tailwind scale and literal px mixed. Most common Tailwind: `px-4` x71, `gap-2` x68, `px-3` x65, `mb-3` x47, `py-3` x39, `py-2.5` x36, `mt-6` x36, `mb-1` x34, `gap-3` x34, `pt-8` x29, `p-4` x28, `mb-4` x28. Inline gaps: 8 x38, 6 x31, 10 x25, 12 x13, 4 x7.
- Page container conventions: `px-4 pt-8 pb-12` (History/Progress/Exercise history pages), `px-4 pt-8 pb-24` (SettingsPage; 8 uses of `pb-24`), gym session root `pb-24`, LoginPage `px-6`, planner/sheet content `padding 20px`. `main` in `App.tsx`: `flex-1 overflow-y-auto min-h-0` inside a `flex flex-col h-dvh` shell; Nav is the last flex child (not fixed). 14 uses of `pb-12`.
- Touch-target sizes (inline `height`/`minHeight`): 44 x49 combined (explicit "44px convention" in comments), 28 x35, 50 x20 (sheet confirm buttons), 36 x16, 26 x12, 24 x11, 32 x10, 48 x8, 30 x9, 20 x10, 52/56 (large CTAs). Square icon buttons: 28 x21 (width), 36 x15, 22 x12, 32 x6, 34 x4, 44 x1.
- Max widths: none for the app (full viewport width, no centered column). Only: LoginPage `max-w-sm` wrapper; ConfirmDialog card `maxWidth: 380`; Toast `maxWidth: calc(100vw - 32px)`; switcher chips `maxWidth: 130`; misc `maxWidth` 96/110/84 on truncating labels. Layout is designed for ~375px (comments cite 375px and 320px).
- Sheet heights: `maxHeight` 70dvh (gym sheets: MoveSession, WorkoutSidebar, MissedSession), 80dvh (SwapExerciseSheet, G14Prompt), 85dvh (programs BottomSheet, planner Sheet), 90dvh (library sheets); picker sheets fixed `height: 82dvh`.

### A7. Borders
Widths: `1px solid` is the default; `2px solid var(--border-strong)` x36 (e.g. FINISH SESSION button, set-row inputs in places); `3px solid var(--accent)` borderTop x4 and borderLeft (stage/warm accents); `2px solid var(--accent)` bottom underline for sub-tab (Coach/Ask category buttons). Styles: solid mainly; `dashed` `var(--border-strong)` x13 + `var(--border)` x6 + `var(--accent)` for "add"/ghost-affordance buttons and empty cards (e.g. RestDayCard, ApplyAheadBanner, MakeWeekDefault, SessionPreview). Colours: `var(--border)` x133 (cards/inputs), `var(--border-strong)` x66 (buttons, sheets' chips), `var(--border-subtle)` (dividers, nav top border; ~20 uses), `var(--accent)` x13 (selected/active), `var(--error)` (field error). Selected-state pattern (chips): border `var(--accent)`, fill `var(--accent-muted)`, text `var(--accent)`; or fully filled accent with `var(--base)` text and border transparent (segments, tabs, rating chips).

### A8. Shadows, z-index, safe area
- Shadow: only one: `boxShadow: '0 4px 14px rgba(0,0,0,0.3)'` on the CURRENT SET floating pill (gym/GymSession.tsx:753). Everything else is flat with borders.
- z-index (inline numbers and Tailwind): 30 = CURRENT SET pill (GymSession.tsx:754); 40 (`z-40`) = PwaUpdateNotice top bar; 50 = Toast (`z-50`), gym sheets (MoveSession, WorkoutSidebar, MissedSession, SwapExercise `z-50`), programs BottomSheet, planner `Sheet`, designFieldEditors Sheet, PlanPage remove-exercise sheet, LibraryCatalog, LostExercises, ExerciseForm (all 50); 60 = ExercisePicker (programs), WeekExercisePickerSheet, ReassignSheet, PlannerPage G14Prompt; 70 = ConfirmDialog. Collision note (factual): Toast is z-50 and so is the gym/library sheets; ConfirmDialog (70) is above everything; the Toast (z-50) renders under z-60/70 overlays (MakeWeekDefault.tsx comment: "close the dialog (its overlay would hide the toast)").
- Safe area: `env(safe-area-inset-bottom)` in Nav `<nav>` padding-bottom (Nav.tsx:84), Toast and CURRENT SET `bottom: calc(96px + env(safe-area-inset-bottom))` (96px is a hardcoded estimate of Nav height; comment in PwaUpdateNotice says ~35px headroom), every bottom sheet `paddingBottom: calc(24px + env(...))` (or 16px in picker lists), PlannerPage footer `calc(12px + env(...))`; `env(safe-area-inset-top)` only in PwaUpdateNotice (`calc(10px + env(...))`). viewport meta `viewport-fit=cover`. Page heights use `h-dvh` (App shell, loading spinner), `min-h-dvh` (LoginPage); sheet heights use `dvh`.
- Overlay (scrim) colours: `rgba(6,6,7,0.88)` (ConfirmDialog, programs/planner/library/plan sheets: hardcoded dark base, not theme-aware) vs `rgba(0,0,0,0.6)` (gym sheets, Tailwind `fixed inset-0 z-50 flex items-end`).
- Animation: only `animate-spin` x35 (spinners) and `transition-colors`/`transition-all duration-200` on the Toggle and Nav links. No keyframes in CSS.

### A9. Hardcoded colours outside tokens (non-test src)

Files containing literal colour values outside `tokens.css`:
- `components/ConfirmDialog.tsx:31` `rgba(6,6,7,0.88)` scrim.
- `features/programs/ExercisePicker.tsx:63`, `features/programs/ProgramsPage.tsx:561`, `features/planner/PlannerPage.tsx:287`, `features/planner/designFieldEditors.tsx:746`, `features/library/ReassignSheet.tsx:154`, `features/library/LostExercises.tsx:51`, `features/library/LibraryCatalog.tsx:31`, `features/library/ExerciseForm.tsx:121`, `features/plan/WeekExercisePickerSheet.tsx:43`, `features/plan/PlanPage.tsx:1478`: `rgba(6,6,7,0.88)` scrim.
- `features/gym/WorkoutSidebarSheet.tsx:30`, `MoveSessionSheet.tsx:54`, `MissedSessionPrompt.tsx:66`, `SwapExerciseSheet.tsx:99`: `rgba(0,0,0,0.6)` scrim.
- `features/programs/ProgramsPage.tsx:460`: DELETE button `background:'#cc3333'`, `color:'#fff'` (the only hex red and only hardcoded white).
- `rgba(248,113,113,a)` (= `--error` #f87171 literal): `features/history/HistorySessions.tsx` (lines 241-242 .05/.2, 257 .1, 303 .15), `features/history/SessionDetail.tsx` (276-277 .08/.25, 289-290 .06/.3, 319 .15), `features/coach/PhaseLog.tsx` (211,229), `CoachMemory.tsx` (276,294,357,375), `WeightLog.tsx` (253,271), `features/planner/StepExercises.tsx` (521,550,817), `features/planner/designFieldEditors.tsx:468`, `features/plan/PlanPage.tsx:1498`, `features/settings/SettingsPage.tsx:413`.
- `rgba(74,222,128,0.12)` (= `--success` literal): `features/history/HistorySessions.tsx:29`, `features/history/SessionDetail.tsx:19`, `features/gym/TodayPage.tsx:521`.
- `features/gym/GymSession.tsx:753` shadow `rgba(0,0,0,0.3)`.
- `features/settings/SettingsPage.tsx:9-21` the 12 accent hex swatches; `hooks/useAccentColour.ts:4` and `features/settings/settingsStore.ts:6` default `#FF8C42`.
- `color-mix(in srgb, var(--error) 15%, transparent)` (token-based, but a one-off construct): `gym/ExerciseCard.tsx:260`, `gym/SetRow.tsx:378,423,828,874`, `gym/SupersetBlock.tsx:449`; `color-mix(in srgb, var(--accent) 15%, transparent)` in `gym/SwapExerciseSheet.tsx:314` (MuscleFilterChip).
- `index.html:7` `theme-color #060607`; `vite.config.ts:71-72` manifest colours `#060607`.
- Nothing hardcoded in `.css` outside `tokens.css`; global.css states no hardcoded colours.
- Status chips in History use local maps: `HistorySessions.tsx:29-30` and `SessionDetail.tsx:19-20` `completed` {bg rgba success .12, color --success, label DONE / COMPLETED}, `skipped` {bg rgba error .12, color --error, label SKIPPED}.

### A10. Icons
lucide-react only. Sizes in use: 20 (Nav, stroke 1.75), 16 (back chevrons/arrows), 15 (Ellipsis, close X in sheets), 14, 13 (Trash2/Chevron in IconBtn rows), 12, 11. Icons imported: AlertTriangle Archive ArchiveRestore ArchiveX ArrowDown ArrowLeft ArrowLeftRight ArrowUp BookOpen CalendarDays Check CheckCircle CheckSquare ChevronDown/Left/Right/Up Clock Copy Download Dumbbell Ellipsis GitMerge History LayoutList Library Link2 Pencil Plus Repeat2 RotateCcw Settings Sparkles Square Trash2 TrendingUp X.

---

## PART B: APP SHELL, ROUTES, NAV

### B1. `App.tsx` structure
`App()` = `QueryClientProvider` > `AuthProvider` > `BrowserRouter` > [`PwaUpdateNotice` (always, even logged out), `AppRoutes`]. `main.tsx` wraps in `StrictMode`.

`AppRoutes` (exported):
1. Applies `useAccentColour(settings.accentColour)` and `data-theme` effect (settings = `useSettings().data`, which falls back to defaults).
2. `loading` (auth): full-height `h-dvh` centred spinner: 24x24 `rounded-full animate-spin`, `2px solid var(--border-strong)`, top border `var(--text-primary)`, bg `var(--base)`.
3. `!user`: `<Routes><Route path="*" element={<LoginPage/>}/></Routes>` (no Nav, no Toast).
4. Logged in: `<div className="flex flex-col h-dvh">` containing `<SyncManager/>` (null-render: sync queue init/runner, seed default exercises), `<main className="flex-1 overflow-y-auto min-h-0">` with routes, then `<Toast/>`, then `<Nav/>` (Nav always last, in flow, always visible incl. mid-workout).

Routes (all inside `<main>`):
| Path | Component | Notes |
|---|---|---|
| `/` | `Navigate to /today` (replace) | |
| `/today` | `gym/TodayPage` | |
| `/plan` | `plan/PlanPage` | reached from Nav; Plan header links to Programs |
| `/plan/priorities` | `plan/PrioritiesEditor` | |
| `/progress` | `progress/ProgressPage` | |
| `/history` | `history/HistoryPage` | |
| `/exercise/:exerciseId` | `history/ExerciseHistoryPage` | |
| `/session-type/:workoutDayId` | `history/SessionTypeHistoryPage` | |
| `/program` | `programs/ProgramsPage` | not in Nav (chunk 26: PROGRAM removed from bar; reached from Plan header) |
| `/program/:programId` | `planner/PlannerPage` | stepped planner |
| `/meso/:mesocycleId/priorities` | `coach/MesoPrioritiesPage` | |
| `/library` | `library/LibraryPage` | |
| `/settings` | `settings/SettingsPage` | |
| `/coach` | `coach/CoachPage` | unconditional route; page itself renders locked placeholder (`CoachLocked`) for non-Coach users; not in Nav for them |
| `*` | `Navigate to /today` (replace) | |

### B2. `components/Nav.tsx` (bottom tab bar)
Container: `borderTop: 1px solid var(--border-subtle)`, `backgroundColor: var(--base)`. Three stacked regions:
1. Install strip, shown when `useInstallPrompt().canInstall` (a `beforeinstallprompt` event is held): `flex items-center justify-between px-4 py-2`, `borderBottom 1px solid var(--border)`; left text `ADD TO HOME SCREEN` (text-xs, mono, --text-secondary); right button `INSTALL` (accent fill, `--base` text, `px-3 py-2 rounded-lg text-xs font-bold`, mono) calling `install`.
2. Offline strip, shown when `!useOnlineStatus()`: `px-4 py-1.5`, `borderBottom 1px solid var(--border-subtle)`; 6px dot `--text-muted` + text `OFFLINE · SETS WILL SYNC ON RECONNECT` (text-xs font-bold tracking-widest, --text-muted, mono).
3. `<nav className="flex">` with `paddingBottom: env(safe-area-inset-bottom)`; each tab `NavLink` `flex-1 flex flex-col items-center gap-1 py-3 transition-colors`, mono 8px, `letterSpacing 1px`, weight 700; colour `var(--accent)` when route active else `var(--text-dim)`; Lucide icon 20px strokeWidth 1.75 above label. No active background/indicator other than colour; no badges.

Tabs in order: TODAY `/today` (Dumbbell), PLAN `/plan` (LayoutList), PROGRESS `/progress` (TrendingUp), HISTORY `/history` (Clock), LIBRARY `/library` (BookOpen), SETTINGS `/settings` (Settings). Seventh tab COACH `/coach` (Sparkles) appended only when `isCoachUser(user?.id)` (`coach/coachGate.ts`: `VITE_COACH_USER_ID` env set and equals user id). NavLink `to` matching is react-router default (non-`end`): `/plan/priorities` also activates PLAN; `/program*`, `/meso/...`, `/exercise/...`, `/session-type/...` activate no tab (History sub-pages `/exercise/:id` do not highlight HISTORY).

### B3. Other global overlays
- `features/pwa/PwaUpdateNotice.tsx`: shown when `usePwaUpdate().updateAvailable`. `fixed left-0 right-0 top-0 z-40`, padding top `calc(10px + env(safe-area-inset-top))`, bottom 10, `px-4`, bg `--accent-muted`, `borderBottom 1px solid var(--accent)`. Text `UPDATE AVAILABLE` (xs bold, accent, mono). Button `RELOAD` (min-height 44, accent fill, `--base` text, `px-3 rounded-lg text-xs font-bold`; shows `…` and opacity .6 while `isReloading`), dismiss `X` icon button 44x44, `aria-label="Dismiss update notice"`, accent colour, disabled while reloading.
- `features/notifications/Toast.tsx` (+ `toastStore.ts`): single message string in zustand (`useToastStore.show(message)`, `clear`); auto-clears after 3000ms (`useEffect` timeout, restarted by new message). Style: `fixed left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-xl text-sm font-bold text-center`, `bottom: calc(96px + env(safe-area-inset-bottom))`, `maxWidth: calc(100vw - 32px)`, bg `--surface-overlay`, `1px solid --border-strong`, text `--text-primary`, mono. No variants (no error/success colour), no icon, no action, no queue (a new message replaces the old one). Callers (`useToastStore` imports): programs/ProgramsPage, planner/StepPriorities, planner/PlannerPage, library/ReassignSheet, library/ExerciseList, library/LostExercises, library/LibraryCatalog, plan/MakeWeekDefault, gym/useAutoFinishSession.ts (hook).

---

## PART C: REUSABLE COMPONENTS / RECURRING PATTERNS

Legend: "shared" = one exported component used in several places; "local copy" = same visual pattern re-implemented per file.

### C1. ConfirmDialog (shared) `components/ConfirmDialog.tsx`
- Props: `title: string`, `body: ReactNode`, `confirmLabel = 'CONFIRM'`, `danger?: boolean`, `isPending?: boolean`, `onConfirm`, `onCancel`.
- Style: centered modal. Scrim `position:fixed; inset:0; rgba(6,6,7,0.88); zIndex 70; padding 20`, click on scrim = `onCancel`. Card: bg `--surface-raised`, radius 16, padding 24, `width 100%`, `maxWidth 380`, `1px solid --border`. Title: display font 800, 16px, `letterSpacing .5px`, `--text-primary`, mb 12. Body: 14px, `--text-secondary`, lineHeight 1.5, mb 24. Buttons row gap 8, each `flex:1; height 44; radius 10`: CANCEL (transparent, `1px solid --border-strong`, `--text-secondary`, mono 700 12px ls 1px) and confirm (fill `var(--error)` if `danger` else `var(--accent)`, text `--base`, no border, same type; shows `…` and opacity .6, `not-allowed` when `isPending`).
- Used in: `library/ExerciseList.tsx:222` (title `DELETE EXERCISE` / `MOVE TO LOST EXERCISES`), `library/LibraryCatalog.tsx:386` (title `DELETE LIBRARY EXERCISES`, confirmLabel `REMOVE`), `plan/MakeWeekDefault.tsx:85` (title "Make {noun} {n} the new default?", confirmLabel `MAKE DEFAULT`). (Other confirms in the app are NOT this component: see C3 inline sheet confirms and C5 inline confirms.)

### C2. Buttons (all local; no Button component)
Recurring variants as coded (heights/radius/type are literal per site):

| Variant | Visual recipe | Where (representative; not exhaustive for Tailwind-class buttons) |
|---|---|---|
| Primary / accent solid, large | bg `--accent`, text `--base`, no border. Sheet-footer size: `flex:1; height 50; radius 10`, display font 900 13px ls 1.5px | programs/ProgramsPage.tsx:431 `END RUN`/complete (also :341 `CREATE PROGRAM` 9px radius padding 10x20; :388 `START RUN` h54 r11 display 14; :486 `CREATE PROGRAM` h56 r11 display 15), plan/PlanPage.tsx:534-536, planner/StepExercises.tsx:227 `ADD WORKOUT` (h56 r11), planner/PlannerPage.tsx:222 `START` (h50), planner/PlannerPage.tsx:358 `CONFIRM`, library/ExerciseForm.tsx:287 (`SAVE CHANGES`/`ADD EXERCISE`, h56 r11 display 15). Disabled/pending variant swaps bg to `--border-strong` and text to `--text-muted` (ProgramsPage.tsx:388,486; StepExercises.tsx:227; PlannerPage.tsx:222,358; ExerciseForm.tsx:287). |
| Primary, Tailwind/mono, in-flow | `backgroundColor accent; color --base; mono; font-black/bold; text-sm/xs tracking-wider; rounded-lg; px-4/px-3; heights 44 or auto/py-3` | gym/SetRow.tsx `LOG` / `START SET` / `LOCKED` (h44, `px-4 rounded-lg font-black text-sm tracking-wider`; LOCKED is the same fill but `disabled`), `SAVE` (h44, :302,:706); gym/TodayPage.tsx:277 `START SESSION`/`STARTING…`; gym/SessionPreview.tsx:122 `START SESSION`/`STARTING…`; gym/SequenceTodayPage.tsx:190 `START SESSION`/`TRAIN ANYWAY`; gym/SessionComplete.tsx:135 `COMPLETE SESSION`/`SAVING…`; gym/CompletedTodayScreen.tsx:122 `SAVE`, :189 `CONFIRM`, :221 `CONTINUE SESSION`; gym/MissedSessionPrompt.tsx:130 `DO IT NOW`; gym/SwapExerciseSheet.tsx:166 (`ADD EXERCISE`/`CONFIRM SWAP`), :233 `CREATE`; gym/NotesPanel.tsx:82 `ADD NOTE`/`SAVING...`; coach/* `ANALYZE`/`ANALYZING…`, `ADD ENTRY`, `SAVE CHANGES`, `ADD PHASE`, `ASK`/`ASKING...`; pwa `RELOAD`; Nav `INSTALL`; auth/LoginPage.tsx:121 full-width `py-3 rounded text-base font-bold` (`Sign in`/`Create account`, `...` while loading, opacity .5 loading) |
| Primary, compact (28-40px) | accent fill, mono 9-11px, radius 7-10 | plan/ApplyAheadOffer.tsx:150 `APPLY`/`APPLYING…` (h28 r7 9px); planner/designFieldEditors.tsx:432 `ADD` (h36 r8 10px); library/ReassignSheet.tsx:273 `CREATE`, :406 `RETRY` (h40 r10 11px) |
| Primary, square icon | bg accent, h/w 28-40, radius 7-11 | programs/ProgramsPage.tsx:266 `+` (28, display 18px); library/LibraryPage.tsx:113 (40x40 r11 add-exercise icon); library/LibraryCatalog.tsx:274 (36x36 r9) |
| Secondary / outline | bg `--surface` (or `transparent`), `1px solid --border-strong`, text `--text-secondary`, radius 10, mono 700 12px ls 1px; paired left of the primary | `CANCEL` in programs/ProgramsPage.tsx:422,451; planner/StepExercises.tsx:512,538,808; planner/designFieldEditors.tsx:459; plan/PlanPage.tsx:1489; planner/PlannerPage.tsx (`SAVE` h50 :216, `KEEP AS IS` :337, `CANCEL` :352); library/ReassignSheet.tsx (`CANCEL`/`BACK` h40/44) |
| Secondary, quiet/ghost cancel | bg `--surface-raised`, text `--text-muted` (no border) or `1px solid --border`, mono | `CANCEL` in coach/PhaseLog.tsx:141,217, CoachMemory.tsx:164,221,282,363, WeightLog.tsx:188,259, history/HistorySessions.tsx:280, history/SessionDetail.tsx:303; gym/SetRow.tsx `CANCEL` (h44/28 `1px solid --border`), gym/SwapExerciseSheet.tsx:225,159, gym/CompletedTodayScreen.tsx:138,202, gym/ExerciseCard.tsx:243, gym/SupersetBlock.tsx:432; gym/SessionComplete.tsx:149 `BACK TO SESSION`; gym/TodayPage.tsx:266 `PREVIEW SESSION` (`1px solid --border-strong`, `--text-secondary`), :296 `MOVE THIS SESSION` (`1px solid --border`, `--text-muted`); gym/SequenceTodayPage.tsx:203 `SKIP`; gym/MissedSessionPrompt.tsx:143 `MARK SKIPPED`; gym/GymSession.tsx:523 `COACH` (Coach user only, `px-3 py-1.5 rounded-lg text-xs`, `1px solid --border`, `--text-secondary`) |
| Finish-session (outlined heavy) | full width `py-4 rounded-xl font-black tracking-widest text-sm`, `2px solid --border-strong`, `--text-secondary`, mono | gym/GymSession.tsx:724 `FINISH SESSION` |
| Danger (confirm delete) | tinted fill `rgba(248,113,113,0.15)` (or `color-mix(error 15%)` in gym), no border (or `1px solid` rgba .2-.3 in history), text `--error`; sheet-footer size h50 r10 display 900 13px; label `DELETE`/`REMOVE`/`CONFIRM DELETE`/`CONFIRM SKIP` | planner/StepExercises.tsx:518,544,814; planner/designFieldEditors.tsx:465; plan/PlanPage.tsx:1495; coach/PhaseLog, CoachMemory (x3), WeightLog (CONFIRM DELETE / `DELETING...`); history/HistorySessions.tsx:253 `DELETE MESO`, :291 `CONFIRM DELETE`/`DELETING…`; history/SessionDetail.tsx:272 `DELETE SESSION`, :314; gym/SetRow.tsx:418,869 `DELETE`; gym/ExerciseCard.tsx:255 & gym/SupersetBlock.tsx:444 `CONFIRM SKIP`. Solid red variants: programs/ProgramsPage.tsx:457 `DELETE` (`#cc3333` + `#fff`); library/ReassignSheet.tsx:557 `MERGE HISTORY` (fill `--error`, `--base` text); ConfirmDialog `danger` (fill `--error`). |
| Danger text link | transparent, text `--error`, mono | `DELETE` in coach list rows (PhaseLog.tsx:193, CoachMemory.tsx:258,341, WeightLog.tsx:237); menu `MenuAction danger` |
| Text-link / ghost button | transparent, no border, accent or muted text, mono 9-11px | programs/ProgramsPage.tsx:304 `OPEN IN PLANNER`, :310 `START`, :545 `END RUN`; coach `EDIT`/`HIDE`/`SHOW`/`RESTORE`; planner/PlannerPage.tsx:102,124 (accent 14px text links); plan/PlanPage.tsx:724 (sans 13px accent), :560 (32px high muted); library/LibraryPage.tsx:239 `HIDE ARCHIVED`/`SHOW ARCHIVED`; gym/RestTimer.tsx:124 `HIDE`; gym/GymSession `SKIP REST OF EXERCISE`/`SKIPPING…` (h44, `--text-muted`, in ExerciseCard.tsx:269 & SupersetBlock.tsx:458); `BACK` with ChevronLeft in history pages (`flex items-center gap-1 text-xs font-bold tracking-widest`, `--text-muted`) |
| Dashed "add" affordance | full-width, bg `transparent`/`--surface`, `1px dashed --border-strong` (or `--border`), radius 8-12, height 36-52, text `--text-secondary`/`--text-muted`/`--accent`, either sans 11-13 bold or mono 9-10 ls 1.5-2px, usually with Plus icon | planner/StepExercises.tsx:201 (h52 r12), :421 (h48), :478 (h44), :766 (h36), :780 `REST DAY`; planner/designFieldEditors.tsx:441 (h36); plan/PlanPage.tsx:628 (h48, accent text), :648 (deload, accent when active), :1384 (h36, accent), :1446 (h44); plan/MakeWeekDefault.tsx:62 (h48 r11); coach/MesoPrioritiesPage.tsx:135 (h48 accent); gym/GymSession.tsx:707 `+ ADD EXERCISE` (h48, `1px dashed --border`), gym/ExerciseCard.tsx:225, SupersetBlock.tsx:415, SwapExerciseSheet.tsx:249 (h44, dashed --border); gym/SessionPreview.tsx:90 (`1px dashed --accent`); library/ReassignSheet.tsx:296 (h44) |
| Icon button, bordered (close / back / nav) | square 28-40, radius 7-11, bg `--surface-overlay`, `1px solid --border-strong`, icon `--text-secondary` (X 12-15, ChevronLeft/ArrowLeft 16) | Sheet close buttons in every sheet (C3); back buttons: programs/ProgramsPage, library/*, planner/PlannerPage.tsx:159 (36), plan/PrioritiesEditor.tsx:95, coach/MesoPrioritiesPage.tsx:81, gym/SessionPreview.tsx:60; week nav 32x32 in plan/PlanPage.tsx:584,591,604 (prev/next; prev colour dim when `viewWeek <= 1`); progress/ExerciseProgress.tsx:143 (36x36 `--surface`, `1px --border`) |
| Icon button, bare | square 22-36, transparent, no border, icon/glyph `--text-muted`/`--text-dim` | IconBtn (C4), planMenu MenuButton (C4), library/ExerciseList.tsx:154,174,195 (36x36 row actions), library/LostExercises.tsx:207,227, gym/SetRow.tsx:435,451,884,899 (28x28), gym/ExerciseHeader.tsx:80,89 (28x28), pwa dismiss 44x44, ProgramsPage.tsx:229 (28 `--surface` bordered) |

Disabled convention: opacity .5-.6 and/or colour swap to `--text-dim`, `cursor: 'default'|'not-allowed'`; no common disabled style. Pending convention: label swaps to `…`/`WORD…`/`WORD...` (both "…" and "..." appear). No hover/active/focus styles (touch-first); only LoginPage toggle link has JS `onMouseEnter` colour change.

### C3. Bottom sheets / modals (no shared component; ~14 implementations)
Two families:

**Family 1: "surface-raised" sheets** (inline-style, 20px top radius, scrim `rgba(6,6,7,0.88)`): container `position fixed; inset 0; display flex; alignItems flex-end`, tap-on-scrim closes (`e.target === e.currentTarget`); panel `background --surface-raised; borderRadius '20px 20px 0 0'; width 100%; padding '24px 20px'; paddingBottom calc(24px + safe-area); border '1px solid --border'; borderBottom none; maxHeight 80-90dvh; overflowY auto`. No drag handle.
| Sheet | File:line | Props | z | Notes |
|---|---|---|---|---|
| `BottomSheet` | programs/ProgramsPage.tsx:558 | `children, onClose` | 50 | max 85dvh; used at :326 (start run), :409 (complete-meso confirm), :441 (delete-meso confirm), :470 (create program) |
| `Sheet` (exported) | planner/designFieldEditors.tsx:743 | `children, onClose` | 50 | max 85dvh; built-in right-aligned X close (28x28, `--surface-overlay`, radius 7, X 13) with `marginBottom -8`; used in planner/StepExercises.tsx:211 (add workout), :504 (delete workout confirm), :530 (delete exercise confirm), :775 (sequence add/picker), :800 (remove from sequence confirm) and designFieldEditors.tsx:451 (remove warmup item confirm) |
| Remove-exercise confirm sheet (inline) | plan/PlanPage.tsx:1478 | inline JSX | 50 | no max height; CANCEL + REMOVE row (h50) |
| `G14Prompt` | planner/PlannerPage.tsx:269 (rendered :238) | `groups, onKeepAsIs, onConfirmSplit...` | 60 | max 80dvh; AlertTriangle(20, accent) + display 17px title; two-step (confirming flag); buttons `KEEP AS IS`, `GIVE EACH DAY ITS OWN WORKOUT` (accent-muted fill, accent border), `CANCEL`, `CONFIRM`; scrim tap = keep as is |
| `ExercisePicker` (programs) | programs/ExercisePicker.tsx:20 | `workoutDayId, existingExerciseIds, onClose` | 60 | fixed `height 82dvh`, flex column, no padding on panel: header (display 800 16px title `ADD EXERCISE` + 32x32 X), horizontally scrolling FilterChip row (`ALL` + muscle groups), scrolling list; used at planner/StepExercises.tsx:496 |
| `WeekExercisePickerSheet` | plan/WeekExercisePickerSheet.tsx:32 | `title, excludeExerciseIds, onPick(exercise), onClose` | 60 | same layout as ExercisePicker (82dvh); used plan/PlanPage.tsx:1458, 1466 (add/swap in week) |
| `ReassignSheet` | library/ReassignSheet.tsx:45 | `sourceExercise, onClose` | 60 | max 90dvh; multi-step (pick target, create new, preview/merge confirm w/ typed-name match `MERGE HISTORY`); rendered from library/LostExercises.tsx:252 |
| `LibraryCatalog` | library/LibraryCatalog.tsx:23 | `onClose` | 50 | max 90dvh; has its own ConfirmDialog; opened from LibraryPage.tsx:266 |
| `LostExercises` | library/LostExercises.tsx:33 | `onClose` | 50 | max 90dvh; opened from LibraryPage.tsx:268 |
| `ExerciseForm` | library/ExerciseForm.tsx:49 | `exercise (edit) \| undefined, onClose` | 50 | max 90dvh; add/edit exercise form; opened LibraryPage.tsx:260 |

**Family 2: "base" sheets** (Tailwind, `fixed inset-0 z-50 flex items-end`, scrim `rgba(0,0,0,0.6)`, panel `w-full rounded-t-2xl px-4 pt-4 pb-10`, bg `var(--base)`, `maxHeight 70dvh|80dvh`, with a 36x4 `rounded-full` drag-handle bar `--border-strong` at top (decorative, not draggable), header row: accent mono `text-xs font-bold tracking-widest` title left + 28x28 `X`(14) close `--surface-overlay` radius 8 right):
| Sheet | File:line | Props | Used at |
|---|---|---|---|
| `MoveSessionSheet` | gym/MoveSessionSheet.tsx:37 | `workoutDayName, originalDate, currentDate, today, isPending, onPick(date), onClose` | gym/TodayPage.tsx:320, plan/MoveSessionControl.tsx:112; title `MOVE THIS SESSION`, h2 display `text-xl font-black`, sub `PICK TODAY OR A LATER DAY THIS WEEK`, day chips (`rounded-xl px-3 py-2.5`, minWidth 72, current day disabled/raised) or `NO DAYS LEFT THIS WEEK` |
| `WorkoutSidebarSheet` | gym/WorkoutSidebarSheet.tsx:24 | `sessionId, onClose` | gym/GymSession.tsx:763 (opened by `COACH` button, Coach user only); header is a 2-segment tab bar `NOTES` / `ASK` (accent fill active) + X(`aria-label="Close"`); bodies: NotesPanel / QaPanel |
| `SwapExerciseSheet` | gym/SwapExerciseSheet.tsx:50 | `mode ('swap'\|'add'), excludeExerciseIds, onConfirm, onClose, ...` | gym/ExerciseCard.tsx:287, gym/SupersetBlock.tsx:482, gym/GymSession.tsx:767 (add); titles `SWAP EXERCISE`/`CONFIRM SWAP`/`ADD EXERCISE`/`CONFIRM ADD`; flex column max 80dvh; muscle-filter chips (MuscleFilterChip) in add mode; inline create-exercise form |
| `MissedSessionPrompt` | gym/MissedSessionPrompt.tsx:17 | `queue, activeMeso, onDismiss, today` | gym/TodayPage.tsx:115; title `MISSED SESSIONS`; per-session `DO IT NOW` (primary) / `MARK SKIPPED` (outline) |

### C4. ⋯ row menu (shared) `features/plan/planMenu.tsx`
- `MenuButton({ open, onClick, ariaLabel, dot = false })`: 28x28, radius 7, `Ellipsis` icon 15; closed = transparent bg, `--text-dim`; open (`aria-expanded`) = bg `--accent-muted`, `--accent` icon; `dot` adds `DiffDot` (6x6 accent circle at top 4 right 4, `data-diff="kind"`).
- `DiffDot()` (exported): also used on a spacer (PlanPage.tsx:2073) where a past week has no ⋯.
- `MENU_PANEL_STYLE`: inline panel under the row (not a popover; comment: exercise card clips overflow at 375px): `margin '2px 16px 8px'; padding '8px 10px'; background --surface-overlay; border '1px solid --border-strong'; radius 9; flex column; gap 8`.
- `MenuAction({ onClick, disabled, ariaLabel, danger, children })`: transparent, `minHeight 32`, mono 10px 700 ls 1px, uppercase labels supplied by caller (icon + text children); colour `--text-secondary` / `--error` if `danger` / `--text-dim` if disabled; opacity .5 disabled.
- Used: plan/PlanPage.tsx (exercise menu :1666-1703 with Swap/Move up/Move down/Add warmup sets/Remove; set menus :1865,1972,1995,2020,2075,2229, "Delete set", "Add stage", "Delete stage"); planner/designFieldEditors.tsx:647-663 (WarmupItemMenuRow: Move up/down/Remove, panel margin override `'2px 0 8px'`); plan/StructureFields.tsx (`ExerciseDesignMenu`, `SetRestMenu` supply the content that sits inside these panels: REST / REST AFTER / TEMPO / UNIT).
- Visible only on editable (non-past) weeks (per comments in PlanPage); conditions belong to the screen inventories.

### C5. Segmented controls / tab bars (local copies, same recipe)
Recipe: flex row inside a `1px solid --border` container with `overflow:hidden`, equal-width (`flex:1`) buttons; active = `bg --accent`, text `--base`; inactive = `bg --surface`, text `--text-muted`; labels mono uppercase.
| Instance | File:line | Labels | Size |
|---|---|---|---|
| `SegmentBar<T>` (generic; only named component) | plan/PlanPage.tsx:1516, used :1400 | `SETS` / `STRUCTURE` (`PLAN_VIEWS`) | radius 11, padding 10px 0, 10px, ls 2px; props `segments {id,label}[], active, onSelect, marginBottom?` |
| History tabs | history/HistoryPage.tsx:36-52 | `SESSIONS` / `EXERCISES` | Tailwind `rounded-xl overflow-hidden`, `py-2.5 text-xs font-bold tracking-widest` |
| Progress tabs | progress/ProgressPage.tsx:31-47 | `EXERCISE` / `MESO OVERVIEW` | same as History |
| Coach tabs | coach/CoachPage.tsx:53 | `ANALYSIS` / `ASK` / `CONTEXT` | same recipe (Coach only) |
| Coach analysis sub-tabs | coach/CoachAnalysisTab.tsx:42 | `SESSION` / `WEEK` / `MESO` | underline style (`borderBottom 2px solid accent` active) per grep |
| Coach ask categories | coach/CoachAskTab.tsx:50 | `ABOUT TRAINING` / `ABOUT PLANNING` / `HOW THIS APP WORKS` | underline style |
| Sidebar sheet tabs | gym/WorkoutSidebarSheet.tsx:47 | `NOTES` / `ASK` | `flex flex-1 rounded-xl`, `py-2 text-xs` |
| Planner step switcher | planner/PlannerPage.tsx:188-197 | `1 · PRIORITIES` / `2 · EXERCISES` / `3 · VOLUME` | radius 11, padding 10px 2px, 9px ls 1px |
| Schedule type | planner/StepExercises.tsx:166-174 | `WEEKDAY` / `SEQUENCE` (`st.toUpperCase()`) | radius 10, padding 9px 0, 10px ls 1.5px; disabled while mutation pending |
| Planning type | planner/StepVolume.tsx:70-86 | `STABLE` / `WEEK-DEPENDENT` (+ `note` text) | radius 10, padding 10px 6px |
| Deload override | planner/StepVolume.tsx:160-170 | `USE MY DEFAULT` / `CUSTOM` | same |
| Library view mode | library/LibraryPage.tsx:160-180 | `LIST` / `EDIT TAGS` | pill variant: container `--surface`, `1px --border-strong`, radius 9, padding 3; active segment `--accent-muted`/accent text (not solid fill), h32 r7 |
| Settings chip rows | settings/SettingsPage.tsx:77-100 (`chipRow` fn) | THEME `DARK`/`LIGHT`; weight unit; week start; warmup display; etc. | separate buttons (not joined) `flex-1 py-3 rounded-xl text-xs font-bold`, minHeight 44, active accent fill/inactive `--surface-raised` + `1px --border`, ls .08em |
| `ChipRow<T>` (settings) | settings/DeloadRulesEditor.tsx:79 | options passed (e.g. `DOWN`/`UP`) | `flex gap-2`, buttons `flex-1 py-2 rounded-xl text-xs font-bold`, minHeight 36, active accent fill, inactive `--surface-raised` + border, props `options, value, onChange, disabled` |

### C6. Chips
- Filter chip (muscle groups etc.), selected = accent-muted fill + accent border + accent text; unselected = `--surface` + `1px --border-strong` + `--text-muted`; all in horizontal `hide-scrollbar` rows, `gap 6`, with `ALL` first; tapping the active muscle again resets to ALL. Four local copies:
  - programs/ExercisePicker.tsx:133 `FilterChip` (h28, padding 0 10px, r6, 9px ls 1px): used same file.
  - plan/WeekExercisePickerSheet.tsx:108 `FilterChip` (same).
  - library/LibraryPage.tsx:279 `FilterChip` (h30, 0 12px, 10px ls 1.5px): used :140,:146.
  - gym/SwapExerciseSheet.tsx:305 `MuscleFilterChip` (Tailwind `rounded-md text-xs font-bold tracking-wide`, h28, border `--border` not strong, fill `color-mix(accent 15%)`): add mode only.
  - progress/ExercisePicker.tsx:51-64 and history/HistorySessions.tsx:128,203,216 use solid-accent-fill chips (active = accent bg, `--base` text, transparent border; inactive `--surface` + `1px --border`) for status/muscle filters (`ALL`, `DONE`, ... / muscle groups).
- Option chip grid: library/TagChipGrid.tsx:8 `TagChipGrid<T>({ values, labels, selected, onToggle, columns })`: CSS grid `repeat(columns,1fr) gap 8`, chips h42 r9 mono 10px ls 1px, multi-select, accent-muted style. Used by library/MuscleSubgroupPicker.tsx:64, ExerciseTagList.tsx:230, ExerciseForm.tsx:239,252.
- Single-select scales (touch 44): gym/RatingChips.tsx:14 `RatingChips<T>({ scale, value, onChange, label })` (label above in `text-xs --text-muted` mono; chips `h44 px-3 rounded-lg text-xs font-bold tracking-widest`, active accent fill/transparent border, inactive `--surface` + `1px --border`; horizontally scrollable `hide-scrollbar gap-1.5`; tapping active clears to null). Used: gym/SessionComplete.tsx:106-107 (`ENERGY (OPTIONAL)`, `PUMP (OPTIONAL)`), gym/SetRow.tsx:763,1335 (`FORM`), planner/StepVolume.tsx:580,618, plan/PlanPage.tsx:1987. Same visual recipe copied in plan/MarkSelector.tsx:20 (`MarkSelector({ value, onChange, disabled })`, nullable, used planner/StepPriorities.tsx:116,131) and coach/PrioritySelector.tsx:14 (`PrioritySelector({ value, onChange, disabled })`, non-nullable; used coach/MesoPrioritiesPage.tsx:189,206).
- Switcher chips (two-line, active = solid accent): plan/WorkoutSwitcher.tsx:23 `WorkoutSwitcher({ days, selectedDow, onSelect })` (SUN/MON.. mono 8px + workout name display 800 12px, `maxWidth 130`, padding 8px 12px, r10; used PlanPage.tsx:736) and plan/SequenceSlotSwitcher.tsx:25 `SequenceSlotSwitcher({ slots, selectedId, onSelect })` (`SLOT n` + name; rest slots disabled opacity .5; `role="region" aria-label="Sequence slot switcher"`; used PlanPage.tsx:781). Both: horizontally scrolling `hide-scrollbar`, `gap 6`, `marginBottom 14`.
- Unit chips: planner/designFieldEditors.tsx:209 `UnitChips({ value, globalUnit, disabled, onChange, style })`: `INHERIT (KG|LBS)` / `KG` / `LBS`, h24, 8px; used planner/StepExercises.tsx:638, plan/StructureFields.tsx:236.
- Static marker chip: plan/StructureFields.tsx:173 `MarkerChip` (h16, padding 0 6, r5, `--surface-overlay`, `1px --border-strong`, mono 9px, `--text-dim`), `ExerciseMarkers` wrapper; used PlanPage.tsx:2104,2107 (set tags / markers) and StructureFields.
- Tag toggles in PlanPage: TagsEditor chips (PlanPage.tsx:2529 h24 r6 9px accent-muted when active; `+ CUSTOM` dashed at :2564; remove x at :2538).
- Superset link toggle: planner/designFieldEditors.tsx:696 `SupersetLinkToggle({ linked, disabled, onToggle, suffix })` full-width h28 r7 9px with Link2 icon; labels `LINK AS SUPERSET` / `SUPERSET — TAP TO UNLINK`; linked = accent-muted + accent border; unlinked = dashed `--border-strong`; used planner/StepExercises.tsx:467, plan/PlanPage.tsx:1769.
- Status chip (read-only): small rounded label with tinted bg + coloured text (HistorySessions.tsx:29 / SessionDetail.tsx:19, ProgramsPage.tsx:516 accent badge `borderRadius 6 padding 3px 10px` for ACTIVE-style label, `SYNC` badges per tokens.css comment).

### C7. Steppers and numeric inputs
Local copies (all `−` / `+` text glyph buttons around a centred value; glyph colours `--text-muted`, `--text-dim` when disabled):
| Component | File:line | Props | Look | Used |
|---|---|---|---|---|
| `Stepper` | settings/DeloadRulesEditor.tsx:125 | `value, onChange, step, min?, max?, format?, disabled?, label?` | container h30, `--surface-overlay`, `1px --border-strong`, r8; buttons 26x30; value display 800 13px minWidth 48; optional mono 9px label left | DeloadRulesEditor.tsx:236,267,280,318,345 |
| `RestStepper` (planner copy A) | planner/StepVolume.tsx:651 | `label?, value:number\|null, onChange, defaultText` | h26, `--surface-overlay`, r6; buttons 22x26 13px; value display 800 11px; 15s step, max 600s; "−" at floor -> null; null shows `defaultText` in `--text-dim` | StepVolume.tsx:496,596 |
| `RestStepper` (copy B, exported) | planner/designFieldEditors.tsx:53 | `label, value, disabled, onChange, defaultText, ariaLabel?` | as A but container bg `--surface`; adds `disabled` and aria "Less/More {ariaLabel}" | StepExercises.tsx:655,662; designFieldEditors.tsx:286,294 (BlockRestEditor); plan/StructureFields.tsx:211,219,262,271 |
| `RirStepper` | plan/PlanPage.tsx:2580 | `value:number\|null, disabled, changed?, onChange` | h28, `--surface-overlay`, r6, buttons 22x28 15px; shows `NO RIR` (dim) or `RIR n` (display 800 12px); "+" from null starts at 3, max 9, "−" at 0 -> null; `changed` applies CHANGED_EDGE (accent border + accent-muted fill + accent text) | PlanPage.tsx:2214 |
| Sets count stepper | planner/StepVolume.tsx:275,286 (inline in ExerciseSetsEditor) | | transparent 26x30 buttons 15px | StepVolume |
| Rest/other tiny steppers | plan/PlanPage.tsx:2594,2615 (28x22 glyph buttons around values) | | | PlanPage week/set editors |
- Number inputs: gym/SetRow.tsx weight `type="text" inputMode="decimal"` (flex-1, h44, `px-3 rounded-lg text-sm font-bold text-center`, bg `--surface`, `1px --border`, mono; embedded unit toggle text button at right `text-xs`, accent+700 when overridden) and reps `type="number" inputMode="numeric"` (width 60, h44, `px-2`), separated by `×` (14px `--text-muted`); `placeholder '0'` (or `···` while loading); `opacity .5` while loading. Settings numeric text inputs: SettingsPage.tsx:235,303 (rest seconds as `m:ss`, auto-finish minutes) with `restEditing`/`autoFinishEditing` local state. Plan editors: PlanPage.tsx:2329 (rep target), 2425 (weight target), 2553 (custom tag) tap-to-edit text inputs. Planner StepVolume.tsx:383,469 (rep/target text inputs; button shows value, tap -> input). Totals: 39 `<input>`, 7 `type="number"`, 14 `inputMode`, 6 `<textarea>`.
- Text inputs in sheets/forms: `height 44-50`, bg `--surface`, `1px solid --border-strong` (error: `--error`; focused-state variants use `--accent` e.g. `border: ... ${error ? 'var(--error)' : 'var(--accent)'}` x3), radius 10-12, padding `0 14px`, size 14-15 (e.g. ProgramsPage.tsx:353,478; PlannerPage.tsx:168; ExerciseForm.tsx:198); page-level filter inputs use Tailwind `w-full px-3 py-2.5 rounded-xl text-sm outline-none` (HistorySessions.tsx:97; shared `inputStyle` object there: bg `--surface`, `1px --border`, text `--text-primary`).
- Selects: only 3 native `<select>`, all `w-full px-3 py-2.5 rounded-xl text-sm outline-none appearance-none` with `--surface` bg, `1px --border`, mono (or sans): history/HistorySessions.tsx:107 (meso filter, options uppercase, `ALL MESOS`, `(ACTIVE)`), history/ExerciseHistoryView.tsx:363, progress/MesoProgress.tsx:264 (meso selector). No custom dropdown. Date inputs: native `type="date"` x4 (HistorySessions.tsx:170,185; PhaseLog.tsx:121; WeightLog.tsx:162).

### C8. Toggles (switch)
Two identical local copies: `Toggle` at settings/DeloadRulesEditor.tsx:42 (`{ value, onChange, label, disabled }`) and the `toggle()` function in settings/SettingsPage.tsx:~117-135. Row `flex items-center justify-between py-1`: label (sans, `text-sm`, `--text-primary`) left; switch 48x28: track `rounded-full`, on = `--accent` / off = `--surface-raised` + `1px --border` (transparent border when on); thumb 20x20 circle at `left: 4` off / `24` on (`top-1`), on = `--base`, off = `--text-muted`; `transition-colors/all duration-200`; `aria-label={label}`; disabled opacity .5. Used: SettingsPage (Show rest timer, buzz, measure set time, etc.), DeloadRulesEditor.tsx:221,259,310,337. No checkboxes/radios anywhere (`type="checkbox"` count 0); warmup checklist (gym/WarmupRoutineChecklist.tsx) uses lucide `Square`/`CheckSquare` icon buttons (44px).

### C9. Cards and rows
No Card component. Recipes:
- Standard card: `rounded-xl` (12) + `bg --surface` + `1px solid --border`, padding `p-4` (SettingsPage sections `rounded-xl p-4 space-y-4/5` via `cardStyle`; coach tabs `cardStyle` x4 files, `rounded-xl p-6 text-center` for EmptyCard).
- Exercise card (gym): `rounded-xl overflow-hidden` + border (ExerciseCard.tsx:73; SupersetBlock.tsx:222 `1px solid --border`).
- Dashed info card: `rounded-xl p-5`, `1px dashed --border`, bg `--surface`: gym/TodayPage.tsx:455 `RestDayCard({ label })` (kicker `REST` xs bold tracking-widest `--text-muted`, body text-sm `--text-secondary`). ApplyAheadBanner uses dashed `--border-strong`, r11.
- Program/meso cards: programs/ProgramsPage.tsx `ActiveMesoCard` (:502), program rows (~:229 with 28px button), selectable option rows (accent-muted + accent border when selected, ProgramsPage.tsx:368, `width 100%, padding 12px 14px, text-left`).
- List rows with bottom hairlines: `borderBottom '1px solid var(--border-subtle)'` (isLast -> none) in WeekDiffMarks, Plan set rows, library lists; `borderTop` dividers (`--border-subtle` x11).
- Today due-row: gym/TodayPage.tsx:485 `DueTodaySummaryRow` (bordered card + status chip; button `--surface`, `1px --border`, display 10px at :506).
- Diff marks (plan/WeekDiffMarks.tsx): exported style constants `CHANGED_EDGE` (accent border + accent-muted bg), `CHANGED_CELL` (+ accent text), `CHANGED_BAND` (accent-muted band), `REMOVED_TEXT` (`--text-dim` + line-through); components `RemovedExerciseLine`, `RemovedSetRow`, `RemovedStructureRow`; `DiffDot` from planMenu.
- Section label above groups (very common, not a component): mono 9-11px, 700, ls 1-2.5px, `--text-muted`/`--text-dim`, uppercase; SettingsPage `sectionTitle(text)` = `text-xs font-bold tracking-widest mb-3` with `labelStyle` (mono, 11px, ls .1em, `--text-muted`).

### C10. Banners / strips / inline messages
- Install strip and Offline strip (Nav.tsx, B2).
- Update notice (PwaUpdateNotice, B3).
- Apply-ahead banner: plan/ApplyAheadOffer.tsx:88 `ApplyAheadBanner({ offer, outcome, isPending, onApply, onDismiss })`; renders null if neither `offer` nor `outcome`; dashed `--border-strong` r11 box, padding 10x12, mb 12; text mono 10px 700 ls 1px `--text-secondary` e.g. `APPLY THIS CHANGE TO {n} PLANNED WEEK(S) AHEAD?` / outcome `APPLIED TO x OF y PLANNED WEEKS...`; sub lines 9px `--text-dim`; `OFFLINE — CONNECT TO APPLY`; buttons `APPLY` (disabled when pending or offline) + X dismiss (28x28). Used PlanPage.tsx:1373.
- Make-week-default button (dashed button, not banner): plan/MakeWeekDefault.tsx:25 `MakeWeekDefault({ mesoId, weekNumber, isSequence })`, label `MAKE THIS {WEEK|CYCLE} THE NEW DEFAULT` / `MAKING THE DEFAULT…`, opens ConfirmDialog; used PlanPage.tsx:704.
- Page-level error: plan/PlanPage.tsx:212 `PlanLoadError` ("COULDN'T LOAD PLAN" mono 11px ls 2px `--error`, sub "Check your connection and try again." 10px `--text-dim`, centred in full height); copied pattern in plan/PrioritiesEditor, planner/StepPriorities, coach/MesoPrioritiesPage ("the app's existing page-level load error").
- Inline form errors: `<p>` text `--error` (text-sm in LoginPage; mono 10-11px elsewhere); success `<p>` `--success` (LoginPage message); field-level error = input border `--error` + message below (ExerciseForm name, designFieldEditors TempoEditor).
- Deload indicator toggle button on Plan: PlanPage.tsx:648 (dashed `1px --accent` when `weekIsFullyDeload`, accent-muted fill) and :1323 `DELOAD` pill (h26 r6 9px, accent-muted/accent when `weekPlan.isDeload`).

### C11. Spinners, loading, empty states
- Spinner (pure CSS ring, `animate-spin`, 2px border `--border-strong`, `borderTopColor` varies): App.tsx loading (24px, top `--text-primary`); `PlanSpinner` plan/PlanPage.tsx:201 (22px, top `--accent`, full-height `--base`); coach `Spinner` x3 local copies (coach/CoachMesoAnalysisTab.tsx:30, CoachWeekAnalysisTab.tsx:21, CoachSessionAnalysisTab.tsx:29: 20px, top `--text-primary`, `py-12`); gym TodayPage/other pages: `w-6 h-6 rounded-full animate-spin` (gym/TodayPage.tsx:~51). 35 `animate-spin` uses total. Text loading states instead use mono words: `LOADING…`, `LOADING...`, `···` placeholder (inputs), `…` on pending buttons.
- Empty state patterns: (1) centred dim mono caption: `<p style="textAlign center; padding '20px 0'|'24px 0'|'32px 0'; mono 11px 700 ls 2px; color --text-dim">` e.g. `NO WORKOUTS YET` (planner/StepExercises.tsx:~185), many others; (2) coach `EmptyCard({ title, body })` x3 local copies (coach/CoachMesoAnalysisTab.tsx:41, CoachWeekAnalysisTab.tsx:32, CoachSessionAnalysisTab.tsx:40): `rounded-xl p-6 text-center`, card style, title `text-sm font-bold` mono `--text-secondary`, body `mt-2 text-xs --text-muted`; (3) gym `RestDayCard` (dashed card, above) and `RestDayScreen` (gym/RestDayScreen.tsx with `MoonGlyph` SVG, h1); (4) library/LibraryCatalog empty ("expected state until content ships"); (5) `CoachLocked` placeholder (coach/CoachLocked.tsx).

### C12. Page headers
- Large title `h1`: display font, `font-black tracking-tight`, `text-3xl` (HISTORY, PROGRESS, SETTINGS...) or `text-2xl`, `--text-primary`, in `px-4 pt-8` container; ProgramsPage/PlanPage use inline display 900 26-28px, `lineHeight 1`, optional `letterSpacing -0.5px`. Back affordance: `ChevronLeft` + `BACK` text button (history sub-pages) or 36x36 bordered square (planner/progress/coach pages).
- gym/TodayHeader.tsx:7 `TodayHeader({ label })` (h1 for Today).

---

## Gaps / uncertainties
- Tailwind utility counts (`px-4`, `text-xs`, etc.) include every `className` occurrence including multi-class duplicates; inline-style counts only match single-line `prop: value` pairs, so properties spread across lines (common in Tailwind-era gym/settings files) are under-counted in the inline tables. The tables show relative weight, not exact totals.
- The per-button table in C2 was derived from a scripted scan of `<button>...</button>` blocks (303 total across 95 files); buttons built via helper functions (e.g. SettingsPage `chipRow`/`toggle`, SetRow's many conditional buttons) may appear once in the scan but render in several contexts. Exact visibility conditions for each are in the per-screen inventories, not here.
- Whether any component actually uses the Tailwind colour utilities (`bg-surface`, `text-ink`, `border-wire`, `text-accent`): not verified exhaustively; code inspected uses `var(--...)` inline exclusively.
- Light-theme appearance of items that hardcode dark values (all `rgba(6,6,7,0.88)` scrims, `rgba(0,0,0,0.6)` gym scrims, `#cc3333`, manifest/theme-color) and the fact that `--error`/`--success`/`--accent` are not re-tuned for light: stated as coded; effect on contrast not evaluated.
- Coach underline-style tabs (CoachAnalysisTab sub-tabs, CoachAskTab categories): style taken from grep of `borderBottom: 2px solid accent` hits (CoachAskTab.tsx:50 and CoachAnalysisTab.tsx:43); neighbouring styling not read line-by-line.
- `.test.tsx` files, `__fixtures__` HTML (static render snapshots of Plan/Today/Gym), and the `coach/` internals beyond the shared patterns were not inventoried here.
- Toast bottom offset (96px) and CURRENT SET offset are hardcoded to approximate Nav height; Nav height actually varies with the install/offline strips (PwaUpdateNotice comment explains this deliberately); not measured.
- `usePwaUpdate`, `useInstallPrompt`, `useOnlineStatus` internals not read beyond the flags used (`updateAvailable`/`isReloading`/`canInstall`/boolean).

---

# Part 4 — Supplement (verified by the assembler)

**Rating option sets** (`src/features/gym/ratingScales.ts`, rendered by `RatingChips`; SessionComplete shows ENERGY (OPTIONAL) and PUMP (OPTIONAL)):
- Form (per set): RUSHED, NORMAL, CONTROLLED, EXTRA CONTROLLED
- Energy: NONE, LOW, NORMAL, HIGH, SUPREME
- Pump: NONE, SOME, GOOD, EXTREME

**Muscle-group chip labels** (`src/lib/exerciseTags.ts` `MUSCLE_GROUP_LABELS`; local copies of the same list with their own labels exist in programs/ExercisePicker, history/HistorySessions, library/ExerciseForm, library/LibraryPage, plan/WeekExercisePickerSheet, progress/ExercisePicker): CHEST, BACK, SHOULDERS, BICEPS, TRICEPS, FOREARMS, QUADS, HAMSTRINGS, GLUTES, CALVES, CORE, OTHER.

**Plan SETS-view editors** (`PlanPage.tsx` 2362–2624, read directly): WeightTargetEditor (`Enter a valid weight`), TagsEditor (TAGS label, preset chips, per-active-chip copy icon "Apply to all sets", `+ CUSTOM` dashed button, `custom tag` input) and RirStepper (`NO RIR` / `RIR n`, `−`/`+`, + from none → 3, max 9) are documented in 1.1.

**Known limits of this inventory** (each section's own "Gaps" list is authoritative): counts in Part 2–3 are grep-based and approximate; QaPanel's ASK tab is summarised, not itemised; `StructureFields.tsx` was read by the STRUCTURE pass, not the SETS pass; Coach screens other than the completed-run destination are out of scope.
