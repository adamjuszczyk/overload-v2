import { supabase } from '../../lib/supabase'
import type { UserSettings } from '../../types'
import { validateDeloadRules } from '../../lib/deloadRules'

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
  week_start?: string  // absent until migration 027 has been applied; READ ONLY since chunk 49 (see DbSettingsWrite)
  warmup_display?: string  // absent until migration 027 has been applied
  deload_rules?: unknown  // absent until migration 027 has been applied; jsonb, validated on read
  stage_volume_rule?: string  // absent until migration 042 has been applied; written since chunk 49
  log_in_order?: boolean  // absent until migration 042 has been applied; written since chunk 49
}

// What upsertSettings writes: every column but week_start. SPEC [1.2] removes
// the "new week starts" setting (Screens → Settings), and from chunk 49 the
// full-row upsert omits the key, so a stored value stays exactly as it is (the
// upsert only updates the columns its payload names). Typing the row without
// the column makes naming it a compile error, not just a failing test.
type DbSettingsWrite = Omit<DbSettings, 'week_start'>

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
    // Read only since chunk 49 (the setting is gone from Settings and from the
    // upsert): Plan's highlighting and v2_plan_week (041) still read the stored
    // value until chunks 53 and 54b.
    weekStart: (row.week_start as UserSettings['weekStart'] | undefined) ?? 'copy',
    // Falls back to the column default ('rows' — SPEC "Warmup sets") until
    // migration 027 has been run, same "key missing" convention as the
    // others above.
    warmupDisplay: (row.warmup_display as UserSettings['warmupDisplay'] | undefined) ?? 'rows',
    // Chunk 22 — validated defensively on every read (deloadRules.ts is the
    // one place this shape is decided); falls back to null ("no rules on")
    // both before migration 027 (key absent) and for a malformed stored
    // value, same posture as every other "may not exist yet" field above.
    deloadRules: validateDeloadRules(row.deload_rules),
    // Migration 042 (TASKS-1.2 chunk 36) — SPEC [1.2] "Settings": how drops
    // and stages count in volume (default each drop = ½) and the log lock
    // (default on). Same "key missing" fallback to the column defaults as the
    // fields above, until 042 has been applied. Chunk 36 only read them;
    // upsertSettings below writes both since chunk 49 (042 is live on staging).
    stageVolumeRule: (row.stage_volume_rule as UserSettings['stageVolumeRule'] | undefined) ?? 'half',
    logInOrder: row.log_in_order ?? true,
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
//
// "Complete" means every column the app still owns. Chunk 49 (SPEC [1.2]
// Settings): the row now names stage_volume_rule and log_in_order (migration
// 042) and no longer names week_start, so a stored week_start is never
// overwritten, and a first save with no row yet gets its column default.
export async function upsertSettings(
  userId: string,
  settings: UserSettings,
): Promise<void> {
  const row: DbSettingsWrite = {
    user_id: userId,
    theme: settings.theme,
    accent_colour: settings.accentColour,
    rest_timer_enabled: settings.restTimerEnabled,
    buzz_on_rest_complete: settings.buzzOnRestComplete,
    target_rest_seconds: settings.targetRestSeconds,
    weight_unit: settings.weightUnit,
    auto_finish_minutes: settings.autoFinishMinutes,
    measure_set_time: settings.measureSetTime,
    warmup_display: settings.warmupDisplay,
    deload_rules: settings.deloadRules,
    stage_volume_rule: settings.stageVolumeRule,
    log_in_order: settings.logInOrder,
  }

  const { error } = await supabase
    .from('v2_user_settings')
    .upsert(row, { onConflict: 'user_id' })
  if (error) throw error
}
