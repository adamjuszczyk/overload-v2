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
}

function toUserSettings(row: DbSettings): UserSettings {
  return {
    theme: row.theme as UserSettings['theme'],
    accentColour: row.accent_colour,
    restTimerEnabled: row.rest_timer_enabled,
    buzzOnRestComplete: row.buzz_on_rest_complete,
    targetRestSeconds: row.target_rest_seconds,
    weightUnit: row.weight_unit as UserSettings['weightUnit'],
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

export async function upsertSettings(
  userId: string,
  patch: Partial<UserSettings>,
): Promise<void> {
  const row: Partial<DbSettings> & { user_id: string } = { user_id: userId }
  if (patch.theme !== undefined)              row.theme = patch.theme
  if (patch.accentColour !== undefined)       row.accent_colour = patch.accentColour
  if (patch.restTimerEnabled !== undefined)   row.rest_timer_enabled = patch.restTimerEnabled
  if (patch.buzzOnRestComplete !== undefined) row.buzz_on_rest_complete = patch.buzzOnRestComplete
  if (patch.targetRestSeconds !== undefined)  row.target_rest_seconds = patch.targetRestSeconds
  if (patch.weightUnit !== undefined)         row.weight_unit = patch.weightUnit

  const { error } = await supabase
    .from('v2_user_settings')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}
