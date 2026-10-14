// staging-guard.mjs
//
// The one check every script that writes test data runs first: it refuses
// production's Supabase project. Staging is a persistent branch of that
// project with its own ref (CONTEXT.md, "Staging"); production holds real
// people's data, which no test write may touch.
//
// Use from a script:
//   import { assertNotProduction } from './staging-guard.mjs';
//   assertNotProduction(process.env.STAGING_SUPABASE_URL);   // throws on production
// Or from a shell:  node scripts/staging-guard.mjs <supabase-url>   (exit 1 on production)

// Production's project ref (CONTEXT.md, Repo facts). Also in src/lib/appEnv.ts.
export const PRODUCTION_SUPABASE_REF = 'imhsawrghteqsmpklofv';

// The project ref of a Supabase URL (https://<ref>.supabase.co), or null.
export function supabaseRefOf(url) {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)(\/|$)/i.exec(String(url ?? '').trim());
  return match ? match[1].toLowerCase() : null;
}

// Throws unless `url` is a Supabase project URL that is not production's.
// An unrecognised URL is refused too: a guard that can't tell is not a pass.
export function assertNotProduction(url) {
  const ref = supabaseRefOf(url);
  if (ref === null) {
    throw new Error(`staging-guard: not a Supabase project URL (${url ? 'unrecognised' : 'empty'}); refusing to write test data`);
  }
  if (ref === PRODUCTION_SUPABASE_REF) {
    throw new Error('staging-guard: this is PRODUCTION; refusing to write test data');
  }
  return ref;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const ref = assertNotProduction(process.argv[2]);
    console.log(`staging-guard: ${ref} is not production`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
