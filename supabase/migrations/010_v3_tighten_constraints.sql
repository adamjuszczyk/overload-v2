-- Overload v3 — contract migration: parent_set_id FK tightening
-- (TASKS.md §2.1, §2.8, Phase 3.8 item 35)
--
-- parent_set_id was created in 001 as `on delete set null`. Under the v3
-- dropset model a stage row with parent_set_id = null is indistinguishable
-- from a main working set, so deleting a dropset's head would silently
-- promote its stages into independent working sets (TASKS.md §2.1, "the
-- silent-promotion window"). Must become `on delete cascade`.
--
-- Deferred to this migration specifically, and run last, because it is the
-- only migration in this release that can reject an old-shaped offline
-- payload replayed from the Dexie sync_queue — TASKS.md §0 item 3. It must
-- not run until the queue is confirmed empty. Checked live in the Phase 3.8
-- session, against the persistent authenticated dev-server browser session
-- used for every live-verification pass in this project (localhost:5173,
-- IndexedDB database "overload-v2"): `sync_queue` count was 0, 0 items —
-- see CONTEXT.md's Phase 3.8 entry for the full result and its one caveat
-- (this reflects the browser/device used for development, not every device
-- the account may have used offline).
--
-- The plan side (parent_week_plan_set_id) already got `on delete cascade`
-- in 004 — no change needed there.
--
-- Does not retire ExerciseCard.tsx's client-side cascade guard (added in
-- 3.1, TASKS.md §5.3) — the FK stops the database from orphaning stages;
-- the guard keeps TanStack Query's optimistic cache correct, since a
-- server-side cascade removes rows the client still holds until the next
-- refetch. Complementary, not redundant in a way that needs unwinding.
alter table v2_set_logs
  drop constraint v2_set_logs_parent_set_id_fkey,
  add constraint v2_set_logs_parent_set_id_fkey
    foreign key (parent_set_id) references v2_set_logs(id) on delete cascade;
