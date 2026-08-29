# Exercise Library — Legacy Provenance Review (migration 020 input)

*Proposed by Claude Code, 2026-08-29, per EXERCISE-LIBRARY-TASKS.md §4.4
step 1. Read directly from production `exercises` (70 rows, account
`12e79b69-9891-4f53-a7cf-650edd83659f`), not from `defaultExercises.ts` —
same reasoning as `COACH-EXERCISE-TAGS.md` and
COACH-WEEK-ANALYSIS-TASKS.md §4.2: names must come from the database,
because classification here is exactly the name-match rule
`importDefaultExercises()` itself uses, and a code-sourced proposal would
silently agree with itself instead of checking against what's actually
stored. Archived rows are included and classified too — archived means
"not offered in the picker," not "not from the seed" (§4.2 step 1,
`COACH-WEEK-ANALYSIS-TASKS.md` §4.2 step 1 applied the same reading).*

**Status: awaiting review (§4.4 step 4). Nothing has been written to
`source_library_id` yet — migration 020 does not exist until this file is
corrected and approved, same gate migration 014 went through as
`COACH-EXERCISE-TAGS.md`.**

## What this document proposes

Create one synthetic, unlisted library (`slug = 'legacy-default'`, name
"Original Default List") and attach every row below classified `legacy`
to it via `source_library_id`. Every row classified `hand-created` stays
`source_library_id = NULL`. This is §4.1's proposal, restated here against
the real, now-fully-confirmed data rather than the assumption it started
from — see EXERCISE-LIBRARY-TASKS.md §4 for the full reasoning and the
rejected alternatives.

**The classification rule**, stated plainly so review can test it against
each row below: a name that matches a `DEFAULT_EXERCISES` entry
case/whitespace-insensitively is `legacy`; everything else is
`hand-created`. This does not assert the row was *literally* inserted by
a seed — it asserts the name is identical to a default entry and would be
treated as the same exercise by every existing code path (§4.3). Applied
here, it is unambiguous for all 70 rows: **0 ambiguous / near-miss
matches needing judgment.**

## The numbers

| | Count |
|---|---|
| Live exercises on the account | **70** |
| Matched a `DEFAULT_EXERCISES` name → `legacy` | **46** |
| No default match → `hand-created` | **24** |
| Ambiguous / needing judgment | **0** |
| Archived rows (all `legacy`) | **4** |
| Near-collision pairs (archived/active or active/active) | **7** |

## Insertion-history cross-check (informational only — not the classification basis)

`created_at` was evaluated as a cross-check, not the primary rule
(EXERCISE-LIBRARY-TASKS.md §4.3 — clustering fails as a primary rule
regardless, since a hand-added row created seconds after a bulk batch is
indistinguishable from it by time alone). The real shape, confirmed
against production and fully accounted for — **28 individually-inserted
rows + 42 bulk-inserted rows = 70 exactly:**

- **42 of the 46 `legacy` rows share one identical timestamp down to the
  microsecond** — `2026-08-12 01:26:26.632424+00`. In Postgres `now()` is
  evaluated once per statement, so this is the unambiguous signature of
  one bulk `INSERT` — the real `importDefaultExercises()` run (the manual
  Library-screen "download defaults" button), not the automatic
  fresh-account seed.
- **The other 28 rows are individually, distinctly timestamped** — no two
  share a timestamp, live or hand-added — consistent with one-at-a-time
  entry via ADD EXERCISE:
  - **4 are `legacy`** (`Dips`, `Barbell Row`, `Leg Press`, `Leg
    Extension`) — Adam had already hand-typed these exact default names
    days before the bulk import ran, so `importDefaultExercises()`
    correctly skipped them (46 − 4 = 42, exactly the bulk batch size).
  - **24 are `hand-created`** — every one of them. 23 sit inside two
    tight insertion windows on **2026-07-03** (`13:49:34`–`13:51:32`, 10
    rows; `21:22:38`–`21:26:23`, 13 rows — the second window also holding
    all 4 of the individually-stamped `legacy` rows above, interleaved).
    The 24th, **`Incline Smith Press`**, was added alone on **2026-07-05**
    (`17:15:15.294376+00`), two days later — not interleaved with
    anything, but still an individual, one-at-a-time insert like the
    other 23.
- **For the 4 individually-stamped `legacy` rows, this cross-check
  provides no corroboration either way** — their classification rests on
  the name match alone, which §4.3 already argues is sufficient on its
  own. For the 42-row batch, the cross-check independently corroborates
  the classification with a real, strong signal.

This closes both follow-up items the prior diagnostic session (CONTEXT.md,
2026-08-29) left open: the near-collision counterparts below are
independently confirmed non-archived (not merely stated), and the
previously-unnamed clustering outlier is `Incline Smith Press`.

## ⚠ flag legend

- **archived** — one of the 4 rows currently `is_archived = true`. Still
  classified by name match like any other row; archived only changes
  where it's offered in the picker, not its provenance (§4.2).
- **near-collision** — this row's name is close enough to another row's
  name that a reviewer should look twice before approving. Both sides of
  every pair are flagged, cross-referencing each other. All 7 pairs
  independently confirmed this session: every archived row's named
  counterpart genuinely exists and is genuinely non-archived (queried
  directly, not assumed).

**13 rows carry a flag** (7 pairs, one row — `Squat` — in two pairs):
`Back Squat`, `Front Squat`, `Squat`, `Cable Row`, `Seated Cable Row`,
`Incline Dumbbell Bench Press`, `Incline Dumbell Press`, `Leg Curl`,
`Seated Leg Curl`, `Seated Calf Raise`, `Seated Machine Calf Raise`,
`Standing Calf Raise`, `Standing Machine Calf Raise`. All 4 archived rows
are among these 13 — every archived row in this library happens to also
be a near-collision pair, not a coincidence: the pattern throughout is
Adam archiving a generic imported default in favour of the more specific
variant he actually trains (§4.2).

**0 rows show the two signals (name match vs. `created_at`) disagreeing**
— nothing here needs adjudicating between them; every disagreement this
rule could in principle produce simply didn't occur on this account's
real data.

---

## back (14)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `2ec8ed37-ac62-4d3b-9370-80d301cb18c3` | Barbell Row | 2026-07-03 21:23:36.575297+00 | false | legacy | Barbell Row | |
| `f45af525-6475-4cb7-a184-48368dccb032` | Cable Row | 2026-07-03 21:23:32.00622+00 | false | hand-created | — | ⚠ near-collision with Seated Cable Row |
| `84deab53-8ac0-479f-954d-7cfaebdf144e` | Chin-Up | 2026-08-12 01:26:26.632424+00 | false | legacy | Chin-Up | |
| `7aaf9e75-45e0-4caf-945a-952aa76c5798` | Deadlift | 2026-08-12 01:26:26.632424+00 | false | legacy | Deadlift | |
| `2641b620-7e0c-4a4e-9eff-59edd2451a34` | Dumbbell Row | 2026-08-12 01:26:26.632424+00 | false | legacy | Dumbbell Row | |
| `fd527d5a-2eb3-4c22-b3f5-44d818a7b260` | Lat Pulldown | 2026-08-12 01:26:26.632424+00 | false | legacy | Lat Pulldown | |
| `a4381392-7d7d-4493-a817-cbc508c60193` | Lat Pulldown (machine) | 2026-07-03 13:50:11.504977+00 | false | hand-created | — | |
| `9fd76ebe-3b60-4ba7-9548-3933fac562b0` | Neutral Lat Pulldown (cable) | 2026-07-03 21:24:20.030126+00 | false | hand-created | — | |
| `81c2ae9f-4397-43dd-9d27-a8df84ef3b38` | One-arm Cable Lat Row | 2026-07-03 21:23:09.88428+00 | false | hand-created | — | |
| `f6f3ee93-5df7-4912-a680-5cddb1ce64f3` | One-arm Cable Pullover | 2026-07-03 21:24:00.025352+00 | false | hand-created | — | |
| `cb0342ee-697e-431d-8794-58a7b3976c30` | Pendlay Row | 2026-08-12 01:26:26.632424+00 | false | legacy | Pendlay Row | |
| `85b3cb54-de1f-4a8d-a4fa-11877f6599e8` | Pull-Up | 2026-08-12 01:26:26.632424+00 | false | legacy | Pull-Up | |
| `225c7218-edeb-451c-b5d5-554e3c82dfc9` | Seated Cable Row | 2026-08-12 01:26:26.632424+00 | false | legacy | Seated Cable Row | ⚠ near-collision with Cable Row |
| `d34127a3-74de-4f25-bd0c-25352932cd4d` | T-Bar Row | 2026-08-12 01:26:26.632424+00 | false | legacy | T-Bar Row | |

## biceps (6)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `61f20e77-0c42-4042-b926-a7a2f972a001` | Barbell Curl | 2026-08-12 01:26:26.632424+00 | false | legacy | Barbell Curl | |
| `e48c9453-370a-41f3-8fb5-15ae533f0bb7` | Dumbbell Curl | 2026-08-12 01:26:26.632424+00 | false | legacy | Dumbbell Curl | |
| `d60464f1-1414-468b-9cf5-107a81c362dc` | Ezbar Preacher Curl | 2026-07-03 21:25:25.909771+00 | false | hand-created | — | |
| `ee48aad5-ea6e-4b7a-b952-ea7f2a0e7e54` | Hammer Curl | 2026-08-12 01:26:26.632424+00 | false | legacy | Hammer Curl | |
| `36f6e096-e3d7-4b2d-b386-b259b22c2a70` | One-arm Cable Curl | 2026-07-03 13:50:32.479366+00 | false | hand-created | — | |
| `c60b76e1-7ca4-43f2-9c9a-b698bb3bf844` | Preacher Curl | 2026-08-12 01:26:26.632424+00 | false | legacy | Preacher Curl | |

## calves (4)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `5117b026-c2ad-4d3e-8641-348577f5d812` | Seated Calf Raise | 2026-08-12 01:26:26.632424+00 | true | legacy | Seated Calf Raise | ⚠ archived; near-collision with Seated Machine Calf Raise |
| `dd5190c3-a917-4609-ab01-a60f97fe14f8` | Seated Machine Calf Raise | 2026-07-03 13:51:32.995056+00 | false | hand-created | — | ⚠ near-collision with Seated Calf Raise |
| `e4e1767f-153f-4c99-a2c4-ca242387de3e` | Standing Calf Raise | 2026-08-12 01:26:26.632424+00 | true | legacy | Standing Calf Raise | ⚠ archived; near-collision with Standing Machine Calf Raise |
| `7bf2818f-dfbc-442e-8e9b-40bde8caa413` | Standing Machine Calf Raise | 2026-07-03 21:26:23.763784+00 | false | hand-created | — | ⚠ near-collision with Standing Calf Raise |

## chest (12)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `ea8fbc9f-ac7c-45fd-b222-d693f3bafbae` | Barbell Bench Press | 2026-08-12 01:26:26.632424+00 | false | legacy | Barbell Bench Press | |
| `85636257-2f5b-4019-905d-e64c3fcc82ec` | Bench Supported Incline Cable Fly | 2026-07-03 21:22:54.387765+00 | false | hand-created | — | |
| `cdea8622-98ed-4cad-9024-edec28b4cd8e` | Chest Press | 2026-07-03 21:22:44.19974+00 | false | hand-created | — | |
| `7643664e-7eae-4e1f-9158-505e5d275d86` | Dips | 2026-07-03 21:22:57.314881+00 | false | legacy | Dips | |
| `99f51477-c045-4806-9d0b-ba3c242a7e24` | Dumbbell Bench Press | 2026-08-12 01:26:26.632424+00 | false | legacy | Dumbbell Bench Press | |
| `4be802a3-4719-4a89-8820-b738bf72539f` | Dumbbell Fly | 2026-08-12 01:26:26.632424+00 | false | legacy | Dumbbell Fly | |
| `12db1508-253c-4eab-b59a-9dd8b76486fb` | Incline Barbell Bench Press | 2026-08-12 01:26:26.632424+00 | false | legacy | Incline Barbell Bench Press | |
| `9c1499a2-5cdf-46a3-8dcd-fec8b2d66037` | Incline Dumbbell Bench Press | 2026-08-12 01:26:26.632424+00 | true | legacy | Incline Dumbbell Bench Press | ⚠ archived; near-collision with Incline Dumbell Press |
| `aa86fde4-ed48-4dbe-b004-288ebe6b4903` | Incline Dumbell Press | 2026-07-03 13:49:34.645767+00 | false | hand-created | — | ⚠ near-collision with Incline Dumbbell Bench Press |
| `96647f04-0465-4408-bd6e-d1706de31065` | Incline Smith Press | 2026-07-05 17:15:15.294376+00 | false | hand-created | — | the clustering cross-check's outlier — added alone, two days after the two 2026-07-03 windows (see above) |
| `fc2a34e3-bca2-4a4e-a439-a0eb2353cde7` | Pec Deck Fly | 2026-07-03 21:22:38.124278+00 | false | hand-created | — | |
| `854f1cd6-0f2f-4f38-838a-694640e14590` | Push-Up | 2026-08-12 01:26:26.632424+00 | false | legacy | Push-Up | |

## core (4)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `59c1262b-6e46-43c1-8e11-2259edd630cd` | Ab Wheel Rollout | 2026-08-12 01:26:26.632424+00 | false | legacy | Ab Wheel Rollout | |
| `0a2e9640-4f26-4174-add5-f287c6ca0dfc` | Cable Crunch | 2026-08-12 01:26:26.632424+00 | false | legacy | Cable Crunch | |
| `74c94b4b-37f4-465b-83fa-b3a0cb67a612` | Hanging Leg Raise | 2026-08-12 01:26:26.632424+00 | false | legacy | Hanging Leg Raise | |
| `9d921f91-9bb8-491f-b5c0-0d4ae78727c2` | Plank | 2026-08-12 01:26:26.632424+00 | false | legacy | Plank | |

## forearms (1)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `9fd89bfb-5e2a-43f1-ba6d-6cca55ff2d11` | Cable Reverse Biceps Curl | 2026-07-03 13:50:58.588864+00 | false | hand-created | — | |

## glutes (2)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `38ede736-47e9-47bd-9521-aa3de6dfb4a4` | Hip Thrust | 2026-08-12 01:26:26.632424+00 | false | legacy | Hip Thrust | |
| `0b86f140-42ba-427e-8e7f-804a477c96ce` | Hip Thrust (machine) | 2026-07-03 13:51:25.734759+00 | false | hand-created | — | |

## hamstrings (4)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `7d717418-31a9-4f0f-9e00-d8bbb31fe415` | Good Morning | 2026-08-12 01:26:26.632424+00 | false | legacy | Good Morning | |
| `baf11c4b-98dc-4a0c-9fdd-7adba698a243` | Leg Curl | 2026-08-12 01:26:26.632424+00 | true | legacy | Leg Curl | ⚠ archived; near-collision with Seated Leg Curl |
| `6a68f5cf-0b2d-45c9-a176-f008260b83db` | Romanian Deadlift | 2026-08-12 01:26:26.632424+00 | false | legacy | Romanian Deadlift | |
| `acc0178b-791b-4ff8-95e6-5682ebe56793` | Seated Leg Curl | 2026-07-03 13:51:14.026407+00 | false | hand-created | — | ⚠ near-collision with Leg Curl |

## other (1)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `26e648ae-ace8-452c-88d4-bbca2472ba15` | Adduction Machine | 2026-07-03 21:26:14.142868+00 | false | hand-created | — | |

## quads (8)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `543ffeda-26bd-4f43-b5fa-a2d228e60a58` | Back Squat | 2026-08-12 01:26:26.632424+00 | false | legacy | Back Squat | ⚠ near-collision with Squat |
| `e5bf9a8a-75ae-449c-ad26-cf4f6a5872c7` | Bulgarian Split Squat | 2026-08-12 01:26:26.632424+00 | false | legacy | Bulgarian Split Squat | |
| `0e6130a6-5834-423e-be26-702c34e66a80` | Front Squat | 2026-08-12 01:26:26.632424+00 | false | legacy | Front Squat | ⚠ near-collision with Squat |
| `de88aa3b-00ff-4d52-806d-d192f74bdecf` | Hack Squat | 2026-07-03 13:51:05.027929+00 | false | hand-created | — | |
| `845c3d9b-ac30-4619-95af-68dd736dc716` | Leg Extension | 2026-07-03 21:26:00.471022+00 | false | legacy | Leg Extension | |
| `73101f9a-efad-4d1f-811c-3bcd54b3b1ac` | Leg Press | 2026-07-03 21:25:55.912586+00 | false | legacy | Leg Press | |
| `c63546c5-19c2-4ab8-ae33-642267de15f1` | Squat | 2026-07-03 21:25:51.897768+00 | false | hand-created | — | ⚠ near-collision with Back Squat / Front Squat |
| `4f7fa2d7-f470-4dd6-a154-0412ef4739d7` | Walking Lunge | 2026-08-12 01:26:26.632424+00 | false | legacy | Walking Lunge | |

## shoulders (8)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `8dd020f8-6202-4969-9ef9-53e38ca0e206` | Cable Lateral Raise | 2026-07-03 13:50:20.572362+00 | false | hand-created | — | |
| `f3a7d0bf-8982-4de3-a2da-9c6710b96f46` | Face Pull | 2026-08-12 01:26:26.632424+00 | false | legacy | Face Pull | |
| `e78aa456-de7d-4791-a596-e4d0ae2b7294` | Lateral Raise | 2026-08-12 01:26:26.632424+00 | false | legacy | Lateral Raise | |
| `8db7bba5-7186-49f3-a02b-dd5ec39fcc84` | One-arm Dumbell Lateral Raise | 2026-07-03 21:25:14.1977+00 | false | hand-created | — | |
| `25827130-c571-43c0-878b-061d5147b18a` | Overhead Press | 2026-08-12 01:26:26.632424+00 | false | legacy | Overhead Press | |
| `613ce12e-ed61-4dad-acee-85f3891102be` | Rear Delt Fly | 2026-08-12 01:26:26.632424+00 | false | legacy | Rear Delt Fly | |
| `19d3f9d6-6e6d-48e5-8066-9b9415c1d222` | Seated Dumbbell Shoulder Press | 2026-08-12 01:26:26.632424+00 | false | legacy | Seated Dumbbell Shoulder Press | |
| `113576ab-8fcb-4626-9cc0-eb7a9a1af3ac` | Upright Row | 2026-08-12 01:26:26.632424+00 | false | legacy | Upright Row | |

## triceps (6)

| id | name | created_at (UTC) | archived | classification | matched default name | note |
|---|---|---|---|---|---|---|
| `8aa7e7da-1733-4f6e-a168-784780d5dc5c` | Close-Grip Bench Press | 2026-08-12 01:26:26.632424+00 | false | legacy | Close-Grip Bench Press | |
| `916b80af-c926-4a91-945d-23c509475432` | Dip machine (triceps) | 2026-07-03 21:25:40.308209+00 | false | hand-created | — | |
| `4a557509-ecef-45b4-a0fc-945e0c0654e9` | Incline Skullcrusher | 2026-07-03 13:50:40.93694+00 | false | hand-created | — | |
| `0b39072b-ee61-4ae0-9b6c-2132dc94a5cd` | Overhead Tricep Extension | 2026-08-12 01:26:26.632424+00 | false | legacy | Overhead Tricep Extension | |
| `66dbe69a-637b-4d74-9102-075da3593502` | Skull Crusher | 2026-08-12 01:26:26.632424+00 | false | legacy | Skull Crusher | |
| `756e03e6-4b5f-4e73-acd0-e2bf92e7f0b5` | Tricep Pushdown | 2026-08-12 01:26:26.632424+00 | false | legacy | Tricep Pushdown | |

---

## Summary

70 exercises, all classified (0 ambiguous, 0 signal-disagreement cases).
**46 `legacy` / 24 `hand-created`**, unchanged from every prior computation
of this split (migration 014's comments, last session's static check, this
session's live production query) — nothing about closing out the two
follow-up diagnostics or writing this document changed the headline
number, only added corroborating detail underneath it.

**13 rows worth the closest look** (the 7 near-collision pairs, listed in
full under "⚠ flag legend" above) — these are where a reviewer might
reasonably want to merge a `legacy` row into its `hand-created`
near-collision counterpart via reassignment (§5) rather than simply
leaving both to coexist after migration 020. That is a separate decision
from this document's job, which is only "which library does each row's
provenance belong to" — reassignment, if wanted, is a later, explicit,
independently-confirmed action (§5.6: not reversible), not something this
review or migration 020 does implicitly.

## What migration 020 will do, once this is approved

Per §4.4 step 5: one `insert` creating the `legacy-default` library row,
then one keyed `update … from (values …)` over the 46 approved `legacy`
ids, **keyed on `id` with the name in a trailing comment per row** —
byte-for-byte the shape migration 014 used, chosen there for the same
reason (exact, and immune to this library's real typos like "Dumbell").
Verification per §4.5: the post-migration `legacy` count must be exactly
46 against `v2_exercise_libraries.slug = 'legacy-default'`, and every
`hand-created` row must still show `source_library_id is null`.

**Nothing is written until Adam reviews and corrects this file.** If any
row's classification should change, edit the `classification` /
`matched default name` columns above directly — migration 020 will be
written from whatever this file says once it's approved, not from the
rule restated in prose.
