-- V3 replay-check test (MIGRATION-SWITCH.md step 9). DO NOT MERGE.
-- Deliberately broken: the table does not exist, so migration-replay must fail here.
-- Reverted by the next commit.
alter table v2_does_not_exist add column x int;
