import { create } from 'zustand'

export type Gate = 'none' | 'maintenance' | 'update'
export type UpdateState = 'ready' | 'updating' | 'failed'

interface DemoState {
  online: boolean
  queued: number
  gate: Gate
  exemptStrip: boolean
  updateState: UpdateState
  afterUpdateSheet: boolean
  menuOpen: boolean
  counting: boolean
  openDelete: string | null
  openTempo: string | null
  set: (patch: Partial<Omit<DemoState, 'set'>>) => void
}

export const useDemo = create<DemoState>((set) => ({
  online: true,
  queued: 0,
  gate: 'none',
  exemptStrip: false,
  updateState: 'ready',
  afterUpdateSheet: false,
  menuOpen: false,
  counting: false,
  openDelete: null,
  openTempo: null,
  set: (patch) => set(patch),
}))
