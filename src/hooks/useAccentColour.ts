import { useEffect } from 'react'
import { create } from 'zustand'

const DEFAULT_ACCENT = '#FF8C42'

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

// Call once in AppRoutes. Pass accent when loaded from settings (Phase 10);
// omit to use the store value (defaults to #FF8C42 on first load).
export function useAccentColour(accent?: string) {
  const { accentColour, setAccentColour } = useAccentStore()

  useEffect(() => {
    const value = accent ?? accentColour
    document.documentElement.style.setProperty('--accent', value)
    if (accent && accent !== accentColour) {
      setAccentColour(accent)
    }
  }, [accent, accentColour, setAccentColour])
}
