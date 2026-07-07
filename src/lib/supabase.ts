import { createClient } from '@supabase/supabase-js'

// Strip any invisible/non-ASCII characters (BOM, zero-width spaces, etc.) that
// can be accidentally introduced when copy-pasting values into a hosting dashboard.
// These characters are above U+007E and cause "non ISO-8859-1 code point" errors
// in the Authorization header across all browsers.
const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string ?? '')
  .replace(/[^\x20-\x7E]/g, '')
  .trim()
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string ?? '')
  .replace(/[^\x20-\x7E]/g, '')
  .trim()

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env.local and fill in your project values.',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
