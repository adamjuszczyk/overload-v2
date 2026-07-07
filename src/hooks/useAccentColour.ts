import { useEffect } from 'react'
import { create } from 'zustand'

const DEFAULT_ACCENT = '#FF8C42'
const MUTED_ALPHA = 0.15

// Zustand store — holds the current accent colour in memory so any component
// can read it without prop drilling. Phase 10 will hydrate this from Supabase.
interface AccentStore {
  accentColour: string
  setAccentColour: (colour: string) => void
}

export const useAccentStore = create<AccentStore>(set => ({
  accentColour: DEFAULT_ACCENT,
  setAccentColour: colour => set({ accentColour: colour }),
}))

// --accent-muted must always track --accent's hue — a hardcoded rgba() in
// tokens.css only matched the default orange, so switching accent colour in
// Settings left every "muted" fill (SYNC badges, chips, deload toggles) orange.
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return hex
  const bigint = parseInt(clean, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// Call once in AppRoutes. Pass accent when loaded from settings (Phase 10);
// omit to use the store value (defaults to #FF8C42 on first load).
export function useAccentColour(accent?: string) {
  const { accentColour, setAccentColour } = useAccentStore()

  useEffect(() => {
    const value = accent ?? accentColour
    document.documentElement.style.setProperty('--accent', value)
    document.documentElement.style.setProperty('--accent-muted', hexToRgba(value, MUTED_ALPHA))
    if (accent && accent !== accentColour) {
      setAccentColour(accent)
    }
  }, [accent, accentColour, setAccentColour])
}
