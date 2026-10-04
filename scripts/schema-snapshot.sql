-- schema-snapshot.sql
--
-- One read-only query over pg_catalog that returns the database's schema as a
-- single JSON document (column "snapshot"). It reads no table rows.
--
-- Used to prove that replaying supabase/migrations from scratch gives the live
-- schema: run it on both databases, then
--   node scripts/compare-schema.mjs [--exclude FILE] live.json replay.json
--
-- Live (Windows cmd):
--   npx --yes supabase@2.119.0 db query --linked -f scripts\schema-snapshot.sql -o json > live-snapshot.json
-- Replay: bash scripts/replay-migrations.sh --snapshot replay-snapshot.json
--
-- Scope: everything in schema public, plus user triggers on auth/storage tables
-- (trigger function in public) and policies on storage tables. Supabase's own
-- schemas are managed by the platform and differ by service version, so they
-- are left out. "meta" is informational and never compared.

with
rels as (
  select c.oid, c.relname, c.relkind, c.relowner, c.relacl, c.reloptions,
         c.relrowsecurity, c.relforcerowsecurity
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
     -- objects that belong to an extension are the extension's, not ours
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
),
funcs as (
  select p.*
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (select 1 from pg_depend d
                      where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
)
select jsonb_build_object(
  'meta', jsonb_build_object(
    'server_version', current_setting('server_version'),
    'taken_at', now()
  ),

  'schemas', (
    select coalesce(jsonb_agg(jsonb_build_object('name', n.nspname, 'owner', n.nspowner::regrole::text)
                    order by n.nspname), '[]')
      from pg_namespace n
     where n.nspname not like 'pg\_%' and n.nspname <> 'information_schema'),

  'extensions', (
    select coalesce(jsonb_agg(jsonb_build_object('name', e.extname, 'schema', e.extnamespace::regnamespace::text,
                                                 'version', e.extversion) order by e.extname), '[]')
      from pg_extension e),

  'tables', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', r.relname, 'kind', r.relkind, 'owner', r.relowner::regrole::text,
             'rls', r.relrowsecurity, 'rls_forced', r.relforcerowsecurity,
             'options', coalesce(to_jsonb(r.reloptions), '[]'))
           order by r.relname), '[]')
      from rels r where r.relkind in ('r', 'p', 'f')),

  'columns', (
    select coalesce(jsonb_agg(x order by x->>'table', (x->>'position')::int), '[]')
      from (
        select jsonb_build_object(
                 'table', r.relname, 'name', a.attname,
                 -- relative order among live columns (dropped columns leave attnum gaps)
                 'position', row_number() over (partition by r.oid order by a.attnum),
                 'type', format_type(a.atttypid, a.atttypmod),
                 'not_null', a.attnotnull,
                 'default', pg_get_expr(ad.adbin, ad.adrelid),
                 'identity', nullif(a.attidentity, ''),
                 'generated', nullif(a.attgenerated, ''),
                 'collation', case when a.attcollation <> 0
                                    and a.attcollation <> (select t.typcollation from pg_type t where t.oid = a.atttypid)
                                   then (select co.collname from pg_collation co where co.oid = a.attcollation) end) as x
          from rels r
          join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
          left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
         where r.relkind in ('r', 'p', 'f', 'v', 'm')
      ) s),

  'constraints', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'table', r.relname, 'name', co.conname, 'type', co.contype,
             'definition', pg_get_constraintdef(co.oid, true),
             'deferrable', co.condeferrable, 'deferred', co.condeferred, 'validated', co.convalidated)
           order by r.relname, co.conname), '[]')
      from pg_constraint co join rels r on r.oid = co.conrelid),

  'indexes', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'table', r.relname, 'name', ic.relname, 'definition', pg_get_indexdef(i.indexrelid))
           order by r.relname, ic.relname), '[]')
      from pg_index i
      join rels r on r.oid = i.indrelid
      join pg_class ic on ic.oid = i.indexrelid),

  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'schema', p.schemaname, 'table', p.tablename, 'name', p.policyname,
             'permissive', p.permissive, 'roles', to_jsonb(p.roles), 'command', p.cmd,
             'using', p.qual, 'with_check', p.with_check)
           order by p.schemaname, p.tablename, p.policyname), '[]')
      from pg_policies p
     where p.schemaname in ('public', 'storage')),

  'functions', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', f.proname, 'args', pg_get_function_identity_arguments(f.oid),
             'kind', f.prokind, 'returns', pg_get_function_result(f.oid),
             'language', (select l.lanname from pg_language l where l.oid = f.prolang),
             'security_definer', f.prosecdef, 'volatility', f.provolatile,
             'strict', f.proisstrict, 'config', coalesce(to_jsonb(f.proconfig), '[]'),
             'owner', f.proowner::regrole::text,
             'body_md5', md5(f.prosrc), 'body_length', length(f.prosrc))
           order by f.proname, pg_get_function_identity_arguments(f.oid)), '[]')
      from funcs f),

  'views', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', r.relname, 'kind', r.relkind, 'owner', r.relowner::regrole::text,
             'options', coalesce(to_jsonb(r.reloptions), '[]'),
             'definition', pg_get_viewdef(r.oid, true))
           order by r.relname), '[]')
      from rels r where r.relkind in ('v', 'm')),

  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'schema', tn.nspname, 'table', tc.relname, 'name', t.tgname,
             'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid, true))
           order by tn.nspname, tc.relname, t.tgname), '[]')
      from pg_trigger t
      join pg_class tc on tc.oid = t.tgrelid
      join pg_namespace tn on tn.oid = tc.relnamespace
      join pg_proc tp on tp.oid = t.tgfoid
      join pg_namespace pn on pn.oid = tp.pronamespace
     where not t.tgisinternal
       and (tn.nspname = 'public'
            or (tn.nspname in ('auth', 'storage') and pn.nspname = 'public'))),

  'types', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', t.typname, 'kind', t.typtype,
             'labels', (select coalesce(jsonb_agg(e.enumlabel order by e.enumsortorder), '[]')
                          from pg_enum e where e.enumtypid = t.oid),
             'base', case when t.typtype = 'd' then format_type(t.typbasetype, t.typtypmod) end,
             'not_null', t.typnotnull, 'default', t.typdefault)
           order by t.typname), '[]')
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typtype in ('e', 'd')
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_type'::regclass and d.objid = t.oid and d.deptype = 'e')),

  'sequences', (
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', r.relname, 'type', format_type(s.seqtypid, null),
             'start', s.seqstart, 'increment', s.seqincrement, 'min', s.seqmin, 'max', s.seqmax,
             'cache', s.seqcache, 'cycle', s.seqcycle,
             'owned_by', (select oc.relname || '.' || oa.attname
                            from pg_depend d
                            join pg_class oc on oc.oid = d.refobjid
                            join pg_attribute oa on oa.attrelid = d.refobjid and oa.attnum = d.refobjsubid
                           where d.classid = 'pg_class'::regclass and d.objid = r.oid
                             and d.deptype in ('a', 'i') limit 1))
           order by r.relname), '[]')
      from rels r join pg_sequence s on s.seqrelid = r.oid),

  'grants', (
    select coalesce(jsonb_agg(g order by g->>'object', g->>'grantee', g->>'privilege'), '[]')
      from (
        select jsonb_build_object(
                 'object', case r.relkind when 'S' then 'sequence ' when 'v' then 'view ' when 'm' then 'view '
                                          else 'table ' end || r.relname,
                 'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
                 'privilege', x.privilege_type, 'grantable', x.is_grantable) as g
          from rels r,
               aclexplode(coalesce(r.relacl, acldefault((case when r.relkind = 'S' then 's' else 'r' end)::"char", r.relowner))) x
        union all
        select jsonb_build_object(
                 'object', 'function ' || f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')',
                 'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
                 'privilege', x.privilege_type, 'grantable', x.is_grantable)
          from funcs f, aclexplode(coalesce(f.proacl, acldefault('f'::"char", f.proowner))) x
      ) s),

  'default_privileges', (
    select coalesce(jsonb_agg(g order by g->>'role', g->>'schema', g->>'object_type', g->>'grantee', g->>'privilege'), '[]')
      from (
        select jsonb_build_object(
                 'role', d.defaclrole::regrole::text,
                 'schema', coalesce(d.defaclnamespace::regnamespace::text, '(all)'),
                 'object_type', d.defaclobjtype,
                 'grantee', case when x.grantee = 0 then 'PUBLIC' else x.grantee::regrole::text end,
                 'privilege', x.privilege_type, 'grantable', x.is_grantable) as g
          from pg_default_acl d, aclexplode(d.defaclacl) x
         where d.defaclnamespace = 0 or d.defaclnamespace = 'public'::regnamespace
      ) s),

  'comments', (
    select coalesce(jsonb_agg(c order by c->>'object'), '[]')
      from (
        select jsonb_build_object('object', 'relation ' || r.relname, 'comment', obj_description(r.oid, 'pg_class')) as c
          from rels r where obj_description(r.oid, 'pg_class') is not null
        union all
        select jsonb_build_object('object', 'column ' || r.relname || '.' || a.attname,
                                  'comment', col_description(r.oid, a.attnum))
          from rels r join pg_attribute a on a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
         where col_description(r.oid, a.attnum) is not null
        union all
        select jsonb_build_object('object', 'function ' || f.proname || '(' || pg_get_function_identity_arguments(f.oid) || ')',
                                  'comment', obj_description(f.oid, 'pg_proc'))
          from funcs f where obj_description(f.oid, 'pg_proc') is not null
      ) s)
) as snapshot;
