-- Overload v3 — Coach: Weekly Analysis, reviewed exercise tags
-- (COACH-WEEK-ANALYSIS-TASKS.md §4.2 step 4. Generated from
-- COACH-EXERCISE-TAGS.md as reviewed and approved by Adam on 2026-08-20 —
-- approved as-is, including every flagged ⚠ row (Deadlift's back-only
-- subgroup filing, the Dips/Dip machine movement-pattern split, both Hip
-- Thrust rows' hip_hinge tag, Face Pull/Upright Row's isolation reading).
-- No corrections to the reviewed file. 013 is the last applied migration.)
--
-- Keyed on id, not name — exact, and immune to the real typos in this
-- library ("One-arm Dumbell Lateral Raise", "Incline Dumbell Press"). Name
-- in a trailing comment per row so this file stays reviewable as well as
-- exact — it's the same 70 rows in the same order as COACH-EXERCISE-TAGS.md.
--
-- Tag corrections apply prospectively only: a v2_coach_week_analyses row
-- generated before a future tag change permanently reflects the tag as it
-- stood at generation time (input_snapshot is frozen, same asymmetry as
-- prompt_version on the daily table — TASKS §3.1/§5.11's reasoning applies
-- here too, just to tag data instead of prompt wording).

update exercises e
set muscle_subgroup  = v.subgroups,
    movement_pattern = v.pattern
from (values
  ('2ec8ed37-ac62-4d3b-9370-80d301cb18c3'::uuid, '{lats,mid_back}'::text[], 'horizontal_pull'),         -- Barbell Row
  ('f45af525-6475-4cb7-a184-48368dccb032'::uuid, '{lats,mid_back}'::text[], 'horizontal_pull'),         -- Cable Row
  ('84deab53-8ac0-479f-954d-7cfaebdf144e'::uuid, '{lats}'::text[],          'vertical_pull'),           -- Chin-Up
  ('7aaf9e75-45e0-4caf-945a-952aa76c5798'::uuid, '{lower_back,traps}'::text[], 'hip_hinge'),             -- Deadlift
  ('2641b620-7e0c-4a4e-9eff-59edd2451a34'::uuid, '{lats,mid_back}'::text[], 'horizontal_pull'),         -- Dumbbell Row
  ('fd527d5a-2eb3-4c22-b3f5-44d818a7b260'::uuid, '{lats}'::text[],          'vertical_pull'),           -- Lat Pulldown
  ('a4381392-7d7d-4493-a817-cbc508c60193'::uuid, '{lats}'::text[],          'vertical_pull'),           -- Lat Pulldown (machine)
  ('9fd76ebe-3b60-4ba7-9548-3933fac562b0'::uuid, '{lats}'::text[],          'vertical_pull'),           -- Neutral Lat Pulldown (cable)
  ('81c2ae9f-4397-43dd-9d27-a8df84ef3b38'::uuid, '{lats,mid_back}'::text[], 'horizontal_pull'),         -- One-arm Cable Lat Row
  ('f6f3ee93-5df7-4912-a680-5cddb1ce64f3'::uuid, '{lats}'::text[],          'isolation'),               -- One-arm Cable Pullover
  ('cb0342ee-697e-431d-8794-58a7b3976c30'::uuid, '{lats,mid_back}'::text[], 'horizontal_pull'),         -- Pendlay Row
  ('85b3cb54-de1f-4a8d-a4fa-11877f6599e8'::uuid, '{lats}'::text[],          'vertical_pull'),           -- Pull-Up
  ('225c7218-edeb-451c-b5d5-554e3c82dfc9'::uuid, '{lats,mid_back}'::text[], 'horizontal_pull'),         -- Seated Cable Row
  ('d34127a3-74de-4f25-bd0c-25352932cd4d'::uuid, '{lats,mid_back}'::text[], 'horizontal_pull'),         -- T-Bar Row

  ('61f20e77-0c42-4042-b926-a7a2f972a001'::uuid, '{biceps}'::text[],             'isolation'),          -- Barbell Curl
  ('e48c9453-370a-41f3-8fb5-15ae533f0bb7'::uuid, '{biceps}'::text[],             'isolation'),          -- Dumbbell Curl
  ('d60464f1-1414-468b-9cf5-107a81c362dc'::uuid, '{biceps}'::text[],             'isolation'),          -- Ezbar Preacher Curl
  ('ee48aad5-ea6e-4b7a-b952-ea7f2a0e7e54'::uuid, '{biceps,brachialis}'::text[],  'isolation'),          -- Hammer Curl
  ('36f6e096-e3d7-4b2d-b386-b259b22c2a70'::uuid, '{biceps}'::text[],             'isolation'),          -- One-arm Cable Curl
  ('c60b76e1-7ca4-43f2-9c9a-b698bb3bf844'::uuid, '{biceps}'::text[],             'isolation'),          -- Preacher Curl

  ('5117b026-c2ad-4d3e-8641-348577f5d812'::uuid, '{calves}'::text[], 'isolation'),                      -- Seated Calf Raise
  ('dd5190c3-a917-4609-ab01-a60f97fe14f8'::uuid, '{calves}'::text[], 'isolation'),                      -- Seated Machine Calf Raise
  ('e4e1767f-153f-4c99-a2c4-ca242387de3e'::uuid, '{calves}'::text[], 'isolation'),                      -- Standing Calf Raise
  ('7bf2818f-dfbc-442e-8e9b-40bde8caa413'::uuid, '{calves}'::text[], 'isolation'),                      -- Standing Machine Calf Raise

  ('ea8fbc9f-ac7c-45fd-b222-d693f3bafbae'::uuid, '{mid_chest}'::text[],              'horizontal_push'),  -- Barbell Bench Press
  ('85636257-2f5b-4019-905d-e64c3fcc82ec'::uuid, '{upper_chest}'::text[],            'isolation'),        -- Bench Supported Incline Cable Fly
  ('cdea8622-98ed-4cad-9024-edec28b4cd8e'::uuid, '{mid_chest}'::text[],              'horizontal_push'),  -- Chest Press
  ('7643664e-7eae-4e1f-9158-505e5d275d86'::uuid, '{lower_chest}'::text[],            'horizontal_push'),  -- Dips
  ('99f51477-c045-4806-9d0b-ba3c242a7e24'::uuid, '{mid_chest}'::text[],              'horizontal_push'),  -- Dumbbell Bench Press
  ('4be802a3-4719-4a89-8820-b738bf72539f'::uuid, '{mid_chest}'::text[],              'isolation'),        -- Dumbbell Fly
  ('12db1508-253c-4eab-b59a-9dd8b76486fb'::uuid, '{upper_chest,front_delt}'::text[], 'horizontal_push'),  -- Incline Barbell Bench Press
  ('9c1499a2-5cdf-46a3-8dcd-fec8b2d66037'::uuid, '{upper_chest,front_delt}'::text[], 'horizontal_push'),  -- Incline Dumbbell Bench Press (archived)
  ('aa86fde4-ed48-4dbe-b004-288ebe6b4903'::uuid, '{upper_chest,front_delt}'::text[], 'horizontal_push'),  -- Incline Dumbell Press
  ('96647f04-0465-4408-bd6e-d1706de31065'::uuid, '{upper_chest,front_delt}'::text[], 'horizontal_push'),  -- Incline Smith Press
  ('fc2a34e3-bca2-4a4e-a439-a0eb2353cde7'::uuid, '{mid_chest}'::text[],              'isolation'),        -- Pec Deck Fly
  ('854f1cd6-0f2f-4f38-838a-694640e14590'::uuid, '{mid_chest}'::text[],              'horizontal_push'),  -- Push-Up

  ('59c1262b-6e46-43c1-8e11-2259edd630cd'::uuid, '{abs}'::text[], 'isolation'),                         -- Ab Wheel Rollout
  ('0a2e9640-4f26-4174-add5-f287c6ca0dfc'::uuid, '{abs}'::text[], 'isolation'),                         -- Cable Crunch
  ('74c94b4b-37f4-465b-83fa-b3a0cb67a612'::uuid, '{abs}'::text[], 'isolation'),                         -- Hanging Leg Raise
  ('9d921f91-9bb8-491f-b5c0-0d4ae78727c2'::uuid, '{abs}'::text[], 'isolation'),                         -- Plank

  ('9fd89bfb-5e2a-43f1-ba6d-6cca55ff2d11'::uuid, '{forearms}'::text[], 'isolation'),                    -- Cable Reverse Biceps Curl

  ('38ede736-47e9-47bd-9521-aa3de6dfb4a4'::uuid, '{glutes}'::text[], 'hip_hinge'),                       -- Hip Thrust
  ('0b86f140-42ba-427e-8e7f-804a477c96ce'::uuid, '{glutes}'::text[], 'hip_hinge'),                       -- Hip Thrust (machine)

  ('7d717418-31a9-4f0f-9e00-d8bbb31fe415'::uuid, '{hamstrings,lower_back}'::text[], 'hip_hinge'),        -- Good Morning
  ('baf11c4b-98dc-4a0c-9fdd-7adba698a243'::uuid, '{hamstrings}'::text[],            'isolation'),        -- Leg Curl (archived)
  ('6a68f5cf-0b2d-45c9-a176-f008260b83db'::uuid, '{hamstrings,glutes}'::text[],     'hip_hinge'),        -- Romanian Deadlift
  ('acc0178b-791b-4ff8-95e6-5682ebe56793'::uuid, '{hamstrings}'::text[],            'isolation'),        -- Seated Leg Curl

  ('26e648ae-ace8-452c-88d4-bbca2472ba15'::uuid, '{adductors}'::text[], 'isolation'),                   -- Adduction Machine

  ('543ffeda-26bd-4f43-b5fa-a2d228e60a58'::uuid, '{quads,glutes}'::text[], 'squat'),                    -- Back Squat
  ('e5bf9a8a-75ae-449c-ad26-cf4f6a5872c7'::uuid, '{quads,glutes}'::text[], 'squat'),                    -- Bulgarian Split Squat
  ('0e6130a6-5834-423e-be26-702c34e66a80'::uuid, '{quads}'::text[],       'squat'),                     -- Front Squat
  ('de88aa3b-00ff-4d52-806d-d192f74bdecf'::uuid, '{quads}'::text[],       'squat'),                     -- Hack Squat
  ('845c3d9b-ac30-4619-95af-68dd736dc716'::uuid, '{quads}'::text[],       'isolation'),                 -- Leg Extension
  ('73101f9a-efad-4d1f-811c-3bcd54b3b1ac'::uuid, '{quads}'::text[],       'squat'),                     -- Leg Press
  ('c63546c5-19c2-4ab8-ae33-642267de15f1'::uuid, '{quads,glutes}'::text[], 'squat'),                    -- Squat
  ('4f7fa2d7-f470-4dd6-a154-0412ef4739d7'::uuid, '{quads,glutes}'::text[], 'squat'),                    -- Walking Lunge

  ('8dd020f8-6202-4969-9ef9-53e38ca0e206'::uuid, '{side_delt}'::text[],         'isolation'),           -- Cable Lateral Raise
  ('f3a7d0bf-8982-4de3-a2da-9c6710b96f46'::uuid, '{rear_delt}'::text[],         'isolation'),           -- Face Pull
  ('e78aa456-de7d-4791-a596-e4d0ae2b7294'::uuid, '{side_delt}'::text[],         'isolation'),           -- Lateral Raise
  ('8db7bba5-7186-49f3-a02b-dd5ec39fcc84'::uuid, '{side_delt}'::text[],         'isolation'),           -- One-arm Dumbell Lateral Raise
  ('25827130-c571-43c0-878b-061d5147b18a'::uuid, '{front_delt,side_delt}'::text[], 'vertical_push'),    -- Overhead Press
  ('613ce12e-ed61-4dad-acee-85f3891102be'::uuid, '{rear_delt}'::text[],         'isolation'),           -- Rear Delt Fly
  ('19d3f9d6-6e6d-48e5-8066-9b9415c1d222'::uuid, '{front_delt,side_delt}'::text[], 'vertical_push'),    -- Seated Dumbbell Shoulder Press
  ('113576ab-8fcb-4626-9cc0-eb7a9a1af3ac'::uuid, '{side_delt,traps}'::text[],   'isolation'),           -- Upright Row

  ('8aa7e7da-1733-4f6e-a168-784780d5dc5c'::uuid, '{triceps_lateral_head}'::text[], 'horizontal_push'),  -- Close-Grip Bench Press
  ('916b80af-c926-4a91-945d-23c509475432'::uuid, '{triceps_lateral_head}'::text[], 'vertical_push'),    -- Dip machine (triceps)
  ('4a557509-ecef-45b4-a0fc-945e0c0654e9'::uuid, '{triceps_long_head}'::text[],    'isolation'),        -- Incline Skullcrusher
  ('0b39072b-ee61-4ae0-9b6c-2132dc94a5cd'::uuid, '{triceps_long_head}'::text[],    'isolation'),        -- Overhead Tricep Extension
  ('66dbe69a-637b-4d74-9102-075da3593502'::uuid, '{triceps_long_head}'::text[],    'isolation'),        -- Skull Crusher
  ('756e03e6-4b5f-4e73-acd0-e2bf92e7f0b5'::uuid, '{triceps_lateral_head}'::text[], 'isolation')          -- Tricep Pushdown
) as v(id, subgroups, pattern)
where e.id = v.id;
