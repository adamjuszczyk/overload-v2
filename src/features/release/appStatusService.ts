import { supabase } from '../../lib/supabase'

// Chunk 72 (SPEC.md 1.2.1, Objects stored → `v2_app_status`; TASKS.md "Data model (1.2.1)"). The app's release state: one row that anyone,
// signed out included, can read, and that nobody can write through the API (migration 048: Adam changes it in the SQL editor). This file is
// the one read of it. The screens it decides are `gates.tsx`'s; when the read happens is `useAppStatus.ts`'s.
export interface AppStatus {
  /** On: the database refuses a non-exempt signed-in user's writes (`OL001`) and the maintenance screen shows. */
  maintenance: boolean
  /** The oldest app version allowed to run (chunk 73 gates on it; this chunk only carries it). */
  minVersion: string
  /** The accounts that keep working during maintenance. */
  exemptUserIds: string[]
  updatedAt: string
}

type DbAppStatus = {
  maintenance: boolean
  min_version: string
  exempt_user_ids: string[] | null
  updated_at: string
}

function toAppStatus(row: DbAppStatus): AppStatus {
  return {
    // Only a real `true` is maintenance: a row that reads any other way never locks anyone out.
    maintenance: row.maintenance === true,
    minVersion: row.min_version,
    exemptUserIds: Array.isArray(row.exempt_user_ids) ? row.exempt_user_ids : [],
    updatedAt: row.updated_at,
  }
}

/** The status row (`select *`, one row by `.single()`). A read that fails throws: the app then works as usual (no status is no gate). */
export async function fetchAppStatus(): Promise<AppStatus> {
  const { data, error } = await supabase.from('v2_app_status').select('*').single()
  if (error) throw error
  return toAppStatus(data as DbAppStatus)
}
