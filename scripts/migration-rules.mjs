// migration-rules.mjs — the safe list and the classifier. Pure functions, no I/O.
// Tested by migration-rules.test.mjs. Run by check-migration.mjs.
//
// Decides whether the migrations on this branch can be merged into main without
// me. It checks every statement against a short list of changes that cannot
// alter or remove existing data. Anything not on the list — including anything
// this script doesn't recognise — is flagged, and the merge comes to me.
//
// It checks what's allowed, not what's forbidden, so it fails safe.
// It checks data safety only. Whether RLS policies are *correct* is the schema
// chunk's own verification, not this script's job.

// ---------------------------------------------------------------- SQL splitting

// Splits SQL into statements, dropping comments. Respects single-quoted strings,
// quoted identifiers and dollar-quoted bodies, so a ';' or '--' inside any of
// them never splits or truncates a statement.
export function splitStatements(sql) {
  const out = [];
  let cur = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      cur += ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < n && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      cur += ' ';
      continue;
    }
    if (c === "'" || c === '"') {
      const q = c;
      cur += c;
      i++;
      while (i < n) {
        cur += sql[i];
        if (sql[i] === q) {
          if (sql[i + 1] === q) { cur += sql[i + 1]; i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        cur += sql.slice(i, stop);
        i = stop;
        continue;
      }
    }
    if (c === ';') {
      if (cur.trim()) out.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += c;
    i++;
  }
  if (cur.trim()) out.push(cur);
  return out.map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

// Splits on commas that are not inside parentheses or quotes.
function splitTopLevelCommas(s) {
  const parts = [];
  let depth = 0, cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Text with quoted strings removed, so keywords inside strings don't count.
function withoutStrings(s) {
  return s.replace(/'(?:[^']|'')*'/g, "''");
}

// ---------------------------------------------------------------- names

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`(?:${IDENT}\.)?${IDENT}`;

export function normName(q) {
  const parts = q.match(/"[^"]+"|[^.]+/g).map(p =>
    p.startsWith('"') ? p.slice(1, -1) : p.toLowerCase());
  return parts.length === 1 ? `public.${parts[0]}` : `${parts[0]}.${parts[1]}`;
}

// ---------------------------------------------------------------- the safe list

const re = (src) => new RegExp(src, 'i');

const R = {
  txn: re(String.raw`^(BEGIN|COMMIT|START TRANSACTION)$`),
  createTable: re(String.raw`^CREATE TABLE (?:IF NOT EXISTS )?(${QNAME}) ?\(`),
  createIndex: re(String.raw`^CREATE (UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?(?:${IDENT} )?ON (?:ONLY )?(${QNAME})`),
  createEnum: re(String.raw`^CREATE TYPE ${QNAME} AS ENUM ?\(`),
  alterTypeAddValue: re(String.raw`^ALTER TYPE ${QNAME} ADD VALUE `),
  comment: re(String.raw`^COMMENT ON `),
  alterTable: re(String.raw`^ALTER TABLE (?:IF EXISTS )?(?:ONLY )?(${QNAME}) (.+)$`),
  createPolicy: re(String.raw`^CREATE POLICY ${IDENT} ON (${QNAME})`),
  grant: re(String.raw`^GRANT .+? ON (?:TABLE )?(${QNAME}) TO `),
  insert: re(String.raw`^INSERT INTO (${QNAME})`),
};

// One ALTER TABLE action on a table that already exists. Returns a reason if
// it's not safe, or null if it is.
function checkAddColumn(action) {
  const a = withoutStrings(action).toUpperCase();
  if (!/^ADD /.test(a)) return 'only ADD COLUMN is allowed on an existing table';
  if (/^ADD (CONSTRAINT|PRIMARY|UNIQUE|CHECK|FOREIGN|EXCLUDE)\b/.test(a))
    return 'adds a constraint to existing data';
  if (/\bPRIMARY KEY\b|\bUNIQUE\b|\bCHECK\b|\bGENERATED\b/.test(a))
    return 'new column carries a constraint or generated value';
  if (/\bON (DELETE|UPDATE)\b/.test(a))
    return 'foreign key action can change existing rows later';
  if (/\bNOT NULL\b/.test(a) && !/\bDEFAULT\b/.test(a))
    return 'NOT NULL without a DEFAULT on a table that already has rows';
  return null;
}

// Classifies one statement. `created` holds tables created earlier in this same
// batch — they're empty when the migration runs, so anything done to them is safe.
function classifyStatement(stmt, created) {
  let m;
  if (R.txn.test(stmt)) return null;
  if ((m = R.createTable.exec(stmt))) { created.add(normName(m[1])); return null; }
  if (R.createEnum.test(stmt)) return null;
  if (R.alterTypeAddValue.test(stmt)) return null;
  if (R.comment.test(stmt)) return null;

  if ((m = R.createIndex.exec(stmt))) {
    if (!m[1] || created.has(normName(m[2]))) return null;
    return 'unique index on a table that already has rows';
  }
  if ((m = R.alterTable.exec(stmt))) {
    if (created.has(normName(m[1]))) return null;
    for (const action of splitTopLevelCommas(m[2])) {
      const why = checkAddColumn(action);
      if (why) return why;
    }
    return null;
  }
  if ((m = R.createPolicy.exec(stmt))) {
    if (created.has(normName(m[1]))) return null;
    return 'policy on an existing table changes who can see existing rows';
  }
  if ((m = R.grant.exec(stmt))) {
    if (created.has(normName(m[1]))) return null;
    return 'grant on an existing table';
  }
  if ((m = R.insert.exec(stmt))) {
    if (created.has(normName(m[1])) && !/\bDO UPDATE\b/i.test(withoutStrings(stmt))) return null;
    return 'writes rows into a table that already has data';
  }
  return 'not on the safe list';
}

// files: [{ path, status, sql }] — status is git's: A added, M modified, D deleted, R renamed.
// Returns { safe, flagged: [{ file, statement, reason }] }.
export function classify(files) {
  const flagged = [];
  const created = new Set();
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  for (const f of sorted) {
    if (f.status !== 'A') {
      flagged.push({ file: f.path, statement: '(whole file)', reason: 'changes an existing migration — migrations are forward-only' });
    }
  }
  for (const f of sorted) {
    if (f.status !== 'A' || f.sql == null) continue;
    for (const stmt of splitStatements(f.sql)) {
      const reason = classifyStatement(stmt, created);
      if (reason) flagged.push({ file: f.path, statement: stmt, reason });
    }
  }
  return { safe: flagged.length === 0, flagged };
}
