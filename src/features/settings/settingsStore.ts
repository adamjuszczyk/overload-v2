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
  // Chunk 22 — SPEC.md "Deload rules"/"Settings": "default deload rules",
  // "off by default".
  deloadRules: null,
  // Migration 042 (TASKS-1.2 chunk 36) — SPEC [1.2] "Settings": "each drop =
  // ½" and "Log sets in order" on are the defaults.
  stageVolumeRule: 'half',
  logInOrder: true,
}

interface SettingsStoreState extends UserSettings {
  hydrate: (settings: UserSettings) => void
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  ...DEFAULT_SETTINGS,
  hydrate: (settings) => set(settings),
}))
