import { create } from 'zustand'
import type { UserSettings } from '../../types'

export const DEFAULT_SETTINGS: UserSettings = {
  theme: 'dark',
  accentColour: '#FF8C42',
  restTimerEnabled: true,
  buzzOnRestComplete: true,
  targetRestSeconds: 120,
  weightUnit: 'kg',
  autoFinishMinutes: 5,
  measureSetTime: false,
  weekStart: 'copy',
  warmupDisplay: 'rows',
}

interface SettingsStoreState extends UserSettings {
  hydrate: (settings: UserSettings) => void
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  ...DEFAULT_SETTINGS,
  hydrate: (settings) => set(settings),
}))
