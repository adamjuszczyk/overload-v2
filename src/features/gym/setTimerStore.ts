import { create } from 'zustand'

interface SetTimerState {
  startedAt: number | null  // Date.now() value when Start Set was tapped
  start: () => void
  stop: () => void
}

export const useSetTimerStore = create<SetTimerState>((set) => ({
  startedAt: null,
  start: () => set({ startedAt: Date.now() }),
  stop: () => set({ startedAt: null }),
}))
