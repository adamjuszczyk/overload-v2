// Chunk 61's review 1 (F1; SPEC G47: "logging, delete set and unlog work offline and sync later through the sync queue"; DECISIONS 146 (a), 147 (a),
// 197): a logged head whose last drop was deleted is a normal set from then on, so its log loses its stage kind. `deleteEffects` says so (`headPatch`)
// and `runDelete` sends it after the drop's own log and before the change rows.
//
// Online it is the request it always was (`useUpdateSetLog`: `update({ stage_kind: null }).eq('id', id)`, awaited, a refusal thrown so W9 says why).
// Offline it is one `patch` queue item, `{ id, stage_kind: null }` (58a's patch item, widened by this one shape: `queueSetLogStageKindClear`), queued
// after the drop's `delete` item and held behind the drops' writes when the queue is sent. It is never a whole-row save of the log (DECISIONS 197's
// condition: it could bring back a log another phone deleted and write this phone's weight and reps over another's edit), and `useUpdateSetLog` is
// not used offline: TanStack pauses that mutation until the phone is online, which would leave the confirm on DELETING… with nothing written.
// The screen's own copy of the session changes at once either way, so the head is drawn as the normal set it is.
import { queryClient } from '../../lib/queryClient'
import { queueSetLogStageKindClear } from '../offline/useSyncQueue'
import type { Session } from '../../types'

export async function clearStageKind({
  sessionId,
  logId,
  online,
  update,
}: {
  sessionId: string
  logId: string
  online: boolean
  /** Online: the request itself (`useUpdateSetLog`'s `mutateAsync`, which also changes the screen's copy and reads the session again). */
  update: (logId: string) => Promise<unknown>
}): Promise<void> {
  if (online) {
    await update(logId)
    return
  }
  await queueSetLogStageKindClear({ id: logId, sessionId })
  // A read of the session that left before the item was queued would bring back the head with its kind: it is stopped first, as `useUpdateSetLog`
  // stops it before its own optimistic write.
  await queryClient.cancelQueries({ queryKey: ['v2_session', sessionId] })
  queryClient.setQueryData(['v2_session', sessionId], (old: Session | undefined) =>
    old ? { ...old, setLogs: old.setLogs?.map((log) => (log.id === logId ? { ...log, stageKind: null } : log)) } : old,
  )
}
