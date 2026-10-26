// A test stand-in for what the workout screen hands every card to write what a delete calls for (chunk 61, `setDelete.ts`'s `SessionWriters`): each writer is
// a spy that answers at once, so a test reads the calls. `online` is a switch of the test's own, as the screen's `useOnlineStatus` is.
import { vi } from 'vitest'
import type { SessionWriters } from './setDelete'

export type SpyWriters = SessionWriters & {
  writeChanges: ReturnType<typeof vi.fn>
  patchNumbers: ReturnType<typeof vi.fn>
  clearStageKind: ReturnType<typeof vi.fn>
  patchLog: ReturnType<typeof vi.fn>
  queueChanges: ReturnType<typeof vi.fn>
}

export function spyWriters(over: Partial<SessionWriters> = {}): SpyWriters {
  return {
    mesocycleId: 'meso-1',
    weekNumber: 2,
    isCycle: false,
    online: true,
    writeChanges: vi.fn(async () => {}),
    patchNumbers: vi.fn(async () => {}),
    clearStageKind: vi.fn(async () => {}),
    patchLog: vi.fn(async () => {}),
    queueChanges: vi.fn(async () => {}),
    ...over,
  } as SpyWriters
}
