import { useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { queryClient } from '../../lib/queryClient'
import { useAuth } from '../auth/useAuth'
import { useSettingsStore, DEFAULT_SETTINGS } from './settingsStore'
import { fetchSettings, upsertSettings } from './settingsService'
import type { UserSettings } from '../../types'
import type { DeloadRules } from '../../lib/deloadRules'

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
    // Send the full merged settings object, never a raw partial — see
    // upsertSettings for why a partial upsert corrupts unset fields.
    mutationFn: (patch: Partial<UserSettings>) => {
      const current =
        queryClient.getQueryData<UserSettings | null>(SETTINGS_KEY) ?? DEFAULT_SETTINGS
      const merged: UserSettings = { ...current, ...patch }
      return upsertSettings(user!.id, merged)
    },
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

// Chunk 22 (SPEC.md "Settings" — "default deload rules"; reviewer's note
// 7: "Writes use networkMode: 'always'") — a SEPARATE mutation from
// useUpdateSettings above, not a widening of it: every other Settings
// field keeps that hook's existing (default 'online') networkMode exactly
// as it was — this file's one new write path is the only thing that
// changes, scoped to its own mutation object so it can carry 'always'
// without touching the shared hook every other control already uses.
// Same "send the merged full row" shape as useUpdateSettings (upsertSettings
// always wants the complete row — see its own header), and the same
// optimistic hydrate so DeloadRulesEditor.tsx's own controls (and anything
// else reading the live store) reflect the change immediately.
export function useUpdateDeloadRules() {
  const { user } = useAuth()
  const hydrate = useSettingsStore((s) => s.hydrate)

  return useMutation({
    networkMode: 'always',
    mutationFn: (deloadRules: DeloadRules | null) => {
      const current =
        queryClient.getQueryData<UserSettings | null>(SETTINGS_KEY) ?? DEFAULT_SETTINGS
      const merged: UserSettings = { ...current, deloadRules }
      return upsertSettings(user!.id, merged)
    },
    onMutate: (deloadRules) => {
      const current =
        queryClient.getQueryData<UserSettings | null>(SETTINGS_KEY) ?? DEFAULT_SETTINGS
      const merged: UserSettings = { ...current, deloadRules }
      hydrate(merged)
      queryClient.setQueryData(SETTINGS_KEY, merged)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  })
}
