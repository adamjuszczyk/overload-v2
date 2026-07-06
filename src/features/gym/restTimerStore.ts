import { create } from 'zustand'

interface RestTimerState {
  startedAt: number | null  // Date.now() value when last set was logged
  isVisible: boolean
  start: () => void
  stop: () => void
  hide: () => void
  show: () => void
}

export const useRestTimerStore = create<RestTimerState>((set) => ({
  startedAt: null,
  isVisible: true,
  start: () => set({ startedAt: Date.now(), isVisible: true }),
  stop: () => set({ startedAt: null }),
  hide: () => set({ isVisible: false }),
  show: () => set({ isVisible: true }),
}))
