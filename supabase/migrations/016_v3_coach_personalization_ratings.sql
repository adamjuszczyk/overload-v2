-- Overload v3 — Coach Personalization phase 1: form / energy / pump ratings.
-- Additive only. Three nullable text columns, no default, no NOT NULL, no
-- backfill — every existing row stays exactly as it is and reads as "not
-- rated" (COACH-PERSONALIZATION-SPEC.md §5, §7 "absence is data too").
--
-- v2_-prefixed tables only: unlike migration 013's exercises columns, these
-- are in this app's own namespace, so there is no cross-app (Northstar v2)
-- consideration. Nullable-column-with-no-default is metadata-only on
-- Postgres 11+ (this project runs 17.6.1.141), so no table rewrite.

alter table v2_set_logs
  add column form_rating text
  check (form_rating in ('rushed','normal','controlled','extra_controlled'));

alter table v2_sessions
  add column energy_rating text
  check (energy_rating in ('none','low','normal','high','supreme'));

alter table v2_sessions
  add column pump_rating text
  check (pump_rating in ('none','some','good','extreme'));
