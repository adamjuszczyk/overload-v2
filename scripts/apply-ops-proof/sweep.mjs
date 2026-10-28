// apply-ops-proof/sweep.mjs (chunk 47): a generated sweep of the function, for the holes that hand-picked breaks leave
// (RULES: a break that survives a named proof is one of several holes in the same function). Pure: it reads the install
// text and returns mutants; scripts/apply-ops-proof.mjs --sweep runs every scenario against each one.
//
// The operators, each applied to every place it fits, one edit per mutant:
//   raise     a `raise exception …;` statement becomes `null;`
//   delete    an assignment, an `execute … ;`, a `select … into … ;` or a `get diagnostics` becomes `null;`
//   not       an `if` / `elsif` condition is negated
//   always    an `if` / `elsif` condition becomes true, and becomes false
//   and-or    one `and` in a condition becomes `or`, and the other way round
//   flip      a comparison is turned: <> and =, is distinct from and is not distinct from, exists and not exists
//   number    a literal in a count or a comparison is changed (0 to 1, + 1 to + 0)
// A mutant that does not compile is dropped by the runner (the function fails to create).

const body = (text) => {
  const start = text.indexOf('as $fn$') + 'as $fn$'.length
  const end = text.lastIndexOf('$fn$;')
  return { start, end, text: text.slice(start, end) }
}

// `if … then` and `elsif … then`, but not `end if;`
const IF = /(?<!end\s)\b(if|elsif)\s+([\s\S]+?)\s+then\b/g

export function mutants(installText) {
  const { start, text } = body(installText)
  const out = []
  const push = (op, at, len, to, what) => {
    const edited = text.slice(0, at) + to + text.slice(at + len)
    out.push({ id: `${op}-${out.length + 1}`, op, what: what.replace(/\s+/g, ' ').slice(0, 90), text: installText.slice(0, start) + edited + installText.slice(start + text.length) })
  }

  for (const m of text.matchAll(/raise exception[^;]*;/g)) push('raise', m.index, m[0].length, 'null;', m[0])
  for (const m of text.matchAll(/(?<![\w.])(v_[a-z_]+\s*:=[^;]*;|execute\s+format[^;]*;|select\s[^;]*\sinto\s[^;]*;|get diagnostics[^;]*;)/g)) {
    if (/^v_(uid|tables|done)\b/.test(m[0]) && !m[0].includes(':=')) continue
    push('delete', m.index, m[0].length, 'null;', m[0])
  }
  for (const m of text.matchAll(IF)) {
    const [whole, kw, cond] = m
    const condAt = m.index + kw.length + (whole.slice(kw.length).length - whole.slice(kw.length).trimStart().length)
    push('not', condAt, cond.length, `not (${cond})`, `${kw} ${cond}`)
    push('always', condAt, cond.length, 'true', `${kw} ${cond}`)
    push('always', condAt, cond.length, 'false', `${kw} ${cond}`)
    for (const a of cond.matchAll(/\b(and|or)\b/g)) push('and-or', condAt + a.index, a[0].length, a[0] === 'and' ? 'or' : 'and', `${kw} ${cond}`)
  }
  const flips = [
    [/<> 'array'/g, "= 'array'"], [/<> 'object'/g, "= 'object'"], [/is distinct from/g, 'is not distinct from'],
    [/not exists/g, 'exists'], [/not \(v_table = any/g, '(v_table = any'], [/v_count = 0/g, 'v_count <> 0'], [/v_count = 0/g, 'v_count = 1'],
    [/v_done \+ 1/g, 'v_done + 0'], [/v_done integer := 0/g, 'v_done integer := 1'], [/k <> 'deload_restore'/g, "k = 'deload_restore'"],
    [/v_kind = '(insert|update|delete)'/g, "v_kind <> '$1'"], [/a\.attnum > 0/g, 'a.attnum >= 0'], [/limit 1/g, 'limit 0'],
  ]
  for (const [re, to] of flips) for (const m of text.matchAll(re)) push('flip', m.index, m[0].length, m[0].replace(re, to), m[0])
  return out
}
