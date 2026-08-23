# Coach — Exercise Tag Proposals (one-time batch pass)

*Proposed by Claude Code, 2026-08-20, per COACH-WEEK-ANALYSIS-TASKS.md §4.2
steps 1–2. Read directly from production `exercises` (70 rows, account
`12e79b69-9891-4f53-a7cf-650edd83659f`), not from `defaultExercises.ts` —
per §4.2's own reasoning, names must come from the database because this
library has real typos ("Dumbell") that a code-sourced proposal would miss.
Archived rows are included and tagged too (archived means "not offered in
the picker," not "never trained" — §4.2 step 1).*

**Status: awaiting review (§4.2 step 3). Nothing has been written to
`muscle_subgroup`/`movement_pattern` yet — migration 014 does not exist
until this file is corrected and approved.**

**Vocabulary used** (TASKS §4.3 — itself part of what's under review, see
§9 open question 1):

```
chest      upper_chest, mid_chest, lower_chest
back       lats, mid_back, lower_back, traps
shoulders  front_delt, side_delt, rear_delt
arms       biceps, brachialis, triceps_long_head, triceps_lateral_head, forearms
legs       quads, hamstrings, glutes, adductors, calves
core       abs, obliques
```

`movement_pattern`: `horizontal_push` `vertical_push` `horizontal_pull`
`vertical_pull` `hip_hinge` `squat` `isolation` (SPEC §4's exact seven,
closed vocabulary, DB-enforced).

**Reasoning conventions applied throughout** (stated once here rather than
repeated 70 times):
- A **fly/pullover/raise** (single-joint, no elbow-flexion-plus-shoulder
  compound action) is `isolation`, even where the prime mover is a large
  muscle — pecs on a fly, lats on a pullover. A **press/row** (multi-joint)
  gets the directional pattern.
- Where a compound press/pull is filed under an accessory muscle group in
  this library (e.g. Close-Grip Bench Press under `triceps`, not `chest`),
  the *movement* is still tagged by what it structurally is — a press
  stays `horizontal_push`/`vertical_push` regardless of which muscle group
  the exercise happens to be filed under.
- Squat-pattern machines (Leg Press, Hack Squat) are tagged `squat` — same
  knee/hip joint action as a free-weight squat, machine or not.
- Per TASKS §4.3's own note: **`isolation` wins for accessories** even
  where the raw joint action could be read as a weak pull (Face Pull,
  Upright Row) — flagged individually below, since this is exactly the
  reading §9 open question 3 asks to confirm before this ships.

Rows with a genuinely debatable call are marked ⚠ in the note column —
these are the ones most worth a close look in step 3, not the rest of the
table.

---

## back (14)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `2ec8ed37-ac62-4d3b-9370-80d301cb18c3` | Barbell Row | back | `lats`, `mid_back` | `horizontal_pull` | |
| `f45af525-6475-4cb7-a184-48368dccb032` | Cable Row | back | `lats`, `mid_back` | `horizontal_pull` | |
| `84deab53-8ac0-479f-954d-7cfaebdf144e` | Chin-Up | back | `lats` | `vertical_pull` | |
| `7aaf9e75-45e0-4caf-945a-952aa76c5798` | Deadlift | back | `lower_back`, `traps` | `hip_hinge` | ⚠ deadlift is genuinely a full posterior-chain movement (hamstrings/glutes too) but the exercise is filed under `back` here, so subgroup stays back-only per that filing |
| `2641b620-7e0c-4a4e-9eff-59edd2451a34` | Dumbbell Row | back | `lats`, `mid_back` | `horizontal_pull` | |
| `fd527d5a-2eb3-4c22-b3f5-44d818a7b260` | Lat Pulldown | back | `lats` | `vertical_pull` | |
| `a4381392-7d7d-4493-a817-cbc508c60193` | Lat Pulldown (machine) | back | `lats` | `vertical_pull` | |
| `9fd76ebe-3b60-4ba7-9548-3933fac562b0` | Neutral Lat Pulldown (cable) | back | `lats` | `vertical_pull` | |
| `81c2ae9f-4397-43dd-9d27-a8df84ef3b38` | One-arm Cable Lat Row | back | `lats`, `mid_back` | `horizontal_pull` | ⚠ name mixes "lat" and "row" — read as a horizontal row done at an angle that emphasises lats |
| `f6f3ee93-5df7-4912-a680-5cddb1ce64f3` | One-arm Cable Pullover | back | `lats` | `isolation` | ⚠ pullover is shoulder-extension only, no elbow flexion — treated as isolation per convention, not `vertical_pull`, even though it's a lat-dominant back exercise |
| `cb0342ee-697e-431d-8794-58a7b3976c30` | Pendlay Row | back | `lats`, `mid_back` | `horizontal_pull` | |
| `85b3cb54-de1f-4a8d-a4fa-11877f6599e8` | Pull-Up | back | `lats` | `vertical_pull` | |
| `225c7218-edeb-451c-b5d5-554e3c82dfc9` | Seated Cable Row | back | `lats`, `mid_back` | `horizontal_pull` | |
| `d34127a3-74de-4f25-bd0c-25352932cd4d` | T-Bar Row | back | `lats`, `mid_back` | `horizontal_pull` | |

## biceps (6)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `61f20e77-0c42-4042-b926-a7a2f972a001` | Barbell Curl | biceps | `biceps` | `isolation` | |
| `e48c9453-370a-41f3-8fb5-15ae533f0bb7` | Dumbbell Curl | biceps | `biceps` | `isolation` | |
| `d60464f1-1414-468b-9cf5-107a81c362dc` | Ezbar Preacher Curl | biceps | `biceps` | `isolation` | |
| `ee48aad5-ea6e-4b7a-b952-ea7f2a0e7e54` | Hammer Curl | biceps | `biceps`, `brachialis` | `isolation` | neutral grip shifts real emphasis onto brachialis/brachioradialis, not just biceps |
| `36f6e096-e3d7-4b2d-b386-b259b22c2a70` | One-arm Cable Curl | biceps | `biceps` | `isolation` | |
| `c60b76e1-7ca4-43f2-9c9a-b698bb3bf844` | Preacher Curl | biceps | `biceps` | `isolation` | |

## calves (4)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `5117b026-c2ad-4d3e-8641-348577f5d812` | Seated Calf Raise | calves | `calves` | `isolation` | archived |
| `dd5190c3-a917-4609-ab01-a60f97fe14f8` | Seated Machine Calf Raise | calves | `calves` | `isolation` | |
| `e4e1767f-153f-4c99-a2c4-ca242387de3e` | Standing Calf Raise | calves | `calves` | `isolation` | archived |
| `7bf2818f-dfbc-442e-8e9b-40bde8caa413` | Standing Machine Calf Raise | calves | `calves` | `isolation` | |

## chest (12)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `ea8fbc9f-ac7c-45fd-b222-d693f3bafbae` | Barbell Bench Press | chest | `mid_chest` | `horizontal_push` | |
| `85636257-2f5b-4019-905d-e64c3fcc82ec` | Bench Supported Incline Cable Fly | chest | `upper_chest` | `isolation` | fly, not press — isolation despite the incline angle matching the SPEC's press example |
| `cdea8622-98ed-4cad-9024-edec28b4cd8e` | Chest Press | chest | `mid_chest` | `horizontal_push` | |
| `7643664e-7eae-4e1f-9158-505e5d275d86` | Dips | chest | `lower_chest` | `horizontal_push` | ⚠ dips read as vertical bodyweight movement by bar path, but forward-lean chest dips are conventionally grouped `horizontal_push` in most programming taxonomies — see the triceps-filed "Dip machine" below for the contrasting call |
| `99f51477-c045-4806-9d0b-ba3c242a7e24` | Dumbbell Bench Press | chest | `mid_chest` | `horizontal_push` | |
| `4be802a3-4719-4a89-8820-b738bf72539f` | Dumbbell Fly | chest | `mid_chest` | `isolation` | |
| `12db1508-253c-4eab-b59a-9dd8b76486fb` | Incline Barbell Bench Press | chest | `upper_chest`, `front_delt` | `horizontal_push` | SPEC §4's own worked example |
| `9c1499a2-5cdf-46a3-8dcd-fec8b2d66037` | Incline Dumbbell Bench Press | chest | `upper_chest`, `front_delt` | `horizontal_push` | archived |
| `aa86fde4-ed48-4dbe-b004-288ebe6b4903` | Incline Dumbell Press | chest | `upper_chest`, `front_delt` | `horizontal_push` | real "Dumbell" typo in this library's own data, per TASKS §4.1/§4.2 |
| `96647f04-0465-4408-bd6e-d1706de31065` | Incline Smith Press | chest | `upper_chest`, `front_delt` | `horizontal_push` | |
| `fc2a34e3-bca2-4a4e-a439-a0eb2353cde7` | Pec Deck Fly | chest | `mid_chest` | `isolation` | |
| `854f1cd6-0f2f-4f38-838a-694640e14590` | Push-Up | chest | `mid_chest` | `horizontal_push` | |

## core (4)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `59c1262b-6e46-43c1-8e11-2259edd630cd` | Ab Wheel Rollout | core | `abs` | `isolation` | |
| `0a2e9640-4f26-4174-add5-f287c6ca0dfc` | Cable Crunch | core | `abs` | `isolation` | |
| `74c94b4b-37f4-465b-83fa-b3a0cb67a612` | Hanging Leg Raise | core | `abs` | `isolation` | |
| `9d921f91-9bb8-491f-b5c0-0d4ae78727c2` | Plank | core | `abs` | `isolation` | isometric — no clean movement-pattern fit besides isolation |

## forearms (1)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `9fd89bfb-5e2a-43f1-ba6d-6cca55ff2d11` | Cable Reverse Biceps Curl | forearms | `forearms` | `isolation` | the exercise CONTEXT.md's Coach step E session diagnosed a phrasing gap on — reverse grip shifts emphasis to brachioradialis/wrist extensors, consistent with its `forearms` filing despite "Biceps" in the name |

## glutes (2)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `38ede736-47e9-47bd-9521-aa3de6dfb4a4` | Hip Thrust | glutes | `glutes` | `hip_hinge` | ⚠ hip thrust is hip-extension dominant, not a hinge in the RDL/good-morning sense — `hip_hinge` is the closest of the seven fixed values, not a clean fit |
| `0b86f140-42ba-427e-8e7f-804a477c96ce` | Hip Thrust (machine) | glutes | `glutes` | `hip_hinge` | same ⚠ as above |

## hamstrings (4)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `7d717418-31a9-4f0f-9e00-d8bbb31fe415` | Good Morning | hamstrings | `hamstrings`, `lower_back` | `hip_hinge` | |
| `baf11c4b-98dc-4a0c-9fdd-7adba698a243` | Leg Curl | hamstrings | `hamstrings` | `isolation` | archived |
| `6a68f5cf-0b2d-45c9-a176-f008260b83db` | Romanian Deadlift | hamstrings | `hamstrings`, `glutes` | `hip_hinge` | |
| `acc0178b-791b-4ff8-95e6-5682ebe56793` | Seated Leg Curl | hamstrings | `hamstrings` | `isolation` | |

## other (1)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `26e648ae-ace8-452c-88d4-bbca2472ba15` | Adduction Machine | other | `adductors` | `isolation` | `muscle_group` itself is `other`, but the finer tag has a real home in the vocabulary |

## quads (8)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `543ffeda-26bd-4f43-b5fa-a2d228e60a58` | Back Squat | quads | `quads`, `glutes` | `squat` | |
| `e5bf9a8a-75ae-449c-ad26-cf4f6a5872c7` | Bulgarian Split Squat | quads | `quads`, `glutes` | `squat` | unilateral, same joint action family |
| `0e6130a6-5834-423e-be26-702c34e66a80` | Front Squat | quads | `quads` | `squat` | more quad-dominant than back squat (upright torso) — glutes not added |
| `de88aa3b-00ff-4d52-806d-d192f74bdecf` | Hack Squat | quads | `quads` | `squat` | |
| `845c3d9b-ac30-4619-95af-68dd736dc716` | Leg Extension | quads | `quads` | `isolation` | |
| `73101f9a-efad-4d1f-811c-3bcd54b3b1ac` | Leg Press | quads | `quads` | `squat` | ⚠ machine, fixed path, but same knee/hip extension action as a squat |
| `c63546c5-19c2-4ab8-ae33-642267de15f1` | Squat | quads | `quads`, `glutes` | `squat` | |
| `4f7fa2d7-f470-4dd6-a154-0412ef4739d7` | Walking Lunge | quads | `quads`, `glutes` | `squat` | |

## shoulders (8)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `8dd020f8-6202-4969-9ef9-53e38ca0e206` | Cable Lateral Raise | shoulders | `side_delt` | `isolation` | |
| `f3a7d0bf-8982-4de3-a2da-9c6710b96f46` | Face Pull | shoulders | `rear_delt` | `isolation` | ⚠ structurally a weak horizontal pull, but per TASKS §4.3's "isolation wins for accessories" convention — this is exactly what §9 open question 3 asks to confirm |
| `e78aa456-de7d-4791-a596-e4d0ae2b7294` | Lateral Raise | shoulders | `side_delt` | `isolation` | |
| `8db7bba5-7186-49f3-a02b-dd5ec39fcc84` | One-arm Dumbell Lateral Raise | shoulders | `side_delt` | `isolation` | SPEC §5's own worked example ("a lateral raise is unambiguously side-delt work"); also has the real "Dumbell" typo |
| `25827130-c571-43c0-878b-061d5147b18a` | Overhead Press | shoulders | `front_delt`, `side_delt` | `vertical_push` | |
| `613ce12e-ed61-4dad-acee-85f3891102be` | Rear Delt Fly | shoulders | `rear_delt` | `isolation` | |
| `19d3f9d6-6e6d-48e5-8066-9b9415c1d222` | Seated Dumbbell Shoulder Press | shoulders | `front_delt`, `side_delt` | `vertical_push` | |
| `113576ab-8fcb-4626-9cc0-eb7a9a1af3ac` | Upright Row | shoulders | `side_delt`, `traps` | `isolation` | ⚠ same call as Face Pull — a compound-looking pull filed as isolation per the accessory convention |

## triceps (6)

| id | name | muscle_group | muscle_subgroup (proposed) | movement_pattern (proposed) | note |
|---|---|---|---|---|---|
| `8aa7e7da-1733-4f6e-a168-784780d5dc5c` | Close-Grip Bench Press | triceps | `triceps_lateral_head` | `horizontal_push` | filed under `triceps` but structurally a bench press — pattern follows the movement, not the filing |
| `916b80af-c926-4a91-945d-23c509475432` | Dip machine (triceps) | triceps | `triceps_lateral_head` | `vertical_push` | ⚠ the "(triceps)" suffix (vs. the chest-filed "Dips" above) reads as a more upright machine variant emphasising triceps over chest — tagged `vertical_push` in contrast to chest Dips' `horizontal_push`; worth confirming since both are plausibly the same joint action |
| `4a557509-ecef-45b4-a0fc-945e0c0654e9` | Incline Skullcrusher | triceps | `triceps_long_head` | `isolation` | overhead/stretched arm position emphasises the long head |
| `0b39072b-ee61-4ae0-9b6c-2132dc94a5cd` | Overhead Tricep Extension | triceps | `triceps_long_head` | `isolation` | overhead position, same long-head reasoning |
| `66dbe69a-637b-4d74-9102-075da3593502` | Skull Crusher | triceps | `triceps_long_head` | `isolation` | flat-bench skullcrusher still stretches the long head at the bottom |
| `756e03e6-4b5f-4e73-acd0-e2bf92e7f0b5` | Tricep Pushdown | triceps | `triceps_lateral_head` | `isolation` | elbow-at-side position minimises long-head stretch, emphasises lateral head |

---

## Summary

70 exercises, all tagged (0 deliberately left untagged — every exercise in
this library had enough in its name to support at least one confident
`muscle_subgroup` and `movement_pattern` call). If step 3's review leaves
any row intentionally `NULL`, note it here so §4.2 step 2's post-migration
verification (`select count(*) where muscle_subgroup is null` matching a
*decided* number) has something real to check against.

**⚠ rows worth the closest look** (9 of 70): One-arm Cable Lat Row,
One-arm Cable Pullover, Dips vs. Dip machine (triceps) pattern split, Hip
Thrust ×2 (`hip_hinge` fit), Leg Press (`squat` on a machine), Face Pull,
Upright Row. All are movement-pattern judgment calls, not
muscle-subgroup ones — the subgroup tags are lower-risk throughout.

**Ties to §9's open questions, concretely, not abstractly:**
- Open question 1 (subgroup vocabulary) — every subgroup value used above
  is drawn from §4.3's proposed 22; none needed an ad-hoc addition.
- Open question 3 (`isolation` reading) — Face Pull and Upright Row are the
  two rows that reading actually decides, and are marked ⚠ for that reason.
