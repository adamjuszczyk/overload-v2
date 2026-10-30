import { useSettingsStore } from '@app/features/settings/settingsStore'
import type { UserSettings } from '@app/types'
export function useSettings() {
  const data = useSettingsStore((s) => s) as unknown as UserSettings
  return { data, isLoading: false, isError: false }
}
export function useUpdateSettings() {
  const hydrate = useSettingsStore((s) => s.hydrate)
  return { mutate: (patch: Partial<UserSettings>) => hydrate({ ...(useSettingsStore.getState() as any), ...patch }) }
}
export function useUpdateDeloadRules() {
  const hydrate = useSettingsStore((s) => s.hydrate)
  return { mutate: (deloadRules: any) => hydrate({ ...(useSettingsStore.getState() as any), deloadRules }) }
}
