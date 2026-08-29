-- Overload v3 — Exercise Library Rework, retroactive legacy provenance
-- (EXERCISE-LIBRARY-TASKS.md §4.4/§4.5. Generated from
-- EXERCISE-LIBRARY-PROVENANCE.md as reviewed and approved by Adam on
-- 2026-08-29 — approved as-is, no corrections: the 46/24 split, all four
-- archived-row near-collisions, and the 28-individual/42-bulk insertion
-- history were each independently verified row-by-row against that
-- file's own tables. 019 is the last applied migration.)
--
-- Two statements. First, the synthetic library every legacy row will
-- point at — unlisted (SPEC §5, TASKS §2.1): it exists only as an FK
-- target for provenance, has no catalog content, and must never be
-- offered for preview or download. Second, a keyed update over the 46
-- approved legacy ids, keyed on id rather than name for the same reason
-- migration 014 was — exact, and immune to this library's real typos
-- ("Incline Dumbell Press", "One-arm Dumbell Lateral Raise"). Name in a
-- trailing comment per row so this file stays reviewable as well as
-- exact — same 46 rows, same order, as EXERCISE-LIBRARY-PROVENANCE.md's
-- own muscle_group grouping.
--
-- Provenance only: this does not archive, delete, or move anything to
-- Lost. Every hand-created row's source_library_id stays untouched
-- (NULL) — the update's VALUES list contains only the 46 legacy ids.

insert into v2_exercise_libraries (slug, name, description, is_listed)
values (
  'legacy-default',
  'Original Default List',
  'The original built-in exercise list, present on this account before ' ||
  'the Exercise Library rework introduced per-exercise provenance. Not ' ||
  'a real curated library and not offered for preview or download — see ' ||
  'EXERCISE-LIBRARY-PROVENANCE.md for how membership was determined.',
  false
);

update exercises e
set source_library_id = (
  select id from v2_exercise_libraries where slug = 'legacy-default'
)
from (values
  ('2ec8ed37-ac62-4d3b-9370-80d301cb18c3'::uuid), -- Barbell Row
  ('84deab53-8ac0-479f-954d-7cfaebdf144e'::uuid), -- Chin-Up
  ('7aaf9e75-45e0-4caf-945a-952aa76c5798'::uuid), -- Deadlift
  ('2641b620-7e0c-4a4e-9eff-59edd2451a34'::uuid), -- Dumbbell Row
  ('fd527d5a-2eb3-4c22-b3f5-44d818a7b260'::uuid), -- Lat Pulldown
  ('cb0342ee-697e-431d-8794-58a7b3976c30'::uuid), -- Pendlay Row
  ('85b3cb54-de1f-4a8d-a4fa-11877f6599e8'::uuid), -- Pull-Up
  ('225c7218-edeb-451c-b5d5-554e3c82dfc9'::uuid), -- Seated Cable Row
  ('d34127a3-74de-4f25-bd0c-25352932cd4d'::uuid), -- T-Bar Row

  ('61f20e77-0c42-4042-b926-a7a2f972a001'::uuid), -- Barbell Curl
  ('e48c9453-370a-41f3-8fb5-15ae533f0bb7'::uuid), -- Dumbbell Curl
  ('ee48aad5-ea6e-4b7a-b952-ea7f2a0e7e54'::uuid), -- Hammer Curl
  ('c60b76e1-7ca4-43f2-9c9a-b698bb3bf844'::uuid), -- Preacher Curl

  ('5117b026-c2ad-4d3e-8641-348577f5d812'::uuid), -- Seated Calf Raise
  ('e4e1767f-153f-4c99-a2c4-ca242387de3e'::uuid), -- Standing Calf Raise

  ('ea8fbc9f-ac7c-45fd-b222-d693f3bafbae'::uuid), -- Barbell Bench Press
  ('7643664e-7eae-4e1f-9158-505e5d275d86'::uuid), -- Dips
  ('99f51477-c045-4806-9d0b-ba3c242a7e24'::uuid), -- Dumbbell Bench Press
  ('4be802a3-4719-4a89-8820-b738bf72539f'::uuid), -- Dumbbell Fly
  ('12db1508-253c-4eab-b59a-9dd8b76486fb'::uuid), -- Incline Barbell Bench Press
  ('9c1499a2-5cdf-46a3-8dcd-fec8b2d66037'::uuid), -- Incline Dumbbell Bench Press (archived)
  ('854f1cd6-0f2f-4f38-838a-694640e14590'::uuid), -- Push-Up

  ('59c1262b-6e46-43c1-8e11-2259edd630cd'::uuid), -- Ab Wheel Rollout
  ('0a2e9640-4f26-4174-add5-f287c6ca0dfc'::uuid), -- Cable Crunch
  ('74c94b4b-37f4-465b-83fa-b3a0cb67a612'::uuid), -- Hanging Leg Raise
  ('9d921f91-9bb8-491f-b5c0-0d4ae78727c2'::uuid), -- Plank

  ('38ede736-47e9-47bd-9521-aa3de6dfb4a4'::uuid), -- Hip Thrust

  ('7d717418-31a9-4f0f-9e00-d8bbb31fe415'::uuid), -- Good Morning
  ('baf11c4b-98dc-4a0c-9fdd-7adba698a243'::uuid), -- Leg Curl (archived)
  ('6a68f5cf-0b2d-45c9-a176-f008260b83db'::uuid), -- Romanian Deadlift

  ('543ffeda-26bd-4f43-b5fa-a2d228e60a58'::uuid), -- Back Squat
  ('e5bf9a8a-75ae-449c-ad26-cf4f6a5872c7'::uuid), -- Bulgarian Split Squat
  ('0e6130a6-5834-423e-be26-702c34e66a80'::uuid), -- Front Squat
  ('845c3d9b-ac30-4619-95af-68dd736dc716'::uuid), -- Leg Extension
  ('73101f9a-efad-4d1f-811c-3bcd54b3b1ac'::uuid), -- Leg Press
  ('4f7fa2d7-f470-4dd6-a154-0412ef4739d7'::uuid), -- Walking Lunge

  ('f3a7d0bf-8982-4de3-a2da-9c6710b96f46'::uuid), -- Face Pull
  ('e78aa456-de7d-4791-a596-e4d0ae2b7294'::uuid), -- Lateral Raise
  ('25827130-c571-43c0-878b-061d5147b18a'::uuid), -- Overhead Press
  ('613ce12e-ed61-4dad-acee-85f3891102be'::uuid), -- Rear Delt Fly
  ('19d3f9d6-6e6d-48e5-8066-9b9415c1d222'::uuid), -- Seated Dumbbell Shoulder Press
  ('113576ab-8fcb-4626-9cc0-eb7a9a1af3ac'::uuid), -- Upright Row

  ('8aa7e7da-1733-4f6e-a168-784780d5dc5c'::uuid), -- Close-Grip Bench Press
  ('0b39072b-ee61-4ae0-9b6c-2132dc94a5cd'::uuid), -- Overhead Tricep Extension
  ('66dbe69a-637b-4d74-9102-075da3593502'::uuid), -- Skull Crusher
  ('756e03e6-4b5f-4e73-acd0-e2bf92e7f0b5'::uuid)  -- Tricep Pushdown
) as v(id)
where e.id = v.id;
