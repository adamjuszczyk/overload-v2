import { supabase } from '../../lib/supabase'
import type { UserSettings } from '../../types'

type DbSettings = {
  user_id: string
  theme: string
  accent_colour: string
  rest_timer_enabled: boolean
  buzz_on_rest_complete: boolean
  target_rest_seconds: number
  weight_unit: string
  auto_finish_minutes: number | null
  measure_set_time?: boolean  // absent until migration 005 has been applied
  week_start?: string  // absent until migration 027 has been applied
  warmup_display?: string  // absent until migration 027 has been applied
}

function toUserSettings(row: DbSettings): UserSettings {
  return {
    theme: row.theme as UserSettings['theme'],
    accentColour: row.accent_colour,
    restTimerEnabled: row.rest_timer_enabled,
    buzzOnRestComplete: row.buzz_on_rest_complete,
    targetRestSeconds: row.target_rest_seconds,
    weightUnit: row.weight_unit as UserSettings['weightUnit'],
    // Falls back to the column default until the auto_finish_minutes
    // migration has been run — the key is absent from the row entirely
    // rather than null, since the column doesn't exist yet.
    autoFinishMinutes: row.auto_finish_minutes === undefined ? 5 : row.auto_finish_minutes,
    measureSetTime: row.measure_set_time ?? false,
    // Falls back to the column default ('copy' — SPEC G4) until migration
    // 027 has been run, same "key missing" convention as the others above.
    weekStart: (row.week_start as UserSettings['weekStart'] | undefined) ?? 'copy',
    // Falls back to the column default ('rows' — SPEC "Warmup sets") until
    // migration 027 has been run, same "key missing" convention as the
    // others above.
    warmupDisplay: (row.warmup_display as UserSettings['warmupDisplay'] | undefined) ?? 'rows',
  }
}

export async function fetchSettings(userId: string): Promise<UserSettings | null> {
  const { data, error } = await supabase
    .from('v2_user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return toUserSettings(data as DbSettings)
}

// Always sends the complete row. A partial upsert on first save (no row yet)
// lets Postgres column defaults fill in every untouched field — and the DB
// default for buzz_on_rest_complete (false) disagrees with the client default
// (true), so a first-ever settings change silently flipped it off.
export async function upsertSettings(
  userId: string,
  settings: UserSettings,
): Promise<void> {
  const row: DbSettings = {
    user_id: userId,
    theme: settings.theme,
    accent_colour: settings.accentColour,
    rest_timer_enabled: settings.restTimerEnabled,
    buzz_on_rest_complete: settings.buzzOnRestComplete,
    target_rest_seconds: settings.targetRestSeconds,
    weight_unit: settings.weightUnit,
    auto_finish_minutes: settings.autoFinishMinutes,
    measure_set_time: settings.measureSetTime,
    week_start: settings.weekStart,
    warmup_display: settings.warmupDisplay,
  }

  const { error } = await supabase
    .from('v2_user_settings')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}
