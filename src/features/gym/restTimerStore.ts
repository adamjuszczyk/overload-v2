import { create } from 'zustand'

interface RestTimerState {
  startedAt: number | null  // Date.now() value when last set was logged
  isVisible: boolean
  // Id of the set log that most recently (re)started this rest period — lets
  // a specific row render an inline "REST 0:45" under itself (SPEC §4.3's
  // "not only as a floating/global element"), in addition to the existing
  // floating timer. Set once the log's real id is known (see GymSession.tsx's
  // onLog), so it lags start() by one round trip — there's nothing to point
  // at until the row actually exists.
  anchorId: string | null
  start: () => void
  stop: () => void
  hide: () => void
  show: () => void
  setAnchor: (id: string | null) => void
}

export const useRestTimerStore = create<RestTimerState>((set) => ({
  startedAt: null,
  isVisible: true,
  anchorId: null,
  start: () => set({ startedAt: Date.now(), isVisible: true, anchorId: null }),
  stop: () => set({ startedAt: null, anchorId: null }),
  hide: () => set({ isVisible: false }),
  show: () => set({ isVisible: true }),
  setAnchor: (id) => set({ anchorId: id }),
}))
