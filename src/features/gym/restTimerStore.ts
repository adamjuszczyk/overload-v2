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
  // Chunk 16 (SPEC "Rest") — the rest-chain-resolved target for the CURRENT
  // rest period, in seconds. null means "no override — read Settings' own
  // targetRestSeconds", exactly today's only behaviour (RestTimer.tsx/
  // RestTimerInline.tsx fall back to it). Only startRest (below) ever sets
  // this to a real number; start() always resets it to null, so a stale
  // override from an earlier call never leaks into a plain start() — kept
  // for D30 (RestTimer.d30.test.tsx calls start() directly and must still
  // land on the Settings target, unchanged).
  targetSeconds: number | null
  // Unchanged — zero arguments, same behaviour as before this chunk
  // (RestTimer.d30.test.tsx asserts start.length === 0 and that logging ANY
  // set starts the timer at the Settings target). Reviewer's brief: "add an
  // optional argument or a separate entry point rather than changing the
  // existing signature's behaviour" — this file takes the separate-entry-
  // point option; start() itself is untouched in shape and behaviour.
  start: () => void
  // Chunk 16's own new entry point — the rest-chain's resolved value
  // (restChain.ts's resolveRestTarget), always a real number. "No timer" is
  // never expressed by calling this with null: a caller that resolves "no
  // timer" calls stop() instead (or simply doesn't call this), since the
  // floating/inline timers are both gated on startedAt being set at all.
  startRest: (targetSeconds: number) => void
  stop: () => void
  hide: () => void
  show: () => void
  setAnchor: (id: string | null) => void
}

export const useRestTimerStore = create<RestTimerState>((set) => ({
  startedAt: null,
  isVisible: true,
  anchorId: null,
  targetSeconds: null,
  start: () => set({ startedAt: Date.now(), isVisible: true, anchorId: null, targetSeconds: null }),
  startRest: (targetSeconds) => set({ startedAt: Date.now(), isVisible: true, anchorId: null, targetSeconds }),
  stop: () => set({ startedAt: null, anchorId: null, targetSeconds: null }),
  hide: () => set({ isVisible: false }),
  show: () => set({ isVisible: true }),
  setAnchor: (id) => set({ anchorId: id }),
}))
