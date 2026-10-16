// apply-ops-proof/breaks.mjs (chunk 47): the break proofs. Each is one exact edit (or a few) to a copy of the function
// read out of the migration file, or to the new column's constraint inside each scenario's own transaction (`pre`, rolled
// back), and names the scenarios that must then fail. `survives` marks the edit that cannot be seen from outside, with
// the reason: it is stated, not hidden. Run with `node scripts/apply-ops-proof.mjs --breaks`.
//
// An edit's `from` text must occur in the function exactly once (applyBreak throws otherwise: a break that never fired
// must not read as caught - RULES). The migration file itself is never changed.

// A control changes nothing that runs: it must pass every scenario, or the copy mechanism is not the function.
export const CONTROLS = [
  {
    id: 'C0',
    control: true,
    title: 'control: the function copied into the session, unedited',
    edits: [],
  },
  {
    id: 'C2',
    control: true,
    noDefaults: true,
    title: 'control: the copy on a database with no default privileges (a new Supabase branch): the migration\'s own revoke and grant leave authenticated alone able to run it',
    edits: [],
  },
  {
    id: 'C1',
    control: true,
    title: 'control: one comment added to the copy (the edit mechanism changes nothing by itself)',
    edits: [["begin\n  if v_uid is null then", "begin\n  -- control: a comment and nothing else\n  if v_uid is null then"]],
  },
]

export const BREAKS = [
  // ── who may call it, and what a list is
  { id: 'B01', title: 'no check that the caller is signed in', edits: [["    raise exception 'not signed in';", '    null;']], fails: ['G02'] },
  { id: 'B02', title: 'a list that is not a list is not refused', edits: [["    raise exception 'ops must be a list';", '    null;']], fails: ['G05-anobject', 'G05-astring', 'G05-anumber', 'G05-aJSONnull', 'G05-anSQLNULL'] },
  { id: 'B03', title: 'an SQL NULL list reads as an empty list (the "p_ops is null" half of the check dropped)', edits: [["if p_ops is null or jsonb_typeof(p_ops) <> 'array' then", "if jsonb_typeof(p_ops) <> 'array' then"]], fails: ['G05-anSQLNULL'] },
  { id: 'B04', title: 'an op that is not an object is not refused', edits: [["      raise exception 'op % is not an object', v_ord;", '      null;']], fails: ['G06'] },
  { id: 'B05', title: 'the list is applied in reverse order', edits: [['     order by e.ordinality\n  loop', '     order by e.ordinality desc\n  loop']], fails: ['A04', 'A05'] },
  { id: 'B06', title: 'the count returned is one more than the ops applied', edits: [['    v_done := v_done + 1;', '    v_done := v_done + 2;']], fails: ['A01', 'A06'] },
  { id: 'B07', title: 'an op of an unknown kind is counted and skipped', edits: [["      raise exception 'unknown op: %', coalesce(v_kind, 'none');", '      null;']], fails: ['G07'] },
  { id: 'B08', title: 'the kind is matched without regard to case', edits: [["if v_kind = 'insert' then", "if lower(v_kind) = 'insert' then"]], fails: ['G07'] },

  // ── the tables
  {
    id: 'B10',
    title: 'a table not on the list is not refused',
    edits: [["      raise exception 'table not allowed'\n        using detail = format('op %s names %s', v_ord, coalesce(v_table, 'no table'));", '      null;']],
    fails: ['T01', 'T02'],
  },
  {
    id: 'B11',
    title: 'v2_set_logs added to the list',
    edits: [["'v2_week_review_decisions', 'v2_session_set_changes'\n  ];", "'v2_week_review_decisions', 'v2_session_set_changes', 'v2_set_logs'\n  ];"]],
    fails: ['T01', 'T02'],
  },
  {
    id: 'B12',
    title: 'v2_session_set_changes taken off the list',
    edits: [["'v2_week_review_decisions', 'v2_session_set_changes'\n  ];", "'v2_week_review_decisions'\n  ];"]],
    fails: ['A06', 'I03', 'U02', 'D02'],
  },
  {
    id: 'B13',
    title: 'v2_week_plans taken off the list',
    edits: [["'v2_workout_days', 'v2_programs', 'v2_run_schedules', 'v2_week_plans',", "'v2_workout_days', 'v2_programs', 'v2_run_schedules',"]],
    fails: ['A06', 'W03'],
  },

  // ── insert
  { id: 'B20', title: 'no refusal of an insert into v2_programs, v2_workout_days, v2_week_plans', edits: [["        raise exception 'insert not allowed on %', v_table;", '        null;']], fails: ['I01', 'W01'] },
  { id: 'B21', title: 'v2_week_plans taken off the no-insert list', edits: [["if v_table in ('v2_programs', 'v2_workout_days', 'v2_week_plans') then", "if v_table in ('v2_programs', 'v2_workout_days') then"]], fails: ['I01', 'W01'] },
  { id: 'B22', title: 'v2_workout_days taken off the no-insert list', edits: [["if v_table in ('v2_programs', 'v2_workout_days', 'v2_week_plans') then", "if v_table in ('v2_programs', 'v2_week_plans') then"]], fails: ['I01'] },
  { id: 'B23', title: 'v2_programs taken off the no-insert list', edits: [["if v_table in ('v2_programs', 'v2_workout_days', 'v2_week_plans') then", "if v_table in ('v2_workout_days', 'v2_week_plans') then"]], fails: ['I01'] },
  { id: 'B24', title: 'an insert without a row object is not refused', edits: [["        raise exception 'insert needs a row'\n          using detail = format('op %s on %s', v_ord, v_table);", '        null;']], fails: ['I04'] },
  { id: 'B25', title: 'a row that names an unknown column is not refused (the key is dropped without a word)', edits: [["        raise exception 'row names an unknown column: %.%', v_table, v_col;", '        null;']], fails: ['I05'] },
  { id: 'B26', title: 'the row\'s own user_id is kept (not overwritten by the caller\'s)', edits: [["      v_row := v_row || jsonb_build_object('user_id', v_uid);", '      null;']], fails: ['I02', 'A01'] },
  {
    id: 'B28',
    title: 'the unknown-column check lets system columns through (ctid, tableoid)',
    edits: [['and a.attnum > 0 and not a.attisdropped and a.attname = k)', 'and not a.attisdropped and a.attname = k)']],
    fails: ['I05'],
  },
  {
    id: 'B29',
    title: 'the unknown-column check counts a dropped column as a column',
    edits: [['and a.attnum > 0 and not a.attisdropped and a.attname = k)', 'and a.attnum > 0 and a.attname = k)']],
    fails: ['I05'],
  },
  {
    id: 'B27',
    title: 'an insert takes only the columns the row names, so a column it leaves out gets its default (the other reading of jsonb_populate_record)',
    edits: [[
      "      execute format(\n        'insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',\n        v_table, v_table\n      ) using v_row;",
      "      select string_agg(format('%I', k), ', ') into v_sets from jsonb_object_keys(v_row) as k;\n      execute format(\n        'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',\n        v_table, v_sets, v_sets, v_table\n      ) using v_row;",
    ]],
    fails: ['I06'],
  },

  // ── update
  { id: 'B30', title: 'an update without a patch object is not refused as such', edits: [["        raise exception 'update needs a patch'\n          using detail = format('op %s on %s/%s', v_ord, v_table, v_id);", '        null;']], fails: ['U04'] },
  {
    id: 'B31',
    title: 'a patch may set id and user_id',
    edits: [["      if v_patch ? 'id' or v_patch ? 'user_id' then\n        raise exception 'patch sets a protected column';\n      end if;", '']],
    fails: ['U01'],
  },
  { id: 'B32', title: 'a patch may set id (only user_id is protected)', edits: [["if v_patch ? 'id' or v_patch ? 'user_id' then", "if v_patch ? 'user_id' then"]], fails: ['U01'] },
  { id: 'B33', title: 'a patch may set user_id (only id is protected)', edits: [["if v_patch ? 'id' or v_patch ? 'user_id' then", "if v_patch ? 'id' then"]], fails: ['U01'] },
  {
    id: 'B34',
    title: 'a patch of v2_week_plans may name any column (the one-column rule removed)',
    edits: [["        if v_col is not null then\n          raise exception 'patch sets a protected column';\n        end if;", '        null;']],
    fails: ['W02'],
  },
  {
    id: 'B35',
    title: 'a patch of v2_week_plans may also name notes',
    edits: [["where k <> 'deload_restore' limit 1;", "where k not in ('deload_restore', 'notes') limit 1;"]],
    fails: ['W02'],
  },
  {
    id: 'B36',
    title: 'the one-column rule is put on v2_week_plan_sets instead of v2_week_plans',
    edits: [["      if v_table = 'v2_week_plans' then\n        select k into v_col", "      if v_table = 'v2_week_plan_sets' then\n        select k into v_col"]],
    fails: ['W02', 'A01'],
  },
  { id: 'B37', title: 'a patch with nothing in it reaches the database as a bare SET', edits: [["        raise exception 'patch is empty'\n          using detail = format('op %s on %s/%s', v_ord, v_table, v_id);", '        null;']], fails: ['U04'] },
  {
    id: 'B38',
    title: 'an update that matches no row is not an error (counted, not found)',
    edits: [[") using v_patch, v_id, v_uid;\n      get diagnostics v_count = row_count;\n      if v_count = 0 then\n        raise exception 'row not found: %/%', v_table, v_id;\n      end if;", ") using v_patch, v_id, v_uid;"]],
    fails: ['A02', 'U02', 'W04'],
  },
  {
    id: 'B64',
    title: 'the patch\'s column names are spliced in as text (%s) instead of quoted as identifiers (%I)',
    edits: [["format('%I = (p.r).%I', k, k)", "format('%s = (p.r).%s', k, k)"]],
    fails: ['U07'],
  },
  {
    id: 'B65',
    title: 'the table name is spliced in as text in the delete (the list of tables already makes it safe)',
    edits: [["execute format('delete from public.%I as t where t.id = $1 and t.user_id = $2', v_table)", "execute format('delete from public.%s as t where t.id = $1 and t.user_id = $2', v_table)"]],
    survives: 'a table name is only ever one of the twelve on the list (B10 and B11 are the breaks of that list); %I is a second lock',
  },
  {
    id: 'B39',
    title: 'an update is not limited to its id (every row of the caller\'s table is updated)',
    edits: [["' where t.id = $2 and t.user_id = $3'", "' where t.user_id = $3'"]],
    fails: ['U06', 'A01'],
  },
  {
    id: 'B40',
    title: 'an update is not scoped to the caller in its own text (RLS still scopes it: security invoker)',
    edits: [["' where t.id = $2 and t.user_id = $3'", "' where t.id = $2'"]],
    survives: 'the table\'s row-level security shows the caller only their own rows, so the stranger\'s row is still "not found"; B58 removes both locks',
  },

  // ── delete
  { id: 'B45', title: 'a delete of a v2_week_plans row is not refused', edits: [["        raise exception 'delete not allowed on %', v_table;", '        null;']], fails: ['W01'] },
  {
    id: 'B46',
    title: 'a delete that matches no row is not an error',
    edits: [["using v_id, v_uid;\n      get diagnostics v_count = row_count;\n      if v_count = 0 then\n        raise exception 'row not found: %/%', v_table, v_id;\n      end if;", 'using v_id, v_uid;']],
    fails: ['D02'],
  },
  {
    id: 'B47',
    title: 'a delete is not limited to its id (every row of the caller\'s table goes)',
    edits: [["'delete from public.%I as t where t.id = $1 and t.user_id = $2'", "'delete from public.%I as t where t.user_id = $2'"]],
    fails: ['D01', 'D04'],
  },
  {
    id: 'B48',
    title: 'a delete is not scoped to the caller in its own text (RLS still scopes it)',
    edits: [["'delete from public.%I as t where t.id = $1 and t.user_id = $2'", "'delete from public.%I as t where t.id = $1'"]],
    survives: 'row-level security (security invoker) hides the stranger\'s rows; B58 removes both locks',
  },

  // ── who runs it, and who may
  { id: 'B50', title: 'security definer instead of invoker', edits: [['security invoker', 'security definer']], fails: ['G04'] },
  { id: 'B51', title: 'no fixed search_path', edits: [['set search_path = public\n', '']], fails: ['G04'] },
  { id: 'B52', title: 'execute not revoked from public and anon', edits: [['revoke execute on function v2_apply_ops(jsonb) from public, anon;', '']], fails: ['G03', 'G04'] },
  { id: 'B53', title: 'execute revoked from public but not from anon', edits: [['from public, anon;', 'from public;']], fails: ['G03', 'G04'] },
  {
    id: 'B54',
    title: 'execute not granted to authenticated (with Supabase\'s default privileges on, which grant it anyway)',
    edits: [['grant execute on function v2_apply_ops(jsonb) to authenticated;', '']],
    survives: 'production-like databases grant authenticated execute on a new function in public by default; B55 is the database without them',
  },
  {
    id: 'B55',
    title: 'execute not granted to authenticated, on a database with no default privileges (a new Supabase branch)',
    noDefaults: true,
    edits: [['grant execute on function v2_apply_ops(jsonb) to authenticated;', '']],
    fails: ['G01', 'A01', 'G04'],
  },
  {
    id: 'B58',
    title: 'both locks off: security definer and no user scope in the update and the delete text',
    edits: [
      ['security invoker', 'security definer'],
      ["' where t.id = $2 and t.user_id = $3'", "' where t.id = $2'"],
      ["'delete from public.%I as t where t.id = $1 and t.user_id = $2'", "'delete from public.%I as t where t.id = $1'"],
    ],
    fails: ['U02', 'D02', 'A02', 'W04', 'G04'],
  },

  // ── the new column (inside each scenario's transaction, rolled back)
  {
    id: 'B60',
    title: 'the link\'s foreign key without "on delete set null"',
    pre: "alter table v2_program_exercises drop constraint v2_program_exercises_replaces_program_exercise_id_fkey;\nalter table v2_program_exercises add constraint v2_program_exercises_replaces_program_exercise_id_fkey foreign key (replaces_program_exercise_id) references v2_program_exercises(id);",
    edits: [],
    fails: ['D03', 'S01'],
  },
  {
    id: 'B61',
    title: 'the link\'s foreign key with "on delete cascade"',
    pre: "alter table v2_program_exercises drop constraint v2_program_exercises_replaces_program_exercise_id_fkey;\nalter table v2_program_exercises add constraint v2_program_exercises_replaces_program_exercise_id_fkey foreign key (replaces_program_exercise_id) references v2_program_exercises(id) on delete cascade;",
    edits: [],
    fails: ['D03', 'S01'],
  },
  {
    id: 'B62',
    title: 'no foreign key on the link',
    pre: 'alter table v2_program_exercises drop constraint v2_program_exercises_replaces_program_exercise_id_fkey;',
    edits: [],
    fails: ['I08', 'S01'],
  },
  {
    id: 'B63',
    title: 'the link column is NOT NULL',
    pre: 'alter table v2_program_exercises alter column replaces_program_exercise_id set not null;',
    edits: [],
    fails: ['F00', 'S01'],
  },
]

