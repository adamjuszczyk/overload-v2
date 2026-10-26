// Chunk 61 (TASKS-1.2 61; SPEC [1.2] "Delete set (18b)", "Offline (G47)"; DECISIONS 146 (a), 147 (a), 170, 178): what DELETE writes, and in which order.
// `deleteEffects` (46r) says everything a delete does; this file sends it. The card calls `runDelete` once per delete and the screen's writers do the
// requests: online each is awaited and the first refusal stops the rest, offline each goes into the sync queue (the delete items 57 built, the change
// row as an upsert, the renumber as 58a's `patch` items) in the order below, which is the order the queue replays them in.
//
// THE ORDER (the one `deleteEffects`' header leaves to this chunk: "until a deleted set's change row has landed, a refetch draws the set as an open row"):
//   1. the logs, the drops from the last, then the head (`cascadeDeleteOrder`: a head's delete waits for its stages', 57). The first refusal stops
//      everything after it, so a delete that did not complete leaves what is left on screen and re-deletable, never a set hidden whose logs are
//      still there counting in History and Volume;
//   2. the head's stage kind, when its last drop went (147 (a)): the log is a normal set from here;
//   3. the change rows (`deleted`, replacing the set's `retyped` row by its id; a drop's `retyped` / `pending_stages` row);
//   4. the numbers of the sets after it (`renumber`, drops included), as `patch` items: 178's own path, so a number is never written twice.
// What the screen draws meanwhile is the change rows, held at once by the card (`useWorkoutRows.holdChanges`), so the log going before its change
// row never draws the set as an open row.
//
// One write has no offline path: a head losing its stage kind is a patch of a column the queue's `patch` item does not carry (it is `{ id, set_number }`
// and nothing else: DECISIONS 197), and a whole-row save of the log would bring back a log another phone deleted and write this phone's weight and reps
// over another's edit. A delete that holds it says "Requires a connection" before anything is written. Every other delete works offline.
import type { ChangeWrite, DeleteEffects, LoggedSet, NumberPatch } from './workoutRules'

/** What the workout screen hands every card for writing what a set's change calls for, and the run and week CUES writes to. */
export interface SessionWriters {
  mesocycleId: string | null
  weekNumber: number
  /** A sequence run's week is a cycle (the cues sheet's eyebrow says CYCLE). */
  isCycle: boolean
  online: boolean
  /** The change rows of one delete (or, from 62, one type change): in order, online or queued. */
  writeChanges: (writes: readonly ChangeWrite[]) => Promise<void>
  /** The renumber: 58a's `patchSetNumbers`, each patch queued behind the earlier writes to its log. */
  patchNumbers: (patches: readonly NumberPatch[]) => Promise<void>
  /** A logged head loses its stage kind (online only). */
  clearStageKind: (logId: string) => Promise<void>
}

/** A delete that can't be sent without a connection; nothing was written. */
export class NeedsConnectionError extends Error {
  constructor() {
    super('Requires a connection')
    this.name = 'NeedsConnectionError'
  }
}

export interface DeleteDeps {
  /** One log: the screen's `useDeleteSetLog` (online the request, offline the queue's `delete` item, a stage naming its head). */
  deleteLog: (log: Pick<LoggedSet, 'id' | 'parentSetId'>) => Promise<void>
  writers: Pick<SessionWriters, 'online' | 'writeChanges' | 'patchNumbers' | 'clearStageKind'>
}

export async function runDelete(effects: DeleteEffects, { deleteLog, writers }: DeleteDeps): Promise<void> {
  // Before anything is written: a delete that can't be finished isn't started (a half-done one would leave the drop's log gone and its head a dropset).
  if (effects.headPatch !== null && !writers.online) throw new NeedsConnectionError()
  for (const log of effects.deleteOrder) await deleteLog(log)
  if (effects.headPatch !== null) await writers.clearStageKind(effects.headPatch.id)
  if (effects.changes.length > 0) await writers.writeChanges(effects.changes)
  if (effects.renumber.length > 0) await writers.patchNumbers(effects.renumber)
}
