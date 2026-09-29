// migration-rules.test.mjs — run with: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, splitStatements } from './migration-rules.mjs';

const added = (sql, path = 'supabase/migrations/20260101000000_x.sql') => [{ path, status: 'A', sql }];
const safe = (sql) => assert.equal(classify(added(sql)).safe, true, JSON.stringify(classify(added(sql)).flagged));
const flagged = (sql) => assert.equal(classify(added(sql)).safe, false);

test('no migration changes is safe', () => {
  assert.equal(classify([]).safe, true);
});

test('new table with RLS, policy, index and grant is safe', () => safe(`
  create table public.sessions (id uuid primary key, user_id uuid not null references auth.users on delete cascade);
  alter table public.sessions enable row level security;
  create policy "own rows" on public.sessions for select using (auth.uid() = user_id);
  create unique index sessions_user_idx on sessions (user_id);
  grant select on sessions to authenticated;
  insert into sessions (id, user_id) values ('a', 'b');
`));

test('nullable column on an existing table is safe', () => safe('ALTER TABLE workouts ADD COLUMN notes text;'));
test('NOT NULL with DEFAULT on an existing table is safe', () => safe('alter table workouts add column done boolean not null default false;'));
test('several ADD COLUMNs in one statement are safe', () => safe('alter table workouts add column a text, add column b int default 0;'));
test('new index on an existing table is safe', () => safe('create index if not exists w_idx on workouts (created_at);'));
test('new enum and a new enum value are safe', () => safe(`create type mood as enum ('good','bad'); alter type mood add value 'ok';`));
test('comments and transactions are safe', () => safe(`begin; comment on table workouts is 'drop table x;'; commit;`));

test('NOT NULL without DEFAULT on an existing table is flagged', () => flagged('alter table workouts add column done boolean not null;'));
test('DROP COLUMN is flagged', () => flagged('alter table workouts drop column notes;'));
test('ADD then DROP in one statement is flagged', () => flagged('alter table workouts add column a text, drop column b;'));
test('changing a column type is flagged', () => flagged('alter table workouts alter column reps type smallint;'));
test('DROP TABLE is flagged', () => flagged('drop table workouts;'));
test('unique index on an existing table is flagged', () => flagged('create unique index u on workouts (name);'));
test('policy on an existing table is flagged', () => flagged(`create policy p on workouts for select using (true);`));
test('new function is flagged', () => flagged(`create function f() returns int as $$ select 1; $$ language sql;`));
test('UPDATE is flagged', () => flagged(`update workouts set reps = 0;`));
test('insert into an existing table is flagged', () => flagged(`insert into workouts (id) values (1);`));
test('upsert into a new table is flagged', () => flagged(`create table t (id int); insert into t values (1) on conflict (id) do update set id = 2;`));
test('new FK column with ON DELETE CASCADE on an existing table is flagged',
  () => flagged('alter table workouts add column plan_id uuid references plans on delete cascade;'));
test('unknown statements are flagged', () => flagged('create extension if not exists pg_trgm;'));

test('keywords inside comments do not count', () => safe(`-- drop table workouts;\n/* truncate workouts; */\nalter table workouts add column notes text;`));

test('a dollar-quoted body stays one statement', () => {
  const s = splitStatements(`create function f() returns void as $body$ begin delete from x; end; $body$ language plpgsql; select 1;`);
  assert.equal(s.length, 2);
});

test('a table created in an earlier file of the same branch counts as new', () => {
  const r = classify([
    { path: 'supabase/migrations/1_a.sql', status: 'A', sql: 'create table plans (id uuid primary key);' },
    { path: 'supabase/migrations/2_b.sql', status: 'A', sql: 'alter table plans add constraint c unique (id);' },
  ]);
  assert.equal(r.safe, true);
});

test('editing an existing migration is flagged', () => {
  const r = classify([{ path: 'supabase/migrations/1_a.sql', status: 'M', sql: 'create table x (id int);' }]);
  assert.equal(r.safe, false);
});

test('deleting an existing migration is flagged', () => {
  const r = classify([{ path: 'supabase/migrations/1_a.sql', status: 'D', sql: null }]);
  assert.equal(r.safe, false);
});
