# Overload v2 — Audit Tracker
Source: Fable 5 technical audit, July 2026

---

## Fixed
- FIX 1: C5 + C4 — fake prefill, empty log silent failure (July 7)
- FIX 2: C1 — offline sync IDs invalid UUID, dead-letter after 3 attempts (July 7)
- FIX 3: C2 — today frozen at module load, now refreshes on visibility change (July 7)
- FIX 4: C3 — null muscle_group crash, SQL backfill run, guards added (July 7)
- FIX 5: H3 + A1 — offline session mutations queued, sign-out added (July 7)
- FIX 6: H1 — offline last session correctly excludes current session (July 7)
- FIX 7: H6 + H7 — accent-muted derives from accent, settings always upsert all fields (July 7)
- FIX 8: E1 — logged sets editable and deletable with renumbering (July 7)
- FIX 9: E2 — missed session modal dismissable via X or backdrop tap (July 7)
- FIX 10: E3 — DELETE DAY and exercise delete require confirmation (July 7)
- FIX 11: A5 — mutations invalidate related caches consistently (July 7)
- FIX 12: M6 — iOS vibration fallback to visual flash (July 7)
- FIX 13: Q7 — timezone standardised to local time in mesoService.ts (July 7)

---

## Pending your action
- S1 (exercises RLS): verify in Supabase dashboard that the exercises table has RLS enabled
  and correct policies from v1. Add .eq('user_id', userId) filter in exerciseService.ts
  as defence-in-depth regardless.

---

## Deferred (not urgent for personal use)
### Architecture
- A2: positional-matching model in gym UI structurally fragile — needs identity matching via weekPlanSetId
- A3: no uniqueness constraints on v2_sessions(user_id, date) or v2_set_logs(session_id, exercise_id, set_number)
- A4: meso weeks anchored to start date — plan/calendar weeks disagree mid-week start
- A6: programs can never be deleted
- A7: toMesocycle fabricates half-real Program with empty schedule

### Performance
- P1: session start does double N+1 over exercises — use single IN query
- P2: history list downloads every set log ever — use view/RPC
- P3: Google Fonts not offline-cached (unlike Northstar v2)
- P4: Dexie set_logs grows without bound
- P5: fetchLastSessionLogs limit-50 can push prior session out mid-workout

### Security
- S2: updateExercise/setExerciseArchived filter only by id — add user_id scoping
- S4: .env.local contains VERCEL_OIDC_TOKEN — move to .vercel/ only

### Code Quality
- Q1: hardcoded colours violating no-hardcoded-colours rule
- Q2: MUSCLE_LABEL/MUSCLE_GROUPS copy-pasted in five files, one drifted
- Q3: two styling dialects (Tailwind vs inline styles)
- Q4: mutateAsync without try/catch in gym flow
- Q5: obfuscated type cast hiding null muscle_group
- Q6: dead code (restElapsed, LOOKBACK_DAYS duplicated, unused imports)

### Medium Bugs (deferred)
- H2: extra sets corrupt positional row model
- H4: progress chart drops newest sessions after 1000 logged sets
- H5: concurrent offline logs collide via shared ref
- M1: primeOfflineCache omits weekPlan from deps
- M2: in-progress sessions older than 7 days fall out of scheduler lookback
- M3: plan-page add-set numbering collides after deletions
- M4: copyFromPreviousWeek non-transactional
- M5: spontaneous dropsets never get parentSetId, set notes unwritable
- M7: rapid schedule edits race condition

### Edge Cases
- E4: REDO is lossy without warning
- E5: kg→lbs is a label not a conversion
- E6: active session with deleted workout day → blank Today tab
- E7: no iOS home-screen icon (apple-touch-icon missing)
- E8: multi-workout same day not communicated as design constraint
- E9: navigator.onLine false-positives on captive portals

