import { useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { useSettingsStore, DEFAULT_SETTINGS } from './settingsStore'
import { fetchSettings, upsertSettings } from './settingsService'
import type { UserSettings } from '../../types'

const SETTINGS_KEY = ['v2_settings']

export function useSettings() {
  const { user } = useAuth()
  const hydrate = useSettingsStore((s) => s.hydrate)

  const query = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => fetchSettings(user!.id),
    enabled: !!user,
    staleTime: Infinity,
  })

  // Hydrate Zustand store so RestTimer / SetRow can read without prop drilling
  useEffect(() => {
    if (query.data !== undefined) {
      hydrate(query.data ?? DEFAULT_SETTINGS)
    }
  }, [query.data, hydrate])

  return { ...query, data: query.data ?? DEFAULT_SETTINGS }
}

export function useUpdateSettings() {
  const { user } = useAuth()
  const hydrate = useSettingsStore((s) => s.hydrate)

  return useMutation({
    mutationFn: (patch: Partial<UserSettings>) => upsertSettings(user!.id, patch),
    onMutate: (patch) => {
      const current =
        queryClient.getQueryData<UserSettings | null>(SETTINGS_KEY) ?? DEFAULT_SETTINGS
      const merged = { ...current, ...patch }
      hydrate(merged)
      queryClient.setQueryData(SETTINGS_KEY, merged)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  })
}
