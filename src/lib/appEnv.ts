// Which deployment this bundle is (VITE_APP_ENV, set per Vercel environment).
// 'staging' builds show a STAGING badge and install as a differently named,
// differently coloured PWA (vite.config.ts), so a real workout is never logged
// into staging by mistake. Anything else (unset included) is the real app.
//
// A staging build pointed at production's Supabase project refuses to start:
// staging holds synthetic data only, and its test account must never write to
// production (CONTEXT.md, "Staging").

// Production's Supabase project ref (CONTEXT.md, Repo facts). Also in
// scripts/staging-guard.mjs, which the staging scripts use.
export const PRODUCTION_SUPABASE_REF = 'imhsawrghteqsmpklofv'

export type AppEnv = 'staging' | 'production'

export function resolveAppEnv(raw: unknown): AppEnv {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'staging' ? 'staging' : 'production'
}

// The project ref of a Supabase URL (https://<ref>.supabase.co), or null.
export function supabaseRefOf(url: string): string | null {
  const match = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in)(\/|$)/i.exec(url.trim())
  return match ? match[1].toLowerCase() : null
}

// Throws when a staging bundle is configured with production's database.
export function assertStagingNotOnProduction(env: AppEnv, supabaseUrl: string): void {
  if (env === 'staging' && supabaseRefOf(supabaseUrl) === PRODUCTION_SUPABASE_REF) {
    throw new Error('This staging build is configured with the production database. Set the staging Supabase URL for this deployment.')
  }
}

export const APP_ENV: AppEnv = resolveAppEnv(import.meta.env.VITE_APP_ENV)
export const IS_STAGING = APP_ENV === 'staging'
